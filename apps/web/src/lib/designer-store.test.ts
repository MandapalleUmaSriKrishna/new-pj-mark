import { beforeEach, describe, expect, it } from 'vitest';
import { elementBounds, emptyTemplateDoc, type TemplateDoc } from '@kdc/shared';
import { selectedElement, useDesigner } from './designer-store';

function load(doc?: TemplateDoc) {
  useDesigner.getState().load({
    templateId: 't1',
    name: 'Test',
    description: null,
    doc: doc ?? emptyTemplateDoc('a4_landscape'),
  });
}

describe('designer store', () => {
  beforeEach(() => {
    load();
  });

  it('starts clean and marks dirty on change', () => {
    expect(useDesigner.getState().dirty).toBe(false);
    useDesigner.getState().addElement('text');
    expect(useDesigner.getState().dirty).toBe(true);
    useDesigner.getState().markSaved();
    expect(useDesigner.getState().dirty).toBe(false);
  });

  it('adds elements with unique ids and increasing z-index', () => {
    const first = useDesigner.getState().addElement('text');
    const second = useDesigner.getState().addElement('rect');
    const elements = useDesigner.getState().doc.elements;
    expect(elements).toHaveLength(2);
    expect(first).not.toBe(second);
    expect(elements[1]?.zIndex ?? 0).toBeGreaterThan(elements[0]?.zIndex ?? 0);
  });

  it('clamps moves to the page so nothing can be dragged off-canvas', () => {
    const id = useDesigner.getState().addElement('text');
    useDesigner.getState().moveElement(id, -500, -500);
    const element = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    expect(element?.x).toBe(0);
    expect(element?.y).toBe(0);
    useDesigner.getState().moveElement(id, 99_999, 99_999);
    const clamped = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    expect(clamped?.x).toBeLessThanOrEqual(842);
    expect(clamped?.y).toBeLessThanOrEqual(595);
  });

  it('refuses to move locked elements', () => {
    const id = useDesigner.getState().addElement('text');
    useDesigner.getState().toggleLock(id);
    useDesigner.getState().moveElement(id, 100, 100);
    const element = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    expect(element?.x).not.toBe(100);
  });

  it('nudges by 1pt and 10pt for keyboard access', () => {
    const id = useDesigner.getState().addElement('text');
    const before = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    useDesigner.getState().nudgeElement(id, 1, 0);
    useDesigner.getState().nudgeElement(id, 10, 0);
    const after = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    expect(after?.x).toBe((before?.x ?? 0) + 11);
  });

  it('duplicates with an offset and selects the copy', () => {
    const id = useDesigner.getState().addElement('text');
    const copyId = useDesigner.getState().duplicateElement(id);
    expect(copyId).not.toBe(id);
    expect(useDesigner.getState().selectedId).toBe(copyId);
    expect(useDesigner.getState().doc.elements).toHaveLength(2);
  });

  it('removes elements but keeps locked ones', () => {
    const id = useDesigner.getState().addElement('text');
    const locked = useDesigner.getState().addElement('rect');
    useDesigner.getState().toggleLock(locked);
    useDesigner.getState().removeElement(id);
    useDesigner.getState().removeElement(locked);
    const elements = useDesigner.getState().doc.elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]?.id).toBe(locked);
  });

  it('swaps z-order forward and backward', () => {
    const a = useDesigner.getState().addElement('text');
    const b = useDesigner.getState().addElement('rect');
    const zOf = (id: string) =>
      useDesigner.getState().doc.elements.find((entry) => entry.id === id)?.zIndex ?? 0;
    const beforeA = zOf(a);
    const beforeB = zOf(b);
    useDesigner.getState().reorder(a, 'forward');
    expect(zOf(a)).toBe(beforeB);
    expect(zOf(b)).toBe(beforeA);
    useDesigner.getState().reorder(a, 'backward');
    expect(zOf(a)).toBe(beforeA);
  });

  it('centres an element on either axis', () => {
    const id = useDesigner.getState().addElement('text');
    useDesigner.getState().align(id, 'h');
    const element = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    expect(element?.x).toBe(Math.round((842 - elementBounds(element!).width) / 2));
    useDesigner.getState().align(id, 'v');
    const centred = useDesigner.getState().doc.elements.find((entry) => entry.id === id);
    expect(centred?.y).toBe(Math.round((595 - elementBounds(centred!).height) / 2));
  });

  it('zoom clamps to the supported range and fit uses the container', () => {
    useDesigner.getState().setZoom(99);
    expect(useDesigner.getState().zoom).toBe(3);
    useDesigner.getState().setZoom(0.01);
    expect(useDesigner.getState().zoom).toBe(0.25);
    useDesigner.getState().fitZoom(842 + 48);
    expect(useDesigner.getState().zoom).toBeCloseTo(1, 1);
  });

  it('exposes the selected element helper', () => {
    const id = useDesigner.getState().addElement('qr');
    useDesigner.getState().select(id);
    expect(selectedElement(useDesigner.getState())?.type).toBe('qr');
    useDesigner.getState().select(null);
    expect(selectedElement(useDesigner.getState())).toBeNull();
  });

  it("merges page updates; switching to a custom size is the caller's decision", () => {
    useDesigner.getState().updatePage({ preset: 'a4_portrait', width: 595, height: 842 });
    expect(useDesigner.getState().doc.page.preset).toBe('a4_portrait');
    useDesigner.getState().updatePage({ width: 700 });
    expect(useDesigner.getState().doc.page.width).toBe(700);
    useDesigner.getState().updatePage({ preset: 'custom' });
    expect(useDesigner.getState().doc.page.preset).toBe('custom');
  });
});
