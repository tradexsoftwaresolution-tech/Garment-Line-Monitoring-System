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


def parse_requested_time(value: str, timezone: ZoneInfo) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("A date and time are required.")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"Invalid date and time: {value}") from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone)
    return parsed.astimezone(timezone)


def first_text(source: dict[str, Any], *names: str) -> str | None:
    for name in names:
        value = source.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


AUTH_FAILED_TEXTS = (
    "authentication failed",
    "authentication failure",
    "auth failed",
    "verify failed",
    "verification failed",
    "face failed",
)

AUTH_FAILED_COMPACT_TEXTS = (
    "authenticationfailed",
    "authenticationfailure",
    "authfailed",
    "verifyfailed",
    "verificationfailed",
    "facefailed",
)


def is_authentication_failed_event(source: dict[str, Any]) -> bool:
    try:
        text = json.dumps(source, default=str).lower()
    except TypeError:
        text = " ".join(str(value) for value in source.values()).lower()
    compact = text.replace(" ", "").replace("_", "").replace("-", "")
    return any(phrase in text for phrase in AUTH_FAILED_TEXTS) or any(
        phrase in compact for phrase in AUTH_FAILED_COMPACT_TEXTS
    )


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
    authentication_failed = is_authentication_failed_event(node)
    likely_face_event = bool(employee_no or person_name or picture_url or visible_light_pic_url)
    if verify_mode and "face" in verify_mode.lower():
        likely_face_event = True
    if authentication_failed:
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
        "accessDecision": "unknown" if authentication_failed or not employee_no else "recognized",
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


def event_info_list(data: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    event_response = data.get("AcsEvent") or {}
    if not isinstance(event_response, dict):
        return [], {}
    info_list = event_response.get("InfoList") or []
    if isinstance(info_list, dict):
        info_list = [info_list]
    if not isinstance(info_list, list):
        return [], event_response
    return [node for node in info_list if isinstance(node, dict)], event_response


def fetch_event_page(
    camera_url: str,
    timezone: ZoneInfo,
    start: datetime,
    end: datetime,
    search_id: str,
    position: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int, int | None, str]:
    username = os.environ.get("HIKVISION_USERNAME", "")
    password = os.environ.get("HIKVISION_PASSWORD", "")
    timeout = env_int("HIKVISION_TIMEOUT_SECONDS", 10)
    payload = {
        "AcsEventCond": {
            "searchID": search_id,
            "searchResultPosition": max(0, position),
            "maxResults": max(1, page_size),
            "major": 0,
            "minor": 0,
            "startTime": hikvision_time(start),
            "endTime": hikvision_time(end),
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
    info_list, event_response = event_info_list(data)
    normalized: list[dict[str, Any]] = []
    for node in info_list:
        event = normalize_event(camera_url, node, timezone)
        if event:
            normalized.append(event)

    total_matches = int_or_none(event_response.get("totalMatches"))
    response_status = str(event_response.get("responseStatusStrg") or "").strip().upper()
    return normalized, len(info_list), total_matches, response_status


def fetch_events(camera_url: str, timezone: ZoneInfo) -> list[dict[str, Any]]:
    lookback_minutes = env_int("HIKVISION_LOOKBACK_MINUTES", 60)
    page_size = max(1, env_int("HIKVISION_MAX_RESULTS", 30))
    end = datetime.now(tz=timezone)
    start = end - timedelta(minutes=max(1, lookback_minutes))
    events, _, _, _ = fetch_event_page(
        camera_url,
        timezone,
        start,
        end,
        "lm-live-" + uuid.uuid4().hex[:20],
        0,
        page_size,
    )
    return events


def fetch_events_for_range(
    camera_url: str,
    timezone: ZoneInfo,
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    page_size = max(1, env_int("HIKVISION_MAX_RESULTS", 30))
    max_events = max(page_size, env_int("HIKVISION_BACKFILL_MAX_EVENTS_PER_SLICE", 10_000))
    search_id = "lm-backfill-" + uuid.uuid4().hex[:16]
    position = 0
    events_by_id: dict[str, dict[str, Any]] = {}

    while position < max_events:
        events, raw_count, total_matches, response_status = fetch_event_page(
            camera_url,
            timezone,
            start,
            end,
            search_id,
            position,
            page_size,
        )
        for event in events:
            events_by_id[event["id"]] = event

        if raw_count <= 0:
            break

        position += raw_count
        if total_matches is not None and position >= total_matches:
            break
        if raw_count < page_size:
            break
        if response_status and response_status not in {"MORE", "OK"}:
            break

    if position >= max_events and (total_matches is None or position < total_matches):
        raise RuntimeError(
            f"More than {max_events} events were returned in one recovery slice; "
            "use a shorter time range or increase HIKVISION_BACKFILL_MAX_EVENTS_PER_SLICE."
        )

    return sorted(events_by_id.values(), key=lambda event: event["eventTime"])


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
    if not endpoint:
        log("Hikvision backend URL is empty.")
        return
    if not token:
        log("Bridge token is empty.")
        return

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

        try:
            result = post_events(endpoint, token, pending)
        except Exception as exc:
            log(f"{camera_url}: failed to post {len(pending)} events: {exc}")
            continue

        next_sent_keys.extend(event["id"] for event in pending)
        state["sent_keys"] = next_sent_keys[-5000:]
        save_state(state)
        log(f"{camera_url}: posted {result.get('accepted', len(pending))} face events.")


def backfill_camera_urls() -> list[str]:
    configured = split_values(os.environ.get("HIKVISION_CAMERA_URLS", ""))
    selected = split_values(os.environ.get("HIKVISION_BACKFILL_CAMERA_URLS", ""))
    if not selected:
        return configured

    configured_set = set(configured)
    invalid = [camera_url for camera_url in selected if camera_url not in configured_set]
    if invalid:
        raise ValueError("Recovery camera is not in the configured Hikvision camera list.")
    return selected


def run_backfill(start: datetime, end: datetime, timezone: ZoneInfo) -> int:
    endpoint = backend_endpoint()
    token = os.environ.get("BRIDGE_SHARED_TOKEN", "")
    if not endpoint:
        raise RuntimeError("Hikvision backend URL is empty.")
    if not token:
        raise RuntimeError("Bridge token is empty.")
    if end <= start:
        raise ValueError("Recovery end time must be after the start time.")

    camera_urls = backfill_camera_urls()
    if not camera_urls:
        raise RuntimeError("No Hikvision camera URLs are configured.")

    batch_size = max(1, env_int("HIKVISION_MAX_RESULTS", 30))
    slice_minutes = max(1, env_int("HIKVISION_BACKFILL_SLICE_MINUTES", 60))
    total_found = 0
    total_accepted = 0
    failures = 0
    log(
        f"Recovery started for {len(camera_urls)} camera(s) from "
        f"{start.isoformat()} to {end.isoformat()}."
    )

    for camera_index, camera_url in enumerate(camera_urls, start=1):
        camera_found = 0
        camera_accepted = 0
        seen_event_ids: set[str] = set()
        cursor = start
        log(f"Recovery camera {camera_index}/{len(camera_urls)} {camera_url}: started.")
        try:
            while cursor < end:
                slice_end = min(cursor + timedelta(minutes=slice_minutes), end)
                events = fetch_events_for_range(camera_url, timezone, cursor, slice_end)
                unique_events = [event for event in events if event["id"] not in seen_event_ids]
                seen_event_ids.update(event["id"] for event in unique_events)
                camera_found += len(unique_events)

                for batch_start in range(0, len(unique_events), batch_size):
                    batch = unique_events[batch_start : batch_start + batch_size]
                    result = post_events(endpoint, token, batch)
                    camera_accepted += int(result.get("accepted", 0))

                log(
                    f"Recovery {camera_url}: {cursor.isoformat()} to {slice_end.isoformat()}, "
                    f"found {len(unique_events)} event(s)."
                )
                cursor = slice_end

            log(
                f"Recovery {camera_url}: complete, found {camera_found}, "
                f"backend accepted {camera_accepted}."
            )
        except Exception as exc:
            failures += 1
            log(f"Recovery {camera_url}: failed: {exc}")

        total_found += camera_found
        total_accepted += camera_accepted

    log(
        f"Recovery complete: found {total_found} event(s), backend accepted "
        f"{total_accepted}, camera failures {failures}."
    )
    return 1 if failures else 0


def main() -> int:
    interval = env_int("HIKVISION_INTERVAL_SECONDS", 5)
    timezone = ZoneInfo(os.environ.get("BRIDGE_TIME_ZONE", "Asia/Colombo"))
    backfill_from = os.environ.get("HIKVISION_BACKFILL_FROM", "").strip()
    backfill_to = os.environ.get("HIKVISION_BACKFILL_TO", "").strip()
    if backfill_from or backfill_to:
        if not backfill_from or not backfill_to:
            raise ValueError("Both recovery start and end times are required.")
        return run_backfill(
            parse_requested_time(backfill_from, timezone),
            parse_requested_time(backfill_to, timezone),
            timezone,
        )

    state = load_state()
    log("Hikvision bridge worker started.")
    while RUNNING:
        run_once(state)
        for _ in range(max(1, interval)):
            if not RUNNING:
                break
            time.sleep(1)
    log("Hikvision bridge worker stopped.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.exit(0)
