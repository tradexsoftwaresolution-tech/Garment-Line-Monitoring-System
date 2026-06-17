import type { HikvisionRecognitionEvent } from "@/types/hikvision";

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
  events: HikvisionRecognitionEvent[],
  preferredAttendanceDate?: string
) {
  const fallbackDate = eventDateInAttendanceTimeZone(events[0]?.eventTime);
  const attendanceDate = preferredAttendanceDate || fallbackDate;
  const dailyEvents = attendanceDate
    ? events.filter((event) => eventDateInAttendanceTimeZone(event.eventTime) === attendanceDate)
    : events;
  const matchedEvents = dailyEvents.filter((event) => event.matchStatus === "matched");
  const unmatchedEvents = dailyEvents.filter((event) => event.matchStatus !== "matched");

  return {
    attendanceDate,
    totalEvents: dailyEvents.length,
    matchedEvents: matchedEvents.length,
    unmatchedEvents: unmatchedEvents.length,
    unmatchedEmployeeNos: Array.from(
      new Set(
        unmatchedEvents
          .map((event) => event.employeeNo || event.devicePersonName || event.serialNo || event.id)
          .filter(Boolean)
      )
    ),
  };
}
