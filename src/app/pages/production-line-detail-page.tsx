import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRightLeft,
  ClipboardList,
  Gauge,
  History,
  Plus,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { getMetricAuditFromBackend } from "@/lib/backend/calculation-api";
import type { CalculationAuditView } from "@/types/calculations";
import { useAuth } from "../auth";
import { useOperations } from "../operations-context";
import {
  Card,
  KpiCard,
  PageHeader,
  StatusBadge,
  WorkerChip,
  attendanceTone,
  formatCurrency,
} from "../components/ops-ui";
import { isHelperWorker, isMachineOperator, isPresentWorker } from "../components/line-floor-plan";

type EmployeeGroupKey = "actualMo" | "actualHel" | "teamMembers" | "actualCadre";

function formatEfficiencyRatio(value?: number) {
  if (typeof value !== "number") {
    return "0.00%";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatMetricNumber(value?: number, maximumFractionDigits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function toLocalDateInputValue(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function toLocalTimeInputValue(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(11, 16);
}

function formatEntryTime(value: string) {
  return value.slice(0, 5);
}

function MetricEmployeeButton({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ops-key-value ops-key-value-button${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      <div className="ops-key-value-label">{label}</div>
      <div className="ops-key-value-value">{value}</div>
    </button>
  );
}

export function ProductionLineDetailPage() {
  const { lineId } = useParams();
  const { canDo, currentUser } = useAuth();
  const { lines, workers, lineOutputEntries, updateLineStyle, addLineOutputEntry } = useOperations();
  const [audit, setAudit] = useState<CalculationAuditView | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState("");
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleMessage, setStyleMessage] = useState<string | null>(null);
  const [outputDate, setOutputDate] = useState("");
  const [outputTime, setOutputTime] = useState(toLocalTimeInputValue());
  const [outputQuantity, setOutputQuantity] = useState("");
  const [outputNote, setOutputNote] = useState("");
  const [outputSaving, setOutputSaving] = useState(false);
  const [outputMessage, setOutputMessage] = useState<string | null>(null);
  const [showOutputHistory, setShowOutputHistory] = useState(false);
  const [selectedEmployeeGroup, setSelectedEmployeeGroup] = useState<EmployeeGroupKey | null>(null);

  const line = lines.find((item) => item.id === lineId);

  useEffect(() => {
    setOutputDate(line?.latestMetricDate || toLocalDateInputValue());
  }, [line?.id, line?.latestMetricDate]);

  if (!line) {
    return <Navigate to="/production-lines" replace />;
  }

  const lineWorkers = workers
    .filter((worker) => worker.currentLineId === line.id)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const actualMoWorkers = lineWorkers.filter(isMachineOperator);
  const actualHelWorkers = lineWorkers.filter(isHelperWorker);
  const actualCadreWorkers = lineWorkers.filter(isPresentWorker);
  const selectedEmployees =
    selectedEmployeeGroup === "actualMo"
      ? actualMoWorkers
      : selectedEmployeeGroup === "actualHel"
        ? actualHelWorkers
        : selectedEmployeeGroup === "actualCadre"
          ? actualCadreWorkers
          : lineWorkers;
  const selectedEmployeeGroupLabel =
    selectedEmployeeGroup === "actualMo"
      ? "Actual MO Employees"
      : selectedEmployeeGroup === "actualHel"
        ? "Actual HEL Employees"
        : selectedEmployeeGroup === "actualCadre"
          ? "Actual Present Cadre"
          : "Assigned Team Members";
  const toggleEmployeeGroup = (group: EmployeeGroupKey) => {
    setSelectedEmployeeGroup((current) => (current === group ? null : group));
  };

  const presentWorkers = line.presentWorkers + line.lateWorkers;
  const currentStyle = styleDraft || line.allocatedStyle || "";
  const selectedOutputDate = outputDate || line.latestMetricDate || toLocalDateInputValue();
  const lineDailyOutputEntries = lineOutputEntries
    .filter((entry) => entry.lineId === line.id && entry.productionDate === selectedOutputDate)
    .sort((a, b) =>
      `${b.productionDate}T${b.entryTime}`.localeCompare(`${a.productionDate}T${a.entryTime}`)
    );
  const latestOutputEntry = lineDailyOutputEntries[0];
  const currentDailyOutput = latestOutputEntry?.cumulativeOutput ?? line.actualPcs ?? line.output;

  const saveOutputEntry = async () => {
    const nextQuantity = Number(outputQuantity);

    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      setOutputMessage("Output quantity must be greater than zero.");
      return;
    }

    setOutputSaving(true);
    setOutputMessage(null);

    try {
      const result = await addLineOutputEntry({
        lineId: line.id,
        productionDate: selectedOutputDate,
        entryTime: outputTime,
        outputQuantity: nextQuantity,
        note: outputNote,
        actor: currentUser.name,
      });
      setOutputMessage(result.message);

      if (result.ok) {
        setOutputQuantity("");
        setOutputNote("");
        setOutputTime(toLocalTimeInputValue());
      }
    } finally {
      setOutputSaving(false);
    }
  };

  const loadAudit = async () => {
    if (!line.latestMetricId) {
      return;
    }

    if (audit) {
      setAudit(null);
      return;
    }

    setAuditLoading(true);
    setAuditError(null);

    try {
      setAudit(await getMetricAuditFromBackend(line.latestMetricId));
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuditLoading(false);
    }
  };

  const saveLineStyle = async () => {
    const nextStyle = currentStyle.trim();

    if (!nextStyle) {
      setStyleMessage("Allocated style is required.");
      return;
    }

    setStyleSaving(true);
    setStyleMessage(null);

    try {
      const result = await updateLineStyle({
        lineId: line.id,
        allocatedStyle: nextStyle,
        actor: currentUser.name,
      });
      setStyleMessage(result.message);
      setStyleDraft("");
    } finally {
      setStyleSaving(false);
    }
  };

  return (
    <div className="ops-page">
      <PageHeader
        title={line.name}
        subtitle={`${line.code} · ${line.department} · ${line.shift} · ${line.supervisor}`}
        actions={
          <>
            <Link
              to={`/production-lines/${line.id}/floor-plan`}
              className="ops-button ops-button-primary"
            >
              <Users size={16} />
              View Floor Plan
            </Link>
            <Link to="/production-lines" className="ops-button ops-button-secondary">
              <ArrowLeft size={16} />
              Back to Lines
            </Link>
          </>
        }
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Assigned"
          value={`${line.assignedWorkers}`}
          meta="Workers currently mapped to this production line."
          icon={Users}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Came Today"
          value={`${presentWorkers}`}
          meta="Present and late workers from attendance records."
          icon={ClipboardList}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Attendance"
          value={`${line.attendanceRate}%`}
          meta={`${presentWorkers} of ${line.assignedWorkers} assigned workers came today.`}
          icon={Gauge}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Efficiency"
          value={`${line.efficiency}%`}
          meta={`Target output ${line.targetOutput}; current output ${line.output}.`}
          icon={Target}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card title="Line Allocation" subtitle="Style assignment and line state.">
          <div className="ops-item-header">
            <div>
              <div className="ops-item-title">{line.allocatedStyle || "Unassigned style"}</div>
              <div className="ops-row-subtitle">
                {line.status} · {line.risk} · Target manpower {line.targetManpower}
              </div>
            </div>
            <StatusBadge
              label={line.allocatedStyle ? "Style Assigned" : "Needs Style"}
              tone={line.allocatedStyle ? "success" : "warning"}
            />
          </div>

          {line.issue ? <div className="ops-alert-banner tone-warning">{line.issue}</div> : null}

          {canDo("assignLine") ? (
            <div className="ops-detail-form-row">
              <div className="ops-filter-group" style={{ margin: 0 }}>
                <label className="ops-filter-label" htmlFor={`style-${line.id}`}>
                  Allocated style
                </label>
                <input
                  id={`style-${line.id}`}
                  className="ops-input"
                  value={currentStyle}
                  onChange={(event) => setStyleDraft(event.target.value)}
                  placeholder="Enter style code"
                />
              </div>
              <button
                type="button"
                className="ops-button ops-button-secondary"
                disabled={styleSaving}
                onClick={() => void saveLineStyle()}
              >
                {styleSaving ? "Saving..." : "Save Style"}
              </button>
            </div>
          ) : null}

          {styleMessage ? <div className="ops-badge tone-info">{styleMessage}</div> : null}

          <div className="ops-item-actions">
            {canDo("assignLine") ? (
              <Link to="/line-assignment" className="ops-button ops-button-ghost">
                <UserPlus size={15} />
                Assign
              </Link>
            ) : null}
            {canDo("transferLine") ? (
              <Link to="/line-assignment" className="ops-button ops-button-ghost">
                <ArrowRightLeft size={15} />
                Transfer
              </Link>
            ) : null}
          </div>
        </Card>

        <Card title="Line Summary" subtitle="Output, capacity, and operational status.">
          <div className="ops-meta-grid">
            <div className="ops-key-value">
              <div className="ops-key-value-label">Target Output</div>
              <div className="ops-key-value-value">{line.targetOutput}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Current Output</div>
              <div className="ops-key-value-value">{line.output}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Status</div>
              <div className="ops-key-value-value">{line.status}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Risk</div>
              <div className="ops-key-value-value">{line.risk}</div>
            </div>
          </div>
        </Card>
      </section>

      <Card
        title="Hourly Output Entry"
        subtitle="Add the current hour output. The daily metric and incentive values refresh from the backend calculation engine after each save."
      >
        <div className="ops-detail-section">
          <div className="ops-item-header">
            <div>
              <div className="ops-item-title">{formatMetricNumber(currentDailyOutput, 0)} PCS</div>
              <div className="ops-row-subtitle">
                Current saved output for {selectedOutputDate}
                {latestOutputEntry ? ` · Last entry ${formatEntryTime(latestOutputEntry.entryTime)}` : ""}
              </div>
            </div>
            <button
              type="button"
              className="ops-button ops-button-ghost"
              onClick={() => setShowOutputHistory((current) => !current)}
            >
              <History size={16} />
              {showOutputHistory ? "Hide History" : "View History"}
            </button>
          </div>

          {canDo("addLineOutput") ? (
            <div className="ops-output-entry-form">
              <div className="ops-filter-group" style={{ margin: 0 }}>
                <label className="ops-filter-label" htmlFor={`output-date-${line.id}`}>
                  Date
                </label>
                <input
                  id={`output-date-${line.id}`}
                  type="date"
                  className="ops-input"
                  value={selectedOutputDate}
                  onChange={(event) => setOutputDate(event.target.value)}
                />
              </div>
              <div className="ops-filter-group" style={{ margin: 0 }}>
                <label className="ops-filter-label" htmlFor={`output-time-${line.id}`}>
                  Time
                </label>
                <input
                  id={`output-time-${line.id}`}
                  type="time"
                  className="ops-input"
                  value={outputTime}
                  onChange={(event) => setOutputTime(event.target.value)}
                />
              </div>
              <div className="ops-filter-group" style={{ margin: 0 }}>
                <label className="ops-filter-label" htmlFor={`output-quantity-${line.id}`}>
                  Output PCS
                </label>
                <input
                  id={`output-quantity-${line.id}`}
                  type="number"
                  min="1"
                  step="1"
                  className="ops-input"
                  value={outputQuantity}
                  onChange={(event) => setOutputQuantity(event.target.value)}
                  placeholder="Add output"
                />
              </div>
              <div className="ops-filter-group" style={{ margin: 0 }}>
                <label className="ops-filter-label" htmlFor={`output-note-${line.id}`}>
                  Note
                </label>
                <input
                  id={`output-note-${line.id}`}
                  className="ops-input"
                  value={outputNote}
                  onChange={(event) => setOutputNote(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <button
                type="button"
                className="ops-button ops-button-primary"
                disabled={outputSaving}
                onClick={() => void saveOutputEntry()}
              >
                <Plus size={16} />
                {outputSaving ? "Saving..." : "Add Output"}
              </button>
            </div>
          ) : (
            <div className="ops-alert-banner tone-warning">
              Only admins and supervisors can add hourly output entries.
            </div>
          )}

          {outputMessage ? <div className="ops-badge tone-info">{outputMessage}</div> : null}

          {showOutputHistory ? (
            lineDailyOutputEntries.length ? (
              <div className="ops-table-wrap">
                <table className="ops-table ops-compact-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Added Output</th>
                      <th>Daily Total</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineDailyOutputEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatEntryTime(entry.entryTime)}</td>
                        <td>{formatMetricNumber(entry.outputQuantity, 0)}</td>
                        <td>{formatMetricNumber(entry.cumulativeOutput, 0)}</td>
                        <td>{entry.note || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ops-empty-state" style={{ padding: 18 }}>
                <h3>No output history</h3>
                <p>No manual output entries have been saved for this line on the selected date.</p>
              </div>
            )
          ) : null}
        </div>
      </Card>

      <Card
        title="Latest Calculation Metrics"
        subtitle={
          line.latestMetricId
            ? `${line.latestMetricDate || "No calculation date"} · Formula ${line.formulaRuleSetId || "-"} v${line.formulaRuleVersion || 0}`
            : "No persisted daily metric from the calculation engine."
        }
      >
        {line.latestMetricId ? (
          <div className="ops-detail-section">
            <div className="ops-item-header">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <StatusBadge
                  label={line.incentiveBand || "No band"}
                  tone={line.incentiveBand ? "success" : "neutral"}
                />
                {line.metricWarnings?.map((warning) => (
                  <StatusBadge key={warning} label={warning} tone="warning" />
                ))}
              </div>
              {["super_admin", "admin"].includes(currentUser.role) ? (
                <button type="button" className="ops-button ops-button-ghost" onClick={() => void loadAudit()}>
                  {audit ? "Hide Audit" : auditLoading ? "Loading Audit..." : "View Audit"}
                </button>
              ) : null}
            </div>

            <div className="ops-detail-subsection">
              <h3 className="ops-detail-subtitle">Line Input Data</h3>
              <div className="ops-meta-grid ops-metric-grid">
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Line Code</div>
                  <div className="ops-key-value-value">{line.code}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Shift</div>
                  <div className="ops-key-value-value">{line.shift}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Style</div>
                  <div className="ops-key-value-value">{line.allocatedStyle || "-"}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Planned MO</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.plannedMo)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Planned HEL</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.plannedHel)}</div>
                </div>
                <MetricEmployeeButton
                  label="Actual MO"
                  value={formatMetricNumber(actualMoWorkers.length, 0)}
                  active={selectedEmployeeGroup === "actualMo"}
                  onClick={() => toggleEmployeeGroup("actualMo")}
                />
                <MetricEmployeeButton
                  label="Actual HEL"
                  value={formatMetricNumber(actualHelWorkers.length, 0)}
                  active={selectedEmployeeGroup === "actualHel"}
                  onClick={() => toggleEmployeeGroup("actualHel")}
                />
                <MetricEmployeeButton
                  label="Team Members"
                  value={formatMetricNumber(lineWorkers.length, 0)}
                  active={selectedEmployeeGroup === "teamMembers"}
                  onClick={() => toggleEmployeeGroup("teamMembers")}
                />
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Working Hours</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.workingHours)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">SMV</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.smv, 4)}</div>
                </div>
              </div>
            </div>

            {selectedEmployeeGroup ? (
            <div className="ops-detail-subsection">
              <div className="ops-item-header">
                <div>
                  <h3 className="ops-detail-subtitle">{selectedEmployeeGroupLabel}</h3>
                  <div className="ops-row-subtitle">
                    Real assigned employee records from the current line data.
                  </div>
                </div>
                <StatusBadge label={`${selectedEmployees.length} employee(s)`} tone="info" />
              </div>
              {selectedEmployees.length ? (
                <div className="ops-employee-mini-grid">
                  {selectedEmployees.map((worker) => (
                    <Link
                      key={worker.id}
                      to={`/workers/${worker.id}`}
                      className="ops-employee-mini-card"
                    >
                      <WorkerChip
                        worker={worker}
                        meta={<div className="ops-row-subtitle">{worker.department}</div>}
                      />
                      <StatusBadge
                        label={worker.attendanceStatus}
                        tone={attendanceTone(worker.attendanceStatus)}
                      />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="ops-empty-state" style={{ padding: 18 }}>
                  <h3>No employees found</h3>
                  <p>No assigned employees match this actual data group in the current dataset.</p>
                </div>
              )}
            </div>
            ) : null}

            <div className="ops-detail-subsection">
              <h3 className="ops-detail-subtitle">Production Values</h3>
              <div className="ops-meta-grid ops-metric-grid">
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Planned PCS</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.plannedPcs, 0)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Forecast PCS</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.forecastPcs, 0)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Actual PCS</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.actualPcs, 0)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Target Output</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.targetOutput, 0)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Current Output</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.output, 0)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Piece Variance</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.pieceVariance, 0)}</div>
                </div>
              </div>
            </div>

            <div className="ops-detail-subsection">
              <h3 className="ops-detail-subtitle">Calculated Results</h3>
              <div className="ops-meta-grid ops-metric-grid">
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Planned Cadre</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.plannedCadreTotal)}</div>
                </div>
                <MetricEmployeeButton
                  label="Actual Cadre"
                  value={formatMetricNumber(actualCadreWorkers.length, 0)}
                  active={selectedEmployeeGroup === "actualCadre"}
                  onClick={() => toggleEmployeeGroup("actualCadre")}
                />
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Clock Hours</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.clockHours)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Planned SAH</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.plannedSah)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Forecast SAH</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.forecastSah)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Actual SAH</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.actualSah)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Planned Efficiency</div>
                  <div className="ops-key-value-value">
                    {formatEfficiencyRatio(line.plannedEfficiencyRatio)}
                  </div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Forecast Efficiency</div>
                  <div className="ops-key-value-value">
                    {formatEfficiencyRatio(line.forecastEfficiencyRatio)}
                  </div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Actual Efficiency</div>
                  <div className="ops-key-value-value">
                    {formatEfficiencyRatio(line.actualEfficiencyRatio)}
                  </div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">SAH Variance</div>
                  <div className="ops-key-value-value">{formatMetricNumber(line.sahVariance)}</div>
                </div>
                <div className="ops-key-value">
                  <div className="ops-key-value-label">Line Incentive</div>
                  <div className="ops-key-value-value">
                    {typeof line.incentiveAmount === "number"
                      ? formatCurrency(line.incentiveAmount)
                      : "-"}
                  </div>
                </div>
              </div>
            </div>

            {auditError ? <div className="ops-alert-banner tone-danger">{auditError}</div> : null}
            {audit ? (
              <pre className="ops-audit-snapshot">{JSON.stringify(audit, null, 2)}</pre>
            ) : null}
          </div>
        ) : (
          <div className="ops-empty-state" style={{ padding: 18 }}>
            <h3>No calculation metrics yet</h3>
            <p>This line does not yet have a persisted daily metric from the calculation engine.</p>
          </div>
        )}
      </Card>

      <Card title="Assigned Staff" subtitle={`${lineWorkers.length} worker(s) currently mapped to ${line.name}.`}>
        {lineWorkers.length ? (
          <div className="ops-line-workers">
            {lineWorkers.map((worker) => (
              <div key={worker.id} className="ops-line-worker-item">
                <WorkerChip
                  worker={worker}
                  meta={
                    <div className="ops-row-subtitle">
                      {worker.employeeId} · {worker.department} · {worker.roleTitle}
                    </div>
                  }
                />
                <div className="ops-detail-worker-actions">
                  <StatusBadge
                    label={worker.attendanceStatus}
                    tone={attendanceTone(worker.attendanceStatus)}
                  />
                  <Link to={`/workers/${worker.id}`} className="ops-link-button">
                    View Profile
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ops-empty-state" style={{ padding: 18 }}>
            <h3>No staff assigned</h3>
            <p>This production line does not currently have any assigned workers.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

export default ProductionLineDetailPage;
