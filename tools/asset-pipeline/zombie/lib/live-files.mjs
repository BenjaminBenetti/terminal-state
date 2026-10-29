// Meshy T2.5 migration (lane CHARS): which zombie body / wearable GLB is LIVE for an id. Rebuilt files carry a '-t25'
// suffix while the superseded files may still sit next to them until they are git-removed, so QA tools must not pick
// files by pattern. In the runtime models directory the game's own manifest (game/src/assets/manifest.ts MODEL_FILES:
// zombieBody_<id> / outfit_<id>) decides; in any other directory (dev builds via --out) the '-t25' file wins.
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from './master.mjs';

export const RUNTIME_MODELS = path.join(REPO, 'game/public/assets/models');

/** {bodies: {id: absFile}, wearables: {id: absFile}} for a models directory. */
export function liveModelFiles(models = RUNTIME_MODELS) {
  const dir = path.resolve(models);
  const out = {bodies: {}, wearables: {}};
  if (dir === RUNTIME_MODELS) {
    const src = fs.readFileSync(path.join(REPO, 'game/src/assets/manifest.ts'), 'utf8');
    for (const m of src.matchAll(/\b(zombieBody|outfit)_([a-z0-9]+):\s*\{url:\s*'assets\/models\/([^']+\.glb)'/g))
      (m[1] === 'zombieBody' ? out.bodies : out.wearables)[m[2]] = path.join(dir, m[3]);
    return out;
  }
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^(zombie-body|outfit)-([a-z0-9]+)(-t25)?\.glb$/.exec(f);
    if (!m) continue;
    const map = m[1] === 'zombie-body' ? out.bodies : out.wearables;
    if (!map[m[2]] || m[3]) map[m[2]] = path.join(dir, f);
  }
  return out;
}

/** Absolute file of one live body ('body') or wearable ('wearable') id. */
export function liveFile(models, kind, id) {
  const f = liveModelFiles(models)[kind === 'body' ? 'bodies' : 'wearables'][id];
  if (!f) throw new Error(`no live ${kind} file for ${id} in ${path.relative(REPO, path.resolve(models))}`);
  return f;
}
