import { useEffect, useMemo, useState } from "react";
import { Calculator, RotateCcw, Shield, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../auth";
import { useOperations } from "../operations-context";
import { Button, Card, KpiCard, PageHeader, StatusBadge } from "../components/ops-ui";
import { RoleAccessManager } from "../modules/rbac/role-access-manager";
import { UserManagementPanel } from "../modules/rbac/user-management-panel";
import {
  getEfficiencyRulesPreviewFromBackend,
  getIncentiveRulesPreviewFromBackend,
  listCalculationRuleSetsFromBackend,
  recalculateMetricsFromBackend,
} from "@/lib/backend/calculation-api";
import type {
  CalculationRuleCatalogEntry,
  EfficiencyRulesPreview,
  IncentiveRulesPreview,
} from "@/types/calculations";

function SettingSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 0",
        borderBottom: "1px solid #eef2f7",
      }}
    >
      <div>
        <div className="ops-item-title">{label}</div>
        <div className="ops-row-subtitle">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="ops-button"
        style={{
          minWidth: 64,
          minHeight: 34,
          borderRadius: 999,
          background: checked ? "var(--ops-primary)" : "#d6dbe6",
          color: "#fff",
        }}
      >
        {checked ? "On" : "Off"}
      </button>
    </div>
  );
}

function PreviewTable({
  rows,
  headers,
}: {
  rows: string[][];
  headers: string[];
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${index}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsPage() {
  const { currentUser } = useAuth();
  const { settings, updateSetting } = useOperations();
  const [ruleEntries, setRuleEntries] = useState<CalculationRuleCatalogEntry[]>([]);
  const [efficiencyRules, setEfficiencyRules] = useState<EfficiencyRulesPreview | null>(null);
  const [incentiveRules, setIncentiveRules] = useState<IncentiveRulesPreview | null>(null);
  const [loadingRules, setLoadingRules] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [recalculateState, setRecalculateState] = useState<{
    dateFrom: string;
    dateTo: string;
    lineCode: string;
    submitting: boolean;
    message: string | null;
    error: string | null;
  }>({
    dateFrom: "",
    dateTo: "",
    lineCode: "",
    submitting: false,
    message: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const loadRules = async () => {
      setLoadingRules(true);
      setRulesError(null);
      try {
        const [entries, efficiency, incentives] = await Promise.all([
          listCalculationRuleSetsFromBackend(),
          getEfficiencyRulesPreviewFromBackend(),
          getIncentiveRulesPreviewFromBackend(),
        ]);

        if (!cancelled) {
          setRuleEntries(entries);
          setEfficiencyRules(efficiency);
          setIncentiveRules(incentives);
        }
      } catch (error) {
        if (!cancelled) {
          setRulesError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setLoadingRules(false);
        }
      }
    };

    void loadRules();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveToggle = async <K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K]
  ) => {
    await updateSetting({ key, value, actor: currentUser.name });
  };

  const formulaRows = useMemo(
    () =>
      efficiencyRules
        ? Object.entries(efficiencyRules.formulaRuleSet.formulas).map(([key, value]) => [
            key,
            value.expression,
          ])
        : [],
    [efficiencyRules]
  );

  const ladderRows = useMemo(
    () =>
      incentiveRules
        ? incentiveRules.incentiveLadderRuleSet.bands.map((band) => [
            band.label,
            `${band.minEfficiency}`,
            `${band.maxEfficiencyExclusive}`,
            `${band.incentiveAmount}`,
          ])
        : [],
    [incentiveRules]
  );

  const handleRecalculate = async () => {
    setRecalculateState((current) => ({
      ...current,
      submitting: true,
      message: null,
      error: null,
    }));

    try {
      const result = await recalculateMetricsFromBackend({
        dateFrom: recalculateState.dateFrom || null,
        dateTo: recalculateState.dateTo || null,
        lineCode: recalculateState.lineCode || null,
      });

      setRecalculateState((current) => ({
        ...current,
        submitting: false,
        message: `Recalculated ${result.recalculatedCount} metric row(s).`,
        error: null,
      }));
    } catch (error) {
      setRecalculateState((current) => ({
        ...current,
        submitting: false,
        message: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  return (
    <div className="ops-page">
      <PageHeader
        title="Settings"
        subtitle="Operational controls plus the rule-driven calculation engine that powers efficiency, incentives, reporting, and daily line metrics."
        actions={<Button tone="primary">Live settings auto-save</Button>}
      />

      <section className="ops-kpi-grid">
        <KpiCard
          label="Formula Rule Set"
          value={
            efficiencyRules
              ? `v${efficiencyRules.formulaRuleSet.version}`
              : loadingRules
                ? "Loading"
                : "Unavailable"
          }
          meta={
            efficiencyRules?.formulaRuleSet.ruleSetId ||
            "Workbook-based production efficiency formulas."
          }
          icon={Calculator}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Ladder Bands"
          value={`${incentiveRules?.incentiveLadderRuleSet.bands.length || 0}`}
          meta={
            incentiveRules
              ? `Rule ${incentiveRules.incentiveLadderRuleSet.ruleSetId}`
              : "Efficiency ladder bands."
          }
          icon={Calculator}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Aggregation Mode"
          value={
            efficiencyRules?.aggregationRuleSet.rollupStrategy
              ? efficiencyRules.aggregationRuleSet.rollupStrategy.replace(/_/g, " ")
              : "Pending"
          }
          meta="Totals are recomputed from stored row inputs, not from scattered UI logic."
          icon={Shield}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
        <KpiCard
          label="Published Rule Files"
          value={`${ruleEntries.length}`}
          meta="Loaded from the backend calculation-rules folder and versioned for audit."
          icon={RotateCcw}
          accent="var(--ops-violet)"
          soft="var(--ops-violet-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Calculation Rules Engine"
          subtitle="Read-only preview of the active YAML rule sets currently loaded by Spring Boot."
        >
          {loadingRules ? <div className="ops-row-subtitle">Loading rule previews…</div> : null}
          {rulesError ? (
            <div className="ops-alert-banner tone-danger" style={{ marginBottom: 16 }}>
              {rulesError}
            </div>
          ) : null}

          {efficiencyRules ? (
            <div className="ops-list">
              <div className="ops-list-item">
                <div className="ops-item-header">
                  <div className="ops-item-title">Efficiency formulas</div>
                  <StatusBadge
                    label={`v${efficiencyRules.formulaRuleSet.version}`}
                    tone="info"
                  />
                </div>
                <div className="ops-item-description">
                  {efficiencyRules.formulaRuleSet.description}
                </div>
              </div>
              <div className="ops-list-item">
                <div className="ops-item-header">
                  <div className="ops-item-title">Constants</div>
                  <StatusBadge
                    label={`scale ${efficiencyRules.constantsRuleSet.calculationScale}`}
                    tone="neutral"
                  />
                </div>
                <div className="ops-item-description">
                  Rounding mode: {efficiencyRules.constantsRuleSet.calculationRoundingMode}
                </div>
              </div>
              <div className="ops-list-item">
                <div className="ops-item-header">
                  <div className="ops-item-title">Aggregation</div>
                  <StatusBadge
                    label={efficiencyRules.aggregationRuleSet.useRealRowTotals ? "Live totals" : "Configured totals"}
                    tone="success"
                  />
                </div>
                <div className="ops-item-description">
                  {efficiencyRules.aggregationRuleSet.description}
                </div>
              </div>
            </div>
          ) : null}
        </Card>

        <Card
          title="Recalculate Metrics"
          subtitle="Trigger a controlled recalculation after a rule-set update. Existing raw inputs are replayed and new audit snapshots are stored."
        >
          <div className="ops-grid cols-2">
            <div className="ops-input-wrap">
              <input
                className="ops-input"
                type="date"
                value={recalculateState.dateFrom}
                onChange={(event) =>
                  setRecalculateState((current) => ({
                    ...current,
                    dateFrom: event.target.value,
                  }))
                }
              />
            </div>
            <div className="ops-input-wrap">
              <input
                className="ops-input"
                type="date"
                value={recalculateState.dateTo}
                onChange={(event) =>
                  setRecalculateState((current) => ({
                    ...current,
                    dateTo: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="ops-input-wrap" style={{ marginTop: 16 }}>
            <input
              className="ops-input"
              value={recalculateState.lineCode}
              onChange={(event) =>
                setRecalculateState((current) => ({
                  ...current,
                  lineCode: event.target.value,
                }))
              }
              placeholder="Optional line code filter"
            />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
            <Button
              tone="primary"
              disabled={recalculateState.submitting}
              onClick={() => void handleRecalculate()}
            >
              {recalculateState.submitting ? "Recalculating…" : "Run recalculation"}
            </Button>
            {recalculateState.message ? (
              <div className="ops-row-subtitle">{recalculateState.message}</div>
            ) : null}
          </div>

          {recalculateState.error ? (
            <div className="ops-alert-banner tone-danger" style={{ marginTop: 16 }}>
              {recalculateState.error}
            </div>
          ) : null}
        </Card>
      </section>

      {formulaRows.length ? (
        <Card
          title="Formula Preview"
          subtitle="Named calculation steps loaded from `backend/src/main/resources/calculation-rules/efficiency/default-efficiency-formulas.yml`."
        >
          <PreviewTable headers={["Formula", "Expression"]} rows={formulaRows} />
        </Card>
      ) : null}

      {ladderRows.length ? (
        <Card
          title="Incentive Ladder Preview"
          subtitle="Threshold-to-amount bands loaded from the incentive ladder YAML."
        >
          <PreviewTable
            headers={["Band", "Min Efficiency", "Max Exclusive", "Amount (LKR)"]}
            rows={ladderRows}
          />
        </Card>
      ) : null}

      <section className="ops-grid cols-2">
        <Card title="Verification & Security" subtitle="Biometric and exception handling controls.">
          <SettingSwitch
            label="Face Recognition"
            description="Enable face recognition at gates and workstation validation points."
            checked={settings.faceRecognition}
            onChange={(value) => void saveToggle("faceRecognition", value)}
          />
          <SettingSwitch
            label="Fingerprint Verification"
            description="Require fingerprint validation at time capture devices."
            checked={settings.fingerprintVerification}
            onChange={(value) => void saveToggle("fingerprintVerification", value)}
          />
          <SettingSwitch
            label="Dual Validation Required"
            description="Force both biometric methods before release to sensitive areas."
            checked={settings.dualValidationRequired}
            onChange={(value) => void saveToggle("dualValidationRequired", value)}
          />
          <SettingSwitch
            label="Manual Verification Fallback"
            description="Allow HR or supervisors to resolve edge cases when devices fail."
            checked={settings.manualVerificationFallback}
            onChange={(value) => void saveToggle("manualVerificationFallback", value)}
          />
        </Card>

        <Card title="Attendance Controls" subtitle="Shift timing and alert behaviour for workforce operations.">
          <div className="ops-meta-grid">
            <div className="ops-key-value">
              <div className="ops-key-value-label">Shift Start</div>
              <div className="ops-key-value-value">{settings.morningShiftStart}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Shift End</div>
              <div className="ops-key-value-value">{settings.morningShiftEnd}</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Late Threshold</div>
              <div className="ops-key-value-value">{settings.lateArrivalThreshold} minutes</div>
            </div>
            <div className="ops-key-value">
              <div className="ops-key-value-label">Grace Period</div>
              <div className="ops-key-value-value">{settings.gracePeriod} minutes</div>
            </div>
          </div>

          <div className="ops-card-divider" />

          <SettingSwitch
            label="Auto Mark Absent"
            description="Automatically flag absent workers when no biometric event is captured after the threshold."
            checked={settings.autoMarkAbsent}
            onChange={(value) => void saveToggle("autoMarkAbsent", value)}
          />
          <SettingSwitch
            label="Failed Entry Alerts"
            description="Create immediate alerts for unknown faces and invalid gate attempts."
            checked={settings.failedEntryAlerts}
            onChange={(value) => void saveToggle("failedEntryAlerts", value)}
          />
          <SettingSwitch
            label="Low Efficiency Warnings"
            description="Send alerts when line efficiency drops below configured operational limits."
            checked={settings.lowEfficiencyWarnings}
            onChange={(value) => void saveToggle("lowEfficiencyWarnings", value)}
          />
          <SettingSwitch
            label="Daily Summary Report"
            description="Produce end-of-day rollups for management and payroll support."
            checked={settings.dailySummaryReport}
            onChange={(value) => void saveToggle("dailySummaryReport", value)}
          />
        </Card>
      </section>

      <UserManagementPanel />

      <RoleAccessManager />
    </div>
  );
}

export default SettingsPage;
