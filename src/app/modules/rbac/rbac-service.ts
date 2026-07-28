import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  actionPermissions,
  actionTitles,
  roleLabels,
  routePermissions,
  routeTitles,
  type AppAction,
  type AppRouteKey,
} from "../../permissions";
import type { UserRole } from "../../types";

export type RbacPermissionType = "route" | "action";

export type RbacRoleRecord = {
  roleCode: string;
  label: string;
  description: string;
  isSystemRole: boolean;
  isActive: boolean;
  displayOrder: number;
};

export type RbacPermissionRecord = {
  permissionKey: string;
  permissionType: RbacPermissionType;
  label: string;
  description: string;
  isActive: boolean;
  displayOrder: number;
};

export type RbacRolePermissionGrant = {
  roleCode: string;
  permissionKey: string;
};

export type RbacConfiguration = {
  roles: RbacRoleRecord[];
  permissions: RbacPermissionRecord[];
  grants: RbacRolePermissionGrant[];
};

export type RbacAccessMatrix = {
  routes: Partial<Record<AppRouteKey, UserRole[]>>;
  actions: Partial<Record<AppAction, UserRole[]>>;
};

type AppSupabaseClient = SupabaseClient<Database>;

const knownUserRoles = Object.keys(roleLabels) as UserRole[];
const knownRouteKeys = Object.keys(routeTitles) as AppRouteKey[];
const knownActionKeys = Object.keys(actionTitles) as AppAction[];

function isKnownUserRole(value: string): value is UserRole {
  return knownUserRoles.includes(value as UserRole);
}

function isKnownRouteKey(value: string): value is AppRouteKey {
  return knownRouteKeys.includes(value as AppRouteKey);
}

function isKnownActionKey(value: string): value is AppAction {
  return knownActionKeys.includes(value as AppAction);
}

export function routePermissionKey(routeKey: AppRouteKey) {
  return `route.${routeKey}`;
}

export function actionPermissionKey(action: AppAction) {
  return `action.${action}`;
}

export function defaultRbacGrantRows(): RbacRolePermissionGrant[] {
  const grants: RbacRolePermissionGrant[] = [];

  Object.entries(routePermissions).forEach(([routeKey, roles]) => {
    roles.forEach((role) => {
      grants.push({
        roleCode: role,
        permissionKey: routePermissionKey(routeKey as AppRouteKey),
      });
    });
  });

  Object.entries(actionPermissions).forEach(([action, roles]) => {
    roles.forEach((role) => {
      grants.push({
        roleCode: role,
        permissionKey: actionPermissionKey(action as AppAction),
      });
    });
  });

  return grants;
}

export function buildRbacAccessMatrix(configuration: RbacConfiguration): RbacAccessMatrix {
  const activeRoles = new Set(
    configuration.roles
      .filter((role) => role.isActive && isKnownUserRole(role.roleCode))
      .map((role) => role.roleCode as UserRole)
  );
  const permissionsByKey = new Map(
    configuration.permissions
      .filter((permission) => permission.isActive)
      .map((permission) => [permission.permissionKey, permission])
  );
  const routes: Partial<Record<AppRouteKey, UserRole[]>> = {};
  const actions: Partial<Record<AppAction, UserRole[]>> = {};

  configuration.grants.forEach((grant) => {
    if (!isKnownUserRole(grant.roleCode) || !activeRoles.has(grant.roleCode)) {
      return;
    }

    const permission = permissionsByKey.get(grant.permissionKey);
    if (!permission) {
      return;
    }

    if (permission.permissionType === "route") {
      const routeKey = permission.permissionKey.replace(/^route\./, "");
      if (isKnownRouteKey(routeKey)) {
        routes[routeKey] = [...(routes[routeKey] || []), grant.roleCode];
      }
      return;
    }

    const action = permission.permissionKey.replace(/^action\./, "");
    if (isKnownActionKey(action)) {
      if (action === "manageRoleAccess" && grant.roleCode !== "super_admin") {
        return;
      }
      actions[action] = [...(actions[action] || []), grant.roleCode];
    }
  });

  return { routes, actions };
}

export async function listRbacConfiguration(
  client: AppSupabaseClient
): Promise<RbacConfiguration> {
  const [rolesResponse, permissionsResponse, grantsResponse] = await Promise.all([
    client.from("rbac_roles").select("*").order("display_order", { ascending: true }),
    client
      .from("rbac_permissions")
      .select("*")
      .order("permission_type", { ascending: false })
      .order("display_order", { ascending: true }),
    client.from("rbac_role_permissions").select("role_code, permission_key"),
  ]);

  if (rolesResponse.error) {
    throw new Error(rolesResponse.error.message);
  }
  if (permissionsResponse.error) {
    throw new Error(permissionsResponse.error.message);
  }
  if (grantsResponse.error) {
    throw new Error(grantsResponse.error.message);
  }

  return {
    roles: (rolesResponse.data || []).map((role) => ({
      roleCode: role.role_code,
      label: role.label,
      description: role.description,
      isSystemRole: role.is_system_role,
      isActive: role.is_active,
      displayOrder: role.display_order,
    })),
    permissions: (permissionsResponse.data || []).map((permission) => ({
      permissionKey: permission.permission_key,
      permissionType: permission.permission_type,
      label: permission.label,
      description: permission.description,
      isActive: permission.is_active,
      displayOrder: permission.display_order,
    })),
    grants: (grantsResponse.data || []).map((grant) => ({
      roleCode: grant.role_code,
      permissionKey: grant.permission_key,
    })),
  };
}

export async function replaceRbacRolePermissions(
  client: AppSupabaseClient,
  grants: RbacRolePermissionGrant[]
) {
  const { error } = await client.rpc("replace_rbac_role_permissions", {
    p_grants: grants.map((grant) => ({
      role_code: grant.roleCode,
      permission_key: grant.permissionKey,
    })) as Json,
  });

  if (error) {
    throw new Error(error.message);
  }
}
