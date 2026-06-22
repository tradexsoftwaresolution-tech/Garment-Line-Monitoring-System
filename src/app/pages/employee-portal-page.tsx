import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Image, KeyRound, LogOut, Phone, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import {
  createEmployeePortalLeaveRequestFromBackend,
  getEmployeePortalFromBackend,
  loginEmployeePortal,
  logoutEmployeePortal,
  setupEmployeePortalPassword,
  verifyEmployeePortalOtp,
} from "@/lib/backend/employee-portal-api";
import { isBackendConfigured } from "@/lib/backend/env";
import type {
  EmployeePortalAuthResponse,
  EmployeePortalOtpChallenge,
  EmployeePortalSnapshot,
} from "@/types/employee-portal";
import type { HalfDaySession, LeaveCategory, LeaveType } from "@/types/leave-management";
import {
  AccessDeniedState,
  Button,
  Card,
  EmptyState,
  MetricTile,
  PageHeader,
  StatusBadge,
  formatCurrency,
  getInitials,
} from "../components/ops-ui";

const PORTAL_TOKEN_STORAGE_KEY = "linematrix.employeePortalToken";

const EMPTY_PORTAL: EmployeePortalSnapshot = {
  linked: false,
  profile: { id: "" },
  employee: null,
  currentLine: null,
  attendanceHistory: [],
  leaveRequests: [],
  incentives: [],
  leaveBalance: {
    allowanceDays: 14,
    usedDays: 0,
    remainingDays: 14,
  },
};

function labelize(value?: string | null) {
  if (!value) return "Not captured";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status?: string | null) {
  if (!status) return "neutral";
  if (["validated", "approved", "present"].includes(status)) return "success";
  if (["pending", "needs_review", "face_only", "fingerprint_only"].includes(status)) return "warning";
  if (["leave", "cancelled"].includes(status)) return "info";
  if (["absent", "rejected", "anomaly"].includes(status)) return "danger";
  return "neutral";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not captured";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function storedPortalToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PORTAL_TOKEN_STORAGE_KEY);
}

function savePortalToken(token: string) {
  window.localStorage.setItem(PORTAL_TOKEN_STORAGE_KEY, token);
}

function clearPortalToken() {
  window.localStorage.removeItem(PORTAL_TOKEN_STORAGE_KEY);
}

export function EmployeePortalPage() {
  const [snapshot, setSnapshot] = useState<EmployeePortalSnapshot>(EMPTY_PORTAL);
  const [token, setToken] = useState<string | null>(() => storedPortalToken());
  const [loading, setLoading] = useState(Boolean(storedPortalToken()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [otpChallenge, setOtpChallenge] = useState<EmployeePortalOtpChallenge | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [authForm, setAuthForm] = useState({
    employeeCode: "",
    phoneNumber: "",
    password: "",
  });
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "full_day" as LeaveType,
    leaveCategory: "casual" as LeaveCategory,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    startTime: "",
    endTime: "",
    halfDaySession: "first_half" as HalfDaySession,
    reason: "",
  });

  const pendingLeaveCount = useMemo(
    () => snapshot.leaveRequests.filter((item) => item.status === "pending").length,
    [snapshot.leaveRequests]
  );
  const latestAttendance = snapshot.attendanceHistory[0];

  const applyAuthResponse = (response: EmployeePortalAuthResponse) => {
    if (response.status === "otp_required") {
      setOtpChallenge(response);
      setOtpCode("");
      setMessage(response.message || "OTP validation is required.");
      return;
    }

    savePortalToken(response.token);
    setToken(response.token);
    setSnapshot(response.snapshot);
    setOtpChallenge(null);
    setOtpCode("");
    setMessage("Employee portal signed in.");
  };

  const loadPortal = async (sessionToken = token) => {
    if (!sessionToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getEmployeePortalFromBackend(sessionToken));
      setToken(sessionToken);
    } catch (loadError) {
      clearPortalToken();
      setToken(null);
      setSnapshot(EMPTY_PORTAL);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const existingToken = storedPortalToken();
    if (existingToken) {
      void loadPortal(existingToken);
    }
  }, []);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applyAuthResponse(
        await loginEmployeePortal({
          phoneNumber: authForm.phoneNumber,
          password: authForm.password,
        })
      );
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setSaving(false);
    }
  };

  const submitSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applyAuthResponse(
        await setupEmployeePortalPassword({
          employeeCode: authForm.employeeCode,
          phoneNumber: authForm.phoneNumber,
          password: authForm.password,
        })
      );
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : String(setupError));
    } finally {
      setSaving(false);
    }
  };

  const submitOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!otpChallenge) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      applyAuthResponse(
        await verifyEmployeePortalOtp({
          challengeId: otpChallenge.challengeId,
          code: otpCode,
        })
      );
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : String(otpError));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    const currentToken = token;
    clearPortalToken();
    setToken(null);
    setSnapshot(EMPTY_PORTAL);
    setOtpChallenge(null);
    if (currentToken) {
      try {
        await logoutEmployeePortal(currentToken);
      } catch (_error) {
        // Local logout should still complete even if the backend session already expired.
      }
    }
  };

  const applyLeave = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const startDate = leaveForm.startDate;
      const endDate = leaveForm.leaveType === "full_day" ? leaveForm.endDate : startDate;
      setSnapshot(
        await createEmployeePortalLeaveRequestFromBackend(token, {
          leaveType: leaveForm.leaveType,
          leaveCategory: leaveForm.leaveCategory,
          startDate,
          endDate,
          startTime: leaveForm.leaveType === "short_leave" ? leaveForm.startTime : null,
          endTime: leaveForm.leaveType === "short_leave" ? leaveForm.endTime : null,
          halfDaySession: leaveForm.leaveType === "half_day" ? leaveForm.halfDaySession : null,
          reason: leaveForm.reason || null,
        })
      );
      setLeaveForm((current) => ({ ...current, reason: "" }));
      setMessage("Leave request submitted for HR approval.");
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : String(leaveError));
    } finally {
      setSaving(false);
    }
  };

  if (!isBackendConfigured()) {
    return (
      <AccessDeniedState
        title="Backend configuration required"
        description="Set VITE_BACKEND_URL before opening the employee portal."
      />
    );
  }

  if (loading) {
    return (
      <div className="ops-page ops-self-service">
        <EmptyState
          title="Loading employee portal"
          description="The portal is checking your employee session and secure attendance records."
        />
      </div>
    );
  }

  const isSignedIn = Boolean(token && snapshot.employee);

  return (
    <div className="ops-page ops-self-service">
      <PageHeader
        title="Employee Portal"
        subtitle="Employee-only access for attendance history, leave requests, current line, and incentive visibility."
        actions={
          isSignedIn ? (
            <>
              <Button tone="secondary" onClick={() => void loadPortal()}>
                <RefreshCw size={15} />
                Refresh
              </Button>
              <Button tone="secondary" onClick={() => void signOut()}>
                <LogOut size={15} />
                Sign Out
              </Button>
            </>
          ) : (
            <Link to="/employee-portal/qr" className="ops-button ops-button-secondary">
              Portal QR
            </Link>
          )
        }
      />

      {error ? <div className="ops-alert-banner tone-danger">{error}</div> : null}
      {message ? <div className="ops-alert-banner tone-info">{message}</div> : null}

      {!isSignedIn ? (
        <section className="ops-grid cols-2">
          <Card
            title={mode === "login" ? "Employee Portal Login" : "Create Portal Password"}
            subtitle={
              mode === "login"
                ? "Use your registered phone number and employee portal password."
                : "Create the first portal password using your employee number and registered phone."
            }
          >
            {otpChallenge ? (
              <form className="ops-auth-form-stack" onSubmit={submitOtp}>
                <div className="ops-alert-banner tone-info">
                  Enter the Monday validation OTP sent to {otpChallenge.maskedPhone}. For local testing, check the backend console log.
                </div>
                {otpChallenge.developmentOtp ? (
                  <div className="ops-badge tone-warning">Development OTP: {otpChallenge.developmentOtp}</div>
                ) : null}
                <label className="ops-filter-group">
                  <span className="ops-filter-label">OTP code</span>
                  <input
                    className="ops-input"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6 digit code"
                    autoComplete="one-time-code"
                    required
                  />
                </label>
                <div className="ops-auth-actions">
                  <Button tone="primary" type="submit" disabled={saving || otpCode.length < 6}>
                    <ShieldCheck size={15} />
                    Verify OTP
                  </Button>
                  <Button tone="secondary" type="button" onClick={() => setOtpChallenge(null)} disabled={saving}>
                    Back
                  </Button>
                </div>
              </form>
            ) : (
              <form className="ops-auth-form-stack" onSubmit={mode === "login" ? submitLogin : submitSetup}>
                {mode === "setup" ? (
                  <label className="ops-filter-group">
                    <span className="ops-filter-label">Employee number</span>
                    <input
                      className="ops-input"
                      value={authForm.employeeCode}
                      onChange={(event) => setAuthForm((current) => ({ ...current, employeeCode: event.target.value }))}
                      placeholder="e.g. 16527"
                      required
                    />
                  </label>
                ) : null}

                <label className="ops-filter-group">
                  <span className="ops-filter-label">Registered phone number</span>
                  <input
                    className="ops-input"
                    type="tel"
                    value={authForm.phoneNumber}
                    onChange={(event) => setAuthForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                    placeholder="e.g. 0771234567"
                    autoComplete="tel"
                    required
                  />
                </label>

                <label className="ops-filter-group">
                  <span className="ops-filter-label">Password</span>
                  <input
                    className="ops-input"
                    type="password"
                    value={authForm.password}
                    onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder={mode === "login" ? "Portal password" : "Create at least 8 characters"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                  />
                </label>

                <div className="ops-auth-actions">
                  <Button tone="primary" type="submit" disabled={saving}>
                    {mode === "login" ? <KeyRound size={15} /> : <Phone size={15} />}
                    {saving ? "Please wait..." : mode === "login" ? "Login" : "Create Password"}
                  </Button>
                  <Button
                    tone="secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setMode(mode === "login" ? "setup" : "login");
                      setError(null);
                      setMessage(null);
                    }}
                  >
                    {mode === "login" ? "First time setup" : "Back to login"}
                  </Button>
                </div>
              </form>
            )}
          </Card>

          <Card title="Weekly Identity Check" subtitle="Every Monday, the portal asks for an OTP on the registered phone before opening employee records.">
            <div className="ops-list">
              <div className="ops-list-item">
                <div className="ops-item-title">Phone + password</div>
                <div className="ops-row-subtitle">The login must match the employee's registered phone number.</div>
              </div>
              <div className="ops-list-item">
                <div className="ops-item-title">Monday OTP revalidation</div>
                <div className="ops-row-subtitle">The first login of each week requires OTP verification.</div>
              </div>
              <div className="ops-list-item">
                <div className="ops-item-title">Employee-scoped records</div>
                <div className="ops-row-subtitle">The portal token can only read and submit data for the logged-in employee.</div>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {isSignedIn && snapshot.employee ? (
        <>
          <Card title={snapshot.employee.fullName} subtitle={`${snapshot.employee.employeeCode} · ${snapshot.employee.designation || "Employee"}`}>
            <div className="ops-worker-profile-hero">
              {snapshot.employee.photoUrl ? (
                <img src={snapshot.employee.photoUrl} alt={snapshot.employee.fullName} className="ops-worker-profile-photo" />
              ) : (
                <div className="ops-worker-profile-photo ops-worker-profile-photo-placeholder">
                  <Image size={22} />
                  <span>{getInitials(snapshot.employee.fullName)}</span>
                </div>
              )}
              <div>
                <div className="ops-item-title">{snapshot.employee.fullName}</div>
                <div className="ops-row-subtitle">
                  {snapshot.employee.department || "Department not captured"} · {snapshot.employee.shift || "Shift not captured"}
                </div>
                <div className="ops-row-subtitle">Employee portal session</div>
              </div>
            </div>
          </Card>

          <section className="ops-grid cols-4">
            <MetricTile label="Current Line" value={snapshot.currentLine?.name || "Unassigned"} />
            <MetricTile label="Latest Attendance" value={latestAttendance ? labelize(latestAttendance.status) : "No records"} />
            <MetricTile label="Leave Balance" value={`${snapshot.leaveBalance.remainingDays} days`} />
            <MetricTile label="Pending Requests" value={`${pendingLeaveCount}`} />
          </section>

          <section className="ops-grid cols-2">
            <Card title="Apply for Leave" subtitle="Requests are saved as pending and reviewed by HR.">
              <div className="ops-grid cols-2">
                <select
                  className="ops-select"
                  value={leaveForm.leaveType}
                  onChange={(event) =>
                    setLeaveForm((current) => ({ ...current, leaveType: event.target.value as LeaveType }))
                  }
                >
                  <option value="full_day">Full day leave</option>
                  <option value="half_day">Half day leave</option>
                  <option value="short_leave">Short leave</option>
                </select>
                <select
                  className="ops-select"
                  value={leaveForm.leaveCategory}
                  onChange={(event) =>
                    setLeaveForm((current) => ({ ...current, leaveCategory: event.target.value as LeaveCategory }))
                  }
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
                <input
                  className="ops-input"
                  type="date"
                  value={leaveForm.startDate}
                  onChange={(event) => setLeaveForm((current) => ({ ...current, startDate: event.target.value }))}
                />
                {leaveForm.leaveType === "full_day" ? (
                  <input
                    className="ops-input"
                    type="date"
                    value={leaveForm.endDate}
                    onChange={(event) => setLeaveForm((current) => ({ ...current, endDate: event.target.value }))}
                  />
                ) : null}
                {leaveForm.leaveType === "half_day" ? (
                  <select
                    className="ops-select"
                    value={leaveForm.halfDaySession}
                    onChange={(event) =>
                      setLeaveForm((current) => ({ ...current, halfDaySession: event.target.value as HalfDaySession }))
                    }
                  >
                    <option value="first_half">First half</option>
                    <option value="second_half">Second half</option>
                  </select>
                ) : null}
                {leaveForm.leaveType === "short_leave" ? (
                  <>
                    <input
                      className="ops-input"
                      type="time"
                      value={leaveForm.startTime}
                      onChange={(event) =>
                        setLeaveForm((current) => ({ ...current, startTime: event.target.value }))
                      }
                    />
                    <input
                      className="ops-input"
                      type="time"
                      value={leaveForm.endTime}
                      onChange={(event) =>
                        setLeaveForm((current) => ({ ...current, endTime: event.target.value }))
                      }
                    />
                  </>
                ) : null}
              </div>
              <textarea
                className="ops-textarea"
                style={{ marginTop: 14 }}
                value={leaveForm.reason}
                onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Leave reason"
              />
              <div className="ops-item-actions" style={{ marginTop: 14 }}>
                <Button tone="primary" disabled={saving} onClick={() => void applyLeave()}>
                  <Send size={15} />
                  Submit Request
                </Button>
              </div>
            </Card>

            <Card title="Leave Requests" subtitle="Your submitted requests and HR review status.">
              <div className="ops-list">
                {snapshot.leaveRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="ops-list-item">
                    <div className="ops-item-header">
                      <div>
                        <div className="ops-item-title">
                          {labelize(request.leaveType)} · {labelize(request.leaveCategory)}
                        </div>
                        <div className="ops-row-subtitle">
                          {request.startDate}
                          {request.endDate !== request.startDate ? ` to ${request.endDate}` : ""}
                          {request.startTime && request.endTime
                            ? ` · ${request.startTime.slice(0, 5)}-${request.endTime.slice(0, 5)}`
                            : ""}
                        </div>
                      </div>
                      <StatusBadge label={labelize(request.status)} tone={statusTone(request.status)} />
                    </div>
                    {request.reason ? <div className="ops-item-description">{request.reason}</div> : null}
                    <div className="ops-item-meta">
                      <span>{request.dayCount ? `${request.dayCount} day(s)` : "Short leave"}</span>
                      <span>{formatDateTime(request.requestedAt)}</span>
                    </div>
                    {request.reviewNote ? <div className="ops-item-description">HR note: {request.reviewNote}</div> : null}
                  </div>
                ))}
                {!snapshot.leaveRequests.length ? (
                  <EmptyState title="No leave requests" description="Submitted leave requests will appear here." />
                ) : null}
              </div>
            </Card>
          </section>

          <section className="ops-grid cols-2">
            <Card title="Attendance History" subtitle="Latest attendance reconciliation records.">
              <div className="ops-list">
                {snapshot.attendanceHistory.slice(0, 12).map((record) => (
                  <div key={record.id} className="ops-list-item">
                    <div className="ops-item-header">
                      <div>
                        <div className="ops-item-title">{record.date}</div>
                        <div className="ops-row-subtitle">
                          Time in {record.timeIn?.slice(0, 5) || record.faceFirstSeen?.slice(0, 5) || "N/A"} · Time out{" "}
                          {record.timeOut?.slice(0, 5) || record.faceLastSeen?.slice(0, 5) || "N/A"}
                        </div>
                      </div>
                      <StatusBadge label={labelize(record.status)} tone={statusTone(record.status)} />
                    </div>
                    <div className="ops-item-meta">
                      <span>OT {record.otHours || 0}h</span>
                      <span>Late/Early {record.lateEarlyHours || 0}h</span>
                      {record.leaveType ? <span>{record.leaveType}</span> : null}
                    </div>
                    {record.exceptionReason ? <div className="ops-item-description">{record.exceptionReason}</div> : null}
                  </div>
                ))}
                {!snapshot.attendanceHistory.length ? (
                  <EmptyState title="No attendance history" description="Attendance records will appear after HR imports or device syncs data." />
                ) : null}
              </div>
            </Card>

            <Card title="Current Line & Incentives" subtitle="Line assignment and recent incentive visibility.">
              <div className="ops-list">
                <div className="ops-list-item">
                  <div className="ops-item-header">
                    <div>
                      <div className="ops-item-title">{snapshot.currentLine?.name || "Unassigned"}</div>
                      <div className="ops-row-subtitle">
                        {snapshot.currentLine
                          ? `${snapshot.currentLine.code} · ${snapshot.currentLine.shift || "Shift not captured"}`
                          : "No active line assignment"}
                      </div>
                    </div>
                    <StatusBadge label={snapshot.currentLine ? "Active" : "Pending"} tone={snapshot.currentLine ? "success" : "warning"} />
                  </div>
                  {snapshot.currentLine?.supervisor ? (
                    <div className="ops-item-description">Supervisor: {snapshot.currentLine.supervisor}</div>
                  ) : null}
                </div>

                {snapshot.incentives.slice(0, 6).map((row) => (
                  <div key={row.id} className="ops-list-item">
                    <div className="ops-item-header">
                      <div>
                        <div className="ops-item-title">{row.monthStart}</div>
                        <div className="ops-row-subtitle">{row.reason || "Incentive"}</div>
                      </div>
                      <StatusBadge label={formatCurrency(row.amount || 0)} tone="success" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}

export default EmployeePortalPage;
