package com.garmentline.operations.api;

import com.garmentline.operations.security.AuthenticatedUser;
import com.garmentline.operations.security.UserContextService;
import com.garmentline.operations.service.RbacUserManagementService;
import com.garmentline.operations.service.RbacUserManagementService.ManagedUserCreateRequest;
import com.garmentline.operations.service.RbacUserManagementService.ManagedUserUpdateRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rbac/users")
@Validated
public class RbacUserManagementController {

  private final RbacUserManagementService rbacUserManagementService;
  private final UserContextService userContextService;

  public RbacUserManagementController(
      RbacUserManagementService rbacUserManagementService,
      UserContextService userContextService) {
    this.rbacUserManagementService = rbacUserManagementService;
    this.userContextService = userContextService;
  }

  @GetMapping
  public List<Map<String, Object>> listUsers(@AuthenticationPrincipal Jwt jwt) {
    AuthenticatedUser user = userContextService.loadCurrentUser(jwt);
    return rbacUserManagementService.listUsers(user);
  }

  @PostMapping
  public Map<String, Object> createUser(
      @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ManagedUserCreateRequest request) {
    AuthenticatedUser user = userContextService.loadCurrentUser(jwt);
    return rbacUserManagementService.createUser(user, request);
  }

  @PutMapping("/{id}")
  public Map<String, Object> updateUser(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @Valid @RequestBody ManagedUserUpdateRequest request) {
    AuthenticatedUser user = userContextService.loadCurrentUser(jwt);
    return rbacUserManagementService.updateUser(user, id, request);
  }
}
