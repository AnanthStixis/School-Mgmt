import type {
  AuthResponse,
  DevOutcome,
  PaymentAttemptDto,
  ReceiptDto,
  ReceiptListItem,
  SessionUser,
  StartPaymentDto,
  StudentAttendanceDto,
  StudentFeesDto,
  StudentLoginStatus,
} from '@sms/shared';
import { API_URL } from './config';
import { storage } from './storage';

/**
 * API client for the app. Like the web app, but the server returns the refresh token in the body
 * (header x-client: mobile) and the app keeps it in secure storage. The access token (15 minutes)
 * lives in memory; on a 401 the session is refreshed once and the request retried.
 */
const REFRESH_KEY = 'sms_refresh_token';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSession: (u: SessionUser | null) => void = () => {};
export const setSessionListener = (fn: (u: SessionUser | null) => void) => (onSession = fn);

async function raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        'x-client': 'mobile',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the school's server. Check your internet connection and try again.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const m = data?.message;
    throw new ApiError(res.status, Array.isArray(m) ? m.join('. ') : m || `Something went wrong (${res.status})`);
  }
  return data as T;
}

async function setSession(r: AuthResponse | null): Promise<void> {
  accessToken = r?.accessToken ?? null;
  if (r?.refreshToken) await storage.set(REFRESH_KEY, r.refreshToken);
  if (!r) await storage.remove(REFRESH_KEY);
  onSession(r?.user ?? null);
}

let refreshing: Promise<AuthResponse | null> | null = null;
/** Restores or renews the session from the stored refresh token. Parallel callers share one request (the token rotates). */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    const refreshToken = await storage.get(REFRESH_KEY);
    if (!refreshToken) {
      await setSession(null);
      return null;
    }
    try {
      const r = await raw<AuthResponse>('POST', '/auth/refresh', { refreshToken }, false);
      await setSession(r);
      return r;
    } catch (e) {
      // Only a rejected token signs the parent out; no network keeps them signed in for later.
      if (e instanceof ApiError && e.status === 401) await setSession(null);
      else throw e;
      return null;
    }
  })().finally(() => (refreshing = null));
  return refreshing;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && (await refreshSession())) return raw<T>(method, path, body);
    throw e;
  }
}

export interface Child {
  id: string;
  name: string;
  className: string | null;
}

export const api = {
  requestOtp: (phone: string) => raw<{ message: string }>('POST', '/auth/otp/request', { phone }, false),
  verifyOtp: async (phone: string, code: string) => setSession(await raw<AuthResponse>('POST', '/auth/otp/verify', { phone, code }, false)),
  logout: async () => {
    const refreshToken = await storage.get(REFRESH_KEY);
    try {
      if (refreshToken) await raw('POST', '/auth/logout', { refreshToken }, false);
    } finally {
      await setSession(null);
    }
  },

  children: () => call<Child[]>('GET', '/attendance/mine'),
  fees: (studentId: string) => call<StudentFeesDto>('GET', `/fees/students/${studentId}`),
  attendance: (studentId: string) => call<StudentAttendanceDto>('GET', `/attendance/students/${studentId}`),
  receipts: (studentId: string) => call<ReceiptListItem[]>('GET', `/fees/students/${studentId}/receipts`),
  receipt: (id: string) => call<ReceiptDto>('GET', `/fees/receipts/${id}`),

  startPayment: (studentId: string, invoiceIds: string[]) => call<StartPaymentDto>('POST', '/payments/online', { studentId, invoiceIds }),
  payment: (orderId: string) => call<PaymentAttemptDto>('GET', `/payments/online/${encodeURIComponent(orderId)}`),
  devCompletePayment: (orderId: string, outcome: DevOutcome, mode: string) => call<PaymentAttemptDto>('POST', `/payments/dev/${encodeURIComponent(orderId)}/complete`, { outcome, mode }),

  childLogins: () => call<StudentLoginStatus[]>('GET', '/student-logins/mine'),
  setChildPassword: (studentId: string, password: string) => call<StudentLoginStatus>('PUT', `/student-logins/${studentId}`, { password }),
  disableChildLogin: (studentId: string) => call<StudentLoginStatus>('DELETE', `/student-logins/${studentId}`),
};
