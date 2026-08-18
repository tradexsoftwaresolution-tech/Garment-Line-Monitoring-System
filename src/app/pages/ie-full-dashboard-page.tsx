import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Factory,
  Fingerprint,
  RefreshCw,
  ScanFace,
  Search,
  ShieldAlert,
  type LucideIcon,
  UserX,
  Users,
} from "lucide-react";
import { DetailDrawer, StatusBadge, WorkerChip, attendanceTone } from "../components/ops-ui";
import {
  ATTENDANCE_MISSING_SIGNAL_FILTERS,
  type AttendanceReportFilter,
  getFaceFingerprintMismatch as mismatchKind,
  matchesAttendanceReportFilter,
} from "../attendance-reporting";
import { buildHikvisionFaceEventSummary } from "../face-event-counts";
import { usePublicExclusiveDashboardSnapshot } from "../hooks/use-public-exclusive-dashboard-snapshot";
import type { FaceEvent, ProductionLineRecord, WorkerProfile } from "../types";

type Tone = "good" | "warning" | "danger" | "info" | "neutral";
type TabId = "today" | "mismatch" | "employees" | "lines";
type MismatchFilter = "all" | "camera-missed" | "unregistered-face" | "unknown-face" | "fingerprint-missed";
type EmployeeFilter = "attention" | "attended" | "absent" | "late" | "present";

type Issue = {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
};

const NAV_ITEMS = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "mismatch", label: "Mismatch", icon: Fingerprint },
  { id: "employees", label: "Employees", icon: Users },
  { id: "lines", label: "Lines", icon: Factory },
] satisfies Array<{ id: TabId; label: string; icon: LucideIcon }>;

const MISMATCH_FILTERS = [
  { id: "all", label: "All" },
  { id: "camera-missed", label: "Camera missed" },
  { id: "unregistered-face", label: "Not registered" },
  { id: "unknown-face", label: "Unknown face" },
  { id: "fingerprint-missed", label: "Fingerprint missed" },
] satisfies Array<{ id: MismatchFilter; label: string }>;

const EMPLOYEE_FILTERS = [
  { id: "attention", label: "Need attention" },
  { id: "attended", label: "Attended" },
  { id: "absent", label: "Absent" },
  { id: "late", label: "Late" },
  { id: "present", label: "Present" },
] satisfies Array<{ id: EmployeeFilter; label: string }>;

const clientLogoSrc = "/brand/union-north-logo.png";

const MISMATCH_PAGE_SIZE = 10;
const EMPLOYEE_PAGE_SIZE = 20;

function lineNumber(line: { code: string; name: string }) {
  const match = `${line.code} ${line.name}`.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function getAntonioGreeting(date: Date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return "Good morning, Mr. Antonio";
  if (hour >= 12 && hour < 17) return "Good afternoon, Mr. Antonio";
  if (hour >= 17 && hour < 21) return "Good evening, Mr. Antonio";
  return "Good night, Mr. Antonio";
}

function formatDateLabel(value?: string) {
  if (!value) return "Today";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;

  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-LK").format(value);
}

function plural(count: number, singular: string, pluralText = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralText}`;
}

function lineTone(line: ProductionLineRecord): Tone {
  if (line.risk === "Critical" || line.attendanceRate < 70) return "danger";
  if (line.risk === "Watch" || line.attendanceRate < 85) return "warning";
  return "good";
}

function lineRiskLabel(line: ProductionLineRecord) {
  if (line.risk === "Critical" || line.attendanceRate < 70) return "Red";
  if (line.risk === "Watch" || line.attendanceRate < 85) return "Amber";
  return "Green";
}

function findLine(lines: ProductionLineRecord[], lineId?: string) {
  return lineId ? lines.find((line) => line.id === lineId) : undefined;
}

function isVerified(value?: string) {
  return value === "Verified";
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function mismatchLabel(worker: {
  faceVerificationStatus: string;
  fingerprintVerificationStatus: string;
}) {
  const kind = mismatchKind(worker);
  if (kind === "camera-missed") return "Face not detected";
  if (kind === "fingerprint-missed") return "Fingerprint not detected";
  return "Needs review";
}

function isFaceEventMatched(event: FaceEvent) {
  return Boolean(event.workerId) || event.matchStatus === "matched" || event.outcome === "matched";
}

function normalizeFaceIdentifier(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return "";

  const lower = normalized.toLowerCase();
  if (["-", "--", "n/a", "na", "null", "undefined", "unknown", "unknown person"].includes(lower)) {
    return "";
  }

  return normalized;
}

function compactFaceEventText(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function faceEventTextBlob(event: FaceEvent) {
  return [
    event.employeeNo,
    event.devicePersonName,
    event.cameraName,
    event.cameraLocation,
    event.gate,
    event.matchStatus,
    event.outcome,
    event.verifyMode,
    event.attendanceStatus,
    event.accessDecision,
    event.rawPayload ? JSON.stringify(event.rawPayload) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isAuthenticationFailedFaceEvent(event: FaceEvent) {
  const text = faceEventTextBlob(event);
  const compact = compactFaceEventText(text);
  return (
    text.includes("authentication failed") ||
    text.includes("authentication failure") ||
    text.includes("auth failed") ||
    text.includes("verify failed") ||
    text.includes("verification failed") ||
    text.includes("face failed") ||
    compact.includes("authenticationfailed") ||
    compact.includes("authenticationfailure") ||
    compact.includes("authfailed") ||
    compact.includes("verifyfailed") ||
    compact.includes("verificationfailed") ||
    compact.includes("facefailed")
  );
}

function isUnknownFaceEvent(event: FaceEvent) {
  if (isFaceEventMatched(event)) return false;
  if (isAuthenticationFailedFaceEvent(event)) return true;
  return !normalizeFaceIdentifier(event.employeeNo) && !normalizeFaceIdentifier(event.devicePersonName);
}

function faceEventPersonLabel(event: FaceEvent) {
  return normalizeFaceIdentifier(event.employeeNo) || normalizeFaceIdentifier(event.devicePersonName) || "Unknown face";
}

function faceEventCameraLabel(event: FaceEvent) {
  return event.cameraName || event.cameraLocation || event.gate || "Hikvision camera";
}

function faceEventSearchText(event: FaceEvent) {
  return [
    event.employeeNo,
    event.devicePersonName,
    event.cameraName,
    event.cameraLocation,
    event.gate,
    event.matchStatus,
    event.outcome,
    event.verifyMode,
    event.attendanceStatus,
    event.accessDecision,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatEventDateTime(value?: string) {
  if (!value) return "Time not captured";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function workerSearchText(worker: WorkerProfile, line?: ProductionLineRecord) {
  return [
    worker.fullName,
    worker.employeeId,
    worker.department,
    worker.roleTitle,
    worker.attendanceStatus,
    worker.faceVerificationStatus,
    worker.fingerprintVerificationStatus,
    line?.name,
    line?.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function employeePriority(worker: WorkerProfile) {
  if (mismatchKind(worker) !== "none") return 0;
  if (worker.attendanceStatus === "Absent") return 1;
  if (worker.attendanceStatus === "Late") return 2;
  return 3;
}

export function IeFullDashboardPage() {
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState("");
  const isHistoricalMode = Boolean(selectedAttendanceDate);
  const { snapshot, isLoading, error, refresh } = usePublicExclusiveDashboardSnapshot(
    selectedAttendanceDate || undefined,
    isHistoricalMode ? 0 : 10_000
  );
  const {
    attendanceOverview,
    fingerprintDeviceSummary,
    faceEvents,
    lines,
    workers,
  } = snapshot;
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [mismatchFilter, setMismatchFilter] = useState<MismatchFilter>("all");
  const [mismatchQuery, setMismatchQuery] = useState("");
  const [mismatchVisibleCount, setMismatchVisibleCount] = useState(MISMATCH_PAGE_SIZE);
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeFilter>("attention");
  const [employeeSignalFilter, setEmployeeSignalFilter] =
    useState<AttendanceReportFilter>("all");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeVisibleCount, setEmployeeVisibleCount] = useState(EMPLOYEE_PAGE_SIZE);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);

  const greeting = useMemo(() => getAntonioGreeting(currentTime), [currentTime]);
  const todayInputValue = useMemo(() => formatDateInput(currentTime), [currentTime]);

  const lineRows = useMemo(
    () =>
      [...lines].sort((a, b) => {
        const lineNumberDelta = lineNumber(a) - lineNumber(b);
        if (lineNumberDelta !== 0) return lineNumberDelta;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      }),
    [lines]
  );

  const faceEventSummary = useMemo(
    () => buildHikvisionFaceEventSummary(faceEvents, attendanceOverview.attendanceDate),
    [attendanceOverview.attendanceDate, faceEvents]
  );

  const overallAttended = attendanceOverview.presentWorkers + attendanceOverview.lateWorkers;
  const attendanceRate =
    attendanceOverview.totalWorkers === 0
      ? 0
      : Math.round((overallAttended / attendanceOverview.totalWorkers) * 100);
  const assignedWorkers = lineRows.reduce((sum, line) => sum + line.assignedWorkers, 0);
  const cameToday = lineRows.reduce((sum, line) => sum + line.presentWorkers + line.lateWorkers, 0);
  const lineAttendance = assignedWorkers === 0 ? 0 : Math.round((cameToday / assignedWorkers) * 100);
  const redLines = lineRows.filter((line) => lineTone(line) === "danger");
  const amberLines = lineRows.filter((line) => lineTone(line) === "warning");
  const unmatchedAttendanceChecks =
    fingerprintDeviceSummary.unregisteredDevicePins + faceEventSummary.unmatchedEvents;

  const factoryTone: Tone =
    redLines.length > 0 || attendanceRate < 70
      ? "danger"
      : amberLines.length > 0 || attendanceOverview.absentWorkers > 0 || attendanceRate < 90
        ? "warning"
        : "good";

  const mismatchWorkers = useMemo(
    () =>
      workers
        .filter((worker) => mismatchKind(worker) !== "none")
        .sort((a, b) => {
          const labelDelta = mismatchLabel(a).localeCompare(mismatchLabel(b));
          if (labelDelta !== 0) return labelDelta;
          return a.fullName.localeCompare(b.fullName);
        }),
    [workers]
  );

  const registeredCameraMissedWorkers = useMemo(
    () => mismatchWorkers.filter((worker) => mismatchKind(worker) === "camera-missed"),
    [mismatchWorkers]
  );
  const registeredFingerprintMissedWorkers = useMemo(
    () => mismatchWorkers.filter((worker) => mismatchKind(worker) === "fingerprint-missed"),
    [mismatchWorkers]
  );
  const unregisteredFaceEvents = useMemo(
    () =>
      faceEvents
        .filter((event) => !isFaceEventMatched(event) && !isUnknownFaceEvent(event))
        .sort((a, b) => {
          const firstTime = new Date(a.timestamp).getTime();
          const secondTime = new Date(b.timestamp).getTime();
          return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
        }),
    [faceEvents]
  );
  const unknownFaceEvents = useMemo(
    () =>
      faceEvents
        .filter(isUnknownFaceEvent)
        .sort((a, b) => {
          const firstTime = new Date(a.timestamp).getTime();
          const secondTime = new Date(b.timestamp).getTime();
          return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
        }),
    [faceEvents]
  );

  const filteredRegisteredCameraMissedWorkers = useMemo(() => {
    if (mismatchFilter !== "all" && mismatchFilter !== "camera-missed") return [];
    const normalized = normalizeSearch(mismatchQuery);

    return registeredCameraMissedWorkers.filter((worker) => {
      const line = findLine(lines, worker.currentLineId);
      if (!normalized) return true;
      return `${workerSearchText(worker, line)} ${mismatchLabel(worker).toLowerCase()}`.includes(normalized);
    });
  }, [lines, mismatchFilter, mismatchQuery, registeredCameraMissedWorkers]);

  const filteredRegisteredFingerprintMissedWorkers = useMemo(() => {
    if (mismatchFilter !== "all" && mismatchFilter !== "fingerprint-missed") return [];
    const normalized = normalizeSearch(mismatchQuery);

    return registeredFingerprintMissedWorkers.filter((worker) => {
      const line = findLine(lines, worker.currentLineId);
      if (!normalized) return true;
      return `${workerSearchText(worker, line)} ${mismatchLabel(worker).toLowerCase()}`.includes(normalized);
    });
  }, [lines, mismatchFilter, mismatchQuery, registeredFingerprintMissedWorkers]);

  const filteredUnregisteredFaceEvents = useMemo(() => {
    if (mismatchFilter !== "all" && mismatchFilter !== "unregistered-face") return [];
    const normalized = normalizeSearch(mismatchQuery);

    return unregisteredFaceEvents.filter((event) => {
      if (!normalized) return true;
      return faceEventSearchText(event).includes(normalized);
    });
  }, [mismatchFilter, mismatchQuery, unregisteredFaceEvents]);

  const filteredUnknownFaceEvents = useMemo(() => {
    if (mismatchFilter !== "all" && mismatchFilter !== "unknown-face") return [];
    const normalized = normalizeSearch(mismatchQuery);

    return unknownFaceEvents.filter((event) => {
      if (!normalized) return true;
      return `${faceEventSearchText(event)} unknown face no device employee code`.includes(normalized);
    });
  }, [mismatchFilter, mismatchQuery, unknownFaceEvents]);

  const employeeRows = useMemo(() => {
    const normalized = normalizeSearch(employeeQuery);

    return workers
      .filter((worker) => {
        const hasMismatch = mismatchKind(worker) !== "none";
        if (employeeFilter === "attention") {
          return hasMismatch || worker.attendanceStatus === "Absent" || worker.attendanceStatus === "Late";
        }
        if (employeeFilter === "attended") {
          return worker.attendanceStatus === "Present" || worker.attendanceStatus === "Late";
        }
        if (employeeFilter === "absent") return worker.attendanceStatus === "Absent";
        if (employeeFilter === "late") return worker.attendanceStatus === "Late";
        return worker.attendanceStatus === "Present";
      })
      .filter((worker) => matchesAttendanceReportFilter(worker, employeeSignalFilter))
      .filter((worker) => {
        if (!normalized) return true;
        return workerSearchText(worker, findLine(lines, worker.currentLineId)).includes(normalized);
      })
      .sort((a, b) => {
        const priorityDelta = employeePriority(a) - employeePriority(b);
        if (priorityDelta !== 0) return priorityDelta;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [employeeFilter, employeeQuery, employeeSignalFilter, lines, workers]);

  const lineRiskRows = useMemo(
    () =>
      [...lineRows].sort((a, b) => {
        const toneRank = { danger: 0, warning: 1, good: 2, info: 3, neutral: 4 };
        const toneDelta = toneRank[lineTone(a)] - toneRank[lineTone(b)];
        if (toneDelta !== 0) return toneDelta;
        const absentDelta = b.absentWorkers - a.absentWorkers;
        if (absentDelta !== 0) return absentDelta;
        return lineNumber(a) - lineNumber(b);
      }),
    [lineRows]
  );
  const mismatchReviewCount = mismatchWorkers.length + unregisteredFaceEvents.length;
  const filteredMismatchCount =
    mismatchFilter === "unknown-face"
      ? filteredUnknownFaceEvents.length
      : filteredRegisteredCameraMissedWorkers.length +
        filteredRegisteredFingerprintMissedWorkers.length +
        filteredUnregisteredFaceEvents.length;

  const urgentIssues = useMemo<Issue[]>(() => {
    const issues: Issue[] = [];
    const lowestLine = [...lineRows].sort((a, b) => a.attendanceRate - b.attendanceRate)[0];

    if (mismatchReviewCount > 0) {
      issues.push({
        id: "employee-mismatches",
        title: `${plural(mismatchReviewCount, "mismatch", "mismatches")} to review`,
        detail: `${registeredCameraMissedWorkers.length} camera missed, ${unregisteredFaceEvents.length} not registered, ${registeredFingerprintMissedWorkers.length} fingerprint missed`,
        tone: "danger",
      });
    }

    if (redLines.length > 0) {
      issues.push({
        id: "red-lines",
        title: `${plural(redLines.length, "line")} in red`,
        detail: redLines.map((line) => line.name).slice(0, 3).join(", "),
        tone: "danger",
      });
    }

    if (attendanceOverview.absentWorkers > 0) {
      issues.push({
        id: "absent",
        title: `${attendanceOverview.absentWorkers} absent today`,
        detail: `${attendanceOverview.totalWorkers} workers in today's list`,
        tone: attendanceOverview.absentWorkers >= 10 ? "danger" : "warning",
      });
    }

    if (attendanceOverview.lateWorkers > 0) {
      issues.push({
        id: "late",
        title: `${attendanceOverview.lateWorkers} late arrivals`,
        detail: "May affect the first production hours",
        tone: "warning",
      });
    }

    if (unmatchedAttendanceChecks > 0) {
      issues.push({
        id: "attendance-checks",
        title: `${unmatchedAttendanceChecks} attendance checks`,
        detail: "Device records need staff review",
        tone: "warning",
      });
    }

    if (lowestLine && lowestLine.attendanceRate < 85) {
      issues.push({
        id: "lowest-line",
        title: `${lowestLine.name} is lowest`,
        detail: `${lowestLine.attendanceRate}% line attendance`,
        tone: lowestLine.attendanceRate < 70 ? "danger" : "warning",
      });
    }

    return issues.slice(0, 3);
  }, [
    attendanceOverview.absentWorkers,
    attendanceOverview.lateWorkers,
    attendanceOverview.totalWorkers,
    lineRows,
    mismatchReviewCount,
    redLines,
    registeredCameraMissedWorkers.length,
    registeredFingerprintMissedWorkers.length,
    unregisteredFaceEvents.length,
    unmatchedAttendanceChecks,
  ]);

  const visibleCameraMissedWorkers = filteredRegisteredCameraMissedWorkers.slice(0, mismatchVisibleCount);
  const visibleUnregisteredFaceEvents = filteredUnregisteredFaceEvents.slice(0, mismatchVisibleCount);
  const visibleUnknownFaceEvents = filteredUnknownFaceEvents.slice(0, mismatchVisibleCount);
  const visibleFingerprintMissedWorkers = filteredRegisteredFingerprintMissedWorkers.slice(0, mismatchVisibleCount);
  const hasMoreMismatchRows =
    filteredRegisteredCameraMissedWorkers.length > visibleCameraMissedWorkers.length ||
    filteredUnregisteredFaceEvents.length > visibleUnregisteredFaceEvents.length ||
    (mismatchFilter === "unknown-face" && filteredUnknownFaceEvents.length > visibleUnknownFaceEvents.length) ||
    filteredRegisteredFingerprintMissedWorkers.length > visibleFingerprintMissedWorkers.length;
  const visibleEmployeeRows = employeeRows.slice(0, employeeVisibleCount);
  const selectedWorker = selectedWorkerId ? workers.find((worker) => worker.id === selectedWorkerId) : undefined;
  const selectedWorkerLine = selectedWorker ? findLine(lines, selectedWorker.currentLineId) : undefined;
  const selectedLine = selectedLineId ? lines.find((line) => line.id === selectedLineId) : undefined;
  const selectedLineWorkers = useMemo(
    () =>
      selectedLineId
        ? workers
            .filter((worker) => worker.currentLineId === selectedLineId)
            .sort((a, b) => employeePriority(a) - employeePriority(b) || a.fullName.localeCompare(b.fullName))
        : [],
    [selectedLineId, workers]
  );

  const renderRegisteredMismatchCard = (worker: WorkerProfile) => {
    const line = findLine(lines, worker.currentLineId);
    const fingerprintVerified = isVerified(worker.fingerprintVerificationStatus);
    const faceVerified = isVerified(worker.faceVerificationStatus);

    return (
      <button
        key={worker.id}
        type="button"
        className="ops-ceo-mismatch-card tone-danger"
        onClick={() => setSelectedWorkerId(worker.id)}
      >
        <div className="ops-ceo-mismatch-top">
          <div>
            <h3>{worker.fullName}</h3>
            <p>{worker.employeeId} - {line?.name || "No line"} - {worker.attendanceStatus}</p>
          </div>
          <span>{mismatchLabel(worker)}</span>
        </div>
        <div className="ops-ceo-system-row">
          <span className={fingerprintVerified ? "is-yes" : "is-no"}>
            <Fingerprint size={16} />
            Fingerprint {yesNo(fingerprintVerified)}
          </span>
          <span className={faceVerified ? "is-yes" : "is-no"}>
            <ScanFace size={16} />
            Face {yesNo(faceVerified)}
          </span>
        </div>
      </button>
    );
  };

  const handleRefresh = useCallback(async () => {
    await refresh();
    setLastUpdated(new Date());
  }, [refresh]);

  const handleLiveMode = useCallback(() => {
    setSelectedAttendanceDate("");
  }, []);

  const scrollToDetailPanel = useCallback(() => {
    window.setTimeout(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, []);

  const openEmployeeDetail = useCallback(
    (filter: EmployeeFilter) => {
      setEmployeeFilter(filter);
      setEmployeeSignalFilter("all");
      setEmployeeQuery("");
      setEmployeeVisibleCount(EMPLOYEE_PAGE_SIZE);
      setActiveTab("employees");
      scrollToDetailPanel();
    },
    [scrollToDetailPanel]
  );

  const openMismatchDetail = useCallback(
    (filter: MismatchFilter = "all") => {
      setMismatchFilter(filter);
      setMismatchQuery("");
      setMismatchVisibleCount(MISMATCH_PAGE_SIZE);
      setActiveTab("mismatch");
      scrollToDetailPanel();
    },
    [scrollToDetailPanel]
  );

  const openLineRiskDetail = useCallback(() => {
    setSelectedLineId(null);
    setActiveTab("lines");
    scrollToDetailPanel();
  }, [scrollToDetailPanel]);

  const openIssueDetail = useCallback(
    (issueId: string) => {
      if (issueId === "absent") {
        openEmployeeDetail("absent");
        return;
      }

      if (issueId === "late") {
        openEmployeeDetail("late");
        return;
      }

      if (issueId === "red-lines" || issueId === "lowest-line") {
        openLineRiskDetail();
        return;
      }

      openMismatchDetail("all");
    },
    [openEmployeeDetail, openLineRiskDetail, openMismatchDetail]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLoading && !error) {
      setLastUpdated(new Date());
    }
  }, [error, isLoading, snapshot]);

  useEffect(() => {
    setMismatchVisibleCount(MISMATCH_PAGE_SIZE);
  }, [mismatchFilter, mismatchQuery]);

  useEffect(() => {
    setEmployeeVisibleCount(EMPLOYEE_PAGE_SIZE);
  }, [employeeFilter, employeeQuery, employeeSignalFilter]);

  useEffect(() => {
    setSelectedWorkerId(null);
    setSelectedLineId(null);
    setMismatchVisibleCount(MISMATCH_PAGE_SIZE);
    setEmployeeVisibleCount(EMPLOYEE_PAGE_SIZE);
  }, [selectedAttendanceDate]);

  useEffect(() => {
    if (selectedWorkerId && !workers.some((worker) => worker.id === selectedWorkerId)) {
      setSelectedWorkerId(null);
    }
  }, [selectedWorkerId, workers]);

  useEffect(() => {
    if (selectedLineId && !lines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(null);
    }
  }, [lines, selectedLineId]);

  return (
    <main className="ops-exclusive-dashboard ops-ceo-mobile-dashboard">
      <div className="ops-ceo-shell">
        <header className="ops-ceo-header">
          <div className="ops-ceo-brand-row">
            <div className="ops-ceo-brand-copy">
              <div className="ops-ceo-factory">
                <img className="ops-ceo-factory-logo" src={clientLogoSrc} alt="" />
                Union North Garment
              </div>
              <h1>{greeting}</h1>
            </div>
            <span className={`ops-ceo-live-chip tone-${error ? "danger" : isHistoricalMode ? "neutral" : factoryTone}`}>
              <span className="ops-live-dot" />
              {error
                ? "Offline"
                : isHistoricalMode
                  ? "History"
                  : factoryTone === "good"
                    ? "Green"
                    : factoryTone === "warning"
                      ? "Amber"
                      : "Red"}
            </span>
          </div>

          <div className="ops-ceo-date-row">
            <span>
              <CalendarDays size={17} />
              {formatDateLabel(attendanceOverview.attendanceDate)}
            </span>
            <label className="ops-ceo-date-picker">
              <CalendarDays size={16} />
              <input
                type="date"
                value={selectedAttendanceDate || attendanceOverview.attendanceDate || ""}
                max={todayInputValue}
                onChange={(event) =>
                  setSelectedAttendanceDate(
                    event.target.value === todayInputValue ? "" : event.target.value
                  )
                }
                aria-label="Attendance date"
              />
            </label>
            {isHistoricalMode ? (
              <button type="button" className="ops-ceo-live-mode-button" onClick={handleLiveMode}>
                Live
              </button>
            ) : null}
            <span>
              <Clock3 size={17} />
              Last updated {formatClock(lastUpdated)}
            </span>
          </div>

          <button
            type="button"
            className="ops-ceo-refresh-button"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? "is-spinning" : undefined} size={22} />
            {isLoading ? "Refreshing" : "Refresh"}
          </button>

          <nav className="ops-ceo-nav" aria-label="Dashboard sections">
            {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                className={activeTab === id ? "is-active" : undefined}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </header>

        <nav className="ops-ceo-bottom-nav" aria-label="Mobile dashboard sections">
          {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? "is-active" : undefined}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {error ? (
          <div className="ops-ceo-alert-banner">
            <AlertTriangle size={20} />
            Could not load dashboard data.
          </div>
        ) : null}

        {activeTab === "today" ? (
          <section className="ops-ceo-section ops-ceo-tab-panel">
            <div className="ops-ceo-section-heading">
              <div>
                <span>First View</span>
                <h2>Today Attendance</h2>
              </div>
              <strong>{attendanceRate}%</strong>
            </div>

            <div className="ops-ceo-kpi-grid">
              <button
                type="button"
                className="ops-ceo-kpi-card ops-ceo-action-card tone-good is-primary"
                onClick={() => openEmployeeDetail("attended")}
                aria-label="View attended employees"
              >
                <div className="ops-ceo-kpi-label">
                  <CheckCircle2 size={19} />
                  Present
                </div>
                <div className="ops-ceo-kpi-value">
                  {formatNumber(overallAttended)}
                  <span>/ {formatNumber(attendanceOverview.totalWorkers)}</span>
                </div>
              </button>

              <button
                type="button"
                className="ops-ceo-kpi-card ops-ceo-action-card tone-danger"
                onClick={() => openEmployeeDetail("absent")}
                aria-label="View absent employees"
              >
                <div className="ops-ceo-kpi-label">
                  <UserX size={19} />
                  Absent
                </div>
                <div className="ops-ceo-kpi-value">{formatNumber(attendanceOverview.absentWorkers)}</div>
              </button>

              <button
                type="button"
                className="ops-ceo-kpi-card ops-ceo-action-card tone-warning"
                onClick={() => openEmployeeDetail("late")}
                aria-label="View late employees"
              >
                <div className="ops-ceo-kpi-label">
                  <Clock3 size={19} />
                  Late
                </div>
                <div className="ops-ceo-kpi-value">{formatNumber(attendanceOverview.lateWorkers)}</div>
              </button>

              <button
                type="button"
                className={`ops-ceo-kpi-card ops-ceo-action-card tone-${redLines.length > 0 ? "danger" : amberLines.length > 0 ? "warning" : "good"}`}
                onClick={openLineRiskDetail}
                aria-label="View line risk details"
              >
                <div className="ops-ceo-kpi-label">
                  <ShieldAlert size={19} />
                  Line Risk
                </div>
                <div className="ops-ceo-kpi-value">{formatNumber(redLines.length + amberLines.length)}</div>
              </button>

              <button
                type="button"
                className={`ops-ceo-kpi-card ops-ceo-action-card tone-${mismatchReviewCount > 0 ? "danger" : "good"}`}
                onClick={() => openMismatchDetail("all")}
                aria-label="View mismatch details"
              >
                <div className="ops-ceo-kpi-label">
                  <Fingerprint size={19} />
                  Mismatch
                </div>
                <div className="ops-ceo-kpi-value">{formatNumber(mismatchReviewCount)}</div>
              </button>
            </div>

            <div className="ops-ceo-mini-list">
              {urgentIssues.length > 0 ? (
                urgentIssues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    className={`ops-ceo-issue-card ops-ceo-action-card tone-${issue.tone}`}
                    onClick={() => openIssueDetail(issue.id)}
                    aria-label={`Open details for ${issue.title}`}
                  >
                    <AlertTriangle size={22} />
                    <div>
                      <h3>{issue.title}</h3>
                      <p>{issue.detail}</p>
                    </div>
                    <ChevronRight className="ops-ceo-action-chevron" size={20} />
                  </button>
                ))
              ) : (
                <article className="ops-ceo-empty-card">
                  <CheckCircle2 size={22} />
                  No urgent issues right now
                </article>
              )}
            </div>
        </section>
        ) : null}

        {activeTab === "mismatch" ? (
          <section ref={detailPanelRef} className="ops-ceo-section ops-ceo-tab-panel">
            <div className="ops-ceo-section-heading">
              <div>
                <span>Fingerprint vs Face</span>
                <h2>Attendance Mismatch</h2>
              </div>
              <strong>{formatNumber(filteredMismatchCount)}</strong>
            </div>

            <div className="ops-ceo-segmented" aria-label="Mismatch filter">
              {MISMATCH_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={mismatchFilter === filter.id ? "is-active" : undefined}
                  onClick={() => setMismatchFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <label className="ops-ceo-search">
              <Search size={18} />
              <input
                value={mismatchQuery}
                onChange={(event) => setMismatchQuery(event.target.value)}
                placeholder="Search name or ID"
              />
            </label>

            {filteredMismatchCount > 0 ? (
              <div className="ops-ceo-mismatch-sections">
                {mismatchFilter === "all" || mismatchFilter === "camera-missed" ? (
                  <section className="ops-ceo-mismatch-group">
                    <div className="ops-ceo-subsection-heading">
                      <div>
                        <h3>Registered employees not detected by face camera</h3>
                        <p>Fingerprint was attended, but no matched face event was received.</p>
                      </div>
                      <span>{formatNumber(filteredRegisteredCameraMissedWorkers.length)}</span>
                    </div>
                    <div className="ops-ceo-mismatch-list">
                      {visibleCameraMissedWorkers.length > 0 ? (
                        visibleCameraMissedWorkers.map(renderRegisteredMismatchCard)
                      ) : (
                        <article className="ops-ceo-empty-card">
                          <CheckCircle2 size={22} />
                          No camera-missed registered employees
                        </article>
                      )}
                    </div>
                  </section>
                ) : null}

                {mismatchFilter === "all" || mismatchFilter === "unregistered-face" ? (
                  <section className="ops-ceo-mismatch-group">
                    <div className="ops-ceo-subsection-heading">
                      <div>
                        <h3>Face events not registered in LineMatrix</h3>
                        <p>The camera captured a person identifier, but it did not match an active employee.</p>
                      </div>
                      <span>{formatNumber(filteredUnregisteredFaceEvents.length)}</span>
                    </div>
                    <div className="ops-ceo-mismatch-list">
                      {visibleUnregisteredFaceEvents.length > 0 ? (
                        visibleUnregisteredFaceEvents.map((event) => (
                          <article key={event.id} className="ops-ceo-mismatch-card tone-warning">
                            <div className="ops-ceo-mismatch-top">
                              <div>
                                <h3>{faceEventPersonLabel(event)}</h3>
                                <p>{formatEventDateTime(event.timestamp)} - {faceEventCameraLabel(event)}</p>
                              </div>
                              <span>Not registered</span>
                            </div>
                            <div className="ops-ceo-system-row">
                              <span className="is-no">
                                <ScanFace size={16} />
                                Unknown face event
                              </span>
                              <span className="is-no">
                                <UserX size={16} />
                                No employee match
                              </span>
                            </div>
                          </article>
                        ))
                      ) : (
                        <article className="ops-ceo-empty-card">
                          <CheckCircle2 size={22} />
                          No unregistered face events
                        </article>
                      )}
                    </div>
                  </section>
                ) : null}

                {mismatchFilter === "unknown-face" ? (
                  <section className="ops-ceo-mismatch-group">
                    <div className="ops-ceo-subsection-heading">
                      <div>
                        <h3>Unknown face events</h3>
                        <p>The camera recorded a face event, but no employee code or person identity was captured.</p>
                      </div>
                      <span>{formatNumber(filteredUnknownFaceEvents.length)}</span>
                    </div>
                    <div className="ops-ceo-mismatch-list">
                      {visibleUnknownFaceEvents.length > 0 ? (
                        visibleUnknownFaceEvents.map((event) => (
                          <article key={event.id} className="ops-ceo-mismatch-card tone-warning">
                            <div className="ops-ceo-mismatch-top">
                              <div>
                                <h3>{faceEventPersonLabel(event)}</h3>
                                <p>{formatEventDateTime(event.timestamp)} - {faceEventCameraLabel(event)}</p>
                              </div>
                              <span>Unknown</span>
                            </div>
                            <div className="ops-ceo-system-row">
                              <span className="is-no">
                                <ScanFace size={16} />
                                Unknown face event
                              </span>
                              <span className="is-no">
                                <UserX size={16} />
                                No device employee code
                              </span>
                            </div>
                          </article>
                        ))
                      ) : (
                        <article className="ops-ceo-empty-card">
                          <CheckCircle2 size={22} />
                          No unknown face events
                        </article>
                      )}
                    </div>
                  </section>
                ) : null}

                {mismatchFilter === "all" || mismatchFilter === "fingerprint-missed" ? (
                  <section className="ops-ceo-mismatch-group">
                    <div className="ops-ceo-subsection-heading">
                      <div>
                        <h3>Registered employees without fingerprint detection</h3>
                        <p>Face was detected, but no fingerprint attendance was received.</p>
                      </div>
                      <span>{formatNumber(filteredRegisteredFingerprintMissedWorkers.length)}</span>
                    </div>
                    <div className="ops-ceo-mismatch-list">
                      {visibleFingerprintMissedWorkers.length > 0 ? (
                        visibleFingerprintMissedWorkers.map(renderRegisteredMismatchCard)
                      ) : (
                        <article className="ops-ceo-empty-card">
                          <CheckCircle2 size={22} />
                          No fingerprint-missed registered employees
                        </article>
                      )}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <article className="ops-ceo-empty-card">
                <CheckCircle2 size={22} />
                {mismatchFilter === "unknown-face" ? "No unknown face events" : "No fingerprint and face mismatches"}
              </article>
            )}

            {hasMoreMismatchRows ? (
              <button
                type="button"
                className="ops-ceo-show-more"
                onClick={() => setMismatchVisibleCount((current) => current + MISMATCH_PAGE_SIZE)}
              >
                Show more
              </button>
            ) : null}
          </section>
        ) : null}

        {activeTab === "employees" ? (
          <section ref={detailPanelRef} className="ops-ceo-section ops-ceo-tab-panel">
            <div className="ops-ceo-section-heading">
              <div>
                <span>Employees</span>
                <h2>Attendance List</h2>
              </div>
              <strong>{formatNumber(employeeRows.length)}</strong>
            </div>

            <div className="ops-ceo-segmented" aria-label="Employee filter">
              {EMPLOYEE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={employeeFilter === filter.id ? "is-active" : undefined}
                  onClick={() => setEmployeeFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <select
              className="ops-ceo-select"
              value={employeeSignalFilter}
              onChange={(event) =>
                setEmployeeSignalFilter(event.target.value as AttendanceReportFilter)
              }
              aria-label="Face and fingerprint filter"
            >
              {ATTENDANCE_MISSING_SIGNAL_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>

            <label className="ops-ceo-search">
              <Search size={18} />
              <input
                value={employeeQuery}
                onChange={(event) => setEmployeeQuery(event.target.value)}
                placeholder="Search employee"
              />
            </label>

            <div className="ops-ceo-worker-list">
              {visibleEmployeeRows.length > 0 ? (
                visibleEmployeeRows.map((worker) => {
                  const line = findLine(lines, worker.currentLineId);
                  const hasMismatch = mismatchKind(worker) !== "none";
                  const tone = hasMismatch
                    ? "danger"
                    : worker.attendanceStatus === "Absent"
                      ? "danger"
                      : worker.attendanceStatus === "Late"
                        ? "warning"
                        : "good";

                  return (
                    <button
                      key={worker.id}
                      type="button"
                      className={`ops-ceo-worker-card tone-${tone}`}
                      onClick={() => setSelectedWorkerId(worker.id)}
                    >
                      <WorkerChip
                        worker={worker}
                        meta={<span className="ops-ceo-worker-line">{line?.name || "No line"}</span>}
                      />
                      <span>{hasMismatch ? mismatchLabel(worker) : worker.attendanceStatus}</span>
                    </button>
                  );
                })
              ) : (
                <article className="ops-ceo-empty-card">
                  <Users size={22} />
                  No employees found
                </article>
              )}
            </div>

            {employeeRows.length > visibleEmployeeRows.length ? (
              <button
                type="button"
                className="ops-ceo-show-more"
                onClick={() => setEmployeeVisibleCount((current) => current + EMPLOYEE_PAGE_SIZE)}
              >
                Show more
              </button>
            ) : null}
          </section>
        ) : null}

        {activeTab === "lines" ? (
          <section ref={detailPanelRef} className="ops-ceo-section ops-ceo-tab-panel">
            <div className="ops-ceo-section-heading">
              <div>
                <span>Line Status</span>
                <h2>{formatNumber(lineRows.length)} active lines</h2>
              </div>
              <strong>{lineAttendance}%</strong>
            </div>

            <div className="ops-ceo-line-list">
              {lineRows.map((line) => {
                const tone = lineTone(line);
                const came = line.presentWorkers + line.lateWorkers;

                return (
                  <article key={line.id} className={`ops-ceo-line-card tone-${tone}`}>
                    <button
                      type="button"
                      className="ops-ceo-line-toggle"
                      aria-label={`${line.name} details`}
                      onClick={() => setSelectedLineId(line.id)}
                    >
                      <div className="ops-ceo-line-top">
                        <div>
                          <h3>{line.name}</h3>
                          <p>{line.allocatedStyle || line.department || line.code}</p>
                        </div>
                        <span>{lineRiskLabel(line)}</span>
                      </div>
                      <div className="ops-ceo-line-summary">
                        <strong>{line.attendanceRate}%</strong>
                        <ChevronRight size={20} />
                      </div>

                      <div className="ops-ceo-line-metrics">
                        <span>Assigned <strong>{line.assignedWorkers}</strong></span>
                        <span>Came <strong>{came}</strong></span>
                        <span>Absent <strong>{line.absentWorkers}</strong></span>
                        <span>Late <strong>{line.lateWorkers}</strong></span>
                        <span>Leave <strong>{line.onLeaveWorkers}</strong></span>
                        <span>Output <strong>{line.output}</strong></span>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <DetailDrawer
          open={Boolean(selectedWorker)}
          title={selectedWorker?.fullName || "Employee"}
          subtitle={selectedWorker ? `${selectedWorker.employeeId} - ${selectedWorker.roleTitle}` : undefined}
          onClose={() => setSelectedWorkerId(null)}
        >
          {selectedWorker ? (
            <div className="ops-ceo-detail-stack">
              <div className="ops-ceo-drawer-hero">
                <WorkerChip worker={selectedWorker} />
                <StatusBadge
                  label={selectedWorker.attendanceStatus}
                  tone={attendanceTone(selectedWorker.attendanceStatus)}
                />
              </div>

              <div className="ops-ceo-detail-grid">
                <DetailField label="Department" value={selectedWorker.department} />
                <DetailField label="Line" value={selectedWorkerLine?.name || "No line"} />
                <DetailField label="Shift" value={selectedWorker.shift} />
                <DetailField label="Current Status" value={selectedWorker.currentStatus} />
              </div>

              <div className="ops-ceo-system-row">
                <span className={isVerified(selectedWorker.fingerprintVerificationStatus) ? "is-yes" : "is-no"}>
                  <Fingerprint size={16} />
                  Fingerprint {yesNo(isVerified(selectedWorker.fingerprintVerificationStatus))}
                </span>
                <span className={isVerified(selectedWorker.faceVerificationStatus) ? "is-yes" : "is-no"}>
                  <ScanFace size={16} />
                  Face {yesNo(isVerified(selectedWorker.faceVerificationStatus))}
                </span>
              </div>

              <div className="ops-ceo-detail-grid">
                <DetailField label="Validation" value={selectedWorker.finalValidationStatus} />
                <DetailField label="Phone" value={selectedWorker.phone || "Not captured"} />
                <DetailField label="Joined" value={formatDateLabel(selectedWorker.joinDate)} />
                <DetailField label="Skills" value={selectedWorker.skills.length ? selectedWorker.skills.join(", ") : "Not captured"} />
              </div>
            </div>
          ) : null}
        </DetailDrawer>

        <DetailDrawer
          open={Boolean(selectedLine)}
          title={selectedLine?.name || "Line"}
          subtitle={selectedLine ? `${selectedLine.code} - ${selectedLine.shift}` : undefined}
          onClose={() => setSelectedLineId(null)}
        >
          {selectedLine ? (
            <div className="ops-ceo-detail-stack">
              <div className={`ops-ceo-line-card tone-${lineTone(selectedLine)}`}>
                <div className="ops-ceo-line-top">
                  <div>
                    <h3>{selectedLine.allocatedStyle || "Unassigned style"}</h3>
                    <p>{selectedLine.department} - {selectedLine.supervisor}</p>
                  </div>
                  <span>{lineRiskLabel(selectedLine)}</span>
                </div>
                <div className="ops-ceo-line-summary">
                  <strong>{selectedLine.attendanceRate}%</strong>
                  <StatusBadge
                    label={selectedLine.risk}
                    tone={lineTone(selectedLine) === "good" ? "success" : lineTone(selectedLine) === "warning" ? "warning" : "danger"}
                  />
                </div>
              </div>

              <div className="ops-ceo-detail-grid">
                <DetailField label="Assigned" value={selectedLine.assignedWorkers} />
                <DetailField label="Present" value={selectedLine.presentWorkers} />
                <DetailField label="Late" value={selectedLine.lateWorkers} />
                <DetailField label="Absent" value={selectedLine.absentWorkers} />
                <DetailField label="Leave" value={selectedLine.onLeaveWorkers} />
                <DetailField label="Output" value={`${selectedLine.output}/${selectedLine.targetOutput}`} />
              </div>

              <div className="ops-ceo-detail-section">
                <h3>Line Employees</h3>
                <div className="ops-ceo-drawer-list">
                  {selectedLineWorkers.slice(0, 8).map((worker) => (
                    <button
                      key={worker.id}
                      type="button"
                      className="ops-ceo-drawer-worker"
                      onClick={() => {
                        setSelectedLineId(null);
                        setSelectedWorkerId(worker.id);
                      }}
                    >
                      <WorkerChip worker={worker} />
                      <StatusBadge label={worker.attendanceStatus} tone={attendanceTone(worker.attendanceStatus)} />
                    </button>
                  ))}
                  {selectedLineWorkers.length === 0 ? (
                    <div className="ops-ceo-empty-card">
                      <Users size={22} />
                      No employees assigned
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </DetailDrawer>
      </div>
    </main>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ops-ceo-detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default IeFullDashboardPage;
