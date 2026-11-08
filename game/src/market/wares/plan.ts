// Task studio-market-rework-20261108-074144-01 (lane WARES): THE DISPLAY PLAN — where each of a stall's stock stacks stands on its display
// surfaces (market/wares/slots.ts). Pure, deterministic (no RNG, no three.js): the same stock + surfaces give the same plan.
//
// SHELF PACKING per surface (surface-local: x left -> right along its width, depth from its FRONT edge — the customer side, local +Z —
// back): rows from the front, each as deep as its deepest ware; a ware goes into the first row (front first) with an x gap wide enough
// (and the last row may deepen while depth is left), else a new row behind. Each ware stands upright facing the front; one too tall for
// the surface's free height lies down (cylinders on their side, boxes on their back: items/lootLayout.ts orientations), turned 90° only
// when that is the only way it fits. A gun lies on its side (world/pickups.ts meshFor) by its model's real bounds. A surface's supported
// spans (WareSurface.supports: a joined counter top has no board over its seam) hold every ware: inside one span, or bridging two (a long
// gun across the seam, resting on both tops) — never over the gap alone, so a woken ware never drops into the counter.
//  - ORDER: the stall's stock order (the trade view's), surfaces in their given order (the counter tops first). A stack that fits no
//    space left is not shown and the next one is tried (it stays in stock: listed / bought in the trade view, never lost); at most
//    WARES.maxPerStall per stall.
//  - BUILD: the whole stock packed, then each row spread evenly along its surface (even gaps). CHANGES (a sale adds a stack, a purchase /
//    theft removes one): `release` frees a ware's place, `place` puts a new one into a free gap — the others never move.
import type {ItemShape} from '../../items/items';
import type {Orient} from '../../items/lootLayout';
import {WARES, type WareSurface} from './slots';

/** A ware's size as its model stands upright (w = local x, d = local z, h = height) and how it may lie down. */
export interface WareDims { w: number; d: number; h: number; shape: ItemShape }

/** One displayed stack: its surface, surface-local centre (x, z: +z = toward the front edge), yaw (0 or PI/2 on top of the surface's) and
 *  orientation; the world resting point / yaw. */
export interface WarePlace {
  uid: number;
  surface: number;
  lx: number; lz: number;
  turn: 0 | 1;
  orient: Orient;
  /** World resting point (the model's bottom centre before the lie-down transform) and world yaw. */
  x: number; y: number; z: number;
  yaw: number;
  /** Footprint on the surface (after the turn) and the height it takes. */
  sx: number; sz: number; sy: number;
}

interface Slot { uid: number; x0: number; x1: number; sz: number; sy: number; turn: 0 | 1; orient: Orient }
interface Row { u0: number; depth: number; items: Slot[] }

/** The ways a ware may stand on a surface, preferred first (footprint sx along x, sz along depth, height sy). */
function footprints(d: WareDims, clear: number): {sx: number; sz: number; sy: number; turn: 0 | 1; orient: Orient}[] {
  const out: {sx: number; sz: number; sy: number; turn: 0 | 1; orient: Orient}[] = [];
  const add = (orient: Orient, sx: number, sy: number, sz: number) => {
    if (sy + 0.004 > clear) return;
    out.push({sx, sz, sy, turn: 0, orient}, {sx: sz, sz: sx, sy, turn: 1, orient});
  };
  add('up', d.w, d.h, d.d);
  if (d.shape === 'cylinder') add('side', d.h, d.w, d.d);
  else if (d.shape === 'box') add('back', d.w, d.d, d.h);
  return out;
}

/** Least overlap (m) a ware bridging a seam keeps on each supported span it rests on. */
const BRIDGE = 0.04;

/** A ware spanning x0 .. x0 + sx is held up: inside one supported span, or bridging two (resting on both). */
export function supported(s: WareSurface, x0: number, sx: number): boolean {
  const sp = s.supports;
  if (!sp?.length) return true;
  const x1 = x0 + sx;
  if (sp.some(([a, b]) => x0 >= a - 1e-9 && x1 <= b + 1e-9)) return true;
  return sp.filter(([a, b]) => Math.min(b, x1) - Math.max(a, x0) >= BRIDGE).length >= 2;
}

/** The leftmost held-up start for an sx-wide ware inside the free gap [g0, g1] (null: none). */
function spotIn(s: WareSurface, g0: number, g1: number, sx: number): number | null {
  if (g1 - g0 < sx - 1e-9) return null;
  // (the gap's ends, then each span's ends: flush with it, or bridging onto it by just BRIDGE)
  const cands = [g0, g1 - sx, ...(s.supports ?? []).flatMap(([a, b]) => [a, b - sx, a + BRIDGE - sx, b - BRIDGE])]
    .filter(x => x >= g0 - 1e-9 && x + sx <= g1 + 1e-9).sort((a, b) => a - b);
  for (const x of cands) if (supported(s, x, sx)) return Math.min(Math.max(g0, x), g1 - sx);
  return null;
}

/** The packing state of one stall's surfaces. */
export class WarePacker {
  private readonly rows: Row[][];
  /** Where each displayed uid stands. */
  readonly placed = new Map<number, WarePlace>();

  constructor(readonly surfaces: readonly WareSurface[]) {
    this.rows = surfaces.map(() => []);
  }

  get count(): number {
    return this.placed.size;
  }

  /** Put a ware into the first free space (null: no space left / the stall shows WARES.maxPerStall already). */
  place(uid: number, dims: WareDims): WarePlace | null {
    if (this.placed.has(uid)) return this.placed.get(uid)!;
    if (this.placed.size >= WARES.maxPerStall) return null;
    for (let si = 0; si < this.surfaces.length; si++) {
      const s = this.surfaces[si];
      for (const f of footprints(dims, s.clear)) {
        const at = this.fit(si, f.sx, f.sz);
        if (!at) continue;
        const slot: Slot = {uid, x0: at.x0, x1: at.x0 + f.sx, sz: f.sz, sy: f.sy, turn: f.turn, orient: f.orient};
        if (at.row) { at.row.items.push(slot); at.row.depth = Math.max(at.row.depth, f.sz); }
        else this.rows[si].push({u0: at.u0, depth: f.sz, items: [slot]});
        const p = this.toPlace(si, slot, at.row?.u0 ?? at.u0);
        this.placed.set(uid, p);
        return p;
      }
    }
    return null;
  }

  /** Free a ware's place (bought / stolen / gone). */
  release(uid: number): void {
    if (!this.placed.delete(uid)) return;
    for (const rows of this.rows) for (const r of rows) {
      const i = r.items.findIndex(q => q.uid === uid);
      if (i >= 0) r.items.splice(i, 1);
    }
  }

  /**
   * Spread every row evenly along its surface (the build's look; call before the wares are spawned). On a surface with supported spans
   * (a joined counter top) a ware bridging the seam stays where it is; the others are shared out over the free stretches of the spans
   * (the least-filled first) and spread evenly in each — never over the seam. A row that cannot be shared out keeps its packed spots.
   */
  spread(): void {
    const E = WARES.edge, G = WARES.gap;
    this.rows.forEach((rows, si) => {
      const s = this.surfaces[si], lo = -s.w / 2 + E, hi = s.w / 2 - E;
      for (const r of rows) {
        if (!r.items.length) continue;
        const spans = (s.supports ?? [[lo, hi]]).map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number]).filter(([a, b]) => b > a);
        const inSpan = (q: Slot) => spans.some(([a, b]) => q.x0 >= a - 1e-9 && q.x1 <= b + 1e-9);
        const fixed = r.items.filter(q => !inSpan(q)), free = r.items.filter(inSpan).sort((a, b) => a.x0 - b.x0);
        // the stretches the free wares may use: each span minus the bridging wares (and a gap round them)
        let segs: [number, number][] = spans.map(([a, b]) => [a, b]);
        for (const q of fixed) segs = segs.flatMap(([a, b]): [number, number][] => [[a, Math.min(b, q.x0 - G)], [Math.max(a, q.x1 + G), b]]).filter(([a, b]) => b - a > 1e-6);
        const bins = segs.map(([a, b]) => ({a, b, items: [] as Slot[], used: 0}));
        let ok = true;
        for (const q of free) {
          const w = q.x1 - q.x0;
          const fit = bins.filter(bn => bn.used + w + bn.items.length * G <= bn.b - bn.a + 1e-9)
            .sort((p, q2) => (p.used + w) / (p.b - p.a) - (q2.used + w) / (q2.b - q2.a) || p.a - q2.a)[0];
          if (!fit) { ok = false; break; }
          fit.items.push(q);
          fit.used += w;
        }
        if (!ok) continue;
        for (const bn of bins) {
          const n = bn.items.length;
          if (!n) continue;
          const len = bn.b - bn.a, room = len - bn.used;
          // even gaps at both ends and between; a stretch packed tighter than that keeps its ends at its edges (gaps >= WARES.gap)
          const roomy = room >= (n + 1) * G || n === 1;
          const gap = roomy ? room / (n + 1) : room / (n - 1);
          let x = bn.a + (roomy ? gap : 0);
          for (const q of bn.items) {
            const w = q.x1 - q.x0;
            q.x0 = x;
            q.x1 = x + w;
            x += w + gap;
          }
        }
        for (const q of r.items) this.placed.set(q.uid, this.toPlace(si, q, r.u0));
      }
    });
  }

  /** A free spot for an sx x sz footprint on surface si: in an existing row (front first), else a new row behind them. */
  private fit(si: number, sx: number, sz: number): {row?: Row; u0: number; x0: number} | null {
    const s = this.surfaces[si], E = WARES.edge, G = WARES.gap;
    const lo = -s.w / 2 + E, hi = s.w / 2 - E;
    if (sx > hi - lo + 1e-9 || sz > s.d - 2 * E + 1e-9) return null;
    const rows = this.rows[si];
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k], last = k === rows.length - 1;
      // a deeper ware fits a row only as its last one (nothing behind it yet) and only while the surface has the depth
      if (sz > r.depth + 1e-9 && !(last && r.u0 + sz <= s.d - E + 1e-9)) continue;
      const items = r.items.slice().sort((a, b) => a.x0 - b.x0);
      let x = lo;
      for (const q of items) {
        const at = spotIn(s, x, q.x0 - G, sx);
        if (at !== null) return {row: r, u0: r.u0, x0: at};
        x = Math.max(x, q.x1 + G);
      }
      const at = spotIn(s, x, hi, sx);
      if (at !== null) return {row: r, u0: r.u0, x0: at};
    }
    const u0 = rows.length ? Math.max(...rows.map(r => r.u0 + r.depth)) + G : E;
    if (u0 + sz > s.d - E + 1e-9) return null;
    const at = spotIn(s, lo, hi, sx);
    return at === null ? null : {u0, x0: at};
  }

  private toPlace(si: number, q: Slot, u0: number): WarePlace {
    const s = this.surfaces[si];
    const lx = (q.x0 + q.x1) / 2, lz = s.d / 2 - (u0 + q.sz / 2);
    const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    return {uid: q.uid, surface: si, lx, lz, turn: q.turn, orient: q.orient,
      x: s.x + c * lx + n * lz, y: s.y, z: s.z - n * lx + c * lz, yaw: s.yaw + (q.turn ? Math.PI / 2 : 0),
      sx: q.x1 - q.x0, sz: q.sz, sy: q.sy};
  }
}

/** The build's plan of one stall: every stack in stock order (those that fit), spread evenly. */
export function planStall(stacks: readonly {uid: number; itemId: string}[], surfaces: readonly WareSurface[], dimsOf: (itemId: string) => WareDims): WarePacker {
  const pk = new WarePacker(surfaces);
  for (const st of stacks) pk.place(st.uid, dimsOf(st.itemId));
  pk.spread();
  return pk;
}
