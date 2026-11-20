import { Injectable, Logger } from '@nestjs/common';

/**
 * Outgoing SMS. The provider (MSG91, Gupshup…) is not chosen yet, so only a
 * development sender exists. Bind a real implementation to SMS_SENDER when it is.
 */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

/** Writes messages to the server log instead of sending them. Refused in production (see auth.module.ts). */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly log = new Logger('SMS (dev)');

  async send(phone: string, text: string): Promise<void> {
    this.log.log(`to ${phone}: ${text}`);
  }
}

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Returns null when the input is not a valid mobile number.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let n = digits.startsWith('+') ? digits.slice(1) : digits;
  if (n.length === 10) n = '91' + n;
  else if (n.length === 11 && n.startsWith('0')) n = '91' + n.slice(1);
  if (!/^91[6-9]\d{9}$/.test(n)) return null;
  return '+' + n;
}
