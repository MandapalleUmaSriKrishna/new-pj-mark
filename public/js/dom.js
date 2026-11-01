/** Small DOM + formatting helpers shared by the UI modules. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Create an element with class names and (text) children. Text is never HTML. */
export function h(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

/** Inline SVG icon from 24×24 path data (no innerHTML, CSP-friendly). */
export function icon(paths, { className = 'icon' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  for (const d of [].concat(paths)) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export const ICONS = {
  check: 'm5 12.6 4.2 4.2L19 7',
  alert: ['M12 8.4v5', 'M12 16.9v.2', 'M12 3.2 22 20.4H2L12 3.2Z'],
  info: ['M12 11v5.4', 'M12 7.9v.2', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'],
  close: 'M6 6l12 12M18 6 6 18',
};

export function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

/** 125 -> "2:05", 3630 -> "1:00:30". */
export function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatClock(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return timeFormatter.format(date);
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

/** Flag emoji from an ISO-3166-1 alpha-2 code. */
export function flagEmoji(iso) {
  if (!iso || iso.length !== 2) return '🌐';
  const codePoints = [...iso.toUpperCase()].map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function pluralise(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Keep focus visible for keyboard users after programmatic moves. */
export function focusElement(element, { select = false } = {}) {
  if (!element) return;
  try {
    element.focus({ preventScroll: false });
    if (select && typeof element.select === 'function') element.select();
  } catch {
    /* ignore */
  }
}
