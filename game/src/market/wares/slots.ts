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
//  - ORDER (allStallSurfaces): nearest the stall's customer spot first (the counter tops, then the back fixtures), ties by prop index.
//  - TASK studio-market-bar-20261108-225231-01 (lane SHELVES; user: "Move owner wares to a shelf near them, not the counter immediately
//    in front (accidental theft when trying to talk)."): the wares use `stallSurfaces` — every surface but the CUSTOMER COUNTER TOPS (the
//    counter between the customer and the trader: isCustomerCounter, any version — v1's derived tops, v2's counter displays, a v3 bar
//    counter), nearest the TRADER first: the back wall behind the trader, then the side shelving / racks. A stall with no shelving at all
//    (v1's gun / fuel / scrap) keeps only its counter run's ENDS away from the talk corridor (counterEnds). Runtime only (layout geometry
//    untouched). The trader's body and the counter occlude the Steal aim (market/wares/wares.ts aim): talking is Trade.
// `vendorDisplayHosts` lists the props those surfaces lie on: a loot / salvage system must never fill them (the displays are the stall's
// finite stock, nothing else).
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../../gen/props';
import {cutSurfaces} from '../../gen/props07';
import {MARKET_STALLS, type MarketLayout, type MarketStall, type MarketStallId} from '../../gen/market/marketTypes';
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
  /** (task studio-market-bar-20261108-225231-01) The trader's body as an aim occluder: an upright capsule (radius, height; m). */
  traderR: 0.3,
  traderH: 1.85,
  /**
   * (task studio-market-bar-20261108-225231-01) A stall with NO shelving (v1's gun / fuel / scrap stalls) shows its wares on its counter
   * run's ENDS only: never within this half-width (m, along the counter) of the trader / customer-spot axis — the stretch a customer
   * talks across.
   */
  talk: 0.75,
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
  /** (task studio-market-bar-20261108-225231-01) A counter-run END of a stall without shelving (counterEnds): away from the talk corridor. */
  end?: boolean;
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

/** Every display surface a stall's layout offers (v2 / v3: its `displays`; v1: derived from its furniture) — customer counter tops included. */
export function allStallSurfaces(layout: Layoutish, stall: MarketStall): WareSurface[] {
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

/** The counter kinds a customer talks to the trader across (never a ware's display: task studio-market-bar-20261108-225231-01). */
export const COUNTER_KINDS: ReadonlySet<string> = new Set(['shopCounter']);
/** Margin (m) round the stall's counter footprint inside which a surface counts as that counter's top. */
const COUNTER_PAD = 0.05;

/**
 * Task studio-market-bar-20261108-225231-01 (lane SHELVES; user: "Move owner wares to a shelf near them, not the counter immediately in
 * front (accidental theft when trying to talk)."): a surface IS the customer counter between the customer and the trader when one of its
 * hosts is a counter kind or stands on the stall's counter footprint (`stall.counter`: the counter run / the bar counter), or — a surface
 * without a host — when its centre lies over that footprint (same storey). Any layout version: v1's derived counter tops, v2's counter
 * `displays`, a v3 bar counter whatever its kind.
 */
export function isCustomerCounter(layout: Layoutish, stall: MarketStall, s: WareSurface): boolean {
  const c = stall.counter, P = COUNTER_PAD;
  if (!c || ![c.x0, c.x1, c.z0, c.z1].every(fin)) return false;
  const x0 = Math.min(c.x0, c.x1) - P, x1 = Math.max(c.x0, c.x1) + P, z0 = Math.min(c.z0, c.z1) - P, z1 = Math.max(c.z0, c.z1) + P;
  const lv = c.level ?? 0;
  for (const i of s.hosts) {
    const p = layout.props[i];
    if (!p) continue;
    if (COUNTER_KINDS.has(p.kind as string)) return true;
    // (the prop's footprint overlaps the counter footprint by more than the margin: it is part of the counter run)
    if ((p.level ?? 0) === lv && Math.min(x1, p.x + p.hx) - Math.max(x0, p.x - p.hx) > 2 * P && Math.min(z1, p.z + p.hz) - Math.max(z0, p.z - p.hz) > 2 * P) return true;
  }
  return !s.hosts.length && s.level === lv && s.x >= x0 && s.x <= x1 && s.z >= z0 && s.z <= z1;
}

/** The solid boxes of a stall's counter (the free-standing props on its counter footprint, its storey): world min / max. */
export function counterBoxes(layout: Layoutish, stall: MarketStall): {min: {x: number; y: number; z: number}; max: {x: number; y: number; z: number}}[] {
  const c = stall.counter, P = COUNTER_PAD;
  if (!c || ![c.x0, c.x1, c.z0, c.z1].every(fin)) return [];
  const x0 = Math.min(c.x0, c.x1) - P, x1 = Math.max(c.x0, c.x1) + P, z0 = Math.min(c.z0, c.z1) - P, z1 = Math.max(c.z0, c.z1) + P;
  const lv = c.level ?? 0, out: ReturnType<typeof counterBoxes> = [];
  for (const p of layout.props) {
    if (p.host !== undefined || p.mounted || (p.level ?? 0) !== lv) continue;
    if (Math.min(x1, p.x + p.hx) - Math.max(x0, p.x - p.hx) <= 2 * P || Math.min(z1, p.z + p.hz) - Math.max(z0, p.z - p.hz) <= 2 * P) continue;
    out.push({min: {x: p.x - p.hx, y: p.y, z: p.z - p.hz}, max: {x: p.x + p.hx, y: p.y + p.h, z: p.z + p.hz}});
  }
  return out;
}

/**
 * The talk corridor of a stall along a counter surface's own x (surface-local): the trader's post and the customer spot projected onto it,
 * WARES.talk either side. Null without a trader / customer point.
 */
export function talkCorridor(stall: MarketStall, s: WareSurface): [number, number] | null {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  const pts = [stall.trader, stall.front].filter(p => p && fin(p.x) && fin(p.z)).map(p => (p.x - s.x) * c - (p.z - s.z) * n);
  return pts.length ? [Math.min(...pts) - WARES.talk, Math.max(...pts) + WARES.talk] : null;
}

/**
 * (task studio-market-bar-20261108-225231-01, the lead's rule for stalls WITHOUT shelving) A counter surface's ENDS away from the talk
 * corridor: the parts of its width outside talkCorridor (at most one each side), each its own surface (`end`), its supported spans
 * clipped to it; never the stretch in front of the trader / the customer spot. [] when nothing usable is left.
 */
export function counterEnds(stall: MarketStall, s: WareSurface): WareSurface[] {
  const cor = talkCorridor(stall, s);
  if (!cor) return [];
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw), h = s.w / 2, out: WareSurface[] = [];
  for (const [a, b] of [[-h, Math.min(h, cor[0])], [Math.max(-h, cor[1]), h]] as [number, number][]) {
    if (b - a < WARES.minW) continue;
    const m = (a + b) / 2;
    const supports = s.supports?.map(([p, q]): [number, number] => [Math.max(p, a) - m, Math.min(q, b) - m]).filter(([p, q]) => q - p >= WARES.minW);
    if (supports && !supports.length) continue;
    out.push({...s, x: s.x + c * m, z: s.z - n * m, w: b - a, hosts: [...s.hosts], ...(supports ? {supports} : {}), end: true});
  }
  return out;
}

/**
 * The display surfaces of one stall — its owned wares stand here (market/wares/wares.ts): every offered surface but the customer counter
 * tops (isCustomerCounter), NEAREST THE TRADER first (its post, chest high: the shelves behind / beside the vendor before the ones by the
 * entrance; ties keep the layout's order). Runtime only: no layout's geometry changes (v1 / v2 stay byte-identical). A stall whose shelves
 * hold fewer stacks shows what fits (the rest stays in its stock, listed and bought in the trade view).
 * A stall with NO shelving at all (v1's first market: the gun / fuel / scrap stalls — a counter and a rack / cylinders / cartons only)
 * shows its wares on its counter run's ENDS only (counterEnds: never within WARES.talk of the trader / customer-spot axis); the trader's
 * body and the counter still give the customer spot's look to the trade (wares.ts occluder).
 */
export function stallSurfaces(layout: Layoutish, stall: MarketStall): WareSurface[] {
  const t = stall.trader, ty = (t?.y ?? 0) + 1.2;
  const far = (s: WareSurface) => (t && fin(t.x) && fin(t.z) ? Math.hypot(s.x - t.x, s.z - t.z, s.y - ty) : 0);
  const all = allStallSurfaces(layout, stall);
  let use = all.filter(s => !isCustomerCounter(layout, stall, s));
  if (!use.length) use = all.filter(s => isCustomerCounter(layout, stall, s)).flatMap(s => counterEnds(stall, s));
  return use.map((s, i) => ({s, i, k: far(s)})).sort((a, b) => a.k - b.k || a.i - b.i).map(e => e.s);
}

/** Every stall's display surfaces (empty without a market). */
export function marketSurfaces(layout: Layoutish): Partial<Record<MarketStallId, WareSurface[]>> {
  const out: Partial<Record<MarketStallId, WareSurface[]>> = {};
  for (const s of layout.market?.stalls ?? []) if ((MARKET_STALLS as readonly string[]).includes(s.id)) out[s.id] = stallSurfaces(layout, s);
  return out;
}

/** The layout.props indices the stalls' wares are displayed on: never filled by loot / salvage (they show the stalls' finite stock). */
export function vendorDisplayHosts(layout: Layoutish): Set<number> {
  const out = new Set<number>();
  for (const list of Object.values(marketSurfaces(layout))) for (const s of list ?? []) for (const h of s.hosts) out.add(h);
  return out;
}
