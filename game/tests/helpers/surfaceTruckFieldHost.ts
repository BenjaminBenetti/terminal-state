// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): a Node host for the truck's CONDITION / REPAIR / DASH MAP / FOG
// PRESSURE tests — the truck's own host (tests/helpers/surfaceTruckHost.ts: the vehicle controller, the REAL Player, the truck's
// definition and its compartments over a real Inventory) with the field systems installed exactly like Game (installTruckCondition after
// the compartments), recording fakes for what other systems own (the volumetric smoke field, the fire sprites, the sound cues, the map
// runtime) and, optionally, a synthetic fog-pressure boundary in the layout (a version-2 district's `surface.boundary`).
import type {Levels} from '../../src/gen/levels';
import {CELL, FLOOR, Grid, SOLID} from '../../src/gen/grid';
import {Levels as LevelsClass} from '../../src/gen/levels';
import type {PropPlacement} from '../../src/gen/props';
import type {SPose, SurfaceBoundary} from '../../src/gen/surface/surfaceTypes';
import type {SmokeEmitterOptions, SmokeHandle} from '../../src/render/smoke';
import type {PlanningMap} from '../../src/world/surface/mapModel';
import {installTruckCondition, type TruckFieldHost} from '../../src/world/surface/truckStorage';
import {build} from './skywaysCarHost';
import {truckHost, type TruckTestHost} from './surfaceTruckHost';

/** A flat walled floor `w` x `d` m (0.5 m cells, floor 0, ceiling `ceil`): room to drive the truck at speed. */
export function flatLevels(w: number, d: number, ceil = 8): Levels {
  const W = Math.round(w / CELL), H = Math.round(d / CELL), g = new Grid(W, H);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = g.idx(cx, cy);
    if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) { g.cells[i] = SOLID; continue; }
    g.cells[i] = FLOOR;
    g.area[i] = 0;
    g.floor[i] = 0;
    g.ceil[i] = ceil;
  }
  return new LevelsClass([{id: 0, role: 'main', grid: g, baseY: 0}], [], []);
}

export interface FakePlume { opts: SmokeEmitterOptions; alive: boolean; emitting: boolean; updates: number; stopped: number | null }
export interface FakeLoop { cue: string; playing: boolean; level: number; stops: number }

export interface FieldTestHost extends TruckTestHost {
  input: {down(code: string): boolean; clears: number};
  hitListeners: ((hit: {amount: number}) => void)[];
  atmosphere: {markShadows(): void; addSmokeEmitter(o: SmokeEmitterOptions): SmokeHandle};
  fireFx: {standing(key: object, x: number, y: number, z: number, r: number, flames: number, smoke: number, dark: number, dt: number): void};
}

/** The recorded effects / sounds (bounded: counters + the last values). */
export interface FieldLog {
  plumes: FakePlume[];
  loops: FakeLoop[];
  /** FireFx.standing calls: sprite smoke (flames 0) / flame calls, the last dark, the max flames seen. */
  smokeCalls: number;
  flameCalls: number;
  lastDark: number;
  maxFlames: number;
  groans: number[];
  cues: string[];
  stalls: number;
  truckHits: number;
  rings: (number | null)[];
}

export function fieldHost(o: {pose?: Partial<SPose>; props?: PropPlacement[]; levels?: Levels; boundary?: SurfaceBoundary; map?: () => PlanningMap | null; build?: boolean} = {}) {
  const r = truckHost({pose: o.pose, props: o.props, levels: o.levels, storage: true, build: false});
  const h = r.h as FieldTestHost, car = r.car;
  const log: FieldLog = {plumes: [], loops: [], smokeCalls: 0, flameCalls: 0, lastDark: 0, maxFlames: 0, groans: [], cues: [], stalls: 0, truckHits: 0, rings: []};
  h.input = h.keys;
  h.hitListeners = [];
  (h.hud as {setHoldRing?(p: number | null): void}).setHoldRing = p => { log.rings.push(p); if (log.rings.length > 8) log.rings.shift(); };
  h.atmosphere = {
    markShadows() {},
    addSmokeEmitter(opts) {
      const p: FakePlume = {opts: {...opts}, alive: true, emitting: true, updates: 0, stopped: null};
      log.plumes.push(p);
      return {
        id: log.plumes.length, get alive() { return p.alive; }, get emitting() { return p.alive && p.emitting; },
        setPos: (x, y, z) => { p.opts.x = x; p.opts.y = y; p.opts.z = z; },
        update: u => { Object.assign(p.opts, u); p.updates++; },
        stop: fade => { p.emitting = false; p.stopped = fade ?? 3; p.alive = false; },
      };
    },
  };
  h.fireFx = {
    standing(_key, _x, _y, _z, _r, flames, smoke, dark) {
      if (flames > 0) { log.flameCalls++; log.maxFlames = Math.max(log.maxFlames, flames); }
      else if (smoke > 0) { log.smokeCalls++; log.lastDark = dark; }
    },
  };
  Object.assign(h.sfx as object, {
    engineStall: () => { log.stalls++; h.sfxCalls.push('stall'); return 1.2; },
    reactorCue: (cue: string) => { log.cues.push(cue); },
    reactorLoop: (cue: string, _x: number, _y: number, _z: number, opt?: {level?: number}) => {
      const l: FakeLoop = {cue, playing: true, level: opt?.level ?? 1, stops: 0};
      log.loops.push(l);
      return {setPos() {}, setLevel(k: number) { l.level = k; }, stop() { l.playing = false; l.stops++; }, get playing() { return l.playing; }};
    },
    truckGroan: (_x: number, _y: number, _z: number, k: number) => { log.groans.push(k); return true; },
    carImpact: () => { log.truckHits++; return true; },
  });
  if (o.boundary) (h.layout as unknown as {surface: {boundary?: SurfaceBoundary}}).surface.boundary = o.boundary;
  const map = {opens: 0, model: o.map ?? (() => null)};
  const sys = installTruckCondition(h as unknown as TruckFieldHost, car, {model: () => map.model(), open: () => { map.opens++; return true; }});
  if (o.build !== false) build(h);
  return {h, car, pose: r.pose, storage: r.storage!, sys, log, map};
}

/** A boundary whose clear rect ends at x = `edgeX` (everything west of it clear, the ramp `ramp` m east of it to pressure 1). */
export function eastBoundary(edgeX: number, ramp: number): SurfaceBoundary {
  return {clear: {x0: -1e4, x1: edgeX, z0: -1e4, z1: 1e4}, ramp, edge: {x0: -1e4, x1: edgeX + ramp * 4, z0: -1e4, z1: 1e4}};
}
