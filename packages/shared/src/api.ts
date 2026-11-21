import type { Role } from './roles';

/** API contracts shared by the server and its clients. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  db: 'up' | 'down';
  time: string;
}

export interface BranchDto {
  id: string;
  code: string;
  name: string;
  board: string;
  color: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  title: string;
  /** null only for the Stixis platform admin */
  tenantId: string | null;
  /** null = all branches of the tenant (group director / platform admin) */
  branchId: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface OtpRequest {
  phone: string;
}

export interface OtpVerifyRequest {
  phone: string;
  code: string;
}

/** Students sign in with their login ID (the admission number) and a password set by a parent or the school. */
export interface StudentLoginRequest {
  loginId: string;
  password: string;
}

export const STUDENT_PASSWORD_MIN = 8;
/** After this many wrong passwords the account is locked for LOGIN_LOCK_MINUTES. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

/** A student's sign-in, as shown to their parent or the school office. */
export interface StudentLoginStatus {
  studentId: string;
  studentName: string;
  className: string | null;
  /** The ID the student types to sign in; null until a password has been set once. */
  loginId: string | null;
  enabled: boolean;
  lastLoginAt: string | null;
}

export interface SetStudentPasswordRequest {
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: SessionUser;
  /** Only returned to mobile clients (header `x-client: mobile`); web uses an httpOnly cookie. */
  refreshToken?: string;
}

export interface AcademicYearDto {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  current: boolean;
  locked: boolean;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}
