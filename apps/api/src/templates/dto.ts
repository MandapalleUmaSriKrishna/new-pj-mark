import { z } from 'zod';
import { PAGE_PRESETS, templateDocSchema } from '@kdc/shared';

export const createTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().min(1).max(60).default('General'),
  /** Omit `doc` to start from a named starter design. */
  starterKey: z.string().max(60).optional(),
  doc: templateDocSchema.optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().min(1).max(60).optional(),
  doc: templateDocSchema.optional(),
  thumbnailAssetId: z.string().max(64).nullable().optional(),
  locked: z.boolean().optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const duplicateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
});
export type DuplicateTemplateInput = z.infer<typeof duplicateTemplateSchema>;

export const listTemplatesSchema = z.object({
  q: z.string().max(120).optional(),
  category: z.string().max(60).optional(),
  includeStarters: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(String(v).toLowerCase()),
    )
    .optional(),
});
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema>;

export const previewTemplateSchema = z.object({
  doc: templateDocSchema,
  /** Values substituted into `{{merge.tokens}}`; defaults to the sample data. */
  sample: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .refine((v) => Object.keys(v).length <= 60, { message: 'At most 60 sample values' })
    .optional(),
  watermark: z.enum(['draft', 'specimen', 'revoked']).optional(),
  /** Overridable chrome so the preview matches the real certificate. */
  serial: z.string().trim().max(60).optional(),
  verifyUrl: z.string().trim().url().max(400).optional(),
  tenantName: z.string().trim().max(160).optional(),
  issuedAt: z.coerce.date().optional(),
});
export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;

export const PAGE_PRESET_IDS = Object.keys(PAGE_PRESETS);
