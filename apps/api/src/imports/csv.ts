/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines
 * inside quotes, CRLF or LF line endings, optional UTF-8 BOM (Excel adds one).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (inQuotes) throw new Error('The file has an unclosed quote (")');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty lines (Excel often leaves trailing ones).
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export interface CsvRecord {
  line: number;
  data: Record<string, string>;
}

/**
 * Reads a CSV with a header row into records keyed by lower-case header.
 * `line` is the 1-based line number in the file (header = 1), for error messages.
 */
export function readRecords(text: string, known: readonly string[], required: readonly string[]): { records: CsvRecord[]; headerErrors: string[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { records: [], headerErrors: ['The file is empty'] };
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const headerErrors: string[] = [];
  const unknown = header.filter((h) => h && !known.includes(h));
  if (unknown.length) headerErrors.push(`Unknown column(s): ${unknown.join(', ')}. Download the template for the expected columns.`);
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) headerErrors.push(`Missing column(s): ${missing.join(', ')}`);
  const dupes = header.filter((h, i) => h && header.indexOf(h) !== i);
  if (dupes.length) headerErrors.push(`Column(s) appear twice: ${[...new Set(dupes)].join(', ')}`);

  const records = rows.slice(1).map((r, i) => {
    const data: Record<string, string> = {};
    header.forEach((h, j) => {
      if (h) data[h] = (r[j] ?? '').trim();
    });
    return { line: i + 2, data };
  });
  return { records, headerErrors };
}

/** Builds a CSV line, quoting values that need it. */
export function toCsvLine(values: string[]): string {
  return values.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
}
