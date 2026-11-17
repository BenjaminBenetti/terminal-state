// Task studio-subway-station-variety-20261117-043926-01: the Subway's version-2 PLAN FAMILIES and station IDENTITIES (pure data, no three.js).
//
// User: "do for the Subway what we did for Mall variety ... more lively areas, bigger ticketing locations, a station that feels more unknown,
// varied and exciting". Version 2 (gen/subwayLayoutVersion.ts) rolls a plan family per seed on its own salt: the CLASSIC share builds the
// seed's version-1 archetype exactly (gen/archetypes.ts, untouched), the rest build one of three new overall plans from the same carving
// kit (gen/stationKit.ts). Influences (reference/tasks/.../research/REFERENCES.md, no literal reconstruction, no real names or brand art):
//  - GRAND-HALL (great interchange ticket halls, e.g. the big Jubilee-line boxes): the platform's whole back wall opens by a run of stair
//    passages into a long, low PAID GATE GALLERY; across two or three gate banks lies ONE great double-height ticket hall — the station's
//    landmark — with its ticket office windows, machine banks, a waiting hall off one end, the district (food court / arcade / exits) off
//    the other end and the far wall;
//  - CAVERN (rock-cut cavern stations, e.g. Stockholm's painted bedrock): one tall rock vault over both side platforms and a COLUMN-FREE
//    bed, rough grotto niches off both platform walls (waiting alcoves), both platforms reached from ONE shared end hall at the tunnel end,
//    an inclined passage up from it to the rock-cut ticket hall and its district; the walls and roof are painted blasted rock;
//  - HUB (big interchange halls between lines): line 1's side platforms north, a single-track LINE 2 platform south, and between them one
//    PAID INTERCHANGE HALL both lines' stairs open into; its two ends are fare lines into two ticket halls, a full district beyond one and a
//    line-2 concourse with exits beyond the other.
// Every family yields the classic Plan contract (gen/archetypes.ts Plan): the shared passes of gen/station.ts tryGenerate then add exits,
// the agent office, washrooms, storefronts, back-of-house, the track extensions, dressing, spawns and lighting exactly as for the classic
// archetypes, and validateLayout holds every family to the same rules (platform >= 94 m, the full room set, fare gates, food court, exits,
// traversal, doorways, levels, extensions).
//
// IDENTITY: every version-2 station (classic share included) also carries `layout.identity` — pure style data drawn by world/subwayArch.ts
// with the station's EXISTING materials (tinted clones of the tile / the existing rock and cast-concrete sets): the public wall finish and its
// tint, the accent (line) colour of the tile bands and friezes, the wayfinding plate colours. A classic seed at version 2 is its version-1
// layout plus only that record.

import {Rng, hashString} from '../core/rng';
import {Kit, TUN} from './stationKit';
import {levelProgram} from './levelGen';
import {Plan, PATTERNS, arcade, district, exitHall, hall, r1, setP1, ticketHall, type Pattern} from './archetypes';
import {type Archetype, type Area, type Side, type StationIdentity} from './stationTypes';
import {SUBWAY_HALL_V3_MIN_VERSION} from './subwayLayoutVersion';
import {grandHallV3} from './stationHallV3'; // task studio-subway-architecture-materials-rework-20261117-072826-01

// ---------------------------------------------------------------------------------------------
// The roll

/** A version-2 plan family: the classic share (the seed's version-1 archetype) or one of the new plans. */
export type PlanFamily = 'classic' | 'grand-hall' | 'cavern' | 'hub';
/** Version 2's family weights (the classic archetypes keep 40 %; the three new plans share the rest evenly). */
export const PLAN_FAMILY_WEIGHTS: readonly (readonly [PlanFamily, number])[] = [['classic', 0.4], ['grand-hall', 0.2], ['cavern', 0.2], ['hub', 0.2]];

/** The version-2 plan family of a seed (its own salt: the version-1 archetype roll is untouched). */
export function planFamilyOf(seed: number): PlanFamily {
  return new Rng(hashString('subway-plan-family-v2', seed >>> 0)).weighted(PLAN_FAMILY_WEIGHTS as [PlanFamily, number][]);
}

export const isPlanFamily = (a: Archetype): a is 'grand-hall' | 'cavern' | 'hub' => a === 'grand-hall' || a === 'cavern' || a === 'hub';

/**
 * The skeleton of a version-2 plan family (null: this attempt does not fit; the generator retries like the classic archetypes).
 * (task studio-subway-architecture-materials-rework-20261117-072826-01: from layout version 3 the grand-hall family builds its great hall
 * sectioned, gen/stationHallV3.ts; `version` absent = 2, every other family is version 2's at any version)
 */
export function buildPlanFamily(k: Kit, arch: 'grand-hall' | 'cavern' | 'hub', terms: string[], version = 2): Plan | null {
  const plan = new Plan();
  const ok = arch === 'grand-hall' ? (version >= SUBWAY_HALL_V3_MIN_VERSION ? grandHallV3(k, plan, terms) : grandHall(k, plan, terms)) : arch === 'cavern' ? cavern(k, plan, terms) : hub(k, plan, terms);
  return ok && plan.foods.length ? plan : null;
}

// ---------------------------------------------------------------------------------------------
// GRAND-HALL

function grandHall(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceil = r1(rng.range(4.6, 5.2));
  const Lp = rng.int(250, 296);
  const blk = k.sideBlock(84, 56, Lp, ceil);
  plan.blocks.push(blk);
  const [P1, P2] = blk.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  setP1(plan, P1, [P2]);
  // Stacked levels as on every side station (cores behind both back walls; the passages slide off them).
  if (!levelProgram(k, blk)) return false;
  for (const s of ['W', 'E'] as const) plan.openEnds.push([P1, s], [P2, s]);
  plan.staffWalls.push([P2, 'N']);
  // A run of stair passages along the whole back wall into the low gate gallery (the paid side is only this strip).
  const pass = k.stairPassages(P1, 'S', rng.int(4, 5), 0.07, 0.93, rng.int(8, 11));
  if (pass.length < 3) return false;
  const G = k.mezzanine(pass, 'S', rng.int(10, 13), [rng.int(4, 12), rng.int(4, 12)], r1(rng.range(4.2, 4.6)), {label: 'Gate gallery', paid: true, role: 'gate-gallery'});
  if (!G) return false;
  plan.paidHalls.push(G);
  // The great hall: most of the gallery's length, 23-31 m deep, double height; two or three gate banks in their shared wall.
  const along = Math.max(110, G.w - rng.int(0, 24)), deep = rng.int(46, 62);
  const T = hall(k, G, 'S', along, deep, rng.int(-8, 8), 'fare-hall', r1(rng.range(7.2, 8.6)), {role: 'grand-ticket-hall', label: 'Grand ticket hall'});
  if (!T) return false;
  const banks = T.w >= 150 && rng.chance(0.5) ? [0.06, 0.5, 0.94] : [rng.range(0.04, 0.2), rng.range(0.8, 0.96)];
  let lines = 0;
  for (const p of banks) if (k.fareLine(G, T, rng.int(4, 6), p)) lines++;
  if (lines < 2) return false;
  plan.ticketHalls.push(T);
  plan.washHosts.push(T);
  // Street exits first in line: a bank of two stairs in the great hall's far wall.
  plan.exits.push({parent: T, side: 'S', frac: rng.range(0.18, 0.3)}, {parent: T, side: 'S', frac: rng.range(0.7, 0.82)});
  // The waiting hall off one end, the district off the other end and the far wall.
  const [wEnd, dEnd] = rng.shuffle(['W', 'E'] as Side[]);
  const W = hall(k, T, wEnd, rng.int(26, 36), rng.int(22, 30), rng.int(-6, 6), 'concourse', r1(rng.range(4.4, 5.0)), {role: 'waiting-hall', label: 'Waiting hall'});
  if (W) {
    if (k.connect(T, W, rng.int(10, 14), 4.0, {pick: 'mid', margin: 3})) { plan.washHosts.push(W); plan.frontages.push({hall: W, sides: [wEnd], mix: 'kiosk', max: 1}); }
    else k.undoLast(W);
  }
  if (!district(k, plan, T, 'S', [dEnd], rng.weighted(PATTERNS.filter(([p]) => p !== 'row') as [Pattern, number][]))) return false;
  // Retail pockets along the far wall between the exits: the district's kiosk frontage of the hall (one frontage per hall wall: two on
  // one wall would overlap their bays), far wall first and more of them.
  const tf = plan.frontages.find(f => f.hall === T);
  if (tf) { tf.sides = ['S', ...tf.sides.filter(s => s !== 'S')]; tf.max = rng.int(3, 5); }
  plan.notes.push(`grand:${T.w}x${T.h}`, `banks:${lines}`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// CAVERN

function cavern(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  // The rock vault over both platforms and the bed: 6.2-7 m (the light wells over the bed rise ~3.5 m higher), no centre columns (the
  // rock spans it). Taller vaults lift the upper galleries past what the stair cores' flight lighting is laid out for (levelGen).
  const ceil = r1(rng.range(6.2, 7.0));
  const Lp = rng.int(236, 280);
  const end = rng.pick(['W', 'E'] as const);
  const blk = k.sideBlock(end === 'W' ? 150 : 90, 62, Lp, ceil, ['Platform 1', 'Platform 2'], false);
  plan.blocks.push(blk);
  const [P1, P2] = blk.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  setP1(plan, P1, [P2]);
  // The galleries hang high in the vault; the player starts at the far end from the shared end hall.
  if (!levelProgram(k, blk, {spawnEnd: end === 'W' ? 'E' : 'W'})) return false;
  plan.openEnds.push([P1, end === 'W' ? 'E' : 'W'], [P2, end === 'W' ? 'E' : 'W']);
  // Grotto niches: rough waiting alcoves cut into both platform back walls (wide openings, low rock roofs).
  let grottos = 0;
  for (const [P, side] of [[P1, 'S'], [P2, 'N']] as const) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const w = rng.int(14, 24), d = rng.int(8, 12);
      const f = (i + 0.5) / n;
      const off = Math.round((f - 0.5) * (P.w - w - 40)) + rng.int(-10, 10);
      const N = k.attach(P, side, w, d, off, 'concourse', 'concourse', r1(rng.range(3.6, 4.6)), P.id, {label: 'Waiting grotto', paid: true, role: 'grotto'});
      if (!N) continue;
      if (!k.connect(P, N, Math.max(6, w - rng.int(4, 8)), 3.4, {pick: 'mid', margin: 2})) { k.undoLast(N); continue; }
      grottos++;
    }
  }
  if (grottos < 2) return false;
  // Both platforms end in passages along the tunnel walls to ONE end hall beyond the bed end (the express rule, for side platforms).
  const beyond = rng.int(3, 7);
  const EPa = k.endPassage(blk, P1, end, beyond, rng.int(9, 12));
  const EPb = k.endPassage(blk, P2, end, beyond, rng.int(9, 12));
  if (!EPa || !EPb) return false;
  const along = (blk.y1 - blk.y0 + 1) + rng.int(8, 18), deep = rng.int(22, 30);
  const cy = (blk.y0 + blk.y1) / 2 + rng.int(-4, 4);
  const r = {x: end === 'E' ? EPa.x + EPa.w + 1 : EPa.x - 1 - deep, y: Math.round(cy - along / 2), w: deep, h: along};
  if (!k.rectFree(r)) return false;
  const MH = k.addArea(r, 'concourse', 'concourse', r1(rng.range(6.0, 7.0)), EPa.id, {label: 'Cavern concourse', paid: true, role: 'end-hall'});
  if (!k.connect(EPa, MH, EPa.h - 2, 3.2, {pick: 'mid'}) || !k.connect(EPb, MH, EPb.h - 2, 3.2, {pick: 'mid'})) return false;
  plan.paidHalls.push(MH);
  // The inclined passage climbs away from the concourse (south) to the upper concourse and the rock-cut ticket hall.
  const ew = rng.int(10, 12);
  const IN = k.attach(MH, 'S', ew, rng.int(44, 70), rng.int(-4, 4), 'passage', 'passage', r1(rng.range(4.8, 5.4)), MH.id, {label: 'Inclined passage', paid: true, role: 'escalator'});
  if (!IN || !k.connect(MH, IN, ew - 2, 4.0, {pick: 'mid'})) return false;
  const UM = k.attach(IN, 'S', rng.int(30, 44), rng.int(14, 20), rng.int(-8, 8), 'concourse', 'concourse', r1(rng.range(4.8, 5.6)), IN.id, {label: 'Upper concourse', paid: true, role: 'mezzanine'});
  if (!UM || !k.connect(IN, UM, ew - 2, 4.0, {pick: 'mid'})) return false;
  plan.paidHalls.push(UM);
  const T = ticketHall(k, plan, UM, 'S', rng.int(46, 62), rng.int(30, 40), rng.int(-8, 8), rng.int(5, 6), 'Rock-cut ticket hall');
  if (!T) return false;
  if (!district(k, plan, T, 'S', ['W', 'E'], rng.weighted(PATTERNS))) return false;
  if (rng.chance(0.5)) plan.frontages.push({hall: MH, sides: [end], mix: 'kiosk', max: 1});
  plan.notes.push(`cavern:${end}`, `grottos:${grottos}`, `incline:${IN.h}`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// HUB

function hub(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const Lp1 = rng.int(236, 280);
  const blk1 = k.sideBlock(120, 48, Lp1, r1(rng.range(4.4, 4.9)));
  plan.blocks.push(blk1);
  const [P1, P2] = blk1.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  if (!levelProgram(k, blk1)) return false;
  for (const s of ['W', 'E'] as const) plan.openEnds.push([P1, s], [P2, s]);
  plan.staffWalls.push([P2, 'N']);
  // Line 1's stairs down the middle of its back wall into the interchange hall (paid, tall, 24-36 m deep).
  const PL = rng.int(8, 10);
  const pass1 = k.stairPassages(P1, 'S', rng.int(2, 3), 0.28, 0.72, PL);
  if (pass1.length < 2) return false;
  const H = k.mezzanine(pass1, 'S', rng.int(48, 72), [rng.int(8, 18), rng.int(8, 18)], r1(rng.range(5.8, 7.0)), {label: 'Interchange hall', paid: true, role: 'interchange-hall'});
  if (!H) return false;
  plan.paidHalls.push(H);
  // Line 2: a single-track platform under the hall's far wall, offset along the line; its stairs climb north into the hall.
  const PL2 = rng.int(8, 10), PW = rng.int(14, 17), Lp2 = rng.int(196, 236);
  const p2x = Math.round(H.x + H.w / 2 - Lp2 / 2) + rng.int(-24, 24);
  const y2 = H.y + H.h + 1 + PL2 + 1;
  if (!k.rectFree({x: p2x - TUN, y: y2, w: Lp2 + 2 * TUN, h: PW + 9})) return false;
  const blk2 = k.singleBlock(p2x, y2, Lp2, r1(rng.range(4.4, 5.0)), PW, 'Platform 3 · Line 2');
  plan.blocks.push(blk2);
  const P3 = blk2.platforms[0];
  P3.platformNo = 3; P3.towardsS = terms[2];
  setP1(plan, P1, [P2, P3]);
  plan.openEnds.push([P3, 'W'], [P3, 'E']);
  const ox0 = Math.max(H.x + 3, P3.x + 6), ox1 = Math.min(H.x + H.w - 3, P3.x + P3.w - 6);
  if (ox1 - ox0 < 30) return false;
  const pass2 = k.stairPassages(P3, 'N', rng.int(2, 3), (ox0 - P3.x) / P3.w, (ox1 - P3.x) / P3.w, PL2);
  if (pass2.length < 1) return false;
  for (const p of pass2) k.carveDoor({x: p.x, y: H.y + H.h, w: p.w, h: 1}, H, p, 3.2, true);
  // Ticket halls on both ends of the hall: the full district beyond one, the line-2 concourse and exits beyond the other.
  const [dEnd, cEnd] = rng.shuffle(['W', 'E'] as const);
  const TD = ticketHall(k, plan, H, dEnd, rng.int(36, 48), rng.int(28, 38), rng.int(-6, 6), rng.int(4, 6), `Ticket hall (${dEnd === 'W' ? 'west' : 'east'})`);
  if (!TD) return false;
  if (!district(k, plan, TD, dEnd, ['N', 'S'], rng.weighted(PATTERNS))) return false;
  const TC = ticketHall(k, plan, H, cEnd, rng.int(30, 40), rng.int(24, 32), rng.int(-6, 6), rng.int(3, 5), `Ticket hall (${cEnd === 'W' ? 'west' : 'east'})`);
  if (TC) {
    const R = arcade(k, plan, TC, cEnd, rng.int(30, 56), rng.int(-4, 4), 'Line 2 concourse');
    if (R) exitHall(k, plan, R, cEnd, rng.int(-6, 6));
    plan.exits.push({parent: TC, side: cEnd, frac: rng.range(0.3, 0.7)});
    plan.frontages.push({hall: TC, sides: ['N', 'S', cEnd], mix: 'kiosk', max: rng.int(1, 2)});
  }
  if (rng.chance(0.6)) plan.frontages.push({hall: H, sides: rng.shuffle(['N', 'S'] as Side[]), mix: 'kiosk', max: rng.int(1, 2)});
  plan.notes.push(`hub:${H.w}x${H.h}`, `line2:${P3.w}`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// IDENTITY

/** One station look: the public wall finish family and tint, accent (line) colour, wayfinding plate colours. Fictional, generic palettes. */
export interface StationTheme extends Omit<StationIdentity, 'theme'> { label: string }

export const STATION_THEMES: Readonly<Record<string, StationTheme>> = {
  // tile (the station's glazed tile set, tinted)
  heritage: {label: 'cream heritage tile, oxblood line', walls: 'tile', wallTint: 0xffffff, finishCeiling: false, accent: 0x7a2a26, plate: {bg: 0x1f2225, fg: 0xe8dfc6}},
  civic: {label: 'pale blue civic tile, navy line', walls: 'tile', wallTint: 0xc4d4e6, finishCeiling: false, accent: 0x23407a, plate: {bg: 0x1d2c4f, fg: 0xf2f2ea}},
  municipal: {label: 'sage municipal tile, bottle-green line', walls: 'tile', wallTint: 0xc9dcc4, finishCeiling: false, accent: 0x2d5a3a, plate: {bg: 0x23402c, fg: 0xf0eedd}},
  terracotta: {label: 'warm terracotta tile, ochre line', walls: 'tile', wallTint: 0xf2c6a6, finishCeiling: false, accent: 0xb8862b, plate: {bg: 0x2a211b, fg: 0xf6e7c8}},
  moderne: {label: 'white moderne tile, signal-red line', walls: 'tile', wallTint: 0xf4f4f6, finishCeiling: false, accent: 0xb3302a, plate: {bg: 0xf1f1ee, fg: 0x1d1d1f}},
  // board-formed cast concrete (the Reactor family's existing pit-concrete set: grand halls and interchanges)
  brutalist: {label: 'board-formed concrete, orange line', walls: 'concrete', wallTint: 0xd8d4cc, finishCeiling: true, accent: 0xc8641e, plate: {bg: 0x18191b, fg: 0xf2c230}},
  // painted blasted rock (the existing mine-rock set: the cavern family only)
  cavernBlue: {label: 'blue-painted bedrock', walls: 'rock', wallTint: 0x7fa6d8, finishCeiling: true, accent: 0x2c4f8a, plate: {bg: 0x15243f, fg: 0xf2f2ea}},
  cavernRed: {label: 'red-ochre painted bedrock', walls: 'rock', wallTint: 0xe08f74, finishCeiling: true, accent: 0x8a2e22, plate: {bg: 0x2a1a17, fg: 0xf3e2c8}},
  cavernGreen: {label: 'green-painted bedrock', walls: 'rock', wallTint: 0x9cc79a, finishCeiling: true, accent: 0x2f6f4a, plate: {bg: 0x1c2f22, fg: 0xeef0dc}},
  cavernBone: {label: 'whitewashed bedrock, cobalt line', walls: 'rock', wallTint: 0xf0ece2, finishCeiling: true, accent: 0x2f5fa8, plate: {bg: 0x1d2c4f, fg: 0xf4f2ea}},
};

const THEMES_BY_FAMILY: Readonly<Record<PlanFamily, readonly (readonly [string, number])[]>> = {
  classic: [['heritage', 1.4], ['civic', 1], ['municipal', 1], ['terracotta', 1], ['moderne', 0.8]],
  'grand-hall': [['moderne', 1], ['civic', 1], ['heritage', 0.8], ['brutalist', 1.2], ['terracotta', 0.6]],
  hub: [['brutalist', 1], ['civic', 1], ['municipal', 1], ['terracotta', 0.8], ['moderne', 0.8]],
  cavern: [['cavernBlue', 1], ['cavernRed', 1], ['cavernGreen', 1], ['cavernBone', 0.8]],
};

/** The family of a built station's archetype (a classic archetype = 'classic'). */
export const familyOfArchetype = (a: Archetype): PlanFamily => (isPlanFamily(a) ? a : 'classic');

/** A version-2 station's identity: a theme of its family, on its own salt (deterministic per seed; no generation draw is moved). */
export function stationIdentityOf(seed: number, arch: Archetype): StationIdentity {
  const fam = familyOfArchetype(arch);
  const theme = new Rng(hashString('subway-identity-v2', seed >>> 0)).weighted(THEMES_BY_FAMILY[fam] as [string, number][]);
  const {label: _label, ...look} = STATION_THEMES[theme];
  return {theme, ...look, plate: {...look.plate}};
}

/** Areas of a plan family's signature spaces (tests / QA): the great hall, the gate gallery, the interchange hall, grottos. */
export function signatureAreas(areas: readonly Area[]): Area[] {
  return areas.filter(a => a.role === 'grand-ticket-hall' || a.role === 'gate-gallery' || a.role === 'waiting-hall' || a.role === 'interchange-hall' || a.role === 'grotto');
}
