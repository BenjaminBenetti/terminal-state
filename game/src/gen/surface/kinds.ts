// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane KIT): the SURFACE RUN district's own street / checkpoint / wreck PROP
// KINDS — one registry, spread into every shared table by one tagged line each (gen/props.ts PropKind + PROP_DEFS, damage/materials.ts
// PROP_DAMAGE, damage/physicsAudit.ts PROP_PHYSICS_AUDIT, world/openablesSpec.ts OPENABLE_AUDIT; the crate's openable spec / loot table
// in world/openablesSpec.ts + items/lootTables.ts). Pure data (no three.js). Placed by lanes GEN (streets, checkpoint, wrecks) and ROOMS
// (interiors); drawn by world/surface/kit.ts (procedural parts, gen/surface/kitMesh.ts) and the lazy library (wreck models).
//
// The NAMES and the PropDef boxes below are the published contract (front +Z, w along X, d along Z, origin bottom centre, metres).
// Classified for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md):
//  - rule 1: the only storage is the lidded military crate (srMilitaryCrate): a real openable (authored lid on a back hinge) whose finite
//    contents come from the loot foundation (items/lootTables.ts MILITARY_SUPPLY_ROWS, an ADDITIVE own table). Nothing else reads as
//    storage (the radio's case, the hydrant's caps, the lamp's hand-hole cover are sealed equipment: OPEN audit rows below);
//  - rule 2: the light loose kinds are dynamic contact bodies (cone 3.2 kg, radio 7 kg on its host, cot 9 kg); the heavy / anchored ones
//    are static with an honest reason (SURFACE_PHYS);
//  - rule 4: nothing loose is part of any kind (the radio's handset is on its cord; the cot has no bedding; the map table is bare —
//    lane LIFE draws the dynamic map onto its top);
//  - rule 5: SURFACE_SCALE (scale-check renders beside the runtime-scaled zombie, viewed).
// Wrecks reuse EXISTING models only (no generation): the Skyways street wrecks (assets/skywaysProps.generated.ts, user-supplied community
// Meshy sources, provenance in assets/derivatives/) and the Office's car / bus wrecks (assets/officeAssets.ts). Their boxes are the
// models' MEASURED runtime bounds (w = length along X, nose +X): instanced at scale 1 by the builder's non-uniform fit.

import type {PropDef} from '../props';
import type {DamageClass, PhysMat, StaticWhy} from '../../damage/materials';
import {SKYWAYS_PROP_MODELS} from '../../assets/skywaysProps.generated';

export const SURFACE_STREET_KINDS = ['srSandbagWall', 'srJerseyBarrier', 'srTrafficCone', 'srFireHydrant', 'srStreetLamp', 'srTrafficSignal', 'srStreetSign',
  'srChainFence', 'srBollard'] as const;
export const SURFACE_CHECKPOINT_KINDS = ['srMapTable', 'srFieldRadio', 'srCot', 'srMilitaryCrate'] as const;
export const SURFACE_WRECK_KINDS = ['srWreckSedanStripped', 'srWreckSedanRust', 'srWreckSedanBurnt', 'srWreckSuv', 'srWreckArmyTruck', 'srWreckCar', 'srWreckBus'] as const;
export const SURFACE_KINDS = [...SURFACE_STREET_KINDS, ...SURFACE_CHECKPOINT_KINDS, ...SURFACE_WRECK_KINDS] as const;
export type SurfaceWreckKind = (typeof SURFACE_WRECK_KINDS)[number];
export type SurfaceKind = (typeof SURFACE_KINDS)[number];
/** The procedurally drawn kinds (gen/surface/kitMesh.ts): everything but the wrecks (models) and the crate (world/openables.ts draws it). */
export type SurfaceDrawnKind = Exclude<SurfaceKind, SurfaceWreckKind | 'srMilitaryCrate'>;

const KIND_SET: ReadonlySet<string> = new Set(SURFACE_KINDS);
const WRECK_SET: ReadonlySet<string> = new Set(SURFACE_WRECK_KINDS);
export const isSurfaceKind = (k: string): k is SurfaceKind => KIND_SET.has(k);
export const isSurfaceWreckKind = (k: string): k is SurfaceWreckKind => WRECK_SET.has(k);
export const isSurfaceDrawnKind = (k: string): k is SurfaceDrawnKind => KIND_SET.has(k) && !WRECK_SET.has(k) && k !== 'srMilitaryCrate';

// ---------------------------------------------------------------------------------------------------------------------------
// Shapes the other lanes read (prop frame, metres)

/**
 * The checkpoint's planning-map table: a plywood top on two welded steel trestles. `top` = its bare work surface (prop frame) — lane LIFE
 * lays its code-drawn dynamic map there (a quad at y = top.y + ~2 mm over x0..x1 / z0..z1) and adds the [E] read; the reader stands at
 * the +Z (front) long side.
 */
export const SR_MAP_TABLE = {w: 2.0, d: 1.2, h: 0.95, topT: 0.028, top: {y: 0.95, x0: -0.98, x1: 0.98, z0: -0.58, z1: 0.58}} as const;
/**
 * The military crate (holder-local, closed pose): footprint w x d (rope grips / brackets included), carcass bodyW x bodyD on three battens
 * (`skid` high), board `wall` thickness, the lid (`lidT`, hinged on the back top edge, opens toward -Z), the compartment floor.
 */
export const SR_CRATE = {w: 1.2, d: 0.6, h: 0.55, bodyW: 1.14, bodyD: 0.564, skid: 0.05, wall: 0.022, lidT: 0.05, floorY: 0.075} as const;
/**
 * Street-sign variants: blade A (along the placement's local X, faces +-Z) names street `a`, blade B (along local Z, 15 cm higher) street
 * `b` — SurfaceStreet ids in layout.surface.streets. GEN encodes them with srStreetSignVariant; the builder draws the names at runtime
 * (world/surface/kit.ts: a code-drawn dynamic atlas, root CLAUDE.md dynamic-text exemption).
 */
export const SR_SIGN = {w: 0.3, d: 0.3, h: 3.0, bladeL: 0.76, bladeH: 0.152, bladeT: 0.012, bladeAY: 2.62, bladeBY: 2.79, poleR: 0.03} as const;
const SIGN_SPAN = 4096;
/** Street-sign variant for blade A naming street `a` and (optional) blade B naming street `b`. */
export const srStreetSignVariant = (a: number, b?: number): number => (a + 1) + (b === undefined || b < 0 ? 0 : (b + 1) * SIGN_SPAN);
/** The street ids a street-sign variant names (-1 = none). */
export const srStreetSignStreets = (variant: number): {a: number; b: number} => ({a: (variant % SIGN_SPAN) - 1, b: Math.floor(variant / SIGN_SPAN) - 1});

// ---------------------------------------------------------------------------------------------------------------------------
// Wreck models (existing files only)

/** A wreck kind's lazy library key, its file, cooked size (bytes; the catalogue) and measured runtime bounds (w along X = length, nose +X). */
export interface SurfaceWreckModel { key: string; url: string; bytes: number; w: number; h: number; d: number; tris: number; source: string }
const sky = (id: keyof typeof SKYWAYS_PROP_MODELS, bytes: number): SurfaceWreckModel => {
  const m = SKYWAYS_PROP_MODELS[id];
  return {key: m.url.replace(/^assets\/models\//, '').replace(/\.glb$/, ''), url: m.url, bytes, w: m.w, h: m.h, d: m.d, tris: m.tris, source: `assets/skywaysProps.generated.ts ${id}`};
};
/**
 * The wreck kinds' models. Skyways rows: SKYWAYS_PROP_MODELS (bytes = the cooked GLB sizes; tests/surface-kinds.test.ts checks them
 * against the files). Office rows: assets/officeAssets.ts OFFICE_ASSETS car-wreck / bus-wreck (library keys office-<id>, already in the
 * catalogue; dims copied here — this module stays three-free — and checked against OFFICE_ASSETS by the same test).
 */
export const SURFACE_WRECK_MODEL: Readonly<Record<SurfaceWreckKind, SurfaceWreckModel>> = {
  srWreckSedanStripped: sky('skyways_wreck_sedan_stripped', 570260),
  srWreckSedanRust: sky('skyways_wreck_sedan_rust', 1240512),
  srWreckSedanBurnt: sky('skyways_wreck_sedan_burnt', 1444400),
  srWreckSuv: sky('skyways_wreck_suv', 1102820),
  srWreckArmyTruck: sky('skyways_wreck_army_truck', 958140),
  srWreckCar: {key: 'office-car-wreck', url: 'assets/models/office-car-wreck.glb', bytes: 831852, w: 4.6, h: 1.3055, d: 1.7809, tris: 7762, source: 'assets/officeAssets.ts car-wreck'},
  srWreckBus: {key: 'office-bus-wreck', url: 'assets/models/office-bus-wreck.glb', bytes: 757148, w: 12, h: 4.3417, d: 3.7612, tris: 9565, source: 'assets/officeAssets.ts bus-wreck'},
};
/** Lazy library files the Surface kit adds (game.ts propModels catalogue): the Skyways wrecks (the Office wrecks are catalogued already). */
export const SURFACE_KIT_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(
  Object.values(SURFACE_WRECK_MODEL).filter(m => !m.key.startsWith('office-')).map(m => [m.key, {url: m.url, bytes: m.bytes}]));
/** Game.sectionModelKeys: the wreck models a layout placed (fetched under its asset family; the Skyways files allow 'surface'). */
export function surfaceKitModelKeysFor(layout: {props?: readonly {kind: string}[]}): string[] {
  const s = new Set<string>();
  for (const p of layout.props ?? []) if (isSurfaceWreckKind(p.kind)) s.add(SURFACE_WRECK_MODEL[p.kind].key);
  return [...s].sort();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The specs

/** Rigid-body row (the live physics come from `def.physics`) or the static reason. */
export type SurfacePhys =
  | {dynamic: true; mass: number; mat: PhysMat; shape: 'box' | 'cylinder'; onHost?: boolean; how: string}
  | {dynamic: false; why: StaticWhy; how: string};
/** Openables audit row ('openable' only with the real openable spec: the crate). */
export interface SurfaceOpen { cls: 'openable' | 'exception' | 'none'; role: 'equipment' | 'decor' | 'surface' | 'storage'; how: string }
export interface SurfaceKindSpec { def: PropDef; phys: SurfacePhys; damage: DamageClass; open: SurfaceOpen }

const wreckDef = (k: SurfaceWreckKind): PropDef => { const m = SURFACE_WRECK_MODEL[k]; return {w: m.w, d: m.d, h: m.h, blocksSight: m.h >= 1.7}; };
const wreck = (k: SurfaceWreckKind, what: string, kg: string): SurfaceKindSpec => ({
  def: wreckDef(k),
  phys: {dynamic: false, why: 'too heavy', how: `${what} (${kg}) sitting on its rims / axles: never shoved by a walker or a bullet; its collision box is the model's measured runtime bounds`},
  damage: 'sheetMetal',
  open: {cls: 'exception', role: 'decor', how: `${what}: its doors / bonnet are rusted shut or gone in the model (no separable leaf, nothing stored inside); not storage`},
});

export const SURFACE_SPECS: Readonly<Record<SurfaceKind, SurfaceKindSpec>> = {
  srSandbagWall: {
    def: {w: 1.6, d: 0.6, h: 0.9, blocksSight: false},
    phys: {dynamic: false, why: 'too heavy', how: 'stacked sandbag wall: six staggered rows of filled woven bags (~36 bags, ~600 kg) — bullets bury in it, a walker never shifts it'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'stacked filled sandbags: nothing to open'},
  },
  srJerseyBarrier: {
    def: {w: 2.0, d: 0.6, h: 0.81, blocksSight: false},
    phys: {dynamic: false, why: 'too heavy', how: 'precast concrete jersey barrier segment (2 m, ~1.4 t): immovable by hand or bullet'},
    damage: 'concrete',
    open: {cls: 'none', role: 'decor', how: 'solid precast concrete: nothing to open'},
  },
  srTrafficCone: {
    def: {w: 0.36, d: 0.36, h: 0.7, blocksSight: false, physics: {mass: 3.2, dynamic: true, shape: 'box', mat: 'pad', contact: true}},
    phys: {dynamic: true, mass: 3.2, mat: 'pad', shape: 'box', how: '70 cm PVC traffic cone on its square rubber base (~3.2 kg): a walker (or a vehicle) knocks it aside, a shot tips it over'},
    damage: 'plastic',
    open: {cls: 'none', role: 'decor', how: 'hollow traffic cone: nothing to open'},
  },
  srFireHydrant: {
    def: {w: 0.4, d: 0.4, h: 0.8, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'cast-iron fire hydrant (~80 kg) bolted to its riser on the buried water main'},
    damage: 'steel',
    open: {cls: 'exception', role: 'equipment', how: 'hydrant outlet caps are threaded hose connections (no storage; there is no water service to simulate)'},
  },
  srStreetLamp: {
    def: {w: 0.4, d: 0.4, h: 7.5, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'steel street-light pole (~150 kg) bolted to its concrete footing; the arm and dead cobra-head luminaire overhang the street at 7 m'},
    damage: 'steel',
    open: {cls: 'exception', role: 'equipment', how: 'the base hand-hole cover hides the pole wiring (screwed shut; equipment, not storage)'},
  },
  srTrafficSignal: {
    def: {w: 0.5, d: 0.5, h: 5.5, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'traffic-signal pole (~200 kg) bolted to its footing, a short mast arm with a dead three-lens head and a side head'},
    damage: 'sheetMetal',
    open: {cls: 'exception', role: 'equipment', how: 'signal heads and the pole hand-hole are sealed equipment (no storage)'},
  },
  srStreetSign: {
    def: {w: SR_SIGN.w, d: SR_SIGN.d, h: SR_SIGN.h, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'galvanised sign post set in a concrete footing with one or two street-name blades bolted at its top'},
    damage: 'sheetMetal',
    open: {cls: 'none', role: 'decor', how: 'sign post and blades: nothing to open'},
  },
  srChainFence: {
    def: {w: 3.0, d: 0.2, h: 2.2, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'temporary chain-link fence panel (~15 kg) clamped to its neighbours, its posts standing in two ~30 kg concrete feet: a bump or a bullet does not tip it'},
    damage: 'steel',
    open: {cls: 'none', role: 'decor', how: 'fence panel (no gate leaf): nothing to open'},
  },
  srBollard: {
    def: {w: 0.25, d: 0.25, h: 1.0, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'concrete-filled steel pipe bollard set in the pavement'},
    damage: 'steel',
    open: {cls: 'none', role: 'decor', how: 'solid bollard: nothing to open'},
  },
  srMapTable: {
    def: {w: SR_MAP_TABLE.w, d: SR_MAP_TABLE.d, h: SR_MAP_TABLE.h, blocksSight: false},
    phys: {dynamic: false, why: 'too heavy', how: 'military planning table: a 28 mm plywood top on two welded steel trestles (~70 kg), the checkpoint map station; a bump or a bullet does not shift it'},
    damage: 'wood',
    open: {cls: 'none', role: 'surface', how: 'open trestle table (no drawer): its bare top carries the planning map (lane LIFE) and any loose kit placed on it'},
  },
  srFieldRadio: {
    def: {w: 0.45, d: 0.3, h: 0.3, blocksSight: false, physics: {mass: 7, dynamic: true, shape: 'box', mat: 'pad', onHost: true, contact: true}},
    phys: {dynamic: true, mass: 7, mat: 'pad', shape: 'box', onHost: true, how: 'military field radio set (~7 kg, rubber feet) standing on a table or crate top: knocked off its host by a shot, shoved when walked into on the floor (handset on its cord, antenna stowed: part of the set)'},
    damage: 'plastic',
    open: {cls: 'exception', role: 'equipment', how: 'radio set: the battery box is a sealed equipment compartment (no storage; the set is dead)'},
  },
  srCot: {
    def: {w: 1.9, d: 0.7, h: 0.45, blocksSight: false, physics: {mass: 9, dynamic: true, shape: 'box', mat: 'pad', contact: true}},
    phys: {dynamic: true, mass: 9, mat: 'pad', shape: 'box', how: 'folding military camp cot (aluminium tube frame, olive canvas bed, ~9 kg) on rubber-capped legs: walked into it slides, shot it skids / tips'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'camp cot: a canvas bed on a tube frame, nothing to open'},
  },
  srMilitaryCrate: {
    def: {w: SR_CRATE.w, d: SR_CRATE.d, h: SR_CRATE.h, blocksSight: false},
    phys: {dynamic: false, why: 'holder', how: 'loot holder: stays put so its finite lots never float'},
    damage: 'wood',
    open: {cls: 'openable', role: 'storage', how: 'lidded military supply crate: the authored lid lifts on its back hinge (world/openablesSpec.ts srMilitaryCrate); finite seeded contents from items/lootTables.ts MILITARY_SUPPLY_ROWS'},
  },
  srWreckSedanStripped: wreck('srWreckSedanStripped', 'stripped sedan wreck: shell without wheels or glass', '~900 kg'),
  srWreckSedanRust: wreck('srWreckSedanRust', 'rusted sedan wreck', '~1.2 t'),
  srWreckSedanBurnt: wreck('srWreckSedanBurnt', 'burnt-out sedan wreck', '~1 t'),
  srWreckSuv: wreck('srWreckSuv', 'abandoned SUV wreck', '~1.8 t'),
  srWreckArmyTruck: wreck('srWreckArmyTruck', 'wrecked military cargo truck', '~9 t'),
  srWreckCar: wreck('srWreckCar', 'abandoned car wreck', '~1.2 t'),
  srWreckBus: wreck('srWreckBus', 'wrecked city bus', '~11 t'),
};

// ---------------------------------------------------------------------------------------------------------------------------
// Shared-table views (one spread line each)

const map = <T>(f: (s: SurfaceKindSpec, k: SurfaceKind) => T): Record<SurfaceKind, T> =>
  Object.fromEntries(SURFACE_KINDS.map(k => [k, f(SURFACE_SPECS[k], k)])) as Record<SurfaceKind, T>;

/** gen/props.ts PROP_DEFS spread. */
export const SURFACE_PROP_DEFS: Readonly<Record<SurfaceKind, PropDef>> = map(s => s.def);
/** damage/materials.ts PROP_DAMAGE spread (marks only: nothing breaks). */
export const SURFACE_DAMAGE_CLASS: Readonly<Record<SurfaceKind, DamageClass>> = map(s => s.damage);
/** damage/physicsAudit.ts rows (surfaceRow: class / body from the live physics, the reason from here). */
export const SURFACE_PHYS: Readonly<Record<SurfaceKind, SurfacePhys>> = map(s => s.phys);
/** world/openablesSpec.ts OPENABLE_AUDIT spread (the crate's 'openable' row comes from its spec there, so it is left out here). */
export const SURFACE_OPEN_AUDIT: readonly {kind: SurfaceKind; cls: 'exception' | 'none'; role: SurfaceOpen['role']; how: string}[] =
  SURFACE_KINDS.flatMap(k => { const o = SURFACE_SPECS[k].open; return o.cls === 'openable' ? [] : [{kind: k, cls: o.cls, role: o.role, how: o.how}]; });

/**
 * Scale-check records (rule 5: tools/asset-pipeline/props/scale-check.mjs --kind <kind> beside zombie lastshift x 1.0, front + side views
 * looked at; renders in the task's private qa folder): W x H x D as rendered, grounded contact, notes.
 */
export const SURFACE_SCALE: Readonly<Record<SurfaceKind, string>> = map(() => 'pending scale-check');
