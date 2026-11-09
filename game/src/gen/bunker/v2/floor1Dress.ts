// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 1's own dressing (after the station dresser's purpose pass; the
// carve and the storey's idea: gen/bunker/v2/floor1.ts). A few strong compositions per space, existing kinds only:
//  - the gallery ring: benches in rows facing the rail (the muster gallery's roll call), planters and the dead plants nobody watered,
//    the roll-call boards on the muster gallery's back wall, the overlook's plates over the lane mouths ("HABITATION COMMONS BELOW");
//  - the intake hall: the registration counter (desks + clerks' chairs) across the hall, queue barriers funnelling to the three
//    lanes, rows of waiting benches facing the screening wall, the hall's tall pendant grid;
//  - the checkpoint: a walk-through metal detector in every lane (the walkway beside it), the booths' consoles, the search table;
//  - decontamination: shower booths along the far wall, wash troughs, suit lockers, the eyewash, hazard-amber floor bands;
//  - the arrival lobby: benches, a stretcher, the first-aid kit, the wayfinding to decontamination;
//  - the freight lobby: the loading bay's amber outline round the lift apron, crates / cartons / a pallet jack on the far side;
//  - the security wing: the duty desk at the service stair, operations (radio console, control console, the map table), the
//    warden's desk, the records' filing, the guard room's mess table, the armoury's gun lockers, the holding cells' cots.
// Storage placed here opens (cabinets, lockers, crates, gun lockers, filing cabinets: existing openables / holders; their loot comes
// from the room's purpose table). Loose things move (chairs, benches, crates, bins: the dresser's own physics kinds). No food holders.

import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Side} from '../../stationTypes';
import {doorSide, placeAgainstWall, propBlocksDoorway, boxClear, rowAlongWall, tryPlaceProp, wallRange, mountProp} from '../../placeKit';
import {OPP, armoury, doorPlate, island, radioRoom, scanWall, sweepPockets, wallSign, ceilingDuct, type Dx} from '../../reactor/complex/bunkerDress';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 4) / 4;

/** QA / tests: what the last storey-1 dress placed. */
export const F1_DRESS_STATS = {props: 0, decor: 0, signs: 0, lights: 0, skipped: [] as string[]};

/** A light grid over a big area (the station dresser hangs at most three down the middle): `step` m apart, skipping spots near a fixture. */
function hallLights(D: Dx, a: Area, step: number, inset = 1.6): number {
  const rel = a.ceil - D.base, y = r3(D.base + (rel > 4.65 ? 4.5 : rel - 0.02));
  const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL;
  const nx = Math.max(1, Math.round((aw - 2 * inset) / step) + 1), nz = Math.max(1, Math.round((ah - 2 * inset) / step) + 1);
  let n = 0;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = nx === 1 ? ax0 + aw / 2 : ax0 + inset + (aw - 2 * inset) * i / (nx - 1);
    const z = nz === 1 ? az0 + ah / 2 : az0 + inset + (ah - 2 * inset) * k / (nz - 1);
    if (D.layout.lights.some(l => (l.level ?? 0) === D.lv && Math.hypot(l.x - x, l.z - z) < step * 0.55)) continue;
    D.layout.lights.push({x: r3(x), y, z: r3(z), rot: aw >= ah ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: false, power: 1, dying: false, level: D.lv});
    n++;
  }
  return n;
}

/** A floor-finish decor box (world x / z, local y) kept off every doorway's clear volume and every prop. */
function floorDecor(D: Dx, m: Parameters<Dx['decor']>[0], b: {x0: number; z0: number; x1: number; z1: number}, y1 = 0.008): boolean {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  if (propBlocksDoorway(D.layout, cx, cz, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base, y1 + 0.01)) return false;
  if (!boxClear(D.ctx, b.x0, b.x1, D.base, D.base + y1, b.z0, b.z1)) return false;
  D.decor(m, {x0: r3(b.x0), z0: r3(b.z0), x1: r3(b.x1), z1: r3(b.z1)}, 0, y1);
  return true;
}

/** An amber hazard outline (0.12 m bands) round a world rect: the loading bay, the decontamination line. */
function outline(D: Dx, b: {x0: number; z0: number; x1: number; z1: number}, w = 0.12): void {
  for (const e of [{...b, z1: b.z0 + w}, {...b, z0: b.z1 - w}, {...b, x1: b.x0 + w}, {...b, x0: b.x1 - w}]) floorDecor(D, 'plasticSeat', e);
}

const put = (D: Dx, a: Area, kind: PropKind, x: number, z: number, rot: number, o: Parameters<typeof tryPlaceProp>[6] = {}): PropPlacement | null =>
  tryPlaceProp(D.ctx, a, kind, q4(x), q4(z), rot, o);

/** Rot of a prop whose front faces side `s` of the room (front = (sin rot, cos rot)). */
const ROT_TOWARD: Record<Side, number> = {N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2};

// ---------------------------------------------------------------------------------------------------------------------------------
// The gallery ring

/** The muster gallery: two rows of benches facing the rail, planters at the row ends, the roll-call boards on the back wall. */
function musterGallery(D: Dx, a: Area, wellX0: number, wellX1: number): void {
  const rail = (a.y + a.h) * CELL; // the rail line (the well's north edge)
  const x0 = wellX0 * CELL + 1.6, x1 = wellX1 * CELL - 1.6;
  const bench = PROP_DEFS.bench;
  let n = 0;
  for (const back of [2.6, 4.6]) {
    for (let x = x0 + bench.w / 2; x + bench.w / 2 <= x1 + 1e-6; x += bench.w + 1.4) if (put(D, a, 'bench', x, rail - back, 0, {ring: 0.5})) n++;
  }
  // planters at both ends of the bench rows, and dead pot plants along the back wall
  for (const x of [x0 - 0.9, x1 + 0.9]) put(D, a, 'planterTree', x, rail - 3.6, 0, {ring: 0.5});
  const back = a.y * CELL;
  for (let i = 0; i < 4; i++) placeAgainstWall(D.ctx, a, 'noticeBoard', {sides: ['N'], y: 1.2, tries: 20});
  put(D, a, 'securityPodium', (wellX0 + wellX1) / 2 * CELL, back + 1.4, 0, {ring: 0.4});
  for (const f of [0.08, 0.92]) put(D, a, 'deadPlant', (a.x + a.w * f) * CELL, back + 0.7, 0);
  wallSign(D, a, 'N', (wellX0 + wellX1) / 2 * CELL, 3.3, {kind: 'info', text: 'ROLL CALL · REPORT TO YOUR WARDEN', w: 3.2});
  if (n < 4) F1_DRESS_STATS.skipped.push(`muster benches ${n}`);
}

/** The overlook (south gallery): two benches at its ends facing the well, plates over the lane mouths. */
function overlook(D: Dx, a: Area, lanes: Area[]): void {
  const rail = a.y * CELL;
  for (const x of [a.x * CELL + 2.2, (a.x + a.w) * CELL - 2.2]) put(D, a, 'bench', x, rail + 2.2, Math.PI, {ring: 0.5});
  for (const x of [a.x * CELL + 0.8]) put(D, a, 'pottedPlantSmall', x, (a.y + a.h) * CELL - 0.5, 0);
  const mid = lanes[1] ?? lanes[0];
  if (mid) wallSign(D, a, 'S', (mid.x + mid.w / 2) * CELL, 3.7, {kind: 'info', text: 'LEVEL 2 · HABITATION COMMONS BELOW', w: 3.4});
  for (const ln of lanes) {
    const d = D.doors(ln).find(q => q.a === a.id || q.b === a.id);
    if (d) doorPlate(D, d, a, 'EXIT · ADMISSIONS', 1.6);
  }
}

/** A gallery walk: one bench against the outer wall facing the well, a fire point. */
function galleryWalk(D: Dx, a: Area, outer: Side): void {
  const x = outer === 'W' ? a.x * CELL + PROP_DEFS.bench.d / 2 + 0.05 : (a.x + a.w) * CELL - PROP_DEFS.bench.d / 2 - 0.05;
  if (a.w * CELL >= 3) put(D, a, 'bench', x, (a.y + a.h / 2) * CELL, ROT_TOWARD[OPP[outer]]);
  scanWall(D, a, 'fireExtinguisherCabinet', [outer], 0.5);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The admission line

/** The intake hall: queue barriers to the lanes, the registration counter, waiting benches facing the screening wall. */
function intakeHall(D: Dx, a: Area, lanes: Area[]): void {
  const top = a.y * CELL, bot = (a.y + a.h) * CELL;
  // queue barriers: a pair either side of each lane's mouth, running south from the screening wall
  for (const ln of lanes) {
    const cx = (ln.x + ln.w / 2) * CELL;
    for (const s of [-1, 1]) put(D, a, 'crowdBarrier', cx + s * 1.5, top + 2.2, Math.PI / 2);
  }
  // the registration counter: desks in a line across the hall's middle, clerks behind them (north), applicants come from the south
  const zc = top + (bot - top) * 0.52;
  const desk = PROP_DEFS.desk;
  let desks = 0;
  for (let x = a.x * CELL + 3.0; x <= (a.x + a.w) * CELL - 4.0; x += desk.w + 1.6) {
    const p = put(D, a, 'desk', x, zc, 0, {ring: 0.4});
    if (!p) continue;
    desks++;
    put(D, a, 'officeSwivelChair', x, zc - desk.d / 2 - 0.45, 0, {laneOk: true});
  }
  // waiting benches: two rows near the south wall facing the screening wall
  for (const back of [1.5, 3.2]) for (let x = a.x * CELL + 2.4; x <= (a.x + a.w) * CELL - 2.4; x += PROP_DEFS.bench.w + 1.6) put(D, a, 'bench', x, bot - back, Math.PI, {ring: 0.4});
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'noticeBoard', {sides: ['W', 'S'], y: 1.2, tries: 16});
  wallSign(D, a, 'N', (a.x + a.w / 2) * CELL, 4.6, {kind: 'info', text: 'ADMISSIONS · ALL ARRIVALS REGISTER HERE', w: 4.2});
  lanes.forEach((ln, i) => {
    const d = D.doors(ln).find(q => q.a === a.id || q.b === a.id);
    if (d) doorPlate(D, d, a, `SCREENING ${i + 1}`, 1.4);
  });
  if (desks < 2) F1_DRESS_STATS.skipped.push(`intake desks ${desks}`);
}

/** A screening lane: the walk-through detector against one wall (the walkway beside it). */
function lane(D: Dx, a: Area, side: 'W' | 'E'): void {
  const det = PROP_DEFS.metalDetector;
  // along the lane (its 3.1 m width north-south), backed against the given wall
  const x = side === 'W' ? a.x * CELL + det.d / 2 + 0.02 : (a.x + a.w) * CELL - det.d / 2 - 0.02;
  const z = (a.y + a.h / 2) * CELL;
  if (!put(D, a, 'metalDetector', x, z, Math.PI / 2, {laneOk: true})) put(D, a, 'securityPodium', side === 'W' ? a.x * CELL + 0.45 : (a.x + a.w) * CELL - 0.45, z, side === 'W' ? Math.PI / 2 : -Math.PI / 2);
}

/** A guard booth: the console facing the lane door, the guard's chair. */
function booth(D: Dx, a: Area): void {
  const ds = D.doors(a)[0];
  const s = ds ? doorSide(ds, a) : 'W';
  const p = scanWall(D, a, 'monitorDesk', [OPP[s], 'N', 'S'], 0.9);
  if (p) {
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    put(D, a, 'officeSwivelChair', p.x + fx * 0.8, p.z + fz * 0.8, p.rot + Math.PI, {laneOk: true});
  }
  mountProp(D.ctx, a, OPP[s], (a.y + a.h / 2) * CELL, 'keyCabinet', 1.4, D.base);
}

/** The search room: the inspection table, a chair, the bin, a cabinet for what they took off you. */
function searchRoom(D: Dx, a: Area): void {
  island(D, a, 'table', 'S', 0.7);
  scanWall(D, a, 'cabinetLow', ['N', 'W', 'S'], 0.7);
  scanWall(D, a, 'bin', ['S', 'W'], 0);
}

/** Decontamination: shower booths on the far wall, wash troughs on a side wall, suit lockers by the dirty-side door, the eyewash. */
function decontamination(D: Dx, a: Area): void {
  const ds = D.doors(a);
  const sides = new Set(ds.map(d => doorSide(d, a)));
  const free = (['S', 'E', 'N', 'W'] as Side[]).filter(s => !sides.has(s));
  for (let i = 0; i < 3; i++) if (!scanWall(D, a, 'bunkerDeconShower', free, 1.0, undefined, true)) break;
  for (let i = 0; i < 2; i++) scanWall(D, a, 'washCounter', ['E', ...free], 0.7, undefined, true);
  for (let i = 0; i < 2; i++) scanWall(D, a, 'staffLockers', ['N'], 1.0, undefined, true);
  scanWall(D, a, 'eyewashStation', ['N', 'E'], 0.6, undefined, true);
  scanWall(D, a, 'bin', ['N', 'S'], 0, undefined, true);
  // the decontamination line: an amber band across the room between the dirty and clean sides
  const xm = (a.x + a.w * 0.5) * CELL;
  floorDecor(D, 'plasticSeat', {x0: xm - 0.08, x1: xm + 0.08, z0: a.y * CELL + 0.1, z1: (a.y + a.h) * CELL - 0.1});
}

/** The arrival lobby: benches on the south wall, a stretcher, the first-aid kit; the way to decontamination. */
function arrivalLobby(D: Dx, a: Area, decon: Area | undefined): void {
  for (let i = 0; i < 2; i++) scanWall(D, a, 'bench', ['S'], 0.6, (a.x + a.w * 0.62) * CELL);
  scanWall(D, a, 'wheeledStretcher', ['E', 'S'], 0.6);
  mountProp(D.ctx, a, 'N', (a.x + a.w * 0.6) * CELL, 'firstAidWallKit', 1.3, D.base);
  if (decon) {
    const d = D.doors(a).find(q => q.a === decon.id || q.b === decon.id);
    if (d) doorPlate(D, d, a, 'ALL ARRIVALS · DECONTAMINATION', 2.6);
  }
  wallSign(D, a, 'N', (a.x + a.w * 0.75) * CELL, 2.2, {kind: 'info', text: 'ARRIVALS · KEEP TO THE LINE', w: 2.4, arrow: 'left'});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The freight lobby and the security wing

/** The freight lobby: the loading bay outlined round the lift apron, goods stacked along the far wall, a pallet jack. */
function freightLobby(D: Dx, a: Area): void {
  const an = D.layout.bunker ? null : null; void an;
  const ap = {x: 56, y: 63, w: 12, h: 8};
  outline(D, {x0: ap.x * CELL + 0.06, z0: ap.y * CELL + 0.06, x1: (ap.x + ap.w) * CELL - 0.06, z1: (ap.y + ap.h) * CELL - 0.02});
  for (let i = 0; i < 3; i++) scanWall(D, a, 'crate', ['N'], 0, (a.x + a.w * 0.3) * CELL);
  for (let i = 0; i < 2; i++) scanWall(D, a, 'cartonStack', ['N'], 0, (a.x + a.w * 0.7) * CELL);
  scanWall(D, a, 'palletJack', ['N', 'E'], 0.4);
  scanWall(D, a, 'desk', ['W', 'N'], 0.8);
  wallSign(D, a, 'S', (ap.x + ap.w / 2) * CELL, 3.6, {kind: 'service', text: 'CARGO LIFT · KEEP BAY CLEAR', w: 3.0});
}

/** The duty hall: the duty desk facing the service stair's landing, the punch clock, the key cabinet. */
function dutyHall(D: Dx, a: Area): void {
  const desk = scanWall(D, a, 'receptionDesk', ['N'], 1.2, (a.x + a.w * 0.62) * CELL);
  if (desk) put(D, a, 'officeSwivelChair', desk.x, desk.z - 1.25, 0, {laneOk: true});
  mountProp(D.ctx, a, 'N', (a.x + a.w * 0.3) * CELL, 'punchClock', 1.3, D.base);
  scanWall(D, a, 'bench', ['W', 'N'], 0.6);
}

/** Operations: the radio console + chair (the Reactor shelter's radio room), the control console, the map table, a whiteboard. */
function operations(D: Dx, a: Area): void {
  radioRoom(D, a);
  scanWall(D, a, 'bunkerControlConsole', ['E', 'N', 'S'], 1.0, undefined, true);
  const t = island(D, a, 'conferenceTable', 'S', 0.8);
  if (t) for (const s of [-1, 1]) put(D, a, 'foldingChair', t.x + s * 0.8, t.z + 1.05, Math.PI, {laneOk: true});
  scanWall(D, a, 'mobileWhiteboard', ['W', 'S', 'N'], 0.6);
}

/** The warden's office: the desk facing the door, the chair, the coat rack, a filing cabinet. */
function wardenOffice(D: Dx, a: Area): void {
  const ms = D.doors(a)[0] ? doorSide(D.doors(a)[0], a) : 'W';
  const desk = D.layout.props.find(p => p.area === a.id && p.kind === 'desk') ?? null;
  if (desk) { const fx = Math.round(Math.sin(desk.rot)), fz = Math.round(Math.cos(desk.rot)); put(D, a, 'officeSwivelChair', desk.x - fx * 0.8, desk.z - fz * 0.8, desk.rot, {laneOk: true}); }
  scanWall(D, a, 'coatRack', [ms, 'N', 'S'], 0.4);
  scanWall(D, a, 'filingCabinet', ['N', 'S', 'E'], 0.8);
}

/** The records strongroom: filing cabinets in a row, archive boxes. */
function recordsRoom(D: Dx, a: Area): void {
  rowAlongWall(D.ctx, a, 'E', 'filingCabinet', {front: 0.8, max: 4});
  for (let i = 0; i < 2; i++) scanWall(D, a, 'archiveBoxes', ['N', 'S'], 0);
}

/** The guard room: the mess table and folding chairs (the dresser placed the gun locker / monitor desk / cabinets). */
function guardRoom(D: Dx, a: Area): void {
  const t = island(D, a, 'table', 'N', 0.7);
  if (t) for (const [dx, dz, r] of [[0, -1.15, 0], [0, 1.15, Math.PI]] as const) put(D, a, 'foldingChair', t.x + dx, t.z + dz, r, {laneOk: true});
}

/** A holding cell: a cot on one wall, a bucket. */
function holdingCell(D: Dx, a: Area): void {
  scanWall(D, a, 'palletBed', ['W', 'N', 'S'], 0.5);
  scanWall(D, a, 'bin', ['N', 'S', 'W'], 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function dressFloor1(ctx: FloorDressCtx): void {
  const S = F1_DRESS_STATS;
  S.skipped = [];
  const {layout, carved} = ctx;
  const key = carved.areas;
  const A = (k: string): Area | undefined => (key[k] !== undefined ? layout.areas[key[k]] : undefined);
  const areas = Object.values(key).map(id => layout.areas[id]);
  const D = shelterDx(layout, ctx.level, ctx.rng, areas);
  for (const i of ctx.held) D.held.add(i);
  const p0 = layout.props.length, d0 = layout.decor.length, s0 = layout.signs.length, l0 = layout.lights.length;
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } };
  const well = ctx.frame.well!.rect;
  const lanes = ['lane1', 'lane2', 'lane3'].map(A).filter((q): q is Area => !!q);

  // lights first (the dressing below keeps clear of nothing they need)
  for (const k of ['galN', 'galS', 'intake', 'freight', 'duty', 'ops', 'arrival', 'decon']) { const a = A(k); if (a) step(`lights ${k}`, () => hallLights(D, a, k === 'intake' ? 4.2 : 4.6)); }
  for (const k of ['galE', 'galW', 'guardCorr']) { const a = A(k); if (a) step(`lights ${k}`, () => hallLights(D, a, 4.0, 1.0)); }

  const galN = A('galN'), galS = A('galS'), galE = A('galE'), galW = A('galW');
  if (galN) step('muster', () => musterGallery(D, galN, well.x, well.x + well.w));
  if (galS) step('overlook', () => overlook(D, galS, lanes));
  if (galE) step('galE', () => galleryWalk(D, galE, 'E'));
  if (galW) step('galW', () => galleryWalk(D, galW, 'W'));
  const intake = A('intake');
  if (intake) step('intake', () => intakeHall(D, intake, lanes));
  lanes.forEach((ln, i) => step(`lane${i + 1}`, () => lane(D, ln, i % 2 ? 'E' : 'W')));
  for (const k of ['booth1', 'booth2']) { const a = A(k); if (a) step(k, () => booth(D, a)); }
  const search = A('search');
  if (search) step('search', () => searchRoom(D, search));
  const decon = A('decon');
  if (decon) step('decon', () => decontamination(D, decon));
  const arrival = A('arrival');
  if (arrival) step('arrival', () => arrivalLobby(D, arrival, decon));
  const freight = A('freight');
  if (freight) step('freight', () => freightLobby(D, freight));
  const duty = A('duty');
  if (duty) step('duty', () => dutyHall(D, duty));
  const ops = A('ops');
  if (ops) step('ops', () => operations(D, ops));
  const warden = A('warden');
  if (warden) step('warden', () => wardenOffice(D, warden));
  const records = A('records');
  if (records) step('records', () => recordsRoom(D, records));
  const guard = A('guard');
  if (guard) step('guard', () => guardRoom(D, guard));
  const arm = A('armoury');
  if (arm) step('armoury', () => armoury(D, arm));
  for (const k of ['cell1', 'cell2', 'cell3', 'cell4']) { const a = A(k); if (a) step(k, () => holdingCell(D, a)); }
  const corr = A('guardCorr');
  if (corr) step('corr duct', () => ceilingDuct(D, corr, 'E'));

  // plates on the rooms' doors in the shelter's words
  step('plates', () => {
    for (const [k, text] of Object.entries(PLATE_TEXT)) {
      const a = A(k);
      if (!a) continue;
      const d = D.doors(a)[0];
      if (!d) continue;
      const outside = layout.areas[d.a === a.id ? d.b : d.a];
      layout.signs = layout.signs.filter(sg => !(sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - (d.x + d.w / 2) * CELL, sg.z - (d.y + d.h / 2) * CELL) < 2.6));
      doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4);
    }
  });
  // the guarantee: no floor pocket anywhere on the storey's areas
  sweepPockets(D, areas, p0);
  S.props = layout.props.length - p0; S.decor = layout.decor.length - d0; S.signs = layout.signs.length - s0; S.lights = layout.lights.length - l0;
  void FLOOR; void wallRange;
}

const PLATE_TEXT: Readonly<Record<string, string>> = {
  decon: 'DECONTAMINATION', search: 'SEARCH ROOM', booth1: 'CHECKPOINT', booth2: 'CHECKPOINT', ops: 'OPERATIONS', warden: 'SHELTER WARDEN',
  records: 'RECORDS', guard: 'GUARD ROOM', armoury: 'ARMOURY · AUTHORISED ONLY', latrines: 'LATRINES', store: 'CONFISCATED PROPERTY', registry: 'REGISTRY',
  cell1: 'HOLDING 1', cell2: 'HOLDING 2', cell3: 'HOLDING 3', cell4: 'HOLDING 4',
};
