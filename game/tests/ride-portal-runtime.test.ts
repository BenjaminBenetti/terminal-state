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
import {portalCut, portalEndKey, type RidePortal} from '../src/world/ridePortal';
import {PORTAL_RT, RidePortalRuntime, type PortalWhich, type RidePortalHost} from '../src/world/ridePortalRuntime';
import {leafMatrix} from '../src/world/ridePortalView';
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

/** World point `s` m beyond portal `q`'s plane on the track centre line, `dy` above the bed. */
const at = (q: RidePortal, s: number, dy = 1): THREE.Vector3 => new THREE.Vector3(q.x + q.out * s, q.bedY + dy, q.z);
const box = (name: string): THREE.Mesh => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial()); m.name = name; return m; };

describe('ride portal runtime: the gate, the breach headwall, the movers and the car (Subway 4242: a gate and a breach)', () => {
  it('the gate swings over PORTAL_RT.swing with an ease; a release shuts it first, then lifts the cut; a breach reads 1 while engaged', async () => {
    const w = await portalWorld('subway', 4242);
    const P = w.portals!;
    expect([P.front.kind, P.rear.kind]).toEqual(['gate', 'breach']);
    const h = hostOf(w), rt = new RidePortalRuntime(h).install();
    for (const k of h.sectionHooks) k.build?.(w.layout as never);
    const v = w.world.rideGates!.gates.get(portalEndKey(P.front))!, m = new THREE.Matrix4();
    const pose = (e: number) => { v.leaves.getMatrixAt(0, m); return m.elements.every((x, i) => Math.abs(x - leafMatrix(P.front, P.front.opening, -1, e).elements[i]) < 1e-5); };
    rt.engage('front', {gateOpen: false});
    expect(rt.gate('front')).toBe(0);
    rt.setGate('front', true);
    rt.step(PORTAL_RT.swing / 2);
    expect(rt.gate('front')).toBeCloseTo(0.5, 9); // (smoothstep at half time)
    expect(pose(0.5)).toBe(true);
    rt.step(PORTAL_RT.swing / 4);
    expect(rt.gate('front')).toBeCloseTo(0.84375, 9);
    rt.step(PORTAL_RT.swing);
    expect(rt.gate('front')).toBe(1);
    expect(pose(1)).toBe(true);
    rt.release('front');
    expect(rt.state('front').releasing).toBe(true);
    rt.setGate('front', true); // (ignored while releasing)
    rt.step(PORTAL_RT.swing / 2);
    expect(rt.engaged('front')).toBe(true);
    expect(rt.gate('front')).toBeCloseTo(0.5, 9);
    rt.step(PORTAL_RT.swing / 2 + 1e-6);
    expect(rt.engaged('front')).toBe(false);
    expect(rt.gate('front')).toBe(0);
    expect(pose(0)).toBe(true);
    expect(RIDE_MASK.on).toBe(false);
    // engage with the gate open (an arrival); a release of a shut gate finishes at once
    rt.engage('front', {gateOpen: true});
    expect(rt.gate('front')).toBe(1);
    rt.setGate('front', false);
    rt.step(PORTAL_RT.swing + 0.01);
    rt.release('front');
    expect(rt.engaged('front')).toBe(false);
    // a breach: no gate to swing (setGate is a no-op), 1 while engaged
    rt.engage('rear', {gateOpen: false});
    expect(rt.gate('rear')).toBe(1);
    rt.setGate('rear', false);
    rt.step(1);
    expect(rt.gate('rear')).toBe(1);
    rt.release('rear', {now: true});
    expect(rt.gate('rear')).toBe(0);
  }, 240_000);

  it('the breach headwall: the tunnel section less the ride opening at the plane, only while engaged; it goes only unobserved (out of view, beyond the murk, the eye at the plane) — a forced timeout is a counted last resort', async () => {
    const w = await portalWorld('subway', 4242);
    const q = w.portals!.rear;
    let pool: (() => readonly THREE.Object3D[]) | null = null;
    const h = hostOf(w, {warmRegistry: {addPool: (name, roots) => { expect(name).toBe('ride-portals'); pool = roots; }}});
    const rt = new RidePortalRuntime(h).install();
    for (const k of h.sectionHooks) k.build?.(w.layout as never);
    const root = w.scene.children.find(o => o.userData.ridePortal)!;
    expect(root).toBeTruthy();
    expect(root.visible).toBe(false); // (outside rides: nothing stands in the walkable tunnel)
    expect(pool!()).toContain(root); // (warmed with the loading screen's pool)
    const wall = root.children[0] as THREE.Mesh, P = wall.geometry.attributes.position as THREE.BufferAttribute, idx = wall.geometry.index!;
    for (let i = 0; i < P.count; i++) expect(P.getX(i)).toBeCloseTo(q.x, 4);
    let area = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < idx.count; t += 3) { a.fromBufferAttribute(P, idx.getX(t)); b.fromBufferAttribute(P, idx.getX(t + 1)); c.fromBufferAttribute(P, idx.getX(t + 2)); area += b.sub(a).cross(c.sub(a)).length() / 2; }
    expect(area).toBeCloseTo((q.face.z1 - q.face.z0) * (q.face.y1 - q.face.y0) - (q.opening.z1 - q.opening.z0) * (q.opening.y1 - q.opening.y0), 4); // (float32 positions)
    const cam = h.camera;
    const look = (from: THREE.Vector3, to: THREE.Vector3) => { cam.position.copy(from); cam.lookAt(to); cam.updateMatrixWorld(true); };
    // in view, near: it stays until it is looked away from
    rt.engage('rear', {gateOpen: true});
    expect(root.visible).toBe(true);
    rt.release('rear');
    look(at(q, -15, 1.6), at(q, 0, 1.6));
    rt.step(0.1, cam.position);
    rt.step(0.1, cam.position);
    expect([rt.engaged('rear'), root.visible]).toEqual([true, true]);
    look(at(q, -15, 1.6), at(q, -40, 1.6)); // (turned round)
    rt.step(0.1, cam.position);
    expect([rt.engaged('rear'), root.visible]).toEqual([false, false]);
    // in view but beyond the murk's sight (PORTAL_RT.unseen = RIDE_PORTAL.dark)
    rt.engage('rear', {gateOpen: true});
    rt.release('rear');
    look(at(q, -(PORTAL_RT.unseen + 5), 1.6), at(q, 0, 1.6));
    rt.step(0.1, cam.position);
    expect(rt.engaged('rear')).toBe(false);
    // looking back down the station tunnel from 20-50 m (in view, in the murk's sight): it waits, however long the ride's tail is
    for (const d of [20, 35, 50]) {
      rt.engage('rear', {gateOpen: true});
      rt.release('rear');
      look(at(q, -d, 1.6), at(q, 0, 1.6));
      for (let k = 0; k < 40; k++) rt.step(0.5, cam.position);
      expect([d, rt.engaged('rear'), root.visible]).toEqual([d, true, true]);
      // ... until the viewer turns away
      look(at(q, -d, 1.6), at(q, -d - 30, 1.6));
      rt.step(0.1, cam.position);
      expect(rt.engaged('rear')).toBe(false);
    }
    // a player walking up to the headwall in view: the walkable tunnel is back once the eye is at the plane (the change at the eye)
    rt.engage('rear', {gateOpen: true});
    rt.release('rear');
    for (const d of [10, 4, 1.5]) { look(at(q, -d, 1.6), at(q, 5, 1.6)); rt.step(0.1, cam.position); expect([d, rt.engaged('rear')]).toEqual([d, true]); }
    look(at(q, -0.6, 1.6), at(q, 5, 1.6));
    rt.step(0.1, cam.position);
    expect(rt.engaged('rear')).toBe(false);
    // the last resort: in view and near the whole time — only after PORTAL_RT.timeout, counted (QA)
    expect(PORTAL_RT.timeout).toBeGreaterThanOrEqual(60);
    rt.engage('rear', {gateOpen: true});
    rt.release('rear');
    look(at(q, -10, 1.6), at(q, 0, 1.6));
    for (let k = 0; k < Math.floor((PORTAL_RT.timeout - 1e-6) / 0.5); k++) rt.step(0.5, cam.position); // (just under the timeout)
    expect([rt.engaged('rear'), rt.state('rear').forced]).toEqual([true, 0]);
    rt.step(0.5, cam.position);
    expect([rt.engaged('rear'), rt.state('rear').forced, rt.stats.forced]).toEqual([false, 1, 1]);
    // re-engaging cancels a release under way
    rt.engage('rear', {gateOpen: true});
    rt.release('rear');
    rt.engage('rear', {gateOpen: true});
    expect(rt.state('rear').releasing).toBe(false);
    rt.release('rear', {now: true});
    for (const k of h.sectionHooks) k.teardown?.();
    expect(root.parent).toBeNull();
    expect(pool!()).toEqual([]);
  }, 240_000);

  it('movers in the cut are hidden by their root and shown when they leave it / on release; never the car, what rides in it, the transit, an owner-hidden object', async () => {
    const w = await portalWorld('subway', 4242);
    const q = w.portals!.front;
    const zombie = (p: THREE.Vector3) => { const r = new THREE.Group(); r.add(box('zombie-body')); r.position.copy(p); w.scene.add(r); return {root: r}; };
    const zIn = zombie(at(q, 8, 0)), zOut = zombie(at(q, -6, 0)), zDoor = zombie(at(q, 0.1, 0));
    const pickups = new THREE.Group(); w.scene.add(pickups);
    const pk = new THREE.Group(); pk.add(box('pickup')); pk.position.copy(at(q, 12, 0.2)); pickups.add(pk);
    const loose = new THREE.Group(); w.scene.add(loose);
    const crate = box('loose-crate'); crate.position.copy(at(q, 30, 0.3)); loose.add(crate);
    const ownerHidden = box('owner-hidden'); ownerHidden.position.copy(at(q, 31, 0.3)); ownerHidden.visible = false; loose.add(ownerHidden);
    const station = box('station-side'); station.position.copy(at(q, -3, 0.3)); loose.add(station);
    // the car riding in the tunnel: its view, a bag lying in it (not parented to it), the transit tunnel group
    const car = new THREE.Group(); car.add(box('car-shell')); car.position.copy(at(q, 40, 1.15)); car.rotation.y = q.out > 0 ? 0 : Math.PI; w.scene.add(car);
    const bag = box('bag-in-car'); bag.position.copy(at(q, 43, 1.6)); loose.add(bag);
    const transit = new THREE.Group(); transit.userData.trainTransit = true; const tw = box('transit-wall'); tw.position.copy(at(q, 60, 1)); transit.add(tw); w.scene.add(transit);
    // a big scene mesh (an exterior's block) reaching into the box beyond the plane: it would vanish where it is seen from elsewhere
    const block = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 20), new THREE.MeshBasicMaterial()); block.position.copy(at(q, 50, 2)); block.position.z += 9; loose.add(block);
    w.scene.updateMatrixWorld(true);
    const h = hostOf(w, {zombies: [zIn, zOut, zDoor], pickups: {list: [{obj: pk}]}, trainRuntime: {view: {root: car}, spec: {length: 16.2, width: 2.99, roofY: 3.4}}});
    const rt = new RidePortalRuntime(h).install();
    for (const k of h.sectionHooks) k.build?.(w.layout as never);
    const base = snapshot(w.roots);
    rt.engage('front', {gateOpen: true});
    const vis = () => [zIn.root, zOut.root, zDoor.root, pk, crate, ownerHidden, station, car, bag, tw].map(o => o.visible);
    expect(vis()).toEqual([false, true, true, false, false, false, true, true, true, true]);
    expect(rt.state('front').hidden.objects).toBe(3);
    expect([block.visible, rt.stats.uncut]).toEqual([true, 1]);
    // the inner one walks out to the platform side, the outer one into the tunnel: each step follows
    zIn.root.position.copy(at(q, -2, 0));
    zOut.root.position.copy(at(q, 5, 0));
    w.scene.updateMatrixWorld(true);
    rt.step(1 / 60);
    expect([zIn.root.visible, zOut.root.visible]).toEqual([true, false]);
    // a crate shoved out of the box (beside the track, off the box's side) shows again
    crate.position.z = q.z + 3; crate.updateMatrixWorld(true);
    rt.step(1 / 60);
    expect(crate.visible).toBe(true);
    rt.release('front', {now: true});
    expect(vis()).toEqual([true, true, true, true, true, false, true, true, true, true]);
    expect(diff(base, snapshot(w.roots))).toEqual([]);
  }, 240_000);

  it('an instance another system rewrites while hidden is never restored over; one placed into the cut while engaged is hidden', async () => {
    const w = await portalWorld('subway', 4242);
    const q = w.portals!.rear;
    const h = hostOf(w), rt = new RidePortalRuntime(h).install();
    for (const k of h.sectionHooks) k.build?.(w.layout as never);
    const ims: THREE.InstancedMesh[] = [];
    for (const r of w.roots) r.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh && !o.userData.ridePortal) ims.push(o as THREE.InstancedMesh); });
    const before = new Map(ims.map(im => [im, Float32Array.from(im.instanceMatrix.array as Float32Array)]));
    rt.engage('rear', {gateOpen: true});
    // an instance we hid
    let hid: [THREE.InstancedMesh, number] | null = null;
    for (const im of ims) { const a = im.instanceMatrix.array as Float32Array, b = before.get(im)!; for (let i = 0; i < im.count && !hid; i++) if (a[i * 16] !== b[i * 16] && Math.abs(a[i * 16]) < 1e-20) hid = [im, i]; if (hid) break; }
    expect(hid).not.toBeNull();
    const [im, i] = hid!;
    // another system (prop damage / physics) takes it over: moved 2 m to the station side of the plane and drawn there
    const moved = new THREE.Matrix4().fromArray(before.get(im)!, i * 16).premultiply(new THREE.Matrix4().makeTranslation(-q.out * (Math.abs(q.x - at(q, 0).x) + 200), 0, 0));
    im.setMatrixAt(i, moved);
    im.instanceMatrix.needsUpdate = true;
    // and an instance of another mesh is placed INTO the cut (a pooled decal / a re-attached prop)
    let other: [THREE.InstancedMesh, number] | null = null;
    for (const m of ims) { if (m === im || m.count < 1) continue; other = [m, 0]; break; }
    const [om, oi] = other!;
    const into = new THREE.Matrix4().makeTranslation(at(q, 20).x, q.bedY + 1, q.z);
    const lm = new THREE.Matrix4().copy(om.matrixWorld).invert().multiply(into);
    om.setMatrixAt(oi, lm);
    om.instanceMatrix.needsUpdate = true;
    rt.step(1 / 60);
    const m = new THREE.Matrix4();
    im.getMatrixAt(i, m);
    expect(m.elements.every((x, k) => Math.abs(x - moved.elements[k]) <= 1e-4 * Math.max(1, Math.abs(x)))).toBe(true); // (its value stands)
    om.getMatrixAt(oi, m);
    expect(Math.abs(m.elements[0]) < 1e-20 && Math.abs(m.elements[5]) < 1e-20).toBe(true); // (hidden: collapsed)
    rt.release('rear', {now: true});
    im.getMatrixAt(i, m);
    expect(m.elements.every((x, k) => Math.abs(x - moved.elements[k]) <= 1e-4 * Math.max(1, Math.abs(x)))).toBe(true); // (never restored over)
    om.getMatrixAt(oi, m);
    expect(m.elements.every((x, k) => Math.abs(x - lm.elements[k]) < 1e-4)).toBe(true); // (its own placement back)
  }, 240_000);

  it('the culler decides from the portal\'s opening while an eye rides beyond an engaged portal; nothing changes outside a ride', async () => {
    const w = await portalWorld('market', 4242);
    const q = w.portals!.front;
    const h = hostOf(w), rt = new RidePortalRuntime(h).install();
    for (const k of h.sectionHooks) k.build?.(w.layout as never);
    const cul = w.world.culler as unknown as {eyeProxy: ((e: THREE.Vector3) => void) | null};
    expect(cul.eyeProxy).toBeNull();
    rt.engage('front', {gateOpen: true});
    const e = at(q, 30, 1.7);
    cul.eyeProxy!(e);
    expect(e.x).toBeCloseTo(q.x - q.out * 0.5, 9);
    const s = at(q, -4, 1.7), s0 = s.clone();
    cul.eyeProxy!(s);
    expect(s.equals(s0)).toBe(true);
    rt.release('front', {now: true});
    expect(cul.eyeProxy).toBeNull();
  }, 240_000);
});
