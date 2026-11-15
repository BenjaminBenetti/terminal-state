// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EXPO): the Expo event's NEW prop kinds — hand-built SIMPLE meshes
// (code-drawn box parts in the existing ShapeMat / PurposeMat keys + canvas faces painted locally by world/skywaysExpoDraw.ts: dynamic
// per-seed text over code shapes, never presented as generated art). Everything else of the expo REUSES existing kinds (the convention's
// stage, the Mall's TV wall / flat-screen TV / glass counter and cabinet, the office monitor / server rack, the P7 CRT terminal / info
// kiosk / folding chair, the tech display + device wall with their split demo devices, the arcade cabinet, console station, lounge seats).
// Every kind is classified honestly for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md):
//  - nothing here reads as storage (no doors, lids or drawers are drawn: solid plinths / counters / tables; the expo's real storage is
//    the reused server racks, glass cabinets, crates) -> openables 'none';
//  - the movable things move (rule 2): the screen stand, the sign totem, the tower PC (+ the lectern as on-host decor on the stage);
//    the hosts (counter, plinth, demo table) stay static so the loose devices on them never float (the convention merch table's rule);
//    the booth wall is a shell-scheme partition, the LED wall and the hanging sign are mounted;
//  - no loose items are baked in (rule 4): every device / monitor / keyboard / phone on a host is a separate on-host prop;
//  - real-world scale (rule 5): EXPO_SCALE (scale-check renders beside the runtime-scaled zombie, viewed).
// Merged by gen/skyways/events/kinds.ts into the Skyways destination registry (PROP_DEFS / PROP_DAMAGE / physics audit / OPENABLE_AUDIT).

import type {PropDef} from '../../props';
import type {DestDrawnPart, DestPhys} from '../destinations/kindTypes';
import type {EventFace, EventKindSpec} from './eventKindTypes';
import type {PartMat} from '../../purposeShapes';
import {EXPO_EXHIBITORS} from './expoTypes';

export const EXPO_KINDS = [
  'skyExpoLedWall', 'skyExpoLectern', 'skyExpoBoothWall', 'skyExpoDemoCounter', 'skyExpoDemoTable', 'skyExpoPlinth', 'skyExpoScreenStand',
  'skyExpoTowerPc', 'skyExpoHangSign', 'skyExpoSignStand',
] as const;
export type ExpoKind = (typeof EXPO_KINDS)[number];

/** Box sizes (m: W x H x D, prop frame origin bottom centre, front +Z) and the support tops the dresser stands decor on. */
export const EXPO_DIMS = {
  ledWall: {w: 6.2, h: 3.3, d: 0.12},
  lectern: {w: 0.62, h: 1.16, d: 0.52},
  boothWall: {w: 3.0, h: 2.5, d: 0.12},
  counter: {w: 1.6, h: 1.0, d: 0.6},
  table: {w: 1.6, h: 0.75, d: 0.8},
  plinth: {w: 0.5, h: 1.0, d: 0.5},
  screenStand: {w: 1.55, h: 2.0, d: 0.65},
  towerPc: {w: 0.2, h: 0.44, d: 0.45},
  /** The hanging sign: its board (2.4 x 0.6) under SIGN_CABLE m of cable to the ceiling (the placement's top = the ceiling). */
  hangSign: {w: 2.4, h: 1.1, d: 0.06},
  signStand: {w: 0.9, h: 2.0, d: 0.45},
} as const;
/** Cable drop of the hanging booth sign (top batten -> ceiling, m: a 3.9 m expo floor ceiling leaves 2.78 m clear under the board). */
export const EXPO_SIGN_CABLE = 0.5;
/** The keynote LED wall's place in the stage truss: its centre this far (model z) behind the uprights' back face; its base above the deck. */
export const EXPO_LED_IN_TRUSS = {dz: 0.08, y0: 0.06} as const;

const D = EXPO_DIMS;
const box = (m: PartMat, s: readonly [number, number, number], p: readonly [number, number, number], rx?: number): DestDrawnPart => ({m, s, p, ...(rx ? {rx} : {})});
const def = (k: keyof typeof EXPO_DIMS, o: Partial<PropDef> = {}): PropDef => ({w: D[k].w, d: D[k].d, h: D[k].h, blocksSight: false, ...o});
const dyn = (mass: number, mat: 'metal' | 'wood' | 'plastic' | 'pad', onHost = false): PropDef['physics'] => ({mass, dynamic: true, shape: 'box', mat, contact: true, ...(onHost ? {onHost: true} : {})});
/** The exhibitors' booth panel colours (an existing paint key per exhibitor index). */
const PANEL: readonly PartMat[] = ['paintGreen', 'paintBlue', 'black', 'paintWhite', 'steelDark', 'paintBlue', 'paintOrange', 'paintGreen', 'paintRed', 'paintOrange', 'black', 'paintBlue', 'paintGreen', 'paintYellow'];
export const expoPanelMat = (v: number): PartMat => PANEL[((Math.floor(v) % EXPO_EXHIBITORS.length) + EXPO_EXHIBITORS.length) % EXPO_EXHIBITORS.length % PANEL.length];

const phys = {
  ledWall: {dynamic: false, why: 'mounted', how: 'an LED video wall of modular panels hung in the keynote stage\'s truss (~300 kg, rigged): mounted, never shoved'},
  lectern: {dynamic: true, mass: 30, mat: 'wood', shape: 'box', onHost: true, how: 'a stage lectern (~30 kg: MDF carcass, acrylic logo panel) standing on the keynote stage deck: on-host decor of the static stage — a shot knocks it over / off the deck'},
  boothWall: {dynamic: false, why: 'partition', how: 'a shell-scheme booth wall (aluminium extrusion frame, clamped panels and a header fascia) braced against the hall wall: a partition, never shoved'},
  counter: {dynamic: false, why: 'fixture', how: 'a closed booth demo counter (~45 kg, solid panels on a kick plinth): the host of the demo devices on its top (they go loose when shot; a prop something rests on never moves)'},
  table: {dynamic: false, why: 'fixture', how: 'a booth demo table (aluminium legs, laminate top, modesty panel): the host of the monitors / keyboards / devices on it (they go loose when shot; a prop something rests on never moves)'},
  plinth: {dynamic: false, why: 'fixture', how: 'a solid display plinth (painted MDF box): the host of the device on it (the device goes loose when shot; a prop something rests on never moves)'},
  screenStand: {dynamic: true, mass: 45, mat: 'pad', shape: 'box', how: 'a 65-inch display on a steel floor stand (~45 kg, flat base plate on felt pads): walked into it shoves / rocks, a shot can tip it over'},
  towerPc: {dynamic: true, mass: 9, mat: 'metal', shape: 'box', onHost: true, how: 'a desktop tower case (~9 kg) on a demo table: a shot knocks it over / off its table'},
  hangSign: {dynamic: false, why: 'mounted', how: 'a printed booth sign board hung from the ceiling on two cables (2.5 m+ clear under it): mounted'},
  signStand: {dynamic: true, mass: 14, mat: 'pad', shape: 'box', how: 'a freestanding sign totem (~14 kg, flat steel base on felt pads): walked into it slides / tips, a shot rocks it over'},
} satisfies Record<string, DestPhys>;

const NONE = (role: 'equipment' | 'decor' | 'surface', how: string) => ({cls: 'none' as const, role, how});

export const EXPO_SPECS: Readonly<Record<ExpoKind, EventKindSpec>> = {
  skyExpoLedWall: {
    def: def('ledWall'), phys: phys.ledWall, damage: 'screen', open: NONE('equipment', 'an LED video wall: nothing to open'),
    parts: () => {
      const {w, h} = D.ledWall;
      return [box('black', [w, h, 0.06], [0, h / 2, -0.03]), box('steelDark', [w, 0.06, 0.1], [0, h - 0.03, 0]), box('steelDark', [w, 0.08, 0.1], [0, 0.04, 0]),
        box('steelDark', [0.06, h, 0.1], [-(w / 2 - 0.03), h / 2, 0]), box('steelDark', [0.06, h, 0.1], [w / 2 - 0.03, h / 2, 0])];
    },
    faces: () => [{paint: 'expo-led', w: 6.0, h: 3.08, p: [0, 1.66, 0.052], glow: 0.6}],
  },
  skyExpoLectern: {
    def: def('lectern', {physics: dyn(30, 'wood', true)}), phys: phys.lectern, damage: 'wood', open: NONE('equipment', 'a lectern with a solid front: nothing to open'),
    parts: () => [
      box('black', [0.62, 0.05, 0.52], [0, 0.025, 0]),
      box('accent', [0.52, 1.0, 0.4], [0, 0.55, -0.02]),
      box('black', [0.62, 0.04, 0.48], [0, 1.1, -0.02], -0.22),
      box('steelDark', [0.016, 0.26, 0.016], [0.17, 1.24, 0.08], 0.45),
      box('black', [0.03, 0.06, 0.03], [0.17, 1.36, 0.14]),
    ],
    faces: () => [{paint: 'expo-lectern', w: 0.42, h: 0.42, p: [0, 0.62, 0.182]}],
  },
  skyExpoBoothWall: {
    def: def('boothWall'), phys: phys.boothWall, damage: 'laminate', open: NONE('decor', 'a booth wall panel: nothing to open'),
    parts: v => {
      const {w, h} = D.boothWall;
      return [
        box('steelBright', [0.05, h, 0.06], [-(w / 2 - 0.025), h / 2, 0]), box('steelBright', [0.05, h, 0.06], [w / 2 - 0.025, h / 2, 0]),
        box('steelBright', [w, 0.05, 0.06], [0, h - 0.025, 0]), box('steelBright', [w, 0.04, 0.06], [0, 2.05, 0]), box('steelBright', [w, 0.05, 0.06], [0, 0.025, 0]),
        box(expoPanelMat(v), [w - 0.1, 1.98, 0.02], [0, 1.04, -0.02]),
        box('black', [w - 0.06, 0.38, 0.04], [0, 2.26, 0.0]),
      ];
    },
    faces: () => [
      {paint: 'expo-header', w: 2.9, h: 0.36, p: [0, 2.26, 0.022], glow: 0.35},
      {paint: 'expo-graphic', w: 1.8, h: 1.2, p: [0, 1.3, -0.008]},
    ],
  },
  skyExpoDemoCounter: {
    def: def('counter'), phys: phys.counter, damage: 'laminate', open: NONE('surface', 'a closed demo counter (solid panels, no doors or drawers): a work surface, nothing to open'),
    parts: () => [box('black', [1.5, 0.08, 0.5], [0, 0.04, 0]), box('accent', [1.56, 0.9, 0.56], [0, 0.53, 0]), box('counter', [1.6, 0.04, 0.6], [0, 0.98, 0])],
    faces: () => [{paint: 'expo-counter', w: 1.4, h: 0.35, p: [0, 0.62, 0.282], glow: 0.25}],
  },
  skyExpoDemoTable: {
    def: def('table'), phys: phys.table, damage: 'laminate', open: NONE('surface', 'an open demo table (legs, top and a modesty panel; no drawers): nothing to open'),
    parts: v => {
      const {w, h, d} = D.table, legs: DestDrawnPart[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(box('steelBright', [0.04, h - 0.04, 0.04], [sx * (w / 2 - 0.05), (h - 0.04) / 2, sz * (d / 2 - 0.05)]));
      return [...legs, box('laminate', [w, 0.04, d], [0, h - 0.02, 0]), box(expoPanelMat(v), [w - 0.14, 0.34, 0.02], [0, h - 0.24, d / 2 - 0.06])];
    },
  },
  skyExpoPlinth: {
    def: def('plinth'), phys: phys.plinth, damage: 'wood', open: NONE('surface', 'a solid display plinth: nothing to open'),
    parts: v => [box(v % 2 ? 'black' : 'accent', [0.5, 0.97, 0.5], [0, 0.485, 0]), box(v % 2 ? 'steelBright' : 'counter', [0.52, 0.03, 0.52], [0, 0.985, 0])],
  },
  skyExpoScreenStand: {
    def: def('screenStand', {physics: dyn(45, 'pad')}), phys: phys.screenStand, damage: 'screen', open: NONE('equipment', 'a display on a stand: nothing to open'),
    parts: () => [
      box('steelDark', [0.9, 0.03, 0.65], [0, 0.015, 0]),
      box('steelBright', [0.06, 1.55, 0.05], [-0.3, 0.8, -0.07]), box('steelBright', [0.06, 1.55, 0.05], [0.3, 0.8, -0.07]),
      box('black', [1.55, 0.9, 0.06], [0, 1.54, 0]), box('black', [0.6, 0.4, 0.05], [0, 1.54, -0.055]),
    ],
    faces: () => [{paint: 'expo-slide', w: 1.48, h: 0.83, p: [0, 1.54, 0.031], glow: 0.6}],
  },
  skyExpoTowerPc: {
    def: def('towerPc', {physics: dyn(9, 'metal', true)}), phys: phys.towerPc, damage: 'sheetMetal', open: NONE('equipment', 'a closed computer case (screwed side panel): nothing to open'),
    parts: () => [box('black', [0.2, 0.42, 0.45], [0, 0.23, 0]), box('steelDark', [0.18, 0.02, 0.4], [0, 0.01, 0]), box('paintBlue', [0.012, 0.3, 0.006], [0.06, 0.25, 0.226]), box('steelBright', [0.03, 0.03, 0.006], [-0.05, 0.38, 0.226])],
  },
  skyExpoHangSign: {
    def: def('hangSign'), phys: phys.hangSign, damage: 'plastic', open: NONE('decor', 'a hanging sign board: nothing to open'),
    parts: () => {
      // the board from the placement's base (y 0) to the top batten (0.6), the cables from there up to the ceiling (h)
      const {w, h} = D.hangSign, top = h - EXPO_SIGN_CABLE, bh = top - 0.035;
      return [
        box('steelDark', [w + 0.05, 0.035, 0.035], [0, top - 0.0175, 0]), box('steelDark', [w + 0.05, 0.03, 0.03], [0, 0.015, 0]),
        box('steelDark', [0.008, EXPO_SIGN_CABLE, 0.008], [-(w / 2 - 0.1), top + EXPO_SIGN_CABLE / 2, 0]), box('steelDark', [0.008, EXPO_SIGN_CABLE, 0.008], [w / 2 - 0.1, top + EXPO_SIGN_CABLE / 2, 0]),
        box('paintWhite', [w, bh, 0.01], [0, bh / 2, 0]),
      ];
    },
    faces: () => [{paint: 'expo-hang', w: 2.36, h: 0.52, p: [0, 0.3, 0.007], back: true}],
  },
  skyExpoSignStand: {
    def: def('signStand', {physics: dyn(14, 'pad')}), phys: phys.signStand, damage: 'plastic', open: NONE('decor', 'a sign totem: nothing to open'),
    parts: () => [
      box('steelDark', [0.9, 0.03, 0.45], [0, 0.015, 0]),
      box('steelBright', [0.04, 1.96, 0.05], [-0.43, 1.0, 0]), box('steelBright', [0.04, 1.96, 0.05], [0.43, 1.0, 0]),
      box('black', [0.84, 1.72, 0.04], [0, 1.12, 0]),
    ],
    faces: () => [{paint: 'expo-totem', w: 0.8, h: 1.6, p: [0, 1.12, 0.022], glow: 0.4, back: true}] satisfies EventFace[],
  },
};

/** Scale-check records (tools/asset-pipeline/props/scale-check.mjs --kind <kind> beside zombie lastshift, viewed): W x H x D, contact. */
export const EXPO_SCALE: Readonly<Record<ExpoKind, string>> = {
  skyExpoLedWall: '6.20 x 3.30 x 0.11 m (W x H x D); its base 0.06 m over the stage deck (1.09 m), its top 4.39 m under the truss beam; 4 contacts on the deck',
  skyExpoLectern: '0.62 x 1.39 x 0.52 m (sloped top at 1.12 m, gooseneck to 1.39); grounded, 4 contacts on the deck',
  skyExpoBoothWall: '3.00 x 2.50 x 0.06 m drawn (0.12 m collider); header band 2.05-2.45 m; grounded, 2 contact runs',
  skyExpoDemoCounter: '1.60 x 1.00 x 0.60 m; top 1.00 m (a standing counter); grounded, 4 contacts',
  skyExpoDemoTable: '1.60 x 0.75 x 0.80 m; top 0.75 m (desk height); grounded on 4 legs',
  skyExpoPlinth: '0.52 x 1.00 x 0.52 m; top 1.00 m; grounded, 4 contacts',
  skyExpoScreenStand: '1.55 x 1.99 x 0.65 m (a 65-inch panel, its centre 1.54 m); grounded base plate, 4 contacts',
  skyExpoTowerPc: '0.20 x 0.44 x 0.45 m (a mid tower); grounded, 4 contacts',
  skyExpoHangSign: '2.45 x 1.10 x 0.04 m (board 0.60 m + 0.50 m cables); hung: its top at the ceiling, >= 2.5 m clear under the board',
  skyExpoSignStand: '0.90 x 1.98 x 0.45 m (a 0.80 x 1.60 m totem face); grounded base plate, 4 contacts',
};
