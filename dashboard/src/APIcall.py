"""
Field data API for the ISL ASTRO-NOTS dashboard.

Install:  pip install fastapi uvicorn requests pandas numpy rioxarray planetary-computer pystac-client
Run:      uvicorn api:app --reload --port 8000

Endpoints (the React app calls both with the same query string):
  GET /api/weather?lat=..&lon=..&start=YYYY-MM-DD&end=YYYY-MM-DD   (fast: NASA POWER + GDD)
  GET /api/ndvi?lat=..&lon=..&start=YYYY-MM-DD&end=YYYY-MM-DD      (slow: Landsat NDVI)
"""

from datetime import date
from functools import lru_cache

import numpy as np
import pandas as pd
import planetary_computer
import pystac_client
import requests
import rioxarray
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

app = FastAPI(title="Field data API")

# Let the Vite dev server (React app) call this API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def parse_dates(start: str, end: str) -> tuple[date, date]:
    """Turn 'YYYY-MM-DD' strings into dates and make sure they make sense."""
    try:
        start_d, end_d = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=422, detail="Dates must look like YYYY-MM-DD.")
    if start_d > end_d:
        raise HTTPException(status_code=422, detail="start must be on or before end.")
    return start_d, end_d


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
            "temp_avg": round(float(row["temp_avg"]), 1),
            "rain": round(float(row["PRECTOTCORR"]), 1),
            "humidity": round(float(row["RH2M"]), 1),
            "daily_gdd": round(float(row["daily_gdd"]), 1),
            "cumulative_gdd": round(float(row["cumulative_gdd"]), 1),
        }
        for idx, row in df.iterrows()
    ]

    return {
        "selected_point": {"latitude": lat, "longitude": lon},
        "date_range": {"start": start, "end": end},
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
