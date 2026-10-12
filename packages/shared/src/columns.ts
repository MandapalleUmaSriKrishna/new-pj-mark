import { z } from 'zod';

/**
 * CSV / XLSX import handling: canonical recipient columns, fuzzy header
 * matching and row validation. Shared by the API parser and the web preview so
 * that the mapping UI and the server always agree.
 */

export const CANONICAL_COLUMNS = [
  'name',
  'email',
  'title',
  'department',
  'roll_number',
  'grade',
  'hours',
  'issued_at',
] as const;
export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

export const COLUMN_LABELS: Record<CanonicalColumn, string> = {
  name: 'Recipient name',
  email: 'Email address',
  title: 'Title / designation',
  department: 'Department / branch',
  roll_number: 'Roll / employee number',
  grade: 'Grade / score / CGPA',
  hours: 'Duration (hours)',
  issued_at: 'Issue date (back-dating)',
};

/** Aliases seen in real spreadsheets exported from LMS / HR / SIS systems. */
const ALIASES: Record<CanonicalColumn, string[]> = {
  name: [
    'name',
    'fullname',
    'full_name',
    'studentname',
    'student_name',
    'recipient',
    'candidate',
    'candidate_name',
    'participant',
    'attendee',
    'naam',
  ],
  email: [
    'email',
    'emailaddress',
    'email_address',
    'mail',
    'e_mail',
    'primary_email',
    'personal_email',
  ],
  title: [
    'title',
    'designation',
    'role',
    'position',
    'award',
    'award_title',
    'course',
    'course_name',
    'program',
  ],
  department: [
    'department',
    'dept',
    'branch',
    'stream',
    'faculty',
    'school',
    'team',
    'division',
    'specialisation',
  ],
  roll_number: [
    'roll',
    'rollno',
    'roll_no',
    'rollnumber',
    'roll_number',
    'id',
    'studentid',
    'student_id',
    'employeeid',
    'employee_id',
    'emp_id',
    'registration',
    'reg_no',
    'regno',
    'enrollment',
    'enrollment_number',
  ],
  grade: [
    'grade',
    'score',
    'marks',
    'percentage',
    'cgpa',
    'gpa',
    'result',
    'class',
    'division_result',
    'percent',
  ],
  hours: ['hours', 'duration', 'duration_hours', 'total_hours', 'credit', 'credits', 'hrs'],
  issued_at: [
    'issued_at',
    'issuedat',
    'issue_date',
    'issuedate',
    'date',
    'completed_on',
    'completion_date',
    'award_date',
  ],
};

export function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\uFEFF/, '') // strip BOM left behind by Excel
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function detectColumn(header: string): CanonicalColumn | null {
  const norm = normaliseHeader(header);
  if (!norm) return null;
  for (const col of CANONICAL_COLUMNS) {
    if (ALIASES[col].includes(norm)) return col;
  }
  // fall back to substring matching for headers like "Student Full Name (Reg.)"
  for (const col of CANONICAL_COLUMNS) {
    if (ALIASES[col].some((a) => a.length > 3 && norm.includes(a))) return col;
  }
  return null;
}

export interface AutoMapping {
  mapping: Record<string, CanonicalColumn>;
  unmapped: string[];
  confidence: 'high' | 'medium' | 'low';
}

/** Best-effort header -> canonical column mapping for a spreadsheet. */
export function autoMapHeaders(headers: string[]): AutoMapping {
  const mapping: Record<string, CanonicalColumn> = {};
  const unmapped: string[] = [];
  const used = new Set<CanonicalColumn>();
  for (const h of headers) {
    const detected = detectColumn(h);
    if (detected && !used.has(detected)) {
      mapping[h] = detected;
      used.add(detected);
    } else {
      unmapped.push(h);
    }
  }
  const score = used.size / Math.min(headers.length || 1, CANONICAL_COLUMNS.length);
  const confidence =
    used.has('name') && score >= 0.5 ? 'high' : used.has('name') ? 'medium' : 'low';
  return { mapping, unmapped, confidence };
}

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value.trim());
}

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const rich = value as { text?: unknown; result?: unknown; hyperlink?: string };
    if (typeof rich.text === 'string') return rich.text; // exceljs rich text
    if (typeof rich.result === 'string') return rich.result; // exceljs formula
    if (typeof rich.result === 'number') return String(rich.result);
    if (typeof rich.hyperlink === 'string') return rich.hyperlink;
    return JSON.stringify(value);
  }
  return String(value).trim();
}

export interface RawRow {
  __row: number;
  [key: string]: unknown;
}

export interface ValidatedRow {
  row: number;
  ok: true;
  values: Record<string, string>;
  meta: Record<string, string>;
}
export interface RejectedRow {
  row: number;
  ok: false;
  errors: { field: string; message: string }[];
  raw: Record<string, string>;
}
export type RowResult = ValidatedRow | RejectedRow;

export interface MappingOptions {
  /** header -> canonical column */
  mapping: Record<string, CanonicalColumn>;
  /** Rows with an invalid email: drop them, or keep the certificate without one. */
  onInvalidEmail: 'reject' | 'keep_without_email';
  requireEmail: boolean;
  /** Reject duplicate names within the same file. */
  dedupeOn: ('name' | 'email' | 'roll_number')[];
}

export function validateRows(
  rows: RawRow[],
  opts: MappingOptions,
): {
  results: RowResult[];
  valid: ValidatedRow[];
  invalid: RejectedRow[];
} {
  const results: RowResult[] = [];
  const valid: ValidatedRow[] = [];
  const invalid: RejectedRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const values: Record<string, string> = {};
    const meta: Record<string, string> = {};
    const errors: { field: string; message: string }[] = [];

    for (const [header, rawValue] of Object.entries(row)) {
      if (header === '__row') continue;
      const text = cellToString(rawValue);
      if (!text && text !== '') continue;
      const canonical = opts.mapping[header];
      if (canonical) values[canonical] = text;
      else if (header && text) meta[header] = text;
    }

    const name = (values.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) errors.push({ field: 'name', message: 'Recipient name is required' });
    else if (name.length > 200)
      errors.push({ field: 'name', message: 'Name exceeds 200 characters' });

    const email = (values.email ?? '').trim();
    if (email) {
      if (!isValidEmail(email)) {
        if (opts.onInvalidEmail === 'reject') {
          errors.push({ field: 'email', message: `"${email}" is not a valid email address` });
        } else {
          delete values.email;
          meta.__invalid_email = email;
        }
      } else {
        values.email = email.toLowerCase();
      }
    } else if (opts.requireEmail) {
      errors.push({ field: 'email', message: 'Email is required for this event' });
    }

    if (values.roll_number && values.roll_number.length > 80) {
      errors.push({ field: 'roll_number', message: 'Roll number exceeds 80 characters' });
    }
    if (values.hours && !/^\d{1,5}(\.\d{1,2})?$/.test(values.hours)) {
      errors.push({ field: 'hours', message: 'Hours must be a number' });
    }

    if (errors.length === 0) {
      const dedupeKey = opts.dedupeOn
        .map((f) => (values[f] ?? '').trim().toLowerCase())
        .filter(Boolean)
        .join('|');
      if (dedupeKey && seen.has(dedupeKey)) {
        errors.push({
          field: opts.dedupeOn[0] ?? 'name',
          message: 'Duplicate row within this file',
        });
      } else if (dedupeKey) {
        seen.add(dedupeKey);
      }
    }

    if (errors.length === 0) {
      const okRow: ValidatedRow = { row: row.__row, ok: true, values, meta };
      results.push(okRow);
      valid.push(okRow);
    } else {
      const badRow: RejectedRow = { row: row.__row, ok: false, errors, raw: values };
      results.push(badRow);
      invalid.push(badRow);
    }
  }

  return { results, valid, invalid };
}

export const importMappingSchema = z.record(z.string(), z.enum(CANONICAL_COLUMNS));

/** RFC4180-friendly CSV header row for the downloadable sample file. */
export const SAMPLE_CSV_HEADERS = [
  'name',
  'email',
  'title',
  'department',
  'roll_number',
  'grade',
  'hours',
];
export const SAMPLE_CSV = [
  SAMPLE_CSV_HEADERS.join(','),
  'Jane Q. Public,jane.public@example.edu,B.Tech Graduate,Computer Science,21BCE1234,9.4 CGPA,',
  'Priya Ramesh,priya.ramesh@example.edu,B.Tech Graduate,Electronics,21BEC4521,8.9 CGPA,',
  'Rahul Verma,rahul.verma@example.edu,B.Tech Graduate,Mechanical,21BME7788,9.1 CGPA,',
].join('\n');

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const ACCEPTED_MIME_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/octet-stream',
];
