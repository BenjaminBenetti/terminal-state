// Office tower QA hooks (iteration 16 lane TOWER; task office-seamless lane LIFT) for short, bounded browser spot checks,
// spread into window.__LL by qa.ts. Nothing here bypasses the gameplay rules: calls / floor choices go through the same
// logic the landing buttons and the cab panel use, and the cab then really travels while the normal frame loop runs. The
// "go" helpers only PLACE the player (QA positioning, like a teleport — never traversal proof) and aim the view.

import type {TowerRuntime} from './towerRuntime';
import {floorLabel, gateWorld, insideRect} from './towerShared';
import {EXT_U} from './exterior';

type Rgb = [number, number, number];
/** Exterior look knobs (uniform values only: no rebuild). Colours are LINEAR rgb. */
export interface ExteriorTune { haze?: Rgb; hazeDensity?: number; sun?: Rgb; sky?: Rgb; ground?: Rgb; zenith?: Rgb; skyGain?: number; sunDir?: [number, number, number] }

interface QaGame {
  tower: TowerRuntime;
  player: {x: number; z: number; y: number; yaw: number; pitch: number; eye: number; vy: number; grounded: boolean; climb: unknown; vx?: number; vz?: number};
  levels?: {levelAt(x: number, z: number, y: number): number};
  camera: {updateMatrixWorld(force?: boolean): void};
}

/** Put the player at (x, z) standing on a floor at height y (QA positioning only). */
function stand(g: QaGame, x: number, z: number, y: number): void {
  const p = g.player;
  p.x = x; p.z = z; p.y = y; p.vy = 0; p.grounded = true; p.climb = null;
  if (p.vx !== undefined) p.vx = 0;
  if (p.vz !== undefined) p.vz = 0;
  p.eye = y + 1.62;
}

/** Face (x, y, z) from the player's eye (camera convention: forward = (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch)). */
function face(g: QaGame, x: number, y: number, z: number): void {
  const p = g.player, eyeY = p.y + 1.62;
  const dx = x - p.x, dz = z - p.z, dy = y - eyeY;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function towerQaApi(game: unknown) {
  const g = game as QaGame;
  const rt = () => g.tower;
  const elev = () => rt().office?.elevator ?? null;
  return {
    /**
     * Office tower state: the cab (y, v, phase, stop / target floors, queue, doors 0..1), every stop (y, landing doors, lit
     * buttons), riders carried on the last moving frame, the player (y, storey, in the cab), windows / exterior, counters.
     */
    tower: () => {
      const o = rt().office;
      if (!o) return {office: false};
      const e = o.elevator, P = g.player;
      const L = e?.logic;
      const ex = o.exterior;
      return {
        office: true, floors: o.info.floors, groundY: o.info.groundY, storeys: o.info.storeys.map(s => ({floor: s.floor, level: s.levelId, baseY: s.baseY, label: s.label})),
        cab: L ? {
          y: r3(L.y), v: r3(L.v), phase: L.phase, dir: L.dir, stop: L.stop !== null ? L.stops[L.stop].floor : null, target: L.target !== null ? L.stops[L.target].floor : null,
          floor: L.floor, queue: [...L.requests].map(k => L.stops[k].floor).sort((a, b) => a - b), doors: r3(L.door), state: L.state,
          gateOpen: e!.gate.open, level: e!.vol.level, trips: L.trips, arrivals: L.arrivals,
        } : null,
        stops: L ? L.stops.map((s, i) => ({floor: s.floor, label: floorLabel(s.floor), y: r3(s.y), landingDoor: r3(L.landingDoor(i)), hall: L.hall.has(i), car: L.car.has(i)})) : [],
        landingDoors: L ? Object.fromEntries(L.stops.map((s, i) => [s.floor, r3(L.landingDoor(i))])) : {},
        riders: e ? {...e.carried} : null,
        player: {x: r3(P.x), y: r3(P.y), z: r3(P.z), level: g.levels?.levelAt(P.x, P.z, P.y) ?? -1, inCab: rt().playerInCab()},
        windows: o.windows ? {spans: o.windows.plans.length, storeys: new Set(o.windows.plans.map(p => p.level)).size, panes: o.windows.plans.reduce((n, p) => n + p.panes.length, 0)} : null,
        exterior: ex ? {visible: ex.view.root.visible, tris: ex.view.tris, groundY: ex.plan.groundY, instanced: ex.view.instanced.length, models: ex.view.used} : null,
        target: rt().target?.kind ?? null, prompt: rt().prompt, listOpen: rt().choice.isOpen, counts: {...rt().counts},
      };
    },
    /** Press the landing call button of `floor` (1 = L), as E on that landing's call panel does. */
    towerCall: (floor: number) => rt().callFloor(floor),
    /** In the cab: choose a floor on the panel (as the floor list does); 'open' = open doors. False when not in the cab. */
    towerPick: (floor: number | 'open') => rt().panelPick(floor),
    /** Press E on what the crosshair targets (call panel / cab panel), as the game's E does. */
    towerInteract: () => rt().interact(),
    /** QA positioning: stand on `floor`'s landing in front of the elevator doors, facing them (x, z AND y on that storey). */
    towerGoLanding: (floor: number) => {
      const e = elev();
      const st = e?.plan.info.stops.find(s => s.floor === floor);
      if (!e || !st) return false;
      stand(g, st.landing.x, st.landing.z, st.y);
      const G = e.plan.gate, [dx, dz] = gateWorld(G, G.depth, 0);
      face(g, dx, st.y + 1.3, dz);
      g.camera.updateMatrixWorld(true);
      return true;
    },
    /** QA positioning: stand in the cab (at its CURRENT height, wherever it is), facing the floor panel. */
    towerGoCab: () => {
      const e = elev();
      if (!e) return false;
      const cab = e.plan.info.cab, y = e.logic.y;
      const G = e.plan.gate, [bx, bz] = gateWorld(G, -1.0, 0);
      const x = insideRect(cab, bx, bz, 0.35) ? bx : (cab.x0 + cab.x1) / 2, z = insideRect(cab, bx, bz, 0.35) ? bz : (cab.z0 + cab.z1) / 2;
      stand(g, x, z, y);
      const p = e.plan.panelLocal;
      face(g, p.x, p.y + y, p.z);
      g.camera.updateMatrixWorld(true);
      return true;
    },
    /** Spot-check tuning of the exterior's dusk light / haze (uniforms only); returns the current values. */
    towerExteriorTune: (o: ExteriorTune = {}) => {
      const col = (k: 'haze' | 'sun' | 'sky' | 'ground' | 'zenith') => { const v = o[k]; if (v) EXT_U[k].value.setRGB(...v); return (EXT_U[k].value as {toArray(): number[]}).toArray(); };
      if (typeof o.hazeDensity === 'number') EXT_U.hazeDensity.value = o.hazeDensity;
      if (typeof o.skyGain === 'number') EXT_U.skyGain.value = o.skyGain;
      if (o.sunDir) EXT_U.sunDir.value.set(...o.sunDir).normalize();
      return {haze: col('haze'), sun: col('sun'), sky: col('sky'), ground: col('ground'), zenith: col('zenith'), hazeDensity: EXT_U.hazeDensity.value, skyGain: EXT_U.skyGain.value, sunDir: EXT_U.sunDir.value.toArray()};
    },
  };
}
