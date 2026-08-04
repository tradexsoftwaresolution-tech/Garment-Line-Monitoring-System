import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, Clock3, Fingerprint, ScanFace, ShieldCheck, Users } from "lucide-react";
import {
  getFaceFingerprintMismatch,
  hasFaceAttendance,
  hasFingerprintAttendance,
} from "../attendance-reporting";
import {
  currentAttendanceDateKey,
  isDateKeyInAttendanceDay,
} from "../alert-dates";
import { useAuth } from "../auth";
import { buildHikvisionFaceEventSummary } from "../face-event-counts";
import { resolveFingerprintDeviceSummary } from "../fingerprint-device-counts";
import { useHikvisionFaceEvents } from "../hooks/use-hikvision-face-events";
import { useZktecoFingerprintEvents } from "../hooks/use-zkteco-fingerprint-events";
import { findLine, useOperations } from "../operations-context";
import { IeDashboardPage } from "./ie-dashboard-page";
import {
  AlertItem,
  Card,
  DetailModal,
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  WorkerChip,
  attendanceTone,
} from "../components/ops-ui";
import type { WorkerProfile } from "../types";

type HrKpiId =
  | "total-workforce"
  | "fingerprint-attended"
  | "face-attended"
  | "on-leave"
  | "open-alerts"
  | "biometric-mismatch";

type HrKpiDetail = {
  title: string;
  subtitle: string;
  workers: WorkerProfile[];
};

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

function mismatchLabel(worker: WorkerProfile) {
  const mismatch = getFaceFingerprintMismatch(worker);
  if (mismatch === "camera-missed") return "Face not detected";
  if (mismatch === "fingerprint-missed") return "Fingerprint not detected";
  return "No mismatch";
}

export function DashboardPage() {
  const { currentUser, canAccess } = useAuth();
  const {
    attendanceOverview,
    departmentAttendance,
    alerts,
    lines,
    workers,
    fingerprintDeviceSummary,
  } = useOperations();
  const [selectedHrKpi, setSelectedHrKpi] = useState<HrKpiId | null>(null);

  const isIeUser = currentUser.role === "ie";
  const isHrUser = currentUser.role === "hr";
  const { events: hikvisionFaceEvents } = useHikvisionFaceEvents(500, !isIeUser);
  const { events: zktecoFingerprintEvents } = useZktecoFingerprintEvents(5000, !isIeUser);
  const resolvedFingerprintDeviceSummary = useMemo(
    () => resolveFingerprintDeviceSummary(fingerprintDeviceSummary, zktecoFingerprintEvents),
    [fingerprintDeviceSummary, zktecoFingerprintEvents]
  );
  const faceEventSummary = useMemo(
    () => buildHikvisionFaceEventSummary(hikvisionFaceEvents, attendanceOverview.attendanceDate),
    [attendanceOverview.attendanceDate, hikvisionFaceEvents]
  );
  const latestAttendanceDateLabel = formatAttendanceDate(attendanceOverview.attendanceDate);
  const activeAlertDate = attendanceOverview.attendanceDate || currentAttendanceDateKey();
  const clockedInToday = attendanceOverview.presentWorkers + attendanceOverview.lateWorkers;
  const fingerprintDeviceCount =
    resolvedFingerprintDeviceSummary.totalDevicePins || clockedInToday;
  const fingerprintAttendedWorkers = useMemo(
    () => workers.filter(hasFingerprintAttendance),
    [workers]
  );
  const faceAttendedWorkers = useMemo(
    () => workers.filter(hasFaceAttendance),
    [workers]
  );
  const onLeaveWorkers = useMemo(
    () => workers.filter((worker) => worker.attendanceStatus === "On Leave"),
    [workers]
  );
  const biometricMismatchWorkers = useMemo(
    () =>
      workers.filter(
        (worker) => getFaceFingerprintMismatch(worker) !== "none"
      ),
    [workers]
  );
  const openAlerts = useMemo(
    () =>
      alerts.filter(
        (alert) =>
          alert.status !== "Resolved" &&
          isDateKeyInAttendanceDay(alert.createdAt, activeAlertDate)
      ),
    [activeAlertDate, alerts]
  );
  const openAlertWorkers = useMemo(() => {
    const workerIds = new Set(
      openAlerts
        .map((alert) => alert.workerId)
        .filter((workerId): workerId is string => Boolean(workerId))
    );
    return workers.filter((worker) => workerIds.has(worker.id));
  }, [openAlerts, workers]);
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
  const hrKpiDetails = useMemo<Record<HrKpiId, HrKpiDetail>>(
    () => ({
      "total-workforce": {
        title: "Total Workforce",
        subtitle: "All active workers in the current attendance roster.",
        workers,
      },
      "fingerprint-attended": {
        title: "Fingerprint Device Count",
        subtitle: "Registered workers with a verified fingerprint attendance signal.",
        workers: fingerprintAttendedWorkers,
      },
      "face-attended": {
        title: "Face Count",
        subtitle: "Workers with a verified face attendance signal.",
        workers: faceAttendedWorkers,
      },
      "on-leave": {
        title: "On Leave",
        subtitle: "Workers marked on leave in the current attendance snapshot.",
        workers: onLeaveWorkers,
      },
      "open-alerts": {
        title: "Workers with Open Alerts",
        subtitle: "Workers linked to today's unresolved attendance and operations alerts.",
        workers: openAlertWorkers,
      },
      "biometric-mismatch": {
        title: "Face / Fingerprint Mismatch",
        subtitle: "Workers detected by exactly one of the two biometric attendance channels.",
        workers: biometricMismatchWorkers,
      },
    }),
    [
      biometricMismatchWorkers,
      faceAttendedWorkers,
      fingerprintAttendedWorkers,
      onLeaveWorkers,
      openAlertWorkers,
      workers,
    ]
  );
  const selectedHrKpiDetail = selectedHrKpi ? hrKpiDetails[selectedHrKpi] : null;
  const closeHrKpiModal = useCallback(() => setSelectedHrKpi(null), []);

  if (isIeUser) {
    return <IeDashboardPage />;
  }

  return (
    <div className="ops-page">
      <PageHeader
        title="Attendance Dashboard"
        subtitle="Biometric operations overview with current headcount, department attendance, and line readiness."
        actions={
          <>
            {canAccess("productionLines") ? (
              <Link to="/production-lines" className="ops-button ops-button-secondary">
                Production Lines
              </Link>
            ) : null}
            {canAccess("reports") ? (
              <Link to="/reports" className="ops-button ops-button-primary">
                Open Reports
              </Link>
            ) : null}
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
          onClick={isHrUser ? () => setSelectedHrKpi("total-workforce") : undefined}
        />
        <KpiCard
          label="Fingerprint Device Count"
          value={`${fingerprintDeviceCount}/${attendanceOverview.totalWorkers}`}
          meta={`${resolvedFingerprintDeviceSummary.registeredDevicePins} registered, ${resolvedFingerprintDeviceSummary.unregisteredDevicePins} unregistered PINs.`}
          icon={Clock3}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
          onClick={isHrUser ? () => setSelectedHrKpi("fingerprint-attended") : undefined}
        />
        <KpiCard
          label="Face Count"
          value={`${faceAttendedWorkers.length}/${attendanceOverview.totalWorkers}`}
          meta={`${faceAttendedWorkers.length} matched workers, ${faceEventSummary.unmatchedEvents} unmatched face events.`}
          icon={ScanFace}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
          onClick={isHrUser ? () => setSelectedHrKpi("face-attended") : undefined}
        />
        <KpiCard
          label="On Leave"
          value={`${attendanceOverview.onLeaveWorkers}`}
          meta="Workers currently marked as leave from the fingerprint attendance source."
          icon={ShieldCheck}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
          onClick={isHrUser ? () => setSelectedHrKpi("on-leave") : undefined}
        />
        {isHrUser ? (
          <KpiCard
            label="Face / Fingerprint Mismatch"
            value={`${biometricMismatchWorkers.length}`}
            meta="Fingerprint-only and face-only attendance records that require review."
            icon={AlertTriangle}
            accent="var(--ops-danger)"
            soft="var(--ops-danger-soft)"
            onClick={() => setSelectedHrKpi("biometric-mismatch")}
          />
        ) : null}
        <KpiCard
          label="Open Alerts"
          value={`${openAlerts.length}`}
          meta={`${attendanceOverview.absentWorkers} workers are still not clocked in for today's attendance date.`}
          icon={AlertTriangle}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
          onClick={isHrUser ? () => setSelectedHrKpi("open-alerts") : undefined}
        />
      </section>

      <section className={`ops-grid${isHrUser ? "" : " cols-2"}`}>
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

        {!isHrUser ? (
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
        ) : null}
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
          subtitle="Today's open exceptions that still need follow-up from supervisors or HR."
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

      <DetailModal
        open={Boolean(selectedHrKpiDetail)}
        title={selectedHrKpiDetail?.title || "Worker Details"}
        subtitle={
          selectedHrKpiDetail
            ? `${selectedHrKpiDetail.subtitle} ${selectedHrKpiDetail.workers.length} worker(s) for ${latestAttendanceDateLabel}.`
            : undefined
        }
        onClose={closeHrKpiModal}
      >
        {selectedHrKpiDetail?.workers.length ? (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Department / Line</th>
                  <th>Attendance</th>
                  <th>Face</th>
                  <th>Fingerprint</th>
                  <th>Mismatch</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {selectedHrKpiDetail.workers.map((worker) => {
                  const line = findLine(lines, worker.currentLineId);
                  return (
                    <tr key={worker.id}>
                      <td>
                        <WorkerChip worker={worker} />
                      </td>
                      <td>
                        <div className="ops-row-title">{worker.department}</div>
                        <div className="ops-row-subtitle">{line?.name || "Unassigned"}</div>
                      </td>
                      <td>
                        <StatusBadge
                          label={worker.attendanceStatus}
                          tone={attendanceTone(worker.attendanceStatus)}
                        />
                      </td>
                      <td>
                        <StatusBadge
                          label={hasFaceAttendance(worker) ? "Attended" : "Not attended"}
                          tone={hasFaceAttendance(worker) ? "success" : "danger"}
                        />
                      </td>
                      <td>
                        <StatusBadge
                          label={hasFingerprintAttendance(worker) ? "Attended" : "Not attended"}
                          tone={hasFingerprintAttendance(worker) ? "success" : "danger"}
                        />
                      </td>
                      <td>{mismatchLabel(worker)}</td>
                      <td>
                        <Link to={`/workers/${worker.id}`} className="ops-link-button">
                          View Profile
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No workers in this category"
            description="The current attendance snapshot has no matching worker records."
          />
        )}
      </DetailModal>
    </div>
  );
}

export default DashboardPage;
