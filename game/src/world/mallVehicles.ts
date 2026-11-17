// Task studio-mall-parking-glass-followup-20261117-043548-01: the Mall's exterior VEHICLES, drawn with the game's EXISTING cooked
// destroyed-car models (user: "The car models in the parking lot are not using our 3d car assets ... Use the existing destroyed car
// assets"). The parked / abandoned cars of the parking-lot window walls (world/mallWindows.ts) and the wrecks on the street-exit roads
// (world/mallStreetExit.ts) were the Office's procedural block stand-ins; they are now these models (pure planning here, the instanced
// draw in world/mallStreetExit.ts vehicleMeshes):
//  - MODELS: the Skyways street wrecks (assets/skywaysProps.generated.ts: the stripped / rusted / burnt-out sedans and the SUV) and the
//    Office car / bus wrecks (assets/officeAssets.ts C1 / C5), at the sizes Surface Run's scale check fixed (gen/surface/kinds.ts
//    SURFACE_WRECK_MODEL: the cars as cooked, the bus x 0.78), nose +X, grounded, their own Meshy maps. Fetched behind the loading screen
//    through the lazy prop library (Game.sectionModelKeys: mallVehicleModelKeysFor), never recooked, never a new asset.
//  - CHOICE (per spot, its own seeded stream: the lot / street plans and their streams are untouched): a burnt plan car is the burnt
//    sedan; the rows near the glass mix every car model; the rows deep in the outdoor murk (beyond MALL_VEHICLE.near) take the lighter
//    wrecks (the triangle budget goes where it can be seen). A bus spot is the Office bus.
//  - FIT: every spot is the plan's (position, heading); an askew car whose footprint would touch a car already placed is straightened,
//    and dropped only when even straight it would (the plan's spacing was for the smaller stand-ins: a real car never interpenetrates).
// A spot whose model did not load (Node tests, a 404) takes another loaded model of its class, else it is not drawn (the library's rule:
// never a box stand-in).

import {mulberry32} from '../core/rng';
import {SURFACE_WRECK_MODEL, type SurfaceWreckModel} from '../gen/surface/kinds';

/** A vehicle spot of a view plan (the view's local frame: u along, w outward, y above the street; `yaw` = the plan's heading). */
export interface VehicleSpot { u: number; y: number; w: number; yaw: number; kind: 'car' | 'bus'; burnt?: boolean }

/**
 * A placed model: its library key, its pose in the view frame (`yaw` = the MODEL's turn about +y: its +X nose ends up along
 * (sin yaw, cos yaw) in (u, w)), the drawn scale and footprint (length along the nose x width, m).
 */
export interface VehiclePlace { key: string; u: number; y: number; w: number; yaw: number; k: number; len: number; wid: number; kind: 'car' | 'bus' }

/** Tuning: the near-row depth (m from the glass / facade) where the full model mix ends, and the footprint clearance (m). */
export const MALL_VEHICLE = {near: 30, gap: 0.15} as const;

type Row = SurfaceWreckModel & {near: number; far: number};
const row = (m: SurfaceWreckModel, near: number, far: number): Row => ({...m, near, far});
/** The car models (pick weights near / far) and the bus. */
export const MALL_CAR_MODELS: readonly Row[] = [
  row(SURFACE_WRECK_MODEL.srWreckSedanStripped, 3, 2),
  row(SURFACE_WRECK_MODEL.srWreckSedanRust, 2, 0),
  row(SURFACE_WRECK_MODEL.srWreckSuv, 2, 0),
  row(SURFACE_WRECK_MODEL.srWreckCar, 2, 1),
];
export const MALL_BURNT_MODEL: SurfaceWreckModel = SURFACE_WRECK_MODEL.srWreckSedanBurnt;
export const MALL_BUS_MODEL: SurfaceWreckModel = SURFACE_WRECK_MODEL.srWreckBus;

/** Every model a Mall exterior view may draw (by library key). */
export const MALL_VEHICLE_MODELS: Readonly<Record<string, SurfaceWreckModel>> = Object.fromEntries(
  [...MALL_CAR_MODELS, MALL_BURNT_MODEL, MALL_BUS_MODEL].map(m => [m.key, {key: m.key, url: m.url, bytes: m.bytes, k: m.k, w: m.w, h: m.h, d: m.d, tris: m.tris, source: m.source}]));

/** Game.sectionModelKeys: the vehicle models of a Mall layout with an exterior view (a street exit or a parking-lot window wall). */
export function mallVehicleModelKeysFor(layout: {mall?: {exits?: readonly unknown[]; windows?: readonly unknown[]}}): string[] {
  const m = layout.mall;
  return m && ((m.exits?.length ?? 0) > 0 || (m.windows?.length ?? 0) > 0) ? Object.keys(MALL_VEHICLE_MODELS).sort() : [];
}

/** The model for a spot (deterministic per seed stream): burnt -> the burnt sedan, a bus -> the bus, else the weighted near / far mix. */
function pick(s: VehicleSpot, far: boolean, rnd: () => number): SurfaceWreckModel {
  const x = rnd(); // (always drawn: the stream never depends on the spot's class)
  if (s.kind === 'bus') return MALL_BUS_MODEL;
  if (s.burnt) return MALL_BURNT_MODEL;
  const total = MALL_CAR_MODELS.reduce((t, m) => t + (far ? m.far : m.near), 0);
  let r = x * total;
  for (const m of MALL_CAR_MODELS) { r -= far ? m.far : m.near; if (r <= 0 && (far ? m.far : m.near) > 0) return m; }
  return MALL_CAR_MODELS[0];
}

/** Two footprints (centre, nose direction, half length / width) overlap within `gap` (separating axis test). */
export function footprintsTouch(a: VehiclePlace, b: VehiclePlace, gap: number = MALL_VEHICLE.gap): boolean {
  const ax = [Math.sin(a.yaw), Math.cos(a.yaw)], ay = [ax[1], -ax[0]];
  const bx = [Math.sin(b.yaw), Math.cos(b.yaw)], by = [bx[1], -bx[0]];
  const d = [b.u - a.u, b.w - a.w];
  const ha = [a.len / 2 + gap / 2, a.wid / 2 + gap / 2], hb = [b.len / 2 + gap / 2, b.wid / 2 + gap / 2];
  for (const axis of [ax, ay, bx, by]) {
    const ra = ha[0] * Math.abs(axis[0] * ax[0] + axis[1] * ax[1]) + ha[1] * Math.abs(axis[0] * ay[0] + axis[1] * ay[1]);
    const rb = hb[0] * Math.abs(axis[0] * bx[0] + axis[1] * bx[1]) + hb[1] * Math.abs(axis[0] * by[0] + axis[1] * by[1]);
    if (Math.abs(d[0] * axis[0] + d[1] * axis[1]) > ra + rb) return false;
  }
  return true;
}

/**
 * The models and poses of a view's vehicle spots: a model per spot (`farOf(spot)`: deep in the murk -> the lighter mix), the plan's
 * heading turned to the model frame (the plan headings were for the Z-long stand-ins: model yaw = plan yaw - pi / 2), overlaps resolved
 * (straighten an askew car, else drop it). Spots at different heights (a parking deck's storeys) never meet.
 */
export function placeVehicles(spots: readonly VehicleSpot[], seed: number, farOf: (s: VehicleSpot) => boolean = () => false): VehiclePlace[] {
  const rnd = mulberry32((seed ^ 0x7ec1e5) >>> 0);
  const out: VehiclePlace[] = [];
  for (const s of spots) {
    const m = pick(s, farOf(s), rnd);
    const p: VehiclePlace = {key: m.key, u: s.u, y: s.y, w: s.w, yaw: s.yaw - Math.PI / 2, k: m.k, len: m.w, wid: m.d, kind: s.kind};
    const hits = (q: VehiclePlace) => out.some(o => Math.abs(o.y - q.y) < 1 && footprintsTouch(o, q));
    if (hits(p)) {
      // straighten: the nearest of the spot's two axis headings (along / across the view frame)
      const quarter = Math.round(p.yaw / (Math.PI / 2)) * (Math.PI / 2);
      const q = {...p, yaw: quarter};
      if (hits(q)) continue;
      out.push(q);
      continue;
    }
    out.push(p);
  }
  return out;
}

/** The loaded model a placement draws with: its own, else the first loaded model of its class (car / bus), else null (not drawn). */
export function drawnKey(p: Pick<VehiclePlace, 'key' | 'kind'>, loaded: (key: string) => boolean): string | null {
  if (loaded(p.key)) return p.key;
  const pool = p.kind === 'bus' ? [MALL_BUS_MODEL] : [...MALL_CAR_MODELS, MALL_BURNT_MODEL];
  return pool.find(m => loaded(m.key))?.key ?? null;
}
