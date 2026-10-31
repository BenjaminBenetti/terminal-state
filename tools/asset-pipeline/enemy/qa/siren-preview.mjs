#!/usr/bin/env node
// Task studio-siren-clothing-refit-20261031-01 (lane PREVIEW): human-review renders of a Siren GLB (baseline or refit candidate)
// with the asset's ACTUAL skinning and ACTUAL clips. Deterministic CPU software rasteriser (../lib/preview-raster.mjs) — not a GPU /
// WebGPU / browser render and not a captured game frame. No browser, no network, no provider, no new dependency (sharp encodes).
//
// usage:
//   node --max-old-space-size=3500 tools/asset-pipeline/enemy/qa/siren-preview.mjs --glb <siren.glb> --out <dir>
//        [--role candidate|baseline] [--baseline <baseline.glb>] [--only static,pairs,scale,light,clips,motion,worst]
//        [--meta <dir>] [--ss 2] [--zombie lastshift] [--worst clip:t[:region]] [--quick]
//   (run heavy batches under: flock /tmp/siren-heavy.lock)
// Sets (file names are relative to --out; a JSON meta record per set goes to --meta, default <out>/../evidence/PREVIEW/meta):
//   static  <role>-front / -back / -wearer-left / -wearer-right (orthographic) / -three-quarter (perspective) .jpg,
//           fit-chest-strap / fit-shoulder-underarm-right / fit-underarm-flank-left / fit-waist / fit-hip .jpg (pose: Stand)
//   pairs   pair-front / pair-three-quarter / pair-strap-waist .jpg (baseline | candidate, identical cameras)    [needs --baseline]
//   scale   <role>-beside-zombie.jpg (actual zombie-body-<id>-t25.glb, Idle t = 0, runtime root scale 1.00)
//   light   <role>-gameplay-light-gamefov.jpg / -close.jpg (standalone CPU approximation of the game's flashlight look)
//   clips   clips-<Clip>.jpg (per clip: samples x 2 body-relative views) + clips-overview.jpg
//   motion  motion/<Clip>/f###.webp (stepper frames, still WebP) + motion-<Clip>.webp (animated WebP, loops)
//   worst   worst-frame.jpg (a clip time + region reported by lane FIT: --worst Run:0.3:right-underarm)
// Body-relative orientation comes from the body geometry (../lib/preview-anatomy.mjs), never from screen sides or node names.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {loadGlb, poseAll, samplePose, worldMatrices} from '../lib/preview-gltf.mjs';
import {makeCamera, orbit, prepareMaterial, render, compose, encode, flatten, svgText, GAMEPLAY_LIGHT} from '../lib/preview-raster.mjs';
import {computeAnatomy, coverageProbe, axisName} from '../lib/preview-anatomy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BACKEND = 'CPU software rasteriser (tools/asset-pipeline/enemy/lib/preview-raster.mjs), deterministic, supersampled 2x2 + lanczos3; NOT a GPU / WebGPU / browser render, NOT a captured game frame';
const STUDIO = 'studio light: neutral grey background, light-grey ground plane y = 0 with a 0.5 m grid, 3 fixed camera-relative lights + ambient, base-colour texture only (no normal map), double-sided, no cast shadows (soft contact shading on the floor only)';
const BELOW = 'magenta tint = geometry below the floor (y < 0), drawn THROUGH a translucent floor (disclosed, not hidden)';
const BELOW_SHORT = 'magenta = below floor (shown, not hidden)';
export const CLIPS = ['Dormant', 'Rise', 'Run', 'Attack', 'Hit', 'Death'];
const STAND = {clip: 'Rise', t: null, label: 'Stand pose = Rise clip final frame (the game holds it as the standing / Idle pose)'};

// ------------------------------------------------------------------------------------------------------------------- args
function parseArgs(argv) {
  const a = {only: null, ss: 2, zombie: 'lastshift', role: 'candidate'};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--glb') a.glb = v(); else if (k === '--out') a.out = v(); else if (k === '--role') a.role = v();
    else if (k === '--baseline') a.baseline = v(); else if (k === '--only') a.only = new Set(v().split(','));
    else if (k === '--meta') a.meta = v(); else if (k === '--ss') a.ss = +v(); else if (k === '--zombie') a.zombie = v();
    else if (k === '--worst') a.worst = v(); else if (k === '--quick') a.quick = true; else if (k === '--clips') a.clips = v().split(','); else if (k === '--worst-point') a.worstPoints = v().split(';').map(q => { const f = q.split(','); return {p: f.slice(0, 3).map(Number), label: f.slice(3).join(',') || 'worst region'}; });
    else throw new Error('unknown argument ' + k);
  }
  if (!a.glb || !a.out) throw new Error('usage: --glb <siren.glb> --out <dir> [--role candidate|baseline] [--baseline <glb>] [--only sets]');
  a.meta ??= path.join(path.dirname(path.resolve(a.out)), 'evidence', 'PREVIEW', 'meta');
  return a;
}
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rel = f => path.relative(ROOT, path.resolve(f));
const r3 = v => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------------------------------------------------------- siren model
export async function loadSiren(file, label) {
  const asset = await loadGlb(file);
  const mats = await Promise.all(asset.prims.map(p => prepareMaterial(p.material)));
  const anat = computeAnatomy(asset);
  const nodeIndex = Object.fromEntries(asset.nodes.map((n, i) => [n.name, i]));
  return {file, label, sha256: sha256(file), bytes: fs.statSync(file).size, asset, mats, anat, nodeIndex,
    prims: asset.prims.map(p => ({name: p.name, role: p.role, vertices: p.vertexCount, triangles: p.triangleCount, joints: p.skinJoints?.length ?? 0, material: p.material?.name ?? ''})),
    clips: Object.fromEntries(Object.entries(asset.clips).map(([k, c]) => [k, r3(c.duration)]))};
}
/** Posed draws + helpers for one Siren at (clip, t). */
export function pose(S, clip, t) {
  const tt = clip && t == null ? S.asset.clips[clip].duration : t;
  const posed = poseAll(S.asset, clip, tt);
  const W = worldMatrices(S.asset, samplePose(S.asset, clip, tt));
  const joint = name => { const i = S.nodeIndex[name]; return i == null ? null : [W[i][12], W[i][13], W[i][14]]; };
  const draws = posed.map((p, i) => ({pos: p.pos, nrm: p.nrm, uv: p.prim.uv, idx: p.prim.idx, mat: S.mats[i], role: p.prim.role}));
  const body = posed[S.anat.bodyPrim];
  const apex = side => { const v = S.anat.apex[side].vertex; return [body.pos[v * 3], body.pos[v * 3 + 1], body.pos[v * 3 + 2]]; };
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], dressMinY = Infinity, bodyMinY = Infinity;
  for (const p of posed) for (let i = 0; i < p.pos.length; i += 3) for (let c = 0; c < 3; c++) {
    const v = p.pos[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v;
    if (c === 1) { if (p.prim.role === 'dress') dressMinY = Math.min(dressMinY, v); else bodyMinY = Math.min(bodyMinY, v); }
  }
  return {clip, t: tt, posed, draws, joint, apex, bounds: {min, max}, dressMinY, bodyMinY};
}

// ------------------------------------------------------------------------------------------------------------------- cameras
function bodyCam(S, {azDeg, elDeg = 0, target, type = 'ortho', height, fovDeg, dist, w, h}) {
  const o = orbit({front: S.anat.front, left: S.anat.left, target, azDeg, elDeg, dist: dist ?? (type === 'ortho' ? 8 : 4.4)});
  return makeCamera({type, ...o, height, fovDeg, w, h});
}
const VIEW_NAMES = {0: 'FRONT', 180: 'BACK', 90: "WEARER'S LEFT side", [-90]: "WEARER'S RIGHT side"};
/** Orientation strip lines from the actual camera axes (body-relative, computed — never assumed). */
function orientation(S, cam) {
  const sL = S.anat.left[0] * cam.r[0] + S.anat.left[2] * cam.r[2], sF = S.anat.front[0] * cam.r[0] + S.anat.front[2] * cam.r[2];
  const parts = [];
  if (Math.abs(sL) > 0.3) parts.push(sL > 0 ? "◀ wearer's RIGHT · LEFT ▶" : "◀ wearer's LEFT · RIGHT ▶");
  if (Math.abs(sF) > 0.3) parts.push(sF > 0 ? '◀ her BACK · FRONT ▶' : '◀ her FRONT · BACK ▶');
  return parts;
}
function orientSvg(lines, w) {
  if (!lines.length) return '';
  return `<rect x="0" y="0" width="${w}" height="${6 + 16 * lines.length}" fill="#000" fill-opacity="0.5"/>` + lines.map((l, i) => svgText(8, 16 + 16 * i, l, {size: 12, weight: 'bold', fill: '#ffe9a8'})).join('');
}
/** Anatomy tags facing the camera: breast apexes on front-ish views, shoulders on rear views; only sides not facing away. */
function apexTags(S, P, cam) {
  const tc = p => { if (!cam.persp) return cam.f.map(v => -v); const d = cam.eye.map((v, i) => v - p[i]); const l = Math.hypot(...d); return d.map(v => v / l); };
  const tags = [];
  for (const side of ['right', 'left']) {
    const sv = side === 'right' ? S.anat.right : S.anat.left;
    const ap = P.apex(side), t = tc(ap);
    const facing = S.anat.front[0] * t[0] + S.anat.front[2] * t[2], sideFacing = sv[0] * t[0] + sv[2] * t[2];
    const col = side === 'right' ? '#5fd7ff' : '#ffb35c', name = side === 'right' ? 'RIGHT' : 'LEFT';
    if (sideFacing < -0.75) continue;
    if (facing > 0.2 || (sideFacing > 0.5 && facing > -0.3)) tags.push({world: ap, text: `wearer's ${name} breast`, color: col});
    else if (facing < -0.2) { const sh = P.joint(side === 'right' ? 'R_UpperArm' : 'L_UpperArm'); if (sh) tags.push({world: [sh[0], sh[1] + 0.06, sh[2]], text: `wearer's ${name} shoulder`, color: col}); }
  }
  if (tags.length === 2) { tags[0].dy = -11; tags[1].dy = 11; }
  return tags;
}
function projLabel(cam, short = false) {
  const d = r3(Math.hypot(...cam.eye.map((v, i) => v - cam.target[i])));
  if (short) return cam.persp ? `perspective ${cam.fovDeg}°, ${d} m` : `orthographic, ${r3(cam.height)} m tall window`;
  return cam.persp ? `perspective, vertical FOV ${cam.fovDeg}°, camera ${d} m from target` : `orthographic, ${r3(cam.height)} m image height`;
}

// ------------------------------------------------------------------------------------------------------------------- meta
class Meta {
  constructor(a, S) { this.a = a; this.S = S; this.items = []; }
  add(item) { this.items.push({backend: BACKEND, role: this.a.role, asset: rel(this.S.file), assetSha256: this.S.sha256, ...item}); }
  write(set) {
    fs.mkdirSync(this.a.meta, {recursive: true});
    const f = path.join(this.a.meta, `${this.a.role}-${set}.json`);
    fs.writeFileSync(f, JSON.stringify({set, role: this.a.role, asset: rel(this.S.file), assetSha256: this.S.sha256, anatomy: anatSummary(this.S), generatedBy: 'tools/asset-pipeline/enemy/qa/siren-preview.mjs', items: this.items}, null, 1));
    this.items = [];
    return f;
  }
}
const anatSummary = S => ({statement: S.anat.statement, cues: S.anat.cues, heightBindM: r3(S.anat.heightM), apexBind: {left: S.anat.apex.left.bind.map(r3), right: S.anat.apex.right.bind.map(r3)}});

async function save(sheet, out, file, meta, info) {
  const r = await encode(sheet, path.join(out, file), {quality: info.quality ?? 86});
  meta.add({file, mime: file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg', bytes: r.bytes, width: r.width, height: r.height, ...info, quality: undefined});
  console.log(`  ${file}  ${r.width}x${r.height}  ${(r.bytes / 1024).toFixed(0)} KB`);
  return r;
}

// ------------------------------------------------------------------------------------------------------------------- static set
const FULL = {w: 720, h: 960};
function cardinalCam(S, az, P) {
  const cy = (Math.max(0, P.bounds.min[1]) + P.bounds.max[1]) / 2 - 0.02;
  return bodyCam(S, {azDeg: az, target: [0, cy, 0], height: Math.max(1.9, P.bounds.max[1] + 0.25), ...FULL});
}
function threeQuarterCam(S, P, az = -35, w = FULL.w, h = FULL.h) {
  const cy = P.bounds.max[1] * 0.5;
  return bodyCam(S, {type: 'persp', azDeg: az, elDeg: 10, target: [0, cy, 0], fovDeg: 26, dist: 4.4 * Math.max(1, (P.bounds.max[1] + 0.2) / 1.9), w, h});
}

/** Close-up crop definitions at a posed frame (centres from the posed apexes / joints: framing aids only). */
function crops(S, P, Pb) {
  const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  const chest = mid(P.apex('left'), P.apex('right')), chestB = mid(Pb.apex('left'), Pb.apex('right'));
  const hips = P.joint('Hips') ?? [0, P.bounds.max[1] * 0.5, 0], spine = P.joint('Spine') ?? hips;
  const rSh = P.joint('R_UpperArm') ?? chest, lSh = P.joint('L_UpperArm') ?? chest;
  const waist = mid(spine, hips);
  const sz = {w: 384, h: 480};
  const C = (az, target, height, extra = {}) => ({cam: bodyCam(S, {azDeg: az, target, height, ...sz, ...extra}), az});
  const P3 = (az, target, dist = 1.5, fov = 22, el = 8) => ({cam: bodyCam(S, {type: 'persp', azDeg: az, elDeg: el, target, dist, fovDeg: fov, ...sz}), az});
  return {
    chest: {file: 'fit-chest-strap.jpg', title: 'Chest / coverage edge + strap', panels: [
      {...C(0, [chest[0], chest[1] + 0.06, chest[2]], 0.56), title: 'FRONT (orthographic) — chest'},
      {...P3(-35, [chestB[0] - 0.03, chestB[1] + 0.05, chestB[2]], 1.6, 22), bind: true, title: 'BIND / T-pose, front-right 3/4 (persp., az −35°)'}]},
    shoulderR: {file: 'fit-shoulder-underarm-right.jpg', title: "Wearer's RIGHT shoulder / underarm (strap side)", panels: [
      {...C(-90, [rSh[0], rSh[1] - 0.12, rSh[2]], 0.6), title: "WEARER'S RIGHT side (orthographic)"},
      {...P3(-140, [rSh[0], rSh[1] - 0.1, rSh[2]], 1.7, 24), title: 'back-right three-quarter (perspective, az −140°)'}]},
    flankL: {file: 'fit-underarm-flank-left.jpg', title: "Wearer's LEFT underarm / flank (intentionally exposed side)", panels: [
      {...C(90, [lSh[0], lSh[1] - 0.18, lSh[2]], 0.66), title: "WEARER'S LEFT side (orthographic)"},
      {...P3(140, [lSh[0], lSh[1] - 0.15, lSh[2]], 1.7, 24), title: 'back-left three-quarter (perspective, az +140°)'}]},
    waist: {file: 'fit-waist.jpg', title: 'Waist (front + back)', panels: [
      {...C(0, [0, waist[1], waist[2]], 0.5), title: 'FRONT (orthographic) — waist', noTags: true},
      {...C(180, [0, waist[1], waist[2]], 0.5), title: 'BACK (orthographic) — waist', noTags: true}]},
    hip: {file: 'fit-hip.jpg', title: 'Hip (both sides)', panels: [
      {...C(-90, [hips[0], hips[1] - 0.04, hips[2]], 0.56), title: "WEARER'S RIGHT side (orthographic) — hip", noTags: true},
      {...C(90, [hips[0], hips[1] - 0.04, hips[2]], 0.56), title: "WEARER'S LEFT side (orthographic) — hip", noTags: true}]},
  };
}

async function renderPanel(S, P, cam, {title, lines = [], tags = true, mode = 'studio', ss, extraDraws = [], floor}) {
  const img = await render([...P.draws, ...extraDraws], cam, {ss, mode, floor});
  return {img, title, lines, tags: tags ? apexTags(S, P, cam) : [], overlaySvg: orientSvg(orientation(S, cam), img.w)};
}

async function staticSet(a, S, meta) {
  const P = pose(S, STAND.clip, STAND.t);
  const poseLine = `pose: Stand = ${STAND.clip} @ ${r3(P.t)} s (final frame, held by the game as standing / Idle)`;
  const cov = coverageProbe(S.anat, P.posed);
  const covLine = `coverage probe (geometric sanity check): RIGHT apex ${pct(cov.right.fraction)} · LEFT apex ${pct(cov.left.fraction)} of rays hit dress ≤ 12 cm`;
  for (const [az, file] of [[0, 'front'], [180, 'back'], [90, 'wearer-left'], [-90, 'wearer-right']]) {
    const cam = cardinalCam(S, az, P);
    const panel = await renderPanel(S, P, cam, {title: `${S.label}: ${VIEW_NAMES[az]} — orthographic, elevation 0°`, lines: [poseLine, `${projLabel(cam)} · floor edge-on · ${BELOW_SHORT}`, covLine], ss: a.ss});
    await save(await compose([panel]), a.out, `${a.role}-${file}.jpg`, meta, {view: VIEW_NAMES[az], viewAzimuthDeg: az, projection: 'orthographic', clip: STAND.clip, timeS: r3(P.t), light: STUDIO, coverageProbe: cov});
  }
  const cam = threeQuarterCam(S, P);
  const panel = await renderPanel(S, P, cam, {title: `${S.label}: front-right THREE-QUARTER — perspective (az −35° toward wearer's right, el 10°)`, lines: [poseLine, projLabel(cam), covLine], ss: a.ss});
  await save(await compose([panel]), a.out, `${a.role}-three-quarter.jpg`, meta, {view: "three-quarter, front-right (35° toward the wearer's right), elevation 10°", viewAzimuthDeg: -35, projection: 'perspective 26°', clip: STAND.clip, timeS: r3(P.t), light: STUDIO, coverageProbe: cov});
  const Pb = pose(S, null, 0);
  const bindLine = 'pose: BIND / T-pose (never shown in game)';
  const standShort = `pose: Stand (${STAND.clip} @ ${r3(P.t)} s, final frame)`;
  for (const c of Object.values(crops(S, P, Pb))) {
    const panels = [];
    for (const pc of c.panels) panels.push(await renderPanel(S, pc.bind ? Pb : P, pc.cam, {title: pc.title, lines: [pc.bind ? bindLine : standShort, projLabel(pc.cam, true)], ss: a.ss, tags: !pc.noTags}));
    await save(await compose(panels, {cols: 2, title: `${S.label} — ${c.title}`, subtitle: "close fit view · studio light · cyan = wearer's RIGHT, orange = wearer's LEFT (hollow dot = hidden)"}), a.out, c.file, meta,
      {view: c.title, panels: c.panels.map(p => ({title: p.title, azimuthDeg: p.az, projection: p.cam.persp ? 'perspective' : 'orthographic', pose: p.bind ? 'bind (T-pose)' : `Stand (${STAND.clip} @ ${r3(P.t)} s)`})), clip: STAND.clip, timeS: r3(P.t), light: STUDIO});
  }
}
const pct = f => `${Math.round(f * 100)}%`;

// ------------------------------------------------------------------------------------------------------------------- pairs
async function pairsSet(a, S, B, meta) {
  const PS = pose(S, STAND.clip, STAND.t), PB = pose(B, STAND.clip, STAND.t);
  const poseLine = `pose: ${STAND.clip} @ ${r3(PS.t)} s (Stand) · identical camera for both`;
  const half = {w: 640, h: 860};
  const mk = async (SS, P, cam, title, lines) => renderPanel(SS, P, cam, {title, lines, ss: a.ss});
  const covS = coverageProbe(S.anat, PS.posed), covB = coverageProbe(B.anat, PB.posed);
  const cl = c => `coverage probe: RIGHT ${pct(c.right.fraction)} · LEFT ${pct(c.left.fraction)}`;
  {
    const cy = (Math.max(PS.bounds.max[1], PB.bounds.max[1])) / 2;
    const cam = bodyCam(S, {azDeg: 0, target: [0, cy, 0], height: Math.max(PS.bounds.max[1], PB.bounds.max[1]) + 0.22, ...half});
    const panels = [await mk(B, PB, cam, `BASELINE (main, ${B.sha256.slice(0, 12)}…) — FRONT`, [poseLine, 'orthographic, elevation 0°', cl(covB)]), await mk(S, PS, cam, `CANDIDATE (${S.sha256.slice(0, 12)}…) — FRONT`, [poseLine, 'orthographic, elevation 0°', cl(covS)])];
    await save(await compose(panels, {cols: 2, title: 'Baseline vs candidate — full body FRONT', subtitle: "unmirrored front camera: the wearer's RIGHT is on screen-LEFT · " + BELOW}), a.out, 'pair-front.jpg', meta, {view: 'FRONT', pair: true, roles: ['baseline', 'candidate'], baselineSha256: B.sha256, clip: STAND.clip, timeS: r3(PS.t), light: STUDIO, coverageProbe: {baseline: covB, candidate: covS}});
  }
  {
    const cam = threeQuarterCam(S, PS, -35, half.w, half.h);
    const panels = [await mk(B, PB, cam, 'BASELINE — front-right THREE-QUARTER', [poseLine, projLabel(cam)]), await mk(S, PS, cam, 'CANDIDATE — front-right THREE-QUARTER', [poseLine, projLabel(cam)])];
    await save(await compose(panels, {cols: 2, title: 'Baseline vs candidate — three-quarter (perspective, az −35° toward the wearer\'s right, el 10°)'}), a.out, 'pair-three-quarter.jpg', meta, {view: 'three-quarter front-right', pair: true, roles: ['baseline', 'candidate'], baselineSha256: B.sha256, clip: STAND.clip, timeS: r3(PS.t), light: STUDIO});
  }
  {
    const PSb = pose(S, null, 0), PBb = pose(B, null, 0);
    const cS = crops(S, PS, PSb);
    const pick = [cS.chest.panels[0], cS.chest.panels[1], cS.shoulderR.panels[1], cS.waist.panels[0]];
    const panels = [];
    for (const [SS, P, Pbind, role] of [[B, PB, PBb, 'BASELINE'], [S, PS, PSb, 'CANDIDATE']]) for (const pc of pick) panels.push(await renderPanel(SS, pc.bind ? Pbind : P, pc.cam, {title: role, lines: [pc.title, pc.bind ? 'pose: BIND / T-pose (never shown in game)' : `pose: Stand (${STAND.clip} @ ${r3(PS.t)} s)`], ss: a.ss, tags: !pc.noTags}));
    await save(await compose(panels, {cols: 4, title: 'Baseline (top) vs candidate (bottom) — chest / strap, strap from behind, waist', subtitle: "identical cameras per column · cyan = wearer's RIGHT, orange = wearer's LEFT (hollow dot = hidden)"}), a.out, 'pair-strap-waist.jpg', meta,
      {view: 'chest front, chest+strap 3/4 (bind), strap back-right 3/4, waist front', pair: true, roles: ['baseline', 'candidate'], baselineSha256: B.sha256, clip: STAND.clip, timeS: r3(PS.t), light: STUDIO});
  }
}

// ------------------------------------------------------------------------------------------------------------------- scale
async function scaleSet(a, S, meta) {
  const zfile = path.join(ROOT, `game/public/assets/models/zombie-body-${a.zombie}-t25.glb`);
  const side = JSON.parse(fs.readFileSync(path.join(ROOT, `game/public/assets/derivatives/zombie-body-${a.zombie}.json`), 'utf8'));
  const Z = await loadGlb(zfile);
  const zm = await Promise.all(Z.prims.map(p => prepareMaterial(p.material, {maxTex: 1024})));
  const zClip = Z.clips.Idle ? 'Idle' : null;
  const zScale = 1.0; // ai/zombieActor.ts: 0.95 + rand * 0.1 -> the median; never rescaled for composition
  const zp = poseAll(Z, zClip, 0, {scale: zScale});
  const P = pose(S, STAND.clip, STAND.t);
  const Pb = pose(S, null, 0);
  // place the zombie at the wearer's LEFT (+left) 0.95 m, same ground, facing the same way as the zombie's own front (+Z authored)
  const off = S.anat.left.map(v => v * 0.95);
  const zd = zp.map((p, i) => {
    const pos = Float32Array.from(p.pos); for (let k = 0; k < pos.length; k += 3) { pos[k] += off[0]; pos[k + 2] += off[2]; }
    return {pos, nrm: p.nrm, uv: p.prim.uv, idx: p.prim.idx, mat: zm[i]};
  });
  let zTop = -Infinity, zMin = Infinity; for (const d of zd) for (let k = 1; k < d.pos.length; k += 3) { zTop = Math.max(zTop, d.pos[k]); zMin = Math.min(zMin, d.pos[k]); }
  const sTop = P.bounds.max[1], sBind = Pb.bounds.max[1];
  const capt = [`Siren: ${S.label} ${path.basename(S.file)} (${S.sha256.slice(0, 12)}…), runtime scale 1 (SirenActor.scale), pose Stand: top ${r3(sTop)} m · bind (T-pose) height ${r3(sBind)} m`,
    `zombie: ${path.basename(zfile)} "${side.title?.replace(/ - .*/, '') ?? a.zombie}", authored height ${side.conventions?.heightM ?? '?'} m × runtime root scale ${zScale.toFixed(2)} (median of the game's 0.95–1.05), clip ${zClip ?? 'bind'} @ 0 s: top ${r3(zTop)} m, lowest ${r3(zMin)} m`];
  const panels = [];
  const w = 900, h = 1100;
  {
    const cy = 0.95, cam = bodyCam(S, {azDeg: 0, target: [off[0] / 2, cy, off[2] / 2], height: 2.05, w, h});
    const g = guidesSvg(cam, [[sTop, `Siren top ${r3(sTop)} m (Stand)`, '#5fd7ff'], [zTop, `zombie top ${r3(zTop)} m`, '#9cff8a'], [0, 'ground y = 0', '#dddddd']]);
    const img = await render([...P.draws, ...zd], cam, {ss: a.ss});
    panels.push({img, title: `${S.label} beside an actual runtime-scaled zombie — FRONT, orthographic`, lines: capt, tags: [], overlaySvg: orientSvg(orientation(S, cam), w) + g});
  }
  {
    const o = orbit({front: S.anat.front, left: S.anat.left, target: [off[0] / 2, 0.85, off[2] / 2], azDeg: -30, elDeg: 8, dist: 5.2});
    const cam = makeCamera({type: 'persp', ...o, fovDeg: 26, w, h});
    const img = await render([...P.draws, ...zd], cam, {ss: a.ss});
    panels.push({img, title: 'same, three-quarter (perspective 26°, az −30°, el 8°) — same ground plane', lines: ['zombie stands 0.95 m to the wearer\'s LEFT; both on y = 0', 'zombie-body-*-t25.glb is the bare body layer (the game adds wardrobe meshes)'], tags: [], overlaySvg: ''});
  }
  await save(await compose(panels, {cols: 2}), a.out, `${a.role}-beside-zombie.jpg`, meta, {view: 'FRONT ortho + three-quarter perspective', clip: STAND.clip, timeS: r3(P.t), light: STUDIO,
    zombie: {file: rel(zfile), id: a.zombie, authoredHeightM: side.conventions?.heightM, runtimeScale: zScale, clip: zClip, timeS: 0, topM: r3(zTop), lowestM: r3(zMin)}, siren: {standTopM: r3(sTop), bindHeightM: r3(sBind), runtimeScale: 1}});
}
function guidesSvg(cam, lines) {
  return lines.map(([y, label, col]) => { const sy = cam.project([0, y, 0])[1]; return `<line x1="0" y1="${sy.toFixed(1)}" x2="${cam.w}" y2="${sy.toFixed(1)}" stroke="${col}" stroke-width="1" stroke-dasharray="7 5"/>` + svgText(cam.w - 8, sy - 4, label, {size: 12, fill: col, anchor: 'end', stroke: '#111'}); }).join('');
}

// ------------------------------------------------------------------------------------------------------------------- gameplay light
async function lightSet(a, S, meta) {
  const P = pose(S, STAND.clip, STAND.t), D = pose(S, 'Dormant', 0);
  const eyeH = 1.6;
  const lightLines = ['STANDALONE CPU approximation of the game\'s flashlight look — NOT a captured game frame, NOT GPU',
    'flashlight SpotLight 34 cd #fff4e2, 0.58 rad, penumbra 0.7, decay 1.2 (camera-mounted, game.ts) + hemisphere 0.045 + FogExp2 0.043 + ACES 0.78',
    'material: base colour + metallic-roughness + normal map (three.js physical BRDF approximation) · not modelled: level fixture light field, shadows, volumetrics'];
  // (1) the game's 75° vertical FOV, 16:9, standing Siren 4 m ahead, flashlight on her
  {
    const tgt = [0, 1.0, 0];
    const dir = S.anat.front.map((v, i) => v * Math.cos(-20 * Math.PI / 180) + S.anat.left[i] * Math.sin(-20 * Math.PI / 180));
    const eye = [dir[0] * 4, eyeH, dir[2] * 4];
    const cam = makeCamera({type: 'persp', eye, target: tgt, fovDeg: 75, w: 1024, h: 576});
    const img = await render(P.draws, cam, {ss: a.ss, mode: 'gameplay', floor: {y: 0, half: 60, grid: 1.0}});
    await save(await compose([{img, title: `${S.label} — gameplay-light approximation, the game's 75° vertical FOV, 16:9, eye 1.6 m, 4.0 m away (front-right 20°)`, lines: [`pose: Stand (${STAND.clip} @ ${r3(P.t)} s)`, ...lightLines], tags: []}]), a.out, `${a.role}-gameplay-light-gamefov.jpg`, meta,
      {view: 'player view: eye 1.6 m, 4.0 m away, 20° to the wearer\'s right of front, FOV 75°', projection: 'perspective 75°', clip: STAND.clip, timeS: r3(P.t), light: GAMEPLAY_LIGHT.source, notModelled: GAMEPLAY_LIGHT.notModelled});
  }
  // (2) closer (narrower FOV = a centre crop of the same light), standing + dormant
  const panels = [];
  for (const [PP, label, tgtY, dist] of [[P, `Stand (${STAND.clip} @ ${r3(P.t)} s)`, 0.85, 3.0], [D, 'Dormant @ 0 s (how she is first found)', 0.35, 3.0]]) {
    const dir = S.anat.front.map((v, i) => v * Math.cos(-20 * Math.PI / 180) + S.anat.left[i] * Math.sin(-20 * Math.PI / 180));
    const eye = [dir[0] * dist, eyeH, dir[2] * dist];
    const cam = makeCamera({type: 'persp', eye, target: [0, tgtY, 0], fovDeg: 34, w: 600, h: 760});
    const img = await render(PP.draws, cam, {ss: a.ss, mode: 'gameplay', floor: {y: 0, half: 60, grid: 1.0}});
    panels.push({img, title: `${label} — ${dist} m, eye 1.6 m, FOV 34° (= centre crop)`, lines: [lightLines[0], 'floor drawn translucent: skirt below the floor shows purple (in game the opaque floor hides it)'], tags: []});
  }
  await save(await compose(panels, {cols: 2, footer: lightLines.slice(1)}), a.out, `${a.role}-gameplay-light-close.jpg`, meta,
    {view: 'player view crop: eye 1.6 m, 3.0 m away, 20° to the wearer\'s right of front, FOV 34°', projection: 'perspective 34°', clip: 'Rise(end) + Dormant', light: GAMEPLAY_LIGHT.source, notModelled: GAMEPLAY_LIGHT.notModelled});
}

// ------------------------------------------------------------------------------------------------------------------- clips
const SAMPLES = {
  Dormant: [[0, 'loop start'], [1.0, 'breath'], [2.0, 'mid'], [3.0, 'breath']],
  Rise: [[0, 'start (kneel)'], [0.3, 'push'], [0.5, 'stand-up blend'], [0.7, 'rising'], [null, 'end = Stand']],
  Run: [[0, 'contact'], [0.15, 'passing'], [0.3, 'opposite contact'], [0.45, 'passing']],
  Attack: [[0, 'start'], [0.28, 'wind-up end'], [0.4, 'impact (reach)'], [0.7, 'recovery'], [null, 'end']],
  Hit: [[0, 'start'], [0.1, 'recoil'], [0.2, 'recoil'], [null, 'end']],
  Death: [[0, 'start'], [0.5, 'falling'], [1.0, 'falling'], [1.4, 'impact'], [null, 'end (prone, floor contact)']],
};
/** Adds extreme frames found on the clip's own key times: deepest dress below floor; for Run / Attack the widest stride / reach. */
function clipSamples(S, clip) {
  const dur = S.asset.clips[clip].duration;
  const base = SAMPLES[clip].map(([t, l]) => [t == null ? dur : Math.min(t, dur), l]);
  const keys = [...new Set(S.asset.clips[clip].channels.flatMap(c => Array.from(c.T)))].sort((x, y) => x - y);
  let worstSink = {t: 0, v: Infinity}, ext = {t: 0, v: -Infinity};
  for (const t of keys) {
    const P = pose(S, clip, t);
    if (P.dressMinY < worstSink.v) worstSink = {t, v: P.dressMinY};
    const lf = P.joint('L_Foot'), rf = P.joint('R_Foot'), rh = P.joint('R_Hand'), ch = P.joint('Chest');
    const m = clip === 'Run' && lf && rf ? Math.hypot(lf[0] - rf[0], lf[2] - rf[2]) : clip === 'Attack' && rh && ch ? Math.hypot(rh[0] - ch[0], rh[2] - ch[2]) : -Infinity;
    if (m > ext.v) ext = {t, v: m};
  }
  const add = (t, l) => { if (!base.some(([b]) => Math.abs(b - t) < 0.04)) base.push([t, l]); };
  if (worstSink.v < -0.02) add(worstSink.t, `deepest skirt below floor (${r3(-worstSink.v)} m)`);
  if (Number.isFinite(ext.v) && ext.v > 0) add(ext.t, clip === 'Run' ? 'widest stride' : 'max reach');
  return {samples: base.sort((x, y) => x[0] - y[0]).slice(0, 6), worstSink: {t: r3(worstSink.t), belowFloorM: r3(Math.max(0, -worstSink.v))}};
}
/** Fixed per-clip cameras (orthographic, el 10°) fitted to the clip's actual posed vertices: front-right 3/4 and back-left 3/4. */
const VIEWS3 = [{az: -35, name: "front-right 3/4 (az −35°, toward the wearer's right)"}, {az: 145, name: 'back-left 3/4 (az +145°, behind at her left)'}];
function fitOrtho(S, az, el, pointSets, w, h, margin = 0.07) {
  const base = bodyCam(S, {azDeg: az, elDeg: el, target: [0, 0.8, 0], height: 2, w, h});
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const P of pointSets) for (let i = 0; i < P.length; i += 3 * 7) {
    const d = [P[i] - base.eye[0], P[i + 1] - base.eye[1], P[i + 2] - base.eye[2]];
    const x = d[0] * base.r[0] + d[1] * base.r[1] + d[2] * base.r[2], y = d[0] * base.u[0] + d[1] * base.u[1] + d[2] * base.u[2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const height = Math.max(y1 - y0, (x1 - x0) * h / w) * (1 + 2 * margin) + 0.06;
  const shift = base.r.map((v, k) => v * cx + base.u[k] * cy);
  return makeCamera({type: 'ortho', eye: base.eye.map((v, k) => v + shift[k]), target: base.target.map((v, k) => v + shift[k]), height, w, h});
}
function clipCams(S, clip, w, h, times = null) {
  const dur = S.asset.clips[clip].duration;
  const ts = times ?? Array.from({length: 13}, (_, i) => (dur * i) / 12);
  const sets = ts.flatMap(t => pose(S, clip, t).posed.map(p => p.pos));
  return VIEWS3.map(v => ({...v, cam: fitOrtho(S, v.az, 10, sets, w, h)}));
}

async function clipsSet(a, S, meta) {
  const info = {};
  for (const clip of CLIPS) {
    if (!S.asset.clips[clip]) { console.log(`  (no clip ${clip})`); continue; }
    const {samples, worstSink} = clipSamples(S, clip);
    info[clip] = {durationS: r3(S.asset.clips[clip].duration), samples: samples.map(([t, l]) => ({t: r3(t), label: l})), worstSink};
    const cols = samples.length, cw = Math.floor(1600 / cols) - 4, chh = Math.round(cw * 1.3);
    const cams = clipCams(S, clip, cw, chh);
    const panels = [];
    for (const v of cams) for (const [t, l] of samples) {
      const P = pose(S, clip, t);
      const img = await render(P.draws, v.cam, {ss: a.ss});
      panels.push({img, title: `${clip} @ ${t.toFixed(2)} s — ${l}`, lines: [v.name, `dress lowest ${r3(P.dressMinY)} m · body lowest ${r3(P.bodyMinY)} m`], tags: [], overlaySvg: orientSvg(orientation(S, v.cam), cw)});
    }
    await save(await compose(panels, {cols, title: `${S.label} — ${clip} (actual clip, ${r3(S.asset.clips[clip].duration)} s): representative + extreme poses`, subtitle: `top row front-right 3/4, bottom row back-left 3/4 · orthographic, elevation 10°, one fixed camera per row framing the whole clip · ${BELOW}`}), a.out, `clips-${clip}.jpg`, meta,
      {view: cams.map(c => c.name).join(' / '), projection: 'orthographic, elevation 10°', clip, samples: info[clip].samples, light: STUDIO, worstSinkBelowFloor: worstSink});
  }
  // overview: every clip, 3 key samples each (2 clips per row), front-right 3/4 only — an index; per-clip sheets are the review images
  const KEY = {Dormant: [0, 2.0, 3.0], Rise: [0, 0.5, null], Run: [0, 0.15, 0.3], Attack: [0.28, 0.4, null], Hit: [0, 0.1, null], Death: [0, 1.4, null]};
  const cw = 262, chh = 300;
  const panels = [];
  for (const clip of CLIPS) {
    if (!S.asset.clips[clip]) continue;
    const dur = S.asset.clips[clip].duration, ts = KEY[clip].map(t => (t == null ? dur : Math.min(t, dur)));
    const cam = clipCams(S, clip, cw, chh)[0].cam;
    for (const t of ts) {
      const P = pose(S, clip, t);
      const lbl = (SAMPLES[clip].find(([x]) => (x == null ? dur : x) === t) ?? [0, ''])[1];
      panels.push({img: await render(P.draws, cam, {ss: a.ss}), title: `${clip} @ ${t.toFixed(2)} s`, lines: [lbl || ' '], tags: []});
    }
  }
  await save(await compose(panels, {cols: 6, title: `${S.label} — all six actual clips, 3 key poses each (index; see the per-clip sheets)`, subtitle: `front-right 3/4, orthographic el 10°, fitted per clip · ${BELOW}`, gap: 2}), a.out, 'clips-overview.jpg', meta, {view: 'front-right 3/4', projection: 'orthographic, elevation 10°', clip: CLIPS.join(','), samples: KEY, light: STUDIO});
  return info;
}

// ------------------------------------------------------------------------------------------------------------------- motion
const MOTION = {Dormant: {fps: 12, span: 'loop', cycles: 1}, Rise: {fps: 15, hold: 0.6}, Run: {fps: 15, span: 'loop', cycles: 2}, Attack: {fps: 15, hold: 0.6}, Hit: {fps: 15, hold: 0.6}, Death: {fps: 15, hold: 0.8}};
async function motionSet(a, S, meta) {
  const PW = 383, PH = 512;
  const out = {};
  for (const clip of a.clips ?? CLIPS) {
    if (!S.asset.clips[clip]) continue;
    const spec = MOTION[clip], dur = S.asset.clips[clip].duration;
    const total = spec.span === 'loop' ? dur * spec.cycles : dur;
    const n = spec.span === 'loop' ? Math.round(total * spec.fps) : Math.floor(dur * spec.fps + 1e-6) + 1;
    const times = Array.from({length: n}, (_, i) => Math.min(i / spec.fps, spec.span === 'loop' ? total : dur));
    if (spec.span !== 'loop' && times[times.length - 1] < dur - 1e-6) times.push(dur);
    const cams = clipCams(S, clip, PW, PH);
    const dir = path.join(a.out, 'motion', clip);
    fs.mkdirSync(dir, {recursive: true});
    const frames = [];
    let i = 0;
    for (const T of times) {
      const t = spec.span === 'loop' ? T % dur : T;
      const P = pose(S, clip, t);
      const panels = [];
      for (const v of cams) panels.push({img: await render(P.draws, v.cam, {ss: a.ss}), title: v.az < 0 ? 'front-right 3/4 (az −35°)' : 'back-left 3/4 (az +145°)', lines: [], tags: [], overlaySvg: orientSvg(orientation(S, v.cam), PW)});
      const sheet = await compose(panels, {cols: 2, title: `${S.label} · ${clip} · t = ${t.toFixed(3)} s / ${r3(dur)} s · frame ${i + 1}/${times.length}`, capH: 22, gap: 2});
      const raw = await flatten(sheet);
      const f = path.join(dir, `f${String(i).padStart(3, '0')}.webp`);
      const info = await sharp(raw, {raw: {width: sheet.width, height: sheet.height, channels: 3}}).webp({quality: 80, effort: 4}).toFile(f);
      frames.push({file: path.relative(a.out, f), t: r3(t), bytes: info.size, raw, width: sheet.width, height: sheet.height});
      i++;
    }
    // animated WebP: same frames; the last frame is held (once-clips) for `hold` seconds
    const delays = frames.map((_, k) => Math.round(1000 / spec.fps) + (k === frames.length - 1 && spec.hold ? Math.round(spec.hold * 1000) : 0));
    const pngs = await Promise.all(frames.map(fr => sharp(fr.raw, {raw: {width: fr.width, height: fr.height, channels: 3}}).png({compressionLevel: 1}).toBuffer()));
    const webp = path.join(a.out, `motion-${clip}.webp`);
    const wi = await sharp(pngs, {join: {animated: true}}).webp({quality: 72, loop: 0, delay: delays, effort: 4}).toFile(webp);
    const durationS = delays.reduce((x, y) => x + y, 0) / 1000;
    const framesBytes = frames.reduce((x, f) => x + f.bytes, 0);
    out[clip] = {fps: spec.fps, frames: frames.length, width: frames[0].width, height: frames[0].height, clipDurationS: r3(dur), shownSpanS: r3(total), cycles: spec.cycles ?? 1, endHoldS: spec.hold ?? 0, webp: {file: path.basename(webp), bytes: wi.size, durationS: r3(durationS), loop: true}, framesBytes, frameTimes: frames.map(f => f.t)};
    meta.add({file: path.basename(webp), mime: 'image/webp', bytes: wi.size, width: frames[0].width, height: frames[0].height, fps: spec.fps, durationS: r3(durationS), frames: frames.length, animated: true, clip, clipDurationS: r3(dur), cycles: spec.cycles ?? 1, endHoldS: spec.hold ?? 0, view: cams.map(c => c.name).join(' | '), projection: 'orthographic, elevation 10°', light: STUDIO});
    for (const fr of frames) meta.add({file: fr.file, mime: 'image/webp', bytes: fr.bytes, width: fr.width, height: fr.height, clip, timeS: fr.t, stepperFrame: true, view: cams.map(c => c.name).join(' | '), light: STUDIO});
    console.log(`  motion ${clip}: ${frames.length} frames @ ${spec.fps} fps, ${frames[0].width}x${frames[0].height}, webp ${(wi.size / 1024).toFixed(0)} KB, frames ${(framesBytes / 1024).toFixed(0)} KB`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------- worst
async function worstSet(a, S, meta) {
  const [clip, ts, region = 'reported region'] = a.worst.split(':');
  const t = +ts;
  const P = pose(S, clip, t);
  const pts = a.worstPoints ?? [];
  const COL = ['#ff4d4d', '#ffd84d', '#c58cff'];
  const ptTags = pts.map((q, k) => ({world: q.p, text: `${k + 1}: ${q.label}`, color: COL[k % COL.length]}));
  const panels = [];
  const ctr = P.bounds.max.map((v, i) => (v + P.bounds.min[i]) / 2);
  const W = 400, H = 520;
  for (const az of [-35, 145, 0, 180]) {
    const cam = bodyCam(S, {azDeg: az, elDeg: 10, target: ctr, height: Math.max(1.0, P.bounds.max[1] - Math.max(-0.1, P.bounds.min[1]) + 0.3), w: W, h: H});
    const pnl = await renderPanel(S, P, cam, {title: `az ${az}° (${VIEW_NAMES[az] ?? (az === -35 ? 'front-right 3/4' : 'back-left 3/4')})`, lines: [`${clip} @ ${t} s · orthographic, el 10°`], ss: a.ss, tags: false});
    pnl.tags = ptTags.map((tg, k) => ({...tg, text: `${k + 1}`, dy: 0}));
    panels.push(pnl);
  }
  const hp = P.joint('Hips') ?? ctr;
  for (const [k, q] of pts.entries()) {
    const dl = (q.p[0] - hp[0]) * S.anat.left[0] + (q.p[2] - hp[2]) * S.anat.left[2], df = (q.p[0] - hp[0]) * S.anat.front[0] + (q.p[2] - hp[2]) * S.anat.front[2];
    const az = Math.round(Math.atan2(dl, df) * 180 / Math.PI);
    const cam = bodyCam(S, {azDeg: az, elDeg: 10, target: q.p, height: 0.45, w: W, h: H});
    const pnl = await renderPanel(S, P, cam, {title: `close-up ${k + 1}: ${q.label}`, lines: [`az ${az}° (facing the point), orthographic 0.45 m window`], ss: a.ss, tags: false});
    pnl.tags = [{...ptTags[k], text: `${k + 1}`}];
    panels.push(pnl);
  }
  await save(await compose(panels, {cols: 4, title: `${S.label} — worst remaining frame (lane FIT's metric): ${clip} @ ${t} s — ${region}`, subtitle: `numbered markers = deepest dress-inside-skin points of this frame by dress region (garment-metrics.mjs) · ${BELOW}`}), a.out, 'worst-frame.jpg', meta,
    {view: '4 body-relative views + one close-up per point', clip, timeS: t, region, points: pts, light: STUDIO, source: "lane FIT's garment metric (tools/asset-pipeline/enemy/lib/garment-metrics.mjs measureFrame) evaluated on this asset"});
}

// ------------------------------------------------------------------------------------------------------------------- main
async function main() {
  const a = parseArgs(process.argv);
  fs.mkdirSync(a.out, {recursive: true});
  const want = s => !a.only || a.only.has(s);
  const t0 = Date.now();
  const S = await loadSiren(a.glb, a.role === 'baseline' ? 'BASELINE' : 'CANDIDATE');
  console.log(`${a.role}: ${rel(a.glb)} sha256 ${S.sha256} (${S.bytes} B); ${S.anat.statement}`);
  console.log(`  prims: ${JSON.stringify(S.prims)}; clips: ${JSON.stringify(S.clips)}`);
  const meta = new Meta(a, S);
  const summary = {asset: rel(a.glb), sha256: S.sha256, bytes: S.bytes, role: a.role, prims: S.prims, clips: S.clips, anatomy: anatSummary(S)};
  if (want('static')) { console.log('static'); await staticSet(a, S, meta); meta.write('static'); }
  if (want('pairs') && a.baseline) { console.log('pairs'); const B = await loadSiren(a.baseline, 'BASELINE'); summary.baseline = {asset: rel(a.baseline), sha256: B.sha256, bytes: B.bytes, prims: B.prims, anatomy: anatSummary(B)}; await pairsSet(a, S, B, meta); meta.write('pairs'); }
  if (want('scale')) { console.log('scale'); await scaleSet(a, S, meta); meta.write('scale'); }
  if (want('light')) { console.log('light'); await lightSet(a, S, meta); meta.write('light'); }
  if (want('clips')) { console.log('clips'); summary.clipSamples = await clipsSet(a, S, meta); meta.write('clips'); }
  if (want('motion')) { console.log('motion'); summary.motion = await motionSet(a, S, meta); meta.write('motion'); }
  if (want('worst') && a.worst) { console.log('worst'); await worstSet(a, S, meta); meta.write('worst'); }
  if (want('coverage')) {
    const cov = {};
    for (const clip of CLIPS) { if (!S.asset.clips[clip]) continue; const d = S.asset.clips[clip].duration; cov[clip] = []; for (let t = 0; t <= d + 1e-6; t += 0.1) cov[clip].push({t: r3(Math.min(t, d)), ...(({left, right}) => ({left: left.fraction, right: right.fraction}))(coverageProbe(S.anat, poseAll(S.asset, clip, Math.min(t, d))))}); }
    summary.coverageProbe = {method: 'body vertices within 3.5 cm of each breast apex (bind) cast a ray along the posed normal; hit on a dress triangle within 12 cm (tolerance −3 mm) = covered; geometric sanity check only', perClip: cov,
      summary: Object.fromEntries(Object.entries(cov).map(([k, v]) => [k, {rightMin: Math.min(...v.map(x => x.right)), rightMax: Math.max(...v.map(x => x.right)), leftMin: Math.min(...v.map(x => x.left)), leftMax: Math.max(...v.map(x => x.left))}]))};
  }
  fs.mkdirSync(a.meta, {recursive: true});
  const sf = path.join(a.meta, `${a.role}-summary${a.only ? '-' + [...a.only].join('_') : ''}.json`);
  fs.writeFileSync(sf, JSON.stringify(summary, null, 1));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s; meta ${rel(sf)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
export {axisName};
