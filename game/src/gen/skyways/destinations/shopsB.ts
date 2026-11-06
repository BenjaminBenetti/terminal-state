// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-B (C)): the interiors of this lane's DESTINATION anchor shop families — each
// family's kit (kindsShopsB.ts) plus existing fixtures / holders, laid out over the anchor's floors / zones / back rooms
// (layout.skyways.anchors). Called by destinations/index.ts.
//
// Each family reads as its own place at a glance (the user: bigger, distinct, memorable; never an empty box or generic shelving with a sign):
//  - Glasshouse Garden Co.: rows of slatted plant benches with geranium pots on their measured tops, tall potted palms and planter trees along
//    the walls (height under the glasshouse roof), flower stands by the windows, a potting / cash counter with supplies behind it, garden
//    supplies on the back wall, a wheelbarrow, small potted plants, the garden poster;
//  - Starfall Arcade: a bank of arcade cabinets on the back wall, claw cranes along one side, back-to-back pinball rows and air-hockey tables
//    in the middle (the play strips are the aisles), a prize counter with a glass prize case and prize shelving, the giant teddy prize,
//    capsule-toy machines, a drinks machine, the arcade poster;
//  - Aurora Picture House: the LOBBY (box office with its rope queue, a concession counter with its warmer, the cooler and back counter behind
//    it, the popcorn cart, a snack rack, film posters, a waiting bench) and the AUDITORIUM behind it (four-seat cinema rows facing the SCREEN
//    on its far wall — the door wall is the projection side — side aisles, a centre aisle from the door and a back cross aisle, a few seat
//    blocks torn out);
//  - Big Sky Wonders: the tall rocket model as the centrepiece under the planet mobile (hung, clear underside), telescopes at the windows,
//    giant globes, display tables of science kits (microscopes, flasks, tube / bottle racks), a satellite model, device shelving, the counter;
//  - Blue Line Sports: the goalie display mannequin by the entry, goal nets on display, boxed-stock shelving along the walls, empty jersey rails,
//    a skate-fitting bench, a fitness corner (treadmill, bikes), the drinks cooler + snack rack at the till.
//
// Loot (root CLAUDE.md rule 1, docs/loot-tables.md): only EXISTING holder kinds; their rows come from the floor's purpose, the family's base use
// (carve.ts ANCHOR_FAMILIES[f].use: garden florist, arcade / science tech, cinema newsstand, hockey convenience) — finite, rolled once at runtime
// by the containers. No new item lists, no floor piles. Back rooms keep their back-of-house dressing (not dressed here).

import type {Rng} from '../../../core/rng';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../../props';
import {doorSide} from '../../placeKit';
import {stockVariant} from '../../purposeShapes';
import type {Area, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor, SkywaysShopFamily} from '../skywaysTypes';
import {OPP, doorBetween, hallFrame, xzUV, type HallFrame} from '../addonFrame';
import {PLANET_MOBILE_HANG, PLANT_BENCH_TOP, SKYD_SCREEN} from './kindsShopsB';
import {ShopsBDresser} from './skywaysShopsBKit';

export const SHOPS_B_FAMILIES: readonly SkywaysShopFamily[] = ['garden', 'arcade', 'cinema', 'science', 'hockey'];

/** What one anchor got (tests / QA): its props (layout order) and the pieces that found no room. */
export interface ShopsBResult { family: SkywaysShopFamily; props: PropPlacement[]; skipped: string[] }
/** The latest result per anchor id (tests / QA; rewritten by every generation). */
export const SHOPS_B_LAST = new Map<string, ShopsBResult>();

/** Dresses one anchor of this lane's families; returns the props placed. */
export function dressShopsB(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  const dress = FAMILY[anchor.family as ShopsBFamily];
  if (!dress) return 0;
  const d = new ShopsBDresser(layout, rng, anchor);
  dress(d);
  SHOPS_B_LAST.set(anchor.id, {family: anchor.family, props: d.placed, skipped: d.skipped});
  return d.count;
}

type ShopsBFamily = 'garden' | 'arcade' | 'cinema' | 'science' | 'hockey';
const FAMILY: Readonly<Record<ShopsBFamily, (d: ShopsBDresser) => void>> = {
  garden: dressGarden, arcade: dressArcade, cinema: dressCinema, science: dressScience, hockey: dressHockey,
};

// ---------------------------------------------------------------------------------------------
// Shared pieces

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const snap = (v: number) => Math.round(v * 2) / 2;
const sv = stockVariant;
type Region = {u0: number; u1: number; v0: number; v1: number};

/** The side wall (L / R) with more floor beside the entry (counters / long runs go there). */
const roomySide = (d: ShopsBDresser): 'L' | 'R' => (d.entryU >= d.W / 2 ? 'L' : 'R');
const otherSide = (w: 'L' | 'R'): 'L' | 'R' => (w === 'L' ? 'R' : 'L');
/** A placement's frame (u, v). */
const uvOf = (p: {x: number; z: number}, fr: HallFrame): [number, number] => xzUV(fr, p.x, p.z);

/** Staff aisle behind a counter run (m). */
const STAFF = 1.05;
/** Host-local x of a till's cash register (towards the counter's +x end). */
const REGISTER_X = r3(PROP_DEFS.shopCounter.w / 2 - PROP_DEFS.cashRegister.w / 2 - 0.12);

/**
 * A counter run (the till / prize / potting counter) parallel to side wall `w` from depth `v0`: `kinds` modules end to end facing into the
 * shop (a 0.9 m customer strip kept in front), a staff aisle behind them and the `back` units against the wall; a cash register on the first
 * counter. Returns the modules (counter + back units).
 */
function cashWrap(d: ShopsBDresser, w: 'L' | 'R', v0: number, kinds: readonly PropKind[], back: readonly [PropKind, number][] = []): PropPlacement[] {
  const backD = Math.max(0.45, ...back.map(([k]) => PROP_DEFS[k].d));
  const out: PropPlacement[] = [];
  const yaw = d.faceFrom(w);
  let v = v0;
  for (const k of kinds) {
    const def = PROP_DEFS[k], u = backD + 0.03 + STAFF + def.d / 2;
    const p = d.put(k, w === 'L' ? u : d.W - u, v + def.w / 2, yaw, {front: 0.9});
    if (p) out.push(p); else d.skipped.push(`counter ${k}`);
    v += def.w;
  }
  let t = v0;
  for (const [k, variant] of back) {
    const got = d.wallRow(w, k, t, Math.min(v + 0.6, d.D - 0.6), {max: 1, variant: () => variant});
    if (got.length) { out.push(...got); t = r3(Math.max(t + 0.5, uvOf(got[0], d.fr)[1] + PROP_DEFS[k].w / 2 + 0.3)); } else d.skipped.push(`behind counter ${k}`);
  }
  const till = out.find(p => p.kind === 'shopCounter');
  if (till) d.onTop(till, 'cashRegister', REGISTER_X, 0, SHOP_COUNTER_TOP_Y);
  return out;
}

/** Seeded half-metre spots of a frame region. */
function spotsIn(r: Region): [number, number][] {
  const out: [number, number][] = [];
  for (let u = snap(r.u0); u <= r.u1 + 1e-6; u += 0.5) for (let v = snap(r.v0); v <= r.v1 + 1e-6; v += 0.5) out.push([u, v]);
  return out;
}

/** Up to `n` islands of `kind` at seeded spots of a frame region (each keeps a walkway ring), at least `apart` m between centres. */
function islands(d: ShopsBDresser, kind: PropKind, n: number, r: Region, o: {ring?: number; yaw?: () => number; apart?: number} = {}): PropPlacement[] {
  const out: PropPlacement[] = [];
  if (n <= 0 || r.u1 < r.u0 || r.v1 < r.v0) return out;
  const apart = o.apart ?? 2.2;
  for (const [u, v] of d.rng.shuffle(spotsIn(r))) {
    if (out.length >= n) break;
    const [x, z] = d.xz(u, v);
    if (out.some(p => Math.hypot(p.x - x, p.z - z) < apart)) continue;
    const p = d.put(kind, u, v, o.yaw?.() ?? d.anyYaw(), {ring: o.ring ?? 0.8});
    if (p) out.push(p);
  }
  return out;
}

/** The free spot of a region nearest a frame point that takes `kind` (with a ring); null when none fits. */
function nearest(d: ShopsBDresser, kind: PropKind, cu: number, cv: number, r: Region, yaw: number, ring: number): PropPlacement | null {
  const spots = spotsIn(r).sort((a, b) => Math.hypot(a[0] - cu, a[1] - cv) - Math.hypot(b[0] - cu, b[1] - cv));
  for (const [u, v] of spots) { const p = d.put(kind, u, v, yaw, {ring}); if (p) return p; }
  return null;
}

/** `n` units of `kind` side by side along u from `u0` at depth `v`, facing `yaw`: one contiguous run (all or nothing). */
function rowAt(d: ShopsBDresser, kind: PropKind, u0: number, v: number, n: number, yaw: number, front: number, gap = 0.03): PropPlacement[] {
  const w = PROP_DEFS[kind].w;
  const items = Array.from({length: n}, (_, k) => { const [x, z] = d.xz(u0 + w / 2 + k * (w + gap), v); return {kind, x, z, rot: yaw}; });
  return d.putRow(items, d.floor, front);
}

/** Runs of up to `per` contiguous units along the band [u0, u1] at depth v (blocked / reserved floor skipped), `gap` m between runs. */
function bandRows(d: ShopsBDresser, kind: PropKind, u0: number, u1: number, v: number, per: number, yaw: number, front: number, gap = 1.4): PropPlacement[] {
  const w = PROP_DEFS[kind].w + 0.03, out: PropPlacement[] = [];
  let u = snap(u0);
  while (u + w <= u1 + 1e-6) {
    let got: PropPlacement[] = [];
    for (let n = Math.min(per, Math.floor((u1 - u) / w)); n >= 2 && !got.length; n--) got = rowAt(d, kind, u, v, n, yaw, front);
    if (got.length) { out.push(...got); u = snap(u + got.length * w + gap + 0.25); } else u += 0.5;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Glasshouse Garden Co.

function dressGarden(d: ShopsBDresser): void {
  const {W, D} = d;
  d.reserveLanes({mainTo: D - 2.4});
  const cs = roomySide(d), os = otherSide(cs);
  // the potting / cash counter near the front on the roomy side, garden supplies on the shelf behind it
  cashWrap(d, cs, 1.5, ['shopCounter', 'shopCounter'], [['stockShelf', sv('cleaning')]]);
  // flower stands by the windows on the other side
  if (!d.wallRow(os, 'flowerStand', 1.2, Math.min(D - 1.5, 5.0), {max: 2, gap: 0.5}).length) d.skipped.push('flower stands');
  // garden supplies along the back wall (holders)
  if (!d.wallRow('B', 'stockShelf', 1.0, W - 1.0, {gap: 0.3, max: d.rng.int(2, 4), variant: () => sv('cleaning')}).length) d.skipped.push('back shelving');
  // tall potted palms and planter trees along both side walls and in the back corners: height under the glass roof
  const tall: PropKind[] = ['skyDPottedPalm', 'planterTree'];
  let k = d.rng.int(0, 1);
  for (const w of ['L', 'R'] as const) {
    for (let t = w === cs ? 5.6 : (w === os ? 5.4 : 3.2); t <= D - 1.0; t += d.rng.range(2.4, 3.0)) {
      const kind = tall[k++ % 2], half = PROP_DEFS[kind].w / 2 + 0.05;
      d.put(kind, w === 'L' ? half : W - half, snap(t), d.faceFrom(w));
    }
  }
  const ph = PROP_DEFS.skyDPottedPalm.w / 2 + 0.05;
  for (const u of [ph, W - ph]) d.put('skyDPottedPalm', u, D - ph, d.anyYaw());
  // the bench field: rows of slatted plant benches (pairs end to end, cross aisles between them), geranium pots on their tops
  const bw = PROP_DEFS.skyDPlantBench.w, bd = PROP_DEFS.skyDPlantBench.d;
  const uA = 2.8, uB = W - 2.8, vEnd = D - PROP_DEFS.stockShelf.d - 1.5;
  const benches: PropPlacement[] = [];
  for (let v = 3.5; v + bd <= vEnd + 1e-6; v += bd + 1.5) {
    let u = uA;
    while (u + bw <= uB + 1e-6) {
      const n = u + 2 * bw <= uB + 1e-6 ? 2 : 1;
      let got = 0;
      for (let j = 0; j < n; j++) { const p = d.put('skyDPlantBench', u + bw / 2 + j * bw, v + bd / 2, d.fr.toFront); if (!p) break; benches.push(p); got++; }
      u = got ? u + got * bw + 1.5 : u + 0.5;
    }
  }
  if (!benches.length) d.skipped.push('plant benches');
  potBenches(d, benches);
  // the wheelbarrow: in the front zone on the flower-stand side, else anywhere on the floor
  const wb = islands(d, 'skyDWheelbarrow', 1, {u0: os === 'L' ? 2.4 : W * 0.5, u1: os === 'L' ? W * 0.5 : W - 2.4, v0: 1.8, v1: Math.min(3.0, D - 2)}, {ring: 0.5, yaw: () => d.rng.pick([d.fr.plusU, d.fr.minusU])});
  if (!wb.length && !islands(d, 'skyDWheelbarrow', 1, {u0: 1.5, u1: W - 1.5, v0: 2.0, v1: D - 2.0}, {ring: 0.5}).length) d.skipped.push('wheelbarrow');
  // small potted plants by the stands and the windows
  islands(d, 'pottedPlantSmall', d.rng.int(2, 4), {u0: 1.0, u1: W - 1.0, v0: 1.4, v1: 3.2}, {ring: 0.4, apart: 1.2});
  if (!d.posters(1).length) d.skipped.push('poster');
}

/** Geranium pots on the benches' measured tops: a grid of slots over each top, about 60 % filled, at least two per bench. */
function potBenches(d: ShopsBDresser, benches: readonly PropPlacement[]): void {
  const bw = PROP_DEFS.skyDPlantBench.w, bd = PROP_DEFS.skyDPlantBench.d, top = PLANT_BENCH_TOP(), pot = PROP_DEFS.skyDGeraniumPot;
  const cols = Math.max(1, Math.floor((bw - 0.1) / (pot.w + 0.08))), rows = bd - 0.08 >= 2 * pot.d + 0.06 ? 2 : 1;
  const slots: [number, number][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) slots.push([r3(-bw / 2 + (bw / cols) * (i + 0.5)), rows === 1 ? 0 : r3((j ? 1 : -1) * bd / 4)]);
  for (const b of benches) {
    const take = d.rng.shuffle(slots.slice()).slice(0, Math.max(2, Math.round(slots.length * d.rng.range(0.45, 0.75))));
    for (const [lx, lz] of take) d.onTop(b, 'skyDGeraniumPot', lx, lz, top, d.anyYaw());
  }
}

// ---------------------------------------------------------------------------------------------
// Starfall Arcade

function dressArcade(d: ShopsBDresser): void {
  const {W, D} = d;
  d.reserveLanes({mainTo: D - 1.8});
  const ps = roomySide(d), cl = otherSide(ps);
  // the prize counter: a till counter + the glass prize case, prize shelving behind; the giant teddy prize beside it
  const counter = cashWrap(d, ps, 1.4, ['shopCounter', 'showcase'], [['stockShelf', sv('cartons')]]);
  const pc = counter.find(p => p.kind === 'showcase') ?? counter[0];
  if (pc) {
    const [pu, pv] = uvOf(pc, d.fr);
    if (!nearest(d, 'giantTeddy', pu + (ps === 'L' ? 1.7 : -1.7), pv + 1.4, {u0: 1.2, u1: W - 1.2, v0: 1.4, v1: Math.min(D - 2, 6)}, d.fr.toFront, 0.4)) d.skipped.push('teddy');
  }
  // the back wall: a bank of arcade cabinets (play space kept in front)
  if (!d.wallRow('B', 'arcadeCabinet', 0.4, W - 0.4, {run: 6, gap: 0.03, front: 1.0}).length) d.skipped.push('cabinets');
  // claw cranes along the other side wall
  if (!d.wallRow(cl, 'skyDClawCrane', 2.2, D - 1.3, {run: 4, gap: 0.05, front: 1.0}).length) d.skipped.push('claw cranes');
  // capsule-toy machines and the drinks machine along the prize side, beyond the counter
  const vc = 1.4 + PROP_DEFS.shopCounter.w + PROP_DEFS.showcase.w + 1.2;
  d.wallRow(ps, 'capsuleToyMachine', vc, Math.min(D - 1.3, vc + 2.4), {run: 4, gap: 0.05, front: 0.8});
  if (!d.wallRow(ps, 'vending', vc + 2.6, D - 1.2, {max: 1, front: 1.0}).length && !d.wallRow(cl, 'vending', 0.6, 2.2, {max: 1, front: 1.0}).length) d.skipped.push('vending');
  // the middle: air-hockey tables and (back-to-back) pinball rows in bands; the play strips in front of each row are the aisles
  const inL = PROP_DEFS.skyDClawCrane.d + 1.0 + 0.4, inR = PROP_DEFS.capsuleToyMachine.d + 0.8 + 0.4;
  const u0 = cl === 'L' ? inL : inR, u1 = W - (cl === 'L' ? inR : inL);
  const vA = 2.4, vB = D - PROP_DEFS.arcadeCabinet.d - 1.0 - 0.3;
  const pd = PROP_DEFS.skyDPinball.d, ad = PROP_DEFS.skyDAirHockey.d;
  const PB2 = 0.9 + 2 * pd + 0.9, PB1 = 0.9 + pd, AH = 0.6 + ad + 0.6, R = vB - vA;
  const plan: ('PB2' | 'PB1' | 'AH')[] = R >= PB2 + 2 * AH ? ['AH', 'PB2', 'AH'] : R >= PB2 + AH ? ['AH', 'PB2'] : R >= AH + PB1 ? ['AH', 'PB1'] : R >= PB1 ? ['PB1'] : [];
  let v = vA, pins = 0, hockey = 0;
  for (const b of plan) {
    if (b === 'AH') {
      const cv = snap(v + 0.6 + ad / 2);
      hockey += islands(d, 'skyDAirHockey', d.rng.int(1, 3), {u0: u0 + 1.6, u1: u1 - 1.6, v0: cv, v1: cv}, {ring: 0.9, yaw: () => d.fr.toFront, apart: 4.2}).length;
      v += AH;
      continue;
    }
    const ra = bandRows(d, 'skyDPinball', u0, u1, v + 0.9 + pd / 2, d.rng.int(4, 6), d.fr.toFront, 0.9);
    pins += ra.length;
    if (b === 'PB2') {
      // the second row back to back behind the first (backboxes touching), one unit behind each of the first row's
      for (const p of ra) pins += rowAt(d, 'skyDPinball', uvOf(p, d.fr)[0] - PROP_DEFS.skyDPinball.w / 2, v + 0.9 + pd + pd / 2, 1, d.fr.toBack, 0.9).length;
      v += PB2;
    } else v += PB1;
  }
  if (!hockey && !islands(d, 'skyDAirHockey', 1, {u0: 2.0, u1: W - 2.0, v0: 1.6, v1: D - 2.0}, {ring: 0.9, yaw: () => d.fr.toFront}).length) d.skipped.push('air hockey');
  if (!pins) d.skipped.push('pinball');
  if (!d.posters(1).length) d.skipped.push('poster');
}

// ---------------------------------------------------------------------------------------------
// Aurora Picture House: the lobby (the sales floor) and the auditorium (its zone)

function dressCinema(d: ShopsBDresser): void {
  const {W, D} = d;
  const aud = d.anchor.zones.map(id => d.layout.areas[id]).find(Boolean);
  const audDoor = aud ? d.doors.find(fd => fd.to === aud.id) : undefined;
  // lanes: the entry straight in, then along the lobby's front half to the auditorium door / any back-room door (the concession counter
  // stands at the back wall)
  const vMid = Math.max(1.4, Math.min(2.2, D / 2 - 0.4));
  d.keepUV(d.entryU, 0, d.entryU, Math.min(3, D - 1), Math.max(0.75, Math.min(1.1, d.entryHalf)));
  for (const fd of d.doors) d.laneTo(fd, vMid);
  // --- the concession: counter modules + the warmer facing the lobby on the roomier side of the auditorium door, a staff aisle, the cooler
  // and the back counter against the back wall, the snack rack at its outer end, the popcorn cart out on the lobby floor
  const du = audDoor?.u ?? W / 2;
  const cSide: 'L' | 'R' = du - 1.4 >= W - du - 1.4 ? 'L' : 'R';
  const room: [number, number] = cSide === 'L' ? [1.6, du - 1.2] : [du + 1.2, W - 1.6];
  const mods = (['shopCounter', 'shopDisplay', 'shopCounter'] as PropKind[]).slice(0, Math.max(1, Math.min(3, Math.floor((room[1] - room[0]) / 1.5))));
  const runW = mods.reduce((s, k) => s + PROP_DEFS[k].w, 0);
  const startU = cSide === 'L' ? room[1] - runW : room[0];
  const cv = D - PROP_DEFS.shopBackbar.d - 0.03 - STAFF - PROP_DEFS.shopCounter.d / 2;
  const counter: PropPlacement[] = [];
  let u = startU;
  for (const k of mods) {
    const p = d.put(k, u + PROP_DEFS[k].w / 2, cv, d.fr.toFront, {front: 0.9});
    if (p) counter.push(p); else d.skipped.push(`concession ${k}`);
    u += PROP_DEFS[k].w;
  }
  const till = counter.find(p => p.kind === 'shopCounter');
  if (till) d.onTop(till, 'cashRegister', REGISTER_X, 0, SHOP_COUNTER_TOP_Y);
  const cool = d.wallRow('B', 'shopCooler', startU, startU + 1.0, {max: 1});
  const bb = d.wallRow('B', 'shopBackbar', startU + (cool.length ? 1.05 : 0), Math.max(startU + 1.9, startU + runW + 0.2), {max: 2, gap: 0.3});
  if (!cool.length && !bb.length) d.skipped.push('back counter');
  const outerU = cSide === 'L' ? startU - 0.45 : startU + runW + 0.45;
  if (!d.put('snackRack', outerU, cv, d.fr.toFront)) d.skipped.push('snack rack');
  if (!nearest(d, 'skyDPopcornCart', outerU + (cSide === 'L' ? 0.6 : -0.6), cv - 1.7, {u0: 0.8, u1: W - 0.8, v0: 1.4, v1: D - 0.8}, d.fr.toFront, 0.3)) d.skipped.push('popcorn cart');
  // --- the box office by the entry (its window toward the entry lane) with a rope queue off its window
  const bSide: 'L' | 'R' = d.entryU >= W / 2 ? 'L' : 'R', s = bSide === 'L' ? 1 : -1;
  const bk = PROP_DEFS.skyDTicketBooth, yaw = bSide === 'L' ? d.fr.plusU : d.fr.minusU;
  const bu = d.entryU - s * (d.entryHalf + 2.4 + bk.d / 2), bv = 1.1 + bk.w / 2;
  const booth = d.put('skyDTicketBooth', bu, bv, yaw) ?? nearest(d, 'skyDTicketBooth', bu, bv, {u0: 1.0, u1: W - 1.0, v0: 1.6, v1: D - 1.6}, yaw, 0);
  if (booth) {
    const [b0, b1] = uvOf(booth, d.fr), face = b0 + s * (bk.d / 2);
    for (const dv of [-0.65, 0.65]) for (let k = 0; k < 3; k++) d.putRound('skywaysPrizeStanchion', face + s * (0.5 + k * 0.9), b1 + dv, 0);
  } else d.skipped.push('ticket booth');
  // a waiting bench, a bin by the auditorium door, the film posters on the lobby walls
  d.wallRow(otherSide(cSide), 'bench', 2.2, D - 0.8, {max: 1});
  if (audDoor) d.put('bin', audDoor.u + (cSide === 'L' ? 1.6 : -1.6), D - 0.45, d.fr.toFront);
  if (d.posters(3, ['L', 'R', 'B']).length < 2) d.skipped.push('posters');
  if (aud) dressAuditorium(d, aud);
}

/** How many `w` blocks fit a span in groups of <= 3 with 1.2 m aisles between groups; the group sizes. */
function seatGroups(span: number, w: number): number[] {
  for (let n = Math.floor(span / w); n > 0; n--) {
    const g = Math.ceil(n / 3);
    if (n * w + (g - 1) * 1.2 <= span + 1e-6) return Array.from({length: g}, (_, i) => (i < g - 1 ? 3 : n - 3 * (g - 1)));
  }
  return [];
}

/** The auditorium: the screen on its screen wall, seat rows facing it, the aisles from its door kept. */
function dressAuditorium(d: ShopsBDresser, aud: Area): void {
  const door = doorBetween(d.layout, d.floor.id, aud.id);
  if (!door) { d.skipped.push('auditorium door'); return; }
  const dside = doorSide(door, aud);
  // the screen on the FAR wall, facing the lobby door (lead / lane AUDIO: the projector loop sits on the door wall, the projection side)
  const screenSide = OPP[dside];
  const fa = hallFrame(aud, screenSide);
  const W = fa.W, D = fa.D, base = aud.floorY ?? d.base, clear = aud.ceil - base;
  // the screen (code-drawn), centred on its wall, its frame bottom lowered in a low room
  const sy = Math.max(SKYD_SCREEN.minY, Math.min(SKYD_SCREEN.y, clear - (SKYD_SCREEN.h + 2 * SKYD_SCREEN.border) - SKYD_SCREEN.ceilGap));
  const [sx, sz] = d.xz(W / 2, 0, fa);
  if (!d.mount(aud, screenSide, screenSide === 'N' || screenSide === 'S' ? sx : sz, 'skyDCinemaScreen', r3(sy))) d.skipped.push('screen');
  // the door (on the back wall of this frame) and the aisles: both side aisles, a centre aisle from the door to the front, a back cross aisle
  const [du] = uvOf({x: (door.x + door.w / 2) * 0.5, z: (door.y + door.h / 2) * 0.5}, fa);
  const SIDE = 1.1, BACK = 1.5;
  d.keepUV(SIDE / 2, 2.4, SIDE / 2, D - 0.4, SIDE / 2, fa);
  d.keepUV(W - SIDE / 2, 2.4, W - SIDE / 2, D - 0.4, SIDE / 2, fa);
  d.keepUV(du, D, du, 2.4, 0.7, fa);
  d.keepUV(0, D - BACK / 2, W, D - BACK / 2, BACK / 2, fa);
  // seat rows: from 3.2 m off the screen to the back aisle, groups of up to three 4-seat rows between the aisles; a few blocks torn out
  const sd = PROP_DEFS.skyDCinemaSeats.d, swd = PROP_DEFS.skyDCinemaSeats.w;
  let blocks = 0;
  for (let v = 3.2; v + sd <= D - BACK + 1e-6; v += 1.05) {
    for (const [a, b] of [[SIDE, du - 0.75], [du + 0.75, W - SIDE]] as const) {
      const groups = seatGroups(b - a, swd);
      const total = groups.reduce((s, q) => s + q, 0) * swd + Math.max(0, groups.length - 1) * 1.2;
      let u = a + (b - a - total) / 2;
      for (const n of groups) {
        let items: {kind: PropKind; x: number; z: number; rot: number}[] = [];
        for (let k = 0; k < n; k++) {
          if (d.rng.chance(0.06)) { blocks += d.putRow(items, aud).length; items = []; continue; } // torn out
          const [x, z] = d.xz(u + swd / 2 + k * swd, v + sd / 2, fa);
          items.push({kind: 'skyDCinemaSeats', x, z, rot: fa.toFront});
        }
        blocks += d.putRow(items, aud).length;
        u += n * swd + 1.2;
      }
    }
  }
  if (!blocks) d.skipped.push('seat rows');
}

// ---------------------------------------------------------------------------------------------
// Big Sky Wonders

const SCIENCE_KITS: readonly PropKind[] = ['labMicroscope', 'labFlaskLarge', 'labTubeRack', 'labBottleRack'];

function dressScience(d: ShopsBDresser): void {
  const {W, D} = d;
  d.reserveLanes({mainTo: Math.min(D - 2.0, 3.2)});
  const cs = roomySide(d), os = otherSide(cs);
  cashWrap(d, cs, 1.5, ['shopCounter', 'shopCounter'], [['stockShelf', sv('devices')]]);
  // telescopes at the windows either side of the entry, aimed out through the glass
  let scopes = 0;
  for (const off of [2.2, 3.8]) for (const s of [-1, 1]) {
    const u = d.entryU + s * (d.entryHalf + off);
    if (scopes < 3 && u > 1.0 && u < W - 1.0 && d.put('skyDTelescope', u, 1.6, d.fr.toFront, {ring: 0.3})) scopes++;
  }
  if (!scopes && !islands(d, 'skyDTelescope', 1, {u0: 1.0, u1: W - 1.0, v0: 1.4, v1: 3.0}, {ring: 0.3, yaw: () => d.fr.toFront}).length) d.skipped.push('telescope');
  // the centrepiece rocket near the middle of the floor (a ring kept round it), the planet mobile hung over it
  const rocket = nearest(d, 'skyDRocketModel', W / 2, Math.max(4.2, D * 0.52), {u0: 2.5, u1: W - 2.5, v0: 3.4, v1: D - 2.4}, d.fr.toFront, 1.2);
  if (!rocket) d.skipped.push('rocket');
  const [rx, rz] = rocket ? [rocket.x, rocket.z] : d.xz(W / 2, D / 2);
  const cands: [number, number][] = [];
  for (let a = -3; a <= 3; a += 0.5) for (let b = -3; b <= 3; b += 0.5) cands.push([rx + a, rz + b]);
  cands.sort((p, q) => Math.hypot(p[0] - rx, p[1] - rz) - Math.hypot(q[0] - rx, q[1] - rz));
  const hangY = PLANET_MOBILE_HANG();
  if (!cands.some(([x, z]) => d.hang(d.floor, 'skyDPlanetMobile', x, z, hangY))) d.skipped.push(`planet mobile (clear ${d.clear.toFixed(2)} m)`);
  // giant globes, display tables of science kits (on-host: their spans cut out of the tables' loot tops), a satellite model
  const mid: Region = {u0: 2.0, u1: W - 2.0, v0: 3.0, v1: D - 2.2};
  if (!islands(d, 'skyDGiantGlobe', d.rng.int(2, 3), mid, {ring: 0.6}).length) d.skipped.push('globes');
  const tables = islands(d, 'merchTable', Math.max(2, Math.min(4, Math.floor(W * D / 45))), mid, {ring: 0.9, yaw: () => d.rng.pick([d.fr.toFront, d.fr.plusU])});
  if (!tables.length) d.skipped.push('display tables');
  const tw = PROP_DEFS.merchTable.w, top = PROP_DEFS.merchTable.h;
  for (const t of tables) {
    const kits = d.rng.shuffle(SCIENCE_KITS.slice()).slice(0, d.rng.int(2, 3));
    kits.forEach((k, i) => d.onTop(t, k, r3((i - (kits.length - 1) / 2) * (tw / 3.2)), 0, top));
  }
  islands(d, 'satelliteModel', d.rng.int(0, 1), mid, {ring: 0.7});
  // device / kit shelving along the other side wall and the back wall (holders)
  const side = d.wallRow(os, 'stockShelf', 3.6, D - 0.8, {gap: 0.3, variant: () => sv('devices')});
  const back = d.wallRow('B', 'stockShelf', 1.0, W - 1.0, {gap: 0.3, max: d.rng.int(2, 3), variant: () => sv(d.rng.pick(['devices', 'parts'] as const))});
  if (!side.length && !back.length) d.skipped.push('shelving');
  if (!d.posters(1).length) d.skipped.push('poster');
}

// ---------------------------------------------------------------------------------------------
// Blue Line Sports

function dressHockey(d: ShopsBDresser): void {
  const {W, D} = d;
  d.reserveLanes({mainTo: D - 2.2});
  const cs = roomySide(d), os = otherSide(cs);
  // the till: two counters with the drinks cooler and boxed stock behind them, the snack rack (energy bars) past their end
  const counter = cashWrap(d, cs, 1.5, ['shopCounter', 'shopCounter'], [['shopCooler', 0], ['stockShelf', sv('cartons')]]);
  if (counter.some(p => p.kind === 'shopCounter')) {
    const cu = Math.max(0.45, PROP_DEFS.shopCooler.d) + 0.03 + STAFF + PROP_DEFS.shopCounter.d / 2;
    if (!d.put('snackRack', cs === 'L' ? cu : W - cu, 1.5 + 2 * PROP_DEFS.shopCounter.w + 0.6, d.faceFrom(cs))) d.skipped.push('snack rack');
  }
  // the goalie display mannequin by the entry, facing it
  const gu = d.entryU + (d.entryU < W / 2 ? 1 : -1) * (d.entryHalf + 1.4);
  if (!d.put('skyDGoalieMannequin', gu, 2.0, d.fr.toFront, {ring: 0.4}) && !nearest(d, 'skyDGoalieMannequin', gu, 2.2, {u0: 1.0, u1: W - 1.0, v0: 1.4, v1: D - 2}, d.fr.toFront, 0.4)) d.skipped.push('goalie');
  // goal nets: one on display against the back wall, one out on the floor facing the entry
  const backNet = d.wallRow('B', 'skyDHockeyNet', Math.max(1.0, W / 2 - 2.6), Math.min(W - 1.0, W / 2 + 2.6), {max: 1});
  const floorNet = islands(d, 'skyDHockeyNet', 1, {u0: 2.5, u1: W - 2.5, v0: 3.4, v1: D - 2.6}, {ring: 0.8, yaw: () => d.fr.toFront});
  if (!backNet.length && !floorNet.length) d.skipped.push('nets');
  // boxed-stock shelving along the other side wall and beside the till (holders)
  if (!d.wallRow(os, 'stockShelf', 2.6, D - 0.8, {gap: 0.3, variant: () => sv('cartons')}).length) d.skipped.push('shelving');
  d.wallRow(cs, 'stockShelf', 1.5 + 2 * PROP_DEFS.shopCounter.w + 1.6, D - 0.8, {gap: 0.3, max: 3, variant: () => sv('cartons')});
  // empty jersey rails, a skate-fitting bench, the fitness corner
  const mid: Region = {u0: 2.2, u1: W - 2.2, v0: 3.0, v1: D - 2.2};
  islands(d, 'garmentRail', d.rng.int(2, 3), mid, {ring: 0.8, yaw: () => d.rng.pick([d.fr.toFront, d.fr.plusU])});
  islands(d, 'fittingBench', d.rng.int(1, 2), mid, {ring: 0.6, yaw: () => d.rng.pick([d.fr.toFront, d.fr.plusU])});
  if (d.rng.chance(0.6)) d.wallRow('B', 'treadmill', 0.6, Math.max(0.6, W / 2 - 2.8), {max: 1, front: 0.8});
  if (d.rng.chance(0.6)) d.wallRow('B', 'bicycle', W / 2 + 2.8, W - 0.6, {max: d.rng.int(1, 2), gap: 0.4});
  if (!d.posters(1).length) d.skipped.push('poster');
}
