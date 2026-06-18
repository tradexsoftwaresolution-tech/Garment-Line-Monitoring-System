import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildHikvisionFaceEventSummary } from "../face-event-counts";
import { usePublicExclusiveDashboardSnapshot } from "../hooks/use-public-exclusive-dashboard-snapshot";
import {
  Card,
  LineCard,
  PageHeader,
  SearchField,
  StatusBadge,
  WorkerChip,
  attendanceTone,
} from "../components/ops-ui";
import type { ProductionLineRecord } from "../types";

const EMPLOYEE_PAGE_SIZE = 50;
type VerificationFilter = "all" | "missing-fingerprint" | "missing-face" | "missing-both" | "fully-verified";

const COLORS = {
  present: "#16a34a",
  late: "#d97706",
  leave: "#2563eb",
  absent: "#dc2626",
  face: "#7c3aed",
  fingerprint: "#0f766e",
  total: "#94a3b8",
};

function verificationLabel(verified: boolean) {
  return verified ? "Attended" : "Not attended";
}

function verificationTone(verified: boolean) {
  return verified ? "success" : "danger";
}

function lineNumber(line: { code: string; name: string }) {
  const match = `${line.code} ${line.name}`.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function getAntonioGreeting(date: Date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return "Good morning, Mr. Antonio!";
  if (hour >= 12 && hour < 17) return "Good afternoon, Mr. Antonio!";
  if (hour >= 17 && hour < 21) return "Good evening, Mr. Antonio!";
  return "Good night, Mr. Antonio!";
}

function findLine(lines: ProductionLineRecord[], lineId?: string) {
  return lineId ? lines.find((line) => line.id === lineId) : undefined;
}

export function IeFullDashboardPage() {
  const { snapshot, isLoading, error } = usePublicExclusiveDashboardSnapshot();
  const {
    attendanceOverview,
    departmentAttendance,
    fingerprintDeviceSummary,
    faceEvents,
    lines,
    reportSeries,
    workers,
  } = snapshot;
  const [query, setQuery] = useState("");
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("all");
  const [employeePage, setEmployeePage] = useState(1);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const greeting = useMemo(() => getAntonioGreeting(currentTime), [currentTime]);

  const lineRows = useMemo(
    () =>
      [...lines].sort((a, b) => {
        const lineNumberDelta = lineNumber(a) - lineNumber(b);
        if (lineNumberDelta !== 0) return lineNumberDelta;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      }),
    [lines]
  );

  const missingFingerprintWorkers = workers.filter(
    (worker) => worker.fingerprintVerificationStatus !== "Verified"
  ).length;
  const missingFaceWorkers = workers.filter((worker) => worker.faceVerificationStatus !== "Verified").length;
  const missingBothWorkers = workers.filter(
    (worker) => worker.fingerprintVerificationStatus !== "Verified" && worker.faceVerificationStatus !== "Verified"
  ).length;
  const fullyVerifiedWorkers = workers.filter(
    (worker) => worker.fingerprintVerificationStatus === "Verified" && worker.faceVerificationStatus === "Verified"
  ).length;

  const verificationFilters: Array<{ value: VerificationFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: workers.length },
    { value: "missing-fingerprint", label: "No Finger", count: missingFingerprintWorkers },
    { value: "missing-face", label: "No Face", count: missingFaceWorkers },
    { value: "missing-both", label: "Missing Both", count: missingBothWorkers },
    { value: "fully-verified", label: "Both Attended", count: fullyVerifiedWorkers },
  ];

  const filteredWorkers = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return workers.filter((worker) => {
      const fingerprintVerified = worker.fingerprintVerificationStatus === "Verified";
      const faceVerified = worker.faceVerificationStatus === "Verified";
      const matchesVerificationFilter =
        verificationFilter === "all" ||
        (verificationFilter === "missing-fingerprint" && !fingerprintVerified) ||
        (verificationFilter === "missing-face" && !faceVerified) ||
        (verificationFilter === "missing-both" && !fingerprintVerified && !faceVerified) ||
        (verificationFilter === "fully-verified" && fingerprintVerified && faceVerified);

      if (!matchesVerificationFilter) return false;
      if (!normalized) return true;

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
  }, [lines, query, verificationFilter, workers]);

  const totalEmployeePages = Math.max(1, Math.ceil(filteredWorkers.length / EMPLOYEE_PAGE_SIZE));
  const pagedWorkers = useMemo(() => {
    const start = (employeePage - 1) * EMPLOYEE_PAGE_SIZE;
    return filteredWorkers.slice(start, start + EMPLOYEE_PAGE_SIZE);
  }, [employeePage, filteredWorkers]);
  const employeeStart = filteredWorkers.length === 0 ? 0 : (employeePage - 1) * EMPLOYEE_PAGE_SIZE + 1;
  const employeeEnd = Math.min(employeePage * EMPLOYEE_PAGE_SIZE, filteredWorkers.length);

  useEffect(() => {
    setEmployeePage(1);
  }, [query, verificationFilter]);

  useEffect(() => {
    setEmployeePage((current) => Math.min(current, totalEmployeePages));
  }, [totalEmployeePages]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const registeredFingerprintWorkers = workers.filter(
    (worker) => worker.fingerprintVerificationStatus === "Verified"
  ).length;
  const registeredFingerprintAttended =
    fingerprintDeviceSummary.registeredDevicePins || registeredFingerprintWorkers;
  const unmatchedFingerprintCount = fingerprintDeviceSummary.unregisteredDevicePins;
  const fingerprintAttended =
    fingerprintDeviceSummary.totalDevicePins || registeredFingerprintAttended + unmatchedFingerprintCount;
  const faceAttended = workers.filter((worker) => worker.faceVerificationStatus === "Verified").length;
  const faceEventSummary = useMemo(
    () => buildHikvisionFaceEventSummary(faceEvents, attendanceOverview.attendanceDate),
    [attendanceOverview.attendanceDate, faceEvents]
  );
  const unmatchedFaceCount = faceEventSummary.unmatchedEvents;
  const overallAttended = attendanceOverview.presentWorkers + attendanceOverview.lateWorkers;

  const assignedWorkers = lineRows.reduce((sum, line) => sum + line.assignedWorkers, 0);
  const cameToday = lineRows.reduce((sum, line) => sum + line.presentWorkers + line.lateWorkers, 0);
  const lineAttendance = assignedWorkers === 0 ? 0 : Math.round((cameToday / assignedWorkers) * 100);
  const criticalLines = lineRows.filter((line) => line.risk === "Critical").length;
  const averageLineAttendance =
    lines.length === 0
      ? 0
      : Math.round(lines.reduce((sum, line) => sum + line.attendanceRate, 0) / lines.length);

  const statusData = useMemo(
    () => [
      { name: "Present", value: attendanceOverview.presentWorkers, fill: COLORS.present },
      { name: "Late", value: attendanceOverview.lateWorkers, fill: COLORS.late },
      { name: "On Leave", value: attendanceOverview.onLeaveWorkers, fill: COLORS.leave },
      { name: "Absent", value: attendanceOverview.absentWorkers, fill: COLORS.absent },
    ],
    [attendanceOverview]
  );

  const verificationData = useMemo(
    () => [
      {
        label: "Fingerprint",
        attended: registeredFingerprintAttended,
        unmatched: unmatchedFingerprintCount,
        missing: missingFingerprintWorkers,
      },
      {
        label: "Face",
        attended: faceAttended,
        unmatched: unmatchedFaceCount,
        missing: missingFaceWorkers,
      },
    ],
    [
      faceAttended,
      missingFaceWorkers,
      missingFingerprintWorkers,
      registeredFingerprintAttended,
      unmatchedFaceCount,
      unmatchedFingerprintCount,
    ]
  );

  const lineChartData = useMemo(
    () =>
      lines.map((line) => ({
        label: line.name,
        attendance: line.attendanceRate,
        assigned: line.assignedWorkers,
        came: line.presentWorkers + line.lateWorkers,
        absent: line.absentWorkers,
      })),
    [lines]
  );

  return (
    <main className="ops-exclusive-dashboard">
      <div className="ops-exclusive-dashboard-shell">
        <div className="ops-exclusive-dashboard-brand">
          <div className="ops-logo-badge">
            <LayoutDashboard size={22} />
          </div>
          <div>
            <div className="ops-row-title">{greeting}</div>
          </div>
        </div>

        <div className="ops-page ops-ie-full-dashboard">
      <PageHeader
        title="Exclusive Operations Dashboard"
        subtitle={isLoading ? "Refreshing live factory attendance..." : "Live factory attendance, verification, and line readiness."}
      />

      {error ? (
        <div className="ops-alert-banner tone-danger">
          Could not load public dashboard data: {error}
        </div>
      ) : null}

      <section className="ops-ie-hero">
        <div className="ops-ie-hero-copy">
          <div className="ops-section-eyebrow">
            <LayoutDashboard size={15} />
            Industrial Engineering Control View
          </div>
          <h2>Attendance, line readiness, and verification coverage in one live dashboard.</h2>
        </div>
        <div className="ops-ie-hero-stats">
          <div className="ops-stat-tile">
            <div className="ops-stat-label">Overall Attendance</div>
            <div className="ops-stat-value">{overallAttended}/{attendanceOverview.totalWorkers}</div>
          </div>
          <div className="ops-stat-tile">
            <div className="ops-stat-label">Line Attendance</div>
            <div className="ops-stat-value">{lineAttendance}%</div>
          </div>
          <div className="ops-stat-tile">
            <div className="ops-stat-label">Unmatched Fingerprint PINs</div>
            <div className="ops-stat-value">{unmatchedFingerprintCount}</div>
          </div>
          <div className="ops-stat-tile">
            <div className="ops-stat-label">Unmatched Face Events</div>
            <div className="ops-stat-value">{unmatchedFaceCount}</div>
          </div>
        </div>
      </section>

      <section className="ops-exclusive-quick-stats" aria-label="Factory attendance summary">
        <div className="ops-exclusive-quick-stat">
          <span>Total Employees</span>
          <strong>{attendanceOverview.totalWorkers}</strong>
        </div>
        <div className="ops-exclusive-quick-stat">
          <span>Overall Attendance</span>
          <strong>
            {overallAttended}/{attendanceOverview.totalWorkers}
          </strong>
        </div>
        <div className="ops-exclusive-quick-stat">
          <span>Fingerprint Attended</span>
          <strong>{fingerprintAttended}</strong>
          <small>{unmatchedFingerprintCount} unmatched PINs</small>
        </div>
        <div className="ops-exclusive-quick-stat">
          <span>Face Attended</span>
          <strong>{faceAttended}</strong>
          <small>{unmatchedFaceCount} unmatched face events</small>
        </div>
      </section>

      <Card
        title="Employee Attendance Verification"
        subtitle="Every active employee with image, department, current line, fingerprint status, face status, and overall attendance."
      >
        <div id="ie-verification" className="ops-section-anchor" />
        <div className="ops-exclusive-sticky-controls">
          <div className="ops-exclusive-status-row">
            <StatusBadge label={`${unmatchedFingerprintCount} unmatched fingerprint PINs`} tone="warning" />
            <StatusBadge label={`${unmatchedFaceCount} unmatched face events`} tone="warning" />
          </div>
          <SearchField value={query} onChange={setQuery} placeholder="Search employee, line, or department" />
          <div className="ops-exclusive-filter-row" role="group" aria-label="Employee verification filters">
            {verificationFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`ops-exclusive-filter-chip${verificationFilter === filter.value ? " is-active" : ""}`}
                onClick={() => setVerificationFilter(filter.value)}
              >
                <span>{filter.label}</span>
                <strong>{filter.count}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="ops-table-wrap ops-exclusive-employee-table" style={{ maxHeight: 620, overflow: "auto" }}>
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
                      <StatusBadge label={verificationLabel(faceVerified)} tone={verificationTone(faceVerified)} />
                    </td>
                    <td>
                      <StatusBadge label={worker.attendanceStatus} tone={attendanceTone(worker.attendanceStatus)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ops-exclusive-employee-mobile-list">
          {pagedWorkers.map((worker) => {
            const line = findLine(lines, worker.currentLineId);
            const fingerprintVerified = worker.fingerprintVerificationStatus === "Verified";
            const faceVerified = worker.faceVerificationStatus === "Verified";

            return (
              <article key={worker.id} className="ops-exclusive-employee-card">
                <WorkerChip worker={worker} />
                <div className="ops-exclusive-employee-meta">
                  <span>{worker.department}</span>
                  <span>{line ? `${line.name} · ${line.code}` : "Unassigned"}</span>
                </div>
                <div className="ops-exclusive-employee-badges">
                  <StatusBadge
                    label={`Finger: ${verificationLabel(fingerprintVerified)}`}
                    tone={verificationTone(fingerprintVerified)}
                  />
                  <StatusBadge
                    label={`Face: ${verificationLabel(faceVerified)}`}
                    tone={verificationTone(faceVerified)}
                  />
                  <StatusBadge label={worker.attendanceStatus} tone={attendanceTone(worker.attendanceStatus)} />
                </div>
              </article>
            );
          })}
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

      <section className="ops-exclusive-section-rail" id="ie-lines">
        <div>
          <span>Lines Tracked</span>
          <strong>{lineRows.length}</strong>
        </div>
        <div>
          <span>Assigned Workers</span>
          <strong>{assignedWorkers}</strong>
        </div>
        <div>
          <span>Came Today</span>
          <strong>{cameToday}</strong>
        </div>
        <div>
          <span>Line Attendance</span>
          <strong>{lineAttendance}%</strong>
          <small>{criticalLines} critical line(s)</small>
        </div>
      </section>

      <Card title="Line Attendance Table" subtitle="Attendance detail by production line.">
        <div className="ops-table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Style</th>
                <th>Assigned</th>
                <th>Came</th>
                <th>Late</th>
                <th>Leave</th>
                <th>Absent</th>
                <th>Attendance</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {lineRows.map((line) => (
                <tr key={line.id}>
                  <td>
                    <div className="ops-row-title">{line.name}</div>
                    <div className="ops-row-subtitle">
                      {line.code} · {line.department} · {line.shift}
                    </div>
                  </td>
                  <td>{line.allocatedStyle || "Unassigned"}</td>
                  <td>{line.assignedWorkers}</td>
                  <td>{line.presentWorkers + line.lateWorkers}</td>
                  <td>{line.lateWorkers}</td>
                  <td>{line.onLeaveWorkers}</td>
                  <td>{line.absentWorkers}</td>
                  <td>
                    <StatusBadge
                      label={`${line.attendanceRate}%`}
                      tone={line.attendanceRate >= 85 ? "success" : line.attendanceRate >= 70 ? "warning" : "danger"}
                    />
                  </td>
                  <td>
                    <StatusBadge
                      label={line.risk}
                      tone={line.risk === "Stable" ? "success" : line.risk === "Watch" ? "warning" : "danger"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="ops-grid cols-3 ops-line-attendance-grid">
        {lineRows.map((line) => {
          const lineWorkers = workers.filter((worker) => worker.currentLineId === line.id);
          return (
            <div key={line.id} className="ops-card-link ops-static-card">
              <LineCard
                line={line}
              >
                <div className="ops-list" style={{ marginTop: 16, maxHeight: 260, overflow: "auto" }}>
                  {lineWorkers.slice(0, 8).map((worker) => (
                    <div key={worker.id} className="ops-list-item">
                      <div className="ops-item-header">
                        <WorkerChip worker={worker} />
                        <StatusBadge label={worker.attendanceStatus} tone={attendanceTone(worker.attendanceStatus)} />
                      </div>
                    </div>
                  ))}
                  {lineWorkers.length === 0 ? (
                    <div className="ops-row-subtitle">No employees currently assigned.</div>
                  ) : null}
                </div>
              </LineCard>
            </div>
          );
        })}
      </section>

      <section className="ops-exclusive-section-rail" id="ie-analytics">
        <div>
          <span>Average Line Attendance</span>
          <strong>{averageLineAttendance}%</strong>
        </div>
        <div>
          <span>Present Workers</span>
          <strong>{overallAttended}</strong>
        </div>
        <div>
          <span>Late Workers</span>
          <strong>{attendanceOverview.lateWorkers}</strong>
        </div>
        <div>
          <span>Absent Workers</span>
          <strong>{attendanceOverview.absentWorkers}</strong>
        </div>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Attendance Status Mix" subtitle="Present, late, leave, and absent distribution.">
          <div className="ops-chart-box">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110}>
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          title="Verification Coverage"
          subtitle="Fingerprint and face coverage separates registered workers from unmatched device events."
        >
          <div className="ops-chart-box">
            <ResponsiveContainer>
              <BarChart data={verificationData}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="attended" name="Registered attended" fill={COLORS.fingerprint} radius={[6, 6, 0, 0]} />
                <Bar dataKey="unmatched" name="Unmatched events" fill={COLORS.late} radius={[6, 6, 0, 0]} />
                <Bar dataKey="missing" name="Not attended" fill={COLORS.absent} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Line Attendance Percentage" subtitle="Attendance percentage by active production line.">
          <div className="ops-chart-box">
            <ResponsiveContainer>
              <BarChart data={lineChartData}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="attendance" name="Attendance %" fill={COLORS.face} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Department Attendance" subtitle="Came today against total department roster.">
          <div className="ops-chart-box">
            <ResponsiveContainer>
              <BarChart data={reportSeries.departmentAttendance}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name="Came Today" fill={COLORS.present} radius={[6, 6, 0, 0]} />
                <Bar dataKey="secondaryValue" name="Total Staff" fill={COLORS.total} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <Card title="Department Detail" subtitle="Department-wise attendance rates for IE planning.">
        <div className="ops-table-wrap" style={{ maxHeight: 460, overflow: "auto" }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Total</th>
                <th>Came</th>
                <th>Late</th>
                <th>Leave</th>
                <th>Absent</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {departmentAttendance.map((department) => (
                <tr key={department.department}>
                  <td>
                    <div className="ops-row-title">{department.department}</div>
                  </td>
                  <td>{department.totalWorkers}</td>
                  <td>{department.presentWorkers + department.lateWorkers}</td>
                  <td>{department.lateWorkers}</td>
                  <td>{department.onLeaveWorkers}</td>
                  <td>{department.absentWorkers}</td>
                  <td>{department.attendanceRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
        </div>
      </div>
    </main>
  );
}

export default IeFullDashboardPage;
