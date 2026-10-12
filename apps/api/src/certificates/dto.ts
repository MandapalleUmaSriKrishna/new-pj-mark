import { z } from 'zod';
import { canonicaliseSerialInput } from '@kdc/shared';

const recipientName = z
  .string()
  .trim()
  .min(1, 'Recipient name is required')
  .max(200)
  .refine((v) => !/^[\s\p{P}\p{S}]+$/u.test(v), 'Recipient name cannot be only punctuation');

const email = z
  .string()
  .trim()
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase())
  .optional()
  .or(z.literal('').transform(() => undefined));

const serialInput = z.string().trim().min(6).max(64).transform(canonicaliseSerialInput);

export const recipientSchema = z.object({
  name: recipientName,
  email,
  title: z.string().trim().max(200).optional(),
  department: z.string().trim().max(200).optional(),
  roll_number: z.string().trim().max(80).optional(),
  grade: z.string().trim().max(80).optional(),
  hours: z.string().trim().max(20).optional(),
  meta: z.record(z.string(), z.string().max(500)).optional(),
});
export type RecipientInput = z.infer<typeof recipientSchema>;

export const issueOneSchema = z.object({
  eventId: z.string().min(1).max(64),
  recipient: recipientSchema,
  issuedAt: z.coerce.date().optional(),
  sendEmail: z.boolean().optional(),
});
export type IssueOneInput = z.infer<typeof issueOneSchema>;

export const issueBulkSchema = z.object({
  eventId: z.string().min(1).max(64),
  recipients: z.array(recipientSchema).min(1).max(500_000),
  batchId: z.string().max(64).optional(),
  issuedAt: z.coerce.date().optional(),
  sendEmail: z.boolean().optional(),
  /** Continue on per-row failures instead of aborting the batch. */
  continueOnFailure: z.boolean().default(true),
});
export type IssueBulkInput = z.infer<typeof issueBulkSchema>;

export const approveSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  /** Issue + render immediately after approving. */
  issue: z.boolean().default(true),
});
export type ApproveInput = z.infer<typeof approveSchema>;

export const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason so the submitter knows what to fix').max(2000),
});
export type RejectInput = z.infer<typeof rejectSchema>;

export const revokeSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  notifyRecipient: z.boolean().default(false),
});
export type RevokeInput = z.infer<typeof revokeSchema>;

export const listCertificatesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  eventId: z.string().max(64).optional(),
  status: z.string().max(30).optional(),
  batchId: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  sort: z
    .enum(['createdAt', 'issuedAt', 'recipient.name', 'serial', 'status'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListCertificatesInput = z.infer<typeof listCertificatesSchema>;

export const verifySchema = z.object({
  serial: serialInput,
  /** Required by tenants that gate self-download behind an email match. */
  email: email.optional(),
});
export type VerifyInput = z.infer<typeof verifySchema>;

export const resendSchema = z.object({
  note: z.string().max(500).optional(),
});
export type ResendInput = z.infer<typeof resendSchema>;
