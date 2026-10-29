// Meshy T2.5 migration (task studio-meshy-game-replacement-20261029-01, lane CHARS): source resolution for the
// character pipelines (zombie bodies / wearables, rat-dog creature).
//
// A T2.5 source is the Meshy `meshy_image_to_3d` (ai_model meshy-t2.5, smart topology, 2K PBR) NATIVE GLB that lane
// MESHY downloaded to reference/tasks/meshy-game-replacement-20261029/assets/raw/<asset>/<attempt>/native.glb and indexed
// in assets/DELIVERED.json (task id, input image + sha256, review verdict). The pipelines use it read-only, pinned by
// sha256 (config), exactly like the old Pixal3D masters; only ACCEPTED deliveries are used.
//
// Meshy outputs are low-poly (~15-21 k triangles); the slice-landmark stages need a dense vertex cloud, so the loader
// densifies the source by consistent edge splits (lib/densify.mjs: same surface, same texture mapping) before the
// unchanged stages run (placement, skeleton / garment / pants / quadruped landmarks, simplify, unwrap, bake).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {REPO} from './master.mjs';
import {loadSource} from './source.mjs';
import {densify} from './densify.mjs';
import {bounds} from './mesh.mjs';

export const T25_TASK = 'studio-meshy-game-replacement-20261029-01';
export const T25_ROOT = path.join(REPO, 'reference/tasks/meshy-game-replacement-20261029/assets');
export const T25_DELIVERED = path.join(T25_ROOT, 'DELIVERED.json');
/** Pushed base commit of the migration (restore point of every replaced runtime file). */
export const T25_BASE_COMMIT = 'a7a646a1dd62bf1c641fe3dd0d1187ab322afe87';
/** Runtime file suffix of every derivative rebuilt in the migration (new URL = cache-busting; logical keys unchanged). */
export const T25_SUFFIX = '-t25';

/** Hash of the T2.5 loader code (part of the stage cache key of T2.5 sources). */
export function t25LoaderHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['t25.mjs', 'densify.mjs']) h.update(fs.readFileSync(new URL(f, import.meta.url)));
  return h.digest('hex').slice(0, 12);
}

let delivered = null;
export function deliveredIndex() {
  if (!delivered) delivered = JSON.parse(fs.readFileSync(T25_DELIVERED, 'utf8'));
  return delivered;
}

/**
 * Source record for an accepted T2.5 delivery.
 * @param asset inventory master id (e.g. 'body:heavyset')
 * @param pin {sha256, attempt?} the native GLB this build is pinned to
 * @param densifyFrac max edge length after densification as a fraction of the source's bbox height
 * @param extra facing etc. (merged into the record)
 * @returns loadSource-compatible record (with `t25` metadata) or null when not delivered / not accepted / pin differs
 */
export function t25Source(asset, pin, densifyFrac, extra = {}) {
  const d = deliveredIndex().assets?.[asset];
  if (!d || d.status !== 'SUCCEEDED' || d.review !== 'accepted') return null;
  if (pin.attempt && d.attempt !== pin.attempt) return null;
  if (d.sha256 !== pin.sha256) throw new Error(`${asset}: delivered native sha256 ${d.sha256} differs from the pinned ${pin.sha256} (re-review and update the pin)`);
  const file = path.join(T25_ROOT, d.nativeGlb);
  if (!fs.existsSync(file)) return null;
  return {
    id: asset, file, sha256: d.sha256, densifyFrac, ...extra,
    // srcInfo() fields of the derivative manifests
    inputPng: d.inputImage, inputPngSha256: d.inputImageSha256, jobId: d.taskId, displayName: asset,
    t25: {asset, attempt: d.attempt, taskId: d.taskId, provider: 'Meshy meshy_image_to_3d (ai_model meshy-t2.5, model_type smart-topology, 2K PBR textures, single original front/reference image)',
      args: d.args, nativeGlb: path.relative(REPO, file), nativeSha256: d.sha256, nativeBytes: d.bytes, nativeTriangles: d.tris, nativeVertices: d.verts, nativeBBox: d.bbox,
      nativeTextures: d.textures, inputImage: d.inputImage && path.relative(REPO, d.inputImage), inputImageSha256: d.inputImageSha256, review: d.review, reviewNote: d.reviewNote,
      delivered: path.relative(REPO, T25_DELIVERED)},
  };
}

/** loadSource + densification for T2.5 sources (other sources load unchanged). */
export async function loadAnySource(src) {
  const m = await loadSource(src);
  if (!src.t25) return m;
  const b = bounds(m.pos), H = b.max[1] - b.min[1];
  const d = densify(m, H * src.densifyFrac);
  return {...m, pos: d.pos, nrm: d.nrm, uv: d.uv, idx: d.idx, triangles: m.triangles, vertices: m.vertices,
    densify: {...d.stats, maxEdgeFractionOfHeight: src.densifyFrac, sourceHeightUnits: +H.toPrecision(6)}};
}

/** Pushed-history restore record for an old runtime path (read-only git; null when not tracked in the base commit). */
export function restoreRecord(relPath, git) {
  try {
    const blob = git(['rev-parse', `${T25_BASE_COMMIT}:${relPath}`]).trim();
    return {path: relPath, baseCommit: T25_BASE_COMMIT, blob, restore: `git show ${T25_BASE_COMMIT.slice(0, 7)}:${relPath} > ${relPath}`};
  } catch { return null; }
}
