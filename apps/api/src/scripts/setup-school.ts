/**
 * Sets up a real school on an empty (migrated) database, without demo data:
 * the school (tenant), its branches, the academic year and the first School Admin(s).
 *
 *   corepack pnpm --filter @sms/api setup:school -- path/to/school.json          (shows what it would change)
 *   corepack pnpm --filter @sms/api setup:school -- path/to/school.json --yes    (writes)
 *   (in the Docker image: node dist/scripts/setup-school.js /app/school.json --yes)
 *
 * Safe to run again: everything is matched by code / label / mobile number and updated in place.
 * School onboarding screens come in phase 2; until then this script is how a school is created.
 * The School Admin signs in on the Staff tab with a code sent to their mobile, then adds staff,
 * classes and students in the app (or with the CSV imports).
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SchoolSetup {
  tenant: { id: string; name: string; trust?: string; city?: string; receiptPrefix: string };
  academicYear: { label: string; startsOn: string; endsOn: string };
  branches: { code: string; name: string; board: string; color?: string; city?: string; address?: string; phone?: string; email?: string; lateFeePerDay?: number }[];
  admins: { name: string; title?: string; email?: string; phone: string }[];
}

const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function normalisePhone(input: string): string | null {
  let n = input.replace(/[^\d]/g, '');
  if (n.length === 10) n = '91' + n;
  return /^91[6-9]\d{9}$/.test(n) ? '+' + n : null;
}

function validate(c: SchoolSetup): void {
  if (!c.tenant?.id || !c.tenant.name) fail('tenant.id and tenant.name are required');
  if (!/^[A-Z0-9]{2,10}$/.test(c.tenant.receiptPrefix ?? '')) fail('tenant.receiptPrefix must be 2–10 capital letters or digits, e.g. BNMPS');
  if (!/^\d{4}-\d{2}$/.test(c.academicYear?.label ?? '')) fail('academicYear.label must look like 2027-28');
  for (const k of ['startsOn', 'endsOn'] as const) if (!/^\d{4}-\d{2}-\d{2}$/.test(c.academicYear[k] ?? '')) fail(`academicYear.${k} must be YYYY-MM-DD`);
  if (!c.branches?.length) fail('at least one branch is required');
  for (const b of c.branches) if (!/^[A-Z0-9]{2,10}$/.test(b.code ?? '') || !b.name || !b.board) fail(`branch ${b.code ?? '?'}: code (capitals), name and board are required`);
  if (!c.admins?.length) fail('at least one School Admin is required');
  for (const a of c.admins) if (!a.name || !normalisePhone(a.phone ?? '')) fail(`admin ${a.name ?? '?'}: name and a valid 10-digit mobile are required`);
  // The example file's placeholders must be replaced before use.
  for (const a of c.admins) {
    if (/replace with/i.test(a.name) || /^(\+?91)?9000000000$/.test(a.phone.replace(/\D/g, '')) || /example\.com$/i.test(a.email ?? '')) fail(`admin "${a.name}": replace the example name, mobile and e-mail with the real School Admin's`);
  }
}

/** host/database of DATABASE_URL, without the password, so the operator sees what will be changed. */
function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL not set)';
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) fail('Give the settings file: setup:school -- path/to/school.json');
  const config = JSON.parse(readFileSync(resolve(file!), 'utf8')) as SchoolSetup;
  validate(config);
  const prisma = new PrismaClient();
  const existing = await prisma.tenant.findUnique({ where: { id: config.tenant.id }, include: { _count: { select: { branches: true } } } });
  const students = existing ? await prisma.student.count({ where: { branch: { tenantId: existing.id } } }) : 0;
  console.log(`Database: ${target()}`);
  console.log(existing ? `School ${existing.name} exists (${existing._count.branches} branches, ${students} students): it will be updated.` : `School ${config.tenant.name} will be created.`);
  console.log(`Academic year ${config.academicYear.label} becomes the current year; branches: ${config.branches.map((b) => b.code).join(', ')}; School Admin(s): ${config.admins.map((a) => a.name).join(', ')}.`);
  if (!args.includes('--yes')) {
    console.log('\nNothing changed. Check the database above, then run again with --yes.');
    await prisma.$disconnect();
    return;
  }
  try {
    const t = config.tenant;
    const tenant = await prisma.tenant.upsert({
      where: { id: t.id },
      update: { name: t.name, trust: t.trust ?? null, city: t.city ?? null, receiptPrefix: t.receiptPrefix },
      create: { id: t.id, name: t.name, trust: t.trust ?? null, city: t.city ?? null, receiptPrefix: t.receiptPrefix },
    });
    console.log(`✓ School: ${tenant.name}`);

    for (const b of config.branches) {
      const data = { name: b.name, board: b.board, color: b.color ?? '#e8650a', city: b.city ?? null, address: b.address ?? null, phone: b.phone ?? null, email: b.email ?? null };
      const existing = await prisma.branch.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: b.code } } });
      const settings = { ...((existing?.settings as object) ?? { workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], startsAt: '08:30', endsAt: '15:30', attendanceThreshold: 75 }), ...(b.lateFeePerDay !== undefined ? { lateFeePerDay: b.lateFeePerDay } : {}) };
      await prisma.branch.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: b.code } }, update: { ...data, settings }, create: { tenantId: tenant.id, code: b.code, ...data, settings } });
      console.log(`✓ Branch: ${b.code} ${b.name}`);
    }

    const y = config.academicYear;
    // The new year becomes the current one; earlier years stay readable.
    await prisma.$transaction([
      prisma.academicYear.updateMany({ where: { tenantId: tenant.id, NOT: { label: y.label } }, data: { current: false } }),
      prisma.academicYear.upsert({
        where: { tenantId_label: { tenantId: tenant.id, label: y.label } },
        update: { startsOn: new Date(`${y.startsOn}T00:00:00Z`), endsOn: new Date(`${y.endsOn}T00:00:00Z`), current: true },
        create: { tenantId: tenant.id, label: y.label, startsOn: new Date(`${y.startsOn}T00:00:00Z`), endsOn: new Date(`${y.endsOn}T00:00:00Z`), current: true },
      }),
    ]);
    console.log(`✓ Academic year ${y.label} (current)`);

    for (const a of config.admins) {
      const phone = normalisePhone(a.phone)!;
      const email = a.email?.trim().toLowerCase() || null;
      const byPhone = await prisma.user.findUnique({ where: { phone } });
      if (byPhone && byPhone.tenantId !== tenant.id) fail(`mobile ${a.phone} already belongs to a user of another school`);
      if (byPhone && byPhone.role !== 'manager') fail(`mobile ${a.phone} already belongs to a ${byPhone.role}; use another number`);
      // School Admin = a manager with no branch (sees and configures every branch). No password: they sign in by mobile code.
      const data = { tenantId: tenant.id, branchId: null, role: 'manager' as const, name: a.name, title: a.title ?? 'School Admin', email, active: true };
      await prisma.user.upsert({ where: { phone }, update: data, create: { ...data, phone } });
      console.log(`✓ School Admin: ${a.name} (${phone})`);
    }

    console.log('\nDone. The School Admin can now sign in (Staff tab → "No password? Sign in with a code sent to your mobile") and add classes, staff and students.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => fail((e as Error).message));
