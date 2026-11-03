// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): the save file's INTEGRITY checksum (campaign/types.ts
// SaveFileV1.checksum) — FNV-1a (32-bit) over the UTF-8 bytes of the CANONICAL JSON of `run` (object keys sorted at every depth,
// arrays in order, no whitespace, `undefined` object members skipped like JSON.stringify). It detects a damaged / truncated /
// hand-edited file; it is NOT security (anyone can recompute it). Pure.

/** Canonical JSON: JSON.stringify with every object's keys sorted (so a re-ordered but equal file hashes the same). */
export function canonicalJson(v: unknown): string {
  const out: string[] = [];
  write(v, out);
  return out.join('');
}

function write(v: unknown, out: string[]): void {
  if (v === null || typeof v !== 'object') {
    // numbers / strings / booleans exactly as JSON.stringify writes them (non-finite numbers become null, as in JSON)
    out.push(v === undefined ? 'null' : JSON.stringify(v));
    return;
  }
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i) out.push(',');
      const x = v[i];
      write(x === undefined || typeof x === 'function' ? null : x, out);
    }
    out.push(']');
    return;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter(k => o[k] !== undefined && typeof o[k] !== 'function').sort();
  out.push('{');
  keys.forEach((k, i) => {
    if (i) out.push(',');
    out.push(JSON.stringify(k), ':');
    write(o[k], out);
  });
  out.push('}');
}

/** FNV-1a 32-bit of a string's UTF-8 bytes. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The checksum string of a save's `run`: 'fnv1a32-' + 8 lowercase hex digits. */
export function checksumOf(run: unknown): string {
  return `fnv1a32-${fnv1a32(canonicalJson(run)).toString(16).padStart(8, '0')}`;
}

/** UTF-8 byte length of a string (the file-size limit is in bytes). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
