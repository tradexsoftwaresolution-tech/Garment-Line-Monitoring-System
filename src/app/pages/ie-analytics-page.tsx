import { useMemo } from "react";
import { Link } from "react-router";
import { BarChart3, PieChart as PieChartIcon, TrendingUp, Users } from "lucide-react";
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
import { useOperations } from "../operations-context";
import { buildHikvisionFaceEventSummary } from "../face-event-counts";
import { resolveFingerprintDeviceSummary } from "../fingerprint-device-counts";
import { useHikvisionFaceEvents } from "../hooks/use-hikvision-face-events";
import { useZktecoFingerprintEvents } from "../hooks/use-zkteco-fingerprint-events";
import { Card, KpiCard, PageHeader } from "../components/ops-ui";

const COLORS = {
  present: "#16a34a",
  late: "#d97706",
  leave: "#2563eb",
  absent: "#dc2626",
  face: "#7c3aed",
  fingerprint: "#0f766e",
  total: "#94a3b8",
};

export function IeAnalyticsPage() {
  const { attendanceOverview, departmentAttendance, lines, workers, reportSeries, fingerprintDeviceSummary } =
    useOperations();
  const { events: hikvisionFaceEvents } = useHikvisionFaceEvents(500);
  const { events: zktecoFingerprintEvents } = useZktecoFingerprintEvents(5000);

  const statusData = useMemo(
    () => [
      { name: "Present", value: attendanceOverview.presentWorkers, fill: COLORS.present },
      { name: "Late", value: attendanceOverview.lateWorkers, fill: COLORS.late },
      { name: "On Leave", value: attendanceOverview.onLeaveWorkers, fill: COLORS.leave },
      { name: "Absent", value: attendanceOverview.absentWorkers, fill: COLORS.absent },
    ],
    [attendanceOverview]
  );

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
  const faceEventSummary = useMemo(
    () => buildHikvisionFaceEventSummary(hikvisionFaceEvents, attendanceOverview.attendanceDate),
    [attendanceOverview.attendanceDate, hikvisionFaceEvents]
  );
  const unmatchedFaceCount = faceEventSummary.unmatchedEvents;

  const verificationData = useMemo(
    () => [
      {
        label: "Fingerprint",
        attended: registeredFingerprintAttended,
        unmatched: unmatchedFingerprintCount,
        missing: workers.filter((worker) => worker.fingerprintVerificationStatus !== "Verified").length,
      },
      {
        label: "Face",
        attended: workers.filter((worker) => worker.faceVerificationStatus === "Verified").length,
        unmatched: unmatchedFaceCount,
        missing: workers.filter((worker) => worker.faceVerificationStatus !== "Verified").length,
      },
    ],
    [registeredFingerprintAttended, unmatchedFaceCount, unmatchedFingerprintCount, workers]
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

  const averageLineAttendance =
    lines.length === 0
      ? 0
      : Math.round(lines.reduce((sum, line) => sum + line.attendanceRate, 0) / lines.length);
  const bestLine = [...lines].sort((a, b) => b.attendanceRate - a.attendanceRate)[0];
  const lowestLine = [...lines].sort((a, b) => a.attendanceRate - b.attendanceRate)[0];

  return (
    <div className="ops-page">
      <PageHeader
        title="IE Analytics"
        subtitle="Attendance analytics for line balancing, department visibility, and verification coverage."
        actions={
          <>
            <Link to="/" className="ops-button ops-button-secondary">
              IE Dashboard
            </Link>
            <Link to="/ie-line-attendance" className="ops-button ops-button-primary">
              Line Attendance
            </Link>
          </>
        }
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Average Line Attendance"
          value={`${averageLineAttendance}%`}
          meta="Average attendance percentage across active lines."
          icon={TrendingUp}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Best Line"
          value={bestLine ? `${bestLine.attendanceRate}%` : "0%"}
          meta={bestLine ? `${bestLine.name} has the strongest attendance.` : "No line data available."}
          icon={BarChart3}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Lowest Line"
          value={lowestLine ? `${lowestLine.attendanceRate}%` : "0%"}
          meta={lowestLine ? `${lowestLine.name} needs the most attention.` : "No line data available."}
          icon={PieChartIcon}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
        <KpiCard
          label="Total Workforce"
          value={`${attendanceOverview.totalWorkers}`}
          meta="Active employees included in the analytics view."
          icon={Users}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card title="Attendance Status Mix" subtitle="Present, late, leave, and absent distribution.">
          <div style={{ width: "100%", height: 300 }}>
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
          <div style={{ width: "100%", height: 300 }}>
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
          <div style={{ width: "100%", height: 320 }}>
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
          <div style={{ width: "100%", height: 320 }}>
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
  );
}

export default IeAnalyticsPage;
