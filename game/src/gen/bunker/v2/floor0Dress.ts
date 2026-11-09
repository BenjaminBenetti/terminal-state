// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 0 (the station)'s own furnishing, after the ONE station dresser
// (gen/stationDress.ts) ran over the whole level (world metres; pure data). The compositions (see floor0.ts for the plan):
//  - the vault hall: the colonnade (full-height columns, transverse beams over them, queue barriers strung between), the painted aisle
//    and its wait line, the marshals' booths flanking the door with a podium at the threshold, dead planters by the portal, benches in
//    the west bay, warm lamps on the door, the shelter's plates;
//  - the registration hall: the queue line, the registration counter (two runs of counter modules, clerks' chairs behind), records;
//  - the waiting hall: benches in rows facing the arcade, luggage, bedrolls along the far wall, a child's rocking horse;
//  - the observation ward's camp beds, receiving's goods, the billeting desk, the platform's overflow berths and its portal framing;
//  - plates and notices in the shelter's own words; the composer's retail stock (shoe-shine chairs, capsule toys, newspaper boxes,
//    cash machines …) taken out of the vault hall, the vestibule and the platform: a civil-defence shelter's admission halls.
// Storage placed here opens (counters, filing cabinets, archive boxes, shelves, medicine cabinet: existing holders, loot by the room's
// purpose); loose things move (chairs, barriers, luggage, planters: their existing physics classes); anchored structure (columns, the
// booths) is the existing classification. Every placement goes through placeKit (door zones, access strips, area connectivity).

import {CELL} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Rect, Side, StationLayout} from '../../stationTypes';
import {cellsOfBox, mountProp, tryPlaceProp, wallRange, wallSpot, type PlaceOpts} from '../../placeKit';
import {doorPlate, scanWall, sealOrDrop, wallSign, type Dx} from '../../reactor/complex/bunkerDress';
import {shelterDx} from '../dress';
import {bunkerShortName} from '../names';
import type {FloorDressCtx} from './floorApi';
import {F0_AXIS, F0_COLONNADE, F0_KEYS, F0_PLATES, F0_STATS, type F0Key} from './floor0Spec';
import {V2} from './spine';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 4) / 4;
const FREE: PlaceOpts = {laneOk: true, plazaOk: true};

/** Kinds the station dresser's composer stocks a public hall with that do not belong in a shelter's admission halls. */
const OFF_THEME: ReadonlySet<string> = new Set(['shoeShineChair', 'capsuleToyMachine', 'newspaperVendingBox', 'newspaperBundles', 'atmKiosk', 'infoTouchKiosk', 'fareValidatorStand', 'ticketMachine']);

/** Cells a prop's footprint blocks (placeKit's cellsOfBox). */
function propCells(g: StationLayout['grid'], p: PropPlacement): number[] {
  const [c0, r0, c1, r1] = cellsOfBox(p.x, p.z, p.hx, p.hz), out: number[] = [];
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
  return out;
}

/**
 * Takes the storey-0 props matching `drop` out (and whatever stands on them), keeping every other prop's order: host indices of on-top
 * decor are renumbered, the freed cells go back to open floor unless another prop still covers them. Only props placed by the station
 * dresser are candidates (index >= `from`: the vault door's pieces and the generators / core cluster come before it).
 */
function dropProps(layout: StationLayout, from: number, drop: (p: PropPlacement) => boolean): number {
  const g = layout.levels[0].grid;
  const gone = new Set<number>();
  layout.props.forEach((p, i) => { if (i >= from && (p.level ?? 0) === 0 && drop(p)) gone.add(i); });
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

/** A light fixture of this storey (its state is set later by applyLighting from the area's profile). */
function addLight(layout: StationLayout, a: Area, x: number, z: number, y: number, rot: number, warm: boolean, power = 1): void {
  layout.lights.push({x: r3(x), y: r3(y), z: r3(z), rot, area: a.id, broken: false, flicker: false, warm, power, dying: false});
}

/** A placement on the 0.25 m lattice. */
function put(D: Dx, a: Area, kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts = FREE): PropPlacement | null {
  return tryPlaceProp(D.ctx, a, kind, q4(x), q4(z), rot, o);
}

/** A notice board mounted on the first wall of `sides` with a backed spot (1.1 m up), nearest the wall's middle. */
function board(D: Dx, a: Area, sides: readonly Side[]): PropPlacement | null {
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd), mid = (lo + hi) / 2;
    const ts: number[] = [];
    for (let t = lo + 1.0; t <= hi - 1.0; t += 0.25) ts.push(t);
    ts.sort((u, v) => Math.abs(u - mid) - Math.abs(v - mid) || u - v);
    for (const t of ts) { const p = mountProp(D.ctx, a, sd, q4(t), 'noticeBoard', 1.1, D.base); if (p) return p; }
  }
  return null;
}

/** Every 0.25 m along `side` of `a` (nearest `prefer` first), up to `n` placements of `kind` (the wall scan of the bunker dresser). */
function along(D: Dx, a: Area, kind: PropKind, side: Side, n: number, front: number, prefer?: number): number {
  let got = 0;
  for (let i = 0; i < n; i++) if (scanWall(D, a, kind, [side], front, prefer)) got++;
  return got;
}

export function dressStation(c: FloorDressCtx): void {
  const {layout, rng} = c;
  const st = F0_STATS;
  st.removed = 0; st.columns = 0; st.booths = 0; st.counters = 0; st.benches = 0; st.berths = 0; st.skipped = [];
  const A = (k: F0Key) => layout.areas[c.carved.areas[k]];
  const platform = layout.areas[layout.platform];
  const vest = layout.areas.find(a => a.label === 'Vault vestibule' && (a.level ?? 0) === 0)!;
  const hall = A('vaultHall');
  // the station dresser's props start after the vault door's pieces and the objectives (all placed before it, on their own storeys)
  const dresserFrom = layout.props.findIndex((p, i) => i > 0 && (p.level ?? 0) === 0 && p.kind !== 'blastDoor' && !String(p.kind).startsWith('bunker'));
  const from = dresserFrom < 0 ? layout.props.length : dresserFrom;
  const pub = new Set([hall.id, vest.id, platform.id]);
  st.removed = dropProps(layout, from, p => pub.has(p.area) && OFF_THEME.has(p.kind));
  // the platform bay in front of the central portal: its column(s) (and a bench between them) in the sightline give way to a pair of
  // columns framing the portal
  const colZ = layout.props.find(p => p.area === platform.id && p.kind === 'column')?.z;
  st.removed += dropProps(layout, from, p => p.area === platform.id && ((p.kind === 'column' && Math.abs(p.x - F0_AXIS) < 4.0) || (p.kind === 'bench' && Math.abs(p.x - F0_AXIS) < 2.5)));
  const p0 = layout.props.length, d0 = layout.decor.length, s0 = layout.signs.length, l0 = layout.lights.length;
  const mine = [...F0_KEYS.map(A), platform, vest];
  const D = shelterDx(layout, 0, rng.fork('station'), mine);
  keepFronts(D, new Set(mine.map(a => a.id)));
  // the pipeline holds the aprons / the threshold by BLOCKING them while the floors dress; blocked, the threshold row cuts the vault
  // hall's (and the vestibule's) lane door off, so placeKit's connectivity proof refuses every non-trivial placement there. Held cells
  // become KEPT (never placed on) and open for the proof while this pass runs, then are blocked again for the pipeline's release.
  const unheld: number[] = [];
  for (const i of c.held) if (D.g.blocked[i]) { D.g.blocked[i] = 0; D.ctx.keep[i] = 1; unheld.push(i); }
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { st.skipped.push(`${name}: ${(e as Error).message}`); } };
  const name = bunkerShortName(layout.name).toUpperCase();
  step('platform', () => platformBay(D, platform, c.carved.openings ?? [], name, colZ));
  step('vault hall', () => vaultHall(D, hall, name));
  step('registration', () => registration(D, A('registration')));
  step('waiting', () => waitingHall(D, A('waiting')));
  step('observation', () => observation(D, A('observation')));
  step('medical', () => medical(D, A('medical')));
  step('receiving', () => receiving(D, A('receiving')));
  step('billeting', () => billeting(D, A('billeting')));
  step('vestibule', () => vestibule(D, vest));
  step('plates', () => plates(D, c, s0));
  for (const i of unheld) D.g.blocked[i] = 1;
  st.props = layout.props.length - p0; st.decor = layout.decor.length - d0; st.signs = layout.signs.length - s0; st.lights = layout.lights.length - l0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The platform

/**
 * The platform: two columns framing the central portal (the station dresser's column in the bay, if any, was taken out: the first
 * view from the train is the blast door down the aisle), the overflow berths on the back wall (latecomers who never got in slept
 * here), and its plates over the portals.
 */
function platformBay(D: Dx, p: Area, openings: readonly Rect[], name: string, colZ: number | undefined): void {
  const z = colZ ?? (p.y + Math.round(p.h * 0.58) + 0.5) * CELL;
  for (const s of [-1, 1]) if (tryPlaceProp(D.ctx, p, 'column', r3(F0_AXIS + s * 3.0), r3(z), 0, {checkZone: false, h: p.ceil})) F0_STATS.columns++;
  // overflow berths: bunks with their long side to the back wall, away from the portals (~10 m either side of the platform's middle)
  const [lo, hi] = wallRange(p, 'S');
  const mid = (lo + hi) / 2;
  const ts: number[] = [];
  for (let t = lo + 1.5; t <= hi - 1.5; t += 0.5) ts.push(t);
  ts.sort((u, v) => Math.abs(Math.abs(u - mid) - 10) - Math.abs(Math.abs(v - mid) - 10) || u - v);
  for (const t of ts) {
    if (F0_STATS.berths >= 4) break;
    const sp = wallSpot(p, 'S', t, 'bunkBed');
    const q = tryPlaceProp(D.ctx, p, 'bunkBed', q4(sp.x), r3(sp.z), sp.rot, FREE);
    if (q && sealOrDrop(D, p, q)) F0_STATS.berths++;
  }
  // a suitcase or two by the berths (their owners' things)
  for (let i = 0; i < 2; i++) {
    const b = D.layout.props.filter(q => q.area === p.id && q.kind === 'bunkBed')[i];
    if (b) put(D, p, 'rollingSuitcase', b.x + (i ? -1.35 : 1.35), b.z, 0, {...FREE, ring: 0.3});
  }
  // over the portals
  const lane = V2.station.laneX + V2.station.laneW / 2;
  for (const o of [...openings].sort((u, v) => u.x - v.x)) {
    const cx = (o.x + o.w / 2) * CELL;
    const central = Math.abs(o.x + o.w / 2 - lane) < 1;
    const text = central ? `${name} · ALL ARRIVALS` : o.x + o.w / 2 < lane ? 'REGISTRATION · ADMISSION KITS' : 'WAITING HALL · MEDICAL INSPECTION';
    wallSign(D, p, 'S', cx, 3.62, {kind: 'service', text, w: central ? 3.0 : 2.4});
  }
  wallSign(D, p, 'S', mid + 13.5, 1.75, {kind: 'info', text: 'OVERFLOW BERTHS · KEEP THE PLATFORM EDGE CLEAR', w: 2.6});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The vault hall

/**
 * The vault hall as a nave: two colonnades of full-height columns flanking the aisle under transverse beams, queue barriers strung
 * between the columns, the painted aisle with its wait line, the marshals' booths flanking the blast door (fronts to the aisle) and a
 * podium at the threshold, dead planters by the portal, benches in the west bay, two warm lamps on the door and its plates.
 */
function vaultHall(D: Dx, a: Area, name: string): void {
  const ax = F0_AXIS;
  const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL, z1 = (a.y + a.h) * CELL, top = a.ceil - D.base;
  const off = F0_COLONNADE.off;
  // the colonnade and the beams over it
  for (const dz of F0_COLONNADE.rows) {
    const z = z0 + dz;
    let n = 0;
    for (const s of [-1, 1]) if (put(D, a, 'column', ax + s * off, z, 0, {...FREE, checkZone: false, h: top})) n++;
    F0_STATS.columns += n;
    if (n === 2) {
      D.decor('steelDark', {x0: x0 + 0.02, x1: x1 - 0.02, z0: z - 0.2, z1: z + 0.2}, top - 0.45, top - 0.02);
      for (const s of [-1, 1]) D.decor('steelDark', {x0: ax + s * off - 0.34, x1: ax + s * off + 0.34, z0: z - 0.34, z1: z + 0.34}, top - 0.75, top - 0.45);
    }
  }
  // queue barriers between the columns and on toward the door, both colonnade lines
  const zA = z0 + F0_COLONNADE.rows[0], zB = z0 + F0_COLONNADE.rows[1];
  for (const s of [-1, 1]) for (const zc of [(zA + zB) / 2, zB + 1.5]) put(D, a, 'crowdBarrier', ax + s * off, zc, Math.PI / 2);
  // the marshals' booths flanking the door (fronts to the aisle: their inner faces 3 m off the axis, just inside the colonnade lines),
  // beside the open leaf / the frame; the threshold marshal's podium by the lane
  const bk = PROP_DEFS.booth, bz = z1 - 3.6;
  for (const s of [-1, 1]) {
    const bx = ax + s * (3.05 + bk.d / 2);
    if ([0, -0.5, -1.0, 0.5].some(dz => put(D, a, 'booth', bx, bz + dz, s < 0 ? Math.PI / 2 : -Math.PI / 2))) F0_STATS.booths++;
  }
  put(D, a, 'securityPodium', ax + 2.4, z1 - 2.0, -Math.PI / 2);
  // the aisle's edge lines and the wait line across it at the booths (floor paint, under the doorways' 2 cm allowance)
  const thr = (V2.station.bulkheadY - 3) * CELL;
  for (const s of [-1, 1]) D.decor('plasticSeat', {x0: ax + s * 1.5 - 0.06, x1: ax + s * 1.5 + 0.06, z0: z0 + 0.6, z1: thr - 0.3}, 0, 0.008);
  D.decor('plasticSeat', {x0: ax - 1.44, x1: ax + 1.44, z0: bz - 1.5 - 0.08, z1: bz - 1.5 + 0.08}, 0, 0.008);
  // dead planters either side of the portal, inside the hall
  for (const s of [-1, 1]) put(D, a, 'deadPlant', ax + s * 4.4, z0 + 0.9, 0);
  // benches in the west bay facing the nave (the east side is the arcade)
  along(D, a, 'bench', 'W', 2, 0.6, z0 + 6);
  // the door's plates: the shelter's name over the frame, the rules either side; notices in the forecourt
  wallSign(D, a, 'S', ax, 4.62, {kind: 'station', text: name, w: Math.min(4.6, 1.2 + name.length * 0.19)});
  wallSign(D, a, 'S', ax - 4.4, 2.2, {kind: 'service', text: 'ADMISSION BY SHELTER CARD ONLY', w: 2.0});
  wallSign(D, a, 'S', ax + 4.4, 2.2, {kind: 'service', text: 'NO BAGGAGE BEYOND THIS POINT', w: 2.0});
  wallSign(D, a, 'W', z0 + 2.2, 2.4, {kind: 'info', text: 'FAMILIES KEEP TOGETHER', w: 1.8});
  D.layout.signs.push({x: r3(ax), y: r3(D.base + 3.45), z: r3(z0 + 1.4), rot: 0, kind: 'info', text: 'TO THE SHELTER · HAVE YOUR CARD READY', area: a.id, hang: true, w: 2.8, level: 0});
  // warm lamps on the door
  for (const s of [-1, 1]) addLight(D.layout, a, ax + s * 3.2, z1 - 2.0, D.base + 4.9, 0, true, 1.2);
  void x0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The registration hall

/**
 * The registration hall: a queue line of crowd barriers parallel to the counter (its entry at the west end), the registration
 * counter in two runs of counter modules (customers north, the clerks' chairs south: the admission kits are its loot), and the
 * cleared side behind it — records (filing cabinets, archive boxes) on the back wall, the inspection gates on the east wall.
 */
function registration(D: Dx, a: Area): void {
  const ax0 = a.x * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const cz = az1 - 4.25; // the counter line
  const ck = PROP_DEFS.shopCounter;
  const span = ax1 - ax0 - 2.0, run = 2 * ck.w, gap = Math.max(1.0, span - 2 * run);
  const starts = [ax0 + 1.0, ax0 + 1.0 + run + gap];
  for (const s0 of starts) for (let k = 0; k < 2; k++) {
    const x = s0 + ck.w / 2 + k * ck.w;
    if (put(D, a, 'shopCounter', x, cz, Math.PI, {...FREE, front: 0.8})) {
      F0_STATS.counters++;
      put(D, a, 'officeSwivelChair', x, cz + ck.d / 2 + 0.45, Math.PI);
    }
  }
  if (F0_STATS.counters < 2) F0_STATS.skipped.push(`registration: ${F0_STATS.counters} counter modules`);
  // the queue line: barriers parallel to the counter, closed at the east wall, the entry at the west end
  const bz = cz - ck.d / 2 - 1.55, bw = PROP_DEFS.crowdBarrier.w;
  for (let x = ax1 - 0.35 - bw / 2; x - bw / 2 >= ax0 + 2.4; x -= bw + 0.05) put(D, a, 'crowdBarrier', x, bz, 0);
  // records on the cleared side's back wall
  along(D, a, 'filingCabinet', 'S', 2, 0.8, (ax0 + ax1) / 2 + 1.5);
  along(D, a, 'archiveBoxes', 'S', 1, 0.6, ax1 - 1.5);
  scanWall(D, a, 'securityPodium', ['E'], 0.8, az1 - 2.5);
  // notices on the public side
  wallSign(D, a, 'W', a.y * CELL + 1.6, 2.3, {kind: 'info', text: 'ONE BAG PER PERSON', w: 1.6});
  wallSign(D, a, 'E', a.y * CELL + 1.6, 2.3, {kind: 'info', text: 'HAVE YOUR SHELTER CARD READY', w: 2.0});
  D.layout.signs.push({x: r3((ax0 + ax1) / 2), y: r3(D.base + 2.85), z: r3(cz - 0.9), rot: 0, kind: 'info', text: 'REGISTRATION · ADMISSION KITS', area: a.id, hang: true, w: 2.6, level: 0});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The waiting hall

/** The waiting hall: benches in rows facing the arcade (and the door beyond), luggage, bedrolls along the far wall, a rocking horse. */
function waitingHall(D: Dx, a: Area): void {
  const ax0 = a.x * CELL, ax1 = (a.x + a.w) * CELL, az0 = a.y * CELL, az1 = (a.y + a.h) * CELL;
  const b = PROP_DEFS.bench;
  const midZ = (az0 + az1) / 2 + 0.5;
  for (let x = ax0 + 2.4; x <= ax1 - 3.4 && F0_STATS.benches < 8; x += 1.9) for (const s of [-1, 1]) {
    if (F0_STATS.benches >= 8) break;
    if (put(D, a, 'bench', x, midZ + s * (1.1 + b.w / 2), -Math.PI / 2, {...FREE, ring: 0.3})) F0_STATS.benches++;
  }
  // luggage left by the benches
  const loose: PropKind[] = ['rollingSuitcase', 'babyStroller', 'rollingSuitcase', 'wheelchair'];
  for (const k of loose) for (let t = 0; t < 16; t++) {
    const x = D.rng.range(ax0 + 1.6, ax1 - 1.6), z = D.rng.range(az0 + 1.6, az1 - 1.6);
    if (put(D, a, k, x, z, [0, Math.PI / 2, Math.PI, -Math.PI / 2][D.rng.int(0, 3)], {...FREE, ring: 0.45})) break;
  }
  // bedrolls along the east wall (families slept here waiting for their group), a child's rocking horse in the corner
  along(D, a, 'bedroll', 'E', 2, 0.4, az0 + 3);
  along(D, a, 'rockingHorse', 'S', 1, 0.5, ax1 - 1.5);
  // notices
  wallSign(D, a, 'E', az1 - 2.5, 2.3, {kind: 'info', text: 'WAIT HERE UNTIL YOUR GROUP IS CALLED', w: 2.4});
  wallSign(D, a, 'S', (ax0 + ax1) / 2, 2.3, {kind: 'info', text: 'MISSING PERSONS · ENQUIRE AT REGISTRATION', w: 2.6});
  D.layout.signs.push({x: r3((ax0 + ax1) / 2), y: r3(D.base + 2.9), z: r3(az0 + 2.2), rot: Math.PI / 2, kind: 'info', text: `NOW ADMITTING · GROUP ${D.rng.int(9, 31)}`, area: a.id, hang: true, w: 2.2, level: 0});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rooms

/** The observation ward: camp beds along both long walls, a stretcher, an IV pole, the medicine cabinet. */
function observation(D: Dx, a: Area): void {
  const bed = PROP_DEFS.palletBed;
  const horiz = a.w >= a.h;
  const sides: Side[] = horiz ? ['N', 'S'] : ['W', 'E'];
  let n = 0;
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 1.0; t + bed.d / 2 <= hi - 0.8 && n < 6; t += 1.7) {
      const sp = wallSpot(a, side, t, 'palletBed');
      // head to the wall: the bed's length runs into the room
      const rot = side === 'N' ? 0 : side === 'S' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2;
      const nx = side === 'W' ? 1 : side === 'E' ? -1 : 0, nz = side === 'N' ? 1 : side === 'S' ? -1 : 0;
      const dd = bed.w / 2 - bed.d / 2;
      if (put(D, a, 'palletBed', sp.x + nx * dd, sp.z + nz * dd, rot + Math.PI / 2)) n++;
    }
  }
  scanWall(D, a, 'wheeledStretcher', horiz ? ['E', 'W'] : ['N', 'S'], 0.6);
  scanWall(D, a, 'ivPole', horiz ? ['E', 'W'] : ['N', 'S'], 0.4);
  scanWall(D, a, 'medCabinet', horiz ? ['W', 'E'] : ['S', 'N'], 0.8);
  wallSign(D, a, horiz ? 'E' : 'S', horiz ? (a.y + a.h / 2) * CELL : (a.x + a.w / 2) * CELL, 2.2, {kind: 'service', text: 'HELD FOR OBSERVATION · MASKS ON', w: 2.2});
}

/** The medical inspection post's notice (its furniture is the station dresser's first-aid room). */
function medical(D: Dx, a: Area): void {
  wallSign(D, a, 'N', (a.x + a.w / 2) * CELL, 2.3, {kind: 'info', text: 'ALL ARRIVALS · REPORT ANY FEVER OR WOUND', w: 2.6});
}

/** Receiving (its shelving / crates are the station dresser's stores): pallets of parcels as they came in, the booking-in notice. */
function receiving(D: Dx, a: Area): void {
  along(D, a, 'parcelPallet', 'N', 2, 0.6);
  wallSign(D, a, 'N', (a.x + a.w / 2) * CELL, 2.4, {kind: 'service', text: 'ALL GOODS TO BE BOOKED IN', w: 1.8});
}

/** The billeting office (its desk / safe / cabinets are the station dresser's agent office): the allocations board. */
function billeting(D: Dx, a: Area): void {
  board(D, a, ['S', 'W', 'E', 'N']);
  wallSign(D, a, 'S', (a.x + a.w / 2) * CELL, 2.4, {kind: 'info', text: 'LEVEL & DORMITORY ALLOCATIONS', w: 2.2});
}

/** The vestibule (spine-owned): its stair / lift wayfinding. */
function vestibule(D: Dx, v: Area): void {
  wallSign(D, v, 'N', (V2.station.laneX - 6) * CELL, 2.2, {kind: 'info', text: 'ADMITTED PERSONS · LEVEL 1 DECONTAMINATION', w: 2.6});
  wallSign(D, v, 'N', (V2.station.laneX + 9) * CELL, 2.2, {kind: 'exit', text: 'EXIT · TO THE TRAINS', w: 1.6});
}

/** Door plates in the shelter's words (the station dresser's stock plate by the same door gives way: signs before index `s0`). */
function plates(D: Dx, c: FloorDressCtx, s0: number): void {
  const {layout} = c;
  for (const [k, text] of Object.entries(F0_PLATES) as [F0Key, string][]) {
    const a = layout.areas[c.carved.areas[k]];
    const ds = D.doors(a);
    const d = ds.find(q => q.a === a.parent || q.b === a.parent) ?? ds[0];
    if (!d) continue;
    const outside = layout.areas[d.a === a.id ? d.b : d.a];
    if (outside.type === 'platform') continue;
    const dx = (d.x + d.w / 2) * CELL, dz = (d.y + d.h / 2) * CELL;
    const stock = new Set(layout.signs.filter((sg, i) => i < s0 && sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - dx, sg.z - dz) < 2.6));
    if (stock.size) layout.signs = layout.signs.filter(sg => !stock.has(sg));
    doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4);
  }
}
