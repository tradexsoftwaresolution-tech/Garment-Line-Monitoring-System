#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import signal
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
from requests.auth import HTTPDigestAuth


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
    return [part.strip().rstrip("/") for part in cleaned.split(",") if part.strip()]


def state_file() -> Path:
    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR", "."))
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / "hikvision-state.json"


def load_state() -> dict[str, Any]:
    path = state_file()
    if not path.exists():
        return {"sent_keys": []}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {"sent_keys": []}


def save_state(state: dict[str, Any]):
    state_file().write_text(json.dumps(state, indent=2, sort_keys=True))


def backend_endpoint() -> str:
    backend_url = os.environ.get("HIKVISION_BRIDGE_BACKEND_URL", "").strip()
    if not backend_url:
        return ""
    return urljoin(backend_url.rstrip("/") + "/", "api/bridge/hikvision/events")


def camera_id(camera_url: str) -> str:
    parsed = urlparse(camera_url)
    host = parsed.hostname or camera_url
    return "hikvision-" + host.replace(".", "-").replace(":", "-")


def camera_name(camera_url: str) -> str:
    parsed = urlparse(camera_url)
    return parsed.hostname or camera_url


def hikvision_time(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def parse_event_time(value: Any, timezone: ZoneInfo) -> datetime:
    if not value:
        return datetime.now(tz=timezone)
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(tz=timezone)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone)
    return parsed.astimezone(timezone)


def first_text(source: dict[str, Any], *names: str) -> str | None:
    for name in names:
        value = source.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_event(camera_url: str, node: dict[str, Any], timezone: ZoneInfo) -> dict[str, Any] | None:
    employee_no = first_text(node, "employeeNoString", "employeeNo", "employeeNoString")
    person_name = first_text(node, "name")
    verify_mode = first_text(node, "currentVerifyMode")
    picture_url = first_text(node, "pictureURL")
    visible_light_pic_url = first_text(node, "visibleLightPicUrl", "visibleLightURL")
    likely_face_event = bool(employee_no or person_name or picture_url or visible_light_pic_url)
    if verify_mode and "face" in verify_mode.lower():
        likely_face_event = True
    if not likely_face_event:
        return None

    event_time = parse_event_time(first_text(node, "time", "dateTime"), timezone)
    serial_no = first_text(node, "serialNo", "SerialNo")
    major = int_or_none(node.get("major"))
    minor = int_or_none(node.get("minor"))
    cam_id = camera_id(camera_url)
    event_id = "hikvision-" + str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            "|".join([cam_id, serial_no or "", employee_no or "", event_time.isoformat(), str(major), str(minor)]),
        )
    )

    return {
        "id": event_id,
        "cameraId": cam_id,
        "cameraName": camera_name(camera_url),
        "cameraLocation": None,
        "cameraBaseUrl": camera_url,
        "serialNo": serial_no,
        "employeeNo": employee_no,
        "devicePersonName": person_name,
        "eventTime": event_time.isoformat(),
        "verifyMode": verify_mode,
        "attendanceStatus": first_text(node, "attendanceStatus"),
        "accessDecision": "recognized" if employee_no else "unknown",
        "pictureUrl": picture_url,
        "visibleLightPicUrl": visible_light_pic_url,
        "thermalPicUrl": first_text(node, "thermalPicUrl"),
        "temperature": float_or_none(node.get("currTemperature")),
        "mask": first_text(node, "mask"),
        "major": major,
        "minor": minor,
        "rawPayload": node,
    }


def heartbeat_event(camera_url: str, timezone: ZoneInfo) -> dict[str, Any]:
    return {
        "cameraId": camera_id(camera_url),
        "cameraName": camera_name(camera_url),
        "cameraLocation": None,
        "cameraBaseUrl": camera_url,
        "bridgeHeartbeat": True,
        "polledAt": datetime.now(tz=timezone).isoformat(),
    }


def fetch_events(camera_url: str, timezone: ZoneInfo) -> list[dict[str, Any]]:
    username = os.environ.get("HIKVISION_USERNAME", "")
    password = os.environ.get("HIKVISION_PASSWORD", "")
    timeout = env_int("HIKVISION_TIMEOUT_SECONDS", 10)
    lookback_minutes = env_int("HIKVISION_LOOKBACK_MINUTES", 60)
    max_results = env_int("HIKVISION_MAX_RESULTS", 30)
    now = datetime.now(tz=timezone)
    start = now - timedelta(minutes=max(1, lookback_minutes))
    payload = {
        "AcsEventCond": {
            "searchID": "garmentline-desktop-bridge-" + camera_id(camera_url),
            "searchResultPosition": 0,
            "maxResults": max(1, max_results),
            "major": 0,
            "minor": 0,
            "startTime": hikvision_time(start),
            "endTime": hikvision_time(now),
            "timeReverseOrder": True,
        }
    }
    response = requests.post(
        urljoin(camera_url.rstrip("/") + "/", "ISAPI/AccessControl/AcsEvent?format=json"),
        auth=HTTPDigestAuth(username, password),
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    info_list = data.get("AcsEvent", {}).get("InfoList") or []
    normalized: list[dict[str, Any]] = []
    for node in info_list:
        if isinstance(node, dict):
            event = normalize_event(camera_url, node, timezone)
            if event:
                normalized.append(event)
    return normalized


def post_events(endpoint: str, token: str, payload: list[dict[str, Any]]):
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
    batch_size = max(1, env_int("HIKVISION_MAX_RESULTS", 30))
    sent_keys = set(state.get("sent_keys", []))
    next_sent_keys = list(state.get("sent_keys", []))

    for camera_url in split_values(os.environ.get("HIKVISION_CAMERA_URLS", "")):
        try:
            events = fetch_events(camera_url, timezone)
        except Exception as exc:
            log(f"{camera_url}: failed to fetch events: {exc}")
            continue

        pending = [event for event in events if event["id"] not in sent_keys][:batch_size]
        if not pending:
            try:
                post_events(endpoint, token, [heartbeat_event(camera_url, timezone)])
                log(f"{camera_url}: no new face events; heartbeat posted.")
            except Exception as exc:
                log(f"{camera_url}: no new face events; failed to post heartbeat: {exc}")
            continue

        if not can_post:
            reason = "backend URL is empty" if not endpoint else "bridge token is empty"
            log(f"{camera_url}: read {len(pending)} face events; backend {reason}.")
            continue

        try:
            result = post_events(endpoint, token, pending)
        except Exception as exc:
            log(f"{camera_url}: failed to post {len(pending)} events: {exc}")
            continue

        next_sent_keys.extend(event["id"] for event in pending)
        state["sent_keys"] = next_sent_keys[-5000:]
        save_state(state)
        log(f"{camera_url}: posted {result.get('accepted', len(pending))} face events.")


def main():
    interval = env_int("HIKVISION_INTERVAL_SECONDS", 5)
    state = load_state()
    log("Hikvision bridge worker started.")
    while RUNNING:
        run_once(state)
        for _ in range(max(1, interval)):
            if not RUNNING:
                break
            time.sleep(1)
    log("Hikvision bridge worker stopped.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
