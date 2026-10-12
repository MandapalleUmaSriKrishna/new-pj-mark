#!/usr/bin/env node
/**
 * Generates the PWA icons from source, with no image dependencies.
 *
 * The sandbox has no ImageMagick / sharp / rsvg, and pulling a rasteriser in
 * just to draw one logo would be a heavy dependency for a static asset. So the
 * icon is drawn pixel-by-pixel into an RGBA buffer and encoded as PNG with
 * node:zlib (PNG is a thin container over DEFLATE scanlines).
 *
 *   node scripts/generate-icons.mjs [--out apps/web/public/icons]
 *
 * Outputs: icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png
 * and icon.svg (the vector master the PNGs are drawn from).
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------ png encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1)
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte (0 = None) per scanline, then the raw RGBA row.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- drawing */

function parseHex(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4); // fully transparent
  }

  set(x, y, [r, g, b], alpha) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.size || py >= this.size) return;
    const i = (py * this.size + px) * 4;
    const a = Math.max(0, Math.min(1, alpha));
    if (a <= 0) return;
    // Source-over compositing so overlapping strokes blend correctly.
    const dstA = this.data[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    this.data[i] = Math.round((r * a + this.data[i] * dstA * (1 - a)) / outA);
    this.data[i + 1] = Math.round((g * a + this.data[i + 1] * dstA * (1 - a)) / outA);
    this.data[i + 2] = Math.round((b * a + this.data[i + 2] * dstA * (1 - a)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  /** Filled rounded rectangle, optionally a vertical gradient. */
  roundedRect(x, y, w, h, radius, fromHex, toHex) {
    const from = parseHex(fromHex);
    const to = toHex ? parseHex(toHex) : from;
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    for (let py = Math.floor(y); py < y + h; py += 1) {
      const t = (py - y) / Math.max(1, h - 1);
      const color = [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
      for (let px = Math.floor(x); px < x + w; px += 1) {
        // Distance to the rounded-rect interior.
        const dx = Math.max(r - (px - x), px - (x + w - 1 - r), 0);
        const dy = Math.max(r - (py - y), py - (y + h - 1 - r), 0);
        if (dx * dx + dy * dy <= r * r) this.set(px, py, color, 1);
      }
    }
  }

  /** Anti-aliased ring. */
  ring(cx, cy, radius, thickness, hex, alpha = 1) {
    const color = parseHex(hex);
    const outer = radius + thickness / 2;
    const inner = Math.max(0, radius - thickness / 2);
    const span = Math.ceil(outer + 2);
    for (let py = Math.floor(cy - span); py <= cy + span; py += 1) {
      for (let px = Math.floor(cx - span); px <= cx + span; px += 1) {
        const d = Math.hypot(px - cx, py - cy);
        const coverage = Math.min(1, Math.max(0, Math.min(outer - d, d - inner) + 0.5));
        if (coverage > 0) this.set(px, py, color, coverage * alpha);
      }
    }
  }

  /** Anti-aliased polyline with round joins. */
  polyline(points, thickness, hex, alpha = 1) {
    const color = parseHex(hex);
    const half = thickness / 2;
    for (let i = 0; i < points.length - 1; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const length = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(1, Math.ceil(length));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        for (let py = Math.floor(cy - half - 1); py <= cy + half + 1; py += 1) {
          for (let px = Math.floor(cx - half - 1); px <= cx + half + 1; px += 1) {
            const d = Math.hypot(px - cx, py - cy);
            const coverage = Math.min(1, Math.max(0, half - d + 0.5));
            if (coverage > 0) this.set(px, py, color, coverage * alpha);
          }
        }
      }
    }
  }

  /** A certificate sheet: white card with ruled text lines. */
  sheet(x, y, w, h, radius, lineHex, alpha = 1) {
    this.roundedRect(x, y, w, h, radius, '#ffffff');
    const color = parseHex(lineHex);
    const lines = [0.3, 0.46, 0.62];
    for (const fraction of lines) {
      const ly = y + h * fraction;
      const lx = x + w * 0.14;
      const lw = w * (fraction === 0.3 ? 0.5 : 0.72);
      for (let px = Math.floor(lx); px < lx + lw; px += 1) {
        this.set(px, Math.round(ly), color, 0.55 * alpha);
        this.set(px, Math.round(ly) + 1, color, 0.35 * alpha);
      }
    }
  }

  toPng() {
    return encodePng(this.size, this.size, this.data);
  }
}

/**
 * The mark: a brand-blue tile, a white certificate sheet, and a gold seal with
 * a check - "verified". `maskable` keeps everything inside the 80% safe zone
 * and fills the tile edge to edge, as Android requires.
 */
function drawIcon(size, { maskable = false } = {}) {
  const canvas = new Canvas(size);
  const pad = maskable ? 0 : Math.round(size * 0.06);
  const tile = size - pad * 2;
  const radius = maskable ? 0 : Math.round(size * 0.22);

  canvas.roundedRect(pad, pad, tile, tile, radius, '#2b4bd8', '#151a56');

  // Soft top highlight so the tile is not a flat block of colour.
  for (let j = 0; j < Math.round(tile * 0.35); j += 1) {
    const alpha = 0.05 * (1 - j / (tile * 0.35));
    for (let i = 0; i < tile; i += 1) canvas.set(pad + i, pad + j, [255, 255, 255], alpha);
  }

  const inset = maskable ? size * 0.24 : size * 0.2;
  const sheetW = size - inset * 2;
  const sheetH = sheetW * 0.66;
  const sheetX = inset;
  const sheetY = size * (maskable ? 0.3 : 0.26);
  canvas.sheet(sheetX, sheetY, sheetW, sheetH, size * 0.05, '#8ea2d8');

  // Gold seal with a white check, sitting on the sheet's bottom-right corner.
  const sealR = size * 0.135;
  const sealX = sheetX + sheetW - sealR * 0.55;
  const sealY = sheetY + sheetH - sealR * 0.42;
  canvas.ring(sealX, sealY, sealR, sealR * 2, '#d4a94a');
  canvas.ring(sealX, sealY, sealR * 0.74, Math.max(1, size * 0.008), '#f6e3ac', 0.7);
  canvas.polyline(
    [
      [sealX - sealR * 0.4, sealY + sealR * 0.05],
      [sealX - sealR * 0.14, sealY + sealR * 0.32],
      [sealX + sealR * 0.44, sealY - sealR * 0.3],
    ],
    Math.max(2, size * 0.03),
    '#ffffff',
  );

  return canvas.toPng();
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Krishna Digital Certificate">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#2b4bd8" />
      <stop offset="1" stop-color="#151a56" />
    </linearGradient>
    <linearGradient id="seal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0d99a" />
      <stop offset="1" stop-color="#b98b33" />
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="104" fill="url(#tile)" />
  <rect x="104" y="140" width="304" height="200" rx="24" fill="#ffffff" />
  <g stroke="#8ea2d8" stroke-width="12" stroke-linecap="round">
    <line x1="146" y1="196" x2="296" y2="196" />
    <line x1="146" y1="240" x2="366" y2="240" />
    <line x1="146" y1="284" x2="366" y2="284" />
  </g>
  <circle cx="356" cy="330" r="74" fill="url(#seal)" />
  <circle cx="356" cy="330" r="52" fill="none" stroke="#fff8e6" stroke-width="6" opacity="0.75" />
  <path d="M328 332 l20 22 40 -44" fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;

function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf('--out');
  const outDir = resolve(
    process.cwd(),
    outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'apps/web/public/icons',
  );
  mkdirSync(outDir, { recursive: true });

  const targets = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    ['maskable-512.png', 512, { maskable: true }],
    ['apple-touch-icon.png', 180, {}],
  ];

  for (const [name, size, options] of targets) {
    const png = drawIcon(size, options);
    const target = resolve(outDir, name);
    writeFileSync(target, png);
    process.stdout.write(
      `wrote ${target.replace(`${process.cwd()}/`, '')} (${png.length} bytes)\n`,
    );
  }

  const svgPath = resolve(outDir, 'icon.svg');
  writeFileSync(svgPath, SVG);
  process.stdout.write(
    `wrote ${svgPath.replace(`${process.cwd()}/`, '')} (${Buffer.byteLength(SVG)} bytes)\n`,
  );
}

main();
