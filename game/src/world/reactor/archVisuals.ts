// Task reactor-build-20261101 (lane ARCH): the Reactor's ReactorVisuals (world/reactor/visuals.ts) over the built kit.
//  - setFanSpeed(id, s): target speed of fan `id` (O(1)); tick eases the rotor speed toward it and spins ONLY the fans that turn
//    (one instance matrix each; the rotor InstancedMesh uploads once per frame while any turns);
//  - setGeneratorRunning(id, l): the panel lamps' instance colours now (O(1): red off -> green running) and the body's vibration
//    level (tick jitters only running generators' few body instances; back to rest once when it stops);
//  - setCoreGlow(l): the vessel glow target; tick eases it (faint cold glow at 0, a breathing green-white at 1) — one colour;
//  - setTierPower(level, p): one tier's lamp material colour (emergency floor at 0) — one uniform, O(1).
//  - setGeneratorJammed(id, on) (task reactor-playtest-round2-20261102, lane GAS): the jammed generator's red lamp FLASHES (JAM_BLINK_HZ;
//    one instance colour write per flip) while it stands still; cranking / running shows the normal lamps.
// No allocation per call or per frame (scratch matrices / colours); everything is a no-op for unknown ids.

import * as THREE from 'three';
import type {MeshBasicNodeMaterial} from 'three/webgpu';
import type {ReactorVisuals} from './visuals';
import {setReactorVisuals} from './visuals';
import type {KitPlan} from './archKit';
import type {InstanceSlot, KitBuilt} from './archMeshes';
import {LAMP} from './archMaterials';
import type {CoreVisuals} from './coreVisuals'; // task reactor-expansion-20261101 (lane CORE)
import type {ReactorRunState} from './runState';

/** Rotor speed at fan speed 1 (rev / s), spool time constant (s), core glow ease (1 / s), generator jitter amplitude (m). */
export const ARCH_VISUALS = {fanRevPerS: 1.6, fanEase: 1.4, glowEase: 0.6, jitter: 0.006} as const;

/** Glow colours (linear RGB): dormant and alive. Task reactor-expansion-20261101 (lane CORE): the dormant vessel glow is a clear green
 *  (user: "there is no green glow from the reactor like shown in the art"), the alive one a hot green-white. */
const GLOW_COLD = new THREE.Color(0.06, 0.42, 0.12), GLOW_ALIVE = new THREE.Color(0.75, 1.6, 0.9);
const LAMP_OFF = new THREE.Color(0.25, 0.03, 0.02), LAMP_RED = new THREE.Color(1.0, 0.16, 0.08);
const LAMP_GREEN_OFF = new THREE.Color(0.02, 0.08, 0.03), LAMP_GREEN = new THREE.Color(0.2, 1.0, 0.3);

interface FanState { target: number; speed: number; angle: number; basis: THREE.Matrix4; radius: number }
interface GenState { level: number; body: InstanceSlot[]; red: InstanceSlot | undefined; green: InstanceSlot | undefined; resting: boolean; phase: number; jammed: boolean; blink: number }

/** (lane GAS) Fault lamp flash rate of a jammed generator (Hz). */
export const JAM_BLINK_HZ = 1.25;

export class ReactorArchVisuals implements ReactorVisuals {
  private readonly fans: FanState[] = [];
  private readonly fanIndex = new Map<number, number>();
  private readonly gens = new Map<number, GenState>();
  /** The same generator states as an array (the per-frame loop: no iterator allocation). */
  private readonly genList: GenState[] = [];
  private readonly tiers = new Map<number, {mat: MeshBasicNodeMaterial; power: number}>();
  private glowTarget = 0;
  private glow = -1;
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly r = new THREE.Matrix4();
  private readonly sv = new THREE.Vector3();
  private readonly c = new THREE.Color();
  /** Per-frame counters (QA / tests): instance matrices written by the last tick. */
  lastTickWrites = 0;
  /** Task reactor-expansion-20261101 (lane CORE): the hero reactor's staged visuals (arch.ts sets it). */
  core: CoreVisuals | null = null;

  constructor(private readonly built: KitBuilt | null, plan: KitPlan | null, private readonly glowMat: MeshBasicNodeMaterial | null) {
    if (plan && built) {
      plan.fans.forEach((f, i) => { this.fanIndex.set(f.id, i); this.fans.push({target: 0, speed: 0, angle: (f.id * 0.7) % (Math.PI * 2), basis: f.basis, radius: f.radius}); });
      for (const g of plan.generators) {
        const body = g.modelIndex >= 0 ? built.modelSlots.get('generator')?.[g.modelIndex] ?? [] : g.body.map(r => built.slot(r)).filter((s): s is InstanceSlot => !!s);
        const st: GenState = {level: 0, body, red: built.slot(g.lamps[0]), green: built.slot(g.lamps[1]), resting: true, phase: g.id * 1.37, jammed: false, blink: -1};
        this.gens.set(g.id, st);
        this.genList.push(st);
      }
      for (const [level, t] of built.tierLamps) this.tiers.set(level, {mat: t.mat, power: -1});
    }
    for (const level of this.tiers.keys()) this.setTierPower(level, 0);
    for (const id of this.gens.keys()) this.setGeneratorRunning(id, 0);
    this.applyGlow(0);
    this.glow = 0;
    this.writeFans(true);
  }

  setFanSpeed(id: number, speed: number): void {
    const i = this.fanIndex.get(id);
    if (i === undefined) return;
    this.fans[i].target = Math.max(0, Math.min(1, Number.isFinite(speed) ? speed : 0));
  }

  setGeneratorRunning(id: number, level: number): void {
    const g = this.gens.get(id);
    if (!g) return;
    const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    g.level = l;
    // panel lamps: red while stopped (dim when cranking), green as it runs
    if (g.red) { g.red.mesh.setColorAt(g.red.index, this.c.copy(LAMP_RED).lerp(LAMP_OFF, Math.min(1, l * 1.6))); markColors(g.red.mesh); }
    if (g.green) { g.green.mesh.setColorAt(g.green.index, this.c.copy(LAMP_GREEN_OFF).lerp(LAMP_GREEN, l)); markColors(g.green.mesh); }
  }

  /** (lane GAS) Generator `id` jammed: its red fault lamp flashes while it stands still (tick). */
  setGeneratorJammed(id: number, jammed: boolean): void {
    const g = this.gens.get(id);
    if (!g || g.jammed === jammed) return;
    g.jammed = jammed;
    g.blink = -1;
    if (!jammed) this.setGeneratorRunning(id, g.level);
  }

  setCoreGlow(level: number): void {
    this.glowTarget = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    this.core?.setCoreGlow(this.glowTarget); // task reactor-expansion-20261101 (lane CORE)
  }

  /** Task reactor-expansion-20261101 (lane CORE): the restart record -> the hero's staged visuals (idempotent; instant on build). */
  setRestartState(state: Readonly<ReactorRunState>, instant: boolean): void {
    this.core?.setRestartState(state, instant);
  }

  setTierPower(level: number, power: number): void {
    const t = this.tiers.get(level);
    if (!t) return;
    const p = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
    if (p === t.power) return;
    t.power = p;
    const k = LAMP.emergency + (1 - LAMP.emergency) * p;
    t.mat.color.setHex(LAMP.color).multiplyScalar(k);
  }

  /** Per frame (play dt): ease + spin the turning fans, jitter running generators, ease the core glow. */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    this.core?.tick(dt); // task reactor-expansion-20261101 (lane CORE)
    let writes = 0;
    // fans
    let fanMoved = false;
    const ease = 1 - Math.exp(-dt / ARCH_VISUALS.fanEase);
    for (let i = 0; i < this.fans.length; i++) {
      const f = this.fans[i];
      if (f.speed === 0 && f.target === 0) continue;
      f.speed += (f.target - f.speed) * ease;
      if (Math.abs(f.speed - f.target) < 1e-3) f.speed = f.target;
      f.angle = (f.angle + f.speed * ARCH_VISUALS.fanRevPerS * Math.PI * 2 * dt) % (Math.PI * 2);
      fanMoved = true;
    }
    if (fanMoved) writes += this.writeFans(false);
    // generators
    for (let gi = 0; gi < this.genList.length; gi++) {
      const g = this.genList[gi];
      if (g.jammed && g.level <= 0 && g.red) { // (lane GAS) the fault lamp flashes: one colour write per flip
        const on = Math.floor(this.time * JAM_BLINK_HZ * 2) % 2 === 0 ? 1 : 0;
        if (on !== g.blink) { g.blink = on; g.red.mesh.setColorAt(g.red.index, on ? LAMP_RED : LAMP_OFF); markColors(g.red.mesh); writes++; }
      } else if (g.jammed) g.blink = -1;
      if (g.level <= 0) {
        if (!g.resting) { for (let k = 0; k < g.body.length; k++) { const s = g.body[k]; s.mesh.setMatrixAt(s.index, s.base); s.mesh.instanceMatrix.needsUpdate = true; writes++; } g.resting = true; }
        continue;
      }
      g.resting = false;
      const a = ARCH_VISUALS.jitter * g.level, t = this.time * 60 + g.phase;
      const dx = a * Math.sin(t * 1.37), dy = a * 0.5 * Math.sin(t * 2.11 + 1), dz = a * Math.sin(t * 1.73 + 2);
      for (let k = 0; k < g.body.length; k++) {
        const s = g.body[k];
        this.m.copy(s.base);
        const e = this.m.elements;
        e[12] += dx; e[13] += dy; e[14] += dz;
        s.mesh.setMatrixAt(s.index, this.m);
        s.mesh.instanceMatrix.needsUpdate = true;
        writes++;
      }
    }
    // core glow
    if (this.glow !== this.glowTarget) {
      const k = 1 - Math.exp(-dt * ARCH_VISUALS.glowEase);
      this.glow += (this.glowTarget - this.glow) * k;
      if (Math.abs(this.glow - this.glowTarget) < 1e-3) this.glow = this.glowTarget;
    }
    if (this.glow > 0.02 || this.glowTarget > 0) this.applyGlow(this.glow * (1 + 0.06 * Math.sin(this.time * 1.3)));
    this.lastTickWrites = writes;
  }

  private applyGlow(g: number): void {
    if (!this.glowMat) return;
    this.glowMat.color.copy(GLOW_COLD).lerp(GLOW_ALIVE, Math.max(0, Math.min(1.1, g)));
  }

  private writeFans(all: boolean): number {
    const im = this.built?.fanRotors;
    if (!im) return 0;
    let n = 0;
    for (let i = 0; i < this.fans.length; i++) {
      const f = this.fans[i];
      if (!all && f.speed === 0 && f.target === 0) continue;
      this.m.copy(f.basis).multiply(this.r.makeRotationZ(f.angle)).scale(this.sv.setScalar(f.radius));
      im.setMatrixAt(i, this.m);
      n++;
    }
    if (n) im.instanceMatrix.needsUpdate = true;
    return n;
  }

  /** QA / tests: the current visual state. */
  state(): {fans: {id: number; target: number; speed: number; angle: number}[]; generators: {id: number; level: number; jammed: boolean}[]; glow: number; glowTarget: number; tiers: {level: number; power: number}[]} {
    return {
      fans: [...this.fanIndex].map(([id, i]) => ({id, target: this.fans[i].target, speed: this.fans[i].speed, angle: this.fans[i].angle})),
      generators: [...this.gens].map(([id, g]) => ({id, level: g.level, jammed: g.jammed})),
      glow: this.glow, glowTarget: this.glowTarget,
      tiers: [...this.tiers].map(([level, t]) => ({level, power: t.power})),
    };
  }
}

function markColors(im: THREE.InstancedMesh): void {
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
}

/** The visuals of the current Reactor world (ticked by archInstall's frame hook); null on any other level. */
let active: ReactorArchVisuals | null = null;

/** Builder: register the built Reactor world's visuals (null for any other world) — the seam AIR / RESTART call through. */
export function registerReactorArchVisuals(v: ReactorArchVisuals | null): void {
  active = v;
  setReactorVisuals(v);
}
export function activeReactorArchVisuals(): ReactorArchVisuals | null { return active; }
