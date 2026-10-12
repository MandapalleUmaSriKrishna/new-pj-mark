import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { newId } from '../ids';
import type { MailMessage, MailPort, MailResult } from './mail.port';

/**
 * Log mail driver: renders the message to an RFC-822 style file on disk.
 *
 * This is the default so that `npm run dev` and CI can exercise the whole
 * issuance -> notification path without an SMTP account. It reports
 * `delivered: false` and status `captured`, and the API surfaces that state to
 * the UI. Nothing is presented as sent.
 */
export class LogMail implements MailPort {
  readonly driver = 'log' as const;
  readonly configured = true;
  private readonly logger = new Logger('LogMail');
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async send(message: MailMessage): Promise<MailResult> {
    const id = newId();
    const file = join(this.dir, `${Date.now()}-${id}.eml`);
    const lines = [
      `X-KDC-Captured: true`,
      `X-KDC-Note: MAIL_DRIVER=log - this message was rendered but NOT sent.`,
      `X-KDC-Category: ${message.category ?? 'transactional'}`,
      `Message-ID: <${id}@kdc.local>`,
      `Date: ${new Date().toUTCString()}`,
      `To: ${message.to}`,
      `From: ${process.env.MAIL_FROM ?? 'Krishna Digital Certificate <no-reply@localhost>'}`,
      message.replyTo ? `Reply-To: ${message.replyTo}` : null,
      `Subject: ${message.subject}`,
      message.attachments?.length
        ? `X-KDC-Attachments: ${message.attachments.map((a) => `${a.filename}(${a.contentType},${a.content.byteLength}b)`).join(', ')}`
        : null,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
      message.html ? `\n----- HTML PART -----\n${message.html}` : '',
    ].filter((l): l is string => l !== null);

    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(file, lines.join('\n'), 'utf8');
    } catch (err) {
      this.logger.error(`Could not capture email to ${file}: ${(err as Error).message}`);
      return { delivered: false, status: 'failed', provider: 'log', error: (err as Error).message };
    }
    this.logger.warn(`CAPTURED (not sent) -> ${message.to} :: ${message.subject} :: ${file}`);
    return {
      delivered: false,
      status: 'captured',
      provider: 'log',
      providerMessageId: id,
      capturedPath: file,
    };
  }

  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await mkdir(this.dir, { recursive: true });
      return { ok: true, detail: `capturing to ${this.dir} (no mail is actually sent)` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
