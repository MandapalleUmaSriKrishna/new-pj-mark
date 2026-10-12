'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BadgeCheck, Building2, UserPlus } from 'lucide-react';
import { TENANT_TYPES } from '@kdc/shared';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import { slugify } from '@/lib/utils';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(120),
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(12, 'Use at least 12 characters'),
    confirmPassword: z.string(),
    createOrganisation: z.boolean(),
    orgName: z.string().trim().max(160),
    orgSlug: z.string().trim().max(48),
    orgType: z.string(),
    country: z.string().trim().max(2),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((values) => !values.createOrganisation || values.orgName.length >= 2, {
    message: 'Name your organisation',
    path: ['orgName'],
  });

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const { t } = useI18n();
  const { register: signIn, google } = useSession();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [policyIssues, setPolicyIssues] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      createOrganisation: true,
      orgName: '',
      orgSlug: '',
      orgType: 'college',
      country: 'IN',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setPolicyIssues([]);
    try {
      await signIn({
        name: values.name,
        email: values.email,
        password: values.password,
        organisation: values.createOrganisation
          ? {
              name: values.orgName,
              slug: values.orgSlug || undefined,
              type: values.orgType,
              country: values.country || undefined,
            }
          : undefined,
      });
      router.push('/dashboard');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.fields.length > 0) setPolicyIssues(error.fields.map((issue) => issue.message));
        else setFormError(error.message);
      } else {
        setFormError(t('errors.network'));
      }
    }
  });

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-950 text-white">
            <BadgeCheck className="size-5.5" aria-hidden />
          </span>
          <span className="text-sm font-bold">Krishna Digital Certificate</span>
        </Link>

        <div className="kdc-card p-6">
          <h1 className="text-lg font-bold tracking-tight">{t('auth.signUp')}</h1>
          <p className="mb-5 mt-1 text-xs text-[var(--kdc-text-muted)]">
            Free plan: 100 certificates/month, 6 starter designs, public verification.
          </p>

          {formError ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            >
              {formError}
            </p>
          ) : null}
          {policyIssues.length > 0 ? (
            <Notice tone="warn" className="mb-4">
              <strong className="font-semibold">Password policy:</strong>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {policyIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
            <Field label={t('auth.name')} required error={errors.name?.message}>
              {(id) => (
                <Input
                  id={id}
                  autoComplete="name"
                  placeholder="Jane Q. Public"
                  invalid={Boolean(errors.name)}
                  {...register('name')}
                />
              )}
            </Field>
            <Field label={t('auth.email')} required error={errors.email?.message}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="email"
                  placeholder="you@organisation.edu"
                  invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              )}
            </Field>
            <Field
              label={t('auth.password')}
              required
              error={errors.password?.message}
              hint={t('auth.passwordHint')}
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
              )}
            </Field>
            <Field
              label={t('auth.confirmPassword')}
              required
              error={errors.confirmPassword?.message}
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  invalid={Boolean(errors.confirmPassword)}
                  {...register('confirmPassword')}
                />
              )}
            </Field>

            <fieldset className="space-y-3 rounded-xl border border-[var(--kdc-border)] p-3">
              <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold">
                <Building2 className="size-3.5 text-[var(--kdc-brand)]" aria-hidden />
                {t('auth.createOrganisation')}
              </legend>
              <label className="flex items-center gap-2 text-xs text-[var(--kdc-text-muted)]">
                <input
                  type="checkbox"
                  className="size-4 rounded border-[var(--kdc-border)]"
                  {...register('createOrganisation')}
                />
                Create a workspace now (recommended)
              </label>
              <Field label={t('auth.organisationName')} error={errors.orgName?.message}>
                {(id) => (
                  <Input
                    id={id}
                    placeholder="Krishna Institute of Technology"
                    invalid={Boolean(errors.orgName)}
                    {...register('orgName')}
                    onChange={(event) => {
                      setValue('orgName', event.target.value);
                      if (!getValues('orgSlug')) setValue('orgSlug', slugify(event.target.value));
                    }}
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('auth.organisationSlug')} hint="kdc.app/…">
                  {(id) => <Input id={id} placeholder="krishna-inst" {...register('orgSlug')} />}
                </Field>
                <Field label={t('auth.organisationType')}>
                  {(id) => (
                    <Select id={id} {...register('orgType')}>
                      {TENANT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </fieldset>

            <Button type="submit" loading={isSubmitting} icon={UserPlus} className="w-full">
              {t('auth.createOrganisation')}
            </Button>

            {google?.configured ? (
              <a href="/api/v1/auth/google" className="kdc-btn kdc-btn-secondary w-full">
                {t('auth.signInWithGoogle')}
              </a>
            ) : null}

            <p className="text-center text-xs text-[var(--kdc-text-muted)]">
              {t('auth.haveAccount')}{' '}
              <Link
                href="/login"
                className="font-semibold text-[var(--kdc-brand)] underline-offset-2 hover:underline"
              >
                {t('auth.signIn')}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
