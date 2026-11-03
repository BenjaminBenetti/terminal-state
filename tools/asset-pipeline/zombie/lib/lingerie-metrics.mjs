// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): fit metrics of a lingerie set on its body through ALL six clips.
// Used by build-lingerie.mjs (in memory) AND game/tests/zombie-lingerie-fit.test.ts (on the SHIPPED GLBs: CI-safe, no raw needed).
// Per validation pose (every `step` s of every clip of the body GLB + the last frame), CPU linear-blend skinning (glTF spec) of the
// body and both pieces, then per piece (welded cloth vertices):
//  - signed distance to the posed FIT surface (closed skin, torso + legs: lib/lingerie-body.mjs); the sign is the interpolated skin
//    normal at the closest point, a negative sign only kept when the point is inside the closed skin by ray parity;
//    penetration = sd < -2 mm (cloth sunk into the skin: hidden / "sinking straps"), deep = sd < -5 mm;
//    gap = sd percentiles; hover = farther than 15 mm from the skin AND from any other body surface (hair) on interior cloth vertices; free-edge hover = the same on
//    open-boundary vertices + one ring (lace scallops / cup tops / hems may lift like real lace: gated more loosely);
//    regions: 'upper' = top-piece cloth above the breast apex + 6 cm (straps, upper cup edges), 'legs' = bottom-piece cloth below the
//    crotch - 2 cm (suspender straps, thigh rings), 'core' = the rest;
//  - body poke-through (wardrobe iteration-07 definition, lib/penetration.mjs auditPose): fit-surface body vertices covered by the
//    set in the bind pose whose posed outward ray no longer meets the cloth while it lies UNDER the skin -> visible poke when the
//    vertex belongs to a body triangle that is not hidden; exposed-hidden = hidden-only vertices not covered in the pose
//    (see-through risk);
//  - coverage: body vertices of the breast apex zones (within 2 cm of each apex = nipple / areola, facing forward) and of the groin zone (front of the
//    pubis down to the crotch: a V, |x| < 1.5 cm at the crotch widening to 3 cm, up to 7 cm above it; >= 85 % in every frame, the
//    zone border being the cloth's own edge) and of its CORE (the front midline strip |x| < 1.2 cm: 100 % in every frame) whose posed outward ray meets the cloth within 5 cm.
import {TriGrid, prepareInner, bindCoverage, auditPose, insideByParity} from './penetration.mjs';
import {validationPoses} from './lingerie-body.mjs';
import {skinWith, posedWeldedNormals, clothGraph} from './lingerie-fit.mjs';

const mm = v => +(v * 1000).toFixed(2), r4 = v => +(+v).toFixed(4);
export const LIMITS = {
  // per piece, every validation frame of every clip (fractions of the piece's welded cloth vertices)
  penetration: 0.01, deep: 0.005, hover: 0.06, edgeHover: 0.12, minSdMM: -25,
  // body poke-through: visible poke vertices / covered body vertices; exposed hidden / hidden-only vertices
  // (a small hidden set: a handful of vertices is tolerated in absolute terms)
  pokeVisible: 0.01, pokeVisibleCount: 5, exposedHidden: 0.02, exposedHiddenCount: 3,
  // coverage minimum over every frame
  apexCoverage: 1.0, groinCoreCoverage: 1.0, groinCoverage: 0.85,
};

function quant(arr, q) { if (!arr.length) return 0; const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; }

/** Body zones (bind) for the coverage metric. */
export function coverageZones(B) {
  const L = B.landmarks, P = B.pos, N = B.nrm, n = P.length / 3;
  const fit = new Uint8Array(n); for (const v of B.fitIdx) fit[v] = 1;
  const apex = [], groin = [], groinCore = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const r = B.remap[i]; if (seen.has(r) || !fit[i] || B.hair[i]) continue; seen.add(r);
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    for (const s of ['L', 'R']) { const A = L.apex[s]; if (Math.hypot(x - A[0], y - A[1], z - A[2]) < 0.02 && N[i * 3 + 2] > 0.2) apex.push(i); }
    const c = L.crotch;
    // front of the pubis (facing forward) + the underside at the crotch (facing down); the inner-thigh crease walls of a body whose
    // thighs touch face sideways and are bridged by the gusset, not covered along their normal
    // a V: 1.5 cm half-width at the crotch widening to 3 cm on the mons (the genital area; the groin crease beside a thong's narrow
    // gusset is a leg opening, not the genitals)
    const hw = Math.min(0.03, 0.015 + 0.3 * Math.max(0, y - c[1]));
    if (Math.abs(x) < hw && y > c[1] - 0.005 && y < c[1] + 0.07 && z > c[2] - 0.02 && (N[i * 3 + 2] > 0.5 || (y < c[1] + 0.025 && N[i * 3 + 1] < -0.5))) groin.push(i);
    // the CORE (must be covered in every frame): the front midline strip |x| < 1.2 cm from 0.5 to 6 cm above the crotch
    if (Math.abs(x) < 0.012 && y > c[1] + 0.005 && y < c[1] + 0.06 && N[i * 3 + 2] > 0.5) groinCore.push(i);
  }
  // each zone vertex is tested along its REGION normal (mean skin normal within 3 cm): the direction it can be seen from; a crease
  // wall facing the midline is seen out of the crease, not across it
  const nb = new Map();
  for (const i of [...apex, ...groin, ...groinCore]) { if (nb.has(i)) continue; const ids = []; for (const j of seen) { if (Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]) < 0.03) ids.push(j); } nb.set(i, Uint32Array.from(ids)); }
  return {apex: Uint32Array.from(apex), groin: Uint32Array.from(groin), groinCore: Uint32Array.from(groinCore), nb};
}

/**
 * @param B loadBody()
 * @param pieces [{name: 'top' | 'bottom', pos (bind), idx, joints (u8 x4), weights (float x4), hide (Uint8Array nTris, body)}]
 * @param opts {step (s, default 0.1 = every 3rd frame at 30 fps), clips (subset), poses (precomputed)}
 */
export function measureSet(B, pieces, opts = {}) {
  const poses = opts.poses ?? validationPoses(B, {step: opts.step ?? 0.1, clips: opts.clips ?? null});
  const L = B.landmarks;
  const Gs = pieces.map(p => clothGraph(p));
  const region = pieces.map((p, k) => { const r = new Uint8Array(p.pos.length / 3); for (const i of Gs[k].uniq) { const y = p.pos[i * 3 + 1]; r[i] = p.name === 'top' && y > L.apexY + 0.06 ? 1 : p.name === 'bottom' && y < L.crotch[1] - 0.02 ? 2 : 0; } return r; });
  // free edges (open-boundary cloth vertices + one ring: lace scallops, cup tops, hems) may lift off the skin like real lace; their
  // hover is reported apart and gated more loosely
  const edge = pieces.map((p, k) => edgeMask(p, Gs[k]));
  // body: hidden union, eligible = fit-surface vertices
  const nT = B.nTris, hide = new Uint8Array(nT);
  for (const p of pieces) for (let t = 0; t < nT; t++) if (p.hide[t]) hide[t] = 1;
  // audited body: torso / leg skin of the fit surface (arm skin pressing on a side band in a pose is the body's own animation: the
  // inner arm meets the torso there too; reported by no metric here)
  const elig = new Uint8Array(B.pos.length / 3); for (const v of B.fitIdx) if (B.groups[v] !== 2) elig[v] = 1;
  const inner = prepareInner({pos: B.pos, idx: B.idx, nrm: B.nrm, joints: B.joints, weights: B.weights}, hide, elig);
  const cover = bindCoverage(inner, pieces.map(p => ({pos: p.pos, idx: p.idx})), {coverDist: 0.04, maxDepth: 0.04});
  let hiddenOnly = 0; for (const i of inner.uniq) if (inner.used[i] && !inner.visible[i]) hiddenOnly++;
  const zones = coverageZones(B);
  const perClip = {};
  for (const pose of poses) {
    const bp = skinWith(pose.mats, B.pos, B.joints, B.weights);
    const bn = posedWeldedNormals(B, bp);
    const fitG = new TriGrid(bp, B.fitIdx, 0.025), closed = new TriGrid(bp, B.skinIdx, 0.025), anyG = new TriGrid(bp, B.idx, 0.025);
    const cloth = pieces.map(p => ({pos: skinWith(pose.mats, p.pos, p.joints, p.weights), idx: p.idx}));
    const frame = {clip: pose.clip, t: pose.t, pieces: {}};
    pieces.forEach((p, k) => {
      const sd = [], reg = [[], [], []];
      let pen = 0, deep = 0, hover = 0, edgeHover = 0, minSd = Infinity;
      const nEdge = Gs[k].uniq.reduce((a, i) => a + edge[k][i], 0);
      const C = cloth[k].pos;
      for (const i of Gs[k].uniq) {
        const c = fitG.closest(C[i * 3], C[i * 3 + 1], C[i * 3 + 2], 0.08);
        let d = 0.08;
        if (c) {
          const I = B.fitIdx, a = I[c.tri * 3], b = I[c.tri * 3 + 1], e = I[c.tri * 3 + 2], q = c.q;
          const nx = q[3] * bn[a * 3] + q[4] * bn[b * 3] + q[5] * bn[e * 3], ny = q[3] * bn[a * 3 + 1] + q[4] * bn[b * 3 + 1] + q[5] * bn[e * 3 + 1], nz = q[3] * bn[a * 3 + 2] + q[4] * bn[b * 3 + 2] + q[5] * bn[e * 3 + 2];
          d = (C[i * 3] - q[0]) * nx + (C[i * 3 + 1] - q[1]) * ny + (C[i * 3 + 2] - q[2]) * nz < 0 ? -c.d : c.d;
          if (d < 0 && !insideByParity(closed, C[i * 3], C[i * 3 + 1], C[i * 3 + 2])) d = c.d;
        }
        sd.push(d); reg[region[k][i]].push(d);
        if (d < -0.002) pen++; if (d < -0.005) deep++; if (d < minSd) minSd = d;
        // hovering = more than 15 mm from ANY body surface (cloth resting on a hair lock is not floating)
        if (d > 0.015 && !anyG.closest(C[i * 3], C[i * 3 + 1], C[i * 3 + 2], 0.015)) { if (edge[k][i]) edgeHover++; else hover++; }
      }
      const nv = sd.length;
      const rs = ['core', 'upper', 'legs'].map((nm, ri) => [nm, reg[ri].length ? {n: reg[ri].length, penetration: r4(reg[ri].filter(v => v < -0.002).length / reg[ri].length), hover: r4(reg[ri].filter(v => v > 0.015).length / reg[ri].length), gapP95MM: mm(quant(reg[ri], 0.95))} : null]);
      frame.pieces[p.name] = {vertices: nv, edgeVertices: nEdge, penetration: r4(pen / nv), deep: r4(deep / nv), hover: r4(hover / Math.max(1, nv - nEdge)), edgeHover: r4(edgeHover / Math.max(1, nEdge)), minSdMM: mm(minSd), gapP50MM: mm(quant(sd, 0.5)), gapP95MM: mm(quant(sd, 0.95)), gapMaxMM: mm(Math.max(...sd)), regions: Object.fromEntries(rs.filter(([, v]) => v))};
    });
    // body poke-through
    const a = auditPose(inner, cover, {pos: bp, nrm: bn}, cloth, {outDist: 0.05, maxDepth: 0.04, outerInside: false, innerGrid: new TriGrid(bp, B.idx, 0.025)});
    frame.body = {covered: a.covered, pokeVisible: a.pokeVisible, pokeVisibleFraction: r4(a.pokeVisible / Math.max(1, a.covered)), exposedHidden: a.exposedHidden, exposedHiddenFraction: r4(a.exposedHidden / Math.max(1, hiddenOnly)), hiddenOnly};
    // coverage
    const og = new TriGrid(Float32Array.from(cloth.flatMap(c => [...c.pos])), mergeIdx(cloth), 0.025);
    const cov = ids => {
      let ok = 0;
      for (const i of ids) {
        let nx = 0, ny = 0, nz = 0; for (const j of zones.nb.get(i)) { nx += bn[j * 3]; ny += bn[j * 3 + 1]; nz += bn[j * 3 + 2]; }
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const x = bp[i * 3], y = bp[i * 3 + 1], z = bp[i * 3 + 2];
        if (og.ray(x - nx * 0.001, y - ny * 0.001, z - nz * 0.001, nx, ny, nz, 0.05)) ok++;
      }
      return ids.length ? r4(ok / ids.length) : 1;
    };
    frame.coverage = {apex: cov(zones.apex), groin: cov(zones.groin), groinCore: cov(zones.groinCore)};
    (perClip[pose.clip] ??= []).push(frame);
  }
  // per clip: the worst frame of each metric
  const summary = {};
  for (const [clip, frames] of Object.entries(perClip)) {
    const S = {frames: frames.length, pieces: {}};
    for (const p of pieces) {
      const f = frames.map(x => x.pieces[p.name]);
      S.pieces[p.name] = {penetration: Math.max(...f.map(x => x.penetration)), deep: Math.max(...f.map(x => x.deep)), hover: Math.max(...f.map(x => x.hover)), edgeHover: Math.max(...f.map(x => x.edgeHover)), minSdMM: Math.min(...f.map(x => x.minSdMM)), gapP50MM: +quant(f.map(x => x.gapP50MM), 0.5).toFixed(2), gapP95MM: Math.max(...f.map(x => x.gapP95MM)), gapMaxMM: Math.max(...f.map(x => x.gapMaxMM)),
        regions: Object.fromEntries(Object.keys(f[0].regions).map(r => [r, {penetration: Math.max(...f.map(x => x.regions[r].penetration)), hover: Math.max(...f.map(x => x.regions[r].hover)), gapP95MM: Math.max(...f.map(x => x.regions[r].gapP95MM))}]))};
    }
    S.body = {pokeVisibleFraction: Math.max(...frames.map(x => x.body.pokeVisibleFraction)), pokeVisible: Math.max(...frames.map(x => x.body.pokeVisible)), exposedHiddenFraction: Math.max(...frames.map(x => x.body.exposedHiddenFraction)), exposedHidden: Math.max(...frames.map(x => x.body.exposedHidden)), covered: frames[0].body.covered, hiddenOnly};
    S.coverage = {apex: Math.min(...frames.map(x => x.coverage.apex)), groin: Math.min(...frames.map(x => x.coverage.groin)), groinCore: Math.min(...frames.map(x => x.coverage.groinCore))};
    summary[clip] = S;
  }
  return {poses: poses.length, zones: {apex: zones.apex.length, groin: zones.groin.length, groinCore: zones.groinCore.length}, summary, perClip};
}


/** Free-edge vertices of a piece: welded vertices on an open-boundary edge + one ring. */
export function edgeMask(p, G) {
  const E = new Map();
  for (let t = 0; t < p.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = G.remap[p.idx[t + k]], b = G.remap[p.idx[t + (k + 1) % 3]]; if (a === b) continue; const key = a < b ? a * 4294967296 + b : b * 4294967296 + a; E.set(key, (E.get(key) ?? 0) + 1); }
  const m = new Uint8Array(p.pos.length / 3);
  for (const [key, c] of E) if (c === 1) { m[Math.floor(key / 4294967296)] = 1; m[key % 4294967296] = 1; }
  const ring = m.slice();
  for (const i of G.uniq) if (m[i]) for (const j of G.nb.get(i)) ring[j] = 1;
  return ring;
}

/** Bind-pose coverage of a zone by cloth meshes (same rays as measureSet): {fraction, uncovered: [vertex ids]}. */
export function bindZoneCoverage(B, ids, nb, cloth) {
  const og = new TriGrid(Float32Array.from(cloth.flatMap(c => [...c.pos])), mergeIdx(cloth), 0.025);
  const P = B.pos, N = B.nrm, un = [];
  for (const i of ids) {
    let nx = 0, ny = 0, nz = 0; for (const j of nb.get(i)) { nx += N[j * 3]; ny += N[j * 3 + 1]; nz += N[j * 3 + 2]; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (!og.ray(P[i * 3] - nx * 0.001, P[i * 3 + 1] - ny * 0.001, P[i * 3 + 2] - nz * 0.001, nx, ny, nz, 0.05)) un.push(i);
  }
  return {fraction: ids.length ? 1 - un.length / ids.length : 1, uncovered: un};
}

function mergeIdx(list) { const out = []; let base = 0; for (const m of list) { for (const v of m.idx) out.push(v + base); base += m.pos.length / 3; } return Uint32Array.from(out); }

/** Limit check of a measureSet summary: list of failures (empty = pass). */
export function checkLimits(summary, lim = LIMITS) {
  const fail = [];
  for (const [clip, S] of Object.entries(summary)) {
    for (const [pn, P] of Object.entries(S.pieces)) {
      if (P.penetration > lim.penetration) fail.push(`${clip} ${pn}: penetration ${P.penetration} > ${lim.penetration}`);
      if (P.deep > lim.deep) fail.push(`${clip} ${pn}: deep ${P.deep} > ${lim.deep}`);
      if (P.hover > lim.hover) fail.push(`${clip} ${pn}: hover ${P.hover} > ${lim.hover}`);
      if (P.edgeHover > lim.edgeHover) fail.push(`${clip} ${pn}: free-edge hover ${P.edgeHover} > ${lim.edgeHover}`);
      if (P.minSdMM < lim.minSdMM) fail.push(`${clip} ${pn}: min sd ${P.minSdMM} mm < ${lim.minSdMM}`);
    }
    if (S.body.pokeVisibleFraction > lim.pokeVisible && S.body.pokeVisible > lim.pokeVisibleCount) fail.push(`${clip}: visible body poke ${S.body.pokeVisible} vertices (${S.body.pokeVisibleFraction}) > ${lim.pokeVisible}`);
    if (S.body.exposedHiddenFraction > lim.exposedHidden && S.body.exposedHidden > lim.exposedHiddenCount) fail.push(`${clip}: exposed hidden ${S.body.exposedHidden} vertices (${S.body.exposedHiddenFraction}) > ${lim.exposedHidden}`);
    if (S.coverage.apex < lim.apexCoverage) fail.push(`${clip}: apex coverage ${S.coverage.apex} < ${lim.apexCoverage}`);
    if (S.coverage.groin < lim.groinCoverage) fail.push(`${clip}: groin coverage ${S.coverage.groin} < ${lim.groinCoverage}`);
    if (S.coverage.groinCore < lim.groinCoreCoverage) fail.push(`${clip}: groin core coverage ${S.coverage.groinCore} < ${lim.groinCoreCoverage}`);
  }
  return fail;
}

/**
 * The two pieces of a SHIPPED outfit-lingerie-<design>.glb for one body, ready for measureSet: bind POSITION, indices, JOINTS_0 /
 * WEIGHTS_0 (u8 normalised -> float), the body hide bitset (node extras hideBodyTriangles). The variant's skin joints must be the
 * body's 18 joints in the same order (prefixed copy), which is asserted.
 */
export async function loadShippedFit(file, bodyId, bodyNames) {
  const {NodeIO} = await import('@gltf-transform/core');
  const {ALL_EXTENSIONS} = await import('@gltf-transform/extensions');
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const m = /^Outfit_(lingerie-[a-z]+-(top|bottom))__(.+)$/.exec(node.getName());
    if (!m || m[3] !== bodyId) continue;
    const skin = node.getSkin(), names = skin.listJoints().map(j => j.getName().slice(bodyId.length + 1));
    if (names.join() !== bodyNames.join()) throw new Error(`${node.getName()}: skin joints differ from the body's`);
    const prim = node.getMesh().listPrimitives()[0], ex = node.getExtras();
    const W = prim.getAttribute('WEIGHTS_0');
    const bits = Buffer.from(ex.hideBodyTriangles, 'base64'), hide = new Uint8Array(ex.bodyTriangles);
    for (let t = 0; t < hide.length; t++) hide[t] = (bits[t >> 3] >> (t & 7)) & 1;
    out.push({name: m[2], wearable: m[1], node: node.getName(), extras: ex, pos: Float32Array.from(prim.getAttribute('POSITION').getArray()), idx: Uint32Array.from(prim.getIndices().getArray()),
      joints: Uint8Array.from(prim.getAttribute('JOINTS_0').getArray()), weights: Float32Array.from(W.getArray(), v => W.getNormalized() ? v / 255 : v), hide});
  }
  return out.sort((a, b) => (a.name === 'top' ? 0 : 1) - (b.name === 'top' ? 0 : 1));
}
