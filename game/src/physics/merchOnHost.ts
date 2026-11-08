// Task studio-skywalk-variety-20261107-231448-01 (lane MERCH; user: "some store items do not move when shot, like the skates in the
// sports store. It is a standing rule … that items on top of counters / shelves should not be part of the counter / shelf and have
// physics, when shot!"): MOVABLE ON-HOST DECOR standing on its static host — on the host's TOP face (the office monitor on a desk, as
// before) or on a support INSIDE the host's box (skates on a slatwall deck, books on a bookcase shelf, model kits on a gondola tier,
// records in a bin). The cause of the bug: physics/dynamicItems.ts only let on-host decor go loose from its host's top face, and a
// bullet into open shelving stopped at the shelving's box (the hitscan tests prop AABBs: the host's box contains its shelves' stock), so
// every piece of stock on a shelf was a static, unhittable box. The ONE rule here is read by every consumer, for every present and future
// movable kind (no per-kind handler):
//  - hostRest: where an on-host prop stands on its host ('top' / 'shelf');
//  - shelfSupported: a 'shelf' rest counts only on a KNOWN open support — a loot holder's own loot surfaces (its real shelves; physics
//    boxes in world/containers.ts, uncut) or the host kind's declared `shelves` (gen/props.ts PropDef.shelves; physics/world.ts) — so a
//    loose piece always has something real to land on, and decor inside a closed counter well stays put (no support known there);
//  - shelfDecorHit / raycastShot: a bullet that strikes such a host's box goes on into its open shelves and takes the first resting
//    shelf piece on its line (a wall / slab between them still stops it), like the filler stock (world/shelfStock.ts pelletHit).
// Bodies stay the existing bounded lazy sleeping ones (physics/dynamicItems.ts); nothing here simulates or scans per frame.

import {propPhysics} from '../damage/materials';
import {asLevels, type Levels} from '../gen/levels';
import type {Grid} from '../gen/grid';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {isLootHolderKind} from '../items/loot';
import {isSpillHolderKind} from '../world/openablesSpec';
import {rayAabb, raycastWorld, type Vec3, type WorldHit} from '../combat/hitscan';
import {isEnclosedHolderKind} from './holderShapes';

/**
 * Whether props of this kind can become rigid bodies at all: flagged dynamic (PROP_PHYSICS / PROP_DEFS.physics) with a finite
 * mass, and not a loot holder (its lots would float) unless it is a spill holder (trash can / wheelie bin: goLoose spills them).
 * Placement rules come on top (DynamicItems.isDynamicProp: on the floor, or on a static host for `onHost` kinds). (Moved here from
 * physics/dynamicItems.ts, which re-exports it.)
 */
export function dynamicKind(kind: string): boolean {
  const ph = propPhysics(kind);
  return ph.dynamic && Number.isFinite(ph.mass) && !(isLootHolderKind(kind) && !isSpillHolderKind(kind));
}

/** Movable on-host decor: a dynamic kind that may go loose where it stands on its static host (`onHost`). */
export const looseDecorKind = (kind: string): boolean => dynamicKind(kind) && !!propPhysics(kind).onHost;

type Shelf = NonNullable<(typeof PROP_DEFS)[keyof typeof PROP_DEFS]['shelves']>[number];
/** A non-holder host kind's declared open supports (host frame), `[]` = it hangs its decor, undefined = none known. */
export function hostShelves(kind: string): readonly Shelf[] | undefined {
  return (PROP_DEFS as unknown as Record<string, {shelves?: readonly Shelf[]} | undefined>)[kind]?.shelves;
}

/** A host whose open supports are known: a loot holder (its loot surfaces) or a kind with declared `shelves`. */
export const knownSupportKind = (kind: string): boolean => isLootHolderKind(kind) || hostShelves(kind) !== undefined;

const TOL = 0.03;
/** A declared shelf's collision board under its top (m): thinner than a holder's slab, so it never reaches the stock of the shelf below. */
export const SHELF_BOARD = 0.025;

/**
 * Where on-host prop `p` stands on `q` (its `host`): 'top' — on the host's top face, inside its footprint (the office rule); 'shelf' —
 * its base inside the host's box (a shelf deck / tier / bin floor / ledge / hook below the top); null — not on it, or the host moves.
 */
export function hostRest(p: PropPlacement, q: PropPlacement | undefined): 'top' | 'shelf' | null {
  if (!q || q === p || q.h <= 0.02 || dynamicKind(q.kind)) return null;
  if (Math.abs(p.x - q.x) > q.hx || Math.abs(p.z - q.z) > q.hz) return null;
  const top = q.y + q.h;
  if (Math.abs(p.y - top) < TOL) return 'top';
  return p.y > q.y - TOL && p.y < top - TOL ? 'shelf' : null;
}

/** Host-local (x, z) of a world point (host frame: front +Z, yaw q.rot). */
function local(q: PropPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(q.rot), s = Math.sin(q.rot), dx = x - q.x, dz = z - q.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/**
 * A 'shelf' rest on a known open support: the host is a loot holder (its loot surfaces are its shelves — tests check every placement
 * stands on one), or the host kind declares `shelves` and `p` stands on one of them (or it declares none: hung decor).
 */
export function shelfSupported(p: PropPlacement, q: PropPlacement): boolean {
  if (isLootHolderKind(q.kind)) return true;
  const sh = hostShelves(q.kind);
  if (!sh) return false;
  if (!sh.length) return true;
  return onDeclaredShelf(p, q, sh);
}

/** Up to this far ABOVE a declared board a piece may stand (it settles onto it when loose: a sloped bin tray as one board). */
export const SHELF_RISE = 0.06;
/** `p` stands on one of host `q`'s declared shelves (its base within TOL below / SHELF_RISE above a board, its centre over it). */
export function onDeclaredShelf(p: PropPlacement, q: PropPlacement, sh: readonly Shelf[]): boolean {
  const ly = p.y - q.y, [lx, lz] = local(q, p.x, p.z);
  return sh.some(s => ly > s.y - TOL && ly < s.y + SHELF_RISE && lx >= s.x0 - 0.02 && lx <= s.x1 + 0.02 && lz >= s.z0 - 0.02 && lz <= s.z1 + 0.02);
}

/** Movable on-host decor resting where it may go loose: on its static host's top, or on a known open support inside it. */
export function restsOnHost(p: PropPlacement, props: readonly PropPlacement[]): 'top' | 'shelf' | null {
  const q = p.host !== undefined ? props[p.host] : undefined;
  const r = hostRest(p, q);
  if (r === 'shelf' && !shelfSupported(p, q!)) return null;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Bullets into open shelves

const shelfIndex = new WeakMap<readonly PropPlacement[], Map<number, number[]>>();
/**
 * host index -> the movable decor resting on its known open shelves (a host a bullet can enter: not an enclosed holder). Built once per
 * props array from the placements (decor that already went loose has no box and is hit as a body: DamageSystem.knockPickups).
 */
export function shelfDecorIndex(props: readonly PropPlacement[]): ReadonlyMap<number, readonly number[]> {
  let m = shelfIndex.get(props);
  if (m) return m;
  m = new Map();
  props.forEach((p, i) => {
    if (p.host === undefined || p.h <= 0.02 || !looseDecorKind(p.kind)) return;
    const q = props[p.host];
    if (!q || isEnclosedHolderKind(q.kind) || restsOnHost(p, props) !== 'shelf') return;
    const l = m!.get(p.host);
    if (l) l.push(i); else m!.set(p.host, [i]);
  });
  shelfIndex.set(props, m);
  return m;
}

/** Ray parameter where o + d t leaves an axis-aligned prop box (Infinity: never). */
function exitT(o: Vec3, d: Vec3, p: PropPlacement): number {
  let t = Infinity;
  const lo = [p.x - p.hx, p.y, p.z - p.hz], hi = [p.x + p.hx, p.y + p.h, p.z + p.hz], O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-12) continue;
    t = Math.min(t, Math.max((lo[a] - O[a]) / D[a], (hi[a] - O[a]) / D[a]));
  }
  return t;
}

/**
 * A world hit on the box of a host with movable decor on its open shelves, refined: the first resting shelf piece the ray meets inside
 * that box takes the hit instead (its own box face and normal) — unless a wall / floor / slab of the level lies between. Anything else
 * is returned unchanged.
 */
export function shelfDecorHit(world: Grid | Levels, props: readonly PropPlacement[], o: Vec3, d: Vec3, wh: WorldHit, trenchY: number): WorldHit {
  if (wh.kind !== 'prop' || wh.prop === undefined) return wh;
  const list = shelfDecorIndex(props).get(wh.prop);
  const host = props[wh.prop];
  if (!list?.length || !host) return wh;
  const out = exitT(o, d, host);
  let best: {t: number; n: [number, number, number]; i: number} | null = null;
  for (const i of list) {
    const p = props[i];
    if (p.h <= 0.02) continue;
    const h = rayAabb(o, d, {x: p.x - p.hx, y: p.y, z: p.z - p.hz}, {x: p.x + p.hx, y: p.y + p.h, z: p.z + p.hz});
    if (!h || h.t < wh.t - 1e-6 || h.t > out + 1e-6 || (best && h.t >= best.t)) continue;
    best = {t: h.t, n: h.n, i};
  }
  if (!best) return wh;
  const s = asLevels(world).raycast(o, d, best.t, {trenchY, unsetCeil: 3});
  if (s.kind !== 'none' && s.t < best.t - 1e-6) return wh;
  return {...wh, t: best.t, prop: best.i, nx: best.n[0], ny: best.n[1], nz: best.n[2]};
}

/** A BULLET's world ray (Game.fire / the damage QA shot): raycastWorld, then into the open shelves of the host it struck. */
export function raycastShot(world: Grid | Levels, props: readonly PropPlacement[], o: Vec3, d: Vec3, maxDist: number, trenchY: number): WorldHit {
  return shelfDecorHit(world, props, o, d, raycastWorld(world, props, o, d, maxDist, trenchY), trenchY);
}
