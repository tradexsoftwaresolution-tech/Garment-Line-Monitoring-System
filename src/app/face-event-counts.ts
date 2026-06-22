import type { HikvisionRecognitionEvent } from "@/types/hikvision";
import type { FaceEvent } from "./types";

const ATTENDANCE_TIME_ZONE = "Asia/Colombo";

function eventDateInAttendanceTimeZone(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildHikvisionFaceEventSummary(
  events: Array<HikvisionRecognitionEvent | FaceEvent>,
  preferredAttendanceDate?: string
) {
  const fallbackDate = eventDateInAttendanceTimeZone(faceEventTime(events[0]));
  const attendanceDate = preferredAttendanceDate || fallbackDate;
  const dailyEvents = attendanceDate
    ? events.filter((event) => eventDateInAttendanceTimeZone(faceEventTime(event)) === attendanceDate)
    : events;
  const matchedEvents = dailyEvents.filter((event) => faceEventMatched(event));
  const unmatchedEvents = dailyEvents.filter((event) => !faceEventMatched(event));

  return {
    attendanceDate,
    totalEvents: dailyEvents.length,
    matchedEvents: matchedEvents.length,
    unmatchedEvents: unmatchedEvents.length,
    unmatchedEmployeeNos: Array.from(
      new Set(
        unmatchedEvents
          .map((event) => faceEventLabel(event))
          .filter(Boolean)
      )
    ),
  };
}

function faceEventTime(event?: HikvisionRecognitionEvent | FaceEvent) {
  if (!event) return undefined;
  return isHikvisionRecognitionEvent(event) ? event.eventTime : event.timestamp;
}

function faceEventMatched(event: HikvisionRecognitionEvent | FaceEvent) {
  if (isHikvisionRecognitionEvent(event)) {
    return event.matchStatus === "matched";
  }

  return event.matchStatus === "matched" || event.outcome === "matched";
}

function faceEventLabel(event: HikvisionRecognitionEvent | FaceEvent) {
  if (isHikvisionRecognitionEvent(event)) {
    return event.employeeNo || event.devicePersonName || event.serialNo || event.id;
  }

  return event.employeeNo || event.devicePersonName || event.workerId || event.id;
}

function isHikvisionRecognitionEvent(event: HikvisionRecognitionEvent | FaceEvent): event is HikvisionRecognitionEvent {
  return "eventTime" in event;
}
