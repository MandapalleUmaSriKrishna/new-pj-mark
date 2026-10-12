import { Inject, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { ImportBatch } from '@kdc/shared';
import {
  CANONICAL_COLUMNS,
  MAX_UPLOAD_BYTES,
  SAMPLE_CSV,
  autoMapHeaders,
  getPlan,
  validateRows,
  type CanonicalColumn,
  type RawRow,
  type RejectedRow,
  type ValidatedRow,
} from '@kdc/shared';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { EVENT_BUS_PORT, type EventBusPort } from '../infra/events/eventbus.port';
import { AppException } from '../common/errors/app.exception';
import { AuditService } from '../audit/audit.service';
import { AssetsService, sanitiseFilename } from '../assets/assets.service';
import { TenantsService } from '../tenants/tenants.service';

export interface ParseOutcome {
  headers: string[];
  rows: RawRow[];
  detectedType: 'csv' | 'xlsx';
  encoding: string;
}

export interface PreparedImport {
  batch: ImportBatch;
  valid: ValidatedRow[];
  invalid: RejectedRow[];
  autoMapping: Record<string, CanonicalColumn>;
  unmapped: string[];
  confidence: 'high' | 'medium' | 'low';
}

const MAX_PREVIEW_ROWS = 50;
const MAX_STORED_ERRORS = 200;

/**
 * Spreadsheet import pipeline.
 *
 *   upload -> detect type -> parse -> auto-map headers -> validate -> stage
 *   -> (caller confirms mapping) -> bulk issue
 *
 * Nothing is issued during the upload: the caller sees the detected mapping, the
 * row-by-row errors and a preview first, then confirms. That two-step flow is
 * what stops a mis-mapped column from silently printing 5,000 wrong names.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly batches: Repository<ImportBatch>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly assets: AssetsService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
  ) {
    this.batches = store.repository<ImportBatch>('import_batches');
  }

  /* ------------------------------------------------------------- parsing */

  detectType(filename: string, mimetype: string, buffer: Uint8Array): 'csv' | 'xlsx' {
    const name = filename.toLowerCase();
    // An XLSX is a ZIP container, so it always starts with PK\x03\x04.
    if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx';
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || mimetype.includes('spreadsheetml'))
      return 'xlsx';
    if (name.endsWith('.xls')) {
      throw new AppException(
        'unsupported_file_type',
        'The legacy binary .xls format is not supported. Re-save the file as .xlsx or export it as .csv.',
        undefined,
        400,
      );
    }
    return 'csv';
  }

  /** Decodes a CSV buffer, handling the BOM and UTF-16 exports from Excel. */
  private decodeCsv(input: Uint8Array): { text: string; encoding: string } {
    const buffer: Buffer = Buffer.from(input);
    let text = buffer.toString('utf8');
    let encoding = 'utf-8';
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
      encoding = 'utf-8-bom';
    }
    // UTF-16 exports from Excel arrive as "ÿþ" or "\ufeff" with nulls between chars.
    if (text.includes('\u0000')) {
      const le = buffer[0] === 0xff && buffer[1] === 0xfe;
      const be = buffer[0] === 0xfe && buffer[1] === 0xff;
      if (le || be) {
        text = buffer.toString(le ? 'utf16le' : 'ucs2').replace(/^\uFEFF/, '');
        encoding = le ? 'utf-16le' : 'utf-16be';
      }
    }
    return { text, encoding };
  }

  async parse(buffer: Uint8Array, filename: string, mimetype: string): Promise<ParseOutcome> {
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new AppException(
        'file_too_large',
        `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`,
        undefined,
        413,
      );
    }
    const detectedType = this.detectType(filename, mimetype, buffer);

    if (detectedType === 'xlsx') return this.parseXlsx(buffer);
    const { text, encoding } = this.decodeCsv(buffer);
    return this.parseCsv(text, encoding);
  }

  private parseCsv(text: string, encoding: string): ParseOutcome {
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      delimiter: '', // let papaparse sniff , ; \t |
    });
    if (result.data.length === 0 && result.errors.length > 0) {
      throw AppException.validationFailed(
        'The CSV file could not be parsed',
        result.errors.slice(0, 20).map((e) => ({
          row: e.row ?? null,
          type: e.type,
          message: e.message,
        })),
      );
    }
    const headers = result.meta.fields ?? [];
    if (headers.length === 0)
      throw AppException.validationFailed('No header row was found in the CSV file');
    const rows: RawRow[] = result.data.map((row, index) => ({ __row: index + 2, ...row }));
    return { headers, rows, detectedType: 'csv', encoding };
  }

  private async parseXlsx(buffer: Uint8Array): Promise<ParseOutcome> {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs@4 ships `declare interface Buffer extends ArrayBuffer {}` at the
      // top of its index.d.ts, which merges into the global Buffer type and makes
      // `xlsx.load()` uncallable with a genuine Node Buffer. The cast is confined
      // to this one boundary and is expressed as the callee's own parameter type
      // so it stays correct if the upstream declaration is ever fixed.
      const bytes = Buffer.from(buffer);
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch (err) {
      throw AppException.validationFailed(
        `The Excel file could not be opened: ${(err as Error).message}`,
      );
    }
    const sheet = workbook.worksheets.find((w) => w.state === 'visible') ?? workbook.worksheets[0];
    if (!sheet) throw AppException.validationFailed('The Excel file contains no visible worksheet');

    // The header is always the first populated row of the first visible sheet.
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber - 1] = String(cell.text ?? '').trim();
    });
    const cleaned = headers.filter((h) => h !== undefined && h !== '');
    if (cleaned.length === 0)
      throw AppException.validationFailed('No header row was found in the first worksheet');

    const rows: RawRow[] = [];
    const lastRow = sheet.rowCount ?? 1;
    for (let r = 2; r <= lastRow; r += 1) {
      const row = sheet.getRow(r);
      const values: RawRow = { __row: r };
      let hasValue = false;
      cleaned.forEach((header, index) => {
        const cell = row.getCell(index + 1);
        const raw = cell.value;
        const text = cellValueToText(raw);
        if (text !== '') hasValue = true;
        values[header] = raw instanceof Date ? raw.toISOString() : text;
      });
      if (hasValue) rows.push(values);
    }
    return { headers: cleaned, rows, detectedType: 'xlsx', encoding: 'xlsx' };
  }

  /* ------------------------------------------------------------- staging */

  /**
   * Parses an upload and stages it as an ImportBatch WITHOUT issuing anything.
   */
  async stage(
    tenantId: string,
    eventId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    opts: {
      uploadedBy: string;
      requireEmail?: boolean;
      onInvalidEmail?: 'reject' | 'keep_without_email';
    },
  ): Promise<PreparedImport> {
    const plan = await this.tenants.planOf(tenantId);
    const maxRows = getPlan(plan).maxImportRows;

    const outcome = await this.parse(file.buffer, file.originalname, file.mimetype);
    if (outcome.rows.length === 0) {
      throw AppException.validationFailed('The file has a header row but no data rows');
    }
    if (outcome.rows.length > maxRows) {
      const upgrade = plan === 'free' ? 'starter' : plan === 'starter' ? 'growth' : 'enterprise';
      throw AppException.quotaExceeded(
        `The file has ${outcome.rows.length} rows but the ${plan} plan allows up to ${maxRows} per import.`,
        upgrade,
      );
    }

    const auto = autoMapHeaders(outcome.headers);
    if (auto.confidence === 'low') {
      throw AppException.validationFailed(
        'No "name" column could be detected. Rename the column to one of: name, full name, student name, recipient, participant.',
        { headers: outcome.headers, suggestions: CANONICAL_COLUMNS },
      );
    }

    const validated = validateRows(outcome.rows, {
      mapping: auto.mapping,
      onInvalidEmail: opts.onInvalidEmail ?? 'reject',
      requireEmail: opts.requireEmail ?? false,
      dedupeOn: ['email', 'roll_number', 'name'],
    });

    // Keep the original file so an operator can re-run with a different mapping.
    const filename = sanitiseFilename(file.originalname);
    const asset = await this.assets.storeGenerated(
      tenantId,
      'import_file',
      filename,
      file.buffer,
      outcome.detectedType === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const now = new Date();
    const batch: ImportBatch = {
      id: asset.id,
      tenantId,
      eventId,
      fileName: filename,
      fileType: outcome.detectedType,
      status: 'parsed',
      totalRows: outcome.rows.length,
      validRows: validated.valid.length,
      invalidRows: validated.invalid.length,
      issuedRows: 0,
      failedRows: 0,
      columnMapping: auto.mapping,
      errors: validated.invalid.slice(0, MAX_STORED_ERRORS).map((r) => ({
        row: r.row,
        message: r.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
        field: r.errors[0]?.field,
      })),
      preview: validated.valid.slice(0, MAX_PREVIEW_ROWS).map((r) => r.values),
      jobId: null,
      uploadedBy: opts.uploadedBy,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.batches.insert(batch);

    await this.audit.recordFrom(
      { tenantId, userId: opts.uploadedBy, role: 'admin' },
      'import.started',
      'import_batch',
      batch.id,
      {
        fileName: filename,
        fileType: outcome.detectedType,
        encoding: outcome.encoding,
        totalRows: batch.totalRows,
        validRows: batch.validRows,
        invalidRows: batch.invalidRows,
        mapping: auto.mapping,
        confidence: auto.confidence,
      },
    );
    this.logger.log(
      `Staged import ${batch.id} for tenant ${tenantId}: ${batch.validRows}/${batch.totalRows} rows valid`,
    );

    return {
      batch,
      valid: validated.valid,
      invalid: validated.invalid,
      autoMapping: auto.mapping,
      unmapped: auto.unmapped,
      confidence: auto.confidence,
    };
  }

  /**
   * Re-validates a staged batch with a mapping the operator adjusted, and
   * returns the recipient payloads ready for `CertificatesService.issueBulk`.
   */
  async prepareForIssue(
    tenantId: string,
    batchId: string,
    mapping: Record<string, CanonicalColumn>,
    opts: { requireEmail?: boolean; onInvalidEmail?: 'reject' | 'keep_without_email' } = {},
  ): Promise<{
    recipients: RecipientPayload[];
    valid: number;
    invalid: number;
    errors: { row: number; message: string }[];
  }> {
    const batch = await this.getBatch(tenantId, batchId);
    const asset = await this.assets.read(batchId, { tenantId });
    if (!asset)
      throw AppException.notFound(
        'The uploaded file is no longer available; please upload it again',
      );

    const outcome = await this.parse(
      asset.buffer,
      batch.fileName,
      batch.fileType === 'csv' ? 'text/csv' : 'xlsx',
    );
    const validated = validateRows(outcome.rows, {
      mapping,
      onInvalidEmail: opts.onInvalidEmail ?? 'reject',
      requireEmail: opts.requireEmail ?? false,
      dedupeOn: ['email', 'roll_number', 'name'],
    });

    const recipients: RecipientPayload[] = validated.valid.map((row) => ({
      name: row.values.name ?? '',
      email: row.values.email || undefined,
      title: row.values.title || undefined,
      department: row.values.department || undefined,
      roll_number: row.values.roll_number || undefined,
      grade: row.values.grade || undefined,
      hours: row.values.hours || undefined,
      meta: Object.keys(row.meta).length > 0 ? row.meta : undefined,
    }));

    await this.batches.updateById(batchId, {
      columnMapping: mapping,
      validRows: validated.valid.length,
      invalidRows: validated.invalid.length,
      errors: validated.invalid.slice(0, MAX_STORED_ERRORS).map((r) => ({
        row: r.row,
        message: r.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
        field: r.errors[0]?.field,
      })),
      preview: validated.valid.slice(0, MAX_PREVIEW_ROWS).map((r) => r.values),
      status: 'queued',
    });

    return {
      recipients,
      valid: validated.valid.length,
      invalid: validated.invalid.length,
      errors: validated.invalid.slice(0, MAX_STORED_ERRORS).map((r) => ({
        row: r.row,
        message: r.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      })),
    };
  }

  async markCompleted(
    tenantId: string,
    batchId: string,
    issued: number,
    failed: number,
    jobId: string | null,
  ): Promise<void> {
    await this.batches.updateById(batchId, {
      status: failed > 0 && issued === 0 ? 'failed' : 'completed',
      issuedRows: issued,
      failedRows: failed,
      jobId,
      completedAt: new Date(),
    });
    await this.bus
      .publish(tenantId, failed > 0 && issued === 0 ? 'import.failed' : 'import.completed', {
        batchId,
        issued,
        failed,
      })
      .catch(() => undefined);
  }

  async getBatch(tenantId: string, batchId: string): Promise<ImportBatch> {
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) throw AppException.notFound('Import batch');
    return batch;
  }

  async list(tenantId: string, limit = 50): Promise<ImportBatch[]> {
    return this.batches.find({ tenantId }, { sort: { createdAt: -1 }, limit });
  }

  /** Sample CSV, so users can see the expected shape before uploading. */
  sampleCsv(): { filename: string; mimeType: string; buffer: Buffer } {
    return {
      filename: 'kdc-sample-recipients.csv',
      mimeType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(`\uFEFF${SAMPLE_CSV}\n`, 'utf8'),
    };
  }

  /** Sample XLSX with a styled header row and data validation hints. */
  async sampleXlsx(): Promise<{ filename: string; mimeType: string; buffer: Buffer }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Krishna Digital Certificate';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Recipients');
    const headers = CANONICAL_COLUMNS.filter((c) => c !== 'issued_at');
    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headers.forEach((h, i) => {
      sheet.getColumn(i + 1).width = h === 'name' ? 32 : 20;
    });
    sheet.addRow([
      'Jane Q. Public',
      'jane.public@example.edu',
      'B.Tech Graduate',
      'Computer Science',
      '21BCE1234',
      '9.4 CGPA',
      '',
    ]);
    sheet.addRow([
      'Priya Ramesh',
      'priya.ramesh@example.edu',
      'B.Tech Graduate',
      'Electronics',
      '21BEC4521',
      '8.9 CGPA',
      '',
    ]);
    sheet.addRow([
      'Rahul Verma',
      'rahul.verma@example.edu',
      'B.Tech Graduate',
      'Mechanical',
      '21BME7788',
      '9.1 CGPA',
      '',
    ]);

    const notes = workbook.addWorksheet('Instructions');
    notes.getColumn(1).width = 110;
    [
      'Krishna Digital Certificate - recipient import template',
      '',
      'Required column: name',
      'Recommended: email (needed to deliver the certificate by email)',
      'Optional: title, department, roll_number, grade, hours',
      '',
      'Any extra columns you add are kept and can be referenced on the design as',
      '{{recipient.meta.<column_name>}}.',
      '',
      'Tips:',
      '- Header names are matched automatically (for example "Full Name", "Student Name"',
      '  and "Recipient" all map to name).',
      '- Delete this worksheet before uploading, or leave it: only the first visible',
      '  sheet named "Recipients" is read.',
      '- Rows with a blank name, or an invalid email when email is required, are',
      '  reported individually and can be skipped or fixed before issuing.',
    ].forEach((line) => notes.addRow([line]));

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      filename: 'kdc-recipient-template.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    };
  }
}

export interface RecipientPayload {
  name: string;
  email?: string;
  title?: string;
  department?: string;
  roll_number?: string;
  grade?: string;
  hours?: string;
  meta?: Record<string, string>;
}

function cellValueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const rich = value as {
      text?: unknown;
      result?: unknown;
      richText?: { text: string }[];
      hyperlink?: string;
    };
    if (Array.isArray(rich.richText)) return rich.richText.map((t) => t.text).join('');
    if (typeof rich.text === 'string') return rich.text;
    if (rich.result !== undefined) return String(rich.result);
    if (typeof rich.hyperlink === 'string') return rich.hyperlink;
    return JSON.stringify(value);
  }
  return String(value).trim();
}
