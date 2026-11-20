/** Attendance contracts (sprint 3). */

export const ATTENDANCE_STATUSES = ['P', 'A', 'L'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { P: 'Present', A: 'Absent', L: 'Leave' };

/** A class the caller may take attendance for, with today's register state. */
export interface MarkableClass {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  isMyClass: boolean;
  submittedToday: boolean;
}

export interface RegisterEntry {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  /** null when this day hasn't been marked yet */
  status: AttendanceStatus | null;
  /** Attendance % over the academic year so far (null if no days marked). */
  percent: number | null;
}

export interface RegisterDto {
  classId: string;
  className: string;
  date: string;
  /** e.g. "Sunday is not a working day for this branch" — marking is refused. */
  notWorkingDay: string | null;
  submitted: { by: string | null; at: string } | null;
  /** Whether the caller may save this register (date window, role). */
  canEdit: boolean;
  editNote: string | null;
  entries: RegisterEntry[];
}

export interface RegisterSaveInput {
  classId: string;
  date: string;
  entries: { studentId: string; status: AttendanceStatus }[];
}

export interface RegisterSaveResult {
  saved: number;
  present: number;
  absent: number;
  leave: number;
  /** Guardians newly alerted about an absence on this date. */
  alertsSent: number;
}

export interface ClassAttendanceRow {
  classId: string;
  className: string;
  branchName: string;
  strength: number;
  /** % present over the period */
  average: number | null;
  /** Last 5 marked days, oldest first: % present */
  recent: { date: string; percent: number }[];
  belowThreshold: number;
  submittedToday: boolean;
}

export interface AtRiskStudent {
  studentId: string;
  name: string;
  className: string;
  branchName: string;
  percent: number;
  threshold: number;
}

export interface AttendanceOverview {
  date: string;
  from: string;
  classes: ClassAttendanceRow[];
  atRisk: AtRiskStudent[];
  pendingToday: number;
  todayPresentPercent: number | null;
}

export interface StudentAttendanceDto {
  studentId: string;
  name: string;
  className: string | null;
  from: string;
  to: string;
  threshold: number;
  percent: number | null;
  counts: Record<AttendanceStatus, number>;
  days: { date: string; status: AttendanceStatus }[];
}
