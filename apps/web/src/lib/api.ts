import type {
  AcademicYearDto,
  ApiError,
  AuthResponse,
  BranchDetailDto,
  BranchDto,
  BranchInput,
  ClassBulkInput,
  ClassDto,
  ClassUpdateInput,
  HealthResponse,
  ImportResult,
  Paged,
  StaffDto,
  StaffInput,
  StudentDto,
  StudentInput,
  StudentListItem,
  SubjectDto,
} from '@sms/shared';

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

async function raw<T>(method: string, path: string, body?: unknown, auth = true, asText = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  if (res.ok && asText) return (await res.text()) as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data as ApiError | null;
    const msg = Array.isArray(e?.message) ? e.message.join('; ') : (e?.message ?? res.statusText);
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

async function call<T>(method: string, path: string, body?: unknown, asText = false): Promise<T> {
  try {
    return await raw<T>(method, path, body, true, asText);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && (await refreshSession())) return raw<T>(method, path, body, true, asText);
    throw e;
  }
}

/** Builds ?a=1&b=2, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + new URLSearchParams(p.map(([k, v]) => [k, String(v)])).toString() : '';
}

/** Saves text as a file in the browser (used for CSV templates). */
export function saveText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  health: () => raw<HealthResponse>('GET', '/health', undefined, false),
  academicYears: () => call<AcademicYearDto[]>('GET', '/academic-years'),

  branches: () => call<BranchDto[]>('GET', '/branches'),
  branchDetails: () => call<BranchDetailDto[]>('GET', '/branches/details'),
  createBranch: (b: BranchInput) => call<BranchDetailDto>('POST', '/branches', b),
  updateBranch: (id: string, b: Partial<BranchInput>) => call<BranchDetailDto>('PATCH', `/branches/${id}`, b),

  classes: (branchId?: string) => call<ClassDto[]>('GET', `/classes${qs({ branchId })}`),
  createClasses: (b: ClassBulkInput) => call<{ created: ClassDto[]; skipped: string[] }>('POST', '/classes/bulk', b),
  updateClass: (id: string, b: ClassUpdateInput) => call<ClassDto>('PATCH', `/classes/${id}`, b),
  deleteClass: (id: string) => call<void>('DELETE', `/classes/${id}`),

  subjects: (branchId?: string) => call<SubjectDto[]>('GET', `/subjects${qs({ branchId })}`),
  createSubject: (b: Omit<SubjectDto, 'id'>) => call<SubjectDto>('POST', '/subjects', b),
  updateSubject: (id: string, b: Partial<SubjectDto>) => call<SubjectDto>('PATCH', `/subjects/${id}`, b),

  staff: (p: { branchId?: string; q?: string; status?: string }) => call<StaffDto[]>('GET', `/staff${qs(p)}`),
  createStaff: (b: StaffInput) => call<StaffDto>('POST', '/staff', b),
  updateStaff: (id: string, b: Partial<StaffInput>) => call<StaffDto>('PATCH', `/staff/${id}`, b),

  students: (p: { branchId?: string; classId?: string; status?: string; q?: string; page?: number; pageSize?: number }) =>
    call<Paged<StudentListItem>>('GET', `/students${qs(p)}`),
  student: (id: string) => call<StudentDto>('GET', `/students/${id}`),
  createStudent: (b: StudentInput) => call<StudentDto>('POST', '/students', b),
  updateStudent: (id: string, b: Partial<StudentInput>) => call<StudentDto>('PATCH', `/students/${id}`, b),

  importTemplate: (kind: 'students' | 'staff') => call<string>('GET', `/imports/${kind}/template`, undefined, true),
  importCsv: (kind: 'students' | 'staff', branchId: string, csv: string, dryRun: boolean) => call<ImportResult>('POST', `/imports/${kind}`, { branchId, csv, dryRun }),

  login: (email: string, password: string) => raw<AuthResponse>('POST', '/auth/login', { email, password }, false),
  requestOtp: (phone: string) => raw<{ message: string }>('POST', '/auth/otp/request', { phone }, false),
  verifyOtp: (phone: string, code: string) => raw<AuthResponse>('POST', '/auth/otp/verify', { phone, code }, false),
  logout: () => raw<void>('POST', '/auth/logout', {}, false),
};
