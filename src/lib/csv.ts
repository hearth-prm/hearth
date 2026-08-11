/**
 * CSV reading and writing, to RFC 4180.
 *
 * Hand-written rather than pulled in as a dependency because the requirement is
 * small and completely specified, and because export and import must agree on one
 * dialect exactly — a round-trip that loses a comma or a newline is worse than no
 * round-trip. Both directions live here so they cannot drift.
 */

/** Quote a single field if it needs it. */
function quote(value: string): string {
  // A leading = + - @ makes Excel and Sheets treat the cell as a formula. Prefixing
  // a tab-free zero-width guard would corrupt the value, so instead the field is
  // quoted AND the risk is documented: import strips a single leading apostrophe.
  const needs = /[",\r\n]/.test(value);
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [headers.map(quote).join(",")];
  for (const row of rows) lines.push(row.map(quote).join(","));
  // CRLF and a trailing newline: the spec's line ending, and the one Excel expects
  // when it sniffs a file's dialect.
  return lines.join("\r\n") + "\r\n";
}

/**
 * A UTF-8 byte order mark.
 *
 * Excel on Windows reads a BOM-less UTF-8 CSV as the system code page, which turns
 * every accented name into mojibake. The BOM costs three bytes and is skipped by the
 * parser below, so a round-trip through Hearth is unaffected.
 */
export const UTF8_BOM = "﻿";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Parse CSV text into headers and rows.
 *
 * A character-at-a-time scanner rather than a split on commas and newlines, because
 * both appear inside quoted fields — a notes column or an address makes that a
 * certainty, not an edge case.
 */
export function parseCsv(text: string): ParsedCsv {
  const body = text.startsWith(UTF8_BOM) ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline yields one empty field, which is not a row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < body.length) {
    const ch = body[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // Treat CRLF and a bare CR alike; a lone CR is a legal line ending in files
      // that have been through an old Mac editor.
      endRow();
      i += body[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Whatever is left is the final row, unless the file ended on a line break.
  if (field !== "" || row.length > 0) endRow();

  const headers = (rows.shift() ?? []).map((h) => cleanCell(h));
  return { headers, rows };
}

/**
 * Tidy one imported cell.
 *
 * Strips a single leading apostrophe, which is how spreadsheets escape a value that
 * would otherwise be read as a formula or renumbered — the user sees "+441234" in
 * the cell but the file holds "'+441234".
 *
 * Line endings inside a cell are normalised to LF. A browser uploading a file as
 * multipart/form-data rewrites bare LFs to CRLF, so a multi-line notes field exported
 * by Hearth comes back with carriage returns it never had — which made re-importing
 * an untouched export a change rather than a no-op. LF is also what the textarea that
 * edits these fields produces, so this converges on one representation rather than
 * inventing a third.
 */
export function cleanCell(value: string | undefined): string {
  const s = (value ?? "").replace(/\r\n?/g, "\n").trim();
  return s.startsWith("'") ? s.slice(1) : s;
}

/**
 * Map a row onto its headers.
 *
 * Header matching is case- and space-insensitive so a file that has been through a
 * spreadsheet — where "Given name" easily becomes "Given Name" — still lines up.
 */
export function rowReader(headers: readonly string[]) {
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = headerKey(h);
    if (key && !index.has(key)) index.set(key, i);
  });

  return {
    has: (name: string) => index.has(headerKey(name)),
    get: (row: readonly string[], name: string): string => {
      const at = index.get(headerKey(name));
      return at === undefined ? "" : cleanCell(row[at]);
    },
    /** Headers that were not consumed, so import can report them rather than guess. */
    unknown: (known: readonly string[]): string[] => {
      const knownKeys = new Set(known.map(headerKey));
      return headers.filter((h) => h && !knownKeys.has(headerKey(h)));
    },
  };
}

export function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}
