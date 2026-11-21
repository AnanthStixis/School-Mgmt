/** Online payments and notifications — sprint 7. */

/** Modes a parent can pay with online (the gateway reports which one was used). */
export const ONLINE_MODES = ['UPI', 'Credit Card', 'Debit Card', 'Net Banking'] as const;
export type OnlineMode = (typeof ONLINE_MODES)[number];

export type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED';
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { INITIATED: 'Not completed', PENDING: 'Waiting for bank', SUCCESS: 'Paid', FAILED: 'Failed' };

/** A parent pays whole installments online (balance + late fee due today). */
export interface StartPaymentInput {
  studentId: string;
  invoiceIds: string[];
}

export interface StartPaymentDto {
  orderId: string;
  amount: number;
  gateway: string;
  /** Where to send the parent to pay */
  checkoutUrl: string;
}

export interface PaymentLine {
  invoiceId: string;
  label: string;
  fee: number;
  fine: number;
}

export interface PaymentAttemptDto {
  id: string;
  orderId: string;
  gateway: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  branchName: string;
  amount: number;
  lines: PaymentLine[];
  status: PaymentStatus;
  code: number | null;
  message: string | null;
  mode: string | null;
  gatewayTxnId: string | null;
  receiptId: string | null;
  receiptNo: string | null;
  excess: number;
  createdAt: string;
  completedAt: string | null;
}

export interface OnlinePaymentsReportDto {
  from: string;
  to: string;
  rows: PaymentAttemptDto[];
  totals: { attempts: number; success: number; failed: number; pending: number; notCompleted: number; collected: number; excess: number };
}

/** The development gateway's checkout page: what the "bank" answers. */
export const DEV_OUTCOMES = ['success', 'declined', 'failed', 'pending'] as const;
export type DevOutcome = (typeof DEV_OUTCOMES)[number];

export interface ReminderInput {
  branchId?: string;
  classId?: string;
}

export interface ReminderResult {
  sent: number;
  /** Already reminded today, or no mobile number on record */
  skipped: number;
}
