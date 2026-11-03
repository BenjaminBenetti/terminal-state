// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the TRANSIT TUNNEL — a self-contained, lightweight procedural
// dark tunnel the player's train runs through between two stations while the primary disposes the old world and builds the next one.
//
// Train-local motion: the car stands still at TRANSIT.origin (far from every station world, which all lie within a few hundred metres
// of the origin) with yaw 0, and the tunnel SCROLLS past it — one group whose x offset is the travelled distance modulo TRANSIT.period.
// Everything in the group repeats with that period (sleepers, lamps, the wall / floor / ceiling texture repeats), so the wrap is
// invisible and nothing (the car, the player, the camera) ever jumps in world space: no float drift over a long ride, no teleport.
// A hitch (a 0.3-2 s build frame) just advances the clamped dt the ride integrates.
//
// Existing materials only, no new art: the station tunnels' board-formed shell wall (trackExt/wallFinish.ts), the world 'ceiling' /
// 'ballast' / 'rail' / 'sleeper' materials, the train's own warm 'fixture' emissive for the passing tunnel lamps (no lights: the
// light set never changes; the car's own head / tail / interior lights move with it). Six draws: floor, walls, ceiling, track
// (rails + third rail + cable tray, merged), sleepers (instanced), lamps (instanced). Built once, kept hidden between rides.

import * as THREE from 'three';
import type {WorldMaterials} from './materials';
import {BOARD_SPAN, tunnelShellMaterial} from './trackExt/wallFinish';
import {RAIL_TOP_ABOVE_BED, RAIL_GAUGE_HALF} from '../gen/playerTrain';

export const TRANSIT = {
  /** World position of the riding car's local origin (rail top at the car centre) while in transit. */
  origin: {x: -1600, y: 0, z: -1600},
  /** Repeat period (m) of everything in the tunnel. */
  period: 48,
  /** Drawn half length either side of the car (m); the fog closes the ends. A multiple of the period. */
  half: 96,
  /** Inner wall offset from the track centre (m): a single-track box tunnel. */
  halfWidth: 2.4,
  /** Ceiling above the bed (m). */
  ceil: 4.8,
  /** Lamps: every lampStep m, alternating walls, at lampY above the rail top (window height), size (m). */
  lampStep: 24, lampY: 2.5, lamp: [0.34, 0.12, 0.07] as const,
  sleeperStep: 0.6, sleeper: [0.24, 0.14, 2.5] as const,
  rail: {w: 0.07, h: 0.15}, third: {z: 1.4, y: 0.3, h: 0.12, w: 0.08}, tray: {y: 3.25, w: 0.28, h: 0.06},
} as const;

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
  rail: THREE.Material;
  sleeper: THREE.Material;
  lamp: THREE.Material;
  /** Texture repeat sizes (m per uv unit) of the floor / ceiling maps. */
  floorTile?: {u: number; v: number};
  ceilTile?: {u: number; v: number};
}

/** The transit materials from the world's long-lived cache (+ the train's fixture emissive for the lamps). */
export function transitMaterials(mats: WorldMaterials, lamp: THREE.Material): TransitMaterials {
  const sc = (mats as unknown as {scale?: Record<string, {u: number; v: number}>}).scale ?? {};
  return {wall: tunnelShellMaterial(mats), ceiling: mats.get('ceiling'), floor: mats.get('ballast'), rail: mats.get('rail'), sleeper: mats.get('sleeper'), lamp,
    floorTile: sc.ballast, ceilTile: sc.ceiling};
}

/** A whole number of texture repeats per period: uv = x * k / period (k = round(period / tile)). */
const repeats = (tile: number | undefined, period: number): number => Math.max(1, Math.round(period / Math.max(0.05, tile ?? 2)));

export class TrainTransitTunnel {
  readonly group = new THREE.Group();
  readonly geometries: THREE.BufferGeometry[] = [];
  /** Signed travelled distance along local +X (wrapped into [0, period)). */
  offset = 0;
  /** Draw calls (meshes) and instances (QA / tests). */
  readonly stats = {meshes: 0, instances: 0};
  private built = false;

  constructor(readonly origin: {x: number; y: number; z: number} = TRANSIT.origin) {
    this.group.name = 'train-transit-tunnel';
    this.group.visible = false;
    this.group.position.set(origin.x, origin.y, origin.z);
  }

  get active(): boolean { return this.group.visible; }

  /** Builds the meshes once (idempotent). */
  build(m: TransitMaterials): this {
    if (this.built) return this;
    this.built = true;
    const T = TRANSIT, H = T.half, hw = T.halfWidth, P = T.period;
    const bed = -RAIL_TOP_ABOVE_BED, top = bed + T.ceil;
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
      this.geometries.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.frustumCulled = false; // (always around the camera while shown)
      this.group.add(mesh);
      this.stats.meshes++;
      return mesh;
    };
    // walls (inner faces), u along the tunnel in board spans, v from the bed: P is a whole number of BOARD_SPANs
    const kw = repeats(BOARD_SPAN, P), wall = new Boxes();
    const wu = (x: number) => (x * kw) / P, wv = (y: number) => (y - bed) / BOARD_SPAN;
    wall.quad([-H, bed, -hw], [H, bed, -hw], [H, top, -hw], [-H, top, -hw], [0, 0, 1], [[wu(-H), wv(bed)], [wu(H), wv(bed)], [wu(H), wv(top)], [wu(-H), wv(top)]]);
    wall.quad([H, bed, hw], [-H, bed, hw], [-H, top, hw], [H, top, hw], [0, 0, -1], [[wu(H), wv(bed)], [wu(-H), wv(bed)], [wu(-H), wv(top)], [wu(H), wv(top)]]);
    add(wall.geometry(), m.wall, 'transit-walls');
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
    const mx = new THREE.Matrix4();
    for (let i = 0; i < nS; i++) { mx.makeTranslation(-H + (i + 0.5) * T.sleeperStep, bed + T.sleeper[1] / 2, 0); sleepers.setMatrixAt(i, mx); }
    sleepers.instanceMatrix.needsUpdate = true;
    sleepers.name = 'transit-sleepers';
    sleepers.frustumCulled = false;
    this.group.add(sleepers);
    this.stats.meshes++;
    this.stats.instances += nS;
    // tunnel lamps: alternate walls every lampStep (2 per period)
    const nL = Math.round((2 * H) / T.lampStep), lg = new THREE.BoxGeometry(T.lamp[0], T.lamp[1], T.lamp[2]);
    this.geometries.push(lg);
    const lamps = new THREE.InstancedMesh(lg, m.lamp, nL);
    for (let i = 0; i < nL; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      mx.makeTranslation(-H + (i + 0.5) * T.lampStep, T.lampY, side * (hw - T.lamp[2] / 2));
      lamps.setMatrixAt(i, mx);
    }
    lamps.instanceMatrix.needsUpdate = true;
    lamps.name = 'transit-lamps';
    lamps.frustumCulled = false;
    this.group.add(lamps);
    this.stats.meshes++;
    this.stats.instances += nL;
    this.group.traverse(o => { o.userData.trainTransit = true; });
    return this;
  }

  /** Show the tunnel around the car (the car's world pose = origin + its jostle). */
  enterTransit(): void {
    this.group.visible = true;
    this.place();
  }

  /** Hide the tunnel (the car has left for a station). */
  leaveTransit(): void {
    this.group.visible = false;
  }

  /** The car travelled `ds` m along its local +X (negative: toward -X): the tunnel scrolls the other way, wrapped by the period. */
  advance(ds: number): void {
    if (!Number.isFinite(ds)) return;
    const P = TRANSIT.period;
    this.offset = (((this.offset + ds) % P) + P) % P;
    this.place();
  }

  private place(): void {
    this.group.position.set(this.origin.x - this.offset, this.origin.y, this.origin.z);
    this.group.updateMatrixWorld(true);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.built = false;
  }
}
