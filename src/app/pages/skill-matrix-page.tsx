import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { Award, BadgeCheck, Brain, CalendarDays, Clock3, Eye, EyeOff, Layers3, ListPlus, Pencil, RefreshCcw, Trash2 } from "lucide-react";
import {
  cancelLineStyleScheduleFromBackend,
  deleteLineOperationFromBackend,
  deleteStylePlanFromBackend,
  deleteStylePlanMachineFromBackend,
  getLineAutomaticRecommendationsFromBackend,
  getSkillMatrixFromBackend,
  saveLineStyleScheduleFromBackend,
  saveLineOperationFromBackend,
  saveSkillOperationFromBackend,
  saveStylePlanFromBackend,
  saveStylePlanMachineFromBackend,
} from "@/lib/backend/skill-matrix-api";
import type {
  LineAutomaticRecommendation,
  LineStyleSchedule,
  LineOperation,
  SkillCandidate,
  SkillMatrixSnapshot,
  StyleOperationPlan,
  StyleOperationPlanMachine,
} from "@/types/skill-matrix";
import { useAuth } from "../auth";
import { Button, Card, KpiCard, PageHeader, StatusBadge, WorkerChip, formatDateTime } from "../components/ops-ui";
import type { AttendanceStatus, WorkerProfile } from "../types";

const EMPTY_MATRIX: SkillMatrixSnapshot = {
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

function toPercent(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "0%";
}

function formatMachineLabel(machineNumber: string) {
  const trimmed = machineNumber.trim();
  if (!trimmed) return "";

  const numericMachine = Number(trimmed);
  if (Number.isFinite(numericMachine) && numericMachine > 0) {
    return `Machine ${String(Math.trunc(numericMachine)).padStart(2, "0")}`;
  }

  return trimmed.toLowerCase().startsWith("machine") ? trimmed : `Machine ${trimmed}`;
}

function machineSequence(machineNumber: string) {
  const numericMachine = Number(machineNumber.trim());
  return Number.isFinite(numericMachine) && numericMachine > 0 ? Math.trunc(numericMachine) : 0;
}

function machineInputValue(positionLabel: string) {
  const match = positionLabel.match(/\d+/);
  if (match) return String(Number(match[0]));
  return positionLabel.replace(/^machine\s*/i, "").trim() || "1";
}

function toDateInputValue(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function toLocalIso(dateText: string, timeText: string) {
  if (!dateText || !timeText) return "";
  return new Date(`${dateText}T${timeText}:00`).toISOString();
}

function scheduleTone(schedule: LineStyleSchedule): "success" | "warning" | "danger" | "info" | "neutral" {
  if (schedule.status === "active") return "success";
  if (schedule.status === "scheduled") return "info";
  if (schedule.status === "completed") return "neutral";
  if (schedule.status === "cancelled") return "danger";
  return "warning";
}

function candidateTone(candidate: SkillCandidate) {
  if (!candidate.availableNow) return "danger";
  if (candidate.currentLineName) return "warning";
  return "success";
}

function candidateWorker(candidate: SkillCandidate): WorkerProfile {
  return {
    id: candidate.employeeId,
    employeeId: candidate.employeeCode,
    fullName: candidate.fullName,
    photoUrl: candidate.photoUrl || undefined,
    department: candidate.department || "Unassigned",
    roleTitle: candidate.designation || "Worker",
    currentLineId: candidate.currentLineId || undefined,
    shift: "Shift A",
    attendanceStatus: candidate.attendanceStatus as AttendanceStatus,
    faceVerificationStatus: "Pending",
    fingerprintVerificationStatus: "Pending",
    finalValidationStatus: "Pending Validation",
    currentStatus: candidate.availableNow ? "On Line" : "Off Shift",
    skills: [],
    notes: [],
    flags: [],
    supervisorRemarks: [],
    phone: "",
    joinDate: "",
  };
}

export function SkillMatrixPage() {
  const { currentUser } = useAuth();
  const [matrix, setMatrix] = useState<SkillMatrixSnapshot>(EMPTY_MATRIX);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<Date>(new Date());
  const [automaticRecommendations, setAutomaticRecommendations] = useState<LineAutomaticRecommendation[]>([]);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [operationForm, setOperationForm] = useState({
    operationCode: "",
    name: "",
    category: "",
    description: "",
  });
  const [stylePlanForm, setStylePlanForm] = useState({
    styleNumber: "",
    version: "1",
    description: "",
  });
  const [editingStylePlanId, setEditingStylePlanId] = useState<string | null>(null);
  const [expandedStylePlanId, setExpandedStylePlanId] = useState<string | null>(null);
  const [editingStylePlanMachineId, setEditingStylePlanMachineId] = useState<string | null>(null);
  const [stylePlanMachineForm, setStylePlanMachineForm] = useState({
    styleOperationPlanId: "",
    operationId: "",
    machineNumber: "1",
    requiredSkillPercentage: "60",
    stationType: "mo" as "mo" | "helper" | "other",
  });
  const [scheduleForm, setScheduleForm] = useState({
    productionLineId: "",
    styleOperationPlanId: "",
    scheduledDate: toDateInputValue(new Date()),
    scheduledTime: "07:30",
    scheduledEndDate: "",
    scheduledEndTime: "",
    shiftName: "Shift A",
    notes: "",
  });
  const [lineOperationForm, setLineOperationForm] = useState({
    operationId: "",
    machineNumber: "1",
    requiredSkillPercentage: "60",
  });
  const loadMatrix = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextMatrix = await getSkillMatrixFromBackend();
      setMatrix(nextMatrix);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const loadAutomaticRecommendations = async (lineId = selectedLineId) => {
    if (!lineId) {
      setAutomaticRecommendations([]);
      return;
    }
    setRecommendationLoading(true);
    setError(null);
    try {
      const response = await getLineAutomaticRecommendationsFromBackend(lineId);
      setAutomaticRecommendations(response.recommendations);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRecommendationLoading(false);
    }
  };

  useEffect(() => {
    void loadMatrix();
  }, []);

  useEffect(() => {
    if (!selectedLineId && matrix.lines[0]) {
      setSelectedLineId(matrix.lines[0].id);
    }
    if (!lineOperationForm.operationId && matrix.operations[0]) {
      setLineOperationForm((current) => ({ ...current, operationId: matrix.operations[0].id }));
    }
    const styleMachinePlanExists = matrix.stylePlans.some((plan) => plan.id === stylePlanMachineForm.styleOperationPlanId);
    const schedulePlanExists = matrix.stylePlans.some((plan) => plan.id === scheduleForm.styleOperationPlanId);
    if ((!stylePlanMachineForm.styleOperationPlanId || !styleMachinePlanExists) && matrix.stylePlans[0]) {
      setStylePlanMachineForm((current) => ({
        ...current,
        styleOperationPlanId: matrix.stylePlans[0].id,
      }));
    }
    if (!stylePlanMachineForm.operationId && matrix.operations[0]) {
      setStylePlanMachineForm((current) => ({ ...current, operationId: matrix.operations[0].id }));
    }
    if (!scheduleForm.productionLineId && matrix.lines[0]) {
      setScheduleForm((current) => ({ ...current, productionLineId: matrix.lines[0].id }));
    }
    if ((!scheduleForm.styleOperationPlanId || !schedulePlanExists) && matrix.stylePlans[0]) {
      setScheduleForm((current) => ({ ...current, styleOperationPlanId: matrix.stylePlans[0].id }));
    }
    if (expandedStylePlanId && !matrix.stylePlans.some((plan) => plan.id === expandedStylePlanId)) {
      setExpandedStylePlanId(matrix.stylePlans[0]?.id ?? null);
    }
  }, [
    expandedStylePlanId,
    lineOperationForm.operationId,
    matrix,
    scheduleForm.productionLineId,
    scheduleForm.styleOperationPlanId,
    selectedLineId,
    stylePlanMachineForm.operationId,
    stylePlanMachineForm.styleOperationPlanId,
  ]);

  useEffect(() => {
    void loadAutomaticRecommendations(selectedLineId);
  }, [selectedLineId]);

  const selectedLineOperations = useMemo(
    () =>
      matrix.lineOperations
        .filter((item) => item.productionLineId === selectedLineId)
        .sort((a, b) => a.sequenceNo - b.sequenceNo || a.positionLabel.localeCompare(b.positionLabel)),
    [matrix.lineOperations, selectedLineId]
  );
  const selectedStylePlanMachines = useMemo(
    () =>
      matrix.stylePlanMachines
        .filter((item) => item.styleOperationPlanId === stylePlanMachineForm.styleOperationPlanId)
        .sort((a, b) => a.sequenceNo - b.sequenceNo || a.positionLabel.localeCompare(b.positionLabel)),
    [matrix.stylePlanMachines, stylePlanMachineForm.styleOperationPlanId]
  );
  const stylePlanMachinesByPlan = useMemo(() => {
    const groups = new Map<string, StyleOperationPlanMachine[]>();
    matrix.stylePlanMachines.forEach((machine) => {
      const current = groups.get(machine.styleOperationPlanId) ?? [];
      current.push(machine);
      groups.set(machine.styleOperationPlanId, current);
    });
    groups.forEach((machines) =>
      machines.sort((a, b) => a.sequenceNo - b.sequenceNo || a.positionLabel.localeCompare(b.positionLabel))
    );
    return groups;
  }, [matrix.stylePlanMachines]);
  const schedulesByStylePlan = useMemo(() => {
    const groups = new Map<string, LineStyleSchedule[]>();
    matrix.lineStyleSchedules.forEach((schedule) => {
      const current = groups.get(schedule.styleOperationPlanId) ?? [];
      current.push(schedule);
      groups.set(schedule.styleOperationPlanId, current);
    });
    groups.forEach((schedules) => schedules.sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt)));
    return groups;
  }, [matrix.lineStyleSchedules]);
  const visibleSchedules = useMemo(
    () =>
      [...matrix.lineStyleSchedules]
        .sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt))
        .slice(0, 12),
    [matrix.lineStyleSchedules]
  );

  const topEmployeeSkills = useMemo(
    () => [...matrix.employeeSkills].sort((a, b) => b.skillLevelPercentage - a.skillLevelPercentage).slice(0, 12),
    [matrix.employeeSkills]
  );

  const skillAverage =
    matrix.employeeSkills.length === 0
      ? 0
      : matrix.employeeSkills.reduce((sum, row) => sum + row.skillLevelPercentage, 0) /
        matrix.employeeSkills.length;
  const scheduledCount = matrix.lineStyleSchedules.filter((schedule) => schedule.status === "scheduled").length;
  const activeStyleCount = matrix.lineStyleSchedules.filter((schedule) => schedule.status === "active").length;
  const canPlanSkills = ["super_admin", "admin", "supervisor", "hr"].includes(currentUser.role);

  const setMatrixFromSave = (nextMatrix: SkillMatrixSnapshot, nextMessage: string) => {
    setMatrix(nextMatrix);
    setMessage(nextMessage);
    setError(null);
  };

  const saveOperation = async () => {
    setSaving(true);
    try {
      const nextMatrix = await saveSkillOperationFromBackend({
        operationCode: operationForm.operationCode,
        name: operationForm.name,
        category: operationForm.category || null,
        description: operationForm.description || null,
        isActive: true,
      });
      setOperationForm({ operationCode: "", name: "", category: "", description: "" });
      setMatrixFromSave(nextMatrix, "Operation saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const saveLineOperation = async () => {
    setSaving(true);
    try {
      const nextMatrix = await saveLineOperationFromBackend({
        productionLineId: selectedLineId,
        operationId: lineOperationForm.operationId,
        positionLabel: formatMachineLabel(lineOperationForm.machineNumber),
        requiredSkillPercentage: Number(lineOperationForm.requiredSkillPercentage),
        plannedOperators: 1,
        sequenceNo: machineSequence(lineOperationForm.machineNumber),
        isActive: true,
      });
      setLineOperationForm((current) => ({
        ...current,
        machineNumber: String(machineSequence(current.machineNumber) + 1 || 1),
      }));
      setMatrixFromSave(nextMatrix, "Machine operation saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const resetStylePlanForm = () => {
    setEditingStylePlanId(null);
    setStylePlanForm({ styleNumber: "", version: "1", description: "" });
  };

  const startEditingStylePlan = (plan: StyleOperationPlan) => {
    setEditingStylePlanId(plan.id);
    setExpandedStylePlanId(plan.id);
    setStylePlanForm({
      styleNumber: plan.styleNumber,
      version: String(plan.version || 1),
      description: plan.description || "",
    });
    setStylePlanMachineForm((current) => ({ ...current, styleOperationPlanId: plan.id }));
    setScheduleForm((current) => ({ ...current, styleOperationPlanId: plan.id }));
  };

  const saveStylePlan = async () => {
    setSaving(true);
    try {
      const version = Math.max(1, Number(stylePlanForm.version) || 1);
      const nextMatrix = await saveStylePlanFromBackend({
        id: editingStylePlanId || undefined,
        styleNumber: stylePlanForm.styleNumber,
        version,
        description: stylePlanForm.description || null,
        isActive: true,
      });
      const nextPlan =
        nextMatrix.stylePlans.find((plan) => plan.id === editingStylePlanId) ??
        nextMatrix.stylePlans.find((plan) => plan.styleNumber === stylePlanForm.styleNumber && plan.version === version);
      if (nextPlan) {
        setStylePlanMachineForm((current) => ({ ...current, styleOperationPlanId: nextPlan.id }));
        setScheduleForm((current) => ({ ...current, styleOperationPlanId: nextPlan.id }));
        setExpandedStylePlanId(nextPlan.id);
      }
      resetStylePlanForm();
      setMatrixFromSave(nextMatrix, editingStylePlanId ? "Style operation plan updated." : "Style operation plan saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const deleteStylePlan = async (plan: StyleOperationPlan) => {
    if (!window.confirm(`Delete style ${plan.styleNumber} v${plan.version} and its machine details?`)) return;

    setSaving(true);
    try {
      const nextMatrix = await deleteStylePlanFromBackend(plan.id);
      if (editingStylePlanId === plan.id) resetStylePlanForm();
      if (editingStylePlanMachineId) setEditingStylePlanMachineId(null);
      setExpandedStylePlanId((current) =>
        current === plan.id ? nextMatrix.stylePlans[0]?.id ?? null : current
      );
      setMatrixFromSave(nextMatrix, "Style operation plan deleted.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const resetStylePlanMachineForm = () => {
    setEditingStylePlanMachineId(null);
    setStylePlanMachineForm((current) => ({
      ...current,
      machineNumber: "1",
      requiredSkillPercentage: "60",
      stationType: "mo",
    }));
  };

  const startEditingStylePlanMachine = (machine: StyleOperationPlanMachine) => {
    setEditingStylePlanMachineId(machine.id);
    setExpandedStylePlanId(machine.styleOperationPlanId);
    setStylePlanMachineForm({
      styleOperationPlanId: machine.styleOperationPlanId,
      operationId: machine.operationId,
      machineNumber: machineInputValue(machine.positionLabel),
      requiredSkillPercentage: String(Math.round(machine.requiredSkillPercentage || 0)),
      stationType: machine.stationType,
    });
  };

  const saveStylePlanMachine = async () => {
    setSaving(true);
    try {
      const isEditingMachine = Boolean(editingStylePlanMachineId);
      const nextMatrix = await saveStylePlanMachineFromBackend({
        id: editingStylePlanMachineId || undefined,
        styleOperationPlanId: stylePlanMachineForm.styleOperationPlanId,
        operationId: stylePlanMachineForm.operationId,
        positionLabel: formatMachineLabel(stylePlanMachineForm.machineNumber),
        requiredSkillPercentage: Number(stylePlanMachineForm.requiredSkillPercentage),
        plannedOperators: 1,
        stationType: stylePlanMachineForm.stationType,
        sequenceNo: machineSequence(stylePlanMachineForm.machineNumber),
        isActive: true,
      });
      if (isEditingMachine) {
        setEditingStylePlanMachineId(null);
      } else {
        setStylePlanMachineForm((current) => ({
          ...current,
          machineNumber: String(machineSequence(current.machineNumber) + 1 || 1),
        }));
      }
      setExpandedStylePlanId(stylePlanMachineForm.styleOperationPlanId);
      setMatrixFromSave(nextMatrix, isEditingMachine ? "Style machine operation updated." : "Style machine operation saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const deleteStylePlanMachine = async (machine: StyleOperationPlanMachine) => {
    setSaving(true);
    try {
      if (editingStylePlanMachineId === machine.id) setEditingStylePlanMachineId(null);
      setMatrixFromSave(await deleteStylePlanMachineFromBackend(machine.id), "Style machine operation removed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const saveLineStyleSchedule = async () => {
    setSaving(true);
    try {
      const scheduledStartAt = toLocalIso(scheduleForm.scheduledDate, scheduleForm.scheduledTime);
      const scheduledEndAt =
        scheduleForm.scheduledEndDate && scheduleForm.scheduledEndTime
          ? toLocalIso(scheduleForm.scheduledEndDate, scheduleForm.scheduledEndTime)
          : null;
      const nextMatrix = await saveLineStyleScheduleFromBackend({
        productionLineId: scheduleForm.productionLineId,
        styleOperationPlanId: scheduleForm.styleOperationPlanId,
        scheduledStartAt,
        scheduledEndAt,
        shiftName: scheduleForm.shiftName,
        notes: scheduleForm.notes || null,
        status: "scheduled",
      });
      setScheduleForm((current) => ({ ...current, notes: "" }));
      setMatrixFromSave(nextMatrix, "Line style schedule saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const cancelLineStyleSchedule = async (schedule: LineStyleSchedule) => {
    setSaving(true);
    try {
      setMatrixFromSave(await cancelLineStyleScheduleFromBackend(schedule.id), "Line style schedule cancelled.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const deleteLineOperation = async (lineOperation: LineOperation) => {
    setSaving(true);
    try {
      setMatrixFromSave(await deleteLineOperationFromBackend(lineOperation.id), "Machine operation removed.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ops-page">
      <PageHeader
        title="Skill Matrix"
        subtitle="Plan machine operations, monitor employee skill coverage, and review automatic replacement recommendations."
        actions={
          <Button
            tone="secondary"
            onClick={() => {
              void loadMatrix();
              void loadAutomaticRecommendations();
            }}
          >
            <RefreshCcw size={16} />
            Refresh
          </Button>
        }
      />

      {error ? <div className="ops-alert-banner tone-danger">{error}</div> : null}
      {message ? <div className="ops-alert-banner tone-info">{message}</div> : null}

      <section className="ops-kpi-grid">
        <KpiCard
          label="Operations"
          value={loading ? "Loading" : `${matrix.operations.length}`}
          meta="Active operation types available for line planning."
          icon={ListPlus}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Machine Operations"
          value={`${matrix.lineOperations.length}`}
          meta="Configured machine-to-operation mappings across active lines."
          icon={BadgeCheck}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Mapped Machines"
          value={`${matrix.linePositionAssignments.length}`}
          meta="Employees linked to configured floor-plan machines."
          icon={BadgeCheck}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Employee Skills"
          value={`${matrix.employeeSkills.length}`}
          meta="Employee operation skill records maintained on worker profiles."
          icon={Award}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Style Plans"
          value={`${matrix.stylePlans.length}`}
          meta="Style-specific machine plans prepared for current or upcoming production."
          icon={Layers3}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Scheduled Styles"
          value={`${scheduledCount}`}
          meta={`${activeStyleCount} active style schedule(s) currently running.`}
          icon={CalendarDays}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Average Skill"
          value={toPercent(skillAverage)}
          meta="Average percentage across all recorded employee skills."
          icon={Brain}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card title="Operations Library" subtitle="Create the operation catalogue used by line plans and employee skills.">
          <div className="ops-skill-form-grid">
            <input
              className="ops-input"
              value={operationForm.operationCode}
              onChange={(event) => setOperationForm((current) => ({ ...current, operationCode: event.target.value }))}
              placeholder="Code, e.g. SNGL-NDL"
            />
            <input
              className="ops-input"
              value={operationForm.name}
              onChange={(event) => setOperationForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Operation name"
            />
            <input
              className="ops-input"
              value={operationForm.category}
              onChange={(event) => setOperationForm((current) => ({ ...current, category: event.target.value }))}
              placeholder="Category"
            />
            <input
              className="ops-input"
              value={operationForm.description}
              onChange={(event) => setOperationForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Description"
            />
          </div>
          <div className="ops-item-actions">
            <Button tone="primary" disabled={saving} onClick={() => void saveOperation()}>
              <ListPlus size={16} />
              Save Operation
            </Button>
          </div>
          <div className="ops-list ops-scroll-list is-tall">
            {matrix.operations.map((operation) => (
              <div className="ops-list-item" key={operation.id}>
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{operation.name}</div>
                    <div className="ops-row-subtitle">
                      {operation.operationCode} · {operation.category || "Uncategorised"}
                    </div>
                  </div>
                  <StatusBadge label="Active" tone="success" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Line Machine Operation Plan" subtitle="Choose a line, machine number, and the operation assigned to that machine.">
          <div className="ops-grid cols-2">
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="machine-plan-line">Production line</label>
              <select
                id="machine-plan-line"
                className="ops-select"
                value={selectedLineId}
                onChange={(event) => setSelectedLineId(event.target.value)}
              >
                {matrix.lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name} · {line.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="machine-plan-operation">Operation</label>
              <select
                id="machine-plan-operation"
                className="ops-select"
                value={lineOperationForm.operationId}
                onChange={(event) =>
                  setLineOperationForm((current) => ({ ...current, operationId: event.target.value }))
                }
              >
                {matrix.operations.map((operation) => (
                  <option key={operation.id} value={operation.id}>
                    {operation.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {canPlanSkills ? (
            <>
              <div className="ops-skill-form-grid">
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="machine-plan-number">Machine number</label>
                  <input
                    id="machine-plan-number"
                    className="ops-input"
                    type="number"
                    min="1"
                    value={lineOperationForm.machineNumber}
                    onChange={(event) =>
                      setLineOperationForm((current) => ({ ...current, machineNumber: event.target.value }))
                    }
                    placeholder="Example: 1"
                  />
                </div>
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="machine-plan-skill">Minimum skill percentage</label>
                  <input
                    id="machine-plan-skill"
                    className="ops-input"
                    type="number"
                    min="0"
                    max="100"
                    value={lineOperationForm.requiredSkillPercentage}
                    onChange={(event) =>
                      setLineOperationForm((current) => ({ ...current, requiredSkillPercentage: event.target.value }))
                    }
                    placeholder="Example: 60"
                  />
                </div>
              </div>
              <div className="ops-item-actions">
                <Button tone="primary" disabled={saving} onClick={() => void saveLineOperation()}>
                  <BadgeCheck size={16} />
                  Save Machine Operation
                </Button>
              </div>
            </>
          ) : null}
          <div className="ops-list ops-scroll-list is-tall">
            {selectedLineOperations.map((item) => (
              <div key={item.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{item.positionLabel}</div>
                    <div className="ops-row-subtitle">
                      {item.operationName} · Minimum skill {toPercent(item.requiredSkillPercentage)}
                    </div>
                  </div>
                  <div className="ops-item-actions">
                    <StatusBadge
                      label={`${matrix.linePositionAssignments.filter((assignment) => assignment.lineOperationId === item.id).length} mapped`}
                      tone="info"
                    />
                    {canPlanSkills ? (
                      <Button tone="danger" disabled={saving} onClick={() => void deleteLineOperation(item)}>
                        <Trash2 size={15} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {!selectedLineOperations.length ? (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No machine operations assigned</h3>
                <p>Add machine numbers and operations for the selected production line.</p>
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Style Operation Plans" subtitle="Create, review, update, and delete reusable machine operation plans for style numbers.">
          {canPlanSkills ? (
            <>
              <div className="ops-skill-form-grid">
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="style-plan-number">Style number</label>
                  <input
                    id="style-plan-number"
                    className="ops-input"
                    value={stylePlanForm.styleNumber}
                    onChange={(event) =>
                      setStylePlanForm((current) => ({ ...current, styleNumber: event.target.value }))
                    }
                    placeholder="Example: 232109"
                  />
                </div>
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="style-plan-version">Version</label>
                  <input
                    id="style-plan-version"
                    className="ops-input"
                    type="number"
                    min="1"
                    value={stylePlanForm.version}
                    onChange={(event) =>
                      setStylePlanForm((current) => ({ ...current, version: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="ops-form-field" style={{ marginBottom: 14 }}>
                <label className="ops-filter-label" htmlFor="style-plan-description">Description</label>
                <input
                  id="style-plan-description"
                  className="ops-input"
                  value={stylePlanForm.description}
                  onChange={(event) =>
                    setStylePlanForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Optional style planning note"
                />
              </div>
              <div className="ops-item-actions">
                <Button tone="primary" disabled={saving || !stylePlanForm.styleNumber} onClick={() => void saveStylePlan()}>
                  <Layers3 size={16} />
                  {editingStylePlanId ? "Update Style Plan" : "Save Style Plan"}
                </Button>
                {editingStylePlanId ? (
                  <Button tone="secondary" disabled={saving} onClick={resetStylePlanForm}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="ops-card-divider" />

          <div className="ops-style-section-heading">
            <div>
              <div className="ops-item-title">Saved style plans</div>
              <div className="ops-row-subtitle">Expand a style to see its planned machines, schedules, and planning notes.</div>
            </div>
          </div>

          <div className="ops-list">
            {matrix.stylePlans.map((plan) => {
              const planMachines = stylePlanMachinesByPlan.get(plan.id) ?? [];
              const planSchedules = schedulesByStylePlan.get(plan.id) ?? [];
              const expanded = expandedStylePlanId === plan.id;

              return (
                <div className="ops-list-item" key={plan.id}>
                  <div className="ops-item-header">
                    <div>
                      <div className="ops-item-title">Style {plan.styleNumber} · v{plan.version}</div>
                      <div className="ops-row-subtitle">
                        {plan.description || "No planning note"} · {planMachines.length} machine operation(s) ·{" "}
                        {planSchedules.length} schedule(s)
                      </div>
                      {plan.updatedAt ? <div className="ops-row-subtitle">Updated {formatDateTime(plan.updatedAt)}</div> : null}
                    </div>
                    <div className="ops-item-actions">
                      <StatusBadge label={plan.isActive ? "Active" : "Inactive"} tone={plan.isActive ? "success" : "neutral"} />
                      <Button
                        tone="secondary"
                        disabled={saving}
                        onClick={() => setExpandedStylePlanId(expanded ? null : plan.id)}
                      >
                        {expanded ? <EyeOff size={15} /> : <Eye size={15} />}
                        {expanded ? "Hide Details" : "View Details"}
                      </Button>
                      {canPlanSkills ? (
                        <>
                          <Button tone="secondary" disabled={saving} onClick={() => startEditingStylePlan(plan)}>
                            <Pencil size={15} />
                            Edit
                          </Button>
                          <Button tone="danger" disabled={saving} onClick={() => void deleteStylePlan(plan)}>
                            <Trash2 size={15} />
                            Delete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {expanded ? (
                    <div className="ops-style-plan-details">
                      <div className="ops-grid cols-2">
                        <div>
                          <div className="ops-filter-label">Machine details</div>
                          <div className="ops-list ops-scroll-list is-compact">
                            {planMachines.map((machine) => (
                              <div className="ops-list-item compact" key={machine.id}>
                                <div className="ops-item-header">
                                  <div>
                                    <div className="ops-item-title">{machine.positionLabel}</div>
                                    <div className="ops-row-subtitle">
                                      {machine.operationName} · {machine.stationType.toUpperCase()} · Minimum skill{" "}
                                      {toPercent(machine.requiredSkillPercentage)}
                                    </div>
                                  </div>
                                  {canPlanSkills ? (
                                    <Button tone="secondary" disabled={saving} onClick={() => startEditingStylePlanMachine(machine)}>
                                      <Pencil size={15} />
                                      Edit
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                            {!planMachines.length ? (
                              <div className="ops-empty-state compact">
                                <h3>No machine details</h3>
                                <p>Add machine numbers and operations below.</p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div>
                          <div className="ops-filter-label">Schedule details</div>
                          <div className="ops-list ops-scroll-list is-compact">
                            {planSchedules.map((schedule) => (
                              <div className="ops-list-item compact" key={schedule.id}>
                                <div className="ops-item-header">
                                  <div>
                                    <div className="ops-item-title">{schedule.lineName || "Line"} · {schedule.shiftName}</div>
                                    <div className="ops-row-subtitle">
                                      Starts {formatDateTime(schedule.scheduledStartAt)}
                                      {schedule.scheduledEndAt ? ` · Ends ${formatDateTime(schedule.scheduledEndAt)}` : ""}
                                    </div>
                                    {schedule.notes ? <div className="ops-row-subtitle">{schedule.notes}</div> : null}
                                  </div>
                                  <StatusBadge label={schedule.status} tone={scheduleTone(schedule)} />
                                </div>
                              </div>
                            ))}
                            {!planSchedules.length ? (
                              <div className="ops-empty-state compact">
                                <h3>No schedules</h3>
                                <p>This style has not been scheduled to a line yet.</p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!matrix.stylePlans.length ? (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No saved styles yet</h3>
                <p>Create the first style plan, then add machine-level operation details.</p>
              </div>
            ) : null}
          </div>

          <div className="ops-card-divider" />

          <div className="ops-style-section-heading">
            <div>
              <div className="ops-item-title">Machine details for selected style</div>
              <div className="ops-row-subtitle">
                {editingStylePlanMachineId ? "Editing one saved machine row. Save to update it or cancel to create a new row." : "Add or update machine operations for the selected style."}
              </div>
            </div>
          </div>

          <div className="ops-grid cols-2">
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-plan-machine-style">Style plan</label>
              <select
                id="style-plan-machine-style"
                className="ops-select"
                value={stylePlanMachineForm.styleOperationPlanId}
                onChange={(event) =>
                  setStylePlanMachineForm((current) => ({
                    ...current,
                    styleOperationPlanId: event.target.value,
                  }))
                }
              >
                {matrix.stylePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    Style {plan.styleNumber} · v{plan.version}
                  </option>
                ))}
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-plan-machine-operation">Operation</label>
              <select
                id="style-plan-machine-operation"
                className="ops-select"
                value={stylePlanMachineForm.operationId}
                onChange={(event) =>
                  setStylePlanMachineForm((current) => ({ ...current, operationId: event.target.value }))
                }
              >
                {matrix.operations.map((operation) => (
                  <option key={operation.id} value={operation.id}>
                    {operation.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {canPlanSkills ? (
            <>
              <div className="ops-skill-form-grid">
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="style-plan-machine-number">Machine number</label>
                  <input
                    id="style-plan-machine-number"
                    className="ops-input"
                    type="number"
                    min="1"
                    value={stylePlanMachineForm.machineNumber}
                    onChange={(event) =>
                      setStylePlanMachineForm((current) => ({ ...current, machineNumber: event.target.value }))
                    }
                  />
                </div>
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="style-plan-machine-skill">Minimum skill percentage</label>
                  <input
                    id="style-plan-machine-skill"
                    className="ops-input"
                    type="number"
                    min="0"
                    max="100"
                    value={stylePlanMachineForm.requiredSkillPercentage}
                    onChange={(event) =>
                      setStylePlanMachineForm((current) => ({
                        ...current,
                        requiredSkillPercentage: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="ops-form-field">
                  <label className="ops-filter-label" htmlFor="style-plan-machine-station">Station type</label>
                  <select
                    id="style-plan-machine-station"
                    className="ops-select"
                    value={stylePlanMachineForm.stationType}
                    onChange={(event) =>
                      setStylePlanMachineForm((current) => ({
                        ...current,
                        stationType: event.target.value as "mo" | "helper" | "other",
                      }))
                    }
                  >
                    <option value="mo">Machine Operator</option>
                    <option value="helper">Helper</option>
                    <option value="other">Other Employee</option>
                  </select>
                </div>
              </div>
              <div className="ops-item-actions">
                <Button
                  tone="primary"
                  disabled={
                    saving ||
                    !stylePlanMachineForm.styleOperationPlanId ||
                    !stylePlanMachineForm.operationId
                  }
                  onClick={() => void saveStylePlanMachine()}
                >
                  <BadgeCheck size={16} />
                  {editingStylePlanMachineId ? "Update Style Machine" : "Save Style Machine"}
                </Button>
                {editingStylePlanMachineId ? (
                  <Button tone="secondary" disabled={saving} onClick={resetStylePlanMachineForm}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="ops-list ops-scroll-list is-tall">
            {selectedStylePlanMachines.map((machine) => (
              <div key={machine.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{machine.positionLabel}</div>
                    <div className="ops-row-subtitle">
                      {machine.operationName} · {machine.stationType.toUpperCase()} · Minimum skill{" "}
                      {toPercent(machine.requiredSkillPercentage)}
                    </div>
                  </div>
                  <div className="ops-item-actions">
                    <StatusBadge label="Planned" tone="info" />
                    {canPlanSkills ? (
                      <>
                        <Button tone="secondary" disabled={saving} onClick={() => startEditingStylePlanMachine(machine)}>
                          <Pencil size={15} />
                        </Button>
                        <Button tone="danger" disabled={saving} onClick={() => void deleteStylePlanMachine(machine)}>
                          <Trash2 size={15} />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {!selectedStylePlanMachines.length ? (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No style machines planned</h3>
                <p>Create a style plan, then add machine numbers and operations for that style.</p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Line Style Schedule" subtitle="Schedule a style plan to automatically become active on a line.">
          <div className="ops-calendar-shell">
            <DayPicker
              mode="single"
              selected={selectedScheduleDate}
              onSelect={(date) => {
                if (!date) return;
                setSelectedScheduleDate(date);
                setScheduleForm((current) => ({ ...current, scheduledDate: toDateInputValue(date) }));
              }}
            />
          </div>

          <div className="ops-grid cols-2">
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-line">Production line</label>
              <select
                id="style-schedule-line"
                className="ops-select"
                value={scheduleForm.productionLineId}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, productionLineId: event.target.value }))
                }
              >
                {matrix.lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name} · {line.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-plan">Style plan</label>
              <select
                id="style-schedule-plan"
                className="ops-select"
                value={scheduleForm.styleOperationPlanId}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, styleOperationPlanId: event.target.value }))
                }
              >
                {matrix.stylePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    Style {plan.styleNumber} · v{plan.version}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ops-skill-form-grid">
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-date">Start date</label>
              <input
                id="style-schedule-date"
                className="ops-input"
                type="date"
                value={scheduleForm.scheduledDate}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  setScheduleForm((current) => ({ ...current, scheduledDate: nextDate }));
                  if (nextDate) setSelectedScheduleDate(new Date(`${nextDate}T00:00:00`));
                }}
              />
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-time">Start time</label>
              <input
                id="style-schedule-time"
                className="ops-input"
                type="time"
                value={scheduleForm.scheduledTime}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, scheduledTime: event.target.value }))
                }
              />
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-shift">Shift</label>
              <select
                id="style-schedule-shift"
                className="ops-select"
                value={scheduleForm.shiftName}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, shiftName: event.target.value }))
                }
              >
                <option value="Shift A">Shift A</option>
                <option value="Shift B">Shift B</option>
              </select>
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-end-date">Optional end date</label>
              <input
                id="style-schedule-end-date"
                className="ops-input"
                type="date"
                value={scheduleForm.scheduledEndDate}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, scheduledEndDate: event.target.value }))
                }
              />
            </div>
            <div className="ops-form-field">
              <label className="ops-filter-label" htmlFor="style-schedule-end-time">Optional end time</label>
              <input
                id="style-schedule-end-time"
                className="ops-input"
                type="time"
                value={scheduleForm.scheduledEndTime}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, scheduledEndTime: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="ops-form-field" style={{ marginBottom: 14 }}>
            <label className="ops-filter-label" htmlFor="style-schedule-note">Schedule note</label>
            <input
              id="style-schedule-note"
              className="ops-input"
              value={scheduleForm.notes}
              onChange={(event) =>
                setScheduleForm((current) => ({ ...current, notes: event.target.value }))
              }
              placeholder="Optional planning note"
            />
          </div>

          {canPlanSkills ? (
            <div className="ops-item-actions">
              <Button
                tone="primary"
                disabled={
                  saving ||
                  !scheduleForm.productionLineId ||
                  !scheduleForm.styleOperationPlanId ||
                  !scheduleForm.scheduledDate ||
                  !scheduleForm.scheduledTime
                }
                onClick={() => void saveLineStyleSchedule()}
              >
                <Clock3 size={16} />
                Schedule Style
              </Button>
            </div>
          ) : null}

          <div className="ops-list ops-scroll-list is-tall">
            {visibleSchedules.map((schedule) => (
              <div key={schedule.id} className="ops-list-item">
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">
                      {schedule.lineName} · Style {schedule.styleNumber}
                    </div>
                    <div className="ops-row-subtitle">
                      {formatDateTime(schedule.scheduledStartAt)} · {schedule.shiftName}
                      {schedule.scheduledEndAt ? ` · Ends ${formatDateTime(schedule.scheduledEndAt)}` : ""}
                    </div>
                    {schedule.notes ? <div className="ops-row-subtitle">{schedule.notes}</div> : null}
                  </div>
                  <div className="ops-item-actions">
                    <StatusBadge label={schedule.status} tone={scheduleTone(schedule)} />
                    {canPlanSkills && schedule.status === "scheduled" ? (
                      <Button tone="danger" disabled={saving} onClick={() => void cancelLineStyleSchedule(schedule)}>
                        <Trash2 size={15} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {!visibleSchedules.length ? (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No style schedules yet</h3>
                <p>Select a calendar date, start time, line, and style plan to schedule the next style.</p>
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card title="Employee Skill Coverage" subtitle="Employee skills are edited inside each worker profile; this page shows the current coverage overview.">
          <div className="ops-list">
            {topEmployeeSkills.map((skill) => (
              <div className="ops-list-item" key={skill.id}>
                <div className="ops-item-header">
                  <div>
                    <div className="ops-item-title">{skill.fullName || "Employee"}</div>
                    <div className="ops-row-subtitle">
                      {skill.employeeCode} · {skill.operationName} · Skill {toPercent(skill.skillLevelPercentage)}
                    </div>
                  </div>
                  <div className="ops-item-actions">
                    {skill.isSpeciality ? <StatusBadge label="Speciality" tone="violet" /> : null}
                    <StatusBadge label={toPercent(skill.skillLevelPercentage)} tone="info" />
                  </div>
                </div>
              </div>
            ))}
            {!topEmployeeSkills.length ? (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No skills assigned</h3>
                <p>Open a worker profile and add their operation skills and percentages.</p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Automatic Absence Recommendations" subtitle="Recommendations are generated automatically for absent employees mapped to floor-plan machines.">
          <div className="ops-grid cols-2">
            <select className="ops-select" value={selectedLineId} onChange={(event) => setSelectedLineId(event.target.value)}>
              {matrix.lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name} · {line.code}
                </option>
              ))}
            </select>
            <Button tone="secondary" disabled={recommendationLoading} onClick={() => void loadAutomaticRecommendations()}>
              <RefreshCcw size={16} />
              {recommendationLoading ? "Checking..." : "Refresh"}
            </Button>
          </div>

          {automaticRecommendations.length ? (
            <div className="ops-list">
              {automaticRecommendations.map((recommendation) => (
                <div className="ops-list-item" key={recommendation.assignment.id}>
                  <div className="ops-item-header">
                    <div>
                      <div className="ops-item-title">
                        {recommendation.assignment.positionLabel} · {recommendation.assignment.operationName}
                      </div>
                      <div className="ops-row-subtitle">
                        Absent: {recommendation.assignedEmployee.fullName} · {recommendation.assignedAttendanceStatus}
                      </div>
                    </div>
                    <StatusBadge label="Automatic" tone="warning" />
                  </div>
                  {recommendation.bestCandidate ? (
                    <div className="ops-item-header" style={{ marginTop: 10 }}>
                      <WorkerChip
                        worker={candidateWorker(recommendation.bestCandidate)}
                        meta={<div className="ops-row-subtitle">{recommendation.bestCandidate.recommendationReason}</div>}
                      />
                      <div className="ops-skill-score">
                        <StatusBadge label="Best match" tone={candidateTone(recommendation.bestCandidate)} />
                        <strong>{toPercent(recommendation.bestCandidate.skillLevelPercentage)}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="ops-empty-state" style={{ padding: 18 }}>
                      <h3>No matching skill found</h3>
                      <p>Add matching operation skills on worker profiles.</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="ops-empty-state" style={{ padding: 18 }}>
              <h3>No absent mapped machines</h3>
              <p>When an employee assigned to a floor-plan machine is absent, the best replacement appears here and on the floor plan automatically.</p>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

export default SkillMatrixPage;
