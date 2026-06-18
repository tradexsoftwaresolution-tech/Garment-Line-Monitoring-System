package com.garmentline.operations.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.JsonSupport;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@Service
public class PublicDashboardService {

  private static final ZoneId ATTENDANCE_ZONE = ZoneId.of("Asia/Colombo");
  private static final String LATE_FACE_ARRIVAL_CUTOFF = "08:00:00";

  private final SupabaseAdminClient supabaseAdminClient;

  public PublicDashboardService(SupabaseAdminClient supabaseAdminClient) {
    this.supabaseAdminClient = supabaseAdminClient;
  }

  public Map<String, Object> exclusiveDashboardSnapshot() {
    LocalDate attendanceDate = latestAttendanceDate();
    String attendanceDateText = attendanceDate.toString();

    List<JsonNode> employees =
        rows(select("employees", Map.of("is_active", "eq.true"), "employee_code.asc", null));
    List<JsonNode> employeeProfiles =
        rows(select("employee_profiles", Map.of(), null, null));
    List<JsonNode> productionLines =
        rows(select("production_lines", Map.of("is_active", "eq.true"), "code.asc", null));
    List<JsonNode> lineAssignments =
        rows(select("line_assignments", Map.of("status", "eq.Active"), "assigned_at.desc", null));
    List<JsonNode> reconciliationRows =
        rows(
            select(
                "attendance_reconciliation",
                Map.of("attendance_date", "eq." + attendanceDateText),
                "employee_code.asc",
                null));
    List<JsonNode> fingerprintRows =
        rows(
            select(
                "fingerprint_daily_attendance",
                Map.of("attendance_date", "eq." + attendanceDateText),
                "employee_code.asc",
                null));
    List<JsonNode> zktecoEvents =
        rows(
            select(
                "zkteco_fingerprint_events",
                Map.of("attendance_date", "eq." + attendanceDateText),
                "event_time.desc",
                null));
    List<JsonNode> hikvisionEvents = rows(selectHikvisionEvents(attendanceDate, 5000));

    Map<String, JsonNode> profilesByEmployeeId =
        employeeProfiles.stream()
            .filter(row -> hasText(text(row, "employee_id")))
            .collect(Collectors.toMap(row -> text(row, "employee_id"), row -> row, (left, right) -> left));
    Map<String, JsonNode> reconciliationByCode =
        reconciliationRows.stream()
            .filter(row -> hasText(text(row, "employee_code")))
            .collect(Collectors.toMap(row -> text(row, "employee_code"), row -> row, (left, right) -> left));
    Map<String, JsonNode> fingerprintByCode =
        fingerprintRows.stream()
            .filter(row -> hasText(text(row, "employee_code")))
            .collect(Collectors.toMap(row -> text(row, "employee_code"), row -> row, (left, right) -> left));
    Map<String, JsonNode> activeAssignmentsByEmployeeId = new LinkedHashMap<>();
    lineAssignments.forEach(
        assignment -> {
          String employeeId = text(assignment, "employee_id");
          if (hasText(employeeId)) {
            activeAssignmentsByEmployeeId.putIfAbsent(employeeId, assignment);
          }
        });

    List<Map<String, Object>> workers = new ArrayList<>();
    for (JsonNode employee : employees) {
      workers.add(
          workerSnapshot(
              employee,
              profilesByEmployeeId.get(text(employee, "id")),
              reconciliationByCode.get(text(employee, "employee_code")),
              fingerprintByCode.get(text(employee, "employee_code")),
              activeAssignmentsByEmployeeId.get(text(employee, "id"))));
    }

    List<Map<String, Object>> lines = lineSnapshots(productionLines, workers);
    List<Map<String, Object>> departments = departmentAttendance(workers);
    Map<String, Object> attendanceOverview = attendanceOverview(workers, attendanceDateText);

    Map<String, Object> snapshot = new LinkedHashMap<>();
    snapshot.put("attendanceOverview", attendanceOverview);
    snapshot.put("departmentAttendance", departments);
    snapshot.put("workers", workers);
    snapshot.put("lines", lines);
    snapshot.put("faceEvents", faceEvents(hikvisionEvents));
    snapshot.put("fingerprintDeviceSummary", fingerprintDeviceSummary(zktecoEvents, attendanceDateText));
    snapshot.put("fingerprintEvents", fingerprintEvents(zktecoEvents));
    snapshot.put("validationRecords", List.of());
    snapshot.put("lineAssignments", lineAssignmentSnapshots(lineAssignments));
    snapshot.put("lineOutputEntries", List.of());
    snapshot.put("transferLogs", List.of());
    snapshot.put("alerts", List.of());
    snapshot.put("attendanceSummaries", List.of());
    snapshot.put("overtimeRecords", List.of());
    snapshot.put("leaveRecords", List.of());
    snapshot.put("incentiveRecords", List.of());
    snapshot.put("auditLogs", List.of());
    snapshot.put("smartInsights", List.of());
    snapshot.put("announcements", List.of());
    snapshot.put("settings", defaultSettings());
    snapshot.put(
        "reportSeries",
        Map.of(
            "weeklyAttendance", List.of(),
            "departmentAttendance", departmentSeries(departments),
            "lineAttendance", lineSeries(lines),
            "transferHistory", List.of()));
    return snapshot;
  }

  private LocalDate latestAttendanceDate() {
    LocalDate current = LocalDate.now(ATTENDANCE_ZONE);
    LocalDate latest = null;

    latest = newestDate(latest, latestDateFrom("attendance_reconciliation", "attendance_date"));
    latest = newestDate(latest, latestDateFrom("fingerprint_daily_attendance", "attendance_date"));
    latest = newestDate(latest, latestDateFrom("zkteco_fingerprint_events", "attendance_date"));
    latest = newestDate(latest, latestHikvisionDate());

    return latest == null || latest.isAfter(current) ? current : latest;
  }

  private LocalDate latestDateFrom(String table, String field) {
    List<JsonNode> rows = rows(select(table, Map.of(), field + ".desc", 1));
    String value = rows.isEmpty() ? null : text(rows.get(0), field);
    if (!hasText(value)) {
      return null;
    }

    try {
      return LocalDate.parse(value);
    } catch (RuntimeException ignored) {
      return null;
    }
  }

  private LocalDate latestHikvisionDate() {
    List<JsonNode> rows = rows(select("hikvision_face_events", Map.of(), "event_time.desc", 1));
    String value = rows.isEmpty() ? null : text(rows.get(0), "event_time");
    if (!hasText(value)) {
      return null;
    }

    try {
      return OffsetDateTime.parse(value).atZoneSameInstant(ATTENDANCE_ZONE).toLocalDate();
    } catch (RuntimeException ignored) {
      return null;
    }
  }

  private LocalDate newestDate(LocalDate left, LocalDate right) {
    if (right == null) {
      return left;
    }
    if (left == null || right.isAfter(left)) {
      return right;
    }
    return left;
  }

  private Map<String, Object> workerSnapshot(
      JsonNode employee,
      JsonNode profile,
      JsonNode reconciliationRow,
      JsonNode fingerprintRow,
      JsonNode assignment) {
    String attendanceStatus = attendanceStatus(reconciliationRow, fingerprintRow);
    String employeeName =
        firstNonBlank(
            text(employee, "display_name"),
            text(reconciliationRow, "employee_name"),
            text(fingerprintRow, "employee_name"),
            text(employee, "employee_code"));
    String department =
        firstNonBlank(
            text(reconciliationRow, "department_name"),
            text(fingerprintRow, "department_name"),
            text(employee, "department_name"),
            "Unassigned");
    String role =
        firstNonBlank(
            text(reconciliationRow, "designation"),
            text(fingerprintRow, "designation"),
            text(employee, "designation"),
            "Worker");

    Map<String, Object> worker = new LinkedHashMap<>();
    worker.put("id", text(employee, "id"));
    worker.put("employeeId", text(employee, "employee_code"));
    worker.put("fullName", employeeName);
    if (hasText(text(profile, "photo_url"))) {
      worker.put("photoUrl", text(profile, "photo_url"));
    }
    worker.put("department", department);
    worker.put("roleTitle", role);
    if (assignment != null && hasText(text(assignment, "production_line_id"))) {
      worker.put("currentLineId", text(assignment, "production_line_id"));
    }
    worker.put("shift", firstNonBlank(text(profile, "shift_name"), "Shift A"));
    worker.put("attendanceStatus", attendanceStatus);
    worker.put("faceVerificationStatus", faceVerification(reconciliationRow));
    worker.put("fingerprintVerificationStatus", fingerprintVerification(fingerprintRow, reconciliationRow));
    worker.put("finalValidationStatus", reconciliationRow == null ? "Pending Validation" : "Fully Validated");
    worker.put("currentStatus", currentStatus(attendanceStatus, assignment));
    worker.put("skills", List.of());
    worker.put("notes", List.of());
    worker.put("flags", List.of());
    worker.put("supervisorRemarks", List.of());
    worker.put("phone", firstNonBlank(text(profile, "phone"), "Not set"));
    worker.put("joinDate", firstNonBlank(text(profile, "join_date"), ""));
    return worker;
  }

  private String attendanceStatus(JsonNode reconciliationRow, JsonNode fingerprintRow) {
    if (reconciliationRow != null) {
      String effectiveStatus =
          firstNonBlank(text(reconciliationRow, "manual_override_status"), text(reconciliationRow, "reconciliation_status"));

      if ("leave".equals(effectiveStatus)) {
        return "On Leave";
      }
      if ("absent".equals(effectiveStatus)) {
        return "Absent";
      }
      if (hasText(text(reconciliationRow, "fingerprint_time_in")) || hasText(text(reconciliationRow, "fingerprint_time_out"))) {
        return decimal(reconciliationRow, "late_early_hours") > 0 ? "Late" : "Present";
      }
      if (hasText(text(reconciliationRow, "face_first_seen"))) {
        return isLateFace(text(reconciliationRow, "face_first_seen")) ? "Late" : "Present";
      }
    }

    if (fingerprintRow != null) {
      if ("leave".equals(text(fingerprintRow, "attendance_state"))) {
        return "On Leave";
      }
      if ("present".equals(text(fingerprintRow, "attendance_state"))) {
        return decimal(fingerprintRow, "late_early_hours") > 0 ? "Late" : "Present";
      }
    }

    return "Absent";
  }

  private boolean isLateFace(String time) {
    if (!hasText(time)) {
      return false;
    }
    return time.length() >= 8 && time.substring(0, 8).compareTo(LATE_FACE_ARRIVAL_CUTOFF) > 0;
  }

  private String faceVerification(JsonNode row) {
    if (row == null) {
      return "Pending";
    }
    return integer(row, "face_event_count") > 0 ? "Verified" : "Missing";
  }

  private String fingerprintVerification(JsonNode fingerprintRow, JsonNode reconciliationRow) {
    if (fingerprintRow == null && reconciliationRow == null) {
      return "Pending";
    }

    if (hasText(text(fingerprintRow, "time_in"))
        || hasText(text(fingerprintRow, "time_out"))
        || hasText(text(fingerprintRow, "leave_type"))
        || hasText(text(reconciliationRow, "fingerprint_time_in"))
        || hasText(text(reconciliationRow, "fingerprint_time_out"))
        || hasText(text(reconciliationRow, "leave_type"))) {
      return "Verified";
    }

    return "Missing";
  }

  private String currentStatus(String attendanceStatus, JsonNode assignment) {
    if ("On Leave".equals(attendanceStatus)) {
      return "On Leave";
    }
    if ("Absent".equals(attendanceStatus)) {
      return "Off Shift";
    }
    return assignment == null ? "Pending Assignment" : "On Line";
  }

  private List<Map<String, Object>> lineSnapshots(
      List<JsonNode> productionLines, List<Map<String, Object>> workers) {
    List<Map<String, Object>> lines = new ArrayList<>();
    for (JsonNode row : productionLines) {
      String lineId = text(row, "id");
      List<Map<String, Object>> assigned =
          workers.stream()
              .filter(worker -> lineId.equals(worker.get("currentLineId")))
              .toList();
      int assignedWorkers = assigned.size();
      int presentWorkers = countStatus(assigned, "Present");
      int lateWorkers = countStatus(assigned, "Late");
      int onLeaveWorkers = countStatus(assigned, "On Leave");
      int absentWorkers = countStatus(assigned, "Absent");
      int attendanceRate = attendanceRate(presentWorkers, lateWorkers, assignedWorkers);
      int came = presentWorkers + lateWorkers;
      int gap = Math.max(assignedWorkers - came, 0);
      String status = assignedWorkers == 0 || came == 0 ? "Idle" : came >= Math.min(integer(row, "target_manpower"), assignedWorkers) ? "Active" : "Partial";
      String risk = gap >= 3 ? "Critical" : gap >= 1 ? "Watch" : "Stable";

      Map<String, Object> line = new LinkedHashMap<>();
      line.put("id", lineId);
      line.put("code", text(row, "code"));
      line.put("name", text(row, "name"));
      line.put("department", firstNonBlank(text(row, "department_name"), "Production"));
      if (hasText(text(row, "allocated_style"))) {
        line.put("allocatedStyle", text(row, "allocated_style"));
      }
      line.put("status", status);
      line.put("targetManpower", integer(row, "target_manpower"));
      line.put("actualManpower", assignedWorkers);
      line.put("assignedWorkers", assignedWorkers);
      line.put("presentWorkers", presentWorkers);
      line.put("lateWorkers", lateWorkers);
      line.put("onLeaveWorkers", onLeaveWorkers);
      line.put("absentWorkers", absentWorkers);
      line.put("attendanceRate", attendanceRate);
      line.put("efficiency", integer(row, "current_efficiency"));
      line.put("output", integer(row, "current_output"));
      line.put("targetOutput", integer(row, "target_output"));
      line.put("shift", firstNonBlank(text(row, "shift_name"), "Shift A"));
      line.put("supervisor", firstNonBlank(text(row, "supervisor_name"), "Unassigned"));
      line.put("risk", risk);
      if (hasText(text(row, "issue"))) {
        line.put("issue", text(row, "issue"));
      }
      lines.add(line);
    }
    return lines;
  }

  private int countStatus(List<Map<String, Object>> workers, String status) {
    return (int) workers.stream().filter(worker -> status.equals(worker.get("attendanceStatus"))).count();
  }

  private int attendanceRate(int presentWorkers, int lateWorkers, int totalWorkers) {
    if (totalWorkers <= 0) {
      return 0;
    }
    return Math.round(((presentWorkers + lateWorkers) * 100f) / totalWorkers);
  }

  private Map<String, Object> attendanceOverview(List<Map<String, Object>> workers, String attendanceDate) {
    Map<String, Object> overview = new LinkedHashMap<>();
    overview.put("attendanceDate", attendanceDate);
    overview.put("totalWorkers", workers.size());
    overview.put("presentWorkers", countStatus(workers, "Present"));
    overview.put("lateWorkers", countStatus(workers, "Late"));
    overview.put("onLeaveWorkers", countStatus(workers, "On Leave"));
    overview.put("absentWorkers", countStatus(workers, "Absent"));
    return overview;
  }

  private List<Map<String, Object>> departmentAttendance(List<Map<String, Object>> workers) {
    Map<String, Map<String, Object>> departments = new HashMap<>();
    for (Map<String, Object> worker : workers) {
      String department = String.valueOf(worker.getOrDefault("department", "Unassigned"));
      Map<String, Object> entry =
          departments.computeIfAbsent(
              department,
              key -> {
                Map<String, Object> value = new LinkedHashMap<>();
                value.put("department", key);
                value.put("totalWorkers", 0);
                value.put("presentWorkers", 0);
                value.put("lateWorkers", 0);
                value.put("onLeaveWorkers", 0);
                value.put("absentWorkers", 0);
                value.put("attendanceRate", 0);
                return value;
              });

      increment(entry, "totalWorkers");
      String status = String.valueOf(worker.get("attendanceStatus"));
      if ("Present".equals(status)) {
        increment(entry, "presentWorkers");
      } else if ("Late".equals(status)) {
        increment(entry, "lateWorkers");
      } else if ("On Leave".equals(status)) {
        increment(entry, "onLeaveWorkers");
      } else {
        increment(entry, "absentWorkers");
      }
    }

    return departments.values().stream()
        .peek(
            entry ->
                entry.put(
                    "attendanceRate",
                    attendanceRate(
                        (Integer) entry.get("presentWorkers"),
                        (Integer) entry.get("lateWorkers"),
                        (Integer) entry.get("totalWorkers"))))
        .sorted(
            Comparator.<Map<String, Object>, Integer>comparing(entry -> (Integer) entry.get("totalWorkers"))
                .reversed()
                .thenComparing(entry -> String.valueOf(entry.get("department"))))
        .toList();
  }

  private void increment(Map<String, Object> value, String key) {
    value.put(key, ((Integer) value.get(key)) + 1);
  }

  private Map<String, Object> fingerprintDeviceSummary(List<JsonNode> events, String attendanceDate) {
    Map<String, FingerprintGroup> groups = new LinkedHashMap<>();
    for (JsonNode event : events) {
      String pin = normalizePin(text(event, "employee_pin"));
      if (!hasText(pin)) {
        continue;
      }
      String punchAt = firstNonBlank(text(event, "event_time"), attendanceDate + "T" + firstNonBlank(text(event, "punch_time"), "00:00:00"));
      FingerprintGroup group = groups.computeIfAbsent(pin, FingerprintGroup::new);
      group.punchCount += 1;
      group.firstPunch = group.firstPunch == null || punchAt.compareTo(group.firstPunch) < 0 ? punchAt : group.firstPunch;
      group.lastPunch = group.lastPunch == null || punchAt.compareTo(group.lastPunch) > 0 ? punchAt : group.lastPunch;
      if ("matched".equals(text(event, "match_status")) || hasText(text(event, "employee_code")) || hasText(text(event, "employee_id"))) {
        group.matched = true;
        group.registeredPunches += 1;
      }
      if (hasText(text(event, "device_ip"))) {
        group.deviceIps.add(text(event, "device_ip"));
      }
    }

    List<Map<String, Object>> unregisteredPins =
        groups.values().stream()
            .filter(group -> !group.matched)
            .map(
                group -> {
                  Map<String, Object> value = new LinkedHashMap<>();
                  value.put("pin", group.pin);
                  value.put("firstPunch", group.firstPunch);
                  value.put("lastPunch", group.lastPunch);
                  value.put("punchCount", group.punchCount);
                  value.put("deviceIps", group.deviceIps.stream().sorted().toList());
                  return value;
                })
            .sorted(Comparator.comparing(value -> String.valueOf(value.get("pin"))))
            .toList();

    Map<String, Object> summary = new LinkedHashMap<>();
    summary.put("attendanceDate", attendanceDate);
    summary.put("totalDevicePins", groups.size());
    summary.put("registeredDevicePins", groups.values().stream().filter(group -> group.matched).count());
    summary.put("unregisteredDevicePins", unregisteredPins.size());
    summary.put("totalPunches", events.size());
    summary.put("registeredPunches", groups.values().stream().mapToInt(group -> group.registeredPunches).sum());
    summary.put("unregisteredPunches", unregisteredPins.stream().mapToInt(row -> (Integer) row.get("punchCount")).sum());
    summary.put("unregisteredPins", unregisteredPins);
    return summary;
  }

  private List<Map<String, Object>> faceEvents(List<JsonNode> events) {
    return events.stream()
        .map(
            event -> {
              Map<String, Object> value = new LinkedHashMap<>();
              value.put("id", "hikvision-" + firstNonBlank(text(event, "id"), text(event, "camera_event_id"), text(event, "event_time")));
              if (hasText(text(event, "employee_id"))) {
                value.put("workerId", text(event, "employee_id"));
              }
              value.put("timestamp", text(event, "event_time"));
              value.put("gate", firstNonBlank(text(event, "camera_name"), text(event, "camera_location"), "Hikvision Face"));
              value.put("confidence", "matched".equals(text(event, "match_status")) ? 96 : 0);
              value.put("outcome", "matched".equals(text(event, "match_status")) ? "matched" : "unknown");
              return value;
            })
        .toList();
  }

  private List<Map<String, Object>> fingerprintEvents(List<JsonNode> events) {
    return events.stream()
        .map(
            event -> {
              Map<String, Object> value = new LinkedHashMap<>();
              value.put("id", "zkteco-" + firstNonBlank(text(event, "id"), text(event, "event_uid"), text(event, "event_time")));
              if (hasText(text(event, "employee_id"))) {
                value.put("workerId", text(event, "employee_id"));
              }
              value.put("timestamp", text(event, "event_time"));
              value.put("gate", firstNonBlank(text(event, "device_ip"), text(event, "device_serial_no"), "ZKTeco Fingerprint"));
              value.put("confidence", "matched".equals(text(event, "match_status")) ? 92 : 0);
              value.put("outcome", "matched".equals(text(event, "match_status")) ? "matched" : "missing");
              return value;
            })
        .toList();
  }

  private List<Map<String, Object>> lineAssignmentSnapshots(List<JsonNode> rows) {
    return rows.stream()
        .map(
            row -> {
              Map<String, Object> value = new LinkedHashMap<>();
              value.put("id", text(row, "id"));
              value.put("workerId", text(row, "employee_id"));
              value.put("lineId", text(row, "production_line_id"));
              value.put("assignedAt", firstNonBlank(text(row, "assigned_at"), ""));
              value.put("assignedBy", firstNonBlank(text(row, "assigned_by"), "System"));
              value.put("status", firstNonBlank(text(row, "status"), "Active"));
              return value;
            })
        .toList();
  }

  private List<Map<String, Object>> departmentSeries(List<Map<String, Object>> departments) {
    return departments.stream()
        .map(
            department -> {
              Map<String, Object> value = new LinkedHashMap<>();
              value.put("label", department.get("department"));
              value.put("value", (Integer) department.get("presentWorkers") + (Integer) department.get("lateWorkers"));
              value.put("secondaryValue", department.get("totalWorkers"));
              value.put("tertiaryValue", department.get("onLeaveWorkers"));
              return value;
            })
        .toList();
  }

  private List<Map<String, Object>> lineSeries(List<Map<String, Object>> lines) {
    return lines.stream()
        .map(
            line -> {
              Map<String, Object> value = new LinkedHashMap<>();
              value.put("label", line.get("name"));
              value.put("value", (Integer) line.get("presentWorkers") + (Integer) line.get("lateWorkers"));
              value.put("secondaryValue", line.get("assignedWorkers"));
              value.put("tertiaryValue", line.get("absentWorkers"));
              return value;
            })
        .toList();
  }

  private Map<String, Object> defaultSettings() {
    Map<String, Object> settings = new LinkedHashMap<>();
    settings.put("faceRecognition", true);
    settings.put("fingerprintVerification", true);
    settings.put("dualValidationRequired", true);
    settings.put("autoRejectUnknownFaces", false);
    settings.put("manualVerificationFallback", true);
    settings.put("autoMarkAbsent", false);
    settings.put("morningShiftStart", "07:30");
    settings.put("morningShiftEnd", "17:30");
    settings.put("lateArrivalThreshold", 10);
    settings.put("gracePeriod", 5);
    settings.put("failedEntryAlerts", true);
    settings.put("lowEfficiencyWarnings", true);
    settings.put("workerAbsenceAlerts", true);
    settings.put("dailySummaryReport", true);
    return settings;
  }

  private ArrayNode select(String table, Map<String, String> filters, String order, Integer limit) {
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    filters.forEach(query::add);
    if (hasText(order)) {
      query.add("order", order);
    }
    if (limit != null) {
      query.add("limit", String.valueOf(limit));
      return supabaseAdminClient.select(table, query);
    }
    return supabaseAdminClient.selectAll(table, query);
  }

  private ArrayNode selectHikvisionEvents(LocalDate attendanceDate, int limit) {
    String start = attendanceDate.atStartOfDay(ATTENDANCE_ZONE).toInstant().toString();
    String end = attendanceDate.plusDays(1).atStartOfDay(ATTENDANCE_ZONE).toInstant().toString();
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("event_time", "gte." + start);
    query.add("event_time", "lt." + end);
    query.add("order", "event_time.desc");
    query.add("limit", String.valueOf(limit));
    return supabaseAdminClient.select("hikvision_face_events", query);
  }

  private List<JsonNode> rows(ArrayNode arrayNode) {
    return JsonSupport.toList(arrayNode);
  }

  private String normalizePin(String value) {
    if (!hasText(value)) {
      return "";
    }
    return value.trim().replaceFirst("^0+(?=\\d)", "");
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (hasText(value)) {
        return value.trim();
      }
    }
    return null;
  }

  private String text(JsonNode node, String field) {
    return JsonSupport.text(node, field);
  }

  private Integer integer(JsonNode node, String field) {
    Integer value = JsonSupport.integer(node, field);
    return value == null ? 0 : value;
  }

  private double decimal(JsonNode node, String field) {
    Double value = JsonSupport.decimal(node, field);
    return value == null ? 0 : value;
  }

  private boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private static final class FingerprintGroup {
    private final String pin;
    private final Set<String> deviceIps = new HashSet<>();
    private boolean matched;
    private int punchCount;
    private int registeredPunches;
    private String firstPunch;
    private String lastPunch;

    private FingerprintGroup(String pin) {
      this.pin = pin;
    }
  }
}
