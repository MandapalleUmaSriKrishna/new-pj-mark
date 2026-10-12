import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { ImportBatch } from '@kdc/shared';
import {
  CANONICAL_COLUMNS,
  COLUMN_LABELS,
  MAX_UPLOAD_BYTES,
  importMappingSchema,
  type CanonicalColumn,
} from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ImportsService, type RecipientPayload } from './imports.service';
import { CertificatesService } from '../certificates/certificates.service';
import { AuditService } from '../audit/audit.service';
import { issueBulkSchema, type IssueBulkInput } from '../certificates/dto';

/** Accepted upload MIME types; the parser also sniffs magic bytes. */
const UPLOAD_MIME_FILTER = (
  _req: unknown,
  file: { mimetype: string; originalname: string },
  cb: (error: Error | null, accept: boolean) => void,
): void => {
  const name = file.originalname.toLowerCase();
  const ok =
    file.mimetype === 'text/csv' ||
    file.mimetype === 'text/plain' ||
    file.mimetype === 'application/csv' ||
    file.mimetype.includes('spreadsheetml') ||
    name.endsWith('.csv') ||
    name.endsWith('.xlsx');
  cb(
    ok
      ? null
      : new BadRequestException(
          `Unsupported file type "${file.mimetype}". Upload a .csv or .xlsx file.`,
        ),
    ok,
  );
};

/**
 * Recipient import.
 *
 * Two-phase by design: `POST /imports` parses and stages the file and reports the
 * auto-detected column mapping plus every invalid row, and only
 * `POST /imports/:batchId/issue` - after an operator has confirmed or corrected
 * the mapping - actually issues certificates. The staged file is kept so the same
 * upload can be re-issued with different mapping without asking the user to
 * upload again.
 */
@ApiTags('imports')
@Controller('tenants/:tenantId/imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly certificates: CertificatesService,
    private readonly audit: AuditService,
  ) {}

  @Get('columns')
  @RequirePermissions('import:read')
  @ApiOperation({ summary: 'Canonical columns and the header aliases that map to them' })
  columns(): {
    columns: readonly CanonicalColumn[];
    labels: Record<CanonicalColumn, string>;
    maxUploadBytes: number;
  } {
    return { columns: CANONICAL_COLUMNS, labels: COLUMN_LABELS, maxUploadBytes: MAX_UPLOAD_BYTES };
  }

  @Get('sample.csv')
  @RequirePermissions('import:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="kdc-sample-recipients.csv"')
  @ApiOperation({ summary: 'Download a sample CSV' })
  sampleCsv(@Res() res: Response): void {
    const file = this.imports.sampleCsv();
    res.setHeader('Content-Length', String(file.buffer.byteLength));
    res.status(200).end(file.buffer);
  }

  @Get('sample.xlsx')
  @RequirePermissions('import:read')
  @ApiOperation({ summary: 'Download a styled Excel template' })
  async sampleXlsx(@Res() res: Response): Promise<void> {
    const file = await this.imports.sampleXlsx();
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', String(file.buffer.byteLength));
    res.status(200).end(file.buffer);
  }

  @Get()
  @RequirePermissions('import:read')
  @ApiOperation({ summary: 'List import batches' })
  async list(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: ImportBatch[] }> {
    const n = Math.max(1, Math.min(200, Number.parseInt(limit ?? '50', 10) || 50));
    return { items: await this.imports.list(tenantId, n) };
  }

  @Get(':batchId')
  @RequirePermissions('import:read')
  @ApiOperation({ summary: 'Read one import batch including its row errors and preview' })
  async one(@TenantId() tenantId: string, @Param('batchId') batchId: string): Promise<ImportBatch> {
    return this.imports.getBatch(tenantId, batchId);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('import:create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a CSV/XLSX file, detect the column mapping and stage it' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: UPLOAD_MIME_FILTER as never,
    }),
  )
  async upload(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string | undefined>,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!file?.buffer?.length) {
      throw AppException.validationFailed(
        'A .csv or .xlsx file must be uploaded in the "file" field',
      );
    }
    if (!ctx.userId) throw AppException.unauthenticated();
    const eventId = String(body?.eventId ?? '').trim();
    if (!eventId) throw AppException.validationFailed('eventId is required');

    const prepared = await this.imports.stage(tenantId, eventId, file, {
      uploadedBy: ctx.userId,
      requireEmail: body?.requireEmail === 'true',
      onInvalidEmail:
        body?.onInvalidEmail === 'keep_without_email' ? 'keep_without_email' : 'reject',
    });

    return {
      batchId: prepared.batch.id,
      fileName: prepared.batch.fileName,
      fileType: prepared.batch.fileType,
      totalRows: prepared.batch.totalRows,
      validRows: prepared.batch.validRows,
      invalidRows: prepared.batch.invalidRows,
      mapping: prepared.autoMapping,
      unmappedColumns: prepared.unmapped,
      confidence: prepared.confidence,
      preview: prepared.batch.preview,
      errors: prepared.batch.errors,
      canonicalColumns: CANONICAL_COLUMNS,
      nextStep:
        prepared.batch.invalidRows > 0
          ? 'Fix or skip the invalid rows, confirm the mapping, then POST /imports/:batchId/issue'
          : 'Confirm the mapping, then POST /imports/:batchId/issue',
    };
  }

  @Post(':batchId/issue')
  @HttpCode(202)
  @RequirePermissions('certificate:bulk_issue')
  @ApiOperation({ summary: 'Issue certificates for a staged batch using the confirmed mapping' })
  async issue(
    @TenantId() tenantId: string,
    @Param('batchId') batchId: string,
    @Body()
    body: {
      mapping?: Record<string, CanonicalColumn>;
      requireEmail?: boolean;
      onInvalidEmail?: 'reject' | 'keep_without_email';
      sendEmail?: boolean;
      continueOnFailure?: boolean;
      issuedAt?: string;
    },
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    const batch = await this.imports.getBatch(tenantId, batchId);
    if (batch.status === 'completed' || batch.status === 'processing') {
      throw AppException.conflict(
        `This batch has already been processed (status: ${batch.status})`,
      );
    }
    const rawMapping = body?.mapping ?? batch.columnMapping;
    if (!rawMapping || Object.keys(rawMapping).length === 0) {
      throw AppException.validationFailed(
        'A column mapping is required; upload the file first or supply "mapping"',
      );
    }
    const parsed = importMappingSchema.safeParse(rawMapping);
    if (!parsed.success) {
      throw AppException.validationFailed(
        'The column mapping must map file headers to canonical columns',
        parsed.error.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }
    const mapping = parsed.data;

    const prepared = await this.imports.prepareForIssue(tenantId, batchId, mapping, {
      requireEmail: body?.requireEmail ?? false,
      onInvalidEmail: body?.onInvalidEmail ?? 'reject',
    });
    if (prepared.recipients.length === 0) {
      throw AppException.validationFailed('No valid rows remain after validation', {
        errors: prepared.errors.slice(0, 50),
      });
    }

    const input: IssueBulkInput = issueBulkSchema.parse({
      eventId: batch.eventId,
      recipients: prepared.recipients as IssueBulkInput['recipients'],
      batchId,
      sendEmail: body?.sendEmail ?? true,
      continueOnFailure: body?.continueOnFailure ?? true,
      ...(body?.issuedAt ? { issuedAt: new Date(body.issuedAt) } : {}),
    }) as IssueBulkInput;

    const result = await this.certificates.issueBulk(tenantId, input, {
      actorId: ctx.userId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      batchId,
      issuedAt: input.issuedAt ?? null,
      sendEmail: input.sendEmail,
    });

    await this.audit.record({
      tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role ?? 'admin',
      action: 'import.completed',
      entityType: 'import_batch',
      entityId: batchId,
      payload: {
        jobId: result.jobId,
        validRows: prepared.valid,
        skippedRows: prepared.invalid,
        queued: true,
      },
    });

    return {
      jobId: result.jobId,
      batchId: result.batchId,
      queued: prepared.recipients.length,
      skipped: prepared.invalid,
      chunks: result.chunks,
      errors: prepared.errors.slice(0, 50),
      watch: `/tenants/${tenantId}/jobs/${result.jobId}`,
    };
  }
}

export type { RecipientPayload };
