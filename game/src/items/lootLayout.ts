// Where loot physically sits: the resting surfaces of every loot holder (cabinet shelf tiers,
// crate floor, shelf-unit tiers, kiosk counter/back shelves, vending spill area, table tops) and a
// deterministic packer that places rolled items on them without overlap. Pure data/maths (no
// three.js) so placement can be unit-tested; world/containers.ts turns the local placements into
// instanced item models. Holder-local frame: origin bottom-centre, front +Z (same as props).

import {PURPOSE_SURFACES, SHOP_COOLER_SURFACES, SHOP_DISPLAY_SURFACES, type PurposeHolderKind, type SurfaceSpec} from '../gen/props';
import {itemDims} from './items';
import {P7_SURFACES, type P7HolderKind} from '../gen/props07';
import {MALL_SURFACES, type MallHolderKind} from '../gen/mall/kinds'; // Task track3-eaton-centre-20261031 (lane SHOPS): mall shop holders
import {isOpenableKind, openableSurfaces, type OpenableContainerKind} from '../world/openablesSpec';

export type Orient = 'up' | 'side' | 'back';

/** A flat resting area in holder-local space; items stand on `y` within [x0,x1]×[z0,z1]. */
export interface Surface {
  y: number;
  x0: number; x1: number;
  z0: number; z1: number;
  /** Free height above the surface (next tier / lid / ceiling). */
  clear: number;
  /** Items tumbled out (vending): lie down more often, larger random yaw. */
  spill?: boolean;
  /**
   * Iteration 08 (Lane I): compartment of an openable holder (world/openablesSpec.ts part index: lid / door / drawer) the surface
   * belongs to — its items are only seen / taken while that part is open. Absent: an exposed surface (always open).
   */
  part?: number;
  /**
   * Task mall-playtest-revision-20261031 (lane SHOPS, U10): a SNUG compartment (the medicine cabinet's 14 cm pill drawers): items go in
   * square to the front (no random yaw) with SNUG_GAP between them, so a dressing fits a tray only a little wider than itself. Absent
   * on every Subway / Office surface: their packing (and its random draws) is exactly as before.
   */
  snug?: boolean;
}

/** Placement of one item on a surface (holder-local). y is the resting height. */
export interface Placement { surface: number; x: number; y: number; z: number; yaw: number; orient: Orient }

export interface Dims { w: number; d: number; h: number }

/** Item extent in holder axes for an orientation (before yaw): along X, height, along Z. */
export function orientedSize(itemId: string, orient: Orient): {sx: number; sy: number; sz: number} {
  const d = itemDims(itemId);
  if (orient === 'side') return {sx: d.h, sy: d.w, sz: d.d};
  if (orient === 'back') return {sx: d.w, sy: d.d, sz: d.h};
  return {sx: d.w, sy: d.h, sz: d.d};
}

function orientOptions(itemId: string, lying: boolean): Orient[] {
  const shape = itemDims(itemId).shape;
  if (shape === 'flat') return ['up'];
  const down: Orient = shape === 'cylinder' ? 'side' : 'back';
  return lying ? [down, 'up'] : ['up', down];
}

/** Local AABB of a placed item (yaw-expanded), for targeting and tests. */
export function placementBox(itemId: string, p: Placement): {min: [number, number, number]; max: [number, number, number]} {
  const s = orientedSize(itemId, p.orient);
  const c = Math.abs(Math.cos(p.yaw)), si = Math.abs(Math.sin(p.yaw));
  const hx = (c * s.sx + si * s.sz) / 2, hz = (si * s.sx + c * s.sz) / 2;
  return {min: [p.x - hx, p.y, p.z - hz], max: [p.x + hx, p.y + s.sy, p.z + hz]};
}

// ---------------------------------------------------------------------------------------
// Cabinets

/**
 * Door partitions + interior of the generated cabinets, as fractions of the fitted bounds
 * (measured on the runtime derivatives; see qa-artifacts/assets/props/cabinet-*-views.png). Both
 * have two doors meeting just right of centre; doors and walls are thick shells.
 */
export interface CabinetSpec {
  /** Door rectangle half-width as a fraction of half the cabinet width. */
  halfW: number;
  /** Door rectangle bottom/top as fractions of the height. */
  y0: number; y1: number;
  /** Front slab depth (fraction of depth) whose triangles move with the doors. */
  slab: number;
  /** Seam between the doors as a fraction of half width (+ = right of centre). */
  seam: number;
  doors: 1 | 2;
  /** Interior back plane, fraction of depth from the back. */
  back: number;
}
// Meshy T2.5 cabinets (2026-10-29, ray-cast front profiles of cabinet-tall-t25.glb / cabinet-low-t25.glb; the 2026-10-30 local
// repair cabinet-tall-t25r1.glb only rebuilt the sides / top — door fronts identical, these values unchanged): thin single-shell door
// fronts (tall z 0.269, low z 0.349) meeting at the centre; door edges x +-0.499 / +-0.905, bottom / top grooves y 0.130 / 1.850
// (tall) and 0.108 / 0.758 (low). The slab is 2 cm behind the door face (thin doors, so the opened leaf is not a thick block).
// Iteration-02/04 values: tall {0.905, 0.059, 0.982, 0.24, 0.028}, low {0.946, 0.101, 0.934, 0.18, 0.015}.
export const CABINET_SPECS: Record<'cabinetTall' | 'cabinetLow', CabinetSpec> = {
  cabinetTall: {halfW: 0.921, y0: 0.068, y1: 0.974, slab: 0.072, seam: 0, doors: 2, back: 0.06},
  cabinetLow: {halfW: 0.968, y0: 0.127, y1: 0.892, slab: 0.084, seam: 0, doors: 2, back: 0.06},
};

export interface Interior { hw: number; y0: number; y1: number; zBack: number; zCut: number }

export function cabinetInterior(kind: 'cabinetTall' | 'cabinetLow', def: Dims): Interior {
  const s = CABINET_SPECS[kind];
  return {hw: s.halfW * def.w / 2, y0: s.y0 * def.h, y1: s.y1 * def.h, zBack: -def.d / 2 + s.back * def.d, zCut: def.d / 2 - s.slab * def.d};
}

/** The open shelving unit (`shelf` prop / models.shelf): tier TOP surfaces above its base. */
export interface ShelfInfo { tierY: number[]; w: number; d: number; h: number }
/** Lane-contract defaults; world code passes gen/props.ts SHELF_TIER_Y/PROP_DEFS.shelf when present. */
export const DEFAULT_SHELF: ShelfInfo = {tierY: [0.10, 0.55, 1.00, 1.45], w: 1.2, d: 0.45, h: 1.85};

/**
 * How the shelving unit is fitted inside a cabinet so the interior uses the SAME shelving
 * design. Tall cabinet: one whole unit scaled into the interior. Low cupboard: the unit's lower
 * section (cut between its 2nd and 3rd tier) twice, side by side, so proportions stay close to
 * the original instead of squashing four tiers into 0.7 m.
 */
export interface InsertSection {
  /** Section centre X and width (cabinet-local). */
  cx: number; w: number;
  /** Interior floor, depth centre and depth. */
  y0: number; zMid: number; depth: number;
  /** Shelf-unit height kept (triangles above are dropped) and the vertical scale applied to it. */
  cutY: number; sy: number;
}
export interface CabinetInsert { sections: InsertSection[]; tiers: number[] }

export function cabinetInsert(kind: 'cabinetTall' | 'cabinetLow', def: Dims, shelf: ShelfInfo = DEFAULT_SHELF): CabinetInsert {
  const it = cabinetInterior(kind, def);
  const T = [...shelf.tierY].sort((a, b) => a - b);
  const n = kind === 'cabinetTall' ? 1 : 2;
  const cutY = kind === 'cabinetTall' || T.length < 3 ? shelf.h : T[1] + 0.6 * (T[2] - T[1]);
  const sy = (it.y1 - it.y0) / cutY;
  const width = 2 * it.hw - 0.01;
  const sections: InsertSection[] = [];
  for (let i = 0; i < n; i++) {
    const w = width / n;
    sections.push({cx: -width / 2 + w * (i + 0.5), w, y0: it.y0, zMid: (it.zBack + it.zCut) / 2, depth: it.zCut - it.zBack - 0.01, cutY, sy});
  }
  const tiers = T.filter(t => t < cutY - 0.05).map(t => it.y0 + t * sy);
  return {sections, tiers};
}

// ---------------------------------------------------------------------------------------
// Holder surfaces

export type SurfaceHolder = 'cabinetTall' | 'cabinetLow' | 'crate' | 'shelf' | 'stall' | 'vending' | 'table' | 'desk'
  | 'shopCounter' | 'shopDisplay' | 'shopBackbar' | 'shopCooler'
  // Iteration 05 (Lane R): purpose holders (gen/props.ts PURPOSE_SURFACES).
  | PurposeHolderKind
  // Iteration 07 (Lane P2): generated holders, measured surfaces (gen/props07.ts P7_SURFACES).
  | P7HolderKind
  // Iteration 08 (Lane I): openable containers (world/openablesSpec.ts): surfaces inside their compartments.
  | OpenableContainerKind
  // Task track3-eaton-centre-20261031 (lane SHOPS): The Eaton's Center open shop holders (gen/mall/kinds.ts MALL_SURFACES).
  | MallHolderKind;

/**
 * Storefront holder surfaces as fractions of the prop height (gen/props.ts SHOP_* constants over
 * PROP_DEFS heights; tests/station.test.ts checks they agree): counter top, display-case deck,
 * back-counter worktop + over-shelf, cooler wire shelves.
 */
export const SHOP_SURFACE_FRAC = {
  // Meshy T2.5 counter / back counter (2026-10-29): counter top 1.05 / 1.05; worktop 0.914, over-shelf 1.663 of 1.83 (gen/props.ts).
  counterTop: 1.05 / 1.05, backbar: [0.914 / 1.83, 1.663 / 1.83], cooler: [0.26, 0.66, 1.06, 1.46].map(y => y / 2.0),
};

/** Measured surface specs (gen/props.ts), scaled if a model's fitted height ever differs from `refH`. */
function specSurfaces(specs: readonly SurfaceSpec[], def: Dims, refH: number): Surface[] {
  const k = def.h > 0 && Math.abs(def.h - refH) > 1e-3 ? def.h / refH : 1;
  return specs.map(s => ({y: s.y * k + 0.002, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, clear: s.clear}));
}

export interface SurfaceOptions {
  shelf?: ShelfInfo;
  /** Crate lid split height (m). Default: generated crate seam (0.817 × height). */
  crateSplitY?: number;
  stallCounterY?: number;
  stallCounterZ?: [number, number];
  stallBackShelfY?: number[];
  stallBackShelfZ?: [number, number];
  /** Table top height / depth (the table footprint includes its fixed bench seats). */
  tableTopY?: number;
  tableTopD?: number;
}

const BOARD = 0.03;

export function holderSurfaces(kind: SurfaceHolder, def: Dims, o: SurfaceOptions = {}): Surface[] {
  const out: Surface[] = [];
  const tiersToSurfaces = (tiers: number[], top: number, x0: number, x1: number, z0: number, z1: number) => {
    tiers.forEach((y, i) => {
      const clear = (tiers[i + 1] ?? top) - y - BOARD;
      if (clear > 0.06) out.push({y: y + 0.002, x0, x1, z0, z1, clear});
    });
  };
  switch (kind) {
    case 'cabinetTall':
    case 'cabinetLow': {
      const it = cabinetInterior(kind, def);
      const ins = cabinetInsert(kind, def, o.shelf);
      for (const s of ins.sections) tiersToSurfaces(ins.tiers, it.y1, s.cx - s.w / 2 + 0.045, s.cx + s.w / 2 - 0.045, it.zBack + 0.03, it.zCut - 0.03);
      break;
    }
    case 'crate': {
      const split = o.crateSplitY ?? 0.817 * def.h;
      const floor = 0.06 * def.h;
      const inset = Math.max(0.025, 0.05 * Math.min(def.w, def.d));
      const ix = def.w / 2 - inset - 0.01, iz = def.d / 2 - inset - 0.01;
      out.push({y: floor + 0.002, x0: -ix, x1: ix, z0: -iz, z1: iz, clear: split - floor - 0.01});
      break;
    }
    case 'shelf': {
      const s = o.shelf ?? DEFAULT_SHELF;
      const T = [...s.tierY].sort((a, b) => a - b).map(t => t * def.h / s.h);
      tiersToSurfaces(T, def.h, -def.w / 2 + 0.07, def.w / 2 - 0.07, -def.d / 2 + 0.04, def.d / 2 - 0.04);
      break;
    }
    case 'stall': {
      const cy = o.stallCounterY ?? 1.0;
      const [cz0, cz1] = o.stallCounterZ ?? [def.d / 2 - 0.4, def.d / 2 - 0.08];
      out.push({y: cy + 0.002, x0: -def.w / 2 + 0.2, x1: def.w / 2 - 0.2, z0: cz0, z1: cz1, clear: 0.45});
      const back = [...(o.stallBackShelfY ?? [1.25, 1.62])].sort((a, b) => a - b);
      const [bz0, bz1] = o.stallBackShelfZ ?? [-def.d / 2 + 0.06, -def.d / 2 + 0.32];
      back.forEach((y, i) => out.push({y: y + 0.002, x0: -def.w / 2 + 0.2, x1: def.w / 2 - 0.2, z0: bz0, z1: bz1, clear: Math.min(0.34, (back[i + 1] ?? def.h) - y - BOARD)}));
      break;
    }
    case 'vending': {
      // Stock tumbles out of the forced front onto the floor just in front of the machine.
      const hx = Math.min(0.42, def.w / 2 - 0.04);
      out.push({y: 0.002, x0: -hx, x1: hx, z0: def.d / 2 + 0.06, z1: def.d / 2 + 0.3, clear: 1, spill: true});
      out.push({y: 0.002, x0: -hx, x1: hx, z0: def.d / 2 + 0.3, z1: def.d / 2 + 0.54, clear: 1, spill: true});
      break;
    }
    case 'table': {
      // Food-court table sets include bench seats in the footprint: only the central top holds items.
      const top = o.tableTopD ?? (def.d > 1 ? 0.7 : def.d);
      out.push({y: (o.tableTopY ?? def.h) + 0.002, x0: -def.w / 2 + 0.1, x1: def.w / 2 - 0.1, z0: -top / 2 + 0.08, z1: top / 2 - 0.08, clear: 0.5});
      break;
    }
    case 'desk':
      out.push({y: def.h + 0.002, x0: -def.w / 2 + 0.1, x1: def.w / 2 - 0.1, z0: -def.d / 2 + 0.08, z1: def.d / 2 - 0.08, clear: 0.5});
      break;
    case 'shopCounter':
      out.push({y: def.h * SHOP_SURFACE_FRAC.counterTop + 0.002, x0: -def.w / 2 + 0.12, x1: def.w / 2 - 0.12, z0: -def.d / 2 + 0.1, z1: def.d / 2 - 0.12, clear: 0.5});
      break;
    case 'shopDisplay':
      // Iteration 05: inside the open display case (glass all round), on its two trays.
      out.push(...specSurfaces(SHOP_DISPLAY_SURFACES, def, 1.745));
      break;
    case 'shopBackbar': {
      const [top, shelf] = SHOP_SURFACE_FRAC.backbar.map(f => f * def.h);
      out.push({y: top + 0.002, x0: -def.w / 2 + 0.12, x1: def.w / 2 - 0.12, z0: -def.d / 2 + 0.1, z1: def.d / 2 - 0.08, clear: Math.min(0.5, shelf - top - BOARD)});
      // over-shelf: the T2.5 shelf is a 13 cm ledge against the splash back (z -0.337..-0.21 of the 0.7 m depth)
      out.push({y: shelf + 0.002, x0: -def.w / 2 + 0.12, x1: def.w / 2 - 0.12, z0: -def.d / 2 + 0.03, z1: -def.d / 2 + 0.135, clear: Math.max(0.1, def.h - shelf - 0.02)});
      break;
    }
    case 'shopCooler':
      // Iteration 05: open cooler deck + wire shelves behind real glass (Lane A measurements).
      out.push(...specSurfaces(SHOP_COOLER_SURFACES, def, 2.0));
      break;
    default: {
      const spec = (PURPOSE_SURFACES as Partial<Record<string, SurfaceSpec[]>>)[kind] ?? (P7_SURFACES as Partial<Record<string, SurfaceSpec[]>>)[kind]
        ?? (MALL_SURFACES as Partial<Record<string, readonly SurfaceSpec[]>>)[kind]; // track3 lane SHOPS
      if (spec) out.push(...spec.map(s => ({y: s.y + 0.002, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, clear: s.clear})));
    }
  }
  // Iteration 08 (Lane I): openable holders — exposed surfaces kept / claimed by a compartment, then each compartment's own.
  if (isOpenableKind(kind)) return openableSurfaces(kind, out);
  return out;
}

// ---------------------------------------------------------------------------------------
// Packing

const GAP = 0.018;
/** Task mall-playtest-revision-20261031 (lane SHOPS, U10): spacing on a snug surface (Surface.snug). */
const SNUG_GAP = 0.004;

/**
 * Places items on surfaces left-to-right without overlap (deterministic for a given `rnd`).
 * Returns one placement per item, or null when an item fits nowhere (callers drop it).
 */
/**
 * `square` (mall round 3 CI follow-up): no random yaw jitter — every item square to the surface front. Only the exact-table fallback in
 * items/loot.ts rollHolderLots uses it (on its own stream), when the jittered packing left a rolled lot unplaced.
 */
export function packItems(itemIds: readonly string[], surfaces: readonly Surface[], rnd: () => number, lying = false, square = false): (Placement | null)[] {
  type Slot = {item: number; orient: Orient; yaw: number; sx: number; sy: number; sz: number};
  const bins: Slot[][] = surfaces.map(() => []);
  const used = surfaces.map(() => 0);
  const out: (Placement | null)[] = itemIds.map(() => null);
  const width = (s: Surface) => s.x1 - s.x0;
  itemIds.forEach((id, item) => {
    // Fill evenly: surfaces in random order, then least-filled first (quarter steps).
    const order = surfaces.map((_, i) => ({i, k: rnd()}))
      .sort((a, b) => Math.floor(used[a.i] / width(surfaces[a.i]) * 4) - Math.floor(used[b.i] / width(surfaces[b.i]) * 4) || a.k - b.k);
    for (const {i} of order) {
      const s = surfaces[i];
      const lie = lying || (!!s.spill && rnd() < 0.7);
      let placed = false;
      const jitter = square ? 0 : (rnd() * 2 - 1);
      const gap = s.snug ? SNUG_GAP : GAP; // (lane SHOPS U10: snug compartments; the jitter is still drawn — same stream for every surface)
      for (const orient of orientOptions(id, lie)) {
        const o = orientedSize(id, orient);
        if (o.sy + 0.004 > s.clear) continue;
        // Facing the front first; turned 90° when that is the only way it fits (crates, narrow tiers).
        for (const base of [0, Math.PI / 2]) {
          const yaw = base + (s.snug ? 0 : jitter * (s.spill ? 1.3 : orient === 'up' ? 0.3 : 0.18));
          const c = Math.abs(Math.cos(yaw)), si = Math.abs(Math.sin(yaw));
          const sx = c * o.sx + si * o.sz, sz = si * o.sx + c * o.sz;
          const tol = s.snug ? 1e-9 : 0; // (snug only: exact old comparisons elsewhere)
          if (sz > s.z1 - s.z0 + tol || used[i] + sx + gap > width(s) + tol) continue;
          used[i] += sx + gap;
          bins[i].push({item, orient, yaw, sx, sy: o.sy, sz});
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
  });
  bins.forEach((bin, i) => {
    if (!bin.length) return;
    const s = surfaces[i];
    // Random order along the surface, evenly spread with a little jitter.
    for (let k = bin.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [bin[k], bin[j]] = [bin[j], bin[k]]; }
    const total = bin.reduce((a, b) => a + b.sx, 0);
    const gap = (width(s) - total) / (bin.length + 1);
    let cursor = s.x0;
    for (const b of bin) {
      cursor += gap;
      const x = cursor + b.sx / 2 + (rnd() * 2 - 1) * gap * 0.3;
      cursor += b.sx;
      const freeZ = Math.max(0, (s.z1 - s.z0 - b.sz) / 2);
      const zc = (s.z0 + s.z1) / 2;
      // Slight bias toward the front edge so items read from the aisle.
      const z = zc + Math.min(freeZ, (rnd() * 2 - 1) * Math.min(freeZ, 0.04) + freeZ * 0.35);
      out[b.item] = {surface: i, x, y: s.y, z, yaw: b.yaw, orient: b.orient};
    }
  });
  return out;
}

/** A placed lot's local box (placementBox). */
export type LotBox = ReturnType<typeof placementBox>;

/** Do two lot boxes overlap (with `pad` clearance in x / z; boxes that only meet in height — stacked faces — do not)? */
export function lotBoxesOverlap(a: LotBox, b: LotBox, pad = 0): boolean {
  return a.min[0] < b.max[0] + pad && a.max[0] > b.min[0] - pad && a.min[1] < b.max[1] - 0.002 && a.max[1] > b.min[1] + 0.002
    && a.min[2] < b.max[2] + pad && a.max[2] > b.min[2] - pad;
}

/**
 * Task studio-base-salvage-20261108-073314-01: a FREE spot for ONE more item beside lots already placed (`taken` boxes; holder-local),
 * or null — so an extra lot never moves, re-packs or covers a rolled one. Surfaces in a random order; per surface the packer's
 * orientations (upright first), facing the front, else a quarter turn, a small yaw jitter; `gap` clear of every taken box and of the
 * surface ends, a random free x and the packer's front bias in depth. Never a vending spill area or a snug pill drawer.
 */
export function freeLotSpot(itemId: string, surfaces: readonly Surface[], taken: readonly LotBox[], rnd: () => number, gap = 0.03): Placement | null {
  const order = surfaces.map((_, i) => ({i, k: rnd()})).sort((a, b) => a.k - b.k);
  for (const {i} of order) {
    const s = surfaces[i];
    if (s.spill || s.snug) continue;
    for (const orient of orientOptions(itemId, false)) {
      const o = orientedSize(itemId, orient);
      if (o.sy + 0.004 > s.clear) continue;
      for (const base of [0, Math.PI / 2]) {
        const yaw = base + (rnd() * 2 - 1) * (orient === 'up' ? 0.3 : 0.18);
        const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
        const sx = c * o.sx + sn * o.sz, sz = sn * o.sx + c * o.sz;
        if (sz > s.z1 - s.z0 || sx + 2 * gap > s.x1 - s.x0) continue;
        const z = (s.z0 + s.z1) / 2 + (s.z1 - s.z0 - sz) / 2 * 0.35;
        const xs: number[] = [];
        for (let x = s.x0 + gap + sx / 2; x <= s.x1 - gap - sx / 2 + 1e-9; x += 0.01) {
          const p = {surface: i, x, y: s.y, z, yaw, orient};
          if (!taken.some(t => lotBoxesOverlap(placementBox(itemId, p), t, gap))) xs.push(x);
        }
        if (xs.length) return {surface: i, x: xs[Math.floor(rnd() * xs.length)], y: s.y, z, yaw, orient};
      }
    }
  }
  return null;
}
