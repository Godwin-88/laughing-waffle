/**
 * Minimal RFC 4180 CSV parser — no external dependency, tolerant of CRLF,
 * quoted fields, embedded commas/quotes/newlines, and a BOM header.
 */

export interface CsvRow {
  /** 1-based source row number (for validation reports). */
  line: number;
  cells: string[];
}

export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let line = 0;
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  const content = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < content.length && content[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    switch (ch) {
      case '"':
        inQuotes = true;
        break;
      case ",":
        cells.push(cell);
        cell = "";
        break;
      case "\r":
      case "\n":
        if (ch === "\r" && i + 1 < content.length && content[i + 1] === "\n") i++;
        line++;
        cells.push(cell);
        rows.push({ line, cells: cells.map((c) => c.trim()) });
        cells = [];
        cell = "";
        break;
      default:
        cell += ch;
    }
  }
  // final row (no trailing newline)
  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell);
    rows.push({ line: line + 1, cells: cells.map((c) => c.trim()) });
  }
  return rows.filter((r) => r.cells.some((c) => c.length > 0));
}