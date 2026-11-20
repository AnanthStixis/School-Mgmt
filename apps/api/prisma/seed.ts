/* Seeds the demo tenant, branches and personas from the POC. Safe to re-run. */
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: 'tenant-bnm' },
    update: {},
    create: {
      id: 'tenant-bnm',
      name: 'BNM Public School',
      trust: 'Bhageerathi Bai Narayan Rao Maanay Educational Institutions',
      city: 'Bangalore',
    },
  });

  const branches = [
    { code: 'BNMPS', name: 'BNM Public School', board: 'ICSE / ISC', color: '#e8650a', since: 2001 },
    { code: 'BNMPRE', name: 'BNM Pre-School (Montessori)', board: 'Montessori', color: '#0d9488', since: 2005 },
    { code: 'BNMPUC', name: 'BNM PU College', board: 'State Board (PUC)', color: '#1d4ed8', since: 2010 },
  ];
  const ids: Record<string, string> = {};
  for (const b of branches) {
    const row = await prisma.branch.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: b.code } },
      update: b,
      create: { ...b, tenantId: tenant.id },
    });
    ids[b.code] = row.id;
  }

  await prisma.academicYear.upsert({
    where: { tenantId_label: { tenantId: tenant.id, label: '2026-27' } },
    update: {},
    create: { tenantId: tenant.id, label: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), current: true },
  });

  const users: { role: Role; name: string; title: string; email: string; branch: string | null; platform?: boolean }[] = [
    { role: 'admin', name: 'Meera Nair', title: 'Platform Super Admin', email: 'meera@stixis.io', branch: null, platform: true },
    { role: 'manager', name: 'Dr. Rajesh Kumar', title: 'Group Director (Trust)', email: 'director@bnmpschool.in', branch: null },
    { role: 'manager', name: 'Anitha Krishnan', title: 'Branch Manager – BNM Public School', email: 'anitha@bnmpschool.in', branch: 'BNMPS' },
    { role: 'teacher', name: 'Priya Sharma', title: 'Mathematics • Class Teacher 8-A', email: 'priya.sharma@bnmpschool.in', branch: 'BNMPS' },
    { role: 'accounts', name: 'Kavitha Raman', title: 'Accounts Officer – BNM Public School', email: 'kavitha@bnmpschool.in', branch: 'BNMPS' },
    { role: 'parent', name: 'Suresh Menon', title: 'Parent of Aarav (8-A) & Diya (6-B)', email: 'suresh.menon@mail.com', branch: 'BNMPS' },
    { role: 'student', name: 'Aarav Menon', title: 'Class 8-A • Roll 1', email: 'aarav.menon@students.bnmpschool.in', branch: 'BNMPS' },
  ];
  for (const u of users) {
    const data = {
      role: u.role,
      name: u.name,
      title: u.title,
      tenantId: u.platform ? null : tenant.id,
      branchId: u.branch ? ids[u.branch] : null,
    };
    await prisma.user.upsert({ where: { email: u.email }, update: data, create: { ...data, email: u.email } });
  }
  console.log(`Seeded ${tenant.name}: ${branches.length} branches, ${users.length} users`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
