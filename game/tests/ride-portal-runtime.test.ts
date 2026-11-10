// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): the ride portal RUNTIME (world/ridePortalRuntime.ts) on real
// generated levels of EVERY level kind in the registry, built like Game.buildSection (tests/helpers/ridePortalWorld.ts): what the
// station draws while a ride engages a portal — triangle by triangle, instance by instance, honouring the draw ranges, collapsed
// instance matrices and visible flags the runtime hides with (tests/helpers/ridePortalAudit.ts).
//  - engaged: nothing the station draws lies in the cut (world/ridePortal.ts cutHides); nothing on the station side of the front plane
//    is hidden; what else is hidden is counted (collateral of whole objects / instances reaching out of the box) and bounded;
//  - released: every index object and its bytes, draw range, instance matrix byte and visible flag is what it was (bit-exact), after
//    one portal, the other, both at once, repeated cycles and a teardown while engaged;
//  - the culler's stand-in eye is set while engaged and cleared after; the light mask is the portal's while engaged.
import * as THREE from 'three';
import {appendFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {LEVEL_IDS} from '../src/levels/registry';
import {portalCut, type RidePortal} from '../src/world/ridePortal';
import {RidePortalRuntime, type PortalWhich, type RidePortalHost} from '../src/world/ridePortalRuntime';
import {RIDE_MASK} from '../src/world/rideMask';
import {portalWorld, type PortalWorld} from './helpers/ridePortalWorld';
import {audit, diff, snapshot, type CutAudit} from './helpers/ridePortalAudit';

const LOG = '/tmp/lanes/portal/runtime.log';
const log = (s: string) => { try { appendFileSync(LOG, s + '\n'); } catch { /* best effort */ } };
const SEED = Number(process.env.PORTAL_SEED ?? 4242);

type Hooks = {build?(layout: never): void; teardown?(): void}[];

/** The Game fields the runtime reads, from a test world (no car view, no movers: the tests add them where they need them). */
function hostOf(w: PortalWorld, extra: Partial<RidePortalHost> = {}): RidePortalHost & {sectionHooks: Hooks; camera: THREE.PerspectiveCamera} {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
  return {scene: w.scene, layout: w.layout, trainPlacement: w.placement, world: w.world, containers: w.cm, stock: w.stock, mats: w.mats, camera,
    propModels: {ownsGeometry: g => w.modelGeometries.has(g)}, sectionHooks: [], zombies: [], pickups: {list: []}, ...extra} as RidePortalHost & {sectionHooks: Hooks; camera: THREE.PerspectiveCamera};
}

const fmt = (a: CutAudit) => `violations ${a.violations} collateral ${a.collateral} (station side ${a.stationSide}) hidden tris ${a.hiddenTriangles} inst ${a.hiddenInstances} objects ${a.hiddenObjects} straddlers ${a.straddlers} reach ${a.reach.toFixed(3)} (${a.far})${a.examples.length ? ' | ' + a.examples.slice(0, 6).join('; ') : ''}`;

describe('ride portal runtime: the cut on every level kind (real worlds)', () => {
  for (const id of LEVEL_IDS) {
    it(`${id} ${SEED}: engaged = nothing of the station in the cut, nothing on the station side hidden; released = bit-exact`, async () => {
      const w = await portalWorld(id, SEED);
      expect(w.portals, `${id} places the car`).not.toBeNull();
      const h = hostOf(w);
      const rt = new RidePortalRuntime(h).install();
      for (const k of h.sectionHooks) k.build?.(w.layout as never);
      const st = {...rt.stats};
      const roots = w.roots, base = snapshot(roots);
      const P = {front: w.portals!.front, rear: w.portals!.rear} as Record<PortalWhich, RidePortal>;
      log(`\n=== ${id} ${SEED}: front ${P.front.kind} rear ${P.rear.kind}; bind ${st.prepareMs.toFixed(1)} ms, scanned ${st.scanned}, split meshes ${st.splits} (tris ${st.splitTriangles}), instanced ${st.instanced}`);
      const cul = w.world.culler as unknown as {eyeProxy: unknown};
      for (const which of ['front', 'rear'] as const) {
        const q = P[which];
        rt.engage(which, {gateOpen: which === 'rear'});
        expect(rt.engaged(which)).toBe(true);
        expect(typeof cul.eyeProxy).toBe('function');
        expect(RIDE_MASK.on).toBe(true);
        expect(RIDE_MASK.box).toEqual(q.box);
        expect(RIDE_MASK.openX).toBe(q.x);
        const a = audit(roots, base, [portalCut(q)], [q.x]);
        const s = rt.state(which);
        log(`  ${which} ${q.kind}: engage ${rt.stats.engageMs.toFixed(2)} ms; state ${JSON.stringify(s.hidden)}; ${fmt(a)}`);
        expect(a.violations, `${id} ${which}: ${a.examples.join('; ')}`).toBe(0);
        expect(a.stationSide, `${id} ${which}`).toBe(0);
        rt.release(which, {now: true});
        expect(rt.engaged(which)).toBe(false);
        expect(cul.eyeProxy).toBeNull();
        expect(RIDE_MASK.on).toBe(false);
        expect(diff(base, snapshot(roots)), `${id} ${which} released`).toEqual([]);
      }
      // both at once (an arrival's portal still shutting while the next departure starts is dropped by the ride, but the runtime allows it)
      rt.engage('front', {gateOpen: false});
      rt.engage('rear', {gateOpen: false});
      const both = audit(roots, base, [portalCut(P.front), portalCut(P.rear)], [P.front.x, P.rear.x]);
      expect(both.violations).toBe(0);
      expect(both.stationSide).toBe(0);
      rt.release('front', {now: true});
      const rearOnly = audit(roots, base, [portalCut(P.rear)], [P.rear.x]);
      expect(rearOnly.violations).toBe(0);
      expect(RIDE_MASK.box).toEqual(P.rear.box); // (the remaining portal's mask)
      rt.release('rear', {now: true});
      expect(diff(base, snapshot(roots))).toEqual([]);
      // repeated cycles
      for (let i = 0; i < 3; i++) { rt.engage('front', {gateOpen: true}); rt.engage('front', {gateOpen: true}); rt.release('front', {now: true}); rt.engage('rear', {gateOpen: false}); rt.release('rear', {now: true}); }
      expect(diff(base, snapshot(roots))).toEqual([]);
      // a teardown while engaged: everything back at once, the references dropped
      rt.engage('front', {gateOpen: true});
      for (const k of h.sectionHooks) k.teardown?.();
      expect(rt.portal('front')).toBeNull();
      expect(rt.engaged('front')).toBe(false);
      expect(cul.eyeProxy).toBeNull();
      expect(RIDE_MASK.on).toBe(false);
      expect(w.scene.children.some(c => c.userData.ridePortal)).toBe(false);
      expect(diff(base, snapshot(roots))).toEqual([]);
    }, 240_000);
  }
});
