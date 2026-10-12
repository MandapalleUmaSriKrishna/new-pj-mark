import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CertificateEvent } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions, AllowApiKey } from '../common/decorators/permissions.decorator';
import { EventsService, type EventSummary } from './events.service';
import {
  createEventSchema,
  listEventsSchema,
  updateEventSchema,
  type CreateEventInput,
  type ListEventsInput,
  type UpdateEventInput,
} from './dto';

/** Events (certificate campaigns). */
@ApiTags('events')
@Controller('tenants/:tenantId/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermissions('event:read')
  @AllowApiKey('events:read')
  @ApiOperation({ summary: 'List events with issuance counters' })
  async list(
    @TenantId() tenantId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<{ items: EventSummary[]; total: number }> {
    const input = listEventsSchema.parse(query) as ListEventsInput;
    return this.events.list(tenantId, input);
  }

  @Get('limits')
  @RequirePermissions('event:read')
  @ApiOperation({ summary: 'Plan limits for events and imports' })
  async limits(@TenantId() tenantId: string) {
    return this.events.limits(tenantId);
  }

  @Get(':eventId')
  @RequirePermissions('event:read')
  @AllowApiKey('events:read')
  @ApiOperation({ summary: 'Read one event with its counters' })
  async one(
    @TenantId() tenantId: string,
    @Param('eventId') eventId: string,
  ): Promise<{ event: CertificateEvent; summary: EventSummary }> {
    const event = await this.events.get(tenantId, eventId);
    return { event, summary: await this.events.summarise(event) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('event:create')
  @ApiOperation({ summary: 'Create an event' })
  async create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<CreateEventInput>(createEventSchema, 'Event'))
    body: CreateEventInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<CertificateEvent> {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.events.create(tenantId, body, ctx.userId);
  }

  @Patch(':eventId')
  @RequirePermissions('event:update')
  @ApiOperation({ summary: 'Update an event; issued certificates keep their snapshot' })
  async update(
    @TenantId() tenantId: string,
    @Param('eventId') eventId: string,
    @Body(new ZodValidationPipe<UpdateEventInput>(updateEventSchema, 'Event'))
    body: UpdateEventInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<CertificateEvent> {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.events.update(tenantId, eventId, body, ctx.userId);
  }

  @Delete(':eventId')
  @RequirePermissions('event:delete')
  @ApiOperation({ summary: 'Delete an event, or archive it once certificates exist' })
  async remove(
    @TenantId() tenantId: string,
    @Param('eventId') eventId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.events.remove(tenantId, eventId, ctx.userId);
  }
}
