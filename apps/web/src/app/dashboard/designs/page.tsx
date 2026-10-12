'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Template } from '@kdc/shared';
import { emptyTemplateDoc } from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { ListResult, StarterDesignView } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import { CertificateCanvas } from '@/components/certificate-canvas';
import { Button, Card, CardBody, ErrorState, Modal } from '@/components/ui';
import { truncate } from '@/lib/utils';

export default function DesignsPage() {
  const { activeTenant, can } = useSession();
  const { t } = useI18n();
  const tenantId = activeTenant?.id ?? '';
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<Template | StarterDesignView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);

  const templates = useQuery({
    queryKey: ['templates', tenantId],
    queryFn: () => api.get<ListResult<Template>>(`${API_PREFIX}/tenants/${tenantId}/templates`),
    enabled: Boolean(tenantId),
  });

  const starters = useQuery({
    queryKey: ['templates', 'starters', tenantId],
    queryFn: () =>
      api.get<ListResult<StarterDesignView>>(
        `${API_PREFIX}/tenants/${tenantId}/templates/starters`,
      ),
    enabled: Boolean(tenantId),
  });

  const createBlank = useMutation({
    mutationFn: () =>
      api.post<Template>(`${API_PREFIX}/tenants/${tenantId}/templates`, {
        name: 'Untitled design',
        doc: emptyTemplateDoc('a4_landscape'),
      }),
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: ['templates', tenantId] });
      window.location.assign(`/dashboard/designer/${template.id}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the design'),
  });

  const duplicate = useMutation({
    mutationFn: (template: Template) =>
      api.post<Template>(
        `${API_PREFIX}/tenants/${tenantId}/templates/${template.id}/duplicate`,
        {},
      ),
    onSuccess: (copy) => {
      toast.success(`Copied as "${copy.name}"`);
      void queryClient.invalidateQueries({ queryKey: ['templates', tenantId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not duplicate'),
  });

  const useStarter = useMutation({
    mutationFn: (starter: StarterDesignView) =>
      api.post<Template>(`${API_PREFIX}/tenants/${tenantId}/templates`, {
        name: starter.name,
        description: starter.description,
        doc: starter.doc,
      }),
    onSuccess: (template) => {
      toast.success(`"${template.name}" added to your designs`);
      void queryClient.invalidateQueries({ queryKey: ['templates', tenantId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not add the starter'),
  });

  const remove = useMutation({
    mutationFn: (template: Template) =>
      api.del(`${API_PREFIX}/tenants/${tenantId}/templates/${template.id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      toast.success('Design deleted');
      void queryClient.invalidateQueries({ queryKey: ['templates', tenantId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not delete'),
  });

  const scaleFor = (width: number) => Math.min(1, 300 / width);

  return (
    <>
      <PageHeader
        title={t('nav.designs')}
        description="Templates are the source of truth for how certificates look. Edits never rewrite certificates already issued — they snapshot their values at issue time."
        icon={Sparkles}
        actions={
          can(['template:create']) ? (
            <Button
              size="sm"
              icon={Plus}
              loading={createBlank.isPending}
              onClick={() => createBlank.mutate()}
            >
              {t('dash.newDesign')}
            </Button>
          ) : null
        }
      />

      {templates.isError ? (
        <ErrorState
          message={
            templates.error instanceof ApiError ? templates.error.message : 'Could not load designs'
          }
          onRetry={() => void templates.refetch()}
        />
      ) : (
        <section aria-label="Your designs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.isPending ? (
            Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-64 animate-pulse rounded-xl bg-[var(--kdc-surface)]" />
            ))
          ) : (templates.data?.items ?? []).length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <Card>
                <CardBody className="py-10 text-center text-xs text-[var(--kdc-text-muted)]">
                  No designs yet. Add a starter below or create a blank page.
                </CardBody>
              </Card>
            </div>
          ) : (
            (templates.data?.items ?? []).map((template) => (
              <Card key={template.id} className="group overflow-hidden">
                <button
                  type="button"
                  className="block w-full bg-[var(--kdc-surface-sunken)] p-3 text-left"
                  onClick={() => setPreview(template)}
                >
                  <div className="mx-auto w-fit overflow-hidden rounded shadow-sm">
                    <CertificateCanvas
                      doc={template.doc}
                      scale={scaleFor(template.doc.page.width)}
                    />
                  </div>
                </button>
                <div className="flex items-start justify-between gap-2 border-t border-[var(--kdc-border)] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{template.name}</p>
                    <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">
                      {template.description ?? '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {can(['template:update']) ? (
                      <Link
                        href={`/dashboard/designer/${template.id}`}
                        className="kdc-btn kdc-btn-ghost !min-h-8 !p-1.5"
                        aria-label={`Edit ${template.name}`}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Link>
                    ) : null}
                    {can(['template:create']) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="!min-h-8 !p-1.5"
                        aria-label={`Duplicate ${template.name}`}
                        onClick={() => duplicate.mutate(template)}
                      >
                        <Copy className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                    {can(['template:delete']) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="!min-h-8 !p-1.5 text-red-500"
                        aria-label={`Delete ${template.name}`}
                        onClick={() => setConfirmDelete(template)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))
          )}
        </section>
      )}

      <section aria-label="Starter designs" className="mt-8">
        <h2 className="mb-3 text-sm font-bold">Starter designs</h2>
        <p className="mb-4 max-w-2xl text-xs text-[var(--kdc-text-muted)]">
          Six production-ready layouts covering the common certificate families. Adding one copies
          it into your workspace, so you can edit it freely without touching the original.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(starters.data?.items ?? []).map((starter) => (
            <Card key={starter.key} className="overflow-hidden">
              <div className="bg-[var(--kdc-surface-sunken)] p-3">
                <div className="mx-auto w-fit overflow-hidden rounded shadow-sm">
                  <CertificateCanvas doc={starter.doc} scale={scaleFor(starter.doc.page.width)} />
                </div>
              </div>
              <div className="flex items-start justify-between gap-2 border-t border-[var(--kdc-border)] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{starter.name}</p>
                  <p className="truncate text-[0.68rem] text-[var(--kdc-text-muted)]">
                    {truncate(starter.description, 72)}
                  </p>
                </div>
                {can(['template:create']) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={useStarter.isPending && useStarter.variables?.key === starter.key}
                    onClick={() => useStarter.mutate(starter)}
                  >
                    Add
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
          {starters.isPending ? (
            <div className="h-40 animate-pulse rounded-xl bg-[var(--kdc-surface)] sm:col-span-2 lg:col-span-3" />
          ) : null}
        </div>
      </section>

      {preview ? (
        <Modal
          open
          onOpenChange={(open) => !open && setPreview(null)}
          title={preview.name}
          description={preview.description ?? undefined}
          wide
        >
          <div className="overflow-auto rounded-lg bg-[var(--kdc-surface-sunken)] p-4">
            <div className="mx-auto w-fit">
              <CertificateCanvas
                doc={preview.doc}
                scale={Math.min(1, 760 / preview.doc.page.width)}
              />
            </div>
          </div>
          {'id' in preview ? (
            <div className="mt-4 flex justify-end">
              <Link
                href={`/dashboard/designer/${preview.id}`}
                className="kdc-btn kdc-btn-primary !min-h-9 !py-1.5 !text-xs"
              >
                <Pencil className="size-3.5" aria-hidden /> Open in designer
              </Link>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal
          open
          onOpenChange={(open) => !open && setConfirmDelete(null)}
          title={`Delete "${confirmDelete.name}"?`}
          description="Certificates already issued keep their rendered PDFs and values. New issuances can no longer use this design."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                icon={Trash2}
                loading={remove.isPending}
                onClick={() => remove.mutate(confirmDelete)}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-xs text-[var(--kdc-text-muted)]">
            Events pointing at this design must be switched before their next issuance.
          </p>
        </Modal>
      ) : null}
    </>
  );
}
