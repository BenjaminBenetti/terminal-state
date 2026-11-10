// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the TRANSIT TUNNEL — a self-contained, lightweight procedural
// dark tunnel the player's train runs through between two stations while the primary disposes the old world and builds the next one.
//
// Train-local motion: the car stands still at TRANSIT.origin (far from every station world, which all lie within a few hundred metres
// of the origin) and the tunnel SCROLLS past it — one group whose offset along the car's +X is the travelled distance modulo
// TRANSIT.period. Everything in the group repeats with that period (sleepers, the wall / floor / ceiling texture repeats), so the wrap
// is invisible and nothing (the car, the player, the camera) ever jumps in world space: no float drift over a long ride, no teleport.
// A hitch (a 0.3-2 s build frame) just advances the clamped dt the ride integrates.
//
// Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN):
//  - item 15: VERY DARK. The warm passing lamps are gone; the only light in here is the car's own (head / tail / interior: boot-time
//    lights, intensity only) and the player's flashlight. The fixtures are RED SIGNALS every TRANSIT.signal.step m on the wall opposite
//    the third rail, their lenses facing the oncoming car (the car always runs front first: they come up ahead and pass backwards at
//    the car's speed). Instanced emissive fixtures only (housing, lens, glow card: three draws for all of them) — no lights, no shadow
//    casters, no new fog uniforms (the lens takes the tubes' existing glow fog, the card is the station glow-card material).
//    Signals repeat with their own period (they scroll in a sub-group: travelled mod step), independent of the 48 m pattern.
//  - item 16: the group takes the car's yaw (no 180-degree world-yaw snap at the hand-overs) and can stand in a STATION as a STUB.
//
// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane RIDE): the box IS the RIDE TUNNEL of a station's ride portal
// (world/ridePortal.ts): the same cross-section (RIDE_BOX: ±1.95 m, 4.8 m above the bed), placed as a stub that STARTS exactly at the
// portal plane and runs outward (placeStub: a departure; handBack: an arrival). The hand-overs change nothing around the car:
//  - stub -> transit (handOver): the group re-anchors on the car with the same pattern phase and the same signals (track-fixed
//    identity: the ones the stub hid on the station side of the plane stay hidden);
//  - transit -> stub (handBack): the ride hands back at the moment the car's place in the 48 m pattern is the one the stub gives it
//    (arrivalGap = 0), so the box ends exactly at the plane AND the sleepers / wall boards / signals stay where they are in the car's
//    frame. No geometry is edited and no buffer is written at either hand-over (group transforms, a draw range, signal matrices).
//  A stub's FAR end (192 m beyond the plane) is closed by a wall quad of the wall mesh (draw range: no extra draw): from a station with
//  a thin haze and a long far plane the open gate never shows a hole to the sky / the clear colour. In transit both ends are open
//  (beyond the murk's sight, as before).
//
// Existing materials only, no new art: the station tunnels' board-formed shell wall (trackExt/wallFinish.ts), the world 'ceiling' /
// 'ballast' / 'rail' / 'sleeper' materials; the signal lens is a flat red emissive (code colour, like the light tubes), its glow the
// station glow-card material. Eight draws: floor, walls, ceiling, track (rails + third rail + cable tray, merged), sleepers (instanced),
// signal housings / lenses / glow cards (instanced). Built once, kept hidden between rides.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {WorldMaterials} from './materials';
import {BOARD_SPAN, tunnelShellMaterial} from './trackExt/wallFinish';
import {RAIL_TOP_ABOVE_BED, RAIL_GAUGE_HALF} from '../gen/playerTrain';
import {displayReferred, glowFog, glowMaterial} from './lights';
import {RIDE_BOX, type Box3} from './ridePortal';

export const TRANSIT = {
  /** World position of the riding car's local origin (rail top at the car centre) while in transit. */
  origin: {x: -1600, y: 0, z: -1600},
  /** Repeat period (m) of everything in the tunnel. */
  period: 48,
  /** Drawn half length either side of the car (m); the fog closes the ends. A multiple of the period. */
  half: 96,
  /** Inner wall offset from the track centre (m): the ride box (world/ridePortal.ts RIDE_BOX; was a 2.4 m box before the portals). */
  halfWidth: RIDE_BOX.half,
  /** Ceiling above the bed (m). */
  ceil: RIDE_BOX.ceil,
  sleeperStep: 0.6, sleeper: [0.24, 0.14, 2.5] as const,
  /** Rails, the third rail (the station beds' own offset) and the cable tray: the tray 0.2 m wide in the narrower box (0.2 m off the car's side). */
  rail: {w: 0.07, h: 0.15}, third: {z: 1.4, y: 0.3, h: 0.12, w: 0.08}, tray: {y: 3.25, w: 0.2, h: 0.06},
  /**
   * Item 15: the red signals. `step` m apart (a metro block section; at the 15 m/s cruise one passes every ~7 s), on the `side` wall
   * (-1: local -Z, opposite the third rail), the lens centre `lensY` above the rail top (window / windscreen height). Housing / lens
   * sizes (along x, height y, depth z, m; the housing 0.2 m deep: 0.2 m off the car's side in the ride box); the lens sits `lensUp`
   * above the housing centre on its -X face (toward the oncoming car).
   * `count` instances cover the drawn length; `ahead` = the next signal's distance ahead of the car when the transit starts.
   * Sight: the lens takes the full scene fog (`fog` x density: ~10 % left at 35 m, ~1 % at 48 m in the indoor murk) and the glow card
   * fades out by `glowFar` m (the station glow-card material's far fade): a signal emerges from the dark ~40 m ahead and is gone from
   * sight ~48 m away — the ride's hand-over band (RIDE.signalBand) relies on it.
   * `planeClear`: no signal stands this close to a stub's portal plane (the gate's leaves fold against the walls there).
   */
  signal: {
    step: 110, side: -1, lensY: 2.55, housing: [0.3, 0.62, 0.2] as const, lens: [0.05, 0.17, 0.17] as const, lensUp: 0.14, wallGap: 0.03,
    lensColor: 0xff2a12, glowColor: [2.4, 0.16, 0.06] as const, glowCard: [0.6, 1.2] as const, count: 4, ahead: 60, fog: 1, glowFar: 48,
    planeClear: 4,
  },
} as const;

/** Where a hidden signal instance is parked (far below everything: beyond the far plane, its glow card faded out). */
const PARK_Y = -1e4;

/** Box accumulator (positions / normals / uvs; uvs in metres / tile). */
class Boxes {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uv: number[][]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of uv) this.uv.push(t[0], t[1]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[x1, y0], [x0, y0], [x0, y1], [x1, y1]]);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export interface TransitMaterials {
  wall: THREE.Material;
  ceiling: THREE.Material;
  floor: THREE.Material;
  /** Rails / third rail / tray, and the signal housings (dark steel). */
  rail: THREE.Material;
  sleeper: THREE.Material;
  /** Signal lens / glow card (default: built here — the red emissive with the tubes' glow fog, the station glow-card material). */
  lens?: THREE.Material;
  glow?: THREE.Material;
  /** Texture repeat sizes (m per uv unit) of the floor / ceiling maps. */
  floorTile?: {u: number; v: number};
  ceilTile?: {u: number; v: number};
}

/** The transit materials from the world's long-lived cache (the signal lens / glow are the tunnel's own: see build()). */
export function transitMaterials(mats: WorldMaterials): TransitMaterials {
  const sc = (mats as unknown as {scale?: Record<string, {u: number; v: number}>}).scale ?? {};
  return {wall: tunnelShellMaterial(mats), ceiling: mats.get('ceiling'), floor: mats.get('ballast'), rail: mats.get('rail'), sleeper: mats.get('sleeper'),
    floorTile: sc.ballast, ceilTile: sc.ceiling};
}

/** The red signal lens: a flat emissive like the light tubes (display-referred; the tubes' glow-fog hook at the full scene density). */
export function signalLensMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'transit-signal-lens', color: TRANSIT.signal.lensColor});
  glowFog(m, TRANSIT.signal.fog);
  displayReferred(m);
  return m;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

export type TransitMode = 'hidden' | 'transit' | 'stub';

/** A whole number of texture repeats per period: uv = x * k / period (k = round(period / tile)). */
const repeats = (tile: number | undefined, period: number): number => Math.max(1, Math.round(period / Math.max(0.05, tile ?? 2)));

/** The wall mesh's index layout (see build): the -X end cap, the two walls, the +X end cap. */
const WALL_INDEX = {capBack: 0, walls: 6, capFront: 18, end: 24} as const;

/**
 * The world-axis-aligned volume the tunnel can occupy around the transit origin at ANY yaw (the car turns toward the arrival heading
 * in there): the ride's light mask while in transit (world/rideMask.ts; open face NaN: the whole box is dark).
 */
export function transitMaskBox(origin: {x: number; y: number; z: number} = TRANSIT.origin): Box3 {
  const r = TRANSIT.half + TRANSIT.period + 2, bed = origin.y - RAIL_TOP_ABOVE_BED, k = 0.03;
  return {x0: origin.x - r, x1: origin.x + r, y0: bed - k, y1: bed + TRANSIT.ceil + k, z0: origin.z - r, z1: origin.z + r};
}

export class TrainTransitTunnel {
  readonly group = new THREE.Group();
  /** The signals (housings / lenses / glow cards): scrolled inside the group by the signal phase. */
  readonly signals = new THREE.Group();
  readonly geometries: THREE.BufferGeometry[] = [];
  /** Travelled distance along the group's +X (signed, unbounded; the pattern and the signals are periodic in it). */
  travelled = 0;
  /** travelled mod TRANSIT.period (the pattern's scroll; QA / tests). */
  offset = 0;
  /** Signal phase shift (m): the signals stand at k * step - ((travelled + sig0) mod step) from the anchor along +X. */
  sig0 = 0;
  /** The group's yaw (the car's: local +X = its front) and the anchor (the car's reference point in transit; a stub's base). */
  yaw = 0;
  readonly anchor = new THREE.Vector3();
  mode: TransitMode = 'hidden';
  /** Draw calls (meshes) and instances (QA / tests). */
  readonly stats = {meshes: 0, instances: 0};
  private built = false;
  private walls: THREE.Mesh | null = null;
  private housings: THREE.InstancedMesh | null = null;
  private lenses: THREE.InstancedMesh | null = null;
  private glows: THREE.InstancedMesh | null = null;
  private readonly ownMats: THREE.Material[] = [];
  /** Signal instances shown (stub mode hides those on the station side of the plane / beyond the box). */
  readonly signalShown: boolean[] = Array.from({length: TRANSIT.signal.count}, () => true);
  private readonly mx = new THREE.Matrix4();
  /**
   * Which track-fixed signals show in transit (g = floor((travelled + sig0) / step) + k - 1): g in [gMin, gMax] and not further behind
   * the car than `lo`. gMin: a departure stub's first signal (handOver: the ones behind it stood on the station side of the plane);
   * gMax / lo: the arrival's cut (hideSignalsOutside).
   */
  private readonly vis = {gMin: -Infinity, gMax: Infinity, lo: -Infinity};
  /** A stub: +1 = the group's +X points outward from the portal plane (a departure), -1 = toward it (an arrival). */
  private stubSign: 1 | -1 = 1;

  constructor(readonly origin: {x: number; y: number; z: number} = TRANSIT.origin) {
    this.group.name = 'train-transit-tunnel';
    this.group.visible = false;
    this.signals.name = 'transit-signals';
    this.group.add(this.signals);
    this.anchor.set(origin.x, origin.y, origin.z);
    this.group.position.copy(this.anchor);
  }

  get active(): boolean { return this.group.visible; }

  /** Builds the meshes once (idempotent). */
  build(m: TransitMaterials): this {
    if (this.built) return this;
    this.built = true;
    const T = TRANSIT, H = T.half, hw = T.halfWidth, P = T.period;
    const bed = -RAIL_TOP_ABOVE_BED, top = bed + T.ceil;
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, name: string, parent: THREE.Object3D = this.group): THREE.Mesh => {
      this.geometries.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.frustumCulled = false; // (always around the camera while shown)
      parent.add(mesh);
      this.stats.meshes++;
      return mesh;
    };
    // walls (inner faces), u along the tunnel in board spans, v from the bed: P is a whole number of BOARD_SPANs
    const kw = repeats(BOARD_SPAN, P), wall = new Boxes();
    const wu = (x: number) => (x * kw) / P, wv = (y: number) => (y - bed) / BOARD_SPAN, cu = (z: number) => z / BOARD_SPAN;
    // (task studio-perf-ao-train-continuity-20261110-022206-01, lane RIDE) the end caps are the wall mesh's first / last quad: a stub
    // draws the one at its far end (setEnds: a draw range); in transit neither (WALL_INDEX)
    wall.quad([-H, bed, hw], [-H, bed, -hw], [-H, top, -hw], [-H, top, hw], [1, 0, 0], [[cu(hw), wv(bed)], [cu(-hw), wv(bed)], [cu(-hw), wv(top)], [cu(hw), wv(top)]]);
    wall.quad([-H, bed, -hw], [H, bed, -hw], [H, top, -hw], [-H, top, -hw], [0, 0, 1], [[wu(-H), wv(bed)], [wu(H), wv(bed)], [wu(H), wv(top)], [wu(-H), wv(top)]]);
    wall.quad([H, bed, hw], [-H, bed, hw], [-H, top, hw], [H, top, hw], [0, 0, -1], [[wu(H), wv(bed)], [wu(-H), wv(bed)], [wu(-H), wv(top)], [wu(H), wv(top)]]);
    wall.quad([H, bed, -hw], [H, bed, hw], [H, top, hw], [H, top, -hw], [-1, 0, 0], [[cu(-hw), wv(bed)], [cu(hw), wv(bed)], [cu(hw), wv(top)], [cu(-hw), wv(top)]]);
    this.walls = add(wall.geometry(), m.wall, 'transit-walls');
    // ballast floor and ceiling (world-planar style uvs with a whole number of repeats per period)
    const kf = repeats(m.floorTile?.u, P), kc = repeats(m.ceilTile?.u, P);
    const fz = (z: number) => z / (m.floorTile?.v ?? 2), cz = (z: number) => z / (m.ceilTile?.v ?? 2);
    const floor = new Boxes();
    floor.quad([-H, bed, hw], [H, bed, hw], [H, bed, -hw], [-H, bed, -hw], [0, 1, 0], [[(-H * kf) / P, fz(hw)], [(H * kf) / P, fz(hw)], [(H * kf) / P, fz(-hw)], [(-H * kf) / P, fz(-hw)]]);
    add(floor.geometry(), m.floor, 'transit-floor');
    const ceil = new Boxes();
    ceil.quad([-H, top, -hw], [H, top, -hw], [H, top, hw], [-H, top, hw], [0, -1, 0], [[(-H * kc) / P, cz(-hw)], [(H * kc) / P, cz(-hw)], [(H * kc) / P, cz(hw)], [(-H * kc) / P, cz(hw)]]);
    add(ceil.geometry(), m.ceiling, 'transit-ceiling');
    // track: running rails (top = the rail top, y 0), the third rail, the cable tray on the far wall
    const track = new Boxes(), R = T.rail;
    for (const z of [-RAIL_GAUGE_HALF, RAIL_GAUGE_HALF]) track.box(-H, -R.h, z - R.w / 2, H, 0, z + R.w / 2);
    track.box(-H, bed + T.third.y - T.third.h / 2, T.third.z - T.third.w / 2, H, bed + T.third.y + T.third.h / 2, T.third.z + T.third.w / 2);
    track.box(-H, bed + T.tray.y, hw - T.tray.w - 0.04, H, bed + T.tray.y + T.tray.h, hw - 0.04);
    add(track.geometry(), m.rail, 'transit-track');
    // sleepers (instanced)
    const nS = Math.round((2 * H) / T.sleeperStep), sg = new THREE.BoxGeometry(T.sleeper[0], T.sleeper[1], T.sleeper[2]);
    this.geometries.push(sg);
    const sleepers = new THREE.InstancedMesh(sg, m.sleeper, nS);
    const mx = this.mx;
    for (let i = 0; i < nS; i++) { mx.makeTranslation(-H + (i + 0.5) * T.sleeperStep, bed + T.sleeper[1] / 2, 0); sleepers.setMatrixAt(i, mx); }
    sleepers.instanceMatrix.needsUpdate = true;
    sleepers.name = 'transit-sleepers';
    sleepers.frustumCulled = false;
    this.group.add(sleepers);
    this.stats.meshes++;
    this.stats.instances += nS;
    // item 15: the red signals — housings (dark steel), lenses (red emissive), glow cards (additive; the station glow-card material)
    const S = T.signal, n = S.count;
    const lens = m.lens ?? this.own(signalLensMaterial());
    const glow = m.glow ?? this.own(glowMaterial(S.glowFar));
    const inst = (g: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.InstancedMesh => {
      this.geometries.push(g);
      const im = new THREE.InstancedMesh(g, mat, n);
      im.name = name;
      im.frustumCulled = false;
      im.castShadow = im.receiveShadow = false;
      this.signals.add(im);
      this.stats.meshes++;
      this.stats.instances += n;
      return im;
    };
    this.housings = inst(new THREE.BoxGeometry(S.housing[0], S.housing[1], S.housing[2]), m.rail, 'transit-signal-housings');
    this.lenses = inst(new THREE.BoxGeometry(S.lens[0], S.lens[1], S.lens[2]), lens, 'transit-signal-lenses');
    this.glows = inst(new THREE.PlaneGeometry(S.glowCard[0], S.glowCard[1]), glow, 'transit-signal-glow');
    this.glows.renderOrder = 2;
    const c = new THREE.Color(S.glowColor[0], S.glowColor[1], S.glowColor[2]);
    for (let k = 0; k < n; k++) this.glows.setColorAt(k, c);
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.writeSignals();
    this.setEnds();
    this.group.traverse(o => { o.userData.trainTransit = true; });
    return this;
  }

  private own<M extends THREE.Material>(mat: M): M {
    this.ownMats.push(mat);
    return mat;
  }

  /** Which end caps of the wall mesh are drawn: a stub's far end only (a draw range of the one wall mesh; nothing is uploaded). */
  private setEnds(): void {
    const g = this.walls?.geometry, W = WALL_INDEX;
    if (!g) return;
    if (this.mode !== 'stub') g.setDrawRange(W.walls, W.capFront - W.walls);
    else if (this.stubSign > 0) g.setDrawRange(W.walls, W.end - W.walls);
    else g.setDrawRange(W.capBack, W.capFront - W.capBack);
  }

  /** The far-end cap drawn now: +1 the +X end, -1 the -X end, 0 none (QA / tests). */
  get endCap(): 1 | -1 | 0 {
    const r = this.walls?.geometry.drawRange, W = WALL_INDEX;
    if (!r) return 0;
    return r.start === W.capBack ? -1 : r.start + r.count === W.end ? 1 : 0;
  }

  /** Signal instance k's local position (in the signal sub-group): x along the tunnel, the lens centre height / wall offset. */
  signalLocal(k: number): {x: number; y: number; z: number} {
    const S = TRANSIT.signal;
    return {x: (k - 1) * S.step, y: S.lensY - S.lensUp, z: S.side * (TRANSIT.halfWidth - S.wallGap - S.housing[2] / 2)};
  }

  /** The instance matrices (shown instances at their slots, hidden ones parked far below). */
  private writeSignals(): void {
    const S = TRANSIT.signal, mx = this.mx;
    for (let k = 0; k < S.count; k++) {
      const q = this.signalLocal(k), on = this.signalShown[k], y = on ? q.y : PARK_Y;
      mx.makeTranslation(q.x, y, q.z);
      this.housings?.setMatrixAt(k, mx);
      mx.makeTranslation(q.x - S.housing[0] / 2 - S.lens[0] / 2 + 0.01, y + S.lensUp, q.z);
      this.lenses?.setMatrixAt(k, mx);
      mx.makeTranslation(q.x - S.housing[0] / 2 - 0.12, y + S.lensUp, q.z + S.side * -0.05);
      this.glows?.setMatrixAt(k, mx);
    }
    for (const im of [this.housings, this.lenses, this.glows]) if (im) im.instanceMatrix.needsUpdate = true;
  }

  /** Signal phase: the signals stand at k * step - phase (k = -1 .. count - 2) from the anchor along the group's +X. */
  get signalPhase(): number { return mod(this.travelled + this.sig0, TRANSIT.signal.step); }

  /**
   * Signed positions (m, along the car's +X from the anchor) of the SHOWN signals right now (QA / tests / the ride's hand-over gate).
   * In transit the anchor is the car; in a stub it is the stub's base point.
   */
  signalOffsets(): number[] {
    const S = TRANSIT.signal, out: number[] = [];
    if (!this.built) return out; // (no meshes: nothing to see)
    for (let k = 0; k < S.count; k++) if (this.signalShown[k]) out.push((k - 1) * S.step - this.signalPhase);
    return out;
  }

  /** World x / z of the SHOWN signals (their housings' track positions; QA / tests: the same before and after a hand-over, car frame). */
  signalPoints(): {x: number; z: number}[] {
    const [ax, az] = this.axis();
    return this.signalOffsets().map(s => ({x: this.anchor.x + ax * s, z: this.anchor.z + az * s}));
  }

  /** Shown signals standing within [lo, hi] m of the anchor along +X (in transit: of the car). */
  signalsWithin(lo: number, hi: number): number {
    let n = 0;
    for (const x of this.signalOffsets()) if (x >= lo && x <= hi) n++;
    return n;
  }

  /**
   * The arrival is coming (transit): from now on no new signal comes into sight — every signal beyond `hi` ahead stays hidden, the ones
   * in [lo, hi] pass on and are hidden once they fall behind `lo` (beyond the band the fog hides them anyway: nothing pops). Signals are
   * tracked by their place on the track (g = floor((travelled + sig0) / step) + k - 1), so the instance wrap never shows or drops one.
   * enterTransit / placeStub show all again.
   */
  hideSignalsOutside(lo: number, hi: number): void {
    if (this.mode !== 'transit') return;
    if (this.vis.gMax === Infinity) {
      const S = TRANSIT.signal, ph = this.signalPhase, base = Math.floor((this.travelled + this.sig0) / S.step);
      let gMax = base - 2;
      for (let k = 0; k < S.count; k++) if ((k - 1) * S.step - ph <= hi) gMax = Math.max(gMax, base + k - 1);
      this.vis.gMax = gMax;
      this.vis.lo = lo;
    }
    this.applyVis();
  }

  /** The visibility per instance in transit (track-fixed signal identity). */
  private applyVis(): void {
    const c = this.vis;
    const S = TRANSIT.signal, ph = this.signalPhase, base = Math.floor((this.travelled + this.sig0) / S.step);
    let changed = false;
    for (let k = 0; k < S.count; k++) {
      const g = base + k - 1, want = g >= c.gMin && g <= c.gMax && (k - 1) * S.step - ph >= c.lo;
      if (this.signalShown[k] !== want) { this.signalShown[k] = want; changed = true; }
    }
    if (changed) this.writeSignals();
  }

  /** Put the next signal ahead of the anchor (transit: the car) at `d` m (a hand-over into the transit from a station tunnel). */
  setSignalAhead(d: number): void {
    const S = TRANSIT.signal.step;
    this.sig0 = mod(S - mod(d, S) - this.travelled, S);
    this.place();
  }

  /** Show the tunnel around the car in transit (the car's world pose = origin + its jostle) with the car's yaw. */
  enterTransit(yaw = this.yaw): void {
    this.mode = 'transit';
    this.yaw = yaw;
    this.anchor.set(this.origin.x, this.origin.y, this.origin.z);
    this.vis.gMin = -Infinity; this.vis.gMax = Infinity; this.vis.lo = -Infinity;
    this.group.visible = true;
    this.setEnds();
    this.place();
  }

  /**
   * Stub -> transit without a visible change (a departure): the car at world (x, z) in the stub keeps the same pattern / signals
   * around it when the group re-anchors on it at the transit origin (same yaw: the car runs straight along its track). The signals the
   * stub hid on the station side of the plane stay hidden (they are behind the car for good: it never reverses).
   */
  handOver(carX: number, carZ: number): void {
    const [ax, az] = this.axis(), gx = this.group.position.x, gz = this.group.position.z;
    const xL = (carX - gx) * ax + (carZ - gz) * az; // the car's x in the group
    // the stub's first shown signal by its place on the track (a stub stands still: travelled is its own constant)
    const S = TRANSIT.signal, base = Math.floor((this.travelled + this.sig0) / S.step);
    let gMin = base + S.count - 1;
    if (this.mode === 'stub') { for (let k = S.count - 1; k >= 0; k--) if (this.signalShown[k]) gMin = base + k - 1; } else gMin = -Infinity;
    this.travelled = this.travelled - this.offset + xL;
    this.enterTransit(this.yaw);
    this.vis.gMin = gMin;
    this.applyVis();
  }

  /**
   * A STUB in a station: the ride tunnel of a portal, from its plane `plane` (world: the track centre in the portal plane at rail-top
   * height) outward along the unit `out` (x, z), with the group's +X = the car's front (`yaw`), the pattern at travelled 0. The box
   * starts exactly at the plane (nothing pokes through it toward the station); its far end is capped.
   * `firstSignal` = the first shown signal's distance beyond the plane (null: none); signals on the station side of the plane, closer
   * than TRANSIT.signal.planeClear to it or beyond the box are hidden.
   */
  placeStub(plane: {x: number; y: number; z: number}, out: {x: number; z: number}, yaw: number, firstSignal: number | null): void {
    const H = TRANSIT.half, S = TRANSIT.signal;
    this.mode = 'stub';
    this.yaw = yaw;
    this.travelled = 0;
    this.vis.gMin = -Infinity; this.vis.gMax = Infinity; this.vis.lo = -Infinity;
    this.anchor.set(plane.x + out.x * H, plane.y, plane.z + out.z * H);
    const [ax, az] = this.axis(), sigma = ax * out.x + az * out.z >= 0 ? 1 : -1;
    this.stubSign = sigma;
    if (firstSignal === null) this.signalShown.fill(false);
    else {
      // signal k at out-distance s_k = H + sigma * ((k - 1) * step - phase): pick the phase for s = firstSignal at the nearest slot
      const want = sigma > 0 ? mod(H - firstSignal, S.step) : mod(firstSignal - H, S.step);
      this.sig0 = want;
      for (let k = 0; k < S.count; k++) {
        const s = H + sigma * ((k - 1) * S.step - want);
        this.signalShown[k] = s >= firstSignal - 0.5 && s >= S.planeClear && s <= 2 * H - 1;
      }
    }
    this.writeSignals();
    this.group.visible = true;
    this.setEnds();
    this.place();
  }

  /**
   * How far (m, 0 .. period) the car still has to run in TRANSIT until its place in the pattern is the one an arrival stub gives a car
   * `dist` m before the stub's portal plane (handBack): there the group's +X end lies exactly in the plane.
   */
  arrivalGap(dist: number): number {
    return mod(TRANSIT.half - dist - this.travelled, TRANSIT.period);
  }

  /**
   * Transit -> stub without a visible change (an arrival; the ride calls it when arrivalGap(dist) is 0): the tunnel becomes the stub of
   * the portal plane `plane` (outward along `out`), the car `dist` m beyond the plane heading toward it (`yaw`: the group's +X). The
   * pattern keeps its phase around the car and every signal shown within the box keeps its place; none is added.
   */
  handBack(plane: {x: number; y: number; z: number}, out: {x: number; z: number}, yaw: number, dist: number): void {
    const H = TRANSIT.half, S = TRANSIT.signal;
    // the shown signals relative to the car (in transit the anchor is the car)
    const shown = this.mode === 'transit' ? this.signalOffsets() : [];
    this.placeStub(plane, out, yaw, null);
    if (!shown.length) return;
    // the car stands at xc from the stub's anchor along +X (+X = toward the plane); slot k at (k - 1) * step - sig0
    const sigma = this.stubSign, xc = sigma * (dist - H);
    this.sig0 = mod(-(xc + shown[0]), S.step);
    for (let k = 0; k < S.count; k++) {
      const x = (k - 1) * S.step - this.sig0, s = H + sigma * x;
      this.signalShown[k] = shown.some(r => Math.abs(xc + r - x) < 1e-6) && s >= S.planeClear && s <= 2 * H - 1;
    }
    this.writeSignals();
    this.place();
  }

  /** Hide the tunnel (the car is in a station again / at rest). */
  leaveTransit(): void {
    this.group.visible = false;
    this.mode = 'hidden';
  }

  /** The car travelled `ds` m along its local +X (negative: toward -X): the tunnel scrolls the other way. */
  advance(ds: number): void {
    if (!Number.isFinite(ds)) return;
    this.travelled += ds;
    this.place();
  }

  /** The car's yaw changed in transit (a bounded turn toward the arrival heading: the whole view turns with the car). */
  setYaw(yaw: number): void {
    if (this.yaw === yaw) return;
    this.yaw = yaw;
    this.place();
  }

  /** Unit +X of the group in world (three.js R_y maps +X to (cos, -sin)). */
  axis(): [number, number] {
    return [Math.cos(this.yaw), -Math.sin(this.yaw)];
  }

  /** Where world point (x, z) lies in the 48 m pattern (0 .. period: sleepers, wall boards, floor / ceiling repeats; QA / tests). */
  patternAt(x: number, z: number): number {
    const [ax, az] = this.axis(), g = this.group.position;
    return mod((x - g.x) * ax + (z - g.z) * az, TRANSIT.period);
  }

  /** The drawn box's reach from world point (x, z) along the group's +X: metres of tunnel ahead of / behind it (QA / tests). */
  reach(x: number, z: number): {ahead: number; behind: number} {
    const [ax, az] = this.axis(), g = this.group.position, xl = (x - g.x) * ax + (z - g.z) * az;
    return {ahead: TRANSIT.half - xl, behind: xl + TRANSIT.half};
  }

  private place(): void {
    const P = TRANSIT.period;
    this.offset = mod(this.travelled, P);
    const [ax, az] = this.axis();
    this.group.position.set(this.anchor.x - ax * this.offset, this.anchor.y, this.anchor.z - az * this.offset);
    this.group.rotation.set(0, this.yaw, 0);
    this.signals.position.set(this.offset - this.signalPhase, 0, 0);
    if (this.mode === 'transit') this.applyVis();
    this.group.updateMatrixWorld(true);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const mt of this.ownMats) mt.dispose();
    this.geometries.length = 0;
    this.ownMats.length = 0;
    this.built = false;
    this.walls = null;
  }
}
