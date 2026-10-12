'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AlertTriangle, Check, Copy, Loader2, X, type LucideIcon } from 'lucide-react';
import { cn, TONE_CLASSES, toneFor, type Tone } from '@/lib/utils';

/* ------------------------------------------------------------------ button */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon: Icon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'kdc-btn',
        `kdc-btn-${variant}`,
        size === 'sm' && '!min-h-9 !py-1 !text-xs',
        size === 'lg' && '!min-h-11 !px-5 !text-base',
        size === 'icon' && '!p-2 !min-h-0 aspect-square',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="size-4" aria-hidden />
      ) : null}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------- card */

export function Card({
  className,
  children,
  as: Tag = 'div',
}: {
  className?: string;
  children: ReactNode;
  as?: 'div' | 'section' | 'article';
}) {
  return <Tag className={cn('kdc-card', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--kdc-border)] px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] text-[var(--kdc-brand)]">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-[var(--kdc-text-muted)]">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4 sm:p-5', className)}>{children}</div>;
}

/* ------------------------------------------------------------------- badge */

export function Badge({
  tone = 'muted',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn('kdc-badge', TONE_CLASSES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={toneFor(status)}>{status.replace(/_/g, ' ')}</Badge>;
}

/* ------------------------------------------------------------------ inputs */

export interface FieldProps {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('min-w-0', className)}>
      {label ? (
        <label className="kdc-label" htmlFor={id}>
          {label}
          {required ? (
            <span className="ml-1 text-red-500" aria-hidden>
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {typeof children === 'function' ? children(id) : children}
      {error ? (
        <p
          className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="kdc-hint mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'kdc-input',
        invalid && 'border-red-400 focus-visible:outline-red-400',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('kdc-input min-h-24 resize-y', invalid && 'border-red-400', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn('kdc-input appearance-none bg-[var(--kdc-surface)] pr-8', className)}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitives.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-transparent bg-[var(--kdc-brand)]'
          : 'border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)]',
      )}
    >
      <SwitchPrimitives.Thumb className="block size-4.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[1.35rem]" />
    </SwitchPrimitives.Root>
  );
}

export function Progress({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <ProgressPrimitive.Root
      value={percent}
      aria-label={label}
      className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--kdc-surface-sunken)] ring-1 ring-inset ring-[var(--kdc-border)]"
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full rounded-full transition-all',
          percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-[var(--kdc-brand)]',
        )}
        style={{ width: `${percent}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

/* ------------------------------------------------------------------- modal */

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'kdc-card fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-0 shadow-[var(--shadow-pop)] outline-none',
            wide ? 'max-w-4xl' : 'max-w-lg',
          )}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-[var(--kdc-text-muted)]">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="kdc-btn kdc-btn-ghost !min-h-8 !p-1.5"
                aria-label="Close dialog"
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer ? (
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ states */

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <Loader2
      className={cn('size-5 animate-spin text-[var(--kdc-text-muted)]', className)}
      role="status"
      aria-label={label}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--kdc-border)] px-6 py-12 text-center">
      {Icon ? <Icon className="size-8 text-[var(--kdc-text-muted)]" aria-hidden /> : null}
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-md text-xs text-[var(--kdc-text-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load',
  message,
  onRetry,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50/60 px-6 py-10 text-center dark:border-red-500/30 dark:bg-red-500/10"
    >
      <AlertTriangle className="size-7 text-red-500" aria-hidden />
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">{title}</p>
      {message ? (
        <p className="max-w-md text-xs text-red-600/90 dark:text-red-200/80">{message}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-1" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-xs leading-relaxed',
        TONE_CLASSES[tone],
        className,
      )}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- table */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Hides on small screens. */
  hideBelow?: 'sm' | 'md' | 'lg';
}

export function DataTable<T>({
  rows,
  columns,
  keyOf,
  empty,
  loading,
}: {
  rows: T[];
  columns: Column<T>[];
  keyOf: (row: T) => string;
  empty?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--kdc-border)] text-xs uppercase tracking-wide text-[var(--kdc-text-muted)]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-2 font-semibold',
                  column.hideBelow === 'md' && 'hidden md:table-cell',
                  column.hideBelow === 'lg' && 'hidden lg:table-cell',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }, (_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-[var(--kdc-border)]/60">
                  {columns.map((column) => (
                    <td key={column.key} className="px-3 py-3">
                      <span className="block h-4 animate-pulse rounded bg-[var(--kdc-surface-sunken)]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={keyOf(row)}
                  className="border-b border-[var(--kdc-border)]/60 transition-colors last:border-0 hover:bg-[color-mix(in_oklab,var(--kdc-text)_3%,transparent)]"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-3 py-2.5 align-middle',
                        column.hideBelow === 'md' && 'hidden md:table-cell',
                        column.hideBelow === 'lg' && 'hidden lg:table-cell',
                        column.className,
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 ? (
        <div className="p-4">
          {empty ?? (
            <p className="text-center text-xs text-[var(--kdc-text-muted)]">Nothing here yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-[var(--kdc-text-muted)]">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- misc */

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      icon={copied ? Check : Copy}
      className={cn(copied && 'text-emerald-600 dark:text-emerald-400')}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}

export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            className="z-50 max-w-xs rounded-md bg-ink-900 px-2.5 py-1.5 text-xs text-ink-50 shadow-lg dark:bg-ink-100 dark:text-ink-900"
          >
            {label}
            <Tooltip.Arrow className="fill-ink-900 dark:fill-ink-100" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)] px-1.5 py-0.5 font-mono text-[0.68rem] text-[var(--kdc-text-muted)]">
      {children}
    </kbd>
  );
}
