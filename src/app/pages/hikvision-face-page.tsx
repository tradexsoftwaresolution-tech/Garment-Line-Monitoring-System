import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Play,
  RefreshCw,
  Square,
  UserCheck,
  UserX,
  Wifi,
} from "lucide-react";
import { isBackendConfigured } from "@/lib/backend/env";
import {
  configureHikvisionFromBackend,
  getHikvisionEventsFromBackend,
  pollHikvisionNowFromBackend,
  startHikvisionPollingFromBackend,
  stopHikvisionPollingFromBackend,
  testHikvisionConnectionFromBackend,
} from "@/lib/backend/pipeline-api";
import type { HikvisionCameraEndpoint, HikvisionRecognitionEvent, HikvisionStatus } from "@/types/hikvision";
import { useAuth } from "../auth";
import { Button, Card, EmptyState, KpiCard, PageHeader, StatusBadge, cx, formatDateTime } from "../components/ops-ui";

const EMPTY_STATUS: HikvisionStatus = {
  configured: false,
  running: false,
  pollIntervalSeconds: 3,
  lookbackMinutes: 60,
  eventCount: 0,
  matchedEventCount: 0,
  cameraCount: 0,
  onlineCameraCount: 0,
  cameras: [],
};

export function HikvisionFacePage() {
  const backendConfigured = isBackendConfigured();
  const { canDo } = useAuth();
  const canManageCamera = canDo("assignLine");
  const [status, setStatus] = useState<HikvisionStatus>(EMPTY_STATUS);
  const [events, setEvents] = useState<HikvisionRecognitionEvent[]>([]);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(3);
  const [lookbackMinutes, setLookbackMinutes] = useState(60);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!backendConfigured) {
      return;
    }

    const response = await getHikvisionEventsFromBackend(80);
    setStatus(response.status);
    setEvents(response.events);
    if (response.status.username) setUsername(response.status.username);
    setPollIntervalSeconds(response.status.pollIntervalSeconds || 3);
    setLookbackMinutes(response.status.lookbackMinutes || 60);
  }, [backendConfigured]);

  useEffect(() => {
    void load().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    });
  }, [load]);

  useEffect(() => {
    if (!backendConfigured) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void load().catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    }, Math.max(5000, status.pollIntervalSeconds * 1000));

    return () => window.clearInterval(timer);
  }, [backendConfigured, load, status.pollIntervalSeconds]);

  const latestEvent = events[0];
  const unmatchedCount = useMemo(
    () => events.filter((event) => event.matchStatus !== "matched").length,
    [events]
  );

  async function runAction(label: string, action: () => Promise<HikvisionStatus | { status: HikvisionStatus; events: HikvisionRecognitionEvent[] }>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if ("events" in result) {
        setStatus(result.status);
        setEvents(result.events);
      } else {
        setStatus(result);
      }
      setMessage(label);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  function handleConfigure() {
    void runAction("Camera connection saved and tested.", () =>
      configureHikvisionFromBackend({
        username,
        password: password || undefined,
        pollIntervalSeconds,
        lookbackMinutes,
      })
    );
  }

  function handleTest() {
    void runAction("Camera connection test completed.", testHikvisionConnectionFromBackend);
  }

  function handleStart() {
    void runAction("Live polling started.", startHikvisionPollingFromBackend);
  }

  function handleStop() {
    void runAction("Live polling stopped.", stopHikvisionPollingFromBackend);
  }

  function handlePollNow() {
    void runAction("Latest camera events fetched.", pollHikvisionNowFromBackend);
  }

  return (
    <div className="ops-page">
      <PageHeader
        title="Hikvision Face Recognition"
        subtitle="Live ISAPI recognition feed from 7 Hikvision face terminals. Matched employees are marked into face attendance for monitoring."
        actions={
          <div className="ops-toolbar">
            <Button tone="secondary" onClick={() => void load()} disabled={!backendConfigured || busy}>
              <RefreshCw size={16} /> Refresh
            </Button>
            <Button tone="primary" onClick={handlePollNow} disabled={!backendConfigured || busy || !status.configured}>
              <Camera size={16} /> Poll Now
            </Button>
          </div>
        }
      />

      {!backendConfigured ? (
        <Card>
          <EmptyState
            title="Backend URL is not configured"
            description="Set VITE_BACKEND_URL to the Spring backend URL so the browser can call the Hikvision ISAPI bridge."
          />
        </Card>
      ) : null}

      {error ? <div className="ops-alert-item priority-critical">{error}</div> : null}
      {message ? <div className="ops-alert-item priority-medium">{message}</div> : null}

      <section className="ops-kpi-grid">
        <KpiCard
          label="Camera Feeds"
          value={`${status.onlineCameraCount || 0}/${status.cameraCount || status.cameras?.length || 0}`}
          meta="Online cameras across the configured feed group"
          icon={Wifi}
          accent="#0a84ff"
          soft="rgba(10, 132, 255, 0.14)"
        />
        <KpiCard
          label="Live Polling"
          value={status.running ? "Running" : "Stopped"}
          meta={status.lastSuccessAt ? `Last success ${formatDateTime(status.lastSuccessAt)}` : "Waiting for sync"}
          icon={status.running ? Play : Square}
          accent={status.running ? "#20a464" : "#64748b"}
          soft={status.running ? "rgba(52, 199, 89, 0.16)" : "rgba(100, 116, 139, 0.14)"}
        />
        <KpiCard
          label="Face Attendance"
          value={String(status.matchedEventCount)}
          meta="Matched events projected into employee face attendance"
          icon={UserCheck}
          accent="#20a464"
          soft="rgba(52, 199, 89, 0.16)"
        />
        <KpiCard
          label="Unmatched Events"
          value={String(unmatchedCount)}
          meta="Camera employee No. not found in employee table"
          icon={UserX}
          accent="#d92d20"
          soft="rgba(255, 59, 48, 0.14)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card title="Camera Network" subtitle="Shared Digest-authenticated ISAPI credentials used for all seeded camera feeds.">
          <div className="ops-grid cols-2">
            <label className="ops-filter-group">
              <span className="ops-filter-label">Username</span>
              <input
                className="ops-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin"
                disabled={!canManageCamera}
              />
            </label>
            <label className="ops-filter-group">
              <span className="ops-filter-label">Password</span>
              <input
                className="ops-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={status.configured ? "Leave blank to keep current password" : "Camera password"}
                type="password"
                disabled={!canManageCamera}
              />
            </label>
            <div className="ops-grid cols-2">
              <label className="ops-filter-group">
                <span className="ops-filter-label">Poll Seconds</span>
                <input
                  className="ops-input"
                  type="number"
                  min={1}
                  max={60}
                  value={pollIntervalSeconds}
                  onChange={(event) => setPollIntervalSeconds(Number(event.target.value))}
                  disabled={!canManageCamera}
                />
              </label>
              <label className="ops-filter-group">
                <span className="ops-filter-label">Lookback Minutes</span>
                <input
                  className="ops-input"
                  type="number"
                  min={1}
                  max={1440}
                  value={lookbackMinutes}
                  onChange={(event) => setLookbackMinutes(Number(event.target.value))}
                  disabled={!canManageCamera}
                />
              </label>
            </div>
          </div>

          <div className="ops-item-actions">
            <Button tone="primary" onClick={handleConfigure} disabled={!canManageCamera || busy}>
              <CheckCircle2 size={16} /> Save & Test
            </Button>
            <Button tone="secondary" onClick={handleTest} disabled={!canManageCamera || busy || !status.configured}>
              Test Connection
            </Button>
            {status.running ? (
              <Button tone="danger" onClick={handleStop} disabled={!canManageCamera || busy}>
                <Square size={16} /> Stop
              </Button>
            ) : (
              <Button tone="primary" onClick={handleStart} disabled={!canManageCamera || busy || !status.configured}>
                <Play size={16} /> Start Live
              </Button>
            )}
          </div>

          <CameraEndpointList cameras={status.cameras || []} />
        </Card>

        <Card title="Camera Snapshots" subtitle="Latest deviceInfo and poll state captured from each camera.">
          <CameraSnapshotTable cameras={status.cameras || []} globalLastError={status.lastError || null} />
        </Card>
      </section>

      <Card
        title="Live Recognition Feed"
        subtitle="Newest camera recognition events. Matched rows update each employee's face attendance record for the day."
        actions={
          latestEvent ? (
            <StatusBadge
              label={`Latest ${formatDateTime(latestEvent.eventTime)}`}
              tone={latestEvent.matchStatus === "matched" ? "success" : "warning"}
            />
          ) : null
        }
      >
        {events.length ? (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Employee</th>
                  <th>Camera</th>
                  <th>Match</th>
                  <th>Verify Mode</th>
                  <th>Attendance</th>
                  <th>Temperature</th>
                  <th>Serial</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.eventTime)}</td>
                    <td>
                      <div className="ops-worker-inline">
                        <span className="ops-avatar ops-avatar-placeholder">
                          {initials(event.matchedEmployeeName || event.devicePersonName || event.employeeNo || "NA")}
                        </span>
                        <div>
                          <div className="ops-row-title">
                            {event.matchedEmployeeName || event.employeeNo || "Unknown employee"}
                          </div>
                          <div className="ops-row-subtitle">
                            {event.employeeNo || "No employee No."}
                            {event.matchedDepartment ? ` · ${event.matchedDepartment}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ops-row-title">{event.cameraName || "Unknown camera"}</div>
                      <div className="ops-row-subtitle">{event.cameraLocation || event.cameraBaseUrl || "No location"}</div>
                    </td>
                    <td>
                      <StatusBadge
                        label={event.matchStatus === "matched" ? "Matched" : "Unmatched"}
                        tone={event.matchStatus === "matched" ? "success" : "warning"}
                      />
                    </td>
                    <td>{event.verifyMode || "Not returned"}</td>
                    <td>{event.attendanceStatus || "Not returned"}</td>
                    <td>{event.temperature == null ? "Not returned" : `${event.temperature.toFixed(1)} C`}</td>
                    <td className="ops-monospace">{event.serialNo || event.id.replace("hikvision-", "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No recognition events yet"
            description="Start live polling or run a manual poll after the camera is connected on the same network."
          />
        )}
      </Card>
    </div>
  );
}

function CameraEndpointList({ cameras }: { cameras: HikvisionCameraEndpoint[] }) {
  if (!cameras.length) {
    return (
      <EmptyState
        title="No seeded camera feeds loaded"
        description="Restart the backend after updating the Hikvision camera configuration."
      />
    );
  }

  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>Feed</th>
            <th>Location</th>
            <th>IP</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {cameras.map((camera) => (
            <tr key={camera.id}>
              <td>
                <div className="ops-row-title">{camera.name}</div>
                <div className="ops-row-subtitle">{camera.id}</div>
              </td>
              <td>{camera.location}</td>
              <td className="ops-monospace">{camera.baseUrl}</td>
              <td>
                <StatusBadge
                  label={camera.lastSuccessAt && !camera.lastError ? "Online" : camera.lastError ? "Error" : "Pending"}
                  tone={camera.lastSuccessAt && !camera.lastError ? "success" : camera.lastError ? "danger" : "neutral"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CameraSnapshotTable({
  cameras,
  globalLastError,
}: {
  cameras: HikvisionCameraEndpoint[];
  globalLastError: string | null;
}) {
  if (!cameras.length) {
    return (
      <div className="ops-meta-grid">
        <Metric label="Device" value="Not captured" />
        <Metric label="Model" value="Not captured" />
        <Metric label="Last Error" value={globalLastError || "None"} tone={globalLastError ? "danger" : "success"} />
      </div>
    );
  }

  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>Camera</th>
            <th>Device</th>
            <th>Model</th>
            <th>Last Poll</th>
            <th>Last Error</th>
          </tr>
        </thead>
        <tbody>
          {cameras.map((camera) => (
            <tr key={camera.id}>
              <td>
                <div className="ops-row-title">{camera.name}</div>
                <div className="ops-row-subtitle">{camera.location}</div>
              </td>
              <td>{camera.deviceInfo?.deviceName || "Not captured"}</td>
              <td>{camera.deviceInfo?.model || "Not captured"}</td>
              <td>{camera.lastPollAt ? formatDateTime(camera.lastPollAt) : "Not started"}</td>
              <td>{camera.lastError || "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className={cx("ops-key-value", tone === "danger" && "ops-key-value-danger")}>
      <div className="ops-key-value-label">{label}</div>
      <div className="ops-key-value-value">{value}</div>
    </div>
  );
}

function initials(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
