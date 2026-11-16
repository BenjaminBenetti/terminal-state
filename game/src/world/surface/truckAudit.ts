// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up): the Surface Run truck in the PROP AFFORDANCE AUDITS (root
// CLAUDE.md "Props — core design rules": storage opens; movable things move; exceptions explicit and classified). The truck is not a prop
// kind (no PROP_DEFS entry: the prop-kind audits are keyed by the catalogue and their tests require exactly the catalogue's kinds), so its
// rows live here, in the same row shapes, and are re-exported beside the prop audits (world/openablesSpec.ts VEHICLE_OPEN_AUDIT,
// damage/physicsAudit.ts VEHICLE_PHYSICS_AUDIT). Registry-driven: one openables row per storage compartment (TRUCK_COMPARTMENTS) and one
// physics row for the body plus one per compartment door (tests/surface-truck-lockers.test.ts fails for an unclassified one); (field
// follow-up) a row of each kind per fixed non-storage part (TRUCK_FIXED_PARTS: the planning-map board). Pure data.

import type {AuditEntry} from '../openablesSpec';
import type {PhysAuditRow} from '../../damage/physicsAudit';
import {TRUCK_COMPARTMENTS} from './truckStore';

/** The audit key of a truck part ('surfaceTruck' = the body; 'surfaceTruck.<compartment / part id>' = a storage compartment / a fixed part). */
export const truckAuditKind = (compartment?: string): string => (compartment ? `surfaceTruck.${compartment}` : 'surfaceTruck');

/**
 * Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): the truck's FIXED PARTS that are not storage (registry-driven:
 * each gets an openables row 'none' / equipment and a static built-in physics row; tests/surface-truck-board.test.ts).
 */
export const TRUCK_FIXED_PARTS = [
  {id: 'mapBoard', open: 'the planning-map board bolted to the bed\'s right side: a printed map sheet read with [E] (it opens the planning map), ' +
    'not storage — nothing to open, nothing inside', phys: 'the planning-map board: a panel on two rails bolted to the truck\'s bed side (never detaching); it moves with the truck'},
] as const;

/** Openables: each compartment opens (a hinged door swings out while its view is open); contents are the player's, it starts empty. */
export const TRUCK_OPEN_AUDIT: readonly AuditEntry[] = [
  ...TRUCK_COMPARTMENTS.map(c => ({
    kind: truckAuditKind(c.id),
    cls: 'openable' as const,
    role: 'storage' as const,
    how: `the truck's ${c.name.toLowerCase()} (${c.slots} slots): part of the vehicle — its hinged door swings out while its storage view is open; ` +
      'the contents are the player\'s own (stored, kept with their identity in the truck\'s record, never refilled); it starts EMPTY by design ' +
      '(player storage like the train Lockbox, not found loot: no loot table)',
  })),
  ...TRUCK_FIXED_PARTS.map(p => ({kind: truckAuditKind(p.id), cls: 'none' as const, role: 'equipment' as const, how: `${p.open}; part of the vehicle`})),
];

/** Physics: the truck body never moves as a loose prop; its compartment doors are part of it. */
export const TRUCK_PHYSICS_AUDIT: readonly PhysAuditRow[] = [
  {kind: truckAuditKind(), cls: 'static', why: 'too heavy', src: 'surface',
    how: 'an eight-wheeled military truck (several tonnes): moved only by its own vehicle controller when driven; bullets stop on its body ' +
      'and never shove it; walkers and zombies are pushed by it, never the other way'},
  ...TRUCK_COMPARTMENTS.map(c => ({kind: truckAuditKind(c.id), cls: 'static' as const, why: 'built-in' as const, src: 'surface' as const,
    how: `the ${c.name.toLowerCase()}: a compartment built into the truck's body (its door hinged to it, never detaching); it moves with the truck`})),
  ...TRUCK_FIXED_PARTS.map(p => ({kind: truckAuditKind(p.id), cls: 'static' as const, why: 'built-in' as const, src: 'surface' as const, how: p.phys})),
];
