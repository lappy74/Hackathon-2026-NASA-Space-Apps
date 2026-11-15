"""Manual LoRa send route for the Farm dashboard.

FastAPI only queues a request here. The LoRa bridge owns the Heltec USB port.
The main Heltec caches the reading; farmer station requests it with PRG.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()
HERE = Path(__file__).resolve().parent.parent  # dashboard/
STATUS_FILE = HERE / ".farm_lora_status.json"
COMMAND_FILE = HERE / ".farm_lora_send_request.json"


def main_station_ready():
    try:
        state = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        stamp = datetime.fromisoformat(state["updated_at"])
        if stamp.tzinfo is None:
            return False
        age = (datetime.now(timezone.utc) - stamp).total_seconds()
        return (
            0 <= age < 40
            and state.get("bridge_running") is True
            and state.get("main_connected") is True
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


@router.post("/api/lora/send")
def send_latest_weather_to_main():
    # Local demo only: do not expose this unauthenticated write endpoint on
    # public internet. Run Uvicorn on 127.0.0.1 unless you add authentication.
    if not main_station_ready():
        raise HTTPException(status_code=503, detail="LoRa bridge or main Heltec is offline")

    command = {
        "action": "send_latest_weather",
        "request_id": uuid.uuid4().hex,
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }

    # On Linux, link() is atomic and fails if there's already a queued command.
    temp_file = COMMAND_FILE.with_name(COMMAND_FILE.name + "." + command["request_id"] + ".tmp")
    try:
        temp_file.write_text(json.dumps(command), encoding="utf-8")
        try:
            os.link(temp_file, COMMAND_FILE)
        except FileExistsError:
            raise HTTPException(status_code=409, detail="A manual LoRa send is already queued")
    finally:
        temp_file.unlink(missing_ok=True)

    return {"queued": True, **command}
