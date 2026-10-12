import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VerifyResult } from '@/components/verify-panel';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';

const SERIAL_RX = /^[A-Z0-9][A-Z0-9-]{5,63}$/i;

interface PageProps {
  params: Promise<{ serial: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { serial } = await params;
  return {
    title: `Verify ${serial}`,
    description:
      'Verification result for a Krishna Digital Certificate, including issuer, recipient and tamper check.',
    robots: { index: false, follow: false },
  };
}

export default async function VerifySerialPage({ params }: PageProps) {
  const { serial } = await params;
  const trimmed = String(serial ?? '').trim();
  if (!trimmed || trimmed.length > 64 || !SERIAL_RX.test(trimmed)) notFound();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <VerifyResult serial={trimmed.toUpperCase()} />
      </main>
      <SiteFooter />
    </div>
  );
}
