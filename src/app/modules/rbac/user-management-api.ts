import { backendJsonRequest } from "@/lib/backend/client";
import type { UserRole } from "../../types";

export type ManagedUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  emailConfirmedAt?: string | null;
  lastSignInAt?: string | null;
  createdAt?: string | null;
};

export type ManagedUserCreateInput = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
};

export type ManagedUserUpdateInput = {
  fullName: string;
  role: UserRole;
  password?: string;
};

export function listManagedUsers() {
  return backendJsonRequest<ManagedUser[]>("/api/rbac/users");
}

export function createManagedUser(input: ManagedUserCreateInput) {
  return backendJsonRequest<ManagedUser>("/api/rbac/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateManagedUser(userId: string, input: ManagedUserUpdateInput) {
  return backendJsonRequest<ManagedUser>(`/api/rbac/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
