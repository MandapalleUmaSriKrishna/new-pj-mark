import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WebhookDelivery, WebhookEndpoint } from '@kdc/shared';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_HEADERS,
  WEBHOOK_TOLERANCE_SECONDS,
  type WebhookEvent,
} from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { WebhooksService, redactEndpoint } from './webhooks.service';
import {
  createWebhookSchema,
  updateWebhookSchema,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from './dto';

type RedactedEndpoint = Omit<WebhookEndpoint, 'secret'> & { secretPreview: string };

/** Signed outbound webhooks. */
@ApiTags('webhooks')
@Controller('tenants/:tenantId/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('events')
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Subscribable event names and the signature contract' })
  events(): {
    events: readonly WebhookEvent[];
    headers: typeof WEBHOOK_HEADERS;
    signatureFormat: string;
    toleranceSeconds: number;
    verification: string;
  } {
    return {
      events: WEBHOOK_EVENTS,
      headers: WEBHOOK_HEADERS,
      signatureFormat: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" using the endpoint secret>`,
      toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS,
      verification:
        'Recompute HMAC-SHA256 over `${timestamp}.${rawBody}` with the endpoint secret and compare to v1 using a constant-time comparison. Reject the request if the timestamp is older than the tolerance. Use x-kdc-delivery-id to de-duplicate retries.',
    };
  }

  @Get()
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'List endpoints (secrets are never returned)' })
  async list(@TenantId() tenantId: string): Promise<{ items: RedactedEndpoint[] }> {
    return { items: await this.webhooks.list(tenantId) };
  }

  @Get('deliveries')
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Recent delivery attempts and their responses' })
  async deliveries(@TenantId() tenantId: string): Promise<{ items: WebhookDelivery[] }> {
    return { items: await this.webhooks.listDeliveries(tenantId, undefined, 100) };
  }

  @Get(':webhookId')
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Read one endpoint' })
  async one(
    @TenantId() tenantId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<RedactedEndpoint> {
    return redactEndpoint(await this.webhooks.get(tenantId, webhookId));
  }

  @Get(':webhookId/deliveries')
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Delivery history for one endpoint' })
  async endpointDeliveries(
    @TenantId() tenantId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<{ items: WebhookDelivery[] }> {
    await this.webhooks.get(tenantId, webhookId);
    return { items: await this.webhooks.listDeliveries(tenantId, webhookId, 100) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Register an endpoint; the secret is returned once' })
  async create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<CreateWebhookInput>(createWebhookSchema, 'Webhook'))
    body: CreateWebhookInput,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.webhooks.create(tenantId, body, ctx.userId);
  }

  @Patch(':webhookId')
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Update an endpoint or rotate its signing secret' })
  async update(
    @TenantId() tenantId: string,
    @Param('webhookId') webhookId: string,
    @Body(new ZodValidationPipe<UpdateWebhookInput>(updateWebhookSchema, 'Webhook'))
    body: UpdateWebhookInput,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.webhooks.update(tenantId, webhookId, body, ctx.userId);
  }

  @Post(':webhookId/test')
  @HttpCode(200)
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Send a signed test delivery and report the response' })
  async test(
    @TenantId() tenantId: string,
    @Param('webhookId') webhookId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    const delivery = await this.webhooks.sendTest(tenantId, webhookId, ctx.userId);
    return {
      deliveryId: delivery.id,
      status: delivery.status,
      attempts: delivery.attempts,
      responseStatus: delivery.responseStatus,
      responseBody: delivery.responseBody,
      error: delivery.lastError,
    };
  }

  @Delete(':webhookId')
  @RequirePermissions('webhook:manage')
  @ApiOperation({ summary: 'Delete an endpoint' })
  async remove(
    @TenantId() tenantId: string,
    @Param('webhookId') webhookId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.webhooks.remove(tenantId, webhookId, ctx.userId);
  }
}
