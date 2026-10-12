'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlignCenter,
  AlignCenterVertical,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  FileImage,
  FileType,
  Fingerprint,
  Hash,
  Image as ImageIcon,
  Layers,
  Lock,
  LockOpen,
  Minus,
  PenLine,
  Save,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BUILT_IN_FONTS,
  FONT_STACKS,
  MERGE_FIELDS,
  PAGE_PRESETS,
  hitTest,
  type PagePresetId,
  type Template,
  type TemplateElement,
} from '@kdc/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { CertificateCanvas } from '@/components/certificate-canvas';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  selectedElement,
  useDesigner,
  type AddableType,
} from '@/lib/designer-store';
import {
  Button,
  ErrorState,
  Field,
  Input,
  Kbd,
  Modal,
  Notice,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@/components/ui';
import { cn, formatBytes } from '@/lib/utils';

/**
 * The drag-and-drop certificate designer.
 *
 * Pointer math works in document points: client coordinates are converted with
 * the canvas bounding rect and the current zoom, so dragging is exact at any
 * zoom level and the stored numbers are the same ones the PDF engine renders.
 */

const ADDABLE: { type: AddableType; label: string; icon: typeof FileType }[] = [
  { type: 'text', label: 'designer.text', icon: FileType },
  { type: 'image', label: 'designer.image', icon: ImageIcon },
  { type: 'rect', label: 'designer.shape', icon: Square },
  { type: 'line', label: 'designer.line', icon: Minus },
  { type: 'qr', label: 'designer.qr', icon: Fingerprint },
  { type: 'signature', label: 'designer.signature', icon: PenLine },
  { type: 'serial', label: 'designer.serial', icon: Hash },
];

export default function DesignerPage() {
  const params = useParams<{ templateId: string }>();
  const templateId = params.templateId;
  const { activeTenant } = useSession();
  const { t } = useI18n();
  const tenantId = activeTenant?.id ?? '';

  const store = useDesigner();
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{
    url: string;
    warnings: string[];
    bytes: number;
    sha256: string;
  } | null>(null);

  const template = useQuery({
    queryKey: ['template', tenantId, templateId],
    queryFn: () => api.get<Template>(`${API_PREFIX}/tenants/${tenantId}/templates/${templateId}`),
    enabled: Boolean(tenantId && templateId),
  });

  useEffect(() => {
    if (template.data) {
      store.load({
        templateId: template.data.id,
        name: template.data.name,
        description: template.data.description,
        doc: template.data.doc,
      });
    }
    // Load once per template; the store owns the working copy afterwards.
  }, [template.data?.id, template.data?.updatedAt]);

  /* Resolve signed URLs for uploaded assets referenced by the document. */
  const assetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of store.doc.elements) {
      if (
        (element.type === 'image' || element.type === 'signature') &&
        element.src &&
        !/^(https?:|blob:|\/)/.test(element.src)
      )
        ids.add(element.src);
    }
    if (store.doc.page.backgroundSrc && !/^(https?:|blob:|\/)/.test(store.doc.page.backgroundSrc))
      ids.add(store.doc.page.backgroundSrc);
    return [...ids];
  }, [store.doc]);

  useEffect(() => {
    if (assetIds.length === 0 || !tenantId) return;
    let cancelled = false;
    void Promise.all(
      assetIds.map(async (id) => {
        try {
          const result = await api.get<{ url: string }>(
            `${API_PREFIX}/tenants/${tenantId}/assets/${id}/url`,
          );
          return [id, result.url] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const entry of entries) if (entry) map[entry[0]] = entry[1];
      setAssetUrls((previous) => ({ ...previous, ...map }));
    });
    return () => {
      cancelled = true;
    };
  }, [assetIds.join(','), tenantId]);

  /* ------------------------------------------------------------ mutations */

  const save = useMutation({
    mutationFn: () =>
      api.patch<Template>(`${API_PREFIX}/tenants/${tenantId}/templates/${templateId}`, {
        name: store.name,
        description: store.description || null,
        doc: store.doc,
      }),
    onMutate: () => store.markSaving(true),
    onSuccess: () => {
      store.markSaved();
      toast.success(t('designer.saved'));
    },
    onError: (error) => {
      store.markSaving(false);
      toast.error(
        error instanceof ApiError
          ? error.fields.map((field) => `${field.field}: ${field.message}`).join(' · ') ||
              error.message
          : 'Save failed',
      );
    },
  });

  const renderPreview = useMutation({
    mutationFn: async () => {
      const result = await api.post<{
        pdfBase64: string;
        bytes: number;
        pages: number;
        sha256: string;
        warnings: string[];
      }>(`${API_PREFIX}/tenants/${tenantId}/templates/preview`, { doc: store.doc });
      const bytes = Uint8Array.from(atob(result.pdfBase64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      return { url, warnings: result.warnings, bytes: result.bytes, sha256: result.sha256 };
    },
    onSuccess: (result) => {
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return result;
      });
      setPreviewOpen(true);
      if (result.warnings.length > 0)
        toast.warning(`Preview rendered with ${result.warnings.length} warning(s)`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Preview failed'),
  });

  /* --------------------------------------------------------- pointer math */

  const toDocPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const stage = stageRef.current?.querySelector<HTMLElement>('[data-canvas]');
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const zoom = useDesigner.getState().zoom;
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }, []);

  const onStagePointerDown = (event: React.PointerEvent) => {
    const point = toDocPoint(event);
    if (!point) return;
    const { doc, select } = useDesigner.getState();
    const ordered = [...doc.elements].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
    const hit = ordered.find((element) => hitTest(element, point.x, point.y));
    if (!hit) {
      select(null);
      return;
    }
    if (hit.locked) {
      select(hit.id);
      return;
    }
    select(hit.id);
    dragRef.current = { id: hit.id, offsetX: point.x - hit.x, offsetY: point.y - hit.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onStagePointerMove = (event: React.PointerEvent) => {
    const point = toDocPoint(event);
    if (!point) return;
    const state = useDesigner.getState();
    if (resizeRef.current) {
      const { id, startX, startY, width, height } = resizeRef.current;
      const dx = point.x - startX;
      const dy = point.y - startY;
      const element = state.doc.elements.find((entry) => entry.id === id);
      if (!element) return;
      if (element.type === 'qr') {
        state.updateElement(id, {
          size: Math.max(24, Math.round(Math.max(width, height) + Math.max(dx, dy))),
        });
      } else {
        state.updateElement(id, {
          width: Math.max(8, Math.round(width + dx)),
          height: Math.max(8, Math.round(height + dy)),
        });
      }
      return;
    }
    if (dragRef.current) {
      const { id, offsetX, offsetY } = dragRef.current;
      state.moveElement(id, Math.round(point.x - offsetX), Math.round(point.y - offsetY));
    }
  };

  const endPointer = () => {
    dragRef.current = null;
    resizeRef.current = null;
  };

  const startResize = (event: React.PointerEvent, id: string) => {
    event.stopPropagation();
    const point = toDocPoint(event);
    const element = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    if (!point || !element || element.locked) return;
    const width = element.type === 'qr' ? element.size : element.width;
    const height = element.type === 'qr' ? element.size : element.height;
    resizeRef.current = { id, startX: point.x, startY: point.y, width, height };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  /* ------------------------------------------------------------- keyboard */

  const onKeyDown = (event: React.KeyboardEvent) => {
    const state = useDesigner.getState();
    const id = state.selectedId;
    if (!id) return;
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        state.nudgeElement(id, -step, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        state.nudgeElement(id, step, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        state.nudgeElement(id, 0, -step);
        break;
      case 'ArrowDown':
        event.preventDefault();
        state.nudgeElement(id, 0, step);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        state.removeElement(id);
        break;
      case 'd':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          state.duplicateElement(id);
        }
        break;
      default:
        break;
    }
  };

  /* ----------------------------------------------------------------- drop */

  const onDropMerge = (event: React.DragEvent) => {
    const token = event.dataTransfer.getData('text/kdc-merge');
    if (!token) return;
    event.preventDefault();
    const point = toDocPoint(event);
    const state = useDesigner.getState();
    const id = state.addElement('text', point ? { x: point.x - 100, y: point.y - 14 } : undefined);
    state.updateElement(id, { text: `{{${token}}}`, width: 220, height: 28 });
  };

  if (template.isError) {
    return (
      <ErrorState
        title="Design not found"
        message={
          template.error instanceof ApiError ? template.error.message : 'It may have been deleted.'
        }
      />
    );
  }

  const selected = selectedElement(store);

  return (
    <div
      className="-mx-3 -my-4 flex h-[calc(100dvh-3.4rem)] flex-col sm:-mx-5 sm:-my-6"
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="application"
      aria-label={t('a11y.certificateCanvas')}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-3 py-2">
        <Link href="/dashboard/designs" className="kdc-btn kdc-btn-ghost !min-h-9 !px-2 !text-xs">
          <ArrowLeft className="size-3.5" aria-hidden /> {t('common.back')}
        </Link>
        <Input
          value={store.name}
          onChange={(event) => store.setName(event.target.value)}
          className="!w-44 !min-h-9 !text-xs font-semibold"
          aria-label="Design name"
        />
        <span
          className={cn(
            'text-[0.68rem] font-semibold',
            store.dirty ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--kdc-text-muted)]',
          )}
        >
          {store.dirty ? t('designer.unsaved') : t('designer.saved')}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('designer.zoomOut')}
            onClick={() => store.zoomBy(1 / 1.2)}
            disabled={store.zoom <= MIN_ZOOM}
          >
            <ZoomOut className="size-4" aria-hidden />
          </Button>
          <span className="w-12 text-center font-mono text-[0.68rem] text-[var(--kdc-text-muted)]">
            {Math.round(store.zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('designer.zoomIn')}
            onClick={() => store.zoomBy(1.2)}
            disabled={store.zoom >= MAX_ZOOM}
          >
            <ZoomIn className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('designer.zoomFit')}
            onClick={() => store.fitZoom(stageRef.current?.clientWidth ?? 900)}
          >
            <Eye className="size-4" aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Eye}
            loading={renderPreview.isPending}
            onClick={() => renderPreview.mutate()}
          >
            {t('designer.preview')}
          </Button>
          <Button size="sm" icon={Save} loading={store.saving} onClick={() => save.mutate()}>
            {t('designer.save')}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_1fr_17rem]">
        {/* Left: palette + layers */}
        <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--kdc-border)] bg-[var(--kdc-surface)] lg:block">
          <div className="p-3">
            <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
              {t('designer.addElement')}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {ADDABLE.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.type}
                    type="button"
                    className="kdc-btn kdc-btn-secondary !min-h-9 !py-1.5 !text-[0.7rem]"
                    onClick={() => store.addElement(entry.type)}
                  >
                    <Icon className="size-3.5" aria-hidden /> {t(entry.label as 'designer.text')}
                  </button>
                );
              })}
            </div>

            <p className="mb-2 mt-4 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
              {t('designer.mergeFields')}
            </p>
            <p className="mb-2 text-[0.65rem] text-[var(--kdc-text-muted)]">
              {t('designer.dragHint')}
            </p>
            <ul className="space-y-1">
              {MERGE_FIELDS.map((field) => (
                <li key={field.token}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData('text/kdc-merge', field.token)
                    }
                    onClick={() => {
                      const id = store.addElement('text');
                      store.updateElement(id, {
                        text: `{{${field.token}}}`,
                        width: 220,
                        height: 26,
                        fontSize: 12,
                      });
                    }}
                    className="w-full truncate rounded-md border border-dashed border-[var(--kdc-border)] bg-[var(--kdc-surface-sunken)] px-2 py-1 text-left font-mono text-[0.65rem] text-[var(--kdc-text-muted)] hover:border-[var(--kdc-brand)] hover:text-[var(--kdc-brand)]"
                    title={field.label}
                  >
                    {`{{${field.token}}}`}
                  </button>
                </li>
              ))}
            </ul>

            <p className="mb-2 mt-4 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
              {t('designer.layers')}
            </p>
            <ul className="space-y-0.5">
              {[...store.doc.elements]
                .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
                .map((element) => (
                  <li key={element.id}>
                    <button
                      type="button"
                      onClick={() => store.select(element.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[0.7rem]',
                        store.selectedId === element.id
                          ? 'bg-[color-mix(in_oklab,var(--kdc-brand)_12%,transparent)] font-semibold text-[var(--kdc-brand)]'
                          : 'text-[var(--kdc-text-muted)] hover:bg-[color-mix(in_oklab,var(--kdc-text)_5%,transparent)]',
                      )}
                    >
                      <Layers className="size-3 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {element.name ?? element.type}
                      </span>
                      {element.locked ? <Lock className="size-3 shrink-0" aria-hidden /> : null}
                      {element.hidden ? (
                        <Eye className="size-3 shrink-0 opacity-40" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                ))}
              {store.doc.elements.length === 0 ? (
                <li className="px-2 py-1 text-[0.68rem] text-[var(--kdc-text-muted)]">
                  Empty page — add an element.
                </li>
              ) : null}
            </ul>
          </div>
        </aside>

        {/* Centre: canvas */}
        <div
          ref={stageRef}
          className="kdc-canvas-stage relative min-h-0 overflow-auto p-6"
          onDrop={onDropMerge}
          onDragOver={(event) => event.preventDefault()}
        >
          {template.isPending ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : (
            <div
              className="mx-auto w-fit"
              data-canvas
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
            >
              <div className="relative">
                <CertificateCanvas
                  doc={store.doc}
                  scale={store.zoom}
                  selectedId={store.selectedId}
                  onSelect={store.select}
                  assetUrls={assetUrls}
                />
                {selected && !selected.locked ? (
                  <button
                    type="button"
                    aria-label="Resize element"
                    onPointerDown={(event) => startResize(event, selected.id)}
                    onPointerMove={onStagePointerMove}
                    onPointerUp={endPointer}
                    className="absolute size-3 cursor-nwse-resize rounded-sm border-2 border-[var(--kdc-brand)] bg-white"
                    style={{
                      left:
                        (selected.x + (selected.type === 'qr' ? selected.size : selected.width)) *
                          store.zoom -
                        6,
                      top:
                        (selected.y + (selected.type === 'qr' ? selected.size : selected.height)) *
                          store.zoom -
                        6,
                    }}
                  />
                ) : null}
              </div>
            </div>
          )}
          <p className="mx-auto mt-3 max-w-md text-center text-[0.65rem] text-[var(--kdc-text-muted)]">
            {t('designer.keyboardHint')}
          </p>
        </div>

        {/* Right: properties */}
        <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--kdc-border)] bg-[var(--kdc-surface)] lg:block">
          <PropertiesPanel
            tenantId={tenantId}
            onUploadAsset={async (kind, file) => {
              const form = new FormData();
              form.append('file', file);
              form.append('kind', kind);
              const asset = await api.upload<{ id: string; sizeBytes: number }>(
                `${API_PREFIX}/tenants/${tenantId}/assets`,
                form,
              );
              const url = await api
                .get<{ url: string }>(`${API_PREFIX}/tenants/${tenantId}/assets/${asset.id}/url`)
                .catch(() => null);
              if (url) setAssetUrls((previous) => ({ ...previous, [asset.id]: url.url }));
              return asset.id;
            }}
          />
        </aside>
      </div>

      {previewOpen && preview ? (
        <Modal
          open
          onOpenChange={(open) => !open && setPreviewOpen(false)}
          title={t('designer.preview')}
          description={`Rendered by the real PDF engine · ${formatBytes(preview.bytes)} · sha256 ${preview.sha256.slice(0, 16)}…`}
          wide
        >
          {preview.warnings.length > 0 ? (
            <Notice tone="warn" className="mb-3">
              <ul className="list-inside list-disc">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <iframe
            title="Certificate PDF preview"
            src={preview.url}
            className="h-[62vh] w-full rounded-lg border border-[var(--kdc-border)] bg-white"
          />
        </Modal>
      ) : null}

      {/* Mobile notice: the designer needs a pointer-accurate surface */}
      <div className="border-t border-[var(--kdc-border)] bg-[var(--kdc-surface)] px-3 py-2 text-[0.68rem] text-[var(--kdc-text-muted)] lg:hidden">
        The full designer needs a larger screen. On this device you can still save, preview and use
        the pages below. <Kbd>↔</Kbd>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- properties */

function PropertiesPanel({
  tenantId,
  onUploadAsset,
}: {
  tenantId: string;
  onUploadAsset: (kind: string, file: File) => Promise<string>;
}) {
  const store = useDesigner();
  const { t } = useI18n();
  const selected = selectedElement(store);
  const [uploading, setUploading] = useState(false);

  const upload = async (kind: string, input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file || !selected) return;
    setUploading(true);
    try {
      const assetId = await onUploadAsset(kind, file);
      store.updateElement(selected.id, { src: assetId });
      toast.success('Uploaded and attached');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  const num = (
    value: number,
    onChange: (value: number) => void,
    props: { min?: number; max?: number; step?: number; label: string },
  ) => (
    <Field label={props.label}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
          className="!min-h-8 !py-1 !text-xs"
        />
      )}
    </Field>
  );

  return (
    <div className="space-y-4 p-3">
      <section>
        <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
          {t('designer.pageSetup')}
        </p>
        <div className="space-y-2">
          <Field label="Preset">
            {(id) => (
              <Select
                id={id}
                value={store.doc.page.preset}
                onChange={(event) => {
                  const preset = event.target.value as PagePresetId | 'custom';
                  if (preset === 'custom') {
                    store.updatePage({ preset: 'custom' });
                    return;
                  }
                  const dimensions = PAGE_PRESETS[preset];
                  store.updatePage({ preset, width: dimensions.width, height: dimensions.height });
                }}
                className="!min-h-8 !py-1 !text-xs"
              >
                {Object.entries(PAGE_PRESETS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {num(
              store.doc.page.width,
              (value) => store.updatePage({ width: value, preset: 'custom' }),
              { min: 51, max: 4000, label: 'Width (pt)' },
            )}
            {num(
              store.doc.page.height,
              (value) => store.updatePage({ height: value, preset: 'custom' }),
              { min: 51, max: 4000, label: 'Height (pt)' },
            )}
          </div>
          <Field label={t('designer.background')}>
            {(id) => (
              <Input
                id={id}
                type="color"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(store.doc.page.background)
                    ? store.doc.page.background
                    : '#ffffff'
                }
                onChange={(event) => store.updatePage({ background: event.target.value })}
                className="!h-8 !p-1"
              />
            )}
          </Field>
          <Field label="Background image (asset id or URL)">
            {(id) => (
              <Input
                id={id}
                value={store.doc.page.backgroundSrc ?? ''}
                onChange={(event) =>
                  store.updatePage({ backgroundSrc: event.target.value || undefined })
                }
                className="!min-h-8 !py-1 !text-xs"
                placeholder="empty = colour only"
              />
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Switch
              checked={store.doc.page.showGuides !== false}
              onCheckedChange={(value) => store.updatePage({ showGuides: value })}
              label="guides"
            />
            <span className="text-[0.7rem]">Show guides</span>
          </div>
        </div>
      </section>

      {!selected ? (
        <p className="rounded-lg border border-dashed border-[var(--kdc-border)] px-3 py-4 text-center text-[0.68rem] text-[var(--kdc-text-muted)]">
          Select an element on the canvas to edit its properties.
        </p>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--kdc-text-muted)]">
              {selected.type} · {selected.id.slice(0, 8)}
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="!min-h-7 !p-1"
                aria-label={t('designer.bringForward')}
                onClick={() => store.reorder(selected.id, 'forward')}
              >
                <ArrowUp className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="!min-h-7 !p-1"
                aria-label={t('designer.sendBackward')}
                onClick={() => store.reorder(selected.id, 'backward')}
              >
                <ArrowDown className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="!min-h-7 !p-1"
                aria-label={selected.locked ? t('designer.unlock') : t('designer.lock')}
                onClick={() => store.toggleLock(selected.id)}
              >
                {selected.locked ? (
                  <Lock className="size-3.5" aria-hidden />
                ) : (
                  <LockOpen className="size-3.5" aria-hidden />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="!min-h-7 !p-1 text-red-500"
                aria-label={t('designer.delete')}
                onClick={() => store.removeElement(selected.id)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>

          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 !text-[0.68rem]"
              icon={AlignCenter}
              onClick={() => store.align(selected.id, 'h')}
            >
              {t('designer.alignCenter')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 !text-[0.68rem]"
              icon={AlignCenterVertical}
              onClick={() => store.align(selected.id, 'v')}
            >
              {t('designer.alignMiddle')}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {num(selected.x, (value) => store.updateElement(selected.id, { x: value }), {
              label: 'X (pt)',
            })}
            {num(selected.y, (value) => store.updateElement(selected.id, { y: value }), {
              label: 'Y (pt)',
            })}
            {selected.type !== 'qr'
              ? num(
                  selected.width,
                  (value) => store.updateElement(selected.id, { width: Math.max(1, value) }),
                  { min: 1, label: 'Width (pt)' },
                )
              : null}
            {selected.type !== 'qr' && selected.type !== 'line'
              ? num(
                  selected.height,
                  (value) => store.updateElement(selected.id, { height: Math.max(1, value) }),
                  { min: 1, label: 'Height (pt)' },
                )
              : null}
            {selected.type === 'qr'
              ? num(
                  selected.size,
                  (value) => store.updateElement(selected.id, { size: Math.max(8, value) }),
                  { min: 8, max: 600, label: 'Size (pt)' },
                )
              : null}
            {num(
              selected.rotation ?? 0,
              (value) => store.updateElement(selected.id, { rotation: value }),
              { min: -360, max: 360, label: 'Rotation (°)' },
            )}
            {num(
              selected.opacity ?? 1,
              (value) =>
                store.updateElement(selected.id, { opacity: Math.min(1, Math.max(0, value)) }),
              { min: 0, max: 1, step: 0.05, label: 'Opacity' },
            )}
          </div>

          <ElementProperties
            key={selected.id}
            onUpload={(kind, input) => void upload(kind, input)}
            uploading={uploading}
            tenantId={tenantId}
          />
        </section>
      )}
    </div>
  );
}

function ElementProperties({
  onUpload,
  uploading,
}: {
  onUpload: (kind: string, input: HTMLInputElement) => void;
  uploading: boolean;
  tenantId: string;
}) {
  const store = useDesigner();
  const selected = selectedElement(store);
  if (!selected) return null;
  const update = (patch: Partial<TemplateElement>) => store.updateElement(selected.id, patch);

  const colorField = (
    label: string,
    value: string,
    key: 'color' | 'fill' | 'stroke' | 'foreground' | 'background' | 'ruleColor',
  ) => (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(event) => update({ [key]: event.target.value } as Partial<TemplateElement>)}
          className="!h-8 !p-1"
        />
      )}
    </Field>
  );

  const fontField = (value: string, key: 'fontFamily') => (
    <Field label="Font">
      {(id) => (
        <Select
          id={id}
          value={value}
          onChange={(event) => update({ [key]: event.target.value } as Partial<TemplateElement>)}
          className="!min-h-8 !py-1 !text-xs"
        >
          {[...new Set([...FONT_STACKS, ...BUILT_IN_FONTS])].map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  switch (selected.type) {
    case 'text':
      return (
        <div className="space-y-2">
          <Field label="Text (use {{merge.tokens}})">
            {(id) => (
              <Textarea
                id={id}
                value={selected.text}
                onChange={(event) => update({ text: event.target.value })}
                className="!min-h-20 !text-xs"
              />
            )}
          </Field>
          {fontField(selected.fontFamily, 'fontFamily')}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Size (pt)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={600}
                  value={selected.fontSize}
                  onChange={(event) => update({ fontSize: Number(event.target.value) })}
                  className="!min-h-8 !py-1 !text-xs"
                />
              )}
            </Field>
            <Field label="Line height">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0.5}
                  max={4}
                  step={0.05}
                  value={selected.lineHeight}
                  onChange={(event) => update({ lineHeight: Number(event.target.value) })}
                  className="!min-h-8 !py-1 !text-xs"
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Weight">
              {(id) => (
                <Select
                  id={id}
                  value={selected.fontWeight}
                  onChange={(event) =>
                    update({ fontWeight: event.target.value as 'normal' | 'bold' })
                  }
                  className="!min-h-8 !py-1 !text-xs"
                >
                  <option value="normal">normal</option>
                  <option value="bold">bold</option>
                </Select>
              )}
            </Field>
            <Field label="Style">
              {(id) => (
                <Select
                  id={id}
                  value={selected.fontStyle}
                  onChange={(event) =>
                    update({ fontStyle: event.target.value as 'normal' | 'italic' })
                  }
                  className="!min-h-8 !py-1 !text-xs"
                >
                  <option value="normal">normal</option>
                  <option value="italic">italic</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Align">
              {(id) => (
                <Select
                  id={id}
                  value={selected.align}
                  onChange={(event) =>
                    update({ align: event.target.value as 'left' | 'center' | 'right' | 'justify' })
                  }
                  className="!min-h-8 !py-1 !text-xs"
                >
                  {['left', 'center', 'right', 'justify'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Vertical">
              {(id) => (
                <Select
                  id={id}
                  value={selected.valign}
                  onChange={(event) =>
                    update({ valign: event.target.value as 'top' | 'middle' | 'bottom' })
                  }
                  className="!min-h-8 !py-1 !text-xs"
                >
                  {['top', 'middle', 'bottom'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {colorField('Colour', selected.color, 'color')}
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(selected.uppercase)}
              onCheckedChange={(value) => update({ uppercase: value })}
              label="uppercase"
            />
            <span className="text-[0.7rem]">UPPERCASE</span>
          </div>
        </div>
      );
    case 'rect':
      return (
        <div className="space-y-2">
          <Field label="Variant">
            {(id) => (
              <Select
                id={id}
                value={selected.variant}
                onChange={(event) =>
                  update({
                    variant: event.target.value as
                      'solid' | 'border' | 'double_border' | 'gradient',
                  })
                }
                className="!min-h-8 !py-1 !text-xs"
              >
                {['solid', 'border', 'double_border', 'gradient'].map((value) => (
                  <option key={value} value={value}>
                    {value.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {colorField('Fill', selected.fill, 'fill')}
            {colorField('Stroke', selected.stroke ?? '#000000', 'stroke')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stroke width">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={50}
                  value={selected.strokeWidth}
                  onChange={(event) => update({ strokeWidth: Number(event.target.value) })}
                  className="!min-h-8 !py-1 !text-xs"
                />
              )}
            </Field>
            <Field label="Corner radius">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={500}
                  value={selected.radius}
                  onChange={(event) => update({ radius: Number(event.target.value) })}
                  className="!min-h-8 !py-1 !text-xs"
                />
              )}
            </Field>
          </div>
          {selected.variant === 'gradient' ? (
            <div className="grid grid-cols-2 gap-2">
              {colorField('From', selected.gradientFrom ?? '#1d40f0', 'gradientFrom' as 'fill')}
              {colorField('To', selected.gradientTo ?? '#151a56', 'gradientTo' as 'fill')}
            </div>
          ) : null}
        </div>
      );
    case 'line':
      return (
        <div className="space-y-2">
          {colorField('Stroke', selected.stroke, 'stroke')}
          <Field label="Thickness (pt)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={50}
                value={selected.strokeWidth}
                onChange={(event) => update({ strokeWidth: Number(event.target.value) })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
        </div>
      );
    case 'image':
      return (
        <div className="space-y-2">
          <Field label="Image" hint="Upload a PNG/JPG/SVG (max 25 MB) or paste an https URL.">
            {(id) => (
              <Input
                id={id}
                value={selected.src}
                onChange={(event) => update({ src: event.target.value })}
                className="!min-h-8 !py-1 !text-xs"
                placeholder="asset id or https://…"
              />
            )}
          </Field>
          <label className="kdc-btn kdc-btn-secondary w-full !min-h-9 !py-1.5 !text-xs">
            <FileImage className="size-3.5" aria-hidden />{' '}
            {uploading ? 'Uploading…' : 'Upload image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(event) => onUpload('template_image', event.currentTarget)}
              disabled={uploading}
            />
          </label>
          <Field label="Fit">
            {(id) => (
              <Select
                id={id}
                value={selected.fit}
                onChange={(event) =>
                  update({ fit: event.target.value as 'contain' | 'cover' | 'fill' })
                }
                className="!min-h-8 !py-1 !text-xs"
              >
                {['contain', 'cover', 'fill'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Alt text">
            {(id) => (
              <Input
                id={id}
                value={selected.alt ?? ''}
                onChange={(event) => update({ alt: event.target.value })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
        </div>
      );
    case 'qr':
      return (
        <div className="space-y-2">
          <Field label="Encodes">
            {(id) => (
              <Select
                id={id}
                value={selected.value}
                onChange={(event) =>
                  update({ value: event.target.value as 'verify_url' | 'serial' | 'custom' })
                }
                className="!min-h-8 !py-1 !text-xs"
              >
                <option value="verify_url">Verification URL (recommended)</option>
                <option value="serial">Serial only</option>
                <option value="custom">Custom text</option>
              </Select>
            )}
          </Field>
          {selected.value === 'custom' ? (
            <Field label="Custom value">
              {(id) => (
                <Input
                  id={id}
                  value={selected.customValue ?? ''}
                  onChange={(event) => update({ customValue: event.target.value })}
                  className="!min-h-8 !py-1 !text-xs"
                />
              )}
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {colorField('Foreground', selected.foreground, 'foreground')}
            {colorField('Background', selected.background, 'background')}
          </div>
          <Field label="Error correction">
            {(id) => (
              <Select
                id={id}
                value={selected.errorLevel}
                onChange={(event) =>
                  update({ errorLevel: event.target.value as 'L' | 'M' | 'Q' | 'H' })
                }
                className="!min-h-8 !py-1 !text-xs"
              >
                {['L', 'M', 'Q', 'H'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Caption">
            {(id) => (
              <Input
                id={id}
                value={selected.caption ?? ''}
                onChange={(event) => update({ caption: event.target.value })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
        </div>
      );
    case 'signature':
      return (
        <div className="space-y-2">
          <Field label="Mode">
            {(id) => (
              <Select
                id={id}
                value={selected.mode}
                onChange={(event) => update({ mode: event.target.value as 'image' | 'text' })}
                className="!min-h-8 !py-1 !text-xs"
              >
                <option value="image">Uploaded signature image</option>
                <option value="text">Typed name</option>
              </Select>
            )}
          </Field>
          {selected.mode === 'image' ? (
            <label className="kdc-btn kdc-btn-secondary w-full !min-h-9 !py-1.5 !text-xs">
              <PenLine className="size-3.5" aria-hidden />{' '}
              {uploading ? 'Uploading…' : 'Upload signature / seal'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                onChange={(event) => onUpload('signature', event.currentTarget)}
                disabled={uploading}
              />
            </label>
          ) : null}
          <Field label="Signatory">
            {(id) => (
              <Input
                id={id}
                value={selected.signatoryName ?? ''}
                onChange={(event) => update({ signatoryName: event.target.value })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
          <Field label="Title under the rule">
            {(id) => (
              <Input
                id={id}
                value={selected.signatoryTitle ?? ''}
                onChange={(event) => update({ signatoryTitle: event.target.value })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Switch
              checked={selected.showRule}
              onCheckedChange={(value) => update({ showRule: value })}
              label="rule"
            />
            <span className="text-[0.7rem]">Show signature rule</span>
          </div>
        </div>
      );
    case 'serial':
      return (
        <div className="space-y-2">
          <Field label="Label">
            {(id) => (
              <Input
                id={id}
                value={selected.label}
                onChange={(event) => update({ label: event.target.value })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
          {fontField(selected.fontFamily, 'fontFamily')}
          <Field label="Size (pt)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={120}
                value={selected.fontSize}
                onChange={(event) => update({ fontSize: Number(event.target.value) })}
                className="!min-h-8 !py-1 !text-xs"
              />
            )}
          </Field>
          {colorField('Colour', selected.color, 'color')}
        </div>
      );
    default:
      return null;
  }
}
