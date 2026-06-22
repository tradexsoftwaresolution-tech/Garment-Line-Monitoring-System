# Supabase Schema

## Overview

The LineMatrix backend uses Supabase for:

- authentication and profile roles
- storage of original import files
- raw staging tables for auditability
- normalized attendance tables
- reconciliation output for the Validation Center and reporting views
- operational line, alert, note, and settings data that powers the rest of the frontend

## Core Tables

### `profiles`

Links `auth.users` to application roles.

- `role`: `admin`, `supervisor`, `hr`, `viewer`
- used by RLS and UI route gating

### `departments`

Reference table for department names discovered during imports or seeded manually.

### `employees`

Canonical worker master table.

- `employee_code` is the canonical join key
- face imports use `ID`
- fingerprint imports prefer `EmpNo` and fall back to `EpfNo`
- `source_priority_name` prevents weak face-source names from overwriting stronger fingerprint names

### `leave_code_map`

Editable mapping table for leave and absence codes from fingerprint exports.

## Import Tables

### `import_batches`

One record per uploaded file.

- tracks source type, storage path, counts, timestamps, and status
- statuses progress through `uploaded -> processing -> parsed -> normalized -> reconciled/completed`

### `face_raw_rows`

Preserves every parsed face workbook row before normalization.

### `fingerprint_raw_rows`

Preserves every parsed fingerprint export row before normalization.

## Normalized Tables

### `face_events`

One normalized event per valid face timestamp token.

- duplicate timestamps are preserved with `is_duplicate = true`
- invalid tokens stay in raw rows and summary flags

### `face_daily_summary`

Per employee per day face summary.

- first/last seen
- event counts
- duplicate counts
- normalized record array
- quality flags

### `fingerprint_daily_attendance`

Per employee per day fingerprint summary.

- time in/out
- OT and late/early
- leave totals
- `attendance_state`
- quality flags for zero time pairs, malformed fields, and invalid time conversions

## Reconciliation Tables

### `attendance_reconciliation`

The main operational dataset for the Validation Center.

- one row per employee per day
- stores both source summaries
- stores reconciliation status, flags, confidence, and manual override metadata

### `reconciliation_notes`

Human notes attached to reconciliation rows.

### `audit_logs`

Immutable-style audit trail for reconciliation runs, overrides, and note actions.

## Operational UI Tables

### `production_lines`

Master data for line cards, floor-map views, and assignment targets.

- line code and name
- department and shift
- supervisor
- target manpower and output
- current efficiency, output, and issue fields

### `employee_profiles`

Frontend-facing worker profile extensions on top of `employees`.

- shift
- phone
- join date
- skills
- optional daily and OT rates for live attendance totals

### `employee_notes`

Auditable worker note stream used to build:

- notes
- flags / exceptions
- supervisor remarks

### `line_assignments`

Current and historical line placements.

- only one `Active` assignment is allowed per employee
- transfers close the old row and create a new active row

### `transfer_logs`

Explicit movement history for line balancing and reporting.

### `operations_alerts`

Live alert queue used by Dashboard, Alerts Center, and Display Mode.

- supports manual and reconciliation-sourced alerts
- `reconciliation_id` links alert rows back to attendance exceptions

### `operations_alert_history`

Chronological alert actions such as:

- status changes
- ownership changes
- system-generated alert creation/resolution

### `system_settings`

Singleton row used by the Settings page and operational feature flags.

### `announcements`

Scrollable public display messages for TV mode and operations updates.

### `incentive_records`

Manual or imported incentive adjustments used in worker and payroll summary screens.

### `production_line_daily_metrics`

Daily output and efficiency history for reports and current line performance cards.

## Views

### `vw_validation_summary`

Daily summary counts by reconciliation status.

### `vw_department_validation_summary`

Daily summary counts grouped by department.

### `vw_reconciliation_exceptions`

Exception-focused projection of reconciliation rows where the effective status is:

- `face_only`
- `fingerprint_only`
- `needs_review`
- `anomaly`

## RPC Functions

### `rpc_reconcile_attendance(face_batch_id, fingerprint_batch_id)`

Runs the SQL reconciliation pass for a face/fingerprint batch pair and upserts operational rows.

### `rpc_override_reconciliation(...)`

Stores manual overrides without deleting the original pipeline output.

### `rpc_add_reconciliation_note(...)`

Adds a note and writes an audit event.

### `rpc_assign_worker_to_line(...)`

Creates an active line assignment and writes an audit event.

### `rpc_transfer_worker_line(...)`

Closes the current assignment, creates the next one, writes a transfer log, and records audit history.

### `rpc_sync_reconciliation_alerts()`

Upserts alert rows for current reconciliation exceptions so the non-validation screens stay in sync with the backend pipeline.

## Storage

Bucket: `imports`

Path convention:

`imports/{source_type}/{yyyy}/{mm}/{batch_id}/{original_filename}`

Only `admin` and `hr` can read/write import files through storage policies.
