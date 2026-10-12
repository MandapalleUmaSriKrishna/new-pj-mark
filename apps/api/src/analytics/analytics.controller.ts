import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions, AllowApiKey } from '../common/decorators/permissions.decorator';
import { AnalyticsService, type OverviewStats } from './analytics.service';
import { csvBuffer } from '../common/csv';
import { AppException } from '../common/errors/app.exception';

/** Dashboards, time series and exports. */
@ApiTags('analytics')
@Controller('tenants/:tenantId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @RequirePermissions('analytics:read')
  @AllowApiKey('analytics:read')
  @ApiOperation({ summary: 'Dashboard overview: totals, quota, deliveries, series and top events' })
  async overview(
    @Param('tenantId') tenantId: string,
    @Query('days') days?: string,
  ): Promise<OverviewStats> {
    const n = Math.max(1, Math.min(365, Number.parseInt(days ?? '30', 10) || 30));
    return this.analytics.overview(tenantId, n);
  }

  @Get('series')
  @RequirePermissions('analytics:read')
  @AllowApiKey('analytics:read')
  @ApiOperation({ summary: 'Daily issued / verified / revoked counts' })
  async series(@Param('tenantId') tenantId: string, @Query('days') days?: string) {
    const n = Math.max(1, Math.min(365, Number.parseInt(days ?? '30', 10) || 30));
    const since = new Date(Date.now() - (n - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    return { days: n, series: await this.analytics.series(tenantId, since) };
  }

  @Get('events')
  @RequirePermissions('analytics:read')
  @ApiOperation({ summary: 'Per-event issuance ranking' })
  async topEvents(@Param('tenantId') tenantId: string) {
    return { items: await this.analytics.topEvents(tenantId) };
  }

  @Get('export.csv')
  @RequirePermissions('analytics:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Export certificates as CSV' })
  async exportCsv(
    @Param('tenantId') tenantId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.analytics.exportRows(tenantId, {
      eventId: query.eventId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: Math.min(50_000, Number.parseInt(query.limit ?? '10000', 10) || 10_000),
    });
    if (rows.length === 0) {
      throw AppException.notFound('No certificates match that filter');
    }
    // Recipient email is stored encrypted, so the export carries a presence
    // flag rather than plaintext PII; an operator who needs the address can
    // decrypt it through the certificate detail endpoint with an audit entry.
    const headers = [
      'serial',
      'status',
      'recipient_name',
      'recipient_email_stored',
      'title',
      'department',
      'roll_number',
      'grade',
      'hours',
      'event_id',
      'template_id',
      'issued_at',
      'last_rendered_at',
      'revoked_at',
      'revocation_reason',
      'download_count',
      'view_count',
      'batch_id',
      'integrity_signature_present',
    ];
    const body = rows.map((c) => [
      c.serial,
      c.status,
      c.recipient.name,
      c.recipientEmailEnc ? 'yes' : 'no',
      c.recipient.title ?? '',
      c.recipient.department ?? '',
      c.recipient.rollNumber ?? '',
      c.recipient.grade ?? '',
      c.recipient.hours ?? '',
      c.eventId,
      c.templateId,
      c.issuedAt ?? '',
      c.lastRenderedAt ?? '',
      c.revocation?.revokedAt ?? '',
      c.revocation?.reason ?? '',
      c.downloadCount ?? 0,
      c.viewCount ?? 0,
      c.batchId ?? '',
      c.integritySignature ? 'yes' : 'no',
    ]);
    const buffer = csvBuffer(headers, body);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificates-${tenantId}-${Date.now()}.csv"`,
    );
    res.setHeader('Content-Length', String(buffer.byteLength));
    res.status(200).end(buffer);
  }
}
