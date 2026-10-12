import { Controller, Get, Logger, Param, Sse } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, Subject } from 'rxjs';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { JobsService, type JobStreamMessage } from './jobs.service';

export interface SseMessage {
  data: JobStreamMessage | { type: string; [key: string]: unknown };
  type?: string;
  id?: string;
  retry?: number;
}

/** Heartbeat interval; keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 25_000;
/** Hard cap so a leaked browser tab cannot hold a stream open forever. */
const MAX_STREAM_MS = 60 * 60 * 1000;

/**
 * Realtime stream (Server-Sent Events).
 *
 * SSE rather than WebSockets: the traffic is strictly server-to-client, it rides
 * ordinary HTTPS (so proxies, load balancers and the PWA's fetch layer need no
 * special configuration), it reconnects natively with `Last-Event-ID`, and it
 * works inside a service worker-free browser context. Each connection is scoped
 * to one tenant channel and is authenticated by the same guard as every other
 * tenant route, so a stream can never carry another organisation's events.
 */
@ApiTags('realtime')
@Controller('tenants/:tenantId')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(private readonly jobs: JobsService) {}

  @Get('stream')
  @Sse()
  @RequirePermissions('certificate:read', 'import:read', 'analytics:read', 'tenant:read')
  @ApiOperation({
    summary: 'Subscribe to live job, certificate and quota events for this organisation',
  })
  stream(@Param('tenantId') tenantId: string): Observable<SseMessage> {
    const subject = new Subject<SseMessage>();
    let seq = 0;
    const next = (type: string, data: Record<string, unknown>): void => {
      seq += 1;
      subject.next({
        data: { type, ...data } as SseMessage['data'],
        type,
        id: String(seq),
        retry: HEARTBEAT_MS,
      });
    };

    const unsubscribe = this.jobs.subscribe(tenantId, (message) => {
      next(message.event, { tenantId: message.tenantId, at: message.at, payload: message.data });
    });

    // Tell the client the stream is live and what it will receive.
    next('stream.open', {
      tenantId,
      openedAt: new Date().toISOString(),
      events: [
        'job.progress',
        'job.completed',
        'job.failed',
        'certificate.issued',
        'certificate.revoked',
        'certificate.approved',
        'certificate.rejected',
        'import.progress',
        'import.completed',
        'import.failed',
        'quota.warning',
        'webhook.failed',
        'delivery.failed',
        'tenant.updated',
      ],
    });

    const heartbeat = setInterval(
      () => next('heartbeat', { at: new Date().toISOString() }),
      HEARTBEAT_MS,
    );
    const deadline = setTimeout(() => {
      next('stream.timeout', {
        reason: 'Streams are closed after one hour; reconnect to continue.',
      });
      subject.complete();
    }, MAX_STREAM_MS);

    this.logger.debug(`SSE stream opened for tenant ${tenantId}`);

    return new Observable<SseMessage>((subscriber) => {
      const subscription = subject.subscribe(subscriber);
      return () => {
        clearInterval(heartbeat);
        clearTimeout(deadline);
        unsubscribe();
        subscription.unsubscribe();
        subject.complete();
        this.logger.debug(`SSE stream closed for tenant ${tenantId}`);
      };
    });
  }
}
