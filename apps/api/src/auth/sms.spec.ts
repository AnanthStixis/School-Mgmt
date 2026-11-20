import { normalisePhone } from './sms';

describe('normalisePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
  ])('accepts %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each(['12345', '5876543210', '+1 415 555 0100', 'abcdefghij'])('rejects %s', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });
});
