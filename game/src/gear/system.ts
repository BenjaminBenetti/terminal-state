// Iteration 16 (lane GEAR): the gear system — worn-gear modifiers, the deployable backpack and grounded bags.
//
// installGear(game) is called ONCE from the Game constructor; it only REGISTERS into the iteration-16 registries:
// - modifierSources: the worn gear's stats from base values every frame (items/gear.ts gearModifiersFor) — can never stack;
// - frameHooks: key 6 (ready / sling back the worn backpack), left click while readied (set it down), aimed-bag targeting,
//   the open transfer view's distance / state checks, gloves' reload handling (WeaponController.handling);
// - interactHandlers: [E] on a grounded bag opens the transfer view; promptProviders: "[E] Open backpack";
// - inputOwners: no firing / ADS / item use / flare while the bag is readied or its view (or the resume prompt) is open;
// - hitListeners: a hit closes the open bag; stateListeners: any state but 'playing' closes it (pause, Tab, death, travel);
// - sectionHooks: build = restore this section's bags from the store and turn generated backpack finds into bags;
//   teardown = save them (RUN's section memory once plugged in: game.gear.setStore) and close / cancel everything;
// - warmRegistry pool 'gear': hidden prototypes of every gear model (dropped gear and a set-down bag never compile cold).
//
// Backpack flow (user: "cycle by hitting the six key … must be put on the ground before you can access it with E"):
//   6 = take the worn backpack off into your hands (the gun lowers; the prompt line says what to do) · LEFT CLICK = set it down on the
//   floor in front of you (refused on stairs, in the elevator cab, over a drop or against a wall) · 6 again (or 1-5 / Q /
//   wheel) = sling it back on. E on a bag lying on the ground opens the TRANSFER VIEW: the world keeps running (enemies
//   keep coming), the mouse belongs to the view (no look / fire / aim), WASD still moves you; walking more than 2.5 m away,
//   taking a hit, death, travel, pause or Tab closes it. "Wear it" picks the bag up (same bag, exact contents) if your
//   back slot is free. A backpack found in the level lies there as such a bag (empty), so it works the same way.

import * as THREE from 'three';
import type {Game} from '../game';
import {gearModifiersFor, GEAR_IDS, isBagItem} from '../items/gear';
import {itemDef} from '../items/items';
import {stackFromJSON, stackToJSON, stacksIn, type ItemStack} from '../items/inventory';
import {makeSupplyMesh} from '../world/pickups';
import {BAG_VIEW_RANGE, GroundBag, bagTarget, type BagPose} from '../world/groundBag';
import {BagSession} from './bagSession';
import {defaultBagStore, readSectionBags, type BagRecord, type BagStore, type SectionBags} from './bagStore';
import {BagView} from '../ui/bagView';
import {ensureGearStyles} from '../ui/gearStyles';
import type {StationLayout} from '../gen/stationTypes';
import type {ResolvedHit} from '../player/hits';

/** A placement rule another lane can add (TOWER: e.g. "not in the cab"); returns a refusal text or null. */
export type PlaceRule = (x: number, y: number, z: number, level: number) => string | null;

type CloseReason = 'user' | 'wear' | 'hit' | 'distance' | 'state' | 'travel' | 'reset' | 'gone';

interface OfficeInfoLike {
  levelId?: number;
  elevator?: {cab?: {x0: number; z0: number; x1: number; z1: number}; shaft?: {x0: number; z0: number; x1: number; z1: number}};
}

const KEYS_SHOULDER = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyQ'];

export class GearSystem {
  /** Grounded bags + warm-up prototypes (in the scene for the whole session). */
  readonly group = new THREE.Group();
  /** Bags lying in the current section. */
  bags: GroundBag[] = [];
  /** The worn backpack is in the player's hands (6), waiting for a click to set it down. */
  readied = false;
  /** The open transfer session (E on a grounded bag), or null. */
  session: BagSession | null = null;
  /** The bag under the crosshair (prompt / E). */
  target: GroundBag | null = null;
  /** Extra placement rules (lane TOWER may add one; the elevator cab is refused from layout.office already). */
  readonly placeRules: PlaceRule[] = [];
  store: BagStore = defaultBagStore;
  /** Section the live bags belong to (set at build, cleared at teardown / reset). */
  private section: string | null = null;
  private sectionSeed = 0;
  private live = false;
  private readonly view: BagView;
  private protos: THREE.Object3D[] | null = null;
  private resume: HTMLElement | null = null;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private wornKey = '';
  private seenClears = -1;
  private lastVersion = -1;
  private time = 0;

  constructor(private readonly game: Game) {
    this.group.name = 'gear';
    this.view = new BagView({
      inv: () => this.game.inv,
      session: () => (this.session?.open ? this.session : null),
      close: () => this.close('user'),
      wear: () => this.wear(),
      changed: () => this.game.syncHeld(),
    });
  }

  // --- registration ------------------------------------------------------------------------------------------------

  install(): this {
    const g = this.game;
    g.scene.add(this.group);
    g.modifierSources.push(() => gearModifiersFor(g.inv.gear));
    g.frameHooks.push(dt => this.update(dt));
    g.interactHandlers.push(() => this.onInteract());
    g.hitListeners.push(hit => this.onHit(hit));
    g.sectionHooks.push({build: layout => this.onBuild(layout), teardown: () => this.onTeardown()});
    g.warmRegistry.addPool('gear', () => this.warmPrototypes());
    const reg = g as unknown as {
      stateListeners?: ((s: string, prev: string) => void)[];
      promptProviders?: (() => string | null)[];
      inputOwners?: (() => boolean)[];
    };
    reg.stateListeners?.push(s => { if (s !== 'playing') this.onLeavePlay(); });
    reg.promptProviders?.push(() => this.prompt());
    reg.inputOwners?.push(() => this.ownsInput);
    g.invUI.gear = {dropBag: () => this.placeFromInventory(), changed: () => { this.wornKey = this.keyOfWorn(); }};
    // the bag view releases pointer lock WITHOUT pausing: swallow that unlock (the iteration-04 handler pauses otherwise)
    const prev = g.input.onLockChange;
    g.input.onLockChange = locked => {
      if (!locked && (this.ownsPointer || performance.now() < this.lockGraceUntil) && g.state === 'playing') return;
      prev(locked);
    };
    if (typeof window !== 'undefined') window.addEventListener('keydown', e => this.onKeyCapture(e), {capture: true});
    return this;
  }

  /** RUN: plug in the run's section memory (run/bagStore.ts). The live section keeps its bags (saved there at teardown). */
  setStore(store: BagStore): void {
    this.store = store;
  }

  /** NewGame (RUN participant reset): closes the view, cancels a readied bag and forgets the live bags (never saved). */
  reset(): void {
    this.close('reset');
    this.cancelReady(false);
    this.disposeBags();
    this.live = false;
    this.section = null;
    if (this.store === defaultBagStore) this.store.clear();
    this.wornKey = this.keyOfWorn();
  }

  /** Mouse buttons belong to the gear UI (readied bag, open view, resume prompt): no fire / ADS / use / flare. */
  get ownsInput(): boolean {
    if (this.mouseLatch) {
      if (!this.game.input.mouse[0]) this.mouseLatch = false; // the click that set the bag down never bleeds into the gun
      else return true;
    }
    return this.readied || !!this.session || this.resumeShown;
  }
  private mouseLatch = false;

  /** The transfer view is open (QA / tests). */
  get viewOpen(): boolean {
    return !!this.session?.open;
  }

  // --- per frame (while playing) -----------------------------------------------------------------------------------

  update(dt: number): void {
    const g = this.game, inp = g.input;
    this.time += dt;
    // gloves (and an arm injury) scale the reload time: one place for both lanes (lanes/injury.notes)
    g.weapon.handling = g.mods.handlingMult;
    if (this.seenClears !== inp.clears) {
      // input was cleared (a menu, blur, travel): a readied bag goes back on
      if (this.seenClears >= 0 && this.readied) this.cancelReady(true);
      this.seenClears = inp.clears;
    }
    if (this.resumeShown && (inp.locked || g.qa)) this.hideResume();
    // key 6: ready / sling back / close the view (the view's own capture handler eats 6 while it is open)
    if (inp.hit('Digit6')) {
      if (this.session) this.close('user');
      else if (this.readied) this.cancelReady(true);
      else this.ready();
    }
    if (this.readied) {
      if (!g.inv.worn('backpack') || g.player.climbing || g.consumeView.busy || !g.player.alive) this.cancelReady(true);
      else if (KEYS_SHOULDER.some(k => inp.hit(k)) || inp.wheel) this.cancelReady(true);
      else {
        if (g.weapon.stack) g.weapon.equip(null);
        g.viewmodel.setItem(null);
        if (inp.mousePressed[0]) this.placeReadied();
      }
    }
    // the open view: closes beyond reach / when the bag is gone; redraws on inventory changes (reloads, uses)
    const s = this.session;
    if (s) {
      const bag = s.bag as GroundBag;
      const p = g.player;
      if (!s.active) this.close('gone');
      else if (Math.hypot(p.x - bag.pose.x, p.z - bag.pose.z) > BAG_VIEW_RANGE || Math.abs(p.y - bag.pose.y) > 1.4) { this.close('distance'); g.hud.toast('Too far from the backpack — it closed', true); }
      else if (g.inv.version !== this.lastVersion) { this.lastVersion = g.inv.version; this.view.render(); }
    }
    // aimed bag (not while the view is open or the bag is in the hands)
    const prevTarget = this.target;
    this.target = !this.session && !this.readied && this.bags.length && g.levels ? this.aimedBag() : null;
    for (const b of this.bags) {
      if (b === this.target) b.glow(0.12 + 0.08 * Math.sin(this.time * 6));
      else { const w = Math.sin(this.time * 2.2 + b.serial * 2.39); const k = 0.035 + (w > 0.9 ? (w - 0.9) * 1.3 : 0); b.glow(k); }
    }
    if (prevTarget !== this.target && !this.target && prevTarget) prevTarget.glow(0.035);
    this.announceWorn();
  }

  private aimedBag(): GroundBag | null {
    const g = this.game;
    const eye = g.camera.getWorldPosition(new THREE.Vector3());
    const dir = g.camera.getWorldDirection(new THREE.Vector3());
    return bagTarget(this.bags, eye, dir, g.levels.count > 1 ? g.levels : g.layout.grid);
  }

  /** "Now wearing …" for gear that went on outside the inventory screen (picked up into an empty slot). */
  private announceWorn(): void {
    const key = this.keyOfWorn();
    if (key === this.wornKey) return;
    const before = new Set(this.wornKey.split(',').filter(Boolean));
    this.wornKey = key;
    for (const st of this.game.inv.gearSlots) {
      if (!st || before.has(String(st.uid))) continue;
      const def = itemDef(st.itemId);
      this.game.hud.toast(isBagItem(st.itemId) ? `Wearing the ${def.short.toLowerCase()} — 6 takes it off, click sets it down, E opens it` : `Wearing the ${def.short.toLowerCase()} (Tab: gear)`);
    }
  }

  private keyOfWorn(): string {
    return this.game.inv.gearSlots.map(s => s?.uid ?? '').join(',');
  }

  // --- the readied backpack (6) -------------------------------------------------------------------------------------

  /** 6: take the worn backpack off into the hands. */
  ready(): boolean {
    const g = this.game;
    const bag = g.inv.worn('backpack');
    if (!bag) { g.hud.toast(this.bags.length ? 'No backpack on your back — yours is on the ground (E to open it)' : 'No backpack — gear is rare, keep looking', true); g.sfx.denied(); return false; }
    if (g.player.climbing || g.consumeView.busy) { g.hud.toast('Hands busy', true); g.sfx.denied(); return false; }
    if (g.flareHold.active) { g.flareHold.cancel(); g.syncHeld(); }
    this.readied = true;
    g.weapon.equip(null);
    g.viewmodel.setItem(null);
    g.sfx.equip();
    return true;
  }

  /** Sling the readied backpack back on (nothing moved: it never left the back slot). */
  cancelReady(resync: boolean): void {
    if (!this.readied) return;
    this.readied = false;
    if (resync) this.game.syncHeld();
  }

  /** Left click while readied: set it down (or say why not; it stays in the hands). */
  placeReadied(): boolean {
    const g = this.game;
    const spot = this.placeSpot();
    if (typeof spot === 'string') { g.hud.toast(spot, true); g.sfx.denied(); return false; }
    const ok = this.putDown(spot);
    if (ok) { this.readied = false; this.mouseLatch = true; g.syncHeld(); }
    return ok;
  }

  /** The inventory screen dragged the worn backpack out of the panel: same placement rules; null = done. */
  placeFromInventory(): string | null {
    const spot = this.placeSpot();
    if (typeof spot === 'string') return spot;
    this.cancelReady(false);
    return this.putDown(spot) ? null : 'The backpack could not be put down here.';
  }

  /** Take the worn bag off and lay it down at `pose` (the same stack: identity and contents). */
  private putDown(pose: BagPose): boolean {
    const g = this.game;
    const stack = g.inv.takeOffBag();
    if (!stack) return false;
    if (!stack.bag) stack.bag = new Array(itemDef(stack.itemId).gear?.bagSlots ?? 12).fill(null);
    this.addBag(new GroundBag(`bag:${stack.uid}`, stack, pose));
    this.wornKey = this.keyOfWorn();
    g.sfx.pickup();
    g.hud.toast('Backpack set down — E to open it (the world does not stop)');
    return true;
  }

  /** Where a set-down bag would go, or the refusal text. */
  placeSpot(): BagPose | string {
    const g = this.game, p = g.player, L = g.levels;
    if (!L || !g.layout) return 'Not now.';
    if (p.climbing || !p.grounded) return 'Stand on solid ground to set the backpack down.';
    const here = L.supportIn(p.x, p.z, p.y + 0.05);
    if (!here) return 'You cannot set the backpack down here.';
    if (L.grid(here.level).rampIdx[here.cell] >= 0) return 'Not on the stairs — set the backpack down on level floor.';
    if (this.inCab(p.x, p.z, here.level)) return 'Not inside the elevator — set the backpack down on a floor.';
    const f = g.camera.getWorldDirection(new THREE.Vector3());
    const len = Math.hypot(f.x, f.z);
    const fx = len > 1e-3 ? f.x / len : -Math.sin(p.yaw), fz = len > 1e-3 ? f.z / len : -Math.cos(p.yaw);
    let why = 'No room in front of you — face open floor to set the backpack down.';
    for (const d of [0.75, 0.6, 0.45]) {
      const x = p.x + fx * d, z = p.z + fz * d;
      const s = L.supportIn(x, z, p.y + 0.05);
      if (!s) continue;
      const grid = L.grid(s.level);
      const [cx, cy] = grid.cellOf(x, z);
      if (!grid.passable(cx, cy)) continue;
      if (grid.rampIdx[s.cell] >= 0) { why = 'Not on the stairs — set the backpack down on level floor.'; continue; }
      const y = L.stepAt(x, z, p.y + 0.05);
      if (!Number.isFinite(y) || Math.abs(y - p.y) > 0.2) continue;
      if (!L.lineOfSight({x: p.x, y: p.y + 0.6, z: p.z}, {x, y: p.y + 0.6, z}) || L.railCrosses(p.x, p.z, x, z, 0.05, p.y)) continue;
      if (!L.circleClear(x, z, 0.15, y)) continue;
      if (this.inCab(x, z, s.level)) { why = 'Not inside the elevator — set the backpack down on a floor.'; continue; }
      if (this.bags.some(b => Math.hypot(b.pose.x - x, b.pose.z - z) < 0.45 && Math.abs(b.pose.y - y) < 0.5)) { why = 'Another bag is already lying there.'; continue; }
      let ruled: string | null = null;
      for (const r of this.placeRules) { ruled = r(x, y, z, s.level); if (ruled) break; }
      if (ruled) { why = ruled; continue; }
      return {x, y, z, yaw: p.yaw, level: s.level};
    }
    return why;
  }

  private inCab(x: number, z: number, level: number): boolean {
    const o = (this.game.layout as StationLayout & {office?: OfficeInfoLike}).office;
    const r = o?.elevator?.shaft ?? o?.elevator?.cab;
    if (!r || (o?.levelId !== undefined && o.levelId !== level)) return false;
    return x >= r.x0 - 0.05 && x <= r.x1 + 0.05 && z >= r.z0 - 0.05 && z <= r.z1 + 0.05;
  }

  // --- grounded bags -------------------------------------------------------------------------------------------------

  private addBag(b: GroundBag): void {
    this.bags.push(b);
    this.group.add(b.obj);
  }

  private removeBag(b: GroundBag): void {
    const i = this.bags.indexOf(b);
    if (i >= 0) this.bags.splice(i, 1);
    b.dispose();
    if (this.target === b) this.target = null;
  }

  private disposeBags(): void {
    for (const b of this.bags) b.dispose();
    this.bags = [];
    this.target = null;
  }

  /** E: open the aimed bag (true = handled; the default pickup / container interaction is skipped). */
  onInteract(): boolean {
    if (this.session) { this.close('user'); return true; }
    if (this.readied) return false;
    const b = this.target ?? (this.bags.length ? this.aimedBag() : null);
    if (!b) return false;
    this.open(b);
    return true;
  }

  prompt(): string | null {
    if (this.readied) return '<b>[Click]</b> Set the backpack down · <b>[6]</b> Sling it back on';
    const b = this.target;
    if (!b || this.session) return null;
    const used = (b.stack.bag ?? []).filter(Boolean).length;
    return `<b>[E]</b> Open ${itemDef(b.stack.itemId).short.toLowerCase()} · ${used ? `${used} item${used > 1 ? 's' : ''} inside` : 'empty'}`;
  }

  /** Open the transfer view on a grounded bag (world keeps running). */
  open(b: GroundBag): boolean {
    const g = this.game;
    if (!b.grounded || this.session) return false;
    this.cancelReady(false);
    this.session = new BagSession(() => g.inv, b);
    this.lastVersion = g.inv.version;
    this.ownsPointer = true;
    this.lockGraceUntil = performance.now() + 500;
    if (!g.qa) g.input.unlock();
    this.hideResume();
    this.view.show();
    g.sfx.search?.();
    return true;
  }

  /** Close the view. A player close re-takes the mouse (or shows "click to aim" when the browser refuses). */
  close(reason: CloseReason): void {
    const s = this.session;
    if (!s) return;
    s.close();
    this.session = null;
    this.view.hide();
    this.ownsPointer = false;
    this.lockGraceUntil = performance.now() + 300;
    const g = this.game;
    if (reason === 'reset' || reason === 'state' || reason === 'travel') return;
    if (reason === 'hit') g.hud.toast('Hit! You let go of the backpack', true);
    if (g.state !== 'playing') return;
    if (g.qa || g.input.locked) return;
    void g.input.lock().then(ok => { if (!ok && g.state === 'playing' && !g.input.locked) this.showResume(); });
  }

  /** "Wear it": pick the open bag up and wear it (the same stack). */
  wear(): boolean {
    const s = this.session, g = this.game;
    if (!s) return false;
    if (!s.wear()) { this.view.say(s.refusal?.text ?? 'You cannot wear it now.', true); g.sfx.denied(); return false; }
    this.removeBag(s.bag as GroundBag);
    this.wornKey = this.keyOfWorn();
    g.sfx.pickup();
    g.hud.toast(`Wearing the ${itemDef(s.bag.stack.itemId).short.toLowerCase()}`);
    this.close('wear'); // the session is already closed by wear(); this tidies the view and re-takes the mouse
    g.syncHeld();
    return true;
  }

  private onHit(hit: ResolvedHit): void {
    if (this.session && hit.amount > 0) this.close('hit');
  }

  private onLeavePlay(): void {
    this.close('state');
    this.hideResume();
  }

  /** While the view is open it owns E / 6 (close) — Tab / Esc close it and go on to the inventory / pause as usual. */
  private onKeyCapture(e: KeyboardEvent): void {
    if (!this.session) return;
    if (e.code === 'KeyE' || e.code === 'Digit6') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.close('user');
    } else if (e.code === 'Tab' || e.code === 'Escape' || e.code === 'KeyI') {
      this.close('state');
    }
  }

  // --- section lifecycle ---------------------------------------------------------------------------------------------

  /** Current section id: the run's (lane RUN), else derived from the layout (no run wired). */
  private sectionIdFor(layout: StationLayout): string {
    const run = (this.game as unknown as {run?: {sectionId?: string}}).run;
    if (run?.sectionId) return run.sectionId;
    const o = (layout as StationLayout & {office?: {floor?: number}}).office;
    return o?.floor ? `office:${o.floor === 1 ? 'street' : `floor-${o.floor}`}` : 'subway:main';
  }

  onBuild(layout: StationLayout): void {
    const g = this.game;
    this.close('travel');
    this.cancelReady(false);
    this.disposeBags();
    this.section = this.sectionIdFor(layout);
    this.sectionSeed = layout.seed >>> 0;
    this.live = true;
    const rec = readSectionBags(this.store.load(this.section), this.sectionSeed);
    // generated backpack finds: lying here as bags (E opens them), never as plain pickups — and converted only once
    const finds = g.pickups ? g.pickups.list.filter(p => isBagItem(p.stack.itemId)) : [];
    for (const pk of finds) {
      g.pickups.remove(pk);
      if (rec?.init) continue; // already converted on an earlier visit (its bag, if still here, is in the record)
      const idx = layout.pickups.findIndex(lp => lp.itemId === pk.stack.itemId && Math.abs(lp.x - pk.x) < 1e-3 && Math.abs(lp.z - pk.z) < 1e-3);
      const st = pk.stack;
      if (!st.bag) st.bag = new Array(itemDef(st.itemId).gear?.bagSlots ?? 12).fill(null);
      const lp = idx >= 0 ? layout.pickups[idx] : null;
      this.addBag(new GroundBag(`found:${idx >= 0 ? idx : st.uid}`, st, {x: pk.x, y: pk.y, z: pk.z, yaw: pk.obj.rotation.y, level: lp?.level ?? 0}));
    }
    for (const r of rec?.bags ?? []) {
      const st = stackFromJSON(r.stack) as ItemStack;
      if (g.inv.allStacks(true).some(s => s.uid === st.uid)) continue; // never two of the same bag
      for (const x of stacksIn(st)) g.inv.reserveUids(x.uid); // later splits / pickups never reuse its uids
      this.addBag(new GroundBag(r.id, st, {x: r.x, y: r.y, z: r.z, yaw: r.yaw, level: r.level}));
    }
    this.wornKey = this.keyOfWorn();
  }

  onTeardown(): void {
    this.close('travel');
    this.cancelReady(false);
    this.hideResume();
    if (this.live && this.section) this.store.save(this.section, this.record());
    this.disposeBags();
    this.live = false;
    this.section = null;
  }

  /** The live section's bags as a store record. */
  record(): SectionBags {
    const bags: BagRecord[] = this.bags.filter(b => b.grounded).map(b => ({id: b.id, stack: stackToJSON(b.stack)!, x: b.pose.x, y: b.pose.y, z: b.pose.z, yaw: b.pose.yaw, level: b.pose.level}));
    return {v: 1, seed: this.sectionSeed, init: true, bags};
  }

  /** Saves the live bags into the store now (snapshots taken mid-section). */
  flush(): void {
    if (this.live && this.section) this.store.save(this.section, this.record());
  }

  // --- warm-up --------------------------------------------------------------------------------------------------------

  /** Hidden prototypes of every gear model, built by the same factory as pickups / bags (docs/rendering-warmup.md). */
  warmPrototypes(): THREE.Object3D[] {
    if (!this.protos) {
      this.protos = GEAR_IDS.map(id => {
        const root = makeSupplyMesh(id);
        root.name = `gear-warm-prototype-${id}`;
        root.position.set(0, -1000, 0);
        root.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone(); // like a pickup / bag
          m.visible = false;
          m.raycast = () => {};
        });
        this.group.add(root);
        return root;
      });
    }
    return this.protos;
  }

  // --- small HUD pieces ------------------------------------------------------------------------------------------------

  private get resumeShown(): boolean {
    return !!this.resume && !this.resume.classList.contains('hidden');
  }

  private showResume(): void {
    if (typeof document === 'undefined') return;
    if (!this.resume) {
      ensureGearStyles();
      const el = document.createElement('div');
      el.id = 'gear-resume';
      el.innerHTML = '<span>Click to take aim again</span>';
      el.addEventListener('click', () => { void this.game.input.lock().then(ok => { if (ok) this.hideResume(); }); });
      (document.querySelector('#app') ?? document.body).appendChild(el);
      this.resume = el;
    }
    this.resume.classList.remove('hidden');
  }

  private hideResume(): void {
    this.resume?.classList.add('hidden');
  }

  /** QA: a compact state report. */
  qa(): {readied: boolean; viewOpen: boolean; bags: {id: string; x: number; z: number; level: number; used: number}[]; target: string | null; section: string | null; worn: Record<string, string | null>} {
    const worn: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(this.game.inv.gear)) worn[k] = v?.itemId ?? null;
    return {readied: this.readied, viewOpen: this.viewOpen, target: this.target?.id ?? null, section: this.section, worn,
      bags: this.bags.map(b => ({id: b.id, x: +b.pose.x.toFixed(2), z: +b.pose.z.toFixed(2), level: b.pose.level, used: (b.stack.bag ?? []).filter(Boolean).length}))};
  }

  /** QA: the transfer view (quick / move by slot spec), for short browser spot checks. */
  get bagView(): BagView {
    return this.view;
  }
}

/** Create the gear system and register it into the Game (call once from the Game constructor). */
export function installGear(game: Game): GearSystem {
  return new GearSystem(game).install();
}
