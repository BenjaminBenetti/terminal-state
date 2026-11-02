// Task reactor-build-20261101 (primary): shared pure-data contracts of THE REACTOR (LevelId 'reactor', tier 3) — the selected B
// "Industrial Service Cathedral" (reference/tasks/reactor-concepts-20261101-203831/concepts/B-service-cathedral-attempt2.png).
// Types only — written first so every lane (GEN, AIR, RESTART, ARCH) builds against one shape. The generator (gen/reactor/index.ts,
// lane GEN) fills `layout.reactor`; everything else reads it. Runtime state (generators running, restart progress) is NOT here:
// world/reactor/runState.ts (one persisted record, the run's 'reactor' lane store).
//
// World frame (same conventions as the Office / Mall): x east, z south, y up, metres. ONE continuous layout:
//  - levels[0] = the RIM: the subway station at the TOP of the pit (platform + track bed: a normal station a train can stop at),
//    the rim gallery round the pit mouth and the rim control office (the startup key, the pit status board). baseY 0.
//  - levels[1..] = the walkway TIERS going DOWN (negative baseY) — steel galleries on the pit walls, landings, bridges across the
//    pit, lattice-tower decks and the rooms cut into the rock (stores, switchgear, pump hall) — and LAST the CORE FLOOR round the
//    reactor vessel (the control room overlooks it).
// The pit air is one open column: the deepest band rises through every tier's apertures up to the pit roof (gen/levels.ts union
// of bands). Storey heights are real; nothing is faked by stacking.

/** A point / pose in world metres. yaw: camera convention (forward = (-sin yaw, -cos yaw)). level = layout.levels index. */
export interface ReactorPose { x: number; z: number; yaw: number; level: number }
export interface ReactorPoint { x: number; y: number; z: number; level: number }
export interface ReactorRect { x0: number; z0: number; x1: number; z1: number }

/** The tier roles top-down (HUD / spawn contexts / dressing). */
export type ReactorTierRole = 'rim' | 'upper' | 'middle' | 'deep' | 'core';

export interface ReactorTier {
  /** layout.levels index. */
  level: number;
  /** 0 = the rim, 1.. = walkway tiers top-down, last = the core floor. */
  index: number;
  role: ReactorTierRole;
  /** HUD label ('Rim', 'Tier 1' …, 'Core floor'). */
  label: string;
  /** Nominal deck height (absolute y; <= 0). */
  baseY: number;
  /** Gas zone of the tier (ReactorZone.id), -1 = clean air (the rim). */
  zone: number;
  /** Painted tier marker band colour (0xRRGGBB) — walls, stair stringers, signage of this tier. */
  color: number;
}

/**
 * The pit: an open vertical shaft. `outline` = the pit mouth at the rim (closed clockwise polygon, world m; rectilinear or
 * octagonal per variant); the shaft walls drop straight to the core floor. `roofY` = the top of the open column above the rim
 * (crane runway / pipe tops live below it).
 */
export interface ReactorPit {
  outline: readonly {x: number; z: number}[];
  bounds: ReactorRect;
  /** Pit centre (the vessel axis). */
  cx: number;
  cz: number;
  /** Rim deck / core floor / pit roof heights (absolute). */
  rimY: number;
  floorY: number;
  roofY: number;
  /** Seeded kit variant (gen/reactor/frame.ts). */
  variant: string;
}

/**
 * A GAS ZONE: a depth band whose extraction fans one auxiliary generator powers. Uncleared, the depth gas (world/reactor/air.ts) has
 * concentration cTop at yTop rising to cBottom at yBottom (stratified, thickening downward); cleared, it drains in stages to ~0.
 */
export interface ReactorZone {
  id: number;
  /** Band (absolute y): yTop > yBottom. */
  yTop: number;
  yBottom: number;
  /** Uncleared eye concentration at the band's top / bottom (0..1, the gas system's scale: GAS.THRESHOLD 0.12). */
  cTop: number;
  cBottom: number;
  /** Tiers (layout.levels indices) inside the band. */
  levels: readonly number[];
  /** The generator powering this zone's fans (ReactorGenerator.id). */
  generator: number;
  /** This zone's extraction fans (ReactorFan.id). */
  fans: readonly number[];
}

/**
 * An auxiliary generator on a landing. It stands in air that is already breathable or cleared (the rim / the zone above), so the
 * generator route never needs a mask: zone k's generator is reachable once zone k-1 is clear (no gas deadlock).
 */
export interface ReactorGenerator {
  id: number;
  /** Zone it powers. */
  zone: number;
  /** Landing it stands on. */
  level: number;
  area: number;
  /** Footprint centre / yaw (the skid's long axis along local X) / size (m). */
  x: number;
  z: number;
  y: number;
  yaw: number;
  size: {w: number; d: number; h: number};
  /** Where the player stands to start it (walkable, prop-free) and the start lever / control box (absolute y). */
  use: ReactorPose;
  panel: {x: number; y: number; z: number};
  /** Cable route from the generator to its zone's fans (world polyline, absolute y): ARCH draws it, the lights follow it. */
  cable: readonly {x: number; y: number; z: number}[];
}

/** A wall-mounted extraction fan (a duct housing in the pit wall; blades spin when its zone's generator runs). */
export interface ReactorFan {
  id: number;
  zone: number;
  level: number;
  /** Hub centre (absolute y), outward normal of the wall face (unit, toward the pit), radius (m). */
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  radius: number;
}

/** The restart tasks (2–3 credible industrial jobs; RESTART lane): key, control power, coolant — then the rods. */
export type ReactorTaskId = 'key' | 'power' | 'coolant' | 'rods';

/** A restart SITE: a room / station with its usable controls. */
export type ReactorSiteId = 'rimOffice' | 'switchgear' | 'pumpHall' | 'control';

export interface ReactorControl {
  /** Stable id ('fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch', 'rods', 'statusBoard' …). */
  id: string;
  /** The interactable point (absolute y) and where the player stands to use it (walkable, prop-free). */
  at: {x: number; y: number; z: number};
  stand: ReactorPose;
  /** Facing of the control's front (yaw, camera convention) — the panel / handwheel faces the stand point. */
  yaw: number;
}

export interface ReactorSite {
  id: ReactorSiteId;
  level: number;
  /** Area id of the room (layout.areas). */
  area: number;
  /** Room rectangle (world m). */
  rect: ReactorRect;
  controls: readonly ReactorControl[];
  /** (lane GEN, additive) The big machines reserved in the room (ARCH renders them; each collides as an 'annexMachine' prop). */
  machines?: readonly ReactorMachine[];
}

/**
 * (lane GEN, additive) A machine footprint reserved in a restart site: centre (floor y), front-facing yaw (camera convention: the
 * front faces the operator), size along the wall (w) / off it (d) / height (h), and the index of its collision prop in layout.props.
 */
export interface ReactorMachine {
  kind: 'switchgear' | 'pump' | 'valve' | 'console' | 'statusBoard';
  x: number;
  z: number;
  y: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  prop: number;
}

/** Restart components (finite, seeded once, always placed in the level, never behind their own lock). */
export type ReactorComponentItem = 'reactor_key' | 'fuse_cartridge';

export interface ReactorComponent {
  item: ReactorComponentItem;
  /** Index into layout.pickups of its pickup (the pickup carries the same itemId / position). */
  pickup: number;
  level: number;
  area: number;
  /** Where (room label for QA / the status board hints). */
  where: string;
}

/** A painted / lit wayfinding status board or monitor (canvas screens: RESTART draws the content). */
export interface ReactorScreen {
  id: 'pitBoard' | 'controlMonitor' | 'switchgearBoard' | 'pumpBoard';
  level: number;
  /** Centre of the screen face (absolute y), its facing yaw and size (m). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
}

// --- Set pieces (ARCH renders them; GEN reserves their space / collision) ----------------------------------------------------

/** A straight deck run (gallery segment, landing, bridge, tower deck) — ARCH hangs steel under it. Cells are in the grid too. */
export interface ReactorDeck {
  kind: 'gallery' | 'landing' | 'bridge' | 'tower' | 'stair-landing';
  level: number;
  rect: ReactorRect;
  /** Deck top (absolute y). */
  y: number;
}

/** A free-standing steel lattice tower in the pit (B's crossing towers): foot on the core floor, top under the pit roof. */
export interface ReactorTower {
  x: number;
  z: number;
  /** Footprint half sizes (m). */
  hx: number;
  hz: number;
  y0: number;
  y1: number;
}

/** The overhead gantry crane: two runway girders along `axis` across the pit, a bridge girder spanning them, trolley + hook. */
export interface ReactorCrane {
  axis: 'x' | 'z';
  /** Runway rail height (absolute) and the runway span ends along the axis (world m). */
  railY: number;
  a0: number;
  a1: number;
  /** Runway lines (the other coordinate) and the bridge position along the axis. */
  b0: number;
  b1: number;
  bridgeAt: number;
  /** Trolley position along the bridge (the other coordinate) and the hook's hanging bottom (absolute y). */
  trolleyAt: number;
  hookY: number;
}

/** An organ-like pipe bank climbing a pit wall (B's right wall): a run of vertical pipe modules with ring catwalks. */
export interface ReactorPipeBank {
  /** Wall segment the bank stands against (world m), its outward normal (toward the pit), and y range. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  nx: number;
  nz: number;
  y0: number;
  y1: number;
  /** Depth of the bank off the wall (m). */
  depth: number;
}

/** The reactor vessel on the core floor (hero model; SOLID round obstruction in the grid). */
export interface ReactorCore {
  x: number;
  z: number;
  /** Plinth radius / vessel radius (m) and its bottom / dome-top heights (absolute). */
  radius: number;
  y0: number;
  y1: number;
}

/** A painted tier marker band on the pit walls (B's colour bands): height range, colour and the stencilled label. */
export interface ReactorMarker {
  level: number;
  y0: number;
  y1: number;
  color: number;
  text: string;
}

/**
 * The FUTURE TRAIN ARRIVAL hook: the rim station's platform + track a shared player train can stop at (Beta's train, later). The
 * level does NOT hardcode a station-only spawn: `start` is the platform start used today (levels/registry.ts arrivalPose), `stop`
 * is the stretch of track (world x or z along the bed) a train of up to `maxLength` m stops in, doors facing `doorSide`.
 */
export interface ReactorArrival {
  /** Platform area id and the track bed (layout.trenches index) / track centreline (layout.trench.tracks index) beside it. */
  platform: number;
  trench: number;
  track: number;
  /** Stop window along the bed axis (world m), the axis, and the platform side of the track ('N' = toward -z …). */
  axis: 'x' | 'z';
  stop0: number;
  stop1: number;
  doorSide: 'N' | 'S' | 'E' | 'W';
  maxLength: number;
}

/**
 * Task reactor-expansion-20261101 (primary): a SIDE COMPLEX off the main shaft housing one zone's auxiliary generator (bunker / old
 * mines / waste repository; gen/reactor/complex/*). World metres; areas are layout.areas ids on `level`.
 */
export interface ReactorComplexInfo {
  id: 'bunker' | 'mines' | 'waste';
  name: string;
  level: number;
  zone: number;
  /** ReactorGenerator.id inside it. */
  generator: number;
  areas: readonly number[];
  rooms: readonly {area: number; key: string; label: string; role: string}[];
  /** Entrance doorway centre (on the pit-side deck) and the complex's bounds. */
  entrance: {x: number; z: number; level: number};
  bounds: ReactorRect;
  /**
   * (task reactor-expansion-20261101, lane HOST, additive) The host's slot in world metres: the reserved rock `region` (its pit-side
   * row is the pit wall), the `entrance` span (in that wall row), the deck area in front, the direction into the complex and the
   * ceiling cap (absolute) — validation (gen/reactor/complex/host.ts complexIssues) and QA read it.
   */
  slot?: {region: ReactorRect; entrance: ReactorRect; frontArea: number; inward: 'N' | 'S' | 'E' | 'W'; ceilMax: number};
}

/**
 * Task reactor-expansion-20261101 (lane CORE, additive): THE CORE FLOOR round the vessel (gen/reactor/coreFloor.ts) — the walkable
 * SERVICE RING round the vessel, the glowing GOOP POOL round it (non-walkable: blocked cells 1.5 m below the deck, railed on every
 * edge) crossed by radial BRIDGES, the four COOLANT LOOPS standing in the goop (steam generator + vertical reactor coolant pump +
 * manifold; collision props) and the TURBINE GENERATOR on the outer floor. World metres, absolute y. Render (world/reactor/core*.ts)
 * draws the hero assembly from this record.
 */
export interface ReactorCoreFloor {
  version: 1;
  /** Vessel axis (= core x / z) and the core floor deck height. */
  x: number;
  z: number;
  y: number;
  /** The vessel's blocked footprint radius (walking stops at its hazard plinth). */
  vesselR: number;
  /** Service ring (walkable deck round the vessel) inner / outer radius. */
  ring: {r0: number; r1: number};
  /** The goop pool annulus (+ tower feet): radii, surface height, its floor (the collision band) and cell count. */
  pool: {r0: number; r1: number; surfaceY: number; floorY: number; cells: number};
  /**
   * Walkable radial bridges over the goop: axis angle (rad, atan2(dz, dx)), clear width, the drawn railings' offset from the axis
   * (the outer envelope of its cell-edge collision rails), axis endpoints (ring edge -> outer floor).
   */
  bridges: readonly {angle: number; width: number; rail: number; x0: number; z0: number; x1: number; z1: number}[];
  /** Lattice towers (ReactorInfo.towers index) whose feet stand in the goop. */
  towers: readonly number[];
  /** Coolant loops: each piece's centre (on the goop: y = the pool floor), its yaw (model +X along (cos yaw, -sin yaw)) and prop index. */
  loops: readonly {
    angle: number;
    sg: {x: number; z: number; yaw: number; prop: number} | null;
    rcp: {x: number; z: number; yaw: number; prop: number} | null;
    manifold: {x: number; z: number; yaw: number} | null;
  }[];
  /** The turbine generator on the outer core floor (model +X along `axis`), its collision prop; null when no free wall run. */
  turbine: {x: number; z: number; axis: 'x' | 'z'; yaw: number; prop: number} | null;
  /**
   * Radii of the smooth railings drawn round the goop (the cell-edge collision rails there are `hidden`): the ring's at the outer
   * envelope of its collision edges, the outer floor's at the inner envelope — a body never reaches past a drawn rail.
   */
  rails: {ring: number; outer: number};
}

/** layout.reactor: the whole Reactor in ONE layout (lane GEN writes it; every other lane reads it). */
export interface ReactorInfo {
  version: 1;
  /** Display name ("Reactor"). */
  name: string;
  pit: ReactorPit;
  /** Rim first, then the walkway tiers top-down, last the core floor. */
  tiers: readonly ReactorTier[];
  zones: readonly ReactorZone[];
  generators: readonly ReactorGenerator[];
  fans: readonly ReactorFan[];
  sites: readonly ReactorSite[];
  components: readonly ReactorComponent[];
  screens: readonly ReactorScreen[];
  decks: readonly ReactorDeck[];
  towers: readonly ReactorTower[];
  crane: ReactorCrane;
  pipeBanks: readonly ReactorPipeBank[];
  core: ReactorCore;
  markers: readonly ReactorMarker[];
  /** Player start on the rim platform (levels/registry.ts arrivalPose; = layout.playerSpawn). */
  start: ReactorPose;
  arrival: ReactorArrival;
  /**
   * The physical routes down (QA / validation / tests): every tier reachable from the rim without passing a gas zone below its own
   * generator's zone (the generator route) — 'stairs' = the wall switchbacks, 'bridge' = the bridge / tower line, 'ladder' = the
   * pipe-bank maintenance ladders. Each entry lists the layout.levelLinks ids of that route top-down.
   */
  routes: readonly {kind: 'stairs' | 'bridge' | 'ladder'; links: readonly number[]}[];
  /** Task reactor-expansion-20261101: the generator side complexes (absent / empty = the generators stand on shaft landings). */
  complexes?: readonly ReactorComplexInfo[];
  /** Task reactor-expansion-20261101 (lane CORE, additive): the core floor's ring / goop pool / bridges / loops / turbine. */
  coreFloor?: ReactorCoreFloor;
  /** Task reactor-playtest-round2-20261102 (lane ARRIVAL, additive): platform → station area → breach → tunnel → the rim reveal. */
  approach?: ReactorApproach;
  /** Task reactor-playtest-round2-20261102 (lane ARRIVAL, additive): the seeded rock suites behind the pit walls (gen/reactor/suites.ts). */
  suites?: readonly ReactorSuiteInfo[];
}

/**
 * Task reactor-playtest-round2-20261102 (lane ARRIVAL): one seeded rock suite — an entry corridor from a deck door, a T / L cross
 * corridor, themed rooms off it, sometimes a loop back to a deck, enfilade doors and a back door into a store. Area ids on `level`.
 */
export interface ReactorSuiteInfo {
  level: number;
  wall: 'stair' | 'organ' | 'N' | 'S';
  theme: string;
  corridors: readonly number[];
  rooms: readonly number[];
  deckDoors: readonly ReactorRect[];
  links: readonly (readonly [number, number])[];
  loop: boolean;
  shape: 'T' | 'L';
}

/**
 * Task reactor-playtest-round2-20261102 (lane ARRIVAL): the arrival approach on the rim storey (gen/reactor/arrival.ts). The platform
 * never opens onto the pit: 1-2 openings lead into a small station area (a ticket hall + back of house), one of its walls is broken
 * through (the BREACH: open cells, no door), a short rough tunnel (segments `tunnel`, rock finishes) bends to a second hole in the pit's
 * north wall (the REVEAL) onto the rim gallery. World metres; area ids are layout.areas ids on level 0.
 */
export interface ReactorApproach {
  recipe: 'hall' | 'corridor' | 'backroom';
  /** The ticket hall, the station area (hall first, then the service corridor / rooms), the tunnel segments (breach first). */
  hall: number;
  station: readonly number[];
  tunnel: readonly number[];
  /** Platform -> hall openings. */
  doors: readonly ReactorRect[];
  /** The breached wall cells and the area whose wall it is. */
  breach: ReactorRect;
  breachFrom: number;
  /** The pit-wall cells of the reveal hole and the rim gallery area beyond it. */
  reveal: ReactorRect;
  revealDeck: number;
  /** Tunnel centreline (breach -> reveal, y = the rim) and its length (m). */
  path: readonly {x: number; z: number}[];
  length: number;
}

/** Tier gas concentrations (uncleared) are a function of depth only: the rim is clean (layout.reactor.tiers[0].zone === -1). */
export const REACTOR_TIER = 3;
