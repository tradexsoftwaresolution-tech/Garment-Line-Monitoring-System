package com.garmentline.operations.service;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.garmentline.operations.security.AuthenticatedUser;
import com.garmentline.operations.security.RoleGuard;
import com.garmentline.operations.supabase.SupabaseAdminClient;
import com.garmentline.operations.support.JsonSupport;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@Service
public class DirectoryService {

  private final SupabaseAdminClient supabaseAdminClient;
  private final RoleGuard roleGuard;

  public DirectoryService(SupabaseAdminClient supabaseAdminClient, RoleGuard roleGuard) {
    this.supabaseAdminClient = supabaseAdminClient;
    this.roleGuard = roleGuard;
  }

  public List<Map<String, Object>> listActiveAppUsers(AuthenticatedUser user) {
    roleGuard.requireAnyRole(user, "admin", "hr", "supervisor", "ie");

    MultiValueMap<String, String> query = new LinkedMultiValueMap<>();
    query.add("is_active", "eq.true");
    query.add("order", "full_name.asc");

    ArrayNode rows = supabaseAdminClient.select("profiles", query);
    List<Map<String, Object>> users = new ArrayList<>();
    rows.forEach(
        row -> {
          String role = JsonSupport.text(row, "role") == null ? "viewer" : JsonSupport.text(row, "role");
          String name = JsonSupport.text(row, "full_name") == null ? "Active User" : JsonSupport.text(row, "full_name");
          Map<String, Object> payload = new LinkedHashMap<>();
          payload.put("id", JsonSupport.text(row, "id"));
          payload.put("name", name);
          payload.put("role", role);
          payload.put("title", roleTitle(role));
          payload.put("department", roleDepartment(role));
          payload.put("initials", initials(name));
          users.add(payload);
        });
    return users;
  }

  private String roleTitle(String role) {
    return switch (role) {
      case "super_admin" -> "Platform Super Administrator";
      case "admin" -> "Factory Systems Administrator";
      case "supervisor" -> "Floor Supervisor";
      case "hr" -> "HR Operations Lead";
      case "ie" -> "Industrial Engineering Planner";
      default -> "Management Read-Only";
    };
  }

  private String roleDepartment(String role) {
    return switch (role) {
      case "super_admin" -> "Platform Administration";
      case "admin" -> "Operations";
      case "supervisor" -> "Production";
      case "hr" -> "Human Resources";
      case "ie" -> "Industrial Engineering";
      default -> "Management";
    };
  }

  private String initials(String name) {
    String[] parts = name.split(" ");
    StringBuilder builder = new StringBuilder();
    for (String part : parts) {
      if (!part.isBlank()) {
        builder.append(part.charAt(0));
      }
      if (builder.length() >= 2) {
        break;
      }
    }
    return builder.toString().toUpperCase(Locale.ROOT);
  }
}
