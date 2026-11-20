/** Admissions CRM contracts (sprint 3). */

/** Pipeline order. Enrolled and Dropped are end states. */
export const ENQUIRY_STAGES = ['Enquiry', 'Applied', 'Test/Interview', 'Admitted'] as const;
export type PipelineStage = (typeof ENQUIRY_STAGES)[number];
export type EnquiryStage = PipelineStage | 'Enrolled' | 'Dropped';

export const ENQUIRY_SOURCES = ['Website', 'Walk-in', 'Referral', 'Facebook Ad', 'Google Ad', 'Other'] as const;
export const PREVIOUS_BOARDS = ['ICSE', 'CBSE', 'State', 'IB', 'Montessori', 'Other'] as const;

export interface EnquiryInput {
  branchId: string;
  academicYearId: string;
  childName: string;
  gender?: string | null;
  dob?: string | null;
  grade: number;
  parentName: string;
  parentPhone: string;
  altPhone?: string | null;
  parentEmail?: string | null;
  city?: string | null;
  address?: string | null;
  previousSchool?: string | null;
  previousBoard?: string | null;
  siblingInSchool?: boolean;
  source?: string;
  nextFollowUp?: string | null;
}

export interface EnquiryActivityDto {
  id: string;
  kind: 'created' | 'stage' | 'note' | 'enrolled';
  text: string;
  byName: string | null;
  at: string;
}

export interface EnquiryDto {
  id: string;
  branchId: string;
  branchName: string;
  academicYearId: string;
  academicYear: string;
  childName: string;
  gender: string | null;
  dob: string | null;
  grade: number;
  parentName: string;
  parentPhone: string;
  altPhone: string | null;
  parentEmail: string | null;
  city: string | null;
  address: string | null;
  previousSchool: string | null;
  previousBoard: string | null;
  siblingInSchool: boolean;
  source: string;
  stage: EnquiryStage;
  dropReason: string | null;
  nextFollowUp: string | null;
  student: { id: string; admissionNo: string } | null;
  createdAt: string;
  /** Another open enquiry with the same parent mobile and child name. */
  possibleDuplicateOf: string | null;
}

export interface EnquiryDetailDto extends EnquiryDto {
  activity: EnquiryActivityDto[];
}

export interface AdmissionStats {
  total: number;
  open: number;
  admittedOrEnrolled: number;
  dropped: number;
  /** % of enquiries that reached Admitted or Enrolled */
  conversion: number;
  byStage: Record<EnquiryStage, number>;
  bySource: { source: string; total: number; converted: number }[];
  followUpsDue: number;
}

export interface EnrolInput {
  classId?: string | null;
  admissionNo?: string | null;
  rollNo?: number | null;
  /** Temporary admission (e.g. documents pending); default Active. */
  status?: 'Active' | 'Temporary';
  /** How the enquiring parent is related to the child; default Father. */
  guardianRelation?: string;
}
