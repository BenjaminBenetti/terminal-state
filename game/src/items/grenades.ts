// Task studio-refinement-batch-20261113-035659-01: the two CRAFTED throwables — the Acid Scrapper grenade and the Zombie Lure grenade.
// User: "Acid Scrapper Grenade: 3 bio_mater crafts 5 ... Zombie Lure Grenade: 3 bio_mater crafts 3" (craft/recipes.ts).
//
// Both are kind 'throwable' (items/items.ts): they go in the grenade slot and are thrown exactly like the road flare (hold G — or
// hold click while one is in the hand — to ready, release to throw: weapons/flareHold.ts), but the canister itself is simulated
// by weapons/grenades.ts (GrenadeSystem), not the flare system:
//  - acid: sticks to the prop it hits (a zombie hit bursts it on the zombie), bursts and leaves a 10-active-second acid pool that
//    burns every actor standing in it — the player too — and melts eligible props (world/acidMelt.ts: one salvage each, contents
//    spilled);
//  - lure: lands, then for 20 active seconds draws the infected within 30 m (ai/scentLure.ts SCENT.radius; was 20 m) to ITSELF, even without a line of sight
//    (ai/scentLure.ts): never to the player.
// Models: Meshy T2.5 derivatives of one Codex design image each, their own PBR maps kept (assets/grenades.generated.ts,
// world/grenadeModels.ts). Never loot: they only come from the train's crafting bench.
import type {ItemDef, ItemDims} from './items';
import {GRENADE_MODELS} from '../assets/grenades.generated';

/** Icon keys of the crafted throwables (ui/icons.ts SVG fallbacks; the 3D icon is the model). */
export type GrenadeIconKey = 'acidGrenade' | 'lureGrenade';

/** Stable item ids. */
export const ACID_GRENADE = 'acid_grenade';
export const LURE_GRENADE = 'lure_grenade';
export const GRENADE_IDS = [ACID_GRENADE, LURE_GRENADE] as const;
export type GrenadeId = (typeof GRENADE_IDS)[number];
export const isGrenadeItem = (id: string | null | undefined): id is GrenadeId => !!id && (GRENADE_IDS as readonly string[]).includes(id);
/** Which GrenadeSystem behaviour an item id throws. */
export const grenadeKind = (id: GrenadeId): 'acid' | 'lure' => (id === ACID_GRENADE ? 'acid' : 'lure');

export const GRENADE_ITEMS: Record<string, ItemDef> = {
  [ACID_GRENADE]: {id: ACID_GRENADE, name: 'Acid Scrapper grenade', short: 'Acid', kind: 'throwable', stackMax: 5, icon: 'acidGrenade',
    description: 'A sealed canister of scrapper acid brewed from bio mater. Goes in the grenade slot: hold G to ready it, release to throw. It sticks to the prop it hits and bursts — on a zombie it bursts at once. The pool eats through props for 10 seconds, each leaving one piece of salvage and spilling what it held, and burns anyone standing in it, you too. It never touches the train itself or its fitted fixtures.'},
  [LURE_GRENADE]: {id: LURE_GRENADE, name: 'Zombie Lure grenade', short: 'Lure', kind: 'throwable', stackMax: 5, icon: 'lureGrenade',
    description: 'A canister of rotten bio-mater scent. Goes in the grenade slot: hold G to ready it, release to throw. For 20 seconds the infected within 30 m smell it, even round corners, and go to the canister instead of you — unless they can see you. The blind Screacher and a sleeping Siren ignore it.'},
};

const dimsOf = (k: keyof typeof GRENADE_MODELS): ItemDims => {
  const [w, h, d] = GRENADE_MODELS[k].dims;
  return {w, d, h, shape: 'cylinder'};
};

/** The cooked models' measured bounds (upright canisters; origin bottom-centre, front +Z). */
export const GRENADE_DIMS: Record<string, ItemDims> = {
  [ACID_GRENADE]: dimsOf('acid'),
  [LURE_GRENADE]: dimsOf('lure'),
};
