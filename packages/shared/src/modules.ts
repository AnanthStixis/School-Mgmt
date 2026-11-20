import type { Role } from './roles';

/** Navigation modules and which roles may open them – ported 1:1 from the POC (Poc/assets/app.js NAV). */
export type ModuleKey =
  | 'dashboard' | 'platform' | 'branches' | 'admissions' | 'staff' | 'students' | 'setup'
  | 'attendance' | 'timetable' | 'academics' | 'marks' | 'leave' | 'fees' | 'finance'
  | 'tickets' | 'escalation' | 'communication' | 'operations' | 'reports';

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  group: string;
  roles: Role[] | '*';
}

export const MODULES: ModuleDef[] = [
  { group: 'Overview', key: 'dashboard', label: 'Dashboard', roles: '*' },
  { group: 'SaaS Platform', key: 'platform', label: 'Tenants & Plans', roles: ['admin'] },
  { group: 'Organisation', key: 'branches', label: 'Branches & Config', roles: ['manager', 'admin'] },
  { group: 'Organisation', key: 'admissions', label: 'Admissions CRM', roles: ['manager'] },
  { group: 'Organisation', key: 'staff', label: 'Staff & Payroll', roles: ['manager'] },
  { group: 'Academics', key: 'students', label: 'Students', roles: ['manager', 'teacher', 'accounts'] },
  { group: 'Academics', key: 'setup', label: 'Academic Setup', roles: ['manager'] },
  { group: 'Academics', key: 'attendance', label: 'Attendance', roles: ['manager', 'teacher', 'student', 'parent'] },
  { group: 'Academics', key: 'timetable', label: 'Timetable', roles: ['manager', 'teacher', 'student', 'parent'] },
  { group: 'Academics', key: 'academics', label: 'Homework & Diary', roles: ['manager', 'teacher', 'student', 'parent'] },
  { group: 'Academics', key: 'marks', label: 'Exams & Marks', roles: ['manager', 'teacher', 'student', 'parent'] },
  { group: 'Academics', key: 'leave', label: 'Leave Management', roles: ['manager', 'teacher', 'student', 'parent'] },
  { group: 'Finance', key: 'fees', label: 'Fees & Invoices', roles: ['accounts', 'manager', 'parent'] },
  { group: 'Finance', key: 'finance', label: 'Accounts & Expenses', roles: ['accounts', 'manager'] },
  { group: 'Support & Service', key: 'tickets', label: 'Complaints & Tickets', roles: '*' },
  { group: 'Support & Service', key: 'escalation', label: 'Escalation Engine', roles: ['manager', 'admin'] },
  { group: 'Campus', key: 'communication', label: 'Communication', roles: '*' },
  { group: 'Campus', key: 'operations', label: 'Transport & Library', roles: '*' },
  { group: 'Campus', key: 'reports', label: 'Reports & Analytics', roles: ['manager', 'accounts', 'admin'] },
];

/** Same rule as the POC: platform admin only sees the platform console, everyone else by role list. */
export function canAccess(module: ModuleDef | ModuleKey, role: Role): boolean {
  const m = typeof module === 'string' ? MODULES.find((x) => x.key === module) : module;
  if (!m) return false;
  if (role === 'admin') return m.key === 'dashboard' || m.key === 'platform';
  return m.roles === '*' || m.roles.includes(role);
}

export const modulesFor = (role: Role) => MODULES.filter((m) => canAccess(m, role));
