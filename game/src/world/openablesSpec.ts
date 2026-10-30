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

// Lane AMMO (knife-melee-20261030): ammo rows are GENERIC — the table's ammo weight split ~1/3 each over the calibers (the rows
// live in items/lootTables.ts, built with items/calibers.ts genericAmmo).
import {COMPANY_KIND_AUDIT} from '../gen/office/companyKinds'; // Task office-overhaul-20261030 (lane TENANTS): audit rows
import {OPENABLE_TABLES, type ItemRows, type OwnTable} from '../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)

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
} as const satisfies Record<string, OpenableSpec>;

export type OpenableKind = keyof typeof OPENABLE_SPECS;
export const OPENABLE_KINDS = Object.keys(OPENABLE_SPECS) as OpenableKind[];
const SPECS = OPENABLE_SPECS as Readonly<Record<string, OpenableSpec>>;
export function isOpenableKind(kind: string): kind is OpenableKind { return kind in SPECS; }
export function openableSpec(kind: string): OpenableSpec | null { return SPECS[kind] ?? null; }

/** New container kinds (not loot holders before iteration 08): items/loot.ts ContainerKind additions. */
export const OPENABLE_CONTAINER_KINDS = ['bin', 'wheelieBin', 'newspaperVendingBox', 'staffLockers', 'filingCabinet', 'safe', 'chestFreezer', 'firstAidWallKit', 'fireExtinguisherCabinet', 'aedWallCabinet',
  'toiletStall'] as const; // task office-overhaul-20261030 (lane INTERACT): washroom cubicles
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
export interface AuditEntry { kind: string; cls: AuditClass; how: string }

/**
 * Covered: 'openable' (this lane), 'existing' (earlier holder with doors / lid / pry: cabinets, crates, vending), 'open' (open
 * shelving / counters / racks / carts whose loot is already reachable — nothing closes them), 'exception' (a usable-looking door,
 * lid or drawer that is deliberately NOT openable, with the honest reason) and 'none' (no door, lid or drawer at all).
 */
export const OPENABLE_AUDIT: readonly AuditEntry[] = [
  // openable (iteration 08, this lane)
  ...OPENABLE_KINDS.map(k => ({kind: k, cls: 'openable' as const, how: describe(k)})),
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
  // Iteration 16 (WORLD-GEN office kinds, gen/office/kinds.ts): one fused Meshy mesh each, not loot holders
  {kind: 'officeFiling', cls: 'exception', how: 'lateral filing cabinet: one fused mesh, no separable drawers (the openable filingCabinet is the searchable one)'},
  {kind: 'receptionDesk', cls: 'exception', how: 'reception counter: one fused mesh with no separable drawers; decor only'},
  {kind: 'serverRack', cls: 'exception', how: 'server rack front door: one fused mesh; equipment, nothing to search'},
  {kind: 'officePhotocopier', cls: 'exception', how: 'copier paper trays: appliance, one fused mesh'},
  ...['officeChair', 'officeMonitor', 'officeWaterCooler', 'conferenceTable', 'deadPlant', 'officeWhiteboard', 'officeShelf', 'cubiclePartition']
    .map(k => ({kind: k, cls: 'none' as const, how: 'no door, lid or drawer (office furniture / equipment / open shelving)'})),
  // Task office-overhaul-20261030 (lane TENANTS): company / supporting office kinds (gen/office/companyKinds.ts), none a holder.
  ...COMPANY_KIND_AUDIT,
];

function describe(k: OpenableKind): string {
  const s = SPECS[k];
  const p = s.parts[0];
  const mech = p.move.type === 'slide' ? (s.parts.length > 1 ? `${s.parts.length} sliding ${p.region ? 'derived' : 'authored'} ${p.group ? 'panes' : 'drawers'}` : 'slide')
    : `${s.parts.length > 1 ? `${s.parts.length} ` : ''}${p.region ? 'derived' : 'authored'} ${p.move.axis === 'y' ? 'side-hinged door' : 'hinged lid/door'}${s.parts.length > 1 ? 's' : ''}`;
  return `${mech}${s.model ? ` (${s.model})` : ''}${s.loot ? '' : s.shared ? ', existing loot table' : ', fixture contents only'}`;
}
