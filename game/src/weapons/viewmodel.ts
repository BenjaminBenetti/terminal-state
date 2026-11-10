// First-person held-item view, rendered in its own scene/camera after the world so the gun never
// clips into walls. The guns are static model derivatives (not rigged): recoil, bob, sway, equip
// and reload are procedural transform animation of the whole model.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {WEAPONS, type MeleeStage, type WeaponDef} from './weapons';
import {canvasTexture} from '../world/canvasTextures';
import {OPTIC_ADS_KICK, RifleOptic, opticAimPosition} from './optic';
import {KNIFE_POSES, MELEE_POSES, meleePoseOffset, type PoseOffset} from './meleeView'; // lane KNIFE / FEEL
import {GunParts} from './gunParts'; // task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): visible reloads

interface HeldModel {
  root: THREE.Object3D;
  muzzle: THREE.Vector3;
  def?: WeaponDef;
  hip: THREE.Vector3;
  aim: THREE.Vector3;
  hipYaw: number;
  hipPitch: number;
  hipRoll: number;
  /** Iteration 04: see-through optic (rifle-optic.glb) and its rear-glass centre relative to the Grip pivot. */
  optic?: RifleOptic;
  opticPoint?: THREE.Vector3;
  /** User weapon models (2026-10-28): `Sight` / `Eject` markers relative to the Grip pivot (holder frame), when present. */
  sightPoint?: THREE.Vector3;
  eject?: THREE.Vector3;
  /** Lane GUNS (weapon variety): the model's movable reload parts ('Magazine', 'Barrels' + 'Hinge'), when it has any. */
  parts?: GunParts;
}

/** Sight relief used when a model has a `Sight` marker but its WeaponDef sets no `view.sightRelief`. */
const SIGHT_RELIEF_DEFAULT = 0.3;

/**
 * Sight-based ADS pivot (Grip) position in camera space: puts the `Sight` marker on the camera axis `relief` m in
 * front of the eye, i.e. aim = (0, 0, -relief) - (Sight - Grip). `sightPoint` = Sight relative to the Grip pivot.
 */
export function sightAimPosition(sightPoint: THREE.Vector3, relief: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 0, -relief).sub(sightPoint);
}

const ease = (t: number) => t * t * (3 - 2 * t);

export interface ViewState {
  moving: number;
  sprint: boolean;
  aiming: boolean;
  lookDX: number;
  lookDY: number;
  reloading: boolean;
  reloadProgress: number;
  using: boolean;
  useProgress: number;
  bobT: number;
  /** 0 standing … 1 crouched (player.crouchBlend). */
  crouch?: number;
  /** Player vertical velocity (m/s); the gun lags jumps/falls slightly. */
  vy?: number;
  /** Landing camera dip (m), echoed by the gun. */
  landDip?: number;
  /** Iteration 15: grenade-style flare pull-back while T / left click is held (0 .. 1, weapons/flareHold.ts). */
  throwReady?: number;
  /**
   * Lane FEEL (knife-windup-20261030): the held melee weapon's cycle stage and seconds into it (weapons.ts
   * WeaponController.meleePose: windup / ready / swing / recover; stage null / absent = the carry pose).
   */
  melee?: {stage: MeleeStage | null; t: number; charge?: number}; // (lane MELEE, weapon variety: + a charge weapon's charge 0..1)
  /** Lane GUNS: how far the held gun's BREAK action is open (WeaponController.actionOpen, 0 closed .. 1 open; absent = 0). */
  actionOpen?: number;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(54, 1, 0.01, 20);
  private readonly hemi = new THREE.HemisphereLight(0xf2e6cc, 0x2a2622, 1.6);
  private readonly key = new THREE.DirectionalLight(0xfff1dc, 1.4);
  private readonly flashLight = new THREE.PointLight(0xffc27a, 0, 3, 2);
  private readonly items = new Map<string, HeldModel>();
  private readonly pivot = new THREE.Group();
  private current: string | null = null;
  private readonly flash: THREE.Mesh;
  private flashT = 0;
  private kick = 0;
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  aimBlend = 0;
  private lower = 0;
  private equipT = 1;
  private bump = 0;
  private airLag = 0;
  private light = 0.5;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  /** Pistol lane: `pistol` is optional (game.ts passes the real pistol.glb once PISTOL_ART_READY). A gun without a model is simply not shown. */
  /** Lane KNIFE: `knife` (knife-user.glb, Grip at the origin, Tip marker) joins the held models like the guns; absent = not shown. */
  constructor(models: {rifle: GLTF; shotgun: GLTF; pistol?: Pick<GLTF, 'scene'>; knife?: Pick<GLTF, 'scene'>}, consumables: Record<string, THREE.Object3D>) {
    this.scene.add(this.hemi, this.key, this.camera, this.flashLight);
    this.key.position.set(-1, 2, 1);
    this.camera.add(this.pivot);
    for (const [id, gltf] of Object.entries(models) as [string, Pick<GLTF, 'scene'> | undefined][]) {
      const def = WEAPONS[id];
      if (!gltf || !def) continue;
      this.registerWeaponModel(id, def, gltf);
    }
    for (const [id, obj] of Object.entries(consumables)) {
      const holder = new THREE.Group();
      holder.add(obj);
      holder.visible = false;
      this.pivot.add(holder);
      this.items.set(id, {root: holder, muzzle: new THREE.Vector3(), hip: new THREE.Vector3(0.16, -0.17, -0.36), aim: new THREE.Vector3(0.16, -0.17, -0.36), hipYaw: 0.05, hipPitch: 0, hipRoll: -0.04});
    }
    const flashTex = canvasTexture(128, 128, 7, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,250,220,1)');
      g.addColorStop(0.25, 'rgba(255,200,110,0.9)');
      g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,220,150,0.8)';
      for (let i = 0; i < 6; i++) {
        ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(i * Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(w * 0.48, 0); ctx.lineTo(0, 4); ctx.fill(); ctx.restore();
      }
    });
    // Iteration 13 (CORE): additive in colour (as AdditiveBlending) but leaves alpha untouched, so over empty overlay pixels the
    // flash stays pure added light when render/overlay.ts composites the viewmodel target onto the frame.
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({map: flashTex, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor}));
    this.flash.visible = false;
    this.flash.renderOrder = 2;
  }

  /**
   * A held weapon model (constructor models and addModel): a clone pivoting at its `Grip` marker, the muzzle flash at
   * `Muzzle`, ADS from a see-through optic, else the `Sight` marker (sightRelief / sightLift), else `view.aim`; the
   * `Eject` marker for casings; (lane GUNS) its movable reload parts. The constructor path is unchanged by the move here.
   */
  private registerWeaponModel(id: string, def: WeaponDef, gltf: Pick<GLTF, 'scene'>): void {
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    const grip = root.getObjectByName('Grip');
    const muzzleObj = root.getObjectByName('Muzzle');
    const gp = grip ? grip.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const mp = muzzleObj ? muzzleObj.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, -def.view.length / 2);
    // see-through optic (model space, before the Grip shift); without one a `Sight` marker drives ADS, else the legacy view.aim
    const optic = def.view.optic ? RifleOptic.attach(root, def.view.optic) : null;
    const sightObj = optic ? undefined : root.getObjectByName('Sight');
    const sightPoint = sightObj ? sightObj.getWorldPosition(new THREE.Vector3()).sub(gp) : undefined;
    const ejectObj = root.getObjectByName('Eject');
    const eject = ejectObj ? ejectObj.getWorldPosition(new THREE.Vector3()).sub(gp) : undefined;
    const parts = GunParts.find(root) ?? undefined; // lane GUNS: before the Grip shift (model frame); none on the baseline models
    const holder = new THREE.Group();
    root.position.sub(gp);
    holder.add(root);
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; if (m.renderOrder === 0) m.renderOrder = 1; } });
    holder.visible = false;
    this.pivot.add(holder);
    const opticPoint = optic ? optic.rear.sub(gp) : undefined;
    const aim = optic ? opticAimPosition(opticPoint!, def.view.optic!)
      : sightPoint ? sightAimPosition(sightPoint.clone().setY(sightPoint.y + (def.view.sightLift ?? 0)), def.view.sightRelief ?? SIGHT_RELIEF_DEFAULT) // sightLift: eye just over a solid optic/receiver
      : new THREE.Vector3(...def.view.aim);
    this.items.set(id, {root: holder, muzzle: mp.sub(gp), def, hip: new THREE.Vector3(...def.view.hip), aim, hipYaw: def.view.hipYaw, hipPitch: def.view.hipPitch, hipRoll: def.view.hipRoll, optic: optic?.optic, opticPoint, sightPoint, eject, parts});
  }

  /**
   * Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): register a held weapon model LATE — any WEAPONS id
   * (guns and melee; the weapon-variety models load lazily per section). Same placement rules as the constructor's models
   * (registerWeaponModel). Replaces an earlier model of that id; when `id` is the item the game asked to hold (setItem
   * before the model had arrived, or the replaced one in hand), it is shown at once (raised like an equip). Its root is
   * one of warmRoots() from then on: the caller's warm-up compiles it before it is first seen. False = no such weapon.
   */
  addModel(id: string, gltf: Pick<GLTF, 'scene'>): boolean {
    const def = WEAPONS[id];
    if (!def || !gltf?.scene) return false;
    const old = this.items.get(id);
    if (old) {
      if (this.current === id) { old.root.visible = false; this.current = null; }
      this.pivot.remove(old.root);
    }
    this.registerWeaponModel(id, def, gltf);
    if (this.wanted === id && this.current !== id) this.setItem(id);
    return true;
  }

  /**
   * Task office-overhaul-20261030 (lane INTERACT, #1): an extra held item with its own hand pose — the worn backpack readied
   * with 6 is held in front of you (gear/system.ts adds it once, before the warm-up, so its pipelines compile on the loading
   * screen). `hip` = holder position in viewmodel camera space; no ADS pose (aim = hip). Replaces an earlier one of that id.
   */
  addHeldItem(id: string, obj: THREE.Object3D, pose: {hip: readonly [number, number, number]; yaw?: number; pitch?: number; roll?: number}): void {
    const old = this.items.get(id);
    if (old) { if (this.current === id) this.setItem(null); this.pivot.remove(old.root); }
    obj.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.frustumCulled = false; });
    const holder = new THREE.Group();
    holder.name = `held-${id}`;
    holder.add(obj);
    holder.visible = false;
    this.pivot.add(holder);
    const hip = new THREE.Vector3(...pose.hip);
    this.items.set(id, {root: holder, muzzle: new THREE.Vector3(), hip, aim: hip.clone(), hipYaw: pose.yaw ?? 0, hipPitch: pose.pitch ?? 0, hipRoll: pose.roll ?? 0});
  }

  /** Task office-overhaul-20261030 (INTERACT): whether a held model exists for `id` (QA / gear system). */
  hasItem(id: string): boolean {
    return this.items.has(id);
  }

  /** Task office-overhaul-20261030 (INTERACT): the held item id shown now (null: empty hands) — QA / tests. */
  get heldItem(): string | null {
    return this.current;
  }

  /** Lane GUNS: the item last asked for by setItem, even when its model was not registered yet (addModel shows it on arrival). */
  private wanted: string | null = null;

  setItem(itemId: string | null): void {
    this.wanted = itemId;
    if (this.current === itemId) return;
    if (this.current) this.items.get(this.current)!.root.visible = false;
    this.current = itemId && this.items.has(itemId) ? itemId : null;
    if (this.current) {
      const it = this.items.get(this.current)!;
      it.root.visible = true;
      it.root.add(this.flash);
      this.flash.position.copy(it.muzzle).add(new THREE.Vector3(0, 0, -0.05));
    }
    this.flash.visible = false;
    this.equipT = 0;
    Object.assign(this.meleeApplied, {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0}); // lane FEEL: a new item starts from its carry
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setLightLevel(level: number): void {
    this.hemi.intensity = 0.55 + 1.5 * level;
    this.key.intensity = 0.4 + 1.2 * level;
    this.light = level;
  }

  /**
   * Iteration 04: 0..1 how far the held gun is sighted through its see-through optic (aimBlend × the lens's exit-pupil
   * clarity, so it only rises once the reticle is actually visible; 0 for guns without one, e.g. the shotgun's iron
   * sights). The HUD crosshair hides while this is high: the lens draws the reticle.
   */
  get opticAim(): number {
    const it = this.current ? this.items.get(this.current) : undefined;
    return it?.optic && this.pivot.visible ? this.aimBlend * it.optic.clarity : 0;
  }

  /** Iteration 04 QA/tests: the held optic's runtime state (clarity, eye position in the optic frame), if any. */
  get heldOptic(): RifleOptic | null {
    return (this.current ? this.items.get(this.current)?.optic : undefined) ?? null;
  }

  /** `kickMul` scales the visual kick (stance: crouched kicks less). */
  fire(def: WeaponDef, kickMul = 1): void {
    this.kickV += def.recoil.kick * 60 * kickMul;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = (def.pellets > 1 ? 1.5 : 1) * (0.8 + Math.random() * 0.4);
    this.flash.scale.setScalar(s);
    this.flashLight.intensity = def.pellets > 1 ? 6 : 3.5;
  }

  shellBump(): void {
    this.bump = 1;
  }

  /**
   * Iteration 14 (primary, render/warmup.ts): the roots hidden until used — every held-item holder (rifle / shotgun /
   * pistol, consumables, flare), the muzzle flash and the (holstered) pivot. The loading-screen warm-up makes them
   * visible for one compileAsync call (which draws nothing) and restores them, so equipping a found weapon, eating or
   * the first shot does not build its pipeline mid-play.
   */
  warmRoots(): THREE.Object3D[] {
    return [this.pivot, this.flash, ...[...this.items.values()].map(i => i.root), ...this.faceRoots];
  }

  /**
   * Task gas-mask-roof-feedback-20261030 (item 4): a root fixed to the FACE — the first-person gas-mask view (gear/maskView.ts).
   * It hangs off the camera, not the held-item pivot, so it never bobs, kicks, holsters or swaps with the weapon; it draws in
   * this scene's overlay pass and is one of warmRoots() (compiled on the loading screen while hidden). Added once.
   */
  addFaceRoot(root: THREE.Object3D): void {
    if (this.faceRoots.includes(root)) return;
    this.camera.add(root);
    this.faceRoots.push(root);
  }
  private readonly faceRoots: THREE.Object3D[] = [];

  /** Muzzle position in world space, given the main camera. */
  muzzleWorld(main: THREE.Camera, out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.current) return main.getWorldPosition(out);
    const it = this.items.get(this.current)!;
    it.root.updateWorldMatrix(true, false);
    out.copy(it.muzzle).applyMatrix4(it.root.matrixWorld); // in viewmodel camera space (camera at origin)
    out.applyMatrix4(this.camera.matrixWorldInverse);
    return main.localToWorld(out);
  }

  /**
   * Lane D (casings): world-space ejection port of the held gun. `pos`/`dir` are grip-relative
   * model offsets (holder frame). The point keeps its view depth but is re-projected through the
   * screen so a world-space casing appears where this overlay draws the port despite the narrower
   * viewmodel FOV. Returns false unless `itemId` is the held item.
   */
  /** User weapon models: the gun's `Eject` marker in the same grip-relative holder frame as EJECTION_PORTS, or null without one. */
  ejectionMarker(itemId: string): THREE.Vector3 | null {
    return this.items.get(itemId)?.eject ?? null;
  }

  ejectionPort(main: THREE.PerspectiveCamera, itemId: string, pos: THREE.Vector3, dir: THREE.Vector3, outPos: THREE.Vector3, outDir: THREE.Vector3): boolean {
    const it = this.current === itemId ? this.items.get(itemId) : undefined;
    if (!it) return false;
    this.camera.updateMatrixWorld();
    it.root.updateWorldMatrix(true, false);
    outPos.copy(pos).applyMatrix4(it.root.matrixWorld).applyMatrix4(this.camera.matrixWorldInverse);
    const k = Math.tan(THREE.MathUtils.degToRad(main.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    outPos.x *= k;
    outPos.y *= k;
    main.localToWorld(outPos);
    outDir.copy(dir).transformDirection(it.root.matrixWorld).transformDirection(this.camera.matrixWorldInverse).transformDirection(main.matrixWorld);
    return true;
  }

  update(dt: number, s: ViewState): void {
    const it = this.current ? this.items.get(this.current)! : null;
    this.equipT = Math.min(1, this.equipT + dt / 0.45);
    this.aimBlend += ((s.aiming && !s.reloading && !s.sprint ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 14);
    this.lower += (((s.sprint ? 1 : 0)) - this.lower) * Math.min(1, dt * 8);
    // recoil spring
    this.kickV += (-this.kick * 220 - this.kickV * 22) * dt;
    this.kick += this.kickV * dt;
    this.swayX += (-s.lookDX * 0.0009 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.lookDY * 0.0009 - this.swayY) * Math.min(1, dt * 10);
    this.bump = Math.max(0, this.bump - dt * 6);
    this.flashT -= dt;
    if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    if (!it) return;
    if (this.flash.visible) this.flashLight.position.copy(it.muzzle).applyMatrix4(it.root.matrixWorld);

    const aimK = this.aimBlend;
    const hipK = 1 - aimK;
    const bobAmp = (1 - aimK * 0.85) * s.moving * (1 + this.lower * 0.6) * (1 - (s.crouch ?? 0) * 0.3);
    const bobX = Math.sin(s.bobT) * 0.012 * bobAmp;
    const bobY = -Math.abs(Math.cos(s.bobT)) * 0.014 * bobAmp;
    const pos = new THREE.Vector3().lerpVectors(it.hip, it.aim, aimK);
    pos.x += bobX + this.swayX * (1 - aimK * 0.7);
    pos.y += bobY + this.swayY * (1 - aimK * 0.7);
    // optic ADS: the eyepiece is at the cheek, so the visual kick is scaled down there (hip and iron sights unchanged)
    const optK = it.optic ? aimK : 0;
    pos.z += this.kick * 1.0 * (1 - optK * OPTIC_ADS_KICK.pos);
    const rot = new THREE.Euler(this.kick * 3.2 * (1 - optK * OPTIC_ADS_KICK.rot) + this.swayY * 2 + hipK * it.hipPitch, this.swayX * 2.5 + hipK * it.hipYaw, hipK * it.hipRoll);
    // stance: crouching settles the gun a little lower and canted in; jumps make it lag, landings dip it
    const crouch = ease(Math.max(0, Math.min(1, s.crouch ?? 0)));
    pos.y -= crouch * 0.018 * hipK;
    rot.z += crouch * 0.05 * hipK;
    this.airLag += (Math.max(-0.025, Math.min(0.02, -(s.vy ?? 0) * 0.005)) - this.airLag) * Math.min(1, dt * 12);
    pos.y += this.airLag * (1 - aimK * 0.7) - (s.landDip ?? 0) * 0.35;
    rot.x += this.airLag * 1.2 * hipK; // rising: gun sags and the muzzle dips; falling: the reverse
    // sprint: low-ready across the body (muzzle down and in, canted)
    pos.y -= this.lower * 0.03;
    pos.x += this.lower * 0.01;
    pos.z += this.lower * 0.03;
    rot.x -= this.lower * 0.26;
    rot.y += this.lower * 0.42;
    rot.z += this.lower * 0.22;
    // equip: raise from below
    const e = 1 - ease(this.equipT);
    pos.y -= e * 0.32;
    rot.x -= e * 0.7;
    // reload choreography (whole-model motion; lane GUNS: + the model's movable parts, when it has any — see below)
    if (s.reloading && it.def) {
      const p = s.reloadProgress;
      if (it.def.reload.kind === 'magazine') {
        const tilt = p < 0.18 ? ease(p / 0.18) : p > 0.82 ? ease((1 - p) / 0.18) : 1;
        const jolt = Math.max(0, 1 - Math.abs(p - 0.6) * 12);
        rot.z += tilt * 0.55;
        rot.x += tilt * 0.22 - jolt * 0.12;
        pos.y -= tilt * 0.05 - jolt * 0.015;
        pos.x -= tilt * 0.03;
      } else if (it.def.reload.kind === 'break') {
        // lane GUNS: a break action — the open breech presented up toward the eye (muzzle down, canted), a nudge per shell
        const k = ease(Math.max(0, Math.min(1, s.actionOpen ?? 0)));
        rot.x -= k * 0.34 - this.bump * 0.06;
        rot.z += k * 0.24;
        pos.y += k * 0.035 - this.bump * 0.01;
        pos.x -= k * 0.035;
      } else {
        rot.z += 0.4;
        rot.x += 0.18 - this.bump * 0.08;
        pos.y -= 0.03 - this.bump * 0.012;
      }
    }
    // lane GUNS: the magazine out -> in during a magazine reload, the barrels turning about the hinge with a break action
    it.parts?.apply(s.reloading && it.def?.reload.kind === 'magazine' ? s.reloadProgress : null, s.actionOpen ?? 0);
    if (s.using) {
      const p = s.useProgress;
      pos.y += Math.sin(p * Math.PI) * 0.06;
      rot.x += Math.sin(p * Math.PI * 3) * 0.12;
    }
    // Iteration 15: flare held back like a grenade — raised to the right shoulder line and drawn back toward the eye, head
    // tipped back, a slight wind-up tremble at full draw; eased both ways (a cancel lowers it smoothly). Kept inside the
    // 54 deg viewmodel frustum (the first browser check showed a larger draw-back leaving the frame).
    this.throwK += ((s.throwReady ?? 0) - this.throwK) * Math.min(1, dt * 16);
    const tk = ease(Math.max(0, Math.min(1, this.throwK)));
    if (tk > 0.001) {
      const tremble = tk > 0.95 ? Math.sin(this.bobClock * 23) * 0.0025 : 0;
      pos.x += tk * 0.025;
      pos.y += tk * 0.085 + tremble;
      pos.z += tk * 0.08;
      rot.x += tk * 0.7;
      rot.y -= tk * 0.2;
      rot.z -= tk * 0.35;
    }
    this.bobClock += dt;
    // Lane KNIFE / FEEL: the melee cycle (weapons/meleeView.ts) — windup raise, ready hold, the slash through the crosshair at
    // contact, recovery to the upright carry. Exact while a stage runs; a cancelled windup / swing (menu, sprint, switch...)
    // eases back to the carry instead of snapping (no pop).
    if (it.def?.melee) {
      const st = s.melee?.stage ?? null;
      // (lane MELEE, weapon variety: each weapon's own key poses by its model key = weapon id; a charge weapon's ready pose / swing
      // start follow its charge)
      const k = meleePoseOffset(st, s.melee?.t ?? 0, it.def.melee, MELEE_POSES[it.def.view.model] ?? KNIFE_POSES, this.swingPose, s.melee?.charge ?? 0);
      const a = this.meleeApplied, f = st ? 1 : Math.min(1, dt * 14);
      a.x += (k.x - a.x) * f; a.y += (k.y - a.y) * f; a.z += (k.z - a.z) * f;
      a.rx += (k.rx - a.rx) * f; a.ry += (k.ry - a.ry) * f; a.rz += (k.rz - a.rz) * f;
      pos.x += a.x; pos.y += a.y; pos.z += a.z;
      rot.x += a.rx; rot.y += a.ry; rot.z += a.rz;
    }
    // optic ADS: rotate (kick/sway) about the eyepiece instead of the grip, so the lens stays on the eye
    if (it.optic && optK > 0) {
      const o = it.opticPoint!;
      pos.addScaledVector(this.tmpV.copy(o).applyQuaternion(this.tmpQ.setFromEuler(rot)).sub(o), -optK);
    }
    this.pivot.position.copy(pos);
    this.pivot.rotation.copy(rot);
    // Lane D consume view: holstered = lowered out of view while an item is eaten/drunk/applied.
    if (this.holster > 0) { const h = ease(this.holster); this.pivot.position.y -= h * 0.42; this.pivot.position.x += h * 0.05; this.pivot.rotation.x -= h * 0.9; }
    // optic lens uniforms from the final pose: exit pupil (eye vs axis) + reticle on the aim line
    it.optic?.update(this.pivot.position, this.pivot.quaternion, it.opticPoint!, aimK, this.light);
  }

  /** Lane D (iteration 04, weapons/consumeView.ts): 0 = normal … 1 = lowered fully out of view and hidden. */
  setHolstered(k: number): void {
    this.holster = Math.max(0, Math.min(1, k));
    this.pivot.visible = this.holster < 0.999;
  }
  private holster = 0;
  /** Iteration 15: eased flare pull-back and a clock for its full-draw tremble. */
  private throwK = 0;
  private bobClock = 0;
  /** Lane KNIFE: scratch pose of the melee swing. */
  private readonly swingPose: PoseOffset = {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0};
  /** Lane FEEL: the melee offset actually applied (eases back to zero after a cancel; reset when the held item changes). */
  private readonly meleeApplied: PoseOffset = {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0};
}
