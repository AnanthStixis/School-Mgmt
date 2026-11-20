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
