/** Typed client for the Timeblock sync server (`server/`). */
import type { SyncChange } from "@/data/syncLocal";
import { getPlatform } from "@/platform";

export type ApiErrorCode =
  | "invalid_username"
  | "weak_password"
  | "username_taken"
  | "bad_credentials"
  | "rate_limited"
  | "unauthorized"
  | "bad_request"
  | "network"
  | "server";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AuthResult {
  token: string;
  username: string;
}

export interface SyncRequest {
  since: number;
  changes: SyncChange[];
  replace?: boolean;
}

export interface SyncResponse {
  seq: number;
  changes: SyncChange[];
}

const FRIENDLY: Partial<Record<ApiErrorCode, string>> = {
  bad_credentials: "Wrong username or password.",
  username_taken: "That username is taken.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  unauthorized: "You were signed out. Sign in again.",
};

/** Trims and drops a trailing slash so `${base}/api/…` is well formed. */
export function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function call<T>(
  server: string,
  path: string,
  opts: { method?: "GET" | "POST" | "DELETE"; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const platform = await getPlatform();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await platform.request(`${normalizeServer(server)}${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    // Tauri's HTTP plugin rejects with plain strings, not Errors.
    const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    throw new ApiError("network", `Couldn't reach the sync server${detail ? ` (${detail})` : ""}.`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const body = (json ?? {}) as { error?: string; message?: string };
    const fallback = res.status === 401 ? "unauthorized" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "server" : "bad_request";
    const code = (body.error ?? fallback) as ApiErrorCode;
    throw new ApiError(code, FRIENDLY[code] ?? body.message ?? `The sync server answered ${res.status}.`, res.status);
  }
  if (json === null) throw new ApiError("server", "The sync server sent an unreadable answer.", res.status);
  return json as T;
}

export const api = {
  signup: (server: string, username: string, password: string, device: string) =>
    call<AuthResult>(server, "/api/signup", { body: { username, password, device } }),
  login: (server: string, username: string, password: string, device: string) =>
    call<AuthResult>(server, "/api/login", { body: { username, password, device } }),
  logout: (server: string, token: string) => call<object>(server, "/api/logout", { body: {}, token }),
  logoutAll: (server: string, token: string) => call<object>(server, "/api/logout-all", { body: {}, token }),
  changePassword: (server: string, token: string, oldPassword: string, newPassword: string) =>
    call<{ token: string }>(server, "/api/password", {
      body: { old_password: oldPassword, new_password: newPassword },
      token,
    }),
  deleteAccount: (server: string, token: string, password: string) =>
    call<object>(server, "/api/account", { method: "DELETE", body: { password }, token }),
  sync: (server: string, token: string, req: SyncRequest) => call<SyncResponse>(server, "/api/sync", { body: req, token }),
};
