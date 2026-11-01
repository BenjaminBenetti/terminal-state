// Task track3-eaton-centre-20261031 (lane ARCH): The Eaton's Center's atmosphere — installed into Game through its registries
// (one anchored line in game.ts, like world/officeAtmosphere.ts):
//  - the mall is ONE daylit open column 35-45 m tall under a glass roof: with the subway's near-black FogExp2 (0.043 /m: ~9 %
//    transmittance at 36 m) the roof and the upper rings would vanish from the platform. While a mall world is built the scene fog
//    is a light dusty haze (MALL_FOG: ~78 % transmittance at 36 m, ~30 % at 100 m, a dim grey-green the far galleries fade into),
//    the glow-card fog follows (syncGlowFog), the camera far plane is raised past the fog's cull distance (the far end of the
//    galleria and the vault stay in view) and the level culler's fog distance matches (no black pop-ins). Teardown restores the
//    indoor values exactly (the Subway / Office keep MOOD).
//  - QA hooks for the primary's short serial browser spot checks (mallArchQaApi): finishes / atrium / skylight / culler stats and
//    three named poses (platform look-up, a gallery void edge, a themed shop interior).
// Uniform / camera values only: no light set, material or pipeline change; no per-frame work.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {CELL} from '../gen/grid';
import {MOOD, syncGlowFog} from './lights';
import {fogCullDistance} from './levelCulling';
import type {MallArch} from './mallArch';
import {skylightStats} from './mallSkylight';
import {mallSkyTune, type MallSkyTune} from './mallExterior'; // task mall-playtest-revision (U02)
import {AD_GLOW} from './mallAds'; // task mall-round3 (lane SHOPS, R5): the ads' backlight gain (QA tune)
import {mallAdArtSummary, preloadMallAdArt, releaseMallAdArt} from '../assets/mallAdArt'; // task mall-round4 (lane ADS): the Codex ad artwork

/** The mall's scene fog (FogExp2) and camera far plane. */
export const MALL_FOG = {density: 0.0115, color: 0x3a403c, far: 250};

/** FogExp2 transmittance at distance d. */
export const fogTransmittance = (d: number, density = MALL_FOG.density): number => Math.exp(-((d * density) ** 2));

interface AtmosphereHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  world?: {culler?: {maxDistance: number}; mallArch?: MallArch} | null;
  /** Game.sectionPreloads (task mall-round4, lane ADS: the ad artwork is decoded behind the mall's loading screen). */
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

export class MallAtmosphere {
  /** Whether the mall values are applied now. */
  active = false;
  private farWas: number | null = null;

  constructor(private readonly host: AtmosphereHost) {
    host.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.restore()});
    // Task mall-round4 (lane ADS): a MALL section decodes its eight Codex ad images before the world (and its ad atlas) is built —
    // MallArch.buildAds releases them once packed; any other level loads none and drops a leftover (assets/mallAdArt.ts)
    host.sectionPreloads?.push(async layout => { if (layout.mall) await preloadMallAdArt(); else releaseMallAdArt(); });
  }

  build(layout: StationLayout): void {
    if (!layout.mall) { this.restore(); return; }
    this.apply(MALL_FOG.density, MALL_FOG.color);
  }

  /** Mall fog / far plane / culler distance (density, colour: tunable from QA). */
  apply(density: number, color: number): void {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      fog.density = density;
      fog.color.setHex(color);
      syncGlowFog(fog);
    }
    const cam = this.host.camera;
    if (this.farWas === null) this.farWas = cam.far;
    cam.far = Math.max(this.farWas, MALL_FOG.far);
    cam.updateProjectionMatrix();
    const culler = this.host.world?.culler;
    if (culler) culler.maxDistance = Math.min(fogCullDistance(density), MALL_FOG.far);
    this.host.world?.mallArch?.setStreetHaze?.(density, color); // task mall-round2 (lane ARCH, M09): the street exits' indoor ray part
    this.active = true;
  }

  /** The indoor values back exactly (MOOD fog, the original far plane). */
  restore(): void {
    if (!this.active) return;
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      fog.density = MOOD.fogDensity;
      fog.color.setHex(MOOD.fogColor);
      syncGlowFog(fog);
    }
    if (this.farWas !== null) { this.host.camera.far = this.farWas; this.host.camera.updateProjectionMatrix(); }
    this.farWas = null;
    this.active = false;
  }
}

let installed: MallAtmosphere | null = null;

/** Installs the mall atmosphere hooks (call once at startup; inert outside the mall). */
export function installMallAtmosphere(host: AtmosphereHost): MallAtmosphere {
  return (installed = new MallAtmosphere(host));
}

/** Even-odd point-in-polygon (x / z). */
function insidePoly(poly: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

export interface QaPose { name: string; x: number; z: number; yaw: number; level: number; look: {x: number; y: number; z: number} }

/** Named QA poses of a mall layout: the platform look-up, a gallery edge of the middle floor, a themed shop interior. */
export function mallQaPoses(layout: StationLayout): QaPose[] {
  const m = layout.mall;
  if (!m) return [];
  const out: QaPose[] = [];
  const vb = m.void.bounds, vc = {x: (vb.x0 + vb.x1) / 2, z: (vb.z0 + vb.z1) / 2};
  const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));
  // 1. platform look-up: the start pose, looking up at the vault over the void centre
  out.push({name: 'platform-lookup', x: m.start.x, z: m.start.z, yaw: yawTo(m.start.x, m.start.z, vc.x, vc.z), level: m.start.level,
    look: {x: vc.x, y: m.roof.springY - 2, z: vc.z}});
  // 2. a gallery edge on the middle retail floor (task mall-playtest-revision: floor 2 of 3; that floor's own opening — the openings
  //    widen upward): the gallery cell beside the opening nearest its centre's long side, facing across
  const rings = m.storeys.filter(s => s.role === 'ring');
  const ring = rings[Math.floor((rings.length - 1) / 2)];
  const levels = (layout as {levels?: {id: number; grid: {w: number; h: number; cells: Uint8Array; area: Int32Array | Int16Array | number[]}}[]}).levels;
  const gal = ring ? m.galleries.find(g => g.level === ring.level) : undefined;
  const grid = ring && levels ? levels.find(l => l.id === ring.level)?.grid : undefined;
  if (ring && gal && grid) {
    const set = new Set(gal.areas);
    const open = m.void.openings?.find(o => o.level === ring.level)?.outline ?? m.void.outline;
    let best: {x: number; z: number; d: number} | null = null;
    for (let i = 0; i < grid.w * grid.h; i++) {
      if (grid.cells[i] !== 1 || !set.has(Number(grid.area[i]))) continue;
      const cx = i % grid.w, cy = (i - cx) / grid.w, x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      // next to the void: a neighbour inside this floor's opening
      const inV = (px: number, pz: number) => insidePoly(open, px, pz);
      if (!inV(x + CELL, z) && !inV(x - CELL, z) && !inV(x, z + CELL) && !inV(x, z - CELL)) continue;
      const d = Math.abs(z - vc.z) < Math.abs(x - vc.x) ? Math.abs(x - vc.x) * 0.2 + Math.abs(z - vc.z) : Math.abs(x - vc.x) + Math.abs(z - vc.z) * 0.2;
      if (!best || d < best.d) best = {x, z, d};
    }
    if (best) {
      const back = 1.2, dx = vc.x - best.x, dz = vc.z - best.z, dl = Math.hypot(dx, dz) || 1;
      const px = best.x - (dx / dl) * back, pz = best.z - (dz / dl) * back;
      out.push({name: 'gallery-void-edge', x: px, z: pz, yaw: yawTo(px, pz, vc.x, vc.z), level: ring.level, look: {x: vc.x, y: ring.baseY - 4, z: vc.z}});
    }
  }
  // 3. a themed shop interior: guns, else pharmacy / electronics / clothing / food court, else the deepest store
  const pick = ['guns', 'pharmacy', 'electronics', 'clothing', 'food-court'];
  const shop = pick.map(p => m.shops.find(s => s.program === p && s.kind !== 'kiosk')).find(Boolean) ?? [...m.shops].sort((a, b) => b.depth - a.depth)[0];
  if (shop) {
    const a = layout.areas[shop.area];
    const st = m.storeys.find(s => s.level === shop.level);
    if (a && st) {
      const f = shop.frontage;
      const fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
      const ax = (a.x + a.w / 2) * CELL, az = (a.y + a.h / 2) * CELL;
      // stand just inside the shopfront looking to the back of the sales floor
      const dx = ax - fx, dz = az - fz, dl = Math.hypot(dx, dz) || 1;
      const px = fx + (dx / dl) * 1.5, pz = fz + (dz / dl) * 1.5;
      out.push({name: `shop-${shop.program}`, x: px, z: pz, yaw: yawTo(px, pz, ax, az), level: shop.level, look: {x: ax + (dx / dl) * 4, y: st.baseY + 1.4, z: az + (dz / dl) * 4}});
    }
  }
  return out;
}

/**
 * QA hooks (spread into window.__LL by qa.ts): mallArch() summary, mallFog({density, color}) tune, mallSkylight(), mallCuller(),
 * mallPoses(), mallPose(name) (teleport + look; returns the pose or null); task mall-playtest-revision: mallSky({zenith, horizon,
 * gas, curtain}) (the exterior murk / gas, U02), mallAds() (the ads drawn, D06).
 */
export function mallArchQaApi(game: {world?: {mallArch?: MallArch; culler?: {atriumStats?: unknown; stats?: unknown; slabCulled?: number; occlusionCulled?: number; occlusion?: boolean; update?(c: THREE.Camera, force?: boolean): void}} | null; layout?: StationLayout; scene?: THREE.Scene; camera?: THREE.Camera},
  lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  return {
    mallArch: () => game.world?.mallArch?.summary() ?? null,
    mallFog: (o: {density?: number; color?: number} = {}) => {
      if (!installed || !game.layout?.mall) return null;
      installed.apply(o.density ?? MALL_FOG.density, o.color ?? MALL_FOG.color);
      const f = game.scene?.fog as THREE.FogExp2 | null | undefined;
      return {density: f?.density ?? null, color: f?.color?.getHex() ?? null, t36: fogTransmittance(36, f?.density), t100: fogTransmittance(100, f?.density)};
    },
    mallSkylight: () => skylightStats(),
    // task mall-playtest-revision (lane ARCH): U02 exterior murk / gas tuning (uniforms only) and the D06 ads drawn
    mallSky: (o: MallSkyTune = {}) => mallSkyTune(o),
    // (task mall-round3, lane SHOPS R5: + {glow} tunes the backlight gain; + per slot / storey, lit faces, atlas pages, the cart headers)
    mallAds: (o: {glow?: number} = {}) => {
      const a = game.world?.mallArch;
      if (!a) return null;
      if (typeof o.glow === 'number' && Number.isFinite(o.glow)) AD_GLOW.value = Math.max(0, o.glow);
      const by: Record<string, number> = {}, slot: Record<string, number> = {}, level: Record<string, number> = {};
      for (const q of a.ads) {
        by[`${q.kind}:${q.program}`] = (by[`${q.kind}:${q.program}`] ?? 0) + 1;
        slot[q.slot ?? q.kind] = (slot[q.slot ?? q.kind] ?? 0) + 1;
        level[`L${q.level}`] = (level[`L${q.level}`] ?? 0) + 1;
      }
      const at = (q: (typeof a.ads)[number]) => ({kind: q.kind, slot: q.slot, program: q.program, level: q.level, x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2), glow: q.glow});
      // (task mall-round4, lane ADS: + art = the Codex images drawn by the last build — loaded ids, ads per image, faces with art / plain
      // fill, released after the atlas — and the loader's state now: held ids (none after a build), last failures, counters)
      return {shop: a.stats.shopAds, gallery: a.stats.galleryAds, lit: a.stats.litAds, pages: a.stats.adPages, meshes: a.stats.adMeshes, textureMB: +a.stats.adTextureMB.toFixed(1), glow: AD_GLOW.value,
        art: {...a.adArt, byTheme: {...a.adArt.byTheme}, loader: mallAdArtSummary()},
        by, slot, level, first: a.ads.slice(0, 6).map(at), carts: a.ads.filter(q => q.kind === 'cart').map(at), menus: a.ads.filter(q => q.kind === 'menu').map(at)};
    },
    mallCuller: () => ({atrium: game.world?.culler?.atriumStats ?? null, stats: game.world?.culler?.stats ?? null, slabCulled: game.world?.culler?.slabCulled ?? null,
      occlusionCulled: game.world?.culler?.occlusionCulled ?? null, occlusion: game.world?.culler?.occlusion ?? null}), // (+ slabCulled: lane PERF; + occlusion: task mall-round2 lane PERF)
    // Task mall-round2-20261031 (lane PERF, M05): same-storey occlusion A/B at one pose (world/levelCulling.ts OCCL_*): on / off, re-culled now
    mallOcclusion: (on?: boolean) => {
      const c = game.world?.culler;
      if (!c || typeof c.occlusion !== 'boolean') return null;
      if (typeof on === 'boolean') { c.occlusion = on; if (game.camera) c.update?.(game.camera, true); }
      return {occlusion: c.occlusion, occlusionCulled: c.occlusionCulled ?? null};
    },
    // Task mall-round2-20261031 (lane ARCH, M09): the locked street exits — per exit cost (meshes = draws, tris), the aperture gate's
    // last count, and the look (uniforms only: light / cards / glass / glow); pose: __LL.goMall('street-exit', i)
    mallExits: (o: {light?: number; cards?: number; glass?: number; glow?: number} = {}) => {
      const a = game.world?.mallArch;
      if (!a) return null;
      return {tune: a.streetExitTune(o), exits: a.stats.exitCost, apertureCulled: (game.world?.culler as {apertureCulled?: number} | undefined)?.apertureCulled ?? null,
        at: a.exits().map(s => ({id: s.id, level: s.level, side: s.nz ? (s.nz > 0 ? 'S' : 'N') : (s.nx > 0 ? 'E' : 'W'), plane: s.plane, s0: s.s0, s1: s.s1, streetY: s.streetY, capY: +s.capY.toFixed(2)}))};
    },
    mallPoses: () => (game.layout ? mallQaPoses(game.layout) : []),
    mallPose: (name: string) => {
      const p = game.layout ? mallQaPoses(game.layout).find(q => q.name === name || q.name.startsWith(name)) : undefined;
      if (!p || !teleport(p.x, p.z, p.yaw, p.level)) return null;
      lookAt(p.look.x, p.look.y, p.look.z);
      return p;
    },
  };
}
