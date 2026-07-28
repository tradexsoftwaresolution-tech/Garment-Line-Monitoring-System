package com.garmentline.operations.security;

import com.garmentline.operations.support.ApiException;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class RoleGuard {

  public void requireAnyRole(AuthenticatedUser user, String... roles) {
    if ("super_admin".equals(user.role())) {
      return;
    }

    Set<String> allowedRoles = Set.of(roles);
    if (!allowedRoles.contains(user.role())) {
      throw new ApiException(
          HttpStatus.FORBIDDEN,
          "This action requires one of the following roles: " + String.join(", ", allowedRoles));
    }
  }
}
