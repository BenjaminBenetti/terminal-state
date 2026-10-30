// Task office-interactions-layout-20261030 (lane PHYS): the physics affordance of EVERY office / company / supporting prop kind
// (gen/office/kinds.ts OFFICE_KINDS) — pure data, no three.js / cannon. Standing rule (root CLAUDE.md "Props — core design
// rules" 2): reasonably loose or movable props react to bullets AND to the player walking into them.
//
//  - dynamic: a rigid body on demand (physics/dynamicItems.ts: lazily created, asleep / static when at rest, bounded budgets),
//    with a plausible mass (kg), a CALIBRATED contact material (damage/materials.ts PHYS_MATS: `castor` = wheeled, rolls on
//    carpet; `pad` = feet / fabric / pot base on carpet — calibrated against cannon-es's friction clamp so bodies really slide)
//    and a collider (box of the kind's footprint, or an upright cylinder). damage/materials.ts spreads these rows into
//    PROP_PHYSICS with `contact`: walking into one wakes it too (not only a shot), see DynamicItems.contactWake (task
//    office-props-physics-scale-20261030: in every world, like the Subway kinds' SUBWAY_CONTACT overlay; a spill holder spills).
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
  officeChair: D(11, 'castor', 'task chair on castors (~11 kg): rolls away when bumped, slides / spins under buckshot (~15 cm), a rifle round barely nudges it', {fit: SEAT_FIT}),
  officeMonitor: D(4.5, 'pad', 'flat-screen monitor (~4.5 kg) on its desk: a shot slides / topples it off the desk top (static where it stands in a reception counter well)', {onHost: true}),
  officeFiling: S('too heavy', 'lateral steel filing cabinet with full drawers (~110 kg): stays put (its drawers are the openables audit\'s)'),
  officePhotocopier: S('too heavy', 'floor-standing copier (~100 kg), castors locked and cabled to the wall'),
  officeWaterCooler: D(22, 'pad', 'bottled water cooler with a part-full bottle (~22 kg): a bump shoves it along, buckshot rocks / slides it a little'),
  conferenceTable: S('too heavy', '3 m conference table (~120 kg) on steel legs'),
  deadPlant: D(7, 'pad', 'dead plant in a dry pot (~7 kg): slides / rocks when shot, shoved along when bumped'),
  receptionDesk: S('built-in', 'reception counter built into the lobby fit-out'),
  serverRack: S('anchored', '19-inch server rack bolted to the floor, loaded with equipment (~300 kg)'),
  officeWhiteboard: D(16, 'castor', 'mobile whiteboard on castors (~16 kg): rolls when bumped'),
  officeShelf: S('too heavy', 'stocked 2.2 m steel shelving unit against the wall (~80 kg with contents)'),
  cubiclePartition: S('partition', 'cubicle panel run: fixed to the cubicle frame the desks hang off'),
  // --- D01-D40 company signature props -------------------------------------------------------------------------------------------
  gumballMachine: D(16, 'pad', 'coin gumball machine on a cast stand (~16 kg): slides / rocks when shot, shoved along when bumped'),
  gumballJar: D(20, 'pad', 'big glass candy jars of gumballs (~20 kg): slides / rocks when shot or bumped'),
  arcadeCabinet: S('too heavy', 'upright arcade cabinet (~120 kg), no castors'),
  consoleStation: S('too heavy', 'console gaming station: TV, cabinet and consoles (~45 kg, no castors), cabled'),
  lawBookcase: S('too heavy', '2.2 m bookcase full of law reports (~150 kg), anchored to the wall'),
  justiceStatue: S('too heavy', 'cast statue on its plinth (~80 kg)'),
  tradingDesk: S('built-in', 'curved trading desk (top 0.74 m), cabled into the floor boxes (~90 kg); its monitors / keyboard are separate tradingMonitor / tradingKeyboard props (lane FURN)'),
  bullStatue: S('too heavy', 'bronze-look bull statue (~150 kg)'),
  labBench: S('built-in', 'plumbed laboratory bench (worktop 0.9 m); its glassware / microscope are separate lab* props on its top (lane FURN)'),
  biohazardFridge: S('too heavy', 'upright specimen fridge (~120 kg), plugged in'),
  architectModel: S('too heavy', 'architectural model on its plinth table (~60 kg, no castors)'),
  draftingTable: S('too heavy', 'drafting table on a cast-iron base (~40 kg, no castors): a bump cannot slide it'),
  tvCamera: D(45, 'castor', 'studio camera on a wheeled pedestal (~45 kg): built to glide when pushed, barely moves when shot'),
  newsDesk: S('built-in', 'broadcast anchor desk built into the studio set'),
  espressoMachine: S('built-in', 'espresso machine on its counter, plumbed in'),
  coffeeRoaster: S('machinery', 'drum coffee roaster (~300 kg)'),
  treadmill: S('too heavy', 'treadmill (~110 kg)'),
  sneakerWall: S('built-in', 'wall-height sneaker display fixed to the wall'),
  giantTeddy: D(6, 'pad', 'giant plush teddy (~6 kg): knocked across the floor by buckshot, shoved aside when bumped'),
  rockingHorse: D(9, 'pad', 'wooden rocking horse (~9 kg): rocks / slides'),
  jukebox: S('too heavy', 'jukebox (~130 kg)'),
  mixingConsole: S('built-in', 'studio mixing desk on its riser, built into the control room (its studio monitors are separate props: lane FURN)'),
  examTable: S('too heavy', 'steel examination table (~90 kg)'),
  vitalsMonitor: D(12, 'castor', 'vitals monitor on a wheeled pole stand (~12 kg): rolls when bumped or shot'),
  dressForm: D(6, 'pad', 'padded dress form on a stand (~6 kg, tall and narrow): buckshot knocks it over, a bump shoves it'),
  clothingRack: D(18, 'castor', 'clothing rail on castors with garments (~18 kg): rolls when bumped'),
  shipModel: S('too heavy', 'glazed ship-model case resting on its sideboard (~35 kg of glass, host decor)'),
  parcelPallet: S('too heavy', 'pallet stacked with parcels (~250 kg): moves only with a pallet jack'),
  napPod: S('too heavy', 'nap pod (~150 kg)'),
  kegerator: S('too heavy', 'kegerator with kegs (~90 kg)'),
  cctvConsole: S('built-in', 'CCTV control console built into the control room'),
  metalDetector: S('anchored', 'walk-through metal detector arch bolted at the entry (~70 kg)'),
  vaultSafe: S('too heavy', 'antique vault safe (~500 kg)'),
  archiveBoxes: D(28, 'pad', 'stack of archive boxes full of paper (~28 kg): an openable spill holder (lane OPEN) — a shot or a walk-in knocks it loose and its finite lots spill (openablesSpec `spill`), then it slides / tips'),
  aquarium: S('too heavy', 'water-filled aquarium (~200 kg) on its sideboard'),
  catTree: D(14, 'pad', 'carpeted cat tree (~14 kg): slides / rocks when shot, shoved along when bumped'),
  doughMixer: S('machinery', 'floor dough mixer (~150 kg)'),
  bakeryCase: S('too heavy', 'refrigerated bakery case (~150 kg)'),
  satelliteModel: D(18, 'pad', 'satellite display model on its stand (~18 kg): rocks / slides'),
  telescope: D(10, 'pad', 'telescope on a tripod (~10 kg): slides / rocks when shot, shoved along when bumped (its collider is the full tripod spread)'),
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
  beanBag: D(6, 'pad', 'adult bean bag, 1.3 m across (~6 kg of beads): barely moves under a pistol round, shoved aside when bumped'),
  loungeArmchair: D(22, 'pad', 'upholstered lounge armchair (~22 kg): shoved across the carpet when bumped'),
  pottedPlantSmall: D(4, 'pad', 'small potted plant (~4 kg): buckshot knocks it over and it rolls, a bump shoves it', {shape: 'cylinder'}),
  roofHvac: S('machinery', 'rooftop HVAC unit on its curb'),
  waterTower: S('structure', 'rooftop water tower on its steel stand'),
  satelliteDish: S('anchored', 'satellite dish on a ballasted / bolted roof mount'),
  logoWall: S('built-in', 'free-standing reception logo wall (part of the fit-out)'),
  // --- task office-props-physics-scale-20261030 (lane FURN): loose clutter separated from the lab bench / trading desk models -------
  // (gen/office/clutterKinds.ts; host decor on their furniture's top: `onHost` — loose on the static host's top slab, knocked off by
  // bullets and by other loose props; glass / metal / plastic contact families: they tip and topple rather than glide like furniture)
  labFlask: D(0.6, 'glass', '500 ml Erlenmeyer flask with culture (~0.6 kg) on a lab bench: a shot knocks it over / off the bench', {onHost: true, shape: 'cylinder'}),
  labFlaskLarge: D(1.6, 'glass', '2 l Erlenmeyer flask, part full (~1.6 kg): tips and rolls when shot', {onHost: true, shape: 'cylinder'}),
  labMicroscope: D(5, 'metal', 'compound microscope (~5 kg cast stand): a shot slides / topples it', {onHost: true}),
  labBottle: D(1.2, 'glass', '1 l reagent bottle, part full (~1.2 kg): tips and rolls when shot', {onHost: true, shape: 'cylinder'}),
  labBottleRack: D(2, 'metal', 'wire stand with three reagent bottles (~2 kg): slides / tips when shot', {onHost: true}),
  labTubeRack: D(0.6, 'plastic', 'test-tube rack with tubes (~0.6 kg): knocked across the bench by a shot', {onHost: true}),
  tradingMonitor: D(5, 'pad', '27-inch monitor on its stand (~5 kg) on a trading desk: a shot slides / topples it off the desk top', {onHost: true}),
  tradingKeyboard: D(1.1, 'plastic', 'keyboard and mouse (~1.1 kg): knocked across the desk top by a shot', {onHost: true}),
  // (wave 2: the drafting table's lamp, the mixing desk's studio monitors, the espresso machine's cups — on its sideboard counter)
  draftingLamp: D(1.5, 'metal', 'arm desk lamp on a weighted base (~1.5 kg) on a drafting table: a shot knocks it over / off', {onHost: true}),
  studioMonitor: D(9, 'pad', 'studio monitor (~9 kg) on the mixing desk\'s meter shelf: a shot slides / topples it off', {onHost: true}),
  studioMonitorSmall: D(5, 'pad', 'small studio monitor (~5 kg) on the meter shelf: a shot slides / topples it off', {onHost: true}),
  espressoCups: D(0.6, 'glass', 'stack of four espresso cups (~0.6 kg) on the café counter: tips and scatters when shot', {onHost: true, shape: 'cylinder'}),
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
