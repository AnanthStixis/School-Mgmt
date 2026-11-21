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
    update: { receiptPrefix: 'BNMPS' },
    create: { id: 'tenant-bnm', receiptPrefix: 'BNMPS', name: 'BNM Public School', trust: 'Bhageerathi Bai Narayan Rao Maanay Educational Institutions', city: 'Bangalore' },
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
  // Staff sign in with SEED_PASSWORD (local dev only). The parent signs in by OTP on a test number
  // (in development the code is printed in the API log instead of being sent by SMS). The student
  // signs in with their admission number and SEED_PASSWORD (set below, once the student exists).
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
    { key: 'student', role: 'student', name: 'Aarav Menon', title: 'Class 8-A • Roll 1', email: 'aarav.menon@students.bnmpschool.in', branch: 'BNMPS' },
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
      // Priya Sharma (T03) is class teacher of 8-A only, matching her persona.
      let classTeacherId = b.code === 'BNMPS' && name === '8-A' ? `seed-staff-BNMPS-T03` : teacherIds[(c * 3) % teacherIds.length];
      if (classTeacherId === 'seed-staff-BNMPS-T03' && name !== '8-A') classTeacherId = teacherIds[(c * 3 + 1) % teacherIds.length];
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
        if (studentUserId) await prisma.user.update({ where: { id: studentUserId }, data: { username: admissionNo.toUpperCase(), passwordHash } });
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
  // ---------- admissions: next year's intake is open ----------
  const nextYear = await prisma.academicYear.upsert({
    where: { tenantId_label: { tenantId: tenant.id, label: '2027-28' } },
    update: {},
    create: { tenantId: tenant.id, label: '2027-28', startsOn: new Date('2027-04-01'), endsOn: new Date('2028-03-31') },
  });
  const kids = ['Ritvik', 'Samaira', 'Advik', 'Myra', 'Reyansh', 'Anvi', 'Kian', 'Zara', 'Neil', 'Tara', 'Ayaan', 'Navya', 'Rudra', 'Sara'];
  const stages = ['Enquiry', 'Enquiry', 'Enquiry', 'Applied', 'Applied', 'Applied', 'Test/Interview', 'Test/Interview', 'Test/Interview', 'Admitted', 'Admitted', 'Enquiry', 'Applied', 'Dropped'];
  const sources = ['Website', 'Walk-in', 'Referral', 'Facebook Ad', 'Google Ad'];
  for (const [i, kid] of kids.entries()) {
    const b = branches[i % 3];
    const last = pick(LN);
    const grade = b.code === 'BNMPRE' ? pick([-2, -1, 0]) : b.code === 'BNMPUC' ? 11 : pick([1, 5, 6, 8, 9]);
    const id = `seed-enq-${pad(i + 1)}`;
    const created = new Date(Date.now() - ri(2, 30) * 86_400_000);
    const data = {
      tenantId: tenant.id,
      branchId: bid[b.code],
      academicYearId: i < 12 ? nextYear.id : year.id,
      childName: `${kid} ${last}`,
      gender: i % 2 ? 'F' : 'M',
      grade,
      parentName: `${pick(FM)} ${last}`,
      parentPhone: `+9193${pad(i + 1, 8)}`,
      city: 'Bangalore',
      previousSchool: grade > 0 ? pick(['Delhi Public School', 'Kendriya Vidyalaya', 'National Public School', 'Sri Kumaran']) : null,
      previousBoard: grade > 0 ? pick(['CBSE', 'State', 'ICSE']) : null,
      siblingInSchool: i === 4,
      source: pick(sources),
      stage: stages[i],
      dropReason: stages[i] === 'Dropped' ? 'Chose a school closer to home' : null,
      nextFollowUp: ['Enquiry', 'Applied'].includes(stages[i]) ? new Date(Date.now() + (ri(-2, 5) * 86_400_000)) : null,
      createdAt: created,
    };
    await prisma.enquiry.upsert({ where: { id }, update: data, create: { id, ...data } });
    await prisma.enquiryActivity.deleteMany({ where: { enquiryId: id } });
    await prisma.enquiryActivity.create({ data: { enquiryId: id, kind: 'created', text: `Enquiry recorded (source: ${data.source})`, byName: 'Front Office', at: created } });
    if (stages[i] !== 'Enquiry') await prisma.enquiryActivity.create({ data: { enquiryId: id, kind: 'stage', text: `Enquiry → ${stages[i] === 'Dropped' ? 'Dropped: ' + data.dropReason : stages[i]}`, byName: 'Anitha Krishnan', at: new Date(created.getTime() + 86_400_000) } });
  }

  // ---------- attendance: about 8 weeks of history up to yesterday (today is left to mark) ----------
  const ist = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let k = 1; days.length < 45 && k < 90; k++) {
    const d = ist(Date.now() - k * 86_400_000);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 && d >= '2026-04-01') days.push(d); // Mon–Sat
  }
  const allClasses = await prisma.schoolClass.findMany({ where: { academicYearId: year.id }, include: { students: { where: { status: { in: ['Active', 'Temporary'] } }, select: { id: true } }, classTeacher: true } });
  // Each student gets a steady "attendance habit" so some fall below the 75% threshold.
  const habit = (id: string) => {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 0.68 + ((h % 1000) / 1000) * 0.31;
  };
  let recs = 0;
  for (const c of allClasses) {
    const records: { studentId: string; classId: string; date: Date; status: string }[] = [];
    for (const d of days) for (const st of c.students) {
      const r = rnd();
      const p = habit(st.id);
      records.push({ studentId: st.id, classId: c.id, date: new Date(`${d}T00:00:00Z`), status: r < p ? 'P' : r < p + (1 - p) * 0.3 ? 'L' : 'A' });
    }
    recs += (await prisma.attendanceRecord.createMany({ data: records, skipDuplicates: true })).count;
    await prisma.attendanceRegister.createMany({ data: days.map((d) => ({ classId: c.id, date: new Date(`${d}T00:00:00Z`), submittedBy: c.classTeacher?.name ?? 'Class teacher', submittedAt: new Date(`${d}T03:30:00Z`) })), skipDuplicates: true });
  }

  // ---------- fees: PLACEHOLDER chart from the POC until the school sends its real fee chart ----------
  const BANDS: Record<string, [string, number, number][]> = {
    BNMPS: [['G1–G4', 1, 4], ['G5–G7', 5, 7], ['G8–G10', 8, 10], ['G11–G12', 11, 12]],
    BNMPRE: [['Pre-primary', -2, 0]],
    BNMPUC: [['PU', 11, 12]],
  };
  const ADM = ['Re-admission', 'New Admission', 'UKG to ICSE', 'State to ICSE'];
  const SCHOOL_RATES: Record<string, Record<string, number[]>> = {
    BNMPS: { 'G1–G4': [70000, 78000, 78000, 82000], 'G5–G7': [82000, 92000, 92000, 96000], 'G8–G10': [90000, 100000, 100000, 104000], 'G11–G12': [80000, 90000, 90000, 94000] },
    BNMPRE: { 'Pre-primary': [48000, 56000] },
    BNMPUC: { PU: [70000, 78000] },
  };
  const SLABS: [string, number][] = [['Within 1 km', 10000], ['1 to 2 km', 14000], ['2 to 3 km', 16000], ['3 to 4 km', 18000], ['4 to 6 km', 22000], ['Above 6 km', 26000]];
  const due = (md: string[]) => md.map((d, k) => ({ seq: k + 1, dueDate: new Date(`${d}T00:00:00Z`) }));
  let feeAssignments = 0;
  for (const b of branches) {
    const branchId = bid[b.code];
    for (const [name, fromGrade, toGrade] of BANDS[b.code]) await prisma.feeBand.upsert({ where: { branchId_name: { branchId, name } }, update: { fromGrade, toGrade }, create: { branchId, name, fromGrade, toGrade } });
    const types = [
      { kind: 'SCHOOL', name: 'School Fees 26-27', comp: 'School Fee', plan: due(['2026-04-05', '2026-07-05', '2026-10-05', '2027-01-05']).map((x) => ({ ...x, label: `Installment ${x.seq}` })),
        rates: Object.entries(SCHOOL_RATES[b.code]).flatMap(([band, amounts]) => amounts.map((a, i) => [`${band}|${ADM[i]}`, a] as [string, number])) },
      { kind: 'APPLICATION', name: 'Application Fee 26-27', comp: 'Application Fee', plan: due(['2026-04-05']).map((x) => ({ ...x, label: 'Application Fee' })), rates: [['*', 1500]] as [string, number][] },
      ...(b.code === 'BNMPRE' ? [] : [{ kind: 'TRANSPORT', name: 'Transportation Fees 26-27', comp: 'Transport Fee', plan: due(['2026-04-05', '2026-10-05']).map((x) => ({ ...x, label: `Transport Inst ${x.seq}` })),
        rates: SLABS.flatMap(([slab, amt]) => [[`${slab}|Pickup & Drop`, amt], [`${slab}|Pickup`, Math.round((amt * 0.6) / 100) * 100], [`${slab}|Drop`, Math.round((amt * 0.6) / 100) * 100]] as [string, number][]) }]),
    ];
    for (const t of types) {
      const ft = await prisma.feeType.upsert({
        where: { branchId_academicYearId_name: { branchId, academicYearId: year.id, name: t.name } },
        update: { kind: t.kind, components: [{ name: t.comp, percent: 100 }] },
        create: { branchId, academicYearId: year.id, kind: t.kind, name: t.name, components: [{ name: t.comp, percent: 100 }] },
      });
      if (!(await prisma.feeAssignment.count({ where: { feeTypeId: ft.id } }))) {
        await prisma.feeInstallmentPlan.deleteMany({ where: { feeTypeId: ft.id } });
        await prisma.feeInstallmentPlan.createMany({ data: t.plan.map((p) => ({ feeTypeId: ft.id, ...p })) });
      }
      await prisma.feeRate.deleteMany({ where: { feeTypeId: ft.id } });
      await prisma.feeRate.createMany({ data: t.rates.map(([key, amount]) => ({ feeTypeId: ft.id, key, amount })) });
    }

    // Fee profile + assignments. Most invoices are published; a few per branch are left for the accounts team to review.
    const bands = await prisma.feeBand.findMany({ where: { branchId } });
    const fts = await prisma.feeType.findMany({ where: { branchId, academicYearId: year.id }, include: { installments: { orderBy: { seq: 'asc' } }, rates: true } });
    const students = await prisma.student.findMany({ where: { branchId, status: { in: ['Active', 'Temporary'] }, class: { academicYearId: year.id } }, include: { class: true } });
    for (const [i, st] of students.entries()) {
      const demo = ['Aarav Menon', 'Diya Menon'].includes(st.name);
      const admissionType = demo ? 'Re-admission' : rnd() < 0.2 ? 'New Admission' : 'Re-admission';
      const transport = b.code !== 'BNMPRE' && (demo ? st.name === 'Aarav Menon' : rnd() < 0.4);
      const slab = transport ? (st.name === 'Aarav Menon' ? '2 to 3 km' : pick(SLABS)[0]) : null;
      const pickupMode = transport ? (rnd() < 0.8 ? 'Pickup & Drop' : pick(['Pickup', 'Drop'])) : null;
      await prisma.student.update({ where: { id: st.id }, data: { admissionType, transportSlab: slab, pickupMode, rte: !demo && rnd() < 0.02, staffKid: !demo && rnd() < 0.03 } });
      const published = demo || i % 15 !== 7;
      for (const ft of fts) {
        if (await prisma.feeAssignment.findUnique({ where: { studentId_feeTypeId: { studentId: st.id, feeTypeId: ft.id } } })) continue;
        let key: string | null = null;
        let category = '';
        if (ft.kind === 'SCHOOL') {
          const band = bands.find((x) => st.class!.grade >= x.fromGrade && st.class!.grade <= x.toGrade);
          key = band ? `${band.name}|${admissionType}` : null;
          category = `${band?.name} · ${admissionType}`;
        } else if (ft.kind === 'APPLICATION' && admissionType === 'New Admission') {
          key = '*';
          category = 'Application fee';
        } else if (ft.kind === 'TRANSPORT' && slab) {
          key = `${slab}|${pickupMode}`;
          category = `${slab} · ${pickupMode}`;
        }
        const amount = key ? ft.rates.find((r) => r.key === key)?.amount : undefined;
        if (!amount) continue;
        const n = ft.installments.length;
        const each = Math.round(amount / n);
        await prisma.feeAssignment.create({
          data: {
            studentId: st.id,
            feeTypeId: ft.id,
            category,
            gross: amount,
            status: published ? 'PUBLISHED' : 'ASSIGNED',
            onlineEnabled: published,
            confirmedAt: published ? new Date('2026-03-20') : null,
            publishedAt: published ? new Date('2026-03-25') : null,
            invoices: { create: ft.installments.map((p, k) => ({ studentId: st.id, seq: p.seq, label: p.label, dueDate: p.dueDate, gross: k === n - 1 ? amount - each * (n - 1) : each })) },
          },
        });
        feeAssignments++;
      }
    }
  }

  // ---------- past payments ----------
  // Most families paid the April and July installments (some a little late, with the ₹25/day late fee),
  // so balances and receipts look like a school mid-year. Aarav and Diya leave October unpaid to show a late fee.
  // Runs only once: skipped when the school already has receipts.
  let receiptCount = 0;
  if (!(await prisma.feeReceipt.count({ where: { tenantId: tenant.id } }))) {
    const LATE_PER_DAY = 25;
    const MODES: [string, number][] = [['UPI', 45], ['Cash', 15], ['Net Banking', 15], ['Cheque', 12], ['Credit Card', 6], ['Debit Card', 5], ['DD', 2]];
    const wmode = () => {
      let r = rnd() * 100;
      for (const [m, w] of MODES) if ((r -= w) < 0) return m;
      return 'UPI';
    };
    const BANKS = ['SBI', 'Canara Bank', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Karnataka Bank'];
    const dayMs = 86_400_000;
    const invoices = await prisma.feeInvoice.findMany({
      where: { dueDate: { lt: new Date('2026-08-01') }, assignment: { status: 'PUBLISHED', feeType: { academicYearId: year.id } } },
      include: { assignment: { include: { feeType: true, student: { select: { id: true, name: true, branchId: true } } } } },
      orderBy: [{ dueDate: 'asc' }, { studentId: 'asc' }, { seq: 'asc' }],
    });
    // One receipt per student per due date (school + transport paid together).
    const groups = new Map<string, typeof invoices>();
    for (const inv of invoices) {
      const k = `${inv.studentId}|${inv.dueDate.toISOString()}`;
      groups.set(k, [...(groups.get(k) ?? []), inv]);
    }
    const planned: { date: Date; invs: typeof invoices; late: number }[] = [];
    for (const invs of groups.values()) {
      const july = invs[0].dueDate.getUTCMonth() === 6;
      const demo = ['Aarav Menon', 'Diya Menon'].includes(invs[0].assignment.student.name);
      const skip = rnd() > (july ? 0.86 : 0.93); // a few families still owe
      if (skip && !demo) continue;
      const late = rnd() < 0.15 && !demo ? ri(1, 20) : 0;
      planned.push({ date: new Date(invs[0].dueDate.getTime() + (late ? late : -ri(0, 10)) * dayMs), invs, late });
    }
    planned.sort((a, b) => a.date.getTime() - b.date.getTime());
    const accountant = await prisma.user.findUniqueOrThrow({ where: { id: uid.accounts } });
    for (const p of planned) {
      receiptCount++;
      const mode = wmode();
      const lines = p.invs.map((inv) => ({ invoiceId: inv.id, label: `${inv.assignment.feeType.name} · ${inv.label}`, fee: inv.gross, fine: p.late * LATE_PER_DAY }));
      const fee = lines.reduce((n, l) => n + l.fee, 0);
      const fine = lines.reduce((n, l) => n + l.fine, 0);
      const instrument = mode === 'Cheque' || mode === 'DD';
      await prisma.feeReceipt.create({
        data: {
          tenantId: tenant.id,
          branchId: p.invs[0].assignment.student.branchId,
          studentId: p.invs[0].studentId,
          academicYearId: year.id,
          no: `BNMPS/${year.label}/${pad(receiptCount, 4)}`,
          date: p.date,
          mode,
          source: 'Counter',
          feeTotal: fee,
          fineTotal: fine,
          total: fee + fine,
          bank: instrument ? pick(BANKS) : null,
          instrumentNo: instrument ? String(ri(100000, 999999)) : null,
          instrumentDate: instrument ? new Date(p.date.getTime() - ri(0, 3) * dayMs) : null,
          reference: ['UPI', 'Net Banking'].includes(mode) ? `UTR${ri(100000000, 999999999)}` : null,
          recon: ['Cheque', 'Net Banking'].includes(mode) ? 'DONE' : 'NA',
          createdById: accountant.id,
          createdByName: accountant.name,
          createdAt: new Date(p.date.getTime() + 5 * 3_600_000),
          lines: { create: lines },
        },
      });
      for (const l of lines) {
        await prisma.feeInvoice.update({ where: { id: l.invoiceId }, data: { paid: l.fee, finePaid: l.fine, fineFrom: l.fine ? p.date : null } });
      }
    }
    await prisma.receiptSequence.upsert({
      where: { tenantId_yearLabel: { tenantId: tenant.id, yearLabel: year.label } },
      create: { tenantId: tenant.id, yearLabel: year.label, last: receiptCount },
      update: { last: receiptCount },
    });
  }

  console.log(`Seeded ${tenant.name}: ${branches.length} branches, ${personas.length} personas, ${classCount} classes, ${staffCount} staff, ${studentCount} students, ${kids.length} enquiries, ${recs} new attendance marks over ${days.length} days, ${feeAssignments} new fee assignments, ${receiptCount} past receipts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
