'use client';

import { create } from 'zustand';
import {
  clampToPage,
  emptyTemplateDoc,
  newElementId,
  nextZIndex,
  sortElementsByZ,
  type PageSpec,
  type TemplateDoc,
  type TemplateElement,
} from '@kdc/shared';

/**
 * Designer document state.
 *
 * A single zustand store owns the working copy of the template document. The
 * canvas, layers list and properties panel all read from it, so a drag on the
 * canvas updates the same numbers the PDF renderer will consume - there is no
 * second representation to drift.
 */

export type AddableType = 'text' | 'rect' | 'line' | 'image' | 'qr' | 'signature' | 'serial';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

interface DesignerState {
  templateId: string | null;
  name: string;
  description: string;
  doc: TemplateDoc;
  selectedId: string | null;
  dirty: boolean;
  saving: boolean;
  zoom: number;

  load: (args: {
    templateId: string;
    name: string;
    description?: string | null;
    doc: TemplateDoc;
  }) => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  select: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (factor: number) => void;
  fitZoom: (containerWidth: number) => void;

  updatePage: (patch: Partial<PageSpec>) => void;
  updateElement: (id: string, patch: Partial<TemplateElement>) => void;
  moveElement: (id: string, x: number, y: number) => void;
  nudgeElement: (id: string, dx: number, dy: number) => void;
  addElement: (type: AddableType, at?: { x: number; y: number }) => string;
  removeElement: (id: string) => void;
  duplicateElement: (id: string) => string | null;
  reorder: (id: string, direction: 'forward' | 'backward') => void;
  toggleLock: (id: string) => void;
  toggleHidden: (id: string) => void;
  align: (id: string, axis: 'h' | 'v') => void;

  markSaving: (saving: boolean) => void;
  markSaved: () => void;
  reset: () => void;
}

function defaultElement(
  type: AddableType,
  doc: TemplateDoc,
  at?: { x: number; y: number },
): TemplateElement {
  const id = newElementId(type);
  const cx = at?.x ?? doc.page.width / 2 - 120;
  const cy = at?.y ?? doc.page.height / 2 - 30;
  const z = nextZIndex(doc.elements);
  switch (type) {
    case 'text':
      return {
        id,
        type: 'text',
        x: cx,
        y: cy,
        width: 240,
        height: 40,
        text: 'Double-click to edit… no — select and type in the panel',
        fontFamily: 'Times-Roman',
        fontSize: 18,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#111827',
        align: 'center',
        valign: 'middle',
        lineHeight: 1.3,
        letterSpacing: 0,
        zIndex: z,
      };
    case 'rect':
      return {
        id,
        type: 'rect',
        x: cx,
        y: cy,
        width: 240,
        height: 120,
        fill: '#ffffff',
        stroke: '#1f3a5f',
        strokeWidth: 2,
        radius: 0,
        variant: 'border',
        zIndex: z,
      };
    case 'line':
      return {
        id,
        type: 'line',
        x: cx,
        y: cy,
        width: 240,
        height: 0,
        stroke: '#374151',
        strokeWidth: 1,
        zIndex: z,
      };
    case 'image':
      return {
        id,
        type: 'image',
        x: cx,
        y: cy,
        width: 160,
        height: 160,
        src: '',
        fit: 'contain',
        zIndex: z,
        alt: 'Uploaded image',
      };
    case 'qr':
      return {
        id,
        type: 'qr',
        x: cx,
        y: cy,
        size: 96,
        value: 'verify_url',
        foreground: '#000000',
        background: '#ffffff',
        errorLevel: 'M',
        zIndex: z,
      };
    case 'signature':
      return {
        id,
        type: 'signature',
        x: cx,
        y: cy,
        width: 200,
        height: 80,
        mode: 'text',
        signatoryName: 'Registrar',
        signatoryTitle: 'Registrar',
        showRule: true,
        ruleColor: '#374151',
        fontFamily: 'Times-Roman',
        fontSize: 11,
        color: '#111827',
        zIndex: z,
      };
    case 'serial':
      return {
        id,
        type: 'serial',
        x: cx,
        y: cy,
        width: 220,
        height: 34,
        label: 'Certificate ID',
        showLabel: true,
        fontFamily: 'Courier-Bold',
        fontSize: 10,
        color: '#374151',
        align: 'center',
        zIndex: z,
      };
  }
}

export const useDesigner = create<DesignerState>((set, get) => ({
  templateId: null,
  name: '',
  description: '',
  doc: emptyTemplateDoc('a4_landscape'),
  selectedId: null,
  dirty: false,
  saving: false,
  zoom: 0.8,

  load: ({ templateId, name, description, doc }) =>
    set({
      templateId,
      name,
      description: description ?? '',
      doc,
      selectedId: null,
      dirty: false,
      saving: false,
    }),
  setName: (name) => set({ name, dirty: true }),
  setDescription: (description) => set({ description, dirty: true }),
  select: (selectedId) => set({ selectedId }),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
  zoomBy: (factor) =>
    set((state) => ({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor)) })),
  fitZoom: (containerWidth) =>
    set((state) => ({
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (containerWidth - 48) / state.doc.page.width)),
    })),

  updatePage: (patch) =>
    set((state) => ({
      doc: { ...state.doc, page: { ...state.doc.page, ...patch } },
      dirty: true,
    })),

  updateElement: (id, patch) =>
    set((state) => ({
      doc: {
        ...state.doc,
        elements: state.doc.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as TemplateElement) : element,
        ),
      },
      dirty: true,
    })),

  moveElement: (id, x, y) =>
    set((state) => ({
      doc: {
        ...state.doc,
        elements: state.doc.elements.map((element) =>
          element.id === id && !element.locked
            ? clampToPage({ ...element, x, y }, state.doc.page)
            : element,
        ),
      },
      dirty: true,
    })),

  nudgeElement: (id, dx, dy) => {
    const element = get().doc.elements.find((entry) => entry.id === id);
    if (!element || element.locked) return;
    get().moveElement(id, element.x + dx, element.y + dy);
  },

  addElement: (type, at) => {
    const state = get();
    const element = defaultElement(type, state.doc, at);
    set({
      doc: { ...state.doc, elements: [...state.doc.elements, element] },
      selectedId: element.id,
      dirty: true,
    });
    return element.id;
  },

  removeElement: (id) =>
    set((state) => ({
      doc: {
        ...state.doc,
        elements: state.doc.elements.filter((element) => element.id !== id || element.locked),
      },
      selectedId: state.selectedId === id ? null : state.selectedId,
      dirty: true,
    })),

  duplicateElement: (id) => {
    const state = get();
    const source = state.doc.elements.find((element) => element.id === id);
    if (!source) return null;
    const copy = {
      ...source,
      id: newElementId(source.type),
      x: source.x + 16,
      y: source.y + 16,
      zIndex: nextZIndex(state.doc.elements),
    } as TemplateElement;
    set({
      doc: { ...state.doc, elements: [...state.doc.elements, copy] },
      selectedId: copy.id,
      dirty: true,
    });
    return copy.id;
  },

  reorder: (id, direction) =>
    set((state) => {
      const ordered = sortElementsByZ(state.doc.elements);
      const index = ordered.findIndex((element) => element.id === id);
      if (index < 0) return state;
      const swapWith = direction === 'forward' ? index + 1 : index - 1;
      const neighbour = ordered[swapWith];
      const current = ordered[index];
      if (!neighbour || !current) return state;
      const currentZ = current.zIndex ?? 0;
      const neighbourZ = neighbour.zIndex ?? 0;
      return {
        doc: {
          ...state.doc,
          elements: state.doc.elements.map((element) => {
            if (element.id === current.id)
              return { ...element, zIndex: neighbourZ } as TemplateElement;
            if (element.id === neighbour.id)
              return { ...element, zIndex: currentZ } as TemplateElement;
            return element;
          }),
        },
        dirty: true,
      };
    }),

  toggleLock: (id) =>
    set((state) => ({
      doc: {
        ...state.doc,
        elements: state.doc.elements.map((element) =>
          element.id === id
            ? ({ ...element, locked: !element.locked } as TemplateElement)
            : element,
        ),
      },
      dirty: true,
    })),

  toggleHidden: (id) =>
    set((state) => ({
      doc: {
        ...state.doc,
        elements: state.doc.elements.map((element) =>
          element.id === id
            ? ({ ...element, hidden: !element.hidden } as TemplateElement)
            : element,
        ),
      },
      dirty: true,
    })),

  align: (id, axis) =>
    set((state) => {
      const element = state.doc.elements.find((entry) => entry.id === id);
      if (!element || element.locked) return state;
      const width = element.type === 'qr' ? element.size : element.width;
      const height = element.type === 'qr' ? element.size : element.height;
      const patch =
        axis === 'h'
          ? { x: Math.round((state.doc.page.width - width) / 2) }
          : { y: Math.round((state.doc.page.height - height) / 2) };
      return {
        doc: {
          ...state.doc,
          elements: state.doc.elements.map((entry) =>
            entry.id === id ? ({ ...entry, ...patch } as TemplateElement) : entry,
          ),
        },
        dirty: true,
      };
    }),

  markSaving: (saving) => set({ saving }),
  markSaved: () => set({ dirty: false, saving: false }),
  reset: () =>
    set({
      templateId: null,
      name: '',
      description: '',
      doc: emptyTemplateDoc('a4_landscape'),
      selectedId: null,
      dirty: false,
      saving: false,
      zoom: 0.8,
    }),
}));

export function selectedElement(state: DesignerState): TemplateElement | null {
  return state.doc.elements.find((element) => element.id === state.selectedId) ?? null;
}
