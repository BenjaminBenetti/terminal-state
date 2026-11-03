// Iteration 07 (Lane W): pose-aware garment refit so cloth sits OUTSIDE the body in every pose.
//
// Runs after the iteration-06 per-body placement (fit.mjs: canonical retarget / pants row fit + push-out)
// for upper (garment) and lower (pants) wearables. Root causes it fixes (measured by lib/penetration.mjs,
// evidence qa-artifacts/iter07-wardrobe/fit-*-before.png):
//  1. garment surfaces left UNDER the skin in the bind pose wherever the retargeted garment is smaller
//     than the body (heavy back / belly, collars, hoods): the old push-out only moved garment vertices
//     whose closest body point was within a few grid cells and never looked at body points BETWEEN
//     garment vertices;
//  2. upper garments only collided with the pants ABOVE the crotch: pants legs poked through every coat
//     skirt and many hems;
//  3. garment skin weights were blended away from the body under them (closest point across the
//     arm/torso gap, smoothing, a skirt rule fading the coat to the hips) so cloth and body deformed
//     differently in motion;
//  4. body masks were computed in the bind pose only.
// Method (per body x wearable, welded garment vertices):
//  a. ANCHOR every garment vertex to the OUTER body surface point under it: closest point restricted to
//     the body regions that garment part can cover (sleeves -> own arm + shoulder cap; torso panels ->
//     torso/hips/thighs, never the arms; pant legs -> own leg; waistband -> pelvis/torso) and to outer-hull
//     triangles (AI bodies contain inner shells - shirt/skin double walls - whose normals face inward);
//  b. WEIGHTS = the body's own skin weights interpolated at the anchor (garment and body deform with the
//     same bones), light masked smoothing; coat skirts follow the thighs (shin -> thigh, the centre line
//     splits evenly between both thighs); collars/hoods use Neck instead of Head;
//  c. CLEARANCE as an OFFSET FIELD ON THE SKIN: each outer body vertex carries a required outward offset
//     e (metres along its normal); every garment vertex moves by the field interpolated at its anchor, so
//     both walls of thick (closed-shell) garments and neighbouring panels move together - no crumpling.
//     Bind rounds raise e until every garment vertex is >= `clear` outside its anchor and every covered
//     body vertex (and, for uppers, every covered outer-wall vertex of each fitted lower garment, mapped to
//     the skin under it) has the cloth >= `minClear` outside it along its own normal (catches body bumps
//     between garment vertices). Only cloth ANCHORED near that skin counts (an arm against a jacket flank is
//     limb contact, not fit); e is diffused over the skin (max-preserving) so pushes stay smooth;
//  d. POSE VALIDATION: body + garment (+ lowers) are skinned through every 3rd frame of all six clips
//     plus three ragdoll-like extreme poses; wherever the body (or a lower garment) comes within
//     `poseClear` of the cloth or pokes through it, e grows there (extra capped at `maxExtra`, extremes at
//     `extremeCap`) - repeated until clean or the round limit;
//  e. MASKS: a body triangle is hidden only if it is enclosed in the bind pose (tilted-ray test) AND
//     covered by the cloth in EVERY validation pose (never exposed, never poking); same for the lower
//     garment under an upper (hideWear).
import fs from 'node:fs';
import {TriGrid, skin, outerHull} from './penetration.mjs';
import {JOINT_NAMES} from './skin.mjs';
import {vertexAdjacency, computeNormals} from './mesh.mjs';
import {coverMask, closestDistances} from './fit.mjs';

const NJ = JOINT_NAMES.length;
const JI = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const REG = {torso: 0, armL: 1, armR: 2, legL: 3, legR: 4};

/** Rig.fk output ({name: {pos, rot}}) -> penetration.skin world list in JOINT_NAMES order. */
export function worldList(fk, skel) {
  return JOINT_NAMES.map(n => ({q: fk[n].rot, p: fk[n].pos, b: skel.joints[n]}));
}

/** Per-body context: welded mesh, normals, weights, regions, outer hull and region-restricted grids. */
function bodyCtx(B) {
  const W = B.low.welded, n = W.pos.length / 3, nt = W.idx.length / 3;
  const region = B.weldedWeights.region;
  const nrm = W.nrm ?? computeNormals(W.pos, W.idx);
  const grid = new TriGrid(W.pos, W.idx, 0.03);
  const hull = outerHull(W.pos, nrm, W.idx, grid);
  const sets = {};
  const sub = (key, pred) => {
    if (sets[key]) return sets[key];
    const keep = [];
    for (let t = 0; t < nt; t++) { let k = 0, h = 0; for (let c = 0; c < 3; c++) { const v = W.idx[t * 3 + c]; if (pred(v)) k++; if (hull[v]) h++; } if (k >= 2 && h >= 2) keep.push(W.idx[t * 3], W.idx[t * 3 + 1], W.idx[t * 3 + 2]); }
    const idx = Uint32Array.from(keep);
    return (sets[key] = {idx, g: new TriGrid(W.pos, idx, 0.03)});
  };
  return {W, n, nt, region, nrm, grid, hull, sub, joints: B.weldedWeights.joints, weights: B.weldedWeights.weights};
}

/**
 * Garment part label per welded vertex: 'torso' | 'sleeveL' | 'sleeveR' | 'legL' | 'legR' | 'top'.
 * legX (task mall-lingerie, body option pantsFit.legSplit 'nominal'): the pant leg side comes from the vertex's x in the
 * NOMINAL pants mesh (its legs are apart there) instead of the fitted x - on a body whose inner thighs touch the fitted
 * inner leg panels cross x = 0, and a panel half-weighted to the other leg stretches into a sheet when the legs part.
 */
function garmentParts(G, kind, gRegion, skel, legX = null) {
  const n = G.length / 3, out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (kind === 'pants') out[i] = G[i * 3 + 1] < skel.crotchY ? ((legX ? legX[i * 3] : G[i * 3]) >= 0 ? 'legL' : 'legR') : 'top';
    else out[i] = gRegion && gRegion[i] === 1 ? 'sleeveL' : gRegion && gRegion[i] === 2 ? 'sleeveR' : 'torso';
  }
  return out;
}

/** Region-restricted closest OUTER body point (anchor) per garment vertex. */
function anchors(ctx, G, parts, skel) {
  const R = ctx.region, P = ctx.W.pos;
  const preds = {
    torso: v => R[v] === REG.torso || R[v] === REG.legL || R[v] === REG.legR,
    top: v => R[v] === REG.torso || R[v] === REG.legL || R[v] === REG.legR,
    sleeveL: v => R[v] === REG.armL || (R[v] === REG.torso && P[v * 3 + 1] > skel.armpitY - 0.01 && P[v * 3] > 0),
    sleeveR: v => R[v] === REG.armR || (R[v] === REG.torso && P[v * 3 + 1] > skel.armpitY - 0.01 && P[v * 3] < 0),
    legL: v => R[v] === REG.legL,
    legR: v => R[v] === REG.legR,
  };
  const all = ctx.sub('all', () => true);
  const n = G.length / 3;
  const verts = new Uint32Array(n * 3), bw = new Float32Array(n * 3), q = new Float32Array(n * 3), nr = new Float32Array(n * 3), dist = new Float32Array(n);
  let fallback = 0;
  for (let i = 0; i < n; i++) {
    const set = ctx.sub(parts[i], preds[parts[i]]);
    let c = set.idx.length ? set.g.closest(G[i * 3], G[i * 3 + 1], G[i * 3 + 2], 0.6) : null;
    let I = set.idx;
    if (!c) { c = all.g.closest(G[i * 3], G[i * 3 + 1], G[i * 3 + 2], 1.0); I = all.idx; fallback++; }
    for (let k = 0; k < 3; k++) { verts[i * 3 + k] = I[c.tri * 3 + k]; bw[i * 3 + k] = c.q[3 + k]; q[i * 3 + k] = c.q[k]; }
    dist[i] = c.d;
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { const v = verts[i * 3 + k], ww = bw[i * 3 + k]; nx += ctx.nrm[v * 3] * ww; ny += ctx.nrm[v * 3 + 1] * ww; nz += ctx.nrm[v * 3 + 2] * ww; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nr[i * 3] = nx / l; nr[i * 3 + 1] = ny / l; nr[i * 3 + 2] = nz / l;
  }
  return {verts, bw, q, n: nr, dist, fallback};
}

/** Garment weights from the anchors (dense rows), post rules, masked smoothing, top-4. */
function anchorWeights(ctx, A, G, idx, parts, kind, skel, {smoothIters = 2, lambda = 0.3, skirtCentre = 0.075} = {}) {
  const n = G.length / 3, Wd = new Float32Array(n * NJ);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = A.verts[i * 3 + k], bw = A.bw[i * 3 + k];
      if (!bw) continue;
      for (let s = 0; s < 4; s++) { const w = ctx.weights[v * 4 + s]; if (w) Wd[i * NJ + ctx.joints[v * 4 + s]] += bw * w; }
    }
  }
  let skirt = 0;
  for (let i = 0; i < n; i++) {
    const row = Wd.subarray(i * NJ, i * NJ + NJ);
    if (kind !== 'pants') {
      // collars / hoods follow the neck, not head turns
      row[JI.Neck] += row[JI.Head]; row[JI.Head] = 0;
      // coat skirts (torso panel below the crotch): follow the thighs (shin/foot -> thigh: the hem never
      // folds with the knee); the centre line splits the thigh share evenly between both legs
      const y = G[i * 3 + 1], x = G[i * 3];
      if (parts[i] === 'torso' && y < skel.crotchY + 0.06) {
        skirt++;
        for (const s of ['L', 'R']) { row[JI[s + '_Thigh']] += row[JI[s + '_Shin']] + row[JI[s + '_Foot']]; row[JI[s + '_Shin']] = 0; row[JI[s + '_Foot']] = 0; }
        const T = row[JI.L_Thigh] + row[JI.R_Thigh];
        const g = (1 - ss(0.03, skirtCentre + 0.04, Math.abs(x))) * ss(skel.crotchY + 0.06, skel.crotchY - 0.02, y), tL = ss(-skirtCentre, skirtCentre, x);
        row[JI.L_Thigh] = (1 - g) * row[JI.L_Thigh] + g * T * tL;
        row[JI.R_Thigh] = (1 - g) * row[JI.R_Thigh] + g * T * (1 - tL);
      }
    } else {
      for (const j of ['Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand']) row[JI[j]] = 0;
    }
    let s = 0; for (let j = 0; j < NJ; j++) s += row[j];
    if (s > 0) for (let j = 0; j < NJ; j++) row[j] /= s; else row[JI.Hips] = 1;
  }
  const {offs, adj} = vertexAdjacency(n, idx);
  for (let it = 0; it < smoothIters; it++) {
    const Wn = new Float32Array(Wd.length);
    for (let i = 0; i < n; i++) {
      const deg = offs[i + 1] - offs[i];
      for (let j = 0; j < NJ; j++) {
        let a = 0; for (let k = offs[i]; k < offs[i + 1]; k++) a += Wd[adj[k] * NJ + j];
        Wn[i * NJ + j] = deg ? (1 - lambda) * Wd[i * NJ + j] + lambda * a / deg : Wd[i * NJ + j];
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < NJ; j++) {
        if (Wd[i * NJ + j] > 0) continue;
        let nb = false; for (let k = offs[i]; k < offs[i + 1] && !nb; k++) nb = Wd[adj[k] * NJ + j] > 0.02;
        if (!nb) Wn[i * NJ + j] = 0;
      }
      let s = 0; for (let j = 0; j < NJ; j++) s += Wn[i * NJ + j];
      for (let j = 0; j < NJ; j++) Wn[i * NJ + j] /= s || 1;
    }
    Wd.set(Wn);
  }
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const row = Array.from(Wd.subarray(i * NJ, i * NJ + NJ), (w, j) => [w, j]).filter(e => e[0] > 1e-4).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 4);
    const s = row.reduce((a, e) => a + e[0], 0) || 1;
    for (let k = 0; k < 4; k++) { joints[i * 4 + k] = row[k] ? row[k][1] : 0; weights[i * 4 + k] = row[k] ? row[k][0] / s : 0; }
    weights[i * 4] += 1 - (weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3]);
  }
  return {joints, weights, skirtVertices: skirt};
}

/**
 * Coverage + clearance deficits of the cloth over inner vertices (body outer hull or a lower garment's
 * outer wall). For each covered vertex the cloth must be >= minClear outside it along its normal; the
 * deficit (missing distance) is reported per inner vertex when the cloth hit is ANCHORED near that vertex
 * (`near(i, tri)`), so the skin offset field under it can grow.
 * covered: precomputed Uint8Array or null (=> computed: outward hit within coverDist or cloth under skin).
 */
function deficits(inner, cloth, minClear, {covered = null, coverDist = 0.1, outDist = 0.12, maxDepth = 0.12, eligible = null, track = null, near = null, dirOk = null, pokeList = null} = {}) {
  const og = new TriGrid(cloth.pos, cloth.idx, 0.03);
  const ig = inner.grid ?? new TriGrid(inner.pos, inner.idx, 0.03);
  const P = inner.pos, N = inner.nrm, nv = P.length / 3;
  const def = new Float32Array(nv), hitTri = new Int32Array(nv).fill(-1);
  const cov = covered ?? new Uint8Array(nv);
  let n = 0, poke = 0, close = 0, exposed = 0, far = 0, skew = 0, maxDef = 0;
  for (let i = 0; i < nv; i++) {
    if (eligible && !eligible[i]) continue;
    if (covered && !covered[i]) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    let d = 0, tri = -1;
    const out = og.ray(x - nx * 1e-4, y - ny * 1e-4, z - nz * 1e-4, nx, ny, nz, covered ? outDist : coverDist);
    if (out) { if (!covered) cov[i] = 1; if (out.t < minClear) { d = minClear - out.t; tri = out.tri; close++; } }
    else {
      const back = ig.ray(x, y, z, -nx, -ny, -nz, 0.4, 0.025);
      const lim = Math.min(maxDepth, 0.45 * (back ? back.t : 0.4));
      const u = og.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, -nx, -ny, -nz, lim, 0.0002, null, true);
      if (u) { if (!covered) cov[i] = 1; d = u.t + minClear; tri = u.tri; poke++; if (track) track.poke[i] = 1; if (pokeList) pokeList.push(i); }
      else if (covered) { exposed++; if (track) track.exposed[i] = 1; }
    }
    if (cov[i]) n++;
    if (tri >= 0) {
      if (near && !near(i, tri)) { far++; continue; }
      // pushing the cloth along its anchor normals cannot fix a contact whose normal points elsewhere
      // (cos < 0.3: waistband rims under a hem, the far side of the neck under a jaw): reported, not
      // chased (scaling those pushes was tried: it over-inflated and created new pokes)
      if (dirOk && dirOk(i, tri) < 0.3) { skew++; continue; }
      def[i] = d; hitTri[i] = tri; maxDef = Math.max(maxDef, d);
    }
  }
  return {def, hitTri, covered: cov, stats: {covered: n, poke, close, exposed, notAnchoredHere: far, directionSkew: skew, maxDeficit: +maxDef.toFixed(4)}};
}

/** Max-preserving diffusion of a per-vertex scalar over a mesh adjacency. */
function diffuse(e, offs, adj, iters = 4, k = 0.85) {
  let cur = e;
  for (let it = 0; it < iters; it++) {
    const nx = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      let a = 0; const deg = offs[i + 1] - offs[i];
      for (let q = offs[i]; q < offs[i + 1]; q++) a += cur[adj[q]];
      nx[i] = Math.max(cur[i], deg ? k * a / deg : 0);
    }
    cur = nx;
  }
  return cur;
}

/**
 * Refit one fitted variant (fit.mjs fitVariant result `v`) for body B. gC = stage record (garment:
 * {canonical, low:{weldId}, sleeved}, pants: {low:{weldId, welded}}), cfg = wearable config (cfg.fit07 overrides).
 * B.poses: [{clip, world}] validation poses (worldList); B.layers: fitted lowers [{id, pos, idx, joints, weights}]
 * (welded) and B.layerUV: {id: {pos, idx, joints, weldId}} (UV-split, for hideWear masks) - uppers only.
 */
export function refineFit(v, gC, cfg, B) {
  const t0 = Date.now();
  const kind = cfg.kind;
  const o = {clear: kind === 'pants' ? 0.006 : 0.009, minClear: kind === 'pants' ? 0.004 : 0.006, poseClear: 0.0015, layerClear: 0.006, layerPoseClear: 0.002,
    maxBind: 0.09, maxExtra: kind === 'pants' ? 0.015 : 0.02, extremeCap: 0.012, nearM: 0.05, rounds: 3, maxRoundRaise: 0.04, freezeAfter: 5, ...(cfg.fit07 ?? {})};
  const ctx = bodyCtx(B);
  const idx = kind === 'pants' ? gC.low.welded.idx : gC.canonical.idx;
  const orig = new Float32Array(v.weldedPos), base = new Float32Array(v.weldedPos);
  const n = base.length / 3;
  const parts = garmentParts(base, kind, kind === 'pants' ? null : gC.canonical.region, B.skel, kind === 'pants' && B.pantsFit?.legSplit === 'nominal' ? gC.low.welded.pos : null);
  const A = anchors(ctx, base, parts, B.skel);
  const Wt = anchorWeights(ctx, A, base, idx, parts, kind, B.skel, cfg.fit07?.weights);
  const bodyAdj = vertexAdjacency(ctx.n, ctx.W.idx);
  const BP = ctx.W.pos, BN = ctx.nrm;
  const bodyBind = {pos: BP, nrm: BN, idx: ctx.W.idx, grid: ctx.grid};
  // is the cloth triangle `tri` anchored near inner vertex i (bind positions)?
  const nearBody = (i, tri) => { for (let c = 0; c < 3; c++) { const g = idx[tri * 3 + c]; if (Math.hypot(A.q[g * 3] - BP[i * 3], A.q[g * 3 + 1] - BP[i * 3 + 1], A.q[g * 3 + 2] - BP[i * 3 + 2]) < o.nearM) return true; } return false; };
  // mean anchor normal of a cloth triangle vs the inner vertex normal (bind)
  // returns the cosine between them (deficits() skips contacts with cos < 0.3)
  const triDir = (tri, nx, ny, nz) => { let x = 0, y = 0, z = 0; for (let c = 0; c < 3; c++) { const g = idx[tri * 3 + c]; x += A.n[g * 3]; y += A.n[g * 3 + 1]; z += A.n[g * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; return (x * nx + y * ny + z * nz) / l; };
  const dirBody = (i, tri) => triDir(tri, BN[i * 3], BN[i * 3 + 1], BN[i * 3 + 2]);
  // pants end at the footwear: shoes / boots (Foot-dominant skin) are never covered by a pant leg
  const FOOT = new Set([JI.L_Foot, JI.R_Foot]);
  const eligibleBody = Uint8Array.from(ctx.hull, (h, i) => h && !(kind === 'pants' && FOOT.has(ctx.joints[i * 4])) ? 1 : 0);
  const all = ctx.sub('all', () => true);
  const layers = (kind !== 'pants' ? B.layers ?? [] : []).map(L => {
    const nrm = computeNormals(L.pos, L.idx);
    const lay = {id: L.id, pos: L.pos, idx: L.idx, nrm, joints: L.joints, weights: L.weights, grid: new TriGrid(L.pos, L.idx, 0.03)};
    const hull = outerHull(L.pos, nrm, L.idx, lay.grid), nl = L.pos.length / 3;
    lay.eligible = new Uint8Array(nl);
    lay.anchor = new Uint32Array(nl * 3); lay.abw = new Float32Array(nl * 3); lay.aq = new Float32Array(nl * 3);
    for (let i = 0; i < nl; i++) {
      const c = all.g.closest(L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2], 0.6);
      if (!c) continue;
      for (let k = 0; k < 3; k++) { lay.anchor[i * 3 + k] = all.idx[c.tri * 3 + k]; lay.abw[i * 3 + k] = c.q[3 + k]; lay.aq[i * 3 + k] = c.q[k]; }
      // outer wall: on the hull and facing away from the skin under it
      lay.eligible[i] = hull[i] && (L.pos[i * 3] - c.q[0]) * nrm[i * 3] + (L.pos[i * 3 + 1] - c.q[1]) * nrm[i * 3 + 1] + (L.pos[i * 3 + 2] - c.q[2]) * nrm[i * 3 + 2] > 0 ? 1 : 0;
    }
    // cloth triangle anchored near the skin under lower vertex i
    lay.dirOk = (i, tri) => triDir(tri, nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    lay.near = (i, tri) => { for (let c = 0; c < 3; c++) { const g = idx[tri * 3 + c]; if (Math.hypot(A.q[g * 3] - lay.aq[i * 3], A.q[g * 3 + 1] - lay.aq[i * 3 + 1], A.q[g * 3 + 2] - lay.aq[i * 3 + 2]) < o.nearM) return true; } return false; };
    return lay;
  });
  // ---- c0. iron deep wrinkle valleys: the offset of each cloth vertex above its anchor (along the anchor
  // normal) is low-pass filtered over the garment; valleys more than `ironDepth` below their local average
  // (AI cloth folds dipping into the skin) are lifted toward it - otherwise the whole band would have to be
  // pushed out by the fold depth (flared hems)
  let ironed = 0;
  {
    const sOff = new Float32Array(n);
    for (let i = 0; i < n; i++) sOff[i] = (base[i * 3] - A.q[i * 3]) * A.n[i * 3] + (base[i * 3 + 1] - A.q[i * 3 + 1]) * A.n[i * 3 + 1] + (base[i * 3 + 2] - A.q[i * 3 + 2]) * A.n[i * 3 + 2];
    const {offs, adj} = vertexAdjacency(n, idx);
    let sm = Float32Array.from(sOff);
    for (let it = 0; it < (o.ironIters ?? 12); it++) {
      const nx = new Float32Array(n);
      for (let i = 0; i < n; i++) { let a = 0; const deg = offs[i + 1] - offs[i]; for (let q = offs[i]; q < offs[i + 1]; q++) a += sm[adj[q]]; nx[i] = deg ? 0.5 * sm[i] + 0.5 * a / deg : sm[i]; }
      sm = nx;
    }
    const depth = o.ironDepth ?? 0.008;
    for (let i = 0; i < n; i++) {
      if (A.dist[i] > 0.06) continue;
      const lift = (sm[i] - depth) - sOff[i];
      if (lift <= 0) continue;
      for (let k = 0; k < 3; k++) base[i * 3 + k] += A.n[i * 3 + k] * lift;
      ironed++;
    }
  }
  // ---- the skin offset field
  const eBind = new Float32Array(ctx.n), eExtra = new Float32Array(ctx.n);
  let eS = new Float32Array(ctx.n);
  const refresh = () => { const e = new Float32Array(ctx.n); for (let i = 0; i < ctx.n; i++) e[i] = eBind[i] + eExtra[i]; eS = diffuse(e, bodyAdj.offs, bodyAdj.adj, 4, 0.85); };
  const posOf = () => {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let dx = 0, dy = 0, dz = 0;
      for (let k = 0; k < 3; k++) { const vv = A.verts[i * 3 + k], w = A.bw[i * 3 + k] * eS[vv]; dx += BN[vv * 3] * w; dy += BN[vv * 3 + 1] * w; dz += BN[vv * 3 + 2] * w; }
      p[i * 3] = base[i * 3] + dx; p[i * 3 + 1] = base[i * 3 + 1] + dy; p[i * 3 + 2] = base[i * 3 + 2] + dz;
    }
    return p;
  };
  // a cloth triangle that must move out by d: raise the skin field at the skin vertices that triangle is
  // ANCHORED to (the cloth then moves by ~d along their normals); frozen skin vertices (stopped
  // converging) are left alone
  const raise = (field, i, d, cap) => { if (d > 0 && !frozen[i]) field[i] = Math.min(cap, Math.max(field[i], d)); };
  const frozen = new Uint8Array(ctx.n), raisedCount = new Uint8Array(ctx.n);
  const raiseTri = (field, tri, d, cap) => { for (let c = 0; c < 3; c++) { const g = idx[tri * 3 + c]; for (let k = 0; k < 3; k++) if (A.bw[g * 3 + k] > 0.15) raise(field, A.verts[g * 3 + k], d, cap); } };
  const raiseAll = (field, r, cap) => { for (let i = 0; i < r.def.length; i++) if (r.def[i] > 0 && r.hitTri[i] >= 0) raiseTri(field, r.hitTri[i], Math.min(cap, r.def[i]), 1); };
  // ---- c. bind clearance rounds
  const bindLog = [];
  for (let r = 0; r < 6; r++) {
    const pos = posOf(), cloth = {pos, idx};
    const req = new Float32Array(ctx.n);
    let anchorNeed = 0;
    for (let i = 0; i < n; i++) {
      if (A.dist[i] > 0.05) continue; // far from (or deep inside) the body: the body-vertex test decides
      const s = (pos[i * 3] - A.q[i * 3]) * A.n[i * 3] + (pos[i * 3 + 1] - A.q[i * 3 + 1]) * A.n[i * 3 + 1] + (pos[i * 3 + 2] - A.q[i * 3 + 2]) * A.n[i * 3 + 2];
      // only cloth at or just under the skin: deeper garment geometry is either a real poke (caught by the
      // body-vertex test, which sees its outward face) or interior reconstruction surfaces facing the body
      if (s < o.clear && s > -0.015) { anchorNeed++; for (let k = 0; k < 3; k++) if (A.bw[i * 3 + k] > 0.2) raise(req, A.verts[i * 3 + k], o.clear - s, 1); }
    }
    const d = deficits(bodyBind, cloth, o.minClear, {eligible: eligibleBody, near: nearBody, dirOk: dirBody});
    raiseAll(req, d, o.maxRoundRaise);
    const lstats = [];
    for (const L of layers) {
      const dl = deficits(L, cloth, o.layerClear, {eligible: L.eligible, near: L.near, dirOk: L.dirOk});
      raiseAll(req, dl, o.maxRoundRaise);
      lstats.push({id: L.id, ...dl.stats});
    }
    let need = 0, mx = 0;
    for (let i = 0; i < ctx.n; i++) if (req[i] > 1e-4) { need++; mx = Math.max(mx, req[i]); if (++raisedCount[i] >= o.freezeAfter) frozen[i] = 1; }
    bindLog.push({round: r, anchorBelowClear: anchorNeed, body: d.stats, layers: lstats, skinVerticesRaised: need, maxRaiseM: +mx.toFixed(4)});
    if (process.env.FIT07_DEBUG && r === +process.env.FIT07_DEBUG) {
      const dump = [];
      for (let i = 0; i < ctx.n; i++) if (req[i] > 1e-4) dump.push({i, p: [BP[i * 3], BP[i * 3 + 1], BP[i * 3 + 2]].map(x => +x.toFixed(3)), n: [BN[i * 3], BN[i * 3 + 1], BN[i * 3 + 2]].map(x => +x.toFixed(2)), req: +req[i].toFixed(4), e: +eS[i].toFixed(4), body: +d.def[i].toFixed(4), region: ctx.region[i], j: JOINT_NAMES[ctx.joints[i * 4]]});
      fs.writeFileSync(`/tmp/ll-w07/fit07-debug-${cfg.id}-${B.id}.json`, JSON.stringify(dump));
    }
    if (!need) break;
    for (let i = 0; i < ctx.n; i++) if (req[i] > 0) eBind[i] = Math.min(o.maxBind, eBind[i] + req[i]);
    refresh();
  }
  // ---- d. pose validation rounds
  const poses = B.poses ?? [];
  const poseLog = [];
  let final = null;
  const bodyMesh = {pos: BP, nrm: BN, joints: ctx.joints, weights: ctx.weights};
  for (let r = 0; r <= o.rounds; r++) {
    const bindPos = posOf(), cloth0 = {pos: bindPos, idx};
    const cm = {pos: bindPos, joints: Wt.joints, weights: Wt.weights};
    const bc = deficits(bodyBind, cloth0, 0, {eligible: eligibleBody}).covered;
    const lcs = layers.map(L => deficits(L, cloth0, 0, {eligible: L.eligible}).covered);
    const track = {poke: new Uint8Array(ctx.n), exposed: new Uint8Array(ctx.n)};
    const pokeLists = [];
    const ltrack = layers.map(L => ({poke: new Uint8Array(L.pos.length / 3), exposed: new Uint8Array(L.pos.length / 3)}));
    const req = new Float32Array(ctx.n);
    const per = {};
    for (const p of poses) {
      const bp = skin(bodyMesh, p.world, 1);
      const cp = skin(cm, p.world, 1).pos;
      const s = per[p.clip] ??= {poses: 0, covered: 0, maxPoke: 0, maxClose: 0, maxExposed: 0, maxNotAnchoredHere: 0, layerCovered: 0, layerMaxPoke: 0, layerMaxExposed: 0};
      const cap = /^ragdoll-/.test(p.clip) ? o.extremeCap : o.maxExtra;
      const pl = [];
      const d = deficits({pos: bp.pos, nrm: bp.nrm, idx: ctx.W.idx}, {pos: cp, idx}, o.poseClear, {covered: bc, eligible: eligibleBody, track, near: nearBody, dirOk: dirBody, pokeList: pl});
      pokeLists.push({clip: p.clip, body: pl, layers: {}});
      s.poses++; s.covered = d.stats.covered; s.maxPoke = Math.max(s.maxPoke, d.stats.poke); s.maxClose = Math.max(s.maxClose, d.stats.close); s.maxExposed = Math.max(s.maxExposed, d.stats.exposed); s.maxNotAnchoredHere = Math.max(s.maxNotAnchoredHere, d.stats.notAnchoredHere);
      raiseAll(req, d, cap);
      layers.forEach((L, li) => {
        const lp = skin(L, p.world, 1);
        const ll = [];
        const dl = deficits({pos: lp.pos, nrm: lp.nrm, idx: L.idx}, {pos: cp, idx}, o.layerPoseClear, {covered: lcs[li], eligible: L.eligible, track: ltrack[li], near: L.near, dirOk: L.dirOk, pokeList: ll});
        pokeLists[pokeLists.length - 1].layers[L.id] = ll;
        s.layerCovered = Math.max(s.layerCovered, dl.stats.covered); s.layerMaxPoke = Math.max(s.layerMaxPoke, dl.stats.poke); s.layerMaxExposed = Math.max(s.layerMaxExposed, dl.stats.exposed);
        const ls = (s.layers ??= {})[L.id] ??= {covered: 0, maxPoke: 0, maxExposed: 0};
        ls.covered = Math.max(ls.covered, dl.stats.covered); ls.maxPoke = Math.max(ls.maxPoke, dl.stats.poke); ls.maxExposed = Math.max(ls.maxExposed, dl.stats.exposed);
        raiseAll(req, dl, cap);
      });
    }
    let need = 0, mx = 0, capped = 0;
    for (let i = 0; i < ctx.n; i++) if (req[i] > 1e-4) { need++; mx = Math.max(mx, req[i]); if (++raisedCount[i] >= o.freezeAfter + 3) frozen[i] = 1; }
    const entry = {round: r, skinVerticesNeedingMore: need, maxDeficitM: +mx.toFixed(4)};
    poseLog.push(entry);
    final = {bc, lcs, track, ltrack, per, pokeLists};
    if (r === o.rounds || !need) break;
    for (let i = 0; i < ctx.n; i++) if (req[i] > 0) { const e = eExtra[i] + req[i]; if (e > o.maxExtra) capped++; eExtra[i] = Math.min(o.maxExtra, e); }
    entry.cappedSkinVertices = capped;
    refresh();
  }
  const pos = posOf();
  // ---- e. masks: enclosed in the bind pose (tilted rays) AND covered in every validation pose
  const skipJoints = kind === 'pants'
    ? ['Head', 'Neck', 'Chest', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Foot', 'R_Foot']
    : ['Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot', 'L_Thigh', 'L_Shin', 'R_Thigh', 'R_Shin', ...(gC.sleeved === false ? ['L_UpperArm', 'L_Forearm', 'R_UpperArm', 'R_Forearm'] : [])];
  const maskOpts = kind === 'pants' ? {maxDist: 0.07, inset: 0.025} : {};
  const m0 = coverMask({pos: B.low.pos, idx: B.low.idx}, {pos, idx}, {...maskOpts, ...(cfg.mask || {}), bodyJoints: B.joints, skipJoints});
  const weldOf = B.low.weldId;
  const hide = new Uint8Array(m0.hide.length);
  let dropped = 0, hidden = 0;
  for (let t = 0; t < hide.length; t++) {
    if (!m0.hide[t]) continue;
    let ok = true;
    for (let c = 0; c < 3; c++) { const wv = weldOf[B.low.idx[t * 3 + c]]; if (eligibleBody[wv] && (!final.bc[wv] || final.track.poke[wv] || final.track.exposed[wv])) { ok = false; break; } }
    if (ok) { hide[t] = 1; hidden++; } else dropped++;
  }
  const mask = {hide, hidden, total: hide.length, fraction: +(hidden / hide.length).toFixed(4), droppedNotCoveredInEveryPose: dropped,
    method: `${m0.method}; AND every outer-hull vertex covered (no poke-through, never exposed) in all ${poses.length} validation poses (lib/fit07.mjs)`};
  const hideWear = {};
  layers.forEach((L, li) => {
    const U = B.layerUV?.[L.id];
    if (!U) return;
    const m = coverMask({pos: U.pos, idx: U.idx}, {pos, idx}, {maxDist: 0.08, inset: 0.01, tiltDeg: 24, bodyJoints: U.joints, skipJoints: ['L_Foot', 'R_Foot']});
    const h = new Uint8Array(m.hide.length); let k = 0;
    for (let t = 0; t < h.length; t++) {
      if (!m.hide[t]) continue;
      let ok = true;
      for (let c = 0; c < 3; c++) { const wv = U.weldId[U.idx[t * 3 + c]]; if (L.eligible[wv] && (!final.lcs[li][wv] || final.ltrack[li].poke[wv] || final.ltrack[li].exposed[wv])) { ok = false; break; } }
      if (ok) { h[t] = 1; k++; }
    }
    hideWear[L.id] = {hide: h, hidden: k};
  });
  // ---- visible poke-through after the masks (the gate metric): a welded body vertex is visible if any
  // body triangle using it is not hidden; a lower-garment vertex if any of its triangles survives hideWear
  const visBody = new Uint8Array(ctx.n);
  for (let t = 0; t < hide.length; t++) if (!hide[t]) for (let c = 0; c < 3; c++) visBody[weldOf[B.low.idx[t * 3 + c]]] = 1;
  const visLayer = {};
  layers.forEach(L => {
    const U = B.layerUV?.[L.id], vis = new Uint8Array(L.pos.length / 3);
    if (!U) vis.fill(1);
    else { const h = hideWear[L.id]?.hide; for (let t = 0; t < U.idx.length / 3; t++) if (!h || !h[t]) for (let c = 0; c < 3; c++) vis[U.weldId[U.idx[t * 3 + c]]] = 1; }
    visLayer[L.id] = vis;
  });
  const visible = {};
  for (const pl of final.pokeLists) {
    const v = visible[pl.clip] ??= {poses: 0, covered: final.per[pl.clip]?.covered ?? 0, maxVisiblePoke: 0, layers: {}};
    v.poses++;
    v.maxVisiblePoke = Math.max(v.maxVisiblePoke, pl.body.reduce((a, i) => a + visBody[i], 0));
    layers.forEach((L, li) => { const q = v.layers[L.id] ??= {covered: final.lcs[li].reduce((a, x) => a + x, 0), maxVisiblePoke: 0}; q.maxVisiblePoke = Math.max(q.maxVisiblePoke, (pl.layers[L.id] ?? []).reduce((a, i) => a + visLayer[L.id][i], 0)); });
  }
  // ---- outputs (UV-split spread) + stats
  const nrmW = computeNormals(pos, idx);
  const low = gC.low, nu = low.weldId.length;
  const P = new Float32Array(nu * 3), Nn = new Float32Array(nu * 3), J = new Uint16Array(nu * 4), Ww = new Float32Array(nu * 4);
  for (let i = 0; i < nu; i++) {
    const s = low.weldId[i];
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[s * 3 + k]; Nn[i * 3 + k] = nrmW[s * 3 + k]; }
    for (let k = 0; k < 4; k++) { J[i * 4 + k] = Wt.joints[s * 4 + k]; Ww[i * 4 + k] = Wt.weights[s * 4 + k]; }
  }
  const q = (a, f) => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))].toFixed(4) : 0; };
  // bulk (hit volumes / ragdoll padding) re-measured on the refitted cloth: median cloth -> body distance
  // over torso- / arm- / leg-dominant cloth vertices
  const dist = closestDistances(pos, ctx.W);
  const groups = {torso: [], arm: [], leg: []};
  for (let i = 0; i < n; i++) { const j = JOINT_NAMES[Wt.joints[i * 4]]; if (['Spine', 'Chest', 'Hips'].includes(j)) groups.torso.push(dist[i]); else if (/UpperArm|Forearm/.test(j)) groups.arm.push(dist[i]); else if (/Thigh|Shin/.test(j)) groups.leg.push(dist[i]); }
  const med = a => { if (!a.length) return 0; a.sort((x, y) => x - y); return +a[a.length >> 1].toFixed(4); };
  const bulkM = kind === 'pants' ? {torso: 0, arm: 0, leg: med(groups.leg)} : {torso: med(groups.torso), arm: med(groups.arm)};
  // total displacement from the iteration-06 placement (ironing + skin field)
  const dl = Array.from({length: n}, (_, i) => Math.hypot(pos[i * 3] - orig[i * 3], pos[i * 3 + 1] - orig[i * 3 + 1], pos[i * 3 + 2] - orig[i * 3 + 2]));
  const stats = {
    ...v.stats,
    refit07: {method: 'region-restricted outer-hull anchors -> body weights at the anchor -> bind clearance (anchor + body/lower vertex driven) -> pose-validated extra clearance -> all-pose masks (lib/fit07.mjs)',
      params: o, ironedVertices: ironed, skirtVertices: Wt.skirtVertices, anchorFallbacks: A.fallback, outerHullBodyVertices: ctx.hull.reduce((a, x) => a + x, 0), anchorDistanceM: {p50: q(A.dist, 0.5), p95: q(A.dist, 0.95)},
      offsetM: {p50: q(dl, 0.5), p95: q(dl, 0.95), max: q(dl, 1), skinFieldBindMax: q(eBind, 1), skinFieldPoseExtraMax: q(eExtra, 1)},
      bindRounds: bindLog, poseRounds: poseLog, finalPerClip: final?.per ?? null, visiblePerClip: visible, validationPoses: poses.length, mask: {hidden, droppedNotCoveredInEveryPose: dropped},
      layers: layers.map((L, li) => ({id: L.id, hideWear: hideWear[L.id]?.hidden ?? 0, coveredOuterWallVertices: final.lcs[li].reduce((a, x) => a + x, 0)})), ms: Date.now() - t0},
    hiddenBodyTriangles: hidden, hiddenFraction: mask.fraction, bulkM, bulkMBeforeRefit: v.stats.bulkM,
  };
  return {...v, weldedPos: pos, weldedJoints: Wt.joints, weldedWeights: Wt.weights, pos: P, nrm: Nn, joints: J, weights: Ww, mask, hideWear, stats};
}
