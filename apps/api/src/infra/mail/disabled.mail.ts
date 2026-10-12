import type { MailMessage, MailPort, MailResult } from './mail.port';

/** Mail explicitly turned off. Every send is a recorded failure, never a silent success. */
export class DisabledMail implements MailPort {
  readonly driver = 'disabled' as const;
  readonly configured = false;

  async send(_message: MailMessage): Promise<MailResult> {
    return {
      delivered: false,
      status: 'failed',
      provider: 'disabled',
      error: 'MAIL_DRIVER=disabled - outbound email is turned off for this deployment',
    };
  }

  async verify(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: false, detail: 'MAIL_DRIVER=disabled' };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
