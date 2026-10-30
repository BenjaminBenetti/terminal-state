// Task office-interactions-layout-20261030 (lane PHYS): the physics affordance of EVERY office / company / supporting prop kind
// (gen/office/kinds.ts OFFICE_KINDS) — pure data, no three.js / cannon. Standing rule (root CLAUDE.md "Props — core design
// rules" 2): reasonably loose or movable props react to bullets AND to the player walking into them.
//
//  - dynamic: a rigid body on demand (physics/dynamicItems.ts: lazily created, asleep / static when at rest, bounded budgets),
//    with a plausible mass (kg), a CALIBRATED contact material (damage/materials.ts PHYS_MATS: `castor` = wheeled, rolls on
//    carpet; `pad` = feet / fabric / pot base on carpet — calibrated against cannon-es's friction clamp so bodies really slide)
//    and a collider (box of the kind's footprint, or an upright cylinder). damage/materials.ts spreads these rows into
//    PROP_PHYSICS with `contact`: in office (tower) worlds walking into one wakes it too (not only a shot), see
//    DynamicItems.contactWake (holders excepted: shots only).
//    `onHost`: may also go loose while standing on its host's top (a monitor on a desk) — the host itself is static.
//  - static: stays put, with the honest reason. Rule of thumb used here: furniture WITHOUT castors heavier than ~30 kg stays
//    static — a passing bump cannot slide it (static friction of a few hundred newtons on carpet), and the walker shove of
//    physics/dynamicItems.ts matches the walker's speed (it has no strength limit), so a body would let the player bulldoze a
//    sofa like a chair. Built-in / bolted / plumbed / mounted pieces and machinery stay static whatever they weigh.
//
// damage/physicsAudit.ts PROP_PHYSICS_AUDIT joins these rows with every Subway kind's current class; tests/office-physics.test.ts
// fails for an unclassified kind or a row that disagrees with the live physics.

import type {PhysMat, StaticWhy} from '../../damage/materials';
import type {OfficeKind} from './kinds';

/** `fit`: collider footprint scale (w / d) vs the prop box (chairs tuck under their desk; their box includes the armrests). */
type DynOpts = {shape?: 'box' | 'cylinder'; onHost?: boolean; fit?: number};
export type OfficePhys =
  | ({dynamic: true; mass: number; mat: PhysMat; how: string} & DynOpts)
  | {dynamic: false; why: StaticWhy; how: string};

/** Chairs pulled up to a desk / table (gen/office/dress.ts hostDecor) stand ~4-9 cm into its box: the collider is 0.75 of it. */
const SEAT_FIT = 0.75;
const D = (mass: number, mat: PhysMat, how: string, o: DynOpts = {}): OfficePhys => ({dynamic: true, mass, mat, how, ...o});
const S = (why: StaticWhy, how: string): OfficePhys => ({dynamic: false, why, how});

export const OFFICE_PHYS = {
  // --- iteration-16 office furniture -------------------------------------------------------------------------------------------
  officeChair: D(11, 'castor', 'task chair on castors (~11 kg): rolls when bumped, spins / slides under a shot, tips under buckshot', {fit: SEAT_FIT}),
  officeMonitor: D(4.5, 'pad', 'flat-screen monitor (~4.5 kg) on its desk: a shot slides / topples it off the desk top (static where it stands in a reception counter well)', {onHost: true}),
  officeFiling: S('too heavy', 'lateral steel filing cabinet with full drawers (~110 kg): stays put (its drawers are the openables audit\'s)'),
  officePhotocopier: S('too heavy', 'floor-standing copier (~100 kg), castors locked and cabled to the wall'),
  officeWaterCooler: D(22, 'pad', 'bottled water cooler with a part-full bottle (~22 kg): a bump shoves it, buckshot rocks / tips it'),
  conferenceTable: S('too heavy', '3 m conference table (~120 kg) on steel legs'),
  deadPlant: D(7, 'pad', 'dead plant in a dry pot (~7 kg): rocks under a shot, tips when shoved'),
  receptionDesk: S('built-in', 'reception counter built into the lobby fit-out'),
  serverRack: S('anchored', '19-inch server rack bolted to the floor, loaded with equipment (~300 kg)'),
  officeWhiteboard: D(16, 'castor', 'mobile whiteboard on castors (~16 kg): rolls when bumped'),
  officeShelf: S('too heavy', 'stocked 2.2 m steel shelving unit against the wall (~80 kg with contents)'),
  cubiclePartition: S('partition', 'cubicle panel run: fixed to the cubicle frame the desks hang off'),
  // --- D01-D40 company signature props -------------------------------------------------------------------------------------------
  gumballMachine: D(16, 'pad', 'coin gumball machine on a cast stand (~16 kg): top-heavy, buckshot tips it'),
  gumballJar: D(20, 'pad', 'big glass candy jars of gumballs (~20 kg): slides / rocks when shot or bumped'),
  arcadeCabinet: S('too heavy', 'upright arcade cabinet (~120 kg), no castors'),
  consoleStation: S('too heavy', 'console gaming station: TV, cabinet and consoles (~45 kg, no castors), cabled'),
  lawBookcase: S('too heavy', '2.2 m bookcase full of law reports (~150 kg), anchored to the wall'),
  justiceStatue: S('too heavy', 'cast statue on its plinth (~80 kg)'),
  tradingDesk: S('built-in', 'multi-screen trading desk, cabled into the floor boxes (~90 kg)'),
  bullStatue: S('too heavy', 'bronze-look bull statue (~150 kg)'),
  labBench: S('built-in', 'plumbed laboratory bench'),
  biohazardFridge: S('too heavy', 'upright specimen fridge (~120 kg), plugged in'),
  architectModel: S('too heavy', 'architectural model on its plinth table (~60 kg, no castors)'),
  draftingTable: S('too heavy', 'drafting table on a cast-iron base (~40 kg, no castors): a bump cannot slide it'),
  tvCamera: D(45, 'castor', 'studio camera on a wheeled pedestal (~45 kg): built to glide when pushed, barely moves when shot'),
  newsDesk: S('built-in', 'broadcast anchor desk built into the studio set'),
  espressoMachine: S('built-in', 'espresso machine on its counter, plumbed in'),
  coffeeRoaster: S('machinery', 'drum coffee roaster (~300 kg)'),
  treadmill: S('too heavy', 'treadmill (~110 kg)'),
  sneakerWall: S('built-in', 'wall-height sneaker display fixed to the wall'),
  giantTeddy: D(6, 'pad', 'giant plush teddy (~6 kg): tumbles when shot, shoved aside when bumped'),
  rockingHorse: D(9, 'pad', 'wooden rocking horse (~9 kg): rocks / slides'),
  jukebox: S('too heavy', 'jukebox (~130 kg)'),
  mixingConsole: S('built-in', 'studio mixing desk built into the control room'),
  examTable: S('too heavy', 'steel examination table (~90 kg)'),
  vitalsMonitor: D(12, 'castor', 'vitals monitor on a wheeled pole stand (~12 kg): rolls when bumped, tips when shot high'),
  dressForm: D(6, 'pad', 'padded dress form on a stand (~6 kg): tips over easily'),
  clothingRack: D(18, 'castor', 'clothing rail on castors with garments (~18 kg): rolls when bumped'),
  shipModel: S('too heavy', 'glazed ship-model case resting on its sideboard (~35 kg of glass, host decor)'),
  parcelPallet: S('too heavy', 'pallet stacked with parcels (~250 kg): moves only with a pallet jack'),
  napPod: S('too heavy', 'nap pod (~150 kg)'),
  kegerator: S('too heavy', 'kegerator with kegs (~90 kg)'),
  cctvConsole: S('built-in', 'CCTV control console built into the control room'),
  metalDetector: S('anchored', 'walk-through metal detector arch bolted at the entry (~70 kg)'),
  vaultSafe: S('too heavy', 'antique vault safe (~500 kg)'),
  archiveBoxes: D(28, 'pad', 'stack of archive boxes full of paper (~28 kg): slides / topples (if it ever becomes a loot holder it must spill: openablesSpec `spill`)'),
  aquarium: S('too heavy', 'water-filled aquarium (~200 kg) on its sideboard'),
  catTree: D(14, 'pad', 'carpeted cat tree (~14 kg): tall and light, tips when shot or shoved'),
  doughMixer: S('machinery', 'floor dough mixer (~150 kg)'),
  bakeryCase: S('too heavy', 'refrigerated bakery case (~150 kg)'),
  satelliteModel: D(18, 'pad', 'satellite display model on its stand (~18 kg): rocks / slides'),
  telescope: D(10, 'pad', 'telescope on a tripod (~10 kg): tips when shot or bumped'),
  // --- E01-E17 supporting models -------------------------------------------------------------------------------------------------
  executiveDesk: S('too heavy', 'hardwood executive desk with pedestals (~100 kg)'),
  executiveChair: D(19, 'castor', 'leather executive chair on castors (~19 kg): rolls when bumped', {fit: SEAT_FIT}),
  chesterfieldSofa: S('too heavy', 'chesterfield sofa (~70 kg, no castors): a bump cannot slide it'),
  globeBar: S('too heavy', 'globe drinks cabinet on a heavy wooden stand with decanters (~35 kg, no castors): a bump cannot slide it'),
  serverCabinet: S('anchored', 'server cabinet bolted down, loaded with equipment'),
  cracUnit: S('machinery', 'computer-room air conditioner (~400 kg), plumbed'),
  lobbySofa: S('too heavy', 'lobby sofa (~60 kg, no castors): barely moves under fire, a bump cannot slide it'),
  planterTree: S('too heavy', 'tree in a concrete planter (~150 kg)'),
  securityTurnstile: S('anchored', 'security turnstile bolted to the lobby floor'),
  foosballTable: S('too heavy', 'foosball table (~70 kg)'),
  pingPongTable: S('too heavy', 'table-tennis table (~100 kg)'),
  beanBag: D(6, 'pad', 'bean bag (~6 kg): barely moves under a pistol round, shoved aside when bumped'),
  loungeArmchair: D(22, 'pad', 'upholstered lounge armchair (~22 kg): shoved across the carpet when bumped'),
  pottedPlantSmall: D(4, 'pad', 'small potted plant (~4 kg): tips / rolls', {shape: 'cylinder'}),
  roofHvac: S('machinery', 'rooftop HVAC unit on its curb'),
  waterTower: S('structure', 'rooftop water tower on its steel stand'),
  satelliteDish: S('anchored', 'satellite dish on a ballasted / bolted roof mount'),
  logoWall: S('built-in', 'free-standing reception logo wall (part of the fit-out)'),
} satisfies Record<OfficeKind, OfficePhys>;

/** Dynamic office kinds as PROP_PHYSICS rows (damage/materials.ts spreads them). */
export function officePropPhysics(): Record<string, {mass: number; dynamic: true; mat: PhysMat; contact: true} & DynOpts> {
  const out: Record<string, {mass: number; dynamic: true; mat: PhysMat; contact: true} & DynOpts> = {};
  for (const [k, r] of Object.entries(OFFICE_PHYS) as [string, OfficePhys][]) {
    if (!r.dynamic) continue;
    out[k] = {mass: r.mass, dynamic: true, mat: r.mat, contact: true, ...(r.shape ? {shape: r.shape} : {}), ...(r.onHost ? {onHost: true} : {}), ...(r.fit ? {fit: r.fit} : {})};
  }
  return out;
}
