import { allocate, lateFee, rupeesInWords } from '@sms/shared';

describe('lateFee', () => {
  const inv = { balance: 20500, dueDate: '2026-10-05', fineFrom: null };
  it('is zero on or before the due date', () => {
    expect(lateFee(inv, '2026-10-01', 25)).toBe(0);
    expect(lateFee(inv, '2026-10-05', 25)).toBe(0);
  });
  it('charges per day after the due date', () => {
    expect(lateFee(inv, '2026-10-06', 25)).toBe(25);
    expect(lateFee(inv, '2026-11-20', 25)).toBe(46 * 25);
  });
  it('restarts from the day the late fee was last settled', () => {
    expect(lateFee({ ...inv, fineFrom: '2026-11-10' }, '2026-11-20', 25)).toBe(250);
    // A fineFrom before the due date never makes it start earlier.
    expect(lateFee({ ...inv, fineFrom: '2026-09-01' }, '2026-10-07', 25)).toBe(50);
  });
  it('stops once the installment is paid, and when the branch charges none', () => {
    expect(lateFee({ ...inv, balance: 0 }, '2026-11-20', 25)).toBe(0);
    expect(lateFee(inv, '2026-11-20', 0)).toBe(0);
  });
});

describe('rupeesInWords', () => {
  it('writes amounts the Indian way', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
    expect(rupeesInWords(25)).toBe('Rupees Twenty Five Only');
    expect(rupeesInWords(20500)).toBe('Rupees Twenty Thousand Five Hundred Only');
    expect(rupeesInWords(101150)).toBe('Rupees One Lakh One Thousand One Hundred Fifty Only');
    expect(rupeesInWords(12345678)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
  });
});

describe('allocate', () => {
  it('spreads a concession equally, never above an installment’s unpaid part', () => {
    expect(allocate(8000, [20500, 20500, 20500, 20500], 'Equal')).toEqual([2000, 2000, 2000, 2000]);
    expect(allocate(10001, [20500, 20500, 20500], 'Equal')).toEqual([3334, 3334, 3333]);
    // The first installment is paid, so it takes nothing; the rest share it.
    expect(allocate(9000, [0, 20500, 20500, 20500], 'Equal')).toEqual([0, 3000, 3000, 3000]);
    // A small room fills up and the rest spills over.
    expect(allocate(9000, [1000, 20500, 20500], 'Equal')).toEqual([1000, 4000, 4000]);
  });
  it('fills installments in order', () => {
    expect(allocate(25000, [20500, 20500, 20500], 'Order Wise')).toEqual([20500, 4500, 0]);
  });
  it('refuses more than is unpaid', () => {
    expect(allocate(50000, [20500, 20500], 'Equal')).toBeNull();
    expect(allocate(0, [20500], 'Equal')).toEqual([0]);
  });
});
