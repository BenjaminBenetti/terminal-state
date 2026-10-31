// Iteration 08 (Lane P): COMPOSED station dressing — architecture-anchored activity clusters, landmarks on sightlines, deliberate
// open floor, cover and exploration rewards, per ZONE identity. Pure data (no three.js), level-aware by construction.
//
// User (iteration 08): "really think about the prop placement and building the map — making the map really awesome".
// Instead of equal-density scatter (iteration 07 put ~1 generated prop per 35 m2 of hall at random wall spots) public halls,
// service corridors and the upper / lower levels are composed from the EXISTING library (legacy + iteration-07 generated props):
//
//  1. Circulation first. Desire lines between every pair of an area's portals (doors, stair landings, level links) are routed
//     with a wall-avoiding cost and reserved 1.5 m wide (AI and player lanes); arrival plazas stay open in front of every portal;
//     big halls keep a central plaza (breathing room). Floor props never stand on those cells (placeKit lane / plaza masks).
//  2. Landmarks on sightlines. From each arrival portal the view across the area is traced; the longest one that ends on solid
//     wall gets the zone's landmark vignette centred on the axis (info point, shoe-shine stand, maintenance bay, pump skid …),
//     halls also hang a clock on the axis. Platforms get a work zone on an end wall.
//  3. Activity clusters (CLUSTERS): small believable vignettes placed all-or-nothing against wall runs / columns / beside doors /
//     as open islands — waiting (bench + bin + newspaper box + clock), security post (podium + barrier + CCTV), safety point,
//     phone bank, maintenance bay, plant skid, electrical bank, break nook, service cart by a door, evacuation traces near exits,
//     checkpoint / cover islands, triage point, busing station, caches tucked in dead ends and far corners (finite seeded loot).
//  4. Zone identity (zoneOf / ZONE_RULES): platform waiting/retail vs ticketing/security vs upper concourse vs lower service level
//     each run their own program, density cap and plaza rule, so they read differently.
// Every placement still goes through the dresser's primitive (door zones, access strips, rings, edge bands, stair approaches,
// apertures, connectivity) plus doorway clear volumes and wall backing; mounts / hung props check 3D clearance and the ceiling.

import type {Rng} from '../core/rng';
import {CELL, FLOOR, type Grid} from './grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from './props';
import {isP7Kind} from './props07';
import {wallBackedRuns} from './doorways';
import {
  WALL_ROT, areaBase, areaLevel, backed, begin, boxClear, cellsOfBox, commit, doorSide, hangProp, levelLinksOf, levelRole, markCell, propBlocksDoorway,
  mountProp, rollback, tryPlaceProp, wallRange, wallXZ, type PlaceCtx,
  reserveAhead, strictWallOk, vendingCapReached, // Task mall-playtest-revision-20261031 (lane SHOPS, U09)
} from './placeKit';
import type {Area, Door, Side, StationLayout} from './stationTypes';

// ---------------------------------------------------------------------------------------------
// Zones

export type Zone = 'platform' | 'concourse' | 'ticketing' | 'retail' | 'food' | 'passage' | 'exit' | 'service' | 'upper' | 'lower' | 'room' | 'washroom' | 'store';

export interface ZoneRule {
  /** Max floor-prop footprint share of the area (structure excluded) the composer fills up to. */
  cap: number;
  /** Central plaza (fraction of each dimension) for big areas; 0 = none. */
  plaza: number;
  /** Arrival plaza radius in front of portals (m). */
  arrival: number;
  /** Landmark vignettes with weights (sightline end walls; a type already used in the station counts less). */
  landmarks: readonly (readonly [ClusterId, number])[];
  /** Hang a clock on the landmark axis. */
  clock: boolean;
  label: string;
}

export const ZONE_RULES: Readonly<Record<Zone, ZoneRule>> = {
  platform: {cap: 0.06, plaza: 0, arrival: 3, landmarks: [], clock: false, label: 'platform: waiting bays, safety points, work zone at the end, evacuation traces'},
  concourse: {cap: 0.07, plaza: 0.34, arrival: 3, landmarks: [['infoPoint', 1], ['vendingBank', 1], ['newsCorner', 0.7], ['shoeShine', 0.4]], clock: true, label: 'concourse: info point landmark, waiting, phones, open centre'},
  ticketing: {cap: 0.07, plaza: 0.34, arrival: 3.5, landmarks: [['infoPoint', 1], ['vendingBank', 0.8], ['newsCorner', 0.7]], clock: true, label: 'ticket hall: security post + validators at the fare line, open centre'},
  retail: {cap: 0.08, plaza: 0, arrival: 2.5, landmarks: [['shoeShine', 1], ['capsuleCorner', 0.8], ['newsCorner', 0.6], ['infoPoint', 0.5]], clock: false, label: 'arcade: shoe-shine / capsule corners, news, waiting'},
  food: {cap: 1, plaza: 0, arrival: 2.5, landmarks: [['capsuleCorner', 1], ['vendingBank', 0.8], ['infoPoint', 0.6]], clock: false, label: 'food court: busing stations, seating rug (legacy), info point'},
  passage: {cap: 0.09, plaza: 0, arrival: 2, landmarks: [], clock: false, label: 'passage: kept clear, waiting nook in long ones, safety point'},
  exit: {cap: 0.12, plaza: 0, arrival: 1.5, landmarks: [], clock: false, label: 'sealed exit: abandoned luggage piled at the grille'},
  service: {cap: 0.16, plaza: 0, arrival: 1.5, landmarks: [['workLight', 1], ['maintenanceBay', 1], ['vendingBank', 0.25]], clock: false, label: 'service corridor: maintenance bay / work light at the dead end, cart by a door, cache'},
  upper: {cap: 0.06, plaza: 0.3, arrival: 3, landmarks: [['infoPoint', 1], ['vendingBank', 0.7], ['newsCorner', 0.5]], clock: true, label: 'upper concourse: wayfinding landmark at the stair top, benches, open floor'},
  lower: {cap: 0.14, plaza: 0, arrival: 2, landmarks: [['plantSkid', 1], ['electricalBank', 0.8], ['maintenanceBay', 0.7], ['workLight', 0.5]], clock: false, label: 'lower service level: pumps, transformers, tool bays, cover, caches'},
  room: {cap: 1, plaza: 0, arrival: 0, landmarks: [], clock: false, label: 'purpose room (purpose rules + generated-prop affinities)'},
  washroom: {cap: 1, plaza: 0, arrival: 0, landmarks: [], clock: false, label: 'washroom (purpose rules)'},
  store: {cap: 1, plaza: 0, arrival: 0, landmarks: [], clock: false, label: 'store unit (storefront rules)'},
};

/** Zones whose areas are composed here (their generated-prop scatter is limited to spaced wall / ceiling infrastructure). */
export const COMPOSED_ZONES: ReadonlySet<Zone> = new Set<Zone>(['platform', 'concourse', 'ticketing', 'retail', 'food', 'passage', 'exit', 'service', 'upper', 'lower']);

/** Zone of an area: level role first (upper concourse / lower service level), then hall type / purpose. */
export function zoneOf(layout: StationLayout, a: Area): Zone {
  if (a.storefront !== undefined) return 'store';
  const role = levelRole(layout, areaLevel(a));
  const hallish = a.kind === 'concourse' || a.kind === 'passage' || a.kind === 'platform' || a.kind === 'service';
  // Maintenance catwalks along the tunnel walls stay clear like passages (only wall infrastructure).
  if (a.role === 'catwalk') return 'passage';
  // Track 2 (lane CONTENT): a service annex's corridors (trackbed level, off a track tunnel) compose as the station's lower service
  // level — pumps, transformers, tool bays, caches; its rooms keep their purpose rules ('room'). Core areas never carry `ext`.
  if (a.ext === 'annex' && hallish) return 'lower';
  if (role === 'upper' && hallish && a.type !== 'platform') return 'upper';
  if (role === 'lower' && hallish) return 'lower';
  switch (a.type) {
    case 'platform': return 'platform';
    case 'passage': case 'underpass': return 'passage';
    case 'fare-hall': return 'ticketing';
    case 'concourse': return 'concourse';
    case 'food-court': return 'food';
    case 'retail-arcade': return 'retail';
    case 'exit-stair': return 'exit';
    case 'washroom': return 'washroom';
    case 'service-corridor': return 'service';
    default: return a.kind === 'service' ? 'service' : 'room';
  }
}

// ---------------------------------------------------------------------------------------------
// Cluster catalogue

export type ClusterId =
  | 'waiting' | 'bayWaiting' | 'securityPost' | 'validators' | 'infoPoint' | 'phoneBank' | 'safetyPoint' | 'newsCorner' | 'capsuleCorner'
  | 'shoeShine' | 'vendingBank' | 'busing' | 'evacuation' | 'triage' | 'checkpoint' | 'cover' | 'workZone' | 'workLight' | 'maintenanceBay'
  | 'plantSkid' | 'electricalBank' | 'cleaning' | 'serviceCart' | 'refuse' | 'breakNook' | 'cache' | 'supplyShelf';

type Kinds = readonly PropKind[];
/** One member laid along the wall (left to right), or one member of an open / scattered group. */
export interface Slot {
  k: Kinds;
  need?: boolean;
  chance?: number;
  /** Extra gap before this member (m). */
  gap?: number;
  /** Clear access strip in front (m). */
  front?: number;
  /** Long side against the wall (deep items: pallet jack, stretcher). */
  along?: boolean;
  /** Loot / host-decor purpose override (cache crates, break-nook counter). */
  purpose?: string;
  /** Repeat count range (scatter / open groups). */
  n?: readonly [number, number];
}
/** Wall mount over a member (`over` = slot index, -1 after the last member); `above`: at least 6 cm over that member's top. */
export interface Mount { k: Kinds; y: number; over: number; above?: boolean; need?: boolean; chance?: number }
export interface Hang { k: Kinds; over: number; out: number; chance?: number }

export interface ClusterSpec {
  id: ClusterId;
  /** wall: members side by side against a wall run · open: island group with a walkway ring · scatter: loose items around an
   *  anchor point · bay: between two platform columns. */
  form: 'wall' | 'open' | 'scatter' | 'bay';
  slots: readonly Slot[];
  mounts?: readonly Mount[];
  hangs?: readonly Hang[];
  /** Minimum distance (m) between two clusters of this id on a level. */
  spacing: number;
  /** Zones it appears in (tests: every composed prop's cluster belongs to its area's zone). */
  zones: readonly Zone[];
  cover?: boolean;
  reward?: boolean;
  story: string;
}

const S = (k: Kinds, o: Omit<Slot, 'k'> = {}): Slot => ({k, ...o});
const ALL_HALLS: Zone[] = ['platform', 'concourse', 'ticketing', 'retail', 'food', 'passage', 'upper'];

export const CLUSTERS: Readonly<Record<ClusterId, ClusterSpec>> = {
  waiting: {id: 'waiting', form: 'wall', spacing: 14, zones: ['platform', 'concourse', 'ticketing', 'retail', 'passage', 'upper'],
    slots: [S(['bin'], {need: true}), S(['bench'], {need: true, gap: 0.15}), S(['newspaperVendingBox'], {chance: 0.45, gap: 0.2})],
    mounts: [{k: ['payphone'], y: 0.75, over: -1, chance: 0.3}], hangs: [{k: ['platformClock'], over: 1, out: 1.6, chance: 0.35}],
    story: 'a waiting spot: bench with a bin and a newspaper box, a clock overhead'},
  bayWaiting: {id: 'bayWaiting', form: 'bay', spacing: 5, zones: ['platform'],
    slots: [S(['bin'], {need: true}), S(['newspaperVendingBox'], {chance: 0.3})], story: 'platform bench bay: bin at the column, newspaper box opposite'},
  securityPost: {id: 'securityPost', form: 'wall', spacing: 18, zones: ['ticketing', 'concourse', 'upper', 'lower'],
    slots: [S(['crowdBarrier', 'foldingBarricade'], {chance: 0.85}), S(['securityPodium'], {need: true, front: 1.0, gap: 0.25}), S(['foldingBarricade'], {chance: 0.4, gap: 0.3})],
    mounts: [{k: ['cctvCamera'], y: 2.45, over: 1, chance: 0.9}],
    story: 'transit security post at the fare line: podium, barriers, a camera on it'},
  validators: {id: 'validators', form: 'wall', spacing: 10, zones: ['ticketing', 'concourse', 'platform', 'upper'],
    slots: [S(['fareValidatorStand'], {need: true}), S(['fareValidatorStand'], {chance: 0.85, gap: 0.5}), S(['fareValidatorStand'], {chance: 0.4, gap: 0.5}), S(['bin'], {chance: 0.4, gap: 0.4})],
    story: 'fare validators lined up by the gates / platform entry'},
  infoPoint: {id: 'infoPoint', form: 'wall', spacing: 24, zones: ['concourse', 'ticketing', 'retail', 'food', 'upper'],
    slots: [S(['infoTouchKiosk', 'atmKiosk'], {need: true, front: 1.0}), S(['atmKiosk'], {chance: 0.7, front: 1.0, gap: 0.3}), S(['bin'], {chance: 0.6, gap: 0.3})],
    mounts: [{k: ['cctvCamera'], y: 2.45, over: 0, chance: 0.6}], story: 'information point: touch kiosk and cash machines'},
  phoneBank: {id: 'phoneBank', form: 'wall', spacing: 25, zones: ['platform', 'concourse', 'ticketing', 'passage', 'upper', 'retail'],
    slots: [S(['emergencyCallPoint'], {chance: 0.5})],
    mounts: [{k: ['payphone'], y: 0.75, over: -1, need: true}, {k: ['payphone'], y: 0.75, over: -1, chance: 0.75}, {k: ['payphone'], y: 0.75, over: -1, chance: 0.35}],
    story: 'a bank of payphones (and a help point)'},
  safetyPoint: {id: 'safetyPoint', form: 'wall', spacing: 30, zones: [...ALL_HALLS, 'service', 'lower', 'exit'],
    slots: [S(['emergencyCallPoint', 'fireExtinguisher'], {chance: 0.45})],
    mounts: [{k: ['fireExtinguisherCabinet'], y: 0.6, over: -1, need: true}, {k: ['fireHoseReelCabinet'], y: 0.4, over: -1, chance: 0.6}, {k: ['aedWallCabinet', 'firstAidWallKit'], y: 1.2, over: -1, chance: 0.55}],
    story: 'safety point: extinguisher cabinet, hose reel, defibrillator grouped on one pier'},
  newsCorner: {id: 'newsCorner', form: 'wall', spacing: 20, zones: ['concourse', 'ticketing', 'retail', 'passage', 'exit', 'upper'],
    slots: [S(['newspaperVendingBox'], {need: true}), S(['newspaperVendingBox'], {chance: 0.5, gap: 0.08}), S(['newspaperBundles'], {chance: 0.5, gap: 0.1}), S(['bin'], {chance: 0.5, gap: 0.25})],
    story: 'news corner: newspaper boxes and a stack of bundles'},
  capsuleCorner: {id: 'capsuleCorner', form: 'wall', spacing: 20, zones: ['concourse', 'ticketing', 'retail', 'food'],
    slots: [S(['capsuleToyMachine'], {need: true}), S(['capsuleToyMachine'], {chance: 0.6, gap: 0.05}), S(['bin'], {chance: 0.4, gap: 0.3})], story: 'capsule-toy machines'},
  shoeShine: {id: 'shoeShine', form: 'wall', spacing: 30, zones: ['retail', 'concourse', 'passage'],
    slots: [S(['newspaperBundles'], {chance: 0.4}), S(['shoeShineChair'], {need: true, front: 1.0, gap: 0.3}), S(['bin'], {chance: 0.4, gap: 0.3})], story: 'shoe-shine stand'},
  vendingBank: {id: 'vendingBank', form: 'wall', spacing: 20, zones: ['concourse', 'ticketing', 'upper', 'platform', 'food', 'service'],
    slots: [S(['vending'], {need: true, front: 1.0}), S(['vending'], {need: true, front: 1.0, gap: 0.02}), S(['bin'], {chance: 0.6, gap: 0.3})], story: 'lit vending machines at the end of the view'},
  busing: {id: 'busing', form: 'wall', spacing: 12, zones: ['food'],
    slots: [S(['bin'], {need: true}), S(['busCart'], {need: true, front: 1.0, gap: 0.1}), S(['trashBagPile'], {chance: 0.5, gap: 0.1})], story: 'busing station: bin, tray cart, bags'},
  evacuation: {id: 'evacuation', form: 'scatter', spacing: 10, zones: ['platform', 'concourse', 'ticketing', 'passage', 'exit', 'upper', 'retail'],
    slots: [S(['rollingSuitcase'], {need: true, n: [1, 2]}), S(['babyStroller', 'wheelchair', 'shoppingCart', 'bicycle'], {chance: 0.5})],
    story: 'evacuation traces: luggage and a stroller dropped near the way out'},
  triage: {id: 'triage', form: 'wall', spacing: 60, zones: ['platform', 'concourse', 'upper'], reward: true,
    slots: [S(['wheeledStretcher'], {need: true, along: true}), S(['crashCart'], {need: true, front: 0.8, gap: 0.2}), S(['oxygenCart'], {chance: 0.7, gap: 0.15}), S(['ivPole'], {chance: 0.6, gap: 0.1}), S(['wheelchair'], {chance: 0.4, gap: 0.3})],
    story: 'abandoned triage point: stretcher, crash cart (medical supplies), oxygen'},
  checkpoint: {id: 'checkpoint', form: 'open', spacing: 16, zones: ['concourse', 'ticketing', 'upper', 'lower', 'platform'], cover: true,
    slots: [S(['foldingBarricade'], {need: true}), S(['crowdBarrier', 'foldingBarricade'], {chance: 0.7}), S(['tripodWorkLight', 'wetFloorSign'], {chance: 0.5})],
    story: 'police checkpoint left standing: barricades and a work light (cover)'},
  cover: {id: 'cover', form: 'bay', spacing: 8, zones: ['platform', 'lower'], cover: true,
    slots: [S(['foldingBarricade', 'crowdBarrier', 'trashBagPile'], {need: true})], story: 'barricade left in a column bay (cover)'},
  workZone: {id: 'workZone', form: 'wall', spacing: 40, zones: ['platform', 'lower', 'passage'],
    slots: [S(['foldingBarricade', 'crowdBarrier'], {need: true}), S(['tripodWorkLight'], {need: true, gap: 0.25}), S(['portableGenerator'], {chance: 0.6, gap: 0.2}), S(['gasCylinderCart', 'signalHeadSpare'], {chance: 0.5, gap: 0.2}), S(['crate'], {chance: 0.35, gap: 0.3, purpose: 'storage'})],
    mounts: [{k: ['fieldPhoneBox'], y: 1.2, over: -1, chance: 0.6}], story: 'track work zone at the platform end: barricade, work light, generator'},
  workLight: {id: 'workLight', form: 'wall', spacing: 20, zones: ['service', 'lower'],
    slots: [S(['tripodWorkLight'], {need: true}), S(['portableGenerator', 'drumFan'], {chance: 0.6, gap: 0.2}), S(['crate'], {chance: 0.6, gap: 0.3, purpose: 'storage'})],
    story: 'work light standing at the end of the corridor (seen from the far door)'},
  maintenanceBay: {id: 'maintenanceBay', form: 'wall', spacing: 20, zones: ['service', 'lower'],
    slots: [S(['rollingToolChest'], {need: true, front: 0.8}), S(['drumFan', 'airCompressor'], {chance: 0.7, gap: 0.15}), S(['tripodWorkLight'], {chance: 0.6, gap: 0.15}), S(['stepLadder', 'handTruck'], {chance: 0.6, gap: 0.15}), S(['palletJack'], {chance: 0.45, gap: 0.2, along: true}), S(['crate'], {chance: 0.35, gap: 0.2, purpose: 'storage'})],
    mounts: [{k: ['toolPegboard', 'partsBinRack'], y: 1.0, over: 0, above: true, chance: 0.6}], story: 'maintenance bay: tool chest under a pegboard, fan, work light, pallet jack'},
  plantSkid: {id: 'plantSkid', form: 'wall', spacing: 12, zones: ['lower', 'service'],
    slots: [S(['waterPumpSkid'], {need: true, front: 0.8}), S(['waterPumpSkid', 'airCompressor'], {chance: 0.5, gap: 0.3, front: 0.8}), S(['waterHeaterTank'], {chance: 0.5, gap: 0.3})],
    mounts: [{k: ['pipeValveManifold'], y: 0.5, over: 0, above: true, chance: 0.9}, {k: ['disconnectSwitch'], y: 1.2, over: -1, chance: 0.7}, {k: ['eyewashStation'], y: 0.9, over: -1, chance: 0.4}],
    story: 'pump skid with its valve manifold and isolator'},
  electricalBank: {id: 'electricalBank', form: 'wall', spacing: 14, zones: ['lower', 'service'],
    slots: [S(['dryTransformer'], {need: true, front: 1.0}), S(['dryTransformer'], {chance: 0.45, gap: 0.4, front: 1.0}), S(['fireExtinguisher'], {chance: 0.6, gap: 0.3})],
    mounts: [{k: ['disconnectSwitch'], y: 1.2, over: -1, need: true}, {k: ['wallDataCabinet'], y: 1.4, over: -1, chance: 0.5}],
    story: 'transformer bank with disconnect switches'},
  cleaning: {id: 'cleaning', form: 'wall', spacing: 16, zones: ['service', 'lower', 'food'],
    slots: [S(['floorScrubber', 'mopBucketWringer'], {need: true}), S(['wetDryVac'], {chance: 0.5, gap: 0.15}), S(['wetFloorSign'], {chance: 0.6, gap: 0.15})], story: 'cleaning kit parked: scrubber, vacuum, wet-floor sign'},
  serviceCart: {id: 'serviceCart', form: 'wall', spacing: 10, zones: ['service', 'concourse', 'retail', 'lower'],
    slots: [S(['janitorCart', 'mopBucketWringer'], {need: true}), S(['wetFloorSign'], {chance: 0.6, gap: 0.15})], story: 'janitor cart parked by a door'},
  refuse: {id: 'refuse', form: 'wall', spacing: 12, zones: ['service', 'lower'],
    slots: [S(['wheelieBin'], {need: true}), S(['trashBagPile'], {chance: 0.7, gap: 0.1}), S(['wheelieBin'], {chance: 0.35, gap: 0.05})], story: 'refuse point: wheelie bins and bags'},
  breakNook: {id: 'breakNook', form: 'wall', spacing: 20, zones: ['service', 'lower', 'upper'], reward: true,
    slots: [S(['waterCooler'], {need: true}), S(['cabinetLow'], {need: true, front: 0.7, gap: 0.1, purpose: 'staff-room'}), S(['foldingChair', 'plasticStackChair'], {chance: 0.7, gap: 0.2})],
    mounts: [{k: ['punchClock', 'firstAidWallKit'], y: 1.2, over: -1, chance: 0.5}], story: 'staff break nook: water cooler, counter with a coffee maker, a chair'},
  supplyShelf: {id: 'supplyShelf', form: 'wall', spacing: 12, zones: ['service', 'lower'],
    slots: [S(['stockShelf'], {need: true, front: 0.8}), S(['cartonStack', 'cabinetLow'], {chance: 0.6, gap: 0.1}), S(['crate'], {chance: 0.4, gap: 0.1})],
    story: 'a bay of supply shelving with cartons (stores for the line)'},
  cache: {id: 'cache', form: 'wall', spacing: 8, zones: ['service', 'lower', 'upper', 'platform', 'passage'], reward: true,
    slots: [S(['crate'], {need: true, purpose: 'storage'}), S(['cabinetLow', 'crate'], {chance: 0.3, gap: 0.1, purpose: 'storage', front: 0.7})], story: 'supply cache tucked in a dead end / far corner'},
};

// ---------------------------------------------------------------------------------------------
// Summary

export interface ClusterRecord {
  id: number; type: ClusterId; area: number; level: number; zone: Zone;
  /** Centre (world, m). */
  x: number; z: number;
  side?: Side;
  /** Placed members (props tagged with this cluster) and required members of the spec. */
  members: number; need: number;
  landmark: boolean; cover: boolean; reward: boolean;
}
export interface LandmarkRecord { cluster: number; area: number; level: number; via: 'door' | 'stair' | 'link'; from: {x: number; z: number}; to: {x: number; z: number}; len: number; clock: boolean }
export interface AreaComposition {
  area: number; level: number; zone: Zone; portals: number; lane: number; plaza: number;
  /** Floor coverage before composing (legacy fixtures) and after; the zone cap. */
  before: number; coverage: number; cap: number; clusters: number[];
}
export interface PlazaRect { area: number; level: number; x0: number; z0: number; x1: number; z1: number; kind: 'centre' | 'arrival' }
export interface CompositionSummary {
  clusters: ClusterRecord[]; landmarks: LandmarkRecord[]; areas: AreaComposition[]; plazas: PlazaRect[];
  /** layout.props.length when composition started (later placements: clusters, then the iteration-07 pass). */
  propsBefore: number;
  /** Per level: desire-line lane cells and plaza cells (grid indexing; tests / QA). */
  masks: {lane: Uint8Array; plaza: Uint8Array}[];
}

const SUMMARY = new WeakMap<StationLayout, CompositionSummary>();
/** Composition record of a dressed station (null before dressing / for hand-built layouts). */
export function compositionOf(layout: StationLayout): CompositionSummary | null {
  return SUMMARY.get(layout) ?? null;
}

/** Track 2 (lane GEN): `to` takes over `from`'s composition record (an in-place re-frame adopting its re-framed copy). */
export function adoptComposition(from: StationLayout, to: StationLayout): void {
  const s = SUMMARY.get(from);
  if (s) SUMMARY.set(to, s);
}

/**
 * Track 2 (lane GEN): carries a dressed station's composition record over to its RE-FRAMED copy (gen/trackExt/core.ts reframe:
 * the new frame's cell (0, 0) is the old cell (ox, oy), w x h cells) — world positions translated, the cell masks re-windowed.
 */
export function reframeComposition(from: StationLayout, to: StationLayout, ox: number, oy: number, w: number, h: number, keepAreas = Infinity): void {
  const s0 = SUMMARY.get(from);
  if (!s0) return;
  // Track 2 (lane CONTENT): a core view (keepAreas = the first extension area) leaves the extensions' appended clusters out (their ids
  // come after the core's, so the core's keep theirs).
  const s = keepAreas === Infinity ? s0 : {...s0, clusters: s0.clusters.filter(c => c.area < keepAreas), landmarks: s0.landmarks.filter(l => l.area < keepAreas),
    areas: s0.areas.filter(a => a.area < keepAreas), plazas: s0.plazas.filter(r => r.area < keepAreas)};
  const dx = ox * CELL, dz = oy * CELL, W = from.grid.w, H = from.grid.h;
  const win = (m: Uint8Array): Uint8Array => {
    const out = new Uint8Array(w * h), sx0 = Math.max(0, ox), sx1 = Math.min(W, ox + w);
    if (sx1 > sx0) for (let y = 0; y < h; y++) { const sy = y + oy; if (sy >= 0 && sy < H) out.set(m.subarray(sy * W + sx0, sy * W + sx1), y * w + (sx0 - ox)); }
    return out;
  };
  const p2 = (q: {x: number; z: number}) => ({x: q.x - dx, z: q.z - dz});
  SUMMARY.set(to, {
    ...s,
    clusters: s.clusters.map(c => ({...c, x: c.x - dx, z: c.z - dz})),
    landmarks: s.landmarks.map(l => ({...l, from: p2(l.from), to: p2(l.to)})),
    areas: s.areas.map(a => ({...a, clusters: a.clusters.slice()})),
    plazas: s.plazas.map(r => ({...r, x0: r.x0 - dx, z0: r.z0 - dz, x1: r.x1 - dx, z1: r.z1 - dz})),
    masks: s.masks.map(m => ({lane: win(m.lane), plaza: win(m.plaza)})),
  });
}

// ---------------------------------------------------------------------------------------------
// Composer

export interface ComposeApi {
  rng: Rng;
  /** Iteration-07 generated kinds this station's palette loaded (legacy kinds always available). */
  palette: ReadonlySet<string>;
  ctxOf(a: Area): PlaceCtx;
  /**
   * Track 2 (lane CONTENT): an APPENDED composition pass over a subset of areas (the service annexes, gen/annexContent.ts): only
   * these areas are composed, on their own generated-model budget (`p7Budget`, default COMPOSED_P7_BUDGET), and the clusters /
   * landmarks / plazas / masks join the layout's existing record (`append`: ids continue after the core's). Absent = the station
   * pass exactly as before.
   */
  areas?: (a: Area) => boolean;
  p7Budget?: number;
  append?: boolean;
}

interface Portal { via: 'door' | 'stair' | 'link'; x: number; z: number; nx: number; nz: number; cells: number[]; door?: Door; width: number }

interface CC {
  layout: StationLayout;
  api: ComposeApi;
  rng: Rng;
  sum: CompositionSummary;
  /** Station-wide counters. */
  caches: number;
  triage: number;
  /** Floor footprint (m2) per area id: computed once, then kept up to date as clusters land. */
  cover: Map<number, number>;
  /** Composed iteration-07 model placements so far (COMPOSED_P7_BUDGET). */
  p7: number;
  /** Track 2 (lane CONTENT): this pass's generated-model budget (ComposeApi.p7Budget ?? COMPOSED_P7_BUDGET). */
  p7Budget: number;
}

/**
 * Station-wide budget of composed placements of the lazily loaded iteration-07 models (each ~1.5-6k triangles): once spent, clusters
 * keep only legacy-kind members (bins, benches, crates, vending …) and skip vignettes that need a generated model. Keeps per-station
 * triangles / draw calls bounded however many levels and halls a station has.
 */
export const COMPOSED_P7_BUDGET = 110;

/** Floor footprint share of an area (structure, wall boards, mounts and on-top decor excluded). */
export const STRUCTURE_KINDS: ReadonlySet<string> = new Set(['column', 'fareGate', 'shopGlazing', 'shopShutter', 'exitStair', 'booth', 'noticeBoard']);
export function floorCoverage(layout: StationLayout, a: Area): number {
  let s = 0;
  for (const p of layout.props) if (p.area === a.id && !p.mounted && p.host === undefined && !STRUCTURE_KINDS.has(p.kind)) s += p.hx * p.hz * 4;
  return s / Math.max(1, a.w * a.h * CELL * CELL);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function compose(layout: StationLayout, api: ComposeApi): CompositionSummary {
  // Track 2 (lane CONTENT): an appended pass continues the layout's record (cluster ids after the core's; spacing sees them).
  const prev = api.append ? SUMMARY.get(layout) : undefined;
  const sum: CompositionSummary = prev ?? {clusters: [], landmarks: [], areas: [], plazas: [], propsBefore: layout.props.length, masks: []};
  const cc: CC = {layout, api, rng: api.rng, sum, caches: 0, triage: 0, cover: new Map(), p7: 0, p7Budget: api.p7Budget ?? COMPOSED_P7_BUDGET};
  const areas = layout.areas.filter(a => COMPOSED_ZONES.has(zoneOf(layout, a)) && (!api.areas || api.areas(a)));
  const area0 = sum.areas.length;
  // Pass 1: circulation (lanes + plazas) for every composed area first, so no cluster anywhere takes a lane cell.
  const portalsOf = new Map<number, Portal[]>();
  for (const a of areas) {
    const ctx = api.ctxOf(a), zone = zoneOf(layout, a);
    const portals = findPortals(layout, ctx, a);
    portalsOf.set(a.id, portals);
    const lane = desireLines(ctx, a, portals);
    const plaza = plazas(cc, ctx, a, zone, portals);
    sum.areas.push({area: a.id, level: ctx.level, zone, portals: portals.length, lane, plaza, before: Math.round(floorCoverage(layout, a) * 1000) / 1000, coverage: 0, cap: ZONE_RULES[zone].cap, clusters: []});
  }
  // Pass 2: landmarks everywhere first (the strongest vignettes), then the zone programs — the new levels and the platforms
  // before the big halls, so the station-wide generated-model budget never starves the upper / lower identity.
  for (const a of areas) landmark(cc, api.ctxOf(a), a, zoneOf(layout, a), portalsOf.get(a.id)!);
  const order = [...areas].sort((p, q) => PROGRAM_ORDER.indexOf(zoneOf(layout, p)) - PROGRAM_ORDER.indexOf(zoneOf(layout, q)) || p.id - q.id);
  for (const a of order) PROGRAMS[zoneOf(layout, a)]?.(cc, api.ctxOf(a), a, portalsOf.get(a.id)!);
  for (const r of sum.areas.slice(area0)) r.coverage = Math.round(floorCoverage(layout, layout.areas[r.area]) * 1000) / 1000;
  for (const a of areas) {
    const c = api.ctxOf(a), m = sum.masks[c.level];
    if (!m) sum.masks[c.level] = {lane: c.lane, plaza: c.plaza};
    else if (m.lane !== c.lane) {
      // (appended pass: its own context's lane / plaza cells join the record's masks)
      for (let i = 0; i < m.lane.length && i < c.lane.length; i++) { if (c.lane[i]) m.lane[i] = 1; if (c.plaza[i]) m.plaza[i] = 1; }
    }
  }
  SUMMARY.set(layout, sum);
  return sum;
}

// --- kinds ----------------------------------------------------------------------------------

function available(cc: CC, k: PropKind): boolean {
  return !isP7Kind(k) || (cc.api.palette.has(k) && cc.p7 < cc.p7Budget);
}
function pickKind(cc: CC, ks: Kinds): PropKind | null {
  const ok = ks.filter(k => available(cc, k));
  return ok.length ? ok[0] : null;
}
function pickKindRandom(cc: CC, ks: Kinds): PropKind | null {
  const ok = ks.filter(k => available(cc, k));
  return ok.length ? cc.rng.pick(ok) : null;
}

// --- circulation ------------------------------------------------------------------------------

function findPortals(layout: StationLayout, ctx: PlaceCtx, a: Area): Portal[] {
  const g = ctx.g, out: Portal[] = [];
  const inA = (x: number, y: number) => g.inBounds(x, y) && g.area[g.idx(x, y)] === a.id && g.cells[g.idx(x, y)] === FLOOR && x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    const side = doorSide(d, a);
    const [nx, nz] = side === 'N' ? [0, 1] : side === 'S' ? [0, -1] : side === 'W' ? [1, 0] : [-1, 0];
    const cells: number[] = [];
    for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
      for (let k = 0; k <= 2; k++) { const cx = x + nx * k, cy = y + nz * k; if (inA(cx, cy)) { cells.push(g.idx(cx, cy)); break; } }
    }
    if (!cells.length) continue;
    out.push({via: 'door', x: (d.x + d.w / 2) * CELL, z: (d.y + d.h / 2) * CELL, nx, nz, cells, door: d, width: Math.max(d.w, d.h) * CELL});
  }
  const standPortal = (p: {x: number; z: number}, from: {x: number; z: number}, via: 'stair' | 'link') => {
    const [cx, cy] = g.cellOf(p.x, p.z);
    if (!inA(cx, cy)) return;
    let nx = p.x - from.x, nz = p.z - from.z;
    if (Math.abs(nx) >= Math.abs(nz)) { nx = Math.sign(nx); nz = 0; } else { nz = Math.sign(nz); nx = 0; }
    out.push({via, x: p.x, z: p.z, nx, nz, cells: [g.idx(cx, cy)], width: 1.5});
  };
  if (ctx.level === 0) for (const f of layout.traversal?.stairs ?? []) { standPortal(f.top, f.bottom, 'stair'); standPortal(f.bottom, f.top, 'stair'); }
  for (const k of levelLinksOf(layout)) {
    if (k.kind !== 'stairs') continue;
    if (k.upper === ctx.level) standPortal(k.top, k.bottom, 'link');
    if (k.lower === ctx.level) standPortal(k.bottom, k.top, 'link');
  }
  return out;
}

/** Binary min-heap of (node, key) pairs in typed arrays (lazy deletion: stale entries are skipped by the caller). */
class Heap {
  private node: Int32Array;
  private key: Float32Array;
  size = 0;
  constructor(cap: number) { this.node = new Int32Array(cap); this.key = new Float32Array(cap); }
  push(n: number, k: number): void {
    if (this.size === this.node.length) { const nn = new Int32Array(this.size * 2), nk = new Float32Array(this.size * 2); nn.set(this.node); nk.set(this.key); this.node = nn; this.key = nk; }
    const N = this.node, K = this.key;
    let c = this.size++;
    while (c > 0) { const p = (c - 1) >> 1; if (K[p] <= k) break; N[c] = N[p]; K[c] = K[p]; c = p; }
    N[c] = n; K[c] = k;
  }
  /** Pops the minimum; returns its node (key in `lastKey`). */
  lastKey = 0;
  pop(): number {
    const N = this.node, K = this.key;
    const top = N[0];
    this.lastKey = K[0];
    const n = N[--this.size], k = K[this.size];
    let c = 0;
    for (;;) {
      const l = 2 * c + 1;
      if (l >= this.size) break;
      const m = l + 1 < this.size && K[l + 1] < K[l] ? l + 1 : l;
      if (K[m] >= k) break;
      N[c] = N[m]; K[c] = K[m]; c = m;
    }
    N[c] = n; K[c] = k;
    return top;
  }
}

/**
 * Desire lines: cheapest wall-avoiding routes between every pair of portals of the area, reserved 1 m wide (2 m in halls; AI and player
 * lanes). Dijkstra on 1 m blocks (2 x 2 cells; a block is open when at least three of its cells are free floor of the area) whose
 * cost rises within ~1.5 m of a wall or prop, so lanes run down the open middle; each search stops once every later portal is
 * reached. Returns the number of lane cells.
 */
function desireLines(ctx: PlaceCtx, a: Area, portals: Portal[]): number {
  if (portals.length < 2) return 0;
  const g = ctx.g;
  const BW = Math.ceil(a.w / 2), BH = Math.ceil(a.h / 2), n = BW * BH;
  // Free cells of the area rect (local index), one pass.
  const cf = new Uint8Array(a.w * a.h);
  for (let y = 0; y < a.h; y++) {
    let i = g.idx(a.x, a.y + y);
    for (let x = 0; x < a.w; x++, i++) cf[y * a.w + x] = g.area[i] === a.id && g.cells[i] === FLOOR && !g.blocked[i] ? 1 : 0;
  }
  const cellFree = (x: number, y: number) => x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h && cf[(y - a.y) * a.w + (x - a.x)] === 1;
  const free = new Uint8Array(n);
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
    const x = a.x + bx * 2, y = a.y + by * 2;
    const k = (cellFree(x, y) ? 1 : 0) + (cellFree(x + 1, y) ? 1 : 0) + (cellFree(x, y + 1) ? 1 : 0) + (cellFree(x + 1, y + 1) ? 1 : 0);
    free[by * BW + bx] = k >= 3 ? 1 : 0;
  }
  // Distance (blocks) to the nearest closed block or the area edge, capped at 3 (wall penalty within 2 m).
  const wd = new Uint8Array(n).fill(255);
  const q = new Int32Array(n);
  let qt = 0;
  for (let j = 0; j < n; j++) {
    const x = j % BW, y = (j - x) / BW;
    if (!free[j]) { wd[j] = 0; q[qt++] = j; } else if (x === 0 || y === 0 || x === BW - 1 || y === BH - 1) { wd[j] = 1; q[qt++] = j; }
  }
  for (let h = 0; h < qt; h++) {
    const j = q[h], x = j % BW, y = (j - x) / BW, d = wd[j];
    if (d >= 3) continue;
    if (x > 0 && wd[j - 1] > d + 1) { wd[j - 1] = d + 1; q[qt++] = j - 1; }
    if (x < BW - 1 && wd[j + 1] > d + 1) { wd[j + 1] = d + 1; q[qt++] = j + 1; }
    if (y > 0 && wd[j - BW] > d + 1) { wd[j - BW] = d + 1; q[qt++] = j - BW; }
    if (y < BH - 1 && wd[j + BW] > d + 1) { wd[j + BW] = d + 1; q[qt++] = j + BW; }
  }
  const cost = new Float32Array(n);
  for (let j = 0; j < n; j++) cost[j] = 1 + (wd[j] < 3 ? (3 - wd[j]) * 1.2 : 0);
  const blockOf = (i: number) => { const x = i % g.w - a.x, y = Math.floor(i / g.w) - a.y; return x >= 0 && y >= 0 && x < a.w && y < a.h ? (y >> 1) * BW + (x >> 1) : -1; };
  const srcs = portals.map(p => [...new Set(p.cells.map(blockOf).filter(j => j >= 0 && free[j]))]);
  const dist = new Float32Array(n), prev = new Int32Array(n), goal = new Uint8Array(n);
  const heap = new Heap(n * 2);
  let marked = 0;
  // Lane width: the 1 m path blocks; halls at least 8 m across get a cell either side (2 m).
  const dil = Math.min(a.w, a.h) * CELL >= 8 ? 1 : 0;
  const done = new Uint8Array(n);
  const lane = ctx.lane;
  const mark = (j: number) => {
    if (done[j]) return;
    done[j] = 1;
    const bx = j % BW, by = (j - bx) / BW;
    for (let y = a.y + by * 2 - dil; y <= a.y + by * 2 + 1 + dil; y++) for (let x = a.x + bx * 2 - dil; x <= a.x + bx * 2 + 1 + dil; x++) {
      if (!cellFree(x, y)) continue;
      const i = y * g.w + x;
      if (!lane[i]) { if (ctx.tx.log) markCell(ctx, lane, i); else lane[i] = 1; marked++; }
    }
  };
  for (let s = 0; s < srcs.length - 1; s++) {
    if (!srcs[s].length) continue;
    dist.fill(Infinity); prev.fill(-1); goal.fill(0);
    let left = 0;
    for (let t = s + 1; t < srcs.length; t++) for (const j of srcs[t]) if (!goal[j]) { goal[j] = 1; left++; }
    heap.size = 0;
    for (const j of srcs[s]) { dist[j] = 0; heap.push(j, 0); }
    while (heap.size && left > 0) {
      const j = heap.pop(), d = heap.lastKey;
      if (d > dist[j]) continue;
      if (goal[j] === 1) { goal[j] = 2; left--; }
      const x = j % BW;
      for (let e = 0; e < 4; e++) {
        const k = e === 0 ? (x > 0 ? j - 1 : -1) : e === 1 ? (x < BW - 1 ? j + 1 : -1) : e === 2 ? j - BW : j + BW;
        if (k < 0 || k >= n || !free[k]) continue;
        const nd = d + cost[k];
        if (nd < dist[k]) { dist[k] = nd; prev[k] = j; heap.push(k, nd); }
      }
    }
    for (let t = s + 1; t < srcs.length; t++) {
      let best = -1;
      for (const j of srcs[t]) if (dist[j] < Infinity && (best < 0 || dist[j] < dist[best])) best = j;
      for (let j = best, guard = 0; j >= 0 && guard < n; j = prev[j], guard++) mark(j);
    }
  }
  return marked;
}

/** Arrival plazas in front of portals and a central plaza in big halls. Returns plaza cells. */
function plazas(cc: CC, ctx: PlaceCtx, a: Area, zone: Zone, portals: Portal[]): number {
  const rule = ZONE_RULES[zone], g = ctx.g;
  let n = 0;
  const put = (i: number) => { if (g.area[i] === a.id && g.cells[i] === FLOOR && !ctx.plaza[i]) { markCell(ctx, ctx.plaza, i); n++; } };
  if (rule.arrival > 0) for (const p of portals) {
    const R = Math.min(rule.arrival + 0.5, Math.max(rule.arrival, p.width / 2 + 1.2));
    const c0 = g.cellOf(p.x - R, p.z - R), c1 = g.cellOf(p.x + R, p.z + R);
    let any = false;
    for (let y = Math.max(a.y, c0[1]); y <= Math.min(a.y + a.h - 1, c1[1]); y++) for (let x = Math.max(a.x, c0[0]); x <= Math.min(a.x + a.w - 1, c1[0]); x++) {
      const [wx, wz] = g.center(x, y);
      const dx = wx - p.x, dz = wz - p.z;
      if (dx * p.nx + dz * p.nz < -0.3 || Math.hypot(dx, dz) > R) continue;
      put(g.idx(x, y)); any = true;
    }
    if (any) cc.sum.plazas.push({area: a.id, level: ctx.level, x0: r3(p.x - R), z0: r3(p.z - R), x1: r3(p.x + R), z1: r3(p.z + R), kind: 'arrival'});
  }
  const wM = a.w * CELL, hM = a.h * CELL;
  if (rule.plaza > 0 && Math.min(wM, hM) >= 12 && wM * hM >= 250) {
    const pw = Math.max(4, wM * rule.plaza), ph = Math.max(4, hM * rule.plaza);
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    const [x0, y0] = g.cellOf(cx - pw / 2, cz - ph / 2), [x1, y1] = g.cellOf(cx + pw / 2 - 1e-3, cz + ph / 2 - 1e-3);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g.idx(x, y));
    cc.sum.plazas.push({area: a.id, level: ctx.level, x0: r3(x0 * CELL), z0: r3(y0 * CELL), x1: r3((x1 + 1) * CELL), z1: r3((y1 + 1) * CELL), kind: 'centre'});
  }
  return n;
}

// --- cluster placement -------------------------------------------------------------------------

interface Placed { p: PropPlacement; slot: number }

function newRecord(cc: CC, ctx: PlaceCtx, a: Area, spec: ClusterSpec, placed: PropPlacement[], side?: Side, landmark = false): ClusterRecord {
  const id = cc.sum.clusters.length;
  for (const p of placed) { p.cluster = id; if (isP7Kind(p.kind)) cc.p7++; }
  const [cx, cz] = centreOf(placed);
  const rec: ClusterRecord = {id, type: spec.id, area: a.id, level: ctx.level, zone: zoneOf(cc.layout, a), x: cx, z: cz, side,
    members: placed.length, need: spec.slots.filter(s => s.need).length + (spec.mounts ?? []).filter(m => m.need).length, landmark, cover: !!spec.cover,
    reward: !!spec.reward || placed.some(p => p.purpose === 'storage')};
  cc.sum.clusters.push(rec);
  cc.sum.areas.find(r => r.area === a.id)?.clusters.push(id);
  const m = cc.cover.get(a.id);
  if (m !== undefined) cc.cover.set(a.id, m + placed.reduce((acc, p) => acc + (p.mounted || STRUCTURE_KINDS.has(p.kind) ? 0 : p.hx * p.hz * 4), 0));
  return rec;
}

/** Centre of placed members' footprint boxes. */
function centreOf(placed: readonly PropPlacement[]): [number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of placed) { x0 = Math.min(x0, p.x - p.hx); x1 = Math.max(x1, p.x + p.hx); z0 = Math.min(z0, p.z - p.hz); z1 = Math.max(z1, p.z + p.hz); }
  return [r3((x0 + x1) / 2), r3((z0 + z1) / 2)];
}
/** Commit a cluster when its actual centre keeps the spacing rule; else roll it back. */
function finish(cc: CC, ctx: PlaceCtx, a: Area, spec: ClusterSpec, placed: PropPlacement[], side?: Side, landmark = false): ClusterRecord | null {
  if (!placed.length) { rollback(ctx); return null; }
  const [x, z] = centreOf(placed);
  if (!spaced(cc, ctx.level, spec.id, x, z)) { rollback(ctx); return null; }
  // The zone's density cap on what was actually placed (the early estimate ignores low wall mounts).
  const foot = placed.reduce((acc, p) => acc + (p.mounted || STRUCTURE_KINDS.has(p.kind) ? 0 : p.hx * p.hz * 4), 0);
  if (!underCap(cc, a, zoneOf(cc.layout, a), foot)) { rollback(ctx); return null; }
  commit(ctx);
  return newRecord(cc, ctx, a, spec, placed, side, landmark);
}

/** Spacing: no cluster of the same type within its spacing and no other cluster centre within 3 m, on this level. */
function spaced(cc: CC, level: number, type: ClusterId, x: number, z: number): boolean {
  const sp = CLUSTERS[type].spacing;
  for (const c of cc.sum.clusters) {
    if (c.level !== level) continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < 3 || (c.type === type && d < sp)) return false;
  }
  return true;
}

function underCap(cc: CC, a: Area, zone: Zone, addM2: number): boolean {
  if (ZONE_RULES[zone].cap >= 1) return true;
  let m = cc.cover.get(a.id);
  if (m === undefined) cc.cover.set(a.id, (m = floorCoverage(cc.layout, a) * a.w * a.h * CELL * CELL));
  return (m + addM2) / Math.max(1, a.w * a.h * CELL * CELL) <= ZONE_RULES[zone].cap + 1e-9;
}

/** A floor member with its back (or long side) against `side` at `t`: wall-backed, doorway-clear, dresser checks. */
function wallMember(cc: CC, ctx: PlaceCtx, a: Area, side: Side, t: number, kind: PropKind, slot: Slot, base: number): PropPlacement | null {
  const d = PROP_DEFS[kind];
  const along = !!slot.along;
  const extent = along ? d.d : d.w, depth = along ? d.w : d.d;
  if (!backed(ctx, a, side, t - extent / 2, t + extent / 2, base)) return null;
  // Task mall-playtest-revision-20261031 (lane SHOPS, U09): a mall (strict-wall) vending machine also keeps its approach + passing lane
  if (ctx.strictWalls && kind === 'vending' && !along && !strictWallOk(ctx, a, side, t, kind)) return null;
  if (kind === 'vending' && vendingCapReached(ctx, a)) return null; // (U09: the mall storey's public vending cap; no-op elsewhere)
  const [x, z] = wallXZ(a, side, t, depth / 2 + 0.03);
  const rot = WALL_ROT[side] + (along ? Math.PI / 2 : 0);
  const {hx, hz} = footprint(kind, rot);
  if (propBlocksDoorway(cc.layout, x, z, hx, hz, base, d.h)) return null;
  if (along) {
    // Long side to the wall: keep a 0.9 m strip open in front of it.
    const [sx, sz] = wallXZ(a, side, t, depth + 0.03 + 0.45);
    const ns = side === 'N' || side === 'S';
    const [c0, c1, c2, c3] = cellsOfBox(sx, sz, ns ? extent / 2 : 0.45, ns ? 0.45 : extent / 2);
    for (let cy = c1; cy <= c3; cy++) for (let cx = c0; cx <= c2; cx++) if (!ctx.g.walkable(cx, cy)) return null;
  }
  const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z), rot, {front: along ? undefined : slot.front ?? 0.7});
  if (p && slot.purpose) p.purpose = slot.purpose;
  if (p && !along) reserveAhead(ctx, a, side, t, kind); // (U09: no-op outside the mall / for other kinds)
  return p;
}

/**
 * A wall mount beside the cluster's floor members. High mounts (y >= 0.9) hang on the wall (never block walking); low ones
 * (hose reels, extinguisher cabinets, payphones) are placed from the floor like iteration-07 low mounts: the box collides from
 * the floor (blocks its wall cell, keeps a 0.6 m approach) and the model renders `lift` metres up.
 */
function trailingMount(cc: CC, ctx: PlaceCtx, a: Area, side: Side, t: number, kind: PropKind, y: number, base: number): PropPlacement | null {
  if (y >= 0.9) return mountProp(ctx, a, side, t, kind, y, base);
  const d = PROP_DEFS[kind];
  if (!backed(ctx, a, side, t - d.w / 2, t + d.w / 2, base)) return null;
  const [x, z] = wallXZ(a, side, t, d.d / 2 + 0.03);
  const rot = WALL_ROT[side];
  const {hx, hz} = footprint(kind, rot);
  if (propBlocksDoorway(cc.layout, x, z, hx, hz, base, y + d.h)) return null;
  const [cx, cy] = ctx.g.cellOf(x, z);
  if (ctx.g.ceilAt(x, z) - base < y + d.h + 0.05 && ctx.g.hasCeil(ctx.g.idx(cx, cy))) return null;
  const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z), rot, {front: 0.6});
  if (!p) return null;
  p.lift = y;
  p.h = y + d.h;
  return p;
}

/** Resolve a cluster's members (palette, chance, alternatives); null when a required member is unavailable. */
function resolve(cc: CC, spec: ClusterSpec): {slot: number; kind: PropKind}[] | null {
  const out: {slot: number; kind: PropKind}[] = [];
  spec.slots.forEach((s, i) => {
    if (!s.need && s.chance !== undefined && !cc.rng.chance(s.chance)) return;
    const k = s.k.length > 1 ? pickKindRandom(cc, s.k) : pickKind(cc, s.k);
    if (k) out.push({slot: i, kind: k});
  });
  for (let i = 0; i < spec.slots.length; i++) if (spec.slots[i].need && !out.some(o => o.slot === i)) return null;
  return out;
}

const narrowOrTiny = (a: Area): boolean => Math.min(a.w, a.h) * CELL < 2.6 || a.w * a.h * CELL * CELL < 16;

/** Smallest start >= u whose footprint (dresser cells use a 4 cm inset) begins in a fresh 0.5 m cell. */
const nextCell = (u: number): number => Math.max(u, Math.ceil((u + 0.04) / CELL - 1e-6) * CELL - 0.03);

function memberExtent(kind: PropKind, slot: Slot): number {
  const d = PROP_DEFS[kind];
  return slot.along ? d.d : d.w;
}

/**
 * Wall cluster centred at `t` on `side` (members left to right, mounts above / after them, hung props in front). All-or-nothing
 * for required members; optional ones that do not fit are skipped. Returns the record or null (everything rolled back).
 */
function wallCluster(cc: CC, ctx: PlaceCtx, a: Area, spec: ClusterSpec, side: Side, t: number, o: {landmark?: boolean; members?: {slot: number; kind: PropKind}[]; run?: {s0: number; s1: number}} = {}): ClusterRecord | null {
  const zone = zoneOf(cc.layout, a);
  const resolved = o.members ?? resolve(cc, spec);
  if (!resolved) return null;
  // Narrow (< 2.6 m across: catwalks, bridges) or tiny (< 16 m2) areas keep their floor clear: wall mounts only.
  if (narrowOrTiny(a) && resolved.some(m => spec.slots[m.slot].need)) return null;
  const members = narrowOrTiny(a) ? [] : resolved.slice();
  // Mounts: drawn up front so trailing ones (after the last member) are part of the centred span.
  const mounts: {m: Mount; kind: PropKind}[] = [];
  for (const m of spec.mounts ?? []) {
    if (!m.need && m.chance !== undefined && !cc.rng.chance(m.chance)) continue;
    const kind = m.k.length > 1 ? pickKindRandom(cc, m.k) : pickKind(cc, m.k);
    if (!kind) { if (m.need) return null; continue; }
    if (m.over >= 0 && !members.some(q => q.slot === m.over)) { if (m.need) return null; continue; }
    mounts.push({m, kind});
  }
  const base = areaBase(cc.layout, a);
  const gaps = members.map((m, i) => (i === 0 ? 0 : spec.slots[m.slot].gap ?? 0.08));
  const widths = members.map(m => memberExtent(m.kind, spec.slots[m.slot]));
  const trailW = mounts.filter(q => q.m.over < 0).map(q => PROP_DEFS[q.kind].w);
  // Lay the strip out (members never share a 0.5 m grid cell: each starts at the next free cell boundary), then centre it on t.
  const layoutStrip = (start: number): {cs: number[]; ms: number[]; end: number} => {
    let u = start;
    const cs: number[] = [], ms: number[] = [];
    widths.forEach((w, k) => { if (k) u = nextCell(u + gaps[k]); cs.push(u + w / 2); u += w; });
    for (const w of trailW) { if (cs.length || ms.length) u = nextCell(u + 0.1); ms.push(u + w / 2); u += w; }
    return {cs, ms, end: u};
  };
  const [wlo, whi] = wallRange(a, side);
  const lo = Math.max(wlo + 0.15, o.run ? o.run.s0 : -Infinity), hi = Math.min(whi - 0.15, o.run ? o.run.s1 : Infinity);
  // Too long for the wall run here: shed optional members from the end (a compact vignette beats none).
  let total = layoutStrip(0).end;
  while (total > hi - lo) {
    let k = members.length - 1;
    while (k >= 0 && spec.slots[members[k].slot].need) k--;
    if (k < 0) {
      const tk = mounts.findIndex(q => q.m.over < 0 && !q.m.need);
      if (tk < 0) return null;
      trailW.splice(mounts.filter(q => q.m.over < 0).indexOf(mounts[tk]), 1);
      mounts.splice(tk, 1);
    } else {
      for (let q = mounts.length - 1; q >= 0; q--) if (mounts[q].m.over === members[k].slot) { if (mounts[q].m.need) return null; mounts.splice(q, 1); }
      members.splice(k, 1); gaps.splice(k, 1); widths.splice(k, 1);
      if (gaps.length) gaps[0] = 0;
    }
    total = layoutStrip(0).end;
  }
  if (total <= 0) return null;
  // Strip centred on t (kept inside the run), nudged so the first member's footprint starts on a cell boundary.
  const start = nextCell(Math.min(hi - total, Math.max(lo, t - total / 2)));
  const strip = layoutStrip(start);
  if (start < lo - 1e-6 || strip.end > hi + 1e-6) return null;
  const [cx0, cz0] = wallXZ(a, side, t, 0.5);
  if (!spaced(cc, ctx.level, spec.id, cx0, cz0)) return null;
  const foot = members.reduce((s, m) => s + PROP_DEFS[m.kind].w * PROP_DEFS[m.kind].d, 0);
  if (!underCap(cc, a, zone, foot)) return null;
  begin(ctx);
  const placed: Placed[] = [];
  const at: number[] = [];
  for (let k = 0; k < members.length; k++) {
    const tc = strip.cs[k];
    at[members[k].slot] = tc;
    const slot = spec.slots[members[k].slot];
    const p = wallMember(cc, ctx, a, side, tc, members[k].kind, slot, base);
    if (!p) { if (slot.need) { rollback(ctx); return null; } continue; }
    placed.push({p, slot: members[k].slot});
  }
  let tm = 0;
  for (const {m, kind} of mounts) {
    let p: PropPlacement | null = null;
    if (m.over >= 0) {
      const host = placed.find(q => q.slot === m.over)?.p;
      if (host) p = mountProp(ctx, a, side, at[m.over], kind, m.above ? Math.max(m.y, host.h + 0.06) : m.y, base);
    } else {
      // After the last member, side by side (a safety pier, a phone bank).
      p = trailingMount(cc, ctx, a, side, strip.ms[tm++], kind, m.y, base);
    }
    if (!p) { if (m.need) { rollback(ctx); return null; } continue; }
    placed.push({p, slot: -1});
  }
  if (!placed.length) { rollback(ctx); return null; }
  for (const h of spec.hangs ?? []) {
    if (h.chance !== undefined && !cc.rng.chance(h.chance)) continue;
    const kind = pickKind(cc, h.k);
    if (!kind || at[h.over] === undefined) continue;
    const [x, z] = wallXZ(a, side, at[h.over], h.out);
    const p = hangProp(ctx, a, kind, r3(x), r3(z), WALL_ROT[side], base);
    if (p) placed.push({p, slot: -1});
  }
  return finish(cc, ctx, a, spec, placed.map(q => q.p), side, o.landmark);
}

/**
 * Usable wall runs of one side of an area at floor level (m along the wall): backed by solid wall (no opening, no aperture) and
 * with the floor row in front of it outside door zones, platform-edge bands and stair approaches.
 */
const runCache = new WeakMap<PlaceCtx, Map<string, {s0: number; s1: number}[]>>();
function wallRuns(ctx: PlaceCtx, a: Area, side: Side): {s0: number; s1: number}[] {
  // Door zones, edge bands and walls do not change while composing: one computation per (context, area, side).
  let m = runCache.get(ctx);
  if (!m) runCache.set(ctx, (m = new Map()));
  const key = `${a.id}|${side}`;
  let r = m.get(key);
  if (!r) m.set(key, (r = wallRuns0(ctx, a, side)));
  return r;
}
function wallRuns0(ctx: PlaceCtx, a: Area, side: Side): {s0: number; s1: number}[] {
  const g = ctx.g;
  const alongX = side === 'N' || side === 'S';
  const behind = side === 'N' ? a.y - 1 : side === 'S' ? a.y + a.h : side === 'W' ? a.x - 1 : a.x + a.w;
  const front = side === 'N' ? a.y : side === 'S' ? a.y + a.h - 1 : side === 'W' ? a.x : a.x + a.w - 1;
  const [lo, hi] = wallRange(a, side);
  const open = (c: number) => {
    const [x, y] = alongX ? [c, behind] : [behind, c];
    if (!g.inBounds(x, y) || g.cells[g.idx(x, y)] !== 0 || ctx.aperture[g.idx(x, y)] === 1) return true;
    const [fx, fy] = alongX ? [c, front] : [front, c];
    const i = g.idx(fx, fy);
    return g.area[i] !== a.id || ctx.zone[i] === 1 || ctx.edge[i] === 1 || ctx.doorCell[i] === 1;
  };
  return wallBackedRuns(lo + 0.1, hi - 0.1, open, 0.05, 0.8).map(r => ({s0: r.s0, s1: r.s1}));
}

/** Candidate centres along all (or some) walls for a cluster of width `w`, scored (lower first). */
function wallCandidates(cc: CC, ctx: PlaceCtx, a: Area, w: number, sides: readonly Side[], score: (side: Side, t: number) => number): {side: Side; t: number; run: {s0: number; s1: number}}[] {
  const out: {side: Side; t: number; s: number; run: {s0: number; s1: number}}[] = [];
  for (const side of sides) for (const r of wallRuns(ctx, a, side)) {
    if (r.s1 - r.s0 < w + 0.2) continue;
    const step = r.s1 - r.s0 > 12 ? 1 : 0.5;
    for (let t = r.s0 + w / 2 + 0.1; t <= r.s1 - w / 2 - 0.1 + 1e-6; t += step) out.push({side, t: Math.round(t * 4) / 4, s: score(side, t) + cc.rng.next() * 0.8, run: r});
  }
  out.sort((p, q) => p.s - q.s);
  return out;
}

/** Width of a cluster's required members (+ required trailing mounts): wall runs shorter than this cannot hold it. */
function minWidth(spec: ClusterSpec): number {
  let w = 0, n = 0;
  for (const s of spec.slots) if (s.need) { const k = s.k[0]; w += (s.along ? PROP_DEFS[k].d : PROP_DEFS[k].w); n++; }
  for (const m of spec.mounts ?? []) if (m.need && m.over < 0) { w += PROP_DEFS[m.k[0]].w; n++; }
  return Math.max(0.6, w + Math.max(0, n - 1) * 0.3);
}

/** Try a wall cluster at the best candidates; returns the record or null. */
function tryWall(cc: CC, ctx: PlaceCtx, a: Area, id: ClusterId, sides: readonly Side[], score: (side: Side, t: number) => number, tries = 10, landmark = false): ClusterRecord | null {
  const spec = CLUSTERS[id];
  const cands = wallCandidates(cc, ctx, a, minWidth(spec), sides, score);
  for (let i = 0; i < Math.min(tries, cands.length); i++) {
    const r = wallCluster(cc, ctx, a, spec, cands[i].side, cands[i].t, {landmark, run: cands[i].run});
    if (r) return r;
  }
  return null;
}

const ALL_SIDES: readonly Side[] = ['N', 'S', 'E', 'W'];
const longSides = (a: Area): Side[] => (a.w >= a.h ? ['N', 'S'] : ['W', 'E']);
const shortSides = (a: Area): Side[] => (a.w >= a.h ? ['W', 'E'] : ['N', 'S']);
/** World point of `t` on a wall (at the face). */
const wallPoint = (a: Area, side: Side, t: number): [number, number] => wallXZ(a, side, t, 0);
const nearPoint = (a: Area, px: number, pz: number) => (side: Side, t: number) => { const [x, z] = wallPoint(a, side, t); return Math.hypot(x - px, z - pz); };
/** Prefer spots far from other clusters on the level (spread vignettes out), but not jammed into a corner. */
const spread = (cc: CC, a: Area, level: number) => {
  // Clusters within reach of this area (centres), gathered once per call.
  const xs: number[] = [], zs: number[] = [];
  const x0 = a.x * CELL - 18, x1 = (a.x + a.w) * CELL + 18, z0 = a.y * CELL - 18, z1 = (a.y + a.h) * CELL + 18;
  for (const c of cc.sum.clusters) if (c.level === level && c.x > x0 && c.x < x1 && c.z > z0 && c.z < z1) { xs.push(c.x); zs.push(c.z); }
  return (side: Side, t: number) => {
    const [x, z] = wallPoint(a, side, t);
    let m2 = 324;
    for (let i = 0; i < xs.length; i++) { const dx = xs[i] - x, dz = zs[i] - z, d = dx * dx + dz * dz; if (d < m2) m2 = d; }
    const [lo, hi] = wallRange(a, side);
    const corner = Math.min(t - lo, hi - t);
    return -Math.sqrt(m2) + (corner < 2.5 ? (2.5 - corner) * 2 : 0);
  };
};

/**
 * Open island group (checkpoint / cover): members in a line along `axisX` centred at (cx, cz), a 0.9 m walkway ring around the
 * group's box (reserved), never on lanes / plazas. Returns the record or null.
 */
function openCluster(cc: CC, ctx: PlaceCtx, a: Area, spec: ClusterSpec, cx: number, cz: number, axisX: boolean): ClusterRecord | null {
  if (narrowOrTiny(a)) return null;
  const zone = zoneOf(cc.layout, a);
  const members = resolve(cc, spec);
  if (!members) return null;
  if (!spaced(cc, ctx.level, spec.id, cx, cz)) return null;
  const rot = axisX ? 0 : Math.PI / 2;
  const widths = members.map(m => PROP_DEFS[m.kind].w);
  // Members a cell apart at least (0.35 m gap rounded up to the next cell boundary).
  const offs: number[] = [];
  let u = 0;
  widths.forEach((w, k) => { if (k) u = nextCell(u + 0.35); offs.push(u + w / 2); u += w; });
  const total = u;
  const depth = Math.max(...members.map(m => PROP_DEFS[m.kind].d));
  const hx = axisX ? total / 2 : depth / 2, hz = axisX ? depth / 2 : total / 2;
  const foot = members.reduce((s, m) => s + PROP_DEFS[m.kind].w * PROP_DEFS[m.kind].d, 0);
  if (!underCap(cc, a, zone, foot)) return null;
  const g = ctx.g;
  // Ring: open floor of this area all round the group (0.9 m).
  const [x0, y0, x1, y1] = cellsOfBox(cx, cz, hx + 0.9, hz + 0.9);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!g.walkable(x, y)) return null;
    const i = g.idx(x, y);
    if (g.area[i] !== a.id || ctx.doorCell[i] || ctx.edge[i]) return null;
  }
  begin(ctx);
  const placed: PropPlacement[] = [];
  for (let k = 0; k < members.length; k++) {
    const c = offs[k] - total / 2;
    const x = axisX ? cx + c : cx, z = axisX ? cz : cz + c;
    // Stagger alternate members a little (a line of barricades is never ruler straight).
    const off = k % 2 ? 0.12 : -0.06;
    const px = r3(axisX ? x : x + off), pz = r3(axisX ? z + off : z);
    const {hx: mx, hz: mz} = footprint(members[k].kind, rot);
    const slot = spec.slots[members[k].slot];
    const p = propBlocksDoorway(cc.layout, px, pz, mx, mz, areaBase(cc.layout, a), PROP_DEFS[members[k].kind].h) ? null : tryPlaceProp(ctx, a, members[k].kind, px, pz, rot, {});
    if (!p) { if (slot.need) { rollback(ctx); return null; } continue; }
    placed.push(p);
  }
  if (!placed.length) { rollback(ctx); return null; }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = g.idx(x, y); if (!g.blocked[i]) markCell(ctx, ctx.keep, i); }
  return finish(cc, ctx, a, spec, placed);
}

/** Loose items dropped around an anchor point (evacuation traces): each with a small walkway ring. */
function scatterCluster(cc: CC, ctx: PlaceCtx, a: Area, spec: ClusterSpec, px: number, pz: number, radius: number): ClusterRecord | null {
  if (narrowOrTiny(a)) return null;
  const members = resolve(cc, spec);
  if (!members) return null;
  if (!spaced(cc, ctx.level, spec.id, px, pz)) return null;
  const zone = zoneOf(cc.layout, a);
  const base = areaBase(cc.layout, a);
  begin(ctx);
  const placed: PropPlacement[] = [];
  for (const m of members) {
    const slot = spec.slots[m.slot];
    const n = slot.n ? cc.rng.int(slot.n[0], slot.n[1]) : 1;
    let got = 0;
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < 18; t++) {
        const ang = cc.rng.range(0, Math.PI * 2), r = cc.rng.range(0.4, radius);
        const x = Math.round((px + Math.cos(ang) * r) * 4) / 4, z = Math.round((pz + Math.sin(ang) * r) * 4) / 4;
        const rot = cc.rng.int(0, 3) * Math.PI / 2 - Math.PI / 2;
        const {hx, hz} = footprint(m.kind, rot);
        if (!underCap(cc, a, zone, hx * hz * 4)) break;
        if (propBlocksDoorway(cc.layout, x, z, hx, hz, base, PROP_DEFS[m.kind].h)) continue;
        const p = tryPlaceProp(ctx, a, m.kind, x, z, rot, {ring: 0.6});
        if (p) { placed.push(p); got++; break; }
      }
    }
    if (slot.need && !got) { rollback(ctx); return null; }
  }
  return finish(cc, ctx, a, spec, placed);
}

// --- landmarks ---------------------------------------------------------------------------------

/** March from a portal across the area; the end (if solid wall) and the length. */
function sightline(ctx: PlaceCtx, a: Area, p: Portal): {side: Side; t: number; len: number; x: number; z: number} | null {
  const g = ctx.g;
  const step = CELL / 2;
  // Start just inside the area.
  let x = p.x + p.nx * 0.3, z = p.z + p.nz * 0.3, len = 0;
  for (let k = 0; k < 2000; k++) {
    const nx = x + p.nx * step, nz = z + p.nz * step;
    const [cx, cy] = g.cellOf(nx, nz);
    if (!g.inBounds(cx, cy)) return null;
    const i = g.idx(cx, cy);
    const inside = g.area[i] === a.id && cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h;
    if (!inside) {
      if (g.cells[i] !== 0) return null;   // looks through an opening / into another area: no wall to hold a landmark
      const side: Side = p.nz > 0 ? 'S' : p.nz < 0 ? 'N' : p.nx > 0 ? 'E' : 'W';
      return {side, t: side === 'N' || side === 'S' ? p.x : p.z, len, x, z};
    }
    if (g.sightBlocked[i]) return null;   // the view is blocked (a cabinet / column in the axis)
    x = nx; z = nz; len += step;
  }
  return null;
}

function landmark(cc: CC, ctx: PlaceCtx, a: Area, zone: Zone, portals: Portal[]): void {
  const rule = ZONE_RULES[zone];
  if (!rule.landmarks.length) return;
  // Straight through each portal, and turning left / right along the area's long axis just inside it (an upper deck entered from
  // its stair landing looks out over the light well, but along the deck to its end wall).
  const views: Portal[] = [];
  for (const p of portals) {
    views.push(p);
    const alongX = a.w >= a.h;
    if ((alongX && p.nx !== 0) || (!alongX && p.nz !== 0)) continue;
    for (const dir of [-1, 1]) views.push({...p, x: p.x + p.nx * 1.5, z: p.z + p.nz * 1.5, nx: alongX ? dir : 0, nz: alongX ? 0 : dir});
  }
  const lines = views.map(p => ({p, s: sightline(ctx, a, p)})).filter(q => q.s && q.s.len >= 7).sort((p, q) => q.s!.len - p.s!.len);
  let done = 0;
  for (const {p, s} of lines) {
    if (done >= (a.w * a.h * CELL * CELL > 900 ? 2 : 1)) break;
    let rec: ClusterRecord | null = null;
    // Weighted order (Efraimidis-Spirakis keys); a type the station already has as a landmark counts a third.
    const order = rule.landmarks.map(([id, w]) => ({id, k: Math.pow(cc.rng.next(), 1 / (w * (cc.sum.landmarks.some(l => cc.sum.clusters[l.cluster].type === id) ? 0.33 : 1)))}))
      .sort((p, q) => q.k - p.k).map(o => o.id);
    for (const id of order) {
      const spec = CLUSTERS[id];
      if (!spec.zones.includes(zone)) continue;
      const run = wallRuns(ctx, a, s!.side).find(r => r.s0 - 2 <= s!.t && r.s1 + 2 >= s!.t);
      if (!run) continue;
      for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) { rec = wallCluster(cc, ctx, a, spec, s!.side, Math.round((s!.t + off) * 4) / 4, {landmark: true, run}); if (rec) break; }
      if (rec) break;
    }
    if (!rec) continue;
    done++;
    // A clock hung on the axis between the arrival and the landmark.
    let clock = false;
    if (rule.clock && available(cc, 'platformClock')) {
      const d = Math.min(12, Math.max(4, s!.len * 0.42));
      const cl = hangProp(ctx, a, 'platformClock', r3(p.x + p.nx * d), r3(p.z + p.nz * d), Math.atan2(-p.nx, -p.nz), areaBase(cc.layout, a));
      if (cl) { cl.cluster = rec.id; rec.members++; cc.p7++; clock = true; }
    }
    cc.sum.landmarks.push({cluster: rec.id, area: a.id, level: ctx.level, via: p.via, from: {x: r3(p.x), z: r3(p.z)}, to: {x: rec.x, z: rec.z}, len: r3(s!.len), clock});
  }
}

// --- zone programs -------------------------------------------------------------------------------

type Program = (cc: CC, ctx: PlaceCtx, a: Area, portals: Portal[]) => void;
const PROGRAM_ORDER: readonly Zone[] = ['lower', 'upper', 'platform', 'ticketing', 'concourse', 'service', 'retail', 'food', 'passage', 'exit'];
const m2 = (a: Area) => a.w * a.h * CELL * CELL;
const lenM = (a: Area) => Math.max(a.w, a.h) * CELL;
const nearPortal = (cc: CC, a: Area, portals: Portal[]) => {
  const p = portals.length ? cc.rng.pick(portals) : null;
  return p ? nearPoint(a, p.x, p.z) : spread(cc, a, 0);
};
/** Several clusters of a type spread along the area's walls. */
function repeatWall(cc: CC, ctx: PlaceCtx, a: Area, id: ClusterId, n: number, sides: readonly Side[]): number {
  let got = 0;
  for (let i = 0; i < n; i++) if (tryWall(cc, ctx, a, id, sides, spread(cc, a, ctx.level), 8)) got++;
  return got;
}

/** Evacuation traces in front of portals leading out (exits / passages / stairs). */
function evacuationNear(cc: CC, ctx: PlaceCtx, a: Area, portals: Portal[], chance: number, max: number): void {
  let n = 0;
  for (const p of cc.rng.shuffle(portals.slice())) {
    if (n >= max) break;
    if (!cc.rng.chance(chance)) continue;
    const out = cc.rng.range(3.2, 5);
    const side = (cc.rng.chance(0.5) ? 1 : -1) * cc.rng.range(1.6, 3);
    const px = p.x + p.nx * out + p.nz * side, pz = p.z + p.nz * out + p.nx * side;
    if (scatterCluster(cc, ctx, a, CLUSTERS.evacuation, px, pz, 1.6)) n++;
  }
}

/** Fare doors of an area (ticket hall / paid concourse). */
const fareDoors = (ctx: PlaceCtx, a: Area) => (ctx.doorsOf.get(a.id) ?? []).filter(d => d.fare);

function securityAtFare(cc: CC, ctx: PlaceCtx, a: Area): void {
  for (const d of fareDoors(ctx, a)) {
    const side = doorSide(d, a);
    const mid = d.h === 1 ? (d.x + d.w / 2) * CELL : (d.y + d.h / 2) * CELL;
    const half = (d.h === 1 ? d.w : d.h) * CELL / 2;
    // Beside the gate array on the fare wall (outside its door zone), else on the walls next to it.
    const score = (s: Side, t: number) => (s === side ? Math.abs(Math.abs(t - mid) - half - 3.5) : 6 + nearPoint(a, ...doorXZ(d))(s, t));
    tryWall(cc, ctx, a, 'securityPost', ALL_SIDES, score, 14);
    if (available(cc, 'fareValidatorStand')) tryWall(cc, ctx, a, 'validators', [side, ...ALL_SIDES.filter(s => s !== side)], score, 10);
  }
}
const doorXZ = (d: Door): [number, number] => [(d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL];

const PROGRAMS: Partial<Record<Zone, Program>> = {
  platform: (cc, ctx, a, portals) => {
    platformBays(cc, ctx, a);
    const island = a.edge === 'NS';
    const back: Side[] = island ? [] : [a.edge === 'N' ? 'S' : 'N'];
    // Work zone on an end wall first (the landmark at the end of the platform view), away from the track edge.
    if (cc.rng.chance(0.85)) {
      const ends = cc.rng.shuffle(shortSides(a).slice());
      const mid = island ? (a.y + a.h / 2) * CELL : (a.edge === 'N' ? a.y + a.h * 0.7 : a.y + a.h * 0.3) * CELL;
      for (const s of ends) {
        // The end wall itself, else the back wall in the last metres before that end (platform ends are often openings).
        const endX = s === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
        const rec = tryWall(cc, ctx, a, 'workZone', [s], (_, t) => Math.abs(t - mid), 10, true)
          ?? (back.length ? tryWall(cc, ctx, a, 'workZone', back, (_, t) => (Math.abs(t - endX) < 9 ? Math.abs(t - endX) : 99), 8, true) : null);
        if (rec) { cc.sum.landmarks.push({cluster: rec.id, area: a.id, level: ctx.level, via: 'door', from: {x: r3(s === 'W' ? (a.x + a.w) * CELL : a.x * CELL), z: rec.z}, to: {x: rec.x, z: rec.z}, len: r3(Math.abs(rec.x - (s === 'W' ? (a.x + a.w) * CELL : a.x * CELL))), clock: false}); break; }
      }
    }
    if (cc.triage < 1 && cc.rng.chance(0.3)) { if (tryWall(cc, ctx, a, 'triage', back.length ? back : shortSides(a), spread(cc, a, ctx.level), 10)) cc.triage++; }
    // Safety points about every 45 m along the back wall (or the end walls of an island), near portals first.
    const nSafety = Math.max(1, Math.round(lenM(a) / 45));
    for (let i = 0; i < nSafety; i++) tryWall(cc, ctx, a, 'safetyPoint', back.length ? back : shortSides(a), i === 0 ? nearPortal(cc, a, portals) : spread(cc, a, ctx.level), 8);
    if (back.length && cc.rng.chance(0.7)) tryWall(cc, ctx, a, 'phoneBank', back, nearPortal(cc, a, portals), 8);
    if (back.length && cc.rng.chance(0.4)) tryWall(cc, ctx, a, 'validators', back, nearPortal(cc, a, portals), 6);
    if (back.length) repeatWall(cc, ctx, a, 'waiting', cc.rng.int(0, 1), back);
    evacuationNear(cc, ctx, a, portals, 0.4, cc.rng.int(1, 2));
  },
  concourse: (cc, ctx, a, portals) => hallProgram(cc, ctx, a, portals, 'concourse'),
  ticketing: (cc, ctx, a, portals) => hallProgram(cc, ctx, a, portals, 'ticketing'),
  upper: (cc, ctx, a, portals) => hallProgram(cc, ctx, a, portals, 'upper'),
  retail: (cc, ctx, a, portals) => {
    const sides = longSides(a);
    if (cc.rng.chance(0.5)) tryWall(cc, ctx, a, 'capsuleCorner', sides, spread(cc, a, ctx.level), 8);
    if (cc.rng.chance(0.45)) tryWall(cc, ctx, a, 'newsCorner', sides, nearPortal(cc, a, portals), 8);
    repeatWall(cc, ctx, a, 'waiting', lenM(a) > 40 ? 2 : 1, sides);
    tryWall(cc, ctx, a, 'safetyPoint', sides, nearPortal(cc, a, portals), 8);
    if (cc.rng.chance(0.3)) tryWall(cc, ctx, a, 'serviceCart', sides, nearPortal(cc, a, portals), 6);
    evacuationNear(cc, ctx, a, portals, 0.2, 1);
  },
  food: (cc, ctx, a) => {
    repeatWall(cc, ctx, a, 'busing', cc.rng.int(1, 2), ALL_SIDES);
    if (cc.rng.chance(0.3)) tryWall(cc, ctx, a, 'capsuleCorner', ALL_SIDES, spread(cc, a, ctx.level), 6);
    if (cc.rng.chance(0.3)) tryWall(cc, ctx, a, 'cleaning', ALL_SIDES, spread(cc, a, ctx.level), 6);
    tryWall(cc, ctx, a, 'safetyPoint', ALL_SIDES, spread(cc, a, ctx.level), 6);
  },
  passage: (cc, ctx, a, portals) => {
    const long = lenM(a) >= 20;
    const sides = longSides(a);
    if (long && (a.role === 'transfer' || a.role === 'escalator') && cc.rng.chance(0.6)) tryWall(cc, ctx, a, 'waiting', sides, spread(cc, a, ctx.level), 6);
    if (lenM(a) >= 16 && cc.rng.chance(0.7)) tryWall(cc, ctx, a, 'safetyPoint', sides, spread(cc, a, ctx.level), 6);
    if (long && a.role !== 'catwalk' && cc.rng.chance(0.25)) tryWall(cc, ctx, a, 'phoneBank', sides, spread(cc, a, ctx.level), 6);
    if (long && a.type === 'passage' && cc.rng.chance(0.25)) tryWall(cc, ctx, a, 'shoeShine', sides, spread(cc, a, ctx.level), 6);
    evacuationNear(cc, ctx, a, portals, 0.2, 1);
  },
  exit: (cc, ctx, a, portals) => {
    // Luggage piled in front of the sealed grille: people tried to get out here.
    const grille = cc.layout.props.find(p => p.area === a.id && p.kind === 'exitStair');
    if (grille && cc.rng.chance(0.6)) {
      const fx = Math.round(Math.sin(grille.rot)), fz = Math.round(Math.cos(grille.rot));
      const sd = PROP_DEFS.exitStair.d / 2;
      scatterCluster(cc, ctx, a, CLUSTERS.evacuation, grille.x + fx * (sd + 1.3), grille.z + fz * (sd + 1.3), 1.4);
    }
    if (cc.rng.chance(0.3)) tryWall(cc, ctx, a, 'newsCorner', longSides(a), nearPortal(cc, a, portals), 4);
  },
  service: (cc, ctx, a, portals) => serviceProgram(cc, ctx, a, portals, 'service'),
  lower: (cc, ctx, a, portals) => serviceProgram(cc, ctx, a, portals, 'lower'),
};

/** Ticket halls, concourses and the upper concourse. */
function hallProgram(cc: CC, ctx: PlaceCtx, a: Area, portals: Portal[], zone: Zone): void {
  const sides = longSides(a);
  if (zone === 'ticketing' || (zone === 'concourse' && a.paid)) securityAtFare(cc, ctx, a);
  if (zone === 'upper' && cc.rng.chance(0.4)) tryWall(cc, ctx, a, 'securityPost', ALL_SIDES, nearPortal(cc, a, portals), 8);
  const waiting = Math.max(1, Math.min(3, Math.round(Math.max(a.w, a.h) * CELL / 26)));
  repeatWall(cc, ctx, a, 'waiting', waiting, zone === 'upper' ? ALL_SIDES : sides);
  if (!cc.sum.clusters.some(c => c.area === a.id && c.type === 'infoPoint') && cc.rng.chance(0.45)) tryWall(cc, ctx, a, 'infoPoint', ALL_SIDES, spread(cc, a, ctx.level), 8);
  if (cc.rng.chance(zone === 'ticketing' ? 0.6 : 0.4)) tryWall(cc, ctx, a, 'phoneBank', ALL_SIDES, nearPortal(cc, a, portals), 8);
  const nSafety = m2(a) > 700 ? 2 : 1;
  for (let i = 0; i < nSafety; i++) tryWall(cc, ctx, a, 'safetyPoint', ALL_SIDES, i === 0 ? nearPortal(cc, a, portals) : spread(cc, a, ctx.level), 8);
  if (!a.paid && zone !== 'upper' && cc.rng.chance(0.35)) tryWall(cc, ctx, a, 'capsuleCorner', ALL_SIDES, spread(cc, a, ctx.level), 6);
  if (cc.rng.chance(0.3)) tryWall(cc, ctx, a, 'newsCorner', ALL_SIDES, nearPortal(cc, a, portals), 6);
  // Cover: a checkpoint island in big halls, off the lanes and the centre plaza.
  if (m2(a) >= 380 && cc.rng.chance(zone === 'upper' ? 0.35 : 0.55)) openIsland(cc, ctx, a, 'checkpoint');
  if (cc.triage < 1 && zone !== 'ticketing' && cc.rng.chance(0.15)) { if (tryWall(cc, ctx, a, 'triage', ALL_SIDES, spread(cc, a, ctx.level), 8)) cc.triage++; }
  // Exits: luggage near the doors to the sealed street exits (and near portals of the upper level).
  const exitDoors = portals.filter(p => p.door && cc.layout.areas[p.door.a === a.id ? p.door.b : p.door.a]?.type === 'exit-stair');
  evacuationNear(cc, ctx, a, exitDoors.length ? exitDoors : portals, exitDoors.length ? 0.35 : 0.2, 1);
  if (zone === 'upper' && cc.caches < 4 && cc.rng.chance(0.6)) farCorner(cc, ctx, a, portals, 'cache');
}

/** Service corridors and the lower service level. */
function serviceProgram(cc: CC, ctx: PlaceCtx, a: Area, portals: Portal[], zone: Zone): void {
  const sides = longSides(a);
  // Dead ends: the short walls without an opening. The end facing the longest view holds a landmark (landmark()) — the other
  // dead end gets a cache, tucked out of the way.
  for (const s of shortSides(a)) {
    const runs = wallRuns(ctx, a, s);
    const [lo, hi] = wallRange(a, s);
    const solid = runs.some(r => r.s1 - r.s0 >= hi - lo - 0.6);
    if (!solid) continue;
    if (cc.caches < 4 && cc.rng.chance(zone === 'lower' ? 0.8 : 0.55)) {
      // Tucked against a long wall in the last metres before the dead end (the end wall itself holds the landmark).
      const [ex, ez] = wallPoint(a, s, (lo + hi) / 2);
      if (tryWall(cc, ctx, a, 'cache', longSides(a), nearPoint(a, ex, ez), 6)) cc.caches++;
    }
  }
  if (zone === 'lower') {
    repeatWall(cc, ctx, a, 'plantSkid', m2(a) > 120 ? 2 : 1, ALL_SIDES);
    if (cc.rng.chance(0.7)) tryWall(cc, ctx, a, 'electricalBank', ALL_SIDES, spread(cc, a, ctx.level), 8);
    if (cc.rng.chance(0.6)) tryWall(cc, ctx, a, 'maintenanceBay', ALL_SIDES, spread(cc, a, ctx.level), 8);
    if (cc.rng.chance(0.4)) tryWall(cc, ctx, a, 'workZone', ALL_SIDES, spread(cc, a, ctx.level), 6);
    if (cc.rng.chance(0.35)) tryWall(cc, ctx, a, 'cleaning', ALL_SIDES, spread(cc, a, ctx.level), 6);
    if (cc.rng.chance(0.3)) tryWall(cc, ctx, a, 'breakNook', ALL_SIDES, spread(cc, a, ctx.level), 6);
    if (cc.rng.chance(0.5)) tryWall(cc, ctx, a, 'supplyShelf', ALL_SIDES, spread(cc, a, ctx.level), 6);
    // Combat space: cover islands.
    for (let i = 0, n = m2(a) > 150 ? 2 : 1; i < n; i++) openIsland(cc, ctx, a, 'checkpoint');
    if (cc.caches < 4 && cc.rng.chance(0.6)) farCorner(cc, ctx, a, portals, 'cache');
    tryWall(cc, ctx, a, 'safetyPoint', ALL_SIDES, nearPortal(cc, a, portals), 6);
    return;
  }
  const long = lenM(a) >= 14;
  if (long && cc.rng.chance(0.55)) tryWall(cc, ctx, a, 'maintenanceBay', sides, spread(cc, a, ctx.level), 8);
  if (cc.rng.chance(0.5)) {
    // A cart parked just beside a door.
    const ds = portals.filter(p => p.door);
    if (ds.length) { const p = cc.rng.pick(ds); tryWall(cc, ctx, a, 'serviceCart', sides, (s, t) => Math.abs(nearPoint(a, p.x, p.z)(s, t) - 1.8), 8); }
  }
  if (cc.rng.chance(0.4)) tryWall(cc, ctx, a, 'refuse', sides, nearPortal(cc, a, portals), 6);
  if (cc.rng.chance(0.55)) tryWall(cc, ctx, a, 'supplyShelf', sides, spread(cc, a, ctx.level), 6);
  if (a.label.startsWith('Signal') && cc.rng.chance(0.5)) tryWall(cc, ctx, a, 'breakNook', sides, spread(cc, a, ctx.level), 6);
  if (cc.rng.chance(0.2)) tryWall(cc, ctx, a, 'cleaning', sides, spread(cc, a, ctx.level), 6);
  if (lenM(a) >= 18 && cc.rng.chance(0.5)) tryWall(cc, ctx, a, 'safetyPoint', sides, nearPortal(cc, a, portals), 6);
}

/** Checkpoint / cover island at an open spot of the area (not lane / plaza, away from walls). */
function openIsland(cc: CC, ctx: PlaceCtx, a: Area, id: ClusterId): ClusterRecord | null {
  const g = ctx.g;
  const axisX = a.w >= a.h;
  const cands: [number, number][] = [];
  for (let y = a.y + 3; y < a.y + a.h - 3; y += 2) for (let x = a.x + 3; x < a.x + a.w - 3; x += 2) {
    const i = g.idx(x, y);
    if (g.area[i] !== a.id || !g.walkable(x, y) || ctx.lane[i] || ctx.plaza[i] || ctx.keep[i]) continue;
    cands.push(g.center(x, y));
  }
  cc.rng.shuffle(cands);
  for (let k = 0; k < Math.min(40, cands.length); k++) {
    const r = openCluster(cc, ctx, a, CLUSTERS[id], cands[k][0], cands[k][1], cc.rng.chance(0.5) ? axisX : !axisX);
    if (r) return r;
  }
  return null;
}

/** Cache in the wall spot farthest (walking) from the area's portals. */
function farCorner(cc: CC, ctx: PlaceCtx, a: Area, portals: Portal[], id: ClusterId): ClusterRecord | null {
  if (!portals.length) return null;
  const score = (s: Side, t: number) => { const [x, z] = wallPoint(a, s, t); return -Math.min(...portals.map(p => Math.hypot(p.x - x, p.z - z))); };
  const r = tryWall(cc, ctx, a, id, ALL_SIDES, score, 10);
  if (r && id === 'cache') cc.caches++;
  return r;
}

/**
 * Platform column bays: benches sit between columns (legacy dressing); a bay with a bench gets a bin at a column and sometimes a
 * newspaper box (bayWaiting); an empty bay may hold a barricade (cover) on the column line.
 */
function platformBays(cc: CC, ctx: PlaceCtx, a: Area): void {
  const cols = cc.layout.props.filter(p => p.area === a.id && p.kind === 'column' && propLevelEq(p, ctx.level));
  const rows = new Map<number, PropPlacement[]>();
  for (const c of cols) { const k = Math.round(c.z * 4); let l = rows.get(k); if (!l) rows.set(k, (l = [])); l.push(c); }
  const benches = cc.layout.props.filter(p => p.area === a.id && p.kind === 'bench');
  let covers = 0;
  const maxCover = Math.max(1, Math.round(lenM(a) / 45));
  for (const list of rows.values()) {
    list.sort((p, q) => p.x - q.x);
    for (let i = 0; i + 1 < list.length; i++) {
      const c0 = list[i], c1 = list[i + 1];
      if (c1.x - c0.x > 9) continue;
      const mx = (c0.x + c1.x) / 2, z = c0.z;
      const bench = benches.find(b => Math.abs(b.x - mx) < 0.6 && Math.abs(b.z - z) < 0.6);
      if (bench) {
        if (!cc.rng.chance(0.5)) continue;
        bayCluster(cc, ctx, a, c0, c1, bench);
      } else if (covers < maxCover && cc.rng.chance(0.4)) {
        if (openBay(cc, ctx, a, mx, z)) covers++;
      }
    }
  }
}
const propLevelEq = (p: PropPlacement, level: number) => (p.level ?? 0) === level;

function bayCluster(cc: CC, ctx: PlaceCtx, a: Area, c0: PropPlacement, c1: PropPlacement, bench: PropPlacement): ClusterRecord | null {
  const spec = CLUSTERS.bayWaiting;
  const members = resolve(cc, spec);
  if (!members) return null;
  if (!spaced(cc, ctx.level, 'bayWaiting', bench.x, bench.z)) return null;
  const zone = zoneOf(cc.layout, a);
  if (!underCap(cc, a, zone, 0.6)) return null;
  begin(ctx);
  const placed: PropPlacement[] = [];
  const left = cc.rng.chance(0.5);
  for (const m of members) {
    const isBin = m.kind === 'bin';
    const col = isBin === left ? c0 : c1;
    const dir = col === c0 ? 1 : -1;   // toward the bench
    const d = PROP_DEFS[m.kind];
    const x = r3(col.x + dir * (col.hx + d.w / 2 + 0.08));
    // Newspaper boxes face the walking side (the bench's facing); bins sit on the column line.
    const p = tryPlaceProp(ctx, a, m.kind, x, bench.z, bench.rot, {checkZone: false, front: isBin ? undefined : 0.6});
    if (!p) { if (spec.slots[m.slot].need) { rollback(ctx); return null; } continue; }
    placed.push(p);
  }
  return finish(cc, ctx, a, spec, placed);
}

function openBay(cc: CC, ctx: PlaceCtx, a: Area, x: number, z: number): ClusterRecord | null {
  const spec = CLUSTERS.cover;
  const members = resolve(cc, spec);
  if (!members) return null;
  if (!spaced(cc, ctx.level, 'cover', x, z)) return null;
  const kind = members[0].kind;
  const {hx, hz} = footprint(kind, 0);
  if (!underCap(cc, a, zoneOf(cc.layout, a), hx * hz * 4)) return null;
  if (!boxClear(ctx, x - hx, x + hx, 0, PROP_DEFS[kind].h, z - hz, z + hz)) return null;
  begin(ctx);
  const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z + (cc.rng.chance(0.5) ? 0.1 : -0.1)), 0, {checkZone: false});
  if (!p) { rollback(ctx); return null; }
  return finish(cc, ctx, a, spec, [p]);
}

// ---------------------------------------------------------------------------------------------
// QA / tests

/** Per-area composition summary for the browser review (labels, zone, clusters with members, landmarks, plazas). */
export function compositionSummary(layout: StationLayout) {
  const sum = compositionOf(layout);
  if (!sum) return null;
  const byCluster = new Map<number, string[]>();
  for (const p of layout.props) if (p.cluster !== undefined) { let l = byCluster.get(p.cluster); if (!l) byCluster.set(p.cluster, (l = [])); l.push(p.kind); }
  const counts: Record<string, number> = {};
  for (const c of sum.clusters) counts[c.type] = (counts[c.type] ?? 0) + 1;
  return {
    counts,
    clusters: sum.clusters.length, landmarks: sum.landmarks.length, covers: sum.clusters.filter(c => c.cover).length, rewards: sum.clusters.filter(c => c.reward).length,
    areas: sum.areas.map(r => {
      const a = layout.areas[r.area];
      return {area: r.area, label: a.label, type: a.type, level: r.level, zone: r.zone, m2: Math.round(m2(a)), portals: r.portals, laneCells: r.lane, plazaCells: r.plaza, coverage: r.coverage, cap: r.cap,
        clusters: r.clusters.map(id => { const c = sum.clusters[id]; return {id, type: c.type, x: c.x, z: c.z, side: c.side ?? null, landmark: c.landmark, members: byCluster.get(id) ?? []}; })};
    }).filter(r => r.clusters.length || r.laneCells || r.plazaCells),
    landmarkViews: sum.landmarks.map(l => ({...l, type: sum.clusters[l.cluster].type, label: layout.areas[l.area].label})),
  };
}

/** Is a world cell index on a grid inside one of the summary's plazas? (tests) */
export function plazaCells(layout: StationLayout, g: Grid, level: number, area: number, kind: PlazaRect['kind']): Set<number> {
  const out = new Set<number>();
  for (const r of compositionOf(layout)?.plazas ?? []) {
    if (r.area !== area || r.level !== level || r.kind !== kind) continue;
    const [x0, y0] = g.cellOf(r.x0 + 1e-3, r.z0 + 1e-3), [x1, y1] = g.cellOf(r.x1 - 1e-3, r.z1 - 1e-3);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.inBounds(x, y) && g.area[g.idx(x, y)] === area) out.add(g.idx(x, y));
  }
  return out;
}

