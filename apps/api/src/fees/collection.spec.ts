import { lateFee, rupeesInWords } from '@sms/shared';

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
