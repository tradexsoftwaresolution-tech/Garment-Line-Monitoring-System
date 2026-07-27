package com.garmentline.operations.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.garmentline.operations.security.AuthenticatedUser;
import com.garmentline.operations.security.RoleGuard;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.ApiException;
import com.garmentline.operations.support.JsonSupport;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@Service
public class SkillMatrixService {

  private static final Logger LOGGER = LoggerFactory.getLogger(SkillMatrixService.class);

  private final SupabaseAdminClient supabaseAdminClient;
  private final RoleGuard roleGuard;

  public SkillMatrixService(SupabaseAdminClient supabaseAdminClient, RoleGuard roleGuard) {
    this.supabaseAdminClient = supabaseAdminClient;
    this.roleGuard = roleGuard;
  }

  public Map<String, Object> getMatrix(AuthenticatedUser user) {
    requireMatrixReadAccess(user);
    activateDueSchedulesSafely();
    MatrixRows rows = loadRows();
    return matrixPayload(rows);
  }

  @Scheduled(fixedDelayString = "${garmentline.skill-matrix.schedule-poll-ms:60000}")
  public void activateDueSchedulesOnTimer() {
    activateDueSchedulesSafely();
  }

  private void activateDueSchedulesSafely() {
    try {
      activateDueSchedules();
    } catch (RuntimeException exception) {
      LOGGER.warn("Failed to activate due line style schedules: {}", exception.getMessage());
    }
  }

  public Map<String, Object> saveOperation(AuthenticatedUser user, OperationRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    String code = requireText(request.operationCode(), "Operation code is required.").toUpperCase();
    String name = requireText(request.name(), "Operation name is required.");

    Map<String, Object> row = new LinkedHashMap<>();
    row.put("operation_code", code);
    row.put("name", name);
    row.put("category", blankToNull(request.category()));
    row.put("description", blankToNull(request.description()));
    row.put("is_active", request.isActive() == null || request.isActive());

    supabaseAdminClient.upsertMany("skill_operations", List.of(row), "operation_code");
    return getMatrix(user);
  }

  public Map<String, Object> saveLineOperation(AuthenticatedUser user, LineOperationRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    String productionLineId = requireText(request.productionLineId(), "Production line is required.");
    String operationId = requireText(request.operationId(), "Operation is required.");
    String positionLabel = requireText(request.positionLabel(), "Machine number is required.");

    Map<String, Object> row = new LinkedHashMap<>();
    row.put("production_line_id", productionLineId);
    row.put("operation_id", operationId);
    row.put("position_label", positionLabel);
    row.put("required_skill_percentage", clampPercent(request.requiredSkillPercentage(), 60));
    row.put("planned_operators", Math.max(1, request.plannedOperators() == null ? 1 : request.plannedOperators()));
    row.put("sequence_no", request.sequenceNo() == null ? 0 : request.sequenceNo());
    row.put("is_active", request.isActive() == null || request.isActive());

    String existingId = hasText(request.id()) ? request.id() : existingLineOperationId(productionLineId, positionLabel);
    if (hasText(existingId)) {
      supabaseAdminClient.updateSingle(
          "production_line_operations", filters(Map.of("id", "eq." + existingId)), row);
      return getMatrix(user);
    }

    supabaseAdminClient.upsertMany(
        "production_line_operations", List.of(row), "production_line_id,operation_id,position_label");
    return getMatrix(user);
  }

  public Map<String, Object> deleteLineOperation(AuthenticatedUser user, String id) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    supabaseAdminClient.delete("production_line_operations", filters(Map.of("id", "eq." + id)));
    return getMatrix(user);
  }

  private String existingLineOperationId(String productionLineId, String positionLabel) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("select", "id");
    query.add("production_line_id", "eq." + productionLineId);
    query.add("position_label", "eq." + positionLabel);
    query.add("is_active", "eq.true");
    query.add("limit", "1");
    ArrayNode rows = supabaseAdminClient.select("production_line_operations", query);
    return rows.size() == 0 ? null : JsonSupport.text(rows.get(0), "id");
  }

  public Map<String, Object> saveLinePositionAssignment(
      AuthenticatedUser user, LinePositionAssignmentRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor");
    Map<String, Object> row = new LinkedHashMap<>();
    if (hasText(request.id())) {
      row.put("id", request.id());
    }
    row.put("production_line_operation_id", requireText(request.lineOperationId(), "Machine operation is required."));
    row.put("employee_id", requireText(request.employeeId(), "Employee is required."));
    row.put("assigned_by", user.id());
    row.put("assigned_at", Instant.now().toString());
    row.put("is_active", request.isActive() == null || request.isActive());

    supabaseAdminClient.upsertMany("line_position_assignments", List.of(row), "employee_id");
    return getMatrix(user);
  }

  public Map<String, Object> deleteLinePositionAssignment(AuthenticatedUser user, String id) {
    roleGuard.requireAnyRole(user, "admin", "supervisor");
    supabaseAdminClient.delete("line_position_assignments", filters(Map.of("id", "eq." + id)));
    return getMatrix(user);
  }

  public Map<String, Object> saveStylePlan(AuthenticatedUser user, StylePlanRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    String styleNumber = requireText(request.styleNumber(), "Style number is required.");

    Map<String, Object> row = new LinkedHashMap<>();
    row.put("style_number", styleNumber);
    row.put("version", Math.max(1, request.version() == null ? 1 : request.version()));
    row.put("description", blankToNull(request.description()));
    row.put("is_active", request.isActive() == null || request.isActive());

    if (hasText(request.id())) {
      supabaseAdminClient.updateSingle(
          "style_operation_plans", filters(Map.of("id", "eq." + request.id())), row);
      return getMatrix(user);
    }

    row.put("created_by", user.id());
    supabaseAdminClient.upsertMany("style_operation_plans", List.of(row), "style_number,version");
    return getMatrix(user);
  }

  public Map<String, Object> deleteStylePlan(AuthenticatedUser user, String id) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    supabaseAdminClient.delete("style_operation_plans", filters(Map.of("id", "eq." + id)));
    return getMatrix(user);
  }

  public Map<String, Object> saveStylePlanMachine(
      AuthenticatedUser user, StylePlanMachineRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    String stylePlanId = requireText(request.styleOperationPlanId(), "Style plan is required.");
    String operationId = requireText(request.operationId(), "Operation is required.");
    String positionLabel = requireText(request.positionLabel(), "Machine number is required.");

    Map<String, Object> row = new LinkedHashMap<>();
    if (hasText(request.id())) {
      row.put("id", request.id());
    }
    row.put("style_operation_plan_id", stylePlanId);
    row.put("operation_id", operationId);
    row.put("position_label", positionLabel);
    row.put("required_skill_percentage", clampPercent(request.requiredSkillPercentage(), 60));
    row.put("planned_operators", Math.max(1, request.plannedOperators() == null ? 1 : request.plannedOperators()));
    row.put("station_type", stationType(request.stationType()));
    row.put("sequence_no", request.sequenceNo() == null ? 0 : request.sequenceNo());
    row.put("is_active", request.isActive() == null || request.isActive());

    String existingId = hasText(request.id()) ? request.id() : existingStylePlanMachineId(stylePlanId, positionLabel);
    if (hasText(existingId)) {
      supabaseAdminClient.updateSingle(
          "style_operation_plan_machines", filters(Map.of("id", "eq." + existingId)), row);
      return getMatrix(user);
    }

    supabaseAdminClient.upsertMany(
        "style_operation_plan_machines", List.of(row), "style_operation_plan_id,position_label");
    return getMatrix(user);
  }

  public Map<String, Object> deleteStylePlanMachine(AuthenticatedUser user, String id) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    supabaseAdminClient.delete("style_operation_plan_machines", filters(Map.of("id", "eq." + id)));
    return getMatrix(user);
  }

  public Map<String, Object> saveLineStyleSchedule(
      AuthenticatedUser user, LineStyleScheduleRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    String productionLineId = requireText(request.productionLineId(), "Production line is required.");
    String stylePlanId = requireText(request.styleOperationPlanId(), "Style plan is required.");
    String scheduledStartAt = requireText(request.scheduledStartAt(), "Schedule date and time are required.");

    Map<String, Object> row = new LinkedHashMap<>();
    if (hasText(request.id())) {
      row.put("id", request.id());
    }
    row.put("production_line_id", productionLineId);
    row.put("style_operation_plan_id", stylePlanId);
    row.put("scheduled_start_at", scheduledStartAt);
    row.put("scheduled_end_at", blankToNull(request.scheduledEndAt()));
    row.put("shift_name", shiftName(request.shiftName()));
    row.put("status", scheduleStatus(request.status()));
    row.put("notes", blankToNull(request.notes()));
    row.put("scheduled_by", user.id());

    if (hasText(request.id())) {
      supabaseAdminClient.updateSingle(
          "line_style_schedules", filters(Map.of("id", "eq." + request.id())), row);
      return getMatrix(user);
    }

    supabaseAdminClient.insertSingle("line_style_schedules", row);
    return getMatrix(user);
  }

  public Map<String, Object> cancelLineStyleSchedule(AuthenticatedUser user, String id) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("status", "cancelled");
    supabaseAdminClient.updateSingle("line_style_schedules", filters(Map.of("id", "eq." + id)), row);
    return getMatrix(user);
  }

  private String existingStylePlanMachineId(String stylePlanId, String positionLabel) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("select", "id");
    query.add("style_operation_plan_id", "eq." + stylePlanId);
    query.add("position_label", "eq." + positionLabel);
    query.add("is_active", "eq.true");
    query.add("limit", "1");
    ArrayNode rows = supabaseAdminClient.select("style_operation_plan_machines", query);
    return rows.size() == 0 ? null : JsonSupport.text(rows.get(0), "id");
  }

  public Map<String, Object> saveEmployeeSkill(AuthenticatedUser user, EmployeeSkillRequest request) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    Map<String, Object> row = new LinkedHashMap<>();
    if (hasText(request.id())) {
      row.put("id", request.id());
    }
    row.put("employee_id", requireText(request.employeeId(), "Employee is required."));
    row.put("operation_id", requireText(request.operationId(), "Operation is required."));
    row.put("skill_level_percentage", clampPercent(request.skillLevelPercentage(), 0));
    row.put("is_speciality", request.isSpeciality() != null && request.isSpeciality());
    row.put("notes", blankToNull(request.notes()));
    row.put("certified_at", blankToNull(request.certifiedAt()));

    supabaseAdminClient.upsertMany(
        "employee_operation_skills", List.of(row), "employee_id,operation_id");
    return getMatrix(user);
  }

  public Map<String, Object> deleteEmployeeSkill(AuthenticatedUser user, String id) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr");
    supabaseAdminClient.delete("employee_operation_skills", filters(Map.of("id", "eq." + id)));
    return getMatrix(user);
  }

  public Map<String, Object> recommend(
      AuthenticatedUser user, String lineOperationId, String absentEmployeeId) {
    requireAccess(user);
    activateDueSchedulesSafely();
    MatrixRows rows = loadRows();
    JsonNode lineOperation = findById(rows.lineOperations(), lineOperationId);
    if (lineOperation == null) {
      throw new ApiException(HttpStatus.NOT_FOUND, "Line operation was not found.");
    }

    String operationId = JsonSupport.text(lineOperation, "operation_id");
    String targetLineId = JsonSupport.text(lineOperation, "production_line_id");
    Set<String> excludedEmployeeIds = new HashSet<>();
    if (hasText(absentEmployeeId)) {
      excludedEmployeeIds.add(absentEmployeeId);
    }

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("lineOperation", lineOperationPayload(lineOperation, byId(rows.operations()), byId(rows.lines())));
    payload.put("candidates", buildCandidates(rows, operationId, targetLineId, excludedEmployeeIds, 30));
    return payload;
  }

  public Map<String, Object> lineRecommendations(AuthenticatedUser user, String lineId) {
    requireAccess(user);
    activateDueSchedulesSafely();
    MatrixRows rows = loadRows();
    Map<String, JsonNode> operationsById = byId(rows.operations());
    Map<String, JsonNode> linesById = byId(rows.lines());
    Map<String, JsonNode> lineOperationsById = byId(rows.lineOperations());
    Map<String, JsonNode> employeesById = byId(rows.employees());
    Map<String, JsonNode> profilesByEmployeeId = byField(rows.employeeProfiles(), "employee_id");
    Map<String, JsonNode> latestAttendanceByCode = latestAttendance(rows.attendanceRows());

    List<Map<String, Object>> recommendations = new ArrayList<>();
    rows.linePositionAssignments().forEach(
        assignment -> {
          if (!assignment.path("is_active").asBoolean(true)) {
            return;
          }
          JsonNode lineOperation =
              lineOperationsById.get(JsonSupport.text(assignment, "production_line_operation_id"));
          if (lineOperation == null || !Objects.equals(JsonSupport.text(lineOperation, "production_line_id"), lineId)) {
            return;
          }

          String employeeId = JsonSupport.text(assignment, "employee_id");
          JsonNode employee = employeesById.get(employeeId);
          if (employee == null) {
            return;
          }

          String attendanceStatus =
              attendanceStatus(latestAttendanceByCode.get(JsonSupport.text(employee, "employee_code")));
          boolean present = "Present".equals(attendanceStatus) || "Late".equals(attendanceStatus);
          if (present) {
            return;
          }

          Set<String> excludedEmployeeIds = new HashSet<>();
          excludedEmployeeIds.add(employeeId);
          List<Map<String, Object>> candidates =
              buildCandidates(
                  rows,
                  JsonSupport.text(lineOperation, "operation_id"),
                  lineId,
                  excludedEmployeeIds,
                  20)
                  .stream()
                  .filter(candidate -> Boolean.TRUE.equals(candidate.get("availableNow")))
                  .limit(5)
                  .toList();

          Map<String, Object> item = new LinkedHashMap<>();
          item.put("assignment", linePositionAssignmentPayload(assignment, lineOperationsById, operationsById, linesById, employeesById, profilesByEmployeeId));
          item.put("lineOperation", lineOperationPayload(lineOperation, operationsById, linesById));
          item.put("assignedEmployee", employeePayload(employee, profilesByEmployeeId.get(employeeId)));
          item.put("assignedAttendanceStatus", attendanceStatus);
          item.put("bestCandidate", candidates.isEmpty() ? null : candidates.get(0));
          item.put("candidates", candidates);
          recommendations.add(item);
        });

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("lineId", lineId);
    payload.put("lineName", linesById.containsKey(lineId) ? JsonSupport.text(linesById.get(lineId), "name") : null);
    payload.put("recommendations", recommendations);
    return payload;
  }

  private void activateDueSchedules() {
    String now = Instant.now().toString();
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("status", "eq.scheduled");
    query.add("scheduled_start_at", "lte." + now);
    query.add("order", "scheduled_start_at.asc");
    ArrayNode schedules = supabaseAdminClient.select("line_style_schedules", query);

    schedules.forEach(
        schedule -> {
          String lineId = JsonSupport.text(schedule, "production_line_id");
          String stylePlanId = JsonSupport.text(schedule, "style_operation_plan_id");
          if (!hasText(lineId) || !hasText(stylePlanId)) {
            return;
          }

          completeActiveSchedulesForLine(lineId, now);
          applyStylePlanToLine(stylePlanId, lineId, JsonSupport.text(schedule, "shift_name"));

          Map<String, Object> activated = new LinkedHashMap<>();
          activated.put("status", "active");
          activated.put("activated_at", now);
          supabaseAdminClient.updateSingle(
              "line_style_schedules",
              filters(Map.of("id", "eq." + JsonSupport.text(schedule, "id"))),
              activated);
        });
  }

  private void completeActiveSchedulesForLine(String lineId, String completedAt) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("select", "id");
    query.add("production_line_id", "eq." + lineId);
    query.add("status", "eq.active");
    ArrayNode activeRows = supabaseAdminClient.select("line_style_schedules", query);
    activeRows.forEach(
        row -> {
          Map<String, Object> payload = new LinkedHashMap<>();
          payload.put("status", "completed");
          payload.put("completed_at", completedAt);
          supabaseAdminClient.updateSingle(
              "line_style_schedules",
              filters(Map.of("id", "eq." + JsonSupport.text(row, "id"))),
              payload);
        });
  }

  private void applyStylePlanToLine(String stylePlanId, String lineId, String shiftName) {
    JsonNode stylePlan = fetchStylePlan(stylePlanId);
    if (stylePlan == null) {
      return;
    }

    deactivateCurrentLineOperations(lineId);

    LinkedMultiValueMap<String, String> machineQuery = new LinkedMultiValueMap<>();
    machineQuery.add("style_operation_plan_id", "eq." + stylePlanId);
    machineQuery.add("is_active", "eq.true");
    machineQuery.add("order", "sequence_no.asc,position_label.asc");
    ArrayNode machines = supabaseAdminClient.selectAll("style_operation_plan_machines", machineQuery);
    List<Map<String, Object>> liveOperations = new ArrayList<>();
    machines.forEach(
        machine -> {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("production_line_id", lineId);
          row.put("operation_id", JsonSupport.text(machine, "operation_id"));
          row.put("position_label", JsonSupport.text(machine, "position_label"));
          row.put("required_skill_percentage", JsonSupport.decimal(machine, "required_skill_percentage"));
          row.put("planned_operators", JsonSupport.integer(machine, "planned_operators"));
          row.put("sequence_no", JsonSupport.integer(machine, "sequence_no"));
          row.put("is_active", true);
          liveOperations.add(row);
        });

    supabaseAdminClient.upsertMany(
        "production_line_operations", liveOperations, "production_line_id,operation_id,position_label");

    Map<String, Object> lineUpdate = new LinkedHashMap<>();
    lineUpdate.put("allocated_style", JsonSupport.text(stylePlan, "style_number"));
    if (hasText(shiftName)) {
      lineUpdate.put("shift_name", shiftName(shiftName));
    }
    supabaseAdminClient.updateSingle("production_lines", filters(Map.of("id", "eq." + lineId)), lineUpdate);
  }

  private JsonNode fetchStylePlan(String stylePlanId) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("id", "eq." + stylePlanId);
    query.add("limit", "1");
    ArrayNode rows = supabaseAdminClient.select("style_operation_plans", query);
    return rows.size() == 0 ? null : rows.get(0);
  }

  private void deactivateCurrentLineOperations(String lineId) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("select", "id");
    query.add("production_line_id", "eq." + lineId);
    query.add("is_active", "eq.true");
    ArrayNode activeOperations = supabaseAdminClient.select("production_line_operations", query);
    activeOperations.forEach(
        operation -> {
          String operationId = JsonSupport.text(operation, "id");
          deactivatePositionAssignments(operationId);

          Map<String, Object> payload = new LinkedHashMap<>();
          payload.put("is_active", false);
          supabaseAdminClient.updateSingle(
              "production_line_operations", filters(Map.of("id", "eq." + operationId)), payload);
        });
  }

  private void deactivatePositionAssignments(String lineOperationId) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("select", "id");
    query.add("production_line_operation_id", "eq." + lineOperationId);
    query.add("is_active", "eq.true");
    ArrayNode activeAssignments = supabaseAdminClient.select("line_position_assignments", query);
    activeAssignments.forEach(
        assignment -> {
          Map<String, Object> payload = new LinkedHashMap<>();
          payload.put("is_active", false);
          supabaseAdminClient.updateSingle(
              "line_position_assignments",
              filters(Map.of("id", "eq." + JsonSupport.text(assignment, "id"))),
              payload);
        });
  }

  private MatrixRows loadRows() {
    MultiValueMap<String, String> activeOperations = new LinkedMultiValueMap<>();
    activeOperations.add("is_active", "eq.true");
    activeOperations.add("order", "name.asc");

    MultiValueMap<String, String> activeLines = new LinkedMultiValueMap<>();
    activeLines.add("is_active", "eq.true");
    activeLines.add("order", "code.asc");

    MultiValueMap<String, String> activeLineOperations = new LinkedMultiValueMap<>();
    activeLineOperations.add("is_active", "eq.true");
    activeLineOperations.add("order", "sequence_no.asc,position_label.asc");

    MultiValueMap<String, String> activeEmployees = new LinkedMultiValueMap<>();
    activeEmployees.add("is_active", "eq.true");
    activeEmployees.add("order", "employee_code.asc");

    MultiValueMap<String, String> activeAssignments = new LinkedMultiValueMap<>();
    activeAssignments.add("status", "eq.Active");
    activeAssignments.add("order", "assigned_at.desc");

    MultiValueMap<String, String> activeStylePlans = new LinkedMultiValueMap<>();
    activeStylePlans.add("is_active", "eq.true");
    activeStylePlans.add("order", "style_number.asc,version.desc");

    MultiValueMap<String, String> activeStyleMachines = new LinkedMultiValueMap<>();
    activeStyleMachines.add("is_active", "eq.true");
    activeStyleMachines.add("order", "sequence_no.asc,position_label.asc");

    MultiValueMap<String, String> styleSchedules = new LinkedMultiValueMap<>();
    styleSchedules.add("order", "scheduled_start_at.asc");

    MultiValueMap<String, String> attendanceRows = new LinkedMultiValueMap<>();
    attendanceRows.add("order", "attendance_date.desc,employee_code.asc");
    attendanceRows.add("limit", "2000");

    return new MatrixRows(
        supabaseAdminClient.selectAll("skill_operations", activeOperations),
        supabaseAdminClient.selectAll("production_line_operations", activeLineOperations),
        supabaseAdminClient.selectAll("employee_operation_skills", new LinkedMultiValueMap<>()),
        supabaseAdminClient.selectAll("line_position_assignments", activePositionAssignments()),
        supabaseAdminClient.selectAll("production_lines", activeLines),
        supabaseAdminClient.selectAll("employees", activeEmployees),
        supabaseAdminClient.selectAll("employee_profiles", new LinkedMultiValueMap<>()),
        supabaseAdminClient.selectAll("line_assignments", activeAssignments),
        supabaseAdminClient.selectAll("style_operation_plans", activeStylePlans),
        supabaseAdminClient.selectAll("style_operation_plan_machines", activeStyleMachines),
        supabaseAdminClient.selectAll("line_style_schedules", styleSchedules),
        supabaseAdminClient.select("attendance_reconciliation", attendanceRows));
  }

  private Map<String, Object> matrixPayload(MatrixRows rows) {
    Map<String, JsonNode> operationsById = byId(rows.operations());
    Map<String, JsonNode> linesById = byId(rows.lines());
    Map<String, JsonNode> employeesById = byId(rows.employees());
    Map<String, JsonNode> stylePlansById = byId(rows.stylePlans());
    Map<String, JsonNode> profilesByEmployeeId = byField(rows.employeeProfiles(), "employee_id");

    List<Map<String, Object>> operations = rows.operations().valueStream().map(this::operationPayload).toList();
    List<Map<String, Object>> lines = rows.lines().valueStream().map(this::linePayload).toList();
    List<Map<String, Object>> stylePlans =
        rows.stylePlans().valueStream().map(this::stylePlanPayload).toList();
    List<Map<String, Object>> stylePlanMachines =
        rows.stylePlanMachines().valueStream()
            .map(row -> stylePlanMachinePayload(row, stylePlansById, operationsById))
            .toList();
    List<Map<String, Object>> lineStyleSchedules =
        rows.lineStyleSchedules().valueStream()
            .map(row -> lineStyleSchedulePayload(row, stylePlansById, linesById))
            .toList();
    List<Map<String, Object>> employees =
        rows.employees().valueStream()
            .map(employee -> employeePayload(employee, profilesByEmployeeId.get(JsonSupport.text(employee, "id"))))
            .toList();
    List<Map<String, Object>> lineOperations =
        rows.lineOperations().valueStream()
            .map(row -> lineOperationPayload(row, operationsById, linesById))
            .toList();
    List<Map<String, Object>> employeeSkills =
        rows.employeeSkills().valueStream()
            .map(row -> employeeSkillPayload(row, operationsById, employeesById))
            .toList();
    List<Map<String, Object>> linePositionAssignments =
        rows.linePositionAssignments().valueStream()
            .map(row -> linePositionAssignmentPayload(row, byId(rows.lineOperations()), operationsById, linesById, employeesById, profilesByEmployeeId))
            .toList();

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("operations", operations);
    payload.put("lines", lines);
    payload.put("employees", employees);
    payload.put("lineOperations", lineOperations);
    payload.put("employeeSkills", employeeSkills);
    payload.put("linePositionAssignments", linePositionAssignments);
    payload.put("stylePlans", stylePlans);
    payload.put("stylePlanMachines", stylePlanMachines);
    payload.put("lineStyleSchedules", lineStyleSchedules);
    return payload;
  }

  private MultiValueMap<String, String> activePositionAssignments() {
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("is_active", "eq.true");
    query.add("order", "assigned_at.desc");
    return query;
  }

  private Map<String, Object> operationPayload(JsonNode row) {
    Map<String, Object> payload = basePayload(row);
    payload.put("operationCode", JsonSupport.text(row, "operation_code"));
    payload.put("name", JsonSupport.text(row, "name"));
    payload.put("category", JsonSupport.text(row, "category"));
    payload.put("description", JsonSupport.text(row, "description"));
    payload.put("isActive", row.path("is_active").asBoolean(true));
    return payload;
  }

  private Map<String, Object> linePayload(JsonNode row) {
    Map<String, Object> payload = basePayload(row);
    payload.put("code", JsonSupport.text(row, "code"));
    payload.put("name", JsonSupport.text(row, "name"));
    payload.put("department", JsonSupport.text(row, "department_name"));
    payload.put("shift", JsonSupport.text(row, "shift_name"));
    return payload;
  }

  private Map<String, Object> employeePayload(JsonNode row, JsonNode profile) {
    Map<String, Object> payload = basePayload(row);
    payload.put("employeeCode", JsonSupport.text(row, "employee_code"));
    payload.put("fullName", fallback(JsonSupport.text(row, "display_name"), JsonSupport.text(row, "employee_code")));
    payload.put("designation", fallback(JsonSupport.text(row, "designation"), "Worker"));
    payload.put("department", fallback(JsonSupport.text(row, "department_name"), "Unassigned"));
    payload.put("photoUrl", profile == null ? null : JsonSupport.text(profile, "photo_url"));
    return payload;
  }

  private Map<String, Object> stylePlanPayload(JsonNode row) {
    Map<String, Object> payload = basePayload(row);
    payload.put("styleNumber", JsonSupport.text(row, "style_number"));
    payload.put("version", JsonSupport.integer(row, "version"));
    payload.put("description", JsonSupport.text(row, "description"));
    payload.put("isActive", row.path("is_active").asBoolean(true));
    return payload;
  }

  private Map<String, Object> stylePlanMachinePayload(
      JsonNode row, Map<String, JsonNode> stylePlansById, Map<String, JsonNode> operationsById) {
    Map<String, Object> payload = basePayload(row);
    String stylePlanId = JsonSupport.text(row, "style_operation_plan_id");
    String operationId = JsonSupport.text(row, "operation_id");
    JsonNode stylePlan = stylePlansById.get(stylePlanId);
    JsonNode operation = operationsById.get(operationId);
    payload.put("styleOperationPlanId", stylePlanId);
    payload.put("styleNumber", stylePlan == null ? null : JsonSupport.text(stylePlan, "style_number"));
    payload.put("operationId", operationId);
    payload.put("operationCode", operation == null ? null : JsonSupport.text(operation, "operation_code"));
    payload.put("operationName", operation == null ? null : JsonSupport.text(operation, "name"));
    payload.put("positionLabel", JsonSupport.text(row, "position_label"));
    payload.put("requiredSkillPercentage", JsonSupport.decimal(row, "required_skill_percentage"));
    payload.put("plannedOperators", JsonSupport.integer(row, "planned_operators"));
    payload.put("stationType", JsonSupport.text(row, "station_type"));
    payload.put("sequenceNo", JsonSupport.integer(row, "sequence_no"));
    payload.put("isActive", row.path("is_active").asBoolean(true));
    return payload;
  }

  private Map<String, Object> lineStyleSchedulePayload(
      JsonNode row, Map<String, JsonNode> stylePlansById, Map<String, JsonNode> linesById) {
    Map<String, Object> payload = basePayload(row);
    String stylePlanId = JsonSupport.text(row, "style_operation_plan_id");
    String lineId = JsonSupport.text(row, "production_line_id");
    JsonNode stylePlan = stylePlansById.get(stylePlanId);
    JsonNode line = linesById.get(lineId);
    payload.put("productionLineId", lineId);
    payload.put("lineName", line == null ? null : JsonSupport.text(line, "name"));
    payload.put("lineCode", line == null ? null : JsonSupport.text(line, "code"));
    payload.put("styleOperationPlanId", stylePlanId);
    payload.put("styleNumber", stylePlan == null ? null : JsonSupport.text(stylePlan, "style_number"));
    payload.put("styleVersion", stylePlan == null ? null : JsonSupport.integer(stylePlan, "version"));
    payload.put("scheduledStartAt", JsonSupport.text(row, "scheduled_start_at"));
    payload.put("scheduledEndAt", JsonSupport.text(row, "scheduled_end_at"));
    payload.put("shiftName", JsonSupport.text(row, "shift_name"));
    payload.put("status", JsonSupport.text(row, "status"));
    payload.put("notes", JsonSupport.text(row, "notes"));
    payload.put("activatedAt", JsonSupport.text(row, "activated_at"));
    payload.put("completedAt", JsonSupport.text(row, "completed_at"));
    return payload;
  }

  private Map<String, Object> lineOperationPayload(
      JsonNode row, Map<String, JsonNode> operationsById, Map<String, JsonNode> linesById) {
    Map<String, Object> payload = basePayload(row);
    String operationId = JsonSupport.text(row, "operation_id");
    String lineId = JsonSupport.text(row, "production_line_id");
    JsonNode operation = operationsById.get(operationId);
    JsonNode line = linesById.get(lineId);
    payload.put("productionLineId", lineId);
    payload.put("lineName", line == null ? null : JsonSupport.text(line, "name"));
    payload.put("lineCode", line == null ? null : JsonSupport.text(line, "code"));
    payload.put("operationId", operationId);
    payload.put("operationCode", operation == null ? null : JsonSupport.text(operation, "operation_code"));
    payload.put("operationName", operation == null ? null : JsonSupport.text(operation, "name"));
    payload.put("positionLabel", JsonSupport.text(row, "position_label"));
    payload.put("requiredSkillPercentage", JsonSupport.decimal(row, "required_skill_percentage"));
    payload.put("plannedOperators", JsonSupport.integer(row, "planned_operators"));
    payload.put("sequenceNo", JsonSupport.integer(row, "sequence_no"));
    payload.put("isActive", row.path("is_active").asBoolean(true));
    return payload;
  }

  private Map<String, Object> employeeSkillPayload(
      JsonNode row, Map<String, JsonNode> operationsById, Map<String, JsonNode> employeesById) {
    Map<String, Object> payload = basePayload(row);
    String operationId = JsonSupport.text(row, "operation_id");
    String employeeId = JsonSupport.text(row, "employee_id");
    JsonNode operation = operationsById.get(operationId);
    JsonNode employee = employeesById.get(employeeId);
    payload.put("employeeId", employeeId);
    payload.put("employeeCode", employee == null ? null : JsonSupport.text(employee, "employee_code"));
    payload.put("fullName", employee == null ? null : fallback(JsonSupport.text(employee, "display_name"), JsonSupport.text(employee, "employee_code")));
    payload.put("operationId", operationId);
    payload.put("operationCode", operation == null ? null : JsonSupport.text(operation, "operation_code"));
    payload.put("operationName", operation == null ? null : JsonSupport.text(operation, "name"));
    payload.put("skillLevelPercentage", JsonSupport.decimal(row, "skill_level_percentage"));
    payload.put("isSpeciality", row.path("is_speciality").asBoolean(false));
    payload.put("notes", JsonSupport.text(row, "notes"));
    payload.put("certifiedAt", JsonSupport.text(row, "certified_at"));
    return payload;
  }

  private Map<String, Object> linePositionAssignmentPayload(
      JsonNode row,
      Map<String, JsonNode> lineOperationsById,
      Map<String, JsonNode> operationsById,
      Map<String, JsonNode> linesById,
      Map<String, JsonNode> employeesById,
      Map<String, JsonNode> profilesByEmployeeId) {
    Map<String, Object> payload = basePayload(row);
    String lineOperationId = JsonSupport.text(row, "production_line_operation_id");
    String employeeId = JsonSupport.text(row, "employee_id");
    JsonNode lineOperation = lineOperationsById.get(lineOperationId);
    JsonNode employee = employeesById.get(employeeId);
    JsonNode operation = lineOperation == null ? null : operationsById.get(JsonSupport.text(lineOperation, "operation_id"));
    JsonNode line = lineOperation == null ? null : linesById.get(JsonSupport.text(lineOperation, "production_line_id"));
    payload.put("lineOperationId", lineOperationId);
    payload.put("productionLineId", lineOperation == null ? null : JsonSupport.text(lineOperation, "production_line_id"));
    payload.put("lineName", line == null ? null : JsonSupport.text(line, "name"));
    payload.put("lineCode", line == null ? null : JsonSupport.text(line, "code"));
    payload.put("operationId", lineOperation == null ? null : JsonSupport.text(lineOperation, "operation_id"));
    payload.put("operationCode", operation == null ? null : JsonSupport.text(operation, "operation_code"));
    payload.put("operationName", operation == null ? null : JsonSupport.text(operation, "name"));
    payload.put("positionLabel", lineOperation == null ? null : JsonSupport.text(lineOperation, "position_label"));
    payload.put("requiredSkillPercentage", lineOperation == null ? null : JsonSupport.decimal(lineOperation, "required_skill_percentage"));
    payload.put("employeeId", employeeId);
    payload.put("employeeCode", employee == null ? null : JsonSupport.text(employee, "employee_code"));
    payload.put("fullName", employee == null ? null : fallback(JsonSupport.text(employee, "display_name"), JsonSupport.text(employee, "employee_code")));
    payload.put("photoUrl", JsonSupport.text(profilesByEmployeeId.get(employeeId), "photo_url"));
    payload.put("assignedAt", JsonSupport.text(row, "assigned_at"));
    payload.put("isActive", row.path("is_active").asBoolean(true));
    return payload;
  }

  private List<Map<String, Object>> buildCandidates(
      MatrixRows rows,
      String operationId,
      String targetLineId,
      Set<String> excludedEmployeeIds,
      int limit) {
    JsonNode operation = findById(rows.operations(), operationId);
    Map<String, JsonNode> employeesById = byId(rows.employees());
    Map<String, JsonNode> profilesByEmployeeId = byField(rows.employeeProfiles(), "employee_id");
    Map<String, JsonNode> activeAssignmentsByEmployeeId = activeAssignments(rows.lineAssignments());
    Map<String, JsonNode> activePositionAssignmentsByEmployeeId =
        activePositionAssignmentsByEmployeeId(rows.linePositionAssignments());
    Map<String, JsonNode> linesById = byId(rows.lines());
    Map<String, JsonNode> latestAttendanceByCode = latestAttendance(rows.attendanceRows());

    List<Map<String, Object>> candidates = new ArrayList<>();
    rows.employeeSkills().forEach(
        skill -> {
          if (!Objects.equals(JsonSupport.text(skill, "operation_id"), operationId)) {
            return;
          }
          String employeeId = JsonSupport.text(skill, "employee_id");
          if (employeeId == null || excludedEmployeeIds.contains(employeeId)) {
            return;
          }
          JsonNode employee = employeesById.get(employeeId);
          if (employee == null || !employee.path("is_active").asBoolean(true)) {
            return;
          }

          JsonNode assignment = activeAssignmentsByEmployeeId.get(employeeId);
          JsonNode floorAssignment = activePositionAssignmentsByEmployeeId.get(employeeId);
          JsonNode currentLine = assignment == null ? null : linesById.get(JsonSupport.text(assignment, "production_line_id"));
          JsonNode profile = profilesByEmployeeId.get(employeeId);
          JsonNode attendance = latestAttendanceByCode.get(JsonSupport.text(employee, "employee_code"));
          String attendanceStatus = attendanceStatus(attendance);
          boolean present = "Present".equals(attendanceStatus) || "Late".equals(attendanceStatus);
          boolean unassigned = assignment == null;
          boolean sameLine = assignment != null && Objects.equals(JsonSupport.text(assignment, "production_line_id"), targetLineId);

          Map<String, Object> candidate = new LinkedHashMap<>();
          candidate.put("employeeId", employeeId);
          candidate.put("employeeCode", JsonSupport.text(employee, "employee_code"));
          candidate.put("fullName", fallback(JsonSupport.text(employee, "display_name"), JsonSupport.text(employee, "employee_code")));
          candidate.put("designation", fallback(JsonSupport.text(employee, "designation"), "Worker"));
          candidate.put("department", fallback(JsonSupport.text(employee, "department_name"), "Unassigned"));
          candidate.put("photoUrl", JsonSupport.text(profile, "photo_url"));
          candidate.put("operationId", operationId);
          candidate.put("operationName", operation == null ? "Operation" : JsonSupport.text(operation, "name"));
          candidate.put("skillLevelPercentage", JsonSupport.decimal(skill, "skill_level_percentage"));
          candidate.put("isSpeciality", skill.path("is_speciality").asBoolean(false));
          candidate.put("attendanceStatus", attendanceStatus);
          candidate.put("currentLineId", assignment == null ? null : JsonSupport.text(assignment, "production_line_id"));
          candidate.put("currentLineName", currentLine == null ? null : JsonSupport.text(currentLine, "name"));
          candidate.put("floorAssigned", floorAssignment != null);
          candidate.put("availableNow", present);
          candidate.put("recommendationReason", recommendationReason(present, unassigned, sameLine, currentLine, floorAssignment != null));
          candidates.add(candidate);
        });

    candidates.sort(
        Comparator.<Map<String, Object>, Boolean>comparing(row -> Boolean.TRUE.equals(row.get("availableNow")))
            .reversed()
            .thenComparing(row -> Boolean.TRUE.equals(row.get("floorAssigned")) ? 1 : 0)
            .thenComparing(row -> (Double) row.getOrDefault("skillLevelPercentage", 0.0), Comparator.reverseOrder())
            .thenComparing(row -> Boolean.TRUE.equals(row.get("isSpeciality")) ? 0 : 1)
            .thenComparing(row -> String.valueOf(row.get("fullName"))));

    return candidates.stream().limit(limit).toList();
  }

  private Map<String, Object> basePayload(JsonNode row) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("id", JsonSupport.text(row, "id"));
    payload.put("createdAt", JsonSupport.text(row, "created_at"));
    payload.put("updatedAt", JsonSupport.text(row, "updated_at"));
    return payload;
  }

  private JsonNode findById(ArrayNode rows, String id) {
    if (id == null) {
      return null;
    }
    for (JsonNode row : rows) {
      if (id.equals(JsonSupport.text(row, "id"))) {
        return row;
      }
    }
    return null;
  }

  private Map<String, JsonNode> byId(ArrayNode rows) {
    return byField(rows, "id");
  }

  private Map<String, JsonNode> byField(ArrayNode rows, String field) {
    Map<String, JsonNode> values = new LinkedHashMap<>();
    rows.forEach(row -> {
      String key = JsonSupport.text(row, field);
      if (key != null && !values.containsKey(key)) {
        values.put(key, row);
      }
    });
    return values;
  }

  private Map<String, JsonNode> activeAssignments(ArrayNode rows) {
    Map<String, JsonNode> values = new LinkedHashMap<>();
    rows.forEach(row -> {
      String employeeId = JsonSupport.text(row, "employee_id");
      if (employeeId != null && !values.containsKey(employeeId)) {
        values.put(employeeId, row);
      }
    });
    return values;
  }

  private Map<String, JsonNode> activePositionAssignmentsByEmployeeId(ArrayNode rows) {
    Map<String, JsonNode> values = new LinkedHashMap<>();
    rows.forEach(row -> {
      String employeeId = JsonSupport.text(row, "employee_id");
      if (employeeId != null && row.path("is_active").asBoolean(true) && !values.containsKey(employeeId)) {
        values.put(employeeId, row);
      }
    });
    return values;
  }

  private Map<String, JsonNode> latestAttendance(ArrayNode rows) {
    Map<String, JsonNode> values = new LinkedHashMap<>();
    rows.forEach(row -> {
      String employeeCode = JsonSupport.text(row, "employee_code");
      if (employeeCode != null && !values.containsKey(employeeCode)) {
        values.put(employeeCode, row);
      }
    });
    return values;
  }

  private String attendanceStatus(JsonNode attendance) {
    if (attendance == null) {
      return "Unknown";
    }
    String state =
        fallback(
            JsonSupport.text(attendance, "manual_override_status"),
            JsonSupport.text(attendance, "reconciliation_status"));
    if ("leave".equals(state)) {
      return "On Leave";
    }
    if ("absent".equals(state)) {
      return "Absent";
    }
    if (JsonSupport.text(attendance, "fingerprint_time_in") != null
        || JsonSupport.text(attendance, "fingerprint_time_out") != null
        || JsonSupport.text(attendance, "face_first_seen") != null
        || List.of("validated", "face_only", "fingerprint_only").contains(state)) {
      Double lateHours = JsonSupport.decimal(attendance, "late_early_hours");
      return lateHours != null && lateHours > 0 ? "Late" : "Present";
    }
    return "Absent";
  }

  private String recommendationReason(
      boolean present, boolean unassigned, boolean sameLine, JsonNode currentLine, boolean floorAssigned) {
    if (!present) {
      return "Not currently available from latest attendance data.";
    }
    if (floorAssigned) {
      return "Present with matching skill; already mapped to another floor-plan machine.";
    }
    if (sameLine) {
      return "Already assigned to the target line and can be repositioned.";
    }
    if (unassigned) {
      return "Present and not assigned to another active line.";
    }
    return "Present; transfer candidate from " + JsonSupport.text(currentLine, "name") + ".";
  }

  private MultiValueMap<String, String> filters(Map<String, String> values) {
    LinkedMultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    values.forEach(query::add);
    return query;
  }

  private void requireAccess(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr", "viewer");
  }

  private void requireMatrixReadAccess(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "hr", "ie", "viewer");
  }

  private String requireText(String value, String message) {
    if (!hasText(value)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, message);
    }
    return value.trim();
  }

  private String blankToNull(String value) {
    return hasText(value) ? value.trim() : null;
  }

  private String stationType(String value) {
    if (!hasText(value)) {
      return "mo";
    }
    String normalized = value.trim().toLowerCase();
    if ("helper".equals(normalized) || "other".equals(normalized)) {
      return normalized;
    }
    return "mo";
  }

  private String shiftName(String value) {
    return "Shift B".equals(value) ? "Shift B" : "Shift A";
  }

  private String scheduleStatus(String value) {
    if (!hasText(value)) {
      return "scheduled";
    }
    String normalized = value.trim().toLowerCase();
    if (Set.of("draft", "scheduled", "active", "completed", "cancelled").contains(normalized)) {
      return normalized;
    }
    return "scheduled";
  }

  private boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private double clampPercent(Double value, double fallback) {
    double number = value == null ? fallback : value;
    return Math.max(0, Math.min(100, number));
  }

  private String fallback(String value, String fallback) {
    return hasText(value) ? value : fallback;
  }

  public record OperationRequest(
      String operationCode,
      String name,
      String category,
      String description,
      Boolean isActive) {
  }

  public record LineOperationRequest(
      String id,
      String productionLineId,
      String operationId,
      String positionLabel,
      Double requiredSkillPercentage,
      Integer plannedOperators,
      Integer sequenceNo,
      Boolean isActive) {
  }

  public record EmployeeSkillRequest(
      String id,
      String employeeId,
      String operationId,
      Double skillLevelPercentage,
      Boolean isSpeciality,
      String notes,
      String certifiedAt) {
  }

  public record LinePositionAssignmentRequest(
      String id,
      String lineOperationId,
      String employeeId,
      Boolean isActive) {
  }

  public record StylePlanRequest(
      String id,
      String styleNumber,
      Integer version,
      String description,
      Boolean isActive) {
  }

  public record StylePlanMachineRequest(
      String id,
      String styleOperationPlanId,
      String operationId,
      String positionLabel,
      Double requiredSkillPercentage,
      Integer plannedOperators,
      String stationType,
      Integer sequenceNo,
      Boolean isActive) {
  }

  public record LineStyleScheduleRequest(
      String id,
      String productionLineId,
      String styleOperationPlanId,
      String scheduledStartAt,
      String scheduledEndAt,
      String shiftName,
      String notes,
      String status) {
  }

  private record MatrixRows(
      ArrayNode operations,
      ArrayNode lineOperations,
      ArrayNode employeeSkills,
      ArrayNode linePositionAssignments,
      ArrayNode lines,
      ArrayNode employees,
      ArrayNode employeeProfiles,
      ArrayNode lineAssignments,
      ArrayNode stylePlans,
      ArrayNode stylePlanMachines,
      ArrayNode lineStyleSchedules,
      ArrayNode attendanceRows) {
  }
}
