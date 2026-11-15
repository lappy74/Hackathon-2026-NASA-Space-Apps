"""Local Farm LoRa dashboard routes. The bridge owns the USB serial port."""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException

HERE = Path(__file__).resolve().parent.parent
STATUS_FILE = HERE / ".farm_lora_status.json"
COMMAND_FILE = HERE / ".farm_lora_send_request.json"
status_router = APIRouter()
send_router = APIRouter()


def get_status():
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
        "manual_send": None,
    }
    try:
        data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        timestamp = datetime.fromisoformat(data["updated_at"])
        if timestamp.tzinfo is None:
            return empty
        age = (datetime.now(timezone.utc) - timestamp).total_seconds()
        result = {**empty, **data}
        if not 0 <= age < 40:
            result["bridge_running"] = False
            result["main_connected"] = False
            result["weather_cached"] = False
        return result
    except (OSError, ValueError, KeyError, TypeError):
        return empty


@status_router.get("/api/lora/status")
def lora_status():
    return get_status()


@send_router.post("/api/lora/send")
def send_latest_weather_to_farmer():
    # For a local hackathon demo, not a publicly deployed unauthenticated API.
    current = get_status()
    if not current["bridge_running"] or not current["main_connected"]:
        raise HTTPException(status_code=503, detail="LoRa bridge or main Heltec is offline")

    command = {
        "action": "send_latest_weather",
        "request_id": uuid.uuid4().hex,
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }
    # Atomic creation refuses a second request while the first is pending.
    temp = COMMAND_FILE.with_name(COMMAND_FILE.name + "." + command["request_id"] + ".tmp")
    try:
        temp.write_text(json.dumps(command), encoding="utf-8")
        try:
            os.link(temp, COMMAND_FILE)
        except FileExistsError:
            raise HTTPException(status_code=409, detail="Another LoRa send is already queued")
    finally:
        temp.unlink(missing_ok=True)
    return {"queued": True, **command}


def install_lora_push_routes(app):
    # Do not overwrite or duplicate any routes already added by a teammate.
    existing = {(route.path, method) for route in app.routes
                for method in (getattr(route, "methods", None) or ())}
    if ("/api/lora/status", "GET") not in existing:
        app.include_router(status_router)
    if ("/api/lora/send", "POST") not in existing:
        app.include_router(send_router)
