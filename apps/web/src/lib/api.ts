import type { AcademicYearDto, ApiError, AuthResponse, BranchDto, HealthResponse } from '@sms/shared';

/**
 * API client. The access token lives in memory only; the refresh token is an httpOnly
 * cookie the browser sends to /api/auth/* by itself. On a 401 we refresh once and retry.
 */
let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let onSessionChange: (s: AuthResponse | null) => void = () => {};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function setSessionListener(fn: (s: AuthResponse | null) => void) {
  onSessionChange = fn;
}

export function setSession(s: AuthResponse | null) {
  accessToken = s?.accessToken ?? null;
  onSessionChange(s);
}

async function raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data as ApiError | null;
    const msg = Array.isArray(e?.message) ? e.message.join(', ') : (e?.message ?? res.statusText);
    throw new HttpError(res.status, msg);
  }
  return data as T;
}

/**
 * Exchanges the refresh cookie for a new session. Concurrent callers share one request:
 * the server rotates the token, so a second parallel refresh would look like token theft.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= raw<AuthResponse>('POST', '/auth/refresh', undefined, false)
    .then((s) => {
      setSession(s);
      return s;
    })
    .catch(() => {
      setSession(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && (await refreshSession())) return raw<T>(method, path, body);
    throw e;
  }
}

export const api = {
  health: () => raw<HealthResponse>('GET', '/health', undefined, false),
  branches: () => call<BranchDto[]>('GET', '/branches'),
  academicYears: () => call<AcademicYearDto[]>('GET', '/academic-years'),

  login: (email: string, password: string) => raw<AuthResponse>('POST', '/auth/login', { email, password }, false),
  requestOtp: (phone: string) => raw<{ message: string }>('POST', '/auth/otp/request', { phone }, false),
  verifyOtp: (phone: string, code: string) => raw<AuthResponse>('POST', '/auth/otp/verify', { phone, code }, false),
  logout: () => raw<void>('POST', '/auth/logout', {}, false),
};
