import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Fingerprint,
  RefreshCw,
  Server,
  UserCheck,
  UserX,
  Wifi,
} from "lucide-react";
import { backendEnv, isBackendConfigured } from "@/lib/backend/env";
import {
  getZktecoEventsFromBackend,
  getZktecoStatusFromBackend,
} from "@/lib/backend/pipeline-api";
import type { ZktecoDevice, ZktecoFingerprintEvent, ZktecoStatus } from "@/types/zkteco";
import { Button, Card, EmptyState, KpiCard, PageHeader, StatusBadge, formatDateTime } from "../components/ops-ui";

const EXPECTED_TERMINAL_COUNT = 5;
const EXPECTED_TERMINAL_IPS = ["10.10.4.40", "10.10.4.41", "10.10.4.42", "10.10.4.43", "10.10.4.46"];

const EMPTY_STATUS: ZktecoStatus = {
  devices: [],
  deviceCount: 0,
  serverTime: "",
  mode: "adms_push",
};

export function ZktecoFingerprintPage() {
  const backendConfigured = isBackendConfigured();
  const [status, setStatus] = useState<ZktecoStatus>(EMPTY_STATUS);
  const [events, setEvents] = useState<ZktecoFingerprintEvent[]>([]);
  const [receiverOk, setReceiverOk] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!backendConfigured) {
      return;
    }

    const [nextStatus, nextEvents] = await Promise.all([
      getZktecoStatusFromBackend(),
      getZktecoEventsFromBackend(100),
    ]);
    setStatus(nextStatus);
    setEvents(nextEvents);
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
    }, 10000);

    return () => window.clearInterval(timer);
  }, [backendConfigured, load]);

  const onlineDevices = useMemo(
    () => status.devices.filter((device) => deviceHealth(device).state === "online").length,
    [status.devices]
  );
  const devicesByIp = useMemo(() => {
    const map = new Map<string, ZktecoDevice>();
    status.devices.forEach((device) => {
      if (device.last_ip) {
        map.set(device.last_ip, device);
      }
    });
    return map;
  }, [status.devices]);
  const matchedEvents = useMemo(
    () => events.filter((event) => event.match_status === "matched").length,
    [events]
  );
  const unmatchedEvents = events.length - matchedEvents;
  const latestEvent = events[0];

  async function refresh() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await load();
      setMessage("ZKTeco device status refreshed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function testReceiver() {
    if (!backendConfigured) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setReceiverOk(null);
    try {
      const response = await fetch(`${backendEnv.url}/iclock/ping`);
      if (!response.ok) {
        throw new Error(response.statusText || "ADMS receiver did not respond.");
      }
      setReceiverOk(true);
      setMessage("ADMS receiver is reachable. Configure the devices to push to this backend.");
    } catch (nextError) {
      setReceiverOk(false);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-page">
      <PageHeader
        title="ZKTeco Fingerprint"
        subtitle="ADMS push receiver health, K1000 check-ins, and latest fingerprint punch logs from the factory work-area terminals."
        actions={
          <div className="ops-toolbar">
            <Button tone="secondary" onClick={() => void refresh()} disabled={!backendConfigured || busy}>
              <RefreshCw size={16} /> Refresh
            </Button>
            <Button tone="primary" onClick={() => void testReceiver()} disabled={!backendConfigured || busy}>
              <Server size={16} /> Test Receiver
            </Button>
          </div>
        }
      />

      {!backendConfigured ? (
        <Card>
          <EmptyState
            title="Backend URL is not configured"
            description="Set VITE_BACKEND_URL so the browser can call the Spring backend and ADMS receiver."
          />
        </Card>
      ) : null}

      {error ? <div className="ops-alert-item priority-critical">{error}</div> : null}
      {message ? <div className="ops-alert-item priority-medium">{message}</div> : null}

      <section className="ops-kpi-grid">
        <KpiCard
          label="ADMS Receiver"
          value={receiverOk === false ? "Failed" : receiverOk ? "Reachable" : "Ready"}
          meta={backendConfigured ? `${backendEnv.url}/iclock` : "Backend URL missing"}
          icon={Server}
          accent={receiverOk === false ? "#d92d20" : "#0a84ff"}
          soft={receiverOk === false ? "rgba(255, 59, 48, 0.14)" : "rgba(10, 132, 255, 0.14)"}
        />
        <KpiCard
          label="Machines Seen"
          value={`${status.deviceCount || status.devices.length}/${EXPECTED_TERMINAL_COUNT}`}
          meta="Devices that contacted the ADMS receiver"
          icon={Wifi}
          accent="#20a464"
          soft="rgba(52, 199, 89, 0.16)"
        />
        <KpiCard
          label="Online Now"
          value={String(onlineDevices)}
          meta="Last check-in received within 5 minutes"
          icon={Activity}
          accent="#0f766e"
          soft="rgba(15, 118, 110, 0.14)"
        />
        <KpiCard
          label="Matched Punches"
          value={String(matchedEvents)}
          meta="Latest events matched to employees"
          icon={UserCheck}
          accent="#20a464"
          soft="rgba(52, 199, 89, 0.16)"
        />
        <KpiCard
          label="Unmatched PINs"
          value={String(unmatchedEvents)}
          meta="Device PIN not found as employee code or EPF"
          icon={UserX}
          accent="#d92d20"
          soft="rgba(255, 59, 48, 0.14)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Expected Terminals"
          subtitle="These private LAN IPs cannot be tested directly from Render. A terminal is working when it appears in Detected Devices after ADMS is configured."
        >
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Configured LAN IP</th>
                  <th>Push Test</th>
                  <th>How to Verify</th>
                </tr>
              </thead>
              <tbody>
                {EXPECTED_TERMINAL_IPS.map((ip) => {
                  const device = devicesByIp.get(ip);
                  const health = device ? deviceHealth(device) : null;

                  return (
                    <tr key={ip}>
                      <td className="ops-monospace">{ip}</td>
                      <td>
                        <StatusBadge
                          label={health ? health.label : "Waiting for ADMS"}
                          tone={health ? health.tone : "neutral"}
                        />
                      </td>
                      <td>
                        {device
                          ? `Last seen ${formatDateTime(device.last_seen_at || undefined)}`
                          : "Set Cloud Server / ADMS to this backend and make one fingerprint punch."}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Detected Devices"
          subtitle="Devices that have reached /iclock through ADMS push mode."
          actions={
            status.serverTime ? (
              <StatusBadge label={`Server ${formatDateTime(status.serverTime)}`} tone="info" />
            ) : null
          }
        >
          {status.devices.length ? (
            <DeviceTable devices={status.devices} />
          ) : (
            <EmptyState
              title="No ZKTeco devices have checked in yet"
              description="Open Cloud Server / ADMS on each K1000 device and point it to the Render backend."
            />
          )}
        </Card>
      </section>

      <Card
        title="Latest Fingerprint Punches"
        subtitle="Newest ATTLOG rows received from ZKTeco push devices. Matched rows update daily attendance reconciliation."
        actions={
          latestEvent ? (
            <StatusBadge
              label={`Latest ${formatDateTime(latestEvent.event_time)}`}
              tone={latestEvent.match_status === "matched" ? "success" : "warning"}
            />
          ) : null
        }
      >
        {events.length ? (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Punch Time</th>
                  <th>Employee</th>
                  <th>Device</th>
                  <th>Match</th>
                  <th>Verify</th>
                  <th>In/Out</th>
                  <th>Received</th>
                  <th>Raw</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.event_uid}>
                    <td>{formatDateTime(event.event_time)}</td>
                    <td>
                      <div className="ops-worker-inline">
                        <span className="ops-avatar ops-avatar-placeholder">
                          {initials(event.matched_employee_name || event.employee_code || event.employee_pin)}
                        </span>
                        <div>
                          <div className="ops-row-title">
                            {event.matched_employee_name || event.employee_code || "Unknown employee"}
                          </div>
                          <div className="ops-row-subtitle">
                            PIN {event.employee_pin}
                            {event.matched_department ? ` · ${event.matched_department}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ops-row-title">{event.device_serial_no || "Unknown serial"}</div>
                      <div className="ops-row-subtitle">{event.device_ip || "No IP captured"}</div>
                    </td>
                    <td>
                      <StatusBadge
                        label={event.match_status === "matched" ? "Matched" : "Unmatched"}
                        tone={event.match_status === "matched" ? "success" : "warning"}
                      />
                    </td>
                    <td>{event.verify_mode || "Not returned"}</td>
                    <td>{event.in_out_mode || "Not returned"}</td>
                    <td>{formatDateTime(event.received_at)}</td>
                    <td className="ops-monospace">{event.raw_line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No fingerprint punches received yet"
            description="After ADMS is configured, make one test punch on each K1000 and refresh this page."
          />
        )}
      </Card>
    </div>
  );
}

function DeviceTable({ devices }: { devices: ZktecoDevice[] }) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Serial</th>
            <th>Last IP</th>
            <th>Last Seen</th>
            <th>Last Punch</th>
            <th>Status</th>
            <th>Last Table</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => {
            const health = deviceHealth(device);
            return (
              <tr key={device.serial_no}>
                <td>
                  <div className="ops-row-title">{device.device_name || device.serial_no}</div>
                  <div className="ops-row-subtitle">{device.location || "No location set"}</div>
                </td>
                <td className="ops-monospace">{device.serial_no}</td>
                <td className="ops-monospace">{device.last_ip || "Not captured"}</td>
                <td>{formatDateTime(device.last_seen_at || undefined)}</td>
                <td>{formatDateTime(device.last_event_at || undefined)}</td>
                <td>
                  <StatusBadge label={health.label} tone={health.tone} />
                </td>
                <td>{device.last_push_table || "Not captured"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function deviceHealth(device: ZktecoDevice): {
  state: "online" | "stale" | "waiting";
  label: string;
  tone: "success" | "warning" | "neutral";
} {
  if (!device.last_seen_at) {
    return { state: "waiting", label: "Waiting", tone: "neutral" };
  }

  const seenAt = new Date(device.last_seen_at).getTime();
  const ageMinutes = (Date.now() - seenAt) / 60000;
  if (ageMinutes <= 5) {
    return { state: "online", label: "Online", tone: "success" };
  }
  if (ageMinutes <= 60) {
    return { state: "stale", label: "Stale", tone: "warning" };
  }
  return { state: "waiting", label: "Offline", tone: "neutral" };
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
