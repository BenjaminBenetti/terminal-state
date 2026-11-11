// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): THE TRAIN EQUIPMENT IN THE WORLD — the crafted chests and devices as
// physical things (craft/equipment.ts records, craft/equipmentApi.ts EquipmentSystemLike).
//
// LEAD STUB: the public surface the other crafting systems and Game are wired against. Lane EQUIP replaces the internals (the kinematic
// bodies on world/fuelCartPhysics.ts, grab / carry, plugs, cargo capture / release, the station lane, the chest view); every public
// member below stays.

import type {Game} from '../game';
import {EQUIPMENT, type EquipmentJSON, type EquipmentKind, type TrainEquipment} from '../craft/equipment';
import type {EquipmentStore, EquipmentSystemLike, EquipmentUnit, EquipmentUse} from '../craft/equipmentApi';

/** What the system needs from Game (structural: tests drive it with a fake host + the real Player / train runtime / ride). */
export interface TrainEquipmentHost {
  playerTrain: {equipment: TrainEquipment};
}

export const EQUIPMENT_TEXT = {
  moving: 'Not while the train is moving',
  noTrain: 'There is no train here',
  noRoom: 'No room on the car floor — move something first',
  tooMany: (n: number, max: number) => `Too much equipment in the car (${n} of ${max}) — leave some at a station`,
} as const;

export class TrainEquipmentSystem implements EquipmentSystemLike {
  readonly uses: Partial<Record<EquipmentKind, EquipmentUse>> = {};
  readonly plugListeners: ((u: EquipmentUnit, plugged: boolean) => void)[] = [];
  /** The train's units waiting for a world (stub: every unit). */
  private pending: EquipmentJSON[] = [];

  constructor(readonly host: TrainEquipmentHost) {}

  install(): this {
    this.host.playerTrain.equipment.live = {aboard: () => this.pending.map(r => ({...r})), restore: a => { this.pending = a.map(r => ({...r})); }};
    return this;
  }

  units(): readonly EquipmentUnit[] { return []; }
  plugged(_kind: EquipmentKind): EquipmentUnit | null { return null; }
  active(_kind: EquipmentKind): EquipmentUnit | null { return null; }
  craftBlock(_kind: EquipmentKind): string | null { return EQUIPMENT_TEXT.noTrain; }
  craft(_kind: EquipmentKind): EquipmentUnit | null { return null; }
  storesAboard(): EquipmentStore[] { return []; }

  /** How many stops out the train console's map reveals: 2 while a route radar is plugged in, else 1 (Game.openTravelMap). */
  routeRadius(): number { return this.plugged('radar') ? 2 : 1; }
  /** A unit straddling the car's outline (a doorway) / too many aboard: the refusal text for a departure, else null (Game.fuelCheck). */
  departBlock(): string | null { return null; }
  /** The ending save: the station's units into its lane WITHOUT a teardown (Game.commitEndingSave). */
  flush(): void {}
  /** Highest item uid in any live chest (Game reserves the inventory's counter above it after Retry / Load). */
  maxUid(): number { return this.host.playerTrain.equipment.maxUid(); }
}

void EQUIPMENT;

/** Installs the train equipment (one call in the Game constructor; registries only). */
export function installTrainEquipment(game: Game): TrainEquipmentSystem {
  return new TrainEquipmentSystem(game as unknown as TrainEquipmentHost).install();
}
