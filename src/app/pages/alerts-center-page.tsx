import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  currentAttendanceDateKey,
  isDateKeyInAttendanceDay,
} from "../alert-dates";
import { useOperations } from "../operations-context";
import type { AlertRecord, AlertState } from "../types";
import {
  AlertItem,
  Button,
  Card,
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  formatDateTime,
  priorityTone,
} from "../components/ops-ui";
import { AlertTriangle, BellDot, CheckCheck, ShieldAlert } from "lucide-react";

export function AlertsCenterPage() {
  const { currentUser, users } = useAuth();
  const { alerts, attendanceOverview, updateAlertStatus, assignAlert } = useOperations();
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [feedback, setFeedback] = useState<string | null>(null);
  const activeAlertDate = attendanceOverview.attendanceDate || currentAttendanceDateKey();

  const handleStatusChange = async (alertId: string, status: AlertState) => {
    const result = await updateAlertStatus({
      alertId,
      status,
      actor: currentUser.name,
    });
    setFeedback(result.message);
  };

  const handleAssign = async (alertId: string, assignedToUserId: string) => {
    const result = await assignAlert({
      alertId,
      assignedToUserId,
      actor: currentUser.name,
    });
    setFeedback(result.message);
  };

  const matchesActiveFilters = (alert: AlertRecord) => {
    const matchesPriority = priorityFilter === "All" || alert.priority === priorityFilter;
    const matchesStatus = statusFilter === "All" || alert.status === statusFilter;
    return matchesPriority && matchesStatus;
  };

  const todaysAlerts = alerts.filter((alert) =>
    isDateKeyInAttendanceDay(alert.createdAt, activeAlertDate)
  );
  const historyAlerts = alerts.filter(
    (alert) => !isDateKeyInAttendanceDay(alert.createdAt, activeAlertDate)
  );
  const sevenDayNoSignalAlerts = todaysAlerts.filter((alert) => alert.derived);
  const operationalAlerts = todaysAlerts.filter((alert) => !alert.derived);
  const filteredSevenDayNoSignalAlerts = sevenDayNoSignalAlerts.filter(matchesActiveFilters);
  const filteredOperationalAlerts = operationalAlerts.filter(matchesActiveFilters);
  const filteredHistoryAlerts = historyAlerts.filter(matchesActiveFilters);

  const counts = useMemo(
    () => ({
      critical: operationalAlerts.filter((item) => item.priority === "critical").length,
      high: operationalAlerts.filter((item) => item.priority === "high").length,
      open: operationalAlerts.filter((item) => item.status === "Open").length,
      resolved: operationalAlerts.filter((item) => item.status === "Resolved").length,
      sevenDayNoSignal: sevenDayNoSignalAlerts.length,
    }),
    [operationalAlerts, sevenDayNoSignalAlerts]
  );

  const renderAlertItem = (alert: AlertRecord) => (
    <AlertItem
      key={alert.id}
      priority={alert.priority}
      title={alert.title}
      description={alert.description}
      meta={
        <>
          <span>{formatDateTime(alert.createdAt)}</span>
          <span>{alert.type}</span>
          <span>{alert.status}</span>
          {alert.derived ? <span>system generated</span> : null}
        </>
      }
      actions={
        alert.derived ? (
          <StatusBadge label="System generated" tone="info" />
        ) : (
          <>
            {alert.status !== "Read" ? (
              <Button
                tone="secondary"
                onClick={() => void handleStatusChange(alert.id, "Read")}
              >
                Mark as read
              </Button>
            ) : null}
            {alert.status !== "Resolved" ? (
              <Button
                tone="primary"
                onClick={() => void handleStatusChange(alert.id, "Resolved")}
              >
                Resolve
              </Button>
            ) : null}
            <select
              className="ops-select"
              style={{ maxWidth: 220 }}
              value={alert.assignedToUserId || ""}
              onChange={(event) => void handleAssign(alert.id, event.target.value)}
            >
              <option value="" disabled>
                Assign to
              </option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </>
        )
      }
    />
  );

  return (
    <div className="ops-page">
      <PageHeader
        title="Alerts & Exceptions Center"
        subtitle={`Today's alert queue for ${activeAlertDate}. Past-day alerts are retained below as history.`}
        actions={
          <>
            <StatusBadge label={`${counts.open} open today`} tone="danger" />
            <StatusBadge label={`${historyAlerts.length} historical`} tone="info" />
          </>
        }
      />

      {feedback ? (
        <div className="ops-badge tone-info" style={{ alignSelf: "flex-start" }}>
          {feedback}
        </div>
      ) : null}

      <section className="ops-kpi-grid">
        <KpiCard
          label="Critical"
          value={`${counts.critical}`}
          meta="Manual operational alerts requiring attention today."
          icon={AlertTriangle}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
        <KpiCard
          label="High Priority"
          value={`${counts.high}`}
          meta="Monitor today's queue closely and clear inside this shift."
          icon={ShieldAlert}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Open Alerts"
          value={`${counts.open}`}
          meta="Today's active supervisor or HR workload."
          icon={BellDot}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Resolved"
          value={`${counts.resolved}`}
          meta="Today's closed alerts. Older records are in history."
          icon={CheckCheck}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="7-Day No Signal"
          value={`${counts.sevenDayNoSignal}`}
          meta="Today's generated seven-day no-signal alerts."
          icon={ShieldAlert}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
      </section>

      <div className="ops-filter-bar">
        <select className="ops-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
          <option value="All">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="ops-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="All">All statuses</option>
          <option value="Open">Open</option>
          <option value="Read">Read</option>
          <option value="Resolved">Resolved</option>
        </select>
      </div>

      <Card
        title="Seven-Day No Face/Fingerprint Alerts"
        subtitle="Today's system-generated employees with no face or fingerprint attendance for seven consecutive attendance days."
      >
        {filteredSevenDayNoSignalAlerts.length ? (
          <div className="ops-list">{filteredSevenDayNoSignalAlerts.map(renderAlertItem)}</div>
        ) : (
          <EmptyState
            title="No seven-day attendance gaps detected"
            description="Employees will appear here when they have no face or fingerprint signal for seven attendance days."
          />
        )}
      </Card>

      <Card
        title="Operational Alert Queue"
        subtitle="Today's manual supervisor and HR alerts with assignment, read state, and resolution workflow."
      >
        {filteredOperationalAlerts.length ? (
          <div className="ops-list">{filteredOperationalAlerts.map(renderAlertItem)}</div>
        ) : (
          <EmptyState
            title="No operational alerts matched the current filters"
            description="Change the priority or status filter to inspect another part of the alert queue."
          />
        )}
      </Card>

      <Card
        title="Past Alert History"
        subtitle="Alerts created before today's attendance date, retained for review and audit."
      >
        {filteredHistoryAlerts.length ? (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Priority</th>
                  <th>Latest action</th>
                  <th>Assigned</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistoryAlerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <div className="ops-row-title">{alert.title}</div>
                      <div className="ops-row-subtitle">{formatDateTime(alert.createdAt)}</div>
                    </td>
                    <td>
                      <StatusBadge label={alert.priority.toUpperCase()} tone={priorityTone(alert.priority)} />
                    </td>
                    <td>{alert.history[0]?.action || "No history"}</td>
                    <td>{alert.derived ? "System generated" : users.find((user) => user.id === alert.assignedToUserId)?.name || "Unassigned"}</td>
                    <td>{alert.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No historical alerts matched the current filters"
            description="Past-day alerts will appear here after the attendance date changes."
          />
        )}
      </Card>
    </div>
  );
}

export default AlertsCenterPage;
