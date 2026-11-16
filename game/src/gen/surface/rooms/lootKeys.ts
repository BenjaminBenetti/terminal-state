// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the LOOT KEYS of a district building's holders. The interiors
// furnish their back rooms with the station back-of-house purposes (workshop, maintenance storage, locker room, security office, agent
// office) and the Office tower's storage room (their dressing, labels and lights), but those purposes' tables are ammo-cache rows — a
// rail depot full of them rolled ~3/4 of its finds as ammo, a fire station over half. Each such holder gets the Surface Run key that fits its building (gen/surface/rooms/lootPurposes.ts,
// items/lootTables.ts SURFACE_*) as PropPlacement.purpose, the loot key the runtime reads first (world/containers.ts). The armouries
// (gun shop / police gun lockers), the Mall shop purposes, the Office rooms and the kitchens keep their own rules.

import {isLootHolderKind} from '../../../items/loot';
import type {InteriorBuilder} from './builder';
import {SURFACE_LOOT_KEY as K, type SurfaceLootKey} from './lootPurposes';

/** The Surface Run loot key replacing a station back-of-house loot key in a building of programme `pid` (null: keep the key). */
export function surfaceLootKey(pid: string | null, key: string): SurfaceLootKey | null {
  const fire = pid === 'fire-station';
  switch (key) {
    case 'workshop': return fire ? K.fireWorkshop : K.workshop;
    case 'storage': return fire ? K.fireStore : K.storeRoom;
    case 'locker-room': return K.lockers;
    case 'security-office': return K.policeOffice;
    case 'agent-office': case 'office-storage': return K.backOffice;
    default: return null;
  }
}

/** Sets the Surface Run loot key on every holder of the plan whose loot key (its own, else its room's purpose / type) is a station one. */
export function assignLootKeys(b: InteriorBuilder): void {
  for (const p of b.stub.props) {
    if (!isLootHolderKind(p.kind)) continue;
    const a = b.kit.areas[p.area];
    const key = surfaceLootKey(b.pid, p.purpose ?? a?.purpose ?? a?.type ?? '');
    if (key) p.purpose = key;
  }
}
