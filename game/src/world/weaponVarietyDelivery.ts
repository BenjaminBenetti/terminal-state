// Task studio-weapon-runtime-fix-20261110-022206-01: THE ONE DELIVERY of a lazily loaded weapon model to everything that shows the
// weapon. User: "1337 on the train chest grants the new weapons, but they are TOTALLY INVISIBLE and item previews broken".
//
// Root cause: the twelve new weapons' models (world/weaponVarietyModels.ts) were fetched ONLY by the section preload (Game.prepareSection:
// what the next station realizes / remembers and what is carried or stored at that moment) and handed to the held view and the icons
// right there. A weapon that arrived any other way — the Lockbox gear drop, a trade, anything mid-play — had no model until the next
// station was prepared: nothing in hand, a glyph for its preview, a stand-in when dropped.
//
// Now every surface that shows an item ASKS for its model when it is not resident (requestWeaponVarietyModel: Viewmodel.setItem through
// onMissing, PickupManager.meshFor, itemIconHtml), and this module — subscribed ONCE to onWeaponVarietyReady — delivers whatever arrives,
// by any path (section preload, demand, a retry after a failed fetch), to all of them:
//  - the held view: Viewmodel.addModel (shown at once when it is the item in hand: setItem remembered it);
//  - the world: PickupManager.reskin — every stand-in handed out for it becomes the real model in place;
//  - the previews: the 3D icon is rendered (serialized, never while a warm-up owns the renderer, each icon drawn atomically:
//    ui/itemIcons.ts) and the open item views / the HUD redraw (onItemIconsChanged / itemIconsVersion);
//  - a failed fetch is said out loud once per weapon (the fetch retries on its own with a backoff) — never silently absent.
// The same class serves the game (Game's constructor) and the lean browser QA harness, so the proof runs this code.
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {
  WEAPON_VARIETY_MODEL_STATS, onWeaponVarietyFailed, onWeaponVarietyReady, requestWeaponVarietyModel, residentWeaponVarietyIds,
  weaponVarietyFailures, weaponVarietyGltf, weaponVarietyModelState, type WeaponVarietyFailure,
} from './weaponVarietyModels';
import {LAZY_MODEL_WEAPON_IDS} from '../weapons/lazyWeaponModels'; // task studio-flamethrower-fire-20261114-031614-01: the variety weapons + the Flamethrower

type Model = Pick<GLTF, 'scene'>;

export interface WeaponVarietyHost {
  /** The held view (absent until the boot built it). */
  viewmodel(): {addModel(id: string, gltf: Model): boolean; onMissing: ((id: string) => void) | null} | null | undefined;
  /** The world's pickups (absent until the boot built them). */
  pickups(): {reskin(ids: Iterable<string>): number} | null | undefined;
  /** Show the selected item in hand (called after a model was added; a no-op without a world). */
  syncHeld(): void;
  /** Render the 3D icons of `ids` (ui/itemIcons.ts refreshItemIcons; resolves when the cache holds them). */
  refreshIcons(ids: readonly string[]): Promise<void>;
  /** Resolves when the renderer is free for an icon render (no warm-up running); null / absent = free now. */
  rendererFree?(): Promise<unknown> | null | undefined;
  /** Can icons be rendered at all yet (the renderer is initialised)? Absent = yes. */
  rendererReady?(): boolean;
  /** Tell the player (a short HUD line). */
  say(text: string, bad: boolean): void;
  /** The item's name for a message. */
  itemName(id: string): string;
  /** Anything else that keys on a model's arrival (physics bounds caches ...). */
  onDelivered?(ids: readonly string[]): void;
}

export class WeaponVarietyDelivery {
  /** Counters (QA / tests). */
  readonly counts = {delivered: 0, held: 0, reskinned: 0, iconBatches: 0, icons: 0, failuresSaid: 0, recoveriesSaid: 0};
  private readonly unsub: (() => void)[] = [];
  private readonly iconQueue = new Set<string>();
  private iconRun: Promise<void> | null = null;
  /** Weapons whose failed load was reported (said again only after a success in between). */
  private readonly saidFailed = new Set<string>();
  private attached: object | null = null;

  constructor(private readonly host: WeaponVarietyHost) {}

  install(): this {
    this.unsub.push(onWeaponVarietyReady(ids => this.deliver(ids)), onWeaponVarietyFailed(f => this.failed(f)));
    return this;
  }

  dispose(): void {
    for (const u of this.unsub.splice(0)) u();
    const vm = this.host.viewmodel();
    if (vm && vm === this.attached) vm.onMissing = null;
    this.attached = null;
  }

  /**
   * The held view / the pickups exist now (the boot built them) or were replaced: hook the held view's demand and hand it every model
   * that is already resident (a model loaded before the view existed is never lost). Idempotent.
   */
  attach(): void {
    const vm = this.host.viewmodel();
    if (!vm) return;
    vm.onMissing = id => { requestWeaponVarietyModel(id); };
    if (this.attached === vm) return;
    this.attached = vm;
    const ids = residentWeaponVarietyIds();
    if (ids.length) this.deliver(ids);
  }

  /** Models became resident: the held view, the world's stand-ins, the icons. */
  private deliver(ids: readonly string[]): void {
    const vm = this.host.viewmodel();
    let held = 0;
    for (const id of ids) {
      const g = weaponVarietyGltf(id);
      if (!g) continue;
      this.counts.delivered++;
      if (vm?.addModel(id, g)) held++;
      if (this.saidFailed.delete(id)) { this.counts.recoveriesSaid++; this.host.say(`${this.host.itemName(id)}: its model has loaded`, false); }
    }
    this.counts.held += held;
    try { this.counts.reskinned += this.host.pickups()?.reskin(ids) ?? 0; } catch (err) { console.warn('weapon variety: re-skinning pickups failed', err); }
    try { this.host.onDelivered?.(ids); } catch (err) { console.warn('weapon variety: a delivery hook failed', err); }
    if (held) { try { this.host.syncHeld(); } catch (err) { console.warn('weapon variety: syncHeld failed', err); } }
    for (const id of ids) this.iconQueue.add(id);
    this.pumpIcons();
  }

  /** One icon batch at a time; never while a warm-up owns the renderer; ids that arrive meanwhile join the next batch. */
  private pumpIcons(): void {
    if (this.iconRun || !this.iconQueue.size) return;
    if (this.host.rendererReady && !this.host.rendererReady()) return; // (the boot's own icon build renders every resident model)
    this.iconRun = (async () => {
      try {
        while (this.iconQueue.size) {
          for (let free = this.host.rendererFree?.(); free; free = this.host.rendererFree?.()) await free.catch(() => undefined);
          const batch = [...this.iconQueue].filter(id => !!weaponVarietyGltf(id));
          this.iconQueue.clear();
          if (!batch.length) break;
          this.counts.iconBatches++;
          this.counts.icons += batch.length;
          await this.host.refreshIcons(batch);
        }
      } catch (err) {
        console.warn('weapon variety: the icon refresh failed (the glyphs stay)', err);
      } finally {
        this.iconRun = null;
      }
    })();
  }

  /** Resolves when every icon queued so far is rendered (the section preload awaits it: previews are ready before play). */
  async settled(): Promise<void> {
    this.pumpIcons();
    while (this.iconRun) await this.iconRun;
  }

  private failed(f: WeaponVarietyFailure): void {
    if (this.saidFailed.has(f.id)) return;
    this.saidFailed.add(f.id);
    this.counts.failuresSaid++;
    this.host.say(`${this.host.itemName(f.id)}: its model did not load${f.retryInMs !== null ? ' — trying again' : ''}`, true);
  }

  qa() {
    return {counts: {...this.counts}, iconQueue: [...this.iconQueue], iconBusy: !!this.iconRun, saidFailed: [...this.saidFailed], attached: !!this.attached};
  }
}

/**
 * QA hook (spread into window.__LL by qa.ts) for SHORT serial browser spot checks: per new weapon — where its model stands, whether the
 * held view has it, whether its rendered preview exists; the loader's counters / failures, the delivery's counters, stand-ins waiting.
 */
export function weaponVarietyQaApi(game: () => {weaponVariety?: WeaponVarietyDelivery; viewmodel?: {hasItem(id: string): boolean; heldItem: string | null; wantedItem?: string | null}; pickups?: {awaitingModels?(): Record<string, number>; reskinCounts?: unknown}}, iconUrl: (id: string) => string | null) {
  return {
    weaponVariety: () => {
      const g = game();
      return {
        weapons: Object.fromEntries(LAZY_MODEL_WEAPON_IDS.map(id => [id, {model: weaponVarietyModelState(id), held: !!g.viewmodel?.hasItem(id), icon: !!iconUrl(id)}])),
        stats: {...WEAPON_VARIETY_MODEL_STATS}, failures: weaponVarietyFailures(), delivery: g.weaponVariety?.qa() ?? null,
        heldItem: g.viewmodel?.heldItem ?? null, wantedItem: g.viewmodel?.wantedItem ?? null,
        awaiting: g.pickups?.awaitingModels?.() ?? {}, reskin: g.pickups?.reskinCounts ?? null,
      };
    },
  };
}

/** Installs the delivery (one call in the Game constructor; attach() once the boot built the held view). */
export function installWeaponVarietyDelivery(host: WeaponVarietyHost): WeaponVarietyDelivery {
  return new WeaponVarietyDelivery(host).install();
}
