import { useEffect, useMemo, useState } from "react";
import { HandCoins, Target, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getIncentiveRulesPreviewFromBackend,
  listLineMetricsFromBackend,
} from "@/lib/backend/calculation-api";
import type { IncentiveRulesPreview, LineMetricReportRow } from "@/types/calculations";
import {
  Card,
  ExportActions,
  KpiCard,
  PageHeader,
  StatusBadge,
  downloadCsv,
  formatCurrency,
} from "../components/ops-ui";

function formatEfficiency(value?: number | null) {
  if (typeof value !== "number") {
    return "0.00%";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value?: number | null, digits = 2) {
  if (typeof value !== "number") {
    return "0";
  }
  return Number.isInteger(value) ? `${value}` : value.toFixed(digits);
}

function formatChartEfficiency(value?: number | null) {
  if (typeof value !== "number") {
    return "0.0%";
  }
  return `${value.toFixed(1)}%`;
}

const CADRE_COLORS = ["#16a34a", "#263574", "#7c3aed"];

function defaultDateRange() {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today);
  start.setDate(today.getDate() - 30);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end,
  };
}

export function AttendanceOperationsPage() {
  const defaults = useMemo(() => defaultDateRange(), []);
  const [filters, setFilters] = useState({
    dateFrom: defaults.dateFrom,
    dateTo: defaults.dateTo,
    lineCode: "",
    shiftCode: "",
  });
  const [rows, setRows] = useState<LineMetricReportRow[]>([]);
  const [incentiveRules, setIncentiveRules] = useState<IncentiveRulesPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [nextRows, nextRules] = await Promise.all([
          listLineMetricsFromBackend({
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            lineCode: filters.lineCode || null,
            shiftCode: filters.shiftCode || null,
          }),
          getIncentiveRulesPreviewFromBackend(),
        ]);

        if (!cancelled) {
          setRows(nextRows);
          setIncentiveRules(nextRules);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [filters.dateFrom, filters.dateTo, filters.lineCode, filters.shiftCode]);

  const totals = useMemo(() => {
    const totalIncentive = rows.reduce((sum, row) => sum + (row.linkedIncentiveAmount || 0), 0);
    const rowsWithWarnings = rows.filter((row) => row.warnings.length > 0).length;
    const averageEfficiency =
      rows.length > 0
        ? rows.reduce((sum, row) => sum + (row.actualEfficiency || 0), 0) / rows.length
        : 0;
    const lineCount = new Set(rows.map((row) => row.lineCode || row.productionLineId)).size;

    return {
      totalIncentive,
      rowsWithWarnings,
      averageEfficiency,
      lineCount,
    };
  }, [rows]);

  const exportRows = [
    [
      "Date",
      "Line Code",
      "Style/Line",
      "Shift",
      "SMV",
      "Plan MO",
      "Plan HEL",
      "Plan Total",
      "Actual MO",
      "Actual HEL",
      "TM",
      "Actual Total",
      "Working Hours",
      "Clock Hours",
      "Plan PCS",
      "Plan SAH",
      "Plan Efficiency",
      "Forecast PCS",
      "Forecast SAH",
      "Forecast Efficiency",
      "Actual PCS",
      "Actual SAH",
      "Actual Efficiency",
      "PCS Variance",
      "SAH Variance",
      "Band",
      "Incentive Amount",
      "Warnings",
    ],
    ...rows.map((row) => [
      row.productionDate || "",
      row.lineCode || "",
      row.lineName || "",
      row.shiftCode || "",
      row.smv?.toString() || "",
      row.plannedMo?.toString() || "",
      row.plannedHel?.toString() || "",
      row.plannedCadreTotal?.toString() || "",
      row.actualMo?.toString() || "",
      row.actualHel?.toString() || "",
      row.teamMembers?.toString() || "",
      row.actualCadreTotal?.toString() || "",
      row.workingHours?.toString() || "",
      row.clockHours?.toString() || "",
      row.plannedPcs?.toString() || "",
      row.plannedSah?.toString() || "",
      row.plannedEfficiency?.toString() || "",
      row.forecastPcs?.toString() || "",
      row.forecastSah?.toString() || "",
      row.forecastEfficiency?.toString() || "",
      row.actualPcs?.toString() || "",
      row.actualSah?.toString() || "",
      row.actualEfficiency?.toString() || "",
      row.pieceVariance?.toString() || "",
      row.sahVariance?.toString() || "",
      row.linkedIncentiveBand || "",
      (row.linkedIncentiveAmount || 0).toString(),
      row.warnings.join(" | "),
    ]),
  ];

  const lineChartRows = useMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        count: number;
        plannedEfficiency: number;
        forecastEfficiency: number;
        actualEfficiency: number;
        incentiveAmount: number;
        pieceVariance: number;
        sahVariance: number;
        actualPcs: number;
        plannedPcs: number;
      }
    >();

    rows.forEach((row) => {
      const key = row.lineCode || row.productionLineId || row.id;
      const current =
        groups.get(key) ||
        {
          label: row.lineCode || row.lineName || "Line",
          count: 0,
          plannedEfficiency: 0,
          forecastEfficiency: 0,
          actualEfficiency: 0,
          incentiveAmount: 0,
          pieceVariance: 0,
          sahVariance: 0,
          actualPcs: 0,
          plannedPcs: 0,
        };

      current.count += 1;
      current.plannedEfficiency += (row.plannedEfficiency || 0) * 100;
      current.forecastEfficiency += (row.forecastEfficiency || 0) * 100;
      current.actualEfficiency += (row.actualEfficiency || 0) * 100;
      current.incentiveAmount += row.linkedIncentiveAmount || 0;
      current.pieceVariance += row.pieceVariance || 0;
      current.sahVariance += row.sahVariance || 0;
      current.actualPcs += row.actualPcs || 0;
      current.plannedPcs += row.plannedPcs || 0;
      groups.set(key, current);
    });

    return Array.from(groups.values())
      .map((item) => ({
        ...item,
        plannedEfficiency: item.count ? item.plannedEfficiency / item.count : 0,
        forecastEfficiency: item.count ? item.forecastEfficiency / item.count : 0,
        actualEfficiency: item.count ? item.actualEfficiency / item.count : 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const cadreChartRows = useMemo(() => {
    const plannedMo = rows.reduce((sum, row) => sum + (row.plannedMo || 0), 0);
    const plannedHel = rows.reduce((sum, row) => sum + (row.plannedHel || 0), 0);
    const plannedTotal = rows.reduce((sum, row) => sum + (row.plannedCadreTotal || 0), 0);
    const actualMo = rows.reduce((sum, row) => sum + (row.actualMo || 0), 0);
    const actualHel = rows.reduce((sum, row) => sum + (row.actualHel || 0), 0);
    const actualTotal = rows.reduce((sum, row) => sum + (row.actualCadreTotal || 0), 0);

    return {
      planned: [
        { name: "MO", value: plannedMo },
        { name: "HEL", value: plannedHel },
        { name: "Other", value: Math.max(plannedTotal - plannedMo - plannedHel, 0) },
      ].filter((item) => item.value > 0),
      actual: [
        { name: "MO", value: actualMo },
        { name: "HEL", value: actualHel },
        { name: "Other / TM", value: Math.max(actualTotal - actualMo - actualHel, 0) },
      ].filter((item) => item.value > 0),
    };
  }, [rows]);

  const ladderRows = incentiveRules?.incentiveLadderRuleSet.bands || [];

  return (
    <div className="ops-page">
      <PageHeader
        title="Incentive Calculation"
        subtitle="Production efficiency report with plan, forecast, actual, variance, and incentive ladder outputs."
        actions={
          <ExportActions
            onExportCsv={() => downloadCsv("line-incentive-report.csv", exportRows)}
            onPrint={() => window.print()}
          />
        }
      />

      <section className="ops-grid cols-2">
        <Card
          title="Filters"
          subtitle="Filter calculation rows by date range, line, or shift."
        >
          <div className="ops-grid cols-2">
            <div className="ops-input-wrap">
              <input
                className="ops-input"
                type="date"
                value={filters.dateFrom}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, dateFrom: event.target.value }))
                }
              />
            </div>
            <div className="ops-input-wrap">
              <input
                className="ops-input"
                type="date"
                value={filters.dateTo}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, dateTo: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="ops-grid cols-2" style={{ marginTop: 16 }}>
            <div className="ops-input-wrap">
              <input
                className="ops-input"
                value={filters.lineCode}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, lineCode: event.target.value }))
                }
                placeholder="Optional line code"
              />
            </div>
            <div className="ops-input-wrap">
              <input
                className="ops-input"
                value={filters.shiftCode}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, shiftCode: event.target.value }))
                }
                placeholder="Optional shift code"
              />
            </div>
          </div>
        </Card>

        <Card
          title="Calculation Status"
          subtitle="Rows display persisted backend calculation outputs for the selected filter window."
        >
          {loading ? <div className="ops-row-subtitle">Loading incentive results…</div> : null}
          {error ? (
            <div className="ops-alert-banner tone-danger">{error}</div>
          ) : (
            <div className="ops-list">
              <div className="ops-list-item">
                <div className="ops-item-title">Rows loaded</div>
                <div className="ops-item-description">
                  {rows.length} line metric rows in the active filter window.
                </div>
              </div>
              <div className="ops-list-item">
                <div className="ops-item-title">Rule basis</div>
                <div className="ops-item-description">
                  Incentives use actual efficiency and the active ladder rule set.
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      <section className="ops-kpi-grid">
        <KpiCard
          label="Incentive Pool"
          value={formatCurrency(totals.totalIncentive)}
          meta="Total linked incentive payout inside the active filter range."
          icon={HandCoins}
          accent="var(--ops-primary)"
          soft="var(--ops-primary-soft)"
        />
        <KpiCard
          label="Average Efficiency"
          value={formatEfficiency(totals.averageEfficiency)}
          meta="Average actual efficiency used as the incentive basis."
          icon={TrendingUp}
          accent="var(--ops-success)"
          soft="var(--ops-success-soft)"
        />
        <KpiCard
          label="Lines Covered"
          value={`${totals.lineCount}`}
          meta="Unique production lines represented in the returned incentive rows."
          icon={Target}
          accent="var(--ops-warning)"
          soft="var(--ops-warning-soft)"
        />
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Planned Cadre Mix"
          subtitle="Planned manpower composition by MO, HEL, and other roles."
        >
          {cadreChartRows.planned.length ? (
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={cadreChartRows.planned}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={100}
                    paddingAngle={3}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {cadreChartRows.planned.map((entry, index) => (
                      <Cell key={entry.name} fill={CADRE_COLORS[index % CADRE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatNumber(Number(value), 0)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="ops-empty-state" style={{ padding: 18 }}>
              <h3>No cadre data</h3>
              <p>Planned cadre mix appears after metric rows are loaded.</p>
            </div>
          )}
        </Card>

        <Card
          title="Actual Cadre Mix"
          subtitle="Actual manpower composition by MO, HEL, and other/team-member roles."
        >
          {cadreChartRows.actual.length ? (
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={cadreChartRows.actual}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={100}
                    paddingAngle={3}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {cadreChartRows.actual.map((entry, index) => (
                      <Cell key={entry.name} fill={CADRE_COLORS[index % CADRE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatNumber(Number(value), 0)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="ops-empty-state" style={{ padding: 18 }}>
              <h3>No cadre data</h3>
              <p>Actual cadre mix appears after metric rows are loaded.</p>
            </div>
          )}
        </Card>
      </section>

      <section className="ops-grid cols-2">
        <Card
          title="Line Efficiency Comparison"
          subtitle="Plan, forecast, and actual efficiency by line for the selected filter range."
        >
          {lineChartRows.length ? (
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={lineChartRows}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={formatChartEfficiency} />
                  <Tooltip formatter={(value) => formatChartEfficiency(Number(value))} />
                  <Legend />
                  <Bar dataKey="plannedEfficiency" name="Plan" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="forecastEfficiency" name="Forecast" fill="#263574" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="actualEfficiency" name="Actual" fill="#16a34a" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="ops-empty-state" style={{ padding: 18 }}>
              <h3>No chart data</h3>
              <p>Line efficiency charts appear after metric rows are loaded.</p>
            </div>
          )}
        </Card>

        <Card
          title="Incentive vs Actual Efficiency"
          subtitle="Line incentive payout compared with actual efficiency."
        >
          {lineChartRows.length ? (
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <ComposedChart data={lineChartRows}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatChartEfficiency}
                  />
                  <Tooltip
                    formatter={(value, name) =>
                      name === "Actual Efficiency"
                        ? formatChartEfficiency(Number(value))
                        : formatCurrency(Number(value))
                    }
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="incentiveAmount"
                    name="Incentive"
                    fill="#7c3aed"
                    radius={[6, 6, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="actualEfficiency"
                    name="Actual Efficiency"
                    stroke="#16a34a"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="ops-empty-state" style={{ padding: 18 }}>
              <h3>No chart data</h3>
              <p>Incentive charts appear after metric rows are loaded.</p>
            </div>
          )}
        </Card>
      </section>

      <Card
        title="Line Output Variance"
        subtitle="Positive bars are above forecast output; red bars show under-output."
      >
        {lineChartRows.length ? (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={lineChartRows}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="pieceVariance" name="PCS Variance" radius={[6, 6, 0, 0]}>
                  {lineChartRows.map((row) => (
                    <Cell
                      key={row.label}
                      fill={row.pieceVariance < 0 ? "#dc2626" : "#0f766e"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="ops-empty-state" style={{ padding: 18 }}>
            <h3>No chart data</h3>
            <p>Variance charts appear after metric rows are loaded.</p>
          </div>
        )}
      </Card>

      <Card
        title="Efficiency Report - Production"
        subtitle="Line-wise plan, forecast, actual, variance, and incentive values."
      >
        <div className="ops-table-wrap">
          <table className="ops-table ops-efficiency-table">
            <thead>
              <tr>
                <th colSpan={3}>Style</th>
                <th colSpan={3}>Plan Cadre</th>
                <th colSpan={4}>Actual Cadre</th>
                <th colSpan={2}>Working Hrs</th>
                <th colSpan={3}>Plan</th>
                <th colSpan={3}>Forecast</th>
                <th colSpan={3}>Actual</th>
                <th colSpan={2}>Variance</th>
                <th colSpan={3}>Incentive</th>
              </tr>
              <tr>
                <th>Date</th>
                <th>Line</th>
                <th>SMV</th>
                <th>MO</th>
                <th>HEL</th>
                <th>Total</th>
                <th>MO</th>
                <th>HEL</th>
                <th>TM</th>
                <th>Total</th>
                <th>Shift</th>
                <th>Clock</th>
                <th>PCS</th>
                <th>SAH</th>
                <th>EFF</th>
                <th>PCS</th>
                <th>SAH</th>
                <th>EFF</th>
                <th>PCS</th>
                <th>SAH</th>
                <th>EFF</th>
                <th>PCS</th>
                <th>SAH</th>
                <th>Band</th>
                <th>Incentive</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.productionDate || "—"}</td>
                  <td>
                    <div className="ops-row-title">{row.lineName || row.lineCode || "Unmapped line"}</div>
                    <div className="ops-row-subtitle">{row.lineCode || row.productionLineId || "—"}</div>
                  </td>
                  <td>{formatNumber(row.smv)}</td>
                  <td>{formatNumber(row.plannedMo)}</td>
                  <td>{formatNumber(row.plannedHel)}</td>
                  <td>{formatNumber(row.plannedCadreTotal)}</td>
                  <td>{formatNumber(row.actualMo)}</td>
                  <td>{formatNumber(row.actualHel)}</td>
                  <td>{formatNumber(row.teamMembers)}</td>
                  <td>{formatNumber(row.actualCadreTotal)}</td>
                  <td>{row.shiftCode || "—"}</td>
                  <td>{formatNumber(row.clockHours)}</td>
                  <td>{formatNumber(row.plannedPcs, 0)}</td>
                  <td>{formatNumber(row.plannedSah)}</td>
                  <td>{formatEfficiency(row.plannedEfficiency)}</td>
                  <td>{formatNumber(row.forecastPcs, 0)}</td>
                  <td>{formatNumber(row.forecastSah)}</td>
                  <td>{formatEfficiency(row.forecastEfficiency)}</td>
                  <td>{formatNumber(row.actualPcs, 0)}</td>
                  <td>{formatNumber(row.actualSah)}</td>
                  <td>{formatEfficiency(row.actualEfficiency)}</td>
                  <td>{formatNumber(row.pieceVariance, 0)}</td>
                  <td>{formatNumber(row.sahVariance)}</td>
                  <td>
                    <StatusBadge
                      label={row.linkedIncentiveBand || "No band"}
                      tone={row.linkedIncentiveBand ? "success" : "neutral"}
                    />
                  </td>
                  <td>{formatCurrency(row.linkedIncentiveAmount || 0)}</td>
                  <td>
                    {row.warnings.length ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {row.warnings.map((warning) => (
                          <StatusBadge key={warning} label={warning} tone="warning" />
                        ))}
                      </div>
                    ) : (
                      <StatusBadge label="Clean" tone="success" />
                    )}
                  </td>
                </tr>
              ))}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={26}>
                    <div className="ops-empty-state" style={{ padding: 18 }}>
                      <h3>No metric rows found</h3>
                      <p>Persisted calculation results will appear here after line metrics are generated.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="ops-grid cols-2">
        <Card
          title="Incentive Ladder"
          subtitle="Reference bands for actual efficiency and payout amount."
        >
          <div className="ops-table-wrap">
            <table className="ops-table ops-compact-table">
              <thead>
                <tr>
                  <th>Day / Band</th>
                  <th>Efficiency From</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {ladderRows.map((band) => (
                  <tr key={`${band.label}-${band.minEfficiency}`}>
                    <td>{band.label}</td>
                    <td>{formatEfficiency(band.minEfficiency)}</td>
                    <td>{formatCurrency(band.incentiveAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

      </section>
    </div>
  );
}

export default AttendanceOperationsPage;
