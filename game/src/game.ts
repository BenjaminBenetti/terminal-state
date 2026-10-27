// Game orchestration: state machine (title/playing/paused/inventory/dead/won), the frame loop,
// combat resolution, zombie updates, pickups and the station lifecycle (new seed per run).

import * as THREE from 'three';
import {freshSeed, mulberry32, seedToCode} from './core/rng';
import {PropIndex, moveCircle} from './core/physics';
import {CELL, PathFinder, nearestWalkable} from './gen/grid';
import {generateStation, type StationLayout} from './gen/station';
import {loadAssets, type AssetBundle} from './assets/loader';
import {buildWorld, type BuiltWorld} from './world/builder';
import {WorldMaterials} from './world/materials';
import {MOOD, StationLighting} from './world/lights';
import {VolumetricAtmosphere} from './render/volumetric';
import {PickupManager, makeSupplyMesh, registerItemModels} from './world/pickups';
import {Survival, survivalTicks} from './player/survival';
import {ContainerManager, type ContainerEvent, type ContainerTarget} from './world/containers';
import {Effects} from './world/fx';
import {Input} from './player/input';
import {Player, WALK_SPEED, stanceRecoilMult, stanceSpreadMult} from './player/player';
import {Inventory, type SlotRef} from './items/inventory';
import {ITEMS, itemDef, useHint, useLabel} from './items/items';
import {WEAPONS, WeaponController, type WeaponDef} from './weapons/weapons';
import {Viewmodel} from './weapons/viewmodel';
import {ConsumeView} from './weapons/consumeView';
import {buildItemIcons} from './ui/itemIcons';
import {ZombieActor} from './ai/zombieActor';
import {ZombieLookLibrary, pickZombieLook} from './ai/outfits';
import type {BrainWorld} from './ai/brain';
import {moveZombie, sameLevel, settleZombie} from './ai/motor';
import {ladderTarget, type Ladder} from './gen/traversal';
import {raycastWorld, rayCapsule, raySphere, type Vec3} from './combat/hitscan';
import {Hud} from './ui/hud';
import {InventoryUI} from './ui/inventoryUI';
import {Sfx, humEmitters, roomKindFor} from './audio/sfx';
import {PhysicsSystem, killImpulseStrength} from './physics/world';
import {DamageSystem} from './damage/system';

export type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'inventory' | 'dead' | 'won' | 'error';

export interface Settings { sens: number; fov: number; volume: number; muted: boolean; invertY: boolean; quality: 'low' | 'high' }

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

interface UseAction { uid: number; itemId: string; t: number; total: number }

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // Far plane just past where FogExp2(0.038) is ~99.8% opaque: on the 130 m+ platforms this lets
  // chunked instancing cull far fixtures/props that would be invisible anyway.
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  readonly input: Input;
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  readonly settings: Settings = {sens: 1, fov: 75, volume: 0.7, muted: false, invertY: false, quality: 'high'};
  state: GameState = 'loading';
  assets!: AssetBundle;
  mats!: WorldMaterials;
  viewmodel!: Viewmodel;
  layout!: StationLayout;
  world!: BuiltWorld;
  /** Station lighting (iteration 05: baked persistent light field + tube glow; historical field name). */
  lightPool!: StationLighting;
  propIndex!: PropIndex;
  pathfinder!: PathFinder;
  readonly player = new Player();
  /** Hunger/thirst (FOOD/WATER bars): 80/80 on every spawn, slow drain while playing. */
  readonly survival = new Survival();
  inv = new Inventory();
  weapon = new WeaponController();
  zombies: ZombieActor[] = [];
  /** Iteration 05 body x outfit registry/assembler (ai/outfits.ts), built once from the loaded GLBs. */
  private zombieLooks: ZombieLookLibrary | null = null;
  pickups!: PickupManager;
  readonly fx = new Effects();
  /** Ragdolls (cannon-es) + pooled casings; rebuilt per station, stepped only while playing. */
  readonly physics = new PhysicsSystem(this.scene, this.sfx);
  /** Iteration 06 (Lane D): material damage — craters, debris, per-instance prop damage / breaking, zombie wounds. */
  readonly damage = new DamageSystem(this.fx, this.sfx);
  readonly invUI: InventoryUI;
  private readonly flashlight: THREE.SpotLight;
  flashlightOn = true;
  private readonly muzzleLight = new THREE.PointLight(0xffb468, 0, 8, 2);
  /** Iteration 06 (Lane F): volumetric haze pass + flashlight shadow map (render/volumetric.ts). */
  readonly atmosphere: VolumetricAtmosphere;
  // Constant dim ambient floor (iteration 05: no longer follows the player's area; the baked light
  // field in world/lights.ts carries all fixture light).
  private readonly hemi = new THREE.HemisphereLight(MOOD.hemiSky, MOOD.hemiGround, MOOD.ambient);
  stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
  private recoilPitch = 0;
  private recoilYaw = 0;
  private bloom = 0;
  private shake = 0;
  private muzzleT = 0;
  private use: UseAction | null = null;
  private lastSlot = 0;
  private aiming = false;
  private wonAt = -1;
  private rand: () => number = Math.random;
  private sharedGeometries = new Set<THREE.BufferGeometry>();
  private lastFrame = performance.now();
  private renderT = 0;
  private time = 0;
  private shotCounter = 0;
  private currentSeed = 0;
  /** Frames rendered while playing (used by QA to confirm the loop runs). */
  frames = 0;
  lastError: string | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly qa: boolean) {
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = MOOD.exposure;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.scene.background = new THREE.Color(0x0a0b0c);
    this.scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    this.scene.add(this.hemi, this.camera, this.muzzleLight, this.fx.group);
    this.scene.add(this.damage.group); // Lane D: debris / craters / damaged props (normal depth-tested scene pass)
    this.camera.rotation.order = 'YXZ';
    // Hot centre (~10 deg) with a wide soft spill to ~33 deg; low decay so it reaches ~20 m.
    this.flashlight = new THREE.SpotLight(0xfff4e2, 0, 30, 0.58, 0.7, 1.2);
    this.flashlight.position.set(0.2, -0.15, 0.1);
    this.flashlight.target.position.set(0.04, -0.12, -6);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.atmosphere = new VolumetricAtmosphere(this.renderer, {flashlight: this.flashlight, muzzle: this.muzzleLight}, this.settings.quality);
    this.input = new Input(canvas, qa);
    this.input.onLockChange = locked => {
      if (!locked && this.state === 'playing' && !this.qa) this.setState('paused');
    };
    this.input.onKey = code => this.onKey(code);
    this.invUI = new InventoryUI(() => this.inv, {
      use: ref => this.startUse(ref),
      drop: (ref, count) => this.dropRef(ref, count),
      equip: ref => this.equipRef(ref),
      close: () => this.closeInventory(),
      changed: () => this.syncHeld(),
      vitals: () => ({hp: this.player.hp, maxHp: this.player.maxHp, food: this.survival.hunger, water: this.survival.thirst}),
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => { if (this.state === 'playing' && !this.qa) this.setState('paused'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.setState('paused'); });
    this.resize();
  }

  /** First-person consume animation (weapons/consumeView.ts); visual only, `use` stays authoritative. */
  consumeView!: ConsumeView;

  // ---------------------------------------------------------------------------------------
  async load(onProgress: (f: number, label: string) => void): Promise<void> {
    this.assets = await loadAssets(onProgress);
    const m = this.assets.models;
    for (const g of Object.values(m)) g.scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) this.sharedGeometries.add(mesh.geometry); });
    const lb = new THREE.Box3().setFromObject(m.light.scene).getSize(new THREE.Vector3());
    this.mats = new WorldMaterials(this.assets.textures, 20261025, {w: lb.x, h: lb.y, d: lb.z});
    // Food/drink use the generated item models when the manifest has them (else stand-ins).
    registerItemModels(m as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>);
    const consumables: Record<string, THREE.Object3D> = {};
    for (const id of Object.values(ITEMS).filter(d => d.kind === 'consumable').map(d => d.id)) {
      const o = makeSupplyMesh(id);
      o.rotation.set(0.5, -0.4, 0.15);
      o.traverse(x => { const mm = x as THREE.Mesh; if (mm.isMesh) mm.frustumCulled = false; });
      consumables[id] = o;
    }
    this.viewmodel = new Viewmodel({rifle: m.rifle, shotgun: m.shotgun}, consumables);
    // Lane D (iteration 04): eat/drink/apply with the real item model in hand, and inventory icons
    // rendered once from the runtime models through this renderer (ui/itemIcons.ts).
    this.consumeView = new ConsumeView(this.viewmodel, makeSupplyMesh);
    await buildItemIcons(this.renderer, {rifle: m.rifle, shotgun: m.shotgun});
    this.pickups = new PickupManager({rifle: m.rifle, shotgun: m.shotgun});
    this.scene.add(this.pickups.group);
    this.resize();
  }

  get seed(): number {
    return this.currentSeed;
  }

  newStation(seed: number): void {
    this.currentSeed = seed >>> 0;
    this.rand = mulberry32(seed ^ 0x5bd1e995);
    // tear down the previous run
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse(o => {
        const mesh = o as THREE.Mesh;
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        if (mesh.isMesh && !this.sharedGeometries.has(mesh.geometry)) mesh.geometry.dispose();
      });
      this.lightPool.dispose(this.scene);
    }
    for (const z of this.zombies) { this.scene.remove(z.root); z.dispose(); }
    this.zombies = [];
    this.pickups.clear();
    this.containers?.clear();
    this.containerTarget = null;
    this.fx.clear();
    this.damage.clear();
    this.use = null;
    this.consumeView?.reset();

    const t0 = performance.now();
    this.layout = generateStation(seed);
    this.world = buildWorld(this.layout, this.mats, this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>);
    this.scene.add(this.world.group);
    if (!this.containers) {
      this.containers = new ContainerManager(this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>, this.mats, () => this.inv);
      this.containers.onEvent = e => this.onContainerEvent(e);
      this.scene.add(this.containers.group);
    }
    // Searchable cabinets/crates; loot is rolled from the station seed + container index.
    this.containers.build(this.layout);
    this.propIndex = new PropIndex(this.layout.grid, this.layout.props);
    this.pathfinder = new PathFinder(this.layout.grid);
    this.physics.build(this.layout); // disposes the previous station's bodies and casings
    // Lane D: index the shared prop renderables for per-instance damage; breaks update holders + ragdoll statics.
    const cm = this.containers;
    this.damage.build(this.layout, this.mats, [this.world.group, cm.group], {
      ownMeshes: p => cm.ownMeshes(p),
      onBreak: e => { const h = cm.holderFor(e.prop); if (h) cm.breakHolder(h, e.kind); this.physics.propsChanged(e.prop.x, e.prop.z); },
      pickups: () => this.pickups.list,
    });
    // Audio: occlusion-lite (no line of sight -> muffled) + humming vending/stall emitters. Same Sfx/context.
    this.sfx.setWorld({occlusion: (x, z) => this.layout.grid.lineOfSight(this.player.x, this.player.z, x, z) ? 0 : 1, emitters: humEmitters(this.layout.props)});
    // Iteration 05: every fixture baked into a persistent light field (camera-independent; no pooled lights).
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.lightPool = new StationLighting(this.scene, this.layout, this.world.fixtures, this.world.tubes, {hemi: this.hemi, fogDensity: MOOD.fogDensity, far: this.camera.far, max3DTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number});
    // Iteration 06 (Lane F): haze density map + light-field rebind; station structure/containers cast the flashlight shadow.
    this.atmosphere.setStation(this.layout, this.lightPool.volume);
    this.atmosphere.markShadows(this.world.group, true);
    this.atmosphere.markShadows(this.containers.group, true);
    const sp = this.layout.playerSpawn;
    this.player.spawn(sp.x, sp.z, sp.yaw, this.layout.grid.floorAt(sp.x, sp.z));
    this.ladderAim = null;
    this.survival.reset(); // food/water 80/80 on spawn, new station and retry
    this.recoilPitch = this.recoilYaw = this.bloom = this.shake = 0;

    this.inv = new Inventory();
    this.inv.set({bar: 'hotbar', index: 0}, this.inv.makeStack('rifle', 1, 30));
    this.inv.set({bar: 'hotbar', index: 4}, this.inv.makeStack('bandage', 1));
    this.inv.add(this.inv.makeStack('ammo_rifle', 60));
    this.inv.select(0);
    this.lastSlot = 0;
    this.weapon = new WeaponController();
    this.syncHeld();

    // Iteration 05: each zombie wears a seeded body x outfit look (deterministic per station seed + spawn index; 'coated' = heavy coat outfit).
    // Falls back to the legacy single template (zombie-rigged.glb: Last-shift body + coat) when no registry body model is loaded.
    const models = this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>;
    const looks = (this.zombieLooks ??= new ZombieLookLibrary(models));
    this.layout.zombies.forEach((s, i) => {
      const source = looks.bodies.length ? looks.build(pickZombieLook(this.currentSeed, i, s.type, looks.available)) : models.zombie;
      if (!source) throw new Error('no zombie body model loaded (registry bodies and legacy zombie-rigged.glb both missing)');
      const z = new ZombieActor(source, s, this.rand);
      this.damage.installZombie(z); // Lane D: own wound-patched material clones (body + every wearable)
      z.brain.y = z.root.position.y = this.layout.grid.floorAt(s.x, s.z); // Lane T: spawn on the local floor height
      this.zombies.push(z);
      this.scene.add(z.root);
    });
    for (const p of this.layout.pickups) this.pickups.add(this.inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, this.rand() * Math.PI * 2);
    this.stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
    this.wonAt = -1;
    this.hud.reset();
    for (const z of this.zombies) this.atmosphere.markShadows(z.root, false); // Lane F: zombies block the flashlight beam
    this.genMs = performance.now() - t0;
    $('#seed-line').textContent = `Station: ${this.layout.name} · code ${seedToCode(seed)} (debug/share only; reloading the page always makes a new station)`;
    this.updateCamera(0);
  }
  genMs = 0;

  // ---------------------------------------------------------------------------------------
  setState(s: GameState): void {
    const prev = this.state;
    this.state = s;
    this.input.active = s === 'playing';
    if (s !== 'playing') { this.input.clear(); this.cancelUse(s); }
    this.invUI.cancelDrag();
    for (const id of ['title', 'pause', 'inventory', 'death', 'win', 'error']) $('#' + id).classList.add('hidden');
    const screen: Partial<Record<GameState, string>> = {title: 'title', paused: 'pause', inventory: 'inventory', dead: 'death', won: 'win', error: 'error', loading: 'title'};
    if (screen[s]) $('#' + screen[s]).classList.remove('hidden');
    this.hud.show(s === 'playing' || s === 'paused' || s === 'inventory');
    // Only frozen menus silence audio; any other (incl. future overlay) state keeps it running.
    this.sfx.suspend(s === 'paused' || s === 'inventory' || s === 'title' || s === 'loading' || s === 'error');
    if (s === 'inventory') { this.invUI.selected = null; this.invUI.render(); }
    if (s !== 'playing' && prev === 'playing') this.input.unlock();
    this.lastFrame = performance.now();
  }

  /** Called from a click (user gesture): audio + pointer lock, then play. */
  async enterPlay(): Promise<void> {
    this.sfx.init();
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMuted(this.settings.muted);
    const ok = await this.input.lock();
    this.setState(ok ? 'playing' : 'paused');
    if (!ok) $('#pause .fine').textContent = 'The browser did not capture the mouse — click Resume to try again.';
    else $('#pause .fine').textContent = 'Combat is frozen while this menu is open.';
  }

  private onKey(code: string): void {
    if (code === 'KeyM' && this.state !== 'loading') {
      this.settings.muted = !this.settings.muted;
      this.sfx.setMuted(this.settings.muted);
      ($('#set-mute') as HTMLInputElement).checked = this.settings.muted;
      if (this.state === 'playing') this.hud.toast(this.settings.muted ? 'Audio muted' : 'Audio on');
    }
    if (this.state === 'playing') {
      if (code === 'Tab' || code === 'KeyI') this.openInventory();
      // Browsers normally swallow Esc to exit pointer lock (handled by onLockChange); if the
      // page does receive it, pause directly.
      else if (code === 'Escape') this.setState('paused');
    } else if (this.state === 'inventory') {
      if (code === 'Tab' || code === 'KeyI' || code === 'Escape') this.closeInventory();
      const m = /^Digit([1-5])$/.exec(code);
      if (m) this.invUI.assign(Number(m[1]) - 1);
    } else if (this.state === 'paused' && code === 'Escape' && this.qa) {
      void this.enterPlay();
    }
  }

  openInventory(): void {
    this.cancelUse('inventory');
    this.setState('inventory');
  }

  /** Abort a timed use without consuming (slot switch, sprint, hit, menus, death); the gun comes back up. */
  private cancelUse(reason: string): void {
    if (!this.use) return;
    this.use = null;
    this.consumeView?.cancel(reason);
  }

  closeInventory(): void {
    void this.enterPlay();
  }

  // ---------------------------------------------------------------------------------------
  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.quality === 'high' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.settings.quality === 'high' ? dpr : Math.min(dpr, 0.85));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel?.setAspect(w / h);
    // Lane F: atmosphere quality follows the settings quality (?fog= overrides); targets track the drawing buffer.
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.atmosphere.setQuality(this.settings.quality);
    this.atmosphere.setSize(db.x, db.y);
  }

  applySettings(): void {
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMuted(this.settings.muted);
    this.resize();
  }

  frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.state === 'playing' || (this.state === 'won' && this.wonAt >= 0)) {
      if (this.state === 'playing') this.update(dt);
      this.render();
      this.frames++;
    } else if (this.world) {
      // menus: keep the frozen frame fresh at a low rate
      this.renderT -= dt;
      if (this.renderT <= 0) { this.renderT = 0.25; this.render(); }
    }
    this.input.endFrame();
  }

  render(): void {
    this.renderer.info.reset();
    // Iteration 06 (Lane F): station scene + volumetric haze composited onto the canvas (direct r5 path when
    // off/unsupported); the viewmodel overlay is drawn on top afterwards, never fogged.
    this.atmosphere.render(this.scene, this.camera, this.time);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
  }

  // ---------------------------------------------------------------------------------------
  private selectSlot(i: number): void {
    if (i === this.inv.selected) return;
    this.lastSlot = this.inv.selected;
    this.inv.select(i);
    this.cancelUse('slot');
    this.syncHeld();
  }

  /** Equip whatever is in the selected quick slot. */
  syncHeld(): void {
    const st = this.inv.selectedStack();
    const def = st ? itemDef(st.itemId) : null;
    if (def?.kind === 'weapon') {
      if (this.weapon.stack !== st) { this.weapon.equip(st); this.sfx.equip(); }
      this.viewmodel.setItem(st!.itemId);
    } else {
      this.weapon.equip(null);
      this.viewmodel.setItem(def?.kind === 'consumable' ? st!.itemId : null);
    }
  }

  private equipRef(ref: SlotRef): void {
    if (ref.bar === 'hotbar') { this.selectSlot(ref.index); return; }
    this.inv.move(ref, {bar: 'hotbar', index: this.inv.selected});
    this.invUI.selected = {bar: 'hotbar', index: this.inv.selected};
    this.syncHeld();
  }

  private forward(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  /** Drop `count` (default: all) of a slot on the floor in front of the player (G, inventory drag-out / Drop). */
  dropRef(ref: SlotRef, count?: number): void {
    const st = this.inv.detach(ref, count);
    if (!st) return;
    if (this.use && !this.inv.find(this.use.uid)) this.cancelUse('dropped');
    const g = this.layout.grid;
    const f = this.forward();
    let x = this.player.x + f.x * 0.9, z = this.player.z + f.z * 0.9;
    // Lane T: same level only (not over the platform edge), resting on the local floor / stair tread.
    if (!g.passable(...g.cellOf(x, z)) || Math.abs(g.floorAt(x, z) - this.player.y) > 0.45 || !g.lineOfSight(this.player.x, this.player.z, x, z)) { x = this.player.x; z = this.player.z; }
    this.pickups.add(st, x, g.stepAt(x, z), z, this.player.yaw);
    this.hud.toast(`Dropped ${st.count > 1 ? `${st.count} × ` : ''}${itemDef(st.itemId).short}`);
    this.syncHeld();
  }

  private startUse(ref: SlotRef): void {
    const st = this.inv.get(ref);
    if (!st) return;
    const def = itemDef(st.itemId);
    if (def.kind !== 'consumable') return;
    const blocked = this.survival.blockReason(def, this.player.hp, this.player.maxHp);
    if (blocked) { this.hud.toast(blocked); this.sfx.denied(); return; }
    this.use = {uid: st.uid, itemId: st.itemId, t: 0, total: def.useTime ?? 1};
    // Consume view: the held gun/item lowers and this item's model comes up to the face.
    const held = this.inv.selectedStack();
    this.consumeView.start(st.itemId, def.useTime ?? 1, held === st ? 'hand' : held ? 'swap' : 'empty');
    if (this.state === 'inventory') this.closeInventory();
  }

  private quickHeal(): void {
    const missing = this.player.maxHp - this.player.hp;
    if (missing <= 0) { this.hud.toast('Already at full health'); this.sfx.denied(); return; }
    const order = missing <= 25 ? ['bandage', 'medkit'] : ['medkit', 'bandage'];
    for (const id of order) {
      for (const bar of ['hotbar', 'pack'] as const) {
        const list = bar === 'hotbar' ? this.inv.hotbar : this.inv.pack;
        const i = list.findIndex(s => s?.itemId === id);
        if (i >= 0) { this.startUse({bar, index: i}); return; }
      }
    }
    this.hud.toast('No medical supplies', true);
    this.sfx.denied();
  }

  private interact(): void {
    if (this.containerTarget) { this.containers?.interact(this.containerTarget); return; }
    const p = this.currentTarget;
    if (!p) {
      // Lane T (iteration 05): rescue ladder under the crosshair -> scripted climb (Space / S lets go).
      if (this.ladderAim && !this.player.climbing) {
        this.cancelUse('climb');
        this.player.startClimb(this.ladderAim.ladder, this.ladderAim.up);
        this.sfx.ladder(); // Lane S: Sound Lab ladder-rung clip
        this.ladderAim = null;
      }
      return;
    }
    const def = itemDef(p.stack.itemId);
    const before = p.stack.count;
    const prevSelectedEmpty = !this.inv.selectedStack();
    const left = this.inv.add(p.stack);
    if (left === before) { this.hud.toast('No room in inventory — drop something (Tab)', true); this.sfx.denied(); return; }
    this.sfx.pickup();
    const got = before - left;
    if (left > 0) { p.stack.count = left; this.hud.toast(`Took ${got} ${def.short} (no room for ${left})`); }
    else {
      this.pickups.remove(p);
      const ref = this.inv.find(p.stack.uid);
      if (def.kind === 'weapon' && ref?.bar === 'hotbar') {
        this.hud.toast(`${def.short} → quick slot ${ref.index + 1}${prevSelectedEmpty ? '' : ` (press ${ref.index + 1})`}`);
        if (prevSelectedEmpty) { this.selectSlot(ref.index); }
      } else this.hud.toast(def.kind === 'weapon' ? `${def.short} stored in backpack` : `+${got} ${def.name}`);
    }
    this.syncHeld();
  }

  /**
   * Container feedback (open/close start, search results). Audio hook: wire the audio lane's
   * sfx.containerOpen / containerClose / search here on e.type 'open' | 'close' | 'search'.
   */
  private onContainerEvent(e: ContainerEvent): void {
    if (e.message) this.hud.toast(e.message, e.warn);
    const sound: string = e.container.kind, cp = e.container.prop;
    const at = {x: cp.x, y: cp.y + cp.h * 0.5, z: cp.z};
    if (e.type === 'open') { this.sfx.containerOpen(sound, at); this.sfx.search(); }
    else if (e.type === 'close') this.sfx.containerClose(sound, at);
    else if (e.type === 'search') this.sfx.pry(sound, at); // Lane S: pry start (vending): strain + latch snap
    if (e.result?.taken.length) { this.sfx.pickup(); this.syncHeld(); }
    else if (e.result?.remaining.length) this.sfx.denied();
  }

  private currentTarget: ReturnType<PickupManager['target']> = null;
  /** Lane T: rescue ladder under the crosshair within reach ([E] climbs up / down). */
  ladderAim: {ladder: Ladder; up: boolean; t: number} | null = null;
  containers: ContainerManager | null = null;
  private containerTarget: ContainerTarget | null = null;

  currentSpread(def: WeaponDef): number {
    const moving = Math.min(1, this.player.speed / WALK_SPEED);
    const base = this.aiming ? def.spreadAim : def.spreadHip;
    return (base + def.spreadMove * moving * (this.aiming ? 0.4 : 1) + this.bloom + (this.player.sprinting ? 0.05 : 0)) * stanceSpreadMult(this.player.crouched);
  }

  // ---------------------------------------------------------------------------------------
  update(dt: number): void {
    this.time += dt;
    this.stats.time += dt;
    const inp = this.input;
    const p = this.player;
    const sens = this.settings.sens * 0.0022 * (this.aiming ? 0.65 : 1);
    p.yaw -= inp.dx * sens;
    p.pitch -= inp.dy * sens * (this.settings.invertY ? -1 : 1);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));

    for (let i = 0; i < 5; i++) if (inp.hit(`Digit${i + 1}`)) this.selectSlot(i);
    if (inp.wheel) { const i = (this.inv.selected + Math.sign(inp.wheel) + 5) % 5; this.selectSlot(i); }
    if (inp.hit('KeyQ')) this.selectSlot(this.lastSlot);
    if (inp.hit('KeyF')) { this.flashlightOn = !this.flashlightOn; this.sfx.click(1.4); }
    if (inp.hit('KeyG')) this.dropRef({bar: 'hotbar', index: this.inv.selected});
    if (inp.hit('KeyH')) this.quickHeal();
    if (inp.hit('KeyE')) this.interact();

    const held = this.inv.selectedStack();
    const heldDef = held ? itemDef(held.itemId) : null;
    const wdef = heldDef?.kind === 'weapon' ? WEAPONS[heldDef.weaponId!] : null;
    // A fresh sprint (Shift while moving forward) interrupts a timed use. Until the consume view has
    // brought the gun back up it stays lowered: no aiming, firing or reloading.
    if (this.use && (inp.hit('ShiftLeft') || inp.hit('ShiftRight')) && (inp.down('KeyW') || inp.down('ArrowUp'))) this.cancelUse('sprint');
    const vmBusy = !!this.use || this.consumeView.busy;
    this.aiming = !!wdef && inp.mouse[2] && !this.weapon.reloading && !p.sprinting && !vmBusy && !p.climbing;
    const step = p.update(dt, inp, this.layout.grid, this.propIndex, {aiming: this.aiming, speedMult: this.use ? 0.6 : wdef?.moveMult ?? 1, canSprint: !this.use && !inp.mouse[0]});
    if (step) this.sfx.footstep(p.sprinting, p.crouched);
    if (p.justJumped) this.sfx.jump();
    if (p.justLanded) this.sfx.land(Math.min(1, p.landSpeed / 6));
    if (p.justRung) this.sfx.ladder(); // Lane T: hand/foot on a ladder rung (Lane S: Sound Lab rung clip)
    if (p.stanceChanged) this.sfx.crouch(p.crouched);

    if (wdef) {
      const ev = this.weapon.update(dt, {held: inp.mouse[0], pressed: inp.mousePressed[0], reload: inp.hit('KeyR') && !vmBusy, lowered: p.sprinting || vmBusy || p.climbing}, this.inv);
      for (const e of ev) {
        if (e.type === 'fire') this.fire(e.def);
        else if (e.type === 'dry') { this.sfx.dry(e.def.sound); if (this.inv.count(e.def.ammoItem) === 0) this.hud.toast(`Out of ${itemDef(e.def.ammoItem).name.toLowerCase()}`, true); }
        else if (e.type === 'reloadStart') this.sfx.reloadStart(e.def.sound, e.empty);
        else if (e.type === 'shellIn') { this.sfx.shellIn(); this.viewmodel.shellBump(); }
        else if (e.type === 'reloadEnd') this.sfx.reloadEnd(e.def.sound);
      }
    } else if (heldDef?.kind === 'consumable' && inp.mousePressed[0] && !this.use) {
      this.startUse({bar: 'hotbar', index: this.inv.selected});
    }

    if (this.use) {
      this.use.t += dt;
      if (this.use.t >= this.use.total) {
        const ref = this.inv.find(this.use.uid);
        const def = itemDef(this.use.itemId);
        const used = !!ref && this.inv.consumeAt(ref);
        if (used && (def.verb === 'eat' || def.verb === 'drink')) {
          // Food/drink: restore hunger/thirst (HUD bars animate up and pop "+N").
          const d = this.survival.consume(def);
          this.stats.itemsUsed++;
          if (def.verb === 'drink') this.sfx.drink(def.id); else this.sfx.eat(def.id);
          this.hud.toast(`${def.verb === 'drink' ? 'Drank' : 'Ate'} ${def.name.toLowerCase()}: ${Survival.describe(d)}`);
        } else if (used) {
          const healed = p.heal(def.heal ?? 0);
          this.stats.healed += healed;
          this.stats.itemsUsed++;
          this.sfx.heal();
          this.hud.toast(`${def.short} used: +${Math.round(healed)} health`);
        }
        // Item lowers away (or back into the hand if the held stack remains), then the gun returns.
        this.consumeView.complete(this.inv.selectedStack()?.uid === this.use.uid);
        this.use = null;
        this.syncHeld();
      }
    }

    // Hunger/thirst: slow long-term drain in play time only (menus freeze it); at 0, slow health loss.
    const surv = this.survival.update(survivalTicks(this.state) ? dt : 0);
    if (surv.hpLoss > 0) p.takeDamage(surv.hpLoss);
    for (const w of surv.warnings) this.hud.toast(w.text, w.warn);

    this.updateZombies(dt);
    this.physics.update(dt); // ragdolls (fixed 1/60 steps) + casings; update() only runs while playing

    // recoil recovery and bloom decay
    const rec = wdef ? wdef.recoil.recover : 8;
    this.recoilPitch -= this.recoilPitch * Math.min(1, rec * dt);
    this.recoilYaw -= this.recoilYaw * Math.min(1, rec * dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.06);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.updateCamera(dt);

    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const look = this.forward();
    this.currentTarget = this.pickups.target(eye, look, this.layout.grid);
    // Containers under the crosshair within reach; a closer targeted floor pickup wins.
    const tp = this.currentTarget;
    this.containerTarget = this.containers?.target(eye, look, this.layout.grid, tp ? Math.hypot(tp.x - eye.x, tp.y + 0.08 - eye.y, tp.z - eye.z) : Infinity) ?? null;
    // Container wins: clear the pickup target + its highlight (an unreachable eye matches nothing).
    if (this.containerTarget && tp) this.currentTarget = this.pickups.target(new THREE.Vector3(0, 1e6, 0), look, this.layout.grid);
    // Lane T: a rescue ladder under the crosshair (only when nothing else is targeted).
    this.ladderAim = !this.currentTarget && !this.containerTarget && !p.climbing ? ladderTarget(this.layout.traversal.ladders, eye, look, p.y) : null;
    this.pickups.update(this.time);
    this.containers?.update(dt, this.time);

    this.muzzleT -= dt;
    this.muzzleLight.intensity = this.muzzleT > 0 ? 18 * (0.65 + Math.random() * 0.7) : 0; // flicker
    this.flashlight.intensity = this.flashlightOn ? MOOD.flashlight : 0;
    this.lightPool.update(dt, eye);
    this.fx.update(dt);
    this.damage.update(dt); // Lane D: debris physics, knocked pickups
    // Audio: listener follows the camera; reverb room + ambience beds follow the current area.
    this.sfx.setListener(eye.x, eye.y, eye.z, p.yaw);
    const audioArea = this.layout.areas[this.layout.grid.areaAt(p.x, p.z)];
    if (audioArea) this.sfx.setRoom(roomKindFor(audioArea), audioArea.type);
    this.sfx.vitals(dt, p.hp / p.maxHp, p.stamina / 100);
    this.sfx.ambience(dt);
    // viewmodel brightness follows nearby light
    this.viewmodel.setLightLevel(this.lightPool.viewLevel(eye, this.flashlightOn));
    this.consumeView.update(dt); // item-to-face pose + gun holster level, before the gun pose
    this.viewmodel.update(dt, {
      moving: Math.min(1, p.speed / WALK_SPEED), sprint: p.sprinting, aiming: this.aiming, lookDX: inp.dx, lookDY: inp.dy,
      reloading: this.weapon.reloading, reloadProgress: this.weapon.progress, using: !!this.use, useProgress: this.use ? this.use.t / this.use.total : 0, bobT: p.bobT,
      crouch: p.crouchBlend, vy: p.grounded ? 0 : p.vy, landDip: p.landDip,
    });
    this.hud.setStance(p.crouched, p.standBlocked);
    this.updateHud(wdef);
    // Iteration 04 (Lane E): while sighted through the rifle optic its lens draws the reticle, so the HUD crosshair hides.
    const crosshair = document.getElementById('crosshair');
    const opticHide = this.viewmodel.opticAim > 0.6;
    if (crosshair && (crosshair.style.visibility === 'hidden') !== opticHide) crosshair.style.visibility = opticHide ? 'hidden' : '';

    if (!p.alive) this.die();
    const remaining = this.zombies.filter(z => z.brain.alive).length;
    if (remaining === 0 && this.wonAt < 0) { this.wonAt = this.time; this.sfx.win(); this.hud.toast('Station clear'); }
    if (this.wonAt >= 0 && this.time - this.wonAt > 1.6 && this.wonAt > -1 && !this.wonShown) {
      this.wonShown = true;
      this.showEnd('won');
    }
  }
  private wonShown = false;

  private updateCamera(dt: number): void {
    const p = this.player;
    const bob = Math.sin(p.bobT * 2) * 0.025 * Math.min(1, p.speed / WALK_SPEED);
    this.camera.position.set(p.x, p.eye + bob, p.z);
    const sh = this.shake * this.shake;
    const t = this.time;
    this.camera.rotation.set(p.pitch + this.recoilPitch + Math.sin(t * 37) * 0.02 * sh, p.yaw + this.recoilYaw + Math.sin(t * 29) * 0.02 * sh, Math.sin(t * 23) * 0.015 * sh);
    const targetFov = this.aiming ? (WEAPONS[this.weapon.def?.id ?? 'rifle']?.aimFov ?? 60) : this.settings.fov;
    const fov = this.camera.fov + (targetFov - this.camera.fov) * Math.min(1, dt * 14 || 1);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
  }

  private updateHud(wdef: WeaponDef | null): void {
    const p = this.player;
    const st = this.inv.selectedStack();
    const def = st ? itemDef(st.itemId) : null;
    let hint = '';
    if (wdef && st) {
      if (this.weapon.reloading) hint = 'Reloading…';
      else if ((st.mag ?? 0) === 0) hint = this.inv.count(wdef.ammoItem) ? 'Empty — press R' : 'No ammo';
      else if ((st.mag ?? 0) <= wdef.magazine * 0.25 && this.inv.count(wdef.ammoItem)) hint = 'Low — R to reload';
    } else if (def?.kind === 'consumable') hint = useHint(def);
    let prompt = '';
    if (this.currentTarget) {
      const d = itemDef(this.currentTarget.stack.itemId);
      const n = this.currentTarget.stack.count;
      prompt = `<b>[E]</b> Take ${d.kind === 'weapon' ? d.name : `${n > 1 ? n + ' × ' : ''}${d.name}`}`;
    } else if (this.containerTarget && this.containers) prompt = this.containers.prompt(this.containerTarget);
    else if (this.ladderAim) prompt = this.ladderAim.up ? '<b>[E]</b> Climb ladder' : '<b>[E]</b> Climb down ladder';
    else if (p.climbing) prompt = '<b>[Space]</b> Let go';
    const spread = wdef ? this.currentSpread(wdef) : 0.02;
    const spreadPx = Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (window.innerHeight / 2);
    const area = this.layout.grid.areaAt(p.x, p.z);
    this.hud.update({
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina,
      weaponName: def ? def.short : 'Empty hands',
      mag: wdef && st ? st.mag ?? 0 : null, reserve: wdef ? this.inv.count(wdef.ammoItem) : 0,
      hint, prompt, promptItem: this.currentTarget?.stack.itemId,
      remaining: this.zombies.filter(z => z.brain.alive).length, total: this.zombies.length,
      area: area >= 0 ? `${this.layout.areas[area].label} · ${this.layout.name}` : this.layout.grid.get(...this.layout.grid.cellOf(p.x, p.z)) === 2 ? `Track bed · ${this.layout.name}` : this.layout.name,
      spreadPx, aiming: this.aiming, flashlight: this.flashlightOn,
      use: this.use ? {label: useLabel(itemDef(this.use.itemId)), progress: this.use.t / this.use.total} : null,
      food: this.survival.hunger, water: this.survival.thirst,
    }, this.inv);
  }

  // ---------------------------------------------------------------------------------------
  private fire(def: WeaponDef): void {
    this.stats.shots++;
    this.damage.beginShot();
    this.shotCounter++;
    this.sfx.shot(def.sound);
    this.viewmodel.fire(def, stanceRecoilMult(this.player.crouched));
    this.muzzleT = 0.05;
    const f0 = this.forward();
    this.muzzleLight.position.copy(this.camera.position).addScaledVector(f0, 0.8);
    const spread = this.currentSpread(def);
    const kickMul = (this.aiming ? 0.6 : 1) * stanceRecoilMult(this.player.crouched);
    this.recoilPitch += def.recoil.pitch * kickMul;
    this.recoilYaw += (this.rand() - 0.5) * 2 * def.recoil.yaw * kickMul;
    this.player.pitch = Math.min(1.45, this.player.pitch + def.recoil.pitch * 0.3 * kickMul);
    if (def.pellets === 1) this.bloom = Math.min(0.03, this.bloom + 0.0035);

    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.forward();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const o: Vec3 = {x: origin.x, y: origin.y, z: origin.z};
    const dmg = new Map<ZombieActor, {total: number; pellets: number; head: boolean; point: THREE.Vector3}>();
    const muzzle = this.viewmodel.muzzleWorld(this.camera);
    this.fx.muzzle(muzzle, fwd, def.pellets > 1);
    this.physics.onFire(def.id, this.viewmodel, this.camera, this.player); // brass now; shotgun hull on the pump
    for (let i = 0; i < def.pellets; i++) {
      const a = this.rand() * Math.PI * 2, r = spread * Math.sqrt(this.rand());
      const dir = fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();
      const d: Vec3 = {x: dir.x, y: dir.y, z: dir.z};
      const wh = raycastWorld(this.layout.grid, this.layout.props, o, d, def.range, this.layout.trench.floorY);
      let bestT = wh.t, bestZ: ZombieActor | null = null, bestPart = 'torso';
      for (const z of this.zombies) {
        if (!z.brain.alive) continue;
        // reject zombies far from the ray
        const tx = z.brain.x - o.x, tz = z.brain.z - o.z;
        const along = tx * d.x + tz * d.z;
        if (along < -1 || along > bestT + 1) continue;
        const px = o.x + d.x * along, pz = o.z + d.z * along;
        if ((px - z.brain.x) ** 2 + (pz - z.brain.z) ** 2 > 1.6) continue;
        for (const v of z.hitVolumes) {
          const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r);
          if (t < bestT) { bestT = t; bestZ = z; bestPart = v.part; }
        }
      }
      // Lane D: corpses stop (and tear under) bullets too; shots passing close knock loose pickups about.
      const corpse = this.damage.corpseHit(this.zombies, o, d, bestT);
      if (corpse) { bestT = corpse.t; bestZ = null; }
      this.damage.knockPickups(o, d, bestT);
      const end = origin.clone().addScaledVector(dir, bestT);
      const shot = {damage: def.damage * WeaponController.falloff(def, bestT), pellet: def.pellets > 1, weapon: def.id};
      if (bestZ) {
        const mult = bestPart === 'head' ? def.headMult : bestPart === 'limb' ? def.limbMult : 1;
        const amount = def.damage * WeaponController.falloff(def, bestT) * mult;
        const e = dmg.get(bestZ) ?? {total: 0, pellets: 0, head: false, point: end};
        e.total += amount;
        e.pellets++;
        e.head ||= bestPart === 'head';
        dmg.set(bestZ, e);
        // Lane D: rest-space flesh / clothing wound + blood + flesh pieces (was fx.bodyHit only)
        this.damage.hitZombie(bestZ, end, dir, bestPart as 'head' | 'torso' | 'limb', {...shot, damage: amount});
      } else if (corpse) {
        this.damage.hitZombie(corpse.z, end, dir, corpse.part, shot, true);
        this.sfx.impact(end.x, end.y, end.z, 'flesh');
      } else if (wh.kind !== 'none') {
        // Lane D: material-matched persistent damage (craters / per-instance prop damage / breaking) + fx + sound
        this.damage.hitWorld(wh, end, dir, shot);
      }
      if (def.pellets === 1 ? this.shotCounter % 3 === 0 : i < 3) this.fx.tracer(muzzle, end);
    }
    let anyKill = false;
    for (const [z, e] of dmg) {
      const killed = z.brain.damage(e.total, this.player.x, this.player.z);
      z.hitFlash = 1;
      this.sfx.impact(e.point.x, e.point.y, e.point.z, 'flesh');
      if (e.head) this.stats.headshots++;
      // knockback along the shot direction (stays out of walls)
      const k = def.knockback * (e.pellets / def.pellets) * (killed ? 1.4 : 1);
      if (!z.brain.climbing) [z.brain.x, z.brain.z] = moveCircle(this.layout.grid, this.propIndex, z.brain.x, z.brain.z, fwd.x * k, fwd.z * k, z.brain.stats.radius, z.brain.y);
      if (killed) {
        anyKill = true;
        this.stats.kills++;
        this.sfx.zombieDeath(z.brain.x, z.brain.y + 1.4, z.brain.z);
        // articulated ragdoll from the current pose, shoved by this shot (falls back to the Death clip)
        this.physics.ragdoll(z, {dir: fwd, point: e.point, strength: killImpulseStrength(def.id, e.pellets, def.pellets), bone: e.head ? 'head' : undefined});
      }
    }
    if (dmg.size) {
      this.stats.hits++;
      this.hud.hitmarker(anyKill);
      this.sfx.hitTick(anyKill);
    }
    // gunfire alerts zombies; walls muffle it
    for (const z of this.zombies) {
      const los = this.layout.grid.lineOfSight(this.player.x, this.player.z, z.brain.x, z.brain.z);
      z.brain.hear(this.player.x, this.player.z, def.noise * (los ? 1 : 0.6));
    }
  }

  private panOf(x: number, z: number): [number, number] {
    const dx = x - this.player.x, dz = z - this.player.z;
    const dist = Math.hypot(dx, dz);
    const s = Math.sin(this.player.yaw), c = Math.cos(this.player.yaw);
    const rightComp = (dx * c - dz * s) / (dist || 1);
    return [rightComp, dist];
  }

  private brainWorld(): BrainWorld {
    const g = this.layout.grid;
    return {
      px: this.player.x, pz: this.player.z, playerAlive: this.player.alive,
      los: (ax, az, bx, bz) => g.lineOfSight(ax, az, bx, bz),
      // Lane T (iteration 05): height-aware lines/paths (stairs, platform-edge drops, rescue-ladder links).
      walkClear: (ax, az, bx, bz, r) => g.walkLineClearH(ax, az, bx, bz, r),
      // Large station: cross-track detours via the underpasses need ~20k expansions (brain backs off on failure).
      findPath: (ax, az, bx, bz, opts) => this.pathfinder.find(ax, az, bx, bz, 0.34, 26000, opts),
      py: this.player.y,
      ladder: id => this.layout.traversal.ladders[id],
      randomNear: (x, z, r) => {
        for (let i = 0; i < 14; i++) {
          const tx = x + (this.rand() * 2 - 1) * r, tz = z + (this.rand() * 2 - 1) * r;
          const [cx, cy] = g.cellOf(tx, tz);
          if (g.walkable(cx, cy) && g.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) return g.center(cx, cy);
        }
        return null;
      },
      rand: this.rand,
    };
  }

  private updateZombies(dt: number): void {
    const w = this.brainWorld();
    const p = this.player;
    for (const z of this.zombies) {
      const b = z.brain;
      const seqBefore = b.attackSeq;
      const out = b.update(dt, w);
      if (out.face !== null) {
        let d = out.face - b.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = (b.state === 'attack' ? 7 : 4.5) * dt;
        b.yaw += Math.max(-turn, Math.min(turn, d));
      }
      // Lane T (iteration 05): height-aware motor (stairs, drops into the track bed, ladder climbs by the brain).
      const moved = moveZombie(b, out, dt, this.layout.grid, this.propIndex);
      if (b.alive && !b.climbing) {
        // keep bodies apart: other zombies and the player (same level only: platform vs track bed do not shove)
        for (const o of this.zombies) {
          if (o === z || !o.brain.alive || !sameLevel(b.y, o.brain.y)) continue;
          const dx = b.x - o.brain.x, dz = b.z - o.brain.z, d = Math.hypot(dx, dz), min = b.stats.radius + o.brain.stats.radius;
          if (d > 1e-4 && d < min) { const push = (min - d) * 0.5; b.x += dx / d * push; b.z += dz / d * push; }
        }
        const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), min = b.stats.radius + p.radius + 0.22;
        if (d > 1e-4 && d < min && sameLevel(b.y, p.y)) { b.x += dx / d * (min - d); b.z += dz / d * (min - d); }
        settleZombie(b, this.layout.grid, this.propIndex);
      }
      // positional (panner) zombie audio: vocals, swings, footfalls
      const [, dist] = this.panOf(b.x, b.z);
      if (out.alerted) this.sfx.groan(b.x, b.y + 1.6, b.z, b.type === 'coated');
      if (b.attackSeq !== seqBefore) this.sfx.zombieAttack(b.x, b.y + 1.5, b.z);
      if (b.alive) {
        z.groanT -= dt;
        if (z.groanT <= 0) { z.groanT = (b.aware ? 2.5 : 6) + this.rand() * 6; if (dist < 22) this.sfx.groan(b.x, b.y + 1.6, b.z, b.type === 'coated'); }
        if (b.climbing) this.sfx.zombieClimb(z, b.x, b.y, b.z, dt); // Lane S: rung clanks on a ladder
        else this.sfx.zombieGait(z, b.x, b.z, moved, dt, b.type === 'coated', b.y);
      }
      if (out.attackHit) this.hurtPlayer(z);
      z.animate(dt, out.anim, moved);
      z.syncTransform();
      if (!z.ragdolled) z.root.position.y = b.y; // Lane T: feet on stairs / track bed / underpass / ladder
      z.updateVolumes();
    }
  }

  private hurtPlayer(z: ZombieActor): void {
    const p = this.player;
    const amount = z.brain.stats.attackDamage;
    p.takeDamage(amount);
    const dx = z.brain.x - p.x, dz = z.brain.z - p.z;
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    const fwd = -dx * s - dz * c, right = dx * c - dz * s;
    this.hud.damage(Math.atan2(right, fwd), amount);
    this.shake = Math.min(1, this.shake + 0.6);
    // directional camera punch: head snaps up and away from the attacker (recovers with recoil)
    this.recoilPitch += 0.035;
    this.recoilYaw += Math.sign(right) * 0.03;
    this.sfx.hurt();
    this.cancelUse('hit'); // a zombie hit knocks the item away from the face (nothing consumed)
  }

  private die(): void {
    if (this.state !== 'playing') return;
    this.sfx.death();
    this.showEnd('dead');
  }

  private showEnd(kind: 'dead' | 'won'): void {
    const s = this.stats;
    const acc = s.shots ? Math.round(s.hits / s.shots * 100) : 0;
    const text = `${this.layout.name} · code ${seedToCode(this.currentSeed)}\nTime ${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')} · Infected down ${s.kills}/${this.zombies.length}\nShots ${s.shots} · Hits ${s.hits} (${acc}%) · Headshot hits ${s.headshots} · Damage taken ${Math.round(this.player.damageTaken)}`;
    $(kind === 'dead' ? '#death-stats' : '#win-stats').textContent = text;
    this.setState(kind);
  }

  keepExploring(): void {
    void this.enterPlay();
  }

  restart(sameSeed: boolean): void {
    this.wonShown = false;
    // Resume audio at the very start of the click gesture, before the long synchronous rebuild.
    this.sfx.init();
    // Request pointer lock inside the click gesture too; the rebuild can outlast the gesture window.
    const lock = this.input.lock();
    this.newStation(sameSeed ? this.currentSeed : freshSeed());
    void lock.then(() => this.enterPlay());
  }

  /** Nearest walkable world point (helper for QA hooks). */
  snap(x: number, z: number): [number, number] | null {
    const g = this.layout.grid;
    const c = nearestWalkable(g, ...g.cellOf(x, z), 4);
    return c ? g.center(c[0], c[1]) : null;
  }
}
