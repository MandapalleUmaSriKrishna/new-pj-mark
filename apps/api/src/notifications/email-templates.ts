import type { TenantBranding } from '@kdc/shared';

/**
 * Transactional email templates.
 *
 * Hand-rolled HTML (tables + inline styles) rather than a template engine: this
 * is what actually survives Outlook, Gmail and corporate gateways, and it keeps
 * the dependency surface small. Every template renders a text alternative too,
 * because a certificate notification that arrives as HTML-only is frequently
 * stripped or quarantined.
 *
 * All dynamic values are HTML-escaped here; template bodies are static strings,
 * so there is no injection path from recipient data into the markup.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailLayoutInput {
  branding: Pick<TenantBranding, 'primaryColor' | 'accentColor' | 'tagline' | 'hidePoweredBy'>;
  tenantName: string;
  heading: string;
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerLines?: string[];
  supportUrl?: string;
  appUrl: string;
  verifyBaseUrl: string;
}

export function renderHtml(input: EmailLayoutInput): string {
  const primary = /^#[0-9a-fA-F]{6}$/.test(input.branding.primaryColor ?? '')
    ? input.branding.primaryColor!
    : '#1f3a5f';
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.branding.accentColor ?? '')
    ? input.branding.accentColor!
    : '#2563eb';
  const footer = (input.footerLines ?? [])
    .map((l) => `<p style="margin:0 0 4px;font-size:12px;color:#6b7280">${escapeHtml(l)}</p>`)
    .join('');
  const poweredBy = input.branding.hidePoweredBy
    ? ''
    : `<p style="margin:14px 0 0;font-size:11px;color:#9ca3af">Sent using <a href="${escapeHtml(input.appUrl)}" style="color:#9ca3af">Krishna Digital Certificate</a></p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
  <tr><td style="background:${primary};padding:22px 28px">
    <p style="margin:0;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:.2px">${escapeHtml(input.tenantName)}</p>
    ${input.branding.tagline ? `<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.82)">${escapeHtml(input.branding.tagline)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 14px;font-size:21px;line-height:1.35;color:#111827">${escapeHtml(input.heading)}</h1>
    ${input.bodyHtml}
    ${
      input.ctaLabel && input.ctaUrl
        ? `<p style="margin:24px 0 6px;text-align:center">
      <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:15px;font-weight:600">${escapeHtml(input.ctaLabel)}</a>
    </p>
    <p style="margin:10px 0 0;text-align:center;font-size:12px;color:#6b7280">
      If the button does not work, copy this link:<br>
      <a href="${escapeHtml(input.ctaUrl)}" style="color:${accent};word-break:break-all">${escapeHtml(input.ctaUrl)}</a>
    </p>`
        : ''
    }
  </td></tr>
  <tr><td style="padding:18px 28px;border-top:1px solid #e5e7eb;background:#f9fafb">
    ${footer}
    ${input.supportUrl ? `<p style="margin:6px 0 0;font-size:12px"><a href="${escapeHtml(input.supportUrl)}" style="color:${accent}">Contact support</a></p>` : ''}
    ${poweredBy}
  </td></tr>
</table>
<p style="margin:14px 0 0;font-size:11px;color:#9ca3af">
  Verify any certificate at <a href="${escapeHtml(input.verifyBaseUrl)}" style="color:#6b7280">${escapeHtml(input.verifyBaseUrl)}</a>
</p>
</td></tr>
</table>
</body>
</html>`;
}

export interface CertificateEmailInput {
  tenantName: string;
  branding: EmailLayoutInput['branding'];
  recipientName: string;
  eventName: string;
  serial: string;
  issuedAt: string;
  downloadUrl: string;
  verifyUrl: string;
  bodyText: string;
  appUrl: string;
  verifyBaseUrl: string;
  supportEmail?: string | null;
}

export function certificateEmail(input: CertificateEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

  const subject = `Your certificate from ${input.tenantName} — ${input.eventName}`;
  const text = [
    `Dear ${input.recipientName},`,
    '',
    `Congratulations! Your certificate for "${input.eventName}" has been issued by ${input.tenantName}.`,
    '',
    `Certificate ID: ${input.serial}`,
    `Issued on:     ${input.issuedAt}`,
    '',
    `Download your certificate (private link):`,
    input.downloadUrl,
    '',
    `Anyone can verify its authenticity here:`,
    input.verifyUrl,
    '',
    paragraphs ? stripTags(input.bodyText) : '',
    '',
    input.supportEmail ? `Questions? Reply to ${input.supportEmail}.` : '',
    `-- ${input.tenantName}`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const html = renderHtml({
    branding: input.branding,
    tenantName: input.tenantName,
    heading: `Congratulations, ${input.recipientName}`,
    preheader: `Your certificate ${input.serial} for ${input.eventName} is ready`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">
        Your certificate for <strong>${escapeHtml(input.eventName)}</strong> has been issued.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 18px">
        <tr>
          <td style="padding:12px 14px;font-size:12px;color:#6b7280;width:110px">Certificate ID</td>
          <td style="padding:12px 14px;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#111827">${escapeHtml(input.serial)}</td>
        </tr>
        <tr>
          <td style="padding:0 14px 12px;font-size:12px;color:#6b7280">Issued on</td>
          <td style="padding:0 14px 12px;font-size:14px;color:#111827">${escapeHtml(input.issuedAt)}</td>
        </tr>
      </table>
      ${paragraphs}
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b7280">
        This certificate can be independently verified at
        <a href="${escapeHtml(input.verifyUrl)}" style="color:#2563eb;word-break:break-all">${escapeHtml(input.verifyUrl)}</a>.
        Keep the download link private - it is unique to you.
      </p>`,
    ctaLabel: 'Download your certificate',
    ctaUrl: input.downloadUrl,
    footerLines: [`${input.tenantName}`],
    supportUrl: input.supportEmail ? `mailto:${input.supportEmail}` : undefined,
    appUrl: input.appUrl,
    verifyBaseUrl: input.verifyBaseUrl,
  });

  return { subject, text, html };
}

export function inviteEmail(input: {
  tenantName: string;
  branding: EmailLayoutInput['branding'];
  inviterName: string;
  inviteeName?: string;
  role: string;
  inviteUrl: string;
  message?: string;
  appUrl: string;
  verifyBaseUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `${input.inviterName} invited you to join ${input.tenantName} on Krishna Digital Certificate`;
  const text = [
    `${input.inviteeName ?? 'Hello'},`,
    '',
    `${input.inviterName} invited you to join ${input.tenantName} as ${input.role}.`,
    input.message ? `\n"${input.message}"\n` : '',
    'Accept the invitation:',
    input.inviteUrl,
    '',
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');

  const html = renderHtml({
    branding: input.branding,
    tenantName: input.tenantName,
    heading: `You have been invited to join ${input.tenantName}`,
    preheader: `${input.inviterName} invited you as ${input.role}`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">
        <strong>${escapeHtml(input.inviterName)}</strong> invited you to join
        <strong>${escapeHtml(input.tenantName)}</strong> with the
        <strong>${escapeHtml(input.role)}</strong> role.
      </p>
      ${input.message ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #e5e7eb;color:#4b5563;font-size:14px">${escapeHtml(input.message)}</blockquote>` : ''}
      <p style="margin:0;font-size:13px;color:#6b7280">If you were not expecting this invitation you can safely ignore it.</p>`,
    ctaLabel: 'Accept invitation',
    ctaUrl: input.inviteUrl,
    appUrl: input.appUrl,
    verifyBaseUrl: input.verifyBaseUrl,
  });
  return { subject, text, html };
}

export function welcomeEmail(input: {
  name: string;
  tenantName: string;
  branding: EmailLayoutInput['branding'];
  dashboardUrl: string;
  appUrl: string;
  verifyBaseUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Welcome to Krishna Digital Certificate — ${input.tenantName} is ready`;
  const text = [
    `Hi ${input.name},`,
    '',
    `Your organisation "${input.tenantName}" is ready.`,
    '',
    'Next steps:',
    '1. Pick one of the six starter designs, or drag elements onto a blank canvas.',
    '2. Create an event and upload your recipients as CSV or XLSX.',
    '3. Issue - each certificate gets a unique ID, a QR code and a private download link.',
    '',
    'Open your dashboard:',
    input.dashboardUrl,
  ].join('\n');

  const html = renderHtml({
    branding: input.branding,
    tenantName: input.tenantName,
    heading: `Welcome, ${input.name}`,
    preheader: 'Your organisation is ready - here is what to do first',
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">
        <strong>${escapeHtml(input.tenantName)}</strong> is set up and ready to issue certificates.
      </p>
      <ol style="margin:0 0 6px;padding-left:20px;font-size:15px;line-height:1.8;color:#374151">
        <li>Pick one of the six starter designs, or drag elements onto a blank canvas.</li>
        <li>Create an event and upload your recipients as CSV or XLSX.</li>
        <li>Issue - every certificate gets a unique ID, a QR code and a private download link.</li>
      </ol>`,
    ctaLabel: 'Open your dashboard',
    ctaUrl: input.dashboardUrl,
    appUrl: input.appUrl,
    verifyBaseUrl: input.verifyBaseUrl,
  });
  return { subject, text, html };
}

export function approvalNeededEmail(input: {
  tenantName: string;
  branding: EmailLayoutInput['branding'];
  eventName: string;
  count: number;
  requestedBy: string;
  approvalsUrl: string;
  appUrl: string;
  verifyBaseUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `${input.count} certificate${input.count === 1 ? '' : 's'} awaiting your approval — ${input.tenantName}`;
  const text = [
    `${input.requestedBy} submitted ${input.count} certificate${input.count === 1 ? '' : 's'} for "${input.eventName}" for approval.`,
    '',
    'Review them here:',
    input.approvalsUrl,
  ].join('\n');
  const html = renderHtml({
    branding: input.branding,
    tenantName: input.tenantName,
    heading: 'Certificates are waiting for approval',
    preheader: `${input.count} pending for ${input.eventName}`,
    bodyHtml: `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">
        <strong>${escapeHtml(input.requestedBy)}</strong> submitted
        <strong>${escapeHtml(input.count)}</strong> certificate${input.count === 1 ? '' : 's'} for
        <strong>${escapeHtml(input.eventName)}</strong>. Nothing is issued until they are approved.
      </p>`,
    ctaLabel: 'Review approvals',
    ctaUrl: input.approvalsUrl,
    appUrl: input.appUrl,
    verifyBaseUrl: input.verifyBaseUrl,
  });
  return { subject, text, html };
}

export function quotaWarningEmail(input: {
  tenantName: string;
  branding: EmailLayoutInput['branding'];
  used: number;
  quota: number;
  plan: string;
  billingUrl: string;
  appUrl: string;
  verifyBaseUrl: string;
}): { subject: string; text: string; html: string } {
  const pct = input.quota > 0 ? Math.round((input.used / input.quota) * 100) : 100;
  const subject = `You have used ${pct}% of your monthly certificate quota — ${input.tenantName}`;
  const text = [
    `${input.tenantName} has issued ${input.used} of ${input.quota} certificates this month on the ${input.plan} plan.`,
    '',
    'Manage your plan:',
    input.billingUrl,
  ].join('\n');
  const html = renderHtml({
    branding: input.branding,
    tenantName: input.tenantName,
    heading: 'Certificate quota is running low',
    preheader: `${input.used} of ${input.quota} used this month`,
    bodyHtml: `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">
        You have issued <strong>${escapeHtml(input.used)}</strong> of
        <strong>${escapeHtml(input.quota)}</strong> certificates included in the
        <strong>${escapeHtml(input.plan)}</strong> plan this month.
      </p>`,
    ctaLabel: 'Review plan and usage',
    ctaUrl: input.billingUrl,
    appUrl: input.appUrl,
    verifyBaseUrl: input.verifyBaseUrl,
  });
  return { subject, text, html };
}

export function revocationNoticeEmail(input: {
  tenantName: string;
  branding: EmailLayoutInput['branding'];
  recipientName: string;
  serial: string;
  eventName: string;
  reason: string;
  verifyUrl: string;
  appUrl: string;
  verifyBaseUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Certificate ${input.serial} has been revoked — ${input.tenantName}`;
  const text = [
    `Dear ${input.recipientName},`,
    '',
    `The certificate ${input.serial} issued for "${input.eventName}" by ${input.tenantName} has been revoked.`,
    `Reason: ${input.reason}`,
    '',
    'The verification page now reports it as revoked:',
    input.verifyUrl,
  ].join('\n');
  const html = renderHtml({
    branding: input.branding,
    tenantName: input.tenantName,
    heading: 'A certificate has been revoked',
    preheader: `${input.serial} is no longer valid`,
    bodyHtml: `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#374151">
        Certificate <strong>${escapeHtml(input.serial)}</strong> for
        <strong>${escapeHtml(input.eventName)}</strong> has been revoked by
        ${escapeHtml(input.tenantName)}.
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151">
        Reason given: ${escapeHtml(input.reason)}
      </p>`,
    ctaLabel: 'View verification status',
    ctaUrl: input.verifyUrl,
    appUrl: input.appUrl,
    verifyBaseUrl: input.verifyBaseUrl,
  });
  return { subject, text, html };
}

function stripTags(html: string): string {
  return html
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}
