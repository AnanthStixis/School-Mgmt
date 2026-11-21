import { Logger } from '@nestjs/common';

/**
 * Outgoing e-mail. No provider is chosen yet (Amazon SES, SendGrid, Zoho…). In development and on a
 * test system the console sender writes e-mails to the server log; on the live system e-mail is simply
 * unavailable (EMAIL_SENDER is null) until a provider is configured, and the app hides the option.
 */
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export class ConsoleEmailSender implements EmailSender {
  private readonly log = new Logger('E-mail (dev)');

  async send(to: string, subject: string, text: string): Promise<void> {
    this.log.log(`to ${to}: ${subject} | ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
}
