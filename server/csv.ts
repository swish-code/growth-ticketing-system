/**
 * Minimal RFC4180 CSV reader — handles quoted fields, "" escaped quotes,
 * commas and newlines inside quotes, and CRLF/LF line endings. No external
 * dependency; the import feature is the only consumer and the format is
 * well-defined, so a small hand-rolled parser is enough.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — our own export writes one, and so does Excel.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = '';
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Trailing field/row (files don't always end with a newline).
  if (field !== '' || row.length > 0) endRow();

  // Drop fully-empty trailing rows (a blank line at the end of the file).
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();

  return rows;
}

/**
 * Undoes the formula-injection guard our own export applies (a leading `'`
 * before a value starting with = + - @) — otherwise re-importing a file we
 * exported ourselves would pick up a spurious leading apostrophe.
 */
export function unescapeCsvValue(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}
