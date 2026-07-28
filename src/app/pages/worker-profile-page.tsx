import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRightLeft, Award, CheckCircle2, FileWarning, Image, NotebookPen, ShieldAlert, Trash2, UserPlus, XCircle } from "lucide-react";
import {
  deleteEmployeeSkillFromBackend,
  getSkillMatrixFromBackend,
  saveEmployeeSkillFromBackend,
} from "@/lib/backend/skill-matrix-api";
import { getLeaveManagementFromBackend } from "@/lib/backend/leave-management-api";
import type { LeaveRequestRecord, LeaveRequestStatus } from "@/types/leave-management";
import type { SkillMatrixSnapshot } from "@/types/skill-matrix";
import { useAuth } from "../auth";
import { findLine, useOperations } from "../operations-context";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  formatCurrency,
  formatDateTime,
  getInitials,
  validationTone,
  attendanceTone,
} from "../components/ops-ui";

const EMPTY_SKILL_MATRIX: SkillMatrixSnapshot = {
  operations: [],
  lines: [],
  employees: [],
  lineOperations: [],
  linePositionAssignments: [],
  stylePlans: [],
  stylePlanMachines: [],
  lineStyleSchedules: [],
  employeeSkills: [],
};

function formatLeaveLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function leaveStatusTone(status: LeaveRequestStatus) {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "cancelled") return "neutral";
  return "danger";
}

function formatOptionalDate(value?: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function WorkerProfilePage() {
  const { workerId } = useParams();
  const { currentUser, canDo } = useAuth();
  const {
    loading,
    workers,
    lines,
    validationRecords,
    attendanceSummaries,
    transferLogs,
    overtimeRecords,
    leaveRecords,
    addWorkerNote,
    markWorkerException,
    assignWorker,
    transferWorker,
    updateWorkerAttendanceStatus,
  } = useOperations();
  const worker = workers.find((item) => item.id === workerId);
  const [selectedLineId, setSelectedLineId] = useState(worker?.currentLineId || lines[0]?.id || "");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [attendanceSaving, setAttendanceSaving] = useState<"Present" | "Absent" | null>(null);
  const [attendanceOverride, setAttendanceOverride] = useState<"Present" | "Absent" | null>(null);
  const [skillMatrix, setSkillMatrix] = useState<SkillMatrixSnapshot>(EMPTY_SKILL_MATRIX);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillMessage, setSkillMessage] = useState<string | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
  const [profileLeaveRequests, setProfileLeaveRequests] = useState<LeaveRequestRecord[]>([]);
  const [profileLeaveError, setProfileLeaveError] = useState<string | null>(null);
  const [skillForm, setSkillForm] = useState({
    operationId: "",
    skillLevelPercentage: "70",
    isSpeciality: false,
    notes: "",
  });

  useEffect(() => {
    if (!selectedLineId && lines[0]?.id) {
      setSelectedLineId(worker?.currentLineId || lines[0].id);
    }
  }, [lines, selectedLineId, worker?.currentLineId]);

  useEffect(() => {
    setAttendanceOverride(null);
  }, [worker?.id]);

  useEffect(() => {
    if (!["super_admin", "admin", "supervisor", "hr"].includes(currentUser.role)) {
      setSkillMatrix(EMPTY_SKILL_MATRIX);
      setSkillError(null);
      return;
    }

    let active = true;
    getSkillMatrixFromBackend()
      .then((nextMatrix) => {
        if (!active) return;
        setSkillMatrix(nextMatrix);
        setSkillError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSkillError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [currentUser.role]);

  useEffect(() => {
    if (!skillForm.operationId && skillMatrix.operations[0]) {
      setSkillForm((current) => ({ ...current, operationId: skillMatrix.operations[0].id }));
    }
  }, [skillForm.operationId, skillMatrix.operations]);

  useEffect(() => {
    if (!worker?.id || !["super_admin", "admin", "hr", "supervisor"].includes(currentUser.role)) {
      setProfileLeaveRequests([]);
      setProfileLeaveError(null);
      return;
    }

    let active = true;
    getLeaveManagementFromBackend({ employeeId: worker.id })
      .then((snapshot) => {
        if (!active) return;
        setProfileLeaveRequests(snapshot.requests);
        setProfileLeaveError(null);
      })
      .catch((error) => {
        if (!active) return;
        setProfileLeaveRequests([]);
        setProfileLeaveError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
    };
  }, [currentUser.role, worker?.id]);

  const currentLine = findLine(lines, worker?.currentLineId);
  const workerValidation = validationRecords
    .filter((item) => item.workerId === worker?.id)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const attendanceSummary = attendanceSummaries.find((item) => item.workerId === worker?.id);
  const workerTransfers = transferLogs.filter((item) => item.workerId === worker?.id);
  const workerOt = overtimeRecords.filter((item) => item.workerId === worker?.id);
  const workerLeave = leaveRecords.filter((item) => item.workerId === worker?.id);
  const availableLines = useMemo(() => lines.filter((line) => line.status !== "Idle"), [lines]);
  const canManageSkills = ["super_admin", "admin", "supervisor", "hr"].includes(currentUser.role);
  const workerOperationSkills = skillMatrix.employeeSkills
    .filter((skill) => skill.employeeId === worker?.id)
    .sort((a, b) => b.skillLevelPercentage - a.skillLevelPercentage);

  if (!worker) {
    return (
      <div className="ops-page">
        <EmptyState
          title={loading ? "Loading worker profile" : "Worker not found"}
          description={
            loading
              ? "The live operational profile is still loading from Supabase."
              : "The requested worker profile is not available in the current operational dataset."
          }
        />
      </div>
    );
  }

  const timeline = workerValidation?.timeline || [];
  const transferLabel = workerTransfers.length
    ? `${workerTransfers.length} transfer records`
    : "No recorded transfers";
  const displayedAttendanceStatus = attendanceOverride || worker.attendanceStatus;

  const handleActionResult = async (
    resultPromise: Promise<{ ok: boolean; message: string }>
  ) => {
    const result = await resultPromise;
    setFeedback(result.message);
    if (result.ok) setNote("");
  };

  const changeAttendanceStatus = async (status: "Present" | "Absent") => {
    setAttendanceSaving(status);
    try {
      const result = await updateWorkerAttendanceStatus({
        workerId: worker.id,
        employeeCode: worker.employeeId,
        status,
        actor: currentUser.name,
      });
      setFeedback(result.message);
      if (result.ok) {
        setAttendanceOverride(status);
        setNote("");
      }
    } finally {
      setAttendanceSaving(null);
    }
  };

  const saveSkill = async () => {
    if (!worker) return;
    setSkillSaving(true);
    setSkillError(null);
    setSkillMessage(null);
    try {
      const nextMatrix = await saveEmployeeSkillFromBackend({
        employeeId: worker.id,
        operationId: skillForm.operationId,
        skillLevelPercentage: Number(skillForm.skillLevelPercentage),
        isSpeciality: skillForm.isSpeciality,
        notes: skillForm.notes || null,
      });
      setSkillMatrix(nextMatrix);
      setSkillForm((current) => ({ ...current, notes: "" }));
      setSkillMessage("Employee skill saved.");
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSaving(false);
    }
  };

  const deleteSkill = async (id: string) => {
    setSkillSaving(true);
    setSkillError(null);
    setSkillMessage(null);
    try {
      setSkillMatrix(await deleteEmployeeSkillFromBackend(id));
      setSkillMessage("Employee skill removed.");
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSaving(false);
    }
  };

  return (
    <div className="ops-page">
      <div className="ops-toolbar">
        <Link to="/workers" className="ops-button ops-button-secondary">
          <ArrowLeft size={15} />
          Back to Workers
        </Link>
      </div>

      <PageHeader
        title={worker.fullName}
        subtitle={`${worker.employeeId} · ${worker.department} · ${worker.roleTitle}`}
        actions={
          <>
            {canDo("assignLine") ? (
              <Button
                tone="secondary"
                onClick={() =>
                  void handleActionResult(
                    worker.currentLineId
                      ? transferWorker({
                          workerId: worker.id,
                          destinationLineId: selectedLineId,
                          reason: note || `Transfer action initiated by ${currentUser.name}.`,
                          actor: currentUser.name,
                        })
                      : assignWorker({
                          workerId: worker.id,
                          lineId: selectedLineId,
                          reason: note || `Assignment action initiated by ${currentUser.name}.`,
                          actor: currentUser.name,
                        })
                  )
                }
              >
                {worker.currentLineId ? <ArrowRightLeft size={15} /> : <UserPlus size={15} />}
                {worker.currentLineId ? "Transfer Worker" : "Assign Worker"}
              </Button>
            ) : null}
            {canDo("markException") ? (
              <Button
                tone="danger"
                onClick={() =>
                  void handleActionResult(
                    markWorkerException({
                      workerId: worker.id,
                      note: note || `Exception logged by ${currentUser.name}.`,
                      actor: currentUser.name,
                    })
                  )
                }
              >
                <FileWarning size={15} />
                Mark Exception
              </Button>
            ) : null}
          </>
        }
      />

      {feedback ? (
        <div className="ops-badge tone-info" style={{ alignSelf: "flex-start" }}>
          {feedback}
        </div>
      ) : null}

      <section className="ops-grid cols-2">
        <Card title="Profile Overview" subtitle="Current validation, attendance, and assignment status.">
          <div className="ops-worker-profile-hero">
            {worker.photoUrl ? (
              <img src={worker.photoUrl} alt={worker.fullName} className="ops-worker-profile-photo" />
            ) : (
              <div className="ops-worker-profile-photo ops-worker-profile-photo-placeholder">
                <Image size={22} />
                <span>{getInitials(worker.fullName)}</span>
              </div>
            )}
            <div>
              <div className="ops-item-title">{worker.fullName}</div>
              <div className="ops-row-subtitle">{worker.employeeId}</div>
              <div className="ops-row-subtitle">{worker.department} · {worker.roleTitle}</div>
            </div>
          </div>

          <div className="ops-card-divider" />

          <div className="ops-meta-grid">
            <div className="ops-key-value">
              <div className="ops-key-value-label">Assigned Line</div>
              <div className="ops-key-value-value">{currentLine?.name || "Unassigned"}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Shift</div>
              <div className="ops-key-value-value">{worker.shift}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Employment Status</div>
              <div className="ops-key-value-value">
                <StatusBadge
                  label={worker.employmentStatus === "resigned" ? "Resigned" : worker.employmentStatus === "inactive" ? "Inactive" : "Active"}
                  tone={worker.employmentStatus === "resigned" || worker.employmentStatus === "inactive" ? "danger" : "success"}
                />
              </div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">EPF No.</div>
              <div className="ops-key-value-value">{worker.epfNo || "Not set"}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Hire Date</div>
              <div className="ops-key-value-value">{formatOptionalDate(worker.hireDate)}</div>
            </div>
            {worker.employmentStatus === "resigned" ? (
              <div className="ops-key-value">
                <div className="ops-key-value-label">Resigned Date</div>
                <div className="ops-key-value-value">{formatOptionalDate(worker.resignedAt)}</div>
              </div>
            ) : null}
            <div className="ops-key-value">
              <div className="ops-key-value-label">Attendance Status</div>
              <div className="ops-key-value-value">
                <StatusBadge label={displayedAttendanceStatus} tone={attendanceTone(displayedAttendanceStatus)} />
              </div>
              {canDo("overrideAttendance") ? (
                <div className="ops-item-actions" style={{ marginTop: 12 }}>
                  <Button
                    tone="secondary"
                    disabled={attendanceSaving !== null || displayedAttendanceStatus === "Present"}
                    onClick={() => void changeAttendanceStatus("Present")}
                  >
                    <CheckCircle2 size={15} />
                    Present
                  </Button>
                  <Button
                    tone="danger"
                    disabled={attendanceSaving !== null || displayedAttendanceStatus === "Absent"}
                    onClick={() => void changeAttendanceStatus("Absent")}
                  >
                    <XCircle size={15} />
                    Absent
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Final Validation</div>
              <div className="ops-key-value-value">
                <StatusBadge label={worker.finalValidationStatus} tone={validationTone(worker.finalValidationStatus)} />
              </div>
            </div>
          </div>

          {worker.hrNotes || worker.resignationReason ? (
            <>
              <div className="ops-card-divider" />
              <div className="ops-meta-grid">
                {worker.resignationReason ? (
                  <div className="ops-key-value">
                    <div className="ops-key-value-label">Resignation Reason</div>
                    <div className="ops-key-value-value">{worker.resignationReason}</div>
                  </div>
                ) : null}
                {worker.hrNotes ? (
                  <div className="ops-key-value">
                    <div className="ops-key-value-label">HR Notes</div>
                    <div className="ops-key-value-value">{worker.hrNotes}</div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="ops-card-divider" />

          <div className="ops-stat-strip" style={{ marginTop: 18 }}>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Face Verification</div>
              <div className="ops-stat-value">{worker.faceVerificationStatus}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Fingerprint Verification</div>
              <div className="ops-stat-value">{worker.fingerprintVerificationStatus}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Transfer History</div>
              <div className="ops-stat-value">{transferLabel}</div>
            </div>
          </div>
        </Card>

        {canManageSkills ? (
          <Card title="Operation Skills" subtitle="Speciality operation skills and skill level percentages for this employee.">
          {skillError ? <div className="ops-alert-banner tone-danger">{skillError}</div> : null}
          {skillMessage ? <div className="ops-alert-banner tone-info">{skillMessage}</div> : null}

          {canManageSkills ? (
            <>
              <div className="ops-grid cols-2">
                <select
                  className="ops-select"
                  value={skillForm.operationId}
                  onChange={(event) =>
                    setSkillForm((current) => ({ ...current, operationId: event.target.value }))
                  }
                >
                  {skillMatrix.operations.map((operation) => (
                    <option key={operation.id} value={operation.id}>
                      {operation.name}
                    </option>
                  ))}
                </select>
                <input
                  className="ops-input"
                  type="number"
                  min="0"
                  max="100"
                  value={skillForm.skillLevelPercentage}
                  onChange={(event) =>
                    setSkillForm((current) => ({
                      ...current,
                      skillLevelPercentage: event.target.value,
                    }))
                  }
                  placeholder="Skill level %"
                />
              </div>
              <div className="ops-skill-form-grid">
                <label className="ops-skill-checkbox">
                  <input
                    type="checkbox"
                    checked={skillForm.isSpeciality}
                    onChange={(event) =>
                      setSkillForm((current) => ({
                        ...current,
                        isSpeciality: event.target.checked,
                      }))
                    }
                  />
                  Speciality skill
                </label>
                <input
                  className="ops-input"
                  value={skillForm.notes}
                  onChange={(event) =>
                    setSkillForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Skill note"
                />
              </div>
              <div className="ops-item-actions">
                <Button tone="primary" disabled={skillSaving || !skillForm.operationId} onClick={() => void saveSkill()}>
                  <Award size={15} />
                  Save Skill
                </Button>
              </div>
            </>
          ) : null}

          <div className="ops-list">
            {workerOperationSkills.map((skill) => (
              <div className="ops-list-item" key={skill.id}>
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{skill.operationName}</div>
                    <div className="ops-row-subtitle">
                      {skill.operationCode} · Skill {Math.round(skill.skillLevelPercentage)}%
                    </div>
                  </div>
                  <div className="ops-item-actions">
                    {skill.isSpeciality ? <StatusBadge label="Speciality" tone="violet" /> : null}
                    <StatusBadge label={`${Math.round(skill.skillLevelPercentage)}%`} tone="info" />
                    {canManageSkills ? (
                      <Button tone="danger" disabled={skillSaving} onClick={() => void deleteSkill(skill.id)}>
                        <Trash2 size={15} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {!workerOperationSkills.length ? (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No operation skills assigned</h3>
                <p>Add this employee's speciality skills and percentages to make them available for automatic replacement recommendations.</p>
              </div>
            ) : null}
          </div>
          </Card>
        ) : null}
      </section>

      <section className="ops-grid cols-2">
        <Card title="Supervisor Actions" subtitle="Line assignment, transfer, exception, and notes panel.">
          <div className="ops-filter-group">
            <label className="ops-filter-label" htmlFor="targetLine">
              Target Line
            </label>
            <select
              id="targetLine"
              className="ops-select"
              value={selectedLineId}
              onChange={(event) => setSelectedLineId(event.target.value)}
            >
              {availableLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name} · {line.actualManpower}/{line.targetManpower}
                </option>
              ))}
            </select>
          </div>

          <div className="ops-filter-group" style={{ marginTop: 14 }}>
            <label className="ops-filter-label" htmlFor="note">
              Note / Reason
            </label>
            <textarea
              id="note"
              className="ops-textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add supervisor remark, transfer reason, or exception note"
            />
          </div>

          <div className="ops-toolbar" style={{ marginTop: 16 }}>
            {canDo("addWorkerNote") ? (
              <Button
                tone="secondary"
                onClick={() =>
                  void handleActionResult(
                    addWorkerNote({
                      workerId: worker.id,
                      note: note || `Note added by ${currentUser.name}.`,
                      actor: currentUser.name,
                    })
                  )
                }
              >
                <NotebookPen size={15} />
                Add Note
              </Button>
            ) : null}
            {canDo("assignLine") ? (
              <Button
                tone="primary"
                onClick={() =>
                  void handleActionResult(
                    worker.currentLineId
                      ? transferWorker({
                          workerId: worker.id,
                          destinationLineId: selectedLineId,
                          reason: note || `Transfer action by ${currentUser.name}.`,
                          actor: currentUser.name,
                        })
                      : assignWorker({
                          workerId: worker.id,
                          lineId: selectedLineId,
                          reason: note || `Assignment action by ${currentUser.name}.`,
                          actor: currentUser.name,
                        })
                  )
                }
              >
                {worker.currentLineId ? "Transfer Line" : "Assign Line"}
              </Button>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Event Timeline" subtitle="Face, fingerprint, validation, assignment, and transfer history.">
          <div className="ops-timeline">
            {timeline.length ? (
              timeline.map((event) => (
                <div key={event.id} className="ops-timeline-item">
                  <div className="ops-timeline-dot">
                    <ShieldAlert size={12} />
                  </div>
                  <div className="ops-timeline-title">{event.label}</div>
                  <div className="ops-timeline-meta">{formatDateTime(event.timestamp)}</div>
                  <div className="ops-item-description">{event.detail}</div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No validation timeline available"
                description="This worker does not have a recent validation timeline yet."
              />
            )}
          </div>
        </Card>

        <Card title="Attendance Summary" subtitle="Payroll-ready attendance, OT, leave, and incentive context.">
          <div className="ops-stat-strip">
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Days Present</div>
              <div className="ops-stat-value">{attendanceSummary?.daysPresent || 0}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">OT Hours</div>
              <div className="ops-stat-value">{attendanceSummary?.otHours || 0}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Leave Days</div>
              <div className="ops-stat-value">{attendanceSummary?.leaveDays || 0}</div>
            </div>
            <div className="ops-stat-tile">
              <div className="ops-stat-label">Final Total</div>
              <div className="ops-stat-value">
                {attendanceSummary ? formatCurrency(attendanceSummary.finalTotal) : "N/A"}
              </div>
            </div>
          </div>

          <div className="ops-card-divider" />

          <div className="ops-list" style={{ marginTop: 18 }}>
            {workerOt.map((record) => (
              <div key={record.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div className="ops-item-title">OT approved</div>
                  <StatusBadge label={`${record.hours}h`} tone="info" />
                </div>
                <div className="ops-item-meta">
                  <span>{record.date}</span>
                  <span>{record.approvedBy}</span>
                </div>
              </div>
            ))}
            {profileLeaveRequests.map((record) => (
              <div key={record.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">
                      {formatLeaveLabel(record.leaveType)} · {formatLeaveLabel(record.leaveCategory)}
                    </div>
                    <div className="ops-row-subtitle">
                      {record.startDate}
                      {record.endDate !== record.startDate ? ` to ${record.endDate}` : ""}
                      {record.startTime && record.endTime ? ` · ${record.startTime.slice(0, 5)}-${record.endTime.slice(0, 5)}` : ""}
                    </div>
                  </div>
                  <StatusBadge label={formatLeaveLabel(record.status)} tone={leaveStatusTone(record.status)} />
                </div>
                <div className="ops-item-meta">
                  <span>{record.dayCount ? `${record.dayCount} day(s)` : "Short leave"}</span>
                  <span>{record.requestedBy ? `Requested by ${record.requestedBy}` : "Requested"}</span>
                </div>
                {record.reason ? <div className="ops-item-description">{record.reason}</div> : null}
                {record.reviewNote ? <div className="ops-item-description">Review note: {record.reviewNote}</div> : null}
              </div>
            ))}
            {workerLeave.map((record) => (
              <div key={record.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div className="ops-item-title">{record.type} leave</div>
                  <StatusBadge label={record.status} tone="neutral" />
                </div>
                <div className="ops-item-meta">
                  <span>
                    {record.startDate} to {record.endDate}
                  </span>
                  <span>{record.days} day(s)</span>
                </div>
              </div>
            ))}
            {profileLeaveError ? (
              <div className="ops-alert-banner tone-danger">{profileLeaveError}</div>
            ) : null}
            {!workerOt.length && !profileLeaveRequests.length && !workerLeave.length && !profileLeaveError ? (
              <EmptyState
                title="No attendance records"
                description="No OT, approved leave, or imported leave records are available for this employee yet."
              />
            ) : null}
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Transfer History" subtitle="Line movement log with source, destination, and supervisor reason.">
          <div className="ops-list">
            {workerTransfers.length ? (
              workerTransfers.map((record) => (
                <div key={record.id} className="ops-list-item">
                  <div className="ops-item-header">
                    <div className="ops-item-title">
                      {findLine(lines, record.sourceLineId)?.name || "Pool"} →{" "}
                      {findLine(lines, record.destinationLineId)?.name || "Pool"}
                    </div>
                    <StatusBadge label={record.transferredBy} tone="neutral" />
                  </div>
                  <div className="ops-item-description">{record.reason}</div>
                  <div className="ops-item-meta">
                    <span>{formatDateTime(record.transferredAt)}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No transfer history"
                description="This worker has not been moved between lines in the current operational history."
              />
            )}
          </div>
        </Card>

        <Card title="Notes, Flags & Remarks" subtitle="Supervisor notes and operational flags attached to the worker profile.">
          <div className="ops-list">
            {worker.notes.map((entry) => (
              <div key={entry} className="ops-list-item">
                <div className="ops-item-title">Note</div>
                <div className="ops-item-description">{entry}</div>
              </div>
            ))}
            {worker.flags.map((entry) => (
              <div key={entry} className="ops-list-item">
                <div className="ops-item-title">Flag</div>
                <div className="ops-item-description">{entry}</div>
              </div>
            ))}
            {worker.supervisorRemarks.map((entry) => (
              <div key={entry} className="ops-list-item">
                <div className="ops-item-title">Supervisor remark</div>
                <div className="ops-item-description">{entry}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export default WorkerProfilePage;
