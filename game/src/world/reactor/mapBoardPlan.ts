// Task reactor-expansion-20261101 (lane CONTROLS): THE FLOOR-MAP BOARDS — pure data (user feedback: "it can be hard to locate the needed
// items. I think on the boards that detail what you need there should also be another board near by showing a floor map, with
// indicators (x marks the spot) on where the items are. If multi level the player should be able to select the level to look at via
// small interaction buttons on the map, similar to elevator buttons ... For example I could not find the final key to start the
// reactor."):
//  - PLACEMENT: one physical board beside each objective instruction board (layout.reactor.screens: pit board, switchgear board, pump
//    board, control monitor) on a wall of the same room — the same wall when it has room, never over a doorway / another sign / a
//    machine / a control's stand point, wall solid behind it, walkable floor in front of it;
//  - THE PLAN of each storey from the real level grid (walkable cells, stairs, the pit outline, ladders, named rooms incl. the side
//    complexes' rooms) at one shared framing;
//  - THE MARKERS from the ACTUAL generated positions and the live state: the startup key and the fuse cartridges where they lie now
//    (live pickups; carried = shown at their destination), the switchgear fuse slots / breaker, the coolant valve / pump, the key
//    switch / rods, the three generators — each X (still needed) or a check (done). No loot / enemies are shown.
// Rendering: mapBoardDraw.ts (canvas), runtime: mapBoard.ts.

import {CELL, FLOOR, type Grid} from '../../gen/grid';
import type {ReactorInfo, ReactorScreen} from '../../gen/reactor/reactorTypes';
import type {StationLayout} from '../../gen/stationTypes';
import {reactorMounts} from './controlsMount';
import type {ReactorRunState} from './runState';
import {JAM_TEXT, jamDiscovered, reactorJam} from '../../gen/reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)
import {coreAirCleared} from './endingLogic'; // task studio-reactor-surface-ending-20261102 (lane ENDING)

/** Board size (m): the map face; the storey buttons sit in a column at its right edge. */
export const MAP_BOARD = {w: 1.5, h: 1.25, depth: 0.05, gap: 0.3, centerY: 1.55, buttonR: 0.032, buttonPitch: 0.105, buttonInset: 0.085} as const;
/** The canvas of a board (px). */
export const MAP_PX = {w: 768, h: 640} as const;

export interface MapBoardPose {
  /** The instruction board it stands beside. */
  screen: ReactorScreen['id'];
  level: number;
  /** Face centre (world, on the wall + depth), outward normal (unit, horizontal), along-wall right (seen from the front). */
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  rx: number;
  rz: number;
  /** On the screen's own wall (else another wall of the same room). */
  sameWall: boolean;
}

/** A storey button (world centre, the storey it shows). */
export interface MapButton { level: number; x: number; y: number; z: number }

// ---------------------------------------------------------------------------------------------------------------------------
// Placement

const gridOf = (layout: StationLayout, level: number): Grid | null => layout.levels?.[level]?.grid ?? (level === 0 ? layout.grid : null);

function cellAt(g: Grid, x: number, z: number): number {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  return g.inBounds(cx, cy) ? cy * g.w + cx : -1;
}

/** Floor cell a board may stand over: walkable, not a stair, not a doorway (doors are kept clear). */
function openCell(g: Grid, i: number, doors: ReadonlySet<number>): boolean {
  return i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 && !doors.has(i);
}

interface Keepout { x: number; z: number; r: number }
/** A prop's plan box and vertical range (absolute). */
interface PropBox { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }

/**
 * A board centred at (cx, cz) on a wall whose room side is n and running along r, its face from y0 to y1: the wall is solid behind its
 * whole span, the floor in front is open (no door, no stair), no prop reaches into its volume (a low cabinet under it is fine; a tall
 * one, a machine or a wall-mounted sign is not), and it keeps clear of every keepout (other signs / boards, controls, stand points).
 */
function fits(g: Grid, doors: ReadonlySet<number>, cx: number, cz: number, nx: number, nz: number, rx: number, rz: number, y0: number, y1: number, keep: readonly Keepout[], props: readonly PropBox[]): boolean {
  const half = MAP_BOARD.w / 2 + 0.1, steps = Math.ceil((2 * half) / 0.2);
  for (let k = 0; k <= steps; k++) {
    const s = -half + (2 * half * k) / steps, px = cx + rx * s, pz = cz + rz * s;
    const behind = cellAt(g, px - nx * 0.25, pz - nz * 0.25), front = cellAt(g, px + nx * 0.3, pz + nz * 0.3), front2 = cellAt(g, px + nx * 0.8, pz + nz * 0.8);
    if (behind < 0 || g.cells[behind] === FLOOR) return false;
    if (!openCell(g, front, doors) || !openCell(g, front2, doors)) return false;
  }
  // the board's volume: its span, out to 0.6 m from the wall, its height (+5 cm)
  const xs = [cx - rx * half, cx + rx * half, cx - rx * half + nx * 0.6, cx + rx * half + nx * 0.6];
  const zs = [cz - rz * half, cz + rz * half, cz - rz * half + nz * 0.6, cz + rz * half + nz * 0.6];
  const vx0 = Math.min(...xs), vx1 = Math.max(...xs), vz0 = Math.min(...zs), vz1 = Math.max(...zs);
  for (const p of props) if (p.x1 > vx0 && p.x0 < vx1 && p.z1 > vz0 && p.z0 < vz1 && p.y1 > y0 - 0.05 && p.y0 < y1) return false;
  for (const k of keep) {
    // distance from the keepout to the board's span segment
    const dx = k.x - cx, dz = k.z - cz, t = Math.max(-MAP_BOARD.w / 2, Math.min(MAP_BOARD.w / 2, dx * rx + dz * rz));
    if (Math.hypot(dx - rx * t, dz - rz * t) < k.r) return false;
  }
  return true;
}

/** The objective instruction screens a map board stands beside. */
export const MAP_SCREENS: readonly ReactorScreen['id'][] = ['pitBoard', 'switchgearBoard', 'pumpBoard', 'controlMonitor'];

/**
 * Board poses beside every objective screen. `facing(sc)` = the screen's room-side normal (restartViews.ts screenFacing, the side
 * its plane is drawn on). Deterministic; a screen with no wall room nearby gets no board (never one floating / over a door).
 */
export function planMapBoards(layout: StationLayout, info: ReactorInfo, facing: (sc: ReactorScreen) => [number, number]): MapBoardPose[] {
  const out: MapBoardPose[] = [];
  const doorsBy = new Map<number, Set<number>>();
  const doorCells = (level: number): Set<number> => {
    let s = doorsBy.get(level);
    if (s) return s;
    doorsBy.set(level, (s = new Set()));
    const g = gridOf(layout, level);
    if (!g) return s;
    for (const d of layout.doors) {
      const lv = (d as {level?: number}).level ?? layout.areas[d.a]?.level ?? 0;
      if (lv !== level) continue;
      for (let y = d.y - 1; y < d.y + d.h + 1; y++) for (let x = d.x - 1; x < d.x + d.w + 1; x++) if (g.inBounds(x, y)) s.add(y * g.w + x);
    }
    return s;
  };
  const mounts = reactorMounts(info);
  for (const id of MAP_SCREENS) {
    const sc = info.screens.find(s => s.id === id);
    if (!sc) continue;
    const g = gridOf(layout, sc.level);
    if (!g) continue;
    const doors = doorCells(sc.level);
    const keep: Keepout[] = [];
    for (const s of info.screens) if (s.level === sc.level) keep.push({x: s.x, z: s.z, r: s.w / 2 + 0.2});
    for (const b of out) if (b.level === sc.level) keep.push({x: b.x, z: b.z, r: MAP_BOARD.w / 2 + 0.2});
    for (const site of info.sites) if (site.level === sc.level) for (const c of site.controls) {
      keep.push({x: c.at.x, z: c.at.z, r: 0.6}, {x: c.stand.x, z: c.stand.z, r: 0.5});
      const m = mounts.byId.get(c.id);
      if (m) keep.push({x: m.pick.x, z: m.pick.z, r: 0.6});
    }
    const [nx, nz] = facing(sc);
    const floorY = info.tiers.find(t => t.level === sc.level)?.baseY ?? 0;
    const y = floorY + MAP_BOARD.centerY, y0 = y - MAP_BOARD.h / 2, y1 = y + MAP_BOARD.h / 2;
    const props: PropBox[] = layout.props.filter(p => (p.level ?? 0) === sc.level)
      .map(p => ({x0: p.x - p.hx, z0: p.z - p.hz, x1: p.x + p.hx, z1: p.z + p.hz, y0: p.y + (p.lift ?? 0), y1: p.y + (p.lift ?? 0) + p.h}));
    const pose = (x: number, z: number, n: [number, number], same: boolean): MapBoardPose =>
      // right as seen by a viewer facing the board (= the face plane's local +X: rotation.y atan2(nx, nz) maps +X to (nz, -nx))
      ({screen: id, level: sc.level, x: x + n[0] * (MAP_BOARD.depth + 0.005), y, z: z + n[1] * (MAP_BOARD.depth + 0.005), nx: n[0], nz: n[1], rx: n[1], rz: -n[0], sameWall: same});
    // 1. the screen's own wall (the first solid cell behind the screen: a screen may hang on a machine in front of it), either side
    const rx = -nz, rz = nx;
    let wallD = 0;
    for (let d = 0; d <= 1.5; d += 0.05) { const i = cellAt(g, sc.x - nx * (d + 0.01), sc.z - nz * (d + 0.01)); if (i < 0 || g.cells[i] !== FLOOR) { wallD = d; break; } }
    const wx0 = sc.x - nx * wallD, wz0 = sc.z - nz * wallD;
    let best: MapBoardPose | null = null;
    for (let off = sc.w / 2 + MAP_BOARD.gap + MAP_BOARD.w / 2; off < sc.w / 2 + 3.5 && !best; off += 0.25) {
      for (const side of [1, -1]) {
        const cx = wx0 + rx * off * side, cz = wz0 + rz * off * side;
        if (fits(g, doors, cx, cz, nx, nz, rx, rz, y0, y1, keep, props)) { best = pose(cx, cz, [nx, nz], true); break; }
      }
    }
    // 2. another wall of the same room, nearest the screen
    if (!best) {
      const front = cellAt(g, sc.x + nx * 0.6, sc.z + nz * 0.6), area = front >= 0 ? g.area[front] : -1;
      let bd = Infinity;
      if (area >= 0) for (let i = 0; i < g.cells.length; i++) {
        if (g.area[i] !== area || !openCell(g, i, doors)) continue;
        const cx0 = (i % g.w + 0.5) * CELL, cz0 = (Math.floor(i / g.w) + 0.5) * CELL;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = cellAt(g, cx0 + dx * CELL, cz0 + dz * CELL);
          if (j < 0 || g.cells[j] === FLOOR) continue;
          // the wall face between cell i and the solid cell j; the board's normal points back into the room
          const wx = cx0 + dx * CELL / 2, wz = cz0 + dz * CELL / 2, n: [number, number] = [-dx, -dz];
          const d = Math.hypot(wx - sc.x, wz - sc.z);
          if (d >= bd || d > 9) continue;
          if (fits(g, doors, wx, wz, n[0], n[1], -n[1], n[0], y0, y1, keep, props)) { bd = d; best = pose(wx, wz, n, false); }
        }
      }
    }
    // 3. (lead merge fix: a crowded room — every wall taken by doors / machines / dressing) the nearest free wall within 9 m on the
    // same storey, any area (e.g. the corridor / deck just outside the room's door)
    if (!best) {
      let bd = Infinity;
      for (let i = 0; i < g.cells.length; i++) {
        if (!openCell(g, i, doors)) continue;
        const cx0 = (i % g.w + 0.5) * CELL, cz0 = (Math.floor(i / g.w) + 0.5) * CELL;
        if (Math.abs(cx0 - sc.x) > 9 || Math.abs(cz0 - sc.z) > 9) continue;
        if (Math.abs(g.floorOf(i) - floorY) > 0.05) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = cellAt(g, cx0 + dx * CELL, cz0 + dz * CELL);
          if (j < 0 || g.cells[j] === FLOOR) continue;
          const wx = cx0 + dx * CELL / 2, wz = cz0 + dz * CELL / 2, n: [number, number] = [-dx, -dz];
          const d = Math.hypot(wx - sc.x, wz - sc.z);
          if (d >= bd || d > 8.5) continue;
          if (fits(g, doors, wx, wz, n[0], n[1], -n[1], n[0], y0, y1, keep, props)) { bd = d; best = pose(wx, wz, n, false); }
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** The storey buttons of a board: a column at its right edge, the top storey (the rim) at the top. */
export function mapButtons(b: MapBoardPose, levels: readonly number[]): MapButton[] {
  const n = levels.length, top = b.y + ((n - 1) / 2) * MAP_BOARD.buttonPitch;
  const sx = MAP_BOARD.w / 2 - MAP_BOARD.buttonInset;
  return levels.map((level, k) => ({level, x: b.x + b.rx * sx + b.nx * 0.012, y: top - k * MAP_BOARD.buttonPitch, z: b.z + b.rz * sx + b.nz * 0.012}));
}

// ---------------------------------------------------------------------------------------------------------------------------
// The plan (one raster per storey at one framing)

/** Cell classes of a storey plan. */
export const PLAN = {none: 0, floor: 1, stairs: 2, room: 3, complex: 4} as const;

export interface StoreyPlan {
  level: number;
  label: string;
  baseY: number;
  /** Row runs of cells per class: [x0, x1 (exclusive), row, class]. */
  runs: Int32Array;
  /** Ladders on this storey (world x / z, up / down). */
  ladders: {x: number; z: number; up: boolean; down: boolean}[];
  /** Named rooms (centre world x / z, label). */
  rooms: {x: number; z: number; label: string}[];
}

export interface MapPlan {
  /** World framing shared by every storey (metres). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  pit: readonly {x: number; z: number}[];
  storeys: StoreyPlan[];
}

/** The plan of every storey (walkable cells of each level's own grid) at the union framing. Built once per world. */
export function planStoreys(layout: StationLayout, info: ReactorInfo): MapPlan {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const storeys: StoreyPlan[] = [];
  const siteArea = new Map<number, string>(), complexArea = new Map<number, string>();
  const SITE_LABEL: Record<string, string> = {rimOffice: 'RIM OFFICE', switchgear: 'SWITCHGEAR', pumpHall: 'PUMP HALL', control: 'CONTROL ROOM'};
  for (const s of info.sites) siteArea.set(s.area, SITE_LABEL[s.id] ?? s.id.toUpperCase());
  for (const c of info.complexes ?? []) for (const r of c.rooms) complexArea.set(r.area, r.label.toUpperCase());
  for (const t of info.tiers) {
    const g = gridOf(layout, t.level);
    if (!g) continue;
    const runs: number[] = [];
    for (let y = 0; y < g.h; y++) {
      let x = 0;
      while (x < g.w) {
        const i = y * g.w + x;
        const cls = g.cells[i] !== FLOOR ? PLAN.none : g.rampIdx[i] >= 0 ? PLAN.stairs : siteArea.has(g.area[i]) ? PLAN.room : complexArea.has(g.area[i]) ? PLAN.complex : PLAN.floor;
        let e = x + 1;
        while (e < g.w) {
          const j = y * g.w + e;
          const c2 = g.cells[j] !== FLOOR ? PLAN.none : g.rampIdx[j] >= 0 ? PLAN.stairs : siteArea.has(g.area[j]) ? PLAN.room : complexArea.has(g.area[j]) ? PLAN.complex : PLAN.floor;
          if (c2 !== cls) break;
          e++;
        }
        if (cls !== PLAN.none) {
          runs.push(x, e, y, cls);
          x0 = Math.min(x0, x * CELL); x1 = Math.max(x1, e * CELL); z0 = Math.min(z0, y * CELL); z1 = Math.max(z1, (y + 1) * CELL);
        }
        x = e;
      }
    }
    const ladders = (layout.traversal?.ladders ?? []).filter(l => (l.level ?? 0) === t.level || (l.topLevel ?? -99) === t.level)
      .map(l => ({x: l.x, z: l.faceZ, up: (l.level ?? 0) === t.level, down: (l.topLevel ?? -99) === t.level}));
    const rooms: StoreyPlan['rooms'] = [];
    const seen = new Set<number>();
    for (const [area, label] of [...siteArea, ...complexArea]) {
      const a = layout.areas[area];
      if (!a || seen.has(area) || (a.level ?? 0) !== t.level) continue;
      seen.add(area);
      rooms.push({x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL, label});
    }
    storeys.push({level: t.level, label: t.label, baseY: t.baseY, runs: Int32Array.from(runs), ladders, rooms});
  }
  if (!Number.isFinite(x0)) { x0 = info.pit.bounds.x0; z0 = info.pit.bounds.z0; x1 = info.pit.bounds.x1; z1 = info.pit.bounds.z1; }
  return {x0: x0 - 1, z0: z0 - 1, x1: x1 + 1, z1: z1 + 1, pit: info.pit.outline, storeys};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Markers (what the player still needs, where it is NOW)

/** (task studio-reactor-surface-ending-20261102, lane ENDING: + 'exit', the exterior doors once open) */
export type MarkerKind = 'key' | 'fuse' | 'fuseSlot' | 'breaker' | 'valve' | 'pump' | 'keyswitch' | 'rods' | 'generator' | 'exit';
/** Marker letters on the map / legend. */
export const MARKER_LETTER: Record<MarkerKind, string> = {key: 'K', fuse: 'F', fuseSlot: 'F', breaker: 'B', valve: 'V', pump: 'P', keyswitch: 'S', rods: 'R', generator: 'G', exit: 'E'};
export const MARKER_NAME: Record<MarkerKind, string> = {
  key: 'Startup key', fuse: 'Fuse cartridge', fuseSlot: 'Fuse slots (switchgear)', breaker: 'Main breaker', valve: 'Coolant valve',
  pump: 'Circulation pump', keyswitch: 'Key switch (console)', rods: 'Rod control', generator: 'Generator', exit: 'Surface exit (doors open)',
};

export interface MapMarker {
  kind: MarkerKind;
  level: number;
  x: number;
  y: number;
  z: number;
  /**
   * 'need' = still to find / do here (X), 'done' = installed / started (check), 'use' = carried: use it here (X + arrow). Task
   * reactor-playtest-round2-20261102 (lane GAS): 'jammed' = the jammed final generator (a slashed ring: nothing to do, its zone gassed).
   */
  state: 'need' | 'done' | 'use' | 'jammed';
  /** Generator id / fuse slot (labels). */
  id?: number;
}

/** What the markers read (the runtime fills it from the live game; tests from fixtures). */
export interface MarkerSource {
  info: ReactorInfo;
  state: Readonly<ReactorRunState>;
  /** Items in the player's inventory by id. */
  carried(itemId: string): number;
  /** Every live world pickup of an item (where it lies now: placed, dropped, shot loose). */
  pickups(itemId: string): readonly {x: number; y: number; z: number}[];
  /** The storey (layout.levels index) of a world point. */
  levelAt(x: number, z: number, y: number): number;
}

/** The markers of every storey (the board shows those of its selected storey). */
export function mapMarkers(src: MarkerSource): MapMarker[] {
  const {info, state: s} = src;
  const out: MapMarker[] = [];
  const ctl = (id: string) => {
    for (const site of info.sites) { const c = site.controls.find(q => q.id === id); if (c) return {c, level: site.level}; }
    return null;
  };
  const mounts = reactorMounts(info);
  const at = (id: string, kind: MarkerKind, state: MapMarker['state'], extra: Partial<MapMarker> = {}): void => {
    const q = ctl(id);
    if (!q) return;
    const p = mounts.byId.get(id)?.pick ?? q.c.at;
    out.push({kind, level: q.level, x: p.x, y: p.y, z: p.z, state, ...extra});
  };
  // the startup key: inserted (done) / carried (use it at the key switch) / where it lies
  if (s.keyInserted) at('keyswitch', 'keyswitch', 'done');
  else {
    const lying = src.pickups('reactor_key');
    for (const p of lying) out.push({kind: 'key', level: src.levelAt(p.x, p.z, p.y), x: p.x, y: p.y, z: p.z, state: 'need'});
    at('keyswitch', 'keyswitch', src.carried('reactor_key') > 0 ? 'use' : 'need');
  }
  // fuse cartridges: every live one while a slot is empty; the slots themselves
  const empty = s.fuses.filter(f => !f).length;
  if (empty > 0) for (const p of src.pickups('fuse_cartridge')) out.push({kind: 'fuse', level: src.levelAt(p.x, p.z, p.y), x: p.x, y: p.y, z: p.z, state: 'need'});
  s.fuses.forEach((f, i) => at(`fuse-${i}`, 'fuseSlot', f ? 'done' : src.carried('fuse_cartridge') > 0 ? 'use' : 'need', {id: i}));
  at('breaker', 'breaker', s.breaker ? 'done' : 'need');
  at('valve', 'valve', s.valve ? 'done' : 'need');
  at('pump', 'pump', s.pump ? 'done' : 'need');
  at('rods', 'rods', s.rods ? 'done' : 'need');
  // the generators (in their side complexes): started or not; (lane GAS) the final one is jammed — (task reactor-ending-polish-20261104)
  // marked so only once a start was tried there: until then it is one more generator to start (the player finds the jam by trying)
  const jam = jamDiscovered(s) ? reactorJam(info) : null;
  for (const g of info.generators) out.push({kind: 'generator', level: g.level, x: g.panel.x, y: g.panel.y, z: g.panel.z, state: jam?.generator === g.id ? 'jammed' : s.generators[g.id]?.started ? 'done' : 'need', id: g.id});
  // task studio-reactor-surface-ending-20261102 (lane ENDING): the exterior doors on the rim once they are open (the core air cleared
  // after ONLINE: the same rule as world/reactor/endingLogic.ts coreAirCleared — the board's signature already follows those fields)
  const sf = info.surface;
  if (sf && (s.ending?.doors || coreAirCleared(s))) out.push({kind: 'exit', level: sf.door.level, x: sf.door.x, y: sf.door.y + 1.4, z: sf.door.z, state: 'need'});
  return out;
}

/** Task reactor-playtest-round2-20261102 (lane GAS): an open mark the floor counts (X / carried); done and jammed ones are not. */
export const markerOpen = (m: Pick<MapMarker, 'state'>): boolean => m.state === 'need' || m.state === 'use';

/**
 * (lane GAS) The floor map's warning banner for storey `level`: the jammed zone's storeys while that zone is still gassed (the reactor
 * not online), else null. (task reactor-ending-polish-20261104: only once the jam is known — a start was tried — like its marker.)
 */
export function storeyWarning(info: Pick<ReactorInfo, 'zones' | 'generators'>, s: Readonly<Pick<ReactorRunState, 'restarted' | 'zoneClear'>> & {jam?: {stalls?: number}}, level: number): string | null {
  if (!jamDiscovered(s)) return null;
  const jam = reactorJam(info);
  return jam && jam.levels.includes(level) && !s.restarted && (s.zoneClear[jam.zone] ?? 0) < 1 ? JAM_TEXT.map : null;
}

/** A stable signature of the markers (redraw only on change). */
export function markerSig(ms: readonly MapMarker[]): string {
  return ms.map(m => `${m.kind}${m.id ?? ''}${m.level}:${Math.round(m.x * 4)},${Math.round(m.z * 4)}${m.state[0]}`).join('|');
}
