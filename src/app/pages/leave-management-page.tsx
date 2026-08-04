import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCheck, Clock3, RefreshCcw, Send, XCircle } from "lucide-react";
import {
  createLeaveRequestFromBackend,
  getLeaveManagementFromBackend,
  reviewLeaveRequestFromBackend,
} from "@/lib/backend/leave-management-api";
import type {
  HalfDaySession,
  LeaveCategory,
  LeaveManagementSnapshot,
  LeaveRequestRecord,
  LeaveRequestStatus,
  LeaveType,
} from "@/types/leave-management";
import { Button, Card, EmptyState, KpiCard, PageHeader, StatusBadge } from "../components/ops-ui";

const EMPTY_LEAVE_SNAPSHOT: LeaveManagementSnapshot = {
  employees: [],
  requests: [],
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function labelize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(status: LeaveRequestStatus): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function formatLeaveDuration(request: LeaveRequestRecord) {
  if (request.leaveType === "short_leave") {
    return `${request.startTime?.slice(0, 5) || "N/A"} to ${request.endTime?.slice(0, 5) || "N/A"}`;
  }
  if (request.leaveType === "half_day") {
    return `${request.dayCount} day · ${labelize(request.halfDaySession || "half_day")}`;
  }
  return `${request.dayCount} day(s)`;
}

function isActiveOnDate(request: LeaveRequestRecord, dateText: string) {
  return request.status === "approved" && request.startDate <= dateText && request.endDate >= dateText;
}

export function LeaveManagementPage() {
  const [snapshot, setSnapshot] = useState<LeaveManagementSnapshot>(EMPTY_LEAVE_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "all" as LeaveRequestStatus | "all",
    employeeId: "all",
    dateFrom: "",
    dateTo: "",
  });
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "full_day" as LeaveType,
    leaveCategory: "casual" as LeaveCategory,
    startDate: todayInputValue(),
    endDate: todayInputValue(),
    startTime: "10:00",
    endTime: "12:00",
    halfDaySession: "first_half" as HalfDaySession,
    reason: "",
  });

  const loadLeaveManagement = async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getLeaveManagementFromBackend());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLeaveManagement();
  }, []);

  useEffect(() => {
    if (!form.employeeId && snapshot.employees[0]) {
      setForm((current) => ({ ...current, employeeId: snapshot.employees[0].id }));
    }
  }, [form.employeeId, snapshot.employees]);

  const visibleRequests = useMemo(
    () =>
      snapshot.requests.filter((request) => {
        const statusMatch = filters.status === "all" || request.status === filters.status;
        const employeeMatch = filters.employeeId === "all" || request.employeeId === filters.employeeId;
        const fromMatch = !filters.dateFrom || request.endDate >= filters.dateFrom;
        const toMatch = !filters.dateTo || request.startDate <= filters.dateTo;
        return statusMatch && employeeMatch && fromMatch && toMatch;
      }),
    [filters, snapshot.requests]
  );

  const today = todayInputValue();
  const counts = useMemo(
    () => ({
      pending: snapshot.requests.filter((request) => request.status === "pending").length,
      approved: snapshot.requests.filter((request) => request.status === "approved").length,
      rejected: snapshot.requests.filter((request) => request.status === "rejected").length,
      activeToday: snapshot.requests.filter((request) => isActiveOnDate(request, today)).length,
    }),
    [snapshot.requests, today]
  );

  const submitRequest = async () => {
    setSaving(true);
    setError(null);
    try {
      const isShortLeave = form.leaveType === "short_leave";
      const isHalfDay = form.leaveType === "half_day";
      const nextSnapshot = await createLeaveRequestFromBackend({
        employeeId: form.employeeId,
        leaveType: form.leaveType,
        leaveCategory: form.leaveCategory,
        startDate: form.startDate,
        endDate: form.leaveType === "full_day" ? form.endDate : form.startDate,
        startTime: isShortLeave ? form.startTime : null,
        endTime: isShortLeave ? form.endTime : null,
        halfDaySession: isHalfDay ? form.halfDaySession : null,
        reason: form.reason || null,
      });
      setSnapshot(nextSnapshot);
      setMessage("Leave request created.");
      setForm((current) => ({ ...current, reason: "" }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const reviewRequest = async (request: LeaveRequestRecord, status: "approved" | "rejected" | "cancelled") => {
    setSaving(true);
    setError(null);
    try {
      const nextSnapshot = await reviewLeaveRequestFromBackend(request.id, {
        status,
        reviewNote: reviewNotes[request.id] || null,
      });
      setSnapshot(nextSnapshot);
      setMessage(`Leave request ${status}.`);
      setReviewNotes((current) => ({ ...current, [request.id]: "" }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ops-page">
      <PageHeader
        title="Leave Management"
        subtitle="HR leave request queue with full-day, half-day, short-leave, reason, and approval controls."
        actions={
          <Button tone="secondary" onClick={() => void loadLeaveManagement()}>
            <RefreshCcw size={16} />
            Refresh
          </Button>
        }
      />

      {error ? <div className="ops-alert-banner tone-danger">{error}</div> : null}
      {message ? <div className="ops-alert-banner tone-info">{message}</div> : null}

      <section className="ops-kpi-grid">
        <KpiCard
          label="Pending Requests"
          value={loading ? "Loading" : `${counts.pending}`}
          meta="Waiting for HR review."
          icon={Clock3}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Approved"
          value={`${counts.approved}`}
          meta="Approved leave requests ready for active leave tracking."
          icon={CheckCheck}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Rejected"
          value={`${counts.rejected}`}
          meta="Rejected requests with HR review decisions."
          icon={XCircle}
          accent="var(--ops-danger)"
          soft="var(--ops-danger-soft)"
        />
        <KpiCard
          label="On Leave Today"
          value={`${counts.activeToday}`}
          meta="Approved leave records active today."
          icon={CalendarDays}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card title="Create Leave Request" subtitle="HR can record leave requests on behalf of an employee.">
          <div className="ops-skill-form-grid">
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-employee">Employee</label>
              <select
                id="leave-employee"
                className="ops-select"
                value={form.employeeId}
                onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}
              >
                {snapshot.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeCode} · {employee.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-type">Leave type</label>
              <select
                id="leave-type"
                className="ops-select"
                value={form.leaveType}
                onChange={(event) => {
                  const leaveType = event.target.value as LeaveType;
                  setForm((current) => ({
                    ...current,
                    leaveType,
                    endDate: leaveType === "full_day" ? current.endDate : current.startDate,
                  }));
                }}
              >
                <option value="full_day">Full day leave</option>
                <option value="half_day">Half day leave</option>
                <option value="short_leave">Short leave</option>
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-category">Leave category</label>
              <select
                id="leave-category"
                className="ops-select"
                value={form.leaveCategory}
                onChange={(event) => setForm((current) => ({ ...current, leaveCategory: event.target.value as LeaveCategory }))}
              >
                <option value="annual">Annual</option>
                <option value="casual">Casual</option>
                <option value="sick">Sick</option>
                <option value="no_pay">No pay</option>
                <option value="emergency">Emergency</option>
                <option value="personal">Personal</option>
                <option value="medical">Medical</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-start-date">Start date</label>
              <input
                id="leave-start-date"
                className="ops-input"
                type="date"
                value={form.startDate}
                onChange={(event) => {
                  const startDate = event.target.value;
                  setForm((current) => ({
                    ...current,
                    startDate,
                    endDate: current.leaveType === "full_day" ? current.endDate : startDate,
                  }));
                }}
              />
            </div>
            {form.leaveType === "full_day" ? (
              <div className="ops-form-field">
                <label className="ops-filter-label" htmlFor="leave-end-date">End date</label>
                <input
                  id="leave-end-date"
                  className="ops-input"
                  type="date"
                  value={form.endDate}
                  onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
                />
              </div>
            ) : null}
            {form.leaveType === "half_day" ? (
              <div className="ops-form-field">
                <label className="ops-filter-label" htmlFor="leave-half-session">Half day session</label>
                <select
                  id="leave-half-session"
                  className="ops-select"
                  value={form.halfDaySession}
                  onChange={(event) => setForm((current) => ({ ...current, halfDaySession: event.target.value as HalfDaySession }))}
                >
                  <option value="first_half">First half</option>
                  <option value="second_half">Second half</option>
                </select>
              </div>
            ) : null}
            {form.leaveType === "short_leave" ? (
              <>
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="leave-start-time">Start time</label>
                  <input
                    id="leave-start-time"
                    className="ops-input"
                    type="time"
                    value={form.startTime}
                    onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </div>
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="leave-end-time">End time</label>
                  <input
                    id="leave-end-time"
                    className="ops-input"
                    type="time"
                    value={form.endTime}
                    onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="ops-form-field" style={{ marginBottom: 14 }}>
            <label className="ops-filter-label" htmlFor="leave-reason">Leave reason</label>
            <input
              id="leave-reason"
              className="ops-input"
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Reason for leave"
            />
          </div>
          <Button tone="primary" disabled={saving || !form.employeeId} onClick={() => void submitRequest()}>
            <Send size={16} />
            Submit Leave Request
          </Button>
        </Card>

        <Card title="Filters" subtitle="Review requests by employee, date range, and approval status.">
          <div className="ops-skill-form-grid">
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-filter-status">Status</label>
              <select
                id="leave-filter-status"
                className="ops-select"
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as LeaveRequestStatus | "all" }))}
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-filter-employee">Employee</label>
              <select
                id="leave-filter-employee"
                className="ops-select"
                value={filters.employeeId}
                onChange={(event) => setFilters((current) => ({ ...current, employeeId: event.target.value }))}
              >
                <option value="all">All employees</option>
                {snapshot.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeCode} · {employee.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-filter-from">From</label>
              <input
                id="leave-filter-from"
                className="ops-input"
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
              />
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="leave-filter-to">To</label>
              <input
                id="leave-filter-to"
                className="ops-input"
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
              />
            </div>
          </div>
          <div className="ops-item-actions">
            <Button tone="secondary" onClick={() => setFilters({ status: "all", employeeId: "all", dateFrom: "", dateTo: "" })}>
              Clear Filters
            </Button>
          </div>
        </Card>
      </section>

      <Card title="Pending Approval Queue" subtitle="Approve or reject requests after checking reason, dates, and employee context.">
        <div className="ops-list ops-scroll-list is-tall">
          {visibleRequests.filter((request) => request.status === "pending").map((request) => (
            <div key={request.id} className="ops-list-item">
              <div className="ops-item-header">
                <div>
                  <div className="ops-item-title">
                    {request.employeeName} · {labelize(request.leaveType)}
                  </div>
                  <div className="ops-row-subtitle">
                    {request.employeeCode} · {request.department || "Unassigned"} · {request.startDate} to {request.endDate}
                  </div>
                  <div className="ops-item-description">
                    {labelize(request.leaveCategory)} · {formatLeaveDuration(request)} · {request.reason || "No reason captured"}
                  </div>
                </div>
                <StatusBadge label={request.status} tone={statusTone(request.status)} />
              </div>
              <div className="ops-item-actions">
                <input
                  className="ops-input"
                  style={{ maxWidth: 460 }}
                  value={reviewNotes[request.id] || ""}
                  onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                  placeholder="Optional HR review note"
                />
                <Button tone="primary" disabled={saving} onClick={() => void reviewRequest(request, "approved")}>
                  <CheckCheck size={16} />
                  Approve
                </Button>
                <Button tone="danger" disabled={saving} onClick={() => void reviewRequest(request, "rejected")}>
                  <XCircle size={16} />
                  Reject
                </Button>
              </div>
            </div>
          ))}
          {!visibleRequests.some((request) => request.status === "pending") ? (
            <EmptyState title="No pending leave requests" description="New employee leave requests will appear here for HR approval." />
          ) : null}
        </div>
      </Card>

    </div>
  );
}

export default LeaveManagementPage;
