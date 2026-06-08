package com.garmentline.operations.zkteco;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.garmentline.operations.config.ZktecoProperties;
import com.garmentline.operations.security.AuthenticatedUser;
import com.garmentline.operations.security.RoleGuard;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.ApiException;
import com.garmentline.operations.support.JsonSupport;
import com.garmentline.operations.zkteco.model.ZktecoAdmsResponse;
import com.garmentline.operations.zkteco.model.ZktecoStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@Service
public class ZktecoAdmsService {

  private static final int MAX_EVENTS = 500;
  private static final int DEFAULT_DELAY_SECONDS = 10;
  private static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Colombo");
  private static final List<DateTimeFormatter> LOCAL_DATE_TIME_FORMATTERS =
      List.of(
          DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
          DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"),
          DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss"),
          DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm"));

  private final SupabaseAdminClient supabaseAdminClient;
  private final ObjectMapper objectMapper;
  private final RoleGuard roleGuard;
  private final ZktecoProperties properties;
  private final ZoneId attendanceZone;
  private final Map<String, EmployeeMatch> employeeCache = new ConcurrentHashMap<>();

  public ZktecoAdmsService(
      SupabaseAdminClient supabaseAdminClient,
      ObjectMapper objectMapper,
      RoleGuard roleGuard,
      ZktecoProperties properties) {
    this.supabaseAdminClient = supabaseAdminClient;
    this.objectMapper = objectMapper;
    this.roleGuard = roleGuard;
    this.properties = properties;
    this.attendanceZone = resolveZone(properties.timeZone());
  }

  public String options(MultiValueMap<String, String> query, HttpHeaders headers, String remoteIp) {
    validateCommKey(query, headers);
    String serialNo = requireSerialNo(query);
    touchDevice(serialNo, remoteIp, "options", query);

    int delaySeconds =
        properties.admsDelaySeconds() == null || properties.admsDelaySeconds() < 1
            ? DEFAULT_DELAY_SECONDS
            : properties.admsDelaySeconds();
    String serverVersion =
        properties.serverVersion() == null || properties.serverVersion().isBlank()
            ? "GarmentLine-ZKTeco-ADMS"
            : properties.serverVersion().trim();

    return "GET OPTION FROM: " + serialNo + "\r\n"
        + "Stamp=9999\r\n"
        + "OpStamp=9999\r\n"
        + "ErrorDelay=" + Math.max(30, delaySeconds * 3) + "\r\n"
        + "Delay=" + delaySeconds + "\r\n"
        + "TransTimes=00:00;14:00\r\n"
        + "TransInterval=1\r\n"
        + "TransFlag=1111000000\r\n"
        + "Realtime=1\r\n"
        + "Encrypt=0\r\n"
        + "ServerVer=" + serverVersion + "\r\n";
  }

  public ZktecoAdmsResponse receiveCdata(
      MultiValueMap<String, String> query, HttpHeaders headers, String body, String remoteIp) {
    validateCommKey(query, headers);
    String serialNo = requireSerialNo(query);
    String tableName = firstNonBlank(param(query, "table"), param(query, "tablename"), "ATTLOG");
    String sourceIp = firstNonBlank(param(query, "DeviceIP"), remoteIp);
    touchDevice(serialNo, sourceIp, tableName, query);

    if (!"ATTLOG".equalsIgnoreCase(tableName)) {
      return new ZktecoAdmsResponse(serialNo, tableName, 0, 0);
    }

    List<ZktecoAttendanceLog> logs = parseAttendanceLogs(serialNo, sourceIp, body, query);
    if (logs.isEmpty()) {
      return new ZktecoAdmsResponse(serialNo, tableName, 0, 0);
    }

    Set<String> existingEventUids = existingEventUids(logs);
    List<ZktecoAttendanceLog> newLogs =
        logs.stream().filter(log -> !existingEventUids.contains(log.eventUid())).toList();
    persistEvents(logs);
    persistFingerprintAttendance(newLogs);
    updateDeviceLastEvent(serialNo, newLogs);

    return new ZktecoAdmsResponse(serialNo, tableName, logs.size(), newLogs.size());
  }

  public int receiveBridgePunches(List<Map<String, Object>> punches) {
    processBridgeHeartbeats(punches);
    List<ZktecoAttendanceLog> logs =
        punches == null
            ? List.of()
            : punches.stream().map(this::bridgePunchLog).filter(Objects::nonNull).toList();
    if (logs.isEmpty()) {
      return 0;
    }

    logs.stream()
        .collect(java.util.stream.Collectors.groupingBy(ZktecoAttendanceLog::deviceSerialNo))
        .forEach(this::touchBridgeDevice);

    Set<String> existingEventUids = existingEventUids(logs);
    List<ZktecoAttendanceLog> newLogs =
        logs.stream().filter(log -> !existingEventUids.contains(log.eventUid())).toList();
    persistEvents(logs);
    persistFingerprintAttendance(newLogs);
    newLogs.stream()
        .collect(java.util.stream.Collectors.groupingBy(ZktecoAttendanceLog::deviceSerialNo))
        .forEach(this::updateDeviceLastEvent);
    return newLogs.size();
  }

  public String getRequest(MultiValueMap<String, String> query, HttpHeaders headers, String remoteIp) {
    validateCommKey(query, headers);
    String serialNo = requireSerialNo(query);
    touchDevice(serialNo, remoteIp, "getrequest", query);
    return "OK";
  }

  public String deviceCommandAck(
      MultiValueMap<String, String> query, HttpHeaders headers, String body, String remoteIp) {
    validateCommKey(query, headers);
    String serialNo = requireSerialNo(query);
    touchDevice(serialNo, remoteIp, "devicecmd", query);
    return "OK";
  }

  public void registry(
      MultiValueMap<String, String> query, HttpHeaders headers, String body, String remoteIp) {
    validateCommKey(query, headers);
    String serialNo = requireSerialNo(query);
    touchDevice(serialNo, remoteIp, "registry", query);
  }

  public ZktecoStatus status(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "admin", "hr", "supervisor", "viewer");
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("order", "last_seen_at.desc.nullslast");
    query.add("limit", "100");
    ArrayNode devices = safeSelect("zkteco_devices", query);
    return new ZktecoStatus(devices, devices.size(), OffsetDateTime.now(), "adms_push");
  }

  public ArrayNode listEvents(AuthenticatedUser user, int limit) {
    roleGuard.requireAnyRole(user, "admin", "hr", "supervisor", "viewer");
    int safeLimit = Math.max(1, Math.min(limit, MAX_EVENTS));
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("order", "event_time.desc");
    query.add("limit", String.valueOf(safeLimit));
    return safeSelect("zkteco_fingerprint_events", query);
  }

  private List<ZktecoAttendanceLog> parseAttendanceLogs(
      String serialNo, String remoteIp, String body, MultiValueMap<String, String> query) {
    if (body == null || body.isBlank()) {
      return List.of();
    }

    List<ZktecoAttendanceLog> logs = new ArrayList<>();
    String[] lines = body.replace("\u0000", "").split("\\R");
    for (int lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      String rawLine = lines[lineNumber].trim();
      if (rawLine.isBlank()) {
        continue;
      }

      ParsedFields fields = parseFields(rawLine);
      if (!hasText(fields.pin()) || !hasText(fields.timestampText())) {
        continue;
      }

      OffsetDateTime eventTime = parseEventTime(fields.timestampText());
      EmployeeMatch match = findEmployee(fields.pin());
      String eventUid =
          eventUid(
              serialNo,
              fields.pin(),
              eventTime,
              fields.inOutMode(),
              fields.verifyMode(),
              fields.workCode(),
              rawLine);

      logs.add(
          new ZktecoAttendanceLog(
              eventUid,
              serialNo,
              remoteIp,
              fields.pin(),
              match.employeeCode(),
              match.employeeId(),
              match.employeeName(),
              match.designation(),
              match.department(),
              match.status(),
              eventTime,
              fields.verifyMode(),
              fields.inOutMode(),
              fields.workCode(),
              fields.reserved(),
              rawLine,
              rawPayload(query, fields, lineNumber + 1)));
    }
    return logs;
  }

  private ParsedFields parseFields(String rawLine) {
    String[] fields = rawLine.contains("\t") ? rawLine.split("\\t", -1) : rawLine.split("\\s+");
    if (rawLine.contains("\t")) {
      return new ParsedFields(
          valueAt(fields, 0),
          valueAt(fields, 1),
          valueAt(fields, 3),
          valueAt(fields, 2),
          valueAt(fields, 4),
          tail(fields, 5));
    }

    String timestampText =
        fields.length >= 3 ? valueAt(fields, 1) + " " + valueAt(fields, 2) : valueAt(fields, 1);
    return new ParsedFields(
        valueAt(fields, 0),
        timestampText,
        valueAt(fields, 4),
        valueAt(fields, 3),
        valueAt(fields, 5),
        tail(fields, 6));
  }

  private void persistEvents(List<ZktecoAttendanceLog> logs) {
    List<Map<String, Object>> rows = logs.stream().map(this::eventRow).toList();
    try {
      supabaseAdminClient.upsertMany("zkteco_fingerprint_events", rows, "event_uid");
    } catch (RuntimeException exception) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, "Could not save ZKTeco attendance logs.");
    }
  }

  private void persistFingerprintAttendance(List<ZktecoAttendanceLog> logs) {
    Map<FingerprintAttendanceKey, FingerprintAttendanceAccumulator> grouped = new LinkedHashMap<>();

    for (ZktecoAttendanceLog log : logs) {
      if (!"matched".equals(log.matchStatus()) || !hasText(log.employeeCode())) {
        continue;
      }

      LocalDate attendanceDate = log.eventTime().atZoneSameInstant(attendanceZone).toLocalDate();
      LocalTime punchTime = log.eventTime().atZoneSameInstant(attendanceZone).toLocalTime().withNano(0);
      FingerprintAttendanceKey key =
          new FingerprintAttendanceKey(log.employeeCode(), attendanceDate.toString());
      FingerprintAttendanceAccumulator accumulator =
          grouped.computeIfAbsent(
              key,
              ignored ->
                  new FingerprintAttendanceAccumulator(
                      log.employeeCode(),
                      attendanceDate.toString(),
                      log.employeeName(),
                      log.designation(),
                      log.department(),
                      punchTime,
                      punchTime));
      accumulator.eventCount++;
      accumulator.firstPunch = minTime(accumulator.firstPunch, punchTime);
      accumulator.lastPunch = maxTime(accumulator.lastPunch, punchTime);
    }

    grouped.values().forEach(this::upsertFingerprintAttendance);
  }

  private void upsertFingerprintAttendance(FingerprintAttendanceAccumulator attendance) {
    try {
      MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
      query.add("employee_code", "eq." + attendance.employeeCode);
      query.add("attendance_date", "eq." + attendance.attendanceDate);
      query.add("limit", "1");
      ArrayNode rows = supabaseAdminClient.select("attendance_reconciliation", query);

      if (rows.isEmpty()) {
        supabaseAdminClient.insertSingle("attendance_reconciliation", newFingerprintAttendanceRow(attendance));
        return;
      }

      JsonNode existing = rows.get(0);
      MultiValueMap<String, String> updateQuery = new LinkedMultiValueMap<>();
      updateQuery.add("employee_code", "eq." + attendance.employeeCode);
      updateQuery.add("attendance_date", "eq." + attendance.attendanceDate);
      supabaseAdminClient.updateSingle(
          "attendance_reconciliation", updateQuery, updatedFingerprintAttendanceRow(existing, attendance));
    } catch (RuntimeException ignored) {
      // ADMS ingestion should continue even if the live projection table is not available yet.
    }
  }

  private Map<String, Object> newFingerprintAttendanceRow(FingerprintAttendanceAccumulator attendance) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("face_import_batch_id", null);
    row.put("fingerprint_import_batch_id", null);
    row.put("employee_code", attendance.employeeCode);
    row.put("attendance_date", attendance.attendanceDate);
    row.put("employee_name", attendance.employeeName);
    row.put("designation", attendance.designation);
    row.put("department_name", attendance.department);
    row.put("face_first_seen", null);
    row.put("face_last_seen", null);
    row.put("face_event_count", 0);
    row.put("duplicate_face_event_count", 0);
    row.put("fingerprint_time_in", databaseTime(attendance.firstPunch));
    row.put("fingerprint_time_out", fingerprintTimeOut(attendance));
    row.put("reconciliation_status", "fingerprint_only");
    row.put("exception_reason", "Live ZKTeco fingerprint activity exists without matching face activity.");
    row.put("confidence_level", "medium");
    row.put("rule_flags", List.of("live_zkteco_fingerprint", "fingerprint_present_face_missing"));
    return row;
  }

  private Map<String, Object> updatedFingerprintAttendanceRow(
      JsonNode existing, FingerprintAttendanceAccumulator attendance) {
    String existingFirstPunch = JsonSupport.text(existing, "fingerprint_time_in");
    String existingLastPunch = JsonSupport.text(existing, "fingerprint_time_out");
    boolean hasFace =
        hasText(JsonSupport.text(existing, "face_first_seen"))
            || Optional.ofNullable(JsonSupport.integer(existing, "face_event_count")).orElse(0) > 0;
    String existingStatus = JsonSupport.text(existing, "reconciliation_status");
    String nextStatus = fingerprintAttendanceStatus(existingStatus, hasFace);

    Map<String, Object> row = new LinkedHashMap<>();
    row.put("employee_name", firstNonBlank(JsonSupport.text(existing, "employee_name"), attendance.employeeName));
    row.put("designation", firstNonBlank(JsonSupport.text(existing, "designation"), attendance.designation));
    row.put("department_name", firstNonBlank(JsonSupport.text(existing, "department_name"), attendance.department));
    row.put("fingerprint_time_in", minTimeText(existingFirstPunch, databaseTime(attendance.firstPunch)));
    row.put("fingerprint_time_out", maxTimeText(existingLastPunch, fingerprintTimeOut(attendance)));
    row.put("reconciliation_status", nextStatus);
    row.put("exception_reason", fingerprintAttendanceException(nextStatus));
    row.put("confidence_level", "validated".equals(nextStatus) ? "high" : "anomaly".equals(nextStatus) ? "low" : "medium");
    row.put("rule_flags", fingerprintAttendanceRuleFlags(nextStatus));
    return row;
  }

  private String fingerprintAttendanceStatus(String existingStatus, boolean hasFace) {
    if (hasFace || "face_only".equals(existingStatus) || "validated".equals(existingStatus)) {
      return "validated";
    }
    if ("leave".equals(existingStatus)) {
      return "anomaly";
    }
    return "fingerprint_only";
  }

  private String fingerprintAttendanceException(String status) {
    return switch (status) {
      case "validated" -> null;
      case "anomaly" -> "Leave attendance conflicts with live ZKTeco fingerprint activity.";
      default -> "Live ZKTeco fingerprint activity exists without matching face activity.";
    };
  }

  private List<String> fingerprintAttendanceRuleFlags(String status) {
    return switch (status) {
      case "validated" -> List.of("live_zkteco_fingerprint");
      case "anomaly" -> List.of("live_zkteco_fingerprint", "leave_and_fingerprint_conflict");
      default -> List.of("live_zkteco_fingerprint", "fingerprint_present_face_missing");
    };
  }

  private Map<String, Object> eventRow(ZktecoAttendanceLog log) {
    LocalDate attendanceDate = log.eventTime().atZoneSameInstant(attendanceZone).toLocalDate();
    LocalTime punchTime = log.eventTime().atZoneSameInstant(attendanceZone).toLocalTime().withNano(0);
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("event_uid", log.eventUid());
    row.put("employee_pin", log.employeePin());
    row.put("employee_code", log.employeeCode());
    row.put("employee_id", log.employeeId());
    row.put("matched_employee_name", log.employeeName());
    row.put("matched_department", log.department());
    row.put("match_status", log.matchStatus());
    row.put("device_serial_no", log.deviceSerialNo());
    row.put("device_ip", log.deviceIp());
    row.put("event_time", log.eventTime());
    row.put("attendance_date", attendanceDate);
    row.put("punch_time", punchTime);
    row.put("verify_mode", log.verifyMode());
    row.put("in_out_mode", log.inOutMode());
    row.put("work_code", log.workCode());
    row.put("reserved_fields", log.reservedFields());
    row.put("raw_line", log.rawLine());
    row.put("raw_payload", log.rawPayload());
    return row;
  }

  private void touchDevice(
      String serialNo, String remoteIp, String lastPushTable, MultiValueMap<String, String> query) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("serial_no", serialNo);
    row.put("device_name", firstNonBlank(param(query, "DeviceName"), param(query, "Alias"), serialNo));
    row.put("last_ip", remoteIp);
    row.put("last_seen_at", OffsetDateTime.now());
    row.put("last_push_table", lastPushTable);
    row.put("raw_options", query.toSingleValueMap());
    try {
      supabaseAdminClient.upsertMany("zkteco_devices", List.of(row), "serial_no");
    } catch (RuntimeException ignored) {
      // Keep the protocol response alive while migrations are being rolled out.
    }
  }

  private void updateDeviceLastEvent(String serialNo, List<ZktecoAttendanceLog> logs) {
    if (logs.isEmpty()) {
      return;
    }
    OffsetDateTime lastEvent =
        logs.stream()
            .map(ZktecoAttendanceLog::eventTime)
            .max(OffsetDateTime::compareTo)
            .orElse(null);
    if (lastEvent == null) {
      return;
    }
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("serial_no", "eq." + serialNo);
    Map<String, Object> row = Map.of("last_event_at", lastEvent);
    try {
      supabaseAdminClient.updateSingle("zkteco_devices", query, row);
    } catch (RuntimeException ignored) {
      // Optional device metadata should not block event ingestion.
    }
  }

  private void processBridgeHeartbeats(List<Map<String, Object>> punches) {
    if (punches == null || punches.isEmpty()) {
      return;
    }

    punches.stream()
        .filter(this::isBridgeHeartbeat)
        .forEach(
            punch -> {
              String deviceIp = firstNonBlank(text(punch, "deviceIp"), text(punch, "deviceIP"));
              String serialNo =
                  firstNonBlank(text(punch, "deviceId"), text(punch, "serialNo"), deviceIp, "unknown");
              touchBridgeDevice(serialNo, deviceIp, "BRIDGE_HEARTBEAT");
            });
  }

  private boolean isBridgeHeartbeat(Map<String, Object> punch) {
    if (punch == null || punch.isEmpty()) {
      return false;
    }
    Object value = punch.get("bridgeHeartbeat");
    return value instanceof Boolean booleanValue
        ? booleanValue
        : value != null && "true".equalsIgnoreCase(value.toString());
  }

  private void touchBridgeDevice(String serialNo, List<ZktecoAttendanceLog> logs) {
    String deviceIp =
        logs.stream()
            .map(ZktecoAttendanceLog::deviceIp)
            .filter(this::hasText)
            .findFirst()
            .orElse(null);
    touchBridgeDevice(serialNo, deviceIp, "BRIDGE_POLL");
  }

  private void touchBridgeDevice(String serialNo, String deviceIp, String lastPushTable) {
    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("DeviceName", serialNo);
    touchDevice(serialNo, firstNonBlank(deviceIp, serialNo), lastPushTable, query);
  }

  private Set<String> existingEventUids(List<ZktecoAttendanceLog> logs) {
    Set<String> existing = new HashSet<>();
    int batchSize = 100;
    for (int start = 0; start < logs.size(); start += batchSize) {
      List<ZktecoAttendanceLog> batch = logs.subList(start, Math.min(start + batchSize, logs.size()));
      try {
        MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
        query.add("select", "event_uid");
        query.add(
            "event_uid",
            "in.(" + String.join(",", batch.stream().map(ZktecoAttendanceLog::eventUid).toList()) + ")");
        ArrayNode rows = supabaseAdminClient.select("zkteco_fingerprint_events", query);
        rows.forEach(row -> {
          String eventUid = JsonSupport.text(row, "event_uid");
          if (hasText(eventUid)) {
            existing.add(eventUid);
          }
        });
      } catch (RuntimeException ignored) {
        return Set.of();
      }
    }
    return existing;
  }

  private EmployeeMatch findEmployee(String pin) {
    return employeeCache.computeIfAbsent(
        pin,
        key -> {
          EmployeeMatch byEmployeeCode = findEmployeeBy("employee_code", key);
          if ("matched".equals(byEmployeeCode.status())) {
            return byEmployeeCode;
          }
          EmployeeMatch byEpfNo = findEmployeeBy("epf_no", key);
          return "matched".equals(byEpfNo.status()) ? byEpfNo : EmployeeMatch.unmatched(key);
        });
  }

  private EmployeeMatch findEmployeeBy(String fieldName, String value) {
    try {
      MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
      query.add("select", "id,employee_code,display_name,designation,department_name");
      query.add(fieldName, "eq." + value);
      query.add("limit", "1");
      ArrayNode rows = supabaseAdminClient.select("employees", query);
      if (rows.isEmpty()) {
        return EmployeeMatch.unmatched(value);
      }
      JsonNode row = rows.get(0);
      String employeeCode = JsonSupport.text(row, "employee_code");
      String displayName = JsonSupport.text(row, "display_name");
      return new EmployeeMatch(
          JsonSupport.text(row, "id"),
          employeeCode,
          displayName == null || displayName.isBlank() ? employeeCode : displayName,
          JsonSupport.text(row, "designation"),
          JsonSupport.text(row, "department_name"),
          "matched");
    } catch (RuntimeException exception) {
      return EmployeeMatch.unmatched(value);
    }
  }

  private ArrayNode safeSelect(String table, MultiValueMap<String, String> query) {
    try {
      return supabaseAdminClient.select(table, query);
    } catch (RuntimeException ignored) {
      return objectMapper.createArrayNode();
    }
  }

  private Map<String, Object> rawPayload(
      MultiValueMap<String, String> query, ParsedFields fields, int lineNumber) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("query", query.toSingleValueMap());
    payload.put("line_number", lineNumber);
    payload.put("pin", fields.pin());
    payload.put("timestamp", fields.timestampText());
    payload.put("verify_mode", fields.verifyMode());
    payload.put("in_out_mode", fields.inOutMode());
    payload.put("work_code", fields.workCode());
    payload.put("reserved", fields.reserved());
    return payload;
  }

  private ZktecoAttendanceLog bridgePunchLog(Map<String, Object> punch) {
    if (punch == null || punch.isEmpty()) {
      return null;
    }

    String employeePin =
        firstNonBlank(text(punch, "employeeCode"), text(punch, "pin"), text(punch, "userId"));
    String timestamp = text(punch, "timestamp");
    if (!hasText(employeePin) || !hasText(timestamp)) {
      return null;
    }

    String deviceIp = firstNonBlank(text(punch, "deviceIp"), text(punch, "deviceIP"));
    String serialNo = firstNonBlank(text(punch, "deviceId"), text(punch, "serialNo"), deviceIp, "unknown");
    OffsetDateTime eventTime = parseEventTime(timestamp);
    String verifyMode = firstNonBlank(text(punch, "verifyType"), text(punch, "verifyMode"));
    String inOutMode = firstNonBlank(text(punch, "punchState"), text(punch, "inOutMode"));
    String workCode = text(punch, "workCode");
    String rawLine =
        String.join(
            "\t",
            List.of(
                employeePin,
                timestamp,
                Objects.toString(inOutMode, ""),
                Objects.toString(verifyMode, ""),
                Objects.toString(workCode, "")));
    EmployeeMatch match = findEmployee(employeePin);
    return new ZktecoAttendanceLog(
        eventUid(serialNo, employeePin, eventTime, inOutMode, verifyMode, workCode, rawLine),
        serialNo,
        deviceIp,
        employeePin,
        match.employeeCode(),
        match.employeeId(),
        match.employeeName(),
        match.designation(),
        match.department(),
        match.status(),
        eventTime,
        verifyMode,
        inOutMode,
        workCode,
        List.of(),
        rawLine,
        punch);
  }

  private String text(Map<String, Object> source, String key) {
    Object value = source.get(key);
    return value == null ? null : value.toString().trim();
  }

  private void validateCommKey(MultiValueMap<String, String> query, HttpHeaders headers) {
    String expected = properties.commKey();
    if (expected == null || expected.isBlank()) {
      return;
    }

    String supplied =
        firstNonBlank(
            headers.getFirst("X-ZKTeco-Comm-Key"),
            headers.getFirst("X-ADMS-Comm-Key"),
            param(query, "CommKey"),
            param(query, "pushcommkey"),
            param(query, "DeviceKey"),
            param(query, "KEY"),
            param(query, "key"));
    if (!expected.trim().equals(supplied == null ? null : supplied.trim())) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid ZKTeco ADMS communication key.");
    }
  }

  private String requireSerialNo(MultiValueMap<String, String> query) {
    String serialNo = firstNonBlank(param(query, "SN"), param(query, "sn"), param(query, "SerialNumber"));
    if (!hasText(serialNo)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "ZKTeco ADMS request is missing SN.");
    }
    return serialNo.trim();
  }

  private String param(MultiValueMap<String, String> query, String key) {
    String direct = query.getFirst(key);
    if (direct != null) {
      return direct;
    }
    for (Map.Entry<String, List<String>> entry : query.entrySet()) {
      if (entry.getKey().equalsIgnoreCase(key) && !entry.getValue().isEmpty()) {
        return entry.getValue().get(0);
      }
    }
    return null;
  }

  private OffsetDateTime parseEventTime(String text) {
    String trimmed = text == null ? "" : text.trim();
    if (trimmed.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "ZKTeco attendance log is missing punch timestamp.");
    }

    try {
      return OffsetDateTime.parse(trimmed);
    } catch (DateTimeParseException ignored) {
      // Most ZKTeco ATTLOG rows use local device time without an offset.
    }

    for (DateTimeFormatter formatter : LOCAL_DATE_TIME_FORMATTERS) {
      try {
        return LocalDateTime.parse(trimmed, formatter).atZone(attendanceZone).toOffsetDateTime();
      } catch (DateTimeParseException ignored) {
      }
    }

    throw new ApiException(HttpStatus.BAD_REQUEST, "Could not parse ZKTeco punch timestamp: " + trimmed);
  }

  private String eventUid(
      String serialNo,
      String employeePin,
      OffsetDateTime eventTime,
      String inOutMode,
      String verifyMode,
      String workCode,
      String rawLine) {
    String source =
        String.join(
            "|",
            List.of(
                Objects.toString(serialNo, ""),
                Objects.toString(employeePin, ""),
                Objects.toString(eventTime, ""),
                Objects.toString(inOutMode, ""),
                Objects.toString(verifyMode, ""),
                Objects.toString(workCode, ""),
                Objects.toString(rawLine, "")));
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return "zkteco-" + HexFormat.of().formatHex(digest.digest(source.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 digest is not available.", exception);
    }
  }

  private ZoneId resolveZone(String configuredZone) {
    if (configuredZone == null || configuredZone.isBlank()) {
      return DEFAULT_ZONE;
    }
    try {
      return ZoneId.of(configuredZone.trim());
    } catch (RuntimeException ignored) {
      return DEFAULT_ZONE;
    }
  }

  private String fingerprintTimeOut(FingerprintAttendanceAccumulator attendance) {
    if (attendance.eventCount <= 1 || attendance.firstPunch.equals(attendance.lastPunch)) {
      return null;
    }
    return databaseTime(attendance.lastPunch);
  }

  private LocalTime minTime(LocalTime first, LocalTime second) {
    if (first == null) {
      return second;
    }
    if (second == null) {
      return first;
    }
    return first.isBefore(second) ? first : second;
  }

  private LocalTime maxTime(LocalTime first, LocalTime second) {
    if (first == null) {
      return second;
    }
    if (second == null) {
      return first;
    }
    return first.isAfter(second) ? first : second;
  }

  private String minTimeText(String first, String second) {
    if (!hasText(first)) {
      return second;
    }
    if (!hasText(second)) {
      return first;
    }
    return first.compareTo(second) <= 0 ? first : second;
  }

  private String maxTimeText(String first, String second) {
    if (!hasText(first)) {
      return second;
    }
    if (!hasText(second)) {
      return first;
    }
    return first.compareTo(second) >= 0 ? first : second;
  }

  private String databaseTime(LocalTime time) {
    return time == null ? null : time.format(DateTimeFormatter.ISO_LOCAL_TIME);
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (hasText(value)) {
        return value.trim();
      }
    }
    return null;
  }

  private boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private String valueAt(String[] values, int index) {
    return index >= 0 && index < values.length ? values[index].trim() : null;
  }

  private List<String> tail(String[] values, int startIndex) {
    if (values.length <= startIndex) {
      return List.of();
    }
    List<String> tail = new ArrayList<>();
    for (int index = startIndex; index < values.length; index++) {
      if (hasText(values[index])) {
        tail.add(values[index].trim());
      }
    }
    return tail;
  }

  private record ParsedFields(
      String pin,
      String timestampText,
      String verifyMode,
      String inOutMode,
      String workCode,
      List<String> reserved
  ) {
  }

  private record EmployeeMatch(
      String employeeId,
      String employeeCode,
      String employeeName,
      String designation,
      String department,
      String status
  ) {
    private static EmployeeMatch unmatched(String pin) {
      return new EmployeeMatch(null, null, null, null, null, "unmatched");
    }
  }

  private record ZktecoAttendanceLog(
      String eventUid,
      String deviceSerialNo,
      String deviceIp,
      String employeePin,
      String employeeCode,
      String employeeId,
      String employeeName,
      String designation,
      String department,
      String matchStatus,
      OffsetDateTime eventTime,
      String verifyMode,
      String inOutMode,
      String workCode,
      List<String> reservedFields,
      String rawLine,
      Map<String, Object> rawPayload
  ) {
  }

  private record FingerprintAttendanceKey(String employeeCode, String attendanceDate) {
  }

  private static final class FingerprintAttendanceAccumulator {
    private final String employeeCode;
    private final String attendanceDate;
    private final String employeeName;
    private final String designation;
    private final String department;
    private LocalTime firstPunch;
    private LocalTime lastPunch;
    private int eventCount;

    private FingerprintAttendanceAccumulator(
        String employeeCode,
        String attendanceDate,
        String employeeName,
        String designation,
        String department,
        LocalTime firstPunch,
        LocalTime lastPunch) {
      this.employeeCode = employeeCode;
      this.attendanceDate = attendanceDate;
      this.employeeName = employeeName;
      this.designation = designation;
      this.department = department;
      this.firstPunch = firstPunch;
      this.lastPunch = lastPunch;
    }
  }
}
