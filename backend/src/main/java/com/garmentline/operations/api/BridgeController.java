package com.garmentline.operations.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.garmentline.operations.config.BridgeProperties;
import com.garmentline.operations.hikvision.HikvisionService;
import com.garmentline.operations.hikvision.model.HikvisionBridgeIngestResponse;
import com.garmentline.operations.hikvision.model.HikvisionBridgePushRequest;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.ApiException;
import com.garmentline.operations.zkteco.ZktecoAdmsService;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@RestController
@RequestMapping("/api/bridge")
public class BridgeController {

  private final BridgeProperties bridgeProperties;
  private final HikvisionService hikvisionService;
  private final ZktecoAdmsService zktecoAdmsService;
  private final SupabaseAdminClient supabaseAdminClient;
  private final ObjectMapper objectMapper;

  public BridgeController(
      BridgeProperties bridgeProperties,
      HikvisionService hikvisionService,
      ZktecoAdmsService zktecoAdmsService,
      SupabaseAdminClient supabaseAdminClient,
      ObjectMapper objectMapper) {
    this.bridgeProperties = bridgeProperties;
    this.hikvisionService = hikvisionService;
    this.zktecoAdmsService = zktecoAdmsService;
    this.supabaseAdminClient = supabaseAdminClient;
    this.objectMapper = objectMapper;
  }

  @GetMapping("/health")
  public Map<String, Object> health(@RequestHeader(name = "X-Bridge-Token", required = false) String token) {
    validateToken(token);
    return Map.of("ok", true, "at", OffsetDateTime.now().toString());
  }

  @PostMapping("/hikvision/events")
  public Map<String, Object> hikvisionEvents(
      @RequestHeader(name = "X-Bridge-Token", required = false) String token,
      @RequestBody(required = false) List<Map<String, Object>> events) {
    validateToken(token);
    HikvisionBridgeIngestResponse response = hikvisionService.receiveBridgeEvents(token, hikvisionRequest(events));
    return Map.of("received", response.receivedEvents(), "accepted", response.acceptedEvents());
  }

  @PostMapping("/zkteco/punches")
  public Map<String, Object> zktecoPunches(
      @RequestHeader(name = "X-Bridge-Token", required = false) String token,
      @RequestBody(required = false) List<Map<String, Object>> punches) {
    validateToken(token);
    int received = punches == null ? 0 : punches.size();
    int accepted = zktecoAdmsService.receiveBridgePunches(punches);
    return Map.of("received", received, "accepted", accepted);
  }

  @GetMapping("/device-identity-actions")
  public List<Map<String, Object>> deviceIdentityActions(
      @RequestHeader(name = "X-Bridge-Token", required = false) String token,
      @RequestParam(name = "deviceFamily", required = false) String deviceFamily,
      @RequestParam(name = "limit", required = false, defaultValue = "50") int limit) {
    validateToken(token);

    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("status", "eq.pending");
    if (deviceFamily != null && !deviceFamily.isBlank()) {
      query.add("device_family", "eq." + deviceFamily.trim());
    }
    query.add("order", "created_at.asc");
    query.add("limit", String.valueOf(Math.max(1, Math.min(limit, 200))));

    ArrayNode rows = supabaseAdminClient.select("device_identity_sync_queue", query);
    List<Map<String, Object>> actions = new ArrayList<>();
    rows.forEach(row -> actions.add(objectMapper.convertValue(row, Map.class)));
    return actions;
  }

  @PostMapping("/device-identity-actions/{id}/complete")
  public Map<String, Object> completeDeviceIdentityAction(
      @RequestHeader(name = "X-Bridge-Token", required = false) String token,
      @PathVariable String id,
      @RequestBody(required = false) IdentityActionCompletionRequest request) {
    validateToken(token);

    boolean ok = request != null && Boolean.TRUE.equals(request.ok());
    ObjectNode payload = objectMapper.createObjectNode();
    payload.put("status", ok ? "completed" : "failed");
    payload.put("processed_at", OffsetDateTime.now().toString());
    if (ok) {
      payload.putNull("error_message");
    } else {
      String errorMessage =
          request == null || request.errorMessage() == null || request.errorMessage().isBlank()
              ? "Bridge reported identity cleanup failure."
              : request.errorMessage().trim();
      payload.put("error_message", errorMessage);
    }

    ObjectNode row =
        supabaseAdminClient.updateSingle(
            "device_identity_sync_queue",
            supabaseAdminClient.filters(Map.of("id", "eq." + id)),
            payload);
    return objectMapper.convertValue(row, Map.class);
  }

  private HikvisionBridgePushRequest hikvisionRequest(List<Map<String, Object>> events) {
    Map<String, Object> first = events == null || events.isEmpty() ? Map.of() : events.get(0);
    String cameraBaseUrl = text(first, "cameraBaseUrl", "bridge");
    return new HikvisionBridgePushRequest(
        text(first, "cameraId", "hikvision-bridge"),
        text(first, "cameraName", cameraBaseUrl),
        text(first, "cameraLocation", null),
        cameraBaseUrl,
        OffsetDateTime.now(),
        null,
        events == null ? List.of() : events);
  }

  private void validateToken(String suppliedToken) {
    String expectedToken = bridgeProperties.sharedToken();
    if (expectedToken == null || expectedToken.isBlank()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Bridge token is not configured.");
    }
    if (!expectedToken.trim().equals(suppliedToken == null ? null : suppliedToken.trim())) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid bridge token.");
    }
  }

  private String text(Map<String, Object> source, String key, String fallback) {
    Object value = source.get(key);
    String text = value == null ? null : value.toString().trim();
    return text == null || text.isBlank() ? fallback : text;
  }

  public record IdentityActionCompletionRequest(Boolean ok, String errorMessage) {}
}
