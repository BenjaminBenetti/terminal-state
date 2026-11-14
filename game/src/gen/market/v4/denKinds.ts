// Task studio-corpse-market-shop-20261114-031614-01: THE CORPSE BUYER'S DEN's model-backed PROP KINDS (layout version 4) — the floor
// chute a body goes down and the buyer's barred booth. Ordinary prop placements (collision / bullets / sight from the footprint like every
// prop) drawn through the builder's generic instanced model path (world/builder.ts MODEL_FOR: a non-uniform fit to the PropDef box = the
// model's own real size); the den's runtime (world/corpseShop) animates the swallow / payout around them. Models (assets/
// corpseShopKit.generated.ts): Meshy T2.5 from Codex initial references, maps kept, level-only 'market-*'.
// Classified for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md) and spread into the shared tables
// by one tagged line each (gen/props.ts PROP_DEFS + PropKind, damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts, world/
// openablesSpec.ts OPENABLE_AUDIT, world/builder.ts MODEL_FOR, game.ts propModels / sectionModelKeys):
//  - rule 1: neither is storage — the chute is an open hopper over a shaft (its lid is welded open; nothing is kept in it), the booth a
//    barred screen over a counter on a solid riveted plate (no door, lid or drawer);
//  - rule 2 / 3: static — the chute `anchored` (a welded hopper bolted over its shaft), the booth `built-in` (welded into the den's wall
//    opening: the buyer's side is never reachable);
//  - rule 4: nothing loose is part of either (the booth's caged lamp and the chute's lid are built-in);
//  - rule 5: real size checked beside a runtime zombie (tools/asset-pipeline/props/scale-check.mjs; dims / contact recorded in
//    CORPSE_DEN_SCALE and docs/prop-affordances.md).

import type {PropDef} from '../../props';
import type {DamageClass, StaticWhy} from '../../../damage/materials';
import {CORPSE_SHOP_KIT} from '../../../assets/corpseShopKit.generated';

export const CORPSE_CHUTE_KIND = 'corpseChute' as const;
export const CORPSE_BOOTH_KIND = 'corpseBooth' as const;
export const CORPSE_DEN_KINDS = [CORPSE_CHUTE_KIND, CORPSE_BOOTH_KIND] as const;
export type CorpseDenKind = (typeof CORPSE_DEN_KINDS)[number];
const SET = new Set<string>(CORPSE_DEN_KINDS);
export const isCorpseDenKind = (k: string): k is CorpseDenKind => SET.has(k);

/** The model of each kind (lazy prop-library key + url / bytes / real dims [w, h, d]). */
export const CORPSE_DEN_MODEL_OF: Readonly<Record<CorpseDenKind, (typeof CORPSE_SHOP_KIT)[keyof typeof CORPSE_SHOP_KIT]>> = {
  [CORPSE_CHUTE_KIND]: CORPSE_SHOP_KIT.chute,
  [CORPSE_BOOTH_KIND]: CORPSE_SHOP_KIT.booth,
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Collision boxes = the models' real size (front +Z: the chute's open side / the booth's customer side). */
export const CORPSE_DEN_PROP_DEFS: Readonly<Record<CorpseDenKind, PropDef>> = Object.fromEntries(CORPSE_DEN_KINDS.map(k => {
  const [w, h, d] = CORPSE_DEN_MODEL_OF[k].dims;
  // the booth's bars leave wide open gaps: the buyer is seen through it
  return [k, {w: r3(w), h: r3(h), d: r3(d), blocksSight: false}];
})) as Record<CorpseDenKind, PropDef>;

/** The builder's instanced model per kind (world/builder.ts MODEL_FOR): the lazy library key. */
export const CORPSE_DEN_MODEL_FOR: Readonly<Record<CorpseDenKind, string>> = Object.fromEntries(CORPSE_DEN_KINDS.map(k => [k, CORPSE_DEN_MODEL_OF[k].key])) as Record<CorpseDenKind, string>;

/** The lazy prop-library file map of the den's kit (game.ts propModels). */
export const CORPSE_DEN_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(Object.values(CORPSE_SHOP_KIT).map(m => [m.key, {url: m.url, bytes: m.bytes}]));

/** The lazy model keys a layout's den kinds need (game.ts sectionModelKeys). */
export function corpseDenModelKeysFor(layout: {props?: readonly {kind: string}[]}): string[] {
  const s = new Set<string>();
  for (const p of layout.props ?? []) if (isCorpseDenKind(p.kind)) s.add(CORPSE_DEN_MODEL_OF[p.kind].key);
  return [...s].sort();
}

export const CORPSE_DEN_DAMAGE_CLASS: Readonly<Record<CorpseDenKind, DamageClass>> = {[CORPSE_CHUTE_KIND]: 'steel', [CORPSE_BOOTH_KIND]: 'steel'};

/** Physics-affordance rows (damage/physicsAudit.ts): static, with the honest reason. */
export const CORPSE_DEN_STATIC: Readonly<Record<CorpseDenKind, readonly [StaticWhy, string]>> = {
  [CORPSE_CHUTE_KIND]: ['anchored', 'floor body chute: a welded steel hopper bolted down over its shaft at the four corners (a bump or a bullet never moves it)'],
  [CORPSE_BOOTH_KIND]: ['built-in', 'corpse buyer\'s booth: a welded barred screen and counter built into the den\'s wall opening (a fixture: the buyer\'s side stays sealed)'],
};

/** Openables audit (world/openablesSpec.ts OPENABLE_AUDIT; every kind classified). */
export const CORPSE_DEN_OPEN_AUDIT: readonly {kind: CorpseDenKind; cls: 'none'; role: 'equipment'; how: string}[] = [
  {kind: CORPSE_CHUTE_KIND, cls: 'none', role: 'equipment', how: 'floor body chute: an open hopper over a shaft, its lid welded upright (a disposal chute, nothing is stored in it)'},
  {kind: CORPSE_BOOTH_KIND, cls: 'none', role: 'equipment', how: 'barred trading screen over a counter on a solid riveted plate (no door, lid or drawer; nothing is stored in it)'},
];

/**
 * Rule 5 record: real size (W x H x D), the measured surfaces and contact of the cooked models (tools/asset-pipeline/props/
 * scale-check.mjs --kind corpseChute / corpseBooth beside the runtime 'lastshift' zombie, 1.78 m at scale 1; viewed 2026-11-14).
 */
export const CORPSE_DEN_SCALE = `chute ${CORPSE_SHOP_KIT.chute.dims.join(' x ')} m (hopper rim ${CORPSE_SHOP_KIT.chute.rimY} m, above the knee; its open lid stands along the back edge to the full height; grounded on its four corner foot plates); ` +
  `booth ${CORPSE_SHOP_KIT.booth.dims.join(' x ')} m (counter top ${CORPSE_SHOP_KIT.booth.counterY} m, sloping a few cm down toward the customer; grounded on its two side posts' foot plates, the plate's bottom rail along the floor)`;
