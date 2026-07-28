package com.garmentline.operations.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.garmentline.operations.security.AuthenticatedUser;
import com.garmentline.operations.security.RoleGuard;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.ApiException;
import com.garmentline.operations.support.JsonSupport;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@Service
public class RbacUserManagementService {

  private static final List<String> ALLOWED_ROLES =
      List.of("super_admin", "admin", "supervisor", "hr", "ie", "viewer");

  private final SupabaseAdminClient supabaseAdminClient;
  private final RoleGuard roleGuard;
  public RbacUserManagementService(
      SupabaseAdminClient supabaseAdminClient, RoleGuard roleGuard) {
    this.supabaseAdminClient = supabaseAdminClient;
    this.roleGuard = roleGuard;
  }

  public List<Map<String, Object>> listUsers(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "super_admin");

    Map<String, JsonNode> authUsersById = authUsersById();
    ArrayNode profiles = supabaseAdminClient.selectAll("profiles", new LinkedMultiValueMap<>());
    List<Map<String, Object>> users = new ArrayList<>();

    profiles.forEach(
        profile -> {
          String userId = JsonSupport.text(profile, "id");
          JsonNode authUser = authUsersById.get(userId);
          users.add(toManagedUser(profile, authUser));
        });

    authUsersById.forEach(
        (userId, authUser) -> {
          boolean alreadyListed =
              users.stream().anyMatch(existing -> userId.equals(existing.get("id")));
          if (!alreadyListed) {
            users.add(toManagedUser(null, authUser));
          }
        });

    users.sort(
        Comparator.comparing(
            entry ->
                String.valueOf(
                    entry.get("fullName") == null ? entry.get("email") : entry.get("fullName")),
            String.CASE_INSENSITIVE_ORDER));
    return users;
  }

  public Map<String, Object> createUser(AuthenticatedUser actor, ManagedUserCreateRequest request) {
    roleGuard.requireAnyRole(actor, "super_admin");

    String fullName = requireText(request.fullName(), "Full name is required.");
    String email = requireEmail(request.email());
    String password = requirePassword(request.password());
    String role = requireRole(request.role());

    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("full_name", fullName);
    metadata.put("role", role);

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("email", email);
    payload.put("password", password);
    payload.put("email_confirm", true);
    payload.put("user_metadata", metadata);

    ObjectNode authUser = supabaseAdminClient.createAuthUser(payload);
    String userId = authUserId(authUser);

    upsertProfile(userId, fullName, role, true);
    return toManagedUser(loadProfile(userId), authUser);
  }

  public Map<String, Object> updateUser(
      AuthenticatedUser actor, String userId, ManagedUserUpdateRequest request) {
    roleGuard.requireAnyRole(actor, "super_admin");

    String normalizedUserId = requireText(userId, "User id is required.");
    ObjectNode currentProfile = loadProfile(normalizedUserId);
    String currentRole = valueOrDefault(JsonSupport.text(currentProfile, "role"), "viewer");
    String fullName =
        blankToNull(request.fullName()) == null
            ? valueOrDefault(JsonSupport.text(currentProfile, "full_name"), "Supabase User")
            : requireText(request.fullName(), "Full name is required.");
    String role =
        blankToNull(request.role()) == null ? currentRole : requireRole(request.role());
    String password = blankToNull(request.password());

    if (actor.id().equals(normalizedUserId) && !"super_admin".equals(role)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "You cannot remove your own super admin role.");
    }
    ensureAtLeastOneOtherSuperAdmin(normalizedUserId, currentRole, role);

    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("full_name", fullName);
    metadata.put("role", role);

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("user_metadata", metadata);
    if (password != null) {
      payload.put("password", requirePassword(password));
    }

    ObjectNode authUser = supabaseAdminClient.updateAuthUser(normalizedUserId, payload);
    upsertProfile(normalizedUserId, fullName, role, true);
    return toManagedUser(loadProfile(normalizedUserId), authUser);
  }

  private void upsertProfile(String userId, String fullName, String role, boolean active) {
    Map<String, Object> profile = new LinkedHashMap<>();
    profile.put("id", userId);
    profile.put("full_name", fullName);
    profile.put("role", role);
    profile.put("is_active", active);
    supabaseAdminClient.upsertMany("profiles", List.of(profile), "id");
  }

  private ObjectNode loadProfile(String userId) {
    MultiValueMap<String, String> query = supabaseAdminClient.filters(Map.of("id", "eq." + userId));
    ArrayNode rows = supabaseAdminClient.select("profiles", query);
    if (rows.isEmpty() || !(rows.get(0) instanceof ObjectNode objectNode)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "User profile was not found.");
    }
    return objectNode;
  }

  private Map<String, JsonNode> authUsersById() {
    JsonNode payload = supabaseAdminClient.listAuthUsers();
    JsonNode usersNode = payload == null ? null : payload.get("users");
    Iterable<JsonNode> users =
        usersNode instanceof ArrayNode arrayNode
            ? arrayNode
            : payload instanceof ArrayNode arrayPayload ? arrayPayload : List.<JsonNode>of();

    Map<String, JsonNode> usersById = new HashMap<>();
    users.forEach(
        authUser -> {
          String id = JsonSupport.text(authUser, "id");
          if (id != null) {
            usersById.put(id, authUser);
          }
        });
    return usersById;
  }

  private void ensureAtLeastOneOtherSuperAdmin(
      String targetUserId, String currentRole, String nextRole) {
    if (!"super_admin".equals(currentRole) || "super_admin".equals(nextRole)) {
      return;
    }

    MultiValueMap<String, String> query =
        supabaseAdminClient.filters(Map.of("role", "eq.super_admin", "is_active", "eq.true"));
    ArrayNode superAdmins = supabaseAdminClient.select("profiles", query);
    long remaining =
        JsonSupport.toList(superAdmins).stream()
            .filter(row -> !targetUserId.equals(JsonSupport.text(row, "id")))
            .count();

    if (remaining == 0) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "At least one active super admin is required.");
    }
  }

  private Map<String, Object> toManagedUser(JsonNode profile, JsonNode authUser) {
    String userId =
        JsonSupport.text(profile, "id") == null
            ? JsonSupport.text(authUser, "id")
            : JsonSupport.text(profile, "id");
    String email = JsonSupport.text(authUser, "email");
    String fullName =
        JsonSupport.text(profile, "full_name") == null
            ? metadataText(authUser, "full_name", valueOrDefault(email, "Supabase User"))
            : JsonSupport.text(profile, "full_name");
    String role =
        JsonSupport.text(profile, "role") == null ? metadataText(authUser, "role", "viewer") : JsonSupport.text(profile, "role");
    Boolean isActive = JsonSupport.bool(profile, "is_active");

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("id", userId);
    payload.put("email", email);
    payload.put("fullName", fullName);
    payload.put("role", role);
    payload.put("isActive", isActive == null || isActive);
    payload.put("emailConfirmedAt", JsonSupport.text(authUser, "email_confirmed_at"));
    payload.put("lastSignInAt", JsonSupport.text(authUser, "last_sign_in_at"));
    payload.put("createdAt", JsonSupport.text(profile, "created_at") == null ? JsonSupport.text(authUser, "created_at") : JsonSupport.text(profile, "created_at"));
    return payload;
  }

  private String metadataText(JsonNode authUser, String field, String fallback) {
    JsonNode metadata = authUser == null ? null : authUser.get("user_metadata");
    String value = JsonSupport.text(metadata, field);
    return value == null ? fallback : value;
  }

  private String authUserId(JsonNode authUser) {
    String id = JsonSupport.text(authUser, "id");
    if (id != null) {
      return id;
    }
    JsonNode nestedUser = authUser == null ? null : authUser.get("user");
    id = JsonSupport.text(nestedUser, "id");
    if (id != null) {
      return id;
    }
    throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Supabase did not return the created user id.");
  }

  private String requireEmail(String value) {
    String email = requireText(value, "Email is required.").toLowerCase(Locale.ROOT);
    if (!email.contains("@") || email.startsWith("@") || email.endsWith("@")) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Enter a valid email address.");
    }
    return email;
  }

  private String requirePassword(String value) {
    String password = requireText(value, "Password is required.");
    if (password.length() < 8) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Use at least 8 characters for the password.");
    }
    return password;
  }

  private String requireRole(String value) {
    String role = requireText(value, "Role is required.");
    if (!ALLOWED_ROLES.contains(role)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Unsupported role: " + role);
    }
    return role;
  }

  private String requireText(String value, String message) {
    String normalized = blankToNull(value);
    if (normalized == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, message);
    }
    return normalized;
  }

  private String blankToNull(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return value.trim();
  }

  private String valueOrDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  public record ManagedUserCreateRequest(
      String fullName,
      String email,
      String password,
      String role) {
  }

  public record ManagedUserUpdateRequest(
      String fullName,
      String password,
      String role) {
  }
}
