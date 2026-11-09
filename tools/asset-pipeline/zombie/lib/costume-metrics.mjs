// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME): fit metrics of a full cosplay costume (head piece + upper + lower) on
// its body through EVERY validation pose (every 0.1 s of all six clips + each clip's last frame), measured on the RUNTIME data (the
// quantised u8 skin weights the GLB ships, the shipped hide masks). CPU linear-blend skinning (glTF spec), per pose:
//  - body poke-through (lib/penetration.mjs auditPose, the wardrobe iteration-07 definition): body skin vertices (outer hull; head and
//    free-hanging hair excluded) covered by the costume in the bind pose whose posed outward ray no longer meets the cloth while it lies
//    UNDER the skin -> VISIBLE poke when a body triangle using the vertex is not hidden; exposed-hidden = hidden-only vertices that are
//    neither covered nor under cloth in the pose (see-through risk);
//  - cloth inside the body: cloth vertices (every 2nd) deeper than 5 mm inside the posed closed skin (ray parity) where that skin is
//    VISIBLE (its closest triangle not hidden) and belongs to the regions the cloth part is fitted over, per piece (cloth inside ANOTHER
//    limb - a hand pushed into a skirt, an arm pressed into a jacket's flank: the animation's own limb contact - is reported apart);
//  - coverage of the UNCLOTHED bodies (ZombieBodyDef nude): the breast apex zones, the groin V and its core (lib/lingerie-metrics.mjs
//    zones) and the TORSO (skin between the crotch + 3 cm and the armpits - 4 cm, not facing down): a zone vertex is covered when it is
//    hidden, or NO sight line from it toward a viewer escapes past the costume and the body itself (every azimuth; a standing / moving
//    character from -10 .. +40 deg elevation - a player standing or crouching round it -, a falling / fallen one (Death) up to straight
//    down, a ragdoll extreme pose from every side) - an unclothed body is never shown bare in any frame.
import {TriGrid, prepareInner, bindCoverage, auditPose, insideByParity} from './penetration.mjs';
import {skinWith, posedWeldedNormals} from './lingerie-fit.mjs';
import {coverageZones} from './lingerie-metrics.mjs';
import {REG} from './costume-fit.mjs';

const r4 = v => +(+v).toFixed(4);

/** Gate per (costume, body): every frame of every clip. */
export const COSTUME_LIMITS = {
  // visible poke vertices / covered body vertices (and an absolute floor) - head-to-toe costume = two garments: the ordinary wardrobe's
  // per-garment gates (lib/fit07.mjs: 1 % animated, 2.5 % extreme) summed over upper + lower
  pokeVisible: 0.02, pokeVisibleExtreme: 0.05, pokeVisibleCount: 25,
  exposedHidden: 0.03, exposedHiddenCount: 12,
  clothDeep: 0.03,                          // per piece: fraction of cloth vertices > 5 mm inside the posed body
  apexCoverage: 1, groinCoreCoverage: 1, groinCoverage: 0.85, torsoCoverage: 0.96, // unclothed bodies only
};

/**
 * @param B lib/lingerie-body.mjs loadBody + lib/costume-fit.mjs prepareCostumeBody
 * @param pieces [{name, pos, idx, joints (u8 x4), weights (float x4), hide (Uint8Array over the body triangles)}] (head piece included)
 * @param opts {poses, nude}
 */
export function measureCostume(B, pieces, {poses, nude = false} = {}) {
  const C = B.costume, nT = B.nTris, n = B.pos.length / 3;
  const hide = new Uint8Array(nT);
  for (const p of pieces) if (p.hide) for (let t = 0; t < nT; t++) if (p.hide[t]) hide[t] = 1;
  const elig = new Uint8Array(n);
  for (let v = 0; v < n; v++) elig[v] = C.innerVert[v] && C.region[v] !== REG.head && !(B.hair[v] && !B.fused[v]) ? 1 : 0;
  const cloth = pieces.filter(p => p.name !== 'head');
  const inner = prepareInner({pos: B.pos, idx: B.idx, nrm: B.nrm, joints: B.joints, weights: B.weights}, hide, elig);
  const cover = bindCoverage(inner, cloth.map(p => ({pos: p.pos, idx: p.idx})), {coverDist: 0.12, maxDepth: 0.04});
  let hiddenOnly = 0; for (const i of inner.uniq) if (inner.used[i] && !inner.visible[i]) hiddenOnly++;
  const zones = nude ? coverageZones(B) : null;
  // torso coverage zone: torso skin between the crotch + 3 cm and the armpits - 4 cm
  const torsoZone = [];
  if (nude) {
    const yA = Math.min(C.armpit.L.y, C.armpit.R.y), seen = new Set();
    for (let v = 0; v < n; v++) { const r = B.remap[v]; if (seen.has(r) || !elig[v] || C.region[v] !== REG.torso || !C.hull[v] || B.nrm[v * 3 + 1] < -0.5) continue; seen.add(r); const y = B.pos[v * 3 + 1]; if (y > C.crotch[1] + 0.03 && y < yA - 0.04) torsoZone.push(v); }
  }
  // a body vertex is hidden-only when every triangle using it is hidden
  const vis = new Uint8Array(n);
  for (let t = 0; t < nT; t++) if (!hide[t]) for (let c = 0; c < 3; c++) vis[B.remap[B.idx[t * 3 + c]]] = 1;
  // B.skinIdx triangle -> the body triangle (hide mask index)
  const triOf = new Map(); for (let t = 0; t < nT; t++) triOf.set(`${B.idx[t * 3]},${B.idx[t * 3 + 1]},${B.idx[t * 3 + 2]}`, t);
  const skinTri = Int32Array.from({length: B.skinIdx.length / 3}, (_, t) => triOf.get(`${B.skinIdx[t * 3]},${B.skinIdx[t * 3 + 1]},${B.skinIdx[t * 3 + 2]}`) ?? 0);
  const perClip = {};
  for (const pose of poses) {
    const bp = skinWith(pose.mats, B.pos, B.joints, B.weights);
    const bn = posedWeldedNormals(B, bp);
    const posed = cloth.map(p => ({pos: skinWith(pose.mats, p.pos, p.joints, p.weights), idx: p.idx}));
    const a = auditPose(inner, cover, {pos: bp, nrm: bn}, posed, {outDist: 0.12, maxDepth: 0.04, outerInside: false, innerGrid: new TriGrid(bp, B.idx, 0.03)});
    const closedSkin = new TriGrid(bp, B.skinIdx, 0.025);
    const deep = {}, deepWhere = {}, contacts = {};
    cloth.forEach((p, k) => {
      // cloth sunk > 5 mm into VISIBLE skin (the closest skin triangle is not hidden): skin showing where the costume should be; cloth
      // inside a hidden part (the arm inside its sleeve, the foot inside its shoe) is not seen
      // only skin of the regions the cloth part is fitted over counts (own regions); a hand pushed into a skirt or an arm pressed into
      // a jacket's flank is the animation's limb contact (the bare body does the same), reported apart as contact
      let d = 0, cnt = 0, contact = 0; const P = posed[k].pos, where = {};
      for (let i = 0; i < P.length / 3; i += 2) {
        cnt++;
        const c = closedSkin.closest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.05);
        if (!(c && c.d > 0.005 && !hide[skinTri[c.tri]] && insideByParity(closedSkin, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) continue;
        const pn = p.part?.[i] ?? p.name, rg = C.region[B.skinIdx[c.tri * 3]];
        if (!OWN(pn, rg)) { contact++; continue; }
        d++; const w = `${pn}>${rg}`; where[w] = (where[w] ?? 0) + 1;
      }
      deep[p.name] = r4(d / cnt);
      deepWhere[p.name] = where;
      contacts[p.name] = r4(contact / cnt);
    });
    const pokeWhere = {}; for (const i of a.pokeIds) { const k = REG_NAME[C.region[i]]; pokeWhere[k] = (pokeWhere[k] ?? 0) + 1; }
    const frame = {clip: pose.clip, t: pose.t, body: {covered: a.covered, pokeWhere, pokeVisible: a.pokeVisible, pokeVisibleFraction: r4(a.pokeVisible / Math.max(1, a.covered)), exposedHidden: a.exposedHidden, exposedHiddenFraction: r4(a.exposedHidden / Math.max(1, hiddenOnly))}, clothDeep: deep, clothDeepWhere: deepWhere, limbContact: contacts};
    if (nude) {
      // VISIBILITY from where a viewer can stand: a zone vertex is exposed when a sight line from it toward a viewer direction (azimuth
      // every 30 deg, elevation -10 .. +70 deg above the horizon: a standing or crouching player round the character, looking level or
      // down; never from under a skirt) leaves without meeting the costume or the body itself (a thigh, the arms, long hair) within 1 m
      const og = new TriGrid(Float32Array.from(posed.flatMap(c => [...c.pos])), mergeIdx(posed), 0.025), bg = new TriGrid(bp, B.idx, 0.03), view = viewOf(pose.clip);
      const seen = (i, nx, ny, nz, dirs) => {
        const ox = bp[i * 3] + nx * 0.002, oy = bp[i * 3 + 1] + ny * 0.002, oz = bp[i * 3 + 2] + nz * 0.002;
        for (const d of dirs) {
          if (d[0] * nx + d[1] * ny + d[2] * nz <= 0.05) continue; // the skin faces away: never seen from there
          if (og.ray(ox, oy, oz, d[0], d[1], d[2], 1.0)) continue;
          if (bg.ray(ox, oy, oz, d[0], d[1], d[2], 1.0, 0.004)) continue;
          return true;
        }
        return false;
      };
      const zone = ids => {
        let ok = 0;
        for (const i of ids) {
          let nx = 0, ny = 0, nz = 0; for (const j of zones.nb.get(i)) { nx += bn[j * 3]; ny += bn[j * 3 + 1]; nz += bn[j * 3 + 2]; }
          const l = Math.hypot(nx, ny, nz) || 1;
          if (!vis[B.remap[i]] || !seen(i, nx / l, ny / l, nz / l, view.zone)) ok++;
        }
        return ids.length ? r4(ok / ids.length) : 1;
      };
      let tok = 0;
      for (const i of torsoZone) if (!vis[B.remap[i]] || !seen(i, bn[i * 3], bn[i * 3 + 1], bn[i * 3 + 2], view.torso)) tok++;
      frame.coverage = {apex: zone(zones.apex), groin: zone(zones.groin), groinCore: zone(zones.groinCore), torso: torsoZone.length ? r4(tok / torsoZone.length) : 1};
    }
    (perClip[pose.clip] ??= []).push(frame);
  }
  const summary = {};
  for (const [clip, frames] of Object.entries(perClip)) {
    const worstPoke = frames.reduce((a, x) => (x.body.pokeVisible > a.body.pokeVisible ? x : a));
    const S = {frames: frames.length, body: {covered: frames[0].body.covered, hiddenOnly, pokeWhere: worstPoke.body.pokeWhere, pokeVisible: Math.max(...frames.map(f => f.body.pokeVisible)), pokeVisibleFraction: Math.max(...frames.map(f => f.body.pokeVisibleFraction)),
      exposedHidden: Math.max(...frames.map(f => f.body.exposedHidden)), exposedHiddenFraction: Math.max(...frames.map(f => f.body.exposedHiddenFraction))},
    clothDeep: Object.fromEntries(cloth.map(p => [p.name, Math.max(...frames.map(f => f.clothDeep[p.name]))])),
    limbContact: Object.fromEntries(cloth.map(p => [p.name, Math.max(...frames.map(f => f.limbContact[p.name]))])),
    // where the worst frame's sunk cloth is: '<cloth part>><body region>' (lib/costume-fit.mjs REG) -> vertices (every 2nd)
    clothDeepWhere: Object.fromEntries(cloth.map(p => { const f = frames.reduce((a, x) => (x.clothDeep[p.name] > a.clothDeep[p.name] ? x : a)); return [p.name, f.clothDeepWhere[p.name]]; }))};
    if (nude) S.coverage = Object.fromEntries(['apex', 'groin', 'groinCore', 'torso'].map(k => [k, Math.min(...frames.map(f => f.coverage[k]))]));
    summary[clip] = S;
  }
  return {poses: poses.length, zones: nude ? {apex: zones.apex.length, groin: zones.groin.length, groinCore: zones.groinCore.length, torso: torsoZone.length} : null, summary};
}

/** Viewer directions (unit, world frame): azimuth every 30 deg x elevation -10 / 10 / 30 / 50 / 70 deg, + straight up; coarse: every 45 deg x 0 / 30 / 60. */
const dirsOf = (azStep, els) => { const out = []; for (const el of els) for (let az = 0; az < 360; az += azStep) { const e = el * Math.PI / 180, a = az * Math.PI / 180; out.push([Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]); } out.push([0, 1, 0]); return out; };
const REG_NAME = Object.fromEntries(Object.entries(REG).map(([k, v]) => [v, k]));
// a standing / moving character is seen from a player's eye, level or looking down (<= 40 deg); a falling or fallen one (Death) from
// anywhere above (to straight down); a ragdoll extreme pose (an upright frame of a corpse's limb spread) from every side
const VIEW = {
  standing: {zone: dirsOf(30, [-10, 10, 25, 40]), torso: dirsOf(45, [0, 30])},
  fallen: {zone: dirsOf(30, [-10, 10, 30, 50, 70]), torso: dirsOf(45, [0, 30, 60])},
  ragdoll: {zone: dirsOf(30, [-60, -40, -20, 0, 20, 40, 60, 80]), torso: dirsOf(45, [-45, 0, 45, 80])},
};
const viewOf = clip => (clip.startsWith('ragdoll') ? VIEW.ragdoll : clip === 'Death' ? VIEW.fallen : VIEW.standing);
/** The body regions a cloth part is fitted over (lib/costume-fit.mjs REG): cloth sunk into these counts as a fit fault. */
function OWN(part, rg) {
  if (part === 'torso' || part === 'upper') return rg === REG.torso || rg === REG.head;
  if (part === 'sleeveL') return rg === REG.armL || rg === REG.handL;
  if (part === 'sleeveR') return rg === REG.armR || rg === REG.handR;
  if (part === 'waist' || part === 'lower') return rg === REG.torso || rg === REG.legL || rg === REG.legR;
  if (part === 'legL' || part === 'shoeL') return rg === REG.legL || rg === REG.footL;
  if (part === 'legR' || part === 'shoeR') return rg === REG.legR || rg === REG.footR;
  return true;
}

function mergeIdx(list) { const out = []; let base = 0; for (const m of list) { for (const v of m.idx) out.push(v + base); base += m.pos.length / 3; } return Uint32Array.from(out); }

/** Limit check of a measureCostume summary: list of failures (empty = pass). */
export function checkCostumeLimits(summary, lim = COSTUME_LIMITS) {
  const fail = [];
  for (const [clip, S] of Object.entries(summary)) {
    const pokeLim = clip === 'Death' || clip.startsWith('ragdoll') ? lim.pokeVisibleExtreme : lim.pokeVisible;
    if (S.body.pokeVisibleFraction > pokeLim && S.body.pokeVisible > lim.pokeVisibleCount) fail.push(`${clip}: visible body poke ${S.body.pokeVisible} vertices (${S.body.pokeVisibleFraction})`);
    if (S.body.exposedHiddenFraction > lim.exposedHidden && S.body.exposedHidden > lim.exposedHiddenCount) fail.push(`${clip}: exposed hidden ${S.body.exposedHidden} vertices (${S.body.exposedHiddenFraction})`);
    for (const [pn, d] of Object.entries(S.clothDeep)) if (d > lim.clothDeep) fail.push(`${clip} ${pn}: cloth inside the body ${d}`);
    if (S.coverage) {
      if (S.coverage.apex < lim.apexCoverage) fail.push(`${clip}: apex coverage ${S.coverage.apex}`);
      if (S.coverage.groinCore < lim.groinCoreCoverage) fail.push(`${clip}: groin core coverage ${S.coverage.groinCore}`);
      if (S.coverage.groin < lim.groinCoverage) fail.push(`${clip}: groin coverage ${S.coverage.groin}`);
      // the torso band (a midriff between top and skirt) is gated in the standing / moving clips; a fallen / ragdoll frame reports it
      if (S.coverage.torso < lim.torsoCoverage && clip !== 'Death' && !clip.startsWith('ragdoll')) fail.push(`${clip}: torso coverage ${S.coverage.torso}`);
    }
  }
  return fail;
}
