// TEMPORARY (sub-lane SHOPS-ADS, R5): ad census on generated malls — writes JSON; delete before finishing.
import {mkdirSync, writeFileSync} from 'node:fs';
import {it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import type {StationLayout} from '../src/gen/station';
import {shopFit} from '../src/gen/mall/shops';
import * as THREE from 'three';

installCanvasShim(false);
const OUT = process.env.LL_ADS_OUT ?? '/tmp/ads-census.json';
const SEEDS = [0x7ea3c1, 4242, 11, 222];

it('ad census', async () => {
  const {generateMallLevel} = await import('../src/gen/mall/index');
  const res: Record<string, unknown> = {};
  for (const seed of SEEDS) {
    const layout = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'} as never) as StationLayout;
    const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const arch = w.mallArch!;
    const m = layout.mall!;
    const baseOf = (lv: number) => m.storeys.find(s => s.level === lv)?.baseY ?? 0;
    const ads = arch.ads;
    const tally = (f: (a: (typeof ads)[number]) => string) => { const o: Record<string, number> = {}; for (const a of ads) { const k = f(a); o[k] = (o[k] ?? 0) + 1; } return o; };
    const fits = m.shops.map(s => ({s, f: shopFit(s)}));
    const kinds: Record<string, number> = {};
    for (const {f} of fits) if (f) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
    const shopsWithAd = new Set(ads.filter(a => a.shop).map(a => a.shop));
    const realStores = fits.filter(({f}) => f && (f.kind === 'store' || f.kind === 'anchor' || f.kind === 'food'));
    const meshes: THREE.Mesh[] = [];
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh && /^mall-ad-/.test(o.name)) meshes.push(o as THREE.Mesh); });
    const centre = ads.map(a => +(a.y - baseOf(a.level)).toFixed(2));
    const eyeLevel = ads.filter(a => a.kind !== 'decal' && a.kind !== 'cart' && a.y - baseOf(a.level) >= 1.2 && a.y - baseOf(a.level) <= 2.0).length;
    res[`0x${seed.toString(16)}`] = {
      seed,
      total: ads.length, shopAds: arch.stats.shopAds, galleryAds: arch.stats.galleryAds,
      byKind: tally(a => a.kind), byLevel: tally(a => String(a.level)), byProgram: tally(a => a.program),
      byKindLevel: tally(a => `${a.kind}@L${a.level}`),
      bySlot: tally(a => (a as {slot?: string}).slot ?? '-'),
      glow: {lit: ads.filter(a => ((a as {glow?: number}).glow ?? -1) > 0.6).length, dim: ads.filter(a => { const g = (a as {glow?: number}).glow ?? -1; return g > 0 && g <= 0.6; }).length, dead: ads.filter(a => (a as {glow?: number}).glow === 0).length},
      stats: {litAds: (arch.stats as unknown as Record<string, number>).litAds, adPages: (arch.stats as unknown as Record<string, number>).adPages, adTextureMB: +((arch.stats as unknown as Record<string, number>).adTextureMB ?? 0).toFixed(1), atriumMeshes: arch.stats.meshes, atriumTris: Math.round(arch.stats.triangles)},
      wallAdsCentre1p2to2p0m: eyeLevel,
      centreHeightAboveFloor: {min: Math.min(...centre), max: Math.max(...centre), byKind: Object.fromEntries(['poster', 'lightbox', 'decal', 'billboard', 'menu', 'cart'].map(k => { const v = ads.filter(a => a.kind === k).map(a => a.y - baseOf(a.level)); return [k, v.length ? {min: +Math.min(...v).toFixed(2), max: +Math.max(...v).toFixed(2), mean: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2)} : null]; }))},
      faceArea_m2: {total: +ads.reduce((s, a) => s + a.w * a.h, 0).toFixed(1), byKind: Object.fromEntries(['poster', 'lightbox', 'decal', 'billboard', 'menu', 'cart'].map(k => [k, +ads.filter(a => a.kind === k).reduce((s, a) => s + a.w * a.h, 0).toFixed(1)]))},
      faceSizes: ads.map(a => `${a.kind} ${a.w.toFixed(2)}x${a.h.toFixed(2)} @${(a.y - baseOf(a.level)).toFixed(2)} L${a.level} ${a.program}`),
      unitKinds: kinds,
      kioskUnits: kinds.kiosk ?? 0,
      kioskCarts: layout.props.filter(p => p.kind === 'mallKioskCart').length,
      adsOnKiosks: ads.filter(a => { const s = m.shops.find(q => q.id === a.shop); return s && shopFit(s)?.kind === 'kiosk'; }).length,
      foodUnits: fits.filter(({f}) => f?.kind === 'food').map(({s, f}) => `${s.id} ${f!.program}`),
      realStores: realStores.length, realStoresWithAd: realStores.filter(({s}) => shopsWithAd.has(s.id)).length,
      publicFacing: {decalsOnGlass: ads.filter(a => a.kind === 'decal').length, galleryBillboards: ads.filter(a => !a.shop).length},
      adWalls: (arch as unknown as {adWalls: unknown[]}).adWalls.length,
      render: {meshes: meshes.map(q => `${q.name} ${(q as THREE.InstancedMesh).isInstancedMesh ? `inst x${(q as THREE.InstancedMesh).count}` : `tris ${(q.geometry.index?.count ?? q.geometry.attributes.position.count) / 3}`} mat ${(q.material as THREE.Material).name} emissive ${(q.material as unknown as {emissiveNode?: unknown; emissive?: THREE.Color}).emissiveNode ? 'node' : ((q.material as unknown as {emissive?: THREE.Color}).emissive?.getHex() ?? 'none')}`)},
    };
  }
  mkdirSync(OUT.replace(/\/[^/]+$/, ''), {recursive: true});
  writeFileSync(OUT, JSON.stringify(res, null, 1));
}, 600000);
