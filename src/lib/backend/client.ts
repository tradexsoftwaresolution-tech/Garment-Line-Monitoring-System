import { requireSupabaseBrowserClient } from "@/lib/supabase/client";
import { backendEnv, isBackendConfigured } from "./env";

async function buildHeaders(extraHeaders?: HeadersInit) {
  const client = requireSupabaseBrowserClient();
  const {
    data: { session },
  } = await client.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in again to call the Spring backend.");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    ...extraHeaders,
  };
}

function buildUrl(path: string, params?: Record<string, string | null | undefined>) {
  if (!isBackendConfigured()) {
    throw new Error("VITE_BACKEND_URL is not configured.");
  }

  const url = new URL(`${backendEnv.url}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

export async function backendJsonRequest<T>(
  path: string,
  options: RequestInit = {},
  params?: Record<string, string | null | undefined>
): Promise<T> {
  const headers = await buildHeaders({
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  });

  const response = await fetch(buildUrl(path, params), {
    ...options,
    headers,
  });

  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || response.statusText);
  }

  return response.json() as Promise<T>;
}

export async function backendPublicJsonRequest<T>(
  path: string,
  options: RequestInit = {},
  params?: Record<string, string | null | undefined>
): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || response.statusText);
  }

  return response.json() as Promise<T>;
}

export async function backendFormRequest<T>(
  path: string,
  formData: FormData,
  options: Omit<RequestInit, "body" | "headers"> = {}
): Promise<T> {
  const headers = await buildHeaders();
  const response = await fetch(buildUrl(path), {
    ...options,
    body: formData,
    headers,
  });

  if (!response.ok) {
    const payload = await safeReadJson(response);
    throw new Error(payload?.message || response.statusText);
  }

  return response.json() as Promise<T>;
}

async function safeReadJson(response: Response) {
  try {
    return (await response.json()) as { message?: string };
  } catch (_error) {
    return null;
  }
}
