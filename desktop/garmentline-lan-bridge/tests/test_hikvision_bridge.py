import importlib.util
import os
import sys
import types
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


CAPTURED_REQUESTS = []


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"AcsEvent": {"InfoList": [], "totalMatches": 0}}


def fake_post(url, **kwargs):
    CAPTURED_REQUESTS.append({"url": url, **kwargs})
    return FakeResponse()


requests_stub = types.ModuleType("requests")
requests_stub.post = fake_post
requests_auth_stub = types.ModuleType("requests.auth")
requests_auth_stub.HTTPDigestAuth = lambda username, password: (username, password)
requests_stub.auth = requests_auth_stub
sys.modules["requests"] = requests_stub
sys.modules["requests.auth"] = requests_auth_stub

worker_path = Path(__file__).resolve().parents[1] / "workers" / "hikvision_bridge.py"
spec = importlib.util.spec_from_file_location("hikvision_bridge_under_test", worker_path)
hikvision_bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hikvision_bridge)


class HikvisionBridgeTest(unittest.TestCase):
    def setUp(self):
        CAPTURED_REQUESTS.clear()
        os.environ["HIKVISION_MAX_RESULTS"] = "2"
        os.environ["HIKVISION_BACKFILL_MAX_EVENTS_PER_SLICE"] = "20"
        os.environ.pop("HIKVISION_BACKFILL_CAMERA_URLS", None)
        self.timezone = ZoneInfo("Asia/Colombo")
        self.start = datetime(2026, 8, 18, 8, 0, tzinfo=self.timezone)
        self.end = datetime(2026, 8, 18, 9, 0, tzinfo=self.timezone)

    def test_event_request_uses_supplied_start_and_end(self):
        hikvision_bridge.fetch_event_page(
            "http://10.10.4.101",
            self.timezone,
            self.start,
            self.end,
            "test-search",
            0,
            30,
        )

        condition = CAPTURED_REQUESTS[0]["json"]["AcsEventCond"]
        self.assertEqual(condition["startTime"], "2026-08-18T08:00:00+05:30")
        self.assertEqual(condition["endTime"], "2026-08-18T09:00:00+05:30")

    def test_range_fetch_paginates_until_total_matches(self):
        pages = {
            0: (
                [
                    {"id": "event-1", "eventTime": "2026-08-18T08:01:00+05:30"},
                    {"id": "event-2", "eventTime": "2026-08-18T08:02:00+05:30"},
                ],
                2,
                5,
                "MORE",
            ),
            2: (
                [
                    {"id": "event-3", "eventTime": "2026-08-18T08:03:00+05:30"},
                    {"id": "event-4", "eventTime": "2026-08-18T08:04:00+05:30"},
                ],
                2,
                5,
                "MORE",
            ),
            4: (
                [{"id": "event-5", "eventTime": "2026-08-18T08:05:00+05:30"}],
                1,
                5,
                "OK",
            ),
        }
        positions = []
        original = hikvision_bridge.fetch_event_page

        def fake_page(_url, _timezone, _start, _end, _search_id, position, _page_size):
            positions.append(position)
            return pages[position]

        hikvision_bridge.fetch_event_page = fake_page
        try:
            events = hikvision_bridge.fetch_events_for_range(
                "http://10.10.4.101", self.timezone, self.start, self.end
            )
        finally:
            hikvision_bridge.fetch_event_page = original

        self.assertEqual(positions, [0, 2, 4])
        self.assertEqual(
            [event["id"] for event in events],
            ["event-1", "event-2", "event-3", "event-4", "event-5"],
        )

    def test_backfill_camera_selection_supports_one_or_all_configured_cameras(self):
        os.environ["HIKVISION_CAMERA_URLS"] = (
            "http://10.10.4.101,http://10.10.4.102,http://10.10.4.103"
        )
        self.assertEqual(
            hikvision_bridge.backfill_camera_urls(),
            ["http://10.10.4.101", "http://10.10.4.102", "http://10.10.4.103"],
        )

        os.environ["HIKVISION_BACKFILL_CAMERA_URLS"] = "http://10.10.4.102"
        self.assertEqual(
            hikvision_bridge.backfill_camera_urls(), ["http://10.10.4.102"]
        )


if __name__ == "__main__":
    unittest.main()
