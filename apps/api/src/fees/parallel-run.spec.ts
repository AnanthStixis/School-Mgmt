import { normaliseClassName, normaliseHeader, parseLooseDate, parseRupees, STUDENT_HEADER_ALIASES, STUDENT_IMPORT_COLUMNS, STUDENT_PROFILE_COLUMNS } from '@sms/shared';
import { readRecords } from '../imports/csv';
import { mapStudentRow, previousYearLabel } from '../imports/imports.controller';
import { compareCollections } from './parallel-run';

describe('SchoolElement formats', () => {
  it('matches class names however they are written', () => {
    for (const v of ['VIII-A', '8 A', 'Class 8 / A', '8th-A', 'viii a', 'STD VIII - A']) expect(normaliseClassName(v)).toBe('8-A');
    expect(normaliseClassName('XI (ISC)')).toBe(normaliseClassName('11 ISC'));
    expect(normaliseClassName('LKG-B')).toBe('LKG-B');
  });

  it('reads Indian day-first dates and rupee amounts', () => {
    expect(parseLooseDate('2027-03-31')).toBe('2027-03-31');
    expect(parseLooseDate('31-03-2027')).toBe('2027-03-31');
    expect(parseLooseDate('05/04/2027')).toBe('2027-04-05');
    expect(parseLooseDate('5-Apr-2027')).toBe('2027-04-05');
    expect(parseLooseDate('31-02-2027')).toBeNull();
    expect(parseLooseDate('yesterday')).toBeNull();
    expect(parseRupees('₹ 1,23,456.00')).toBe(123456);
    expect(parseRupees('Rs. 20,500')).toBe(20500);
    expect(parseRupees('20500.50')).toBeNull();
    expect(previousYearLabel('2026-27')).toBe('2025-26');
    expect(previousYearLabel('2099-00')).toBe('2098-99');
  });

  it('maps SchoolElement headers and ignores columns we do not use', () => {
    expect(normaliseHeader("Father's Mobile No.")).toBe('fathers_mobile_no');
    const csv = [
      'Admission No,Enrollment No,Student Name,Class/Section,Date of Birth,Gender,Father Name,Father Mobile,Mother Name,Mother Mobile,RTE/NON-RTE,New Admission or Re-Admission,Student Status',
      'BNMPS25-0099,E-77,Kiran Rao,VIII-A,14-06-2013,Male,Ravi Rao,9876543210,Sita Rao,9876543211,NON-RTE,Re-Admission,Active',
    ].join('\n');
    const { records, headerErrors, ignored } = readRecords(csv, [...STUDENT_IMPORT_COLUMNS, ...STUDENT_PROFILE_COLUMNS], ['name', 'guardian_name', 'guardian_phone'], { aliases: STUDENT_HEADER_ALIASES, ignoreUnknown: true });
    expect(headerErrors).toEqual([]);
    expect(ignored).toEqual(['Enrollment No']);
    const m = mapStudentRow(records[0], 'b1', { classIdByName: new Map([['8-A', 'c8a']]), existingAdmissionNos: new Set(), seenAdmissionNos: new Set() });
    expect(m.errors).toEqual([]);
    expect(m.input).toMatchObject({ admissionNo: 'BNMPS25-0099', name: 'Kiran Rao', classId: 'c8a', dob: '2013-06-14', gender: 'M', status: 'Active' });
    expect(m.input.guardians.map((g) => [g.name, g.relation, g.primary])).toEqual([
      ['Ravi Rao', 'Father', true],
      ['Sita Rao', 'Mother', false],
    ]);
    expect(m.profile).toEqual({ admissionType: 'Re-admission', rte: false });
  });

  it('treats In-active students as Left and explains bad values', () => {
    const rec = { line: 2, data: { name: 'X Y', guardian_name: 'P Q', guardian_phone: '9876543210', status: 'In-active', rte: 'maybe', admission_type: 'Lateral' } };
    const m = mapStudentRow(rec, 'b1', { classIdByName: new Map(), existingAdmissionNos: new Set(), seenAdmissionNos: new Set() });
    expect(m.input.status).toBe('Left');
    expect(m.errors).toEqual(['admission_type "Lateral" must be one of Re-admission, New Admission, UKG to ICSE, State to ICSE', 'rte "maybe" must be RTE or NON-RTE']);
  });
});

describe('compareCollections', () => {
  const p = (date: string, admissionNo: string, amount: number, receiptNo = '') => ({ date, admissionNo, amount, receiptNo });
  it('matches per student per day and lists differences first', () => {
    const rows = compareCollections(
      [p('2027-04-05', 'A1', 20500, 'SE/1'), p('2027-04-05', 'A2', 8000, 'SE/2'), p('2027-04-05', 'A2', 1000, 'SE/3'), p('2027-04-06', 'A3', 5000, 'SE/4')],
      [p('2027-04-05', 'a1', 20500, 'BNMPS/1'), p('2027-04-05', 'A2', 8000, 'BNMPS/2'), p('2027-04-07', 'A4', 700, 'BNMPS/3')],
    );
    expect(rows.map((r) => [r.admissionNo, r.status])).toEqual([
      ['A2', 'DIFFERENT'],
      ['A3', 'ONLY_THEIRS'],
      ['A4', 'ONLY_OURS'],
      ['A1', 'MATCH'],
    ]);
    expect(rows[0].theirs).toEqual({ count: 2, total: 9000, receipts: ['SE/2', 'SE/3'] });
  });
});
