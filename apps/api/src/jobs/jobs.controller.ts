import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JobRecord, JobType } from '@kdc/shared';
import { JOB_TYPES } from '@kdc/shared';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { JobsService } from './jobs.service';

/** Background job visibility: bulk issuance, PDF renders, mail and webhooks. */
@ApiTags('jobs')
@Controller('tenants/:tenantId/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermissions('certificate:read', 'import:read')
  @ApiOperation({ summary: 'List recent background jobs' })
  async list(
    @Param('tenantId') tenantId: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: JobRecord[]; types: readonly JobType[] }> {
    const jobType = type && JOB_TYPES.includes(type as JobType) ? (type as JobType) : undefined;
    return {
      items: await this.jobs.list(tenantId, {
        type: jobType,
        status,
        limit: Math.max(1, Math.min(200, Number.parseInt(limit ?? '50', 10) || 50)),
      }),
      types: JOB_TYPES,
    };
  }

  @Get('queue')
  @RequirePermissions('tenant:update')
  @ApiOperation({ summary: 'Queue depth across all job types (operator view)' })
  async queue(): Promise<{ driver: string; counts: Record<string, number> }> {
    return { driver: this.jobs.driver, counts: await this.jobs.queueCounts() };
  }

  @Get(':jobId')
  @RequirePermissions('certificate:read', 'import:read')
  @ApiOperation({ summary: 'Read one job with live progress' })
  async one(
    @Param('tenantId') tenantId: string,
    @Param('jobId') jobId: string,
  ): Promise<JobRecord> {
    return this.jobs.get(tenantId, jobId);
  }

  @Post(':jobId/retry')
  @HttpCode(200)
  @RequirePermissions('certificate:bulk_issue')
  @ApiOperation({ summary: 'Re-queue a failed job' })
  async retry(
    @Param('tenantId') tenantId: string,
    @Param('jobId') jobId: string,
    @Body() _body: unknown,
  ) {
    return this.jobs.retry(tenantId, jobId);
  }
}
