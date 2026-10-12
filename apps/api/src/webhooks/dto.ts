import { z } from 'zod';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@kdc/shared';

const eventArray = z
  .array(z.enum(WEBHOOK_EVENTS as unknown as [WebhookEvent, ...WebhookEvent[]]))
  .min(1, 'Select at least one event')
  .max(WEBHOOK_EVENTS.length);

export const createWebhookSchema = z.object({
  url: z.string().trim().url('A valid absolute URL is required').max(500),
  events: eventArray,
  description: z.string().trim().max(200).nullable().optional(),
  active: z.boolean().optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    url: z.string().trim().url().max(500).optional(),
    events: eventArray.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    active: z.boolean().optional(),
    rotateSecret: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
