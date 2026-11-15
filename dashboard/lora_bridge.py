# Farm - Supabase to LoRa bridge
# Still sends weather exactly like before, but now keeps a little status file
# so our existing dashboard LoRa tab can show what the boards are doing.

import json
import os
import time
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import serial
from dotenv import load_dotenv
from serial.tools import list_ports
from supabase import create_client

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env", override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY", "").strip()

MAIN_USB_ID = "8C:FD:49:B7:9C:08"
TABLE_NAME = "farm_weather_latest"
POLL_SECONDS = 10
REFRESH_SECONDS = 45
STATUS_FILE = HERE / ".farm_lora_status.json"
COMMAND_FILE = HERE / ".farm_lora_send_request.json"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


status = {
    "bridge_running": True,
    "main_connected": False,
    "main_port": None,
    "weather_cached": False,
    "cached_packet": None,
    "cache_updated_at": None,
    "last_request_at": None,
    "last_reply_tx_at": None,
    "last_reply_status": "none",
    "last_error": None,
    "updated_at": now_iso(),
    "events": [],
    "manual_send": None,
    "last_push_status": "none",
    "last_push_tx_at": None,
    "last_farmer_ack_at": None,
}


def write_status():
    # Write the new status all at once so FastAPI never reads half a JSON file.
    status["updated_at"] = now_iso()
    temp = STATUS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(status, indent=2), encoding="utf-8")
    os.replace(temp, STATUS_FILE)


def add_event(message):
    status["events"] = (
        [{"at": now_iso(), "message": message}] + status["events"]
    )[:10]
    write_status()


def read_main_line(line):
    # Keep the existing terminal output and pass useful events to the dashboard.
    if not line:
        return
    print("[MAIN]", line, flush=True)

    if line.startswith("CACHE_UPDATED="):
        status["weather_cached"] = True
        status["cached_packet"] = line.removeprefix("CACHE_UPDATED=")
        status["cache_updated_at"] = now_iso()
        status["last_error"] = None
        add_event("Main station cached weather")

    elif line == "LORA_RECEIVED=REQ=LATEST":
        status["last_request_at"] = now_iso()
        status["last_reply_status"] = "request_received"
        add_event("Farmer requested latest weather")

    elif line.startswith("REPLY_STARTED="):
        status["last_reply_status"] = "sending"
        add_event("Main station started LoRa reply")

    elif line == "REPLY_TX_DONE":
        status["last_reply_tx_at"] = now_iso()
        status["last_reply_status"] = "transmitted"
        add_event("Main radio finished transmitting")

    elif line == "REPLY_TX_RECOVERY":
        status["last_reply_status"] = "failed"
        add_event("Main radio transmission failed or timed out")

    # These responses are emitted by the upgraded main Heltec after a PUSH.
    elif line.startswith("PUSH_ACCEPTED="):
        status["last_push_status"] = "accepted"
        add_event("Main station accepted dashboard push")

    elif line.startswith("PUSH_TX_DONE="):
        status["last_push_status"] = "transmitted"
        status["last_push_tx_at"] = now_iso()
        add_event("Main transmitted weather to farmer")

    elif line.startswith("PUSH_ACK_RECEIVED="):
        status["last_push_status"] = "delivered"
        status["last_farmer_ack_at"] = now_iso()
        add_event("Farmer station acknowledged weather")

    elif line.startswith("PUSH_ACK_TIMEOUT="):
        status["last_push_status"] = "unconfirmed"
        add_event("No farmer acknowledgment received")

    elif line.startswith("PUSH_TX_FAILED=") or line.startswith("PUSH_ERROR="):
        status["last_push_status"] = "failed"
        add_event("Main station could not complete push")


def find_main_port():
    # The main Heltec can move between ACM0/ACM1/ACM2 after reconnecting.
    for port in list_ports.comports():
        if port.serial_number == MAIN_USB_ID:
            return port.device
    raise RuntimeError("Main Heltec not found. Check its USB connection.")


def to_tenths(value):
    # LoRa sends temperature 20.7 as integer 207.
    number = Decimal(str(value)) * 10
    return int(number.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def get_latest_weather(db):
    result = (
        db.table(TABLE_NAME)
        .select("observation_date,temp_avg_c,daily_gdd,rain_mm")
        .eq("id", 1)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def build_packet(weather):
    date_code = date.fromisoformat(weather["observation_date"]).strftime("%Y%m%d")
    temp10 = to_tenths(weather["temp_avg_c"])
    gdd10 = to_tenths(weather["daily_gdd"])
    rainfall = Decimal(str(weather["rain_mm"]))
    if rainfall < 0:
        raise ValueError("Rainfall cannot be negative")

    # Keep the packet format that already works with both Arduino sketches.
    packet = (
        f"SEQ={date_code},D={date_code},G10={gdd10},"
        f"T10={temp10},R={1 if rainfall > 0 else 0},SM=NA"
    )
    if len(packet) >= 120:
        raise ValueError("LoRa weather packet is too long")
    return packet


def update_main_cache(board, packet):
    board.write((packet + "\n").encode("ascii"))
    board.flush()
    print("[BRIDGE] Sending:", packet, flush=True)

    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        line = board.readline().decode("utf-8", errors="replace").strip()
        if line:
            read_main_line(line)
        if line == f"CACHE_UPDATED={packet}":
            return True
    return False


def take_manual_request():
    # FastAPI creates this JSON request atomically; only this bridge removes it.
    try:
        raw = COMMAND_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None

    COMMAND_FILE.unlink(missing_ok=True)
    try:
        command = json.loads(raw)
        if command.get("action") != "send_latest_weather" or not command.get("request_id"):
            raise ValueError("Invalid dashboard send request")
        return command
    except (ValueError, TypeError) as error:
        status["last_error"] = str(error)
        add_event("Invalid dashboard send request")
        return None


def run_manual_send(board, db, command):
    # Dashboard push is one serial command: cache AND transmit to the farmer.
    # Do not report success just because the main Heltec cached the packet.
    status["manual_send"] = {
        "request_id": command["request_id"],
        "state": "sending",
        "requested_at": command.get("requested_at"),
        "completed_at": None,
        "error": None,
    }
    status["last_push_status"] = "sending"
    add_event("Dashboard requested immediate farmer delivery")

    try:
        latest = get_latest_weather(db)
        if latest is None:
            raise ValueError("No weather row available in Supabase")
        packet = build_packet(latest)
        status["manual_send"]["packet"] = packet
        write_status()

        # The upgraded firmware recognizes PUSH:<weather packet>.
        # It caches the packet and immediately transmits PUSH=<id>|<weather>.
        board.write(("PUSH:" + packet + "\n").encode("ascii"))
        board.flush()
        print("[BRIDGE] Dashboard PUSH to farmer:", packet, flush=True)

        accepted_id = None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            line = board.readline().decode("utf-8", errors="replace").strip()
            if not line:
                continue
            read_main_line(line)

            if line.startswith("PUSH_ERROR="):
                raise RuntimeError("Main Heltec rejected push: " + line.split("=", 1)[1])

            if line.startswith("PUSH_ACCEPTED="):
                accepted_id = line.split("=", 1)[1]
                status["manual_send"]["state"] = "transmitting"
                write_status()

            elif line.startswith("PUSH_TX_FAILED="):
                raise RuntimeError("Main Heltec radio transmission failed")

            elif line.startswith("PUSH_ACK_TIMEOUT="):
                raise TimeoutError("Main transmitted, but no farmer ACK was received")

            elif line.startswith("PUSH_ACK_RECEIVED="):
                returned_id = line.split("=", 1)[1]
                if accepted_id is not None and returned_id == accepted_id:
                    status["manual_send"]["state"] = "delivered"
                    status["manual_send"]["completed_at"] = now_iso()
                    status["last_error"] = None
                    add_event("Dashboard delivery confirmed by farmer ACK")
                    print("[BRIDGE] Farmer delivery confirmed!", flush=True)
                    return packet

        if accepted_id is None:
            raise RuntimeError(
                "No PUSH_ACCEPTED reply. Check that the NEW main Heltec sketch is uploaded."
            )
        raise TimeoutError("Farmer acknowledgment not received within 15 seconds")

    except TimeoutError as error:
        # A lost ACK is not proof that the farmer never received the weather.
        status["manual_send"]["state"] = "unconfirmed"
        status["manual_send"]["completed_at"] = now_iso()
        status["manual_send"]["error"] = str(error)
        status["last_push_status"] = "unconfirmed"
        add_event("Dashboard push delivery could not be confirmed")
        print("[BRIDGE] Push unconfirmed:", error, flush=True)
        return None

    except Exception as error:
        status["manual_send"]["state"] = "failed"
        status["manual_send"]["completed_at"] = now_iso()
        status["manual_send"]["error"] = str(error)
        status["last_error"] = str(error)
        status["last_push_status"] = "failed"
        add_event("Dashboard push failed")
        print("[BRIDGE] Dashboard push failed:", error, flush=True)
        if isinstance(error, serial.SerialException):
            raise
        return None


def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Missing Supabase credentials in dashboard/.env")

    db = create_client(SUPABASE_URL, SUPABASE_KEY)
    board = None
    last_packet = None
    last_update = 0.0

    print("=== FARM SUPABASE LORA BRIDGE ===", flush=True)
    write_status()

    try:
        while True:
            try:
                if board is None:
                    port = find_main_port()
                    board = serial.Serial(port, 115200, timeout=0.2)
                    print("[USB] Main Heltec:", port, flush=True)
                    time.sleep(2)
                    board.reset_input_buffer()
                    last_packet = None
                    status["main_connected"] = True
                    status["main_port"] = port
                    status["weather_cached"] = False
                    status["last_error"] = None
                    add_event("Main Heltec connected by USB")

                # Manual sends use this same USB connection, never a second port.
                command = take_manual_request()
                if command is not None:
                    manual_packet = run_manual_send(board, db, command)
                    if manual_packet is not None:
                        last_packet = manual_packet
                        last_update = time.monotonic()

                weather = get_latest_weather(db)
                if weather is None:
                    print("[SUPABASE] No weather data found", flush=True)
                else:
                    packet = build_packet(weather)
                    needs_update = (
                        packet != last_packet
                        or time.monotonic() - last_update >= REFRESH_SECONDS
                    )
                    if needs_update:
                        if update_main_cache(board, packet):
                            last_packet = packet
                            last_update = time.monotonic()
                            print("[BRIDGE] Main cache updated!", flush=True)
                        else:
                            print("[BRIDGE] No cache confirmation, will retry", flush=True)
                            status["last_error"] = "Main cache update not confirmed"

                # Listen for the farmer pressing PRG and the main sending a reply.
                while board.in_waiting:
                    line = board.readline().decode("utf-8", errors="replace").strip()
                    read_main_line(line)

                # Heartbeat lets the dashboard tell a running bridge from an old log.
                write_status()

            except (serial.SerialException, OSError, RuntimeError) as error:
                print("[USB ERROR]", error, flush=True)
                if board is not None:
                    try:
                        board.close()
                    except Exception:
                        pass
                board = None
                status["main_connected"] = False
                status["weather_cached"] = False
                status["main_port"] = None
                status["last_error"] = str(error)
                add_event("Main Heltec disconnected or unavailable")

            except Exception as error:
                # Keep polling even if Supabase temporarily goes down.
                print("[BRIDGE ERROR]", error, flush=True)
                status["last_error"] = str(error)
                write_status()

            # Poll the manual button queue during the normal interval.
            # This makes a dashboard click respond within about 0.25 seconds.
            for _ in range(POLL_SECONDS * 4):
                if board is not None and COMMAND_FILE.exists():
                    break
                time.sleep(0.25)

    except KeyboardInterrupt:
        print("\n[BRIDGE] Stopped", flush=True)
    finally:
        status["bridge_running"] = False
        status["main_connected"] = False
        status["weather_cached"] = False
        write_status()
        if board is not None:
            board.close()


if __name__ == "__main__":
    main()
