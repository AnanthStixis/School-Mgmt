import { invoiceStatus, quote, splitEqually } from './fees.service';

describe('splitEqually', () => {
  it('splits like the existing system (82,000 → 4 × 20,500)', () => {
    expect(splitEqually(82000, 4)).toEqual([20500, 20500, 20500, 20500]);
  });

  it('puts the rounding on the last installment so the total is exact', () => {
    const parts = splitEqually(10001, 3);
    expect(parts).toEqual([3334, 3334, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10001);
  });
});

describe('quote', () => {
  const bands = [
    { name: 'G1–G4', fromGrade: 1, toGrade: 4 },
    { name: 'G5–G7', fromGrade: 5, toGrade: 7 },
  ];
  const rates = new Map([
    ['G5–G7|Re-admission', 82000],
    ['G5–G7|New Admission', 92000],
    ['2 to 3 km|Pickup & Drop', 16000],
    ['*', 1500],
  ]);
  const student = { grade: 6, admissionType: 'Re-admission', transportSlab: '2 to 3 km', pickupMode: 'Pickup & Drop' };

  it('prices the school fee by class band and admission type', () => {
    expect(quote('SCHOOL', student, bands, rates)).toEqual({ category: 'G5–G7 · Re-admission', amount: 82000 });
    expect(quote('SCHOOL', { ...student, admissionType: 'New Admission' }, bands, rates)).toEqual({ category: 'G5–G7 · New Admission', amount: 92000 });
  });

  it('explains why there is no price', () => {
    expect(quote('SCHOOL', { ...student, grade: 9 }, bands, rates)).toEqual({ reason: 'No class band covers grade 9' });
    expect(quote('SCHOOL', { ...student, grade: 2 }, bands, rates)).toEqual({ reason: 'No rate for G1–G4 · Re-admission' });
    expect(quote('TRANSPORT', { ...student, transportSlab: null }, bands, rates)).toEqual({ reason: 'No transport slab / pickup mode on the student' });
    expect(quote('CUSTOM', student, bands, rates)).toEqual({ reason: 'Enter the amount for this custom fee' });
  });

  it('prices transport by slab and pickup mode, and application/custom fees', () => {
    expect(quote('TRANSPORT', student, bands, rates)).toEqual({ category: '2 to 3 km · Pickup & Drop', amount: 16000 });
    expect(quote('APPLICATION', student, bands, rates)).toEqual({ category: 'Application fee', amount: 1500 });
    expect(quote('CUSTOM', student, bands, rates, 2500)).toEqual({ category: 'Custom amount', amount: 2500 });
  });
});

describe('invoiceStatus', () => {
  const inv = (o: Partial<{ gross: number; concession: number; adjustment: number; paid: number; dueDate: string }>) => ({
    gross: 20500,
    concession: 0,
    adjustment: 0,
    paid: 0,
    ...o,
    dueDate: new Date(`${o.dueDate ?? '2026-07-05'}T00:00:00Z`),
  });
  it('is Pending before the due date and Overdue after', () => {
    expect(invoiceStatus(inv({}), '2026-07-05')).toBe('Pending');
    expect(invoiceStatus(inv({}), '2026-07-06')).toBe('Overdue');
  });
  it('is Partial with some payment and Paid when nothing is left (concessions count)', () => {
    expect(invoiceStatus(inv({ paid: 10000 }), '2026-08-01')).toBe('Partial');
    expect(invoiceStatus(inv({ paid: 18500, concession: 2000 }), '2026-08-01')).toBe('Paid');
  });
});
