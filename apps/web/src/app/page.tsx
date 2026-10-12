import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Accessibility,
  BadgeCheck,
  BarChart3,
  BellRing,
  Blocks,
  CloudUpload,
  FileCheck2,
  Fingerprint,
  Globe2,
  KeyRound,
  Layers,
  Lock,
  MailCheck,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Webhook,
  Workflow,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Krishna Digital Certificate — issue and verify certificates at scale',
  description:
    'Multi-tenant platform for colleges, schools, companies, NGOs, government bodies and events: design certificates with a drag-and-drop studio, bulk issue from CSV/XLSX, verify with QR codes, and keep an immutable audit trail.',
  alternates: { canonical: '/' },
};

const ORG_TYPES = [
  { label: 'Colleges & universities', detail: 'Convocations, degrees, transcripts' },
  { label: 'Schools', detail: 'Merit awards, participation, olympiads' },
  { label: 'Companies', detail: 'Training, compliance, service awards' },
  { label: 'NGOs & trusts', detail: 'Volunteer hours, donor recognition' },
  { label: 'Government', detail: 'Scheme completion, licences, gazettes' },
  { label: 'Events & conferences', detail: 'Speaker and attendee certificates' },
  { label: 'Training institutes', detail: 'Course completion, CPD hours' },
];

const FEATURES = [
  {
    icon: Layers,
    title: 'White-label everything',
    body: 'Your logo, colours, domain and email identity. Tenants are isolated by design — one organisation can never read another’s records.',
  },
  {
    icon: Sparkles,
    title: 'Drag-and-drop designer',
    body: 'A WYSIWYG studio in PostScript points, so what you draw is exactly what the PDF engine renders. Merge fields, QR blocks, signatures and seals.',
  },
  {
    icon: CloudUpload,
    title: 'CSV & XLSX bulk issue',
    body: 'Upload a roster, auto-map columns, preview the first rows, fix the bad ones, then queue issuance in chunks with live progress.',
  },
  {
    icon: QrCode,
    title: 'QR + unique IDs',
    body: 'Every certificate carries a check-summed serial (KDC-2026-…-X) and a QR that resolves to a public verification page — no login required.',
  },
  {
    icon: ShieldCheck,
    title: 'Revocation & tamper checks',
    body: 'Revoke with a reason and the verify page says so immediately. An HMAC integrity signature detects any post-issue edit of the record.',
  },
  {
    icon: Lock,
    title: 'Private downloads',
    body: 'Recipients get a one-time 256-bit download token. Only its hash is stored, so a link can never be recovered from the database.',
  },
  {
    icon: FileCheck2,
    title: 'Immutable audit log',
    body: 'Every action is appended to a SHA-256 hash chain. Anyone can verify the chain end-to-end from the dashboard.',
  },
  {
    icon: MailCheck,
    title: 'Email delivery, honestly',
    body: 'SMTP when configured, a captured-to-disk driver when not — and the UI always tells you which one you are on.',
  },
  {
    icon: Webhook,
    title: 'Signed webhooks + retries',
    body: 'HMAC-signed deliveries with replay tolerance, automatic retries and a delivery log you can inspect per endpoint.',
  },
  {
    icon: BarChart3,
    title: 'Analytics that admit limits',
    body: 'Issuance trends, verification results and quota usage against your plan — including when a limit is the reason something stopped.',
  },
  {
    icon: Smartphone,
    title: 'Installable PWA',
    body: 'Add it to the home screen: the app shell is cached, recent lists stay readable offline, and queued actions sync when you are back.',
  },
  {
    icon: BellRing,
    title: 'Real-time status',
    body: 'Server-sent events push bulk-issue progress, job state and delivery results into the dashboard as they happen.',
  },
  {
    icon: Users,
    title: 'Teams & approvals',
    body: 'Role-based access with six roles, invitations, and optional approval workflows before a certificate is issued.',
  },
  {
    icon: KeyRound,
    title: 'API keys & integrations',
    body: 'Scoped machine keys for your student or HR system, plus a documented REST contract with an OpenAPI reference.',
  },
  {
    icon: Globe2,
    title: 'Localised & accessible',
    body: 'English, Hindi and Telugu catalogues, RTL-ready layout, keyboard-operable designer, visible focus and reduced-motion support.',
  },
  {
    icon: Accessibility,
    title: 'Built for everyone',
    body: 'Semantic landmarks, skip links, ARIA-labelled controls and colour contrast checked in both themes.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Create your organisation',
    body: 'Register, get a workspace with six starter designs, and invite your team with roles that match how you actually work.',
  },
  {
    n: '02',
    title: 'Design once',
    body: 'Drag text, images, QR, signatures and serial blocks onto an A4/Letter/square page. Preview renders a real PDF from the same engine that will issue.',
  },
  {
    n: '03',
    title: 'Issue at any scale',
    body: 'One recipient or half a million rows: chunked jobs, per-row results, retries, and live progress over server-sent events.',
  },
  {
    n: '04',
    title: 'Verify forever',
    body: 'Anyone scans the QR or types the serial. Valid, revoked or not-found — answered in milliseconds, with the tamper check shown.',
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--kdc-border)] bg-[color-mix(in_oklab,var(--kdc-surface)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-950 text-white">
            <BadgeCheck className="size-5" aria-hidden />
          </span>
          <span className="text-sm font-bold tracking-tight">Krishna Digital Certificate</span>
          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
            <a
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--kdc-text-muted)] hover:text-[var(--kdc-text)]"
              href="#features"
            >
              Features
            </a>
            <a
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--kdc-text-muted)] hover:text-[var(--kdc-text)]"
              href="#how"
            >
              How it works
            </a>
            <Link
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--kdc-text-muted)] hover:text-[var(--kdc-text)]"
              href="/pricing"
            >
              Pricing
            </Link>
            <Link
              className="rounded-lg px-3 py-1.5 text-sm text-[var(--kdc-text-muted)] hover:text-[var(--kdc-text)]"
              href="/verify"
            >
              Verify
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <Link href="/login" className="kdc-btn kdc-btn-ghost !min-h-9 !py-1.5 !text-xs">
              Sign in
            </Link>
            <Link href="/register" className="kdc-btn kdc-btn-primary !min-h-9 !py-1.5 !text-xs">
              Get started free
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 -top-24 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--kdc-brand)_16%,transparent),transparent)]"
            aria-hidden
          />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-3 py-1 text-[0.7rem] font-semibold text-[var(--kdc-text-muted)]">
                <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden /> Tamper-evident by
                construction
              </p>
              <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-5xl">
                Certificates your recipients can{' '}
                <span className="text-[var(--kdc-brand)]">prove</span>, and your organisation can{' '}
                <span className="text-[var(--kdc-brand)]">trust</span>.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--kdc-text-muted)] sm:text-base">
                One platform for colleges, schools, companies, NGOs, government bodies and events:
                design in a drag-and-drop studio, bulk issue from CSV or XLSX, deliver by email or
                private link, and verify any certificate by QR in seconds.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/register" className="kdc-btn kdc-btn-primary !min-h-11 !px-5 !text-sm">
                  Start issuing free
                </Link>
                <Link href="/verify" className="kdc-btn kdc-btn-secondary !min-h-11 !px-5 !text-sm">
                  Verify a certificate
                </Link>
              </div>
              <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4 text-center sm:text-left">
                <div>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
                    Organisations
                  </dt>
                  <dd className="text-lg font-bold">1,000+</dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
                    Max rows / import
                  </dt>
                  <dd className="text-lg font-bold">500,000</dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--kdc-text-muted)]">
                    Verification
                  </dt>
                  <dd className="text-lg font-bold">&lt; 100 ms</dd>
                </div>
              </dl>
            </div>

            {/* Hero visual: a real starter design rendered from the shared schema */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="kdc-card overflow-hidden p-2 shadow-[var(--shadow-pop)]">
                <HeroCertificate />
              </div>
              <div className="kdc-card absolute -bottom-5 left-4 flex items-center gap-2 px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
                <QrCode className="size-4 text-[var(--kdc-brand)]" aria-hidden />
                <span className="font-mono font-semibold">KDC-2026-7QK3M9XA-4</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  valid
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Org types */}
        <section className="border-y border-[var(--kdc-border)] bg-[var(--kdc-surface)] py-8">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-xs font-bold uppercase tracking-[0.2em] text-[var(--kdc-text-muted)]">
              Built for every kind of issuer
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ORG_TYPES.map((org) => (
                <li
                  key={org.label}
                  className="rounded-xl border border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)] px-3.5 py-3"
                >
                  <p className="text-sm font-semibold">{org.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--kdc-text-muted)]">{org.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
            Everything a certificate programme needs
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--kdc-text-muted)]">
            Not a PDF mail-merge: a complete issuance pipeline with tenancy, approvals, quotas,
            delivery, verification and audit.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="kdc-card p-4">
                  <span className="grid size-9 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] text-[var(--kdc-brand)]">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <h3 className="mt-3 text-sm font-bold">{feature.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--kdc-text-muted)]">
                    {feature.body}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <section
          id="how"
          className="border-y border-[var(--kdc-border)] bg-[var(--kdc-surface)] py-14"
        >
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              From roster to verified, in four steps
            </h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-4">
              {STEPS.map((step) => (
                <li
                  key={step.n}
                  className="relative rounded-xl border border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)] p-4"
                >
                  <span className="font-mono text-[0.65rem] font-bold text-[var(--kdc-brand)]">
                    {step.n}
                  </span>
                  <h3 className="mt-1 text-sm font-bold">{step.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--kdc-text-muted)]">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-8 grid gap-4 md:grid-cols-3" id="webhooks">
              <div className="kdc-card p-4">
                <Workflow className="size-4.5 text-[var(--kdc-brand)]" aria-hidden />
                <h3 className="mt-2 text-sm font-bold">Approvals before issue</h3>
                <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                  Require a second pair of eyes on every certificate, or per event. Approvers see a
                  queue with the rendered preview.
                </p>
              </div>
              <div className="kdc-card p-4">
                <RefreshCw className="size-4.5 text-[var(--kdc-brand)]" aria-hidden />
                <h3 className="mt-2 text-sm font-bold">Jobs that survive</h3>
                <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                  Bulk runs are chunked background jobs with progress, per-row failure reasons and
                  one-click retry of failed rows.
                </p>
              </div>
              <div className="kdc-card p-4" id="pwa">
                <Smartphone className="size-4.5 text-[var(--kdc-brand)]" aria-hidden />
                <h3 className="mt-2 text-sm font-bold">Works offline-first</h3>
                <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                  Install the PWA: cached shell, readable recent lists offline, and a queue that
                  replays writes when you reconnect.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Trust strip */}
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 rounded-2xl border border-[var(--kdc-border)] bg-gradient-to-br from-brand-50 to-transparent p-6 sm:grid-cols-3 dark:from-brand-950/40">
            <div className="flex gap-3">
              <Fingerprint className="size-5 shrink-0 text-[var(--kdc-brand)]" aria-hidden />
              <div>
                <h3 className="text-sm font-bold">Per-tenant encryption</h3>
                <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                  Envelope encryption with a wrapped key per organisation; recipient emails are
                  encrypted with blind indexes for lookup.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Blocks className="size-5 shrink-0 text-[var(--kdc-brand)]" aria-hidden />
              <div>
                <h3 className="text-sm font-bold">Honest degradation</h3>
                <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                  Unconfigured integrations answer 503 with the exact variable to set — nothing here
                  pretends to be live.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Globe2 className="size-5 shrink-0 text-[var(--kdc-brand)]" aria-hidden />
              <div>
                <h3 className="text-sm font-bold">Your domain, your brand</h3>
                <p className="mt-1 text-xs text-[var(--kdc-text-muted)]">
                  Custom domains with verification records, plus white-label emails and verification
                  pages on paid plans.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-6 py-8 text-center">
            <h2 className="text-xl font-black tracking-tight sm:text-2xl">
              Ready to retire the paper certificates?
            </h2>
            <p className="max-w-xl text-sm text-[var(--kdc-text-muted)]">
              Create a workspace in under a minute. The free plan includes 100 certificates a month,
              6 starter designs and public verification.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <Link href="/register" className="kdc-btn kdc-btn-primary !min-h-11 !px-5 !text-sm">
                Create your workspace
              </Link>
              <Link href="/pricing" className="kdc-btn kdc-btn-secondary !min-h-11 !px-5 !text-sm">
                Compare plans
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-4 py-4 text-center text-[0.7rem] text-[var(--kdc-text-muted)]">
        © {new Date().getFullYear()} Krishna Digital Certificate ·{' '}
        <Link className="underline-offset-2 hover:underline" href="/verify">
          verify a certificate
        </Link>{' '}
        ·{' '}
        <Link className="underline-offset-2 hover:underline" href="/api-docs">
          API docs
        </Link>
      </footer>
    </div>
  );
}

/** Static, dependency-free illustration of a certificate built from the same schema the API serves. */
function HeroCertificate() {
  return (
    <svg
      viewBox="0 0 842 595"
      role="img"
      aria-label="Sample certificate design with a double-rule frame, recipient name and QR code"
      className="block h-auto w-full rounded-lg bg-white"
    >
      <rect width="842" height="595" fill="#fdfcf9" />
      <rect x="24" y="24" width="794" height="547" fill="none" stroke="#1f3a5f" strokeWidth="3" />
      <rect x="34" y="34" width="774" height="527" fill="none" stroke="#1f3a5f" strokeWidth="1" />
      <text
        x="421"
        y="120"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="42"
        fill="#1f3a5f"
      >
        Certificate of Achievement
      </text>
      <text
        x="421"
        y="168"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="16"
        fill="#5a6b85"
      >
        This is to certify that
      </text>
      <text
        x="421"
        y="240"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="40"
        fill="#111827"
      >
        Jane Q. Public
      </text>
      <line x1="240" y1="262" x2="602" y2="262" stroke="#c8a44d" strokeWidth="2" />
      <text
        x="421"
        y="300"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="15"
        fill="#5a6b85"
      >
        has successfully completed the Annual Convocation 2026
      </text>
      <text
        x="421"
        y="326"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="15"
        fill="#5a6b85"
      >
        with distinction in Computer Science
      </text>
      <g fontFamily="Courier, monospace" fill="#374151">
        <text x="70" y="520" fontSize="12">
          Certificate ID
        </text>
        <text x="70" y="540" fontSize="13" fontWeight="bold">
          KDC-2026-7QK3M9XA-4
        </text>
      </g>
      <g>
        <rect x="676" y="452" width="96" height="96" fill="#ffffff" stroke="#d5d9e2" />
        {Array.from({ length: 9 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) =>
            (row * 31 + col * 17 + row * col) % 5 < 2 ? (
              <rect
                key={`${row}-${col}`}
                x={684 + col * 9}
                y={460 + row * 9}
                width="8"
                height="8"
                fill="#111827"
              />
            ) : null,
          ),
        )}
      </g>
      <text
        x="421"
        y="470"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="13"
        fontStyle="italic"
        fill="#1f3a5f"
      >
        Registrar
      </text>
      <line x1="330" y1="480" x2="512" y2="480" stroke="#374151" strokeWidth="1" />
    </svg>
  );
}
