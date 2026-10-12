import { z } from 'zod';
import { EVENT_STATUSES } from '@kdc/shared';

const slug = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, digits and hyphens only')
  .optional();

export const createEventSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug,
  description: z.string().trim().max(2000).nullable().optional(),
  templateId: z.string().min(1).max(64),
  programmeName: z.string().trim().min(1).max(200).optional(),
  programmeDescription: z.string().trim().max(2000).nullable().optional(),
  date: z.coerce.date().nullable().optional(),
  venue: z.string().trim().max(200).nullable().optional(),
  organiser: z.string().trim().max(200).nullable().optional(),
  requireApproval: z.boolean().optional(),
  autoDeliverEmail: z.boolean().optional(),
  emailSubject: z.string().trim().max(200).nullable().optional(),
  emailBody: z.string().max(20_000).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  extraFields: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9_]+$/i, 'Use letters, digits and underscores'),
        label: z.string().trim().min(1).max(80),
        required: z.boolean().default(false),
        type: z.enum(['text', 'number', 'date', 'email']).default('text'),
      }),
    )
    .max(30)
    .optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema
  .omit({ slug: true })
  .partial()
  .extend({ status: z.enum(EVENT_STATUSES).optional(), slug });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const listEventsSchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  templateId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListEventsInput = z.infer<typeof listEventsSchema>;
