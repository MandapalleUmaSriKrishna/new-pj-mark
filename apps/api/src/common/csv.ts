/**
 * Minimal RFC 4180 CSV writer.
 *
 * Used for exports, where a spreadsheet application is the consumer. Values are
 * quoted when needed and a leading BOM is emitted so Excel detects UTF-8 instead
 * of mangling non-ASCII recipient names.
 *
 * Formula injection: a cell starting with `=`, `+`, `-`, `@`, tab or CR is
 * prefixed with a single quote, because Excel would otherwise execute
 * `=HYPERLINK(...)` or a DDE command when the file is opened.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Prepends the UTF-8 BOM Excel needs and returns a byte buffer. */
export function csvBuffer(headers: string[], rows: unknown[][]): Buffer {
  return Buffer.from(`\uFEFF${toCsv(headers, rows)}`, 'utf8');
}
