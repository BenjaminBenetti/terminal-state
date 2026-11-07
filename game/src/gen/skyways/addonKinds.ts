// Task studio-skyways-level-20261106-054448 (lane ADDON): the Skyways ADD-ON's NEW PROP KINDS — the anime convention hall (stage,
// its backdrop, merch tables with their loose merch, posters / poster boards, ceiling-hung banners, the welcome sign, the mascot
// statues) and the prize-car atrium (rope stanchions, the prize-draw board). Pure data (no three.js). Each kind is classified here
// for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md) and spread into the shared tables by one
// tagged line each: gen/props.ts PROP_DEFS (+ PropKind), damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts PROP_PHYSICS_AUDIT,
// world/openablesSpec.ts OPENABLE_AUDIT. Drawn by world/skywaysAddon.ts (level-only lazy `skyways-*` models, the Codex art atlases on
// flat panels); the lazy keys come from skywaysAddonModelKeysFor (game.ts sectionModelKeys). Placed by gen/skyways/addon.ts.
//
// Models (front +Z, real size, grounded, centred; the Meshy maps kept): lane ASSET-D's assets/skywaysMeshyProps.generated.ts
// (stage, merch table, boxed figure, plush, stanchion) and lane ASSET-C's assets/skywaysMascot.generated.ts (one GLB, a mesh node per
// baked pose). Art (Codex initial sources, crop / pack only): assets/skywaysArt.generated.ts atlases shown on flat panels (posters,
// banners, stage backdrop, welcome sign, merch prints, the GRAND PRIZE DRAW board) — no new painting.
//
// Affordances (rule 1: nothing here reads as storage; rule 2: the loose / light things move; rule 3: the rest are classified exceptions):
//  - stage: a modular stage (deck risers on locked legs + a truss goalpost rig, ~1 t) — static structure; its collision is the DECK
//    (8.0 x 4.25 m at 1.029 m: the truss / speakers above it are drawn only) plus a collision-only box for its front steps (variant 1);
//  - backdrop: the stage backdrop vinyl laced into the truss behind the deck — static, mounted;
//  - merch table: a 6-ft vendor table under a floor-length cloth — static booth fixture: the loose merch standing on it goes loose only
//    on a static host (on-host decor: physics/dynamicItems.ts restsOnStaticHost) and a prop something rests on never moves;
//  - boxed figure / plush / print card: loose merch on the merch tables' tops — dynamic on-host decor (a shot knocks it over / off);
//  - poster: a paper poster in a snap frame on a wall — static, mounted; poster board / welcome sign / prize board: freestanding
//    display boards on flat feet — dynamic (walked into or shot, they slide / tip; the prize car knocks them over);
//  - banner: a fabric banner on battens hung from the ceiling on two cables — static, mounted (2.3 m+ clear underneath);
//  - mascot statue: a life-size resin statue (~150 kg) on a round plinth bolted to the floor — static, anchored (never an NPC);
//  - stanchion: a chrome rope stanchion on a weighted base (~8 kg) — dynamic (the velvet ropes between them are drawn by
//    world/skywaysAddonRuntime.ts: they hang between upright posts and drop to the floor when a post is knocked over).
// No loose items are baked into any furniture model (rule 4): the merch is separate props. Scale: see SKYWAYS_ADDON_SCALE below.

import type {PropDef} from '../props';
import type {DamageClass, PhysMat, StaticWhy} from '../../damage/materials';
import type {ShapeMat} from '../propShapes';
import {SKYWAYS_MESHY_PROPS, type SkywaysMeshyPropKey} from '../../assets/skywaysMeshyProps.generated';
import {SKYWAYS_MASCOT, type SkywaysMascotPoseName} from '../../assets/skywaysMascot.generated';
import {SKYWAYS_ART, SKYWAYS_CON_BANNERS, SKYWAYS_CON_POSTERS, SKYWAYS_CON_PRINTS, type SkywaysArtAtlasKey} from '../../assets/skywaysArt.generated';

export const SKYWAYS_ADDON_KINDS = [
  'skywaysConStage', 'skywaysConBackdrop', 'skywaysConMerchTable', 'skywaysConFigureBox', 'skywaysConPlush', 'skywaysConPrintCard',
  'skywaysConPoster', 'skywaysConPosterBoard', 'skywaysConBanner', 'skywaysConWelcome', 'skywaysMascotStatue',
  'skywaysPrizeStanchion', 'skywaysPrizeBoard',
] as const;
export type SkywaysAddonKind = (typeof SKYWAYS_ADDON_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(SKYWAYS_ADDON_KINDS);
export const isSkywaysAddonKind = (k: string): k is SkywaysAddonKind => KIND_SET.has(k);

// ---------------------------------------------------------------------------------------------
// Models

/** The Meshy model each model-backed kind renders with (assets/skywaysMeshyProps.generated.ts key). */
export const SKYWAYS_ADDON_MODEL: Readonly<Partial<Record<SkywaysAddonKind, SkywaysMeshyPropKey>>> = {
  skywaysConStage: 'skyways_con_stage', skywaysConMerchTable: 'skyways_con_merch_table', skywaysConFigureBox: 'skyways_con_figure_box',
  skywaysConPlush: 'skyways_con_plush', skywaysPrizeStanchion: 'skyways_prize_stanchion',
};
/** Cooked file sizes (bytes; the lazy library's progress weights — tests/skyways-addon.test.ts checks them against the files). */
export const SKYWAYS_ADDON_MODEL_BYTES: Readonly<Record<SkywaysMeshyPropKey, number>> = {
  skyways_car_dash: 1414504, skyways_car_seat: 737156, skyways_con_stage: 1372576, skyways_con_merch_table: 216084,
  skyways_con_figure_box: 251632, skyways_con_plush: 288800, skyways_prize_stanchion: 258556,
};
/** Lazy model-library key of a runtime file ('skyways-' prefix: level-only Skyways files, assets/levelAssets.ts). */
const keyOfUrl = (url: string): string => url.replace(/^.*\//, '').replace(/\.glb$/, '');
/** The mascot statues' GLB key (one mesh node per pose). */
export const SKYWAYS_MASCOT_MODEL_KEY = keyOfUrl(SKYWAYS_MASCOT.url);
/** Lazy model-library key of a kind (null: procedural / art panels only). */
export function skywaysAddonModelKey(k: SkywaysAddonKind): string | null {
  if (k === 'skywaysMascotStatue') return SKYWAYS_MASCOT_MODEL_KEY;
  const m = SKYWAYS_ADDON_MODEL[k];
  return m ? keyOfUrl(SKYWAYS_MESHY_PROPS[m].url) : null;
}
/** Lazy file map (game.ts propModels catalogue): `skyways-con-stage` -> assets/models/skyways-con-stage.glb, ... */
export const SKYWAYS_ADDON_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {
  ...Object.fromEntries(Object.values(SKYWAYS_ADDON_MODEL).map(m => [keyOfUrl(SKYWAYS_MESHY_PROPS[m!].url), {url: SKYWAYS_MESHY_PROPS[m!].url, bytes: SKYWAYS_ADDON_MODEL_BYTES[m!]}])),
  [SKYWAYS_MASCOT_MODEL_KEY]: {url: SKYWAYS_MASCOT.url, bytes: SKYWAYS_MASCOT.bytes},
};

/** Game.sectionModelKeys: the lazy model keys of the add-on kinds a layout placed (none outside a Skyways add-on). */
export function skywaysAddonModelKeysFor(layout: {props?: readonly {kind: string}[]}): readonly string[] {
  const out = new Set<string>();
  for (const p of layout.props ?? []) if (isSkywaysAddonKind(p.kind)) { const k = skywaysAddonModelKey(p.kind); if (k) out.add(k); }
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------
// Measured geometry (the cooked GLBs, model frame: front +Z, x centred, grounded; ray / slice measurements 2026-11-06)

const STAGE_M = SKYWAYS_MESHY_PROPS.skyways_con_stage;
/**
 * The stage (skyways-con-stage.glb 8.000 x 5.176 x 5.172 m): the DECK top at 1.029 m spans x -3.94..3.92, z -2.586 (its truss back)
 * .. 1.657 (deck edge), its skirt flaring to z 1.81 below it; the front steps (0.73 m) stand at x 2.2..3.6, z 1.81..2.586; the truss
 * goalpost rises at the back (uprights |x| 3.47..3.91, z -2.38..-1.75, beam underside 4.40 m) with two speakers hung in front of it
 * (|x| 2.56..3.18).
 */
export const SKYWAYS_STAGE = {
  deckY: STAGE_M.deckY,
  /** Deck box in the model frame (z): the truss back to the skirt's front. */
  deckZ0: -STAGE_M.d / 2, deckZ1: 1.81,
  /** The steps (model frame). */
  steps: {x0: 2.2, x1: 3.6, z0: 1.81, z1: STAGE_M.d / 2, h: 0.73},
  /** Truss: inner faces of the uprights (|x|), underside of the top beam, its back face (z). */
  trussInner: 3.47, beamY: 4.40, trussBackZ: -2.38,
} as const;
/** Deck depth (m) = the stage kind's collision depth; the model is drawn shifted by +stageModelShift along its local z. */
export const SKYWAYS_STAGE_DECK_D = SKYWAYS_STAGE.deckZ1 - SKYWAYS_STAGE.deckZ0;
export const SKYWAYS_STAGE_MODEL_SHIFT = -(SKYWAYS_STAGE.deckZ0 + SKYWAYS_STAGE.deckZ1) / 2;
/** Merch table (2.034 x 0.758 x 1.024 m incl. the cloth's flare at the floor): the flat cloth TOP spans x +-0.92, z +-0.39 at topY. */
export const SKYWAYS_MERCH_TOP = {y: SKYWAYS_MESHY_PROPS.skyways_con_merch_table.topY, x: 0.92, z: 0.39} as const;
/** Stanchion: the rope's eye ring height (on the post's +Z side, z ~0.07) and the base radius. */
export const SKYWAYS_STANCHION = {ringY: SKYWAYS_MESHY_PROPS.skyways_prize_stanchion.ringY, radius: 0.17} as const;

/** Mascot statue: plinth (round, bolted) under the baked pose. */
export const SKYWAYS_STATUE_PLINTH = {r: 0.55, h: 0.12} as const;
export const SKYWAYS_MASCOT_POSES = Object.keys(SKYWAYS_MASCOT.poses) as SkywaysMascotPoseName[];

// ---------------------------------------------------------------------------------------------
// Art panels (flat textured faces of the Codex atlases; front +Z, metres)

/** An art face of a kind: atlas piece shown on a quad of w x h centred at p (prop frame), facing +Z (back: also mirrored on -Z). */
export interface AddonArtFace { atlas: SkywaysArtAtlasKey; piece: string; w: number; h: number; p: readonly [number, number, number]; back?: boolean; rx?: number }
/** A frame / stand box (prop frame, centre p, size s; shape-material key: world/shapeMaterials.ts). */
export interface AddonPart { m: ShapeMat; s: readonly [number, number, number]; p: readonly [number, number, number]; rx?: number }

/** Panel sizes (m): face w x h follow the atlas piece's aspect. */
export const SKYWAYS_ART_SIZE = {
  poster: {w: 0.8, h: 1.2},
  banner: {w: 1.1, h: 1.1 / SKYWAYS_ART.conBanners.pieces['banner-wave'].aspect},
  backdrop: {w: 4.8, h: 3.2},
  welcome: {w: 1.2, h: 0.8},
  print: {w: 0.18, h: 0.18},
  prize: {w: 1.8, h: 1.2},
} as const;

const PS = SKYWAYS_ART_SIZE;
/** Bottom of a wall poster's frame above the floor (m). */
export const SKYWAYS_POSTER_Y = 1.05;
/** Cable drop of a hung banner (top batten -> ceiling, m). */
export const SKYWAYS_BANNER_CABLE = 0.52;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const DEFS: Record<SkywaysAddonKind, {w: number; d: number; h: number; blocksSight?: boolean}> = {
  // collision = the deck (the truss / speakers are drawn above it only); the steps are a variant-1 placement of their own size
  skywaysConStage: {w: STAGE_M.w, d: r3(SKYWAYS_STAGE_DECK_D), h: STAGE_M.deckY},
  skywaysConBackdrop: {w: PS.backdrop.w + 0.06, d: 0.04, h: PS.backdrop.h + 0.06},
  // the full cloth flare at the floor (2.03 x 1.02); its top (the host top of the merch) at topY
  skywaysConMerchTable: {w: SKYWAYS_MESHY_PROPS.skyways_con_merch_table.w, d: SKYWAYS_MESHY_PROPS.skyways_con_merch_table.d, h: SKYWAYS_MERCH_TOP.y},
  skywaysConFigureBox: {w: SKYWAYS_MESHY_PROPS.skyways_con_figure_box.w, d: SKYWAYS_MESHY_PROPS.skyways_con_figure_box.d, h: SKYWAYS_MESHY_PROPS.skyways_con_figure_box.h},
  skywaysConPlush: {w: SKYWAYS_MESHY_PROPS.skyways_con_plush.w, d: SKYWAYS_MESHY_PROPS.skyways_con_plush.d, h: SKYWAYS_MESHY_PROPS.skyways_con_plush.h},
  skywaysConPrintCard: {w: 0.21, d: 0.11, h: 0.25},
  skywaysConPoster: {w: PS.poster.w + 0.04, d: 0.03, h: PS.poster.h + 0.04},
  skywaysConPosterBoard: {w: 0.96, d: 0.46, h: 1.98, blocksSight: false},
  skywaysConBanner: {w: PS.banner.w + 0.1, d: 0.06, h: r3(PS.banner.h + 0.06 + SKYWAYS_BANNER_CABLE)},
  skywaysConWelcome: {w: 1.26, d: 0.5, h: 1.92},
  // the plinth's diameter (round collider, any yaw); h = plinth + the 1.40 m pose (per placement: + the pose's height x scale)
  skywaysMascotStatue: {w: SKYWAYS_STATUE_PLINTH.r * 2, d: SKYWAYS_STATUE_PLINTH.r * 2, h: r3(SKYWAYS_STATUE_PLINTH.h + SKYWAYS_MASCOT.height)},
  skywaysPrizeStanchion: {w: SKYWAYS_STANCHION.radius * 2, d: SKYWAYS_STANCHION.radius * 2, h: SKYWAYS_MESHY_PROPS.skyways_prize_stanchion.h},
  skywaysPrizeBoard: {w: 1.9, d: 0.56, h: 2.12},
};

/** Frame / stand parts and art faces of the panel kinds (prop frame; variant = the art piece index). Model kinds: []. */
export function skywaysAddonShape(kind: SkywaysAddonKind, variant = 0): {parts: AddonPart[]; faces: AddonArtFace[]} {
  const parts: AddonPart[] = [], faces: AddonArtFace[] = [];
  const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number], rx?: number) => parts.push({m, s, p, ...(rx ? {rx} : {})});
  const pick = <T extends readonly string[]>(list: T) => list[((variant % list.length) + list.length) % list.length];
  switch (kind) {
    case 'skywaysConPoster': {
      // aluminium snap frame on the wall (back at z -d/2), the paper poster under it
      const {w, h} = PS.poster, f = 0.02, d = DEFS.skywaysConPoster.d;
      box('steelBright', [w + 2 * f, f, d], [0, f / 2, 0]); box('steelBright', [w + 2 * f, f, d], [0, h + 1.5 * f, 0]);
      box('steelBright', [f, h, d], [-(w + f) / 2, h / 2 + f, 0]); box('steelBright', [f, h, d], [(w + f) / 2, h / 2 + f, 0]);
      box('panel', [w, h, 0.01], [0, h / 2 + f, -d / 2 + 0.005]);
      faces.push({atlas: 'conPosters', piece: pick(SKYWAYS_CON_POSTERS), w, h, p: [0, h / 2 + f, -d / 2 + 0.011]});
      break;
    }
    case 'skywaysConPosterBoard': {
      // a foam-core display board between two steel posts on flat feet, the poster on both faces
      const {w, h} = PS.poster, bw = w + 0.1, bh = h + 0.16, y0 = 0.62, t = 0.025;
      box('panel', [bw, bh, t], [0, y0 + bh / 2, 0]);
      for (const s of [-1, 1]) {
        box('steelDark', [0.035, y0 + bh + 0.08, 0.035], [s * (bw / 2 + 0.02), (y0 + bh + 0.08) / 2, 0]);
        box('steelDark', [0.06, 0.03, DEFS.skywaysConPosterBoard.d], [s * (bw / 2 + 0.02), 0.015, 0]);
      }
      faces.push({atlas: 'conPosters', piece: pick(SKYWAYS_CON_POSTERS), w, h, p: [0, y0 + bh / 2, t / 2 + 0.002], back: true});
      break;
    }
    case 'skywaysConBanner': {
      // fabric banner between two battens, two cables up to the ceiling (the placement's top = the ceiling)
      const {w, h} = PS.banner, H = DEFS.skywaysConBanner.h, top = H - SKYWAYS_BANNER_CABLE;
      box('steelDark', [w + 0.1, 0.035, 0.035], [0, top - 0.0175, 0]); box('steelDark', [w + 0.1, 0.03, 0.03], [0, top - h - 0.05, 0]);
      for (const s of [-1, 1]) box('steelDark', [0.008, SKYWAYS_BANNER_CABLE, 0.008], [s * (w / 2 - 0.05), top + SKYWAYS_BANNER_CABLE / 2, 0]);
      box('panel', [w, h, 0.006], [0, top - 0.035 - h / 2, 0]);
      faces.push({atlas: 'conBanners', piece: pick(SKYWAYS_CON_BANNERS), w, h, p: [0, top - 0.035 - h / 2, 0.004], back: true});
      break;
    }
    case 'skywaysConBackdrop': {
      const {w, h} = PS.backdrop;
      box('black', [w + 0.06, h + 0.06, 0.02], [0, (h + 0.06) / 2, -0.01]);
      faces.push({atlas: 'conStage', piece: 'backdrop', w, h, p: [0, 0.03 + h / 2, 0.002]});
      break;
    }
    case 'skywaysConWelcome': {
      // sign board on an easel stand: two legs behind the board, a rear strut, a ledge under the board; the welcome art on the front
      const {w, h} = PS.welcome, y0 = 1.06, t = 0.025;
      box('panel', [w + 0.04, h + 0.04, t], [0, y0 + h / 2, 0]);
      for (const s of [-1, 1]) box('steelDark', [0.035, y0 + h * 0.6, 0.035], [s * (w / 2 - 0.12), (y0 + h * 0.6) / 2, -t / 2 - 0.02]);
      box('steelDark', [0.03, 1.5, 0.03], [0, 0.75, -0.14], 0.17);
      box('steelDark', [w - 0.2, 0.03, 0.06], [0, y0 - 0.035, 0.0]);
      faces.push({atlas: 'conSigns', piece: 'welcome', w, h, p: [0, y0 + h / 2, t / 2 + 0.002]});
      break;
    }
    case 'skywaysPrizeBoard': {
      // the GRAND PRIZE DRAW board between two posts on flat feet (front +Z: faces the hall's entry)
      const {w, h} = PS.prize, y0 = 0.88, t = 0.03;
      box('panel', [w + 0.06, h + 0.06, t], [0, y0 + h / 2, 0]);
      for (const s of [-1, 1]) {
        box('steelBright', [0.05, y0 + h + 0.1, 0.05], [s * (w / 2 + 0.05), (y0 + h + 0.1) / 2, 0]);
        box('steelBright', [0.08, 0.03, DEFS.skywaysPrizeBoard.d], [s * (w / 2 + 0.05), 0.015, 0]);
      }
      faces.push({atlas: 'prizeBoard', piece: 'board', w, h, p: [0, y0 + h / 2, t / 2 + 0.002]});
      break;
    }
    case 'skywaysConPrintCard': {
      // an acrylic easel block: a clear base, the print leaning back on it (rx: tilt back), a thin clear face over the print
      const {w, h} = PS.print, tilt = -0.2;
      box('glass', [0.21, 0.012, 0.1], [0, 0.006, 0]);
      box('porcelain', [w + 0.02, h + 0.05, 0.006], [0, 0.012 + (h + 0.05) / 2, 0.005], tilt);
      faces.push({atlas: 'conSigns', piece: pick(SKYWAYS_CON_PRINTS), w, h, p: [0, 0.012 + 0.025 + h / 2, 0.009], rx: tilt});
      break;
    }
    case 'skywaysMascotStatue':
      box('concrete', [SKYWAYS_STATUE_PLINTH.r * 2, SKYWAYS_STATUE_PLINTH.h, SKYWAYS_STATUE_PLINTH.r * 2], [0, SKYWAYS_STATUE_PLINTH.h / 2, 0]);
      break;
    default: break;
  }
  return {parts, faces};
}

// ---------------------------------------------------------------------------------------------
// Classification

/** Rigid-body row (damage/materials.ts PropPhysics shape) or the static reason. */
type AddonPhys =
  | {dynamic: true; mass: number; mat: PhysMat; shape: 'box' | 'cylinder'; onHost?: boolean; how: string}
  | {dynamic: false; why: StaticWhy; how: string};

/** Physics affordance of each kind (damage/physicsAudit.ts PROP_PHYSICS_AUDIT reads it; the live physics come from PROP_DEFS.physics). */
export const SKYWAYS_ADDON_PHYS: Readonly<Record<SkywaysAddonKind, AddonPhys>> = {
  skywaysConStage: {dynamic: false, why: 'structure', how: 'modular event stage: plywood deck risers on locked legs under a skirt with a truss goalpost rig and hung speakers (~1 t): a bump or a bullet does not shove it; collision is the 1.03 m deck plus its front steps'},
  skywaysConBackdrop: {dynamic: false, why: 'mounted', how: 'printed vinyl stage backdrop laced into the stage truss behind the deck'},
  skywaysConMerchTable: {dynamic: false, why: 'fixture', how: 'convention vendor table (a 6-ft banquet table under a floor-length cloth) set out in its booth row as the host of its merch: kept static so the loose figure boxes / plushes / print cards on its top can be knocked off it (on-host decor goes loose only on a static host; a prop something rests on never moves — no floating stacks)'},
  skywaysConFigureBox: {dynamic: true, mass: 0.6, mat: 'pad', shape: 'box', onHost: true, how: 'boxed collectible figure (~0.6 kg: a resin figure on its base in a window box) standing on a merch table: a shot knocks it over or off the table (on-host decor: out of reach of a walker\'s legs)'},
  skywaysConPlush: {dynamic: true, mass: 0.6, mat: 'pad', shape: 'box', onHost: true, how: 'stuffed mascot plush (~0.6 kg, bean-weighted base) on a merch table: a shot knocks it over or off the table (on-host decor)'},
  skywaysConPrintCard: {dynamic: true, mass: 0.6, mat: 'pad', shape: 'box', onHost: true, how: 'art print in an acrylic easel block (~0.6 kg of acrylic) on a merch table: a shot slides / knocks it over or off the table (on-host decor)'},
  skywaysConPoster: {dynamic: false, why: 'mounted', how: 'paper poster in an aluminium snap frame screwed to the wall'},
  skywaysConPosterBoard: {dynamic: true, mass: 7, mat: 'pad', shape: 'box', how: 'freestanding poster display board (foam-core panel between two steel posts on flat feet, ~7 kg): walked into it slides, shot it slides / tips over'},
  skywaysConBanner: {dynamic: false, why: 'mounted', how: 'fabric banner on two battens hung from the ceiling on cables (bottom >= 2.2 m above the floor)'},
  skywaysConWelcome: {dynamic: true, mass: 6, mat: 'pad', shape: 'box', how: 'welcome sign on a steel easel stand (~6 kg): walked into it slides, shot it slides / tips over'},
  skywaysMascotStatue: {dynamic: false, why: 'anchored', how: 'life-size resin mascot statue (~150 kg) on a round concrete plinth bolted to the floor: never moves (a statue, never an NPC)'},
  skywaysPrizeStanchion: {dynamic: true, mass: 8, mat: 'pad', shape: 'cylinder', how: 'chrome rope stanchion on a weighted base (~8 kg): walked into it slides, shot / rammed it tips over (its velvet ropes drop to the floor)'},
  skywaysPrizeBoard: {dynamic: true, mass: 12, mat: 'pad', shape: 'box', how: 'prize-draw display board between two posts on flat feet (~12 kg): walked into it slides, shot / rammed it tips over'},
};

const DAMAGE: Readonly<Record<SkywaysAddonKind, DamageClass>> = {
  skywaysConStage: 'wood', skywaysConBackdrop: 'fabric', skywaysConMerchTable: 'fabric', skywaysConFigureBox: 'cardboard', skywaysConPlush: 'fabric',
  skywaysConPrintCard: 'plastic', skywaysConPoster: 'cardboard', skywaysConPosterBoard: 'plastic', skywaysConBanner: 'fabric', skywaysConWelcome: 'plastic',
  skywaysMascotStatue: 'plastic', skywaysPrizeStanchion: 'steel', skywaysPrizeBoard: 'plastic',
};
/** Damage class (damage/materials.ts PropDamageSpec, 'never' breaks: marks only — no destructibility system). */
export const SKYWAYS_ADDON_DAMAGE_CLASS: Readonly<Record<SkywaysAddonKind, DamageClass>> = DAMAGE;

function defOf(k: SkywaysAddonKind): PropDef {
  const d = DEFS[k], ph = SKYWAYS_ADDON_PHYS[k];
  // dynamic kinds: calibrated `pad` contact + contact wake (`contact`), on-host decor `onHost` (damage/materials.ts propPhysics)
  return {w: r3(d.w), d: r3(d.d), h: r3(d.h), blocksSight: d.blocksSight ?? false,
    ...(ph.dynamic ? {physics: {mass: ph.mass, dynamic: true, shape: ph.shape, mat: ph.mat, contact: true, ...(ph.onHost ? {onHost: true} : {})}} : {})};
}
export const SKYWAYS_ADDON_PROP_DEFS: Readonly<Record<SkywaysAddonKind, PropDef>> = Object.fromEntries(SKYWAYS_ADDON_KINDS.map(k => [k, defOf(k)])) as Record<SkywaysAddonKind, PropDef>;

/** Openables audit rows (world/openablesSpec.ts OPENABLE_AUDIT; every kind classified, honest reason). */
export const SKYWAYS_ADDON_OPEN_AUDIT: readonly {kind: SkywaysAddonKind; cls: 'exception' | 'none'; role: 'equipment' | 'decor' | 'surface'; how: string}[] = [
  {kind: 'skywaysConStage', cls: 'none', role: 'equipment', how: 'event stage: a skirted deck on legs with a truss rig — no door, lid or drawer'},
  {kind: 'skywaysConBackdrop', cls: 'none', role: 'decor', how: 'printed vinyl backdrop in the stage truss'},
  {kind: 'skywaysConMerchTable', cls: 'none', role: 'surface', how: 'cloth-draped vendor table: an open top with its merch, no door or drawer'},
  {kind: 'skywaysConFigureBox', cls: 'exception', role: 'decor', how: 'sealed retail window box: the boxed figure is the merchandise itself (seen through its window), not storage with contents'},
  {kind: 'skywaysConPlush', cls: 'none', role: 'decor', how: 'stuffed plush: nothing to open'},
  {kind: 'skywaysConPrintCard', cls: 'none', role: 'decor', how: 'print in a solid acrylic block: nothing to open'},
  {kind: 'skywaysConPoster', cls: 'none', role: 'decor', how: 'framed wall poster'},
  {kind: 'skywaysConPosterBoard', cls: 'none', role: 'decor', how: 'freestanding poster display board'},
  {kind: 'skywaysConBanner', cls: 'none', role: 'decor', how: 'ceiling-hung fabric banner'},
  {kind: 'skywaysConWelcome', cls: 'none', role: 'decor', how: 'welcome sign on an easel stand'},
  {kind: 'skywaysMascotStatue', cls: 'none', role: 'decor', how: 'solid resin statue on a plinth: nothing to open'},
  {kind: 'skywaysPrizeStanchion', cls: 'none', role: 'equipment', how: 'rope stanchion post: nothing to open'},
  {kind: 'skywaysPrizeBoard', cls: 'none', role: 'decor', how: 'prize-draw display board on posts'},
];

/**
 * Scale-check record (tools/asset-pipeline/props/scale-check.mjs beside zombie `lastshift` at runtime scale 1.0, viewed; renders in the
 * lane's private QA folder): W x H x D, grounded contact, support heights.
 */
export const SKYWAYS_ADDON_SCALE = {
  skywaysConStage: '8.00 x 5.18 x 5.17 m as cooked (k 1); deck 1.03 m (84 % of the top-down area); grounded, 129 contact clusters (skirt hem, leg feet, steps 0.73 m); truss 5.18 m (hall ceilings 5.6 m)',
  skywaysConMerchTable: '2.03 x 0.76 x 1.02 m (cloth flare incl.; top 1.84 x 0.78 m); top 0.759 m (desk height, 79 %); grounded, 9 clusters (cloth hem)',
  skywaysConFigureBox: '0.16 x 0.24 x 0.06 m standing on the 0.757 m table top',
  skywaysConPlush: '0.30 x 0.34 x 0.28 m sitting on the 0.757 m table top (one contact)',
  skywaysPrizeStanchion: '0.34 x 0.96 x 0.34 m; grounded base disc (2 clusters, 5 cm base plate); eye ring 0.85 m',
} as const;

/** Poses by role (the convention's statues). */
export const SKYWAYS_STATUE_POSE: Readonly<Record<'entrance-wave' | 'washroom-point' | 'stage-cheer' | 'merch-bow' | 'green-room-stand' | 'registration-wave' | 'photo-pose', SkywaysMascotPoseName>> = {
  'entrance-wave': 'wave', 'washroom-point': 'point', 'stage-cheer': 'cheer', 'merch-bow': 'bow', 'green-room-stand': 'stand',
  // (lane VENUE, layout version 3) the venue's registration greeter and the photo lounge's photo-op pose
  'registration-wave': 'wave', 'photo-pose': 'cheer',
};
