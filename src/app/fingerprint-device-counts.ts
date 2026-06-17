import type { ZktecoFingerprintEvent } from "@/types/zkteco";
import type { FingerprintDeviceSummary } from "./types";

export function normalizeFingerprintPin(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/^0+(?=\d)/, "");
}

export function buildFingerprintDeviceSummaryFromZktecoEvents(
  events: ZktecoFingerprintEvent[]
): FingerprintDeviceSummary {
  const attendanceDate = events[0]?.attendance_date || "";
  const dailyEvents = attendanceDate
    ? events.filter((event) => event.attendance_date === attendanceDate)
    : events;
  const groups = new Map<
    string,
    {
      pin: string;
      firstPunch: string;
      lastPunch: string;
      punchCount: number;
      registeredPunches: number;
      deviceIps: Set<string>;
      matched: boolean;
    }
  >();

  dailyEvents.forEach((event) => {
    const pin = normalizeFingerprintPin(event.employee_pin);
    if (!pin) {
      return;
    }

    const punchAt = event.event_time || `${event.attendance_date}T${event.punch_time}`;
    const current =
      groups.get(pin) ||
      {
        pin,
        firstPunch: punchAt,
        lastPunch: punchAt,
        punchCount: 0,
        registeredPunches: 0,
        deviceIps: new Set<string>(),
        matched: false,
      };

    current.punchCount += 1;
    if (event.match_status === "matched" || event.employee_code || event.employee_id) {
      current.matched = true;
      current.registeredPunches += 1;
    }
    if (event.device_ip) {
      current.deviceIps.add(event.device_ip);
    }
    if (punchAt < current.firstPunch) {
      current.firstPunch = punchAt;
    }
    if (punchAt > current.lastPunch) {
      current.lastPunch = punchAt;
    }
    groups.set(pin, current);
  });

  const pinGroups = Array.from(groups.values());
  const unregisteredPins = pinGroups
    .filter((group) => !group.matched)
    .map((group) => ({
      pin: group.pin,
      firstPunch: group.firstPunch,
      lastPunch: group.lastPunch,
      punchCount: group.punchCount,
      deviceIps: Array.from(group.deviceIps).sort(),
    }))
    .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }));

  return {
    attendanceDate,
    totalDevicePins: pinGroups.length,
    registeredDevicePins: pinGroups.filter((group) => group.matched).length,
    unregisteredDevicePins: unregisteredPins.length,
    totalPunches: dailyEvents.length,
    registeredPunches: pinGroups.reduce((sum, group) => sum + group.registeredPunches, 0),
    unregisteredPunches: unregisteredPins.reduce((sum, group) => sum + group.punchCount, 0),
    unregisteredPins,
  };
}

export function resolveFingerprintDeviceSummary(
  summary: FingerprintDeviceSummary,
  events: ZktecoFingerprintEvent[]
) {
  if (!events.length) {
    return summary;
  }

  const eventSummary = buildFingerprintDeviceSummaryFromZktecoEvents(events);

  if (eventSummary.totalDevicePins > 0 || eventSummary.totalPunches > 0) {
    return eventSummary;
  }

  return summary;
}
