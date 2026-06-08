package com.garmentline.operations.hikvision;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.garmentline.operations.config.HikvisionProperties;
import com.garmentline.operations.hikvision.model.HikvisionCameraEndpoint;
import com.garmentline.operations.hikvision.model.HikvisionBridgeIngestResponse;
import com.garmentline.operations.hikvision.model.HikvisionBridgePushRequest;
import com.garmentline.operations.hikvision.model.HikvisionCameraConfig;
import com.garmentline.operations.hikvision.model.HikvisionConfigRequest;
import com.garmentline.operations.hikvision.model.HikvisionDeviceInfo;
import com.garmentline.operations.hikvision.model.HikvisionEventListResponse;
import com.garmentline.operations.hikvision.model.HikvisionRecognitionEvent;
import com.garmentline.operations.hikvision.model.HikvisionStatus;
import com.garmentline.operations.security.AuthenticatedUser;
import com.garmentline.operations.security.RoleGuard;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.ApiException;
import com.garmentline.operations.support.JsonSupport;
import jakarta.annotation.PreDestroy;
import java.io.StringReader;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.xml.parsers.DocumentBuilderFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

@Service
public class HikvisionService {

  private static final int MAX_EVENTS = 500;
  private static final int DEFAULT_POLL_INTERVAL_SECONDS = 3;
  private static final int DEFAULT_LOOKBACK_MINUTES = 60;
  private static final ZoneId ATTENDANCE_ZONE = ZoneId.of("Asia/Colombo");
  private static final DateTimeFormatter CAMERA_TIME_FORMATTER =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");
  private static final DateTimeFormatter DATABASE_TIME_FORMATTER =
      DateTimeFormatter.ofPattern("HH:mm:ss");
  private static final List<CameraSeed> DEFAULT_CAMERA_SEEDS =
      List.of(
          new CameraSeed(
              "guardroom-101", "Guardroom entrance 01", "Guardroom entrance", "http://10.10.4.101"),
          new CameraSeed(
              "guardroom-102", "Guardroom entrance 02", "Guardroom entrance", "http://10.10.4.102"),
          new CameraSeed(
              "guardroom-103", "Guardroom entrance 03", "Guardroom entrance", "http://10.10.4.103"),
          new CameraSeed(
              "guardroom-104", "Guardroom entrance 04", "Guardroom entrance", "http://10.10.4.104"),
          new CameraSeed(
              "guardroom-105", "Guardroom entrance 05", "Guardroom entrance", "http://10.10.4.105"),
          new CameraSeed("bike-106", "Bike parking 01", "Bike parking", "http://10.10.4.106"),
          new CameraSeed("bike-107", "Bike parking 02", "Bike parking", "http://10.10.4.107"));

  private final HikvisionIsapiClient isapiClient;
  private final SupabaseAdminClient supabaseAdminClient;
  private final RoleGuard roleGuard;
  private final ObjectMapper objectMapper;
  private final AtomicReference<List<CameraDefinition>> activeCameras;
  private final String bridgeToken;
  private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
  private final Object eventLock = new Object();
  private final LinkedList<HikvisionRecognitionEvent> events = new LinkedList<>();
  private final Set<String> seenEventIds = ConcurrentHashMap.newKeySet();
  private final Map<String, EmployeeMatch> employeeCache = new ConcurrentHashMap<>();
  private final Map<String, CameraRuntimeState> cameraStates = new ConcurrentHashMap<>();

  private volatile ScheduledFuture<?> pollingTask;
  private volatile OffsetDateTime lastPollAt;
  private volatile OffsetDateTime lastSuccessAt;
  private volatile String lastError;

  public HikvisionService(
      HikvisionIsapiClient isapiClient,
      SupabaseAdminClient supabaseAdminClient,
      RoleGuard roleGuard,
      ObjectMapper objectMapper,
      HikvisionProperties properties) {
    this.isapiClient = isapiClient;
    this.supabaseAdminClient = supabaseAdminClient;
    this.roleGuard = roleGuard;
    this.objectMapper = objectMapper;
    this.activeCameras = new AtomicReference<>(camerasFromProperties(properties));
    this.bridgeToken = properties == null ? "" : Objects.requireNonNullElse(properties.bridgeToken(), "");
  }

  public HikvisionStatus getStatus(AuthenticatedUser user) {
    requireAccess(user);
    return status();
  }

  public HikvisionStatus configure(AuthenticatedUser user, HikvisionConfigRequest request) {
    requireManage(user);
    List<CameraDefinition> existing = activeCameras.get();
    HikvisionCameraConfig firstConfig =
        existing == null || existing.isEmpty() ? null : existing.get(0).config();
    String password =
        request.password() == null || request.password().isBlank()
            ? firstConfig == null ? "" : firstConfig.password()
            : request.password();
    String username = Objects.requireNonNullElse(request.username(), "admin").trim();
    int pollSeconds =
        request.pollIntervalSeconds() == null
            ? DEFAULT_POLL_INTERVAL_SECONDS
            : request.pollIntervalSeconds();
    int lookbackMinutes =
        request.lookbackMinutes() == null ? DEFAULT_LOOKBACK_MINUTES : request.lookbackMinutes();

    List<CameraDefinition> baseCameras =
        existing == null || existing.isEmpty()
            ? DEFAULT_CAMERA_SEEDS.stream()
                .map(seed -> cameraDefinition(seed, username, password, pollSeconds, lookbackMinutes))
                .toList()
            : existing;

    List<CameraDefinition> nextCameras =
        baseCameras.stream()
            .map(
                camera ->
                    new CameraDefinition(
                        camera.id(),
                        camera.name(),
                        camera.location(),
                        new HikvisionCameraConfig(
                            camera.config().baseUrl(),
                            username,
                            password,
                            pollSeconds,
                            lookbackMinutes)))
            .toList();

    activeCameras.set(nextCameras);
    lastError = null;
    return testConnection(user);
  }

  public HikvisionStatus testConnection(AuthenticatedUser user) {
    requireAccess(user);
    List<CameraDefinition> cameras = requireCameras();
    OffsetDateTime now = OffsetDateTime.now();
    lastPollAt = now;
    int successes = 0;
    List<String> failures = new ArrayList<>();

    for (CameraDefinition camera : cameras) {
      CameraRuntimeState state = cameraState(camera);
      state.lastPollAt = now;
      try {
        state.deviceInfo = fetchDeviceInfo(camera.config());
        state.lastSuccessAt = OffsetDateTime.now();
        state.lastError = null;
        successes++;
      } catch (RuntimeException exception) {
        state.lastError = exception.getMessage();
        failures.add(camera.name() + ": " + exception.getMessage());
      }
    }

    if (successes == 0) {
      lastError =
          failures.isEmpty()
              ? "Could not reach any configured Hikvision camera."
              : String.join("; ", failures);
      throw new ApiException(HttpStatus.BAD_GATEWAY, lastError);
    }

    lastSuccessAt = OffsetDateTime.now();
    lastError =
        failures.isEmpty()
            ? null
            : failures.size() + " of " + cameras.size() + " Hikvision camera(s) failed connection test.";
    return status();
  }

  public HikvisionStatus startPolling(AuthenticatedUser user) {
    requireManage(user);
    List<CameraDefinition> cameras = requireCameras();
    int pollIntervalSeconds =
        cameras.isEmpty() ? DEFAULT_POLL_INTERVAL_SECONDS : cameras.get(0).config().pollIntervalSeconds();
    stopPollingInternal();
    pollingTask =
        scheduler.scheduleWithFixedDelay(
            this::safePoll,
            0,
            Math.max(1, pollIntervalSeconds),
            TimeUnit.SECONDS);
    return status();
  }

  public HikvisionStatus stopPolling(AuthenticatedUser user) {
    requireManage(user);
    stopPollingInternal();
    return status();
  }

  public HikvisionEventListResponse pollNow(AuthenticatedUser user) {
    requireManage(user);
    safePoll();
    return listEvents(user, 80);
  }

  public HikvisionBridgeIngestResponse receiveBridgeEvents(
      String suppliedBridgeToken, HikvisionBridgePushRequest request) {
    validateBridgeToken(suppliedBridgeToken);
    CameraDefinition camera = bridgeCameraDefinition(request);
    CameraRuntimeState state = cameraState(camera);
    OffsetDateTime polledAt = request.polledAt() == null ? OffsetDateTime.now() : request.polledAt();
    state.lastPollAt = polledAt;
    state.deviceInfo = request.deviceInfo();

    List<Map<String, Object>> rawEvents = request.events() == null ? List.of() : request.events();
    List<HikvisionRecognitionEvent> normalizedEvents = new ArrayList<>();
    for (Map<String, Object> rawEvent : rawEvents) {
      JsonNode node = objectMapper.valueToTree(rawEvent == null ? Map.of() : rawEvent);
      normalizeEvent(camera, node).ifPresent(normalizedEvents::add);
    }

    int acceptedEvents = ingestEvents(normalizedEvents);
    state.lastSuccessAt = OffsetDateTime.now();
    state.lastError = null;
    lastPollAt = polledAt;
    lastSuccessAt = state.lastSuccessAt;
    lastError = null;
    return new HikvisionBridgeIngestResponse(rawEvents.size(), acceptedEvents, status());
  }

  public HikvisionEventListResponse listEvents(AuthenticatedUser user, int limit) {
    requireAccess(user);
    int safeLimit = Math.max(1, Math.min(limit, MAX_EVENTS));
    mergePersistedEventsIntoMemory(safeLimit);
    List<HikvisionRecognitionEvent> snapshot;
    synchronized (eventLock) {
      snapshot =
          events.stream()
              .sorted(Comparator.comparing(HikvisionRecognitionEvent::eventTime).reversed())
              .limit(safeLimit)
              .toList();
    }
    return new HikvisionEventListResponse(snapshot, status());
  }

  @PreDestroy
  public void shutdown() {
    stopPollingInternal();
    scheduler.shutdownNow();
  }

  private void safePoll() {
    try {
      pollInternal();
    } catch (RuntimeException exception) {
      lastError = exception.getMessage();
    }
  }

  private void pollInternal() {
    List<CameraDefinition> cameras = requireCameras();
    OffsetDateTime pollStartedAt = OffsetDateTime.now();
    lastPollAt = pollStartedAt;
    List<HikvisionRecognitionEvent> nextEvents = new ArrayList<>();
    List<String> failures = new ArrayList<>();
    int successes = 0;

    for (CameraDefinition camera : cameras) {
      CameraRuntimeState state = cameraState(camera);
      state.lastPollAt = pollStartedAt;
      try {
        List<HikvisionRecognitionEvent> cameraEvents = fetchAccessEvents(camera);
        nextEvents.addAll(cameraEvents);
        state.lastSuccessAt = OffsetDateTime.now();
        state.lastError = null;
        successes++;
      } catch (RuntimeException exception) {
        state.lastError = exception.getMessage();
        failures.add(camera.name() + ": " + exception.getMessage());
      }
    }

    if (successes == 0 && !failures.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, String.join("; ", failures));
    }

    int acceptedEvents = ingestEvents(nextEvents);

    if (successes > 0 && (!nextEvents.isEmpty() || acceptedEvents == 0)) {
      lastSuccessAt = OffsetDateTime.now();
      lastError =
          failures.isEmpty()
              ? null
              : failures.size() + " of " + cameras.size() + " Hikvision camera(s) failed during latest poll.";
    }
  }

  private int ingestEvents(List<HikvisionRecognitionEvent> nextEvents) {
    Set<String> existingEventIds = existingEventIds(nextEvents);
    List<HikvisionRecognitionEvent> newEvents = new ArrayList<>();
    synchronized (eventLock) {
      for (HikvisionRecognitionEvent event :
          nextEvents.stream()
              .sorted(Comparator.comparing(HikvisionRecognitionEvent::eventTime).reversed())
              .toList()) {
        if (!existingEventIds.contains(event.id()) && seenEventIds.add(event.id())) {
          events.addFirst(event);
          newEvents.add(event);
        }
      }

      while (events.size() > MAX_EVENTS) {
        HikvisionRecognitionEvent removed = events.removeLast();
        seenEventIds.remove(removed.id());
      }
    }

    persistEvents(newEvents);
    persistFaceAttendance(newEvents);
    return newEvents.size();
  }

  private Set<String> existingEventIds(List<HikvisionRecognitionEvent> nextEvents) {
    Set<String> existing = new HashSet<>();
    int batchSize = 100;
    for (int start = 0; start < nextEvents.size(); start += batchSize) {
      List<HikvisionRecognitionEvent> batch = nextEvents.subList(start, Math.min(start + batchSize, nextEvents.size()));
      try {
        MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
        query.add("select", "camera_event_id");
        query.add(
            "camera_event_id",
            "in.(" + String.join(",", batch.stream().map(HikvisionRecognitionEvent::id).toList()) + ")");
        ArrayNode rows = supabaseAdminClient.select("hikvision_face_events", query);
        rows.forEach(row -> {
          String eventId = JsonSupport.text(row, "camera_event_id");
          if (hasText(eventId)) {
            existing.add(eventId);
          }
        });
      } catch (RuntimeException ignored) {
        return Set.of();
      }
    }
    return existing;
  }

  private void persistEvents(List<HikvisionRecognitionEvent> newEvents) {
    if (newEvents.isEmpty()) {
      return;
    }

    List<Map<String, Object>> rows =
        newEvents.stream().map(this::toPersistenceRow).toList();

    try {
      supabaseAdminClient.upsertMany("hikvision_face_events", rows, "camera_event_id");
    } catch (RuntimeException ignored) {
      try {
        supabaseAdminClient.upsertMany(
            "hikvision_face_events",
            rows.stream().map(this::withoutCameraMetadata).toList(),
            "camera_event_id");
      } catch (RuntimeException ignoredAgain) {
        // The live feed should still work before the optional Supabase migration is applied.
      }
    }
  }

  private void mergePersistedEventsIntoMemory(int limit) {
    List<HikvisionRecognitionEvent> persistedEvents = latestPersistedEvents(limit);
    if (persistedEvents.isEmpty()) {
      return;
    }

    synchronized (eventLock) {
      for (HikvisionRecognitionEvent event : persistedEvents) {
        if (seenEventIds.add(event.id())) {
          events.add(event);
        }
      }

      events.sort(Comparator.comparing(HikvisionRecognitionEvent::eventTime).reversed());
      while (events.size() > MAX_EVENTS) {
        HikvisionRecognitionEvent removed = events.removeLast();
        seenEventIds.remove(removed.id());
      }
    }
  }

  private List<HikvisionRecognitionEvent> latestPersistedEvents(int limit) {
    try {
      MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
      query.add("select", "*");
      query.add("order", "event_time.desc");
      query.add("limit", String.valueOf(Math.max(1, Math.min(limit, MAX_EVENTS))));
      ArrayNode rows = supabaseAdminClient.select("hikvision_face_events", query);
      List<HikvisionRecognitionEvent> persistedEvents = new ArrayList<>();
      rows.forEach(row -> persistedEvent(row).ifPresent(persistedEvents::add));
      return persistedEvents;
    } catch (RuntimeException ignored) {
      return List.of();
    }
  }

  private Optional<HikvisionRecognitionEvent> persistedEvent(JsonNode row) {
    String id = firstNonBlank(JsonSupport.text(row, "camera_event_id"), JsonSupport.text(row, "id"));
    if (!hasText(id)) {
      return Optional.empty();
    }

    OffsetDateTime eventTime =
        parseCameraTime(JsonSupport.text(row, "event_time")).orElse(OffsetDateTime.now());
    OffsetDateTime receivedAt =
        parseCameraTime(JsonSupport.text(row, "received_at")).orElse(eventTime);
    String cameraId = firstNonBlank(JsonSupport.text(row, "camera_id"), "bridge-camera");
    String cameraName =
        firstNonBlank(
            JsonSupport.text(row, "camera_name"),
            JsonSupport.text(row, "camera_base_url"),
            cameraId);
    String matchStatus =
        firstNonBlank(
            JsonSupport.text(row, "match_status"),
            hasText(JsonSupport.text(row, "employee_id")) ? "matched" : "unmatched");

    return Optional.of(
        new HikvisionRecognitionEvent(
            id,
            cameraId,
            cameraName,
            firstNonBlank(JsonSupport.text(row, "camera_location"), "Factory camera"),
            JsonSupport.text(row, "camera_base_url"),
            JsonSupport.text(row, "camera_serial_no"),
            JsonSupport.text(row, "employee_code"),
            JsonSupport.text(row, "device_person_name"),
            JsonSupport.text(row, "employee_id"),
            JsonSupport.text(row, "matched_employee_name"),
            JsonSupport.text(row, "matched_department"),
            matchStatus,
            eventTime,
            receivedAt,
            JsonSupport.text(row, "verify_mode"),
            JsonSupport.text(row, "attendance_status"),
            JsonSupport.text(row, "access_decision"),
            JsonSupport.text(row, "picture_url"),
            JsonSupport.text(row, "visible_light_pic_url"),
            JsonSupport.text(row, "thermal_pic_url"),
            JsonSupport.decimal(row, "temperature"),
            firstNonBlank(JsonSupport.text(row, "mask_status"), JsonSupport.text(row, "mask")),
            JsonSupport.integer(row, "major"),
            JsonSupport.integer(row, "minor"),
            rawPayload(row)));
  }

  private Map<String, Object> rawPayload(JsonNode row) {
    JsonNode rawPayload = row == null ? null : row.get("raw_payload");
    if (rawPayload == null || rawPayload.isNull()) {
      return Map.of();
    }
    return objectMapper.convertValue(rawPayload, new TypeReference<Map<String, Object>>() {});
  }

  private Map<String, Object> withoutCameraMetadata(Map<String, Object> row) {
    Map<String, Object> legacyRow = new LinkedHashMap<>(row);
    legacyRow.remove("camera_id");
    legacyRow.remove("camera_name");
    legacyRow.remove("camera_location");
    legacyRow.remove("camera_base_url");
    return legacyRow;
  }

  private Map<String, Object> toPersistenceRow(HikvisionRecognitionEvent event) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("camera_event_id", event.id());
    row.put("camera_id", event.cameraId());
    row.put("camera_name", event.cameraName());
    row.put("camera_location", event.cameraLocation());
    row.put("camera_base_url", event.cameraBaseUrl());
    row.put("camera_serial_no", event.serialNo());
    row.put("employee_code", event.employeeNo());
    row.put("employee_id", event.matchedEmployeeId());
    row.put("device_person_name", event.devicePersonName());
    row.put("matched_employee_name", event.matchedEmployeeName());
    row.put("matched_department", event.matchedDepartment());
    row.put("match_status", event.matchStatus());
    row.put("event_time", event.eventTime());
    row.put("received_at", event.receivedAt());
    row.put("verify_mode", event.verifyMode());
    row.put("attendance_status", event.attendanceStatus());
    row.put("access_decision", event.accessDecision());
    row.put("picture_url", event.pictureUrl());
    row.put("visible_light_pic_url", event.visibleLightPicUrl());
    row.put("thermal_pic_url", event.thermalPicUrl());
    row.put("temperature", event.temperature());
    row.put("mask_status", event.mask());
    row.put("major", event.major());
    row.put("minor", event.minor());
    row.put("raw_payload", event.rawPayload());
    return row;
  }

  private void persistFaceAttendance(List<HikvisionRecognitionEvent> newEvents) {
    Map<FaceAttendanceKey, FaceAttendanceAccumulator> grouped = new LinkedHashMap<>();

    for (HikvisionRecognitionEvent event : newEvents) {
      if (!"matched".equals(event.matchStatus()) || !hasText(event.employeeNo())) {
        continue;
      }

      var localEventTime = event.eventTime().atZoneSameInstant(ATTENDANCE_ZONE);
      LocalDate attendanceDate = localEventTime.toLocalDate();
      LocalTime attendanceTime = localEventTime.toLocalTime().withNano(0);
      FaceAttendanceKey key = new FaceAttendanceKey(event.employeeNo(), attendanceDate.toString());
      EmployeeMatch match = findEmployee(event.employeeNo());
      FaceAttendanceAccumulator accumulator =
          grouped.computeIfAbsent(
              key,
              ignored ->
                  new FaceAttendanceAccumulator(
                      event.employeeNo(),
                      attendanceDate.toString(),
                      firstNonBlank(event.matchedEmployeeName(), match.employeeName(), event.devicePersonName()),
                      firstNonBlank(match.designation(), null),
                      firstNonBlank(event.matchedDepartment(), match.department()),
                      attendanceTime,
                      attendanceTime));

      accumulator.eventCount++;
      accumulator.firstSeen = minTime(accumulator.firstSeen, attendanceTime);
      accumulator.lastSeen = maxTime(accumulator.lastSeen, attendanceTime);
    }

    grouped.values().forEach(this::upsertFaceAttendance);
  }

  private void upsertFaceAttendance(FaceAttendanceAccumulator attendance) {
    try {
      MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
      query.add("employee_code", "eq." + attendance.employeeCode);
      query.add("attendance_date", "eq." + attendance.attendanceDate);
      query.add("limit", "1");
      ArrayNode rows = supabaseAdminClient.select("attendance_reconciliation", query);

      if (rows.isEmpty()) {
        supabaseAdminClient.insertSingle("attendance_reconciliation", newFaceAttendanceRow(attendance));
        return;
      }

      JsonNode existing = rows.get(0);
      MultiValueMap<String, String> updateQuery = new LinkedMultiValueMap<>();
      updateQuery.add("employee_code", "eq." + attendance.employeeCode);
      updateQuery.add("attendance_date", "eq." + attendance.attendanceDate);
      supabaseAdminClient.updateSingle(
          "attendance_reconciliation", updateQuery, updatedFaceAttendanceRow(existing, attendance));
    } catch (RuntimeException ignored) {
      // Live camera monitoring should continue even if the attendance projection is not migrated yet.
    }
  }

  private Map<String, Object> newFaceAttendanceRow(FaceAttendanceAccumulator attendance) {
    JsonNode fingerprint = fetchFingerprintAttendance(attendance.employeeCode, attendance.attendanceDate);
    boolean hasFingerprint =
        fingerprint != null
            && ("present".equals(JsonSupport.text(fingerprint, "attendance_state"))
                || hasText(JsonSupport.text(fingerprint, "time_in"))
                || hasText(JsonSupport.text(fingerprint, "time_out")));
    boolean isLeave = fingerprint != null && "leave".equals(JsonSupport.text(fingerprint, "attendance_state"));
    String status = faceAttendanceStatus(isLeave ? "leave" : null, hasFingerprint);

    Map<String, Object> row = new LinkedHashMap<>();
    row.put("face_import_batch_id", null);
    row.put("fingerprint_import_batch_id", fingerprint == null ? null : JsonSupport.text(fingerprint, "import_batch_id"));
    row.put("employee_code", attendance.employeeCode);
    row.put("attendance_date", attendance.attendanceDate);
    row.put("employee_name", firstNonBlank(fingerprint == null ? null : JsonSupport.text(fingerprint, "employee_name"), attendance.employeeName));
    row.put("designation", firstNonBlank(fingerprint == null ? null : JsonSupport.text(fingerprint, "designation"), attendance.designation));
    row.put("department_name", firstNonBlank(fingerprint == null ? null : JsonSupport.text(fingerprint, "department_name"), attendance.department));
    row.put("face_first_seen", databaseTime(attendance.firstSeen));
    row.put("face_last_seen", databaseTime(attendance.lastSeen));
    row.put("face_event_count", attendance.eventCount);
    row.put("duplicate_face_event_count", 0);
    row.put("fingerprint_time_in", fingerprint == null ? null : JsonSupport.text(fingerprint, "time_in"));
    row.put("fingerprint_time_out", fingerprint == null ? null : JsonSupport.text(fingerprint, "time_out"));
    row.put("late_early_hours", fingerprint == null ? null : JsonSupport.decimal(fingerprint, "late_early_hours"));
    row.put("ot_hours", fingerprint == null ? null : JsonSupport.decimal(fingerprint, "ot_hours"));
    row.put("leave_type", fingerprint == null ? null : JsonSupport.text(fingerprint, "leave_type"));
    row.put("reconciliation_status", status);
    row.put("exception_reason", faceAttendanceException(status));
    row.put("confidence_level", "validated".equals(status) ? "high" : "anomaly".equals(status) ? "low" : "medium");
    row.put("rule_flags", faceAttendanceRuleFlags(status));
    return row;
  }

  private Map<String, Object> updatedFaceAttendanceRow(
      JsonNode existing, FaceAttendanceAccumulator attendance) {
    String existingFirstSeen = JsonSupport.text(existing, "face_first_seen");
    String existingLastSeen = JsonSupport.text(existing, "face_last_seen");
    int existingFaceCount = Optional.ofNullable(JsonSupport.integer(existing, "face_event_count")).orElse(0);
    boolean existingHasFingerprint =
        hasText(JsonSupport.text(existing, "fingerprint_time_in"))
            || hasText(JsonSupport.text(existing, "fingerprint_time_out"));
    JsonNode fingerprint =
        existingHasFingerprint
            ? null
            : fetchFingerprintAttendance(attendance.employeeCode, attendance.attendanceDate);
    boolean fetchedHasFingerprint =
        fingerprint != null
            && ("present".equals(JsonSupport.text(fingerprint, "attendance_state"))
                || hasText(JsonSupport.text(fingerprint, "time_in"))
                || hasText(JsonSupport.text(fingerprint, "time_out")));
    boolean hasFingerprint = existingHasFingerprint || fetchedHasFingerprint;
    String existingStatus = JsonSupport.text(existing, "reconciliation_status");
    boolean isLeave =
        "leave".equals(existingStatus)
            || (fingerprint != null && "leave".equals(JsonSupport.text(fingerprint, "attendance_state")));
    String nextStatus = faceAttendanceStatus(isLeave ? "leave" : existingStatus, hasFingerprint);

    Map<String, Object> row = new LinkedHashMap<>();
    row.put("employee_name", firstNonBlank(JsonSupport.text(existing, "employee_name"), attendance.employeeName));
    row.put("designation", firstNonBlank(JsonSupport.text(existing, "designation"), attendance.designation));
    row.put("department_name", firstNonBlank(JsonSupport.text(existing, "department_name"), attendance.department));
    row.put(
        "face_first_seen",
        minTimeText(existingFirstSeen, databaseTime(attendance.firstSeen)));
    row.put(
        "face_last_seen",
        maxTimeText(existingLastSeen, databaseTime(attendance.lastSeen)));
    row.put("face_event_count", existingFaceCount + attendance.eventCount);
    row.put("duplicate_face_event_count", Optional.ofNullable(JsonSupport.integer(existing, "duplicate_face_event_count")).orElse(0));
    if (fingerprint != null) {
      row.put("fingerprint_import_batch_id", JsonSupport.text(fingerprint, "import_batch_id"));
      row.put("fingerprint_time_in", JsonSupport.text(fingerprint, "time_in"));
      row.put("fingerprint_time_out", JsonSupport.text(fingerprint, "time_out"));
      row.put("late_early_hours", JsonSupport.decimal(fingerprint, "late_early_hours"));
      row.put("ot_hours", JsonSupport.decimal(fingerprint, "ot_hours"));
      row.put("leave_type", JsonSupport.text(fingerprint, "leave_type"));
    }
    row.put("reconciliation_status", nextStatus);
    row.put("exception_reason", faceAttendanceException(nextStatus));
    row.put("confidence_level", "validated".equals(nextStatus) ? "high" : "anomaly".equals(nextStatus) ? "low" : "medium");
    row.put("rule_flags", faceAttendanceRuleFlags(nextStatus));
    return row;
  }

  private JsonNode fetchFingerprintAttendance(String employeeCode, String attendanceDate) {
    try {
      MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
      query.add("employee_code", "eq." + employeeCode);
      query.add("attendance_date", "eq." + attendanceDate);
      query.add("order", "created_at.desc");
      query.add("limit", "1");
      ArrayNode rows = supabaseAdminClient.select("fingerprint_daily_attendance", query);
      return rows.isEmpty() ? null : rows.get(0);
    } catch (RuntimeException ignored) {
      return null;
    }
  }

  private String faceAttendanceStatus(String existingStatus, boolean hasFingerprint) {
    if (hasFingerprint) {
      return "validated";
    }

    if ("leave".equals(existingStatus)) {
      return "anomaly";
    }

    return "face_only";
  }

  private String faceAttendanceException(String status) {
    return switch (status) {
      case "validated" -> null;
      case "anomaly" -> "Fingerprint export marks leave while live Hikvision face activity exists on the same day.";
      default -> "Live Hikvision face activity exists without a matching fingerprint attendance row.";
    };
  }

  private List<String> faceAttendanceRuleFlags(String status) {
    return switch (status) {
      case "validated" -> List.of("live_hikvision_face");
      case "anomaly" -> List.of("live_hikvision_face", "leave_and_face_conflict");
      default -> List.of("live_hikvision_face", "face_present_fingerprint_missing");
    };
  }

  private List<HikvisionRecognitionEvent> fetchAccessEvents(CameraDefinition camera) {
    HikvisionCameraConfig config = camera.config();
    OffsetDateTime now = OffsetDateTime.now();
    OffsetDateTime start = now.minusMinutes(Math.max(1, config.lookbackMinutes()));

    Map<String, Object> condition = new LinkedHashMap<>();
    condition.put("searchID", "garmentline-live-face-" + camera.id());
    condition.put("searchResultPosition", 0);
    condition.put("maxResults", 30);
    condition.put("major", 0);
    condition.put("minor", 0);
    condition.put("startTime", CAMERA_TIME_FORMATTER.format(start));
    condition.put("endTime", CAMERA_TIME_FORMATTER.format(now));
    condition.put("timeReverseOrder", true);

    Map<String, Object> payload = Map.of("AcsEventCond", condition);
    JsonNode response = isapiClient.postJson(config, "/ISAPI/AccessControl/AcsEvent?format=json", payload);
    JsonNode infoList = response.path("AcsEvent").path("InfoList");
    if (!(infoList instanceof ArrayNode arrayNode)) {
      return List.of();
    }

    List<HikvisionRecognitionEvent> normalized = new ArrayList<>();
    arrayNode.forEach(
        node -> {
          Optional<HikvisionRecognitionEvent> event = normalizeEvent(camera, node);
          event.ifPresent(normalized::add);
        });
    return normalized;
  }

  private Optional<HikvisionRecognitionEvent> normalizeEvent(CameraDefinition camera, JsonNode node) {
    String employeeNo = firstText(node, "employeeNoString", "employeeNo", "employeeNoString");
    String verifyMode = JsonSupport.text(node, "currentVerifyMode");
    String pictureUrl = JsonSupport.text(node, "pictureURL");
    String visibleLightPicUrl = firstText(node, "visibleLightPicUrl", "visibleLightURL");
    String devicePersonName = JsonSupport.text(node, "name");
    boolean likelyFaceEvent =
        hasText(employeeNo)
            || hasText(devicePersonName)
            || hasText(pictureUrl)
            || hasText(visibleLightPicUrl)
            || (verifyMode != null && verifyMode.toLowerCase(Locale.ROOT).contains("face"));

    if (!likelyFaceEvent) {
      return Optional.empty();
    }

    OffsetDateTime eventTime = parseCameraTime(firstText(node, "time", "dateTime")).orElse(OffsetDateTime.now());
    String serialNo = firstText(node, "serialNo", "SerialNo");
    Integer major = intValue(node, "major");
    Integer minor = intValue(node, "minor");
    EmployeeMatch match = hasText(employeeNo) ? findEmployee(employeeNo) : EmployeeMatch.unmatched();
    String id = eventId(camera.id(), serialNo, employeeNo, eventTime, major, minor);
    String attendanceStatus = JsonSupport.text(node, "attendanceStatus");
    String accessDecision = hasText(employeeNo) ? "recognized" : "unknown";

    return Optional.of(
        new HikvisionRecognitionEvent(
            id,
            camera.id(),
            camera.name(),
            camera.location(),
            camera.config().baseUrl(),
            serialNo,
            employeeNo,
            devicePersonName,
            match.employeeId(),
            match.employeeName(),
            match.department(),
            match.status(),
            eventTime,
            OffsetDateTime.now(),
            verifyMode,
            attendanceStatus,
            accessDecision,
            pictureUrl,
            visibleLightPicUrl,
            JsonSupport.text(node, "thermalPicUrl"),
            doubleValue(node, "currTemperature"),
            JsonSupport.text(node, "mask"),
            major,
            minor,
            objectMapper.convertValue(node, new TypeReference<Map<String, Object>>() {})));
  }

  private EmployeeMatch findEmployee(String employeeNo) {
    return employeeCache.computeIfAbsent(
        employeeNo,
        key -> {
          try {
            MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
            query.add("select", "id,employee_code,display_name,designation,department_name");
            query.add("employee_code", "eq." + key);
            query.add("limit", "1");
            ArrayNode rows = supabaseAdminClient.select("employees", query);
            if (rows.isEmpty()) {
              return EmployeeMatch.unmatched();
            }
            JsonNode row = rows.get(0);
            String displayName = JsonSupport.text(row, "display_name");
            return new EmployeeMatch(
                JsonSupport.text(row, "id"),
                displayName == null || displayName.isBlank() ? key : displayName,
                JsonSupport.text(row, "designation"),
                JsonSupport.text(row, "department_name"),
                "matched");
          } catch (RuntimeException exception) {
            return EmployeeMatch.unmatched();
          }
        });
  }

  private HikvisionDeviceInfo fetchDeviceInfo(HikvisionCameraConfig config) {
    String body;
    try {
      body = isapiClient.getText(config, "/ISAPI/System/deviceInfo?format=json");
    } catch (RuntimeException exception) {
      body = isapiClient.getText(config, "/ISAPI/System/deviceInfo");
    }
    return parseDeviceInfo(body);
  }

  private HikvisionDeviceInfo parseDeviceInfo(String body) {
    String trimmed = body == null ? "" : body.trim();
    if (trimmed.startsWith("{")) {
      try {
        JsonNode root = objectMapper.readTree(trimmed);
        JsonNode info = root.has("DeviceInfo") ? root.path("DeviceInfo") : root;
        return new HikvisionDeviceInfo(
            firstText(info, "deviceName", "deviceDescription"),
            firstText(info, "deviceID", "deviceId"),
            JsonSupport.text(info, "model"),
            firstText(info, "serialNumber", "serialNo"),
            firstText(info, "macAddress", "MACAddress"),
            firstText(info, "firmwareVersion", "firmwareReleasedDate"));
      } catch (Exception exception) {
        throw new ApiException(HttpStatus.BAD_GATEWAY, "Could not parse camera deviceInfo JSON.");
      }
    }

    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      Document document = factory.newDocumentBuilder().parse(new InputSource(new StringReader(trimmed)));
      return new HikvisionDeviceInfo(
          xmlText(document, "deviceName", "deviceDescription"),
          xmlText(document, "deviceID", "deviceId"),
          xmlText(document, "model"),
          xmlText(document, "serialNumber", "serialNo"),
          xmlText(document, "macAddress", "MACAddress"),
          xmlText(document, "firmwareVersion", "firmwareReleasedDate"));
    } catch (Exception exception) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, "Could not parse camera deviceInfo XML.");
    }
  }

  private String xmlText(Document document, String... names) {
    for (String name : names) {
      var nodes = document.getElementsByTagNameNS("*", name);
      if (nodes.getLength() == 0) {
        nodes = document.getElementsByTagName(name);
      }
      if (nodes.getLength() > 0) {
        String text = nodes.item(0).getTextContent();
        if (text != null && !text.isBlank()) {
          return text.trim();
        }
      }
    }
    return null;
  }

  private HikvisionStatus status() {
    List<CameraDefinition> cameras = activeCameras.get();
    if (cameras == null) {
      cameras = List.of();
    }
    List<HikvisionRecognitionEvent> snapshot;
    synchronized (eventLock) {
      snapshot = List.copyOf(events);
    }
    int matched = (int) snapshot.stream().filter(event -> "matched".equals(event.matchStatus())).count();
    List<HikvisionCameraEndpoint> cameraEndpoints =
        cameras.stream().map(this::cameraEndpoint).toList();
    int onlineCameraCount =
        (int)
            cameraEndpoints.stream()
                .filter(endpoint -> endpoint.lastSuccessAt() != null && !hasText(endpoint.lastError()))
                .count();
    HikvisionCameraConfig firstConfig = cameras.isEmpty() ? null : cameras.get(0).config();
    HikvisionDeviceInfo firstDeviceInfo =
        cameraEndpoints.stream()
            .map(HikvisionCameraEndpoint::deviceInfo)
            .filter(Objects::nonNull)
            .findFirst()
            .orElse(null);

    boolean localPollingRunning = pollingTask != null && !pollingTask.isCancelled();
    boolean bridgeRecentlyActive =
        !localPollingRunning
            && lastSuccessAt != null
            && lastSuccessAt.isAfter(
                OffsetDateTime.now()
                    .minusSeconds(
                        Math.max(
                            15,
                            (long)
                                (firstConfig == null
                                    ? DEFAULT_POLL_INTERVAL_SECONDS
                                    : firstConfig.pollIntervalSeconds())
                                    * 3)));

    return new HikvisionStatus(
        !cameras.isEmpty(),
        localPollingRunning || bridgeRecentlyActive,
        firstConfig == null ? null : firstConfig.baseUrl(),
        firstConfig == null ? null : firstConfig.username(),
        firstConfig == null ? DEFAULT_POLL_INTERVAL_SECONDS : firstConfig.pollIntervalSeconds(),
        firstConfig == null ? DEFAULT_LOOKBACK_MINUTES : firstConfig.lookbackMinutes(),
        lastPollAt,
        lastSuccessAt,
        lastError,
        firstDeviceInfo,
        snapshot.size(),
        matched,
        cameras.size(),
        onlineCameraCount,
        cameraEndpoints);
  }

  private CameraDefinition bridgeCameraDefinition(HikvisionBridgePushRequest request) {
    String baseUrl = normalizeBaseUrl(request.cameraBaseUrl());
    List<CameraDefinition> cameras = activeCameras.get();
    if (cameras != null) {
      for (CameraDefinition camera : cameras) {
        if (camera.id().equals(request.cameraId()) || normalizeBaseUrl(camera.config().baseUrl()).equals(baseUrl)) {
          return camera;
        }
      }
    }

    return new CameraDefinition(
        request.cameraId(),
        request.cameraName(),
        firstNonBlank(request.cameraLocation(), "Factory camera"),
        new HikvisionCameraConfig(
            baseUrl,
            "bridge",
            "",
            DEFAULT_POLL_INTERVAL_SECONDS,
            DEFAULT_LOOKBACK_MINUTES));
  }

  private void validateBridgeToken(String suppliedBridgeToken) {
    if (!hasText(bridgeToken)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Hikvision bridge token is not configured.");
    }

    if (!bridgeToken.trim().equals(suppliedBridgeToken == null ? null : suppliedBridgeToken.trim())) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid Hikvision bridge token.");
    }
  }

  private List<CameraDefinition> camerasFromProperties(HikvisionProperties properties) {
    String username = properties == null ? "admin" : Objects.requireNonNullElse(properties.username(), "admin");
    String password = properties == null ? "" : Objects.requireNonNullElse(properties.password(), "");
    int pollSeconds =
        properties == null || properties.pollIntervalSeconds() == null
            ? DEFAULT_POLL_INTERVAL_SECONDS
            : properties.pollIntervalSeconds();
    int lookbackMinutes =
        properties == null || properties.lookbackMinutes() == null
            ? DEFAULT_LOOKBACK_MINUTES
            : properties.lookbackMinutes();

    List<CameraSeed> seeds = cameraSeeds(properties);
    return seeds.stream()
        .map(seed -> cameraDefinition(seed, username, password, pollSeconds, lookbackMinutes))
        .toList();
  }

  private List<CameraSeed> cameraSeeds(HikvisionProperties properties) {
    String rawCameraUrls = properties == null ? null : properties.cameraUrls();
    if (hasText(rawCameraUrls)) {
      String[] urls = rawCameraUrls.split("[,;\\n]+");
      List<CameraSeed> seeds = new ArrayList<>();
      int index = 1;
      for (String url : urls) {
        if (!hasText(url)) {
          continue;
        }
        String baseUrl = normalizeBaseUrl(url);
        seeds.add(seedForBaseUrl(baseUrl, index));
        index++;
      }
      if (!seeds.isEmpty()) {
        return seeds;
      }
    }

    if (properties != null && hasText(properties.baseUrl())) {
      String baseUrl = normalizeBaseUrl(properties.baseUrl());
      return List.of(seedForBaseUrl(baseUrl, 1));
    }

    return DEFAULT_CAMERA_SEEDS;
  }

  private CameraSeed seedForBaseUrl(String baseUrl, int fallbackIndex) {
    for (CameraSeed seed : DEFAULT_CAMERA_SEEDS) {
      if (normalizeBaseUrl(seed.baseUrl()).equals(baseUrl)) {
        return seed;
      }
    }

    return new CameraSeed(
        "camera-" + fallbackIndex,
        "Hikvision camera " + String.format("%02d", fallbackIndex),
        "Configured camera",
        baseUrl);
  }

  private CameraDefinition cameraDefinition(
      CameraSeed seed, String username, String password, int pollSeconds, int lookbackMinutes) {
    return new CameraDefinition(
        seed.id(),
        seed.name(),
        seed.location(),
        new HikvisionCameraConfig(
            normalizeBaseUrl(seed.baseUrl()), username, password, pollSeconds, lookbackMinutes));
  }

  private HikvisionCameraEndpoint cameraEndpoint(CameraDefinition camera) {
    CameraRuntimeState state = cameraState(camera);
    return new HikvisionCameraEndpoint(
        camera.id(),
        camera.name(),
        camera.location(),
        camera.config().baseUrl(),
        hasText(camera.config().baseUrl()),
        state.lastPollAt,
        state.lastSuccessAt,
        state.lastError,
        state.deviceInfo);
  }

  private CameraRuntimeState cameraState(CameraDefinition camera) {
    return cameraStates.computeIfAbsent(camera.id(), ignored -> new CameraRuntimeState());
  }

  private List<CameraDefinition> requireCameras() {
    List<CameraDefinition> cameras = activeCameras.get();
    if (cameras == null || cameras.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Configure at least one Hikvision camera connection first.");
    }
    return cameras;
  }

  private String normalizeBaseUrl(String baseUrl) {
    String value = baseUrl == null ? "" : baseUrl.trim();
    if (value.endsWith("/")) {
      value = value.substring(0, value.length() - 1);
    }
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      value = "http://" + value;
    }
    return value;
  }

  private Optional<OffsetDateTime> parseCameraTime(String value) {
    if (value == null || value.isBlank()) {
      return Optional.empty();
    }
    try {
      return Optional.of(OffsetDateTime.parse(value));
    } catch (DateTimeParseException ignored) {
      try {
        return Optional.of(
            LocalDateTime.parse(value)
                .atOffset(ZoneId.systemDefault().getRules().getOffset(LocalDateTime.now())));
      } catch (DateTimeParseException ignoredAgain) {
        return Optional.empty();
      }
    }
  }

  private String firstText(JsonNode node, String... names) {
    for (String name : names) {
      String value = JsonSupport.text(node, name);
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return null;
  }

  private Integer intValue(JsonNode node, String name) {
    JsonNode value = node.path(name);
    return value.isInt() ? value.asInt() : null;
  }

  private Double doubleValue(JsonNode node, String name) {
    JsonNode value = node.path(name);
    return value.isNumber() ? value.asDouble() : null;
  }

  private String databaseTime(LocalTime time) {
    return time == null ? null : DATABASE_TIME_FORMATTER.format(time);
  }

  private LocalTime minTime(LocalTime left, LocalTime right) {
    if (left == null) {
      return right;
    }
    if (right == null) {
      return left;
    }
    return left.isBefore(right) ? left : right;
  }

  private LocalTime maxTime(LocalTime left, LocalTime right) {
    if (left == null) {
      return right;
    }
    if (right == null) {
      return left;
    }
    return left.isAfter(right) ? left : right;
  }

  private String minTimeText(String left, String right) {
    if (!hasText(left)) {
      return right;
    }
    if (!hasText(right)) {
      return left;
    }
    return left.compareTo(right) <= 0 ? left : right;
  }

  private String maxTimeText(String left, String right) {
    if (!hasText(left)) {
      return right;
    }
    if (!hasText(right)) {
      return left;
    }
    return left.compareTo(right) >= 0 ? left : right;
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (hasText(value)) {
        return value;
      }
    }
    return null;
  }

  private String eventId(
      String cameraId,
      String serialNo,
      String employeeNo,
      OffsetDateTime eventTime,
      Integer major,
      Integer minor) {
    return "hikvision-"
        + UUID.nameUUIDFromBytes(
            (cameraId + "|" + serialNo + "|" + employeeNo + "|" + eventTime + "|" + major + "|" + minor)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  private boolean hasText(String value) {
    return value != null && !value.isBlank();
  }

  private void stopPollingInternal() {
    if (pollingTask != null) {
      pollingTask.cancel(true);
      pollingTask = null;
    }
  }

  private void requireAccess(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "admin", "hr", "supervisor", "ie", "viewer");
  }

  private void requireManage(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "admin", "supervisor", "ie");
  }

  private record EmployeeMatch(
      String employeeId,
      String employeeName,
      String designation,
      String department,
      String status
  ) {
    static EmployeeMatch unmatched() {
      return new EmployeeMatch(null, null, null, null, "unmatched");
    }
  }

  private record FaceAttendanceKey(String employeeCode, String attendanceDate) {}

  private static final class FaceAttendanceAccumulator {
    private final String employeeCode;
    private final String attendanceDate;
    private final String employeeName;
    private final String designation;
    private final String department;
    private int eventCount;
    private LocalTime firstSeen;
    private LocalTime lastSeen;

    private FaceAttendanceAccumulator(
        String employeeCode,
        String attendanceDate,
        String employeeName,
        String designation,
        String department,
        LocalTime firstSeen,
        LocalTime lastSeen) {
      this.employeeCode = employeeCode;
      this.attendanceDate = attendanceDate;
      this.employeeName = employeeName;
      this.designation = designation;
      this.department = department;
      this.firstSeen = firstSeen;
      this.lastSeen = lastSeen;
    }
  }

  private record CameraSeed(String id, String name, String location, String baseUrl) {}

  private record CameraDefinition(
      String id, String name, String location, HikvisionCameraConfig config) {}

  private static final class CameraRuntimeState {
    private volatile OffsetDateTime lastPollAt;
    private volatile OffsetDateTime lastSuccessAt;
    private volatile String lastError;
    private volatile HikvisionDeviceInfo deviceInfo;
  }
}
