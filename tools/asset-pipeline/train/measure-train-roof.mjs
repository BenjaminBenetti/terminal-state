#!/usr/bin/env node
// Task studio-train-crafting-v1-20261111-225628-01: MEASURES the player train's ROOF on the cooked shell
// (game/public/assets/models/player-train-shell.glb, train-local metres) and writes game/src/assets/trainRoof.generated.ts — the outline
// the sentry's roof turret may shoot over (craft/trainFixtures.ts roofTopAtPoint; craft/sentry.ts own-hull rule) and the hatch it stands
// on. Measurement only: the shell model is read, never changed; no generation service, deterministic (re-running reproduces the file).
//
// The roof is described ACROSS the car in bands of |z| (STEP wide, both sides together), per stretch ALONG it:
//   body   |x| <= END_X, outside the hatch boxes;
//   ends   the whole length outside the hatch boxes (the rounded end caps sit a little higher: never lower than `body`);
//   hatch  the three low ventilation hatches on the centre line, each its own outline inside its plan box (x0..x1, |z| <= HATCH_Z).
// A band's value = the HIGHEST roof point at or beyond that |z| (so every outline only falls toward the car's side), found EXACTLY: each
// roof triangle is clipped to the band's plan rectangle and the highest clipped corner counts. Values are rounded UP to the millimetre
// plus PAD. tests/train-roof-profile.test.ts re-samples the shell independently and requires the outline to cover every roof point.
//
// usage: node tools/asset-pipeline/train/measure-train-roof.mjs [--check]     (--check: compare with the committed file, write nothing)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHELL = 'game/public/assets/models/player-train-shell.glb';
const OUT = 'game/src/assets/trainRoof.generated.ts';

const STEP = 0.02; // band width across the car (m)
const BANDS = 76; // |z| 0 .. 1.52 (the shell's half width is 1.494)
const END_X = 6.9; // |x| beyond which the rounded end caps begin
const HATCH_Z = 0.6; // a hatch's plan box reaches this far from the centre line (their domes end at |z| 0.38 .. 0.48)
const HATCH_RISE = 0.07; // a hatch = roof this far above the skin's centre-line height beside it
const HATCH_PAD_X = 0.04; // its plan box is this much longer than the measured dome, each way
const ROOF_MIN_Y = 2.9; // only triangles reaching above this are roof (the interior ceiling is at 3.25: the highest point still wins)
const PAD = 0.002; // added to every rounded-up value (m)
const BASE_R = 0.215; // the turret base ring's plan radius (assets/trainEquipment.generated.ts TRAIN_TURRET_MEASURED.baseRadius)

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(REPO, SHELL));
/** Roof triangles as flat [ax, ay, az, bx, by, bz, cx, cy, cz]. */
const TRIS = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const M = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const P = [], v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      P.push([M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]);
    }
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i + 2 < n; i += 3) {
      const a = P[idx ? idx.getScalar(i) : i], b = P[idx ? idx.getScalar(i + 1) : i + 1], c = P[idx ? idx.getScalar(i + 2) : i + 2];
      if (Math.max(a[1], b[1], c[1]) < ROOF_MIN_Y) continue;
      TRIS.push([...a, ...b, ...c]);
    }
  }
}

/** Sutherland-Hodgman: polygon (array of [x, y, z]) clipped to the half space s * (p[axis] - at) >= 0. */
function clip(poly, axis, at, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = s * (p[axis] - at), dq = s * (q[axis] - at);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
  }
  return out;
}

/** The highest roof point over the plan rectangle x0..x1, z0..z1 (-Infinity: no roof there). Exact (a plane's maximum over a clipped polygon is at a corner). */
function topOver(x0, x1, z0, z1) {
  let top = -Infinity;
  for (const t of TRIS) {
    if (Math.max(t[0], t[3], t[6]) < x0 || Math.min(t[0], t[3], t[6]) > x1 || Math.max(t[2], t[5], t[8]) < z0 || Math.min(t[2], t[5], t[8]) > z1) continue;
    if (Math.max(t[1], t[4], t[7]) <= top) continue;
    let poly = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]];
    poly = clip(poly, 0, x0, 1); if (poly.length < 3) continue;
    poly = clip(poly, 0, x1, -1); if (poly.length < 3) continue;
    poly = clip(poly, 2, z0, 1); if (poly.length < 3) continue;
    poly = clip(poly, 2, z1, -1); if (poly.length < 3) continue;
    for (const p of poly) if (p[1] > top) top = p[1];
  }
  return top;
}
/** Both sides of the centre line: |z| in a..b. */
const topBand = (x0, x1, a, b) => Math.max(topOver(x0, x1, a, b), topOver(x0, x1, -b, -a));

// ---- the roof's extent and the hatches (the centre strip's height along the car, 2 cm slices)
let X0 = Infinity, X1 = -Infinity;
for (const t of TRIS) for (const k of [0, 3, 6]) if (t[k + 1] > 3.4) { X0 = Math.min(X0, t[k]); X1 = Math.max(X1, t[k]); }
const SLICE = 0.02, slices = [];
for (let x = Math.floor(X0 / SLICE) * SLICE; x < X1; x += SLICE) slices.push([x, topOver(x, x + SLICE, -0.1, 0.1)]);
const sorted = slices.map(s => s[1]).filter(Number.isFinite).sort((a, b) => a - b);
const skinY = sorted[Math.floor(sorted.length / 2)]; // the median centre-line height = the skin between the hatches
const hatches = [];
for (let i = 0; i < slices.length; i++) {
  if (!(slices[i][1] > skinY + HATCH_RISE)) continue;
  let j = i;
  while (j + 1 < slices.length && slices[j + 1][1] > skinY + HATCH_RISE) j++;
  hatches.push({x0: slices[i][0] - HATCH_PAD_X, x1: slices[j][0] + SLICE + HATCH_PAD_X});
  i = j;
}
if (hatches.length !== 3) throw new Error(`expected the shell's three roof hatches, found ${hatches.length}`);
const r3 = v => Math.round(v * 1000) / 1000, up = v => (Number.isFinite(v) ? Math.ceil(v * 1000 - 1e-6) / 1000 + PAD : v);
for (const h of hatches) { h.x0 = r3(h.x0); h.x1 = r3(h.x1); }

// ---- the outlines
const HB = Math.round(HATCH_Z / STEP); // bands inside a hatch box
/** x stretches of |x| <= END_X outside the hatch boxes (for the bands a hatch box covers). */
const between = [];
{
  let a = -END_X;
  for (const h of hatches) { between.push([a, h.x0]); a = h.x1; }
  between.push([a, END_X]);
}
const body = [], ends = [], hatchTop = hatches.map(() => []);
for (let k = 0; k < BANDS; k++) {
  const a = k * STEP, b = a + STEP;
  body.push(k < HB ? Math.max(...between.map(([x0, x1]) => topBand(x0, x1, a, b))) : topBand(-END_X, END_X, a, b));
  // the end caps: beyond END_X, both ends (no hatch reaches there)
  ends.push(Math.max(topBand(-1e3, -END_X, a, b), topBand(END_X, 1e3, a, b)));
  if (k < HB) hatches.forEach((h, i) => hatchTop[i].push(topBand(h.x0, h.x1, a, b)));
}
// "at or beyond": every outline only falls toward the car's side
const fall = T => { for (let k = T.length - 2; k >= 0; k--) T[k] = Math.max(T[k], T[k + 1]); return T; };
fall(body); fall(ends);
for (let k = 0; k < BANDS; k++) ends[k] = Math.max(ends[k], body[k]);
hatchTop.forEach(T => { T[HB - 1] = Math.max(T[HB - 1], body[HB - 1]); fall(T); for (let k = 0; k < HB; k++) T[k] = Math.max(T[k], body[k]); });

// ---- the turret's seat: the MIDDLE hatch's flat top (the base ring's disc about its plan centre)
const mid = hatches[1], seatX = r3((mid.x0 + mid.x1) / 2);
let seatLo = Infinity, seatHi = -Infinity;
for (let dx = -BASE_R; dx <= BASE_R + 1e-9; dx += 0.01) for (let dz = -BASE_R; dz <= BASE_R + 1e-9; dz += 0.01) {
  if (dx * dx + dz * dz > BASE_R * BASE_R) continue;
  const y = topOver(seatX + dx - 0.005, seatX + dx + 0.005, dz - 0.005, dz + 0.005);
  if (Number.isFinite(y)) { seatLo = Math.min(seatLo, y); seatHi = Math.max(seatHi, y); }
}

const list = T => T.map(v => up(v).toFixed(3)).join(', ');
const text = `// GENERATED by tools/asset-pipeline/train/measure-train-roof.mjs — do not edit (task studio-train-crafting-v1-20261111-225628-01).
// The player train's ROOF as measured on the cooked shell (assets/models/player-train-shell.glb; train-local metres, y above the rail
// top): what the sentry's roof turret may shoot over (craft/trainFixtures.ts roofTopAtPoint) and the hatch it stands on.
// Across the car the roof is given in bands of |z| \`step\` wide (band k = |z| in k * step .. (k + 1) * step, both sides): the HIGHEST roof
// point at or beyond that band (exact on the triangles, rounded up to the mm + ${PAD * 1000} mm), so every outline only falls toward the car's side.
//  - body: |x| <= endX, outside the hatch boxes;  ends: the whole car length outside the hatch boxes (never lower than body);
//  - hatches: the three low ventilation hatches on the centre line — plan box x0..x1, |z| <= hatchZ — each with its own outline \`top\`
//    over the bands inside its box (never lower than body).
// tests/train-roof-profile.test.ts re-samples the shell and requires these outlines to cover every roof point.
export const TRAIN_ROOF_MEASURED = {
  step: ${STEP},
  endX: ${END_X},
  hatchZ: ${HATCH_Z},
  /** The roof's extent along the car (the skin above 3.4 m). */
  x0: ${r3(X0)}, x1: ${r3(X1)},
  /** The skin's height on the centre line between the hatches (the median over the car's length). */
  skinY: ${r3(skinY)},
  body: [${list(body)}],
  ends: [${list(ends)}],
  hatches: [
${hatches.map((h, i) => `    {x0: ${h.x0}, x1: ${h.x1}, top: [${list(hatchTop[i])}]},`).join('\n')}
  ],
  /**
   * The roof turret's seat: the middle hatch's top. x = the hatch's plan centre; lo / hi = the lowest / highest roof point under the
   * turret's base ring (a disc of radius ${BASE_R} m about (x, 0)).
   */
  seat: {x: ${seatX}, lo: ${r3(seatLo)}, hi: ${r3(seatHi)}},
} as const;
`;
const outFile = path.join(REPO, OUT);
if (process.argv.includes('--check')) {
  const same = fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8') === text;
  console.log(same ? `${OUT}: up to date` : `${OUT}: DIFFERS from a fresh measurement`);
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(outFile, text);
console.log(`wrote ${OUT}: ${TRIS.length} roof triangles, skin ${r3(skinY)} m, hatches ${hatches.map(h => `${h.x0}..${h.x1}`).join(' | ')}, seat x ${seatX} y ${r3(seatLo)}..${r3(seatHi)}`);
