import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { BarChart3, CheckCircle2, Fingerprint, ScanFace, Users } from "lucide-react";
import {
  ATTENDANCE_MISSING_SIGNAL_FILTERS,
  type AttendanceReportFilter,
  matchesAttendanceReportFilter,
} from "../attendance-reporting";
import { useOperations, findLine } from "../operations-context";
import { buildHikvisionFaceEventSummary } from "../face-event-counts";
import { resolveFingerprintDeviceSummary } from "../fingerprint-device-counts";
import { useHikvisionFaceEvents } from "../hooks/use-hikvision-face-events";
import { useZktecoFingerprintEvents } from "../hooks/use-zkteco-fingerprint-events";
import {
  Card,
  KpiCard,
  PageHeader,
  SearchField,
  StatusBadge,
  WorkerChip,
  attendanceTone,
} from "../components/ops-ui";

function verificationLabel(verified: boolean) {
  return verified ? "Attended" : "Not attended";
}

function verificationTone(verified: boolean) {
  return verified ? "success" : "danger";
}

const EMPLOYEE_PAGE_SIZE = 50;

export function IeDashboardPage() {
  const { attendanceOverview, workers, lines, fingerprintDeviceSummary } = useOperations();
  const { events: hikvisionFaceEvents } = useHikvisionFaceEvents(500);
  const { events: zktecoFingerprintEvents } = useZktecoFingerprintEvents(5000);
  const [query, setQuery] = useState("");
  const [attendanceSignalFilter, setAttendanceSignalFilter] =
    useState<AttendanceReportFilter>("all");
  const [employeePage, setEmployeePage] = useState(1);

  const filteredWorkers = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return workers.filter((worker) => {
      if (!matchesAttendanceReportFilter(worker, attendanceSignalFilter)) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      const line = findLine(lines, worker.currentLineId);
      return [
        worker.fullName,
        worker.employeeId,
        worker.department,
        worker.roleTitle,
        line?.name,
        line?.code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [attendanceSignalFilter, lines, query, workers]);

  const totalEmployeePages = Math.max(1, Math.ceil(filteredWorkers.length / EMPLOYEE_PAGE_SIZE));
  const pagedWorkers = useMemo(() => {
    const start = (employeePage - 1) * EMPLOYEE_PAGE_SIZE;
    return filteredWorkers.slice(start, start + EMPLOYEE_PAGE_SIZE);
  }, [employeePage, filteredWorkers]);
  const employeeStart = filteredWorkers.length === 0 ? 0 : (employeePage - 1) * EMPLOYEE_PAGE_SIZE + 1;
  const employeeEnd = Math.min(employeePage * EMPLOYEE_PAGE_SIZE, filteredWorkers.length);

  useEffect(() => {
    setEmployeePage(1);
  }, [attendanceSignalFilter, query]);

  useEffect(() => {
    setEmployeePage((current) => Math.min(current, totalEmployeePages));
  }, [totalEmployeePages]);

  const resolvedFingerprintDeviceSummary = useMemo(
    () => resolveFingerprintDeviceSummary(fingerprintDeviceSummary, zktecoFingerprintEvents),
    [fingerprintDeviceSummary, zktecoFingerprintEvents]
  );
  const registeredFingerprintWorkers = workers.filter(
    (worker) => worker.fingerprintVerificationStatus === "Verified"
  ).length;
  const registeredFingerprintAttended =
    resolvedFingerprintDeviceSummary.registeredDevicePins || registeredFingerprintWorkers;
  const unmatchedFingerprintCount = resolvedFingerprintDeviceSummary.unregisteredDevicePins;
  const fingerprintAttended =
    resolvedFingerprintDeviceSummary.totalDevicePins || registeredFingerprintAttended + unmatchedFingerprintCount;
  const faceAttended = workers.filter((worker) => worker.faceVerificationStatus === "Verified").length;
  const faceEventSummary = useMemo(
    () => buildHikvisionFaceEventSummary(hikvisionFaceEvents, attendanceOverview.attendanceDate),
    [attendanceOverview.attendanceDate, hikvisionFaceEvents]
  );
  const unmatchedFaceCount = faceEventSummary.unmatchedEvents;
  const overallAttended = attendanceOverview.presentWorkers + attendanceOverview.lateWorkers;

  return (
    <div className="ops-page">
      <PageHeader
        title="IE Dashboard"
        subtitle="Employee attendance verification and line readiness for industrial engineering review."
        actions={
          <>
            <Link to="/ie-line-attendance" className="ops-button ops-button-secondary">
              Line Attendance
            </Link>
            <Link to="/ie-analytics" className="ops-button ops-button-primary">
              Analytics
            </Link>
          </>
        }
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Total Employees"
          value={`${attendanceOverview.totalWorkers}`}
          meta="Active employee records available for IE review."
          icon={Users}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Overall Attendance"
          value={`${overallAttended}/${attendanceOverview.totalWorkers}`}
          meta={`${attendanceOverview.absentWorkers} absent and ${attendanceOverview.onLeaveWorkers} on leave.`}
          icon={CheckCircle2}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Fingerprint Attended"
          value={`${fingerprintAttended}`}
          meta={`${registeredFingerprintAttended} registered, ${unmatchedFingerprintCount} unmatched PINs included.`}
          icon={Fingerprint}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
        <KpiCard
          label="Face Attended"
          value={`${faceAttended}`}
          meta={`${faceAttended} matched workers, ${unmatchedFaceCount} unmatched face events.`}
          icon={ScanFace}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
      </section>

      <Card
        title="Employee Attendance Verification"
        subtitle="Every active employee with image, department, current line, fingerprint status, face status, and overall attendance."
        actions={
          <>
            <StatusBadge label={`${unmatchedFingerprintCount} unmatched fingerprint PINs`} tone="warning" />
            <StatusBadge label={`${unmatchedFaceCount} unmatched face events`} tone="warning" />
            <SearchField value={query} onChange={setQuery} placeholder="Search employee, line, or department" />
            <select
              className="ops-select"
              style={{ flex: "0 0 230px" }}
              value={attendanceSignalFilter}
              onChange={(event) =>
                setAttendanceSignalFilter(event.target.value as AttendanceReportFilter)
              }
            >
              {ATTENDANCE_MISSING_SIGNAL_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </>
        }
      >
        <div className="ops-table-wrap" style={{ maxHeight: 620, overflow: "auto" }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Line</th>
                <th>Fingerprint</th>
                <th>Face</th>
                <th>Overall Attendance</th>
              </tr>
            </thead>
            <tbody>
              {pagedWorkers.map((worker) => {
                const line = findLine(lines, worker.currentLineId);
                const fingerprintVerified = worker.fingerprintVerificationStatus === "Verified";
                const faceVerified = worker.faceVerificationStatus === "Verified";

                return (
                  <tr key={worker.id}>
                    <td>
                      <WorkerChip worker={worker} />
                    </td>
                    <td>{worker.department}</td>
                    <td>{line ? `${line.name} · ${line.code}` : "Unassigned"}</td>
                    <td>
                      <StatusBadge
                        label={verificationLabel(fingerprintVerified)}
                        tone={verificationTone(fingerprintVerified)}
                      />
                    </td>
                    <td>
                      <StatusBadge
                        label={verificationLabel(faceVerified)}
                        tone={verificationTone(faceVerified)}
                      />
                    </td>
                    <td>
                      <StatusBadge
                        label={worker.attendanceStatus}
                        tone={attendanceTone(worker.attendanceStatus)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ops-pagination-bar">
          <div className="ops-row-subtitle">
            Showing {employeeStart}-{employeeEnd} of {filteredWorkers.length} employees
          </div>
          <div className="ops-pagination-actions">
            <button
              type="button"
              className="ops-button ops-button-secondary"
              disabled={employeePage <= 1}
              onClick={() => setEmployeePage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span className="ops-pagination-count">
              Page {employeePage} of {totalEmployeePages}
            </span>
            <button
              type="button"
              className="ops-button ops-button-secondary"
              disabled={employeePage >= totalEmployeePages}
              onClick={() => setEmployeePage((current) => Math.min(totalEmployeePages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      <section className="ops-grid cols-2">
        <Card
          title="Line Attention"
          subtitle="Lowest attendance production lines for IE follow-up."
          actions={
            <Link to="/ie-line-attendance" className="ops-button ops-button-ghost">
              View Lines
            </Link>
          }
        >
          <div className="ops-list">
            {[...lines]
              .sort((a, b) => a.attendanceRate - b.attendanceRate)
              .slice(0, 5)
              .map((line) => (
                <div key={line.id} className="ops-list-item">
                  <div className="ops-item-header">
                    <div>
                      <div className="ops-item-title">{line.name}</div>
                      <div className="ops-row-subtitle">
                        {line.code} · {line.department} · {line.shift}
                      </div>
                    </div>
                    <StatusBadge
                      label={`${line.attendanceRate}%`}
                      tone={
                        line.attendanceRate >= 85
                          ? "success"
                          : line.attendanceRate >= 70
                            ? "warning"
                            : "danger"
                      }
                    />
                  </div>
                  <div className="ops-item-meta">
                    <span>{line.presentWorkers + line.lateWorkers} came</span>
                    <span>{line.absentWorkers} absent</span>
                    <span>{line.onLeaveWorkers} leave</span>
                  </div>
                </div>
              ))}
          </div>
        </Card>

        <Card
          title="Analytics Shortcut"
          subtitle="Open IE analytics for line, department, and verification trends."
          actions={
            <Link to="/ie-analytics" className="ops-button ops-button-primary">
              <BarChart3 size={15} />
              Open Analytics
            </Link>
          }
        >
          <div className="ops-stat-strip">
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Present</div>
              <div className="ops-stat-value">{attendanceOverview.presentWorkers}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Late</div>
              <div className="ops-stat-value">{attendanceOverview.lateWorkers}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Leave</div>
              <div className="ops-stat-value">{attendanceOverview.onLeaveWorkers}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Absent</div>
              <div className="ops-stat-value">{attendanceOverview.absentWorkers}</div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

export default IeDashboardPage;
