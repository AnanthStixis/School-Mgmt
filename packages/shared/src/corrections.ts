/** Fee corrections and reports — sprint 6: concessions, write-offs, late fee waivers, refunds, reports. */
import type { PaymentMode, ReceiptListItem } from './collection';

export const CORRECTION_KINDS = ['CONCESSION', 'ADJUSTMENT', 'FINE_WAIVER'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];
export const CORRECTION_LABEL: Record<CorrectionKind, string> = { CONCESSION: 'Concession', ADJUSTMENT: 'Write-off', FINE_WAIVER: 'Late fee waiver' };

/** How a concession is spread over installments, as in the existing system. */
export const CONCESSION_METHODS = ['Equal', 'Order Wise', 'Manual'] as const;
export type ConcessionMethod = (typeof CONCESSION_METHODS)[number];

/** Reasons the school types most often (free text is still allowed). */
export const CONCESSION_PRESETS = ['Sibling in the school', 'Joined mid-year', 'Staff child', 'Management decision'];

/**
 * Spreads `amount` over installments without going above each one's room (its unpaid part).
 * Equal: as evenly as possible, any remainder on the earlier installments. Order Wise: fills the first first.
 * Returns null when the amount is more than the total room.
 */
export function allocate(amount: number, room: number[], method: 'Equal' | 'Order Wise'): number[] | null {
  const total = room.reduce((a, b) => a + Math.max(0, b), 0);
  if (amount < 0 || amount > total) return null;
  const out = room.map(() => 0);
  let left = amount;
  if (method === 'Order Wise') {
    room.forEach((r, i) => {
      const c = Math.min(Math.max(0, r), left);
      out[i] = c;
      left -= c;
    });
    return out;
  }
  while (left > 0) {
    const open = room.map((r, i) => i).filter((i) => room[i] - out[i] > 0);
    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      const c = Math.min(share, room[i] - out[i], left);
      out[i] += c;
      left -= c;
      if (!left) break;
    }
  }
  return out;
}

export interface ConcessionInput {
  assignmentId: string;
  /** Rupees, or a percentage of the annual fee */
  basis: 'amount' | 'percent';
  value: number;
  method: ConcessionMethod;
  /** Manual method: invoiceId → rupees */
  manual?: Record<string, number>;
  remarks: string;
}

export interface AdjustmentInput {
  assignmentId: string;
  amount: number;
  remarks: string;
}

export interface FineWaiverInput {
  invoiceId: string;
  remarks: string;
}

export interface RefundInput {
  receiptId: string;
  amount: number;
  mode: PaymentMode;
  bank?: string | null;
  instrumentNo?: string | null;
  remarks: string;
}

interface StudentRef {
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  branchName: string;
}

export interface CorrectionDto extends StudentRef {
  id: string;
  kind: CorrectionKind;
  feeTypeName: string;
  amount: number;
  remarks: string;
  lines: { label: string; amount: number }[];
  createdByName: string;
  createdAt: string;
}

export interface RefundDto extends StudentRef {
  id: string;
  receiptId: string;
  receiptNo: string;
  date: string;
  amount: number;
  mode: PaymentMode;
  bank: string | null;
  instrumentNo: string | null;
  remarks: string;
  status: string;
  createdByName: string;
  createdAt: string;
}

// ---------- reports ----------

export interface DuesRow extends StudentRef {
  guardian: { name: string; phone: string | null } | null;
  billed: number;
  concession: number;
  paid: number;
  balance: number;
  overdue: number;
  lateFee: number;
  /** Unpaid installments, oldest first */
  dues: { label: string; dueDate: string; balance: number }[];
}

export interface DuesReportDto {
  asOf: string;
  rows: DuesRow[];
  totals: { students: number; balance: number; overdue: number; lateFee: number };
}

export interface ClassSummaryRow {
  classId: string | null;
  className: string;
  branchName: string;
  students: number;
  billed: number;
  concession: number;
  adjustment: number;
  collected: number;
  refunded: number;
  balance: number;
  overdue: number;
  finePaid: number;
  fineWaived: number;
}

export interface ClassSummaryDto {
  academicYear: string;
  rows: ClassSummaryRow[];
  totals: Omit<ClassSummaryRow, 'classId' | 'className' | 'branchName'>;
}

export interface CorrectionsReportDto {
  from: string;
  to: string;
  corrections: CorrectionDto[];
  refunds: RefundDto[];
  cancellations: (ReceiptListItem & { cancelledAt: string; cancelReason: string | null })[];
  totals: { concession: number; adjustment: number; fineWaiver: number; refund: number; cancelled: number };
}
