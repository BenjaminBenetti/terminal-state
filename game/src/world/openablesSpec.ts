// Iteration 08 (USER-UPDATE-01, Lane I): "Make everything that is reasonably interactable, interactable. i.e. Opening things.
// For example garbage cans." Pure data (no three.js) for the OPENABLE loot holders: what moves (lid / door / drawer / sliding
// pane), how (hinge pivot + axis + angle, or slide direction + travel), what is revealed (cavity liner, trash fill, newspaper
// stack, drawer tray, shelves) and where the finite seeded loot rests inside each compartment.
//
// Moving geometry is either DERIVED at runtime from the existing GLB derivative (triangles inside `region`, cut exactly on the
// region's faces; the GLB files are never modified) or honestly AUTHORED simple boxes where a model has no separable part
// (authored purpose props: staff lockers, safe; drawer fronts boxed onto the procedural desk pedestals). All coordinates are
// holder-local (prop frame: origin bottom-centre, front +Z, metres) in the CLOSED pose, measured on the fitted derivatives
// (scans + orthographic views, qa-artifacts/lane-i). world/openables.ts builds and animates them; world/containers.ts owns the
// holder state; items/loot.ts rolls the contents (finite, never re-rolled on open / close).
//
// The audit of the whole prop catalogue (covered kinds + genuine exceptions) is OPENABLE_AUDIT below and
// reference/tasks/vertical-slice-iteration08-20261027/lanes/lane-I-audit.md; tests/openables.test.ts keeps both in step.
//
// Task office-interactions-layout-20261030 (lane OPEN): the office-overhaul storage opens too (user: "I encountered a large cabinet
// I could not open. The items inside should be related to the type of container it is") — the lateral filing cabinet, server
// cabinet / rack, vault safe, executive desk, lab bench, exam table, specimen fridge and archive box, split from their office GLBs
// (`turn`: the files face -Z), contents from their own themed tables (items/lootTables.ts, CONTAINER_THEMED); every office kind is
// classified in OFFICE_OPEN_AUDIT (role + class + reason). Checklist: docs/prop-affordances.md; tests/office-openables.test.ts.

// Lane AMMO (knife-melee-20261030): ammo rows are GENERIC — the table's ammo weight split ~1/3 each over the calibers (the rows
// live in items/lootTables.ts, built with items/calibers.ts genericAmmo).
// Task office-interactions-layout-20261030 (lane OPEN): the office kinds' audit rows live here now (OFFICE_OPEN_AUDIT, typed over OfficeKind).
import type {OfficeKind} from '../gen/office/kinds';
import {OPENABLE_TABLES, type ItemRows, type OwnTable} from '../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)
import {COMPANY_DIMS} from '../assets/companyDims.generated'; // Task office-props-physics-scale-20261030 (lane FURN): furniture-only rescales

/** Axis-aligned box [x0, y0, z0, x1, y1, z1] (holder-local, closed pose). */
export type Box6 = readonly [number, number, number, number, number, number];

/** Authored material roles (world/openables.ts maps them to mesh-UV materials; `body` / `inner` follow the model's paint). */
export type MatRole = 'body' | 'inner' | 'liner' | 'fill' | 'paper' | 'frost' | 'steelDark' | 'steelBright' | 'black' | 'white' | 'accent' | 'shadow' | 'stock' | 'wood'
  // Task office-overhaul-20261030 (lane INTERACT): toilet-stall door leaf (the partition shape material's tint, mesh UVs)
  | 'partition';
export interface AuthoredBox { b: Box6; m: MatRole }

export interface HingeMove {
  type: 'hinge';
  axis: 'x' | 'y';
  /** Pivot on the hinge line (holder-local). */
  pivot: readonly [number, number, number];
  /** Signed full-open angle (radians); the placement may limit it (clearance). */
  angle: number;
  /** Smallest acceptable opening when clearance limits it (radians, unsigned). */
  min?: number;
}
export interface SlideMove {
  type: 'slide';
  /** Travel direction (need not be unit: drawers [0, 0, 1]; freezer panes lift a little while they slide over the other pane). */
  dir: readonly [number, number, number];
  /** Full travel (m) along the x component's sign / z component (scaled by `dir`). */
  dist: number;
  min?: number;
}

export interface SurfaceSpec { y: number; x0: number; x1: number; z0: number; z1: number; clear: number }

export interface PartSpec {
  /** HUD name of this compartment's moving part ("lid", "top drawer", "left locker" ...). */
  name: string;
  move: HingeMove | SlideMove;
  /** DERIVED moving geometry: model triangles whose centroid lies in any of these boxes (cut exactly on their faces). */
  region?: readonly Box6[];
  /** AUTHORED moving geometry (closed pose). */
  boxes?: readonly AuthoredBox[];
  /**
   * Inner face plate of a derived door / lid (closed pose), shown while open: a rectangle inset inside the leaf, or (round lids)
   * a horizontal disc [x, y, z, r] fitted inside the rim. tests/openables.test.ts keeps every plate inside its leaf's outline.
   */
  plate?: Box6;
  plateDisc?: readonly [x: number, y: number, z: number, r: number];
  /** Back-side liner box revealed while open (static); `cavityRole` tints it (default: the body paint, darkened). */
  cavity?: Box6;
  cavityRole?: MatRole;
  /**
   * Iteration 12 (ATMOS, #4): the liner REPLACES the derived model's own interior — body faces strictly inside the cavity (inset
   * 1 cm) are dropped. The chest freezer's reconstructed model has an inner sheet ~0.45 m up across the whole basin: it hid the
   * authored frost liner, stock and the loot on it (and kept them in the flashlight's shadow). Only for parts whose cavity lies
   * clear inside the model's outer walls.
   */
  replaceInterior?: boolean;
  /**
   * Task office-overhaul-20261030 (lane INTERACT): the `cavity` only bounds the compartment for item / chunk collision
   * (world/containers.ts openPhysicsBoxes walls); no liner mesh is drawn (a walk-in toilet stall: the real interior shows).
   */
  cavityHidden?: boolean;
  /**
   * Task office-props-physics-scale-20261030 (lane RACK): the compartment IS the model's own modelled interior — real shelves under
   * every surface (the rebuilt server rack's cantilever shelves), so nothing is lined or cleared (use with `cavityHidden`).
   * tests/office-openables.test.ts checks the body geometry under each surface.
   */
  modelInterior?: boolean;
  /** Round liner (trash can): open cylinder r, y0..y1, back-side. */
  cylinder?: readonly [r: number, y0: number, y1: number];
  /** Static extras revealed while open (trash fill, newspaper stack, shelves, frozen stock). */
  inner?: readonly AuthoredBox[];
  /** Flat rim covering a cut wall at the opening: [outer half x, outer z0, outer z1, inner half x, inner z0, inner z1, y] or a ring [ro, ri, y]. */
  rim?: readonly number[];
  /** Moving interior (drawer tray walls / floor): moves with a slide part. */
  tray?: readonly AuthoredBox[];
  /** Loot surfaces of this compartment (holder-local, closed pose). Slide parts carry them. */
  surfaces: readonly SurfaceSpec[];
  /** Lots stay visible through the closed part (glass door); they can only be taken once it is open. */
  glass?: boolean;
  /** Parts of one group are mutually exclusive (sliding freezer panes: opening one closes the other). */
  group?: string;
  /** Initial ajar fraction (forced safe door): visual only, the compartment still counts as closed. */
  ajar?: number;
  /** Render the moving part double-sided (thin shells seen from inside when open: freezer panes). */
  doubleSide?: boolean;
  /** This compartment holds the holder's own (pre-existing) surfaces too: the cooler's wire shelves behind its glass door. */
  holdsExposed?: boolean;
  /**
   * Task office-interactions-layout-20261030 (lane OPEN): what this compartment shows when opened without loot surfaces of its own
   * (the server cabinet's racked servers behind its glass doors), instead of the holder's `contents` / "empty".
   */
  contents?: string;
  /**
   * Task office-interactions-layout-20261030 (lane OPEN): the axis the lined compartment opens along (world/openables.ts
   * openingSlabs), when the region / cavity centres do not tell it (a door frame much taller than its lined bottom compartment).
   */
  openAxis?: 0 | 1 | 2;
}

/** Item weights. Task loot-tables-20261030 (lane LOOT): the loot types / tables live in items/lootTables.ts. */
export type Rows = ItemRows;
export type OpenableLoot = OwnTable;

export interface OpenableSpec {
  /** HUD label (lower case). */
  label: string;
  /** Runtime model key (assets/manifest ModelKey or p7_<kind>) that is split; null = authored. */
  model: string | null;
  /**
   * Who draws the body: 'model' (the derivative minus its moving parts, instanced by the holder system), 'authored' (bodyBoxes,
   * the purpose shape is not drawn by the storefront builder any more) or 'overlay' (the world builder keeps drawing the body;
   * authored parts are added in front of it).
   */
  body: 'model' | 'authored' | 'overlay';
  bodyBoxes?: readonly AuthoredBox[];
  /**
   * Authored body taken from the purpose shape (gen/purposeShapes.ts, world-mapped shape materials) minus the parts whose centre
   * lies in a `drop` box (the baked doors / solid carcass the openable replaces); `bodyBoxes` add the hollow carcass.
   */
  bodyPurpose?: {drop: readonly Box6[]};
  /**
   * Task office-overhaul-20261030 (lane INTERACT): authored body taken from the PROCEDURAL prop shape (gen/propShapes.ts propShape,
   * the same world-mapped shape materials world/builder.ts used before the kind became a container) minus `drop` boxes. `swap`: a
   * delivered model (world/openables.ts setOpenableBodyModel(asset, gltf)) replaces the shape parts whose centre lies in its
   * `drop` boxes, fitted uniformly into `size` (only grossly mis-scaled files are rescaled) at `at` (base centre), turned by `yaw`.
   */
  bodyShape?: {drop: readonly Box6[]; swap?: {asset: string; drop: readonly Box6[]; at: readonly [number, number, number]; size: readonly [number, number, number]; yaw: number}};
  parts: readonly PartSpec[];
  /**
   * Loot: pure new containers roll `loot` over every compartment; surface holders keep their exposed surfaces' roll and get a
   * SEPARATE compartment roll (`inside`) unless `shared` (one roll over exposed + compartments: the holder's own table).
   */
  loot: OpenableLoot | null;
  shared?: boolean;
  /**
   * Pre-existing holder surfaces (items/lootLayout.ts) that stay exposed: all (default), 'none' (they were measured INSIDE the
   * closed model: the crash cart's drawer stack) or those at/above minY (the tool chest's top).
   */
  exposed?: 'none' | {minY: number};
  /** Holder group: 'container' (new holder kind) or 'surface' (existing surface holder that gains compartments). */
  group: 'container' | 'surface';
  /** What an opened compartment without loot shows (fixture contents baked into the model), instead of "empty". */
  contents?: string;
  /** Existing holder keys whose door sound cues fit (audio/sfx.ts OPEN_CUE / CLOSE_CUE; Sound Lab bank reused). */
  sound: {open: string; close: string};
  /** Light dynamic prop (physics/dynamicItems.ts): when shot loose it spills its finite lots as real pickups. */
  spill?: boolean;
  /**
   * Task office-interactions-layout-20261030 (lane OPEN): the model file faces -Z (the office / company GLBs): it is half-turned
   * before the split (world/meshSplit.ts fittedMeshes `turn`), like world/officeProps.ts turns the instanced office models.
   */
  turn?: boolean;
  /**
   * Task office-interactions-layout-20261030 (lane OPEN): the seat pulled up to this work surface (an office / executive chair on
   * castors, gen/office/companyDress.ts SEAT_AT `host`) rolls aside: it never limits this holder's drawers (world/openables.ts
   * FitIndex.context).
   */
  seatAside?: boolean;
}

// ---------------------------------------------------------------------------------------
// Helpers

const P = Math.PI / 180;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box6 => [x0, y0, z0, x1, y1, z1];
const B = (m: MatRole, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AuthoredBox => ({m, b: [x0, y0, z0, x1, y1, z1]});
/** Open-top drawer tray (floor + 4 walls, 1 cm sheet) inside [x0, x1] x [y0, y1] x [z0, z1]. */
function tray(m: MatRole, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AuthoredBox[] {
  const t = 0.01;
  return [B(m, x0, y0, z0, x1, y0 + t, z1), B(m, x0, y0, z0, x0 + t, y1, z1), B(m, x1 - t, y0, z0, x1, y1, z1), B(m, x0, y0, z0, x1, y1, z0 + t), B(m, x0, y0, z1 - t, x1, y1, z1)];
}
/** Lumpy trash fill: a body up to `y` plus a few crumpled bag / paper lumps on top (static, shown while open). */
function trashFill(x0: number, z0: number, x1: number, z1: number, y: number, round = false, base = 0.06): AuthoredBox[] {
  const w = x1 - x0, d = z1 - z0, k = round ? 0.72 : 1;
  return [
    B('fill', x0 + (round ? w * 0.15 : 0), base, z0 + (round ? d * 0.15 : 0), x1 - (round ? w * 0.15 : 0), y, z1 - (round ? d * 0.15 : 0)),
    B('liner', x0 + w * 0.12 * k, y - 0.02, z0 + d * 0.1 * k, x0 + w * 0.48, y + 0.045, z0 + d * 0.5),
    B('paper', x0 + w * 0.55, y - 0.01, z0 + d * 0.2, x0 + w * 0.82, y + 0.03, z0 + d * 0.42),
    B('fill', x0 + w * 0.3, y - 0.02, z0 + d * 0.58, x0 + w * 0.7, y + 0.035, z1 - d * 0.1 * k),
  ];
}

// Item rows / own tables: items/lootTables.ts OPENABLE_TABLES (task loot-tables-20261030, lane LOOT — the same rows as before).
const LOOT = OPENABLE_TABLES;

// ---------------------------------------------------------------------------------------
// Per-kind specs

/**
 * Filing cabinet drawers (bottom -> top), split at the centres of the front seam grooves of the Meshy T2.5 derivative
 * p7-filing-cabinet-t25.glb (ray-cast front profile, 2026-10-29: grooves at y 0.066-0.074 / 0.355-0.370 / 0.670-0.685 /
 * 0.980-0.995, top slit 1.285; drawer fronts x -0.209..0.209 at z 0.292, handles to z 0.320).
 */
const FILING_Y: readonly (readonly [number, number])[] = [[0.072, 0.362], [0.362, 0.678], [0.678, 0.988], [0.988, 1.286]];
/** Filing cabinet drawer front: x span, cut plane (2.2 cm behind the front face, like the iteration-08 fit) and front face z. */
const FILING_X = [-0.209, 0.209] as const, FILING_Z_CUT = 0.27, FILING_Z_FRONT = 0.292;
const FILING_NAMES = ['bottom drawer', 'third drawer', 'second drawer', 'top drawer'];
/**
 * Crash cart drawers (bottom -> top), split at the seam slits of p7-crash-cart-t25.glb (Meshy T2.5, ray-cast 2026-10-29: 0.167 /
 * 0.370 / 0.490 / 0.600 / 0.707 / 0.822; handle bars at 0.33 / 0.455 / 0.57 / 0.675 / 0.77 m under each drawer's top edge;
 * drawer fronts x -0.275..0.245 at z 0.238).
 */
const CART_Y: readonly (readonly [number, number])[] = [[0.167, 0.37], [0.37, 0.49], [0.49, 0.6], [0.6, 0.707], [0.707, 0.822]];
/**
 * Tool chest (p7-rolling-tool-chest-t25.glb, Meshy T2.5, ray-cast 2026-10-29): bottom cabinet drawers (handle bars 0.352 / 0.456 /
 * 0.552 / 0.636 / 0.728 m under seams 0.376 / 0.48 / 0.572 / 0.656 / 0.744; fronts z 0.21, x -0.27..0.33) and four top-chest
 * drawers (handles 0.83 / 0.896 / 0.956 / 1.012 under seams 0.84 / 0.908 / 0.968 / 1.032; fronts z 0.206, x -0.27..0.32).
 */
const CHEST_LOW_Y: readonly (readonly [number, number])[] = [[0.144, 0.376], [0.376, 0.48], [0.48, 0.572], [0.572, 0.656], [0.656, 0.744]];
const CHEST_TOP_Y: readonly (readonly [number, number])[] = [[0.792, 0.84], [0.84, 0.908], [0.908, 0.968], [0.968, 1.032]];
const ord = (i: number, n: number) => (i === 0 ? 'bottom drawer' : i === n - 1 ? 'top drawer' : 'drawer');

/** Drawer part: derived front [x0, x1] x [y0, y1] in front of zCut, tray + cavity behind it, items on the tray floor. */
function drawer(name: string, x0: number, x1: number, y0: number, y1: number, zCut: number, zFront: number, depth: number, dist: number, o: {authored?: AuthoredBox[]; trayRole?: MatRole} = {}): PartSpec {
  const h = y1 - y0, inX0 = x0 + 0.02, inX1 = x1 - 0.02, tz1 = zCut - 0.004, tz0 = tz1 - depth;
  const floor = y0 + 0.022;
  return {
    name,
    move: {type: 'slide', dir: [0, 0, 1], dist, min: Math.min(dist, 0.16)},
    ...(o.authored ? {boxes: o.authored} : {region: [box(x0, y0, zCut, x1, y1, zFront + 0.15)]}),
    cavity: box(x0 + 0.004, y0 + 0.004, tz0 - 0.01, x1 - 0.004, y1 - 0.004, zCut - 0.001),
    tray: tray(o.trayRole ?? 'inner', inX0, y0 + 0.012, tz0, inX1, y1 - Math.min(0.03, h * 0.25), tz1),
    surfaces: [{y: floor, x0: inX0 + 0.02, x1: inX1 - 0.02, z0: tz0 + 0.03, z1: tz1 - 0.03, clear: Math.max(0.02, y1 - floor - 0.02)}],
  };
}

/**
 * Task office-interactions-layout-20261030 (lane OPEN): a drawer DERIVED from an office model — the front [x0, x1] x [y0, y1] in
 * front of `zCut` slides out with an authored tray, a lined cavity behind it and items on the tray floor (like `drawer`). `face` -1:
 * the drawer is on the prop's BACK (the executive desk's sitter side) — the same part mirrored in z, sliding along -Z. `tight`: a
 * shallow drawer (12-15 cm fronts: lab bench / exam table / desk top rows) keeps 1 cm under its tray and 6 mm over the items, so a
 * dressing (9.2 cm) still fits standing up.
 */
interface ModelDrawer { zCut: number; zFront: number; depth: number; dist: number; face?: 1 | -1; tight?: boolean; trayRole?: MatRole }
function modelDrawer(name: string, x0: number, x1: number, y0: number, y1: number, o: ModelDrawer): PartSpec {
  const h = y1 - y0, inX0 = x0 + 0.02, inX1 = x1 - 0.02, tz1 = o.zCut - 0.004, tz0 = tz1 - o.depth;
  const under = o.tight ? 0.006 : 0.012, floor = y0 + under + 0.01, over = o.tight ? 0.006 : 0.02;
  const p: PartSpec = {
    name,
    move: {type: 'slide', dir: [0, 0, 1], dist: o.dist, min: Math.min(o.dist, 0.16)},
    region: [box(x0, y0, o.zCut, x1, y1, o.zFront + 0.15)],
    cavity: box(x0 + 0.004, y0 + 0.004, tz0 - 0.01, x1 - 0.004, y1 - 0.004, o.zCut - 0.001),
    tray: tray(o.trayRole ?? 'inner', inX0, y0 + under, tz0, inX1, y1 - Math.min(0.03, h * 0.25), tz1),
    surfaces: [{y: floor, x0: inX0 + 0.02, x1: inX1 - 0.02, z0: tz0 + 0.03, z1: tz1 - 0.03, clear: Math.max(0.02, y1 - floor - over)}],
  };
  return o.face === -1 ? mirrorSlideZ(p) : p;
}
/** A +Z slide part mirrored onto the prop's back (z -> -z): regions, cavity, tray, surfaces and the travel direction. */
function mirrorSlideZ(p: PartSpec): PartSpec {
  const mb = (b: Box6): Box6 => [b[0], b[1], -b[5], b[3], b[4], -b[2]];
  const mv = p.move as SlideMove;
  return {
    ...p,
    move: {...mv, dir: [mv.dir[0], mv.dir[1], -mv.dir[2]]},
    ...(p.region ? {region: p.region.map(mb)} : {}),
    ...(p.cavity ? {cavity: mb(p.cavity)} : {}),
    ...(p.tray ? {tray: p.tray.map(t => ({m: t.m, b: mb(t.b)}))} : {}),
    surfaces: p.surfaces.map(s => ({...s, z0: -s.z1, z1: -s.z0})),
  };
}
/** Which way a part opens toward (+1 the prop's front +Z, -1 its back): slides by their travel, side hinges by their pivot. */
export function partFace(p: PartSpec): 1 | -1 {
  if (p.move.type === 'slide') return p.move.dir[2] < 0 ? -1 : 1;
  return p.move.axis === 'y' && p.move.pivot[2] < 0 ? -1 : 1;
}

/** Authored drawer front (steel panel + black pull) for the procedural desk pedestals. */
function deskDrawer(name: string, x0: number, x1: number, y0: number, y1: number, zFace: number, depth: number): PartSpec {
  const cx = (x0 + x1) / 2;
  const d = drawer(name, x0, x1, y0, y1, zFace, zFace + 0.018, depth, Math.min(0.32, depth - 0.04), {
    authored: [B('steelDark', x0 + 0.004, y0 + 0.006, zFace + 0.001, x1 - 0.004, y1 - 0.006, zFace + 0.018), B('black', cx - 0.08, y1 - 0.06, zFace + 0.018, cx + 0.08, y1 - 0.045, zFace + 0.034)],
    trayRole: 'steelDark',
  });
  // The pedestal is a solid block: a black opening plate stands in for the drawer slot while it is out.
  return {...d, cavity: undefined, inner: [B('shadow', x0 + 0.004, y0 + 0.006, zFace - 0.0005, x1 - 0.004, y1 - 0.006, zFace + 0.0008)]};
}

/** One base-unit cupboard of the authored kitchenette: veneer door (pull opposite the hinge), shelf, laminate interior. */
function cupboard(cx: number, hinge: -1 | 1): PartSpec {
  const x0 = cx - 0.21, x1 = cx + 0.21, z0 = 0.29, z1 = 0.302;
  const px = hinge < 0 ? cx + 0.13 : cx - 0.17;
  return {
    name: 'cupboard',
    move: {type: 'hinge', axis: 'y', pivot: [hinge < 0 ? x0 : x1, 0, 0.296], angle: (hinge < 0 ? -1 : 1) * 105 * P, min: 60 * P},
    boxes: [B('wood', x0, 0.12, z0, x1, 0.84, z1), B('steelBright', px, 0.72, z1, px + 0.04, 0.74, 0.31)],
    plate: box(x0 + 0.005, 0.125, z0 - 0.004, x1 - 0.005, 0.835, z0),
    cavity: box(cx - 0.21, 0.12, -0.28, cx + 0.21, 0.84, 0.289), cavityRole: 'white',
    inner: [B('white', cx - 0.205, 0.47, -0.28, cx + 0.205, 0.485, 0.27)],
    surfaces: [{y: 0.122, x0: cx - 0.17, x1: cx + 0.17, z0: -0.24, z1: 0.24, clear: 0.33}, {y: 0.487, x0: cx - 0.17, x1: cx + 0.17, z0: -0.24, z1: 0.24, clear: 0.33}],
  };
}

/** One locker of the authored staff-locker bank: door (accent) with vents / handle / name card, hinged on its right edge. */
function locker(name: string, cx: number): PartSpec {
  const hx = cx + 0.19, z0 = 0.2, z1 = 0.22;
  const vents = [1.6, 1.64, 1.68, 0.2, 0.24].map(y => B('black', cx - 0.12, y, z1, cx + 0.12, y + 0.012, z1 + 0.004));
  return {
    name,
    move: {type: 'hinge', axis: 'y', pivot: [hx, 0, 0.21], angle: 105 * P, min: 60 * P},
    boxes: [B('accent', cx - 0.19, 0.09, z0, cx + 0.19, 1.87, z1), ...vents, B('steelBright', cx + 0.13, 0.95, z1, cx + 0.15, 1.08, z1 + 0.015), B('white', cx - 0.04, 1.75, z1, cx + 0.04, 1.79, z1 + 0.003)],
    plate: box(cx - 0.185, 0.095, z0 - 0.004, cx + 0.185, 1.865, z0),
    cavity: box(cx - 0.192, 0.08, -0.23, cx + 0.192, 1.88, z0 - 0.001),
    cavityRole: 'steelDark',
    inner: [B('steelDark', cx - 0.19, 1.49, -0.228, cx + 0.19, 1.502, 0.17), B('steelBright', cx - 0.01, 1.32, -0.228, cx + 0.01, 1.34, -0.12)],
    surfaces: [
      {y: 0.082, x0: cx - 0.16, x1: cx + 0.16, z0: -0.2, z1: 0.15, clear: 0.42},
      {y: 1.504, x0: cx - 0.16, x1: cx + 0.16, z0: -0.2, z1: 0.14, clear: 0.33},
    ],
  };
}

// ---------------------------------------------------------------------------------------
// Task office-interactions-layout-20261030 (lane OPEN): office-overhaul storage measured on the runtime GLBs in the PROP frame (the
// file half-turned from its -Z front like world/officeProps.ts, fitted to the footprint): CPU ortho views + ray-cast depth / hit
// profiles (reference/tasks/office-interactions-layout-20261030/tools/open-measure.mjs, 2026-10-30). Every one is a hollow shell
// behind its fronts, so the derived fronts move and authored trays / liners / shelves make the compartments.

/**
 * B3 lateral filing cabinet (office-filing-cabinet.glb, 1.32 x 1.32 x 0.80): a 2 x 2 bank of drawer fronts (2 cm panels, faces z
 * 0.253..0.277, pulls to z 0.397) in a 3.5 cm frame; see-through seams at x +-0.62 / +-0.017 and y 1.26, a centre rail y 0.69..0.72;
 * the carcass is hollow (inner back z -0.358, floor 0.039, top 1.267, sides +-0.62), no dividers.
 */
const LATERAL_X: readonly (readonly [number, number])[] = [[-0.617, -0.017], [0.017, 0.622]];
const LATERAL_Y: readonly (readonly [number, number])[] = [[0.04, 0.692], [0.722, 1.259]];
const LATERAL = {zCut: 0.24, zFront: 0.277, depth: 0.55, dist: 0.45} as const;
/**
 * E01 executive desk (office-executive-desk.glb, 2.0 x 0.97 x 1.08): the drawers are on the SITTER side (prop -Z): single-faced
 * fronts flush on hollow pedestals (faces z -0.49..-0.50, brass pulls proud): pedestals x +-(0.535..0.89) with a bottom drawer
 * y 0.175..0.38 and an upper one 0.415..0.605, a top row y 0.655..0.77 (side drawers x +-(0.535..0.905), the centre drawer
 * x -0.455..0.45). The two little organiser drawers on the desktop are left fused (8 cm fronts: nothing fits).
 */
const EXEC = {zCut: 0.48, zFront: 0.5, depth: 0.6, dist: 0.4, face: -1} as const;
/**
 * D09 lab bench (office-lab-bench.glb, 1.8 x 0.93 x 0.51): 5 x 3 drawers under the bench top (fronts z 0.212..0.226, pulls to
 * 0.248; seams x -0.52/-0.51, -0.175/-0.165, 0.165/0.175, 0.505/0.52 and y 0.26, 0.385; plinth below 0.115, top slab 0.515);
 * hollow columns between 2 cm dividers, inner back z -0.199.
 */
// Task office-props-physics-scale-20261030 (lane FURN): the bench was a miniature (worktop 0.549 m). The derivative is now the BODY only
// (its glassware separated: gen/office/clutterKinds.ts) uniformly rescaled to a 0.9 m worktop (tools/asset-pipeline/props/
// build-office-overhaul.mjs FURNITURE), so the measurements above (old prop frame, where the body's centre sat at z +0.0009) map by
// the same factor: x' = k x, y' = k y, z' = k (z - 0.0009), k = runtime height / 0.5489 (1.6396). Five ~0.56 m wide drawers per row,
// fronts ~0.22 m tall: full drawers now (no `tight` margins).
const LAB_K = (COMPANY_DIMS['lab-bench']?.[1] ?? 0.5489) / 0.5489, LAB_DZ = 0.0009;
const labS = (v: number) => Math.round(v * LAB_K * 10000) / 10000;
const LAB_X: readonly (readonly [number, number])[] = ([[-0.856, -0.516], [-0.513, -0.17], [-0.168, 0.168], [0.17, 0.51], [0.514, 0.852]] as const).map(([a, b]) => [labS(a), labS(b)] as const);
const LAB_Y: readonly (readonly [number, number])[] = ([[0.128, 0.262], [0.264, 0.387], [0.389, 0.512]] as const).map(([a, b]) => [labS(a), labS(b)] as const);
const LAB = {zCut: labS(0.2 - LAB_DZ), zFront: labS(0.226 - LAB_DZ), depth: labS(0.36), dist: labS(0.3)} as const;
/**
 * Task office-props-physics-scale-20261030 (lane FURN): D38 bakery display case (office-bakery-case.glb, now 1.95 x 1.35 x 1.38: the
 * case alone, rescaled x1.2158 from the toy-like 1.6 x 1.11 m; its baked loaves separated — the bread is the `bread` FOOD item now).
 * Measured in the manifest frame (CPU side profile x = 0.05, component lists, up-face heights; evidence/FURN): the curved customer
 * glass and an inner vertical pane (native z -0.25 -> prop z +0.25 after the half turn) close the CUSTOMER side (prop +Z); the
 * STAFF side (prop -Z) is OPEN from the display deck (top 0.48) up to the canopy, which ends at prop z ~-0.2. Two glass shelves (tops
 * 0.678 / 0.856, x +-0.618, prop z -0.474..0.199) over the deck (x +-0.753, prop z -0.55..0.25). Each level gets an authored display
 * TRAY that pulls out of the open staff side (prop -Z, so the case is placed with a staff aisle behind it: gen/office/companyDress.ts
 * SERVE_BEHIND); its loaves show through (glass: visible while shut) and are taken once the tray is out. Values: manifest frame x k.
 */
const BAKERY_K = (COMPANY_DIMS['bakery-case']?.[1] ?? 1.1104) / 1.1104;
const bk = (v: number) => Math.round(v * BAKERY_K * 10000) / 10000;
function bakeryTray(name: string, y: number, hx: number, z0: number, z1: number, over: number): PartSpec {
  const floor = y + 0.012, lip = 0.026;
  return {
    name, glass: true,
    move: {type: 'slide', dir: [0, 0, -1], dist: bk(0.3), min: bk(0.16)},
    // the staff-side lip and its pull tab (what moves into view first), then the tray itself (floor + walls) carrying the loaves
    boxes: [B('steelBright', bk(-hx), bk(y + 0.002), bk(z0 - 0.012), bk(hx), bk(y + lip + 0.012), bk(z0)), B('black', bk(-0.08), bk(y + 0.008), bk(z0 - 0.03), bk(0.08), bk(y + lip), bk(z0 - 0.012))],
    tray: tray('steelBright', bk(-hx), bk(y + 0.002), bk(z0), bk(hx), bk(y + lip), bk(z1)),
    surfaces: [{y: bk(floor), x0: bk(-hx + 0.03), x1: bk(hx - 0.03), z0: bk(z0 + 0.03), z1: bk(z1 - 0.03), clear: bk(over)}],
  };
}
/** Prop-frame top of each display level (deck, middle shelf, top shelf) — QA / tests. */
export const BAKERY_LEVELS = [bk(0.48), bk(0.678), bk(0.856)] as const;
/**
 * D23 exam table (office-exam-table.glb, 1.9 x 0.99 x 0.75): the cabinet under the head end (x 0.40..0.90, flat front z 0.204,
 * pulls 0.228) is three drawers by their texture seams (inset frame x 0.412 / 0.878, grooves y 0.275 / 0.408, top band 0.54); hollow
 * behind to z -0.367.
 */
const EXAM_Y: readonly (readonly [number, number])[] = [[0.125, 0.274], [0.277, 0.406], [0.41, 0.54]];
const EXAM = {zCut: 0.185, zFront: 0.204, depth: 0.45, dist: 0.35, tight: true} as const;
/** A tall cupboard bay of the E05 server cabinet run: two shelves inside its lined, hollow bay (x0..x1, floor 0.105, back -0.672). */
function serverBay(name: string, x0: number, x1: number, hinge: -1 | 1): PartSpec {
  const ix0 = x0 + 0.012, ix1 = x1 - 0.012;
  return {
    name,
    move: {type: 'hinge', axis: 'y', pivot: [hinge < 0 ? -1.44 : 1.44, 0, 0.68], angle: (hinge < 0 ? -1 : 1) * 100 * P, min: 55 * P},
    region: [hinge < 0 ? box(-1.462, 0.07, 0.6, -0.627, 1.957, 0.75) : box(0.637, 0.07, 0.6, 1.462, 1.957, 0.75)],
    cavity: box(ix0, 0.108, -0.665, ix1, 1.955, 0.598), cavityRole: 'steelDark',
    inner: [B('steelDark', ix0, 0.7, -0.665, ix1, 0.715, 0.56), B('steelDark', ix0, 1.3, -0.665, ix1, 1.315, 0.56)],
    surfaces: [0.11, 0.717, 1.317].map((y, i) => ({y, x0: ix0 + 0.04, x1: ix1 - 0.04, z0: -0.6, z1: 0.5, clear: i === 2 ? 0.6 : 0.56})),
  };
}

export const OPENABLE_SPECS = {
  // --- trash ------------------------------------------------------------------------------------------------------------
  /**
   * Slatted municipal trash can (trash-can-t25.glb): the dome top lifts on its back rim (split at the band top, y 0.746).
   * Re-measured on the Meshy T2.5 derivative (radial profile 2026-10-29): band r 0.275 at y 0.655-0.742, hood r 0.257 from
   * y 0.744 (thin shell, inner r ~0.249), inner drum r ~0.215 with its lip at y 0.62-0.63, inner floor y 0.105-0.17 — the
   * iteration-08 split, pivot, liner, rim and disc below still fit inside it unchanged.
   */
  bin: {
    label: 'trash can', model: 'trashCan', body: 'model', group: 'container', spill: true,
    parts: [{
      name: 'trash can',
      move: {type: 'hinge', axis: 'x', pivot: [0, 0.746, -0.246], angle: -105 * P, min: 30 * P},
      region: [box(-0.3, 0.746, -0.3, 0.3, 1.0, 0.3)],
      // a disc inside the dome's base ring (r 0.245 at the cut): a square plate's corners would stick out of the round lid
      plateDisc: [0, 0.7485, 0, 0.226],
      cylinder: [0.232, 0.05, 0.744],
      rim: [0.27, 0.232, 0.745],
      inner: trashFill(-0.2, -0.2, 0.2, 0.2, 0.42, true),
      surfaces: [{y: 0.452, x0: -0.15, x1: 0.15, z0: -0.15, z1: 0.15, clear: 0.27}],
    }],
    loot: LOOT.bin,
    sound: {open: 'cabinetTall', close: 'cabinetTall'},
  },
  /**
   * Plastic wheelie bin (p7-wheelie-bin-t25.glb): the lid flips back on its rear edge. Meshy T2.5 (ray-cast 2026-10-29): a closed
   * shell; the lid (top 1.03..1.10) overhangs the body with a lip from y 0.974 all round (to z +-0.425, front / back lips down to
   * ~0.94); body walls at the top x +-0.25 / z +-0.255, tapering to x +-0.19..0.235 at knee height; wheels at mid-depth, no handle
   * bar — the hinge sits on the lid's rear edge.
   */
  wheelieBin: {
    label: 'wheelie bin', model: 'p7_wheelieBin', body: 'model', group: 'container', spill: true,
    parts: [{
      name: 'wheelie bin',
      move: {type: 'hinge', axis: 'x', pivot: [0, 0.99, -0.42], angle: -110 * P, min: 55 * P},
      region: [box(-0.31, 0.97, -0.43, 0.31, 1.2, 0.43), box(-0.31, 0.92, 0.262, 0.31, 0.97, 0.43), box(-0.31, 0.92, -0.43, 0.31, 0.97, -0.262)],
      plate: box(-0.24, 0.971, -0.33, 0.24, 0.974, 0.33),
      // the body tapers toward the bottom and the wheels sit below 0.3 m: liner and fill stay inside its walls, from 0.3 m up
      cavity: box(-0.185, 0.3, -0.225, 0.185, 0.968, 0.225),
      rim: [0.255, -0.262, 0.262, 0.185, -0.225, 0.225, 0.969],
      inner: trashFill(-0.175, -0.215, 0.175, 0.215, 0.56, false, 0.3),
      surfaces: [{y: 0.592, x0: -0.15, x1: 0.15, z0: -0.18, z1: 0.18, clear: 0.3}],
    }],
    loot: LOOT.wheelieBin,
    sound: {open: 'crate', close: 'crate'},
  },
  // --- street / station furniture ---------------------------------------------------------------------------------------------
  /**
   * Coin-op newspaper box (p7-newspaper-vending-box-t25.glb): the windowed front door swings up on its top edge. Meshy T2.5
   * (ray-cast 2026-10-29): flat front z 0.179, door seams x +-0.16 and y 0.27 / 0.71, pull handle to z 0.225 at y 0.29..0.39.
   */
  newspaperVendingBox: {
    label: 'newspaper box', model: 'p7_newspaperVendingBox', body: 'model', group: 'container',
    parts: [{
      name: 'newspaper box',
      move: {type: 'hinge', axis: 'x', pivot: [0, 0.71, 0.18], angle: -80 * P, min: 45 * P},
      region: [box(-0.16, 0.27, 0.155, 0.16, 0.71, 0.3)],
      plate: box(-0.156, 0.274, 0.151, 0.156, 0.706, 0.154),
      cavity: box(-0.2, 0.125, -0.19, 0.2, 0.8, 0.15),
      inner: [B('paper', -0.17, 0.125, -0.17, 0.17, 0.205, 0.085), B('paper', -0.16, 0.205, -0.17, 0.15, 0.245, -0.06)],
      surfaces: [{y: 0.207, x0: -0.15, x1: 0.15, z0: -0.055, z1: 0.08, clear: 0.26}],
    }],
    loot: LOOT.newspaperVendingBox,
    contents: 'yesterday\'s papers',
    sound: {open: 'cabinetTall', close: 'vending'},
  },
  // --- staff / office -----------------------------------------------------------------------------------------------------------
  /** Authored staff-locker bank (gen/purposeShapes.ts frame): three lockers, doors hinged on their right edges. */
  staffLockers: {
    label: 'staff lockers', model: null, body: 'authored', group: 'container',
    bodyBoxes: [
      B('steelDark', -0.6, 0, -0.25, 0.6, 1.9, -0.23), B('steelDark', -0.6, 0, -0.25, -0.585, 1.9, 0.2), B('steelDark', 0.585, 0, -0.25, 0.6, 1.9, 0.2),
      B('steelDark', -0.207, 0.08, -0.23, -0.193, 1.88, 0.2), B('steelDark', 0.193, 0.08, -0.23, 0.207, 1.88, 0.2), B('steelDark', -0.6, 1.88, -0.25, 0.6, 1.9, 0.22),
      B('black', -0.585, 0, -0.23, 0.585, 0.08, 0.2),
    ],
    parts: [locker('left locker', -0.4), locker('middle locker', 0), locker('right locker', 0.4)],
    loot: LOOT.staffLockers,
    sound: {open: 'staffLockers', close: 'staffLockers'},
  },
  /** Four-drawer filing cabinet (p7-filing-cabinet-t25.glb): drawer fronts slide out along +Z with their trays. */
  filingCabinet: {
    label: 'filing cabinet', model: 'p7_filingCabinet', body: 'model', group: 'container',
    parts: FILING_Y.map(([y0, y1], i) => drawer(FILING_NAMES[i], FILING_X[0], FILING_X[1], y0, y1, FILING_Z_CUT, FILING_Z_FRONT, 0.5, 0.42)),
    loot: LOOT.filingCabinet,
    sound: {open: 'desk', close: 'desk'},
  },
  /** Old safe (authored; the lock was forced, door ajar): heavy door on its left hinge, two compartments. */
  safe: {
    label: 'safe', model: null, body: 'authored', group: 'container',
    bodyBoxes: [
      B('steelDark', -0.35, 0.08, -0.35, -0.3, 1.0, 0.1), B('steelDark', 0.3, 0.08, -0.35, 0.35, 1.0, 0.1), B('steelDark', -0.3, 0.95, -0.35, 0.3, 1.0, 0.1),
      B('steelDark', -0.3, 0.08, -0.35, 0.3, 0.13, 0.1), B('steelDark', -0.3, 0.13, -0.35, 0.3, 0.95, -0.3), B('steelDark', -0.3, 0.58, -0.3, 0.3, 0.6, 0.08),
      ...[-1, 1].flatMap(sx => [-1, 1].map(sz => B('black', sx * 0.3 - 0.04, 0, sz * 0.25 - 0.09, sx * 0.3 + 0.04, 0.08, sz * 0.25 - 0.01))),
    ],
    parts: [{
      name: 'safe',
      move: {type: 'hinge', axis: 'y', pivot: [-0.3, 0, 0.1], angle: -100 * P, min: 60 * P},
      boxes: [B('steelDark', -0.3, 0.12, 0.1, 0.3, 0.96, 0.16), B('black', 0.05, 0.6, 0.16, 0.17, 0.72, 0.18), B('steelBright', 0.08, 0.45, 0.16, 0.14, 0.48, 0.19)],
      plate: box(-0.29, 0.13, 0.096, 0.29, 0.95, 0.1),
      cavity: box(-0.3, 0.13, -0.3, 0.3, 0.95, 0.099), cavityRole: 'steelDark',
      ajar: 0.2,
      surfaces: [{y: 0.132, x0: -0.26, x1: 0.26, z0: -0.27, z1: 0.06, clear: 0.43}, {y: 0.602, x0: -0.26, x1: 0.26, z0: -0.27, z1: 0.06, clear: 0.33}],
    }],
    loot: LOOT.safe,
    sound: {open: 'gunLocker', close: 'gunLocker'},
  },
  // --- retail -------------------------------------------------------------------------------------------------------------------
  /**
   * Sliding-glass chest freezer (p7-chest-freezer-t25.glb): two curved panes; opening one slides it over the other. Meshy T2.5
   * (ray-cast 2026-10-29): one curved top y 0.61 (z +-0.31) .. 0.835 (z 0) between end caps at |x| >= 0.69, a hollow box
   * below (floor 0.046), so each pane is its half of the top up to the end caps.
   */
  chestFreezer: {
    label: 'chest freezer', model: 'p7_chestFreezer', body: 'model', group: 'container',
    parts: ([[-1, 'left pane'], [1, 'right pane']] as const).map(([s, name]): PartSpec => ({
      name, group: 'panes', doubleSide: true,
      move: {type: 'slide', dir: [-s, 0.036, 0.017], dist: 0.69, min: 0.4},
      region: [s < 0 ? box(-0.69, 0.6, -0.35, 0.0, 0.9, 0.36) : box(0.0, 0.6, -0.35, 0.69, 0.9, 0.36)],
      cavity: s < 0 ? box(-0.69, 0.14, -0.27, 0.0, 0.84, 0.3) : box(0.0, 0.14, -0.27, 0.69, 0.84, 0.3), cavityRole: 'frost', replaceInterior: true,
      inner: s < 0
        ? [B('frost', -0.68, 0.14, -0.26, -0.01, 0.3, 0.29), B('stock', -0.62, 0.3, -0.22, -0.4, 0.36, 0.0), B('stock', -0.3, 0.3, 0.02, -0.12, 0.34, 0.22)]
        : [B('frost', 0.01, 0.14, -0.26, 0.68, 0.3, 0.29), B('stock', 0.12, 0.3, -0.2, 0.34, 0.35, 0.02), B('stock', 0.42, 0.3, 0.04, 0.64, 0.37, 0.24)],
      surfaces: [{y: 0.302, x0: s < 0 ? -0.6 : 0.08, x1: s < 0 ? -0.08 : 0.6, z0: -0.2, z1: 0.22, clear: 0.28}],
    })),
    loot: LOOT.chestFreezer,
    sound: {open: 'desk', close: 'shopCooler'},
  },
  /**
   * Glass-door drinks cooler (shop-cooler-open-t25r1.glb; 2026-10-30 glass-film repair): the framed glass door (handle right) swings
   * on its left hinge. Aimed at, it is taken over; its glass own mesh never casts the flashlight shadow (openables.ts takeover).
   */
  shopCooler: {
    label: 'drinks cooler', model: 'shopCooler', body: 'model', group: 'surface', shared: true,
    parts: [{
      name: 'cooler door', glass: true, holdsExposed: true,
      move: {type: 'hinge', axis: 'y', pivot: [-0.345, 0, 0.36], angle: -100 * P, min: 60 * P},
      region: [box(-0.348, 0.236, 0.29, 0.352, 1.745, 0.42)],
      surfaces: [],
    }],
    loot: null,
    sound: {open: 'shopCooler', close: 'shopCooler'},
  },
  // --- wall cabinets --------------------------------------------------------------------------------------------------------------
  /**
   * Wall first-aid box (p7-first-aid-wall-kit-t25.glb): flat front door (handle left) on its right hinge; two shelves inside.
   * Meshy T2.5 re-measure (ray-cast 2026-10-29): door front z 0.104 between the side seams x +-0.17 and the grooves y 0.028 / 0.419.
   */
  firstAidWallKit: {
    label: 'first-aid kit', model: 'p7_firstAidWallKit', body: 'model', group: 'container',
    parts: [{
      name: 'first-aid kit',
      move: {type: 'hinge', axis: 'y', pivot: [0.17, 0, 0.105], angle: 105 * P, min: 60 * P},
      region: [box(-0.17, 0.028, 0.08, 0.17, 0.419, 0.2)],
      plate: box(-0.166, 0.032, 0.083, 0.166, 0.415, 0.087),
      cavity: box(-0.168, 0.03, -0.115, 0.168, 0.417, 0.079), cavityRole: 'white',
      inner: [B('white', -0.166, 0.145, -0.113, 0.166, 0.152, 0.075), B('white', -0.166, 0.275, -0.113, 0.166, 0.282, 0.075)],
      surfaces: [
        {y: 0.032, x0: -0.15, x1: 0.15, z0: -0.1, z1: 0.06, clear: 0.105},
        {y: 0.154, x0: -0.15, x1: 0.15, z0: -0.1, z1: 0.06, clear: 0.115},
        {y: 0.284, x0: -0.15, x1: 0.15, z0: -0.1, z1: 0.06, clear: 0.125},
      ],
    }],
    loot: LOOT.firstAidWallKit,
    sound: {open: 'medCabinet', close: 'medCabinet'},
  },
  /**
   * Fire-extinguisher cabinet (p7-fire-extinguisher-cabinet-t25r1.glb, an open-front hybrid: T2.5 exterior with its painted pane cut,
   * a real glass pane, an inward liner and the T2.5 extinguisher inside): the white glazed door frame (handle left) swings on its
   * right hinges. Door frame measured on the T2.5 derivative (colour + ray-cast 2026-10-29): x -0.18..0.168, y 0.048..0.705,
   * front z 0.155..0.163 (glass pane z 0.15; the liner ends at z 0.135).
   */
  fireExtinguisherCabinet: {
    label: 'fire extinguisher cabinet', model: 'p7_fireExtinguisherCabinet', body: 'model', group: 'container',
    parts: [{
      name: 'fire extinguisher cabinet',
      move: {type: 'hinge', axis: 'y', pivot: [0.168, 0, 0.165], angle: 105 * P, min: 60 * P},
      region: [box(-0.18, 0.048, 0.14, 0.168, 0.705, 0.25)],
      surfaces: [],
    }],
    loot: null, contents: 'only the extinguisher, clipped in its bracket',
    sound: {open: 'cabinetTall', close: 'cabinetTall'},
  },
  /**
   * Defibrillator cabinet (p7-aed-wall-cabinet-t25.glb): door frame (handle right) on its left hinge. Meshy T2.5 (ray-cast
   * 2026-10-29): frame front z 0.124, an open window x -0.145..0.135 / y 0.065..0.415 onto the unit (no glass pane modelled).
   */
  aedWallCabinet: {
    label: 'defibrillator cabinet', model: 'p7_aedWallCabinet', body: 'model', group: 'container',
    parts: [{
      name: 'defibrillator cabinet',
      move: {type: 'hinge', axis: 'y', pivot: [-0.211, 0, 0.12], angle: -105 * P, min: 60 * P},
      region: [box(-0.212, 0.0, 0.095, 0.212, 0.48, 0.2)],
      surfaces: [],
    }],
    loot: null, contents: 'the defibrillator — its battery long dead',
    sound: {open: 'medCabinet', close: 'medCabinet'},
  },
  // --- carts / chests with drawers (existing surface holders whose loot moves into real drawers) ------------------------------------
  /** Medical crash cart (p7-crash-cart.glb): five drawers under the monitor shelf. */
  crashCart: {
    label: 'crash cart', model: 'p7_crashCart', body: 'model', group: 'surface', shared: true, exposed: 'none',
    parts: CART_Y.map(([y0, y1], i) => drawer(ord(i, CART_Y.length), -0.275, 0.245, y0, y1, 0.218, 0.238, 0.36, 0.3)),
    loot: null,
    sound: {open: 'desk', close: 'desk'},
  },
  /** Rolling tool chest (p7-rolling-tool-chest.glb): five cabinet drawers + three top-chest drawers. */
  rollingToolChest: {
    label: 'tool chest', model: 'p7_rollingToolChest', body: 'model', group: 'surface', shared: true, exposed: {minY: 1.0},
    parts: [
      ...CHEST_LOW_Y.map(([y0, y1], i) => drawer(i === 0 ? 'bottom drawer' : 'drawer', -0.265, 0.325, y0, y1, 0.19, 0.21, 0.36, 0.3)),
      ...CHEST_TOP_Y.map(([y0, y1], i) => drawer(i === CHEST_TOP_Y.length - 1 ? 'top drawer' : 'chest drawer', -0.265, 0.315, y0, y1, 0.186, 0.206, 0.33, 0.27)),
    ],
    loot: null,
    sound: {open: 'desk', close: 'desk'},
  },
  /**
   * Staff kitchenette (gen/purposeShapes.ts): the four base-unit doors were baked onto a solid carcass — now a hollow authored
   * carcass with two pairs of hinged veneer doors (worktop, sink, appliances and wall cupboard unchanged).
   */
  kitchenette: {
    label: 'kitchenette', model: null, body: 'authored', group: 'surface',
    bodyPurpose: {drop: [box(-0.95, 0.1, 0.285, 0.95, 0.86, 0.33), box(-0.05, 0.45, -0.05, 0.05, 0.52, 0.03)]},
    bodyBoxes: [
      B('wood', -0.9, 0.08, -0.31, 0.9, 0.12, 0.29), B('wood', -0.9, 0.84, -0.31, 0.9, 0.88, 0.29), B('wood', -0.9, 0.12, -0.31, 0.9, 0.84, -0.28),
      B('wood', -0.9, 0.12, -0.31, -0.885, 0.84, 0.29), B('wood', 0.885, 0.12, -0.31, 0.9, 0.84, 0.29),
      ...[-0.45, 0, 0.45].map(x => B('wood', x - 0.0075, 0.12, -0.28, x + 0.0075, 0.84, 0.29)),
    ],
    parts: [cupboard(-0.675, -1), cupboard(-0.225, 1), cupboard(0.225, -1), cupboard(0.675, 1)],
    loot: LOOT.kitchenette,
    sound: {open: 'kitchenette', close: 'kitchenette'},
  },
  // --- desks (procedural / authored pedestals: drawer fronts are authored) --------------------------------------------------------
  /** Procedural office desk (gen/propShapes.ts): three authored drawers on the steel pedestal (x 0.275..0.725). */
  desk: {
    label: 'desk', model: null, body: 'overlay', group: 'surface',
    parts: [[0.03, 0.255], [0.265, 0.485], [0.495, 0.715]].map(([y0, y1], i) => deskDrawer(i === 2 ? 'top drawer' : i === 0 ? 'bottom drawer' : 'drawer', 0.285, 0.715, y0, y1, 0.35, 0.6)),
    loot: LOOT.desk,
    sound: {open: 'desk', close: 'desk'},
  },
  /** Security desk (gen/purposeShapes.ts): three authored drawers on its pedestal (x 0.35..0.79, seams 0.24 / 0.48). */
  monitorDesk: {
    label: 'security desk', model: null, body: 'overlay', group: 'surface',
    parts: [[0.015, 0.236], [0.254, 0.476], [0.494, 0.712]].map(([y0, y1], i) => deskDrawer(i === 2 ? 'top drawer' : i === 0 ? 'bottom drawer' : 'drawer', 0.37, 0.77, y0, y1, 0.355, 0.6)),
    loot: LOOT.monitorDesk,
    sound: {open: 'desk', close: 'desk'},
  },
  // --- washroom cubicles (task office-overhaul-20261030, lane INTERACT) -------------------------------------------------------------
  /**
   * Toilet stall (user feedback #13: "Bathroom stall doors cannot be opened … sometimes find items in the toilet!"): the procedural
   * cubicle (gen/propShapes.ts toiletStall: partitions, header rail, legs, toilet) is the holder body; the laminate door is an
   * authored leaf hinged on the left front post that swings INTO the cubicle (88°: it rests along the left partition, clear of the
   * toilet; +angle turns the free end toward -Z). Loot lies in the toilet bowl or on the tank lid — rolled once with the level
   * (finite, remembered like every holder), and the iteration-12 scarcity thins it so only about a third of stalls hold anything.
   * The walk-in collision, sight and hitscan of the cubicle are world/stalls.ts (the prop keeps its generated AABB / masks).
   */
  toiletStall: {
    label: 'toilet stall', model: null, body: 'authored', group: 'container',
    bodyShape: {drop: [], swap: {asset: 'toilet', drop: [box(-0.25, 0, -0.8, 0.25, 0.9, -0.12)], at: [0, 0, -0.79], size: [0.44, 0.82, 0.68], yaw: Math.PI}},
    parts: [{
      name: 'stall door',
      move: {type: 'hinge', axis: 'y', pivot: [-0.455, 0, 0.78], angle: 88 * P, min: 70 * P},
      boxes: [
        B('partition', -0.445, 0.16, 0.765, 0.445, 1.9, 0.795),
        // outside: occupancy indicator + knob near the free edge; inside: the slide latch
        B('black', 0.33, 0.985, 0.795, 0.41, 1.025, 0.803), B('steelBright', 0.355, 0.9, 0.795, 0.385, 0.95, 0.815),
        B('steelBright', 0.36, 0.975, 0.75, 0.42, 1.035, 0.765),
      ],
      cavity: box(-0.47, 0, -0.77, 0.47, 1.95, 0.75), cavityHidden: true,
      // revealed with the door: a toilet-roll holder on the right partition
      inner: [B('steelBright', 0.445, 0.68, -0.3, 0.47, 0.76, -0.12), B('white', 0.39, 0.69, -0.27, 0.445, 0.75, -0.15)],
      surfaces: [
        // in the bowl (items lie down) and on the tank lid
        {y: 0.245, x0: -0.12, x1: 0.12, z0: -0.56, z1: -0.22, clear: 0.14},
        {y: 0.812, x0: -0.17, x1: 0.17, z0: -0.77, z1: -0.64, clear: 0.4},
      ],
    }],
    loot: LOOT.toiletStall,
    sound: {open: 'kitchenette', close: 'kitchenette'},
  },
  // --- office-overhaul storage (task office-interactions-layout-20261030, lane OPEN: "I encountered a large cabinet I could not
  // open. The items inside should be related to the type of container it is") -------------------------------------------------------
  /** B3 lateral filing cabinet: its four big drawer fronts slide out with their trays (the "large cabinet" the user could not open). */
  officeFiling: {
    label: 'filing cabinet', model: 'office-filing-cabinet', turn: true, body: 'model', group: 'container',
    parts: LATERAL_Y.flatMap(([y0, y1], r) => LATERAL_X.map(([x0, x1], c) => modelDrawer(`${r ? 'top' : 'bottom'} ${c ? 'right' : 'left'} drawer`, x0, x1, y0, y1, LATERAL))),
    loot: LOOT.officeFiling,
    sound: {open: 'desk', close: 'desk'},
  },
  /** E01 executive desk: seven drawers on the sitter side (a centre drawer, two top drawers, two per pedestal). */
  executiveDesk: {
    label: 'executive desk', model: 'office-executive-desk', turn: true, body: 'model', group: 'container', seatAside: true,
    parts: [
      modelDrawer('centre drawer', -0.455, 0.45, 0.655, 0.77, {...EXEC, tight: true}),
      ...([-1, 1] as const).flatMap(s => {
        const [x0, x1] = s < 0 ? [-0.89, -0.535] : [0.535, 0.89];
        return [
          modelDrawer('top drawer', s < 0 ? -0.905 : 0.535, s < 0 ? -0.535 : 0.905, 0.655, 0.77, {...EXEC, tight: true}),
          modelDrawer('drawer', x0, x1, 0.415, 0.605, EXEC),
          modelDrawer('bottom drawer', x0, x1, 0.175, 0.38, EXEC),
        ];
      }),
    ],
    loot: LOOT.executiveDesk,
    sound: {open: 'desk', close: 'desk'},
  },
  /** D09 lab bench: fifteen derived drawers (lab consumables, bio mater specimen jars); its glassware stands on top as separate props. */
  labBench: {
    label: 'lab bench', model: 'office-lab-bench', turn: true, body: 'model', group: 'container', seatAside: true,
    parts: LAB_Y.flatMap(([y0, y1], r) => LAB_X.map(([x0, x1]) => modelDrawer(r === 0 ? 'bottom drawer' : r === 2 ? 'top drawer' : 'drawer', x0, x1, y0, y1, LAB))),
    loot: LOOT.labBench,
    sound: {open: 'desk', close: 'desk'},
  },
  /**
   * Task office-props-physics-scale-20261030 (lane FURN, user: "I found a bakery display case, which had food in it, but I could not
   * open and get the bread"): D38 bakery case — three display trays (deck, middle and top shelf) pull out of its open staff side;
   * finite `bread` lots on them (items/lootTables.ts BAKERY_ROWS), seen through the case, taken once a tray is out, never refilled.
   */
  bakeryCase: {
    label: 'bakery case', model: 'office-bakery-case', turn: true, body: 'model', group: 'container',
    parts: [
      bakeryTray('bottom tray', 0.48, 0.7, -0.53, 0.22, 0.17),
      bakeryTray('middle tray', 0.678, 0.6, -0.46, 0.18, 0.145),
      bakeryTray('top tray', 0.856, 0.6, -0.46, 0.18, 0.18),
    ],
    loot: LOOT.bakeryCase,
    contents: 'crumbs and paper liners',
    sound: {open: 'desk', close: 'desk'},
  },
  /** D23 exam table: the three drawers of its head-end cabinet (clinic dressings). */
  examTable: {
    label: 'exam table', model: 'office-exam-table', turn: true, body: 'model', group: 'container',
    parts: EXAM_Y.map(([y0, y1], i) => modelDrawer(i === 0 ? 'bottom drawer' : i === 2 ? 'top drawer' : 'drawer', 0.412, 0.878, y0, y1, EXAM)),
    loot: LOOT.examTable,
    sound: {open: 'desk', close: 'desk'},
  },
  /**
   * D33 antique vault safe (office-vault-safe.glb, 1.31 x 1.5 x 1.35): the panelled door (x -0.506..0.499, y 0.29..1.335, front z
   * 0.585..0.617, back 0.56; dial / handle proud) swings on its right-hand hinge knuckles (x ~0.5, z ~0.63); the body is a hollow
   * single-faced shell (inner floor 0.134, back -0.677): a lined steel cavity with one shelf. The dial was left off the lock.
   */
  vaultSafe: {
    label: 'vault safe', model: 'office-vault-safe', turn: true, body: 'model', group: 'container',
    parts: [{
      name: 'safe door',
      move: {type: 'hinge', axis: 'y', pivot: [0.505, 0, 0.62], angle: 100 * P, min: 55 * P},
      region: [box(-0.509, 0.287, 0.5, 0.503, 1.339, 0.75)],
      cavity: box(-0.5, 0.29, -0.62, 0.5, 1.335, 0.555), cavityRole: 'steelDark',
      inner: [B('steelDark', -0.5, 0.79, -0.62, 0.5, 0.808, 0.54)],
      surfaces: [{y: 0.292, x0: -0.44, x1: 0.44, z0: -0.56, z1: 0.48, clear: 0.48}, {y: 0.81, x0: -0.44, x1: 0.44, z0: -0.56, z1: 0.48, clear: 0.5}],
    }],
    loot: LOOT.vaultSafe,
    sound: {open: 'gunLocker', close: 'gunLocker'},
  },
  /**
   * E05 server cabinet run (office-server-cabinet.glb, 2.92 x 2.0 x 1.38): two tall cupboard bays behind 7 cm solid doors (x
   * -1.454..-0.624 / 0.651..1.454, hinge knuckles on the outer edges at y 0.3 / 1.75, front z 0.677) — EMPTY hollow bays (supply
   * cupboards: two shelves each) — and a centre bay of two glass doors (frames only, x -0.62..0.005..0.634, y 0.105..1.96, meeting
   * stiles with pulls at x -0.05..0.06) over two racks of servers (fronts z 0.58..0.6: equipment, nothing to take).
   */
  serverCabinet: {
    label: 'server cabinet', model: 'office-server-cabinet', turn: true, body: 'model', group: 'container',
    parts: [
      serverBay('left cupboard', -1.425, -0.636, -1),
      {
        name: 'glass door', contents: 'racked servers, cold and dark — nothing to take',
        move: {type: 'hinge', axis: 'y', pivot: [-0.62, 0, 0.675], angle: -100 * P, min: 55 * P},
        region: [box(-0.622, 0.105, 0.62, 0.005, 1.957, 0.75)], surfaces: [],
      },
      {
        name: 'glass door', contents: 'racked servers, cold and dark — nothing to take',
        move: {type: 'hinge', axis: 'y', pivot: [0.634, 0, 0.675], angle: 100 * P, min: 55 * P},
        region: [box(0.005, 0.105, 0.62, 0.636, 1.957, 0.75)], surfaces: [],
      },
      serverBay('right cupboard', 0.648, 1.425, 1),
    ],
    loot: LOOT.serverCabinet,
    sound: {open: 'cabinetTall', close: 'cabinetTall'},
  },
  /**
   * Task office-props-physics-scale-20261030 (lane RACK): the 42U 19-inch rack, a LOCAL procedural rebuild (office-server-rack-r2.glb,
   * 0.6 x 2.0 x 1.0; tools/asset-pipeline/props/build-server-rack-r2.mjs prints this layout and writes it to its sidecar). It replaces
   * B10 (an empty 1.23 x 1.48 m cabinet whose "glass" was an opaque painted texture on overlapping sliver triangles). The front door
   * = a frame (stiles x -0.298..-0.266 / 0.266..0.298, z 0.468..0.485) round a see-through PERFORATED insert (BLEND material, z 0.4765;
   * lever handle on the left, proud to z 0.5) hinged on its right (knuckles x ~0.299). Behind it: front rails z 0.388..0.4, racked
   * equipment (UPS, NAS, 1U / 2U servers, switches, patch panels, KVM, blanking panels; faceplates z 0.4..0.412, LEDs blink —
   * world/rackLeds.ts) and THREE EMPTY BAYS (U2-6, U16-19, U29-33) with cantilever shelves (tray z -0.16..0.4) where loot rests.
   * The carcass is real geometry (side panels x +-0.285, rear door z -0.485), so the cavity only bounds item physics (hidden).
   */
  serverRack: {
    label: 'server rack', model: 'office-server-rack-r2', turn: true, body: 'model', group: 'container',
    parts: [{
      name: 'rack door', glass: true,
      move: {type: 'hinge', axis: 'y', pivot: [0.291, 0, 0.4765], angle: 100 * P, min: 55 * P},
      region: [box(-0.305, 0.07, 0.466, 0.305, 1.995, 0.51)],
      // (front at the frame, so the opening slab [0.445, 0.471] holds no rack face: nothing is dropped from the split)
      cavity: box(-0.284, 0.085, -0.48, 0.284, 1.96, 0.465), cavityHidden: true, modelInterior: true,
      surfaces: [0.1819, 0.8042, 1.3821].map((y, i) => ({y, x0: -0.195, x1: 0.195, z0: -0.135, z1: 0.37, clear: i === 1 ? 0.169 : 0.213})),
    }],
    loot: LOOT.serverRack,
    sound: {open: 'cabinetTall', close: 'cabinetTall'},
  },
  /**
   * D10 biohazard fridge (office-biohazard-fridge.glb, 0.9 x 2.0 x 0.77): the door is a frame (stiles x -0.421..-0.386 / 0.379..0.41,
   * rails y 0.07..0.085 / 1.62..1.635, z 0.33..0.376; no pane) hinged on its right; shelves at y 0.25 / 0.43 / 0.71 / 0.99 / 1.34
   * crammed with fused specimen vials. The bottom shelf and its vials are replaced by a clear compartment over the crisper lid
   * (y 0.2..0.425) for the cold-chain dressings; the racks of vials above stay (decor).
   */
  biohazardFridge: {
    label: 'specimen fridge', model: 'office-biohazard-fridge', turn: true, body: 'model', group: 'container',
    parts: [{
      name: 'fridge door', glass: true,
      move: {type: 'hinge', axis: 'y', pivot: [0.412, 0, 0.37], angle: 100 * P, min: 55 * P},
      region: [box(-0.425, 0.066, 0.32, -0.384, 1.64, 0.45), box(0.376, 0.066, 0.32, 0.415, 1.64, 0.45), box(-0.384, 1.605, 0.32, 0.376, 1.64, 0.45), box(-0.384, 0.066, 0.35, 0.376, 0.088, 0.45)],
      cavity: box(-0.365, 0.2, -0.34, 0.365, 0.425, 0.315), cavityHidden: true, replaceInterior: true, openAxis: 2,
      surfaces: [{y: 0.202, x0: -0.33, x1: 0.33, z0: -0.3, z1: 0.27, clear: 0.2}],
    }],
    loot: LOOT.biohazardFridge,
    sound: {open: 'fridge', close: 'fridge'},
  },
  /**
   * D34 archive box stack (office-archive-boxes.glb, 0.58 x 1.3 x 0.73): the front top box (x -0.2..0.066, z -0.035..0.304, y
   * 1.09..1.3, hollow single-faced card) lifts its lid on the back edge; the crushed boxes under it stay shut (fused). Spills like a
   * bin if physics knocks the stack loose.
   */
  archiveBoxes: {
    label: 'archive box', model: 'office-archive-boxes', turn: true, body: 'model', group: 'container', spill: true,
    parts: [{
      name: 'archive box lid',
      move: {type: 'hinge', axis: 'x', pivot: [0, 1.262, -0.04], angle: -100 * P, min: 45 * P},
      region: [box(-0.215, 1.262, -0.045, 0.075, 1.32, 0.32)],
      // inside its card walls (x -0.206..0.057, z -0.031..0.295 at the narrowest)
      plate: box(-0.192, 1.263, -0.022, 0.048, 1.266, 0.286),
      cavity: box(-0.198, 1.096, -0.027, 0.053, 1.258, 0.291),
      inner: [B('paper', -0.19, 1.096, -0.022, 0.048, 1.17, 0.075)],
      surfaces: [{y: 1.098, x0: -0.165, x1: 0.028, z0: 0.095, z1: 0.265, clear: 0.15}],
    }],
    loot: LOOT.archiveBoxes,
    contents: 'old case files',
    sound: {open: 'crate', close: 'crate'},
  },
} as const satisfies Record<string, OpenableSpec>;

export type OpenableKind = keyof typeof OPENABLE_SPECS;
export const OPENABLE_KINDS = Object.keys(OPENABLE_SPECS) as OpenableKind[];
const SPECS = OPENABLE_SPECS as Readonly<Record<string, OpenableSpec>>;
export function isOpenableKind(kind: string): kind is OpenableKind { return kind in SPECS; }
export function openableSpec(kind: string): OpenableSpec | null { return SPECS[kind] ?? null; }

/** New container kinds (not loot holders before iteration 08): items/loot.ts ContainerKind additions. */
export const OPENABLE_CONTAINER_KINDS = ['bin', 'wheelieBin', 'newspaperVendingBox', 'staffLockers', 'filingCabinet', 'safe', 'chestFreezer', 'firstAidWallKit', 'fireExtinguisherCabinet', 'aedWallCabinet',
  'toiletStall', // task office-overhaul-20261030 (lane INTERACT): washroom cubicles
  // task office-interactions-layout-20261030 (lane OPEN): office-overhaul storage
  'officeFiling', 'executiveDesk', 'labBench', 'examTable', 'vaultSafe', 'serverCabinet', 'serverRack', 'biohazardFridge', 'archiveBoxes',
  'bakeryCase'] as const; // task office-props-physics-scale-20261030 (lane FURN): the bakery display case
export type OpenableContainerKind = (typeof OPENABLE_CONTAINER_KINDS)[number];

/**
 * Whether a placed kind becomes an openable holder: new container kinds always (an honest box placeholder stands in if their
 * model is missing); an existing surface holder (glass-door cooler, crash cart, tool chest) only when its model is loaded —
 * otherwise it stays exactly what it was (the world builder draws it, its loot stays on its exposed surfaces).
 */
export function openableActive(kind: string, models: Readonly<Record<string, unknown>>): boolean {
  const s = SPECS[kind];
  if (!s) return false;
  return s.group === 'container' || !s.model || !!models[s.model];
}
/** Kinds whose body the holder system draws (world builders skip them so nothing is drawn twice). */
export function rendersOwnBody(kind: string, models?: Readonly<Record<string, unknown>>): boolean {
  const s = SPECS[kind];
  return !!s && s.body !== 'overlay' && (!models || openableActive(kind, models));
}
/** Light dynamic holders (trash cans): they still go loose when shot (spilling their lots), see physics/dynamicItems.ts. */
export function isSpillHolderKind(kind: string): boolean { return !!SPECS[kind]?.spill; }

/** Compartment loot surfaces (holder-local, +2 mm like every measured surface) tagged with their part index. */
export function partSurfaces(kind: string): (SurfaceSpec & {part: number})[] {
  const s = SPECS[kind];
  if (!s) return [];
  return s.parts.flatMap((p, i) => p.surfaces.map(q => ({...q, y: q.y + 0.002, part: i})));
}

/**
 * Every loot surface of an openable holder: its pre-existing (exposed) surfaces — kept, filtered or claimed by a compartment —
 * followed by the compartments' own surfaces. Exposed surfaces without a `part` stay open (desk tops).
 */
export function openableSurfaces<S extends SurfaceSpec>(kind: string, exposed: readonly S[]): (S & {part?: number})[] {
  const s = SPECS[kind];
  if (!s) return exposed.slice();
  const keep = s.exposed === 'none' ? [] : s.exposed ? exposed.filter(q => q.y >= (s.exposed as {minY: number}).minY) : exposed.slice();
  const claim = s.parts.findIndex(p => p.holdsExposed);
  return [...keep.map(q => (claim >= 0 ? {...q, part: claim} : q)), ...(partSurfaces(kind) as (S & {part: number})[])];
}

/** Separate compartment roll (desk drawers): the exposed surfaces keep their own roll, compartments get `loot`. */
export function separateCompartmentLoot(kind: string): OpenableLoot | null {
  const s = SPECS[kind];
  return s && s.group === 'surface' && !s.shared ? s.loot : null;
}
/** Own loot table of a NEW container kind (null loot = fixture contents only: rolls nothing). */
export function containerLoot(kind: string): OpenableLoot | null | undefined {
  const s = SPECS[kind];
  return s && s.group === 'container' ? s.loot : undefined;
}

/** Loot table metadata for items/loot.ts (labels / lots / empty chance of the new container kinds). */
export const OPENABLE_META = {
  label: Object.fromEntries(OPENABLE_CONTAINER_KINDS.map(k => [k, SPECS[k].label])) as Record<OpenableContainerKind, string>,
};

// ---------------------------------------------------------------------------------------
// Audit: every prop kind of the catalogue (generated + authored + iteration-07) — what can be opened and why not.

export type AuditClass = 'openable' | 'existing' | 'open' | 'exception' | 'none';
/**
 * Task office-interactions-layout-20261030 (lane OPEN): what a prop IS, for the "storage opens" rule (root CLAUDE.md "Props — core
 * design rules"): 'storage' (reads as something you could open: cabinets, drawers, safes, fridges, lidded boxes), 'surface' (an open
 * top / shelf / counter), 'equipment' (machines, appliances, screens) or 'decor' (furniture and dressing with nothing to open).
 */
export type PropRole = 'storage' | 'surface' | 'equipment' | 'decor';
export interface AuditEntry { kind: string; cls: AuditClass; how: string; role?: PropRole }

/**
 * Task office-interactions-layout-20261030 (lane OPEN): EVERY office kind (gen/office/kinds.ts OFFICE_KINDS: the iteration-16 office
 * kinds + the office-overhaul company / supporting kinds) classified by role and openables class with the honest reason, from the
 * runtime models (CPU ortho views + ray-cast hit profiles, reference/tasks/office-interactions-layout-20261030/tools/open-measure.mjs).
 * A Record over OfficeKind: a new office kind does not compile until it is classified here. 'openable' rows must be OPENABLE_SPECS
 * kinds (tests/office-openables.test.ts).
 */
const OFFICE_OPEN_AUDIT: Readonly<Record<OfficeKind, {role: PropRole; cls: AuditClass; how: string}>> = {
  // --- storage that opens now (OPENABLE_SPECS above) ---
  officeFiling: {role: 'storage', cls: 'openable', how: 'lateral filing cabinet: 4 derived drawers'},
  serverRack: {role: 'storage', cls: 'openable', how: '42U rack (local rebuild): derived perforated see-through door over racked equipment, 3 empty bays with loot shelves'},
  serverCabinet: {role: 'storage', cls: 'openable', how: 'three-bay run: 2 derived cupboard doors (2 shelves each) + 2 derived glass doors over racked servers (fixture contents)'},
  vaultSafe: {role: 'storage', cls: 'openable', how: 'antique vault safe: derived door (the dial was left off the lock), lined steel cavity + shelf'},
  executiveDesk: {role: 'storage', cls: 'openable', how: '7 derived drawers on the sitter side (the 2 desktop organiser drawers stay fused: 8 cm fronts, nothing fits)'},
  labBench: {role: 'storage', cls: 'openable', how: '15 derived drawers (body only: its glassware / microscope are separate lab* props on the worktop)'},
  bakeryCase: {role: 'storage', cls: 'openable', how: 'display case: 3 authored display trays pull out of its open staff side (finite bread FOOD lots; the baked loaves were separated from the model)'},
  examTable: {role: 'storage', cls: 'openable', how: '3 derived drawers in the head-end cabinet'},
  biohazardFridge: {role: 'storage', cls: 'openable', how: 'derived door frame; a cleared bottom compartment (its shelf of fused vials replaced) holds the loot'},
  archiveBoxes: {role: 'storage', cls: 'openable', how: 'the top box lifts its derived lid (the crushed boxes under it stay shut)'},
  // --- storage-looking, deliberately closed (honest reasons) ---
  kegerator: {role: 'storage', cls: 'exception', how: 'its front is a tap panel with no door; the model\'s keg door is on its back, which always stands against a wall (corner placement); kegs / beer are not items'},
  globeBar: {role: 'storage', cls: 'exception', how: 'globe lid modelled permanently open (hinge fused); its decanters and glasses are decor (spirits are not items)'},
  parcelPallet: {role: 'storage', cls: 'exception', how: 'sealed, taped shipping cartons stacked on a pallet (like cartonStack): not searchable'},
  gumballJar: {role: 'storage', cls: 'exception', how: 'lidded glass jar of gumballs: the lid is fused and gum is not an item'},
  gumballMachine: {role: 'equipment', cls: 'exception', how: 'coin flap dispenses gum only (not an item); one fused mesh'},
  arcadeCabinet: {role: 'equipment', cls: 'exception', how: 'coin door: a locked service panel of a machine; one fused mesh'},
  jukebox: {role: 'equipment', cls: 'exception', how: 'service panel locked, records only; one fused mesh'},
  officePhotocopier: {role: 'equipment', cls: 'exception', how: 'copier paper trays: appliance holding paper only (not an item)'},
  coffeeRoaster: {role: 'equipment', cls: 'exception', how: 'drum roaster hatch: machinery holding old beans only'},
  cracUnit: {role: 'equipment', cls: 'exception', how: 'CRAC unit service panels: machinery, locked'},
  roofHvac: {role: 'equipment', cls: 'exception', how: 'rooftop HVAC service panels: machinery, screwed shut'},
  // --- nothing to open ---
  receptionDesk: {role: 'surface', cls: 'none', how: 'solid counter block: closed panels front AND back (both sides measured), no drawers or doors modelled'},
  cctvConsole: {role: 'equipment', cls: 'none', how: 'monitor wall on a flat board: no drawers modelled'},
  tradingDesk: {role: 'surface', cls: 'none', how: 'open curved desk on legs with a PC tower: no drawers (its monitors / keyboard are separate tradingMonitor / tradingKeyboard props)'},
  newsDesk: {role: 'surface', cls: 'none', how: 'anchor desk with a closed front: no drawers modelled'},
  consoleStation: {role: 'surface', cls: 'none', how: 'open media stand (console / pads on open shelves): no doors or drawers'},
  conferenceTable: {role: 'surface', cls: 'none', how: 'table top on legs: no drawers'},
  draftingTable: {role: 'surface', cls: 'none', how: 'drafting board on its trestle: no drawers modelled (lane FURN: its lamp is a separate prop; the baked stool / papers were removed)'},
  officeShelf: {role: 'surface', cls: 'none', how: 'open steel shelving: no doors; its books are decor'},
  lawBookcase: {role: 'surface', cls: 'none', how: 'open bookcase without doors: its books are decor'},
  sneakerWall: {role: 'surface', cls: 'none', how: 'open display wall: the shoes are decor'},
  clothingRack: {role: 'surface', cls: 'none', how: 'open garment rail: the clothes are decor'},
  officeWaterCooler: {role: 'equipment', cls: 'none', how: 'bottle cooler in an open frame: the jug is part of the appliance, no cupboard door'},
  officeMonitor: {role: 'equipment', cls: 'none', how: 'monitor: no door, lid or drawer'},
  espressoMachine: {role: 'equipment', cls: 'none', how: 'espresso machine on a sideboard counter: group heads / wands, no door or drawer (lane FURN: its cups are separate props)'},
  doughMixer: {role: 'equipment', cls: 'none', how: 'open-bowl mixer: no door, lid or drawer'},
  mixingConsole: {role: 'equipment', cls: 'none', how: 'mixing desk on its riser: no drawers (lane FURN: its studio monitors are separate props)'},
  tvCamera: {role: 'equipment', cls: 'none', how: 'studio camera on a pedestal'},
  treadmill: {role: 'equipment', cls: 'none', how: 'treadmill: nothing to open'},
  vitalsMonitor: {role: 'equipment', cls: 'none', how: 'vitals monitor on a stand'},
  metalDetector: {role: 'equipment', cls: 'none', how: 'walk-through detector arch'},
  securityTurnstile: {role: 'equipment', cls: 'none', how: 'turnstile gate: nothing to open'},
  satelliteDish: {role: 'equipment', cls: 'none', how: 'roof satellite dish: nothing to open'},
  waterTower: {role: 'equipment', cls: 'none', how: 'roof water tank on its stand: no hatch within reach'},
  telescope: {role: 'equipment', cls: 'none', how: 'telescope on a tripod'},
  foosballTable: {role: 'equipment', cls: 'none', how: 'game table: no drawers'},
  pingPongTable: {role: 'equipment', cls: 'none', how: 'game table: no drawers'},
  shipModel: {role: 'decor', cls: 'none', how: 'display model delivered without a cabinet: it stands on an openable cabinetLow sideboard'},
  aquarium: {role: 'decor', cls: 'none', how: 'fish tank delivered without a cabinet: it stands on an openable cabinetLow sideboard'},
  officeChair: {role: 'decor', cls: 'none', how: 'swivel chair: nothing to open'},
  executiveChair: {role: 'decor', cls: 'none', how: 'swivel chair: nothing to open'},
  chesterfieldSofa: {role: 'decor', cls: 'none', how: 'sofa: nothing to open'},
  lobbySofa: {role: 'decor', cls: 'none', how: 'sofa: nothing to open'},
  loungeArmchair: {role: 'decor', cls: 'none', how: 'armchair: nothing to open'},
  beanBag: {role: 'decor', cls: 'none', how: 'bean bag: nothing to open'},
  // task office-props-physics-scale-20261030 (lane FURN): loose clutter separated from the lab bench / trading desk models
  labFlask: {role: 'decor', cls: 'none', how: 'loose glassware on a lab bench: nothing to open'},
  labFlaskLarge: {role: 'decor', cls: 'none', how: 'loose glassware on a lab bench: nothing to open'},
  labBottle: {role: 'decor', cls: 'none', how: 'stoppered reagent bottle (fused stopper; reagents are not items)'},
  labBottleRack: {role: 'decor', cls: 'none', how: 'open wire stand of stoppered reagent bottles'},
  labTubeRack: {role: 'decor', cls: 'none', how: 'open test-tube rack'},
  labMicroscope: {role: 'equipment', cls: 'none', how: 'microscope: nothing to open'},
  tradingMonitor: {role: 'equipment', cls: 'none', how: 'monitor: no door, lid or drawer'},
  tradingKeyboard: {role: 'equipment', cls: 'none', how: 'keyboard and mouse: nothing to open'},
  draftingLamp: {role: 'equipment', cls: 'none', how: 'arm desk lamp: nothing to open'},
  studioMonitor: {role: 'equipment', cls: 'none', how: 'studio monitor speaker: nothing to open'},
  studioMonitorSmall: {role: 'equipment', cls: 'none', how: 'studio monitor speaker: nothing to open'},
  espressoCups: {role: 'decor', cls: 'none', how: 'stack of espresso cups: nothing to open'},
  napPod: {role: 'decor', cls: 'none', how: 'sleep pod: an open shell with a mattress'},
  deadPlant: {role: 'decor', cls: 'none', how: 'potted plant: nothing to open'},
  pottedPlantSmall: {role: 'decor', cls: 'none', how: 'potted plant: nothing to open'},
  planterTree: {role: 'decor', cls: 'none', how: 'planter: nothing to open'},
  officeWhiteboard: {role: 'decor', cls: 'none', how: 'whiteboard on a stand'},
  cubiclePartition: {role: 'decor', cls: 'none', how: 'fabric partition panel'},
  logoWall: {role: 'decor', cls: 'none', how: 'reception logo wall (geometry)'},
  justiceStatue: {role: 'decor', cls: 'none', how: 'statue: nothing to open'},
  bullStatue: {role: 'decor', cls: 'none', how: 'statue: nothing to open'},
  architectModel: {role: 'decor', cls: 'none', how: 'architecture model on a plinth'},
  satelliteModel: {role: 'decor', cls: 'none', how: 'satellite model on a plinth'},
  giantTeddy: {role: 'decor', cls: 'none', how: 'plush toy: nothing to open'},
  rockingHorse: {role: 'decor', cls: 'none', how: 'rocking horse: nothing to open'},
  dressForm: {role: 'decor', cls: 'none', how: 'dress form: nothing to open'},
  catTree: {role: 'decor', cls: 'none', how: 'carpeted cat tree: nothing to open'},
};
const OFFICE_AUDIT_KINDS: ReadonlySet<string> = new Set(Object.keys(OFFICE_OPEN_AUDIT));

/**
 * Covered: 'openable' (this lane), 'existing' (earlier holder with doors / lid / pry: cabinets, crates, vending), 'open' (open
 * shelving / counters / racks / carts whose loot is already reachable — nothing closes them), 'exception' (a usable-looking door,
 * lid or drawer that is deliberately NOT openable, with the honest reason) and 'none' (no door, lid or drawer at all).
 */
export const OPENABLE_AUDIT: readonly AuditEntry[] = [
  // openable (iteration 08, this lane; office kinds: OFFICE_OPEN_AUDIT below)
  ...OPENABLE_KINDS.filter(k => !OFFICE_AUDIT_KINDS.has(k)).map(k => ({kind: k, cls: 'openable' as const, how: describe(k)})),
  // existing holders with moving parts / always-open fronts
  {kind: 'cabinetTall', cls: 'existing', how: 'two doors derived from cabinet-tall-t25r1.glb (Meshy T2.5 + local flat side / top repair, task model-touchups-20261030; door region untouched, split unchanged), shelving insert'},
  {kind: 'cabinetLow', cls: 'existing', how: 'two doors derived from cabinet-low-t25.glb (Meshy T2.5; door split re-measured)'},
  {kind: 'crate', cls: 'existing', how: 'lid derived from crate-t25.glb, hinged at the back; splinters when shot (iteration 06)'},
  {kind: 'vending', cls: 'existing', how: 'front pried open ([E] hold), stock spills out (iteration 03); shot front gives way (06)'},
  {kind: 'fridge', cls: 'existing', how: 'authored staff fridge modelled with its door hanging open (footprint includes the swing): open shelves'},
  {kind: 'gunLocker', cls: 'existing', how: 'authored locker modelled forced open (both doors bent back, in the footprint): open racks'},
  {kind: 'medCabinet', cls: 'existing', how: 'authored first-aid cabinet with its doors gone: open shelves'},
  // open holders (nothing to open)
  ...['shelf', 'stall', 'table', 'shopCounter', 'shopDisplay', 'shopBackbar', 'stockShelf', 'snackRack', 'hotdogCart', 'grillLine', 'espressoBar', 'wokLine', 'deliLine', 'blenderBar', 'shoppingCart', 'busCart', 'wheeledStretcher']
    .map(k => ({kind: k, cls: 'open' as const, how: 'open shelving / worktop / basket: loot already reachable'})),
  // genuine exceptions: a door / lid / drawer that stays closed on purpose
  {kind: 'electricalPanel', cls: 'exception', how: 'live switchgear: locked, hazard-labelled steel doors (not storage)'},
  {kind: 'fareVaultCart', cls: 'exception', how: 'padlocked revenue vault (the padlock is modelled); no tool to force it'},
  {kind: 'wallDataCabinet', cls: 'exception', how: 'keyed network cabinet with cable bundles (equipment, not storage)'},
  {kind: 'ticketMachine', cls: 'exception', how: 'coin / card machine: service door locked, no storage'},
  {kind: 'atmKiosk', cls: 'exception', how: 'cash machine safe: armoured, locked (no cash items in the economy)'},
  {kind: 'cashRegister', cls: 'exception', how: 'till drawer only ever holds cash (no money items); onTop decor'},
  {kind: 'microwaveOven', cls: 'exception', how: 'appliance door (no storage; no appliance simulation)'},
  {kind: 'iceMachine', cls: 'exception', how: 'appliance ice-bin flap (melted ice only)'},
  {kind: 'pizzaOven', cls: 'exception', how: 'appliance oven door (authored front, no storage)'},
  {kind: 'officeCopier', cls: 'exception', how: 'appliance paper trays'},
  {kind: 'popcornMachine', cls: 'exception', how: 'appliance kettle cabinet'},
  {kind: 'ingredientBin', cls: 'exception', how: 'bulk flour bin: its slanted lid hides only flour (no item); light dynamic prop that tips when shot'},
  {kind: 'handToolbox', cls: 'exception', how: 'on-top decor toolbox (cantilever trays not separable in the model; hand tools are not items)'},
  {kind: 'fieldPhoneBox', cls: 'exception', how: 'track telephone: the small door covers a handset, not storage'},
  {kind: 'fireHoseReelCabinet', cls: 'exception', how: 'open-fronted frame: the hose reel is fixed (no door modelled)'},
  {kind: 'keyCabinet', cls: 'exception', how: 'open-fronted key rack (no door modelled); keys are not items'},
  {kind: 'paperTowelDispenser', cls: 'exception', how: 'locked dispenser'},
  {kind: 'rollingSuitcase', cls: 'exception', how: 'standing hard-shell case: no separable lid in the model (it would have to lie down to open); light dynamic prop'},
  {kind: 'wetDryVac', cls: 'exception', how: 'appliance drum lid'},
  {kind: 'waterCooler', cls: 'exception', how: 'appliance (dispenser taps, no cupboard)'},
  {kind: 'cartonStack', cls: 'exception', how: 'sealed, strapped cartons on a pallet (collapse when shot); not searchable'},
  {kind: 'booth', cls: 'exception', how: 'station-agent booth door: structural (part of the booth enclosure)'},
  {kind: 'exitStair', cls: 'exception', how: 'locked street-exit grille: structural'},
  {kind: 'shopShutter', cls: 'exception', how: 'rolled-down shopfront shutter: structural (closed store)'},
  // nothing to open
  ...['bench', 'column', 'fareGate', 'washCounter', 'shopGlazing', 'magazineRack', 'techDisplay', 'deviceWall', 'showcase', 'flowerStand', 'repairBench', 'breadRack',
    'couch', 'noticeBoard', 'janitorCart', 'mopSink', 'signalRack',
    'payphone', 'emergencyCallPoint', 'fareValidatorStand', 'infoTouchKiosk', 'capsuleToyMachine', 'crowdBarrier', 'securityPodium', 'platformClock', 'cctvCamera',
    'shoeShineChair', 'babyStroller', 'bicycle', 'wheelchair', 'trashBagPile', 'foldingBarricade', 'wetFloorSign', 'urinal', 'handDryer',
    'mopBucketWringer', 'floorScrubber', 'floorBuffer', 'handTruck', 'palletJack', 'stepLadder', 'coatRack', 'pedestalFan',
    'mobileWhiteboard', 'paperShredder', 'crtTvCart', 'punchClock', 'officeSwivelChair', 'foldingChair', 'plasticStackChair',
    'dripCoffeeMaker', 'crtTerminal', 'coinCounter', 'newspaperBundles', 'spinnerRack', 'basketStack',
    'bloodPressureKiosk', 'solderingStation', 'keyCuttingMachine', 'deepFryer', 'riceCooker', 'espressoGrinder', 'conveyorToaster', 'sodaFountain', 'slushMachine',
    'hotDogRoller', 'condimentStation', 'meatSlicer', 'standMixer', 'ivPole', 'oxygenCart', 'physicianScale', 'eyewashStation', 'signalHeadSpare',
    'disconnectSwitch', 'dryTransformer', 'benchGrinderStand', 'toolPegboard', 'partsBinRack', 'airCompressor', 'gasCylinderCart', 'tripodWorkLight',
    'portableGenerator', 'drumFan', 'waterPumpSkid', 'waterHeaterTank', 'pipeValveManifold', 'fireExtinguisher']
    .map(k => ({kind: k, cls: 'none' as const, how: 'no door, lid or drawer (fixture / equipment / furniture / open frame)'})),
  // Iteration 16 office kinds + task office-overhaul-20261030 company / supporting kinds (gen/office/kinds.ts OFFICE_KINDS): task
  // office-interactions-layout-20261030 (lane OPEN) classified each one (role, class, reason); the openable ones add their mechanism.
  ...Object.entries(OFFICE_OPEN_AUDIT).map(([kind, e]) => ({kind, cls: e.cls, role: e.role, how: e.cls === 'openable' && isOpenableKind(kind) ? `${e.how}: ${describe(kind)}` : e.how})),
];

function describe(k: OpenableKind): string {
  const s = SPECS[k];
  const p = s.parts[0];
  const mech = p.move.type === 'slide' ? (s.parts.length > 1 ? `${s.parts.length} sliding ${p.region ? 'derived' : 'authored'} ${p.group ? 'panes' : 'drawers'}` : 'slide')
    : `${s.parts.length > 1 ? `${s.parts.length} ` : ''}${p.region ? 'derived' : 'authored'} ${p.move.axis === 'y' ? 'side-hinged door' : 'hinged lid/door'}${s.parts.length > 1 ? 's' : ''}`;
  return `${mech}${s.model ? ` (${s.model})` : ''}${s.loot ? '' : s.shared ? ', existing loot table' : ', fixture contents only'}`;
}
