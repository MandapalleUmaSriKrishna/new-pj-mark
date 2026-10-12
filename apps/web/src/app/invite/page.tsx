'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BadgeCheck, MailOpen, UserPlus } from 'lucide-react';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { AcceptInvitationResult, InvitationDetails } from '@/lib/types';
import { Button, ErrorState, Field, Input, Notice, Spinner } from '@/components/ui';
import { formatDate, titleCase } from '@/lib/utils';

const schema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type FormValues = z.infer<typeof schema>;

function InviteInner() {
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const { t } = useI18n();
  const { status, user, setActiveTenant } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitationDetails>(`${API_PREFIX}/auth/invite`, { query: { token } }),
    enabled: token.length > 0,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const accept = async (password?: string) => {
    setError(null);
    setIssues([]);
    try {
      const result = await api.post<AcceptInvitationResult>(`${API_PREFIX}/auth/invite/accept`, {
        token,
        password,
      });
      setActiveTenant(result.tenantId);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields.length > 0) setIssues(err.fields.map((issue) => issue.message));
        else setError(err.message);
      } else {
        setError(t('errors.network'));
      }
    }
  };

  if (!token) {
    return (
      <ErrorState
        title="No invitation link"
        message="Open the link from your invitation email, or ask an administrator to send a new one."
      />
    );
  }

  if (invite.isPending) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }

  if (invite.isError) {
    const reason =
      invite.error instanceof ApiError
        ? invite.error.message
        : 'That invitation could not be read.';
    return <ErrorState title="Invitation unavailable" message={reason} />;
  }

  const details = invite.data;
  const needsPassword = !details.hasPassword;
  const signedInAsSomeoneElse =
    status === 'authenticated' && user && user.email.toLowerCase() !== details.email.toLowerCase();

  const onSubmit = handleSubmit(async (values) => accept(values.password));

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="kdc-card p-6">
        <span className="grid size-11 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] text-[var(--kdc-brand)]">
          <MailOpen className="size-5" aria-hidden />
        </span>
        <h1 className="mt-3 text-lg font-bold tracking-tight">Join {details.tenantName}</h1>
        <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
          You were invited as{' '}
          <strong className="font-semibold text-[var(--kdc-text)]">
            {titleCase(details.role)}
          </strong>{' '}
          using <span className="font-mono">{details.email}</span>
          {details.expiresAt ? <> · valid until {formatDate(details.expiresAt)}</> : null}.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}
        {issues.length > 0 ? (
          <Notice tone="warn" className="mt-4">
            <ul className="list-inside list-disc space-y-0.5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {signedInAsSomeoneElse ? (
          <Notice tone="warn" className="mt-4">
            You are signed in as {user?.email}. This invitation belongs to {details.email}. Sign out
            first, or ask an administrator to invite this account instead.
          </Notice>
        ) : status === 'authenticated' ? (
          <div className="mt-5 space-y-3">
            <p className="text-xs text-[var(--kdc-text-muted)]">Accepting as {user?.email}.</p>
            <Button
              className="w-full"
              icon={UserPlus}
              onClick={() => void accept()}
              disabled={isSubmitting}
            >
              Accept invitation
            </Button>
          </div>
        ) : needsPassword ? (
          <form onSubmit={(event) => void onSubmit(event)} className="mt-5 space-y-4" noValidate>
            <Notice tone="info">
              This account does not have a password yet — the invitation link verifies it is you, so
              choose one now.
            </Notice>
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
            <Button type="submit" loading={isSubmitting} className="w-full" icon={UserPlus}>
              Create password &amp; join
            </Button>
          </form>
        ) : (
          <div className="mt-5 space-y-3">
            <Notice tone="info">
              This account already has a password. Sign in, then accept the invitation from this
              page.
            </Notice>
            <Link
              href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}
              className="kdc-btn kdc-btn-primary w-full"
            >
              {t('auth.signIn')}
            </Link>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-[var(--kdc-text-muted)]">
        Not {details.email}? Invitations are single-use and expire after 14 days.
      </p>
    </div>
  );
}

export default function InvitePage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-950 text-white">
            <BadgeCheck className="size-5.5" aria-hidden />
          </span>
          <span className="text-sm font-bold">Krishna Digital Certificate</span>
        </Link>
        <Suspense fallback={<Spinner />}>
          <InviteInner />
        </Suspense>
      </div>
    </div>
  );
}
