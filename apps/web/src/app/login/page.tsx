'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BadgeCheck, Globe, LogIn } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input } from '@/components/ui';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const { t } = useI18n();
  const { login, google } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const next = search.get('next') ?? '/dashboard';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login({ email: values.email, password: values.password, remember: values.remember });
      router.push(next.startsWith('/') ? next : '/dashboard');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'rate_limited') setFormError(t('errors.rateLimited'));
        else if (error.code === 'invalid_credentials') setFormError(error.message);
        else if (error.code === 'forbidden') setFormError(error.message);
        else setFormError(error.message);
      } else {
        setFormError(t('errors.network'));
      }
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
      {formError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          {formError}
        </p>
      ) : null}

      <Field label={t('auth.email')} required error={errors.email?.message}>
        {(id) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@organisation.edu"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        )}
      </Field>

      <Field label={t('auth.password')} required error={errors.password?.message}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        )}
      </Field>

      <label className="flex items-center gap-2 text-xs text-[var(--kdc-text-muted)]">
        <input
          type="checkbox"
          className="size-4 rounded border-[var(--kdc-border)]"
          {...register('remember')}
        />
        {t('auth.rememberMe')}
      </label>

      <Button type="submit" loading={isSubmitting} icon={LogIn} className="w-full">
        {t('auth.signIn')}
      </Button>

      <GoogleButton configured={google?.configured ?? false} reason={google?.reason} />

      <p className="text-center text-xs text-[var(--kdc-text-muted)]">
        {t('auth.noAccount')}{' '}
        <Link
          href="/register"
          className="font-semibold text-[var(--kdc-brand)] underline-offset-2 hover:underline"
        >
          {t('auth.signUp')}
        </Link>
      </p>
    </form>
  );
}

function GoogleButton({ configured, reason }: { configured: boolean; reason?: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <a
        href={configured ? '/api/v1/auth/google' : undefined}
        aria-disabled={!configured}
        onClick={(event) => {
          if (!configured) event.preventDefault();
        }}
        className={
          configured
            ? 'kdc-btn kdc-btn-secondary w-full'
            : 'kdc-btn kdc-btn-secondary w-full pointer-events-none opacity-60'
        }
      >
        <Globe className="size-4" aria-hidden />
        {t('auth.signInWithGoogle')}
      </a>
      {!configured ? (
        <p className="text-center text-[0.68rem] text-[var(--kdc-text-muted)]">
          {reason ?? t('auth.googleDisabled')} — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to
          enable it.
        </p>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-950 text-white">
            <BadgeCheck className="size-5.5" aria-hidden />
          </span>
          <span className="text-sm font-bold">Krishna Digital Certificate</span>
        </Link>
        <div className="kdc-card p-6">
          <h1 className="text-lg font-bold tracking-tight">{t('auth.signIn')}</h1>
          <p className="mb-5 mt-1 text-xs text-[var(--kdc-text-muted)]">{t('app.tagline')}</p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
