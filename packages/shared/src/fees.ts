/** Fees contracts — sprint 4: fee setup, assignment and publishing. Collection is in collection.ts. */

export const FEE_KINDS = ['SCHOOL', 'TRANSPORT', 'APPLICATION', 'CUSTOM', 'PREVIOUS'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];
export const FEE_KIND_LABEL: Record<FeeKind, string> = {
  SCHOOL: 'School fee (by class band and admission type)',
  TRANSPORT: 'Transport fee (by distance slab and pickup mode)',
  APPLICATION: 'Application fee (one amount for everyone)',
  CUSTOM: 'Custom fee (amount set when assigning)',
  PREVIOUS: 'Previous-year balance (imported from the old system)',
};
/** Fee kinds Accounts can create by hand (previous-year balances only come from the import). */
export const CREATABLE_FEE_KINDS: readonly FeeKind[] = ['SCHOOL', 'TRANSPORT', 'APPLICATION', 'CUSTOM'];
/** Kinds priced from a rate chart (the others take an amount per student). */
export const hasRateChart = (k: string) => k === 'SCHOOL' || k === 'TRANSPORT' || k === 'APPLICATION';
/** The existing system charges no late fee on previous-year balances. */
export const chargesLateFee = (k: string) => k !== 'PREVIOUS';

export const ADMISSION_TYPES = ['Re-admission', 'New Admission', 'UKG to ICSE', 'State to ICSE'] as const;
export type AdmissionType = (typeof ADMISSION_TYPES)[number];
export const PICKUP_MODES = ['Pickup & Drop', 'Pickup', 'Drop'] as const;

/** Rate keys: SCHOOL "<band>|<admission type>", TRANSPORT "<slab>|<pickup mode>", APPLICATION "*". */
export const rateKey = (a: string, b?: string) => (b === undefined ? a : `${a}|${b}`);

export interface FeeBandDto {
  id: string;
  name: string;
  fromGrade: number;
  toGrade: number;
}

export interface FeeInstallmentDto {
  seq: number;
  label: string;
  dueDate: string;
}

export interface FeeComponent {
  name: string;
  percent: number;
}

export interface FeeTypeDto {
  id: string;
  branchId: string;
  academicYearId: string;
  academicYear: string;
  kind: FeeKind;
  name: string;
  components: FeeComponent[];
  ratesConfirmed: boolean;
  active: boolean;
  installments: FeeInstallmentDto[];
  /** key → annual amount (₹) */
  rates: Record<string, number>;
  /** TRANSPORT only: the slab names in chart order (derived from rate keys) */
  slabs: string[];
  assignedCount: number;
}

export interface FeeSetupDto {
  branchId: string;
  academicYearId: string;
  bands: FeeBandDto[];
  feeTypes: FeeTypeDto[];
}

export interface FeeTypeInput {
  branchId: string;
  academicYearId: string;
  kind: FeeKind;
  name: string;
  components?: FeeComponent[];
  installments: FeeInstallmentDto[];
}

export interface FeeTypeUpdate {
  name?: string;
  components?: FeeComponent[];
  installments?: FeeInstallmentDto[];
  ratesConfirmed?: boolean;
  active?: boolean;
}

export type AssignmentStatus = 'ASSIGNED' | 'CONFIRMED' | 'PUBLISHED';
export type InvoiceStatus = 'Paid' | 'Partial' | 'Overdue' | 'Pending';

export interface FeeInvoiceDto {
  id: string;
  seq: number;
  label: string;
  dueDate: string;
  gross: number;
  concession: number;
  adjustment: number;
  paid: number;
  /** gross − concession − adjustment − paid */
  balance: number;
  status: InvoiceStatus;
  /** Late fee owed today (₹/day after the due date while unpaid) */
  lateFee: number;
}

export interface FeeAssignmentDto {
  id: string;
  feeTypeId: string;
  feeTypeName: string;
  kind: FeeKind;
  academicYear: string;
  category: string;
  gross: number;
  status: AssignmentStatus;
  onlineEnabled: boolean;
  invoices: FeeInvoiceDto[];
  totals: { gross: number; concession: number; paid: number; balance: number; overdue: number };
}

/** Fee profile on the student record that decides which rate applies. */
export interface FeeProfile {
  admissionType: string;
  rte: boolean;
  staffKid: boolean;
  transportSlab: string | null;
  pickupMode: string | null;
}

export interface StudentFeesDto {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
  profile: FeeProfile;
  assignments: FeeAssignmentDto[];
  totals: { gross: number; paid: number; balance: number; overdue: number };
}

/** One row of the Assign & publish screen: a student and their assignment of the chosen fee type. */
export interface AssignRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  profile: FeeProfile;
  /** What the chart would charge now (null = no matching rate) */
  quote: { category: string; amount: number } | null;
  assignment: { id: string; category: string; gross: number; status: AssignmentStatus; onlineEnabled: boolean; paid: number } | null;
}

export interface AssignBoardDto {
  feeType: FeeTypeDto;
  classId: string;
  className: string;
  rows: AssignRow[];
  counts: { students: number; unassigned: number; assigned: number; confirmed: number; published: number; online: number };
}

export const FEE_ACTIONS = ['assign', 'confirm', 'publish', 'unpublish', 'online_on', 'online_off', 'reset'] as const;
export type FeeAction = (typeof FEE_ACTIONS)[number];

export interface FeeActionInput {
  feeTypeId: string;
  studentIds: string[];
  action: FeeAction;
  /** CUSTOM fee types: the annual amount to charge each selected student. */
  amount?: number;
}

export interface FeeActionResult {
  done: number;
  skipped: { studentId: string; name: string; reason: string }[];
}

export interface FeeSummaryRow {
  feeTypeId: string;
  feeTypeName: string;
  kind: FeeKind;
  branchName: string;
  students: number;
  assigned: number;
  published: number;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
}

export interface FeeOverviewDto {
  academicYear: string;
  placeholderRates: boolean;
  rows: FeeSummaryRow[];
  totals: { billed: number; paid: number; balance: number; overdue: number; unpublished: number };
}
