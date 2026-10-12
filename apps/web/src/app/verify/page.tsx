import type { Metadata } from 'next';
import { QrCode, ShieldCheck, TimerReset } from 'lucide-react';
import { VerifyForm } from '@/components/verify-panel';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  description:
    'Check any Krishna Digital Certificate by its ID or QR code. No account needed: the answer includes the tamper-check result.',
  alternates: { canonical: '/verify' },
};

export default function VerifyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] text-[var(--kdc-brand)]">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="mt-3 text-2xl font-black tracking-tight">Verify a certificate</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--kdc-text-muted)]">
            Enter the certificate ID printed on the certificate or scan its QR code. The result
            shows who it was issued to, by whom, and whether the record has been altered or revoked.
          </p>
        </div>

        <div className="mt-7">
          <VerifyForm />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="kdc-card p-4">
            <QrCode className="size-4 text-[var(--kdc-brand)]" aria-hidden />
            <p className="mt-2 text-xs font-semibold">QR on every certificate</p>
            <p className="mt-1 text-[0.7rem] text-[var(--kdc-text-muted)]">
              Scanning opens this page with the serial prefilled.
            </p>
          </div>
          <div className="kdc-card p-4">
            <ShieldCheck className="size-4 text-[var(--kdc-brand)]" aria-hidden />
            <p className="mt-2 text-xs font-semibold">Tamper check included</p>
            <p className="mt-1 text-[0.7rem] text-[var(--kdc-text-muted)]">
              An HMAC signature over the record detects any post-issue edit.
            </p>
          </div>
          <div className="kdc-card p-4">
            <TimerReset className="size-4 text-[var(--kdc-brand)]" aria-hidden />
            <p className="mt-2 text-xs font-semibold">Revocation is instant</p>
            <p className="mt-1 text-[0.7rem] text-[var(--kdc-text-muted)]">
              A revoked certificate says so here immediately, with the reason.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
