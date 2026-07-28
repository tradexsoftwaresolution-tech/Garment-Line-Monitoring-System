import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Save, ShieldCheck } from "lucide-react";
import { requireSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "../../auth";
import { roleLabels } from "../../permissions";
import { Button, Card, StatusBadge } from "../../components/ops-ui";
import {
  defaultRbacGrantRows,
  listRbacConfiguration,
  replaceRbacRolePermissions,
  type RbacConfiguration,
  type RbacPermissionRecord,
  type RbacRolePermissionGrant,
} from "./rbac-service";

const grantSeparator = "::";

function grantKey(roleCode: string, permissionKey: string) {
  return `${roleCode}${grantSeparator}${permissionKey}`;
}

function parseGrantKey(value: string): RbacRolePermissionGrant {
  const [roleCode, permissionKey] = value.split(grantSeparator);
  return { roleCode, permissionKey };
}

function countRoleGrants(roleCode: string, draftGrantKeys: Set<string>) {
  return Array.from(draftGrantKeys).filter((key) => key.startsWith(`${roleCode}${grantSeparator}`)).length;
}

function permissionGroupLabel(permissionType: RbacPermissionRecord["permissionType"]) {
  return permissionType === "route" ? "Routes" : "Actions";
}

export function RoleAccessManager() {
  const { currentUser, canDo, refreshAccessPolicy } = useAuth();
  const [configuration, setConfiguration] = useState<RbacConfiguration | null>(null);
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>("super_admin");
  const [draftGrantKeys, setDraftGrantKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManageRoleAccess = canDo("manageRoleAccess");

  const loadConfiguration = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const nextConfiguration = await listRbacConfiguration(requireSupabaseBrowserClient());
      const nextDraftGrantKeys = new Set(
        nextConfiguration.grants.map((grant) => grantKey(grant.roleCode, grant.permissionKey))
      );

      nextConfiguration.permissions.forEach((permission) => {
        nextDraftGrantKeys.add(grantKey("super_admin", permission.permissionKey));
      });

      setConfiguration(nextConfiguration);
      setDraftGrantKeys(nextDraftGrantKeys);
      setSelectedRoleCode((current) => {
        if (nextConfiguration.roles.some((role) => role.roleCode === current)) {
          return current;
        }
        if (nextConfiguration.roles.some((role) => role.roleCode === currentUser.role)) {
          return currentUser.role;
        }
        return nextConfiguration.roles[0]?.roleCode || "super_admin";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfiguration();
  }, []);

  const activeRoles = useMemo(
    () => configuration?.roles.filter((role) => role.isActive) || [],
    [configuration]
  );

  const permissionGroups = useMemo(() => {
    const activePermissions = configuration?.permissions.filter((permission) => permission.isActive) || [];
    return {
      route: activePermissions.filter((permission) => permission.permissionType === "route"),
      action: activePermissions.filter((permission) => permission.permissionType === "action"),
    };
  }, [configuration]);

  const selectedRole = activeRoles.find((role) => role.roleCode === selectedRoleCode) || activeRoles[0];
  const selectedRoleIsProtected = selectedRole?.roleCode === "super_admin";
  const selectedRoleGrantCount = selectedRole
    ? selectedRoleIsProtected
      ? configuration?.permissions.filter((permission) => permission.isActive).length || 0
      : countRoleGrants(selectedRole.roleCode, draftGrantKeys)
    : 0;

  const toggleGrant = (permissionKey: string, checked: boolean) => {
    if (!selectedRole || selectedRoleIsProtected || !canManageRoleAccess) {
      return;
    }

    setDraftGrantKeys((current) => {
      const next = new Set(current);
      const key = grantKey(selectedRole.roleCode, permissionKey);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const resetSelectedRole = () => {
    if (!selectedRole || selectedRoleIsProtected || !canManageRoleAccess) {
      return;
    }

    const defaultKeys = new Set(defaultRbacGrantRows().map((grant) => grantKey(grant.roleCode, grant.permissionKey)));
    setDraftGrantKeys((current) => {
      const next = new Set(
        Array.from(current).filter((key) => !key.startsWith(`${selectedRole.roleCode}${grantSeparator}`))
      );
      defaultKeys.forEach((key) => {
        if (key.startsWith(`${selectedRole.roleCode}${grantSeparator}`)) {
          next.add(key);
        }
      });
      return next;
    });
    setMessage(`${selectedRole.label} reset to the default access template.`);
  };

  const saveConfiguration = async () => {
    if (!configuration || !canManageRoleAccess) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const activeRoleCodes = new Set(configuration.roles.filter((role) => role.isActive).map((role) => role.roleCode));
    const activePermissionKeys = new Set(
      configuration.permissions.filter((permission) => permission.isActive).map((permission) => permission.permissionKey)
    );
    const protectedSuperAdminKeys = configuration.permissions
      .filter((permission) => permission.isActive)
      .map((permission) => grantKey("super_admin", permission.permissionKey));
    const finalGrantKeys = new Set([...draftGrantKeys, ...protectedSuperAdminKeys]);
    const grants = Array.from(finalGrantKeys)
      .map(parseGrantKey)
      .filter(
        (grant) =>
          activeRoleCodes.has(grant.roleCode) &&
          activePermissionKeys.has(grant.permissionKey) &&
          (grant.permissionKey !== "action.manageRoleAccess" || grant.roleCode === "super_admin")
      );

    try {
      await replaceRbacRolePermissions(requireSupabaseBrowserClient(), grants);
      await refreshAccessPolicy();
      setMessage("Role access saved.");
      await loadConfiguration();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Role Access Management"
      subtitle="Modular RBAC controls backed by Supabase roles, permissions, and grants."
      actions={
        canManageRoleAccess ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button tone="ghost" onClick={() => void loadConfiguration()} disabled={loading || saving}>
              <RefreshCcw size={15} />
              Reload
            </Button>
            <Button tone="primary" onClick={() => void saveConfiguration()} disabled={loading || saving}>
              <Save size={15} />
              {saving ? "Saving" : "Save Access"}
            </Button>
          </div>
        ) : (
          <StatusBadge label="Super Admin Only" tone="warning" />
        )
      }
    >
      {loading ? <div className="ops-row-subtitle">Loading role access...</div> : null}
      {error ? (
        <div className="ops-alert-banner tone-danger" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="ops-alert-banner tone-info" style={{ marginBottom: 16 }}>
          {message}
        </div>
      ) : null}

      {configuration && selectedRole ? (
        <div className="ops-grid cols-2">
          <div className="ops-list">
            {activeRoles.map((role) => {
              const isSelected = role.roleCode === selectedRole.roleCode;
              return (
                <button
                  key={role.roleCode}
                  type="button"
                  className="ops-list-item"
                  onClick={() => setSelectedRoleCode(role.roleCode)}
                  style={{
                    width: "100%",
                    font: "inherit",
                    color: "inherit",
                    textAlign: "left",
                    borderColor: isSelected ? "var(--ops-primary)" : undefined,
                    background: isSelected ? "var(--ops-primary-soft)" : undefined,
                  }}
                >
                  <div className="ops-item-header">
                    <div>
                      <div className="ops-item-title">
                        {role.label || roleLabels[role.roleCode as keyof typeof roleLabels] || role.roleCode}
                      </div>
                      <div className="ops-row-subtitle">{role.roleCode}</div>
                    </div>
                    <StatusBadge
                      label={`${countRoleGrants(role.roleCode, draftGrantKeys)} grants`}
                      tone={role.roleCode === currentUser.role ? "info" : "neutral"}
                    />
                  </div>
                  <div className="ops-item-description">{role.description}</div>
                </button>
              );
            })}
          </div>

          <div>
            <div className="ops-item-header" style={{ marginBottom: 14 }}>
              <div>
                <div className="ops-card-title">{selectedRole.label}</div>
                <div className="ops-card-subtitle">{selectedRoleGrantCount} active grants</div>
              </div>
              {selectedRoleIsProtected ? (
                <StatusBadge label="Protected" tone="violet" />
              ) : canManageRoleAccess ? (
                <Button tone="ghost" onClick={resetSelectedRole}>
                  <ShieldCheck size={15} />
                  Reset Role
                </Button>
              ) : null}
            </div>

            {(["route", "action"] as const).map((permissionType) => (
              <div key={permissionType} style={{ marginBottom: 18 }}>
                <div className="ops-row-title" style={{ marginBottom: 8 }}>
                  {permissionGroupLabel(permissionType)}
                </div>
                <div className="ops-list">
                  {permissionGroups[permissionType].map((permission) => {
                    const protectedSuperAdminOnly = permission.permissionKey === "action.manageRoleAccess";
                    const checked =
                      selectedRoleIsProtected ||
                      (!protectedSuperAdminOnly &&
                        draftGrantKeys.has(grantKey(selectedRole.roleCode, permission.permissionKey)));
                    const disabled =
                      selectedRoleIsProtected || protectedSuperAdminOnly || !canManageRoleAccess || saving;

                    return (
                      <label
                        key={permission.permissionKey}
                        className="ops-list-item"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "24px minmax(0, 1fr)",
                          gap: 12,
                          alignItems: "start",
                          cursor: disabled ? "default" : "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => toggleGrant(permission.permissionKey, event.target.checked)}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          <span className="ops-item-title">{permission.label}</span>
                          <span className="ops-row-subtitle" style={{ display: "block" }}>
                            {permission.permissionKey}
                          </span>
                          <span className="ops-item-description" style={{ display: "block" }}>
                            {permission.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
