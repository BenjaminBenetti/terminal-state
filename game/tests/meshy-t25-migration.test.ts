// Meshy T2.5 replacement (task studio-meshy-game-replacement-20261029-01, primary): migration guards over the whole game.
//  - every superseded runtime file recorded in the class provenance restore maps (assets/derivatives/meshy-t25-*-20261029.json)
//    is gone from game/public and no live source string still names it (Git history at a7a646a is the restore point);
//  - every new -t25 runtime file the provenance names exists;
//  - every model file a source string names exists (no dangling URL after the renames);
//  - the excluded assets are untouched: the 25 Meshy office models / textures and the user's weapon files still match the
//    hashes their own provenance recorded.

import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, basename} from 'node:path';

const ROOT = join(__dirname, '..', '..');
const PUB = join(ROOT, 'game', 'public');
const DER = join(PUB, 'assets', 'derivatives');
const SRC = join(ROOT, 'game', 'src');

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const abs = (p: string) => (p.startsWith('game/') ? join(ROOT, p) : join(PUB, p.replace(/^\/+/, '')));

/** Visit every property; `trail` is the dotted key path to it (e.g. 'records.replaces.path'). */
function walk(v: unknown, fn: (k: string, v: unknown, parent: Record<string, unknown>, trail: string) => void, trail = ''): void {
  if (Array.isArray(v)) for (const x of v) walk(x, fn, trail);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const t = trail ? `${trail}.${k}` : k; fn(k, x, v as Record<string, unknown>, t); walk(x, fn, t); }
}

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) srcFiles(p, out); else if (/\.(ts|tsx|js|mjs)$/.test(f)) out.push(p);
  }
  return out;
}
// source text without comments (block + line), so historical notes don't count as live references
const code = srcFiles(SRC).map(p => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')).join('\n')
  + readFileSync(join(ROOT, 'game', 'index.html'), 'utf8');

const provFiles = readdirSync(DER).filter(f => /^meshy-t25-.*-20261029\.json$/.test(f));
const oldPaths = new Set<string>(), newPaths = new Set<string>(), repairedFrom = new Set<string>();
for (const f of provFiles) {
  walk(JSON.parse(readFileSync(join(DER, f), 'utf8')), (_k, v, _p, trail) => {
    if (typeof v !== 'string' || !/^(game\/public\/)?assets\/models\/[\w.-]+\.glb$/.test(v)) return;
    // task model-touchups-20261030: a local repair's superseded -t25 output (record.localRepair.previousOutput)
    if (/localRepair\.previousOutput/.test(trail)) repairedFrom.add(v);
    if (/old|restore|replaces|previous|superseded/i.test(trail)) oldPaths.add(v);
    else if (/-t25(r\d+)?\.glb$/.test(v)) newPaths.add(v); // -t25rN: a local repair's cache-busting file
  });
}

describe('Meshy T2.5 migration guards', () => {
  it('the class provenance files exist and name both the superseded files and their -t25 replacements', () => {
    expect(provFiles.sort()).toEqual(['meshy-t25-chars-20261029.json', 'meshy-t25-items-20261029.json', 'meshy-t25-light-20261029.json', 'meshy-t25-props-20261029.json']);
    expect(oldPaths.size).toBeGreaterThanOrEqual(140);
    expect(newPaths.size).toBeGreaterThanOrEqual(140);
  });

  it('every superseded runtime file is removed from the game and named by no live source string', () => {
    const still: string[] = [], named: string[] = [];
    for (const p of oldPaths) {
      if (/-t25\.glb$/.test(p) && !repairedFrom.has(p)) continue;
      if (existsSync(abs(p))) still.push(p);
      const b = basename(p);
      if (new RegExp(`['"\`/]${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(code)) named.push(b);
    }
    expect(still).toEqual([]);
    expect(named).toEqual([]);
  });

  it('every -t25 runtime file named by provenance exists', () => {
    const missing = [...newPaths].filter(p => !existsSync(abs(p)));
    expect(missing).toEqual([]);
  });

  it('every model file named by a source string exists on disk', () => {
    const names = new Set<string>();
    for (const m of code.matchAll(/['"`/]([\w.-]+\.glb)['"`]/g)) names.add(m[1]);
    const models = new Set(readdirSync(join(PUB, 'assets', 'models')));
    const dangling = [...names].filter(n => !models.has(n) && !/\$\{/.test(n));
    expect(dangling).toEqual([]);
  });

  it('excluded assets are untouched: the Meshy office set and the user weapons still match their recorded hashes', () => {
    const checked: string[] = [], mismatched: string[] = [];
    for (const f of ['office-space-20261029.json', 'user-weapons-20261028.json']) {
      walk(JSON.parse(readFileSync(join(DER, f), 'utf8')), (_k, v, parent) => {
        if (_k !== 'sha256' || typeof v !== 'string') return;
        const p = (parent.path ?? parent.file ?? parent.output) as unknown;
        if (typeof p !== 'string' || !/^(game\/public\/)?assets\/(models|textures)\//.test(p)) return;
        const file = abs(p);
        if (!existsSync(file)) { mismatched.push(`${p} (missing)`); return; }
        checked.push(p);
        if (sha(file) !== v) mismatched.push(p);
      });
    }
    expect(mismatched).toEqual([]);
    expect(checked.some(p => /office-/.test(p))).toBe(true);
  });
});
