import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isBackendConfigured } from "@/lib/backend/env";
import { listActiveAppUsersFromBackend } from "@/lib/backend/pipeline-api";
import { canAccessRoute, canPerform, type AppAction, type AppRouteKey } from "./permissions";
import {
  buildRbacAccessMatrix,
  listRbacConfiguration,
  type RbacAccessMatrix,
} from "./modules/rbac/rbac-service";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import type { AppUser, UserRole } from "./types";
import { listActiveAppUsers } from "@/server/operations/operations-service";

type AuthMode = "supabase";

type AuthContextValue = {
  mode: AuthMode;
  isConfigured: boolean;
  users: AppUser[];
  currentUser: AppUser;
  session: Session | null;
  isAuthenticated: boolean;
  loading: boolean;
  setCurrentUserId: (userId: string) => void;
  canAccess: (routeKey: AppRouteKey) => boolean;
  canDo: (action: AppAction) => boolean;
  refreshAccessPolicy: () => Promise<void>;
  signInWithPassword: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; message: string }>;
  signUp: (
    fullName: string,
    email: string,
    password: string
  ) => Promise<{ ok: boolean; message: string; requiresEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ROLE_TITLES: Record<UserRole, string> = {
  super_admin: "Platform Super Administrator",
  admin: "Factory Systems Administrator",
  supervisor: "Floor Supervisor",
  hr: "HR Operations Lead",
  ie: "Industrial Engineering Planner",
  viewer: "Management Read-Only",
};

const ROLE_DEPARTMENTS: Record<UserRole, string> = {
  super_admin: "Platform Administration",
  admin: "Operations",
  supervisor: "Production",
  hr: "Human Resources",
  ie: "Industrial Engineering",
  viewer: "Management",
};

const unauthenticatedSupabaseUser: AppUser = {
  id: "supabase-guest",
  name: "Sign in required",
  role: "viewer",
  title: "Unauthenticated Session",
  department: "Security",
  initials: "SI",
};

const AUTH_BOOTSTRAP_TIMEOUT_MS = 4000;
const SUPABASE_AUTH_UNAVAILABLE_MESSAGE =
  "Supabase authentication is unreachable. Start Docker Desktop, run `npx supabase start`, and refresh the app before signing in.";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatSupabaseAuthError(error: unknown) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "Authentication failed.";

  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("load failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network request failed") ||
    normalized.includes("fetch")
  ) {
    return SUPABASE_AUTH_UNAVAILABLE_MESSAGE;
  }

  return message.trim() || "Authentication failed.";
}

function mapProfileToUser(
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null,
  user: User | null
): AppUser {
  const email = user?.email || "";
  const metadataName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    email.split("@")[0];
  const role = (profile?.role || "viewer") as UserRole;
  const name = profile?.full_name || metadataName || "Supabase User";

  return {
    id: user?.id || unauthenticatedSupabaseUser.id,
    name,
    role,
    title: ROLE_TITLES[role],
    department: ROLE_DEPARTMENTS[role],
    initials: getInitials(name || "SU"),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabaseClient = getSupabaseBrowserClient();
  const isConfigured = isSupabaseConfigured() && Boolean(supabaseClient);
  const mode: AuthMode = "supabase";

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Database["public"]["Tables"]["profiles"]["Row"] | null>(
    null
  );
  const [users, setUsers] = useState<AppUser[]>([]);
  const [accessMatrix, setAccessMatrix] = useState<RbacAccessMatrix | null>(null);
  const [loading, setLoading] = useState(isConfigured);
  const profileLoadedForUserIdRef = useRef<string | null>(null);

  const loadAccessMatrix = useCallback(async () => {
    if (!supabaseClient) {
      return null;
    }

    try {
      return buildRbacAccessMatrix(await listRbacConfiguration(supabaseClient));
    } catch (_error) {
      return null;
    }
  }, [supabaseClient]);

  useEffect(() => {
    if (!supabaseClient) {
      setLoading(false);
      setUsers([]);
      setAccessMatrix(null);
      return undefined;
    }

    let disposed = false;
    let bootstrapTimer = window.setTimeout(() => {
      if (disposed) {
        return;
      }

      setSession(null);
      setProfile(null);
      setUsers([]);
      setLoading(false);
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    const clearBootstrapTimer = () => {
      window.clearTimeout(bootstrapTimer);
    };

    const syncSession = async (
      nextSession: Session | null,
      options: { forceProfileReload?: boolean } = {}
    ) => {
      if (disposed) {
        return;
      }

      clearBootstrapTimer();
      setSession(nextSession);

      if (!nextSession?.user) {
        profileLoadedForUserIdRef.current = null;
        setProfile(null);
        setUsers([]);
        setAccessMatrix(null);
        setLoading(false);
        return;
      }

      const nextUserId = nextSession.user.id;

      if (!options.forceProfileReload && profileLoadedForUserIdRef.current === nextUserId) {
        setLoading(false);
        return;
      }

      if (profileLoadedForUserIdRef.current !== nextUserId) {
        setProfile(null);
        setUsers([]);
        setAccessMatrix(null);
      }

      setLoading(true);

      const { data, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", nextSession.user.id)
        .single();

      if (disposed) {
        return;
      }

      const nextProfile = error ? null : data;
      const currentUser = mapProfileToUser(nextProfile, nextSession.user);
      const nextAccessMatrix = await loadAccessMatrix();
      setProfile(nextProfile);
      setAccessMatrix(nextAccessMatrix);
      profileLoadedForUserIdRef.current = nextUserId;

      if (["super_admin", "admin", "hr", "supervisor", "ie"].includes(currentUser.role)) {
        try {
          const visibleUsers = isBackendConfigured()
            ? await listActiveAppUsersFromBackend()
            : await listActiveAppUsers(supabaseClient);
          if (!disposed) {
            setUsers(visibleUsers);
          }
        } catch (_error) {
          if (!disposed) {
            setUsers([currentUser]);
          }
        }
      } else {
        setUsers([currentUser]);
      }

      setLoading(false);
    };

    supabaseClient.auth
      .getSession()
      .then(({ data }) => {
        void syncSession(data.session);
      })
      .catch(() => {
        if (disposed) {
          return;
        }

        clearBootstrapTimer();
        setSession(null);
        setProfile(null);
        setUsers([]);
        setAccessMatrix(null);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, nextSession) => {
      if (event === "TOKEN_REFRESHED" && nextSession?.user) {
        clearBootstrapTimer();
        setSession(nextSession);
        setLoading(false);
        return;
      }

      void syncSession(nextSession, { forceProfileReload: event === "USER_UPDATED" });
    });

    return () => {
      disposed = true;
      clearBootstrapTimer();
      subscription.unsubscribe();
    };
  }, [supabaseClient]);

  const currentUser = session?.user
    ? mapProfileToUser(profile, session.user)
    : isConfigured
      ? unauthenticatedSupabaseUser
      : {
          ...unauthenticatedSupabaseUser,
          title: "Supabase Not Configured",
          department: "Configuration",
        };

  const value = useMemo<AuthContextValue>(
    () => ({
      mode,
      isConfigured,
      users,
      currentUser,
      session,
      isAuthenticated: Boolean(session?.user),
      loading,
      setCurrentUserId: () => {},
      canAccess: (routeKey) =>
        Boolean(session?.user) && canAccessRoute(currentUser.role, routeKey, accessMatrix?.routes),
      canDo: (action) =>
        Boolean(session?.user) && canPerform(currentUser.role, action, accessMatrix?.actions),
      refreshAccessPolicy: async () => {
        if (!session?.user) {
          setAccessMatrix(null);
          return;
        }

        setAccessMatrix(await loadAccessMatrix());
      },
      signInWithPassword: async (email, password) => {
        if (!supabaseClient) {
          return {
            ok: false,
            message:
              "Supabase auth is not configured in this environment. Add the Vite Supabase variables first.",
          };
        }

        try {
          const { error } = await supabaseClient.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

          if (error) {
            return { ok: false, message: formatSupabaseAuthError(error) };
          }

          return { ok: true, message: "Signed in successfully." };
        } catch (error) {
          return { ok: false, message: formatSupabaseAuthError(error) };
        }
      },
      signUp: async (fullName, email, password) => {
        if (!supabaseClient) {
          return {
            ok: false,
            message:
              "Supabase auth is not configured in this environment. Add the Vite Supabase variables first.",
          };
        }

        try {
          const { data, error } = await supabaseClient.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                full_name: fullName.trim(),
                role: "viewer",
              },
              emailRedirectTo:
                typeof window !== "undefined" ? window.location.origin : undefined,
            },
          });

          if (error) {
            return { ok: false, message: formatSupabaseAuthError(error) };
          }

          if (data.session) {
            return {
              ok: true,
              message: "Account created and signed in successfully.",
            };
          }

          return {
            ok: true,
            message: "Account created. Confirm the email before signing in.",
            requiresEmailConfirmation: true,
          };
        } catch (error) {
          return { ok: false, message: formatSupabaseAuthError(error) };
        }
      },
      signOut: async () => {
        if (supabaseClient) {
          await supabaseClient.auth.signOut();
        }
      },
    }),
    [accessMatrix, currentUser, isConfigured, loadAccessMatrix, loading, mode, session, supabaseClient, users]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
