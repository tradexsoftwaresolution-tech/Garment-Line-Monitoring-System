Calculation Rules Folder
========================

This folder contains the editable rule sets that drive efficiency calculations,
incentive ladder lookups, and aggregation behavior for LineMatrix.

Safe update steps
-----------------

1. Edit only the YAML files referenced by `rule-set-manifest.yml`.
2. Keep `ruleSetId` stable for a rule family and increase `version` when the
   logic changes.
3. Validate every formula with the supported syntax only:
   - numbers
   - variables
   - `+`, `-`, `*`, `/`
   - parentheses
   - `safe_divide(a, b)`
   - `min(a, b)`, `max(a, b)`
4. Keep formula keys stable if downstream reports already depend on them.
5. Update ladder thresholds in ascending order.
6. Restart the backend or redeploy after changing these files.
7. Use the Calculation Rules screen or backend tests to confirm the rules load.

What not to change casually
---------------------------

- Do not rename the manifest file.
- Do not remove required formula keys without updating Java mappings.
- Do not introduce custom functions that the evaluator does not support.
- Do not leave overlapping incentive bands or descending thresholds.

Validation before deployment
----------------------------

- Run `cd backend && ./mvnw test`
- Check `/api/calculation-rules`
- Check `/api/calculation-rules/efficiency`
- Check `/api/calculation-rules/incentives`
