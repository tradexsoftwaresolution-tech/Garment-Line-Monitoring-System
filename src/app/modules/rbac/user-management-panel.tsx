import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Save, UserPlus } from "lucide-react";
import { USER_ROLES } from "@/types/pipeline";
import { useAuth } from "../../auth";
import { roleLabels } from "../../permissions";
import { Button, Card, StatusBadge, formatDateTime } from "../../components/ops-ui";
import type { UserRole } from "../../types";
import {
  createManagedUser,
  listManagedUsers,
  updateManagedUser,
  type ManagedUser,
} from "./user-management-api";

const initialCreateForm = {
  fullName: "",
  email: "",
  password: "",
  role: "viewer" as UserRole,
};

function initialEditForm(user: ManagedUser | null) {
  return {
    fullName: user?.fullName || "",
    role: user?.role || ("viewer" as UserRole),
    password: "",
  };
}

export function UserManagementPanel() {
  const { currentUser, canDo } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [editForm, setEditForm] = useState(initialEditForm(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManageUsers = canDo("manageRoleAccess");
  const selectedUser = users.find((user) => user.id === selectedUserId) || users[0] || null;

  const loadUsers = async () => {
    if (!canManageUsers) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const nextUsers = await listManagedUsers();
      setUsers(nextUsers);
      setSelectedUserId((current) => {
        if (current && nextUsers.some((user) => user.id === current)) {
          return current;
        }
        return nextUsers[0]?.id || null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [canManageUsers]);

  useEffect(() => {
    setEditForm(initialEditForm(selectedUser));
  }, [selectedUser?.id]);

  const roleCounts = useMemo(() => {
    const counts = new Map<UserRole, number>();
    users.forEach((user) => counts.set(user.role, (counts.get(user.role) || 0) + 1));
    return counts;
  }, [users]);

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const createdUser = await createManagedUser(createForm);
      setCreateForm(initialCreateForm);
      setMessage(`${createdUser.fullName} created.`);
      await loadUsers();
      setSelectedUserId(createdUser.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updatedUser = await updateManagedUser(selectedUser.id, {
        fullName: editForm.fullName,
        role: editForm.role,
        password: editForm.password.trim() || undefined,
      });
      setMessage(`${updatedUser.fullName} updated.`);
      await loadUsers();
      setSelectedUserId(updatedUser.id);
      setEditForm((current) => ({ ...current, password: "" }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="User Management"
      subtitle="Create accounts, reset passwords, and assign application roles."
      actions={
        canManageUsers ? (
          <Button tone="ghost" onClick={() => void loadUsers()} disabled={loading || saving}>
            <RefreshCcw size={15} />
            Reload
          </Button>
        ) : (
          <StatusBadge label="Super Admin Only" tone="warning" />
        )
      }
    >
      {loading ? <div className="ops-row-subtitle">Loading users...</div> : null}
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

      {canManageUsers ? (
        <div className="ops-grid cols-2">
          <div>
            <div className="ops-row-title" style={{ marginBottom: 10 }}>
              New User
            </div>
            <div className="ops-grid cols-2">
              <label>
                <span className="ops-filter-label">Full Name</span>
                <input
                  className="ops-input"
                  value={createForm.fullName}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                  placeholder="Full name"
                />
              </label>
              <label>
                <span className="ops-filter-label">Role</span>
                <select
                  className="ops-input"
                  value={createForm.role}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      role: event.target.value as UserRole,
                    }))
                  }
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="ops-filter-label">Email</span>
                <input
                  className="ops-input"
                  type="email"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="name@company.com"
                  autoComplete="off"
                />
              </label>
              <label>
                <span className="ops-filter-label">Password</span>
                <input
                  className="ops-input"
                  type="password"
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div style={{ marginTop: 14 }}>
              <Button tone="primary" onClick={() => void handleCreate()} disabled={saving}>
                <UserPlus size={15} />
                Create User
              </Button>
            </div>

            <div className="ops-card-divider" />

            <div className="ops-row-title" style={{ marginBottom: 10 }}>
              Role Count
            </div>
            <div className="ops-meta-grid">
              {USER_ROLES.map((role) => (
                <div key={role} className="ops-key-value">
                  <div className="ops-key-value-label">{roleLabels[role]}</div>
                  <div className="ops-key-value-value">{roleCounts.get(role) || 0}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="ops-row-title" style={{ marginBottom: 10 }}>
              Existing Users
            </div>
            <div className="ops-list" style={{ marginBottom: 16 }}>
              {users.map((user) => {
                const selected = user.id === selectedUser?.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    className="ops-list-item"
                    onClick={() => setSelectedUserId(user.id)}
                    style={{
                      width: "100%",
                      font: "inherit",
                      color: "inherit",
                      textAlign: "left",
                      borderColor: selected ? "var(--ops-primary)" : undefined,
                      background: selected ? "var(--ops-primary-soft)" : undefined,
                    }}
                  >
                    <div className="ops-item-header">
                      <div>
                        <div className="ops-item-title">{user.fullName}</div>
                        <div className="ops-row-subtitle">{user.email || "No email"}</div>
                      </div>
                      <StatusBadge
                        label={roleLabels[user.role] || user.role}
                        tone={user.id === currentUser.id ? "info" : "neutral"}
                      />
                    </div>
                    <div className="ops-item-description">
                      Last sign in: {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "Not captured"}
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedUser ? (
              <div>
                <div className="ops-row-title" style={{ marginBottom: 10 }}>
                  Edit User
                </div>
                <div className="ops-grid cols-2">
                  <label>
                    <span className="ops-filter-label">Full Name</span>
                    <input
                      className="ops-input"
                      value={editForm.fullName}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, fullName: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    <span className="ops-filter-label">Role</span>
                    <select
                      className="ops-input"
                      value={editForm.role}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          role: event.target.value as UserRole,
                        }))
                      }
                    >
                      {USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {roleLabels[role]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    <span className="ops-filter-label">New Password</span>
                    <input
                      className="ops-input"
                      type="password"
                      value={editForm.password}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="Leave blank to keep current password"
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <div style={{ marginTop: 14 }}>
                  <Button tone="primary" onClick={() => void handleUpdate()} disabled={saving}>
                    <Save size={15} />
                    Save User
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="ops-row-subtitle">Only a super admin can manage user accounts.</div>
      )}
    </Card>
  );
}
