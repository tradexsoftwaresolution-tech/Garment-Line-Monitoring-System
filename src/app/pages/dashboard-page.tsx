import { useMemo } from "react";
import { Link } from "react-router";
import { AlertTriangle, Clock3, Fingerprint, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "../auth";
import { resolveFingerprintDeviceSummary } from "../fingerprint-device-counts";
import { useZktecoFingerprintEvents } from "../hooks/use-zkteco-fingerprint-events";
import { useOperations } from "../operations-context";
import { IeDashboardPage } from "./ie-dashboard-page";
import {
  AlertItem,
  Card,
  KpiCard,
  PageHeader,
  StatusBadge,
} from "../components/ops-ui";

function formatAttendanceDate(value: string) {
  if (!value) {
    return "No fingerprint attendance date available yet";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function DashboardPage() {
  const { currentUser } = useAuth();
  const {
    attendanceOverview,
    departmentAttendance,
    alerts,
    lines,
    fingerprintDeviceSummary,
  } = useOperations();

  const isIeUser = currentUser.role === "ie";
  const { events: zktecoFingerprintEvents } = useZktecoFingerprintEvents(5000, !isIeUser);
  const resolvedFingerprintDeviceSummary = useMemo(
    () => resolveFingerprintDeviceSummary(fingerprintDeviceSummary, zktecoFingerprintEvents),
    [fingerprintDeviceSummary, zktecoFingerprintEvents]
  );
  const latestAttendanceDateLabel = formatAttendanceDate(attendanceOverview.attendanceDate);
  const clockedInToday = attendanceOverview.presentWorkers + attendanceOverview.lateWorkers;
  const fingerprintDeviceCount =
    resolvedFingerprintDeviceSummary.totalDevicePins || clockedInToday;
  const openAlerts = alerts.filter((alert) => alert.status !== "Resolved");
  const lineCoverage = useMemo(
    () =>
      [...lines]
        .sort((a, b) => {
          if (a.attendanceRate !== b.attendanceRate) {
            return a.attendanceRate - b.attendanceRate;
          }
          return a.name.localeCompare(b.name);
        })
        .slice(0, 6),
    [lines]
  );

  if (isIeUser) {
    return <IeDashboardPage />;
  }

  return (
    <div className="ops-page">
      <PageHeader
        title="Attendance Dashboard"
        subtitle="Fingerprint-first operations overview with current headcount, department attendance, and line readiness."
        actions={
          <>
            <Link to="/production-lines" className="ops-button ops-button-secondary">
              Production Lines
            </Link>
            <Link to="/reports" className="ops-button ops-button-primary">
              Open Reports
            </Link>
          </>
        }
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Total Workforce"
          value={`${attendanceOverview.totalWorkers}`}
          meta={`Live roster being tracked for ${latestAttendanceDateLabel}.`}
          icon={Users}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Fingerprint Device Count"
          value={`${fingerprintDeviceCount}/${attendanceOverview.totalWorkers}`}
          meta={`${resolvedFingerprintDeviceSummary.registeredDevicePins} registered, ${resolvedFingerprintDeviceSummary.unregisteredDevicePins} unregistered PINs.`}
          icon={Clock3}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="On Leave"
          value={`${attendanceOverview.onLeaveWorkers}`}
          meta="Workers currently marked as leave from the fingerprint attendance source."
          icon={ShieldCheck}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
        <KpiCard
          label="Open Alerts"
          value={`${openAlerts.length}`}
          meta={`${attendanceOverview.absentWorkers} workers are still not clocked in for the latest attendance date.`}
          icon={AlertTriangle}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Department Attendance"
          subtitle={`Current attendance by department for ${latestAttendanceDateLabel}.`}
          actions={
            <StatusBadge
              label={`${departmentAttendance.length} departments`}
              tone="info"
            />
          }
        >
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Total Staff</th>
                  <th>Came Today</th>
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
                    <td>
                      <StatusBadge
                        label={`${department.attendanceRate}%`}
                        tone={
                          department.attendanceRate >= 85
                            ? "success"
                            : department.attendanceRate >= 70
                              ? "warning"
                              : "danger"
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Line Attendance Snapshot"
          subtitle="Assigned versus attended workers for the lines that need the most attention today."
          actions={
            <Link to="/production-lines" className="ops-button ops-button-ghost">
              View All Lines
            </Link>
          }
        >
          <div className="ops-list">
            {lineCoverage.map((line) => (
              <div key={line.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{line.name}</div>
                    <div className="ops-row-subtitle">
                      {line.department} · {line.shift}
                    </div>
                  </div>
                  <StatusBadge
                    label={`${line.presentWorkers + line.lateWorkers}/${line.assignedWorkers} came`}
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
                  <span>{line.supervisor}</span>
                  <span>{line.onLeaveWorkers} on leave</span>
                  <span>{line.absentWorkers} absent</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Attendance Overview"
          subtitle="Registered roster attendance plus raw fingerprint device totals."
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
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Device PINs</div>
              <div className="ops-stat-value">{resolvedFingerprintDeviceSummary.totalDevicePins}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Unregistered</div>
              <div className="ops-stat-value">{resolvedFingerprintDeviceSummary.unregisteredDevicePins}</div>
            </div>
          </div>

          {resolvedFingerprintDeviceSummary.unregisteredPins.length ? (
            <>
              <div className="ops-card-divider" />
              <div className="ops-item-header">
                <div>
                  <div className="ops-item-title">Unregistered Fingerprint PINs</div>
                  <div className="ops-row-subtitle">
                    Counted in fingerprint device attendance, excluded from employee/line attendance until registered.
                  </div>
                </div>
                <StatusBadge
                  label={`${resolvedFingerprintDeviceSummary.unregisteredDevicePins} PINs`}
                  tone="warning"
                />
              </div>
              <div className="ops-list" style={{ marginTop: 12 }}>
                {resolvedFingerprintDeviceSummary.unregisteredPins.slice(0, 8).map((pin) => (
                  <div key={pin.pin} className="ops-list-item compact">
                    <div className="ops-item-header">
                      <div>
                        <div className="ops-item-title">PIN {pin.pin}</div>
                        <div className="ops-row-subtitle">
                          {pin.punchCount} punch(es) · {pin.deviceIps.join(", ") || "No device IP"}
                        </div>
                      </div>
                      <StatusBadge label="Not registered" tone="warning" />
                    </div>
                  </div>
                ))}
              </div>
              {resolvedFingerprintDeviceSummary.unregisteredPins.length > 8 ? (
                <Link to="/zkteco-fingerprint" className="ops-button ops-button-ghost" style={{ marginTop: 12 }}>
                  <Fingerprint size={15} />
                  View all unregistered PINs
                </Link>
              ) : null}
            </>
          ) : null}
        </Card>

        <Card
          title="Alerts Center"
          subtitle="Open exceptions that still need follow-up from supervisors or HR."
          actions={
            <Link to="/alerts-center" className="ops-button ops-button-ghost">
              Open Alerts
            </Link>
          }
        >
          <div className="ops-list">
            {openAlerts.slice(0, 4).map((alert) => (
              <AlertItem
                key={alert.id}
                priority={alert.priority}
                title={alert.title}
                description={alert.description}
                meta={<span>{alert.type}</span>}
              />
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export default DashboardPage;
