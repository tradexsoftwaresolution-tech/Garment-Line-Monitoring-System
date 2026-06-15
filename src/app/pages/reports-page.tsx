import { useMemo, useState } from "react";
import { Clock3, FileSpreadsheet, Fingerprint, HandCoins, Printer, ScanFace, UserX } from "lucide-react";
import {
  ATTENDANCE_REPORT_FILTERS,
  type AttendanceReportFilter,
  buildAttendanceReportRows,
  filterWorkersForAttendanceReport,
  findAttendanceReportFilter,
  hasFaceAttendance,
  hasFingerprintAttendance,
} from "../attendance-reporting";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { findLine, useOperations } from "../operations-context";
import {
  Button,
  Card,
  ExportActions,
  KpiCard,
  PageHeader,
  StatusBadge,
  WorkerChip,
  attendanceTone,
  downloadCsv,
  formatCurrency,
} from "../components/ops-ui";

export function ReportsPage() {
  const {
    attendanceOverview,
    departmentAttendance,
    reportSeries,
    attendanceSummaries,
    alerts,
    transferLogs,
    workers,
    lines,
  } = useOperations();
  const [attendanceReportFilter, setAttendanceReportFilter] =
    useState<AttendanceReportFilter>("late");

  const totalPayout = attendanceSummaries.reduce((sum, item) => sum + item.finalTotal, 0);
  const totalIncentive = attendanceSummaries.reduce((sum, item) => sum + item.incentive, 0);
  const openAlerts = alerts.filter((item) => item.status !== "Resolved").length;
  const totalTransfers = transferLogs.length;
  const faceAttendedWorkers = workers.filter((worker) => hasFaceAttendance(worker));
  const fingerprintAttendedWorkers = workers.filter((worker) => hasFingerprintAttendance(worker));
  const lateWorkers = workers.filter((worker) => worker.attendanceStatus === "Late");
  const absentWorkers = workers.filter((worker) => worker.attendanceStatus === "Absent");
  const faceMissingWorkers = workers.filter((worker) => !hasFaceAttendance(worker));
  const fingerprintMissingWorkers = workers.filter((worker) => !hasFingerprintAttendance(worker));
  const bothMissingWorkers = workers.filter(
    (worker) => !hasFaceAttendance(worker) && !hasFingerprintAttendance(worker)
  );
  const selectedAttendanceReport = findAttendanceReportFilter(attendanceReportFilter);
  const selectedReportWorkers = useMemo(
    () => filterWorkersForAttendanceReport(workers, attendanceReportFilter),
    [attendanceReportFilter, workers]
  );
  const selectedReportRows = useMemo(
    () => buildAttendanceReportRows(selectedReportWorkers, lines),
    [lines, selectedReportWorkers]
  );
  const reportCounts = useMemo(
    () =>
      Object.fromEntries(
        ATTENDANCE_REPORT_FILTERS.map((filter) => [
          filter.value,
          filterWorkersForAttendanceReport(workers, filter.value).length,
        ])
      ) as Record<AttendanceReportFilter, number>,
    [workers]
  );

  const exportRows = useMemo(
    () => [
      ["Report", "Metric", "Value"],
      ["Attendance", "Clocked in today", `${attendanceOverview.presentWorkers + attendanceOverview.lateWorkers}`],
      ["Attendance", "Absent today", `${attendanceOverview.absentWorkers}`],
      ["Attendance", "On leave today", `${attendanceOverview.onLeaveWorkers}`],
      ["Payroll", "Estimated payout", formatCurrency(totalPayout)],
      ["Payroll", "Estimated incentive pool", formatCurrency(totalIncentive)],
      ["Alerts", "Open alerts", `${openAlerts}`],
      ["Transfers", "Transfer logs", `${totalTransfers}`],
      ...departmentAttendance.map((department) => [
        "Department Attendance",
        department.department,
        `${department.presentWorkers + department.lateWorkers}/${department.totalWorkers}`,
      ]),
    ],
    [
      attendanceOverview.absentWorkers,
      attendanceOverview.lateWorkers,
      attendanceOverview.onLeaveWorkers,
      attendanceOverview.presentWorkers,
      departmentAttendance,
      openAlerts,
      totalIncentive,
      totalPayout,
      totalTransfers,
    ]
  );

  return (
    <div className="ops-page">
      <PageHeader
        title="Reports"
        subtitle="Attendance-led reports built from fingerprint attendance, line assignments, alerts, and audit-friendly operational data."
        actions={
          <>
            <button className="ops-button ops-button-secondary">
              <FileSpreadsheet size={15} />
              Excel-ready
            </button>
            <ExportActions
              onExportCsv={() => downloadCsv("operations-reports.csv", exportRows)}
              onPrint={() => window.print()}
            />
          </>
        }
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Clocked In Today"
          value={`${attendanceOverview.presentWorkers + attendanceOverview.lateWorkers}/${attendanceOverview.totalWorkers}`}
          meta="Latest attendance snapshot built from fingerprint attendance data."
          icon={Printer}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Monthly Incentive"
          value={formatCurrency(totalIncentive)}
          meta="Current monthly incentive calculation across eligible attendance records."
          icon={HandCoins}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Open Alerts"
          value={`${openAlerts}`}
          meta="Operational alerts still open across attendance, lines, and exception handling."
          icon={Printer}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
        <KpiCard
          label="Transfers Logged"
          value={`${totalTransfers}`}
          meta="Line transfer records currently available in the operations database."
          icon={FileSpreadsheet}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Attendance Exception Reports"
          subtitle="Generate HR reports for face-attended, fingerprint-attended, late, absent, not-attended, and missing-both employees."
          actions={
            <Button
              tone="secondary"
              onClick={() =>
                downloadCsv(selectedAttendanceReport.filename, selectedReportRows)
              }
            >
              <FileSpreadsheet size={15} />
              Download Selected
            </Button>
          }
        >
          <div className="ops-grid cols-2">
            <KpiCard
              label="Face Attended"
              value={`${faceAttendedWorkers.length}`}
              meta="Workers with verified face attendance."
              icon={ScanFace}
              accent="var(--ops-success)"
              soft="var(--ops-success-soft)"
            />
            <KpiCard
              label="Fingerprint Attended"
              value={`${fingerprintAttendedWorkers.length}`}
              meta="Workers with verified fingerprint attendance."
              icon={Fingerprint}
              accent="var(--ops-primary)"
              soft="var(--ops-primary-soft)"
            />
            <KpiCard
              label="Late Employees"
              value={`${lateWorkers.length}`}
              meta="Current workers marked late."
              icon={Clock3}
              accent="var(--ops-warning)"
              soft="var(--ops-warning-soft)"
            />
            <KpiCard
              label="Absent Employees"
              value={`${absentWorkers.length}`}
              meta="Current workers marked absent."
              icon={UserX}
              accent="var(--ops-danger)"
              soft="var(--ops-danger-soft)"
            />
            <KpiCard
              label="Face Not Attended"
              value={`${faceMissingWorkers.length}`}
              meta="No verified face event for the worker."
              icon={ScanFace}
              accent="var(--ops-violet)"
              soft="var(--ops-violet-soft)"
            />
            <KpiCard
              label="Fingerprint Not Attended"
              value={`${fingerprintMissingWorkers.length}`}
              meta={`${bothMissingWorkers.length} workers are missing both channels.`}
              icon={Fingerprint}
              accent="var(--ops-primary)"
              soft="var(--ops-primary-soft)"
            />
          </div>

          <div className="ops-filter-bar" style={{ marginTop: 16 }}>
            <label className="ops-filter-group" style={{ flex: "1 1 280px" }}>
              <span className="ops-filter-label">Report type</span>
              <select
                className="ops-select"
                value={attendanceReportFilter}
                onChange={(event) =>
                  setAttendanceReportFilter(event.target.value as AttendanceReportFilter)
                }
              >
                {ATTENDANCE_REPORT_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label} ({reportCounts[filter.value]})
                  </option>
                ))}
              </select>
            </label>
            <div className="ops-row-subtitle" style={{ flex: "2 1 320px" }}>
              {selectedAttendanceReport.description}
            </div>
          </div>

          <div className="ops-card-divider" />

          <div className="ops-list" style={{ marginTop: 16 }}>
            {ATTENDANCE_REPORT_FILTERS.filter((filter) => filter.value !== "all").map(
              (filter) => {
                const rows = buildAttendanceReportRows(
                  filterWorkersForAttendanceReport(workers, filter.value),
                  lines
                );
                return (
                  <div key={filter.value} className="ops-list-item">
                    <div className="ops-item-header">
                      <div>
                        <div className="ops-item-title">{filter.label}</div>
                        <div className="ops-row-subtitle">{filter.description}</div>
                      </div>
                      <StatusBadge label={`${reportCounts[filter.value]}`} tone="info" />
                    </div>
                    <div className="ops-item-actions">
                      <Button tone="ghost" onClick={() => downloadCsv(filter.filename, rows)}>
                        <FileSpreadsheet size={15} />
                        Download CSV
                      </Button>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </Card>

        <Card
          title={`${selectedAttendanceReport.label} Preview`}
          subtitle={`${selectedReportWorkers.length} employee record(s) match the selected report.`}
        >
          <div className="ops-table-wrap" style={{ maxHeight: 560, overflow: "auto" }}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Line</th>
                  <th>Overall</th>
                  <th>Face</th>
                  <th>Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {selectedReportWorkers.slice(0, 50).map((worker) => {
                  const line = findLine(lines, worker.currentLineId);
                  return (
                    <tr key={worker.id}>
                      <td>
                        <WorkerChip worker={worker} />
                      </td>
                      <td>{line ? `${line.name} · ${line.code}` : "Unassigned"}</td>
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
                          label={
                            hasFingerprintAttendance(worker) ? "Attended" : "Not attended"
                          }
                          tone={hasFingerprintAttendance(worker) ? "success" : "danger"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedReportWorkers.length > 50 ? (
            <div className="ops-row-subtitle" style={{ marginTop: 12 }}>
              Preview shows first 50 records. The downloaded CSV includes all{" "}
              {selectedReportWorkers.length} matching records.
            </div>
          ) : null}
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Weekly Attendance Trend" subtitle="On-time arrivals, absent or leave counts, and late arrivals across recent attendance days.">
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={reportSeries.weeklyAttendance}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name="On Time" fill="#16a34a" radius={[6, 6, 0, 0]} />
                <Bar dataKey="secondaryValue" name="Absent / Leave" fill="#dc2626" radius={[6, 6, 0, 0]} />
                <Bar dataKey="tertiaryValue" name="Late" fill="#d97706" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Department Attendance" subtitle="Present headcount against total department roster from the latest snapshot.">
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={reportSeries.departmentAttendance}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name="Came Today" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="secondaryValue" name="Total Staff" fill="#94a3b8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Line Attendance" subtitle="Assigned versus attended workers across production lines.">
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={reportSeries.lineAttendance}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name="Came Today" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                <Bar dataKey="secondaryValue" name="Assigned" fill="#cbd5f5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Transfer History" subtitle="Recent worker transfer volume for line balancing and staffing support.">
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={reportSeries.transferHistory}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" name="Transfers" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>
    </div>
  );
}

export default ReportsPage;
