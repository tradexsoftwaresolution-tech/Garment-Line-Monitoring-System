const ATTENDANCE_TIME_ZONE = "Asia/Colombo";

export function dateKeyInAttendanceTimeZone(value?: string | Date | null) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value.slice(0, 10) : "";
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

export function currentAttendanceDateKey() {
  return dateKeyInAttendanceTimeZone(new Date());
}

export function isDateKeyInAttendanceDay(value: string, attendanceDate: string) {
  return Boolean(attendanceDate) && dateKeyInAttendanceTimeZone(value) === attendanceDate;
}
