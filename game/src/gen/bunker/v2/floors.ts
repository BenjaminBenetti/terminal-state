// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — the six floor modules, storey by storey (station 0, shelter 1-5).

import type {BunkerFloorModule} from './floorApi';
import {FLOOR_0} from './floor0';
import {FLOOR_1} from './floor1';
import {FLOOR_2} from './floor2';
import {FLOOR_3} from './floor3';
import {FLOOR_4} from './floor4';
import {FLOOR_5} from './floor5';

export const BUNKER_V2_FLOORS: readonly BunkerFloorModule[] = [FLOOR_0, FLOOR_1, FLOOR_2, FLOOR_3, FLOOR_4, FLOOR_5];
