// Task mall-playtest-revision-20261031 (lane SHOPS, U05 — user: "clothing racks can move with physics however the clothes on the rack
// stay put, floating in the air"). Cause: the garment groups are static host decor (gen/mall/kinds.ts garmentHangingGroup, `host` =
// the rail) hung BELOW the rail's top, so physics/dynamicItems.ts supportsOther (a prop with something on its TOP never goes loose)
// did not see them — the rail went loose and moved, the garments kept their static render instance and their static collider.
// Now they RIDE the rail (damage/materials.ts ridesHost): when the rail goes loose (walk-in or shot) the garments' meshes become parts
// of the rail's body (same rigid transform: translate + rotate), their collider goes, and a shot INTO the garments shoves the rail.
// Real Player (W key) + real physics + real PropDamage over the real built world (tests/helpers/contactWalk.ts), on the dressed
// synthetic shop ring (layout-agnostic).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {approach, contactRig, settle, stand, walkForward, type ContactRig} from './helpers/contactWalk';
import {Rng} from '../src/core/rng';
import type {PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {assignMallPrograms} from '../src/gen/mall/shops';
import {dressMallShops} from '../src/gen/mall/shopsDress';
import {MALL_RIDER_KINDS} from '../src/gen/mall/kinds';
import {ridesHost} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {DamageSystem, SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {PhysicsSystem} from '../src/physics/world';
import {buildWorld} from '../src/world/builder';
import {WorldMaterials} from '../src/world/materials';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {standInModels} from './helpers/contactWalk';
import {mallShopsFixture} from './helpers/mallShopsFixture';

installCanvasShim(false);

const RAILS = new Set(['garmentRail', 'garmentRailRound']);
/**
 * A copy with fresh props and the station records buildWorld expects (the synthetic ring has no track bed). The mall record is
 * dropped for the render (lane ARCH's atrium needs a real void; the props, physics and damage are what is tested here).
 */
const fresh = (l: StationLayout): StationLayout =>
  Object.assign({platforms: [], trenches: [], traversal: {stairs: [], ladders: [], underpasses: []}, trench: {floorY: -1.15}}, l, {mall: undefined, props: l.props.map(p => ({...p}))}) as StationLayout;

/** A dressed synthetic shop ring whose clothing shops carry garment groups on their rails. */
function dressedRing(seed: number): StationLayout {
  const {layout} = mallShopsFixture(1);
  assignMallPrograms(layout, new Rng(seed), {force: {'L1-N02': 'clothing', 'L1-S03': 'clothing', 'L1-N07': 'department'}});
  dressMallShops(layout, new Rng(seed ^ 0x5eed), {frame: 'absolute'});
  return layout;
}

/** Rails (index) hosting at least one rider, with their riders. */
function railsWithRiders(layout: StationLayout): {rail: PropPlacement; i: number; riders: {p: PropPlacement; i: number}[]}[] {
  const out: {rail: PropPlacement; i: number; riders: {p: PropPlacement; i: number}[]}[] = [];
  layout.props.forEach((rail, i) => {
    if (!RAILS.has(rail.kind)) return;
    const riders = layout.props.map((p, j) => ({p, i: j})).filter(r => r.p.host === i && ridesHost(r.p.kind));
    if (riders.length) out.push({rail, i, riders});
  });
  return out;
}

/** World matrix of the first part drawn for a prop (its own detached mesh, else its shared instance). */
function drawn(pd: ContactRig['pd'], prop: PropPlacement): {m: THREE.Matrix4; detached: boolean; hidden: boolean} | null {
  const s = pd.states.get(prop);
  const own = s?.parts?.find(q => q.mesh.parent === pd.group);
  const e = pd.index.inst.get(prop)?.[0];
  const im = new THREE.Matrix4();
  if (e) { e.mesh.getMatrixAt(e.index, im); e.mesh.updateWorldMatrix(true, false); im.premultiply(e.mesh.matrixWorld); }
  const hidden = !!e && [0, 1, 2, 4, 5, 6, 8, 9, 10].every(k => Math.abs(im.elements[k]) < 1e-9);
  if (own) { own.mesh.updateWorldMatrix(true, false); return {m: own.mesh.matrixWorld.clone(), detached: true, hidden}; }
  return e ? {m: im, detached: false, hidden} : null;
}
const rel = (a: THREE.Matrix4, b: THREE.Matrix4) => a.clone().invert().multiply(b);
const near = (a: THREE.Matrix4, b: THREE.Matrix4, eps: number) => a.elements.every((v, k) => Math.abs(v - b.elements[k]) < eps);
const yawOf = (m: THREE.Matrix4) => { const q = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), q, new THREE.Vector3()); return new THREE.Euler().setFromQuaternion(q, 'YXZ').y; };

describe('U05 garments ride their rack', () => {
  it('classified: garment groups are host decor that ride their host; the audit says so (no "rail stays put" claim)', () => {
    expect(MALL_RIDER_KINDS).toContain('garmentHangingGroup');
    expect(ridesHost('garmentHangingGroup')).toBe(true);
    for (const k of ['officeMonitor', 'cashRegister', 'flatScreenTv', 'aquarium']) expect(ridesHost(k)).toBe(false);
    const row = PROP_PHYSICS_AUDIT.garmentHangingGroup;
    expect(row.cls).toBe('static');
    expect(row.how).toMatch(/ride/);
    expect(row.how).not.toMatch(/rail stays put/);
    // the rails themselves move (rule 2)
    for (const k of RAILS) expect(PROP_PHYSICS_AUDIT[k].cls).toBe('dynamic');
  });

  it('a REAL player walks into a dressed rail: the garments translate + rotate with it, no stationary collider, drawn once', () => {
    const layout = fresh(dressedRing(3));
    const rig = contactRig(layout);
    const cands = railsWithRiders(layout);
    expect(cands.length).toBeGreaterThan(2);
    let tested = 0;
    for (const c of cands) {
      if (tested >= 2) break;
      if (!rig.ph.dynamicItems.isDynamicProp(c.rail)) continue;
      const at = approach(rig, c.rail, 1.0, 1.2);
      if (!at) continue;
      const r0 = drawn(rig.pd, c.rail), g0 = c.riders.map(r => drawn(rig.pd, r.p));
      expect(r0).not.toBeNull();
      for (const g of g0) expect(g).not.toBeNull();
      const before = g0.map(g => rel(r0!.m, g!.m));
      const h0 = c.riders.map(r => r.p.h);
      expect(h0.every(h => h > 0.5)).toBe(true); // a real collider while hung on the static rail
      stand(rig, at);
      walkForward(rig, 1.4);
      settle(rig, 2.5);
      const r1 = drawn(rig.pd, c.rail)!;
      const moved = new THREE.Vector3().setFromMatrixPosition(r1.m).distanceTo(new THREE.Vector3().setFromMatrixPosition(r0!.m));
      if (moved < 0.05) continue; // pinned against something: try the next rail
      tested++;
      for (const [k, r] of c.riders.entries()) {
        const g1 = drawn(rig.pd, r.p)!;
        expect(g1.detached, 'rider drawn by its own meshes').toBe(true);
        expect(g1.hidden, 'its shared instance hidden (no orphan duplicate)').toBe(true);
        // same rigid transform relative to the rail: translation AND rotation follow
        expect(near(rel(r1.m, g1.m), before[k], 2e-3), `${c.rail.kind} rider ${k} keeps its hang`).toBe(true);
        const gd = new THREE.Vector3().setFromMatrixPosition(g1.m).distanceTo(new THREE.Vector3().setFromMatrixPosition(g0[k]!.m));
        expect(gd).toBeGreaterThan(0.04);
        expect(r.p.h, 'no stationary collider left where it hung').toBe(0);
        // exactly one own copy per shared part (no duplicates of the garments)
        const parts = rig.pd.states.get(r.p)!.parts!;
        expect(parts.filter(q => q.mesh.parent === rig.pd.group).length).toBe(parts.length);
      }
      void yawOf;
    }
    expect(tested).toBeGreaterThan(0);
  });

  it('a shot INTO the garments shoves the rail they ride (damage system routing); garments follow, rotation included', () => {
    const layout = fresh(dressedRing(3));
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const world = buildWorld(layout, mats, standInModels(layout));
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    const sys = new DamageSystem(null, null);
    let s = 7;
    sys.rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    sys.build(layout, mats, [world.group], {physics: ph});
    const pd = (sys as unknown as {props: ContactRig['pd']}).props;
    const c = railsWithRiders(layout).find(q => ph.dynamicItems.isDynamicProp(q.rail))!;
    expect(c).toBeDefined();
    const g = c.riders[0];
    const r0 = drawn(pd, c.rail)!, g0 = drawn(pd, g.p)!;
    const before = rel(r0.m, g0.m);
    // a buckshot volley (9 pellets) into the garments, from their front, off-centre (spins the rack as well as pushing it)
    const fx = Math.sin(c.rail.rot), fz = Math.cos(c.rail.rot);
    const dir = new THREE.Vector3(-fx, -0.05, -fz).normalize();
    for (let k = 0; k < 9; k++) {
      const off = 0.15 + (k - 4) * 0.02;
      const point = new THREE.Vector3(g.p.x + fz * off + fx * g.p.hz, g.p.y + g.p.h * 0.5, g.p.z - fx * off + fz * g.p.hz);
      const hit = sys.hitWorld({t: 1, kind: 'prop', prop: g.i, nx: fx, ny: 0, nz: fz, level: g.p.level ?? 0}, point, dir, {damage: 15, pellet: true, weapon: 'shotgun'});
      expect(hit.object).toBe('prop');
    }
    expect(sys.counts.propsShoved).toBe(9);
    for (let k = 0; k < 180; k++) ph.update(1 / 60);
    const r1 = drawn(pd, c.rail)!, g1 = drawn(pd, g.p)!;
    const moved = new THREE.Vector3().setFromMatrixPosition(r1.m).distanceTo(new THREE.Vector3().setFromMatrixPosition(r0.m));
    // a buckshot volley slides an 18 kg pad-footed round rack ~1.5 cm / a 14 kg castor rail further (calibrated contacts): it moved,
    // and the garments moved with it exactly
    expect(moved, c.rail.kind).toBeGreaterThan(0.005);
    expect(near(rel(r1.m, g1.m), before, 2e-3)).toBe(true);
    expect(g.p.h).toBe(0);
    expect(g1.hidden).toBe(true);
    void SHOT_IMPULSE_PER_DAMAGE;
  });

  it('a resting loose rail hands its render back (reclaim) with its garments at the pose they ride at; waking it again re-carries them', () => {
    const layout = fresh(dressedRing(3));
    const rig = contactRig(layout);
    const c = railsWithRiders(layout).find(q => rig.ph.dynamicItems.isDynamicProp(q.rail) && approach(rig, q.rail, 1.0, 1.2))!;
    const at = approach(rig, c.rail, 1.0, 1.2)!;
    stand(rig, at);
    walkForward(rig, 1.2);
    settle(rig, 3);
    const g = c.riders[0];
    const r1 = drawn(rig.pd, c.rail)!, g1 = drawn(rig.pd, g.p)!;
    const hang = rel(r1.m, g1.m);
    // reclaim everything that rests (the detach budget's background path), then wake it by walking into it again
    const di = rig.ph.dynamicItems as unknown as {reclaim(n: number, except?: unknown, marks?: boolean): number};
    di.reclaim(64, undefined, false);
    const r2 = drawn(rig.pd, c.rail)!, g2 = drawn(rig.pd, g.p)!;
    expect(r2.detached).toBe(false);
    expect(g2.detached).toBe(false); // handed back too: drawn by its shared instance again, at the riding pose
    expect(near(rel(r2.m, g2.m), hang, 2e-3)).toBe(true);
    const at2 = approach(rig, c.rail, 1.0, 1.0);
    if (at2) {
      stand(rig, at2);
      walkForward(rig, 1.2);
      settle(rig, 2.5);
      const r3 = drawn(rig.pd, c.rail)!, g3 = drawn(rig.pd, g.p)!;
      expect(near(rel(r3.m, g3.m), hang, 2e-3)).toBe(true);
    }
  });
});
