Incentive Calculation Flow
==========================

Purpose
-------

This document describes how LineMatrix converts production inputs into
efficiency metrics, incentive outcomes, persisted snapshots, and reportable
results.

End-to-End Flow
---------------

```text
line input / imported report
  -> EfficiencyCalculationInput
  -> EfficiencyCalculationService
  -> EfficiencyCalculationResult
  -> IncentiveCalculationService
  -> IncentiveCalculationResult
  -> ProductionMetricsService persistence
  -> dashboard / line details / incentive reports / audit views
```

Step 1: Input
-------------

The calculation engine accepts a typed input model:

- `productionLineId`
- `productionDate`
- `shiftCode`
- `plannedMo`
- `plannedHel`
- `actualMo`
- `actualHel`
- `teamMembers`
- `workingHours`
- `smv`
- `plannedPcs`
- `forecastPcs`
- `actualPcs`
- `remarks`
- `lostTimeMinutes`
- `sourceMetadata`

Inputs can come from:

- future operations entry screens
- imported production reports
- batch recalculation from already persisted metric rows

Step 2: Efficiency Formulas
---------------------------

`EfficiencyCalculationService` evaluates the workbook formulas defined in:

- `default-efficiency-formulas.yml`
- `default-efficiency-constants.yml`

The result includes:

- cadre totals
- clock hours
- planned / forecast / actual SAH
- planned / forecast / actual efficiency
- piece variance
- SAH variance
- warnings
- rule-set metadata
- debug snapshot

Step 3: Incentive Lookup
------------------------

`IncentiveCalculationService` reads:

- `default-incentive-ladder.yml`
- `default-incentive-policy.yml`

It uses `actual_efficiency` as the default basis metric and returns:

- basis metric
- basis value
- matched incentive band label
- incentive amount
- warnings
- rule-set metadata

Step 4: Persistence
-------------------

`ProductionMetricsService` persists three layers:

1. `production_line_daily_metrics`
   - raw inputs
   - calculated efficiency outputs
   - warnings
   - formula rule version used

2. `incentive_records`
   - basis metric/value
   - band used
   - incentive amount
   - incentive rule version used

3. `calculation_audit_snapshots`
   - full input payload
   - full output payload
   - warnings
   - formula + incentive rule identifiers

Step 5: Reporting
-----------------

Read models are served from the backend through:

- `/api/calculations/metrics`
- `/api/calculations/incentives`
- `/api/calculations/metrics/{metricId}/audit`

These endpoints power:

- line details
- incentive report screen
- admin audit/debug view
- rule preview + recalculation tooling

Recalculation
-------------

Rule changes should not require code changes in services or controllers.

After a ladder or formula update:

1. edit the YAML file
2. increment the rule version
3. restart the backend
4. call `/api/calculations/recalculate`

`CalculationBatchService` reloads stored metric inputs, reruns the calculation
engine, and writes fresh metric/incentive/audit records using the new rule
versions.

Audit Guarantees
----------------

Every persisted result records:

- exact input values
- exact output values
- warnings raised during evaluation
- formula rule set id + version
- incentive rule set id + version

This makes the system explainable even when the business updates ladder
thresholds later.

Edge Case Handling
------------------

The engine is intentionally defensive.

- zero or missing planned cadre: planned efficiency becomes `0`
- zero or missing actual cadre: forecast/actual efficiency become `0`
- zero working hours: protected divide returns `0`
- zero actual output: actual SAH becomes `0`
- empty or inactive rows: no crash, only warnings

The backend never emits spreadsheet-style runtime failures.
