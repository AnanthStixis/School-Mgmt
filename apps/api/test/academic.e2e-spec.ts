/**
 * Sprint 2 end-to-end tests: branches, classes, students, staff and CSV import, with the
 * permission rules for each role. Runs against the seeded database and removes what it creates.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E';
// Unique per run so re-runs never collide; all start +91 96 99 so cleanup can find them.
const base = String(Date.now()).slice(-5);
let n = 0;
const phone = () => `9699${base}${n++}`;

describe('Academic setup, staff and students (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  let ps: string; // BNM Public School branch id
  let pre: string; // Pre-School branch id

  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    for (const [who, email] of Object.entries({ director: 'director@bnmpschool.in', bm: 'anitha@bnmpschool.in', teacher: 'priya.sharma@bnmpschool.in', accounts: 'kavitha@bnmpschool.in' })) {
      const r = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
      tokens[who] = r.body.accessToken;
    }
    const branches = await prisma.branch.findMany();
    ps = branches.find((b) => b.code === 'BNMPS')!.id;
    pre = branches.find((b) => b.code === 'BNMPRE')!.id;
  });

  afterAll(async () => {
    // Remove everything this run created.
    const students = await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: students.map((s) => s.id) } } });
    await prisma.student.deleteMany({ where: { id: { in: students.map((s) => s.id) } } });
    const staff = await prisma.staff.findMany({ where: { name: { startsWith: TAG } } });
    await prisma.staff.deleteMany({ where: { id: { in: staff.map((s) => s.id) } } });
    const users = await prisma.user.findMany({ where: { OR: [{ phone: { startsWith: '+919699' } }, { name: { startsWith: TAG } }] }, select: { id: true } });
    await prisma.studentGuardian.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.schoolClass.deleteMany({ where: { branchId: ps, name: { in: ['1-A', '2-A'] }, students: { none: {} } } });
    await app?.close();
  });

  describe('branches', () => {
    it('lets the School Admin edit a branch, not a branch manager', async () => {
      await http.patch(`/api/branches/${ps}`).set(as('director')).send({ settings: { attendanceThreshold: 80 } }).expect(200);
      await http.patch(`/api/branches/${ps}`).set(as('bm')).send({ city: 'X' }).expect(403);
      const d = await http.get('/api/branches/details').set(as('director')).expect(200);
      const b = d.body.find((x: { id: string }) => x.id === ps);
      expect(b.settings.attendanceThreshold).toBe(80);
      expect(b.settings.workingDays).toHaveLength(6); // merged, not replaced
      expect(b.counts.students).toBeGreaterThan(0);
      await http.patch(`/api/branches/${ps}`).set(as('director')).send({ settings: { attendanceThreshold: 75 } }).expect(200);
    });

    it('rejects a duplicate branch code', () =>
      http.post('/api/branches').set(as('director')).send({ code: 'BNMPS', name: 'Copy', board: 'ICSE' }).expect(409));
  });

  describe('classes', () => {
    it('bulk-creates a grade range, skips existing classes, and keeps branch managers in their branch', async () => {
      const body = { branchId: ps, fromGrade: 1, toGrade: 2, sections: ['a'] };
      const r1 = await http.post('/api/classes/bulk').set(as('bm')).send(body).expect(201);
      expect(r1.body.created.map((c: { name: string }) => c.name).sort()).toEqual(['1-A', '2-A']);
      const r2 = await http.post('/api/classes/bulk').set(as('bm')).send(body).expect(201);
      expect(r2.body.created).toHaveLength(0);
      expect(r2.body.skipped.sort()).toEqual(['1-A', '2-A']);
      await http.post('/api/classes/bulk').set(as('bm')).send({ ...body, branchId: pre }).expect(404);
      await http.post('/api/classes/bulk').set(as('teacher')).send(body).expect(403);
    });

    it('deletes only empty classes', async () => {
      const list = (await http.get(`/api/classes?branchId=${ps}`).set(as('bm')).expect(200)).body as { id: string; name: string; studentCount: number }[];
      const empty = list.find((c) => c.name === '2-A')!;
      const full = list.find((c) => c.name === '8-A')!;
      expect(full.studentCount).toBeGreaterThan(0);
      await http.delete(`/api/classes/${full.id}`).set(as('bm')).expect(409);
      await http.delete(`/api/classes/${empty.id}`).set(as('bm')).expect(204);
    });

    it('requires the class teacher to be staff of the same branch', async () => {
      const list = (await http.get(`/api/classes?branchId=${ps}`).set(as('bm'))).body as { id: string; name: string }[];
      const otherBranchTeacher = await prisma.staff.findFirstOrThrow({ where: { branchId: pre } });
      await http.patch(`/api/classes/${list.find((c) => c.name === '1-A')!.id}`).set(as('bm')).send({ classTeacherId: otherBranchTeacher.id }).expect(400);
    });
  });

  describe('students', () => {
    it('lets teachers and accounts view, but only managers change', async () => {
      const r = await http.get('/api/students?pageSize=5').set(as('teacher')).expect(200);
      expect(r.body.items).toHaveLength(5);
      expect(r.body.items.every((s: { branchId: string }) => s.branchId === ps)).toBe(true);
      await http.get('/api/students').set(as('accounts')).expect(200);
      await http.post('/api/students').set(as('teacher')).send({ branchId: ps, name: `${TAG} X`, guardians: [{ name: 'GG', phone: phone(), relation: 'Father' }] }).expect(403);
    });

    it('creates a student, generates an admission number and links siblings by guardian mobile', async () => {
      const r = await http
        .post('/api/students')
        .set(as('bm'))
        .send({ branchId: ps, name: `${TAG} Sibling`, gender: 'F', dob: '2015-03-01', guardians: [{ name: 'Suresh Menon', phone: '98000 00001', relation: 'Father' }] })
        .expect(201);
      expect(r.body.admissionNo).toMatch(/^BNMPS26-\d{4}$/);
      expect(r.body.siblings.map((s: { name: string }) => s.name).sort()).toEqual(['Aarav Menon', 'Diya Menon']);
      expect(r.body.guardians[0]).toMatchObject({ name: 'Suresh Menon', primary: true });
    });

    it('creates a parent login for a new guardian number and refuses a duplicate admission number', async () => {
      const p = phone();
      const r = await http.post('/api/students').set(as('bm')).send({ branchId: ps, admissionNo: `${TAG}-${base}`, name: `${TAG} New`, guardians: [{ name: `${TAG} Parent`, phone: p, relation: 'Mother' }] }).expect(201);
      const parent = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${p}` } });
      expect(parent.role).toBe('parent');
      await http.post('/api/students').set(as('bm')).send({ branchId: ps, admissionNo: r.body.admissionNo, name: `${TAG} Dup`, guardians: [{ name: 'GG', phone: phone(), relation: 'Father' }] }).expect(409);
    });

    it('records a status change in the audit log', async () => {
      const s = await prisma.student.findFirstOrThrow({ where: { name: `${TAG} New` } });
      await http.patch(`/api/students/${s.id}`).set(as('bm')).send({ status: 'Left' }).expect(200);
      const log = await prisma.auditLog.findFirst({ where: { entityId: s.id, action: 'student.status_change' } });
      expect(log?.data).toMatchObject({ from: 'Active', to: 'Left' });
    });

    it('hides other branches’ students from a branch manager', async () => {
      const other = await prisma.student.findFirstOrThrow({ where: { branchId: pre } });
      await http.get(`/api/students/${other.id}`).set(as('bm')).expect(404);
    });
  });

  describe('staff', () => {
    it('gives a teacher login, blocks manager access for branch managers, and revokes on deactivation', async () => {
      const p = phone();
      const r = await http.post('/api/staff').set(as('bm')).send({ branchId: ps, name: `${TAG} Teacher`, role: 'Teacher', subject: 'Science', phone: p, access: 'teacher' }).expect(201);
      expect(r.body.access).toBe('teacher');
      const u = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${p}` } });
      expect(u).toMatchObject({ role: 'teacher', active: true, branchId: ps });

      await http.patch(`/api/staff/${r.body.id}`).set(as('bm')).send({ access: 'manager' }).expect(403);
      await http.patch(`/api/staff/${r.body.id}`).set(as('bm')).send({ status: 'Inactive' }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).active).toBe(false);
    });

    it('refuses login access without a mobile number', () =>
      http.post('/api/staff').set(as('bm')).send({ branchId: ps, name: `${TAG} NoPhone`, role: 'Teacher', access: 'teacher' }).expect(400));
  });

  describe('CSV import', () => {
    const header = 'name,class,gender,guardian_name,guardian_phone';
    it('reports problems in a dry run and imports nothing', async () => {
      const csv = `${header}\n${TAG} Imp One,8-A,F,${TAG} G1,${phone()}\n${TAG} Imp Two,99-Z,M,${TAG} G2,123\n`;
      const r = await http.post('/api/imports/students').set(as('bm')).send({ branchId: ps, csv, dryRun: true }).expect(201);
      expect(r.body).toMatchObject({ dryRun: true, total: 2, valid: 1, invalid: 1, created: 0 });
      expect(r.body.rows[0].line).toBe(3);
      expect(await prisma.student.count({ where: { name: { startsWith: `${TAG} Imp` } } })).toBe(0);
    });

    it('refuses to import a file with errors, and imports a clean one in full', async () => {
      const bad = `${header}\n${TAG} Imp A,8-A,F,${TAG} GA,${phone()}\n${TAG} Imp B,8-A,M,${TAG} GB,bad\n`;
      const r1 = await http.post('/api/imports/students').set(as('bm')).send({ branchId: ps, csv: bad, dryRun: false }).expect(201);
      expect(r1.body).toMatchObject({ invalid: 1, created: 0 });
      expect(await prisma.student.count({ where: { name: { startsWith: `${TAG} Imp` } } })).toBe(0);

      const good = `${header}\n${TAG} Imp A,8-A,F,${TAG} GA,${phone()}\n${TAG} Imp B,8-A,M,${TAG} GB,${phone()}\n`;
      const r2 = await http.post('/api/imports/students').set(as('bm')).send({ branchId: ps, csv: good, dryRun: false }).expect(201);
      expect(r2.body).toMatchObject({ valid: 2, created: 2 });
      expect(await prisma.student.count({ where: { name: { startsWith: `${TAG} Imp` } } })).toBe(2);
    });

    it('rejects unknown columns', () =>
      http.post('/api/imports/students').set(as('bm')).send({ branchId: ps, csv: 'name,shoe_size,guardian_name,guardian_phone\nA,9,G,9876543210', dryRun: true }).expect(400));

    it('is not available to teachers', () => http.post('/api/imports/students').set(as('teacher')).send({ branchId: ps, csv: 'name\nA' }).expect(403));
  });
});
