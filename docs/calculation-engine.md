Calculation Engine
==================

Overview
--------

LineMatrix now contains a dedicated calculation module for workbook-style
production efficiency and incentive logic. The backend owns this flow so the
frontend never becomes the source of truth for formulas, thresholds, or payout
rules.

The engine was built from the audited `REPORT-1.xlsx` workbook logic and keeps
all editable rule definitions in YAML under:

`backend/src/main/resources/calculation-rules/`

Goals
-----

- Keep formulas and ladders editable without touching controllers or pages.
- Make every output traceable to a specific rule-set version.
- Prevent spreadsheet-style failures such as `#DIV/0!`.
- Support recalculation when business rules change.

Folder Structure
----------------

Rules:

```text
backend/src/main/resources/calculation-rules/
  README.md
  rule-set-manifest.yml
  efficiency/
    default-efficiency-formulas.yml
    default-efficiency-constants.yml
  incentives/
    default-incentive-ladder.yml
    default-incentive-policy.yml
  totals/
    default-aggregation-rules.yml
```

Java:

```text
backend/src/main/java/com/garmentline/operations/calculations/
  engine/
  evaluator/
  incentives/
  loader/
  model/
  reports/
  validation/
```

Database:

- `calculation_rule_sets`
- `production_line_daily_metrics`
- `incentive_records`
- `calculation_audit_snapshots`

How Rule Loading Works
----------------------

1. `CalculationRuleLoaderService` reads `rule-set-manifest.yml`.
2. The manifest points to the active YAML files for formulas, constants,
   ladders, policy, and aggregation behavior.
3. `CalculationRuleValidator` validates:
   - required sections
   - supported expressions
   - formula dependency order
   - ascending incentive bands
4. The loader exposes typed rule models to the rest of the application.

Formula Evaluation
------------------

`SafeExpressionEvaluator` is a small custom evaluator. It supports only:

- numbers
- variable names
- `+`, `-`, `*`, `/`
- parentheses
- `safe_divide(a, b)`
- `min(a, b)`
- `max(a, b)`

This avoids dangerous unrestricted expression execution.

Workbook Formulas Implemented
-----------------------------

- `plannedCadreTotal = planned_mo + planned_hel`
- `actualCadreTotal = actual_mo + actual_hel + team_members`
- `clockHours = working_hours * actual_cadre_total`
- `plannedSah = planned_pcs * smv / 60`
- `plannedEfficiency = safe_divide(planned_sah, planned_cadre_total * working_hours)`
- `forecastSah = forecast_pcs * smv / 60`
- `forecastEfficiency = safe_divide(forecast_sah, clock_hours)`
- `actualSah = actual_pcs * smv / 60`
- `actualEfficiency = safe_divide(actual_sah, clock_hours)`
- `pieceVariance = actual_pcs - forecast_pcs`
- `sahVariance = actual_sah - forecast_sah`

Safe Divide and Warnings
------------------------

Every protected division uses `safe_divide`.

Behavior:

- denominator `null` or `0` returns `0`
- a warning flag is added to the result
- the engine continues without crashing

Common warning flags:

- `DIVIDE_BY_ZERO_PROTECTED`
- `NO_PLANNED_CADRE`
- `NO_ACTUAL_CADRE`
- `NO_WORKING_HOURS`
- `NO_OUTPUT`
- `EMPTY_LINE_INPUT`

Incentive Ladder
----------------

The incentive ladder is defined entirely in:

`backend/src/main/resources/calculation-rules/incentives/default-incentive-ladder.yml`

It is based on the efficiency ladder audited from `REPORT-1.xlsx`. Each band
contains:

- minimum efficiency
- exclusive maximum efficiency
- human-readable label
- incentive amount

`IncentiveCalculationService` reads the active ladder and resolves the band
from `actual_efficiency`.

Persistence and Auditability
----------------------------

Each persisted calculation stores:

- raw inputs in `production_line_daily_metrics`
- calculated outputs in `production_line_daily_metrics`
- incentive outcome in `incentive_records`
- input/output snapshot plus warnings in `calculation_audit_snapshots`
- active rule metadata in `formula_rule_set_id`, `formula_rule_version`,
  `incentive_rule_set_id`, and `incentive_rule_version`

That means every line-day record can be explained later even if the business
updates the ladder.

Where It Plugs Into The Project
-------------------------------

- Spring Boot controllers expose preview, save, list, audit, and recalculation
  endpoints.
- The production lines screen now shows the latest calculated metrics and
  incentive outcome.
- The settings screen now previews active rule sets and allows recalculation.
- The incentives screen now reads persisted incentive records instead of mock
  frontend-only logic.
- `operations-service.ts` includes the latest metric and incentive values in
  line snapshots for the UI.

Recalculation Flow
------------------

When a rule file changes:

1. update the YAML file
2. increment the rule `version`
3. restart or redeploy the backend
4. verify the active rules using `/api/calculation-rules`
5. trigger `/api/calculations/recalculate`

Testing
-------

The backend test suite covers:

- expression evaluation
- safe divide behavior
- workbook formula outputs
- zero-hour and empty-row handling
- ladder threshold selection
- metrics/incentive/audit persistence

Run:

```bash
cd backend
./mvnw test
```
