/*
 * Seeds the demo trust from the POC: 3 branches, the 7 personas, and (for the current year)
 * classes, subjects, staff and students with guardians. Deterministic and safe to re-run.
 */
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Test phone ranges: personas +91 98000 000xx, fathers +91 97…, mothers +91 94…, staff +91 95/96….
// Same deterministic generator idea as Poc/assets/data.js, so every run produces the same people.
let seed = 20261104;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const pad = (n: number, l = 2) => String(n).padStart(l, '0');

const FM = ['Arjun', 'Vihaan', 'Rohan', 'Karthik', 'Siddharth', 'Ishaan', 'Aditya', 'Rahul', 'Nikhil', 'Harish', 'Dev', 'Kabir', 'Pranav', 'Varun', 'Surya', 'Ashwin', 'Mohan', 'Naveen', 'Tarun', 'Yash'];
const FF = ['Ananya', 'Kavya', 'Meera', 'Nisha', 'Priyanka', 'Sneha', 'Lakshmi', 'Divya', 'Aishwarya', 'Harini', 'Janani', 'Ritika', 'Sanjana', 'Tanvi', 'Vaishnavi', 'Pooja', 'Nandhini', 'Swathi', 'Isha', 'Riya'];
const LN = ['Iyer', 'Nair', 'Reddy', 'Krishnan', 'Subramanian', 'Patel', 'Gupta', 'Rao', 'Varma', 'Pillai', 'Natarajan', 'Chandran', 'Sundaram', 'Balaji', 'Mehta', 'Joshi', 'Kapoor', 'Das', 'Naidu', 'Raman', 'Gowda', 'Shetty', 'Hegde', 'Bhat'];
const SF = ['Anita', 'Ramesh', 'Sunita', 'Vijay', 'Deepa', 'Mahesh', 'Latha', 'Sanjay', 'Geetha', 'Prakash', 'Revathi', 'Arun', 'Sudha', 'Kiran', 'Padma', 'Manoj', 'Uma', 'Ganesh', 'Radha', 'Bala', 'Shalini', 'Venkat', 'Jaya', 'Murali', 'Sangeetha', 'Dinesh', 'Bhuvana', 'Senthil'];
const SUBJECTS: [string, string, string][] = [
  ['English', 'ENG', 'Language'],
  ['Mathematics', 'MAT', 'Core'],
  ['Science', 'SCI', 'Core'],
  ['Social Studies', 'SST', 'Core'],
  ['Kannada', 'KAN', 'Language'],
  ['Hindi', 'HIN', 'Language'],
  ['Computer Studies', 'CS', 'Elective'],
];

// [grade, section, name] per branch – as in the POC.
const CLASSES: Record<string, [number, string, string][]> = {
  BNMPS: [[6, 'A', '6-A'], [6, 'B', '6-B'], [7, 'A', '7-A'], [7, 'B', '7-B'], [8, 'A', '8-A'], [8, 'B', '8-B'], [9, 'A', '9-A'], [9, 'B', '9-B'], [10, 'A', '10-A'], [10, 'B', '10-B'], [11, 'A', 'XI (ISC)'], [12, 'A', 'XII (ISC)']],
  BNMPRE: [[-2, 'A', 'Nursery-A'], [-2, 'B', 'Nursery-B'], [-1, 'A', 'LKG-A'], [-1, 'B', 'LKG-B'], [0, 'A', 'UKG-A'], [0, 'B', 'UKG-B']],
  BNMPUC: [[11, 'Sci', 'PUC I Science'], [11, 'Com', 'PUC I Commerce'], [12, 'Sci', 'PUC II Science'], [12, 'Com', 'PUC II Commerce']],
};

const email = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@bnmpschool.in';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: 'tenant-bnm' },
    update: {},
    create: { id: 'tenant-bnm', name: 'BNM Public School', trust: 'Bhageerathi Bai Narayan Rao Maanay Educational Institutions', city: 'Bangalore' },
  });

  const branches = [
    { code: 'BNMPS', name: 'BNM Public School', board: 'ICSE / ISC', color: '#e8650a', since: 2001, city: 'Banashankari II Stage, Bangalore', phone: '080-26713243 / 26710873 / 26714440', email: 'principal@bnmpschool.in', address: 'P.Box No.7087, 12th Main, 27th Cross, Banashankari II Stage, Bangalore - 560070' },
    { code: 'BNMPRE', name: 'BNM Pre-School (Montessori)', board: 'Montessori', color: '#0d9488', since: 2005, city: 'Banashankari, Bangalore' },
    { code: 'BNMPUC', name: 'BNM PU College', board: 'State Board (PUC)', color: '#1d4ed8', since: 2010, city: 'Banashankari, Bangalore' },
  ];
  const settings = { workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], startsAt: '08:30', endsAt: '15:30', termsPerYear: 2, attendanceThreshold: 75 };
  const bid: Record<string, string> = {};
  for (const b of branches) {
    const data = { ...b, settings, modules: b.code === 'BNMPRE' ? { operations: false } : {} };
    const row = await prisma.branch.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: b.code } }, update: data, create: { ...data, tenantId: tenant.id } });
    bid[b.code] = row.id;
  }

  const year = await prisma.academicYear.upsert({
    where: { tenantId_label: { tenantId: tenant.id, label: '2026-27' } },
    update: {},
    create: { tenantId: tenant.id, label: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), current: true },
  });

  // ---------- personas ----------
  // Staff sign in with SEED_PASSWORD (local dev only). Parent and student sign in by OTP on test numbers;
  // in development the code is printed in the API log instead of being sent by SMS.
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) console.warn('SEED_PASSWORD is not set: staff accounts will have no password');
  const passwordHash = seedPassword ? await bcrypt.hash(seedPassword, 12) : null;

  const personas: { key: string; role: Role; name: string; title: string; email: string; branch: string | null; platform?: boolean; phone?: string }[] = [
    { key: 'admin', role: 'admin', name: 'Meera Nair', title: 'Platform Super Admin', email: 'meera@stixis.io', branch: null, platform: true },
    { key: 'director', role: 'manager', name: 'Dr. Rajesh Kumar', title: 'Group Director (Trust)', email: 'director@bnmpschool.in', branch: null, phone: '+919800000013' },
    { key: 'bm', role: 'manager', name: 'Anitha Krishnan', title: 'Branch Manager – BNM Public School', email: 'anitha@bnmpschool.in', branch: 'BNMPS', phone: '+919800000010' },
    { key: 'teacher', role: 'teacher', name: 'Priya Sharma', title: 'Mathematics • Class Teacher 8-A', email: 'priya.sharma@bnmpschool.in', branch: 'BNMPS', phone: '+919800000011' },
    { key: 'accounts', role: 'accounts', name: 'Kavitha Raman', title: 'Accounts Officer – BNM Public School', email: 'kavitha@bnmpschool.in', branch: 'BNMPS', phone: '+919800000012' },
    { key: 'parent', role: 'parent', name: 'Suresh Menon', title: 'Parent of Aarav (8-A) & Diya (6-B)', email: 'suresh.menon@mail.com', branch: 'BNMPS', phone: '+919800000001' },
    { key: 'student', role: 'student', name: 'Aarav Menon', title: 'Class 8-A • Roll 1', email: 'aarav.menon@students.bnmpschool.in', branch: 'BNMPS', phone: '+919800000002' },
  ];
  const uid: Record<string, string> = {};
  for (const u of personas) {
    const isStaff = u.role !== 'parent' && u.role !== 'student';
    const data = { role: u.role, name: u.name, title: u.title, tenantId: u.platform ? null : tenant.id, branchId: u.branch ? bid[u.branch] : null, phone: u.phone ?? null, passwordHash: isStaff ? passwordHash : null, active: true };
    const row = await prisma.user.upsert({ where: { email: u.email }, update: data, create: { ...data, email: u.email } });
    uid[u.key] = row.id;
  }

  // ---------- subjects, staff, classes, students ----------
  let studentCount = 0;
  let staffCount = 0;
  let classCount = 0;
  let sidn = 0;
  for (const [bi, b] of branches.entries()) {
    const branchId = bid[b.code];

    for (const [name, code, type] of SUBJECTS) {
      await prisma.subject.upsert({ where: { branchId_code: { branchId, code } }, update: { name, type }, create: { branchId, name, code, type, active: !(b.code === 'BNMPRE' && code === 'CS') } });
    }

    // Two teachers per subject + four office staff, with stable ids so re-runs update in place.
    const teacherIds: string[] = [];
    for (const [si, [subject]] of SUBJECTS.entries()) {
      for (const k of [0, 1]) {
        const idx = si * 2 + k;
        const i = bi * 14 + idx;
        let name = `${SF[i % SF.length]} ${LN[(i * 7 + 3) % LN.length]}`;
        let userId: string | null = null;
        if (b.code === 'BNMPS' && si === 1 && k === 0) {
          name = 'Priya Sharma';
          userId = uid.teacher;
        }
        const id = `seed-staff-${b.code}-T${pad(idx + 1)}`;
        const data = { branchId, name, role: 'Teacher', subject, email: email(name), phone: userId ? '+919800000011' : `+9196${pad(bi * 100 + idx, 8)}`, qualification: pick(['M.Sc, B.Ed', 'M.A, B.Ed', 'M.Tech, B.Ed', 'B.Sc, B.Ed']), joinedOn: new Date(`${2012 + ri(0, 12)}-06-01`), status: 'Active', userId };
        await prisma.staff.upsert({ where: { id }, update: data, create: { id, ...data } });
        teacherIds.push(id);
        staffCount++;
      }
    }
    const office: [string, string, string | null][] = [
      ['Accounts Officer', 'Accounts', b.code === 'BNMPS' ? 'accounts' : null],
      ['Front Office', 'Admin', null],
      ['Transport Incharge', 'Transport', null],
      ['Librarian', 'Library', null],
    ];
    for (const [k, [role, dept, persona]] of office.entries()) {
      const name = persona === 'accounts' ? 'Kavitha Raman' : `${SF[(bi * 5 + k + 11) % SF.length]} ${LN[(bi * 3 + k * 5 + 1) % LN.length]}`;
      const id = `seed-staff-${b.code}-E${pad(k + 1)}`;
      const data = { branchId, name, role, subject: dept, email: email(name), phone: persona ? '+919800000012' : `+9195${pad(bi * 100 + k, 8)}`, qualification: 'B.Com', status: 'Active', userId: persona ? uid[persona] : null };
      await prisma.staff.upsert({ where: { id }, update: data, create: { id, ...data } });
      staffCount++;
    }
    if (b.code === 'BNMPS') {
      const id = 'seed-staff-BNMPS-M01';
      const data = { branchId, name: 'Anitha Krishnan', role: 'Branch Manager', subject: 'Administration', email: 'anitha@bnmpschool.in', phone: '+919800000010', qualification: 'M.A, M.Ed', status: 'Active', userId: uid.bm };
      await prisma.staff.upsert({ where: { id }, update: data, create: { id, ...data } });
      staffCount++;
    }

    for (const [c, [grade, section, name]] of CLASSES[b.code].entries()) {
      const classTeacherId = b.code === 'BNMPS' && name === '8-A' ? `seed-staff-BNMPS-T03` : teacherIds[(c * 3) % teacherIds.length];
      const cls = await prisma.schoolClass.upsert({
        where: { branchId_academicYearId_name: { branchId, academicYearId: year.id, name } },
        update: { grade, section, classTeacherId, room: `R${101 + c}` },
        create: { branchId, academicYearId: year.id, grade, section, name, classTeacherId, room: `R${101 + c}` },
      });
      classCount++;

      for (let j = 0; j < 8; j++) {
        sidn++;
        const female = rnd() < 0.5;
        let sname = `${female ? pick(FF) : pick(FM)} ${pick(LN)}`;
        const last = sname.split(' ')[1];
        let father = `${pick(FM)} ${last}`;
        let fatherPhone = `+9197${pad(sidn, 8)}`;
        let studentUserId: string | null = null;
        let gender = female ? 'F' : 'M';
        const isAarav = b.code === 'BNMPS' && name === '8-A' && j === 0;
        const isDiya = b.code === 'BNMPS' && name === '6-B' && j === 0;
        if (isAarav || isDiya) {
          sname = isAarav ? 'Aarav Menon' : 'Diya Menon';
          gender = isAarav ? 'M' : 'F';
          father = 'Suresh Menon';
          fatherPhone = '+919800000001';
          studentUserId = isAarav ? uid.student : null;
        }
        const admissionNo = `${b.code}26-${pad(sidn, 4)}`;
        const data = {
          classId: cls.id,
          name: sname,
          gender,
          rollNo: j + 1,
          dob: new Date(`${2026 - Math.max(grade, -2) - 6}-${pad(ri(1, 12))}-${pad(ri(1, 28))}`),
          bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'A-']),
          house: pick(['Red', 'Blue', 'Green', 'Yellow']),
          admittedOn: new Date(`${2026 - Math.max(0, grade - 5)}-06-01`),
          status: 'Active',
          userId: studentUserId,
        };
        const st = await prisma.student.upsert({ where: { branchId_admissionNo: { branchId, admissionNo } }, update: data, create: { branchId, admissionNo, ...data } });
        studentCount++;

        // Father is the primary guardian; about half the students also have the mother on record.
        const fatherUser =
          father === 'Suresh Menon'
            ? { id: uid.parent }
            : await prisma.user.upsert({ where: { phone: fatherPhone }, update: { name: father }, create: { tenantId: tenant.id, branchId, role: 'parent', name: father, title: 'Parent', phone: fatherPhone } });
        await prisma.studentGuardian.upsert({ where: { studentId_userId: { studentId: st.id, userId: fatherUser.id } }, update: { relation: 'Father', primary: true }, create: { studentId: st.id, userId: fatherUser.id, relation: 'Father', primary: true } });
        if (rnd() < 0.5 && father !== 'Suresh Menon') {
          const motherPhone = `+9194${pad(sidn, 8)}`;
          const mother = await prisma.user.upsert({ where: { phone: motherPhone }, update: {}, create: { tenantId: tenant.id, branchId, role: 'parent', name: `${pick(FF)} ${last}`, title: 'Parent', phone: motherPhone } });
          await prisma.studentGuardian.upsert({ where: { studentId_userId: { studentId: st.id, userId: mother.id } }, update: { relation: 'Mother' }, create: { studentId: st.id, userId: mother.id, relation: 'Mother' } });
        }
      }
    }
  }
  console.log(`Seeded ${tenant.name}: ${branches.length} branches, ${personas.length} personas, ${classCount} classes, ${staffCount} staff, ${studentCount} students`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
