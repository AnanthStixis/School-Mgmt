/** The six roles from the POC. `admin` is the Stixis platform super-admin (cross-tenant). */
export const ROLES = ['admin', 'manager', 'teacher', 'accounts', 'parent', 'student'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Platform Admin',
  manager: 'Manager',
  teacher: 'Teacher',
  accounts: 'Accounts',
  parent: 'Parent',
  student: 'Student',
};
