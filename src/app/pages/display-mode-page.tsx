import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  currentAttendanceDateKey,
  isDateKeyInAttendanceDay,
} from "../alert-dates";
import { useOperations } from "../operations-context";
import { StatusBadge } from "../components/ops-ui";

export function DisplayModePage() {
  const { lines, alerts, workers, announcements, attendanceOverview } = useOperations();
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAnnouncementIndex((index) => (index + 1) % announcements.length);
      setNow(new Date());
    }, 6000);
    return () => window.clearInterval(timer);
  }, [announcements.length]);

  const missingWorkers = workers.filter((worker) => worker.attendanceStatus === "Absent").length;
  const activeAlertDate = attendanceOverview.attendanceDate || currentAttendanceDateKey();
  const openAlerts = alerts
    .filter(
      (alert) =>
        alert.status !== "Resolved" &&
        isDateKeyInAttendanceDay(alert.createdAt, activeAlertDate)
    )
    .slice(0, 4);
  const currentAnnouncement = announcements[announcementIndex];

  const lineCards = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        activeWorkers: workers.filter((worker) => worker.currentLineId === line.id).length,
      })),
    [lines, workers]
  );

  return (
    <div className="ops-display">
      <div className="ops-display-header">
        <div>
          <div className="ops-display-title">LineMatrix Public Display</div>
          <div className="ops-display-subtitle">
            Shift A · {now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} · {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <div className="ops-toolbar">
          <StatusBadge label={`${missingWorkers} missing workers`} tone={missingWorkers ? "danger" : "success"} />
          <Link to="/" className="ops-button ops-button-secondary">
            Back to Ops Centre
          </Link>
        </div>
      </div>

      <div className="ops-display-grid">
        <div className="ops-grid">
          <div className="ops-line-grid">
            {lineCards.map((line) => (
              <article key={line.id} className="ops-line-card" style={{ background: "rgba(255,255,255,0.95)" }}>
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{line.name}</div>
                    <div className="ops-row-subtitle">
                      {line.department} · {line.shift}
                    </div>
                  </div>
                  <StatusBadge
                    label={line.status}
                    tone={line.status === "Active" ? "success" : line.status === "Partial" ? "warning" : "neutral"}
                  />
                </div>
                <div className="ops-meta-grid" style={{ marginTop: 14 }}>
                  <div className="ops-key-value">
                    <div className="ops-key-value-label">Active workers</div>
                    <div className="ops-key-value-value">{line.activeWorkers}</div>
                  </div>
                  <div className="ops-key-value">
                    <div className="ops-key-value-label">Manpower</div>
                    <div className="ops-key-value-value">
                      {line.actualManpower}/{line.targetManpower}
                    </div>
                  </div>
                  <div className="ops-key-value">
                    <div className="ops-key-value-label">Efficiency</div>
                    <div className="ops-key-value-value">{line.efficiency}%</div>
                  </div>
                  <div className="ops-key-value">
                    <div className="ops-key-value-label">Output</div>
                    <div className="ops-key-value-value">{line.output}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="ops-grid">
          <div className="ops-announcement">
            <small>Announcement</small>
            <div style={{ fontSize: "1.1rem", lineHeight: 1.6 }}>{currentAnnouncement?.message}</div>
          </div>

          <section className="ops-card" style={{ background: "rgba(255,255,255,0.95)" }}>
            <div className="ops-card-body">
              <h2 className="ops-card-title">Alert Highlights</h2>
              <div className="ops-list" style={{ marginTop: 16 }}>
                {openAlerts.map((alert) => (
                  <div key={alert.id} className="ops-alert-item">
                    <div className="ops-item-header">
                      <div className="ops-item-title">{alert.title}</div>
                      <StatusBadge label={alert.priority.toUpperCase()} tone={alert.priority === "critical" ? "danger" : "warning"} />
                    </div>
                    <div className="ops-item-description">{alert.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default DisplayModePage;
