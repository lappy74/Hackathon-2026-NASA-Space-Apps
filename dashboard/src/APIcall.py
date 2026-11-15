"""
Field data API for the Farm / ISL ASTRO-NOTS dashboard.

Install:  pip install fastapi uvicorn requests pandas numpy rioxarray planetary-computer pystac-client supabase python-dotenv
Run:      uvicorn APIcall:app --reload --port 8000

Endpoints (the React app calls both with the same query string):
  GET /api/weather?lat=..&lon=..&start=YYYY-MM-DD&end=YYYY-MM-DD   (fast: NASA POWER + GDD)
  GET /api/ndvi?lat=..&lon=..&start=YYYY-MM-DD&end=YYYY-MM-DD      (slow: Landsat NDVI)
"""

from datetime import date, datetime, timezone
from functools import lru_cache
import json
from pathlib import Path
import logging
import os

import numpy as np
import pandas as pd
import planetary_computer
import pystac_client
import requests
import rioxarray
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

# Our private Supabase credentials stay in dashboard/.env, not inside React.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
logger = logging.getLogger("uvicorn.error")

from lora_manual_api import router as manual_lora_router

app = FastAPI(title="Field data API")
app.include_router(manual_lora_router)

# Let the Vite dev server (React app) call this API from the browser.
configured_frontend_url = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
allowed_origins = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
if configured_frontend_url:
    allowed_origins.append(configured_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)



# The LoRa bridge writes a tiny local status file. We just read that here.
# No Supabase secret keys or direct browser-to-USB connections needed.
LORA_STATUS_FILE = Path(__file__).resolve().parent.parent / ".farm_lora_status.json"


@app.get("/api/lora/status")
def get_lora_status():
    # If we haven't started the bridge yet, the dashboard should say offline.
    empty = {
        "bridge_running": False,
        "main_connected": False,
        "main_port": None,
        "weather_cached": False,
        "cached_packet": None,
        "cache_updated_at": None,
        "last_request_at": None,
        "last_reply_tx_at": None,
        "last_reply_status": "none",
        "last_error": None,
        "updated_at": None,
        "events": [],
    }
    try:
        data = json.loads(LORA_STATUS_FILE.read_text(encoding="utf-8"))
        heartbeat = datetime.fromisoformat(data["updated_at"])
        age = (datetime.now(timezone.utc) - heartbeat).total_seconds()
        online = 0 <= age < 40
        result = {**empty, **data}
        result["bridge_running"] = online
        # Last-known data isn't proof that the board is connected right now.
        if not online:
            result["main_connected"] = False
            result["weather_cached"] = False
        return result
    except (OSError, ValueError, KeyError, TypeError):
        return empty


def parse_dates(start: str, end: str) -> tuple[date, date]:
    """Turn 'YYYY-MM-DD' strings into dates and make sure they make sense."""
    try:
        start_d, end_d = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must look like YYYY-MM-DD.")
    if start_d > end_d:
        raise HTTPException(status_code=422, detail="start must be on or before end.")
    return start_d, end_d


@lru_cache(maxsize=1)
def get_farm_database():
    # Reuse one Supabase connection instead of creating one for every weather request.
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SECRET_KEY", "").strip()

    if not url or not key:
        return None

    return create_client(url, key)


def save_latest_farm_weather(lat: float, lon: float, latest_day: dict) -> None:
    # One latest row is enough for our current main Heltec and farmer station.
    # The most recent day returned by NASA POWER is the one we'll send over LoRa.
    row = {
        "id": 1,
        "observation_date": latest_day["date"],
        "temp_avg_c": latest_day["temp_avg"],
        "daily_gdd": latest_day["daily_gdd"],
        "rain_mm": latest_day["rain"],
        "latitude": lat,
        "longitude": lon,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        db = get_farm_database()
        if db is None:
            logger.warning("Farm Supabase sync skipped: missing .env credentials")
            return

        # id=1 is the same row our existing lora_bridge.py already reads.
        db.table("farm_weather_latest").upsert(row, on_conflict="id").execute()
        logger.info("Farm Supabase cache updated for %s", latest_day["date"])
    except Exception as exc:
        # Keep the dashboard usable even if Supabase or our internet is down.
        # The bridge will keep the last successfully stored data until a new sync.
        logger.warning("Farm Supabase sync failed: %s", exc)


# ---------------------------------------------------------------------------
# WEATHER + GDD  (your section 4)
# ---------------------------------------------------------------------------
@app.get("/api/weather")
def weather(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: str = Query(...),
    end: str = Query(...),
    base_temp: float = Query(10.0),
):
    start_d, end_d = parse_dates(start, end)

    params = {
        # Max/min temp for GDD, plus rain and humidity for the other cards
        "parameters": "T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M",
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": start_d.strftime("%Y%m%d"),
        "end": end_d.strftime("%Y%m%d"),
        "format": "JSON",
    }

    try:
        response = requests.get(POWER_URL, params=params, timeout=30)
        response.raise_for_status()
        raw = response.json()["properties"]["parameter"]
    except (requests.RequestException, KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"NASA POWER request failed: {exc}")

    # NASA marks missing days with -999; drop those days so they can't wreck the totals.
    df = pd.DataFrame(raw).replace(-999, np.nan).dropna()
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail="NASA POWER has no data for this location and date range yet.",
        )

    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df = df.sort_index()

    df["temp_avg"] = (df["T2M_MAX"] + df["T2M_MIN"]) / 2
    df["daily_gdd"] = (df["temp_avg"] - base_temp).clip(lower=0)
    df["cumulative_gdd"] = df["daily_gdd"].cumsum()

    daily = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "temp_max": round(float(row["T2M_MAX"]), 1),
            "temp_min": round(float(row["T2M_MIN"]), 1),
            "temp_avg": round(float(row["temp_avg"]), 1),
            "rain": round(float(row["PRECTOTCORR"]), 1),
            "humidity": round(float(row["RH2M"]), 1),
            "daily_gdd": round(float(row["daily_gdd"]), 1),
            "cumulative_gdd": round(float(row["cumulative_gdd"]), 1),
        }
        for idx, row in df.iterrows()
    ]

    # Send the latest available NASA POWER reading to Supabase for our LoRa bridge.
    # If Supabase goes down, the dashboard still returns the weather normally.
    save_latest_farm_weather(lat, lon, daily[-1])

    return {
        "selected_point": {"latitude": lat, "longitude": lon},
        "date_range": {"start": start, "end": end},
        "available_date_range": {
            "start": daily[0]["date"],
            "end": daily[-1]["date"],
        },
        "latest_available_date": daily[-1]["date"],
        "base_temp": base_temp,
        "summary_metrics": {"total_gdd": daily[-1]["cumulative_gdd"]},
        "daily": daily,
    }


# ---------------------------------------------------------------------------
# LANDSAT NDVI  (your section 5)
# ---------------------------------------------------------------------------
def read_reflectance(url: str, bbox: tuple) -> "rioxarray.raster_array.RasterArray":
    """Open one Landsat band, crop it to the box, and convert to surface reflectance."""
    band = (
        rioxarray.open_rasterio(url)
        .rio.clip_box(*bbox, crs="EPSG:4326")
        .astype(float)
    )
    band = band.where(band > 0)  # 0 means "no data" in Landsat, so ignore it
    return band * 0.0000275 - 0.2


@lru_cache(maxsize=32)  # same field + dates a second time = instant, no re-download
def compute_ndvi(bbox: tuple, start: str, end: str, max_scenes: int, max_cloud: float):
    catalog = pystac_client.Client.open(
        STAC_URL, modifier=planetary_computer.sign_inplace
    )
    search = catalog.search(
        collections=["landsat-c2-l2"],
        bbox=list(bbox),
        datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": max_cloud}},
        sortby="-properties.datetime",  # newest first...
        max_items=max_scenes,           # ...and stop after this many (keeps it fast)
    )

    rows = []
    for scene in search.items():
        try:
            red = read_reflectance(scene.assets["red"].href, bbox)
            nir = read_reflectance(scene.assets["nir08"].href, bbox)
            values = ((nir - red) / (nir + red)).values
            values = values[np.isfinite(values)]
            if values.size == 0:
                continue
            rows.append((scene.datetime.strftime("%Y-%m-%d"), float(values.mean())))
        except Exception as exc:  # one bad scene shouldn't kill the whole request
            print(f"Skipping scene {scene.id}: {exc}")

    if not rows:
        return ()

    df = pd.DataFrame(rows, columns=["date", "mean_ndvi"])
    # Two scenes on the same day (overlapping tiles) -> average them
    df = df.groupby("date", as_index=False)["mean_ndvi"].mean().sort_values("date")
    df["mean_ndvi"] = df["mean_ndvi"].round(3)
    return tuple(zip(df["date"], df["mean_ndvi"]))


@app.get("/api/ndvi")
def ndvi(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: str = Query(...),
    end: str = Query(...),
    half_size: float = Query(0.05, gt=0, le=0.25),  # degrees; 0.05 -> a 0.1 x 0.1 degree box
    max_scenes: int = Query(12, ge=1, le=40),
    max_cloud: float = Query(20.0, ge=0, le=100),
):
    parse_dates(start, end)

    # The map gives us one point, so build your bounding box around it:
    # [West_Lon, South_Lat, East_Lon, North_Lat]
    bbox = (
        round(lon - half_size, 4),
        round(lat - half_size, 4),
        round(lon + half_size, 4),
        round(lat + half_size, 4),
    )

    try:
        rows = compute_ndvi(bbox, start, end, max_scenes, max_cloud)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Landsat search failed: {exc}")

    series = [{"date": d, "mean_ndvi": float(v)} for d, v in rows]

    return {
        "selected_area": list(bbox),
        "date_range": {"start": start, "end": end},
        "summary_metrics": {
            "latest_ndvi": series[-1]["mean_ndvi"] if series else None,
            "clear_images_found": len(series),
        },
        "ndvi_time_series": series,
    }

import math  

# Reminder text shown on any notice that is not "good". Change it in one place here.
REMINDER = "Notice: May need to inspect field"  # the only advice we give: go look at the field

# A status is one of: "good", "watch", "alert", or "unknown".
# We give each a rank so we can find the most serious one. Bigger number = more serious.
STATUS_RANK = {"unknown": -1, "good": 0, "watch": 1, "alert": 2}  # unknown is lowest so it never raises the alarm

# ---------------------------------------------------------------------------
# GENERAL TEMPERATURE LIMITS (very rough rules of thumb, in degrees Fahrenheit)
# ---------------------------------------------------------------------------
# "Base" = below this, growth mostly stops. "Upper" = above this, plants get heat stress.
COOL_SEASON_BASE_F = 40   # cool-season crops (like wheat, peas, lettuce) stall below about 40 F
COOL_SEASON_UPPER_F = 80  # cool-season crops get stressed above about 80 F
WARM_SEASON_BASE_F = 50   # warm-season crops (like corn, soybeans, tomatoes) stall below about 50 F
WARM_SEASON_UPPER_F = 86  # warm-season crops get stressed above about 86 F
APPROACH_MARGIN_F = 5     # "approaching" means within this many degrees of a limit


def worst_status(statuses):
    #Return the most serious status from a list, like ['good','watch'] -> 'watch'.
    return max(statuses, key=lambda s: STATUS_RANK[s])  # pick the status with the highest rank


def average(numbers):
    #Average of a list of numbers. Returns None if the list is empty (instead of crashing).
    return sum(numbers) / len(numbers) if numbers else None  # add them up, divide by how many


def c_to_f(celsius):
    #Convert degrees Celsius to degrees Fahrenheit
    return celsius * 9 / 5 + 32  # standard conversion formula


def mm_to_inches(mm):
    #Convert millimeters to inches (25.4 mm in one inch)
    return mm / 25.4  # divide by 25.4


def reminder_for(status):
    #Give the reminder text only when something is not 'good'.
    return REMINDER if status in ("watch", "alert") else ""  # empty text means "show no reminder"


# ---------------------------------------------------------------------------
# SOIL MOISTURE (NASA POWER root-zone soil wetness, a number from 0 to 1)
# ---------------------------------------------------------------------------
# ranges:  0.35-0.45 very dry | 0.45-0.55 marginal | 0.55-0.75 optimal | above 0.80 saturated
# ranges leave two gaps, so I added:  below 0.35 = "extremely dry",  0.75-0.80 = "wet".
def classify_soil_wetness(value):
    #Turn a 0-to-1 soil wetness number into (label, status).
    if value < 0.35:  # drier than your driest range
        return "Extremely dry", "alert"  # very serious
    if value < 0.45:  # 0.35 up to 0.45
        return "Very dry", "alert"  # serious
    if value < 0.55:  # 0.45 up to 0.55
        return "Marginal", "watch"  # worth a look
    if value <= 0.75:  # 0.55 up to 0.75
        return "Optimal", "good"  # the sweet spot
    if value <= 0.80:  # 0.75 up to 0.80 (the gap in your ranges)
        return "Wet", "watch"  # getting close to saturated
    return "Saturated (too wet)", "alert"  # above 0.80


def analyze_soil(daily):
    """daily = the day-by-day list from /api/weather (each day has 'rain' in mm and 'soil_wetness')."""
    last_week = daily[-7:]  # the most recent 7 days
    week_before = daily[-14:-7]  # the 7 days before that

    # Pull out the soil wetness numbers, skipping any day where it is missing (None).
    values = [d.get("soil_wetness") for d in last_week if d.get("soil_wetness") is not None]

    if not values:  # NASA has no soil data at all
        return {  # so we report "unknown" 
            "key": "soil",  # an id the dashboard can use
            "title": "Soil moisture",  # the heading shown on screen
            "status": "unknown",  # not known if good or bad, just missing
            "label": "No data",  # the little pill text
            "message": "Soil moisture data was not available for this area.",  # what happened
            "lines": [],  # this notice has no sub-lines
            "reminder": "",  # nothing to remind about
        }

    this_week = average(values)  # average soil wetness over the last 7 days 
    label, status = classify_soil_wetness(this_week)  # look up the label and status

    trend = ""  # will hold a short phrase about drying or wetting
    earlier = [d.get("soil_wetness") for d in week_before if d.get("soil_wetness") is not None]  # prior week's values
    if earlier:  # only compare if we have last week's data
        change = this_week - average(earlier)  # positive = getting wetter
        if change <= -0.03:  # dropped by 0.03 or more
            trend = " It is drying compared with the week before."
        elif change >= 0.03:  # rose by 0.03 or more
            trend = " It is getting wetter compared with the week before."
        else:  # barely changed
            trend = " It is steady compared with the week before."

    rain_7 = mm_to_inches(sum(d["rain"] for d in daily[-7:]))  # rain over the last 7 days, in inches
    rain_30 = mm_to_inches(sum(d["rain"] for d in daily[-30:]))  # rain over the last 30 days, in inches

    message = (  # build one plain sentence group
        f"Soil wetness averaged {this_week:.2f} (scale of 0 to 1) over the last 7 days.{trend} "
        f"Rain: {rain_7:.1f} in over 7 days, {rain_30:.1f} in over 30 days."
    )

    return {
        "key": "soil",  # id
        "title": "Soil moisture",  # heading
        "status": status,  # good / watch / alert
        "label": label,  # pill text such as "Marginal"
        "message": message,  # the sentence built above
        "lines": [],  # no sub-lines for soil
        "reminder": reminder_for(status),  # "Inspect field" unless status is good
    }


# ---------------------------------------------------------------------------
# TEMPERATURE: is it approaching the cold (base) or hot (upper) limit of crops?
# ---------------------------------------------------------------------------
def check_limits(avg_low_f, avg_high_f, base_f, upper_f):
    #Compare recent lows/highs with one crop type's limits. Returns (status, sentence)
    status = "good"  # start by assuming everything is fine
    parts = []  # sentences describing anything unusual

    if avg_low_f < base_f:  # lows are already under the base temperature
        status = worst_status([status, "alert"])  # raise status to alert
        parts.append(f"Lows averaged {avg_low_f:.0f}°F, below the {base_f}°F base temperature.")
    elif avg_low_f <= base_f + APPROACH_MARGIN_F:  # lows are within 5 degrees above the base
        status = worst_status([status, "watch"])  # raise status to watch
        parts.append(f"Lows averaged {avg_low_f:.0f}°F, approaching the {base_f}°F base temperature.")

    if avg_high_f > upper_f:  # highs are already over the upper limit
        status = worst_status([status, "alert"])  # raise status to alert
        parts.append(f"Highs averaged {avg_high_f:.0f}°F, above the {upper_f}°F upper limit.")
    elif avg_high_f >= upper_f - APPROACH_MARGIN_F:  # highs are within 5 degrees below the upper limit
        status = worst_status([status, "watch"])  # raise status to watch
        parts.append(f"Highs averaged {avg_high_f:.0f}°F, approaching the {upper_f}°F upper limit.")

    if not parts:  # nothing was flagged
        parts.append(  # so say temperatures sit comfortably between the two limits
            f"Highs ({avg_high_f:.0f}°F) and lows ({avg_low_f:.0f}°F) are between the "
            f"{base_f}°F base and {upper_f}°F upper limit."
        )

    return status, " ".join(parts)  # give back the status and the joined sentences


def analyze_temperature(daily):
    """daily needs 'temp_max', 'temp_min', and 'temp_avg' (all in Celsius) for each day."""
    last_week = daily[-7:]  # most recent 7 days
    week_before = daily[-14:-7]  # the 7 days before that

    if not last_week:  # no days at all
        return {  # report "unknown"
            "key": "temperature",  # id
            "title": "Temperature trend",  # heading
            "status": "unknown",  # missing data
            "label": "No data",  # pill text
            "message": "Temperature data was not available for this area.",  # what happened
            "lines": [],  # no sub-lines
            "reminder": "",  # nothing to remind
        }

    avg_low_f = c_to_f(average([d["temp_min"] for d in last_week]))  # average nightly low, in F
    avg_high_f = c_to_f(average([d["temp_max"] for d in last_week]))  # average daily high, in F

    trend = "Temperatures are steady compared with the week before."  # default trend sentence
    if week_before:  # only compare if we have the earlier week
        change_c = average([d["temp_avg"] for d in last_week]) - average([d["temp_avg"] for d in week_before])  # change in C
        change_f = change_c * 1.8  # a change of 1 C equals a change of 1.8 F (no +32 for differences)
        if change_f >= 2:  # warmed by 2 F or more
            trend = f"Temperatures are warming (+{change_f:.0f}°F) compared with the week before."
        elif change_f <= -2:  # cooled by 2 F or more
            trend = f"Temperatures are cooling ({change_f:.0f}°F) compared with the week before."

    cool_status, cool_text = check_limits(avg_low_f, avg_high_f, COOL_SEASON_BASE_F, COOL_SEASON_UPPER_F)  # cool-season check
    warm_status, warm_text = check_limits(avg_low_f, avg_high_f, WARM_SEASON_BASE_F, WARM_SEASON_UPPER_F)  # warm-season check

    status = worst_status([cool_status, warm_status])  # the notice takes the more serious of the two
    labels = {"good": "Within limits", "watch": "Near a limit", "alert": "Outside a limit"}  # pill text by status

    return {
        "key": "temperature",  # id
        "title": "Temperature trend",  # heading
        "status": status,  # worst of cool/warm
        "label": labels[status],  # pill text
        "message": trend,  # the trend sentence
        "lines": [  # one line for each crop type
            {"label": "Cool-season crops", "status": cool_status, "text": cool_text},  # cool-season result
            {"label": "Warm-season crops", "status": warm_status, "text": warm_text},  # warm-season result
        ],
        "reminder": reminder_for(status),  # "Inspect field" unless good
    }


# ---------------------------------------------------------------------------
# SATELLITE GREENNESS (NDVI from Landsat, found through Microsoft Planetary Computer)
# ---------------------------------------------------------------------------
def label_ndvi(value):
    """Plain-English name for an NDVI number."""
    if value < 0.2:  # almost no plant cover
        return "Bare or very sparse"
    if value < 0.4:  # a little plant cover
        return "Sparse or early growth"
    if value < 0.6:  # partial cover
        return "Moderate cover"
    if value < 0.8:  # thick, healthy cover
        return "Dense and healthy"
    return "Peak vigor"  # very thick, very green


def analyze_vegetation(ndvi_series):
    """ndvi_series = list like [{'date': '2026-06-10', 'mean_ndvi': 0.43}, ...], oldest first."""
    if not ndvi_series:  # no clear satellite images were found
        return {  # report "unknown"
            "key": "vegetation",  # id
            "title": "Satellite greenness",  # heading
            "status": "unknown",  # missing data
            "label": "No clear images",  # pill text
            "message": "No clear Landsat images (under 20% cloud) were found for this area and period.",  # why
            "lines": [],  # no sub-lines
            "reminder": "",  # nothing to remind
        }

    latest = ndvi_series[-1]  # the newest image
    value = latest["mean_ndvi"]  # its average greenness
    label = label_ndvi(value)  # plain-English name for that number

    status = "good"  # fine unless something odd shows up
    trend = "this is the only clear image in the period"  # used when there is nothing to compare with
    if len(ndvi_series) >= 2:  # we have an earlier image to compare with
        previous = ndvi_series[-2]  # the image before the newest
        change = value - previous["mean_ndvi"]  # positive = greener
        if abs(change) < 0.03:  # barely changed
            trend = f"about the same as {previous['date']}"
        elif change > 0:  # got greener
            trend = f"up {change:.2f} since {previous['date']}"
        else:  # got less green
            trend = f"down {abs(change):.2f} since {previous['date']}"
        if change <= -0.15:  # a big, fast drop is worth a look
            status = "watch"  # flag it

    message = (  # one sentence
        f"Latest clear Landsat image ({latest['date']}): average greenness (NDVI) "
        f"{value:.2f}, {label.lower()}; {trend}."
    )

    return {
        "key": "vegetation",  # id
        "title": "Satellite greenness",  # heading
        "status": status,  # good or watch
        "label": label,  # pill text
        "message": message,  # the sentence
        "lines": [],  # no sub-lines
        "reminder": reminder_for(status),  # "Inspect field" only if flagged
    }


# ---------------------------------------------------------------------------
# PUT IT ALL TOGETHER (api.py calls this one function)
# ---------------------------------------------------------------------------
def build_area_analysis(daily, ndvi_series, radius_miles):
    """
    daily        = the 'daily' list from /api/weather
    ndvi_series  = list of {'date', 'mean_ndvi'} for the selected circle (can be empty)
    radius_miles = the radius the farmer chose on the map
    """
    notices = [  # run the three checks, in the order they will appear on screen
        analyze_soil(daily),  # soil moisture
        analyze_temperature(daily),  # temperature limits and trend
        analyze_vegetation(ndvi_series),  # satellite greenness
    ]

    overall_status = worst_status([n["status"] for n in notices])  # most serious status of the three

    flagged = [n for n in notices if n["status"] in ("watch", "alert")]  # notices that need a look
    if flagged:  # at least one thing looks unusual
        names = ", ".join(n["title"].lower() for n in flagged)  # e.g. "soil moisture, temperature trend"
        count = len(flagged)  # how many were flagged
        headline = f"{count} item{'s' if count != 1 else ''} flagged for the selected area: {names}. {REMINDER}."  # headline
    elif overall_status == "unknown":  # nothing was usable
        headline = "Not enough data to analyze this area yet."  # say so
    else:  # everything is good (or unknown but not flagged)
        headline = "Nothing unusual flagged for the selected area."  # all clear

    acres = math.pi * radius_miles ** 2 * 640  # area of a circle in square miles, times 640 acres per square mile

    notes = [  # the fine print shown under the notices
        "Soil moisture and temperatures come from NASA POWER at the center of the selected area. "
        "Its grid cells are tens of miles wide, so treat them as a regional guide.",
        "Satellite greenness covers the circle you selected, using clear Landsat images "
        "found through Microsoft Planetary Computer.",
        "Temperature limits are general rules of thumb for cool-season and warm-season crops.",
    ]

    return {
        "overall": {"status": overall_status, "headline": headline},  # the top banner
        "area": {"radius_miles": radius_miles, "acres": round(acres)},  # the size of the selected area
        "notices": notices,  # the list of notices
        "notes": notes,  # the fine print
    }


# Farm local LoRa manual-push endpoint (retains all weather/NDVI routes).
from lora_push_routes import install_lora_push_routes
install_lora_push_routes(app)
