import type {
  AnnouncementDto,
  AnnouncementInput,
  AudiencePreview,
  ChannelsDto,
  NotificationFeedDto,
  ParallelRunDto,
  DevOutcome,
  OnlinePaymentsReportDto,
  PaymentAttemptDto,
  ReminderResult,
  StartPaymentDto,
  AdjustmentInput,
  ClassSummaryDto,
  ConcessionInput,
  CorrectionDto,
  CorrectionsReportDto,
  DuesReportDto,
  RefundInput,
  CollectDto,
  CollectInput,
  ReceiptDto,
  ReceiptListItem,
  ReceiptRegisterDto,
  AcademicYearDto,
  StudentLoginStatus,
  AssignBoardDto,
  FeeActionInput,
  FeeActionResult,
  FeeBandDto,
  FeeOverviewDto,
  FeeProfile,
  FeeSetupDto,
  FeeTypeDto,
  FeeTypeInput,
  FeeTypeUpdate,
  StudentFeesDto,
  AdmissionStats,
  AttendanceOverview,
  EnquiryDetailDto,
  EnquiryDto,
  EnquiryInput,
  EnrolInput,
  MarkableClass,
  PipelineStage,
  RegisterDto,
  RegisterSaveInput,
  RegisterSaveResult,
  StudentAttendanceDto,
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

  importTemplate: (kind: 'students' | 'staff' | 'balances') => call<string>('GET', `/imports/${kind}/template`, undefined, true),
  importCsv: (kind: 'students' | 'staff' | 'balances', branchId: string, csv: string, dryRun: boolean) => call<ImportResult>('POST', `/imports/${kind}`, { branchId, csv, dryRun }),

  enquiries: (p: { branchId?: string; academicYearId?: string; q?: string; includeClosed?: boolean }) =>
    call<EnquiryDto[]>('GET', `/enquiries${qs({ ...p, includeClosed: p.includeClosed ? 'true' : undefined })}`),
  enquiryStats: (p: { branchId?: string; academicYearId?: string }) => call<AdmissionStats>('GET', `/enquiries/stats${qs(p)}`),
  enquiry: (id: string) => call<EnquiryDetailDto>('GET', `/enquiries/${id}`),
  createEnquiry: (b: EnquiryInput) => call<EnquiryDetailDto>('POST', '/enquiries', b),
  updateEnquiry: (id: string, b: Partial<EnquiryInput>) => call<EnquiryDetailDto>('PATCH', `/enquiries/${id}`, b),
  moveEnquiry: (id: string, stage: PipelineStage) => call<EnquiryDetailDto>('POST', `/enquiries/${id}/move`, { stage }),
  dropEnquiry: (id: string, reason: string) => call<EnquiryDetailDto>('POST', `/enquiries/${id}/drop`, { reason }),
  noteEnquiry: (id: string, text: string, nextFollowUp?: string | null) => call<EnquiryDetailDto>('POST', `/enquiries/${id}/notes`, { text, nextFollowUp }),
  enrolEnquiry: (id: string, b: EnrolInput) => call<EnquiryDetailDto>('POST', `/enquiries/${id}/enrol`, b),

  attendanceClasses: () => call<MarkableClass[]>('GET', '/attendance/classes'),
  register: (classId: string, date?: string) => call<RegisterDto>('GET', `/attendance/register${qs({ classId, date })}`),
  saveRegister: (b: RegisterSaveInput) => call<RegisterSaveResult>('PUT', '/attendance/register', b),
  attendanceOverview: (branchId?: string) => call<AttendanceOverview>('GET', `/attendance/overview${qs({ branchId })}`),
  myStudents: () => call<{ id: string; name: string; className: string | null }[]>('GET', '/attendance/mine'),
  myStudentLogins: () => call<StudentLoginStatus[]>('GET', '/student-logins/mine'),
  studentLoginStatus: (id: string) => call<StudentLoginStatus>('GET', `/student-logins/${id}`),
  setStudentPassword: (id: string, password: string) => call<StudentLoginStatus>('PUT', `/student-logins/${id}`, { password }),
  disableStudentLogin: (id: string) => call<StudentLoginStatus>('DELETE', `/student-logins/${id}`),
  studentAttendance: (id: string) => call<StudentAttendanceDto>('GET', `/attendance/students/${id}`),

  feeOverview: (p: { branchId?: string; academicYearId?: string }) => call<FeeOverviewDto>('GET', `/fees/overview${qs(p)}`),
  feeSetup: (branchId: string, academicYearId?: string) => call<FeeSetupDto>('GET', `/fees/setup${qs({ branchId, academicYearId })}`),
  saveFeeBands: (branchId: string, bands: Omit<FeeBandDto, 'id'>[]) => call<FeeBandDto[]>('PUT', '/fees/bands', { branchId, bands }),
  createFeeType: (b: FeeTypeInput) => call<FeeTypeDto>('POST', '/fees/types', b),
  updateFeeType: (id: string, b: FeeTypeUpdate) => call<FeeTypeDto>('PATCH', `/fees/types/${id}`, b),
  saveFeeRates: (id: string, rates: Record<string, number>) => call<FeeTypeDto>('PUT', `/fees/types/${id}/rates`, { rates }),
  copyFeeType: (id: string, academicYearId: string) => call<FeeTypeDto>('POST', `/fees/types/${id}/copy`, { academicYearId }),
  feeBoard: (feeTypeId: string, classId: string) => call<AssignBoardDto>('GET', `/fees/board${qs({ feeTypeId, classId })}`),
  feeAction: (b: FeeActionInput) => call<FeeActionResult>('POST', '/fees/actions', b),
  studentFees: (id: string) => call<StudentFeesDto>('GET', `/fees/students/${id}`),
  collectView: (studentId: string) => call<CollectDto>('GET', `/fees/collect/${studentId}`),
  collect: (b: CollectInput) => call<ReceiptDto>('POST', '/fees/receipts', b),
  receiptRegister: (p: { branchId?: string; from?: string; to?: string; mode?: string; recon?: string }) => call<ReceiptRegisterDto>('GET', `/fees/receipts${qs(p)}`),
  receipt: (id: string) => call<ReceiptDto>('GET', `/fees/receipts/${id}`),
  cancelReceipt: (id: string, reason: string) => call<ReceiptDto>('POST', `/fees/receipts/${id}/cancel`, { reason }),
  reconcileReceipt: (id: string, ok: boolean, note?: string) => call<ReceiptDto>('POST', `/fees/receipts/${id}/recon`, { ok, note }),
  setConcession: (b: ConcessionInput) => call<CorrectionDto>('POST', '/fees/concessions', b),
  writeOff: (b: AdjustmentInput) => call<CorrectionDto>('POST', '/fees/adjustments', b),
  waiveFine: (invoiceId: string, remarks: string) => call<CorrectionDto>('POST', '/fees/fine-waivers', { invoiceId, remarks }),
  refund: (b: RefundInput) => call<ReceiptDto>('POST', '/fees/refunds', b),
  studentCorrections: (studentId: string) => call<CorrectionDto[]>('GET', `/fees/students/${studentId}/corrections`),
  duesReport: (p: { branchId?: string; classId?: string; overdueOnly?: string }) => call<DuesReportDto>('GET', `/fees/reports/dues${qs(p)}`),
  classSummary: (p: { branchId?: string }) => call<ClassSummaryDto>('GET', `/fees/reports/classes${qs(p)}`),
  correctionsReport: (p: { branchId?: string; from?: string; to?: string; kind?: string }) => call<CorrectionsReportDto>('GET', `/fees/reports/corrections${qs(p)}`),
  startPayment: (studentId: string, invoiceIds: string[]) => call<StartPaymentDto>('POST', '/payments/online', { studentId, invoiceIds }),
  payment: (orderId: string) => call<PaymentAttemptDto>('GET', `/payments/online/${encodeURIComponent(orderId)}`),
  devCompletePayment: (orderId: string, outcome: DevOutcome, mode: string) => call<PaymentAttemptDto>('POST', `/payments/dev/${encodeURIComponent(orderId)}/complete`, { outcome, mode }),
  onlinePayments: (p: { branchId?: string; from?: string; to?: string; status?: string }) => call<OnlinePaymentsReportDto>('GET', `/payments/online${qs(p)}`),
  parallelRun: (p: { branchId?: string; csv: string }) => call<ParallelRunDto>('POST', '/fees/parallel-run', p),
  sendReminders: (p: { branchId?: string; classId?: string }) => call<ReminderResult>('POST', '/fees/reminders', p),
  notifications: () => call<NotificationFeedDto>('GET', '/notifications'),
  markNotificationRead: (id: string) => call<void>('POST', `/notifications/${id}/read`),
  markAllNotificationsRead: () => call<{ marked: number }>('POST', '/notifications/read-all'),
  channels: () => call<ChannelsDto>('GET', '/notifications/channels'),
  announcements: () => call<AnnouncementDto[]>('GET', '/announcements'),
  previewAnnouncement: (b: Pick<AnnouncementInput, 'branchId' | 'audience' | 'classIds' | 'sms' | 'email'>) => call<AudiencePreview>('POST', '/announcements/preview', b),
  sendAnnouncement: (b: AnnouncementInput) => call<AnnouncementDto>('POST', '/announcements', b),
  withdrawAnnouncement: (id: string) => call<AnnouncementDto>('POST', `/announcements/${id}/withdraw`),
  studentReceipts: (studentId: string) => call<ReceiptListItem[]>('GET', `/fees/students/${studentId}/receipts`),
  updateFeeProfile: (id: string, b: Partial<FeeProfile>) => call<FeeProfile>('PATCH', `/fees/students/${id}/profile`, b),

  login: (email: string, password: string) => raw<AuthResponse>('POST', '/auth/login', { email, password }, false),
  studentLogin: (loginId: string, password: string) => raw<AuthResponse>('POST', '/auth/student-login', { loginId, password }, false),
  requestOtp: (phone: string) => raw<{ message: string }>('POST', '/auth/otp/request', { phone }, false),
  verifyOtp: (phone: string, code: string) => raw<AuthResponse>('POST', '/auth/otp/verify', { phone, code }, false),
  logout: () => raw<void>('POST', '/auth/logout', {}, false),
};
