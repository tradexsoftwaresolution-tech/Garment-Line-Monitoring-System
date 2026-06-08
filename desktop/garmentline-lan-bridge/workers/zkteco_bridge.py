#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import signal
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests

try:
    from zk import ZK
except Exception as exc:  # pragma: no cover - reported in the desktop log
    ZK = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


RUNNING = True


def stop(_signum, _frame):
    global RUNNING
    RUNNING = False


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)


def log(message: str):
    print(message, flush=True)


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def split_values(value: str) -> list[str]:
    if not value:
        return []
    cleaned = value.replace("\n", ",")
    return [part.strip() for part in cleaned.split(",") if part.strip()]


def state_file() -> Path:
    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR", "."))
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / "zkteco-state.json"


def load_state() -> dict[str, Any]:
    path = state_file()
    if not path.exists():
        return {"sent_keys": []}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {"sent_keys": []}


def save_state(state: dict[str, Any]):
    path = state_file()
    path.write_text(json.dumps(state, indent=2, sort_keys=True))


def event_key(device_ip: str, employee_code: str, timestamp: datetime, status: Any, punch: Any) -> str:
    return "|".join(
        [
            device_ip,
            str(employee_code or ""),
            timestamp.isoformat(),
            str(status if status is not None else ""),
            str(punch if punch is not None else ""),
        ]
    )


def int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_timestamp(value: datetime, timezone: ZoneInfo) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone)
    return value.astimezone(timezone)


def backend_endpoint() -> str:
    backend_url = os.environ.get("ZKTECO_BRIDGE_BACKEND_URL", "").strip()
    if not backend_url:
        return ""
    return urljoin(backend_url.rstrip("/") + "/", "api/bridge/zkteco/punches")


def collect_device_attendance(device_ip: str, timezone: ZoneInfo) -> tuple[str, list[dict[str, Any]]]:
    if ZK is None:
        raise RuntimeError(f"pyzk is not installed: {IMPORT_ERROR}")

    port = env_int("ZKTECO_PORT", 4370)
    password = env_int("ZKTECO_PASSWORD", 0)
    timeout = env_int("ZKTECO_TIMEOUT_SECONDS", 8)
    zk = ZK(device_ip, port=port, timeout=timeout, password=password, force_udp=False, ommit_ping=False)
    conn = None
    serial = device_ip
    try:
        conn = zk.connect()
        try:
            serial = conn.get_serialnumber() or device_ip
        except Exception:
            serial = device_ip
        attendance = conn.get_attendance() or []
    finally:
        if conn is not None:
            try:
                conn.disconnect()
            except Exception:
                pass

    rows: list[dict[str, Any]] = []
    for item in attendance:
        employee_code = str(getattr(item, "user_id", "") or "").strip()
        timestamp = getattr(item, "timestamp", None)
        if not employee_code or not isinstance(timestamp, datetime):
            continue
        timestamp = normalize_timestamp(timestamp, timezone)
        status = getattr(item, "status", None)
        punch = getattr(item, "punch", None)
        rows.append(
            {
                "deviceId": serial,
                "deviceIp": device_ip,
                "employeeCode": employee_code,
                "pin": employee_code,
                "userId": employee_code,
                "timestamp": timestamp.isoformat(),
                "punchState": int_or_none(punch),
                "verifyType": int_or_none(status),
                "workCode": str(getattr(item, "workcode", "") or "") or None,
                "rawPayload": {
                    "uid": getattr(item, "uid", None),
                    "user_id": employee_code,
                    "status": status,
                    "punch": punch,
                    "device_ip": device_ip,
                    "device_serial": serial,
                },
            }
        )
    return serial, rows


def heartbeat_punch(device_ip: str, serial: str, timezone: ZoneInfo) -> dict[str, Any]:
    return {
        "bridgeHeartbeat": True,
        "deviceId": serial or device_ip,
        "serialNo": serial or device_ip,
        "deviceIp": device_ip,
        "timestamp": datetime.now(tz=timezone).isoformat(),
    }


def post_punches(endpoint: str, token: str, payload: list[dict[str, Any]]):
    response = requests.post(
        endpoint,
        headers={"X-Bridge-Token": token, "Content-Type": "application/json"},
        json=payload,
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def run_once(state: dict[str, Any]):
    endpoint = backend_endpoint()
    token = os.environ.get("BRIDGE_SHARED_TOKEN", "")
    can_post = bool(endpoint and token)

    timezone = ZoneInfo(os.environ.get("BRIDGE_TIME_ZONE", "Asia/Colombo"))
    lookback_hours = env_int("ZKTECO_LOOKBACK_HOURS", 24)
    batch_size = env_int("ZKTECO_BATCH_SIZE", 100)
    cutoff = datetime.now(tz=timezone) - timedelta(hours=max(1, lookback_hours))
    sent_keys = set(state.get("sent_keys", []))
    next_sent_keys = list(state.get("sent_keys", []))

    for device_ip in split_values(os.environ.get("ZKTECO_DEVICE_IPS", "")):
      try:
          serial, rows = collect_device_attendance(device_ip, timezone)
      except Exception as exc:
          log(f"{device_ip}: failed to read attendance: {exc}")
          continue

      pending: list[dict[str, Any]] = []
      pending_keys: list[str] = []
      for row in rows:
          timestamp = datetime.fromisoformat(row["timestamp"])
          key = event_key(device_ip, row["employeeCode"], timestamp, row.get("verifyType"), row.get("punchState"))
          if timestamp < cutoff or key in sent_keys:
              continue
          pending.append(row)
          pending_keys.append(key)
          if len(pending) >= batch_size:
              break

      if not pending:
          try:
              post_punches(endpoint, token, [heartbeat_punch(device_ip, serial, timezone)])
              log(f"{device_ip} ({serial}): no new punches; heartbeat posted.")
          except Exception as exc:
              log(f"{device_ip} ({serial}): no new punches; failed to post heartbeat: {exc}")
          continue

      if not can_post:
          reason = "backend URL is empty" if not endpoint else "bridge token is empty"
          log(f"{device_ip} ({serial}): read {len(pending)} punches; backend {reason}.")
          continue

      try:
          result = post_punches(endpoint, token, pending)
      except Exception as exc:
          log(f"{device_ip} ({serial}): failed to post {len(pending)} punches: {exc}")
          continue

      next_sent_keys.extend(pending_keys)
      state["sent_keys"] = next_sent_keys[-5000:]
      save_state(state)
      log(f"{device_ip} ({serial}): posted {result.get('accepted', len(pending))} punches.")


def main():
    if ZK is None:
        log(f"pyzk is not installed: {IMPORT_ERROR}")
    interval = env_int("ZKTECO_INTERVAL_SECONDS", 30)
    state = load_state()
    log("ZKTeco bridge worker started.")
    while RUNNING:
        run_once(state)
        for _ in range(max(1, interval)):
            if not RUNNING:
                break
            time.sleep(1)
    log("ZKTeco bridge worker stopped.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
