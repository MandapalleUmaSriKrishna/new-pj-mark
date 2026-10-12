import { Controller, Get, Header, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuditLog } from '@kdc/shared';
import { AUDIT_ACTIONS } from '@kdc/shared';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuditService } from './audit.service';
import { csvBuffer } from '../common/csv';

/**
 * Immutable audit trail.
 *
 * Read-only by design: there is no update or delete endpoint anywhere in the
 * API. Each entry stores the SHA-256 of the previous entry, and
 * `GET /audit/verify` walks the chain so a tenant can prove nothing was altered
 * out of band.
 */
@ApiTags('audit')
@Controller('tenants/:tenantId/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Query the audit log' })
  async list(
    @Param('tenantId') tenantId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<{
    items: AuditLog[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.max(1, Math.min(200, Number.parseInt(query.pageSize ?? '50', 10) || 50));
    const result = await this.audit.list(tenantId, {
      page,
      pageSize,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      q: query.q,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    return { ...result, page, pageSize, hasMore: page * pageSize < result.total };
  }

  @Get('actions')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Every action type that can appear in the log' })
  actions(): { actions: readonly string[] } {
    return { actions: AUDIT_ACTIONS };
  }

  /** Recomputes the hash chain and reports the first break, if any. */
  @Post('verify')
  @HttpCode(200)
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Verify the hash chain of the audit log' })
  async verify(@Param('tenantId') tenantId: string) {
    return this.audit.verifyChain(tenantId);
  }

  @Get('export.csv')
  @RequirePermissions('audit:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Export the audit log as CSV' })
  async exportCsv(
    @Param('tenantId') tenantId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.audit.list(tenantId, {
      page: 1,
      pageSize: 200,
      action: query.action,
      entityType: query.entityType,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    const headers = [
      'createdAt',
      'action',
      'severity',
      'entityType',
      'entityId',
      'actorId',
      'actorEmail',
      'actorRole',
      'ip',
      'requestId',
      'payload',
      'hash',
      'prevHash',
    ];
    const rows = result.items.map((log) => [
      log.createdAt,
      log.action,
      log.severity,
      log.entityType,
      log.entityId,
      log.actorId ?? '',
      log.actorEmail ?? '',
      log.actorRole ?? '',
      log.ip ?? '',
      log.requestId ?? '',
      log.payload ?? {},
      log.hash ?? '',
      log.prevHash ?? '',
    ]);
    const buffer = csvBuffer(headers, rows);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${tenantId}-${Date.now()}.csv"`,
    );
    res.setHeader('Content-Length', String(buffer.byteLength));
    res.status(200).end(buffer);
  }
}
