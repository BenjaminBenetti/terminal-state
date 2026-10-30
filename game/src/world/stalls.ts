// Task office-overhaul-20261030 (lane INTERACT): WALK-IN TOILET STALLS (user feedback #13: "Bathroom stall doors cannot be opened.
// This is a staple of bathroom gameplay! You should be able to open them, and sometimes find items in the toilet!").
//
// The stall is an openable loot holder (world/openablesSpec.ts toiletStall: the procedural cubicle as body, a laminate door hinged on
// the left front post that swings INTO the cubicle, finite seeded loot in the bowl / on the tank lid, remembered like every holder).
// Generation is untouched (same placements, AABBs and grid masks: Subway / office fingerprints unchanged); this runtime gives the
// cubicle what its single generated AABB cannot:
//  - MOVEMENT: game.propIndex is rebuilt per section without the stall AABBs plus per-stall collision boxes — left / right partitions,
//    a thin back, the toilet block and three door-leaf segments re-fitted every frame to the leaf's current swing (the door's
//    collision follows it). A closed stall is a closed cubicle; an open one lets the player step in front of the toilet, partitions
//    block sideways. AI is not routed in (the grid's nav masks keep the stall cells blocked).
//  - SIGHT: the generated sight mask marks the stall cells opaque; while a stall's door is open its own cells (those no other
//    sight-blocking prop covers) are see-through, so a player standing in an open stall is seen and reachable by zombies (melee needs
//    line of sight) — no invulnerable hiding spot. Closed again, the cells are opaque again.
//  - HITSCAN: shots ray-test the props' AABBs; one fired from INSIDE a stall's box would hit it at t = 0. While the player's eye is in
//    a stall's footprint that stall's AABB height is 0 (restored as the eye leaves; physics chunks rebuilt on each change).
//  - CLOSING a door is refused while a body (player / zombie) stands in its inward sweep.
//  - The company `toilet` model (assets/companyAssets.ts, lane ASSETS) replaces the boxed toilet when delivered (world/openables.ts
//    setOpenableBodyModel); until then (url null) the geometry fallback stays.
// installStalls(game) registers into the iteration-16 registries (sectionPreloads, sectionHooks, frameHooks, interactHandlers).

import type {Game} from '../game';
import {PropIndex} from '../core/physics';
import type {PropPlacement} from '../gen/props';
import type {Grid} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {StationLayout} from '../gen/stationTypes';
import {cellsOfBox} from '../gen/placeKit';
import {partAction} from '../items/loot';
import {loadCompanyAsset} from '../assets/companyAssets';
import {partAmount, setOpenableBodyModel} from './openables';
import {openableSpec} from './openablesSpec';
import type {ContainerManager, ContainerTarget, Holder} from './containers';

export const STALL_KIND = 'toiletStall';
/** Door hinge (stall-local x / z), leaf length along +X closed, half thickness used for collision, partition thickness. */
export const STALL_DOOR = {hingeX: -0.455, hingeZ: 0.78, length: 0.9, half: 0.02, segments: 3} as const;
const PART_T = 0.03;
/** Stall-local collision rects [x0, z0, x1, z1, height] (front +Z; the back stands against the wall at z = -0.8). */
const STATIC_BOXES: readonly (readonly [number, number, number, number, number])[] = [
  [-0.5, -0.8, -0.5 + PART_T, 0.8, 1.95], // left partition
  [0.5 - PART_T, -0.8, 0.5, 0.8, 1.95], // right partition
  [-0.5, -0.8, 0.5, -0.77, 1.95], // back (the wall is there too)
  [-0.215, -0.8, 0.215, -0.16, 0.82], // toilet: cistern + bowl
];
/** A door counts as open for sight once it moved this much (or its compartment state is open). */
const OPEN_T = 0.02;

interface StallRT {
  holder: Holder;
  prop: PropPlacement;
  /** Generated AABB height (restored after the eye leaves). */
  baseH: number;
  grid: Grid | null;
  boxes: PropPlacement[];
  leaf: PropPlacement[];
  /** Sight-mask cells this stall may clear (covered by stalls only). */
  cells: number[];
  open: boolean;
  angle: number;
  eyeInside: boolean;
}

type GameLike = {
  layout?: StationLayout;
  levels?: Levels;
  propIndex?: PropIndex;
  containers?: ContainerManager | null;
  player?: {x: number; y: number; z: number; eye?: number; yaw: number; pitch: number; radius?: number};
  zombies?: {brain: {alive: boolean; x: number; y: number; z: number; stats: {radius: number}}}[];
  physics?: {propsChanged?(x: number, z: number): void};
  hud?: {toast(t: string, warn?: boolean): void};
  sfx?: {denied?(): void};
  containerTarget?: ContainerTarget | null;
  sectionHooks?: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks?: ((dt: number) => void)[];
  interactHandlers?: (() => boolean)[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  promptProviders?: (() => string | null)[];
};

/** Stall-local point -> world (props only turn in quarter turns: physics/holderShapes.ts convention). */
function toWorld(p: PropPlacement, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}
/** World point -> stall-local. */
export function stallLocal(p: PropPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = x - p.x, dz = z - p.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** World AABB (as placement centre / half extents) of stall-local points. */
function fitBox(box: PropPlacement, p: PropPlacement, pts: readonly (readonly [number, number])[]): void {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of pts) {
    const [x, z] = toWorld(p, lx, lz);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  box.x = (x0 + x1) / 2; box.z = (z0 + z1) / 2; box.hx = (x1 - x0) / 2; box.hz = (z1 - z0) / 2;
}

function collisionBox(p: PropPlacement, h: number): PropPlacement {
  return {kind: p.kind, x: p.x, z: p.z, y: p.y, rot: 0, area: p.area, hx: p.hx, hz: p.hz, h, blocksSight: false, variant: 0, ...(p.level !== undefined ? {level: p.level} : {})};
}

/** The door leaf's segment `k` (of `n`) at swing `a` (rad, + inward) as stall-local corner points. */
export function leafSegment(a: number, k: number, n: number = STALL_DOOR.segments): [number, number][] {
  const {hingeX, hingeZ, length, half} = STALL_DOOR;
  const s0 = 0.01 + (length - 0.01) * k / n, s1 = 0.01 + (length - 0.01) * (k + 1) / n;
  const c = Math.cos(a), s = Math.sin(a);
  const out: [number, number][] = [];
  for (const d of [s0, s1]) for (const t of [-half, half]) out.push([hingeX + d * c + t * s, hingeZ - d * s + t * c]);
  return out;
}

export class StallSystem {
  stalls: StallRT[] = [];
  /** cell -> stalls covering it (sight toggling). */
  private cellOwners = new Map<string, StallRT[]>();
  /** Counters (QA / tests). */
  readonly counts = {built: 0, refusedClose: 0, sightToggles: 0, hitscanToggles: 0};
  toiletModel = false;

  constructor(private readonly game: Game) {}

  private get g(): GameLike {
    return this.game as unknown as GameLike;
  }

  install(): this {
    const g = this.g;
    g.sectionPreloads?.push(layout => this.preload(layout));
    g.sectionHooks?.push({build: () => this.build(), teardown: () => this.teardown()});
    g.frameHooks?.push(dt => this.update(dt));
    g.interactHandlers?.push(() => this.onInteract());
    g.promptProviders?.push(() => this.prompt());
    return this;
  }

  /** The company toilet model, when lane ASSETS delivered it (null url today: the boxed toilet stays). */
  async preload(layout: StationLayout): Promise<void> {
    if (!layout.props.some(p => p.kind === STALL_KIND)) return;
    const gltf = await loadCompanyAsset('toilet');
    setOpenableBodyModel('toilet', gltf);
    this.toiletModel = !!gltf;
  }

  /** Section build (after the containers and game.propIndex exist): stall runtimes, movement index, sight cells. */
  build(): void {
    const g = this.g;
    this.teardown();
    const cm = g.containers, layout = g.layout, L = g.levels;
    if (!cm || !layout || !L) return;
    const holders = cm.all.filter(h => h.kind === STALL_KIND && h.open);
    if (!holders.length) return;
    const gridOf = (level: number): Grid | null => (layout.levels?.find(l => l.id === level)?.grid ?? (level === 0 ? layout.grid : null)) ?? null;
    for (const h of holders) {
      const p = h.prop;
      const rt: StallRT = {holder: h, prop: p, baseH: p.h, grid: gridOf(p.level ?? 0), boxes: [], leaf: [], cells: [], open: false, angle: NaN, eyeInside: false};
      for (const [x0, z0, x1, z1, hh] of STATIC_BOXES) {
        const b = collisionBox(p, hh);
        fitBox(b, p, [[x0, z0], [x1, z1], [x0, z1], [x1, z0]]);
        rt.boxes.push(b);
      }
      // door segments start as the full footprint (PropIndex buckets them over every stall cell), then shrink to the leaf
      for (let k = 0; k < STALL_DOOR.segments; k++) { const b = collisionBox(p, 1.9); rt.leaf.push(b); rt.boxes.push(b); }
      this.stalls.push(rt);
    }
    const stallProps = new Set(this.stalls.map(s => s.prop));
    g.propIndex = new PropIndex(L, [...layout.props.filter(p => !stallProps.has(p)), ...this.stalls.flatMap(s => s.boxes)]);
    // sight cells covered by stalls only (no other sight-blocking prop on the same storey)
    const foreign = new Set<string>();
    for (const q of layout.props) {
      if (!q.blocksSight || q.kind === STALL_KIND) continue;
      const [x0, y0, x1, y1] = cellsOfBox(q.x, q.z, q.hx, q.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) foreign.add(`${q.level ?? 0}:${cx},${cy}`);
    }
    for (const s of this.stalls) {
      const gr = s.grid;
      if (!gr) continue;
      const [x0, y0, x1, y1] = cellsOfBox(s.prop.x, s.prop.z, s.prop.hx, s.prop.hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const key = `${s.prop.level ?? 0}:${cx},${cy}`;
        if (!gr.inBounds(cx, cy) || foreign.has(key) || gr.sightBlocked[gr.idx(cx, cy)] !== 1) continue;
        s.cells.push(gr.idx(cx, cy));
        let l = this.cellOwners.get(key);
        if (!l) this.cellOwners.set(key, (l = []));
        l.push(s);
      }
    }
    this.counts.built++;
    this.update(0);
  }

  /** Section teardown / rebuild: restore the stall AABBs and sight cells, forget the runtimes. */
  teardown(): void {
    for (const s of this.stalls) {
      s.prop.h = s.baseH;
      if (s.grid) for (const i of s.cells) s.grid.sightBlocked[i] = 1;
    }
    this.stalls = [];
    this.cellOwners.clear();
  }

  /** Whether a stall's door is (being) opened. */
  isOpen(s: StallRT): boolean {
    const rt = s.holder.open;
    return !!s.holder.state.parts?.[0] || (!!rt && rt.parts[0].t > OPEN_T);
  }

  update(_dt: number): void {
    if (!this.stalls.length) return;
    const g = this.g, pl = g.player;
    for (const s of this.stalls) {
      const rt = s.holder.open;
      // door leaf collision follows the swing
      const a = rt ? partAmount(rt, 0) : 0;
      if (a !== s.angle) {
        s.angle = a;
        s.leaf.forEach((b, k) => fitBox(b, s.prop, leafSegment(a, k)));
      }
      // sight: open stalls are see-through (their own cells)
      const open = this.isOpen(s);
      if (open !== s.open) { s.open = open; this.applySight(s); }
      // hitscan: the player's eye inside the stall's box would hit it at t = 0
      if (pl) {
        const eyeY = pl.y + (pl.eye ?? 1.6);
        const p = s.prop;
        const inside = Math.abs(pl.x - p.x) < p.hx && Math.abs(pl.z - p.z) < p.hz && eyeY > p.y && eyeY < p.y + s.baseH + 0.2;
        if (inside !== s.eyeInside) {
          s.eyeInside = inside;
          p.h = inside ? 0 : s.baseH;
          g.physics?.propsChanged?.(p.x, p.z);
          this.counts.hitscanToggles++;
        }
      }
    }
  }

  private applySight(s: StallRT): void {
    const gr = s.grid;
    if (!gr) return;
    const W = gr.w;
    for (const i of s.cells) {
      const key = `${s.prop.level ?? 0}:${i % W},${Math.floor(i / W)}`;
      const owners = this.cellOwners.get(key) ?? [s];
      gr.sightBlocked[i] = owners.some(o => o.open) ? 0 : 1;
    }
    this.counts.sightToggles++;
  }

  /** Bodies (player, live zombies) overlapping a stall door's inward sweep. */
  sweepBlocked(s: StallRT): boolean {
    const g = this.g, p = s.prop;
    const bodies: {x: number; y: number; z: number; r: number}[] = [];
    if (g.player) bodies.push({x: g.player.x, y: g.player.y, z: g.player.z, r: g.player.radius ?? 0.3});
    for (const z of g.zombies ?? []) if (z.brain.alive) bodies.push({x: z.brain.x, y: z.brain.y, z: z.brain.z, r: z.brain.stats.radius});
    const {hingeX, hingeZ, length} = STALL_DOOR;
    for (const b of bodies) {
      if (Math.abs(b.y - p.y) > 1.5) continue;
      const [lx, lz] = stallLocal(p, b.x, b.z);
      if (lz > hingeZ + b.r || lx < -0.5 - b.r || lx > 0.5 + b.r) continue;
      if (Math.hypot(lx - hingeX, lz - hingeZ) < length + b.r) return true;
    }
    return false;
  }

  /** The aimed stall whose door would close on a body standing in its sweep (or null). */
  private blockedClose(): StallRT | null {
    const t = this.g.containerTarget;
    if (!t || t.lot || t.container.kind !== STALL_KIND) return null;
    const s = this.stalls.find(x => x.holder === t.container);
    return s && partAction(s.holder.state, 0) === 'close' && this.sweepBlocked(s) ? s : null;
  }

  /** HUD: instead of "[E] Close stall door" while that would be refused. */
  prompt(): string | null {
    return this.stalls.length && this.blockedClose() ? 'Stall door — step out of the doorway to close it' : null;
  }

  /** [E]: refuse closing a stall door on a body in its sweep (else the container interaction opens / takes / closes as usual). */
  onInteract(): boolean {
    if (!this.blockedClose()) return false;
    this.counts.refusedClose++;
    this.g.hud?.toast('Step out of the doorway to close the stall door', true);
    this.g.sfx?.denied?.();
    return true;
  }

  /** The stall whose footprint holds a world point (or null). */
  stallAt(x: number, z: number): StallRT | null {
    return this.stalls.find(s => Math.abs(x - s.prop.x) < s.prop.hx && Math.abs(z - s.prop.z) < s.prop.hz) ?? null;
  }

  qa(): {index: number; x: number; z: number; level: number; open: boolean; doorT: number; lots: string[]; playerInside: boolean; sightCells: number}[] {
    const pl = this.g.player;
    return this.stalls.map((s, i) => ({
      index: i, x: +s.prop.x.toFixed(2), z: +s.prop.z.toFixed(2), level: s.prop.level ?? 0, open: this.isOpen(s), doorT: +(s.holder.open?.parts[0].t ?? 0).toFixed(2),
      lots: s.holder.state.lots.map(l => `${l.itemId}x${l.count}`),
      playerInside: !!pl && this.stallAt(pl.x, pl.z) === s, sightCells: s.cells.length,
    }));
  }
}

/** Create the stall runtime and register it into the Game (call once from the Game constructor, after installGear). */
export function installStalls(game: Game): StallSystem {
  return new StallSystem(game).install();
}

/** QA hooks (spread into window.__LL via gear/qa.ts) for short serial browser spot checks of the stalls. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stallQaApi(game: Game): Record<string, (...a: any[]) => unknown> {
  const sys = (): StallSystem | null => (game as unknown as {stalls?: StallSystem}).stalls ?? null;
  const g = game as unknown as GameLike;
  const pick = (i?: number): StallRT | null => {
    const s = sys();
    if (!s?.stalls.length) return null;
    if (i !== undefined) return s.stalls[i] ?? null;
    const pl = g.player!;
    return [...s.stalls].sort((a, b) => Math.hypot(a.prop.x - pl.x, a.prop.z - pl.z) - Math.hypot(b.prop.x - pl.x, b.prop.z - pl.z))[0];
  };
  const stand = (s: StallRT, lx: number, lz: number, faceX: number, faceZ: number): void => {
    const pl = g.player!, L = g.levels;
    const [x, z] = toWorld(s.prop, lx, lz);
    const [fx, fz] = toWorld(s.prop, faceX, faceZ);
    pl.x = x; pl.z = z;
    const y = L ? L.stepAt(x, z, s.prop.y + 0.05) : s.prop.y;
    pl.y = Number.isFinite(y) ? y : s.prop.y;
    pl.yaw = Math.atan2(-(fx - x), -(fz - z));
    pl.pitch = -0.25;
  };
  return {
    /** Every stall of the section: position, storey, door state, lots inside, whether the player stands in it. */
    stalls: () => sys()?.qa() ?? [],
    /** Stand ~1.1 m in front of the nearest (or i-th) stall facing its door and press its door like [E] (opens a closed door). */
    stallOpen: (i?: number): boolean | null => {
      const s = pick(i);
      if (!s || !g.containers) return null;
      stand(s, 0, 0.8 + 1.1, 0, 0);
      if (!s.holder.state.parts?.[0]) g.containers.interact({container: s.holder, t: 1, lot: null, part: 0});
      return !!s.holder.state.parts?.[0];
    },
    /** Step into an OPEN stall (in front of the toilet, facing out); null when there is none / the door is still closed. */
    stallEnter: (i?: number): boolean | null => {
      const s = pick(i);
      if (!s || !s.holder.state.parts?.[0]) return null;
      stand(s, 0.02, 0.32, 0.02, 2);
      return true;
    },
    /** The stall spec's loot table (QA readout). */
    stallSpec: () => ({label: openableSpec(STALL_KIND)?.label, loot: openableSpec(STALL_KIND)?.loot, toiletModel: sys()?.toiletModel ?? false}),
  };
}
