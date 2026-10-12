import type { Certificate, CertificateEvent, MergeValues, Tenant } from '@kdc/shared';

/**
 * Builds the merge-value map used by both the PDF renderer and the email
 * templates.
 *
 * Keeping this in one place is what guarantees that `{{recipient.name}}` on the
 * certificate and in the covering email always resolve to the same string.
 */

const DATE_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  long: { day: 'numeric', month: 'long', year: 'numeric' },
};

export function formatDate(value: Date | string | null | undefined, timezone = 'UTC'): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { ...DATE_FORMATS.long, timeZone: timezone }).format(
      date,
    );
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export interface MergeContext {
  certificate: Pick<Certificate, 'serial' | 'recipient' | 'issuedAt' | 'metadata'>;
  event: Pick<
    CertificateEvent,
    'programmeName' | 'programmeDescription' | 'date' | 'venue' | 'organiser' | 'name'
  >;
  tenant: Pick<Tenant, 'name' | 'branding' | 'settings'>;
  verifyUrl: string;
  downloadUrl: string;
  /** Extra values from the import file that are not first-class fields. */
  extra?: Record<string, string> | null;
}

export function buildMergeValues(ctx: MergeContext): MergeValues {
  const timezone = ctx.tenant.settings?.timezone ?? 'UTC';
  const recipient = ctx.certificate.recipient ?? ({} as MergeContext['certificate']['recipient']);
  const issuedAt = ctx.certificate.issuedAt ? new Date(ctx.certificate.issuedAt) : new Date();

  const values: MergeValues = {
    'recipient.name': recipient.name ?? '',
    'recipient.first_name': firstName(recipient.name ?? ''),
    'recipient.last_name': lastName(recipient.name ?? ''),
    'recipient.email': recipient.email ?? '',
    'recipient.title': recipient.title ?? '',
    'recipient.department': recipient.department ?? '',
    'recipient.roll_number': recipient.rollNumber ?? '',
    'recipient.grade': recipient.grade ?? '',
    'recipient.hours': recipient.hours ?? '',
    'event.name': ctx.event.programmeName || ctx.event.name || '',
    'event.description': ctx.event.programmeDescription ?? '',
    'event.date': formatDate(ctx.event.date ?? null, timezone),
    'event.venue': ctx.event.venue ?? '',
    'event.organiser': ctx.event.organiser ?? '',
    'certificate.serial': ctx.certificate.serial,
    'certificate.issued_at': formatDate(issuedAt, timezone),
    'certificate.year': String(issuedAt.getUTCFullYear()),
    'certificate.download_url': ctx.downloadUrl,
    'tenant.name': ctx.tenant.name,
    'tenant.tagline': ctx.tenant.branding?.tagline ?? '',
    'verify.url': ctx.verifyUrl,
  };

  // Anything captured from the spreadsheet is exposed as recipient.meta.<column>
  // and also as a bare <column> token for convenience.
  for (const [key, value] of Object.entries(ctx.extra ?? {})) {
    if (!key || key.startsWith('__')) continue;
    const slug = key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!slug) continue;
    values[`recipient.meta.${slug}`] = value;
    if (!(slug in values)) values[slug] = value;
  }
  for (const [key, value] of Object.entries(ctx.certificate.metadata ?? {})) {
    const slug = key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (slug) values[`certificate.meta.${slug}`] = value;
  }
  return values;
}

export function firstName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[0] ?? '';
}

export function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

/** Values used when previewing a design with no real recipient. */
export function sampleMergeValues(): MergeValues {
  return {
    'recipient.name': 'Jane Q. Public',
    'recipient.first_name': 'Jane',
    'recipient.last_name': 'Public',
    'recipient.email': 'jane.public@example.edu',
    'recipient.title': 'Graduate',
    'recipient.department': 'Computer Science & Engineering',
    'recipient.roll_number': '21BCE1234',
    'recipient.grade': '9.4 CGPA',
    'recipient.hours': '40',
    'event.name': 'Annual Convocation 2026',
    'event.description': 'Awarded for outstanding performance and contribution.',
    'event.date': '12 October 2026',
    'event.venue': 'Main Auditorium',
    'event.organiser': 'Department of Computer Science',
    'certificate.serial': 'KDC-2026-SAMPLE00-X',
    'certificate.issued_at': '12 October 2026',
    'certificate.year': '2026',
    'certificate.download_url': 'https://example.org/download/sample',
    'tenant.name': 'Krishna Institute of Technology',
    'tenant.tagline': 'Excellence in Education',
    'verify.url': 'https://example.org/verify/KDC-2026-SAMPLE00-X',
  };
}
