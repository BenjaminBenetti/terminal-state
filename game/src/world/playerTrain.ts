// Task player-train-shell-20261101-202805 (lane TRAIN): the player's home train in the game — one level-one car PARKED on the start
// platform's track of every station level (Subway / Office / Mall through ONE path: gen/playerTrain.ts playerTrainPlacement, set as
// game.trainPlacement by Game.buildSection before the section hooks). Installs itself through the Game registries (sectionHooks /
// frameHooks / interactHandlers / promptProviders / stateListeners / sectionPreloads / warmRegistry); no other Game code.
//
// ONE train-local object: the view (world/playerTrainView.ts) is built in the train-local frame under one root whose world pose is
// the placement; the collision is a pure function of the spec + that pose (trainColliders). Driving it later = moving the root and
// re-deriving the colliders (remove + re-add the volume, refit the boxes) — nothing here assumes the car never moves, but nothing
// here simulates motion either (no driving, no moving platform physics today).
//
// Collision / walkability (gen/levels.ts DynamicVolume + prop boxes):
//  - the interior is a dynamic volume (floor / ceiling = the car's, shell 0) over the cells under the lining (snapped outward, so
//    the floor never ends short of a wall); its stops = [floor] so the bed band under the car is NOT hidden — the car body encloses
//    it instead: an UNDERFRAME box (bed floor -> car floor over the whole footprint) and WALL boxes (bed floor -> roof) along both
//    sides with the door openings, END walls and the cab PARTITION with its open doorway (and the console). They are prop boxes
//    in game.propIndex (player / enemy collision; rebuilt per build with everything already there, like world/stalls.ts) AND
//    pushed into layout.props (hitscan / melee / the flashlight lure ray and the ragdoll / item statics: bullets stop at the
//    car's walls, floor, roof and closed doors); the door heads / partition header / roof are layout.props only (above the floor
//    they never collide anyway). All are removed again at teardown;
//  - each door opening facing a platform has a GATE whose passage spans the platform gap (the cells between the car and the
//    platform edge), passable while the doors are >= DOOR.gateOpen open: an added band at the car floor bridges the gap. The rest
//    of that gap along the car is closed by low collision-only CURBS (bed floor -> car floor + 5 cm; the 0.5 m gap is narrower
//    than a body anyway) — the same curb fills a door's bridge while its gate is shut — so nobody can sidestep off a bridge or
//    the platform edge into a gap a body cannot stand in (a trap). Far-side doors open onto the bed (a drop, no bridge);
//  - leaves: two prop boxes per doorway (the wall's full thickness) refitted every frame to the sliding leaves.
// Doors (aim + [E], promptProviders '[E] Open doors' / 'Close doors'; no overlay): the pair slides apart into the wall pockets in
// DOOR.time; closing is REFUSED while any living body stands in the doorway or on its bridge, a body stepping in while they close
// RE-OPENS them, and pushing into a shut door for DOOR.pushOpen s opens it — never trapped, never closed on anyone. They start
// shut (the spawn faces the middle platform door, whose prompt shows at once) and keep their state per level for the run.
// Lights that CAST light: created ONCE at install (boot) and kept in the scene — one head SpotLight aimed down the track ahead, one
// red tail SpotLight aimed back, interior PointLights — intensity 0 with no train, moved to the car's mounts per build, intensity
// only otherwise (the light set never changes: docs/rendering-warmup.md). No shadow casters (the flashlight stays the only one),
// bounded distance / decay, not lures (world/lightSources.ts is untouched).
// NOT done here (limits): enemies' path finding ignores volumes (they never path INTO the car; nothing makes it a safe zone).
//
// Task train-shell-followup-20261101-221246 (user playtest: "Interaction highlight is missing on train doors", "you should be able to see
// through the windows", "the rear of the train to also have a little compartment similar to the front"):
//  - the aimed door pair HIGHLIGHTS exactly like an aimed drawer / item (world/highlight.ts: the containers' material swap to a cached
//    cloneSurfaceMaterial clone + the warm emissive pulse), driven by the same aim / reach / occlusion as the prompt, cleared when the
//    aim moves off / out of reach / play stops / the car is torn down; the clones exist (and are warmed) from the build;
//  - SEE-THROUGH windows where lane ASSETS cut the shell / leaf (spec.windows): glass panes (the moving glass lift's clear glass), the
//    interior lining cut out behind them with frame sleeves to the skin, glass in each leaf window sliding with the leaf. Collision is
//    unchanged (the full wall / leaf boxes stay in game.propIndex); for bullets (layout.props) the walls / ends open at the windows and
//    a thin glass box stands at every glass plane, the leaves are their own thickness — a shot stops ON the glass (a glass impact via
//    Game.bulletHitHandlers; the glass does not break);
//  - the REAR compartment (spec.rear): a second partition with the cab's open doorway near the rear end, no console.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {DynamicVolume, Levels, VolumeGate} from '../gen/levels';
import type {PropPlacement} from '../gen/props';
import {PropIndex} from '../core/physics';
import {CELL, STEP_UP} from '../gen/grid';
import type {WarmupRegistry} from '../render/warmup';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec, type TrainDoorSpec} from './playerTrainSpec';
import {RAIL_TOP_ABOVE_BED, playerTrainPlacement, trainToWorld, worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import {TRAIN_GLASS, TRAIN_VIEW, TrainMaterials, buildTrainView, glassSheet, jambOut, leafSpan, noseCorners, nosePane, outerHalf, partitionsOf, rectMinusHoles, viewCost, windowsOf, type TrainGlassData, type TrainModels, type TrainTextures, type TrainView} from './playerTrainView';
import {rayBox, towerCue, type P3} from './towerShared';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PLAYER_TRAIN_MODELS} from '../assets/playerTrain.generated';
import {CHIPPER_MODEL} from './chipperSpec'; // task corpse-chipper (lane ASSET): the chipper joins the car's model catalogue
import {assetUrl} from '../assets/loader';
import {requestSurfaceAnisotropy, type SurfaceRole} from '../render/anisotropy';
import {highlightMaterial, highlightPulse} from './highlight';
import {LOCKBOX_MODEL_KEY, LockboxLid, buildLockboxView, lockboxFootprint, poseLid, type LockboxView} from './trainLockbox';
import {CONSOLE_PROMPT, consoleLocalRect, type ConsoleRect} from './trainConsole'; // task campaign-foundation (lane RIDE): the driving console
import {chipperFootprint, chipperPlacement} from './chipperPlace'; // task corpse-chipper: the train's woodchipper (a fixed component)
import {benchFootprint, benchPlacement} from '../craft/trainFixtures'; // task train-crafting: the crafting bench (a fixed component)
import {TRAIN_EQUIPMENT_MODELS} from '../assets/trainEquipment.generated'; // task train-crafting: the bench, device modules and roof turret join the car's model catalogue
import {saveTerminalPlacement} from './trainSaveTerminalPlace'; // task refinement-batch (lane SAVE): the save terminal left of the desk (a fixed component)

/**
 * Task studio-refinement-batch-20261113-035659-01 (lane SAVE): a car fixture whose aim / prompt / glow / [E] go through THIS runtime's
 * aim (nearest of the doors, the Lockbox, the console and it; the same reach, partitions and occlusion), so the driving desk beside it
 * never takes its [E]. world/trainSaveTerminal.ts sets PlayerTrainRuntime.saveTerminal. All in the CAR frame (parked and riding).
 */
export interface TrainFixtureLink {
  /** The aim box (train-local), null while the fixture is not on the car. */
  aimBox(): {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number} | null;
  /** The meshes that glow while it is aimed (MeshStandardMaterial ones get the highlight clone; others are left as they are). */
  meshes(): THREE.Mesh[];
  /** The look-at prompt while aimed. */
  prompt(): string | null;
  /** [E] while aimed. */
  interact(): void;
}

/**
 * Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the link a MOVING car (world/trainRide.ts) gives the runtime.
 * While it is set the car's pose is the ride's (not the placement): aim / prompts / the Lockbox anchor / cues map through it, the
 * player never "stands in a doorway" (ride mode keeps them inside the closed-door walls), the doors take no [E] / push while
 * `doorsLocked`, and with `holdView` a world teardown keeps the view (+ the boot-time lights) for the next station's build to adopt —
 * one TrainView, never a duplicate. Null = parked: everything exactly as before.
 */
export interface TrainRideLink {
  toWorld(lx: number, ly: number, lz: number): {x: number; y: number; z: number};
  toLocal(wx: number, wy: number, wz: number): {x: number; y: number; z: number};
  /** A world direction in the car frame. */
  dirToLocal(dx: number, dy: number, dz: number): {x: number; y: number; z: number};
  doorsLocked: boolean;
  holdView: boolean;
}

// ---------------------------------------------------------------------------------------------
// Assets (lane ASSETS' cooked files: assets/playerTrain.generated.ts). The models load through the game's lazy prop library (shared by
// every level, fetched behind the loading screen of the first level with a train, kept while levels place one); the Codex interior
// textures through a module cache (shared by every level, never level-scoped).

/** The prop library file map of the train models (game.ts propModels catalogue). Task corpse-chipper (lane ASSET): + the chipper fixture
 *  (world/chipperSpec.ts CHIPPER_MODEL, its own cook: assets/trainChipper.generated.ts) — fetched with the car's other models.
 *  Task train-crafting: + the crafting bench, the three device modules and the sentry's roof turret (assets/trainEquipment.generated.ts):
 *  the bench is a fixture of every car and a device can be crafted at any stop, so they are fetched with the car too. */
export const PLAYER_TRAIN_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> =
  Object.fromEntries([...Object.values(PLAYER_TRAIN_MODELS), CHIPPER_MODEL, ...Object.values(TRAIN_EQUIPMENT_MODELS)].map(m => [m.key, {url: m.url, bytes: m.bytes}]));

/** Game.sectionModelKeys: the train models for a level that parks the car (playerTrainPlacement is pure and memoized per layout). */
export function playerTrainModelKeys(layout: StationLayout): string[] {
  return playerTrainPlacement(layout) ? Object.keys(PLAYER_TRAIN_MODEL_FILES) : [];
}

/** The loaded models from the prop library (missing = the procedural fallback for that part). */
export function trainModelsFrom(lib: {get(key: string): GLTF | undefined}, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): TrainModels {
  return {shell: lib.get(spec.models.shell.key) ?? null, door: lib.get(spec.models.doorLeaf.key) ?? null, console: lib.get(spec.models.console.key) ?? null,
    lockbox: lib.get(LOCKBOX_MODEL_KEY) ?? null, // (task train-lockbox: null until lane ASSETS' cooked model is in the catalogue)
    glass: TRAIN_GLASS ? lib.get(TRAIN_GLASS.key) ?? null : null}; // (task train-window-fit: the conformal glass + reveals)
}

let textureCache: Promise<TrainTextures> | null = null;
/** The Codex interior textures (sRGB; wall repeats along the car, floor / ceiling in 2D, the bulkhead once). Never rejects. */
export function loadTrainTextures(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): Promise<TrainTextures> {
  textureCache ??= (async () => {
    const one = async (url: string, role: SurfaceRole, wrapS: boolean, wrapT: boolean): Promise<THREE.Texture | null> => {
      try {
        const t = await new THREE.TextureLoader().loadAsync(assetUrl(url));
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = wrapS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.wrapT = wrapT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.anisotropy = 4;
        requestSurfaceAnisotropy(t, role);
        t.name = url.split('/').pop() ?? url;
        return t;
      } catch (err) {
        console.warn(`player train: texture ${url} failed`, err);
        return null;
      }
    };
    const T = spec.textures;
    const [wall, floor, ceiling, bulkhead] = await Promise.all([
      one(T.wall, 'wall', true, false), one(T.floor, 'floor', true, true), one(T.ceiling, 'ceiling', true, true), one(T.bulkhead, 'wall', false, false),
    ]);
    return {wall, floor, ceiling, bulkhead};
  })();
  return textureCache;
}

// ---------------------------------------------------------------------------------------------
// Tuning

export const TRAIN_DOOR = {
  /** Full stroke of a leaf pair (s). */
  time: 1.3,
  /** Open fraction from which the doorway (and its platform bridge) is passable. */
  gateOpen: 0.7,
  /** Pushing into a shut door this long opens it (s): standing within pushReach of its leaves, the movement keys aimed into it (cos). */
  pushOpen: 0.7,
  pushReach: 0.12,
  pushAlign: 0.6,
  /** Reach (m, eye to the doorway) for the [E] toggle. */
  reach: 2.2,
  /** The curb top above the car floor (m): a body standing at the floor / the platform cannot step past it into the gap. */
  curbAbove: 0.05,
  /** Seconds between "stand clear" hints. */
  hint: 3,
} as const;

/** Boot-time lights (candela / m / rad). Head + tail are SpotLights; the interior PointLights take `interior.count` of the mounts. */
export const TRAIN_LIGHTS = {
  // (primary, browser A/B pixel check: 60 / 8 / 4.5 left no visible pool beside the 34 cd flashlight; 360 / 160 / 10 cast clearly)
  head: {color: 0xfff1d6, intensity: 360, distance: 32, angle: 0.42, penumbra: 0.55, decay: 1.4, aim: 12, drop: 0.9},
  tail: {color: 0xff2414, intensity: 160, distance: 12, angle: 0.95, penumbra: 0.6, decay: 2, aim: 4, drop: 0.7},
  interior: {color: 0xffd7a3, intensity: 10, distance: 5.5, decay: 2, count: 3},
} as const;

/** The collision boxes' prop kind: an anchored steel structure (damage/materials.ts NEVER('steel'), not dynamic, not a holder). */
const BOX_KIND = 'column' as const;

const ease = (t: number) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------------------------
// Collision: a pure function of the spec + the world pose

export interface DoorCollider {
  index: number;
  door: TrainDoorSpec;
  /** The two leaf boxes [toward local -X, toward +X] (refitted to the leaves): collision, the wall's full thickness. */
  leaves: [PropPlacement, PropPlacement];
  /** Task train-shell-followup: the leaves for hitscan / ragdoll statics (layout.props): the leaf's own thickness, and the glass in
   *  each leaf's window (null: no leaf window) — a bullet stops at the door (its glass) where it is drawn. */
  hitLeaves: [PropPlacement, PropPlacement];
  leafGlass: [PropPlacement, PropPlacement] | null;
  /** The platform bridge (null: no platform within reach on this side — the far side opens onto the bed). */
  gate: VolumeGate | null;
  /** Fills this door's bridge cells while its gate is shut (null without a gate). */
  curb: PropPlacement | null;
  /** Local |z| from which a body is past the doorway on the outside (the platform edge with a bridge, else the outer skin). */
  outZ: number;
}

export interface TrainColliders {
  volume: DynamicVolume;
  /** Grounded static boxes: side walls (with openings), end walls, the partition, the console, the underframe (collision). */
  statics: PropPlacement[];
  /** Task train-shell-followup: what layout.props gets instead of `statics` (hitscan / ragdoll statics): the same boxes, the walls /
   *  ends split around the cut windows, plus a thin box at every window's glass (also in `glass`). */
  shoot: PropPlacement[];
  /** The static window glass boxes (bullets stop there with a glass impact: PlayerTrainRuntime.bulletHit). */
  glass: PropPlacement[];
  /** Hitscan / ragdoll statics only (above the floor: door heads, the partition header, the roof). */
  overhead: PropPlacement[];
  /** Collision-only curbs closing the platform gap beside the car (never in layout.props). */
  curbs: PropPlacement[];
  doors: DoorCollider[];
  bedY: number;
  floorY: number;
  ceilY: number;
  topY: number;
  /** Curb height (bed floor -> car floor + curbAbove). */
  curbH: number;
}

type Pose = Pick<TrainPlacement, 'x' | 'z' | 'railTopY' | 'front' | 'level'> & Partial<Pick<TrainPlacement, 'platformArea' | 'trenchIndex'>>;

/** World AABB (x0, z0, x1, z1) of a train-local rect. */
function worldRect(p: Pose, lx0: number, lx1: number, lz0: number, lz1: number): [number, number, number, number] {
  const a = trainToWorld(p, lx0, 0, lz0), b = trainToWorld(p, lx1, 0, lz1);
  return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
}

function propBox(p: Pose, area: number, lx0: number, lx1: number, lz0: number, lz1: number, y: number, h: number): PropPlacement {
  const [x0, z0, x1, z1] = worldRect(p, Math.min(lx0, lx1), Math.max(lx0, lx1), Math.min(lz0, lz1), Math.max(lz0, lz1));
  return {kind: BOX_KIND, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y, rot: 0, area, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, h, blocksSight: false, variant: 0, level: p.level};
}

/** Re-fit a box in place to a train-local rect (x / z / hx / hz only). */
export function refitBox(b: PropPlacement, p: Pose, lx0: number, lx1: number, lz0: number, lz1: number): void {
  const [x0, z0, x1, z1] = worldRect(p, Math.min(lx0, lx1), Math.max(lx0, lx1), Math.min(lz0, lz1), Math.max(lz0, lz1));
  b.x = (x0 + x1) / 2; b.z = (z0 + z1) / 2; b.hx = (x1 - x0) / 2; b.hz = (z1 - z0) / 2;
}

/** Half thickness of a window glass box (hitscan / ragdoll statics; task train-shell-followup). */
const TRAIN_GLASS_HALF = 0.01;

/** The leaf window's local x span for leaf k of a door at eased open fraction e (the window rect is in the leaf GLB's frame, x centred). */
export function leafWindowSpan(d: TrainDoorSpec, k: 0 | 1, e: number, leafW: number, w: {x0: number; x1: number}): [number, number] {
  const [a, b] = leafSpan(d, k, e, leafW), c = (a + b) / 2;
  return k === 0 ? [c + w.x0, c + w.x1] : [c - w.x1, c - w.x0];
}

const snapLo = (v: number) => Math.floor(v / CELL + 1e-6) * CELL;
const snapHi = (v: number) => Math.ceil(v / CELL - 1e-6) * CELL;

/** Wall spans of one side: [lo, hi] minus the door openings. */
function spans(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let a = lo;
  for (const [c0, c1] of [...cuts].sort((q, r) => q[0] - r[0])) {
    if (c1 <= a || c0 >= hi) continue;
    if (c0 > a + 1e-4) out.push([a, Math.min(c0, hi)]);
    a = Math.max(a, c1);
  }
  if (hi > a + 1e-4) out.push([a, hi]);
  return out;
}

/**
 * The car's colliders at `p`. `levels` (without the car's volume) finds the platform gap beside each door; `consoleRect` = the
 * desk's local footprint + height when its model is placed. Pure: nothing is registered here.
 */
export function trainColliders(spec: PlayerTrainSpec, p: Pose, levels: Levels | null, opt: {bedY?: number; area?: number; consoleRect?: {x0: number; x1: number; z0: number; z1: number; top: number} | null; glass?: TrainGlassData | null} = {}): TrainColliders {
  const hw = spec.interior.halfWidth, out = outerHalf(spec), L2 = spec.length / 2;
  const floorY = p.railTopY + spec.floorY, ceilY = p.railTopY + spec.ceilingY, topY = p.railTopY + spec.roofY;
  const bedY = opt.bedY ?? p.railTopY - RAIL_TOP_ABOVE_BED;
  const area = opt.area ?? p.platformArea ?? -1;
  const H = topY - bedY;
  // --- the interior volume: the lining's footprint, snapped OUTWARD to whole cells ---
  const [ix0, iz0, ix1, iz1] = worldRect(p, spec.interior.x0, spec.interior.x1, -hw, hw);
  const volume: DynamicVolume = {
    x0: snapLo(ix0), z0: snapLo(iz0), x1: snapHi(ix1), z1: snapHi(iz1), floorY, ceilY, level: p.level, area,
    gates: [], stops: [floorY], shell: 0, name: 'player-train',
  };
  // --- statics ---
  const statics: PropPlacement[] = [];
  // hitscan / ragdoll statics: the same boxes with the cut windows open, a thin glass box in each (task train-shell-followup)
  const win = windowsOf(spec), shoot: PropPlacement[] = [], glass: PropPlacement[] = [];
  const G = TRAIN_GLASS_HALF, inset = TRAIN_VIEW.glassInset, glassData = opt.glass === undefined ? TRAIN_GLASS : opt.glass;
  /** A sheet slab (train-local min / max) as a world box. */
  const slab = (b: {min: readonly number[]; max: readonly number[]}) => propBox(p, area, b.min[0], b.max[0], b.min[2], b.max[2], p.railTopY + b.min[1], b.max[1] - b.min[1]);
  for (const side of [-1, 1] as const) {
    const cuts = spec.doors.filter(d => d.side === side).map(d => [d.x - d.width / 2, d.x + d.width / 2] as [number, number]);
    // (the nose corner windows lie inside the end boxes beyond the bulkheads: the end box keeps them; their end panes have glass boxes)
    const sideWins = win.side.filter(w => w.side === side && w.zone !== 'nose');
    const holes = sideWins.map(w => [w.x0, w.x1, p.railTopY + w.y0, p.railTopY + w.y1] as [number, number, number, number]);
    for (const [a, b] of spans(-L2, L2, cuts)) {
      statics.push(propBox(p, area, a, b, side * hw, side * out, bedY, H));
      for (const [x0, x1, y0, y1] of rectMinusHoles(a, b, bedY, topY, holes)) shoot.push(propBox(p, area, x0, x1, side * hw, side * out, y0, y1 - y0));
    }
    for (const w of sideWins) {
      // task train-window-fit: a window with a conformal sheet stops shots on the sheet's own slabs (they follow its curve)
      const q = glassSheet('side', win.side.indexOf(w), glassData);
      if (q && q.boxes.length) { for (const b of q.boxes) glass.push(slab(b)); continue; }
      const zg = side * (w.skinZ - inset);
      glass.push(propBox(p, area, w.x0, w.x1, zg - G, zg + G, p.railTopY + w.y0, w.y1 - w.y0));
    }
  }
  for (const end of [1, -1] as const) {
    const xa = end > 0 ? spec.interior.x1 : -L2, xb = end > 0 ? L2 : spec.interior.x0; // front end (behind the cab's front wall) / rear end
    statics.push(propBox(p, area, xa, xb, -out, out, bedY, H));
    const holes = win.end.filter(w => w.end === end).map(w => [w.z0, w.z1, p.railTopY + w.y0, p.railTopY + w.y1] as [number, number, number, number]);
    // task train-window-fit: the nose corners open the end box too (x-limited), so a shot at a corner from the side meets its glass
    const noses = win.side.filter(w => w.zone === 'nose' && Math.sign(w.x0 + w.x1) === end);
    const xs = [...new Set([xa, xb, ...noses.flatMap(n => [Math.max(xa, Math.min(xb, n.x0)), Math.max(xa, Math.min(xb, n.x1))])])].sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], mid = (x0 + x1) / 2;
      if (x1 - x0 < 1e-4) continue;
      const nh = noses.filter(n => n.x0 < mid && n.x1 > mid).map(n => {
        const [za, zb] = n.side < 0 ? [-out, -n.skinZ] : [n.skinZ, out];
        return [za, zb, p.railTopY + n.y0, p.railTopY + n.y1] as [number, number, number, number];
      });
      for (const [z0, z1, y0, y1] of rectMinusHoles(-out, out, bedY, topY, [...holes, ...nh])) shoot.push(propBox(p, area, x0, x1, z0, z1, y0, y1 - y0));
    }
    win.end.forEach((w, wi) => {
      if (w.end !== end) return;
      const q = glassSheet('end', wi, glassData);
      if (q && q.boxes.length) { for (const b of q.boxes) glass.push(slab(b)); return; }
      const xg = end * (w.skinX - inset);
      glass.push(propBox(p, area, xg - G, xg + G, w.z0, w.z1, p.railTopY + w.y0, w.y1 - w.y0));
      // the flat corner: its side pane (behind the end pane's plane) stops a shot from the side
      for (const n of noseCorners(spec, w)) {
        const np = nosePane(w, n), z = n.side * n.skinZ;
        glass.push(propBox(p, area, np.x0, np.x1, z - G, z + G, p.railTopY + np.y0, np.y1 - np.y0));
      }
    });
  }
  const wallsAndEnds = statics.length;
  // the partitions with their open doorways: the cab's and (task train-shell-followup) the rear compartment's
  const pt = TRAIN_VIEW.partition / 2, parts = partitionsOf(spec);
  for (const {x: px, doorway: dw} of parts) {
    statics.push(propBox(p, area, px - pt, px + pt, -hw, dw.z0, bedY, ceilY - bedY));
    statics.push(propBox(p, area, px - pt, px + pt, dw.z1, hw, bedY, ceilY - bedY));
  }
  const cr = opt.consoleRect;
  if (cr) statics.push(propBox(p, area, cr.x0, cr.x1, cr.z0, cr.z1, bedY, p.railTopY + cr.top - bedY));
  // task train-lockbox: the Lockbox — a solid, anchored box (player / enemy collision, bullets, ragdoll statics) to its closed top
  const lb = spec.lockbox;
  if (lb) { const fp = lockboxFootprint(lb); statics.push(propBox(p, area, fp.x0, fp.x1, fp.z0, fp.z1, bedY, floorY + lb.height - bedY)); }
  // task corpse-chipper: the woodchipper fixed in the +Z bay between the middle and front doors (world/chipperPlace.ts) — solid to its top
  const ch = chipperPlacement(spec);
  if (ch) { const fp = chipperFootprint(ch); statics.push(propBox(p, area, fp.x0, fp.x1, fp.z0, fp.z1, bedY, floorY + ch.height - bedY)); }
  // task train-crafting: the crafting bench in the rear compartment opposite the Lockbox (craft/trainFixtures.ts) — solid to its worktop
  const bn = benchPlacement(spec);
  if (bn) { const fp = benchFootprint(bn); statics.push(propBox(p, area, fp.x0, fp.x1, fp.z0, fp.z1, bedY, floorY + bn.worktopY - bedY)); }
  // task refinement-batch (lane SAVE): the save terminal's wall shelf left of the desk (world/trainSaveTerminalPlace.ts) — solid to its top
  const sv = saveTerminalPlacement(spec);
  if (sv) statics.push(propBox(p, area, sv.box.x0, sv.box.x1, sv.box.z0, sv.box.z1, bedY, p.railTopY + sv.top - bedY));
  statics.push(propBox(p, area, -L2, L2, -out, out, bedY, floorY - bedY)); // underframe: the floor for bullets, the body for the bed
  shoot.push(...statics.slice(wallsAndEnds), ...glass); // partitions, desk, underframe as they are; the window glass
  // --- overhead (layout.props only) ---
  const overhead: PropPlacement[] = [];
  for (const d of spec.doors) {
    const y = floorY + d.height;
    if (topY - y > 1e-3) overhead.push(propBox(p, area, d.x - d.width / 2, d.x + d.width / 2, d.side * hw, d.side * out, y, topY - y));
  }
  for (const {x: px, doorway: dw} of parts) {
    if (ceilY - (floorY + dw.height) > 1e-3) overhead.push(propBox(p, area, px - pt, px + pt, dw.z0, dw.z1, floorY + dw.height, ceilY - floorY - dw.height));
  }
  overhead.push(propBox(p, area, -L2, L2, -out, out, ceilY, topY - ceilY)); // the roof (above the interior ceiling)
  // --- doors: leaves, platform bridges (gates), curbs ---
  const curbH = floorY + TRAIN_DOOR.curbAbove - bedY;
  const curbs: PropPlacement[] = [];
  const doors: DoorCollider[] = [];
  const [bx0, , bx1] = worldRect(p, -L2, L2, 0, 0);
  const platformGap = new Map<-1 | 1, {depth: number; edge: number; dir: 1 | -1}>();
  const gapOf = (side: -1 | 1, wx: number): {depth: number; edge: number; dir: 1 | -1} | null => {
    if (!levels) return null;
    const dirZ = (trainToWorld(p, 0, 0, side).z - p.z) > 0 ? 1 : -1;
    const edge = dirZ > 0 ? volume.z1 : volume.z0;
    for (let k = 0; k < 3; k++) {
      const wz = edge + dirZ * (k + 0.5) * CELL;
      const bands = levels.bands(wx, wz);
      if (bands.some(b => b.floor >= floorY - STEP_UP && b.floor <= floorY + 0.05 && b.ceil >= floorY + 1.8)) return {depth: k * CELL, edge, dir: dirZ};
    }
    return null;
  };
  spec.doors.forEach((d, index) => {
    const lw = leafSpan(d, 0, 0, spec.doorLeaf.width), rw = leafSpan(d, 1, 0, spec.doorLeaf.width);
    const leaves: [PropPlacement, PropPlacement] = [
      propBox(p, area, lw[0], lw[1], d.side * hw, d.side * out, bedY, floorY + d.height - bedY),
      propBox(p, area, rw[0], rw[1], d.side * hw, d.side * out, bedY, floorY + d.height - bedY),
    ];
    const DL = spec.doorLeaf, lz0 = d.side * (DL.outerZ - DL.thickness), lz1 = d.side * DL.outerZ;
    const hitLeaves: [PropPlacement, PropPlacement] = [
      propBox(p, area, lw[0], lw[1], lz0, lz1, floorY, DL.height), propBox(p, area, rw[0], rw[1], lz0, lz1, floorY, DL.height),
    ];
    const lgw = win.leaf;
    const leafGlass: [PropPlacement, PropPlacement] | null = lgw ? [0, 1].map(k => {
      const [a, b] = leafWindowSpan(d, k as 0 | 1, 0, DL.width, lgw);
      return propBox(p, area, a, b, lz0 - d.side * 0.002, lz1 + d.side * 0.002, floorY + lgw.y0, lgw.y1 - lgw.y0);
    }) as [PropPlacement, PropPlacement] : null;
    const [wx0, , wx1] = worldRect(p, d.x - d.width / 2, d.x + d.width / 2, 0, 0);
    const g = gapOf(d.side, (wx0 + wx1) / 2);
    let gate: VolumeGate | null = null, curb: PropPlacement | null = null, outZ = out;
    if (g && g.depth > 0) {
      if (!platformGap.has(d.side)) platformGap.set(d.side, g);
      const a0 = snapLo(wx0), a1 = snapHi(wx1);
      gate = {side: g.dir > 0 ? 'S' : 'N', a0, a1, depth: g.depth, height: d.height, open: false};
      volume.gates.push(gate);
      const zA = g.edge, zB = g.edge + g.dir * g.depth;
      curb = {kind: BOX_KIND, x: (a0 + a1) / 2, z: (zA + zB) / 2, y: bedY, rot: 0, area, hx: (a1 - a0) / 2, hz: Math.abs(zB - zA) / 2, h: curbH, blocksSight: false, variant: 0, level: p.level};
      outZ = Math.abs(worldToTrain(p, 0, 0, zB).z);
    }
    doors.push({index, door: d, leaves, hitLeaves, leafGlass, gate, curb, outZ});
  });
  // the rest of each platform gap along the car body: fixed curbs between the bridges
  for (const [side, g] of platformGap) {
    const bridges = doors.filter(dc => dc.door.side === side && dc.gate).map(dc => [dc.gate!.a0, dc.gate!.a1] as [number, number]);
    const zA = g.edge, zB = g.edge + g.dir * g.depth;
    for (const [a, b] of spans(bx0, bx1, bridges)) {
      curbs.push({kind: BOX_KIND, x: (a + b) / 2, z: (zA + zB) / 2, y: bedY, rot: 0, area, hx: (b - a) / 2, hz: Math.abs(zB - zA) / 2, h: curbH, blocksSight: false, variant: 0, level: p.level});
    }
  }
  return {volume, statics, shoot, glass, overhead, curbs, doors, bedY, floorY, ceilY, topY, curbH};
}

// ---------------------------------------------------------------------------------------------
// Lights (created once at install)

export interface TrainLights {
  head: THREE.SpotLight;
  tail: THREE.SpotLight;
  interior: THREE.PointLight[];
  all: THREE.Light[];
}

export function createTrainLights(): TrainLights {
  const H = TRAIN_LIGHTS.head, T = TRAIN_LIGHTS.tail, I = TRAIN_LIGHTS.interior;
  const head = new THREE.SpotLight(H.color, 0, H.distance, H.angle, H.penumbra, H.decay);
  head.name = 'player-train-head';
  const tail = new THREE.SpotLight(T.color, 0, T.distance, T.angle, T.penumbra, T.decay);
  tail.name = 'player-train-tail';
  head.target.name = 'player-train-head-target';
  tail.target.name = 'player-train-tail-target';
  const interior: THREE.PointLight[] = [];
  for (let i = 0; i < I.count; i++) {
    const l = new THREE.PointLight(I.color, 0, I.distance, I.decay);
    l.name = `player-train-interior-${i}`;
    interior.push(l);
  }
  const all: THREE.Light[] = [head, tail, ...interior];
  for (const l of all) { l.castShadow = false; l.position.set(0, -1000, 0); }
  return {head, tail, interior, all};
}

/** The interior light mounts used by `count` lights: spread over the spec's mounts (first / last / evenly between). */
export function interiorLightMounts(spec: PlayerTrainSpec, count: number = TRAIN_LIGHTS.interior.count): {x: number; y: number; z: number}[] {
  const m = [...spec.lights.interior].sort((a, b) => a.x - b.x);
  if (!m.length) return [];
  if (count <= 1 || m.length === 1) return Array.from({length: Math.max(0, count)}, (_, i) => m[Math.min(m.length - 1, i)]);
  return Array.from({length: count}, (_, i) => m[Math.round((i * (m.length - 1)) / (count - 1))]);
}

const avg = (pts: readonly {x: number; y: number; z: number}[], fb: {x: number; y: number; z: number}) =>
  pts.length ? {x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length, z: pts.reduce((s, q) => s + q.z, 0) / pts.length} : fb;

// ---------------------------------------------------------------------------------------------
// Runtime

/** What the train needs from Game (structural: tests drive it with a fake host). */
export interface TrainHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; z: number; y: number; vx: number; vz: number; radius: number; alive: boolean; yaw?: number};
  /** Held keys (push-open reads the movement keys; Game.input). */
  input?: {down(code: string): boolean};
  /** Task train-shell-followup: bullet hits offered before the damage system (Game.bulletHitHandlers) + the impact effects. */
  bulletHitHandlers?: ((wh: never, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[];
  fx?: {impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'glass', opts?: {decal?: boolean; chips?: number}): void};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[];
  levels: Levels;
  layout: StationLayout;
  propIndex: PropIndex;
  /** gen/playerTrain.ts playerTrainPlacement(layout), set by Game.buildSection before the section hooks (null: no train here). */
  trainPlacement?: TrainPlacement | null;
  sfx: unknown;
  hud: {toast(text: string, warn?: boolean): void};
  warmRegistry: WarmupRegistry;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  physics?: {propsChanged?(x: number, z: number): void};
  interactHandlers: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  state: string;
  world?: {culler?: unknown} | null;
  run?: {current: {level: string; section: string}};
}

export interface TrainOptions {
  spec?: PlayerTrainSpec;
  /** The cooked models, read at build time (preloaded through the prop model library; missing = procedural fallbacks). */
  models?: () => TrainModels;
  /** Fetches the Codex interior textures once (awaited as a bounded section preload; failures = plain paint). */
  textures?: () => Promise<TrainTextures>;
  /** Longest wait for the textures before a build (then plain paint for that level). */
  textureWaitMs?: number;
}

export interface DoorRt {
  col: DoorCollider;
  /** Open fraction (0 shut .. 1 open) and where it is going. */
  t: number;
  target: 0 | 1;
  /** A living body stands in the doorway / on its bridge (this frame). */
  blocked: boolean;
  playerBlocks: boolean;
  /** Push-open timer (s). */
  push: number;
  moving: boolean;
  /** The open fraction the leaves / boxes / gate were last fitted to. */
  shown: number;
}

export interface BuiltTrain {
  placement: TrainPlacement;
  view: TrainView;
  col: TrainColliders;
  doors: DoorRt[];
  levels: Levels;
  layout: StationLayout;
  /** Every box pushed into layout.props (removed at teardown). */
  layoutBoxes: PropPlacement[];
  /** game.propIndex before this build (restored at teardown). */
  prevIndex: PropIndex;
  key: string;
}

export class PlayerTrainRuntime {
  readonly spec: PlayerTrainSpec;
  train: BuiltTrain | null = null;
  readonly lights: TrainLights;
  /** The doorway under the crosshair (within reach, unobstructed) + its prompt. */
  target: DoorRt | null = null;
  prompt: string | null = null;
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, teardowns: 0, toggles: 0, opened: 0, closed: 0, refused: 0, reopen: 0, pushOpen: 0, glassHits: 0, lockbox: 0, console: 0, save: 0};
  private readonly mats = new TrainMaterials();
  private textures: TrainTextures = {};
  private texturesLoading: Promise<void> | null = null;
  /** Door targets per level / section for this run (restored on the next build of it). */
  private memory = new WeakMap<object, Map<string, (0 | 1)[]>>();
  private readonly memoryFallback = {};
  private hintT = 1e9;
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly box = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};
  private readonly nearBodies: {x: number; y: number; z: number; stats: {radius: number}}[] = [];
  /**
   * Task train-shell-followup-20261101-221246 (lane TRAIN): the aimed door pair glows exactly like an aimed drawer / item
   * (world/highlight.ts: the containers' material swap + pulse). The door it is on, and the highlight clones per leaf base material.
   */
  highlighted: DoorRt | null = null;
  /** What glows: a door pair, the Lockbox, (lane RIDE) the driving console, (lane SAVE) the save terminal, or nothing. */
  private hiOwner: DoorRt | 'lockbox' | 'console' | 'save' | null = null;
  /** Task refinement-batch (lane SAVE): the save terminal (world/trainSaveTerminal.ts; null: none — no aim, no prompt). */
  saveTerminal: TrainFixtureLink | null = null;
  /** The save terminal is under the crosshair right now (within reach, unobstructed, nearer than the desk / doors / Lockbox). */
  saveAimed = false;
  // ---- task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the driving console + the moving car ----
  /** [E] on the aimed driving console (the primary opens the campaign map). Null: the console is not an interactable (no prompt). */
  onConsoleInteract: (() => void) | null = null;
  /** The console is under the crosshair right now (within reach, unobstructed). */
  consoleAimed = false;
  /** The desk's measured train-local box (from the placed model; null without the model: trainConsole.ts dims stand in). */
  consoleRect: ConsoleRect | null = null;
  /** The moving car's link (world/trainRide.ts); null while parked. */
  ride: TrainRideLink | null = null;
  /** A build while riding skipped the culler registration: the ride registers the car when it parks. */
  cullerPending = false;
  /** A view kept through a teardown while the ride holds it (the next build adopts it: one TrainView). */
  private heldView: {view: TrainView; lockboxView: LockboxView | null; lockboxLid: LockboxLid} | null = null;
  private readonly hiMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  // ---- task train-lockbox-windows-20261101-232156 (lane TRAIN): the Lockbox world object (world/trainLockbox.ts) — API for lane BOX ----
  /** Called on [E] while the Lockbox is aimed (closed or open): lane BOX opens its LOCKBOX_SLOTS view. Null: [E] just toggles the lid. */
  onLockboxInteract: (() => void) | null = null;
  /** The Lockbox is under the crosshair right now (within reach, unobstructed: the doors' aim rules). */
  lockboxAimed = false;
  /** The built Lockbox view (null: no train / no spec.lockbox) and its lid state. */
  lockboxView: LockboxView | null = null;
  lockboxLid = new LockboxLid();
  private time = 0;
  /** Task train-shell-followup: the glass boxes of the built car (windows + leaf windows) — a bullet stopping on one is a glass hit. */
  private glassBoxes = new Set<PropPlacement>();

  constructor(readonly host: TrainHost, readonly opts: TrainOptions = {}) {
    this.spec = opts.spec ?? PLAYER_TRAIN_SPEC;
    this.lights = createTrainLights();
  }

  /** Registers every hook and adds the boot-time lights to the scene (called once from the Game constructor). */
  install(): this {
    const h = this.host;
    for (const l of this.lights.all) h.scene.add(l);
    h.scene.add(this.lights.head.target, this.lights.tail.target);
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.interact());
    h.bulletHitHandlers?.push((wh, point, dir) => this.bulletHit(wh, point, dir)); // task train-shell-followup: bullets on the window glass
    h.promptProviders?.push(() => this.prompt);
    h.stateListeners?.push(((state: string) => { if (state !== 'playing') { this.target = null; this.prompt = null; this.setHighlight(null); } }) as (state: never, prev: never) => void);
    h.warmRegistry.addPool('player-train', () => (this.train ? [this.train.view.root] : []));
    const wait = this.opts.textureWaitMs ?? 8000;
    h.sectionPreloads?.push(() => Promise.race([this.preloadTextures(), new Promise<void>(r => setTimeout(r, wait))]));
    return this;
  }

  /**
   * Task train-shell-followup-20261101-221246: a bullet / pellet ray stopped on the car's window glass (a thin box at every window's
   * glass plane, door-leaf windows included): the glass impact — chips, a mark, the glass sound — instead of the steel the car's other
   * boxes take (the office windows' route, world/gas/system.ts). The glass does not break (no breakable train glass is implied).
   */
  bulletHit(wh: {kind: string; prop?: number; nx: number; ny: number; nz: number}, point: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (!this.train || wh.kind !== 'prop' || wh.prop === undefined) return false;
    const box = this.host.layout.props[wh.prop];
    if (!box || !this.glassBoxes.has(box)) return false;
    const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
    if (n.lengthSq() < 1e-6 || n.dot(dir) > 0) n.copy(dir).negate();
    this.host.fx?.impact(point, n.normalize(), 'glass', {decal: true, chips: 1});
    this.host.sfx && (this.host.sfx as {impact?(x: number, y: number, z: number, s: string): void}).impact?.(point.x, point.y, point.z, 'glass');
    this.counts.glassHits++;
    return true;
  }

  /** Task first-player-onboarding: a layout.props box of this car that is see-through window glass (sight lines pass it). */
  isGlass(box: PropPlacement | undefined): boolean {
    return !!box && this.glassBoxes.has(box);
  }

  /** Fetches the interior textures once (never rejects). */
  preloadTextures(): Promise<void> {
    if (!this.opts.textures) return Promise.resolve();
    this.texturesLoading ??= this.opts.textures().then(t => { this.textures = t ?? {}; }, err => { console.warn('player train: interior textures unavailable', err); });
    return this.texturesLoading;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle (once per built level; synchronous: the player is placed inside before the first update)

  build(): void {
    if (this.train) this.teardown();
    const h = this.host, p = h.trainPlacement ?? null;
    if (!p || !h.levels || !h.layout) { this.lightsOff(); return; }
    const spec = this.spec;
    const models = this.opts.models?.() ?? {};
    // (lane RIDE) the car the player rides in IS this station's car: a view held through the last teardown is adopted, not rebuilt
    const held = this.heldView;
    this.heldView = null;
    const view = held ? held.view : buildTrainView(spec, this.mats, models, this.textures);
    // task train-lockbox: the Lockbox in the rear compartment (the model when cooked, else its placeholder; never a crash)
    this.lockboxLid = held ? held.lockboxLid : new LockboxLid();
    this.lockboxView = held ? held.lockboxView : spec.lockbox ? buildLockboxView(spec.lockbox, spec.floorY, this.mats, models.lockbox ?? null) : null;
    if (this.lockboxView && !held) { view.root.add(this.lockboxView.group); view.geometries.push(...this.lockboxView.geometries); }
    const root = view.root;
    root.position.set(p.x, p.railTopY, p.z);
    root.rotation.set(0, p.yaw, 0);
    root.updateMatrixWorld(true);
    // the desk's footprint from the placed model (local), so it collides as drawn
    let consoleRect: {x0: number; x1: number; z0: number; z1: number; top: number} | null = null;
    const desk = view.fixed.getObjectByName('train-console');
    if (desk) {
      // setFromObject is in world space: back to the train frame through the root (exact: the yaw is 0 / PI)
      const bb = new THREE.Box3().setFromObject(desk).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
      consoleRect = {x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z, top: bb.max.y};
    }
    this.consoleRect = consoleRect; // (lane RIDE: the console's aim box and the ride's local collision use the same desk box)
    const bedY = h.layout.trenches?.[p.trenchIndex]?.floorY;
    // (the conformal glass's slabs are measured for the cooked car's own windows: a custom spec keeps the flat glass boxes)
    const col = trainColliders(spec, p, h.levels, {bedY: Number.isFinite(bedY) ? bedY : undefined, consoleRect, glass: spec.windows === PLAYER_TRAIN_SPEC.windows ? TRAIN_GLASS : null});
    // 1. the walkable interior (support / headroom / rays inside), the platform bridges
    h.levels.addDynamicVolume(col.volume);
    // 2. hitscan / physics statics: walls, floor, roof, partition, console, door leaves
    const leafBoxes = col.doors.flatMap(d => d.leaves);
    const layoutBoxes = [...col.shoot, ...col.overhead, ...col.doors.flatMap(d => [...d.hitLeaves, ...(d.leafGlass ?? [])])];
    this.glassBoxes = new Set([...col.glass, ...col.doors.flatMap(d => d.leafGlass ?? [])]);
    h.layout.props.push(...layoutBoxes);
    // 3. collision: everything already in the index (stalls etc.) + the car's grounded boxes. The leaves are bucketed over their
    //    whole travel (pocket to pocket) and refitted every frame (world/stalls.ts pattern)
    const prevIndex = h.propIndex;
    const mine = new Set<PropPlacement>(layoutBoxes);
    const base = prevIndex ? prevIndex.props.filter(q => !mine.has(q)) : h.layout.props.filter(q => !mine.has(q));
    const doors: DoorRt[] = col.doors.map(dc => ({col: dc, t: 0, target: 0, blocked: false, playerBlocks: false, push: 0, moving: false, shown: NaN}));
    for (const d of doors) {
      const dd = d.col.door, hw = spec.interior.halfWidth, out = outerHalf(spec);
      const [a0] = leafSpan(dd, 0, 1, spec.doorLeaf.width), [, b1] = leafSpan(dd, 1, 1, spec.doorLeaf.width);
      for (const b of d.col.leaves) refitBox(b, p, a0, b1, dd.side * hw, dd.side * out);
    }
    const curbs = [...col.curbs, ...col.doors.map(d => d.curb).filter((c): c is PropPlacement => !!c)];
    h.propIndex = new PropIndex(h.levels, [...base, ...col.statics, ...leafBoxes, ...curbs]);
    // 4. the view: in the scene, storey-culled (static parts; the leaves move), torch shadows
    view.root.traverse(x => { if ((x as THREE.Mesh).isMesh) x.userData.level = p.level; });
    h.scene.add(root);
    h.atmosphere?.markShadows(view.fixed, true);
    for (const pair of view.leaves) for (const l of pair) h.atmosphere?.markShadows(l, false);
    if (this.lockboxView) h.atmosphere?.markShadows(this.lockboxView.group, false); // (the lid moves: not culler-registered either)
    const culler = h.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    // (lane RIDE) a car still driving in is never storey / fog culled by its parked box: the ride registers it when it stops
    if (culler && typeof culler.register === 'function') { if (!this.ride) culler.register(view.fixed); else this.cullerPending = true; }
    const key = this.sectionKey();
    this.train = {placement: p, view, col, doors, levels: h.levels, layout: h.layout, layoutBoxes, prevIndex, key};
    // 5. door states remembered for this level in this run (else shut), applied at once; (lane RIDE) an arriving car's doors stay
    //    shut until the player opens them
    const saved = held || this.ride ? undefined : this.memFor().get(key);
    doors.forEach((d, i) => { d.target = saved?.[i] ?? 0; d.t = d.target; });
    this.applyDoors(0, true);
    this.prepareHighlight(view);
    // 6. the lights at the car's mounts
    this.placeLights(p);
    // physics: the statics chunks under the car are rebuilt lazily from layout.props (the volume add also clears them)
    for (let x = col.volume.x0 - 2; x <= col.volume.x1 + 2; x += 4) for (const z of [col.volume.z0 - 1, (col.volume.z0 + col.volume.z1) / 2, col.volume.z1 + 1]) h.physics?.propsChanged?.(x, z);
    this.counts.builds++;
  }

  teardown(): void {
    this.setHighlight(null); // the leaves (and the Lockbox) get their own materials back before the view goes
    const t = this.train;
    // (lane RIDE) the riding car leaves with the player: its view, Lockbox and lights stay in the scene for the next build to adopt
    const keep = !!t && !!this.ride?.holdView;
    if (keep) this.heldView = {view: t!.view, lockboxView: this.lockboxView, lockboxLid: this.lockboxLid};
    this.train = null;
    if (!keep) this.lockboxView = null;
    this.lockboxAimed = false;
    this.consoleAimed = false;
    this.saveAimed = false;
    this.target = null;
    this.prompt = null;
    if (!keep) this.lightsOff();
    if (!t) return;
    this.memFor().set(t.key, t.doors.map(d => d.target));
    this.glassBoxes = new Set();
    t.levels.removeDynamicVolume(t.col.volume);
    const mine = new Set(t.layoutBoxes);
    const props = t.layout.props;
    for (let i = props.length - 1; i >= 0; i--) if (mine.has(props[i])) props.splice(i, 1);
    if (this.host.propIndex !== t.prevIndex && this.host.layout === t.layout) this.host.propIndex = t.prevIndex;
    if (!keep) {
      this.host.scene.remove(t.view.root);
      for (const g of t.view.geometries) g.dispose();
    }
    this.counts.teardowns++;
  }

  /** (lane RIDE) The car's view right now: the built train's, or the one held through a teardown while riding (null: none). */
  get view(): TrainView | null {
    return this.train?.view ?? this.heldView?.view ?? null;
  }

  /** (lane RIDE) Drop a held view for good (the ride was reset with no station to adopt it): removed and disposed. */
  releaseHeldView(): void {
    const v = this.heldView;
    this.heldView = null;
    if (!v) return;
    if (this.lockboxView === v.lockboxView) this.lockboxView = null;
    this.host.scene.remove(v.view.root);
    for (const g of v.view.geometries) g.dispose();
    this.lightsOff();
  }

  private memFor(): Map<string, (0 | 1)[]> {
    const owner = (this.host.run as object | undefined) ?? this.memoryFallback;
    let m = this.memory.get(owner);
    if (!m) this.memory.set(owner, (m = new Map()));
    return m;
  }

  /** NewGame: forget every remembered door state (a fresh run). */
  resetMemory(): void {
    this.memory = new WeakMap();
  }

  private sectionKey(): string {
    const c = this.host.run?.current;
    return c ? `${c.level}:${c.section}` : `seed:${(this.host.layout as {seed?: number}).seed ?? 0}`;
  }

  // -------------------------------------------------------------------------------------------
  // Lights

  private placeLights(p: TrainPlacement): void {
    this.placeLightsBy(q => trainToWorld(p, q.x, q.y, q.z));
  }

  /**
   * The boot-time lights at the car's mounts through a train-local -> world map (the placement, or lane RIDE's moving car pose every
   * frame): positions / targets / intensities only — the light set never changes.
   */
  placeLightsBy(w: (q: {x: number; y: number; z: number}) => {x: number; y: number; z: number}): void {
    const s = this.spec, L = this.lights, H = TRAIN_LIGHTS.head, T = TRAIN_LIGHTS.tail, I = TRAIN_LIGHTS.interior;
    const head = avg(s.lights.head, {x: s.length / 2, y: s.floorY + 0.6, z: 0});
    const tail = avg(s.lights.tail, {x: -s.length / 2, y: s.floorY + 0.6, z: 0});
    const at = (o: THREE.Object3D, q: {x: number; y: number; z: number}) => { const v = w(q); o.position.set(v.x, v.y, v.z); o.updateMatrixWorld(); };
    at(L.head, {x: head.x + 0.05, y: head.y, z: head.z});
    at(L.head.target, {x: head.x + H.aim, y: head.y - H.drop, z: head.z});
    at(L.tail, {x: tail.x - 0.05, y: tail.y, z: tail.z});
    at(L.tail.target, {x: tail.x - T.aim, y: tail.y - T.drop, z: tail.z});
    L.head.intensity = H.intensity;
    L.tail.intensity = T.intensity;
    const mounts = interiorLightMounts(s, L.interior.length);
    L.interior.forEach((l, i) => {
      const m = mounts[i];
      if (!m) { l.intensity = 0; return; }
      at(l, {x: m.x, y: m.y - 0.12, z: m.z});
      l.intensity = I.intensity;
    });
  }

  private lightsOff(): void {
    for (const l of this.lights.all) l.intensity = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Per frame: doors (sense, logic, leaves, colliders, gates) and the targeted doorway

  frame(dt: number): void {
    const t = this.train;
    // (lane RIDE) between two stations the riding car has no built train, but its Lockbox / console stay usable (aim in the car frame)
    const riding = !t && !!this.ride && !!this.heldView;
    if (!t && !riding) { this.prompt = null; return; }
    this.hintT += dt;
    this.time += dt;
    if (t) this.applyDoors(dt, false);
    this.stepLockbox(dt);
    this.updateTarget();
    if (this.hiOwner) highlightPulse(this.hiMats.values(), this.time);
  }

  /** Bodies in each doorway, the door logic, then leaves / boxes / gates / curbs follow. */
  private applyDoors(dt: number, snap: boolean): void {
    const t = this.train!, h = this.host, p = t.placement, spec = this.spec;
    const hw = spec.interior.halfWidth, out = outerHalf(spec);
    const P = h.player;
    // bodies near the car only (a cheap reject before the per-door tests)
    const near = (x: number, z: number) => Math.abs(x - p.x) < spec.length / 2 + 2 && Math.abs(z - p.z) < spec.width + 2;
    const playerNear = P.alive && near(P.x, P.z);
    const bodies = this.nearBodies;
    bodies.length = 0;
    for (const z of h.zombies) { const b = z.brain; if (b.alive && !z.ragdolled && near(b.x, b.z)) bodies.push(b); }
    let moved = false;
    for (const d of t.doors) {
      const dd = d.col.door;
      // --- sense: a living body whose circle reaches the leaves' path, or standing on the bridge ---
      const inDoor = (x: number, y: number, z: number, r: number): boolean => {
        if (Math.abs(y - t.col.floorY) > 1.0) return false;
        const q = worldToTrain(p, x, y, z), s = q.z * dd.side;
        return Math.abs(q.x - dd.x) < dd.width / 2 + r - 0.05 && s > hw - r && s < Math.max(out + r, d.col.outZ);
      };
      d.playerBlocks = playerNear && !this.ride && inDoor(P.x, P.y, P.z, P.radius); // (lane RIDE: a riding player is inside the closed-door walls)
      let blocked = d.playerBlocks;
      if (!blocked) for (const b of bodies) if (inDoor(b.x, b.y, b.z, b.stats.radius)) { blocked = true; break; }
      d.blocked = blocked;
      // --- logic: never close on a body; push into a shut door to open it ---
      if (!snap) {
        if (d.target === 0 && d.t > 0 && blocked) {
          d.target = 1;
          this.counts.reopen++;
          this.cue(d, 'reopen');
          if (d.playerBlocks) this.hint('Stand clear of the doors');
        }
        if (d.target === 0 && d.t < 0.02 && playerNear && !this.ride?.doorsLocked && this.pushing(d)) {
          d.push += dt;
          if (d.push >= TRAIN_DOOR.pushOpen) { d.push = 0; d.target = 1; this.counts.pushOpen++; this.counts.opened++; this.cue(d, 'opening'); }
        } else d.push = 0;
        const was = d.t;
        const step = dt / TRAIN_DOOR.time;
        if (d.target > d.t) d.t = Math.min(1, d.t + step);
        else if (d.target < d.t) d.t = Math.max(0, d.t - step);
        const moving = d.t !== was;
        if (moving !== d.moving) {
          d.moving = moving;
          const c = trainToWorld(p, dd.x, 0, dd.side * out);
          h.physics?.propsChanged?.(c.x, c.z); // the ragdoll / item statics re-read the leaf boxes
          if (!moving) this.cue(d, d.t >= 1 ? 'opened' : 'closed');
        }
      }
      // --- follow: leaves (view + boxes), gate, curb (only when the leaves moved) ---
      if (!snap && d.t === d.shown) continue;
      d.shown = d.t;
      const e = ease(d.t);
      const pair = t.view.leaves[d.col.index];
      for (const k of [0, 1] as const) {
        const [a, b] = leafSpan(dd, k, e, spec.doorLeaf.width);
        if (pair?.[k]) pair[k].position.x = (a + b) / 2;
        refitBox(d.col.leaves[k], p, a, b, dd.side * hw, dd.side * out);
        const DL = spec.doorLeaf, lz0 = dd.side * (DL.outerZ - DL.thickness), lz1 = dd.side * DL.outerZ;
        refitBox(d.col.hitLeaves[k], p, a, b, lz0, lz1);
        const lg = d.col.leafGlass, lw = windowsOf(spec).leaf;
        if (lg && lw) { const [ga, gb] = leafWindowSpan(dd, k, e, DL.width, lw); refitBox(lg[k], p, ga, gb, lz0 - dd.side * 0.002, lz1 + dd.side * 0.002); }
      }
      moved = true;
      const open = e >= TRAIN_DOOR.gateOpen;
      if (d.col.gate) d.col.gate.open = open;
      if (d.col.curb) d.col.curb.h = open ? 0 : t.col.curbH;
    }
    if (moved) t.view.syncLeafGlass(); // the leaf-window glass instances follow the leaves
  }

  /**
   * The player presses into this shut door: standing against its leaves (inside or outside, within the opening) with the movement
   * keys pushing toward them (the body's velocity is zero against the leaf, so the intent is read from the keys + yaw as
   * player/player.ts moves). Without an input (tests' bare hosts) nothing is pushed.
   */
  private pushing(d: DoorRt): boolean {
    const t = this.train!, h = this.host, P = h.player, p = t.placement, dd = d.col.door, inp = h.input;
    if (!inp || Math.abs(P.y - t.col.floorY) > 0.6) return false;
    const q = worldToTrain(p, P.x, P.y, P.z), s = q.z * dd.side;
    if (Math.abs(q.x - dd.x) > dd.width / 2 - 0.1) return false;
    // against the leaves from inside (the leaf boxes fill the wall: hw .. out), or from outside against the closed bridge's curb
    const hw = this.spec.interior.halfWidth, out = outerHalf(this.spec), plane = (hw + out) / 2;
    const reach = P.radius + TRAIN_DOOR.pushReach;
    if (s < hw - reach || s > Math.max(out, d.col.outZ) + reach) return false;
    let fx = 0, fz = 0;
    if (inp.down('KeyW') || inp.down('ArrowUp')) fz -= 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) fz += 1;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) fx -= 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len === 0) return false;
    const sy = Math.sin(P.yaw ?? 0), cy = Math.cos(P.yaw ?? 0);
    const wz = (-fx * sy + fz * cy) / len; // world wish direction (z), as player/player.ts
    const toward = (s < plane ? 1 : -1) * wz * p.front * dd.side; // local z of the wish (front = the frame's z sign), + = into the leaves
    return toward > TRAIN_DOOR.pushAlign;
  }

  private hint(text: string): void {
    if (this.hintT < TRAIN_DOOR.hint) return;
    this.hintT = 0;
    this.host.hud.toast(text);
  }

  private cue(d: DoorRt, what: 'opening' | 'closing' | 'opened' | 'closed' | 'reopen' | 'refused'): void {
    const t = this.train;
    if (!t) return;
    const dd = d.col.door, c = this.carPoint(dd.x, this.spec.floorY + 1.2, dd.side * outerHalf(this.spec))!;
    const at: P3 = {x: c.x, y: c.y, z: c.z};
    const sfx = this.host.sfx;
    switch (what) {
      // existing Sound Lab cues only (no new audio): a metal cabinet slide pitched down, the closing clunk
      case 'opening': case 'reopen': towerCue(sfx, 'cabinetOpen', at, {rate: 0.62, gain: 0.85}); break;
      case 'closing': towerCue(sfx, 'cabinetOpen', at, {rate: 0.55, gain: 0.7}); break;
      case 'closed': towerCue(sfx, 'cabinetClose', at, {rate: 0.6, gain: 0.9}); break;
      case 'opened': towerCue(sfx, 'clank', at, {rate: 0.9, gain: 0.25}); break;
      case 'refused': (sfx as {denied?(): void} | null)?.denied?.(); break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // [E]: aim at a doorway (its leaves / opening, either face) within reach, nothing structural in between

  /** The doorway under the crosshair (null: none within reach / blocked, or the Lockbox is nearer). */
  pickDoor(): DoorRt | null {
    return this.pickAim().door;
  }

  /**
   * What the crosshair is on: the nearest of every doorway's aim box and (task train-lockbox) the Lockbox's closed box, within reach,
   * with nothing structural in between. At most one of the two is set.
   */
  pickAim(): {door: DoorRt | null; lockbox: boolean; console: boolean; save: boolean} {
    const none = {door: null, lockbox: false, console: false, save: false};
    const t = this.train, h = this.host, ride = this.ride;
    if ((!t && !(ride && this.heldView)) || !h.player.alive) return none;
    // (lane RIDE) everything is tested in the CAR frame: the placement's (parked; exact for yaw 0 / PI) or the moving car's (riding)
    const P = h.player, pl = this.carLocal(P.x, P.y, P.z)!;
    if (Math.abs(pl.x) > this.spec.length / 2 + TRAIN_DOOR.reach + 1 || Math.abs(pl.z) > this.spec.width / 2 + TRAIN_DOOR.reach + 2) return none;
    const cam = h.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.vEye); cam.getWorldDirection(this.vDir);
    const weye: P3 = {x: this.vEye.x, y: this.vEye.y, z: this.vEye.z}, wdir: P3 = {x: this.vDir.x, y: this.vDir.y, z: this.vDir.z};
    const eye = this.carLocal(weye.x, weye.y, weye.z)!, dir = this.carDir(wdir.x, wdir.y, wdir.z)!;
    const hw = this.spec.interior.halfWidth, jo = jambOut(this.spec), fy = this.spec.floorY, b = this.box;
    const setBox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      b.min.x = x0; b.min.y = y0; b.min.z = z0; b.max.x = x1; b.max.y = y1; b.max.z = z1;
    };
    let best: DoorRt | null = null, bt: number = TRAIN_DOOR.reach;
    // (lane RIDE) locked doors (closing up / moving) are no target: no prompt, no [E]
    if (t && !ride?.doorsLocked) for (const d of t.doors) {
      const dd = d.col.door;
      const za = dd.side * (hw - 0.03), zb = dd.side * (jo + 0.02);
      setBox(dd.x - dd.width / 2, dd.x + dd.width / 2, fy, fy + dd.height, Math.min(za, zb), Math.max(za, zb));
      const hit = rayBox(eye, dir, b as never, bt);
      if (hit !== null && hit < bt) { bt = hit; best = d; }
    }
    let lockbox = false, desk = false;
    const lb = this.spec.lockbox;
    if (lb && this.lockboxView) {
      const fp = lockboxFootprint(lb);
      setBox(fp.x0, fp.x1, fy, fy + lb.height, fp.z0, fp.z1);
      const hit = rayBox(eye, dir, b as never, bt);
      if (hit !== null && hit < bt) { bt = hit; best = null; lockbox = true; }
    }
    // (lane RIDE) the driving console in the front cab (only while the primary's map is wired)
    if (this.onConsoleInteract) {
      const cr = consoleLocalRect(this.spec, this.consoleRect);
      setBox(cr.x0, cr.x1, fy, cr.top, cr.z0, cr.z1);
      const hit = rayBox(eye, dir, b as never, bt);
      if (hit !== null && hit < bt) { bt = hit; best = null; lockbox = false; desk = true; }
    }
    // (lane SAVE) the save terminal left of the desk: the nearer of it and the desk wins (one [E], one prompt, one glow)
    let save = false;
    const sb = this.saveTerminal?.aimBox() ?? null;
    if (sb) {
      setBox(sb.x0, sb.x1, sb.y0, sb.y1, sb.z0, sb.z1);
      const hit = rayBox(eye, dir, b as never, bt);
      if (hit !== null && hit < bt) { bt = hit; best = null; lockbox = false; desk = false; save = true; }
    }
    if (!best && !lockbox && !desk && !save) return none;
    // nothing structural in between: the partitions (their walls + doorway heads; the open doorway passes) for the Lockbox / console /
    // save terminal, and (parked) the station's levels as before
    if ((lockbox || desk || save) && this.partitionBlocks(eye, dir, bt)) return none;
    if (!ride && t) {
      const blocked = h.levels.raycast(weye, wdir, bt + 0.02);
      if (blocked.kind !== 'none' && blocked.t < bt - 0.01) return none;
    }
    return {door: best, lockbox, console: desk, save};
  }

  /** (lane RIDE) A car-frame ray meets a partition wall / doorway head before `maxT`. */
  private partitionBlocks(eye: P3, dir: P3, maxT: number): boolean {
    const s = this.spec, hw = s.interior.halfWidth, pt = TRAIN_VIEW.partition / 2, fy = s.floorY, b = this.box;
    for (const {x, doorway: dw} of partitionsOf(s)) {
      for (const [z0, z1, y0, y1] of [[-hw, dw.z0, fy, s.ceilingY], [dw.z1, hw, fy, s.ceilingY], [dw.z0, dw.z1, fy + dw.height, s.ceilingY]]) {
        b.min.x = x - pt; b.max.x = x + pt; b.min.y = y0; b.max.y = y1; b.min.z = z0; b.max.z = z1;
        const hit = rayBox(eye, dir, b as never, maxT);
        if (hit !== null && hit < maxT - 0.01) return true;
      }
    }
    return false;
  }

  /** (lane RIDE) World -> the car frame: the moving car's pose while riding, else the placement (null: no car). */
  carLocal(wx: number, wy: number, wz: number): P3 | null {
    if (this.ride) return this.ride.toLocal(wx, wy, wz);
    const t = this.train;
    return t ? worldToTrain(t.placement, wx, wy, wz) : null;
  }

  /** (lane RIDE) A world direction in the car frame (exact for the parked yaws). */
  carDir(dx: number, dy: number, dz: number): P3 | null {
    if (this.ride) return this.ride.dirToLocal(dx, dy, dz);
    const t = this.train;
    return t ? {x: dx * t.placement.front, y: dy, z: dz * t.placement.front} : null;
  }

  /** (lane RIDE) The car frame -> world: the moving car's pose while riding, else the placement (null: no car). */
  carPoint(lx: number, ly: number, lz: number): P3 | null {
    if (this.ride) return this.ride.toWorld(lx, ly, lz);
    const t = this.train;
    return t ? trainToWorld(t.placement, lx, ly, lz) : null;
  }

  private updateTarget(): void {
    const r = this.host.state === 'playing' ? this.pickAim() : {door: null, lockbox: false, console: false, save: false};
    this.target = r.door;
    this.lockboxAimed = r.lockbox;
    this.consoleAimed = r.console;
    this.saveAimed = r.save;
    this.prompt = r.door ? this.promptFor(r.door) : r.lockbox ? this.lockboxPrompt() : r.console ? CONSOLE_PROMPT : r.save ? this.saveTerminal?.prompt() ?? null : null;
    this.setHighlightOwner(r.door ?? (r.lockbox ? 'lockbox' : r.console ? 'console' : r.save ? 'save' : null)); // the glow follows the prompt (same aim / reach / occlusion)
  }

  // -------------------------------------------------------------------------------------------
  // The aimed door pair's highlight (world/containers.ts setHighlight style)

  /** The opaque meshes of a door pair's two leaves (the leaf windows' glass never glows). */
  leafMeshes(d: DoorRt): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const holder of this.train?.view.leaves[d.col.index] ?? []) holder.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.trainGlass && !m.userData.highlightPrototype) out.push(m);
    });
    return out;
  }

  /** Swap the aimed pair's leaf materials for their highlight clones (restoring the previous pair's own). */
  setHighlight(d: DoorRt | null): void {
    this.setHighlightOwner(d);
  }

  /** The meshes that glow for a highlight owner. */
  private ownerMeshes(o: DoorRt | 'lockbox' | 'console' | 'save'): THREE.Mesh[] {
    return o === 'lockbox' ? (this.lockboxView?.highlight ?? []) : o === 'console' ? this.consoleMeshes() : o === 'save' ? (this.saveTerminal?.meshes() ?? []) : this.leafMeshes(o);
  }

  /** (lane RIDE) The driving desk's meshes (the cooked console model; none without it). */
  consoleMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.view?.fixed.getObjectByName('train-console')?.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.highlightPrototype) out.push(m);
    });
    return out;
  }

  /** Swap the aimed thing's (a door pair's / the Lockbox's / the console's) materials for their highlight clones, restoring the previous one's own. */
  private setHighlightOwner(o: DoorRt | 'lockbox' | 'console' | 'save' | null): void {
    if (o === this.hiOwner) return;
    if (this.hiOwner && (this.train || this.heldView)) for (const m of this.ownerMeshes(this.hiOwner)) m.material = (m.userData.baseMat as THREE.Material | undefined) ?? m.material;
    this.hiOwner = o;
    this.highlighted = o && o !== 'lockbox' && o !== 'console' && o !== 'save' ? o : null;
    if (!o) return;
    for (const m of this.ownerMeshes(o)) {
      const base = (m.userData.baseMat as THREE.Material | undefined) ?? (m.material as THREE.Material);
      m.userData.baseMat = base;
      const hi = highlightMaterial(this.hiMats, base);
      if (hi) m.material = hi;
    }
    highlightPulse(this.hiMats.values(), this.time);
  }

  /**
   * Build time: the highlight clones of this car's leaf materials exist before the warm-up (a hidden prototype per clone under the
   * warmed root compiles it on the loading screen, not on the first aim); clones of materials no longer used are released.
   */
  private prepareHighlight(view: TrainView): void {
    // (lane RIDE) an adopted view already carries the previous build's prototypes: drop them first (never accumulate)
    for (const c of [...view.root.children]) if (c.userData.highlightPrototype) view.root.remove(c);
    const bases = new Map<THREE.Material, THREE.Mesh>();
    for (const pair of view.leaves) for (const holder of pair) holder.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.trainGlass && !Array.isArray(m.material) && !bases.has(m.material)) bases.set(m.material, m);
    });
    for (const m of this.lockboxView?.highlight ?? []) if (!Array.isArray(m.material) && !bases.has(m.material)) bases.set(m.material, m); // (task train-lockbox)
    view.fixed.getObjectByName('train-console')?.traverse(o => { // (lane RIDE) the driving console glows like the Lockbox
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && !bases.has((m.userData.baseMat as THREE.Material | undefined) ?? m.material)) bases.set((m.userData.baseMat as THREE.Material | undefined) ?? m.material, m);
    });
    for (const m of this.saveTerminal?.meshes() ?? []) { // (lane SAVE) the save terminal glows like the console
      const base = (m.userData.baseMat as THREE.Material | undefined) ?? m.material;
      if (!Array.isArray(base) && !bases.has(base as THREE.Material)) bases.set(base as THREE.Material, m);
    }
    for (const [base, hi] of [...this.hiMats]) if (!bases.has(base)) { hi.dispose(); this.hiMats.delete(base); }
    for (const [base, mesh] of bases) {
      const hi = highlightMaterial(this.hiMats, base);
      if (!hi) continue;
      for (const mirror of [1, -1]) { // the +X leaves are mirrored (a reversed front face is its own pipeline)
        const proto = new THREE.Mesh(mesh.geometry, hi);
        proto.name = 'train-door-highlight-prototype';
        proto.visible = false;
        proto.scale.x = mirror;
        proto.userData.highlightPrototype = true;
        proto.userData.level = this.train?.placement.level ?? 0;
        proto.raycast = () => {};
        view.root.add(proto);
      }
    }
  }

  promptFor(d: DoorRt): string {
    if (d.target === 1) return d.blocked ? '<b>[E]</b> Close doors · stand clear' : '<b>[E]</b> Close doors';
    return '<b>[E]</b> Open doors';
  }

  /** E handler (Game.interactHandlers): toggles the aimed doorway; true when the train handled the key. */
  interact(): boolean {
    if ((!this.train && !(this.ride && this.heldView)) || this.host.state !== 'playing') return false;
    const r = this.pickAim();
    if (r.lockbox) { this.lockboxInteract(); return true; }
    if (r.console) { this.consoleInteract(); return true; } // (lane RIDE)
    if (r.save && this.saveTerminal) { this.counts.save++; this.saveTerminal.interact(); return true; } // (lane SAVE)
    if (!r.door) return false;
    this.toggle(r.door);
    return true;
  }

  /** (lane RIDE) [E] on the aimed driving console: the primary's map (no-op while unwired: the console is then no target). */
  consoleInteract(): void {
    if (!this.onConsoleInteract) return;
    this.counts.console++;
    this.onConsoleInteract();
  }

  // -------------------------------------------------------------------------------------------
  // Task train-lockbox-windows-20261101-232156: the Lockbox (the world object; lane BOX owns its LOCKBOX_SLOTS slots and its view)

  private lockboxPrompt(): string {
    return this.lockboxLid.target === 0 ? '<b>[E]</b> Open Lockbox' : '<b>[E]</b> Close Lockbox'; // open lid = the view is open (E closes it)
  }

  /** [E] on the aimed Lockbox: lane BOX's handler (it opens its view and sets the lid), else the lid toggles. */
  lockboxInteract(): void {
    if (!this.lockboxView) return;
    this.counts.lockbox++;
    if (this.onLockboxInteract) this.onLockboxInteract();
    else this.setLockboxOpen(this.lockboxLid.target === 0);
  }

  /** The lid's target (lane BOX: open while its view is open, shut when closed / walked away from). No-op without a Lockbox. */
  setLockboxOpen(open: boolean): void {
    if (this.lockboxView) this.lockboxLid.target = open ? 1 : 0;
  }

  /** World centre of the Lockbox's closed top (lane BOX's walk-away check), or null without one. */
  lockboxWorld(): {x: number; y: number; z: number} | null {
    const lb = this.spec.lockbox;
    if (!lb || !this.lockboxView) return null;
    return this.carPoint(lb.x, this.spec.floorY + lb.height, lb.z); // (lane RIDE: where the car IS while it moves)
  }

  /** The lid follows its target (smoothstep), with the existing cabinet cues. */
  private stepLockbox(dt: number): void {
    const v = this.lockboxView, lb = this.spec.lockbox;
    if (!v || !lb || (!this.train && !this.ride)) return;
    const ev = this.lockboxLid.step(dt);
    if (ev === null && !this.lockboxLid.moving) return;
    poseLid(v, lb, this.lockboxLid.eased);
    if (ev === 'opening' || ev === 'closed') {
      const c = this.carPoint(lb.x, this.spec.floorY + lb.height, lb.z)!;
      towerCue(this.host.sfx, ev === 'opening' ? 'cabinetOpen' : 'cabinetClose', {x: c.x, y: c.y, z: c.z}, {rate: ev === 'opening' ? 0.85 : 0.8, gain: 0.8});
    }
  }

  /** Toggle through the door rules (what a real press does): closing is refused while a body is in the doorway. */
  toggle(d: DoorRt): 'opening' | 'closing' | 'refused' {
    this.counts.toggles++;
    if (d.target === 1) {
      if (d.blocked) {
        this.counts.refused++;
        this.cue(d, 'refused');
        this.hintT = TRAIN_DOOR.hint;
        this.hint('Stand clear of the doors');
        return 'refused';
      }
      d.target = 0;
      this.counts.closed++;
      this.cue(d, 'closing');
      return 'closing';
    }
    d.target = 1;
    this.counts.opened++;
    this.cue(d, 'opening');
    return 'opening';
  }

  // -------------------------------------------------------------------------------------------
  // QA / tests

  /** The player stands inside the car's interior volume. */
  playerInside(): boolean {
    const P = this.host.player, q = this.carLocal(P.x, P.y, P.z), s = this.spec; // (lane RIDE: the moving car's frame while riding)
    if (!q) return false;
    return P.alive && q.x > s.interior.x0 && q.x < s.interior.x1 && Math.abs(q.z) < s.interior.halfWidth && Math.abs(q.y - s.floorY) < 0.3;
  }

  /** QA: set a door's target by index (through the rules: a refused close returns 'refused'); null = no such door. */
  setDoor(i: number, open: boolean): 'opening' | 'closing' | 'refused' | 'unchanged' | null {
    const d = this.train?.doors[i];
    if (!d) return null;
    if ((d.target === 1) === open) return 'unchanged';
    return this.toggle(d);
  }

  /** QA readout (__LL.train()). */
  qa() {
    const t = this.train, L = this.lights;
    const light = (l: THREE.Light) => ({name: l.name, intensity: +l.intensity.toFixed(2), at: [+l.position.x.toFixed(2), +l.position.y.toFixed(2), +l.position.z.toFixed(2)]});
    return {
      built: !!t,
      placement: t ? {level: t.placement.level, x: +t.placement.x.toFixed(2), z: +t.placement.z.toFixed(2), yaw: t.placement.yaw, front: t.placement.front, floorY: +t.col.floorY.toFixed(3), platformEdgeZ: t.placement.platformEdgeZ} : null,
      provisionalSpec: this.spec.provisional,
      source: t?.view.source ?? null,
      cost: t ? viewCost(t.view.root) : null,
      volume: t ? {x0: t.col.volume.x0, z0: t.col.volume.z0, x1: t.col.volume.x1, z1: t.col.volume.z1, floorY: +t.col.volume.floorY.toFixed(3), ceilY: +t.col.volume.ceilY.toFixed(3), gates: t.col.volume.gates.length} : null,
      doors: t?.doors.map((d, i) => ({i, side: d.col.door.side, x: d.col.door.x, t: +d.t.toFixed(2), target: d.target, gate: d.col.gate ? {open: d.col.gate.open, depth: d.col.gate.depth} : null, blocked: d.blocked})) ?? [],
      target: t && this.target ? t.doors.indexOf(this.target) : null,
      // task train-shell-followup: the glowing door pair, the rear compartment, the see-through windows
      highlighted: t && this.highlighted ? t.doors.indexOf(this.highlighted) : null,
      // task train-lockbox: the Lockbox world object (lane BOX holds its contents)
      lockbox: this.spec.lockbox && t ? {
        source: this.lockboxView?.source ?? null, aimed: this.lockboxAimed, lid: +this.lockboxLid.t.toFixed(2), target: this.lockboxLid.target,
        world: this.lockboxWorld(), handler: !!this.onLockboxInteract, size: [this.spec.lockbox.length, this.spec.lockbox.height, this.spec.lockbox.depth],
        at: {x: this.spec.lockbox.x, z: this.spec.lockbox.z},
      } : null,
      // (lane RIDE) the driving console (aim box in the car frame, wired = the primary's map) and the moving-car link
      console: {aimed: this.consoleAimed, wired: !!this.onConsoleInteract, measured: !!this.consoleRect, box: consoleLocalRect(this.spec, this.consoleRect)},
      saveTerminal: {aimed: this.saveAimed, linked: !!this.saveTerminal, box: this.saveTerminal?.aimBox() ?? null}, // (lane SAVE)
      riding: !!this.ride, heldView: !!this.heldView,
      rear: this.spec.rear ?? null,
      windows: (() => { const w = windowsOf(this.spec); return {side: w.side.length, end: w.end.length, leaf: !!w.leaf, glassBoxes: this.glassBoxes.size}; })(),
      prompt: this.prompt,
      playerInside: this.playerInside(),
      lights: {head: light(L.head), tail: light(L.tail), interior: L.interior.map(light)},
      boxes: t ? {statics: t.col.statics.length, overhead: t.col.overhead.length, curbs: t.col.curbs.length, layoutProps: t.layoutBoxes.length} : null,
      counts: {...this.counts},
    };
  }
}

/** Installs the player train runtime into a Game (one call in the Game constructor, after the other lanes). */
export function installPlayerTrain(host: TrainHost, opts: TrainOptions = {}): PlayerTrainRuntime {
  return new PlayerTrainRuntime(host, opts).install();
}

/** QA hooks (spread into window.__LL) for the primary's short serial browser spot check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trainQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {trainRuntime?: PlayerTrainRuntime; player: {x: number; z: number; y: number; yaw: number; pitch: number; vy: number; grounded: boolean}};
  const rt = () => g.trainRuntime ?? null;
  /** Stand inside `back` m from door i (on its axis, in the car) facing it. */
  const faceDoor = (i: number, back = 1.1): boolean => {
    const r = rt(), t = r?.train, d = t?.doors[i];
    if (!r || !t || !d) return false;
    const dd = d.col.door, s = r.spec, inside = dd.side * Math.max(0.2, s.interior.halfWidth - back);
    const at = trainToWorld(t.placement, dd.x, s.floorY, inside), door = trainToWorld(t.placement, dd.x, s.floorY + 1.2, dd.side * s.interior.halfWidth);
    const P = g.player;
    P.x = at.x; P.z = at.z; P.y = at.y; P.vy = 0; P.grounded = true;
    P.yaw = Math.atan2(-(door.x - at.x), -(door.z - at.z));
    P.pitch = -0.12;
    return true;
  };
  return {
    /** The train: placement, volume, doors (t / target / gate / blocked), lights (intensity + position), cost, counts. */
    train: () => rt()?.qa() ?? null,
    /** Open / close door i through the door rules (no aim); returns 'opening' | 'closing' | 'refused' | 'unchanged' | null. */
    trainDoor: (i: number, open = true) => rt()?.setDoor(i, open) ?? null,
    /** Stand inside facing door i (default: the middle platform-side door) — the [E] prompt shows on the next frame. */
    trainFaceDoor: (i?: number, back = 1.1) => {
      const t = rt()?.train;
      if (!t) return false;
      let k = i ?? -1;
      if (k < 0) for (let j = 0; j < t.doors.length; j++) {
        const dd = t.doors[j].col.door;
        if (dd.side < 0 && (k < 0 || Math.abs(dd.x) < Math.abs(t.doors[k].col.door.x))) k = j;
      }
      return k >= 0 && faceDoor(k, back);
    },
    /** The light intensities (the light set never changes: same objects in every level). */
    trainLights: () => rt()?.qa().lights ?? null,
    /**
     * Task train-shell-followup-20261101-221246: stand in the cab facing the windshield ('cab'), in the rear compartment facing the
     * rear windows ('rear'), or back at the start pose facing the middle platform door ('spawn'). False without a train.
     */
    trainGo: (where: 'cab' | 'rear' | 'spawn' | 'lockbox' = 'cab') => {
      const r = rt(), t = r?.train;
      if (!r || !t) return false;
      const s = r.spec, P = g.player, end = where === 'rear' ? -1 : 1;
      if (where === 'lockbox') {
        // task train-lockbox: in the rear compartment's aisle, ~0.9 m in front of the Lockbox, looking at its lid's front edge
        const lb = s.lockbox;
        if (!lb) return false;
        const fp = lockboxFootprint(lb), front = fp.z0, at = trainToWorld(t.placement, lb.x, s.floorY, front - 0.9);
        const aim = trainToWorld(t.placement, lb.x, s.floorY + lb.height * 0.8, front);
        P.x = at.x; P.z = at.z; P.y = at.y; P.vy = 0; P.grounded = true;
        P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
        P.pitch = Math.atan2(aim.y - (at.y + 1.62), Math.hypot(aim.x - at.x, aim.z - at.z));
        return true;
      }
      if (where === 'spawn') {
        let k = -1;
        for (let j = 0; j < t.doors.length; j++) { const dd = t.doors[j].col.door; if (dd.side < 0 && (k < 0 || Math.abs(dd.x) < Math.abs(t.doors[k].col.door.x))) k = j; }
        return k >= 0 && faceDoor(k, 1.15);
      }
      const lx = where === 'rear' ? ((s.rear?.x0 ?? s.interior.x0) + (s.rear?.x1 ?? s.interior.x0 + 1)) / 2 : (s.cab.x0 + 0.45);
      const at = trainToWorld(t.placement, lx, s.floorY, 0), ahead = trainToWorld(t.placement, lx + end * 4, s.floorY + 2.4, 0);
      P.x = at.x; P.z = at.z; P.y = at.y; P.vy = 0; P.grounded = true;
      P.yaw = Math.atan2(-(ahead.x - at.x), -(ahead.z - at.z));
      P.pitch = 0.08;
      return true;
    },
  };
}
