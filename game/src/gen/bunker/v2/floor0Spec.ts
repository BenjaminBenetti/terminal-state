// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 0 (the station)'s shared constants: area keys, labels, clear
// heights, the vault axis. Pure data (floor0.ts carves, floor0Dress.ts furnishes; tests read both).

import {CELL} from '../../grid';
import {V2} from './spine';

/** Clear heights (m above the station floor). The vault hall is the storey's one tall room; the side halls are low on purpose. */
export const F0_CLEAR = {vaultHall: 6.4, sideHall: 3.6, room: 3.2, ward: 3.4, corridor: 3.0, receiving: 4.8} as const;

/** The floor's area keys (FloorCarveResult.areas). */
export const F0_KEYS = ['vaultHall', 'registration', 'marshals', 'waiting', 'property', 'medical', 'corridor', 'observation', 'receiving', 'billeting'] as const;
export type F0Key = (typeof F0_KEYS)[number];

/** Area labels (docs / QA / tests). */
export const F0_LABELS: Readonly<Record<F0Key, string>> = {
  vaultHall: 'Vault hall', registration: 'Registration hall', marshals: "Marshals' post", waiting: 'Waiting hall', property: 'Surrendered property',
  medical: 'Medical inspection', corridor: 'Observation corridor', observation: 'Observation ward', receiving: 'Receiving', billeting: 'Billeting office',
};

/** Door plates in the shelter's words (original civil-defence wording). */
export const F0_PLATES: Readonly<Partial<Record<F0Key, string>>> = {
  marshals: 'SHELTER MARSHALS', property: 'SURRENDERED PROPERTY', medical: 'MEDICAL INSPECTION', corridor: 'OBSERVATION · STAFF ONLY', observation: 'HELD FOR OBSERVATION',
  receiving: 'RECEIVING · GOODS IN', billeting: 'BILLETING OFFICE',
};

/** The vault axis (world x, m): the lane's centre line; the central portal, the aisle and the door all sit on it. */
export const F0_AXIS = (V2.station.laneX + V2.station.laneW / 2) * CELL;
/** The central portal in the platform wall (cells): 11 cells centred on the axis. */
export const F0_PORTAL = {x: V2.station.laneX - 4, w: 11} as const;
/** The colonnade's offset from the axis (m) and its column rows (m from the vault hall's north wall). */
export const F0_COLONNADE = {off: 3.75, rows: [2.5, 5.5]} as const;

/** QA: what the last dress did. */
export const F0_STATS = {removed: 0, columns: 0, props: 0, decor: 0, signs: 0, lights: 0, booths: 0, counters: 0, benches: 0, berths: 0, skipped: [] as string[]};
