// Task reactor-expansion-20261101 (lane CONTROLS): THE MOUNTED-CONTROL RULE of the Reactor — one pure module both sides use, so the
// machine model (lane ARCH's kit: world/reactor/archKit.ts planSite / planGenerator), the machine's collision footprint (GEN's
// ReactorMachine record + its 'annexMachine' prop) and the restart's control overlay + pick volume (world/reactor/restart.ts /
// restartViews.ts) can never disagree again (user feedback: "the main breaker and fuse slot controls are floating in front of the
// electrical box thing" / "circulation pump hit box is miss aligned with model, hit box is off by 90deg").
//
// The rule (docs/reactor.md "Mounted controls"):
//  1. A HOST MODEL is placed FROM ITS MACHINE FOOTPRINT (ReactorMachine x / z / yaw / w / d), never from a control point: its
//     measured MOUNTING FACE (probed from the cooked GLB, HOST_FACES — not the bounding box: the switchgear's door is 0.26 m behind
//     its lever handle) lies on the footprint's front plane, its long axis follows the footprint's long axis (the pump: motor end
//     toward the operator), so the visual, the collider and the use point are one frame.
//  2. A CONTROL is mounted ON its host's measured face: its overlay frame (origin = a point of the face, +Z = the face normal out of
//     the model, +Y = the face's up) puts the overlay's back plane EMBED m into the face (covers the paint relief), never in front of
//     it; the overlay's extent (OVERLAY_EXTENT) is clamped inside the face's CLEAR rectangle (no gauge / handle / hinge under it), at
//     the spot nearest the generated control point (a switchgear control takes the nearest free cabinet section).
//  3. The pick volume is the mounted overlay's centre (MountedControl.pick), not the generated point.
//  4. Overlay housings take the host's look (world/reactor/controlsSkin.ts: the Codex rusted-steel set tinted to the host's measured
//     paint), never a flat untextured block.
// Pure numbers (no three.js): archKit / the views turn them into matrices.

import type {ReactorControl, ReactorGenerator, ReactorInfo, ReactorMachine, ReactorSite} from '../../gen/reactor/reactorTypes';
import {REACTOR_KIT} from '../../assets/reactorKit.generated';

export type HostPiece = 'switchgear' | 'coolantPump' | 'coolantValve' | 'controlConsole';

/**
 * Measured model-space faces of the host models (m at scale 1; front +Z, base y 0, centred x / z as cooked). Probed from the cooked
 * GLB vertex data (outermost-surface depth maps at 2 cm, 2026-11-01; game/tests/reactor-x-controls-mount.test.ts re-probes them):
 *  - switchgear: the door plane z 0.39 (bbox front 0.65 = the lever handle); flat door x -0.38..0.04, y 1.12..1.46 (the toggle
 *    cluster / lever at x 0.06..0.32, gauge bosses above 1.47, the hinge at -0.42); body back -0.65;
 *  - coolantPump: the motor end cover (-X end, plane x -1.75) is a flat disc r ~0.36 about (y 1.0, z 0); the pump end (+X) is an open
 *    discharge flange;
 *  - controlConsole: the sloped desk (30 deg) from (z 0.40, y 0.82) up to (z 0.07, y 1.01), flat across |x| < 1.4 (knobs < 1 cm);
 *  - coolantValve: the rising-stem handwheel, rim r 0.43 about (0, 1.93, 0), every wheel vertex above y 1.895 (the stem below is
 *    r 0.09); the bonnet front z 0.355 at y 0.93..0.99;
 *  - generator: the control box on the +Z long side, face z 0.77, x 1.9..2.3, y 0.85..1.5 (the body side is z 0.59).
 */
export const HOST_FACES = {
  switchgear: {doorZ: 0.39, backZ: -0.65, clear: {x0: -0.38, x1: 0.04, y0: 1.12, y1: 1.46}},
  coolantPump: {endX: -1.75, disc: {y: 1.0, z: 0, r: 0.35}},
  controlConsole: {desk: {zF: 0.4, yF: 0.82, zB: 0.07, yB: 1.01}, clearX: 1.38},
  coolantValve: {wheel: {y: 1.93, r: 0.43, cutY: 1.895}, lamp: {y: 0.96, z: 0.355}},
  generator: {box: {x0: 1.9, x1: 2.3, y0: 0.85, y1: 1.5, z: 0.77}},
} as const;

/** Real-size dims (W x H x D) of the host models (REACTOR_KIT, cooked). */
export const HOST_DIMS: Readonly<Record<HostPiece | 'generator', readonly [number, number, number]>> = {
  switchgear: REACTOR_KIT.switchgear.dims, coolantPump: REACTOR_KIT.coolantPump.dims, coolantValve: REACTOR_KIT.coolantValve.dims,
  controlConsole: REACTOR_KIT.controlConsole.dims, generator: REACTOR_KIT.generator.dims,
};

/** How far an overlay's back plane sinks into its host face (m): covers paint relief, never a visible gap. */
export const EMBED = 0.012;

/** The overlay's visible extent in its own mount frame (x across the face, y up the face, depth out of it; m). */
export const OVERLAY_EXTENT: Readonly<Record<string, {x0: number; x1: number; y0: number; y1: number; depth: number}>> = {
  'fuse-0': {x0: -0.19, x1: 0.19, y0: -0.07, y1: 0.11, depth: 0.09},
  'fuse-1': {x0: -0.19, x1: 0.19, y0: -0.07, y1: 0.11, depth: 0.09},
  breaker: {x0: -0.09, x1: 0.09, y0: -0.16, y1: 0.16, depth: 0.12},
  pump: {x0: -0.11, x1: 0.23, y0: -0.15, y1: 0.15, depth: 0.07},
  keyswitch: {x0: -0.065, x1: 0.065, y0: -0.085, y1: 0.085, depth: 0.05},
  rods: {x0: -0.08, x1: 0.08, y0: -0.17, y1: 0.17, depth: 0.08},
  valve: {x0: -0.43, x1: 0.43, y0: -0.43, y1: 0.43, depth: 0.06},
};

/** A placed host model: origin = its model origin (bottom centre) in world m, three rotation.y, per-axis scale. */
export interface HostPlacement {
  piece: HostPiece;
  x: number;
  y: number;
  z: number;
  rotY: number;
  sx: number;
  sy: number;
  sz: number;
  /** Index into the site's machines (-1: derived from the controls — a layout without machine records). */
  machine: number;
}

/** A control's mount: the overlay frame (origin on the host face, unit normal n out of it, unit up u in it) and the pick point. */
export interface MountedControl {
  id: string;
  host: HostPiece | null;
  /** Index into the site's host placements (-1: no host — the control stands at its own point). */
  placement: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  ux: number;
  uy: number;
  uz: number;
  /** Where the pick sphere / prompt / cues aim: the overlay's centre (world). */
  pick: {x: number; y: number; z: number};
  /** Unit horizontal "front" of the control (toward its operator): the in-sight test point is taken along it. */
  fx: number;
  fz: number;
}

type P3 = {x: number; y: number; z: number};
type Frame = Pick<HostPlacement, 'x' | 'y' | 'z' | 'rotY' | 'sx' | 'sy' | 'sz'>;

// ---------------------------------------------------------------------------------------------------------------------------
// Frames

/** Model-local (x, y, z) of a placement -> world (three's rotation.y: x' = x cos + z sin, z' = -x sin + z cos). */
export function hostToWorld(p: Frame, lx: number, ly: number, lz: number): P3 {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY), X = lx * p.sx, Z = lz * p.sz;
  return {x: p.x + X * c + Z * s, y: p.y + ly * p.sy, z: p.z - X * s + Z * c};
}
/** A model-local direction -> world (rotation only). */
export function hostDir(rotY: number, dx: number, dy: number, dz: number): P3 {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return {x: dx * c + dz * s, y: dy, z: -dx * s + dz * c};
}
/** World point -> model-local (inverse of hostToWorld). */
export function worldToHost(p: Frame, wx: number, wy: number, wz: number): P3 {
  const c = Math.cos(p.rotY), s = Math.sin(p.rotY), dx = wx - p.x, dz = wz - p.z;
  return {x: (dx * c - dz * s) / p.sx, y: (wy - p.y) / p.sy, z: (dx * s + dz * c) / p.sz};
}

/** three rotation.y that turns model +Z to the horizontal direction (fx, fz). */
export const rotYToward = (fx: number, fz: number): number => Math.atan2(fx, fz);

/** The machine piece a control id is mounted on. */
export function hostOfControl(id: string): HostPiece | null {
  if (/^(fuse|breaker)/.test(id)) return 'switchgear';
  if (id === 'pump') return 'coolantPump';
  if (id === 'valve') return 'coolantValve';
  if (id === 'rods' || id === 'keyswitch') return 'controlConsole';
  return null;
}
const MACHINE_PIECE: Record<ReactorMachine['kind'], HostPiece | null> = {switchgear: 'switchgear', pump: 'coolantPump', valve: 'coolantValve', console: 'controlConsole', statusBoard: null};

/** Unit front of a machine record (camera-convention yaw: the front faces the operator). */
export const machineFront = (m: Pick<ReactorMachine, 'yaw'>): [number, number] => [-Math.sin(m.yaw), -Math.cos(m.yaw)];

/**
 * Footprint extent ALONG the machine's front direction (GEN convention, gen/reactor/structure.ts machine(): `w` runs along the room
 * wall axis, `d` inward; only the pump's front is an along-wall end face, so its `w` is along the front).
 */
export const machineDepth = (m: Pick<ReactorMachine, 'kind' | 'w' | 'd'>): number => (m.kind === 'pump' ? m.w : m.d);
/** Footprint extent ACROSS the front. */
export const machineWidth = (m: Pick<ReactorMachine, 'kind' | 'w' | 'd'>): number => (m.kind === 'pump' ? m.d : m.w);

/** Unit front of a control (toward its stand point; else its yaw). */
export function controlFrontOf(c: Pick<ReactorControl, 'at' | 'stand' | 'yaw'>): [number, number] {
  const dx = c.stand.x - c.at.x, dz = c.stand.z - c.at.z, l = Math.hypot(dx, dz);
  if (l > 0.05) return [dx / l, dz / l];
  return [-Math.sin(c.yaw), -Math.cos(c.yaw)];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Host placements of a site

/** The section stretch a switchgear bank allows so its cabinets exactly fill the collider (the model is ONE cabinet section). */
const SECTION_STRETCH: readonly [number, number] = [0.85, 1.2];

/** The bank's sections: count n and the x stretch sx so n sections exactly fill `len` (the collider) — closest to real size. */
export function bankSections(len: number, w: number = HOST_DIMS.switchgear[0]): {n: number; sx: number} {
  let best = {n: Math.max(1, Math.round(len / w)), sx: 1, e: Infinity};
  for (let n = 1; n <= 12; n++) {
    const sx = len / (n * w);
    if (sx < SECTION_STRETCH[0] || sx > SECTION_STRETCH[1]) continue;
    const e = Math.abs(Math.log(sx));
    if (e < best.e) best = {n, sx, e};
  }
  if (!Number.isFinite(best.e)) best.sx = len / (best.n * w);
  return {n: best.n, sx: best.sx};
}

/**
 * A machine record of a piece derived from its controls (a layout without machine records — old saves / test fixtures): the
 * footprint's front plane through the controls (the mounting face where the controls are), across them, the model's depth behind.
 */
function derivedMachine(site: ReactorSite, piece: HostPiece, floorY: number): ReactorMachine | null {
  const ctl = site.controls.filter(c => hostOfControl(c.id) === piece);
  if (!ctl.length) return null;
  const [fx, fz] = controlFrontOf(ctl[0]);
  const yaw = Math.atan2(-fx, -fz);
  const tx = -fz, tz = fx; // across the front
  const ps = ctl.map(c => (c.at.x - ctl[0].at.x) * tx + (c.at.z - ctl[0].at.z) * tz);
  const [W, , D] = HOST_DIMS[piece];
  const kind: ReactorMachine['kind'] = piece === 'switchgear' ? 'switchgear' : piece === 'coolantPump' ? 'pump' : piece === 'coolantValve' ? 'valve' : 'console';
  const depth = piece === 'switchgear' ? HOST_FACES.switchgear.doorZ - HOST_FACES.switchgear.backZ : piece === 'coolantPump' ? W : D;
  // a derived switchgear bank: whole real-size sections (at least four) across its controls
  const across = piece === 'switchgear' ? Math.max(4, Math.ceil((Math.max(...ps) - Math.min(...ps) + W) / W - 1e-6)) * W : piece === 'coolantPump' ? D : W;
  const mid = (Math.max(...ps) + Math.min(...ps)) / 2;
  const cx = ctl[0].at.x + tx * mid - fx * depth / 2, cz = ctl[0].at.z + tz * mid - fz * depth / 2;
  const w = kind === 'pump' ? depth : across, d = kind === 'pump' ? across : depth;
  return {kind, x: cx, z: cz, y: floorY, yaw, w, d, h: HOST_DIMS[piece][1], prop: -1};
}

/** One machine record -> its host model placement(s) (the switchgear: one per cabinet section, left to right along the bank). */
export function machinePlacements(m: ReactorMachine, index: number): HostPlacement[] {
  const piece = MACHINE_PIECE[m.kind];
  if (!piece) return [];
  const [fx, fz] = machineFront(m);
  const rotFront = rotYToward(fx, fz); // model +Z -> front
  const depth = machineDepth(m), across = machineWidth(m);
  switch (piece) {
    case 'switchgear': {
      // the door plane on the footprint front, n sections stretched to exactly the collider's length
      const {n, sx} = bankSections(across);
      const W = HOST_DIMS.switchgear[0] * sx;
      const tx = Math.cos(rotFront), tz = -Math.sin(rotFront); // model +X in world
      const frontX = m.x + fx * depth / 2, frontZ = m.z + fz * depth / 2;
      const ox = frontX - fx * HOST_FACES.switchgear.doorZ, oz = frontZ - fz * HOST_FACES.switchgear.doorZ;
      const out: HostPlacement[] = [];
      for (let k = 0; k < n; k++) {
        const s = -across / 2 + (k + 0.5) * W;
        out.push({piece, x: ox + tx * s, y: m.y, z: oz + tz * s, rotY: rotFront, sx, sy: 1, sz: 1, machine: index});
      }
      return out;
    }
    case 'coolantPump':
      // the long axis (model X) along the footprint's depth, the motor end (-X) at the front: model -X -> front
      return [{piece, x: m.x, y: m.y, z: m.z, rotY: Math.atan2(fz, -fx), sx: 1, sy: 1, sz: 1, machine: index}];
    default:
      // valve / console: centred on the footprint, front +Z toward the operator
      return [{piece, x: m.x, y: m.y, z: m.z, rotY: rotFront, sx: 1, sy: 1, sz: 1, machine: index}];
  }
}

/** Every host placement of a site (its machine records; a piece without one is derived from its controls). */
export function siteHosts(site: ReactorSite, floorY: number): HostPlacement[] {
  const out: HostPlacement[] = [];
  const have = new Set<HostPiece>();
  (site.machines ?? []).forEach((m, i) => {
    const pl = machinePlacements(m, i);
    if (pl.length) have.add(pl[0].piece);
    out.push(...pl);
  });
  for (const piece of ['switchgear', 'coolantPump', 'coolantValve', 'controlConsole'] as HostPiece[]) {
    if (have.has(piece)) continue;
    const m = derivedMachine(site, piece, floorY);
    if (m) out.push(...machinePlacements(m, -1));
  }
  return out;
}

/** The floor height of a site (its tier's deck), else the lowest control - 1.1 m. */
export function siteFloorY(info: Pick<ReactorInfo, 'tiers'>, site: ReactorSite): number {
  const t = info.tiers.find(q => q.level === site.level)?.baseY;
  const lo = site.controls.length ? Math.min(...site.controls.map(c => c.at.y)) : 0;
  return t !== undefined && lo - t < 2.6 && lo >= t - 0.05 ? t : lo - 1.1;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Mounts

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

function frameMount(id: string, host: HostPiece | null, placement: number, o: P3, n: P3, u: P3): MountedControl {
  const e = OVERLAY_EXTENT[id] ?? {x0: -0.1, x1: 0.1, y0: -0.1, y1: 0.1, depth: 0.05};
  // right = u x n (the overlay's +X)
  const rx = u.y * n.z - u.z * n.y, ry = u.z * n.x - u.x * n.z, rz = u.x * n.y - u.y * n.x;
  const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2, cz = e.depth / 2 - EMBED;
  const pick = {x: o.x + rx * cx + u.x * cy + n.x * cz, y: o.y + ry * cx + u.y * cy + n.y * cz, z: o.z + rz * cx + u.z * cy + n.z * cz};
  let fx = n.x, fz = n.z;
  if (Math.hypot(fx, fz) < 0.3) { fx = u.x; fz = u.z; } // a horizontal face (the valve's handwheel): its front is the face's up
  const fl = Math.hypot(fx, fz) || 1;
  return {id, host, placement, x: o.x, y: o.y, z: o.z, nx: n.x, ny: n.y, nz: n.z, ux: u.x, uy: u.y, uz: u.z, pick, fx: fx / fl, fz: fz / fl};
}

/** A control without a host model (an unknown id): at its own point, facing its stand. */
function bareMount(c: ReactorControl): MountedControl {
  const [fx, fz] = controlFrontOf(c);
  return frameMount(c.id, null, -1, c.at, {x: fx, y: 0, z: fz}, {x: 0, y: 1, z: 0});
}

/** The switchgear door mount of control `id` on section `h` nearest the world point `at` (model-local x, y). */
function doorSpot(h: HostPlacement, id: string, at: P3): {lx: number; ly: number} {
  const e = OVERLAY_EXTENT[id], C = HOST_FACES.switchgear.clear;
  const l = worldToHost(h, at.x, at.y, at.z);
  // the door's features stretch with the section (sx); the overlay keeps its real size
  return {lx: clamp(l.x, C.x0 - e.x0 / h.sx, C.x1 - e.x1 / h.sx), ly: clamp(l.y, C.y0 - e.y0, C.y1 - e.y1)};
}

/** The console desk point at model-local (x, z) and the desk's model-space normal / up-slope. */
export function deskFrame(): {n: P3; u: P3; yAt(z: number): number; z0: number; z1: number} {
  const D = HOST_FACES.controlConsole.desk;
  const dz = D.zB - D.zF, dy = D.yB - D.yF, L = Math.hypot(dz, dy);
  const u = {x: 0, y: dy / L, z: dz / L}; // up the slope (toward the back)
  const n = {x: 0, y: -u.z, z: u.y}; // out of the desk (up + toward the operator)
  return {n, u, yAt: z => D.yF + (z - D.zF) * (dy / dz), z0: D.zB, z1: D.zF};
}

/**
 * The mounts of a site's restart controls on its host placements (siteHosts). Switchgear controls take distinct cabinet sections
 * (in bank order, nearest free section first), each on its section door's clear rect nearest the generated point.
 */
export function siteMounts(site: ReactorSite, hosts: readonly HostPlacement[]): MountedControl[] {
  const mountOf = new Map<string, MountedControl>();
  const idx = (p: HostPiece) => hosts.map((h, i) => ({h, i})).filter(q => q.h.piece === p);
  // --- switchgear: distinct sections, bank order
  const sw = idx('switchgear');
  const swCtl = site.controls.filter(c => hostOfControl(c.id) === 'switchgear');
  if (sw.length) {
    const tx = Math.cos(sw[0].h.rotY), tz = -Math.sin(sw[0].h.rotY);
    swCtl.sort((a, b) => (a.at.x * tx + a.at.z * tz) - (b.at.x * tx + b.at.z * tz));
    const used = new Set<number>();
    for (const c of swCtl) {
      let best: {i: number; lx: number; ly: number; d: number} | null = null;
      for (const {h, i} of sw) {
        if (used.has(i) && used.size < sw.length) continue;
        const s = doorSpot(h, c.id, c.at);
        const w = hostToWorld(h, s.lx, s.ly, HOST_FACES.switchgear.doorZ);
        const d = Math.hypot(w.x - c.at.x, w.z - c.at.z);
        if (!best || d < best.d) best = {i, lx: s.lx, ly: s.ly, d};
      }
      const h = hosts[best!.i];
      used.add(best!.i);
      const o = hostToWorld(h, best!.lx, best!.ly, HOST_FACES.switchgear.doorZ);
      mountOf.set(c.id, frameMount(c.id, 'switchgear', best!.i, o, hostDir(h.rotY, 0, 0, 1), {x: 0, y: 1, z: 0}));
    }
  } else for (const c of swCtl) mountOf.set(c.id, bareMount(c));
  for (const c of site.controls) {
    if (mountOf.has(c.id)) continue;
    const piece = hostOfControl(c.id);
    const cand = piece ? idx(piece) : [];
    if (!piece || !cand.length) { if (piece) mountOf.set(c.id, bareMount(c)); continue; }
    // nearest host of the piece
    let bi = cand[0].i, bd = Infinity;
    for (const {h, i} of cand) { const d = Math.hypot(h.x - c.at.x, h.z - c.at.z); if (d < bd) { bd = d; bi = i; } }
    const h = hosts[bi], e = OVERLAY_EXTENT[c.id];
    switch (piece) {
      case 'coolantPump': {
        // the start station on the motor end cover: the overlay's extent centred on the disc
        const P = HOST_FACES.coolantPump;
        const ex = (e.x0 + e.x1) / 2, ey = (e.y0 + e.y1) / 2;
        // overlay +X (right, seen from the front) = model +Z when the face normal is model -X
        const o = hostToWorld(h, P.endX, P.disc.y - ey, P.disc.z - ex);
        mountOf.set(c.id, frameMount(c.id, piece, bi, o, hostDir(h.rotY, -1, 0, 0), {x: 0, y: 1, z: 0}));
        break;
      }
      case 'coolantValve': {
        // the turning handwheel IS the model's own wheel (separated from the static valve body: world/reactor/controlsModel.ts)
        const W = HOST_FACES.coolantValve.wheel;
        const o = hostToWorld(h, 0, W.y, 0);
        mountOf.set(c.id, frameMount(c.id, piece, bi, o, {x: 0, y: 1, z: 0}, hostDir(h.rotY, 0, 0, 1)));
        break;
      }
      case 'controlConsole': {
        // on the sloped desk, across the desk at the generated point's position, mid-slope
        const df = deskFrame(), X = HOST_FACES.controlConsole.clearX;
        const l = worldToHost(h, c.at.x, c.at.y, c.at.z);
        const lx = clamp(l.x, -X - e.x0, X - e.x1);
        const lz = (df.z0 + df.z1) / 2;
        const o = hostToWorld(h, lx, df.yAt(lz), lz);
        mountOf.set(c.id, frameMount(c.id, piece, bi, o, hostDir(h.rotY, df.n.x, df.n.y, df.n.z), hostDir(h.rotY, df.u.x, df.u.y, df.u.z)));
        break;
      }
      default: mountOf.set(c.id, bareMount(c));
    }
  }
  return site.controls.filter(c => mountOf.has(c.id)).map(c => mountOf.get(c.id)!);
}

/** Every restart site's host placements and control mounts of a Reactor (ARCH draws the hosts, RESTART the overlays). */
export interface ReactorMounts {
  sites: {site: ReactorSite; floorY: number; hosts: HostPlacement[]; mounts: MountedControl[]}[];
  /** Mount by control id. */
  byId: Map<string, MountedControl>;
}

export function reactorMounts(info: Pick<ReactorInfo, 'tiers' | 'sites'>): ReactorMounts {
  const sites: ReactorMounts['sites'] = [];
  const byId = new Map<string, MountedControl>();
  for (const site of info.sites) {
    const floorY = siteFloorY(info, site);
    const hosts = siteHosts(site, floorY);
    const mounts = siteMounts(site, hosts);
    sites.push({site, floorY, hosts, mounts});
    for (const m of mounts) if (!byId.has(m.id)) byId.set(m.id, m);
  }
  return {sites, byId};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Generators (the start lever / lamps on the model's own control box)

/**
 * The generator model's placement inside its footprint (one uniform scale, long axis = the record's yaw): a panel on a long side gets
 * the model's control-box side (+Z) toward it; a panel at an END gets the model's flat radiator end (+X, flat from 0.6 to 1.8 m —
 * the -X end is recessed below 1.26 m) toward it, so the start box always meets a flat face.
 */
export function generatorPlacement(g: Pick<ReactorGenerator, 'x' | 'y' | 'z' | 'yaw' | 'size' | 'panel'>): Frame & {s: number} {
  const GD = HOST_DIMS.generator, s = Math.min(1.25, g.size.w / GD[0], g.size.h / GD[1], g.size.d / GD[2]);
  const dx = g.panel.x - g.x, dz = g.panel.z - g.z, c = Math.cos(g.yaw), sn = Math.sin(g.yaw);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  const end = Math.abs(lx) / (GD[0] / 2) > Math.abs(lz) / (GD[2] / 2);
  const rotY = end ? (lx >= 0 ? g.yaw : g.yaw + Math.PI) : (lz >= 0 ? g.yaw : g.yaw + Math.PI);
  return {x: g.x, y: g.y, z: g.z, rotY, sx: s, sy: s, sz: s, s};
}

/** Generator start control box size (W x H x D, m) and its measured faces (model units at scale 1): the ends |x| 2.69, the sides |z| 0.59. */
export const GENERATOR_PANEL = {w: 0.62, h: 0.78, d: 0.26, endX: 2.69, sideZ: 0.59} as const;

/**
 * Where a generator's start control box stands: flush on the generator's face toward its panel point — the model's measured end
 * (|x| 2.69, y 0.65..1.45 at scale 1) or side (|z| 0.59) when the model is drawn, else the stand-in skid's box face — EMBED into it;
 * centre (cx, py, cz), outward normal n, the face point under its centre, and the post foot (the deck).
 */
export function generatorPanelPose(g: Pick<ReactorGenerator, 'x' | 'y' | 'z' | 'yaw' | 'size' | 'panel'>, model: boolean): {cx: number; py: number; cz: number; n: P3; face: P3; yaw: number; endFace: boolean} {
  const p = generatorPlacement(g), P = GENERATOR_PANEL;
  const l = worldToHost(p, g.panel.x, g.panel.y, g.panel.z);
  const ex = model ? P.endX : g.size.w / 2 / p.s, ez = model ? P.sideZ : g.size.d / 2 / p.s;
  const endFace = Math.abs(l.x) / ex >= Math.abs(l.z) / ez;
  const sx = endFace ? Math.sign(l.x) || 1 : 0, sz = endFace ? 0 : Math.sign(l.z) || 1;
  const face = endFace ? hostToWorld(p, sx * ex, l.y, Math.max(-0.45, Math.min(0.3, l.z))) : hostToWorld(p, Math.max(-ex + 0.5, Math.min(ex - 0.5, l.x)), l.y, sz * ez);
  const n = hostDir(p.rotY, sx, 0, sz);
  return {cx: face.x + n.x * (P.d / 2 - EMBED), py: g.panel.y, cz: face.z + n.z * (P.d / 2 - EMBED), n, face, yaw: Math.atan2(n.x, n.z), endFace};
}
