import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Clock3, Download, Fingerprint, ScanFace, UserX, Users } from "lucide-react";
import {
  ATTENDANCE_REPORT_FILTERS,
  type AttendanceReportFilter,
  buildAttendanceReportRows,
  hasFaceAttendance,
  hasFingerprintAttendance,
  matchesAttendanceReportFilter,
} from "../attendance-reporting";
import { useAuth } from "../auth";
import { useOperations, findLine } from "../operations-context";
import {
  Button,
  KpiCard,
  PageHeader,
  SearchField,
  StatusBadge,
  WorkerChip,
  attendanceTone,
  downloadCsv,
  validationTone,
} from "../components/ops-ui";

const WORKERS_PAGE_SIZE = 50;

export function WorkersPage() {
  const { canAccess } = useAuth();
  const { workers, lines } = useOperations();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");
  const [status, setStatus] = useState("All");
  const [attendanceFocus, setAttendanceFocus] = useState<AttendanceReportFilter>("all");
  const [page, setPage] = useState(1);

  const departments = useMemo(
    () => ["All", ...new Set(workers.map((worker) => worker.department).sort())],
    [workers]
  );

  const filteredWorkers = useMemo(
    () =>
      workers.filter((worker) => {
        const query = search.trim().toLowerCase();
        const matchesQuery =
          !query ||
          worker.fullName.toLowerCase().includes(query) ||
          worker.employeeId.toLowerCase().includes(query) ||
          worker.roleTitle.toLowerCase().includes(query) ||
          worker.department.toLowerCase().includes(query);
        const matchesDepartment = department === "All" || worker.department === department;
        const matchesStatus = status === "All" || worker.attendanceStatus === status;
        const matchesFocus = matchesAttendanceReportFilter(worker, attendanceFocus);
        return matchesQuery && matchesDepartment && matchesStatus && matchesFocus;
      }),
    [attendanceFocus, department, search, status, workers]
  );

  const totalPages = Math.max(1, Math.ceil(filteredWorkers.length / WORKERS_PAGE_SIZE));
  const pagedWorkers = useMemo(() => {
    const start = (page - 1) * WORKERS_PAGE_SIZE;
    return filteredWorkers.slice(start, start + WORKERS_PAGE_SIZE);
  }, [filteredWorkers, page]);
  const workerStart = filteredWorkers.length === 0 ? 0 : (page - 1) * WORKERS_PAGE_SIZE + 1;
  const workerEnd = Math.min(page * WORKERS_PAGE_SIZE, filteredWorkers.length);

  useEffect(() => {
    setPage(1);
  }, [attendanceFocus, department, search, status]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const lateWorkers = workers.filter((worker) => worker.attendanceStatus === "Late").length;
  const absentWorkers = workers.filter((worker) => worker.attendanceStatus === "Absent").length;
  const missingFaceWorkers = workers.filter((worker) => !hasFaceAttendance(worker)).length;
  const missingFingerprintWorkers = workers.filter(
    (worker) => !hasFingerprintAttendance(worker)
  ).length;
  const missingBothWorkers = workers.filter(
    (worker) => !hasFaceAttendance(worker) && !hasFingerprintAttendance(worker)
  ).length;

  const exportRows = buildAttendanceReportRows(filteredWorkers, lines);

  return (
    <div className="ops-page">
      <PageHeader
        title="Workers"
        subtitle="Live worker directory with fingerprint attendance, line assignment, and security-check visibility."
        actions={
          <Button tone="secondary" onClick={() => downloadCsv("workers.csv", exportRows)}>
            <Download size={15} />
            Export
          </Button>
        }
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Total Workers"
          value={`${workers.length}`}
          meta="Active employee records currently available in the operations workspace."
          icon={Users}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Late Today"
          value={`${lateWorkers}`}
          meta="Workers marked late from the live attendance snapshot."
          icon={Clock3}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Absent Today"
          value={`${absentWorkers}`}
          meta="Workers currently marked absent."
          icon={UserX}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
        <KpiCard
          label="Face Not Attended"
          value={`${missingFaceWorkers}`}
          meta={`${missingBothWorkers} workers are missing both face and fingerprint signals.`}
          icon={ScanFace}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
        <KpiCard
          label="Fingerprint Not Attended"
          value={`${missingFingerprintWorkers}`}
          meta="Workers without a verified fingerprint attendance signal."
          icon={Fingerprint}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
      </section>

      <div className="ops-filter-bar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search by employee number, name, or role"
        />
        <select
          className="ops-select"
          style={{ flex: "0 0 190px" }}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          {departments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="ops-select"
          style={{ flex: "0 0 200px" }}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="All">All attendance</option>
          <option value="Present">Present</option>
          <option value="Late">Late</option>
          <option value="Absent">Absent</option>
          <option value="On Leave">On Leave</option>
        </select>
        <select
          className="ops-select"
          style={{ flex: "0 0 250px" }}
          value={attendanceFocus}
          onChange={(event) => setAttendanceFocus(event.target.value as AttendanceReportFilter)}
        >
          {ATTENDANCE_REPORT_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <section className="ops-table-card">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Department / Role</th>
                <th>Current Line</th>
                <th>Shift</th>
                <th>Attendance</th>
                <th>Security Check</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedWorkers.map((worker) => (
                <tr key={worker.id}>
                  <td>
                    <WorkerChip
                      worker={worker}
                      meta={<div className="ops-row-subtitle">{worker.phone}</div>}
                    />
                  </td>
                  <td>
                    <div className="ops-row-title">{worker.department}</div>
                    <div className="ops-row-subtitle">{worker.roleTitle}</div>
                  </td>
                  <td>{findLine(lines, worker.currentLineId)?.name || "Unassigned"}</td>
                  <td>{worker.shift}</td>
                  <td>
                    <StatusBadge
                      label={worker.attendanceStatus}
                      tone={attendanceTone(worker.attendanceStatus)}
                    />
                  </td>
                  <td>
                    <StatusBadge
                      label={worker.finalValidationStatus}
                      tone={validationTone(worker.finalValidationStatus)}
                    />
                  </td>
                  <td>
                    <div className="ops-row-actions">
                      <Link to={`/workers/${worker.id}`} className="ops-link-button">
                        View Profile
                      </Link>
                      {canAccess("productionLines") ? (
                        <Link to="/production-lines" className="ops-link-button">
                          View Line
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ops-pagination-bar">
          <div className="ops-row-subtitle">
            Showing {workerStart}-{workerEnd} of {filteredWorkers.length} workers
          </div>
          <div className="ops-pagination-actions">
            <button
              type="button"
              className="ops-button ops-button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span className="ops-pagination-count">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="ops-button ops-button-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default WorkersPage;
