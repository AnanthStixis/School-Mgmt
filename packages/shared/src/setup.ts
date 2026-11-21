/** Contracts for branches, academic setup, staff and students (sprint 2). */

export interface BranchSettings {
  /** e.g. ["Mon","Tue","Wed","Thu","Fri","Sat"] */
  workingDays?: string[];
  /** "08:30" */
  startsAt?: string;
  /** "15:30" */
  endsAt?: string;
  termsPerYear?: number;
  /** Students below this attendance % are flagged. */
  attendanceThreshold?: number;
  /** Late fee in ₹ per day on an overdue installment (default LATE_FEE_PER_DAY). */
  lateFeePerDay?: number;
}

export interface BranchDetailDto {
  id: string;
  code: string;
  name: string;
  board: string;
  color: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  since: number | null;
  active: boolean;
  settings: BranchSettings;
  /** Module key → enabled. Missing keys mean enabled. */
  modules: Record<string, boolean>;
  counts: { classes: number; students: number; staff: number };
}

export interface BranchInput {
  code: string;
  name: string;
  board: string;
  color?: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  since?: number | null;
  active?: boolean;
  settings?: BranchSettings;
  modules?: Record<string, boolean>;
}

export const SUBJECT_TYPES = ['Core', 'Language', 'Elective', 'Co-scholastic'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export interface SubjectDto {
  id: string;
  branchId: string;
  name: string;
  code: string;
  type: SubjectType;
  active: boolean;
  onReport: boolean;
}

/** Grade numbers: -2 Nursery, -1 LKG, 0 UKG, 1–12. */
export const GRADE_LABEL: Record<number, string> = { [-2]: 'Nursery', [-1]: 'LKG', 0: 'UKG' };
export const gradeLabel = (g: number) => GRADE_LABEL[g] ?? String(g);

export interface ClassDto {
  id: string;
  branchId: string;
  academicYearId: string;
  grade: number;
  section: string;
  name: string;
  room: string | null;
  classTeacher: { id: string; name: string } | null;
  studentCount: number;
}

/** Creates every grade in [fromGrade, toGrade] × sections, skipping ones that exist. */
export interface ClassBulkInput {
  branchId: string;
  academicYearId?: string;
  fromGrade: number;
  toGrade: number;
  sections: string[];
}

export interface ClassUpdateInput {
  name?: string;
  section?: string;
  room?: string | null;
  classTeacherId?: string | null;
}

/** Which kind of login a staff member gets. 'none' = directory entry only. */
export const STAFF_ACCESS = ['none', 'teacher', 'accounts', 'manager'] as const;
export type StaffAccess = (typeof STAFF_ACCESS)[number];

export interface StaffDto {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  role: string;
  subject: string | null;
  email: string | null;
  phone: string | null;
  qualification: string | null;
  status: 'Active' | 'Inactive';
  joinedOn: string | null;
  access: StaffAccess;
  classTeacherOf: string[];
}

export interface StaffInput {
  branchId: string;
  name: string;
  role: string;
  subject?: string | null;
  email?: string | null;
  phone?: string | null;
  qualification?: string | null;
  joinedOn?: string | null;
  status?: 'Active' | 'Inactive';
  access?: StaffAccess;
}

export const STUDENT_STATUSES = ['Active', 'Temporary', 'Left', 'Alumni'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const GUARDIAN_RELATIONS = ['Father', 'Mother', 'Guardian'] as const;

export interface GuardianDto {
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string;
  primary: boolean;
}

export interface GuardianInput {
  name: string;
  phone: string;
  email?: string | null;
  relation: string;
  primary?: boolean;
}

export interface StudentListItem {
  id: string;
  admissionNo: string;
  name: string;
  gender: string | null;
  branchId: string;
  branchName: string;
  classId: string | null;
  className: string | null;
  rollNo: number | null;
  status: StudentStatus;
  primaryGuardian: { name: string; phone: string | null } | null;
}

export interface StudentDto extends StudentListItem {
  dob: string | null;
  bloodGroup: string | null;
  house: string | null;
  address: string | null;
  admittedOn: string | null;
  guardians: GuardianDto[];
  siblings: { id: string; name: string; className: string | null }[];
}

export interface StudentInput {
  branchId: string;
  /** Left blank → generated as <BRANCHCODE>-<year>-<number>. */
  admissionNo?: string | null;
  name: string;
  gender?: string | null;
  dob?: string | null;
  classId?: string | null;
  rollNo?: number | null;
  bloodGroup?: string | null;
  house?: string | null;
  address?: string | null;
  admittedOn?: string | null;
  status?: StudentStatus;
  guardians: GuardianInput[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportRowResult {
  /** 1-based line in the file (header is line 1). */
  line: number;
  data: Record<string, string>;
  errors: string[];
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  /** Only rows with errors in a dry run; empty after a successful import. */
  rows: ImportRowResult[];
  created: number;
  /** Columns in the file that were not recognised and were left out */
  ignoredColumns?: string[];
}

/** Columns of the student import CSV, in template order. */
export const STUDENT_IMPORT_COLUMNS = [
  'admission_no',
  'name',
  'gender',
  'dob',
  'class',
  'roll_no',
  'status',
  'guardian_name',
  'guardian_relation',
  'guardian_phone',
  'guardian_email',
  'guardian2_name',
  'guardian2_relation',
  'guardian2_phone',
  'address',
] as const;

export const STAFF_IMPORT_COLUMNS = ['name', 'role', 'subject', 'email', 'phone', 'qualification', 'joined_on', 'access'] as const;

/** Optional fee-profile columns on the student import (SchoolElement exports these). */
export const STUDENT_PROFILE_COLUMNS = ['admission_type', 'rte', 'section'] as const;

/**
 * Header names seen in SchoolElement exports (and common spreadsheet variants), mapped to our columns.
 * Keys are headers normalised by normaliseHeader().
 */
export const STUDENT_HEADER_ALIASES: Record<string, string> = {
  admission_number: 'admission_no',
  adm_no: 'admission_no',
  admission: 'admission_no',
  student_name: 'name',
  student: 'name',
  name_of_the_student: 'name',
  class_section: 'class',
  class_and_section: 'class',
  class_sec: 'class',
  date_of_birth: 'dob',
  birth_date: 'dob',
  d_o_b: 'dob',
  sex: 'gender',
  roll_number: 'roll_no',
  roll: 'roll_no',
  alpha_roll_no: 'roll_no',
  student_status: 'status',
  fathers_name: 'guardian_name',
  father_name: 'guardian_name',
  parent_name: 'guardian_name',
  father_mobile: 'guardian_phone',
  fathers_mobile: 'guardian_phone',
  father_phone: 'guardian_phone',
  father_mobile_no: 'guardian_phone',
  mobile: 'guardian_phone',
  mobile_no: 'guardian_phone',
  parent_mobile: 'guardian_phone',
  phone: 'guardian_phone',
  father_email: 'guardian_email',
  parent_email: 'guardian_email',
  email: 'guardian_email',
  mothers_name: 'guardian2_name',
  mother_name: 'guardian2_name',
  mother_mobile: 'guardian2_phone',
  mothers_mobile: 'guardian2_phone',
  mother_phone: 'guardian2_phone',
  mother_mobile_no: 'guardian2_phone',
  residential_address: 'address',
  permanent_address: 'address',
  rte_non_rte: 'rte',
  rte_status: 'rte',
  new_admission_or_re_admission: 'admission_type',
};

export const BALANCE_IMPORT_COLUMNS = ['admission_no', 'amount', 'year', 'remarks'] as const;
export const BALANCE_HEADER_ALIASES: Record<string, string> = {
  admission_number: 'admission_no',
  adm_no: 'admission_no',
  previous_balance: 'amount',
  previous_year_balance: 'amount',
  balance: 'amount',
  amount_due: 'amount',
  outstanding: 'amount',
  due: 'amount',
  academic_year: 'year',
  remark: 'remarks',
};

/** "Father's Mobile No." → "fathers_mobile_no" */
export const normaliseHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10', XI: '11', XII: '12' };

/**
 * A comparable form of a class name, so "VIII-A", "8 A", "Class 8 / A" and "8th-A" all match "8-A",
 * and "XI (ISC)" matches "11 ISC".
 */
export function normaliseClassName(v: string): string {
  return v
    .toUpperCase()
    .replace(/\b(CLASS|STD|STANDARD|GRADE)\b\.?/g, ' ')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((t) => ROMAN[t] ?? t.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'))
    .join('-');
}

/** Accepts 2027-03-31, 31-03-2027, 31/03/2027 and 31-Mar-2027 (Indian day-first order). Returns YYYY-MM-DD or null. */
export function parseLooseDate(v: string): string | null {
  const s = v.trim();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{4})/))) [d, m, y] = [Number(r[1]), months.indexOf(r[2].toUpperCase()) + 1, Number(r[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!m || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "₹ 1,23,456.00" → 123456; null if not a whole number of rupees. */
export function parseRupees(v: string): number | null {
  const s = v.replace(/[₹,\s]|Rs\.?|INR/gi, '');
  if (!/^\d+(\.0+)?$/.test(s)) return null;
  return Number(s.split('.')[0]);
}
