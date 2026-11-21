import { STUDENT_IMPORT_COLUMNS } from '@sms/shared';
import { parseCsv, readRecords, toCsvLine } from './csv';
import { mapStaffRow, mapStudentRow, type StudentRowContext } from './imports.controller';

describe('parseCsv', () => {
  it('handles quotes, embedded commas, newlines and escaped quotes', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","line1\nline2","say ""hi"""\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'line1\nline2', 'say "hi"'],
    ]);
  });

  it('strips the Excel BOM and skips blank lines', () => {
    expect(parseCsv('﻿name\n\nAarav\n,\n')).toEqual([['name'], ['Aarav']]);
  });

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a\n"broken')).toThrow(/unclosed quote/);
  });

  it('round-trips through toCsvLine', () => {
    const v = ['plain', 'with, comma', 'with "quote"'];
    expect(parseCsv(toCsvLine(v))[0]).toEqual(v);
  });
});

describe('readRecords', () => {
  it('reports unknown and missing columns', () => {
    const { headerErrors } = readRecords('name,shoe_size\nA,9', STUDENT_IMPORT_COLUMNS, ['name', 'guardian_phone']);
    expect(headerErrors.join(' ')).toMatch(/Unknown column\(s\): shoe_size/);
    expect(headerErrors.join(' ')).toMatch(/Missing column\(s\): guardian_phone/);
  });

  it('numbers lines from the header', () => {
    const { records } = readRecords('Name,Guardian Phone\nA,1\nB,2', STUDENT_IMPORT_COLUMNS, []);
    expect(records.map((r) => [r.line, r.data.name, r.data.guardian_phone])).toEqual([
      [2, 'A', '1'],
      [3, 'B', '2'],
    ]);
  });
});

describe('mapStudentRow', () => {
  const ctx = (): StudentRowContext => ({ classIdByName: new Map([['8-A', 'class-8a']]), existingAdmissionNos: new Set(['BNMPS26-0001']), seenAdmissionNos: new Set() });
  const row = (data: Record<string, string>, line = 2) => ({ line, data: { name: 'Aarav', guardian_name: 'Suresh', guardian_phone: '9876543210', ...data } });

  it('maps a valid row', () => {
    const { input, errors } = mapStudentRow(row({ class: '8-A', gender: 'male', dob: '14/06/2013', guardian2_name: 'Lakshmi', guardian2_phone: '9876543211' }), 'b1', ctx());
    expect(errors).toEqual([]);
    expect(input).toMatchObject({ classId: 'class-8a', gender: 'M', status: 'Active' });
    expect(input.guardians.map((g) => [g.relation, g.primary])).toEqual([
      ['Father', true],
      ['Mother', false],
    ]);
  });

  it('collects every problem in a row', () => {
    const { errors } = mapStudentRow(row({ name: '', class: '13-Z', gender: 'X', guardian_phone: '12345', dob: '2013-02-30', status: 'Expelled' }), 'b1', ctx());
    expect(errors).toEqual(
      expect.arrayContaining([
        'name is required',
        expect.stringMatching(/class "13-Z" not found/),
        expect.stringMatching(/gender "X"/),
        expect.stringMatching(/guardian_phone "12345"/),
        expect.stringMatching(/dob "2013-02-30"/),
        expect.stringMatching(/status "Expelled"/),
      ]),
    );
  });

  it('flags admission numbers that exist or repeat in the file', () => {
    const c = ctx();
    expect(mapStudentRow(row({ admission_no: 'bnmps26-0001' }), 'b1', c).errors).toContain('admission_no bnmps26-0001 already exists');
    mapStudentRow(row({ admission_no: 'X-1' }), 'b1', c);
    expect(mapStudentRow(row({ admission_no: 'x-1' }, 3), 'b1', c).errors).toContain('admission_no x-1 appears more than once in the file');
  });

  it('rejects the same number for both guardians', () => {
    const { errors } = mapStudentRow(row({ guardian2_name: 'M', guardian2_phone: '+91 98765 43210' }), 'b1', ctx());
    expect(errors).toContain('guardian_phone and guardian2_phone are the same number');
  });
});

describe('mapStaffRow', () => {
  it('requires a phone for login access and blocks manager access for branch managers', () => {
    const seen = new Set<string>();
    expect(mapStaffRow({ line: 2, data: { name: 'A', role: 'Teacher', access: 'teacher' } }, 'b1', false, seen).errors).toContain('phone is required for staff with login access');
    expect(mapStaffRow({ line: 3, data: { name: 'B', role: 'Head', access: 'manager', phone: '9876543210' } }, 'b1', false, seen).errors).toContain(
      'only the School Admin can import staff with manager access',
    );
  });

  it('flags a phone used twice in the file', () => {
    const seen = new Set<string>();
    mapStaffRow({ line: 2, data: { name: 'A', role: 'Teacher', phone: '9876543210' } }, 'b1', true, seen);
    expect(mapStaffRow({ line: 3, data: { name: 'B', role: 'Teacher', phone: '98765 43210' } }, 'b1', true, seen).errors).toContain('phone 98765 43210 appears more than once in the file');
  });
});
