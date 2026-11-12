// Task train-interaction-ux-20261112-063646 (lane CRAFT-UI): THE RECIPE PREVIEWS of the crafting bench — the 3D picture on the left of
// each recipe row (ui/craftView.ts). User: "Put an actual 3D item preview, like the inventory preview, on the LEFT of each recipe.
// Reuse the inventory model-preview/cache resources; no new artwork or proxy final images."
//
// WHAT IS SHOWN: the unit the recipe makes, exactly as the equipment system draws it in the car — world/trainEquipmentModel.ts
// EquipmentLook.build(def) of the LIVE system's look: a device on the fuel dolly's hand truck, the chest (the Lockbox model at its scale,
// lid shut). No new art: the same cooked models, cloned (geometry / materials shared with the live templates, never disposed here).
//
// HOW: one extra source per recipe is registered with the inventory's icon pass (ui/itemIcons.ts registerIconSource, id
// 'equipment:<kind>' — ui/craftView.ts craftPreviewId), driven by craft/recipes.ts RECIPES and the kinds' TRAITS (no list of kinds):
// the pass renders it with the game's renderer into its small target and keeps the PNG in the same cache the item icons live in.
//
// NO PROXY: a source gives its object only while EVERY part of the view is the real model — the kind's own model (view.standIn false)
// and, for a kind that stands on the hand truck, the truck's model. Otherwise it gives null: nothing is rendered and the row keeps its
// empty frame (an earlier real render stays cached).
//
// WHEN: never per frame and not on every open. tick() — the bench's update while the car stands parked in a live world — is one integer
// compare: a render is requested only when the look's generation changed since the last request (its real models arrived or changed),
// so the one-time render and its shader compile happen right after a station build, not as a hitch on the first [E]. opened() — the
// list opened — asks again only for previews still missing (a readback that failed, a pass that could not run). One pass at a time,
// never while a warm-up owns the renderer. Without a renderer (Node tests: no `refreshIcons`) nothing is ever requested.

import type * as THREE from 'three';
import {EQUIPMENT, type EquipmentDef} from '../craft/equipment';
import {RECIPES, type Recipe} from '../craft/recipes';
import {craftPreviewId} from '../ui/craftView';
import {itemIconUrl, registerIconSource} from '../ui/itemIcons';
import {cartModels} from './fuelCartModel';
import {poseEquipmentLid, type EquipmentLook} from './trainEquipmentModel';

/** What the previews read of the live equipment system's look (world/trainEquipment.ts `look`). */
export type PreviewLook = Pick<EquipmentLook, 'gen' | 'build'>;

/**
 * The preview camera per TRAIT of a unit (degrees; ui/itemIcons.ts: azimuth from the +Z front toward +X, elevation above the horizon) —
 * how it is moved decides its frame (world/trainEquipmentModel.ts): a 'dolly' kind's +Z is the module's console face with the handle
 * behind it, a 'carry' kind's +Z is the box's latch side. Both: a front three-quarter view from a little above.
 */
export const PREVIEW_VIEW: Readonly<Record<EquipmentDef['move'], {az: number; el: number}>> = {
  dolly: {az: 34, el: 14},
  carry: {az: 30, el: 24},
};

/**
 * The unit `def` as the equipment system draws it NOW, from real models only: null while any part of it would be a stand-in (its own
 * model, or the hand truck a 'dolly' kind stands on). A fresh view every call — never a live unit's; a lid is shut.
 */
export function previewObject(look: PreviewLook, def: EquipmentDef): THREE.Object3D | null {
  if (def.move === 'dolly' && !cartModels().truck) return null; // (the look builds the truck from world/fuelCartModel.ts: its stand-in otherwise)
  const view = look.build(def);
  if (view.standIn) return null;
  poseEquipmentLid(view, 0);
  return view.group;
}

export interface CraftPreviewHost {
  /** The live equipment system's look (null: no equipment system). */
  look(): PreviewLook | null;
  /** Render `ids` into the item-icon cache (Game: ui/itemIcons.ts refreshItemIcons with its renderer). Absent: nothing is rendered. */
  refreshIcons?: ((ids: readonly string[]) => Promise<void> | void) | null;
  /** Can icons be rendered yet (the renderer is initialised)? Absent = yes. */
  rendererReady?: (() => boolean) | null;
  /** Resolves when the renderer is free for an icon render (no warm-up running); null / absent = free now. */
  rendererFree?: (() => Promise<unknown> | null | undefined) | null;
}

export class CraftPreviews {
  /** The preview ids, in recipe order. */
  readonly ids: readonly string[];
  /** Counters (QA / tests). */
  readonly counts = {requests: 0, built: 0, held: 0};
  /** The look generation the last request was made for (-1: none yet). */
  private askedGen = -1;
  private run: Promise<void> | null = null;
  private readonly defs = new Map<string, EquipmentDef>();
  private readonly unregister: (() => void)[] = [];

  constructor(private readonly host: CraftPreviewHost, recipes: readonly Recipe[] = RECIPES) {
    for (const r of recipes) this.defs.set(craftPreviewId(r.kind), EQUIPMENT[r.kind]);
    this.ids = [...this.defs.keys()];
  }

  /** Register one icon source per recipe (idempotent). */
  install(): this {
    if (this.unregister.length) return this;
    for (const [id, def] of this.defs) this.unregister.push(registerIconSource(id, {build: () => this.build(id), view: PREVIEW_VIEW[def.move]}));
    return this;
  }

  dispose(): void {
    for (const u of this.unregister.splice(0)) u();
  }

  /** The object the icon pass renders for `id` now (null: nothing real to show). */
  build(id: string): THREE.Object3D | null {
    const def = this.defs.get(id), look = this.host.look();
    if (!def || !look) return null;
    let o: THREE.Object3D | null = null;
    try { o = previewObject(look, def); } catch (err) { console.warn(`crafting bench: the preview of ${id} could not be built`, err); }
    if (o) this.counts.built++;
    return o;
  }

  /** The previews the cache does not hold. */
  missing(): string[] {
    return this.ids.filter(id => !itemIconUrl(id));
  }

  /** While the world is live (per frame: one compare): render when the look's models changed since the last request. */
  tick(): void {
    const look = this.host.look();
    if (!look || look.gen === this.askedGen) return;
    this.request(look, this.ids);
  }

  /** The list opened: ask again only when something is missing. */
  opened(): void {
    const look = this.host.look();
    if (!look) return;
    if (look.gen !== this.askedGen) { this.request(look, this.ids); return; }
    const missing = this.missing();
    if (missing.length) this.request(look, missing);
  }

  /** Resolves when the pass running now (if any) is over (tests; a caller that wants the previews before it shows them). */
  async settled(): Promise<void> {
    while (this.run) await this.run;
  }

  private request(look: PreviewLook, ids: readonly string[]): void {
    const h = this.host, refresh = h.refreshIcons;
    if (!refresh) { this.askedGen = look.gen; return; } // no renderer (Node): nothing to ask, ever
    if (this.run) { this.counts.held++; return; } // one pass at a time: the next tick / open asks again
    if (h.rendererReady && !h.rendererReady()) return;
    this.askedGen = look.gen;
    const ready = ids.filter(id => this.build(id) !== null); // real models only: an id without them is not sent to the pass at all
    if (!ready.length) return;
    this.counts.requests++;
    this.run = (async () => {
      try {
        for (let free = h.rendererFree?.(); free; free = h.rendererFree?.()) await free.catch(() => undefined);
        await refresh(ready);
      } catch (err) {
        console.warn('crafting bench: the recipe previews could not be rendered (the frames stay empty)', err);
      } finally {
        this.run = null;
      }
    })();
  }

  qa() {
    const look = this.host.look();
    return {
      shown: Object.fromEntries(this.ids.map(id => [id, !!itemIconUrl(id)])), lookGen: look ? look.gen : null, askedGen: this.askedGen,
      busy: !!this.run, renderer: !!this.host.refreshIcons, counts: {...this.counts},
    };
  }
}
