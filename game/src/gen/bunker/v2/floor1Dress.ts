// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 1's own dressing (after the station dresser's purpose pass; the
// carve and the storey's idea: gen/bunker/v2/floor1.ts). A few strong compositions per space, existing kinds only:
//  - the gallery ring: the muster gallery's benches in rows facing the rail, planters at the row ends, the roll-call boards and the
//    warden's podium on its back wall; the overlook's plates over the lane mouths ("HABITATION COMMONS BELOW");
//  - the intake hall: queue barriers funnelling to the three lanes, the registration counter (desks + clerks' chairs) across the
//    hall, rows of waiting benches facing the screening wall, the hall's tall pendant grid;
//  - the checkpoint: the walk-through detector filling half of every lane (the walkway beside it), the booths' monitor desks;
//  - decontamination: shower booths along the far wall, wash troughs, suit lockers, the eyewash, the amber decontamination line;
//  - the arrival lobby: benches, a stretcher, the first-aid kit, the way to decontamination;
//  - the freight lobby: the loading bay's amber outline round the lift apron, goods stacked on the far side, a pallet jack;
//  - the security wing: the duty desk + staff lockers at the service stair, operations (radio console, control console, the map
//    table), the warden's desk with the shelter's files and safe, the armoury's gun lockers, the holding cells' cots.
// Storage placed here opens (cabinets, lockers, crates, gun lockers, filing cabinets, the safe: existing openables / holders, loot from
// the room's purpose table). Loose things move (chairs, benches, crates, bins: their kinds' own physics). No food holders.

import {CELL} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Side} from '../../stationTypes';
import {boxClear, doorSide, mountProp, placeAgainstWall, propBlocksDoorway, tryPlaceProp} from '../../placeKit';
import {OPP, armoury, ceilingDuct, doorPlate, island, radioRoom, scanWall, sweepPockets, wallSign, type Dx} from '../../reactor/complex/bunkerDress';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';
import {F1_LANES} from './floor1Plan';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 4) / 4;

/** QA / tests: what the last storey-1 dress placed. */
export const F1_DRESS_STATS = {props: 0, decor: 0, signs: 0, lights: 0, detectors: 0, skipped: [] as string[]};

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

/** An amber hazard outline (0.12 m bands) round a world rect: the loading bay. */
function outline(D: Dx, b: {x0: number; z0: number; x1: number; z1: number}, w = 0.12): void {
  for (const e of [{...b, z1: b.z0 + w}, {...b, z0: b.z1 - w}, {...b, x1: b.x0 + w}, {...b, x0: b.x1 - w}]) floorDecor(D, 'plasticSeat', e);
}

const put = (D: Dx, a: Area, kind: PropKind, x: number, z: number, rot: number, o: Parameters<typeof tryPlaceProp>[6] = {}): PropPlacement | null =>
  tryPlaceProp(D.ctx, a, kind, q4(x), q4(z), rot, o);

/** Rot of a prop whose front faces side `s` of the room (front = (sin rot, cos rot)). */
const ROT_TOWARD: Record<Side, number> = {N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2};
/** The door between two areas. */
const doorTo = (D: Dx, a: Area, b: Area | undefined) => (b ? D.doors(a).find(q => q.a === b.id || q.b === b.id) : undefined);

// ---------------------------------------------------------------------------------------------------------------------------------
// The gallery ring

/** The muster gallery: two rows of benches facing the rail, planters at the row ends, the roll-call boards + the warden's podium. */
function musterGallery(D: Dx, a: Area, wellX0: number, wellX1: number): void {
  const rail = (a.y + a.h) * CELL; // the rail line (the well's north edge)
  const cx = (wellX0 + wellX1) / 2 * CELL;
  const bench = PROP_DEFS.bench, pitch = bench.w + 1.5;
  let n = 0;
  for (const back of [2.4, 4.4]) for (const k of [-1, 0, 1]) if (put(D, a, 'bench', cx + k * pitch, rail - back, 0)) n++;
  for (const s of [-1, 1]) put(D, a, 'planterTree', cx + s * (1.5 * pitch + 1.2), rail - 3.4, 0, {ring: 0.5});
  const back = a.y * CELL;
  put(D, a, 'securityPodium', cx, back + 1.0, 0, {ring: 0.3});
  for (const s of [-1, 1]) mountProp(D.ctx, a, 'N', cx + s * 2.2, 'noticeBoard', 1.2, D.base);
  mountProp(D.ctx, a, 'N', cx + 4.2, 'noticeBoard', 1.2, D.base);
  wallSign(D, a, 'N', cx, 3.4, {kind: 'info', text: 'ROLL CALL · REPORT TO YOUR WARDEN', w: 3.2});
  if (n < 4) F1_DRESS_STATS.skipped.push(`muster benches ${n}`);
}

/** The overlook (south gallery): a bench at each end facing the well, plates over the lane mouths and on the back wall. */
function overlook(D: Dx, a: Area, lanes: Area[]): void {
  const rail = a.y * CELL;
  // benches in the gaps between the lane mouths' sightlines (each lane's walk to the rail stays open: the first view)
  const mouths = lanes.map(ln => doorTo(D, ln, a)).filter(d => !!d).map(d => [d!.x, d!.x + d!.w] as const).sort((p, q) => p[0] - q[0]);
  const gaps: [number, number][] = [];
  let x0 = a.x;
  for (const [m0, m1] of mouths) { gaps.push([x0, m0]); x0 = m1; }
  gaps.push([x0, a.x + a.w]);
  for (const [g0, g1] of gaps.filter(([g0, g1]) => (g1 - g0) * CELL >= PROP_DEFS.bench.w + 1.2).slice(0, 2)) put(D, a, 'bench', (g0 + g1) / 2 * CELL, rail + 2.0, Math.PI);
  const mid = lanes[1] ?? lanes[0];
  for (const ln of lanes) {
    const d = doorTo(D, ln, a);
    if (!d) continue;
    if (ln === mid) wallSign(D, a, 'S', (d.x + d.w / 2) * CELL, 3.85, {kind: 'info', text: 'LEVEL 2 · HABITATION COMMONS BELOW', w: 3.4});
    else doorPlate(D, d, a, 'NO ENTRY · ADMISSIONS', 1.8);
  }
}

/** The wider (west) gallery walk: a bench against its outer wall facing the well. */
function galleryWalk(D: Dx, a: Area, outer: Side): void {
  if (a.w * CELL >= 3) put(D, a, 'bench', outer === 'W' ? a.x * CELL + 0.3 : (a.x + a.w) * CELL - 0.3, (a.y + a.h / 2) * CELL, ROT_TOWARD[OPP[outer]]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The admission line

/** The intake hall: queue barriers to the lanes, the registration counter, waiting benches facing the screening wall. */
function intakeHall(D: Dx, a: Area, lanes: Area[]): void {
  const top = a.y * CELL, bot = (a.y + a.h) * CELL;
  // queue barriers: one each side of every lane mouth's approach, running south from the screening wall (a funnel per lane)
  for (const ln of lanes) {
    const d = doorTo(D, ln, a);
    if (!d) continue;
    const cx = (d.x + d.w / 2) * CELL;
    for (const s of [-1, 1]) put(D, a, 'crowdBarrier', cx + s * 1.3, top + 2.1, Math.PI / 2);
  }
  // the registration counter: three desks across the hall's middle, the clerks' chairs behind them (north); applicants queue south
  const zc = Math.round((top + (bot - top) * 0.5) / CELL) * CELL; // (on a cell line: the desk covers two rows, the chair the two behind)
  const desk = PROP_DEFS.desk;
  const cx = (a.x + a.w / 2) * CELL;
  let desks = 0;
  for (const k of [-1, 0, 1]) {
    const x = cx + k * (desk.w + 2.6);
    const p = put(D, a, 'desk', x, zc, 0, {front: 0.8});
    if (!p) continue;
    p.purpose = 'agent-office'; // (the registration desks' drawers hold office things, not the hall's shelter supply)
    desks++;
    put(D, a, 'officeSwivelChair', x, zc - 1.0, 0, {laneOk: true});
  }
  // waiting benches: a row along the south wall's middle, facing the screening wall
  for (const k of [-1.5, -0.5, 0.5, 1.5]) put(D, a, 'bench', cx + k * (PROP_DEFS.bench.w + 1.4), bot - 1.6, Math.PI, {ring: 0.4});
  mountProp(D.ctx, a, 'W', (a.y + a.h / 2) * CELL, 'noticeBoard', 1.2, D.base);
  wallSign(D, a, 'N', cx, 4.6, {kind: 'info', text: 'ADMISSIONS · ALL ARRIVALS REGISTER HERE', w: 4.2});
  wallSign(D, a, 'S', cx, 2.6, {kind: 'info', text: 'HAVE YOUR SHELTER CARD READY', w: 2.8});
  lanes.forEach((ln, i) => { const d = doorTo(D, ln, a); if (d) doorPlate(D, d, a, `SCREENING ${i + 1}`, 1.4); });
  if (desks < 2) F1_DRESS_STATS.skipped.push(`intake desks ${desks}`);
}

/** A screening lane: the walk-through detector against its side wall, the walkway beside it between the two doorways. */
function lane(D: Dx, a: Area, side: 'W' | 'E'): void {
  const det = PROP_DEFS.metalDetector;
  // turned along the lane (its 3.1 m width north-south), backed against the given wall, its body clear of both doorways' cells
  const x = side === 'W' ? a.x * CELL + det.d / 2 + 0.01 : (a.x + a.w) * CELL - det.d / 2 - 0.01;
  const z = (a.y + a.h / 2) * CELL;
  if (put(D, a, 'metalDetector', x, z, side === 'W' ? Math.PI / 2 : -Math.PI / 2, {checkZone: false, laneOk: true})) F1_DRESS_STATS.detectors++;
  else F1_DRESS_STATS.skipped.push(`lane detector ${a.label}`);
}

/** A guard booth: the monitor desk on the wall facing the lane door, the guard's chair. */
function booth(D: Dx, a: Area): void {
  if (D.layout.props.some(p => p.area === a.id && (p.kind === 'monitorDesk' || p.kind === 'desk'))) return;
  const d = D.doors(a)[0];
  const s: Side = d ? doorSide(d, a) : 'W';
  const p = scanWall(D, a, 'monitorDesk', [OPP[s], 'N', 'S'], 0.9);
  if (p) {
    p.purpose = 'security-office'; // (the guard's desk: security loot in a booth that is otherwise bare)
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    put(D, a, 'officeSwivelChair', p.x + fx * 0.75, p.z + fz * 0.75, p.rot + Math.PI, {laneOk: true});
  }
}

/** The search room (the dresser furnished it as a security office): the inspection table in the middle. */
function searchRoom(D: Dx, a: Area): void {
  put(D, a, 'table', (a.x + a.w / 2) * CELL, (a.y + a.h * 0.45) * CELL, 0, {ring: 0.5});
}

/** Decontamination: shower booths along the far wall, wash troughs, suit lockers by the dirty-side door, the eyewash. */
function decontamination(D: Dx, a: Area): void {
  const sides = new Set(D.doors(a).map(d => doorSide(d, a)));
  const free = (['S', 'E', 'N', 'W'] as Side[]).filter(s => !sides.has(s));
  for (let i = 0; i < 3; i++) if (!scanWall(D, a, 'bunkerDeconShower', free, 1.0, undefined, true)) break;
  for (let i = 0; i < 2; i++) scanWall(D, a, 'washCounter', ['E', ...free], 0.7, undefined, true);
  scanWall(D, a, 'staffLockers', ['N'], 1.0, (a.x + a.w * 0.75) * CELL, true);
  mountProp(D.ctx, a, 'N', (a.x + a.w * 0.55) * CELL, 'eyewashStation', 0.9, D.base);
  // the decontamination line: an amber band across the room between the dirty (stair) side and the clean (hall) side
  const xm = (a.x + a.w * 0.45) * CELL;
  floorDecor(D, 'plasticSeat', {x0: xm - 0.08, x1: xm + 0.08, z0: a.y * CELL + 0.1, z1: (a.y + a.h) * CELL - 0.1});
}

/** The arrival lobby: benches on the south wall, a stretcher, the first-aid kit; the way to decontamination. */
function arrivalLobby(D: Dx, a: Area, decon: Area | undefined): void {
  for (let i = 0; i < 2; i++) scanWall(D, a, 'bench', ['S'], 0.6, (a.x + a.w * 0.62) * CELL);
  scanWall(D, a, 'wheeledStretcher', ['E'], 0.6);
  mountProp(D.ctx, a, 'N', (a.x + a.w * 0.62) * CELL, 'firstAidWallKit', 1.3, D.base);
  const d = doorTo(D, a, decon);
  if (d) doorPlate(D, d, a, 'ALL ARRIVALS · DECONTAMINATION', 2.6);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The freight lobby and the security wing

/** The freight lobby: the loading bay outlined round the lift apron, goods stacked on the far side, a pallet jack. */
function freightLobby(D: Dx, a: Area, apron: {x: number; y: number; w: number; h: number}): void {
  outline(D, {x0: apron.x * CELL + 0.06, z0: apron.y * CELL + 0.06, x1: (apron.x + apron.w) * CELL - 0.06, z1: (apron.y + apron.h) * CELL - 0.02});
  scanWall(D, a, 'crate', ['N'], 0, (a.x + a.w * 0.35) * CELL);
  scanWall(D, a, 'cartonStack', ['N'], 0, (a.x + a.w * 0.65) * CELL);
  scanWall(D, a, 'palletJack', ['N', 'E'], 0.4, (a.x + a.w * 0.8) * CELL);
  wallSign(D, a, 'S', (apron.x + apron.w / 2) * CELL, 3.7, {kind: 'service', text: 'CARGO LIFT · KEEP BAY CLEAR', w: 3.0});
}

/** The duty hall: the staff lockers on the back wall, the duty desk facing the service stair's landing, the punch clock, a bench. */
function dutyHall(D: Dx, a: Area): void {
  // (the locker room purpose already lined a wall with the staff lockers)
  // the duty desk stands free 2.2 m off the back wall facing the landing, the sergeant's chair between it and the wall
  const dz = a.y * CELL + 2.25;
  for (const f of [0.66, 0.6, 0.72, 0.54]) {
    const desk = put(D, a, 'receptionDesk', (a.x + a.w * f) * CELL, dz, 0);
    if (!desk) continue;
    put(D, a, 'officeSwivelChair', desk.x, a.y * CELL + 0.75, 0, {laneOk: true});
    break;
  }
  if (!D.layout.props.some(p => p.area === a.id && p.kind === 'punchClock')) mountProp(D.ctx, a, 'N', (a.x + a.w * 0.52) * CELL, 'punchClock', 1.3, D.base);
  // the guards' briefing corner at the hall's west end: the roster whiteboard on the back wall, two benches facing it
  const wb = scanWall(D, a, 'mobileWhiteboard', ['N'], 1.4, (a.x + a.w * 0.22) * CELL);
  if (wb) {
    for (const back of [2.3, 3.8]) put(D, a, 'bench', wb.x, a.y * CELL + back, Math.PI);
    wallSign(D, a, 'N', wb.x, 2.6, {kind: 'service', text: 'GUARD BRIEFING · DUTY ROSTER', w: 2.4});
  }
}

/** Operations: the radio console + chair (the Reactor shelter's radio room), the control console, the map table. */
function operations(D: Dx, a: Area): void {
  radioRoom(D, a);
  scanWall(D, a, 'bunkerControlConsole', ['E', 'N', 'S'], 1.0, undefined, true);
  island(D, a, 'conferenceTable', 'S', 0.8);
}

/** The warden's office (the dresser furnished it as an office: desk, safe, cabinets, files): his coat on the rack by the door. */
function wardenOffice(D: Dx, a: Area): void {
  if (!D.layout.props.some(p => p.area === a.id && p.kind === 'coatRack')) scanWall(D, a, 'coatRack', ['W', 'N', 'S'], 0.4);
}

/** The guard room: the dresser placed the gun locker / monitor desk / cabinets; the duty roster board. */
function guardRoom(D: Dx, a: Area): void {
  if (!D.layout.props.some(p => p.area === a.id && p.kind === 'noticeBoard')) placeAgainstWall(D.ctx, a, 'noticeBoard', {y: 1.2, tries: 16});
}

/** A holding cell: a cot on its back wall, nothing else. */
function holdingCell(D: Dx, a: Area): void {
  scanWall(D, a, 'palletBed', ['W', 'N', 'S'], 0.5);
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function dressFloor1(ctx: FloorDressCtx): void {
  const S = F1_DRESS_STATS;
  S.skipped = [];
  S.detectors = 0;
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

  // the big spaces' pendant grids (the dresser hung at most three fixtures down the middle)
  for (const k of ['galN', 'galS', 'intake', 'freight', 'duty']) { const a = A(k); if (a) step(`lights ${k}`, () => hallLights(D, a, k === 'intake' ? 5.0 : 6.0, 2.0)); }

  const at = (k: string, fn: (a: Area) => void) => { const a = A(k); if (a) step(k, () => fn(a)); };
  // the line first (its hero pieces need the most room), then the ring, then the wing
  lanes.forEach((ln, i) => step(`lane${i + 1}`, () => lane(D, ln, F1_LANES[i])));
  at('decon', a => decontamination(D, a));
  at('intake', a => intakeHall(D, a, lanes));
  at('booth1', a => booth(D, a));
  at('booth2', a => booth(D, a));
  at('search', a => searchRoom(D, a));
  at('arrival', a => arrivalLobby(D, a, A('decon')));
  at('galN', a => musterGallery(D, a, well.x, well.x + well.w));
  at('galS', a => overlook(D, a, lanes));
  at('galW', a => galleryWalk(D, a, 'W'));
  const lift = ctx.frame.anchors.find(q => q.id === 'lift');
  at('freight', a => freightLobby(D, a, lift?.apron ?? {x: 56, y: 63, w: 12, h: 8}));
  at('ops', a => operations(D, a));
  at('duty', a => dutyHall(D, a));
  at('warden', a => wardenOffice(D, a));
  at('guard', a => guardRoom(D, a));
  at('armoury', a => armoury(D, a));
  for (const k of ['cell1', 'cell2', 'cell3', 'cell4']) at(k, a => holdingCell(D, a));
  at('guardCorr', a => ceilingDuct(D, a, 'E'));

  // plates on the rooms' main doors in the shelter's words (the dresser's stock plate by that door gives way)
  step('plates', () => {
    for (const [k, text] of Object.entries(PLATE_TEXT)) {
      const a = A(k);
      const d = a ? D.doors(a)[0] : undefined;
      if (!a || !d) continue;
      const outside = layout.areas[d.a === a.id ? d.b : d.a];
      layout.signs = layout.signs.filter(sg => !(sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - (d.x + d.w / 2) * CELL, sg.z - (d.y + d.h / 2) * CELL) < 2.6));
      doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4);
    }
  });
  // the guarantee: no floor pocket anywhere on the storey's areas
  sweepPockets(D, areas, p0);
  S.props = layout.props.length - p0; S.decor = layout.decor.length - d0; S.signs = layout.signs.length - s0; S.lights = layout.lights.length - l0;
}

const PLATE_TEXT: Readonly<Record<string, string>> = {
  decon: 'DECONTAMINATION', search: 'SEARCH ROOM', booth1: 'CHECKPOINT', booth2: 'CHECKPOINT', ops: 'OPERATIONS', warden: 'SHELTER WARDEN',
  guard: 'GUARD ROOM', armoury: 'ARMOURY · AUTHORISED ONLY', latrines: 'LATRINES', store: 'CONFISCATED PROPERTY', duty: 'DUTY DESK',
  cell1: 'HOLDING 1', cell2: 'HOLDING 2', cell3: 'HOLDING 3', cell4: 'HOLDING 4',
};
