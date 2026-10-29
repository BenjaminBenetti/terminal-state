// First-person held-item view, rendered in its own scene/camera after the world so the gun never
// clips into walls. The guns are static model derivatives (not rigged): recoil, bob, sway, equip
// and reload are procedural transform animation of the whole model.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {WEAPONS, type WeaponDef} from './weapons';
import {canvasTexture} from '../world/canvasTextures';
import {OPTIC_ADS_KICK, RifleOptic, opticAimPosition} from './optic';

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
  constructor(models: {rifle: GLTF; shotgun: GLTF; pistol?: Pick<GLTF, 'scene'>}, consumables: Record<string, THREE.Object3D>) {
    this.scene.add(this.hemi, this.key, this.camera, this.flashLight);
    this.key.position.set(-1, 2, 1);
    this.camera.add(this.pivot);
    for (const [id, gltf] of Object.entries(models) as [string, Pick<GLTF, 'scene'> | undefined][]) {
      const def = WEAPONS[id];
      if (!gltf || !def) continue;
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
      this.items.set(id, {root: holder, muzzle: mp.sub(gp), def, hip: new THREE.Vector3(...def.view.hip), aim, hipYaw: def.view.hipYaw, hipPitch: def.view.hipPitch, hipRoll: def.view.hipRoll, optic: optic?.optic, opticPoint, sightPoint, eject});
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

  setItem(itemId: string | null): void {
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
    return [this.pivot, this.flash, ...[...this.items.values()].map(i => i.root)];
  }

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
    // reload choreography (whole-model motion; no magazine/shell geometry is animated)
    if (s.reloading && it.def) {
      const p = s.reloadProgress;
      if (it.def.reload.kind === 'magazine') {
        const tilt = p < 0.18 ? ease(p / 0.18) : p > 0.82 ? ease((1 - p) / 0.18) : 1;
        const jolt = Math.max(0, 1 - Math.abs(p - 0.6) * 12);
        rot.z += tilt * 0.55;
        rot.x += tilt * 0.22 - jolt * 0.12;
        pos.y -= tilt * 0.05 - jolt * 0.015;
        pos.x -= tilt * 0.03;
      } else {
        rot.z += 0.4;
        rot.x += 0.18 - this.bump * 0.08;
        pos.y -= 0.03 - this.bump * 0.012;
      }
    }
    if (s.using) {
      const p = s.useProgress;
      pos.y += Math.sin(p * Math.PI) * 0.06;
      rot.x += Math.sin(p * Math.PI * 3) * 0.12;
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
}
