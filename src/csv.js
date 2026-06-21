// Minimal RFC-4180-ish CSV parser (handles quoted fields, embedded commas/quotes,
// "" escapes, and CRLF/LF). Returns an array of objects keyed by the header row.

export function parseCsvToObjects(text) {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, i) => {
      obj[key] = cells[i] ?? '';
    });
    return obj;
  });
}

function parseRows(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const s = text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // skip blank lines
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // flush last field/row if file doesn't end with newline
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}
