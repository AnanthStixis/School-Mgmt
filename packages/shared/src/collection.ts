import type { RefundDto } from './corrections';

/** Fee collection contracts — sprint 5: counter payments, late fee, receipts, cancellation. */

/** Default late fee when a branch has not set its own (inferred from the existing system's reports). */
export const LATE_FEE_PER_DAY = 25;

export const PAYMENT_MODES = ['Cash', 'Cheque', 'DD', 'Net Banking', 'UPI', 'Credit Card', 'Debit Card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
/** Modes that need bank, instrument number and date on the receipt. */
export const INSTRUMENT_MODES: readonly PaymentMode[] = ['Cheque', 'DD'];
/** Modes Accounts must reconcile against the bank statement before the money counts as received. */
export const RECON_MODES: readonly PaymentMode[] = ['Cheque', 'Net Banking'];

/** What to do with the late fee on an installment when collecting: collect it, waive it, or leave it running. */
export const FINE_ACTIONS = ['pay', 'waive', 'defer'] as const;
export type FineAction = (typeof FINE_ACTIONS)[number];

export type ReceiptStatus = 'SUCCESS' | 'CANCELLED';
export type ReconStatus = 'NA' | 'PENDING' | 'DONE' | 'FAILED';

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * Late fee owed on an installment on `today` (all dates YYYY-MM-DD): ₹perDay for each day after the due date
 * (or after the last time the late fee was settled), but only while some of the installment is unpaid.
 */
export function lateFee(inv: { balance: number; dueDate: string; fineFrom: string | null }, today: string, perDay: number): number {
  if (inv.balance <= 0 || perDay <= 0) return 0;
  const from = inv.fineFrom && inv.fineFrom > inv.dueDate ? inv.fineFrom : inv.dueDate;
  return Math.max(0, dayNumber(today) - dayNumber(from)) * perDay;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const upTo99 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const upTo999 = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', upTo99(n % 100)].filter(Boolean).join(' ');

/** Whole rupees in Indian words, as printed on receipts: 82500 → "Rupees Eighty Two Thousand Five Hundred Only". */
export function rupeesInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore).replace(/^Rupees | Only$/g, '') : upTo999(crore)} Crore`);
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`);
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`);
  if (n) parts.push(upTo999(n));
  return `Rupees ${parts.join(' ')} Only`;
}

/** An installment that can be paid at the counter, with today's late fee. */
export interface CollectableInvoice {
  invoiceId: string;
  feeTypeName: string;
  academicYear: string;
  label: string;
  dueDate: string;
  net: number;
  paid: number;
  balance: number;
  lateFee: number;
  /** Days overdue today (0 if not overdue) */
  daysLate: number;
}

export interface CollectDto {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
  branchId: string;
  branchName: string;
  lateFeePerDay: number;
  today: string;
  invoices: CollectableInvoice[];
  /** Assigned but not yet confirmed by Accounts, so not collectable yet. */
  unconfirmed: number;
  receipts: ReceiptListItem[];
}

export interface CollectLineInput {
  invoiceId: string;
  /** Amount towards the installment (0 to its balance; less than the balance is a part payment). */
  fee: number;
  fine: FineAction;
}

export interface CollectInput {
  studentId: string;
  mode: PaymentMode;
  lines: CollectLineInput[];
  bank?: string | null;
  instrumentNo?: string | null;
  instrumentDate?: string | null;
  reference?: string | null;
  remarks?: string | null;
  /** Required when any late fee is waived. */
  waiveReason?: string | null;
}

export interface ReceiptLineDto {
  invoiceId: string;
  label: string;
  fee: number;
  fine: number;
  fineWaived: number;
}

export interface ReceiptListItem {
  id: string;
  no: string;
  date: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  branchName: string;
  mode: PaymentMode;
  source: string;
  status: ReceiptStatus;
  recon: ReconStatus;
  feeTotal: number;
  fineTotal: number;
  total: number;
  createdByName: string;
}

export interface ReceiptDto extends ReceiptListItem {
  schoolName: string;
  trust: string | null;
  branchAddress: string | null;
  academicYear: string;
  lines: ReceiptLineDto[];
  amountInWords: string;
  bank: string | null;
  instrumentNo: string | null;
  instrumentDate: string | null;
  reference: string | null;
  remarks: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  refunds: RefundDto[];
  /** Fee amount on this receipt not yet refunded (0 if cancelled or awaiting the bank) */
  refundable: number;
}

export interface ReceiptRegisterDto {
  from: string;
  to: string;
  rows: ReceiptListItem[];
  /** Successful receipts only. */
  totals: { count: number; fee: number; fine: number; total: number; byMode: { mode: PaymentMode; count: number; total: number }[] };
  cancelled: number;
}
