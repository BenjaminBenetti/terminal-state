// Track 2 (VIS lane): a small synthetic side-platform station whose two-track bed is continued by GEN-shaped track
// tunnels (DESIGN §1 data model; no generator involved): rasterised as lane GEN does (gen/trackExt/types.ts: a cell is
// walkable iff ALL FOUR CORNERS lie inside the smooth walls, |lat| <= width/2 and 0 <= s <= length; grid.floor written;
// everything else SOLID, incl. the rock reserved behind the cap; `centreRule` = DESIGN's stricter approximation), an annex corridor +
// room behind a door carved through the tunnel's side wall band, clue records and an `extensions` record.
//
//   grid 210 x 110 cells (105 x 55 m); platform x 25-55 m, z 20-28 (edge S); bed x 20-61 m, z 28-36 (tracks z 30, 34)
//   EAST tunnel (x1 end): 14 m straight +X, an arc (default 60 deg toward -Z, R 16 m), 14 m straight, cap (default rubble);
//        annex door on its +Z (right) wall at x 70-71.5 m; graffiti clues near the mouth pointing to the door
//   WEST tunnel (x0 end): 16 m straight -X, cap (default bulkhead), no door, no clues
import {CELL, FLOOR, Grid, VOID} from '../../src/gen/grid';
import type {Area, Door, LightPlacement, StationLayout, Trench} from '../../src/gen/station';
import type {TrackExtensions, TrackTunnel} from '../../src/gen/trackExt/types';
import {TunnelFrame} from '../../src/world/trackExt/frame';

export const TX = {W: 210, H: 110, bedY: -1.15, ceil: 4.4, bedZ0: 28, bedZ1: 36, x0: 20, x1: 61, tracks: [30, 34], annexCeil: -1.15 + 2.6} as const;

export interface TrackExtFixtureOpts {
  eastCap?: TrackTunnel['cap']['kind'];
  westCap?: TrackTunnel['cap']['kind'];
  /** Signed turn of the east arc (deg; + turns toward -Z = left of +X travel). 0 = straight. */
  bend?: number;
  /** Write the data with the mirrored left-normal convention (+left = +Z when travelling +X). */
  mirrored?: boolean;
  /** Omit the west tunnel (its end keeps the black plane + barricade). */
  noWest?: boolean;
  /** Add a second annex door on the east arc's outer wall (a door rect straddling the curved wall line). */
  bendDoor?: boolean;
  /** Length of a STRAIGHT east tunnel (with bend 0; the grid grows east to fit). Default 34 m. */
  eastLen?: number;
  /** Rasterise with DESIGN §1's "centre within width/2 - 0.3" instead of GEN's exact all-corners rule. */
  centreRule?: boolean;
}

export interface TrackExtFixture {
  layout: StationLayout;
  ext: TrackExtensions;
  ids: Record<string, number>;
  east: TrackTunnel;
  west: TrackTunnel | null;
}

/** Centreline from segments (straight `len` m / arc `turn` rad at radius R), sampled every <= 0.5 m. */
export function pathOf(x: number, z: number, heading: number, segs: ({len: number} | {turn: number; R: number})[]): {x: number; z: number}[] {
  const out = [{x, z}];
  let h = heading;
  for (const sg of segs) {
    if ('len' in sg) {
      const n = Math.max(1, Math.ceil(sg.len / 0.5));
      for (let i = 1; i <= n; i++) out.push({x: x + Math.cos(h) * sg.len * i / n, z: z + Math.sin(h) * sg.len * i / n});
      x += Math.cos(h) * sg.len; z += Math.sin(h) * sg.len;
    } else {
      const arc = Math.abs(sg.turn) * sg.R, n = Math.max(1, Math.ceil(arc / 0.5)), d = arc / n, dh = sg.turn / n;
      for (let i = 0; i < n; i++) {
        // Chord step at the mid heading keeps the samples on the circle.
        const hm = h + dh / 2, c = 2 * sg.R * Math.sin(Math.abs(dh) / 2);
        x += Math.cos(hm) * c; z += Math.sin(hm) * c; h += dh;
        out.push({x, z});
      }
      void d;
    }
  }
  return out;
}

export function trackExtFixture(o: TrackExtFixtureOpts = {}): TrackExtFixture {
  const H = TX.H;
  const W = Math.max(TX.W, Math.ceil((TX.x1 + (o.eastLen ?? 0) + 6) / CELL));
  const g = new Grid(W, H);
  g.voidFloor = TX.bedY;
  const areas: Area[] = [];
  const ids: Record<string, number> = {};
  const area = (name: string, r: {x: number; y: number; w: number; h: number}, kind: Area['kind'], type: Area['type'], ceil: number, publicSpace: boolean, extra: Partial<Area> & {ext?: 'tunnel' | 'annex'; extId?: number} = {}): Area => {
    const a = {...r, id: areas.length, kind, type, label: name, ceil, parent: -1, depth: 0, publicSpace, lighting: 'dark', ...extra} as Area;
    areas.push(a);
    ids[name] = a.id;
    return a;
  };
  const carve = (r: {x: number; y: number; w: number; h: number}, cell: number, floor: number, ceil: number, id: number) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = y * W + x; g.cells[i] = cell; g.floor[i] = floor; g.ceil[i] = ceil; g.area[i] = id; }
  };
  const P = area('platform', {x: 50, y: 40, w: 60, h: 16}, 'platform', 'platform', TX.ceil, true, {edge: 'S', platformNo: 1, lighting: 'lit'});
  carve(P, FLOOR, 0, TX.ceil, P.id);
  carve({x: TX.x0 / CELL, y: TX.bedZ0 / CELL, w: (TX.x1 - TX.x0) / CELL, h: (TX.bedZ1 - TX.bedZ0) / CELL}, VOID, TX.bedY, TX.ceil, -1);
  const trench: Trench = {x0: TX.x0, x1: TX.x1, z0: TX.bedZ0, z1: TX.bedZ1, floorY: TX.bedY, platformX0: 25, platformX1: 55, tracks: [...TX.tracks], third: [1, -1], columns: true, ceil: TX.ceil};

  const mirror = o.mirrored ? -1 : 1;
  const zc = (TX.bedZ0 + TX.bedZ1) / 2;
  const bend = ((o.bend ?? 60) * Math.PI) / 180;
  // East: heading +X; a left turn (toward -Z) decreases the heading angle in (x, z).
  const eastPath = pathOf(TX.x1, zc, 0, bend ? [{len: 14}, {turn: -bend, R: 16}, {len: 14}] : [{len: o.eastLen ?? 34}]);
  const westPath = pathOf(TX.x0, zc, Math.PI, [{len: 16}]);
  const tunnels: TrackTunnel[] = [];
  const mk = (id: number, from: 'x0' | 'x1', path: {x: number; z: number}[], cap: TrackTunnel['cap']['kind'], first: number, arcs: {s: number; len: number; radius: number; turnDeg: number}[]): TrackTunnel => {
    const f = new TunnelFrame({id, trench: 0, from, floorY: TX.bedY, ceilY: TX.ceil, width: 8, path, length: 0, rails: [], cap: {kind: cap, s: 0}, areas: [], doors: [], clues: []});
    const p0 = f.first;
    // rails = lateral offsets (+left) of the bed's tracks at the mouth (TunnelFrame convention, or mirrored data).
    const rails = TX.tracks.map(tz => mirror * (tz - p0.z) / p0.lz);
    // (+ lane GEN's additions firstStraight / arcs, so the fixture also type-checks against GEN's types.ts)
    return {id, trench: 0, from, floorY: TX.bedY, ceilY: TX.ceil, width: 8, path, length: f.length, rails, cap: {kind: cap, s: f.length}, areas: [], doors: [], clues: [], firstStraight: first, arcs} as TrackTunnel;
  };
  const east = mk(0, 'x1', eastPath, o.eastCap ?? 'rubble', bend ? 14 : o.eastLen ?? 34, bend ? [{s: 14, len: 16 * bend, radius: 16, turnDeg: (bend * 180) / Math.PI}] : []);
  tunnels.push(east);
  const west = o.noWest ? null : mk(1, 'x0', westPath, o.westCap ?? 'bulkhead', 16, []);
  if (west) tunnels.push(west);

  // Rasterise each tunnel's walkable cells (GEN: all four corners inside; or DESIGN's centre within width/2 - 0.3).
  for (const t of tunnels) {
    const a = area(`tunnel${t.id}`, {x: 0, y: 0, w: 1, h: 1}, 'passage', 'passage', t.ceilY, false, {ext: 'tunnel', extId: t.id});
    t.areas.push(a.id);
    const f = new TunnelFrame(t);
    let x0: number = W, y0: number = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (g.cells[i] !== 0) continue;
      if (o.centreRule) {
        const c = f.project((x + 0.5) * CELL, (y + 0.5) * CELL);
        if (c.s < 0 || c.s > t.length - 0.6 || Math.abs(c.lat) > t.width / 2 - 0.3) continue;
      } else {
        let ok = true;
        for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const c = f.project((x + u) * CELL, (y + v) * CELL);
          if (c.s < -1e-6 || c.s > t.length + 1e-6 || Math.abs(c.lat) > t.width / 2 + 1e-6) { ok = false; break; }
        }
        if (!ok) continue;
      }
      g.cells[i] = FLOOR; g.floor[i] = t.floorY; g.ceil[i] = t.ceilY; g.area[i] = a.id;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    Object.assign(a, {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1});
  }

  // Annex: a 2 m corridor parallel to the east tunnel's +Z wall and a room behind it; doors carved through the bands.
  const doors: Door[] = [];
  const C = area('annexCorridor', {x: 130, y: 73, w: 40, h: 4}, 'service', 'service-corridor', TX.annexCeil, false, {ext: 'annex', extId: 0, floorY: TX.bedY});
  const R = area('annexRoom', {x: 140, y: 78, w: 26, h: 18}, 'room', 'utility', TX.annexCeil, false, {ext: 'annex', extId: 0, floorY: TX.bedY});
  carve(C, FLOOR, TX.bedY, TX.annexCeil, C.id);
  carve(R, FLOOR, TX.bedY, TX.annexCeil, R.id);
  const door = (r: {x: number; y: number; w: number; h: number}, a: Area, b: Area) => {
    carve(r, FLOOR, TX.bedY, TX.bedY + 2.3, b.id);
    doors.push({...r, id: doors.length, a: a.id, b: b.id, height: 2.3, arch: false} as Door);
    return doors.length - 1;
  };
  const eastArea = areas[east.areas[0]];
  // GEN: the entry door is carved in the rock between the (grid-aligned) shell wall and the corridor; DESIGN's centre rule
  // leaves a SOLID row inside the wall, which the door then crosses too.
  const d0 = door(o.centreRule ? {x: 140, y: 71, w: 3, h: 2} : {x: 140, y: 72, w: 3, h: 1}, eastArea, C);
  door({x: 150, y: 77, w: 3, h: 1}, C, R);
  const fE = new TunnelFrame(east);
  const dS = fE.project(70.75, 36).s;
  // Right of +X travel is +Z: side -1 in the documented convention (the mirrored data writes +1).
  east.doors.push({annex: 0, door: d0, s: dS, side: (-1 * mirror) as 1 | -1});
  east.clues.push({s: 4, side: (-1 * mirror) as 1 | -1, kind: 'arrow', toward: 1}, {s: 5.5, side: (1 * mirror) as 1 | -1, kind: 'tag', toward: 1});

  const annexes: TrackExtensions['annexes'] = [{id: 0, tunnel: 0, door: d0, areas: [C.id, R.id], floorY: TX.bedY, ceilY: TX.annexCeil, cells: C.w * C.h + R.w * R.h, areaM2: (C.w * C.h + R.w * R.h) * 0.25, exit: {x: 70.75, z: 36}}];
  if (o.bendDoor && bend) {
    // A second door on the arc's OUTER (right) wall: an axis-aligned 3 x 3 cell rect straddling the curved wall line,
    // into a small room carved only outside the corridor.
    const sD = 22, out = fE.at(sD);
    const ox = -out.lx, oz = -out.lz; // outward = right of travel (documented convention)
    const [wx, wz] = fE.point(sD, -4);
    const room = area('bendRoom', {x: 0, y: 0, w: 1, h: 1}, 'room', 'storage', TX.annexCeil, false, {ext: 'annex', extId: 1, floorY: TX.bedY});
    let rx0: number = W, ry0: number = H, rx1 = 0, ry1 = 0;
    const rc = [wx + ox * 3, wz + oz * 3];
    for (let y = Math.floor((rc[1] - 2.2) / CELL); y <= Math.floor((rc[1] + 2.2) / CELL); y++) for (let x = Math.floor((rc[0] - 2.2) / CELL); x <= Math.floor((rc[0] + 2.2) / CELL); x++) {
      const c = fE.project((x + 0.5) * CELL, (y + 0.5) * CELL);
      if (Math.abs(c.lat) < 4 + 0.6 && c.s > 0 && c.s < fE.length) continue;
      carve({x, y, w: 1, h: 1}, FLOOR, TX.bedY, TX.annexCeil, room.id);
      rx0 = Math.min(rx0, x); ry0 = Math.min(ry0, y); rx1 = Math.max(rx1, x); ry1 = Math.max(ry1, y);
    }
    Object.assign(room, {x: rx0, y: ry0, w: rx1 - rx0 + 1, h: ry1 - ry0 + 1});
    const dc = [wx + ox * 0.25, wz + oz * 0.25];
    const d1 = door({x: Math.floor(dc[0] / CELL) - 1, y: Math.floor(dc[1] / CELL) - 1, w: 3, h: 3}, eastArea, room);
    east.doors.push({annex: 1, door: d1, s: sD, side: (-1 * mirror) as 1 | -1});
    annexes.push({id: 1, tunnel: 0, door: d1, areas: [room.id], floorY: TX.bedY, ceilY: TX.annexCeil, cells: room.w * room.h, areaM2: room.w * room.h * 0.25, exit: {x: wx, z: wz}});
  }

  const lights: LightPlacement[] = [{x: 40, y: 4.25, z: 24, rot: 0, area: P.id, broken: false, flicker: false, warm: false, power: 1, dying: false}];
  const ext = {
    core: {x: 0, y: 0, w: W, h: H}, shift: {x: 0, z: 0}, // lane GEN's additions (unused by VIS)
    tunnels, annexes,
    log: [{trench: 0, from: 'x1', result: 'tunnel+annex'}, {trench: 0, from: 'x0', result: o.noWest ? 'omitted' : 'tunnel'}],
  } as TrackExtensions;
  const layout = {
    seed: 4242, attempt: 0, name: 'TrackExt Fixture', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: g, areas, doors, props: [], lights, signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 40, z: 24, yaw: 0}, trench, trenches: [trench], platform: P.id, platforms: [P.id],
    traversal: {stairs: [], ladders: [], underpasses: []}, levels: [{id: 0, role: 'main', grid: g, baseY: 0}], levelLinks: [],
    extensions: ext,
  } as unknown as StationLayout;
  return {layout, ext, ids, east, west};
}
