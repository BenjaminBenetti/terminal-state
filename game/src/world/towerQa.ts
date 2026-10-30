// Office tower QA hooks (iteration 16 lane TOWER; task office-seamless lane LIFT; task office-overhaul-20261030 lane LIFT) for
// short, bounded browser spot checks, spread into window.__LL by qa.ts. Nothing here bypasses the gameplay rules: presses go
// through the same logic the physical buttons use, and the cab then really travels while the normal frame loop runs. The "go"
// helpers only PLACE the player (QA positioning, like a teleport — never traversal proof) and aim the view.
//
// Buttons (no floor list exists any more): liftButtons() lists them, liftAim(id) turns the view onto one (it becomes the
// crosshair target if within reach and unobstructed), liftPress(id) aims and then presses it through the REAL input path — a
// mousedown on the game canvas (Input -> Game.update -> pointerHandlers: no shot / flare / bag placement) or, with
// via 'key', an E keydown — and resolves once the frame loop handled it (with the shots fired meanwhile: expected 0).
// Ids: 'car-5', 'car-L', 'car-open', 'car-close', 'car-alarm', 'hall-3-up', 'hall-8-down'; shorthands '5' / 'L' / 'open' /
// 'close' / 'alarm' (the cab panel) and 'up' / 'down' (the call station of the player's storey).

import type {TowerRuntime} from './towerRuntime';
import type {LiftButton} from './elevator';
import {floorLabel, gateWorld, insideRect} from './towerShared';
import {EXT_U} from './exterior';

type Rgb = [number, number, number];
/** Exterior look knobs (uniform values only: no rebuild). Colours are LINEAR rgb. */
export interface ExteriorTune { haze?: Rgb; hazeDensity?: number; sun?: Rgb; sky?: Rgb; ground?: Rgb; zenith?: Rgb; skyGain?: number; sunDir?: [number, number, number] }

interface QaInput { mouse: boolean[]; mousePressed: boolean[]; pressed: Set<string>; keys: Set<string> }
interface QaGame {
  tower: TowerRuntime;
  player: {x: number; z: number; y: number; yaw: number; pitch: number; eye: number; vy: number; grounded: boolean; climb: unknown; vx?: number; vz?: number};
  levels?: {levelAt(x: number, z: number, y: number): number};
  camera: {updateMatrixWorld(force?: boolean): void; position?: {set(x: number, y: number, z: number): unknown}; rotation?: {set(x: number, y: number, z: number, order?: string): unknown; order?: string}};
  /** The game canvas (Input listens for mousedown on it) / the Input itself (node tests without a DOM). */
  canvas?: {dispatchEvent(e: Event): boolean} | null;
  input?: QaInput;
  stats?: {shots: number};
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
function face(g: QaGame, x: number, y: number, z: number, eyeY = g.player.y + 1.62): void {
  const p = g.player;
  const dx = x - p.x, dz = z - p.z, dy = y - eyeY;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function towerQaApi(game: unknown) {
  const g = game as QaGame;
  const rt = () => g.tower;
  const elev = () => rt().office?.elevator ?? null;
  /** A button by id or shorthand (see the header). */
  const resolve = (id: string): LiftButton | null => {
    const e = elev();
    if (!e) return null;
    const exact = e.plan.buttons.find(b => b.id === id);
    if (exact) return exact;
    if (id === 'up' || id === 'down') {
      const P = g.player, stops = e.plan.info.stops;
      let best = -1, bd = Infinity;
      stops.forEach((s, i) => { const d = Math.abs(s.y - P.y); if (d < bd) { bd = d; best = i; } });
      return e.plan.hallButtons[best]?.find(b => b.kind === id) ?? null;
    }
    return e.plan.buttons.find(b => b.id === `car-${id}`) ?? null;
  };
  /** World position of a button's cap centre (cab buttons at the cab's current height). */
  const worldAt = (b: LiftButton) => {
    const e = elev()!;
    return b.where === 'car' ? {x: b.at.x, y: b.at.y + e.logic.y, z: b.at.z} : {...b.at};
  };
  const lit = (b: LiftButton): boolean => {
    const m = elev()?.view.lit.get(b.id);
    return !!m && m.visible;
  };
  const liftState = () => {
    const e = elev();
    if (!e) return {office: !!rt().office, elevator: false};
    const L = e.logic, t = rt().target;
    return {
      elevator: true, floor: floorLabel(L.floor), y: r3(L.y), phase: L.phase, doors: r3(L.door), state: L.state, gateOpen: e.gate.open,
      queue: [...L.requests].map(k => floorLabel(L.stops[k].floor)), lit: e.plan.buttons.filter(lit).map(b => b.id),
      target: t ? t.btn.id : null, reach: t ? r3(t.t) : null, prompt: rt().prompt, inCab: rt().playerInCab(),
      lastPress: rt().lastPress, counts: {...rt().counts},
    };
  };
  /** Turn the view onto a button from where the player stands; the camera follows at once and the tower re-targets. */
  const liftAim = (id: string) => {
    const b = resolve(id);
    if (!b) return {ok: false, id, reason: 'no such button'};
    const p = g.player, at = worldAt(b);
    if (!(Math.abs(p.eye - p.y - 1.3) < 0.7)) p.eye = p.y + 1.62; // a freshly placed player: Player.place leaves the eye relative
    face(g, at.x, at.y, at.z, p.eye);
    // the same pose Game.updateCamera gives the camera (no recoil / sway while QA aims)
    g.camera.position?.set(p.x, p.eye, p.z);
    if (g.camera.rotation) { g.camera.rotation.order = 'YXZ'; g.camera.rotation.set(p.pitch, p.yaw, 0); }
    g.camera.updateMatrixWorld(true);
    const t = rt().refreshTarget();
    return {ok: !!t && t.btn.id === b.id, id: b.id, target: t ? t.btn.id : null, distance: r3(Math.hypot(at.x - p.x, at.y - p.eye, at.z - p.z)), prompt: rt().prompt};
  };
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
        stops: L ? L.stops.map((s, i) => ({floor: s.floor, label: floorLabel(s.floor), y: r3(s.y), landingDoor: r3(L.landingDoor(i)), hall: L.hall.has(i), up: L.hallUp.has(i), down: L.hallDown.has(i), car: L.car.has(i)})) : [],
        landingDoors: L ? Object.fromEntries(L.stops.map((s, i) => [s.floor, r3(L.landingDoor(i))])) : {},
        riders: e ? {...e.carried} : null,
        player: {x: r3(P.x), y: r3(P.y), z: r3(P.z), level: g.levels?.levelAt(P.x, P.z, P.y) ?? -1, inCab: rt().playerInCab()},
        windows: o.windows ? {spans: o.windows.plans.length, storeys: new Set(o.windows.plans.map(p => p.level)).size, panes: o.windows.plans.reduce((n, p) => n + p.panes.length, 0)} : null,
        exterior: ex ? {visible: ex.view.root.visible, tris: ex.view.tris, groundY: ex.plan.groundY, instanced: ex.view.instanced.length, models: ex.view.used} : null,
        target: rt().target?.btn.id ?? null, prompt: rt().prompt, counts: {...rt().counts},
      };
    },
    /** Press the landing call button of `floor` (1 = L; up, or down on the top floor) through the logic, no aim needed. */
    towerCall: (floor: number) => rt().callFloor(floor),
    /** In the cab: press a cab panel button through the logic (a floor, 'open' / 'close' / 'alarm'). False when not in the cab. */
    towerPick: (floor: number | 'open' | 'close' | 'alarm') => rt().panelPick(floor),
    /** Press E on what the crosshair targets (a button), as the game's E does. */
    towerInteract: () => rt().interact(),
    /** Every button: id, where, kind, floor, world position (cab buttons at the cab's current height), lit. */
    liftButtons: () => elev()?.plan.buttons.map(b => ({id: b.id, where: b.where, kind: b.kind, floor: b.floor, ...(() => { const a = worldAt(b); return {x: r3(a.x), y: r3(a.y), z: r3(a.z)}; })(), lit: lit(b)})) ?? [],
    /** Compact elevator state: floor, doors, queue, lit button ids, the crosshair target + prompt, press counters. */
    liftState,
    liftAim,
    /**
     * Aim at a button and press it through the real input path ('click': a mousedown on the game canvas, released after the frame
     * loop handled it; 'key': an E keydown). Resolves with {pressed, shotsFired, state} once handled (or after 1.5 s).
     */
    liftPress: (id: string, via: 'click' | 'key' = 'click') => {
      const aim = liftAim(id);
      const before = rt().counts.presses, shots = g.stats?.shots ?? 0;
      let release = () => {};
      const inp = g.input;
      if (via === 'click') {
        if (g.canvas && typeof MouseEvent === 'function' && typeof window !== 'undefined') {
          g.canvas.dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true, cancelable: true}));
          release = () => { window.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true})); };
        } else if (inp) { inp.mouse[0] = true; inp.mousePressed[0] = true; release = () => { inp.mouse[0] = false; }; }
      } else if (typeof KeyboardEvent === 'function' && typeof window !== 'undefined') {
        window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE', key: 'e', bubbles: true}));
        release = () => { window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyE', key: 'e', bubbles: true})); };
      } else if (inp) { inp.pressed.add('KeyE'); inp.keys.add('KeyE'); release = () => { inp.keys.delete('KeyE'); }; }
      const t0 = Date.now();
      return new Promise<{aim: typeof aim; pressed: boolean; shotsFired: number; state: ReturnType<typeof liftState>}>(done => {
        const poll = () => {
          const pressed = rt().counts.presses !== before;
          if (!pressed && Date.now() - t0 < 1500) { setTimeout(poll, 16); return; }
          release();
          done({aim, pressed, shotsFired: (g.stats?.shots ?? 0) - shots, state: liftState()});
        };
        setTimeout(poll, 16);
      });
    },
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
