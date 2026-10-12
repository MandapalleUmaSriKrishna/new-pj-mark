import { z } from 'zod';
import { SUPPORTED_LOCALES, TENANT_TYPES } from '@kdc/shared';

const email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

const slug = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, digits and hyphens only');

const serialPrefix = z
  .string()
  .trim()
  .max(8)
  .regex(/^[A-Za-z0-9]*$/, 'Certificate prefix may only contain letters and digits')
  .transform((v) => v.toUpperCase())
  .optional();

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email,
  password: z.string().min(10, 'Password must be at least 10 characters').max(256),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  /** Organisation created together with the account. */
  organisation: z
    .object({
      name: z.string().trim().min(2).max(160),
      slug: slug.optional(),
      type: z.enum(TENANT_TYPES).default('other'),
      country: z.string().trim().min(2).max(2).max(2).toUpperCase().optional(),
    })
    .optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(256),
  /** When true the refresh cookie outlives the browser session. */
  remember: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(10).max(256),
    confirmPassword: z.string().min(1).max(256),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'New password and confirmation do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const acceptInvitationSchema = z.object({
  /** The unguessable token from the invite link / email. */
  token: z.string().trim().min(8).max(256),
  /** Required only for accounts that do not have a password yet. */
  password: z.string().min(1).max(256).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slug.optional(),
  type: z.enum(TENANT_TYPES).default('other'),
  country: z.string().trim().length(2).toUpperCase().optional(),
  serialPrefix: serialPrefix,
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: z.string().max(64).optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  type: z.enum(TENANT_TYPES).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  serialPrefix: serialPrefix,
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #2563eb');

export const updateBrandingSchema = z.object({
  primaryColor: color.optional(),
  secondaryColor: color.optional(),
  accentColor: color.optional(),
  tagline: z.string().max(160).nullable().optional(),
  website: z.string().url().max(255).nullable().optional(),
  supportEmail: email.nullable().optional(),
  logoAssetId: z.string().max(64).nullable().optional(),
  faviconAssetId: z.string().max(64).nullable().optional(),
  emailBannerAssetId: z.string().max(64).nullable().optional(),
  fontFamily: z.string().max(80).nullable().optional(),
  certificateFooterText: z.string().max(300).nullable().optional(),
  hidePoweredBy: z.boolean().optional(),
});
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

export const updateSettingsSchema = z.object({
  timezone: z.string().max(64).optional(),
  requireApproval: z.boolean().optional(),
  autoDeliverEmail: z.boolean().optional(),
  allowSelfDownload: z.boolean().optional(),
  selfDownloadRequiresEmail: z.boolean().optional(),
  downloadLinkTtlDays: z.number().int().min(0).max(3650).optional(),
  verificationPublic: z.boolean().optional(),
  watermarkDrafts: z.boolean().optional(),
  defaultEmailSubject: z.string().max(200).optional(),
  defaultEmailBody: z.string().max(20_000).optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const inviteMemberSchema = z.object({
  email,
  role: z.enum(['admin', 'manager', 'issuer', 'approver', 'viewer']),
  message: z.string().max(1000).optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager', 'issuer', 'approver', 'viewer']),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
