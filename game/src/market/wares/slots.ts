// Task studio-market-rework-20261108-074144-01 (lane WARES): WHERE A STALL SHOWS ITS WARES — the real, flat display surfaces of each
// market stall (world frame), for its owned stock (market/wares/wares.ts). Pure and deterministic (no three.js).
//
//  - LAYOUT v2: the stall's own `displays` (gen/market/marketTypes.ts MarketDisplaySlot, written by the layout lane), as given. A slot may
//    carry an optional `clear` (free height above it, m; default WARES.clear) and `host` (the layout.props index it lies on).
//  - LAYOUT v1 (the first market: no `displays`; its geometry is never changed): derived from the stall's own furniture — the OPEN loot
//    surfaces (items/lootLayout.ts holderSurfaces, minus the spans its on-top decor takes: gen/props07.ts cutSurfaces — the counter's
//    lantern / toolbox) of every open surface holder standing in the stall's area on its storey: the counter run's tops first, then the
//    back shelving / cabinet tiers (exposed tiers only: never inside a closed container or an openable's compartment, never a vending
//    spill area, never on-top decor's own trays). Those are the same surfaces the holder's loot lots and its physics boards use
//    (world/containers.ts, physics/holderShapes.ts), so a ware stands on a real board, never floats, and a knocked one lands right.
//    Every v1 market holder carries the exact empty key (gen/market/dress.ts MARKET_EMPTY_KEY): no loot lot competes for the space.
//    The counter run is two abutting 1.5 m modules with one continuous top: the facing ends of their surfaces join into ONE surface across
//    the seam (a long gun lies over it, resting on both tops), so a shotgun still fits beside the lantern and the toolbox.
//  - ORDER: nearest the stall's customer spot first (the counter tops, then the back fixtures), ties by prop index.
// `vendorDisplayHosts` lists the props those surfaces lie on: a loot / salvage system must never fill them (the displays are the stall's
// finite stock, nothing else).
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../../gen/props';
import {cutSurfaces} from '../../gen/props07';
import {isMarketStallId, type MarketLayout, type MarketStall, type MarketStallId} from '../../gen/market/marketTypes';
import {isContainerKind, isSurfaceKind} from '../../items/loot';
import {holderSurfaces, type SurfaceHolder} from '../../items/lootLayout';

/** Tuning of the displayed wares (shared by the planner and the runtime). */
export const WARES = {
  /** Most stock stacks one stall shows at once (the rest stays in its stock: listed / bought in the trade view, never lost). */
  maxPerStall: 18,
  /** Free height above a v2 display slot without its own `clear` (m). */
  clear: 0.5,
  /** Gap between neighbouring wares, and their margin to a surface edge (m). */
  gap: 0.025,
  edge: 0.01,
  /** Narrowest / shallowest surface worth showing anything on (m). */
  minW: 0.1,
  minD: 0.06,
  /** The Steal aim: reach from the eye to the ware (m), the pad round its box (m). */
  reach: 2.6,
  pad: 0.015,
} as const;

/** One flat display surface in the world: its centre (y = the resting height), its yaw (three.js rotation.y, front = local +Z, the
 *  customer side), usable width (local x) / depth (local z), the free height above it and its storey. */
export interface WareSurface {
  x: number; y: number; z: number;
  yaw: number;
  w: number; d: number;
  clear: number;
  level: number;
  /** The layout.props indices it lies on (v1: its holder, both modules for a joined counter top; v2: the slot's `host` when named). */
  hosts: number[];
  /**
   * Surface-local x spans with a real board / top under them (absent: the whole width). A joined counter top has none over its seam (the
   * holders' item collision ends at each module's loot surface): a ware stands inside one span or bridges two (market/wares/plan.ts).
   */
  supports?: [number, number][];
}

type Layoutish = {props: readonly PropPlacement[]; market?: MarketLayout};

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The open (exposed) loot surfaces of a v1 stall holder, host-local; [] for closed containers / non-holders. */
function openSurfaces(p: PropPlacement) {
  const kind = p.kind as string;
  if (p.host !== undefined || p.mounted || !isSurfaceKind(kind) || isContainerKind(kind) || kind === 'vending') return [];
  const def = (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number} | undefined>)[kind];
  if (!def) return [];
  const shelf = PROP_DEFS.shelf;
  // (world/containers.ts surfaceOptions: the shelving unit's measured tiers — the only option a market holder kind reads)
  const all = holderSurfaces(kind as SurfaceHolder, def, {shelf: {tierY: SHELF_TIER_Y, w: shelf.w, d: shelf.d, h: shelf.h}});
  return cutSurfaces(all, p.cut).filter(s => s.part === undefined && !s.spill && s.x1 - s.x0 >= WARES.minW && s.z1 - s.z0 >= WARES.minD && s.clear > 0.05);
}

/** Most seam between two joined counter-top surfaces (m: their 0.12 m end margins, both modules). */
const SEAM = 0.3;

/** A surface along its own axes: x interval along the yaw's right axis, its depth centre along the yaw's front axis. */
interface Span { a0: number; a1: number; u: number; s: WareSurface & {k: number} }
const along = (yaw: number, x: number, z: number) => x * Math.cos(yaw) - z * Math.sin(yaw);
const across = (yaw: number, x: number, z: number) => x * Math.sin(yaw) + z * Math.cos(yaw);
const sameYaw = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-3;

/**
 * Joins the facing ends of two surfaces of ABUTTING modules of one kind (same rot, height, depth band; their footprints touch along the
 * run, so the top is continuous across the seam) into one surface (both hosts).
 */
function joinRuns(list: (WareSurface & {k: number})[], props: readonly PropPlacement[]): (WareSurface & {k: number})[] {
  const out = list.slice();
  for (let merged = true; merged;) {
    merged = false;
    search: for (let i = 0; i < out.length; i++) for (let j = 0; j < out.length; j++) {
      const A = out[i], B = out[j];
      if (i === j || !sameYaw(A.yaw, B.yaw) || Math.abs(A.y - B.y) > 0.01 || Math.abs(A.d - B.d) > 0.01 || Math.abs(A.clear - B.clear) > 0.01) continue;
      const y = A.yaw, sa: Span = {a0: along(y, A.x, A.z) - A.w / 2, a1: along(y, A.x, A.z) + A.w / 2, u: across(y, A.x, A.z), s: A};
      const sb: Span = {a0: along(y, B.x, B.z) - B.w / 2, a1: along(y, B.x, B.z) + B.w / 2, u: across(y, B.x, B.z), s: B};
      if (Math.abs(sa.u - sb.u) > 0.01 || sb.a0 < sa.a1 - 1e-6 || sb.a0 - sa.a1 > SEAM) continue;
      // the hosts at the seam: A's last module and B's first must be one kind / rot / height and touch end to end
      const ha = props[A.hosts[A.hosts.length - 1]], hb = props[B.hosts[0]];
      const wa = (PROP_DEFS as unknown as Record<string, {w: number}>)[ha.kind]?.w, wb = (PROP_DEFS as unknown as Record<string, {w: number}>)[hb.kind]?.w;
      if (!wa || !wb || ha.kind !== hb.kind || !sameYaw(ha.rot, hb.rot) || Math.abs(ha.y - hb.y) > 0.01 || Math.abs(across(y, ha.x, ha.z) - across(y, hb.x, hb.z)) > 0.02) continue;
      if (Math.abs((along(y, hb.x, hb.z) - wb / 2) - (along(y, ha.x, ha.z) + wa / 2)) > 0.02) continue;
      const a0 = sa.a0, a1 = sb.a1, am = (a0 + a1) / 2;
      // (back to world: the inverse of along / across)
      const x = am * Math.cos(y) + sa.u * Math.sin(y), z = -am * Math.sin(y) + sa.u * Math.cos(y);
      // the supported spans in the joined surface's own x (each part's spans, or its whole width): never the seam between them
      const spans = (sp: Span): [number, number][] => (sp.s.supports ?? [[-sp.s.w / 2, sp.s.w / 2]]).map(([p, q]) => [p + (sp.a0 + sp.a1) / 2 - am, q + (sp.a0 + sp.a1) / 2 - am]);
      const m = {...A, x, z, w: a1 - a0, hosts: [...A.hosts, ...B.hosts], supports: [...spans(sa), ...spans(sb)], k: Math.min(A.k, B.k)};
      out.splice(Math.max(i, j), 1);
      out.splice(Math.min(i, j), 1, m);
      merged = true;
      break search;
    }
  }
  return out;
}

/** v1: the stall's furniture's open surfaces, in the world frame, nearest its customer spot first. */
function derivedSurfaces(layout: Layoutish, stall: MarketStall): WareSurface[] {
  const lv = stall.counter.level ?? 0, out: (WareSurface & {k: number})[] = [];
  layout.props.forEach((p, i) => {
    if (p.area !== stall.area || (p.level ?? 0) !== lv) return;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (const q of openSurfaces(p)) {
      const lx = (q.x0 + q.x1) / 2, lz = (q.z0 + q.z1) / 2;
      // (the prop frame: local x = (cos rot, -sin rot), local +z = (sin rot, cos rot))
      const x = p.x + c * lx + s * lz, z = p.z - s * lx + c * lz;
      out.push({x, y: p.y + q.y, z, yaw: p.rot, w: q.x1 - q.x0, d: q.z1 - q.z0, clear: q.clear, level: lv, hosts: [i],
        k: Math.hypot(x - stall.front.x, z - stall.front.z)});
    }
  });
  const joined = joinRuns(out, layout.props);
  joined.sort((a, b) => a.k - b.k || (a.hosts[0] - b.hosts[0]) || a.y - b.y);
  return joined.map(({k: _k, ...s}) => s);
}

/** The display surfaces of one stall (v2: its `displays`; v1: derived from its furniture). */
export function stallSurfaces(layout: Layoutish, stall: MarketStall): WareSurface[] {
  if (Array.isArray(stall.displays) && stall.displays.length) {
    const out: WareSurface[] = [];
    for (const s of stall.displays) {
      const o = s as typeof s & {clear?: unknown; host?: unknown};
      if (![s.x, s.y, s.z, s.yaw, s.w, s.d].every(fin) || s.w < WARES.minW || s.d < WARES.minD) continue;
      out.push({x: s.x, y: s.y, z: s.z, yaw: s.yaw, w: s.w, d: s.d, clear: fin(o.clear) && o.clear > 0.05 ? o.clear : WARES.clear,
        level: fin(s.level) ? s.level : 0, hosts: fin(o.host) ? [o.host] : []});
    }
    return out;
  }
  return derivedSurfaces(layout, stall);
}

/** Every stall's display surfaces (empty without a market). */
export function marketSurfaces(layout: Layoutish): Partial<Record<MarketStallId, WareSurface[]>> {
  const out: Partial<Record<MarketStallId, WareSurface[]>> = {};
  for (const s of layout.market?.stalls ?? []) if (isMarketStallId(s.id)) out[s.id] = stallSurfaces(layout, s); // (+ the bar: task studio-market-bar-20261108-225231-01)
  return out;
}

/** The layout.props indices the stalls' wares are displayed on: never filled by loot / salvage (they show the stalls' finite stock). */
export function vendorDisplayHosts(layout: Layoutish): Set<number> {
  const out = new Set<number>();
  for (const list of Object.values(marketSurfaces(layout))) for (const s of list ?? []) for (const h of s.hosts) out.add(h);
  return out;
}
