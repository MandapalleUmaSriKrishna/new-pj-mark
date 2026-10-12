'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CalendarDays, Pencil, Plus } from 'lucide-react';
import type { Template } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { EventView, ListResult } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  StatusBadge,
  Switch,
  type Column,
} from '@/components/ui';
import { Select } from '@/components/ui';
import { formatDate, formatNumber, truncate } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(160),
  programmeName: z.string().trim().max(200).optional(),
  date: z.string().optional(),
  venue: z.string().trim().max(200).optional(),
  templateId: z.string().min(1, 'Choose a design'),
  requireApproval: z.boolean(),
  autoDeliverEmail: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function EventsInner() {
  const { activeTenant, can } = useSession();
  const { t, locale } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(search.get('new') === '1');
  const [editing, setEditing] = useState<EventView | null>(null);

  const events = useQuery({
    queryKey: ['events', tenantId],
    queryFn: () => api.get<ListResult<EventView>>(`${API_PREFIX}/tenants/${tenantId}/events`),
    enabled: Boolean(tenantId),
  });

  const templates = useQuery({
    queryKey: ['templates', tenantId],
    queryFn: () => api.get<ListResult<Template>>(`${API_PREFIX}/tenants/${tenantId}/templates`),
    enabled: Boolean(tenantId),
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name,
        programmeName: values.programmeName || null,
        date: values.date ? new Date(values.date).toISOString() : null,
        venue: values.venue || null,
        templateId: values.templateId,
        requireApproval: values.requireApproval,
        autoDeliverEmail: values.autoDeliverEmail,
      };
      if (editing)
        return api.patch<EventView>(
          `${API_PREFIX}/tenants/${tenantId}/events/${editing.id}`,
          payload,
        );
      return api.post<EventView>(`${API_PREFIX}/tenants/${tenantId}/events`, payload);
    },
    onSuccess: (event) => {
      toast.success(editing ? 'Event updated' : `Event "${event.name}" created`);
      setOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.fields.map((field) => field.message).join(' · ') || error.message
          : 'Could not save the event',
      ),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      programmeName: '',
      date: '',
      venue: '',
      templateId: '',
      requireApproval: false,
      autoDeliverEmail: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      editing
        ? {
            name: editing.name,
            programmeName: editing.programmeName ?? '',
            date: editing.date ? editing.date.slice(0, 10) : '',
            venue: editing.venue ?? '',
            templateId: editing.templateId,
            requireApproval: editing.requireApproval,
            autoDeliverEmail: editing.autoDeliverEmail,
          }
        : {
            name: '',
            programmeName: '',
            date: '',
            venue: '',
            templateId: templates.data?.items[0]?.id ?? '',
            requireApproval: false,
            autoDeliverEmail: true,
          },
    );
  }, [open, editing, reset, templates.data]);

  const columns: Column<EventView>[] = [
    {
      key: 'name',
      header: t('events.name'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{row.name}</p>
          <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">
            {row.programmeName ?? row.venue ?? '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('certificates.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'template',
      header: t('events.template'),
      hideBelow: 'md',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">{row.templateName ?? '—'}</span>
      ),
    },
    {
      key: 'date',
      header: t('events.date'),
      hideBelow: 'lg',
      render: (row) => (
        <span className="text-xs text-[var(--kdc-text-muted)]">
          {row.date ? formatDate(row.date, locale) : '—'}
        </span>
      ),
    },
    {
      key: 'counts',
      header: t('events.issued'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone="ok">{formatNumber(row.counts.issued, locale)}</Badge>
          {row.counts.pending > 0 ? <Badge tone="warn">{row.counts.pending} pending</Badge> : null}
          {row.counts.revoked > 0 ? (
            <Badge tone="danger">{row.counts.revoked} revoked</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'flags',
      header: 'Workflow',
      hideBelow: 'md',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.requireApproval ? <Badge tone="info">approval</Badge> : null}
          {row.autoDeliverEmail ? <Badge tone="muted">auto email</Badge> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) =>
        can(['event:update']) ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${row.name}`}
            onClick={() => {
              setEditing(row);
              setOpen(true);
            }}
          >
            <Pencil className="size-3.5" aria-hidden />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.events')}
        description="An event binds a design, a date and an issuance workflow. Bulk runs and single issues both target an event."
        icon={CalendarDays}
        actions={
          can(['event:create']) ? (
            <Button
              size="sm"
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              {t('events.new')}
            </Button>
          ) : null
        }
      />

      {events.isError ? (
        <ErrorState
          message={
            events.error instanceof ApiError ? events.error.message : String(events.error.message)
          }
          onRetry={() => void events.refetch()}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <DataTable
            rows={events.data?.items ?? []}
            columns={columns}
            keyOf={(row) => row.id}
            loading={events.isPending}
            empty={
              <p className="py-8 text-center text-xs text-[var(--kdc-text-muted)]">
                No events yet — create one to start issuing.
              </p>
            }
          />
        </Card>
      )}

      <Modal
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? `Edit ${editing.name}` : t('events.new')}
        description="The design chosen here is snapshotted per certificate at issue time."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              onClick={(event) => void handleSubmit((values) => save.mutate(values))(event)}
            >
              {editing ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
          <Field label={t('events.name')} required error={errors.name?.message}>
            {(id) => <Input id={id} placeholder="Annual Convocation 2026" {...register('name')} />}
          </Field>
          <Field label={t('events.programme')} error={errors.programmeName?.message}>
            {(id) => (
              <Input id={id} placeholder="Bachelor of Technology" {...register('programmeName')} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('events.date')} error={errors.date?.message}>
              {(id) => <Input id={id} type="date" {...register('date')} />}
            </Field>
            <Field label={t('events.venue')} error={errors.venue?.message}>
              {(id) => <Input id={id} placeholder="Main Auditorium" {...register('venue')} />}
            </Field>
          </div>
          <Field label={t('events.template')} required error={errors.templateId?.message}>
            {(id) => (
              <Select id={id} {...register('templateId')}>
                <option value="">Choose a design…</option>
                {(templates.data?.items ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {truncate(template.name, 40)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Switch
                checked={watch('requireApproval')}
                onCheckedChange={(value) => setValue('requireApproval', value)}
                label={t('events.requireApproval')}
              />
              <span className="text-xs">{t('events.requireApproval')}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Switch
                checked={watch('autoDeliverEmail')}
                onCheckedChange={(value) => setValue('autoDeliverEmail', value)}
                label={t('events.autoDeliver')}
              />
              <span className="text-xs">{t('events.autoDeliver')}</span>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={null}>
      <EventsInner />
    </Suspense>
  );
}
