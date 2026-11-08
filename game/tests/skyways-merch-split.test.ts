// Task studio-skywalk-variety-20261107-231448-01 (lane MERCH follow-up; user: "cover other affected Skyways counter / shelf items
// consistently, not only one pair of skates"). Skyways layout VERSION 4 splits the merchandise still drawn as part of a shop fixture into
// separate, ordinary movable stock (gen/skyways/skywaysMerchSplit.ts, kinds gen/skyways/stores/kinds/merch.ts, drawing world/skywaysMerch.ts):
//  - the demo table (techDisplay): the bare table + its six demo devices, exactly the table's own device parts;
//  - the device wall (deviceWall, tech-display-t25.glb): the model's own triangles cut exactly into the bare unit + four display devices
//    (checked against the real GLB: nothing lost, nothing left in the cut region, every device where WALL_DEVICES says);
//  - the faced-out LP row: its five sleeves on the cover wall's declared ledges.
// The magazine rack / flower stand need nothing (their stock is already separate physical filler: checked here too).
// On real version-4 seeds (found, not hard-coded): every such fixture split, every piece hosted on a known support, none overlapping,
// modest counts, deterministic; version 3 (layoutVersion: 3) unchanged. Real path: the drawn world (devices found by the damage index), a
// buckshot volley through Game.fire's ray / DamageSystem / physics knocks a demo device off its table and a wall device off its deck.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import * as fs from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {PROP_DEFS} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {purposePropShape} from '../src/gen/purposeShapes';
import {DEMO_TABLE, FACED_LP, MERCH_BARE_VARIANT, STORE_MERCH_KINDS, WALL_DEVICES, WALL_DEVICE_CUT, demoDeviceParts} from '../src/gen/skyways/stores/kinds/merch';
import {facedRow} from '../src/gen/skyways/stores/musicStock';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {propPhysics} from '../src/damage/materials';
import {displayTreatment, AUTHORED_CARCASS, stockColliders, stockBoards} from '../src/world/shelfStockCarcass';
import {isStockedKind} from '../src/world/shelfStockCatalog';
import {bareTechTableParts, splitDeviceWall} from '../src/world/skywaysMerch';
import {fittedMeshes} from '../src/world/meshSplit';
import {dynamicKind, hostRest, restsOnHost} from '../src/physics/merchOnHost';
import {raycastShot} from '../src/physics/merchOnHost';
import {DamageSystem} from '../src/damage/system';
import {loadStripped} from './helpers/openablesFixture';
import {contactRig, DT, type ContactRig} from './helpers/contactWalk';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const gen = (seed: number, layoutVersion: number) => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never) as StationLayout;
const SPLIT = new Set<string>(STORE_MERCH_KINDS);
const MAX_SEED = 24;

interface Found { seed: number; layout: StationLayout; tables: number; walls: number; lps: number }
let v4: Found[] = [];
let model: GLTF;
beforeAll(async () => {
  model = await loadStripped('assets/models/tech-display-t25.glb');
  for (let seed = 1; seed <= MAX_SEED && (v4.length < 6 || !v4.some(f => f.tables) || !v4.some(f => f.lps)); seed++) {
    const l = gen(seed, 4);
    const n = (k: string) => l.props.filter(p => p.kind === k).length;
    const f = {seed, layout: l, tables: n('techDisplay'), walls: n('deviceWall'), lps: n('skyMerchFacedLp')};
    if (f.tables || f.walls || f.lps) v4.push(f);
  }
  v4 = v4.slice(0, 8);
}, 900_000);

describe('the split kinds', () => {
  it('both audits classify every split kind: dynamic on-host stock, nothing to open; plausible masses', () => {
    const open = new Map(OPENABLE_AUDIT.map(r => [r.kind, r]));
    for (const k of STORE_MERCH_KINDS) {
      expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({cls: 'dynamic', onHost: true, contact: true});
      expect(dynamicKind(k), k).toBe(true);
      const m = propPhysics(k).mass;
      expect(m > 0.1 && m < 1.5, `${k} ${m} kg`).toBe(true);
      expect(open.get(k)?.cls, k).toBe('none');
      expect(open.get(k)!.how.length, k).toBeGreaterThan(10);
    }
    // the fixtures' rows are honest about what is stock: the row kind is static, the magazine rack / flower stand stock is filler
    expect(PROP_PHYSICS_AUDIT.skyMuFacedRecords).toMatchObject({cls: 'static', why: 'host decor'});
    for (const k of ['magazineRack', 'flowerStand', 'techDisplay', 'deviceWall']) expect(PROP_PHYSICS_AUDIT[k]?.how, k).not.toMatch(/drawn as part of the (rack|stand)/);
  });

  it('the magazine rack and the flower stand were never baked: they draw bare and their stock is separate physical filler on real boards', () => {
    expect(AUTHORED_CARCASS.has('magazineRack')).toBe(true); // the model with baked covers is never drawn
    const mag = displayTreatment('magazineRack', 0, purposePropShape('magazineRack', 0) ?? [], {model: false});
    const flo = displayTreatment('flowerStand', 0, purposePropShape('flowerStand', 0) ?? [], {model: false});
    expect(mag.some(p => p.m === 'magazines')).toBe(false);
    expect(flo.some(p => p.m === 'flowers' || p.m === 'steelBright')).toBe(false);
    for (const k of ['magazineRack', 'flowerStand', 'deviceWall']) { expect(isStockedKind(k), k).toBe(true); expect(stockBoards(k, 0).length, k).toBeGreaterThan(0); }
  });

  it('the demo devices are exactly the table\'s own device parts; the bare table keeps the rest (no device left on it)', () => {
    const full = purposePropShape('techDisplay', 0)!, bare = bareTechTableParts(full);
    const key = (m: string, s: readonly number[], p: readonly number[]) => `${m}|${s.map(v => v.toFixed(3)).join(',')}|${p.map(v => v.toFixed(3)).join(',')}`;
    const removed = full.filter(p => !bare.includes(p)).map(p => key(p.m, p.s, p.p)).sort();
    expect(bare.some(p => p.m === 'deviceScreen')).toBe(false);
    expect(bare.every(p => p.p[1] + p.s[1] / 2 <= DEMO_TABLE.top + 0.006)).toBe(true);
    // the six devices' parts, moved from their prop frame into the table frame (row 1 turned half a turn)
    const moved: string[] = [];
    for (const d of DEMO_TABLE.devices) for (const q of demoDeviceParts(d.phone)) {
      const f = d.turn ? -1 : 1;
      moved.push(key(q.m, q.s, [d.x + f * q.p[0], DEMO_TABLE.top + q.p[1], d.z + f * q.p[2]]));
    }
    expect(moved.sort()).toEqual(removed);
  });

  it('the device wall model is cut exactly: the bare unit + four devices where WALL_DEVICES says, nothing lost, nothing left in the cut', () => {
    const {w, h, d} = PROP_DEFS.deviceWall;
    const src = fittedMeshes(model, w, h, d).reduce((n, m) => n + m.soup.data.length / m.soup.stride / 3, 0);
    const s = splitDeviceWall(model);
    let body = 0;
    const bodyBox = new THREE.Box3();
    s.body.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      body += pos.count / 3;
      bodyBox.expandByObject(m);
      // no body triangle has its centroid inside the device region
      const C = WALL_DEVICE_CUT;
      for (let t = 0; t < pos.count; t += 3) {
        const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3, cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        expect(cy > C.y0 + 1e-4 && cy < C.y1 - 1e-4 && cz > C.z0 + 1e-4 && cz < C.z1 - 1e-4).toBe(false);
      }
    });
    // the bare unit keeps the model's full extents (instancing it re-fits it at scale 1, exactly over the whole model's place)
    const size = bodyBox.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(w, 2); expect(size.y).toBeCloseTo(h, 2); expect(size.z).toBeCloseTo(d, 2);
    let dev = 0;
    WALL_DEVICES.forEach((dv, k) => {
      const parts = s.devices.get(k + 1)!;
      expect(parts?.length, `device ${k}`).toBeGreaterThan(0);
      const box = new THREE.Box3();
      for (const q of parts) { q.geo.computeBoundingBox(); box.union(q.geo.boundingBox!); dev += q.geo.attributes.position.count / 3; expect(q.mat).toBeTruthy(); }
      // geometry relative to the device's bottom centre: its measured box (1 cm)
      expect(box.min.x).toBeCloseTo(-(dv.x1 - dv.x0) / 2, 1); expect(box.max.x).toBeCloseTo((dv.x1 - dv.x0) / 2, 1);
      expect(box.min.y).toBeCloseTo(0, 2); expect(box.max.y).toBeCloseTo(dv.y1 - WALL_DEVICE_CUT.y0, 1);
      expect(box.min.z).toBeCloseTo(-(dv.z1 - dv.z0) / 2, 1); expect(box.max.z).toBeCloseTo((dv.z1 - dv.z0) / 2, 1);
      expect(Math.abs(box.max.x - box.min.x - (dv.x1 - dv.x0))).toBeLessThan(0.01);
    });
    // nothing lost (the exact cuts only ADD triangles where they split one)
    expect(body + dev).toBeGreaterThanOrEqual(src);
    expect(dev).toBeGreaterThan(1500);
  });

  it('a bare device wall\'s filler colliders leave the deck front free for its devices; a whole one keeps the old phones box', () => {
    const b = stockBoards('deviceWall', 0);
    const whole = stockColliders('deviceWall', 0, b), bare = stockColliders('deviceWall', MERCH_BARE_VARIANT, b);
    expect(whole.length - bare.length).toBe(1);
    for (const c of bare) for (const dv of WALL_DEVICES) {
      const overlap = c.min[0] < dv.x1 && c.max[0] > dv.x0 && c.min[1] < dv.y1 && c.max[1] > WALL_DEVICE_CUT.y0 + 0.002 && c.min[2] < dv.z1 && c.max[2] > dv.z0;
      expect(overlap, `collider ${c.min} .. ${c.max} vs device ${dv.kind} ${dv.variant}`).toBe(false);
    }
  });
});

describe('generation: layout version 4 splits, version 3 does not', () => {
  it('on real version-4 seeds every demo table / device wall / faced row is split, each piece on a known support, none overlapping', () => {
    expect(v4.some(f => f.tables > 0), 'a seed with a demo table').toBe(true);
    expect(v4.some(f => f.walls > 0), 'a seed with a device wall').toBe(true);
    expect(v4.some(f => f.lps > 0), 'a seed with faced LPs').toBe(true);
    for (const {seed, layout: l} of v4) {
      const why = `v4 seed ${seed}`;
      expect(l.props.some(p => p.kind === 'skyMuFacedRecords'), `${why}: no faced row left whole`).toBe(false);
      const pieces = l.props.filter(p => SPLIT.has(p.kind));
      expect(pieces.length, `${why}: modest stock count`).toBeLessThanOrEqual(200);
      l.props.forEach((p, i) => {
        if (p.kind === 'techDisplay' || p.kind === 'deviceWall') {
          expect(p.variant, `${why} #${i} ${p.kind} bare`).toBe(MERCH_BARE_VARIANT);
          const mine = l.props.filter(q => q.host === i && SPLIT.has(q.kind));
          expect(mine.length, `${why} #${i} ${p.kind} devices`).toBe(p.kind === 'techDisplay' ? DEMO_TABLE.devices.length : WALL_DEVICES.length);
          if (p.kind === 'techDisplay') expect(p.h).toBeCloseTo(DEMO_TABLE.top, 3);
        }
        if (p.kind === 'skyMuCoverWall') {
          const lps = l.props.filter(q => q.host === i && q.kind === 'skyMerchFacedLp');
          expect(lps.length % 5, `${why} cover wall #${i}: whole rows of five`).toBe(0);
        }
      });
      for (const p of pieces) {
        const q = l.props[p.host!], tag = `${why} ${p.kind} on ${q?.kind}`;
        expect(['techDisplay', 'deviceWall', 'skyMuCoverWall'], tag).toContain(q.kind);
        const r = restsOnHost(p, l.props);
        expect(r, tag).toBe(q.kind === 'techDisplay' ? 'top' : 'shelf');
        expect(hostRest(p, q), tag).toBe(r);
        // never overlapping another piece (standing props: boxes)
        for (const o of pieces) {
          if (o === p || (o.level ?? 0) !== (p.level ?? 0)) continue;
          const ov = Math.min(p.x + p.hx, o.x + o.hx) - Math.max(p.x - p.hx, o.x - o.hx), oz = Math.min(p.z + p.hz, o.z + o.hz) - Math.max(p.z - p.hz, o.z - o.hz);
          const oy = Math.min(p.y + p.h, o.y + o.h) - Math.max(p.y, o.y);
          expect(ov > 0.004 && oz > 0.004 && oy > 0.004, `${tag} overlaps ${o.kind}: ${JSON.stringify(p)} vs ${JSON.stringify(o)}`).toBe(false);
        }
      }
      fs.appendFileSync('/tmp/merch-split-counts.txt', `v4 seed ${seed}: ${l.props.filter(p => p.kind === 'techDisplay').length} demo tables, ${l.props.filter(p => p.kind === 'deviceWall').length} device walls, ${l.props.filter(p => p.kind === 'skyMerchFacedLp').length / 5} faced rows -> ${pieces.length} stock props (${STORE_MERCH_KINDS.map(k => `${k} ${pieces.filter(p => p.kind === k).length}`).join(', ')})\n`);
      // the LPs of a row are that row's five sleeves with its covers
      const lps = l.props.filter(p => p.kind === 'skyMerchFacedLp');
      for (const p of lps) expect(p.y - l.props[p.host!].y, `${why} LP on a ledge`).toBeGreaterThan(0);
    }
  });

  it('deterministic: the same seed generates the same split', () => {
    const f = v4[0];
    const a = gen(f.seed, 4).props.filter(p => SPLIT.has(p.kind)).map(p => `${p.kind}:${p.x},${p.y},${p.z},${p.rot},${p.variant},${p.host}`);
    const b = f.layout.props.filter(p => SPLIT.has(p.kind)).map(p => `${p.kind}:${p.x},${p.y},${p.z},${p.rot},${p.variant},${p.host}`);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('version 3 keeps every fixture whole (no split kinds, the rows and devices drawn as before)', () => {
    let tables = 0, walls = 0, rows = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const l = gen(seed, 3);
      expect(l.props.some(p => SPLIT.has(p.kind)), `v3 seed ${seed}`).toBe(false);
      for (const p of l.props) {
        if (p.kind === 'techDisplay' || p.kind === 'deviceWall') { expect(p.variant).toBe(0); if (p.kind === 'techDisplay') { tables++; expect(p.h).toBeCloseTo(PROP_DEFS.techDisplay.h, 3); } else walls++; }
        if (p.kind === 'skyMuFacedRecords') rows++;
      }
    }
    expect(tables + walls + rows).toBeGreaterThan(0);
    // the faced rows' five sleeves: the split's sleeves stand where the row drew them (row frame x)
    expect(facedRow(0).length).toBe(5);
    expect(FACED_LP.w).toBeGreaterThan(0.3);
  });
});

describe('the real path: drawn, found, shot off', () => {
  it('a version-4 shop: the bare fixtures and their pieces are drawn and indexed; a volley knocks a demo device off its table and a wall device off its deck', () => {
    const f = v4.find(x => x.tables > 0 && x.walls > 0) ?? v4.find(x => x.walls > 0)!;
    const layout = gen(f.seed, 4);
    const rig = contactRig(layout, {containers: 'skyways'});
    // the device wall's own model (core library) for the cut: rebuild the world with it so the bare unit and its devices draw from it
    const sys = realSys(rig, layout);
    const pd = (sys as unknown as {props: ContactRig['pd']}).props;
    const shotKinds = new Set<string>();
    for (const kind of ['skyMerchDemoPhone', 'skyMerchDemoTablet', 'skyMerchWallPhone', 'skyMerchWallTablet'] as const) {
      const i = layout.props.findIndex(p => p.kind === kind && p.h > 0.02);
      if (i < 0) continue;
      const p = layout.props[i];
      expect((pd.index.inst.get(p) ?? []).length, `${kind}: drawn and indexed`).toBeGreaterThan(0);
      const res = volleyAt(rig, sys, i);
      if (!res) continue;
      expect(p.h, `${kind}: loose`).toBe(0);
      expect(res.moved, `${kind}: knocked`).toBeGreaterThan(0.03);
      shotKinds.add(kind);
    }
    expect(shotKinds.size, [...shotKinds].join(', ')).toBeGreaterThanOrEqual(2);
    expect([...shotKinds].some(k => k.startsWith('skyMerchWall')), 'a wall device').toBe(true);
  }, 600_000);

  it('with the real model loaded the bare device wall draws the cut body and its devices draw their own triangles (no whole model)', async () => {
    const f = v4.find(x => x.walls > 0)!;
    const layout = gen(f.seed, 4);
    const {buildWorld} = await import('../src/world/builder');
    const {WorldMaterials} = await import('../src/world/materials');
    const {fakeEnvTextures} = await import('./helpers/openablesFixture');
    const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {techDisplay: model});
    const s = splitDeviceWall(model);
    const geos = new Map<string, Set<THREE.BufferGeometry>>();
    w.group.traverse(o => { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh) { const g = geos.get(im.name) ?? new Set(); g.add(im.geometry); geos.set(im.name, g); } });
    const bodyGeos = new Set<THREE.BufferGeometry>(); s.body.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) bodyGeos.add((o as THREE.Mesh).geometry); });
    expect([...(geos.get('prop-deviceWall') ?? [])].some(g => bodyGeos.has(g)), 'the cut body drawn').toBe(true);
    // (no whole model on a bare unit: every deviceWall placement of the level is bare in version 4)
    let whole = false; model.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && [...(geos.get('prop-deviceWall') ?? [])].includes((o as THREE.Mesh).geometry)) whole = true; });
    expect(whole).toBe(false);
    const devGeos = [...geos.entries()].filter(([n]) => n.startsWith('prop-skyMerchWall')).flatMap(([, g]) => [...g]);
    expect(devGeos.length).toBeGreaterThanOrEqual(1);
    for (const g of devGeos) expect([...s.devices.values()].some(l => l.some(q => q.geo === g)), 'a device draws the model\'s own cut').toBe(true);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------

function realSys(rig: ContactRig, layout: StationLayout): DamageSystem {
  const cm = rig.cm!, pk = rig.pickups!;
  const sys = new DamageSystem(null, null);
  let s = 7;
  sys.rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  sys.build(layout, null, [rig.world.group, cm.group], {physics: rig.ph, ownMeshes: p => cm.ownMeshes(p), pickups: () => pk.list,
    lots: (o, d, maxT) => cm.shotLots(o, d, maxT).map(l => ({holder: l.holder, lotId: l.lotId, t: l.t})), lotsIn: box => cm.lotsInBox(box)});
  return sys;
}

/** A buckshot volley (like Game.fire) at piece `i` from a free line in front of / beside it; then 5 s of physics. Null: no line reaches it. */
function volleyAt(rig: ContactRig, sys: DamageSystem, i: number): {moved: number} | null {
  const props = rig.layout.props, p = props[i], q = props[p.host!];
  const c = new THREE.Vector3(p.x, p.y + p.h * 0.5, p.z);
  const shot = {damage: 15, pellet: true, weapon: 'shotgun'} as const;
  for (const f of [new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot)), new THREE.Vector3(Math.sin(q.rot), 0, Math.cos(q.rot))]) {
    for (const yaw of [0.6, -0.6, 0]) for (const up of [0.2, -0.3, 0.6]) {
      const u = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).setY(up).normalize();
      const o = c.clone().addScaledVector(u, 1.3), d = c.clone().sub(o).normalize();
      const wh0 = raycastShot(rig.L, props, o, d, 8, rig.layout.trench.floorY);
      if (wh0.kind !== 'prop' || wh0.prop !== i) continue;
      sys.beginShot();
      for (let k = 0; k < 9; k++) {
        const wh = raycastShot(rig.L, props, o, d, 8, rig.layout.trench.floorY);
        sys.knockPickups(o, d, wh.t, wh, shot);
        if (wh.kind !== 'none') sys.hitWorld(wh, new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t), d.clone(), shot);
      }
      let moved = 0;
      for (let t = 0; t < 300; t++) {
        rig.ph.update(DT);
        const e = rig.ph.dynamicItems.loose().find(x => x.prop === p);
        if (e) moved = Math.max(moved, new THREE.Vector3().setFromMatrixPosition(e.matrix).distanceTo(new THREE.Vector3(c.x, p.y, c.z)) - 0);
      }
      return {moved};
    }
  }
  return null;
}
