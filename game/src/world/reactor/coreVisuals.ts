// Task reactor-expansion-20261101 (lane CORE): the hero reactor's runtime — ReactorVisuals.setRestartState (world/reactor/visuals.ts) lands
// here through ReactorArchVisuals. Idempotent: the stage TARGETS are a pure function of the persisted record (coreStages.ts), so the
// same state again changes nothing, an instant restore (build / reload) jumps straight to the stage, and there are no one-shots to
// replay. Per frame: ease the levels, write a handful of uniforms, spin the turning rotors (O(rotors) matrices), recolour the status
// lamps only when a level moved. The reactor's glow LIGHTS (world/reactor/coreLights.ts, boot-time objects) read `lightLook()`.
// No allocation per call or per frame.

import * as THREE from 'three';
import type {ReactorRunState} from './runState';
import type {CoreBuilt} from './coreLiquids';
import type {CoreHeroLayout} from './coreHero';
import {CORE_LOOK, coreLook, coreStageTargets, easeLevels, lampColor, sameLevels, type CoreLook, type CoreStageLevels} from './coreStages';

const zero = (): CoreStageLevels => ({fuse0: 0, fuse1: 0, power: 0, pressure: 0, flow: 0, armed: 0, core: 0});

export class CoreVisuals {
  /** Stage targets (from the record) and the eased levels shown. */
  readonly target: CoreStageLevels = zero();
  readonly level: CoreStageLevels = zero();
  /** The look at the current levels (uniform values, rotor speeds, light candela). */
  look: CoreLook = coreLook(zero());
  /** Look tunables (QA: __LL.reactorCore). */
  tune: {[K in keyof typeof CORE_LOOK]: number} = {...CORE_LOOK};
  /** Counters (QA / tests): state changes applied, instant restores, lamp recolours. */
  readonly counts = {states: 0, ignored: 0, instant: 0, recolors: 0};
  private time = 0;
  private flowShift = 0;
  private lampsDirty = true;
  private readonly m = new THREE.Matrix4();
  private readonly r = new THREE.Matrix4();
  private readonly s = new THREE.Vector3();
  private readonly rgb: [number, number, number] = [0, 0, 0];
  private readonly col = new THREE.Color();
  private readonly lights = {green: 0, blue: 0};

  constructor(readonly built: CoreBuilt | null, readonly hero: CoreHeroLayout | null) {
    this.apply(0);
  }

  /** The restart record changed (or the world was built: `instant`). */
  setRestartState(state: Readonly<ReactorRunState>, instant: boolean): void {
    const t = coreStageTargets(state);
    if (sameLevels(t, this.target) && !instant) { this.counts.ignored++; return; }
    Object.assign(this.target, t);
    this.counts.states++;
    if (instant) { Object.assign(this.level, t); this.counts.instant++; }
    this.lampsDirty = true;
    this.apply(0);
  }

  /** ARCH's core glow (the win sequence's ramp): the core level follows it upward while the rods are out. */
  setCoreGlow(k: number): void {
    if (this.target.core > 0 && Number.isFinite(k)) this.level.core = Math.max(this.level.core, Math.min(1, k));
  }

  tick(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    if (easeLevels(this.level, this.target, dt)) this.lampsDirty = true;
    this.apply(dt);
  }

  /** The glow lights' candela now (with a slow breathing on the green; coreLights.ts). */
  lightLook(): {readonly green: number; readonly blue: number} {
    const breathe = 1 + 0.06 * Math.sin(this.time * 1.3) + 0.03 * Math.sin(this.time * 3.1 + 1);
    this.lights.green = this.look.green * breathe;
    this.lights.blue = this.look.blue;
    return this.lights;
  }

  private apply(dt: number): void {
    const L = coreLook(this.level, this.tune, this.look);
    this.flowShift = (this.flowShift + dt * L.flowSpeed * 0.55) % 1000;
    const b = this.built;
    if (!b) return;
    const u = b.uniforms;
    u.time.value = this.time;
    u.goop.value = L.goop;
    u.churn.value = L.churn;
    u.flowGlow.value = L.flowGlow;
    u.flowShift.value = this.flowShift;
    u.fill.value = L.fill;
    // rotors: only while turning
    const w = b.wheels;
    if (w && dt > 0) {
      let moved = false;
      for (let i = 0; i < b.wheelInfo.length; i++) {
        const wi = b.wheelInfo[i], rev = wi.kind === 'rcp' ? L.pumpRev : L.turbineRev;
        if (rev <= 1e-4) continue;
        wi.angle = (wi.angle + rev * Math.PI * 2 * dt) % (Math.PI * 2);
        w.setMatrixAt(i, this.m.copy(wi.basis).multiply(this.r.makeRotationZ(wi.angle)).scale(this.s.setScalar(wi.r)));
        moved = true;
      }
      if (moved) w.instanceMatrix.needsUpdate = true;
    }
    // status lamps: recolour when a level moved
    if (this.lampsDirty && b.lamps && this.hero) {
      this.lampsDirty = false;
      const lamps = this.hero.lamps;
      for (let i = 0; i < lamps.length; i++) {
        const c = lampColor(lamps[i].group, this.level, this.rgb);
        b.lamps.setColorAt(i, this.col.setRGB(c[0], c[1], c[2]));
      }
      if (b.lamps.instanceColor) b.lamps.instanceColor.needsUpdate = true;
      this.counts.recolors++;
    }
  }

  /** QA / tests. */
  state(): {target: CoreStageLevels; level: CoreStageLevels; look: CoreLook; counts: CoreVisuals['counts']} {
    return {target: {...this.target}, level: {...this.level}, look: {...this.look}, counts: {...this.counts}};
  }
}

/** The core visuals of the current Reactor world (the lights runtime reads it; null elsewhere). */
let active: CoreVisuals | null = null;
export function setActiveCoreVisuals(v: CoreVisuals | null): void { active = v; }
export function activeCoreVisuals(): CoreVisuals | null { return active; }
