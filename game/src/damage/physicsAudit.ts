// Task office-interactions-layout-20261030 (lane PHYS): the physics-affordance audit of EVERY prop kind (gen/props.ts PROP_DEFS)
// — root CLAUDE.md "Props — core design rules" 2 / 3, docs/prop-affordances.md section 3. Each kind is either
//  - `dynamic`: a rigid body when shot and when a walker moves into it (`contact`), with its mass (kg), collider and contact
//    material — physics/dynamicItems.ts (lazy bodies, sleep -> static body, MAX_DYNAMIC_PROPS simulating at once), or
//  - `static`: it stays put, with the honest reason (damage/materials.ts StaticWhy) and a sentence.
// Office / company / supporting kinds come from gen/office/physics.ts OFFICE_PHYS. Subway kinds keep their class and mass
// (damage/materials.ts PROP_PHYSICS / PROP_DEFS.physics; loot holders stay put unless they spill) with the static reasons
// recorded here. Task office-props-physics-scale-20261030 (lane PHYS): the Subway's light kinds wake by contact too, with a
// calibrated castor / pad material (damage/materials.ts SUBWAY_CONTACT) — `contact` and `mat` are read from the live physics; spill
// holders wake by contact too (they spill their finite lots as on a shot).
// tests/office-physics.test.ts + tests/contact-physics.test.ts fail for an unclassified kind, an empty reason, or a row that
// disagrees with the live physics (dynamicKind, propPhysics.contact).

import {ALL_PROP_KINDS, SUBWAY_CONTACT, propPhysics, type PhysMat, type StaticWhy} from './materials';
import {OFFICE_PHYS, type OfficePhys} from '../gen/office/physics';
import {isOfficeKind} from '../gen/office/kinds';
import {isP7Kind, p7Spec} from '../gen/props07';
import {isLootHolderKind} from '../items/loot';
import {isSpillHolderKind} from '../world/openablesSpec';
import {dynamicKind} from '../physics/dynamicItems';

export interface PhysAuditRow {
  kind: string;
  cls: 'dynamic' | 'static';
  /** dynamic: rigid-body mass (kg), collider, contact material vs the station (PHYS_MATS). */
  mass?: number;
  shape?: 'box' | 'cylinder';
  mat?: PhysMat;
  /** dynamic: wakes when a walker moves into it (every world; a spill holder then spills its lots). Read from the live physics. */
  contact?: boolean;
  /** dynamic: may go loose on its static host's top (the office monitor on a desk). */
  onHost?: boolean;
  /** static: the reason class. */
  why?: StaticWhy;
  /** One honest sentence (what it is, roughly what it weighs, why it moves / does not). */
  how: string;
  /** office = classified in gen/office/physics.ts; subway = the kind's iteration-07 / 08 class (+ its contact overlay). */
  src: 'office' | 'subway';
}

// ---------------------------------------------------------------------------------------------
// Subway kinds: the reasons of the static ones (their class is read from the live physics, never set here)

const HOLDER_HOW = 'loot holder: stays put so its finite lots never float (only spill holders — trash can, wheelie bin — go loose and spill)';

/** Base / purpose / iteration-07 floor kinds that are static today (not holders, not mounted / on-top): why. */
const SUBWAY_STATIC: Readonly<Record<string, readonly [StaticWhy, string]>> = {
  bench: ['anchored', 'platform bench bolted to the floor'],
  column: ['structure', 'structural column'],
  fareGate: ['anchored', 'fare gate / turnstile bolted into the gate line'],
  booth: ['structure', 'built station booth'],
  ticketMachine: ['anchored', 'ticket machine bolted to the wall / floor (~250 kg)'],
  exitStair: ['structure', 'exit stair block'],
  toiletStall: ['fixture', 'toilet stall: partition panels with a plumbed toilet (its door is the openables audit\'s)'],
  washCounter: ['built-in', 'plumbed wash counter with basins'],
  shopGlazing: ['structure', 'shopfront glazing (shatters; the plinth stays)'],
  shopShutter: ['structure', 'rolled-down shop shutter'],
  // task track2-playtest-revision (lane ROOMS): collision box of an annex machinery assembly (gen/annexRooms.ts)
  annexMachine: ['machinery', 'anchored plant built into a service annex (boiler bank, generator set, turbine, fans, switchgear, channel curbs / basin parapets / spillway chute walls): tonnes of bolted steel and cast concrete'],
  magazineRack: ['fixture', 'loaded wire magazine rack, a store fixture'],
  techDisplay: ['built-in', 'store display table with devices'],
  deviceWall: ['built-in', 'wall display of devices'],
  showcase: ['fixture', 'glazed store showcase'],
  flowerStand: ['fixture', 'florist\'s tiered stand'],
  repairBench: ['built-in', 'repair workbench with its pegboard'],
  pizzaOven: ['machinery', 'pizza oven (~300 kg)'],
  breadRack: ['fixture', 'bakery bread rack'],
  staffLockers: ['anchored', 'locker bank fixed to the wall'],
  couch: ['too heavy', 'staff-room couch (~50 kg, no castors)'],
  noticeBoard: ['mounted', 'wall notice board'],
  janitorCart: ['kept', 'loaded janitor cart (~40 kg): Subway kind, iteration-07 class kept (deliberate static exception, docs/prop-affordances.md section 3)'],
  mopSink: ['fixture', 'plumbed mop sink'],
  electricalPanel: ['fixture', 'electrical switchgear panel'],
  signalRack: ['anchored', 'signal equipment rack bolted down'],
  cartonStack: ['too heavy', 'carton stack (~40 kg): collapses when shot (breakable) rather than sliding'],
  // task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): the annex survivor cache's camp bed (gen/annexCache.ts)
  palletBed: ['too heavy', 'camp bed: a foam mattress and bedding on two wooden pallets (~45 kg) lying flat against a wall: a body bump or a bullet does not shove it'],
  // iteration-07 generated floor kinds
  fareValidatorStand: ['anchored', 'fare validator post bolted to the floor'],
  newspaperVendingBox: ['too heavy', 'steel newspaper box (~35 kg), chained'],
  atmKiosk: ['anchored', 'cash machine bolted down (~300 kg)'],
  infoTouchKiosk: ['anchored', 'information kiosk bolted down'],
  capsuleToyMachine: ['too heavy', 'capsule toy machine stack (~60 kg)'],
  securityPodium: ['too heavy', 'security podium (~40 kg, no castors)'],
  shoeShineChair: ['anchored', 'raised shoe-shine stand'],
  urinal: ['fixture', 'plumbed urinal'],
  floorScrubber: ['machinery', 'floor scrubber (~150 kg)'],
  floorBuffer: ['too heavy', 'floor buffer (~40 kg)'],
  palletJack: ['too heavy', 'pallet jack (~70 kg)'],
  waterCooler: ['too heavy', 'water cooler with a full bottle (~35 kg); the office\'s officeWaterCooler (part-full, ~22 kg) is dynamic'],
  filingCabinet: ['too heavy', 'steel filing cabinet with full drawers (~60 kg)'],
  officeCopier: ['too heavy', 'office copier (~70 kg), cabled'],
  crtTvCart: ['kept', 'TV cart with a CRT set (~45 kg, castors): Subway kind, iteration-07 class kept (deliberate static exception, docs/prop-affordances.md section 3)'],
  mobileWhiteboard: ['kept', 'mobile whiteboard (castors): Subway kind, iteration-07 class kept (deliberate static exception, docs/prop-affordances.md section 3; the office\'s officeWhiteboard is dynamic)'],
  chestFreezer: ['too heavy', 'chest freezer (~80 kg)'],
  bloodPressureKiosk: ['too heavy', 'blood-pressure kiosk (~60 kg)'],
  standMixer: ['machinery', 'floor stand mixer (~100 kg)'],
  iceMachine: ['machinery', 'plumbed ice machine'],
  oxygenCart: ['too heavy', 'oxygen cylinder cart (~60 kg)'],
  physicianScale: ['kept', 'physician\'s beam scale (~25 kg): Subway kind, iteration-07 class kept (deliberate static exception, docs/prop-affordances.md section 3)'],
  fareVaultCart: ['too heavy', 'steel fare-vault cart (~150 kg)'],
  signalHeadSpare: ['too heavy', 'spare signal head (~50 kg)'],
  dryTransformer: ['too heavy', 'dry-type transformer (~500 kg)'],
  benchGrinderStand: ['anchored', 'bench grinder on a bolted stand'],
  airCompressor: ['too heavy', 'air compressor (~60 kg)'],
  gasCylinderCart: ['too heavy', 'gas cylinder cart (~90 kg)'],
  portableGenerator: ['too heavy', 'portable generator (~60 kg)'],
  waterPumpSkid: ['anchored', 'water pump skid bolted down and plumbed'],
  waterHeaterTank: ['fixture', 'plumbed water heater tank'],
  emergencyCallPoint: ['anchored', 'emergency call point post'],
};

function subwayRow(kind: string): PhysAuditRow | null {
  const ph = propPhysics(kind);
  if (dynamicKind(kind)) {
    const spill = isSpillHolderKind(kind);
    const onTop = isP7Kind(kind) && p7Spec(kind).uses.some(u => u.at === 'onTop');
    // task office-props-physics-scale-20261030 (lane PHYS): contact from the live physics (spill holders spill when walked into)
    const contact = !!ph.contact;
    const how = spill ? `light openable holder (iteration 08): ${SUBWAY_CONTACT[kind]?.how ?? 'goes loose when shot or walked into, its lid pops and its finite lots spill as pickups'} (${ph.mat} contact)`
      : contact ? `${SUBWAY_CONTACT[kind]?.how ?? 'light loose prop'} (${ph.mat} contact; wakes when walked into or shot)${onTop ? '; on-top placements stay static (no floating stacks)' : ''}`
      : `light loose prop (iteration 07): rigid body when shot, walkers shove it once loose${onTop ? '; on-top placements stay static (no floating stacks)' : ''}`;
    return {kind, cls: 'dynamic', mass: ph.mass, shape: ph.shape ?? 'box', mat: ph.mat ?? 'metal', contact, how, src: 'subway'};
  }
  if (isLootHolderKind(kind)) return {kind, cls: 'static', why: 'holder', how: ph.dynamic ? `${HOLDER_HOW}; PROP_PHYSICS lists it light, holders still stay put` : HOLDER_HOW, src: 'subway'};
  const r = SUBWAY_STATIC[kind];
  if (r) return {kind, cls: 'static', why: r[0], how: r[1], src: 'subway'};
  if (isP7Kind(kind)) {
    const ats = p7Spec(kind).uses.map(u => u.at);
    if (ats.length && ats.every(a => a === 'mount' || a === 'hang')) return {kind, cls: 'static', why: 'mounted', how: 'wall-mounted / ceiling-hung fixture (iteration-07 mount / hang placement)', src: 'subway'};
    if (ats.length && ats.every(a => a === 'onTop')) return {kind, cls: 'static', why: 'host decor', how: 'counter- / desk-top appliance standing on its host: on-top decor stays put (no floating or interpenetrating stacks)', src: 'subway'};
  }
  return null;
}

function officeRow(kind: string, r: OfficePhys): PhysAuditRow {
  if (!r.dynamic) return {kind, cls: 'static', why: r.why, how: r.how, src: 'office'};
  return {kind, cls: 'dynamic', mass: r.mass, shape: r.shape ?? 'box', mat: r.mat, contact: !!propPhysics(kind).contact && dynamicKind(kind), ...(r.onHost ? {onHost: true} : {}), how: r.how, src: 'office'};
}

/** kind -> its physics-affordance row; a kind with no row here is UNCLASSIFIED (tests fail). */
export const PROP_PHYSICS_AUDIT: Readonly<Record<string, PhysAuditRow>> = Object.fromEntries(ALL_PROP_KINDS.flatMap(k => {
  const row = isOfficeKind(k) ? officeRow(k, (OFFICE_PHYS as Record<string, OfficePhys>)[k]) : subwayRow(k);
  return row ? [[k, row]] : [];
}));

/** Kinds of PROP_DEFS without an audit row (should be empty). */
export function unclassifiedPhysicsKinds(): string[] {
  return ALL_PROP_KINDS.filter(k => !PROP_PHYSICS_AUDIT[k]);
}
