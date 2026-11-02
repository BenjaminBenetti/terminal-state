// Task reactor-playtest-round2-20261102 (lane STARTUP): THE REACTOR COMING TO LIFE — the startup audio (world/reactor/startupAudio.ts),
// the orange rotating beacons (startupBeacons.ts + startupBeaconPlan.ts) and the ONLINE sky (startupSky.ts: the blue beam with its cast
// light, the sky over the roof clearing). installReactorStartup(game) is called ONCE from the Game constructor right after the restart
// runtime and only REGISTERS; it is inert on every level without `layout.reactor`.
//  - boot: the beacons' BEACON_LIGHTS.count SpotLights and the beam's two PointLights join the scene at intensity 0 (the light set never
//    changes: docs/rendering-warmup.md), warm pool 'reactor-startup' (the beam / cleared sky are hidden until ONLINE);
//  - sectionHooks.build: the beacons + the ONLINE sky into one group (registered with the level culler), the director's baseline, the
//    restored end state at once (a restarted world: beacons turning, beam up, sky clear — nothing replays);
//  - frameHooks (after the restart runtime's): read the restart runtime (its persisted record, its live rod hold, its win clock) ->
//    the director, the beam / sky / outdoor gas, the beacons and their lights;
//  - stateListeners: leaving play stops the rod drive at once.
// Everything visible / audible is a pure function of that record + clock (startupPlan.ts); no state of its own is persisted.

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import {MALL_SKY, MALL_SKY_U} from '../mallExterior';
import {reactorRestartOf, type ReactorRestart} from './restart';
import {HOLD_S} from './restartLogic';
import {planWin, type WinPlan} from './restartWin';
import {reactorAirRuntime} from './generators';
import type {ReactorAir} from './air';
import {coreHeroOf} from './coreHero';
import type {KitPlan} from './archKit';
import {STARTUP, beaconPowerAt, beamAt, skyClearAt, stageSnap} from './startupPlan';
import {StartupAudio, type StartupSfx, type StartupSites} from './startupAudio';
import {planBeacons, type BeaconSpot} from './startupBeaconPlan';
import {BEACON_LIGHTS, BeaconLights, BeaconVisuals} from './startupBeacons';
import {BeamLights, OnlineSky, beamSpan} from './startupSky';
import {RainAudio, type RainSfx} from './audioRain'; // task reactor-surface-ending-20261102 (lane AUDIO): the surface rain bed

interface P3 { x: number; y: number; z: number }

/** What the startup runtime needs from Game (structural: tests drive it with a fake host). */
export interface StartupHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  sfx: unknown;
  layout: StationLayout;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  world?: {culler?: unknown; reactorArch?: {plan: KitPlan | null}} | null;
  atmosphere?: {addScatterLight?(l: THREE.PointLight): unknown; removeScatterLight?(l: THREE.PointLight): unknown};
}

/** QA tunables (__LL.reactorStartup({...})). */
export interface StartupTune { beaconLight?: number; beamLight?: number }

const runtimes = new WeakMap<object, ReactorStartup>();
/** The runtime installed into a host (QA / tests). */
export const reactorStartupOf = (host: object): ReactorStartup | undefined => runtimes.get(host);

export class ReactorStartup {
  info: ReactorInfo | null = null;
  root: THREE.Group | null = null;
  beacons: BeaconVisuals | null = null;
  sky: OnlineSky | null = null;
  readonly beaconLights = new BeaconLights();
  readonly beamLights = new BeamLights();
  readonly audio: StartupAudio;
  /** Lane AUDIO (surface ending): the rain bed — outside on the surface after the win, muffled under the roof (audioRain.ts). */
  readonly rain: RainAudio;
  readonly tune = {beaconLight: 1, beamLight: 1};
  /** The host's restart runtime / built Reactor air (tests replace them). */
  findRestart: () => ReactorRestart | undefined = () => reactorRestartOf(this.host);
  findAir: () => ReactorAir | null = () => reactorAirRuntime(this.host)?.air ?? null;
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, restored: 0, frames: 0, outdoorWrites: 0};
  /** The last shown state (QA / tests). */
  readonly shown = {winT: null as number | null, beam: 0, head: 0, clear: 0, turning: 0, lit: 0};
  private plan: WinPlan | null = null;
  private rank = new Map<number, number>();
  private byRank: BeaconSpot[][] = [];
  private sites: StartupSites | null = null;
  /** The built layout's storeys (lane AUDIO: the surface rain rule reads their area grids). */
  private levels: StationLayout['levels'] = [];
  private scattered = false;
  private curtain0 = MALL_SKY.curtain as number;
  private readonly eye = new THREE.Vector3();
  private readonly p3: P3 = {x: 0, y: 0, z: 0};

  constructor(readonly host: StartupHost) {
    this.audio = new StartupAudio(() => (host.sfx ?? null) as StartupSfx | null);
    this.rain = new RainAudio(host, () => (host.sfx ?? null) as RainSfx | null);
  }

  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    this.beaconLights.addTo(h.scene);
    this.beamLights.addTo(h.scene);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.audio.pause(); }) as (state: never, prev: never) => void);
    h.warmRegistry?.addPool('reactor-startup', () => (this.root ? [this.root] : []));
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    if (this.info) this.teardown();
    const info = layout.reactor;
    if (!info) return;
    const h = this.host;
    this.info = info;
    this.levels = layout.levels ?? [];
    this.counts.builds++;
    this.plan = planWin(info.tiers, info.fans);
    this.rank = new Map(this.plan.tiers.map((lv, r) => [lv, r]));
    const root = new THREE.Group();
    root.name = 'reactor-startup';
    const spots = planBeacons(layout);
    this.beacons = spots.length ? new BeaconVisuals(spots) : null;
    if (this.beacons) root.add(this.beacons.group);
    this.byRank = this.plan.tiers.map(lv => spots.filter(s => s.tier === lv));
    this.sky = new OnlineSky(info, layout.levels.map(l => l.id));
    root.add(this.sky.group);
    this.beamLights.place(this.sky.span);
    h.scene.add(root);
    this.root = root;
    const culler = h.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(root);
    this.curtain0 = MALL_SKY_U.curtain.value as number;
    this.sites = this.makeSites(info);
    const R = this.restart();
    this.liveT = null;
    const winT = this.winT(R, 0);
    if (winT !== null) this.counts.restored++;
    this.audio.build(R?.state ? stageSnap(R.state) : {fuses: 0, breaker: false, valve: false, pump: false, key: false, rods: false, restarted: false}, winT, this.plan.tiers.length);
    this.apply(0, winT); // the restored end state at once (no transition)
  }

  teardown(): void {
    this.audio.teardown();
    this.rain.stop();
    if (this.scattered) { this.host.atmosphere?.removeScatterLight?.(this.beamLights.mid); this.scattered = false; }
    this.beaconLights.off();
    this.beamLights.set(0);
    MALL_SKY_U.gas.value = MALL_SKY.gas; // the shared exterior gas uniform back to its default (the mall reads it)
    this.beacons?.dispose();
    this.sky?.dispose();
    this.root?.removeFromParent();
    this.root = null;
    this.beacons = null;
    this.sky = null;
    this.info = null;
    this.levels = [];
    this.plan = null;
    this.sites = null;
    this.byRank = [];
  }

  private restart(): ReactorRestart | undefined {
    return this.findRestart();
  }

  /**
   * The startup clock: the restart's live win clock while its sequence runs; once that sequence is done (it stops stepping at its last
   * change) this clock runs on with play time, so the sky clearing completes. A world BUILT with the sequence already done (a restored
   * restart: finish()) or a restarted record without one is at its end (Infinity). null = not restarted.
   */
  private winT(R: ReactorRestart | undefined, dt: number): number | null {
    if (!R?.state) return (this.liveT = null);
    if (R.win) this.liveT = !R.win.done ? R.win.t : this.liveT === null ? Infinity : this.liveT + dt;
    else this.liveT = R.state.restarted ? (this.liveT ?? Infinity) : null;
    return this.liveT;
  }
  private liveT: number | null = null;

  private makeSites(info: ReactorInfo): StartupSites {
    const core = {x: info.core.x, y: (info.core.y0 + info.core.y1) / 2, z: info.core.z};
    const blue = coreHeroOf(this.host.world?.reactorArch?.plan ?? null)?.lights.blue[0];
    const crdm = blue ? {x: blue.x, y: blue.y - 1.6, z: blue.z} : {x: info.core.x, y: info.core.y1 + 1, z: info.core.z};
    const span = beamSpan(info); // lane AUDIO: the beam column (base on the vessel .. its head in the sky)
    const ctl = new Map<string, P3>();
    const near = (list: readonly BeaconSpot[], L: P3, max: number): P3 | null => {
      let best: P3 | null = null, bd = max;
      for (const s of list) { const d = Math.hypot(s.head.x - L.x, s.head.y - L.y, s.head.z - L.z); if (d < bd) { bd = d; best = s.head; } }
      return best;
    };
    return {
      core, crdm,
      beam: L => ({x: span.x, y: Math.min(span.y1, Math.max(span.y0, L.y)), z: span.z}),
      control: id => {
        let p = ctl.get(id);
        if (!p) {
          const e = this.restart()?.controls.find(c => c.id === id);
          if (!e) return null;
          p = {x: e.m.pick.x + e.fx * 0.1, y: e.m.pick.y, z: e.m.pick.z + e.fz * 0.1};
          ctl.set(id, p);
        }
        return p;
      },
      tier: (rank, L) => {
        const list = this.byRank[rank] ?? [];
        if (list.length) return near(list, L, Infinity);
        const lv = this.plan?.tiers[rank], t = info.tiers.find(q => q.level === lv);
        return t ? {x: info.pit.cx, y: t.baseY + 3, z: info.pit.cz} : null;
      },
      beacon: (L, max) => {
        const v = this.beacons;
        if (!v) return null;
        let best: P3 | null = null, bd = max;
        for (let i = 0; i < v.spots.length; i++) {
          if (v.power[i] < 0.05) continue;
          const s = v.spots[i].head, d = Math.hypot(s.x - L.x, s.y - L.y, s.z - L.z);
          if (d < bd) { bd = d; best = s; }
        }
        return best;
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (while playing; after the restart runtime's frame)

  frame(dt: number): void {
    if (!this.info) return;
    this.counts.frames++;
    const R = this.restart();
    const winT = this.winT(R, dt);
    this.host.camera.getWorldPosition(this.eye);
    const L = this.p3;
    L.x = this.eye.x; L.y = this.eye.y; L.z = this.eye.z;
    if (R?.state && this.sites) {
      const hold = R.hold && R.hold.e.id === 'rods' ? Math.min(1, R.hold.t / HOLD_S.rods) : null;
      this.audio.frame(dt, stageSnap(R.state), hold, winT, this.sites, L);
    }
    this.apply(dt, winT);
    this.rain.frame(dt, L, this.shown.clear, this.info, this.levels); // lane AUDIO: after the win only (the sky's clearing gates it)
  }

  /** The visible state at win time `winT` (null: not restarted): beam + its lights, the sky / outdoor gas, the beacons + their lights. */
  private apply(dt: number, winT: number | null): void {
    const t = winT ?? -1, beam = beamAt(t), clear = skyClearAt(t);
    this.sky?.apply(beam, clear);
    this.beamLights.set(beam.on, this.tune.beamLight);
    const atm = this.host.atmosphere;
    if (beam.on > 0 && !this.scattered && atm?.addScatterLight) this.scattered = !!atm.addScatterLight(this.beamLights.mid);
    else if (beam.on <= 0 && this.scattered) { atm?.removeScatterLight?.(this.beamLights.mid); this.scattered = false; }
    // the surface air over the roof: ONE function for the exposure and the march (ReactorAir.outdoor), the outside gas sheets / curtain
    const air = this.findAir();
    if (air?.setOutdoorClear(clear)) this.counts.outdoorWrites++;
    MALL_SKY_U.gas.value = MALL_SKY.gas * (1 - clear);
    MALL_SKY_U.curtain.value = this.curtain0 * (1 - clear);
    // the beacons: the orange wave from the core floor up the pit, each turning with its power; the real lights on the nearest
    const v = this.beacons, n = this.plan?.tiers.length ?? 0;
    let turning = 0;
    if (v) turning = v.update(dt, i => (winT === null ? 0 : beaconPowerAt(t, this.rank.get(v.spots[i].tier) ?? 0, n)), STARTUP.beaconRev);
    const lit = this.beaconLights.update(dt, v, this.eye, this.tune.beaconLight);
    const s = this.shown;
    s.winT = winT; s.beam = beam.on; s.head = beam.head; s.clear = clear; s.turning = turning; s.lit = lit;
  }

  // -------------------------------------------------------------------------------------------
  // QA

  qa(): object {
    const v = this.beacons, sky = this.sky;
    return {
      reactor: !!this.info, shown: {...this.shown, winT: this.shown.winT === Infinity ? 'done' : this.shown.winT},
      beacons: v ? {...v.stats(), perTier: this.byRank.map(l => l.length), at: v.spots.map(s => ({tier: s.tier, level: s.level, x: s.x, y: s.y, z: s.z}))} : null,
      beaconLights: this.beaconLights.lights.map((l, i) => ({beacon: this.beaconLights.assigned[i], intensity: +l.intensity.toFixed(1)})),
      sky: sky?.stats() ?? null, beamLights: this.beamLights.all.map(l => ({name: l.name, intensity: +l.intensity.toFixed(1), at: [+l.position.x.toFixed(2), +l.position.y.toFixed(2), +l.position.z.toFixed(2)]})),
      scatter: this.scattered, outdoor: this.findAir()?.outdoor ?? null,
      audio: {...this.audio.counts, loops: this.audio.loops}, rain: {...this.rain.shown}, counts: {...this.counts}, tune: {...this.tune}, lightsMax: BEACON_LIGHTS.count + 2,
    };
  }

  /** QA: light gains (uniform / intensity values only). */
  setTune(t: StartupTune): object {
    if (typeof t.beaconLight === 'number' && Number.isFinite(t.beaconLight)) this.tune.beaconLight = Math.max(0, t.beaconLight);
    if (typeof t.beamLight === 'number' && Number.isFinite(t.beamLight)) this.tune.beamLight = Math.max(0, t.beamLight);
    return {...this.tune};
  }
}

/** Installs the startup runtime into a Game (one call in the Game constructor, right after installReactorRestart). */
export function installReactorStartup(host: StartupHost): ReactorStartup {
  return new ReactorStartup(host).install();
}
