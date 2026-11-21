/** Announcements and notifications. */

export const ANNOUNCEMENT_AUDIENCES = ['PARENTS', 'CLASSES', 'STAFF', 'EVERYONE'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  PARENTS: 'All parents',
  CLASSES: 'Parents of selected classes',
  STAFF: 'All staff',
  EVERYONE: 'Parents and staff',
};

export const ANNOUNCEMENT_PRIORITIES = ['Normal', 'Important', 'Urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 2000;
/** SMS copies are cut to this length and point to the app for the rest. */
export const ANNOUNCEMENT_SMS_MAX = 300;

export interface AnnouncementInput {
  /** null = every branch (School Admin only); a branch manager's own branch otherwise */
  branchId: string | null;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** For CLASSES */
  classIds?: string[];
  priority: AnnouncementPriority;
  pinned: boolean;
  /** Also send by SMS (parents: primary guardian; staff: their mobile) */
  sms: boolean;
  /** Also send by e-mail to those with an e-mail address */
  email: boolean;
}

/** Who an announcement would reach, before sending. */
export interface AudiencePreview {
  recipients: number;
  parents: number;
  students: number;
  staff: number;
  sms: number;
  email: number;
}

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** e.g. "Parents of 8-A, 8-B" or "All staff · BNM Public School" */
  audienceLabel: string;
  branchName: string | null;
  priority: AnnouncementPriority;
  pinned: boolean;
  sms: boolean;
  email: boolean;
  recipients: number;
  smsSent: number;
  emailSent: number;
  /** How many recipients have opened it in the app */
  read: number;
  createdByName: string;
  createdAt: string;
  withdrawnAt: string | null;
}

/** One item in a user's notification feed (bell on the website, Notices in the app). */
export interface NotificationDto {
  id: string;
  /** receipt, absence, fee_reminder, announcement */
  kind: string;
  title: string;
  text: string;
  link: string | null;
  createdAt: string;
  read: boolean;
  priority: AnnouncementPriority | null;
  pinned: boolean;
}

export interface NotificationFeedDto {
  items: NotificationDto[];
  unread: number;
}

/** Which outgoing channels work on this system (e-mail is off until a provider is configured). */
export interface ChannelsDto {
  sms: boolean;
  email: boolean;
  /** Development / test system: messages are written to the server log, not sent */
  simulated: boolean;
}
