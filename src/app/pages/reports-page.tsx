import { useEffect, useMemo, useState } from "react";
import { Clock3, FileSpreadsheet, FileText, Fingerprint, HandCoins, Printer, ScanFace, UserX } from "lucide-react";
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
  downloadDailySummaryRangeWordReport,
  downloadFullAttendanceWordReport,
  fetchDailySummaryRangeReport,
} from "../attendance-word-report";
import { isBackendConfigured } from "@/lib/backend/env";
import {
  getHikvisionEventsFromBackend,
  getZktecoEventsFromBackend,
} from "@/lib/backend/pipeline-api";
import type { HikvisionRecognitionEvent } from "@/types/hikvision";
import type { ZktecoFingerprintEvent } from "@/types/zkteco";
import {
  currentAttendanceDateKey,
  isDateKeyInAttendanceDay,
} from "../alert-dates";
import { resolveFingerprintDeviceSummary } from "../fingerprint-device-counts";
import { useZktecoFingerprintEvents } from "../hooks/use-zkteco-fingerprint-events";
import { useAuth } from "../auth";
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
  const { currentUser } = useAuth();
  const {
    attendanceOverview,
    departmentAttendance,
    reportSeries,
    attendanceSummaries,
    alerts,
    transferLogs,
    workers,
    lines,
    fingerprintDeviceSummary,
    faceEvents,
    fingerprintEvents,
    validationRecords,
    leaveRecords,
  } = useOperations();
  const { events: zktecoFingerprintEvents } = useZktecoFingerprintEvents(5000);
  const [attendanceReportFilter, setAttendanceReportFilter] =
    useState<AttendanceReportFilter>("late");
  const [wordReportBusy, setWordReportBusy] = useState(false);
  const [summaryReportBusy, setSummaryReportBusy] = useState(false);
  const [summaryReportError, setSummaryReportError] = useState<string | null>(null);
  const [summaryReportStartDate, setSummaryReportStartDate] = useState("");
  const [summaryReportEndDate, setSummaryReportEndDate] = useState("");

  const totalPayout = attendanceSummaries.reduce((sum, item) => sum + item.finalTotal, 0);
  const totalIncentive = attendanceSummaries.reduce((sum, item) => sum + item.incentive, 0);
  const activeAlertDate = attendanceOverview.attendanceDate || currentAttendanceDateKey();
  const openAlerts = alerts.filter(
    (item) =>
      item.status !== "Resolved" &&
      isDateKeyInAttendanceDay(item.createdAt, activeAlertDate)
  ).length;
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
  const canViewIncentiveReports = currentUser.role !== "hr";
  const resolvedFingerprintDeviceSummary = useMemo(
    () => resolveFingerprintDeviceSummary(fingerprintDeviceSummary, zktecoFingerprintEvents),
    [fingerprintDeviceSummary, zktecoFingerprintEvents]
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
  const unregisteredFingerprintRows = useMemo(
    () => [
      ["PIN", "First Punch", "Last Punch", "Punch Count", "Device IPs", "Status"],
      ...resolvedFingerprintDeviceSummary.unregisteredPins.map((pin) => [
        pin.pin,
        pin.firstPunch,
        pin.lastPunch,
        `${pin.punchCount}`,
        pin.deviceIps.join(" | "),
        "Not registered in LineMatrix",
      ]),
    ],
    [resolvedFingerprintDeviceSummary.unregisteredPins]
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

  const latestAttendanceDate =
    attendanceOverview.attendanceDate ||
    resolvedFingerprintDeviceSummary.attendanceDate ||
    new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!summaryReportStartDate && latestAttendanceDate) {
      setSummaryReportStartDate(latestAttendanceDate);
      setSummaryReportEndDate(latestAttendanceDate);
    }
  }, [latestAttendanceDate, summaryReportEndDate, summaryReportStartDate]);

  const exportRows = useMemo(
    () => [
      ["Report", "Metric", "Value"],
      ["Attendance", "Clocked in today", `${attendanceOverview.presentWorkers + attendanceOverview.lateWorkers}`],
      ["Attendance", "Fingerprint device PINs", `${resolvedFingerprintDeviceSummary.totalDevicePins}`],
      ["Attendance", "Registered fingerprint PINs", `${resolvedFingerprintDeviceSummary.registeredDevicePins}`],
      ["Attendance", "Unregistered fingerprint PINs", `${resolvedFingerprintDeviceSummary.unregisteredDevicePins}`],
      ["Attendance", "Absent today", `${attendanceOverview.absentWorkers}`],
      ["Attendance", "On leave today", `${attendanceOverview.onLeaveWorkers}`],
      ...(canViewIncentiveReports
        ? [
            ["Payroll", "Estimated payout", formatCurrency(totalPayout)],
            ["Payroll", "Estimated incentive pool", formatCurrency(totalIncentive)],
          ]
        : []),
      ["Alerts", "Open alerts today", `${openAlerts}`],
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
      canViewIncentiveReports,
      departmentAttendance,
      openAlerts,
      resolvedFingerprintDeviceSummary.registeredDevicePins,
      resolvedFingerprintDeviceSummary.totalDevicePins,
      resolvedFingerprintDeviceSummary.unregisteredDevicePins,
      totalIncentive,
      totalPayout,
      totalTransfers,
    ]
  );

  async function handleDownloadFullWordReport() {
    setWordReportBusy(true);
    const backendNotes: string[] = [];
    let rawFaceEvents: HikvisionRecognitionEvent[] = [];
    let rawFingerprintEvents: ZktecoFingerprintEvent[] = [];

    try {
      if (isBackendConfigured()) {
        const [faceResult, fingerprintResult] = await Promise.allSettled([
          getHikvisionEventsFromBackend(1000),
          getZktecoEventsFromBackend(5000),
        ]);

        if (faceResult.status === "fulfilled") {
          rawFaceEvents = faceResult.value.events || [];
        } else {
          backendNotes.push(
            `Hikvision event fetch failed: ${
              faceResult.reason instanceof Error ? faceResult.reason.message : String(faceResult.reason)
            }`
          );
        }

        if (fingerprintResult.status === "fulfilled") {
          rawFingerprintEvents = fingerprintResult.value || [];
        } else {
          backendNotes.push(
            `ZKTeco fingerprint event fetch failed: ${
              fingerprintResult.reason instanceof Error
                ? fingerprintResult.reason.message
                : String(fingerprintResult.reason)
            }`
          );
        }
      } else {
        backendNotes.push(
          "VITE_BACKEND_URL is not configured, so raw backend face and fingerprint events were not fetched."
        );
      }

      downloadFullAttendanceWordReport({
        generatedAt: new Date(),
        attendanceOverview,
        departmentAttendance,
        workers,
        lines,
        validationRecords,
        faceEvents,
        fingerprintEvents,
        fingerprintDeviceSummary: resolveFingerprintDeviceSummary(
          fingerprintDeviceSummary,
          rawFingerprintEvents.length ? rawFingerprintEvents : zktecoFingerprintEvents
        ),
        attendanceSummaries,
        leaveRecords,
        alerts,
        rawFaceEvents,
        rawFingerprintEvents,
        backendNotes,
      });
    } finally {
      setWordReportBusy(false);
    }
  }

  async function handleDownloadDailySummaryReport() {
    const dateFrom = summaryReportStartDate || latestAttendanceDate;
    const dateTo = summaryReportEndDate || dateFrom;

    if (!dateFrom || !dateTo) {
      setSummaryReportError("Select a valid date range.");
      return;
    }

    if (dateTo < dateFrom) {
      setSummaryReportError("End date must be the same as or after the start date.");
      return;
    }

    setSummaryReportBusy(true);
    setSummaryReportError(null);

    try {
      const generatedAt = new Date();
      const days = await fetchDailySummaryRangeReport({
        dateFrom,
        dateTo,
        generatedAt,
      });

      downloadDailySummaryRangeWordReport({
        generatedAt,
        dateFrom,
        dateTo,
        days,
      });
    } catch (error) {
      setSummaryReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setSummaryReportBusy(false);
    }
  }

  return (
    <div className="ops-page">
      <PageHeader
        title="Reports"
        subtitle="Attendance-led reports built from fingerprint attendance, line assignments, alerts, and audit-friendly operational data."
        actions={
          <>
            <Button
              tone="primary"
              onClick={() => void handleDownloadFullWordReport()}
              disabled={wordReportBusy}
            >
              <FileText size={15} />
              {wordReportBusy ? "Preparing Report" : "Full Word Report"}
            </Button>
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
        {canViewIncentiveReports ? (
          <KpiCard
            label="Monthly Incentive"
            value={formatCurrency(totalIncentive)}
            meta="Current monthly incentive calculation across eligible attendance records."
            icon={HandCoins}
            accent="var(--ops-success)"
            soft="var(--ops-success-soft)"
          />
        ) : null}
        <KpiCard
          label="Open Alerts"
          value={`${openAlerts}`}
          meta="Today's operational alerts still open across attendance, lines, and exception handling."
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

      <Card
        title="Daily Summary Word Report"
        subtitle="Select a date range and generate one executive summary table for each attendance date."
        actions={
          <Button
            tone="primary"
            onClick={() => void handleDownloadDailySummaryReport()}
            disabled={summaryReportBusy}
          >
            <FileText size={15} />
            {summaryReportBusy ? "Preparing Summary" : "Daily Summary Word"}
          </Button>
        }
      >
        <div className="ops-filter-bar">
          <label className="ops-filter-group" style={{ flex: "1 1 220px" }}>
            <span className="ops-filter-label">From date</span>
            <input
              className="ops-input"
              type="date"
              value={summaryReportStartDate}
              onChange={(event) => setSummaryReportStartDate(event.target.value)}
            />
          </label>
          <label className="ops-filter-group" style={{ flex: "1 1 220px" }}>
            <span className="ops-filter-label">To date</span>
            <input
              className="ops-input"
              type="date"
              value={summaryReportEndDate}
              onChange={(event) => setSummaryReportEndDate(event.target.value)}
            />
          </label>
          <div className="ops-row-subtitle" style={{ flex: "2 1 320px" }}>
            The Word file repeats the same summary table per day and includes face attendance,
            fingerprint attendance, unregistered PINs, and unmatched device-event totals.
          </div>
        </div>
        {summaryReportError ? (
          <div className="ops-row-subtitle" style={{ color: "var(--ops-danger)", marginTop: 12 }}>
            {summaryReportError}
          </div>
        ) : null}
      </Card>

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
              value={`${resolvedFingerprintDeviceSummary.totalDevicePins || fingerprintAttendedWorkers.length}`}
              meta={`${resolvedFingerprintDeviceSummary.registeredDevicePins} registered, ${resolvedFingerprintDeviceSummary.unregisteredDevicePins} unregistered device PINs.`}
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

          {resolvedFingerprintDeviceSummary.unregisteredPins.length ? (
            <div className="ops-list" style={{ marginTop: 16 }}>
              <div className="ops-list-item">
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">Unregistered Fingerprint PIN Report</div>
                    <div className="ops-row-subtitle">
                      These PINs are counted in device attendance but are not matched to employee records yet.
                    </div>
                  </div>
                  <StatusBadge
                    label={`${resolvedFingerprintDeviceSummary.unregisteredDevicePins} PINs`}
                    tone="warning"
                  />
                </div>
                <div className="ops-item-actions">
                  <Button
                    tone="ghost"
                    onClick={() =>
                      downloadCsv(
                        `unregistered-fingerprint-pins-${resolvedFingerprintDeviceSummary.attendanceDate || "latest"}.csv`,
                        unregisteredFingerprintRows
                      )
                    }
                  >
                    <FileSpreadsheet size={15} />
                    Download CSV
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

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
                <Bar dataKey="value" name="Came Today" fill="#263574" radius={[6, 6, 0, 0]} />
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
