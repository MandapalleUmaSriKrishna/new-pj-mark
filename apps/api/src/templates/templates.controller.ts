import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Template } from '@kdc/shared';
import { AppException } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthCtx, TenantId, type AuthContext } from '../common/decorators/auth-context.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { TemplatesService } from './templates.service';
import { PdfService } from '../pdf/pdf.service';
import { sampleMergeValues } from '../certificates/merge';
import {
  createTemplateSchema,
  duplicateTemplateSchema,
  listTemplatesSchema,
  previewTemplateSchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type DuplicateTemplateInput,
  type ListTemplatesInput,
  type PreviewTemplateInput,
  type UpdateTemplateInput,
} from './dto';

/** Certificate designs (the drag-and-drop designer's document model). */
@ApiTags('templates')
@Controller('tenants/:tenantId/templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  @RequirePermissions('template:read')
  @ApiOperation({ summary: 'List designs, optionally with the built-in starters' })
  async list(
    @TenantId() tenantId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<{ items: Template[]; starters: ReturnType<TemplatesService['starters']> }> {
    const input = listTemplatesSchema.parse(query) as ListTemplatesInput;
    const items = await this.templates.list(tenantId, input);
    return { items, starters: input.includeStarters ? this.templates.starters() : [] };
  }

  @Get('starters')
  @RequirePermissions('template:read')
  @ApiOperation({ summary: 'Built-in starter designs' })
  starters(): { items: ReturnType<TemplatesService['starters']> } {
    return { items: this.templates.starters() };
  }

  @Get(':templateId')
  @RequirePermissions('template:read')
  @ApiOperation({ summary: 'Read one design including its full document' })
  async one(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
  ): Promise<Template> {
    return this.templates.get(tenantId, templateId);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('template:create')
  @ApiOperation({ summary: 'Create a design' })
  async create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe<CreateTemplateInput>(createTemplateSchema, 'Design'))
    body: CreateTemplateInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<Template> {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.templates.create(tenantId, body, ctx.userId);
  }

  @Patch(':templateId')
  @RequirePermissions('template:update')
  @ApiOperation({ summary: 'Update a design; changing the document bumps its version' })
  async update(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe<UpdateTemplateInput>(updateTemplateSchema, 'Design'))
    body: UpdateTemplateInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<Template> {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.templates.update(tenantId, templateId, body, ctx.userId);
  }

  @Post(':templateId/duplicate')
  @HttpCode(201)
  @RequirePermissions('template:create')
  @ApiOperation({ summary: 'Copy a design (the only way to fork a locked starter)' })
  async duplicate(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe<DuplicateTemplateInput>(duplicateTemplateSchema, 'Duplicate'))
    body: DuplicateTemplateInput,
    @AuthCtx() ctx: AuthContext,
  ): Promise<Template> {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.templates.duplicate(tenantId, templateId, body, ctx.userId);
  }

  @Delete(':templateId')
  @RequirePermissions('template:delete')
  @ApiOperation({ summary: 'Delete a design that no event uses' })
  async remove(
    @TenantId() tenantId: string,
    @Param('templateId') templateId: string,
    @AuthCtx() ctx: AuthContext,
  ) {
    if (!ctx.userId) throw AppException.unauthenticated();
    return this.templates.remove(tenantId, templateId, ctx.userId);
  }

  /**
   * Renders a design to PDF without saving anything, so the designer can show a
   * true preview (same renderer, same warnings) rather than an HTML imitation.
   */
  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('template:read')
  @ApiOperation({ summary: 'Render a design to PDF for preview' })
  async preview(
    @Body(new ZodValidationPipe<PreviewTemplateInput>(previewTemplateSchema, 'Preview'))
    body: PreviewTemplateInput,
  ): Promise<{
    pdfBase64: string;
    bytes: number;
    pages: number;
    sha256: string;
    warnings: string[];
  }> {
    const input = body;
    const result = await this.pdf.render({
      doc: input.doc,
      mergeValues: { ...sampleMergeValues(), ...(input.sample ?? {}) },
      serial: input.serial ?? 'KDC-0000-00000000-0',
      verifyUrl: input.verifyUrl ?? 'https://example.test/verify/sample',
      tenantName: input.tenantName ?? 'Preview Organisation',
      issuedAt: input.issuedAt ? new Date(input.issuedAt) : new Date(),
      watermark: input.watermark ?? 'specimen',
      metadata: { subject: 'Design preview', keywords: ['preview'] },
    });
    return {
      pdfBase64: result.buffer.toString('base64'),
      bytes: result.bytes,
      pages: result.pages,
      sha256: result.sha256,
      warnings: result.warnings,
    };
  }
}
