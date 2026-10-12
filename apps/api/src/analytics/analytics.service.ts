import { Inject, Injectable } from '@nestjs/common';
import type { Certificate, CertificateEvent, VerificationEvent } from '@kdc/shared';
import { getPlan } from '@kdc/shared';
import { DATA_STORE, type DataStore, type Repository } from '../infra/persistence/repository';
import { dayKey } from '../infra/ids';
import { TenantsService } from '../tenants/tenants.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface TimeSeriesPoint {
  date: string;
  issued: number;
  verified: number;
  revoked: number;
}

export interface OverviewStats {
  totals: {
    certificates: number;
    issued: number;
    pendingApproval: number;
    revoked: number;
    failed: number;
    events: number;
    templates: number;
    members: number;
    verifications: number;
    downloads: number;
  };
  quota: {
    plan: string;
    used: number;
    limit: number;
    remaining: number;
    percent: number;
    resetsOn: string;
  };
  deliveries: Record<string, number>;
  series: TimeSeriesPoint[];
  topEvents: { id: string; name: string; issued: number; revoked: number; pending: number }[];
  recentActivity: {
    at: string;
    serial: string;
    recipientName: string;
    eventName: string;
    status: string;
  }[];
  verificationResults: Record<string, number>;
}

/**
 * Analytics.
 *
 * Aggregations are computed in application code over indexed queries rather than
 * with database-specific pipelines. That keeps one implementation that behaves
 * identically on MongoDB and on the in-process store used by the test suite. At
 * very large volumes the time-series queries should move to a MongoDB
 * aggregation pipeline or a materialised daily rollup; the repository port makes
 * that a contained change.
 */
@Injectable()
export class AnalyticsService {
  private readonly certificates: Repository<Certificate>;
  private readonly events: Repository<CertificateEvent>;
  private readonly verifications: Repository<VerificationEvent>;
  private readonly templates: Repository<{
    tenantId: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  private readonly memberships: Repository<{
    tenantId: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }>;

  constructor(
    @Inject(DATA_STORE) store: DataStore,
    private readonly tenants: TenantsService,
    private readonly notifications: NotificationsService,
  ) {
    this.certificates = store.repository<Certificate>('certificates');
    this.events = store.repository<CertificateEvent>('events');
    this.verifications = store.repository<VerificationEvent>('verification_events');
    this.templates = store.repository('templates');
    this.memberships = store.repository('memberships');
  }

  async overview(tenantId: string, days = 30): Promise<OverviewStats> {
    const since = startOfDaysAgo(Math.max(1, Math.min(365, days)));
    const plan = await this.tenants.planOf(tenantId);
    const entitlements = getPlan(plan);
    const usage = await this.tenants.currentUsage(tenantId);

    const [
      certificates,
      issued,
      pendingApproval,
      revoked,
      failed,
      eventCount,
      templateCount,
      memberCount,
      verificationCount,
      downloads,
      deliveries,
      verificationResults,
    ] = await Promise.all([
      this.certificates.count({ tenantId }),
      this.certificates.count({ tenantId, status: { $in: ['issued', 'delivered'] } }),
      this.certificates.count({ tenantId, status: 'pending_approval' }),
      this.certificates.count({ tenantId, status: 'revoked' }),
      this.certificates.count({ tenantId, status: 'failed' }),
      this.events.count({ tenantId }),
      this.templates.count({ tenantId }),
      this.memberships.count({ tenantId }),
      this.verifications.count({ tenantId }),
      this.certificates.sum('downloadCount', { tenantId }),
      this.notifications.stats(tenantId),
      this.verificationBreakdown(tenantId),
    ]);

    const series = await this.series(tenantId, since);
    const topEvents = await this.topEvents(tenantId);
    const recentActivity = await this.recentActivity(tenantId);

    const limit = entitlements.monthlyCertificateQuota;
    const finite = Number.isFinite(limit) && limit < Number.MAX_SAFE_INTEGER;
    return {
      totals: {
        certificates,
        issued,
        pendingApproval,
        revoked,
        failed,
        events: eventCount,
        templates: templateCount,
        members: memberCount,
        verifications: verificationCount,
        downloads: Math.round(downloads),
      },
      quota: {
        plan,
        used: usage.certificatesThisMonth,
        limit: finite ? limit : -1,
        remaining: finite ? Math.max(0, limit - usage.certificatesThisMonth) : -1,
        percent: finite && limit > 0 ? Math.round((usage.certificatesThisMonth / limit) * 100) : 0,
        resetsOn: nextMonthStart().toISOString(),
      },
      deliveries,
      series,
      topEvents,
      recentActivity,
      verificationResults,
    };
  }

  async series(tenantId: string, since: Date): Promise<TimeSeriesPoint[]> {
    const [issuedRows, verifyRows] = await Promise.all([
      this.certificates.find(
        { tenantId, createdAt: { $gte: since } },
        { limit: 20_000, projection: ['createdAt', 'status', 'serial'] },
      ),
      this.verifications.find(
        { tenantId, createdAt: { $gte: since } },
        { limit: 20_000, projection: ['createdAt', 'result'] },
      ),
    ]);
    const buckets = new Map<string, TimeSeriesPoint>();
    for (let d = new Date(since); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
      buckets.set(dayKey(d), { date: dayKey(d), issued: 0, verified: 0, revoked: 0 });
    }
    for (const row of issuedRows) {
      const point = buckets.get(dayKey(new Date(row.createdAt)));
      if (!point) continue;
      point.issued += 1;
      if (row.status === 'revoked') point.revoked += 1;
    }
    for (const row of verifyRows) {
      const point = buckets.get(dayKey(new Date(row.createdAt)));
      if (!point) continue;
      if (row.result === 'valid') point.verified += 1;
    }
    return [...buckets.values()];
  }

  async topEvents(tenantId: string, limit = 8): Promise<OverviewStats['topEvents']> {
    const events = await this.events.find({ tenantId }, { sort: { createdAt: -1 }, limit: 100 });
    const out: OverviewStats['topEvents'] = [];
    for (const event of events) {
      const [issued, revoked, pending] = await Promise.all([
        this.certificates.count({
          tenantId,
          eventId: event.id,
          status: { $in: ['issued', 'delivered'] },
        }),
        this.certificates.count({ tenantId, eventId: event.id, status: 'revoked' }),
        this.certificates.count({ tenantId, eventId: event.id, status: 'pending_approval' }),
      ]);
      out.push({ id: event.id, name: event.name, issued, revoked, pending });
    }
    return out.sort((a, b) => b.issued - a.issued).slice(0, limit);
  }

  async recentActivity(tenantId: string, limit = 10): Promise<OverviewStats['recentActivity']> {
    const rows = await this.certificates.find({ tenantId }, { sort: { createdAt: -1 }, limit });
    const out: OverviewStats['recentActivity'] = [];
    for (const row of rows) {
      const event = await this.events.findById(row.eventId);
      out.push({
        at: new Date(row.createdAt).toISOString(),
        serial: row.serial,
        recipientName: row.recipient.name,
        eventName: event?.name ?? '(deleted event)',
        status: row.status,
      });
    }
    return out;
  }

  private async verificationBreakdown(tenantId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = { valid: 0, revoked: 0, not_found: 0, malformed: 0 };
    for (const result of Object.keys(out)) {
      out[result] = await this.verifications.count({ tenantId, result });
    }
    return out;
  }

  /** Export-ready rows for a date range (CSV/XLSX export is done client-side). */
  async exportRows(
    tenantId: string,
    opts: { from?: Date; to?: Date; eventId?: string; limit?: number },
  ): Promise<Certificate[]> {
    const filter: Record<string, unknown> = { tenantId };
    if (opts.eventId) filter.eventId = opts.eventId;
    if (opts.from || opts.to) {
      const range: Record<string, unknown> = {};
      if (opts.from) range.$gte = opts.from;
      if (opts.to) range.$lte = opts.to;
      filter.createdAt = range;
    }
    return this.certificates.find(filter as never, {
      sort: { createdAt: -1 },
      limit: Math.min(50_000, opts.limit ?? 10_000),
    });
  }
}

export function startOfDaysAgo(days: number): Date {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
