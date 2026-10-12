/**
 * Mail port.
 *
 * IMPORTANT: this port never lies about delivery. The SMTP driver reports the
 * transport's real response; the log driver reports `delivered: false` with
 * status `captured` so the UI shows "rendered, not sent" rather than a fake
 * success. The disabled driver reports a hard failure.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text alternative. Always set - many corporate gateways strip HTML. */
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  headers?: Record<string, string>;
  replyTo?: string;
  category?: string;
}

export interface MailResult {
  delivered: boolean;
  status: 'captured' | 'sent' | 'failed';
  provider: string;
  providerMessageId?: string;
  /** File the message was written to, when using the log driver. */
  capturedPath?: string;
  error?: string;
}

export interface MailPort {
  readonly driver: 'smtp' | 'log' | 'disabled';
  readonly configured: boolean;
  send(message: MailMessage): Promise<MailResult>;
  verify(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}

export const MAIL_PORT = Symbol('KDC_MAIL_PORT');
