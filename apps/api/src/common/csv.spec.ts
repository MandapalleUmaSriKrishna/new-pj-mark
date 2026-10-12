import { csvBuffer, escapeCsvCell, toCsv } from './csv';

describe('csv output', () => {
  it('quotes cells containing separators, quotes and newlines', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('has,comma')).toBe('"has,comma"');
    expect(escapeCsvCell('has"quote')).toBe('"has""quote"');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // A recipient-controlled value must never become a formula in Excel.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=cmd']) {
      const escaped = escapeCsvCell(dangerous);
      expect(escaped.startsWith('=')).toBe(false);
      expect(escaped.startsWith('+')).toBe(false);
      expect(escaped.startsWith('-')).toBe(false);
      expect(escaped.startsWith('@')).toBe(false);
      expect(escaped.startsWith('\t')).toBe(false);
    }
  });

  it('stringifies null and undefined as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('joins rows with CRLF and a UTF-8 BOM for Excel', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']]);
    expect(csv).toContain('\r\n');
    const buffer = csvBuffer(['a'], [['x']]);
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
  });
});
