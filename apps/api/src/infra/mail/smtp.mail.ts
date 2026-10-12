import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailMessage, MailPort, MailResult } from './mail.port';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}

/**
 * SMTP mail driver (production).
 *
 * Uses STARTTLS by default on port 587. Reports the transport's real result;
 * a rejected/bounced message surfaces as `status: 'failed'` with the SMTP error
 * so the delivery record and the retry queue can act on it.
 */
export class SmtpMail implements MailPort {
  readonly driver = 'smtp' as const;
  readonly configured: boolean;
  private readonly logger = new Logger('SmtpMail');
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.configured = Boolean(options.host);
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth:
        options.user && options.password
          ? { user: options.user, pass: options.password }
          : undefined,
      requireTLS: !options.secure,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      dkim: undefined,
    });
  }

  async send(message: MailMessage): Promise<MailResult> {
    if (!this.configured) {
      return { delivered: false, status: 'failed', provider: 'smtp', error: 'SMTP not configured' };
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.options.from,
        to: message.to,
        replyTo: message.replyTo ?? this.options.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
        headers: {
          'X-KDC-Category': message.category ?? 'transactional',
          ...message.headers,
        },
      });
      const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
      if (rejected > 0 && accepted === 0) {
        return {
          delivered: false,
          status: 'failed',
          provider: 'smtp',
          error: `SMTP rejected all recipients`,
          providerMessageId: info.messageId,
        };
      }
      return {
        delivered: true,
        status: 'sent',
        provider: 'smtp',
        providerMessageId: info.messageId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP send failed for ${message.to}: ${msg}`);
      return { delivered: false, status: 'failed', provider: 'smtp', error: msg };
    }
  }

  async verify(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.configured) return { ok: false, detail: 'SMTP_HOST is not set' };
    try {
      await this.transporter.verify();
      return { ok: true, detail: `${this.options.host}:${this.options.port}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}
