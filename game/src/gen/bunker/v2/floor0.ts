// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 0, THE STATION (contract: gen/bunker/v2/floorApi.ts; frame:
// gen/bunker/v2/spine.ts). The shelter's public face: where a civil-defence shelter took in the people its trains brought down.
//
// The ADMISSION SEQUENCE, from the train to the vault door (rows 25-50 between the platform wall and the bulkhead):
//  - the PLATFORM (spine) keeps its station dressing; latecomers who never got in slept on it (overflow berths on its back wall);
//  - three portals in the platform wall: the central one ON THE VAULT AXIS (the player's start faces it), one into each low side hall;
//  - the VAULT HALL (centre, 6.4 m: the one tall room of the storey) — the processional aisle runs straight from the portal to the blast
//    door; the checkpoint line (two marshals' booths and crowd barriers) splits it into the outer forecourt and the cleared inner
//    apron before the door;
//  - the REGISTRATION HALL (low, 3.6 m) on one side — queue pens, the counter line of clerks' desks, the records side behind it; two
//    narrow inspection gates lead from it into the vault hall's forecourt; the MARSHALS' POST behind it opens a side door onto the apron;
//  - the WAITING HALL (low, 3.6 m) on the other side — open to the vault hall through an arcade of piers: rows of benches facing the
//    door, luggage, bedrolls of families who waited for their group to be called; off it the MEDICAL INSPECTION post and, behind that,
//    the OBSERVATION WARD (a dead end, its lights failing: arrivals held there for a fever or a wound);
//  - SURRENDERED PROPERTY at the far end of the registration side (baggage over the allowance, receipts at the counter).
// The VAULT SIDE (behind the bulkhead, off the spine's vestibule only): RECEIVING (goods in, beside the cargo lift's landing) and the
// BILLETING OFFICE (where the admitted were given their level and dormitory before going down the main stair).
//
// Scale rhythm: platform 5.2 m → portal 3.2 m → vault hall 6.4 m (release) ↔ side halls 3.6 m (compression) → rooms 3.2-3.4 m; the
// inspection gates (1.5 m) and the marshals' door are the constrained links, the arcade the open one.
// Loot by purpose (the station reads as admission): admission kits at the registration counter (the shelter lock's supply table),
// personal belongings in the waiting hall (dormitory rows), surrendered baggage (lost property), the marshals' security office, the
// medical inspection's first-aid stock, receiving's stores, the billeting office's desk / safe. No gas, no generator, no core here.

import {CELL} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Rect, Side, StationLayout} from '../../stationTypes';
import {cellsOfBox, tryPlaceProp, wallRange, wallSpot} from '../../placeKit';
import {BUNKER_PURPOSE} from '../../reactor/complex/bunkerPurposes';
import {doorPlate, rotFacing, scanWall, sealOrDrop, wallSign, type Dx} from '../../reactor/complex/bunkerDress';
import {shelterDx} from '../dress';
import {bunkerShortName} from '../names';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult, FloorDressCtx} from './floorApi';
import {V2} from './spine';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 4) / 4;

/** Clear heights (m above the station floor). */
export const F0_CLEAR = {vaultHall: 6.4, sideHall: 3.6, room: 3.2, ward: 3.4, receiving: 4.8} as const;

/** The floor's area keys (FloorCarveResult.areas). */
export const F0_KEYS = ['vaultHall', 'registration', 'marshals', 'waiting', 'property', 'medical', 'observation', 'receiving', 'billeting'] as const;
export type F0Key = (typeof F0_KEYS)[number];

/** Area labels (docs / QA / tests). */
export const F0_LABELS: Readonly<Record<F0Key, string>> = {
  vaultHall: 'Vault hall', registration: 'Registration hall', marshals: "Marshals' post", waiting: 'Waiting hall', property: 'Surrendered property',
  medical: 'Medical inspection', observation: 'Observation ward', receiving: 'Receiving', billeting: 'Billeting office',
};

/** QA: what the last dress did. */
export const F0_STATS = {removed: 0, props: 0, decor: 0, signs: 0, lights: 0, skipped: [] as string[]};

// ---------------------------------------------------------------------------------------------------------------------------------
// Carve

function carve(ctx: FloorCarveCtx): FloorCarveResult | null {
  const S = V2.station, rng = ctx.rng;
  const platform = ctx.k.areas.find(a => a.type === 'platform');
  const vest = ctx.k.areas.find(a => a.label === 'Vault vestibule');
  if (!platform || !vest) return null;
  const y0 = S.arrivalY0, H = S.bulkheadY - y0; // rows 25..50
  const wallY = platform.y + platform.h; // the platform's south wall row (24)
  const areas: Record<string, number> = {};
  const add = (key: F0Key, r: Rect, kind: Area['kind'], type: Area['type'], clear: number, parent: number, purpose?: string, publicSpace = false): Area | null => {
    const a = ctx.room(r, kind, type, clear, parent, {label: F0_LABELS[key], publicSpace, ...(purpose ? {purpose} : {})});
    if (a) areas[key] = a.id;
    return a;
  };
  // --- the vault hall: symmetric about the lane's centre (x0 + x1 = 2 * 55.5) --------------------------------------------------------
  const lane2 = S.laneX * 2 + S.laneW; // 111
  const fx0 = rng.chance(0.5) ? 41 : 42, fw = lane2 - 2 * fx0; // 29 / 27 cells
  const hall = add('vaultHall', R(fx0, y0, fw, H), 'concourse', 'concourse', F0_CLEAR.vaultHall, platform.id, undefined, true);
  if (!hall) return null;
  const wW = fx0 - 1, wE = fx0 + fw; // the hall's side wall columns
  // --- the registration side (west) and the waiting side (east) -------------------------------------------------------------------
  const sx0 = 22, regH = rng.pick([14, 15, 16]); // registration hall rows y0 .. y0 + regH - 1, the marshals' post under it
  const reg = add('registration', R(sx0, y0, wW - sx0, regH), 'room', 'crew-room', F0_CLEAR.sideHall, platform.id, BUNKER_PURPOSE.lock, true);
  const mar = add('marshals', R(sx0, y0 + regH + 1, wW - sx0, H - regH - 1), 'room', 'agent-office', F0_CLEAR.room, reg?.id ?? -1, 'security-office');
  const ex1 = 90; // the waiting hall's east wall column
  const wait = add('waiting', R(wE + 1, y0, ex1 - wE - 1, H), 'room', 'crew-room', F0_CLEAR.sideHall, platform.id, BUNKER_PURPOSE.dorm, true);
  if (!reg || !mar || !wait) return null;
  const prop = add('property', R(7, y0, sx0 - 1 - 7, H), 'room', 'storage', F0_CLEAR.room, reg.id, 'lost-property');
  const medW = rng.pick([17, 18, 19]);
  const med = add('medical', R(ex1 + 1, y0, medW, H), 'room', 'crew-room', F0_CLEAR.ward, wait.id, 'first-aid-room');
  if (!prop || !med) return null;
  const ox0 = ex1 + 1 + medW + 1;
  const obs = add('observation', R(ox0, y0, 133 - ox0, H), 'room', 'crew-room', F0_CLEAR.room, med.id, BUNKER_PURPOSE.decon);
  if (!obs) return null;
  // --- openings ---------------------------------------------------------------------------------------------------------------------
  const openings: Rect[] = [];
  const portal = (a: Area, x: number, w: number) => { const gap = R(x, wallY, w, 1); ctx.door(gap, platform, a, 3.2); openings.push(gap); };
  portal(hall, 50, 11); // the central portal on the vault axis (50..60: centre 55.5)
  const pw = 8;
  portal(reg, sx0 + Math.floor((reg.w - pw) / 2) + rng.int(-1, 1), pw);
  portal(wait, wait.x + Math.floor((wait.w - pw) / 2) + rng.int(-1, 1), pw);
  // registration -> vault hall: two narrow inspection gates in the forecourt (north of the checkpoint line)
  const gateRows = [y0 + 3 + rng.int(0, 1), y0 + 9 + rng.int(0, 1)];
  for (const gy of gateRows) if (gy + 3 <= y0 + regH - 1) ctx.door(R(wW, gy, 1, 3), reg, hall, 2.6);
  // the marshals' post: off the registration hall (its counter side) and a side door onto the vault hall's inner apron
  ctx.door(R(sx0 + 2 + rng.int(0, 2), y0 + regH, 3, 1), reg, mar, 2.6);
  ctx.door(R(wW, S.bulkheadY - 5, 1, 3), mar, hall, 2.6);
  // surrendered property: a hand-in door off the registration hall
  ctx.door(R(sx0 - 1, y0 + 4 + rng.int(0, 3), 1, 4), reg, prop, 2.6);
  // waiting hall -> vault hall: an arcade of three openings (3 cells, 2-cell piers) in the forecourt (north of the checkpoint line)
  for (const ay of [y0 + 2, y0 + 7, y0 + 12]) ctx.door(R(wE, ay, 1, 3), wait, hall, 3.0);
  // waiting hall -> medical inspection -> observation ward (the dead end)
  ctx.door(R(ex1, y0 + 10 + rng.int(0, 4), 1, 4), wait, med, 2.6);
  ctx.door(R(ex1 + 1 + medW, S.bulkheadY - 6 - rng.int(0, 4), 1, 3), med, obs, 2.6);
  // --- the vault side (off the vestibule only) --------------------------------------------------------------------------------------
  const vx1 = vest.x + vest.w; // the vestibule's east wall column (73)
  const recv = add('receiving', R(vx1 + 1, vest.y, rng.pick([20, 22, 24]), rng.pick([18, 20])), 'room', 'storage', F0_CLEAR.receiving, vest.id, 'storage');
  const bil = add('billeting', R(vest.x - 1 - 15, vest.y + 2, 15, rng.pick([11, 12, 13])), 'room', 'agent-office', F0_CLEAR.room, vest.id, 'agent-office');
  if (!recv || !bil) return null;
  ctx.door(R(vx1, vest.y + vest.h - 7, 1, 6), vest, recv, 3.0); // the goods door beside the lift's landing
  ctx.door(R(vest.x - 1, bil.y + 3 + rng.int(0, 2), 1, 3), vest, bil, 2.6);
  return {areas, openings, gas: [], damp: [], aged: [obs.id]};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dress

/** Kinds the station dresser's composer stocks a public hall with that do not belong in a shelter's admission halls. */
const OFF_THEME: ReadonlySet<string> = new Set(['shoeShineChair', 'capsuleToyMachine', 'newspaperVendingBox', 'newspaperBundles', 'atmKiosk', 'infoTouchKiosk', 'fareValidatorStand', 'ticketMachine']);

/** Cells a prop's footprint blocks (placeKit's cellsOfBox). */
function propCells(g: StationLayout['grid'], p: PropPlacement): number[] {
  const [c0, r0, c1, r1] = cellsOfBox(p.x, p.z, p.hx, p.hz), out: number[] = [];
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
  return out;
}

/**
 * Takes the off-theme stock out of the given storey-0 areas (and whatever stands on it), keeping every other prop's index order: host
 * indices of on-top decor are renumbered, the freed cells go back to open floor unless another prop still covers them.
 */
function dropOffTheme(layout: StationLayout, areaIds: ReadonlySet<number>): number {
  const g = layout.levels[0].grid;
  const gone = new Set<number>();
  layout.props.forEach((p, i) => { if ((p.level ?? 0) === 0 && areaIds.has(p.area) && OFF_THEME.has(p.kind)) gone.add(i); });
  layout.props.forEach((p, i) => { if (p.host !== undefined && gone.has(p.host)) gone.add(i); });
  if (!gone.size) return 0;
  const map = new Map<number, number>();
  let k = 0;
  layout.props.forEach((_, i) => { if (!gone.has(i)) map.set(i, k++); });
  const keep = layout.props.filter((_, i) => !gone.has(i));
  const still = new Set<number>();
  for (const p of keep) if ((p.level ?? 0) === 0 && p.host === undefined && !p.mounted) for (const c of propCells(g, p)) still.add(c);
  for (const i of gone) {
    const p = layout.props[i];
    if (p.host !== undefined || p.mounted) continue;
    for (const c of propCells(g, p)) if (!still.has(c)) { g.blocked[c] = 0; g.sightBlocked[c] = 0; }
  }
  for (const p of keep) if (p.host !== undefined) p.host = map.get(p.host);
  layout.props.length = 0;
  layout.props.push(...keep);
  return gone.size;
}

const NO_FRONT: ReadonlySet<string> = new Set(['column', 'fareGate', 'booth', 'noticeBoard', 'blastDoor', 'annexMachine', 'exitStair']);

/**
 * The station dresser's own pieces keep their access: a fresh placement context knows nothing of the strips it reserved, so the cells
 * `depth` m in front of every standing prop already in these areas are kept clear of this pass's placements.
 */
function keepFronts(D: Dx, ids: ReadonlySet<number>, depth = 1.0): void {
  const g = D.g;
  for (const p of D.layout.props) {
    if ((p.level ?? 0) !== 0 || !ids.has(p.area) || p.mounted || p.host !== undefined || NO_FRONT.has(p.kind)) continue;
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    const hd = fx ? p.hx : p.hz, hw = fx ? p.hz : p.hx;
    const [c0, r0, c1, r1] = cellsOfBox(p.x + fx * (hd + depth / 2), p.z + fz * (hd + depth / 2), fx ? depth / 2 : hw, fz ? depth / 2 : hw);
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (g.inBounds(x, y)) D.ctx.keep[g.idx(x, y)] = 1;
  }
}

/** A light fixture of this storey (state set later by applyLighting from the area's profile). */
function addLight(layout: StationLayout, a: Area, x: number, z: number, y: number, rot: number, warm: boolean, power = 1): void {
  layout.lights.push({x: r3(x), y: r3(y), z: r3(z), rot, area: a.id, broken: false, flicker: false, warm, power, dying: false});
}

/** A placement or null, counted. */
function put(D: Dx, a: Area, kind: PropKind, x: number, z: number, rot: number, o: Parameters<typeof tryPlaceProp>[6] = {}): PropPlacement | null {
  return tryPlaceProp(D.ctx, a, kind, q4(x), q4(z), rot, o);
}

function dress(c: FloorDressCtx): void {
  const {layout, rng} = c;
  const st = F0_STATS;
  st.removed = 0; st.skipped = [];
  const p0 = layout.props.length, d0 = layout.decor.length, s0 = layout.signs.length, l0 = layout.lights.length;
  const A = (k: F0Key) => layout.areas[c.carved.areas[k]];
  const platform = layout.areas[layout.platform];
  const vest = layout.areas.find(a => a.label === 'Vault vestibule' && (a.level ?? 0) === 0)!;
  const hall = A('vaultHall');
  st.removed = dropOffTheme(layout, new Set([hall.id, vest.id]));
  const mine = [...F0_KEYS.map(A), platform, vest];
  const D = shelterDx(layout, 0, rng.fork('station'), mine);
  keepFronts(D, new Set(mine.map(a => a.id)));
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { st.skipped.push(`${name}: ${(e as Error).message}`); } };
  const name = bunkerShortName(layout.name).toUpperCase();
  step('vault hall', () => vaultHall(D, hall, name));
  step('registration', () => registration(D, A('registration'), hall));
  step('waiting', () => waitingHall(D, A('waiting'), hall));
  step('observation', () => observation(D, A('observation')));
  step('receiving', () => receiving(D, A('receiving')));
  step('platform', () => platformBerths(D, platform, c.carved.openings ?? [], name));
  step('vestibule', () => vestibule(D, vest));
  step('plates', () => plates(D, c, s0));
  st.props = layout.props.length - p0; st.decor = layout.decor.length - d0; st.signs = layout.signs.length - s0; st.lights = layout.lights.length - l0;
}

/**
 * The vault hall: the processional aisle (amber edge lines from the central portal to the threshold), the checkpoint line across it
 * (two marshals' booths facing the aisle, crowd barriers out to the side walls), queue barriers along the aisle in the forecourt, dead
 * planters by the portal, the door's plates and a pair of warm lamps on it.
 */
function vaultHall(D: Dx, a: Area, name: string): void {
  const ax = (V2.station.laneX + V2.station.laneW / 2) * CELL; // 27.75
  const z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
  // the aisle's edge lines (floor paint: below the doorway clear volumes' 2 cm floor allowance), clear of the open leaf
  const thr = (V2.station.bulkheadY - 3) * CELL; // the threshold's first riser row
  for (const s of [-1, 1]) D.decor('plasticSeat', {x0: ax + s * 1.5 - 0.06, x1: ax + s * 1.5 + 0.06, z0: z0 + 0.6, z1: thr - 0.3}, 0, 0.008);
  // the checkpoint line: booths either side of the aisle, fronts toward it (north of the open leaf)
  const cz = 20.0;
  const bw = PROP_DEFS.booth;
  for (const s of [-1, 1]) {
    const bx = ax + s * (2.6 + bw.d / 2);
    const p = put(D, a, 'booth', bx, cz, s < 0 ? Math.PI / 2 : -Math.PI / 2, {ring: 0.5});
    if (!p) { F0_STATS.skipped.push('booth'); continue; }
    // crowd barriers from the booth out toward the side wall (a gap kept by the wall: never a sealed line)
    const out0 = bx + s * (bw.d / 2 + 0.1 + PROP_DEFS.crowdBarrier.w / 2);
    for (let k = 0; k < 3; k++) put(D, a, 'crowdBarrier', out0 + s * k * (PROP_DEFS.crowdBarrier.w + 0.1), cz, 0, {laneOk: true, plazaOk: true});
    put(D, a, 'securityPodium', ax + s * 2.0, cz - 1.6, rotFacing(0, -1), {laneOk: true, plazaOk: true});
  }
  // queue barriers along the aisle in the forecourt (the last queue: two lanes either side)
  for (const s of [-1, 1]) for (let z = z0 + 3.0; z < cz - 2.6; z += 2.3) put(D, a, 'crowdBarrier', ax + s * 3.6, z, Math.PI / 2, {laneOk: true, plazaOk: true});
  // dead planters flanking the portal inside the hall
  for (const s of [-1, 1]) put(D, a, 'deadPlant', ax + s * 4.2, z0 + 1.0, 0, {laneOk: true, plazaOk: true});
  // benches against the side walls of the forecourt
  for (const sd of ['W', 'E'] as Side[]) scanWall(D, a, 'bench', [sd], 0.6, z0 + 3.5);
  // the door's plates: the shelter's name over the frame, the rules either side
  const lc = ax;
  wallSign(D, a, 'S', lc, 4.62, {kind: 'service', text: name, w: Math.min(4.2, 1.0 + name.length * 0.17)});
  wallSign(D, a, 'S', lc - 4.3, 2.1, {kind: 'service', text: 'ADMISSION BY SHELTER CARD ONLY', w: 2.0});
  wallSign(D, a, 'S', lc + 4.3, 2.1, {kind: 'service', text: 'KEEP THE DOOR CLEAR · NO BAGGAGE BEYOND THIS POINT', w: 2.2});
  // warm lamps on the door (inside the hall, in front of the frame)
  for (const s of [-1, 1]) addLight(D.layout, a, ax + s * 3.2, z1 - 2.2, Math.min(a.ceil - 0.05, 5.6), 0, true, 1.2);
  // the hall's notices on the forecourt's side walls
  wallSign(D, a, 'W', z0 + 2.2, 2.4, {kind: 'info', text: 'QUEUE HERE · HAVE YOUR CARD READY', w: 2.2});
  wallSign(D, a, 'E', z0 + 2.2, 2.4, {kind: 'info', text: 'FAMILIES KEEP TOGETHER', w: 1.8});
}

/** The registration hall: queue pens by the portal, the counter line of clerks' desks, the records side behind it. */
function registration(D: Dx, a: Area, hall: Area): void {
  const ax0 = a.x * CELL, ax1 = (a.x + a.w) * CELL, az0 = a.y * CELL, az1 = (a.y + a.h) * CELL;
  const cz = az0 + (az1 - az0) * 0.55; // the counter line
  const desk = PROP_DEFS.desk;
  // the desks: fronts (drawers / the clerk's side) south, the public queue north; a 1.1 m gap between them
  let n = 0;
  for (let x = ax0 + 1.4 + desk.w / 2; x + desk.w / 2 <= ax1 - 1.4 && n < 5; x += desk.w + 1.1) {
    const p = put(D, a, 'desk', x, cz, 0, {laneOk: true, plazaOk: true});
    if (!p) continue;
    n++;
    put(D, a, 'officeSwivelChair', x, cz + desk.d / 2 + 0.45, Math.PI, {laneOk: true, plazaOk: true});
  }
  if (n < 2) F0_STATS.skipped.push(`registration: ${n} desks`);
  // queue pens: rows of crowd barriers across the public side, alternating openings at each end (a switchback)
  const qz = [az0 + 2.4, az0 + 4.2];
  qz.forEach((z, i) => {
    const w = PROP_DEFS.crowdBarrier.w;
    const xs: number[] = [];
    for (let x = ax0 + 1.6 + w / 2 + (i % 2 ? 1.4 : 0); x + w / 2 <= ax1 - 1.6 - (i % 2 ? 0 : 1.4); x += w + 0.05) xs.push(x);
    for (const x of xs) put(D, a, 'crowdBarrier', x, z, 0, {laneOk: true, plazaOk: true});
  });
  // the records side: filing cabinets and a tall cabinet against the back wall, a notice board
  for (let i = 0; i < 2; i++) scanWall(D, a, 'filingCabinet', ['S'], 0.8);
  scanWall(D, a, 'cabinetTall', ['S', 'W'], 0.8);
  void hall;
}

/** The waiting hall: rows of benches facing the arcade (and the door beyond), luggage, a few bedrolls along the far wall. */
function waitingHall(D: Dx, a: Area, hall: Area): void {
  const ax0 = a.x * CELL, ax1 = (a.x + a.w) * CELL, az0 = a.y * CELL, az1 = (a.y + a.h) * CELL;
  const b = PROP_DEFS.bench;
  // benches in rows across the hall, fronts west (toward the vault hall), a 2 m aisle down the middle
  const midZ = (az0 + az1) / 2;
  let n = 0;
  for (let x = ax0 + 2.6; x <= ax1 - 3.2 && n < 10; x += 1.9) for (const s of [-1, 1]) {
    const z = midZ + s * (1.0 + b.w / 2);
    if (put(D, a, 'bench', x, z, -Math.PI / 2, {laneOk: true, plazaOk: true, ring: 0.3})) n++;
  }
  // luggage left by the benches
  const loose: PropKind[] = ['rollingSuitcase', 'rollingSuitcase', 'babyStroller', 'rollingSuitcase', 'wheelchair'];
  for (const k of loose) {
    for (let t = 0; t < 12; t++) {
      const x = D.rng.range(ax0 + 1.5, ax1 - 1.5), z = D.rng.range(az0 + 1.5, az1 - 1.5);
      if (put(D, a, k, x, z, [0, Math.PI / 2, Math.PI, -Math.PI / 2][D.rng.int(0, 3)], {ring: 0.4})) break;
    }
  }
  // bedrolls along the east wall (families who slept here waiting for their group)
  for (let i = 0; i < 3; i++) scanWall(D, a, 'bedroll', ['E'], 0.4, az0 + 3 + i * 3);
  void hall;
}

/** The observation ward: camp beds in two rows, a stretcher, IV poles. */
function observation(D: Dx, a: Area): void {
  const ax0 = a.x * CELL, az0 = a.y * CELL, az1 = (a.y + a.h) * CELL;
  const bed = PROP_DEFS.palletBed;
  let n = 0;
  for (const side of ['N', 'S'] as Side[]) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 1.2; t + bed.d / 2 <= hi - 0.8 && n < 8; t += 1.6) {
      const z = side === 'N' ? az0 + bed.w / 2 + 0.05 : az1 - bed.w / 2 - 0.05;
      if (put(D, a, 'palletBed', t, z, Math.PI / 2, {laneOk: true, plazaOk: true})) n++;
    }
  }
  scanWall(D, a, 'wheeledStretcher', ['E', 'W'], 0.6);
  scanWall(D, a, 'ivPole', ['E', 'W'], 0.4);
  scanWall(D, a, 'medCabinet', ['E', 'W'], 0.8);
  void ax0;
}

/** Receiving: goods-in pallets by the door. */
function receiving(D: Dx, a: Area): void {
  for (let i = 0; i < 3; i++) scanWall(D, a, 'parcelPallet', ['N', 'E', 'S'], 0.6);
}

/** The overflow berths on the platform's back wall (latecomers slept on the platform), and its wayfinding over the portals. */
function platformBerths(D: Dx, p: Area, openings: readonly Rect[], name: string): void {
  let n = 0;
  const [lo, hi] = wallRange(p, 'S');
  const mid = (lo + hi) / 2;
  const ts: number[] = [];
  for (let t = lo + 1.5; t <= hi - 1.5; t += 0.5) ts.push(t);
  ts.sort((u, v) => Math.abs(Math.abs(u - mid) - 10) - Math.abs(Math.abs(v - mid) - 10));
  for (const t of ts) {
    if (n >= 4) break;
    const sp = wallSpot(p, 'S', t, 'bunkBed');
    const q = tryPlaceProp(D.ctx, p, 'bunkBed', q4(sp.x), r3(sp.z), sp.rot, {laneOk: true, plazaOk: true});
    if (q && sealOrDrop(D, p, q)) n++;
  }
  // over the portals
  const lane = V2.station.laneX + V2.station.laneW / 2;
  const sorted = [...openings].sort((u, v) => u.x - v.x);
  for (const o of sorted) {
    const cx = (o.x + o.w / 2) * CELL;
    const central = Math.abs(o.x + o.w / 2 - lane) < 1;
    const text = central ? `${name} · ALL ARRIVALS` : o.x + o.w / 2 < lane ? 'REGISTRATION · ADMISSION KITS' : 'WAITING HALL · MEDICAL INSPECTION';
    wallSign(D, p, 'S', cx, 3.62, {kind: 'service', text, w: central ? 3.0 : 2.4});
  }
}

/** The vestibule (spine-owned): its stair / lift wayfinding and the freight by the goods door. */
function vestibule(D: Dx, v: Area): void {
  wallSign(D, v, 'N', (V2.station.laneX - 6) * CELL, 2.2, {kind: 'info', text: 'PROCEED TO LEVEL 1 · DECONTAMINATION', w: 2.4});
  wallSign(D, v, 'N', (V2.station.laneX + 9) * CELL, 2.2, {kind: 'info', text: 'EXIT · TO THE TRAINS', w: 1.6});
}

/** Door plates in the shelter's words (the station dresser's stock plate by the same door gives way: signs before index `s0`). */
function plates(D: Dx, c: FloorDressCtx, s0: number): void {
  const {layout} = c;
  const A = (k: F0Key) => layout.areas[c.carved.areas[k]];
  const PLATE: Partial<Record<F0Key, string>> = {
    registration: 'REGISTRATION', marshals: "SHELTER MARSHALS", waiting: 'WAITING HALL', property: 'SURRENDERED PROPERTY', medical: 'MEDICAL INSPECTION',
    observation: 'OBSERVATION · NO ADMITTANCE', receiving: 'RECEIVING · GOODS IN', billeting: 'BILLETING OFFICE',
  };
  for (const [k, text] of Object.entries(PLATE) as [F0Key, string][]) {
    const a = A(k);
    const ds = D.doors(a);
    const d = ds.find(q => q.a === a.parent || q.b === a.parent) ?? ds[0];
    if (!d) continue;
    const outside = layout.areas[d.a === a.id ? d.b : d.a];
    if (outside.type === 'platform') continue; // (the portals carry their own plates)
    const dx = (d.x + d.w / 2) * CELL, dz = (d.y + d.h / 2) * CELL;
    const stock = new Set(layout.signs.filter((sg, i) => i < s0 && sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - dx, sg.z - dz) < 2.6));
    if (stock.size) layout.signs = layout.signs.filter(sg => !stock.has(sg));
    doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4);
  }
}

export const FLOOR_0: BunkerFloorModule = {
  level: 0,
  title: 'Station — the admission concourse: the vault hall on the door axis, registration and waiting halls, medical inspection',
  carve,
  dress,
};
