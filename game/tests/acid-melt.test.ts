// Task studio-refinement-batch-20261113-035659-01 (lane MELT; user: "Acid Scrapper Grenade ... Melt world props including
// containers/portable devices (not just movable/cargo) ... each destroyed prop yields EXACTLY 1 scrap_metal OR 1 electrical_parts, once
// ... Containers physically spill real contents ... Protect TRAIN STRUCTURE and ALL FIXED TRAIN-MOUNTED FIXTURES ... Portable
// cargo/containers/devices NOT protected merely by being aboard. Use common physical traits/ownership, not per-kind whitelists."):
// world/acidMelt.ts over the REAL station build (helpers/acidMeltHost.ts: buildWorld, physics, damage, containers, pickups, the player
// train + ride, the item / prop cargo) plus a synthetic host for the trait table:
//  - the record lane + its save validator (old saves without it load; malformed records refused);
//  - eligibility by trait / ownership over EVERY registered prop kind (building structure, objectives, riders, not drawn, collision
//    owned elsewhere, trader stock), the train's own boxes never returned, portable cargo aboard (a station prop pushed in, a carried
//    prop) returned and melted;
//  - exposure -> start -> completion exactly once; contents spill as real pickups on real floor (same items / counts, lot provenance);
//    exactly one salvage by trait; the lane persisted; a rebuild from the JSON keeps it gone with no second spill / salvage;
//  - clear() mid-melt (and beyond the visual cap) completes each once; pickups on a melted surface fall to the floor.
// Equipment units and fuel carts: acid-melt-equipment.test.ts.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {ridesHost} from '../src/damage/materials';
import {BUNKER_OBJECTIVE_KINDS} from '../src/gen/bunker/bunkerKinds';
import {vendorDisplayHosts} from '../src/market/wares/slots';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {Inventory} from '../src/items/inventory';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {canonicalItemId} from '../src/items/calibers';
import {STATION_PROPS_LANE, type CargoPropJSON, type StationPropsJSON} from '../src/run/trainCargo';
import {ACID_MELT_LANE, ACID_MELT_LIMITS, acidMeltedOf, acidMeltedProblem} from '../src/run/acidMeltRecord';
import {checksumOf} from '../src/save/checksum';
import {SAVE_LIMITS, validateSaveFile} from '../src/save/validate';
import {sectionId, type SectionKey} from '../src/levels/types';
import {AcidMelt, MELT, propSalvage, type AcidMeltHost, type MeltRef} from '../src/world/acidMelt';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {enterStation, leaveStation, meltStation, pickupsOf, step, type MeltRig, type MeltWorld} from './helpers/acidMeltHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const SALVAGE = new Set<string>([ELECTRICAL_PARTS, SCRAP_METAL]);
const salvageOf = (c: MeltRig) => pickupsOf(c).filter(p => SALVAGE.has(p.itemId));

function station(): {c: MeltRig; w: MeltWorld} {
  const c = meltStation(SUB());
  live.push(c.rt);
  const w = enterStation(c, SUB());
  return {c, w};
}

/** The prop a ref names ('p:<generated index>' — no prop is appended before the hook in these worlds; 'c:<carried id>'). */
function propOf(w: MeltWorld, ref: MeltRef): PropPlacement | null {
  if (ref.key.startsWith('p:')) return w.L.props[Number(ref.key.slice(2))] ?? null;
  if (ref.key.startsWith('c:')) return w.L.props.find(p => p.cargo === ref.key.slice(2)) ?? null;
  return null;
}

/** The ref of a prop through the seam (a disc over its footprint at its base). */
function refOf(c: MeltRig, w: MeltWorld, p: PropPlacement): MeltRef {
  const i = w.L.props.indexOf(p);
  const r = c.melt.inDisc(p.x, p.y, p.z, 0.2).find(x => (p.cargo ? x.key === `c:${p.cargo}` : x.key === `p:${i}`));
  if (!r) throw new Error(`no ref for ${p.kind} #${i}`);
  return r;
}

/** Whether the shared render still draws the prop (an instance at a non-zero matrix). */
function instDrawn(w: MeltWorld, p: PropPlacement): boolean {
  const m = new THREE.Matrix4();
  return (w.pd.index.inst.get(p) ?? []).some(e => { e.mesh.getMatrixAt(e.index, m); return m.determinant() !== 0; });
}

/** Nothing else rests on / is hosted by `p` (a lone piece of furniture). */
function lone(w: MeltWorld, p: PropPlacement): boolean {
  const i = w.L.props.indexOf(p), top = p.y + p.h;
  return !w.L.props.some(q => q !== p && (q.host === i || (Math.abs(q.y - top) < 0.08 && Math.abs(q.x - p.x) < q.hx + p.hx && Math.abs(q.z - p.z) < q.hz + p.hz)));
}

/** The spot lies on a real floor (Levels.supportAt over the live world: not a wall, not in the air). */
function onFloor(c: MeltRig, x: number, y: number, z: number): boolean {
  const s = c.h.levels!.supportAt(x, z, y + 0.05, 0.35);
  return !!s && Math.abs(y - s.floor) < 0.02;
}

// ---------------------------------------------------------------------------------------------------------------------------

describe('acid melt: the record lane and its save validation', () => {
  it('acidMeltedProblem accepts the record and refuses every malformed shape (never read as anything melted)', () => {
    expect(acidMeltedProblem({v: 1, gone: []})).toBeNull();
    expect(acidMeltedProblem({v: 1, gone: [{i: 0, kind: 'bench'}, {i: 12, kind: 'cabinetTall'}]})).toBeNull();
    const bad: [unknown, RegExp][] = [
      [null, /object/], [[], /object/], ['x', /object/],
      [{v: 2, gone: []}, /version/], [{gone: []}, /version/], [{v: 1}, /at most/], [{v: 1, gone: {}}, /at most/],
      [{v: 1, gone: [], extra: 1}, /unexpected/],
      [{v: 1, gone: [{i: 1, kind: 'bench', x: 0}]}, /unexpected/],
      [{v: 1, gone: [{i: -1, kind: 'bench'}]}, /layout index/], [{v: 1, gone: [{i: 1.5, kind: 'bench'}]}, /layout index/],
      [{v: 1, gone: [{i: ACID_MELT_LIMITS.index + 1, kind: 'bench'}]}, /layout index/], [{v: 1, gone: [{i: '3', kind: 'bench'}]}, /layout index/],
      [{v: 1, gone: [{i: 3, kind: 'bench'}, {i: 3, kind: 'bench'}]}, /twice/],
      [{v: 1, gone: [{i: 3}]}, /kind/], [{v: 1, gone: [{i: 3, kind: 'no such kind!'}]}, /kind/], [{v: 1, gone: [null]}, /object/],
      [{v: 1, gone: Array.from({length: ACID_MELT_LIMITS.gone + 1}, (_, i) => ({i, kind: 'bench'}))}, /at most/],
    ];
    for (const [v, re] of bad) {
      expect(acidMeltedProblem(v), JSON.stringify(v)?.slice(0, 60)).toMatch(re);
      expect(acidMeltedOf(v)).toEqual({v: 1, gone: []});
    }
    expect(SAVE_LIMITS.meltedProps).toBe(ACID_MELT_LIMITS.gone);
  });

  it('a save with the lane validates; a malformed lane fails the file; a save without it (old saves) still loads', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    const old = structuredClone(hs.file('arrival', 1)) as {run: {memories: Record<string, {lanes?: Record<string, unknown>}>}; checksum: string};
    expect(validateSaveFile(structuredClone(old)).ok).toBe(true);
    expect(JSON.stringify(old)).not.toContain(ACID_MELT_LANE);
    hs.run.setLaneStore(ACID_MELT_LANE, {v: 1, gone: [{i: 4, kind: 'cabinetTall'}, {i: 9, kind: 'bench'}]}, {level: 'subway', section: 'main', station: sid(1)});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    const lane = (f: typeof base) => f.run.memories['st-01:main'].lanes[ACID_MELT_LANE];
    expect(lane(base).gone).toHaveLength(2);
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    refuse(f => { lane(f).gone[0].i = -1; }, /layout index/);
    refuse(f => { lane(f).gone[1].i = 4; }, /twice/);
    refuse(f => { lane(f).v = 2; }, /version/);
    refuse(f => { lane(f).gone.push({i: 20, kind: 'bench', items: ['medkit']}); }, /unexpected/);
    refuse(f => { f.run.memories['st-01:main'].lanes[ACID_MELT_LANE] = 'all'; }, /object/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------

/** The run's lane stores by section id (RunState.laneStore / setLaneStore). */
class FakeRun {
  readonly lanes = new Map<string, Record<string, unknown>>();
  constructor(public current: SectionKey) {}
  laneStore<T = unknown>(lane: string, key: SectionKey = this.current): T | undefined { return this.lanes.get(sectionId(key))?.[lane] as T | undefined; }
  setLaneStore(lane: string, data: unknown, key: SectionKey = this.current): void {
    const id = sectionId(key), m = this.lanes.get(id) ?? {};
    if (data === undefined) delete m[lane]; else m[lane] = data;
    this.lanes.set(id, m);
  }
}

/**
 * The trait table alone: a synthetic world where EVERY prop is drawn by the shared render (unless `undrawn`) and stands in the walk index
 * (unless `walk` names another set) — the melt's own layout / build hooks run as Game runs them.
 */
function traitWorld(L: StationLayout, o: {undrawn?: Set<PropPlacement>; walk?: PropPlacement[]; append?: PropPlacement[]} = {}) {
  const inst = new Map<PropPlacement, {mesh: THREE.InstancedMesh; index: number}[]>();
  const key: SectionKey = {level: 'subway', section: 'main', station: sid(3)};
  const host = {
    scene: new THREE.Scene(), run: new FakeRun(key), layout: null as StationLayout | null, levels: null, propIndex: null as {props: readonly PropPlacement[]} | null,
    inv: new Inventory(), pickups: {list: [], add: () => null}, containers: null,
    physics: {dynamicItems: {propMatrix: () => false, loose: () => [], withdraw: () => null, isDynamicProp: () => false, shootProp: () => false, wakePickup: () => false, restHeight: (p: PropPlacement) => p.h}, propsChanged: () => {}},
    damage: {props: {index: {inst, merged: []}, retire: () => ({meshes: [], geometries: []}), isRetired: () => false}},
    sectionLayoutHooks: [] as AcidMeltHost['sectionLayoutHooks'], sectionHooks: [] as AcidMeltHost['sectionHooks'], frameHooks: [] as AcidMeltHost['frameHooks'],
  };
  const melt = new AcidMelt(host as unknown as AcidMeltHost).install();
  for (const f of host.sectionLayoutHooks) f(L, key, undefined as never, 'prepare');
  L.props.push(...(o.append ?? [])); // (boxes another system appends after the generated identities are taken: the train's)
  for (const f of host.sectionLayoutHooks) f(L, key, undefined as never, 'build');
  for (const p of L.props) if (!o.undrawn?.has(p)) inst.set(p, [{mesh: null as never, index: 0}]);
  host.layout = L;
  host.propIndex = {props: o.walk ?? L.props};
  for (const s of host.sectionHooks) s.holders?.(L, key);
  for (const s of host.sectionHooks) s.build?.(L);
  return {melt, host, L};
}

const place = (kind: string, i: number, extra: Partial<PropPlacement> = {}): PropPlacement =>
  ({kind, x: 2 + (i % 40) * 3, z: 2 + Math.floor(i / 40) * 3, y: 0, rot: 0, area: 0, hx: 0.4, hz: 0.3, h: 0.9, blocksSight: false, variant: 0, ...extra}) as PropPlacement;

describe('acid melt: eligibility by trait and ownership (every registered prop kind, present and future)', () => {
  it('building structure / objectives / riders / undrawn / collision owned elsewhere / appended boxes never melt; every other kind can', () => {
    // (the kinds come from the game's own registry at run time: a kind added later is classified here automatically)
    const kinds = Object.keys(PROP_PHYSICS_AUDIT).sort();
    expect(kinds.length).toBeGreaterThan(300);
    const props = kinds.map((k, i) => place(k, i));
    const host0 = place(kinds[0], kinds.length + 1);
    const riders = kinds.filter(k => ridesHost(k)).map((k, i) => place(k, kinds.length + 2 + i, {host: props.length}));
    const undrawn = place('cabinetTall', kinds.length + 40), walled = place('cabinetTall', kinds.length + 41), gone = place('cabinetTall', kinds.length + 42, {cargoGone: true});
    const carried = place('foldingChair', kinds.length + 43, {cargo: 'st-09:main#7'}), wrongCargo = place('foldingChair', kinds.length + 44, {cargo: 'st-09:main#7/rider'});
    const L = {props: [...props, host0, ...riders, undrawn, walled, gone, carried, wrongCargo]} as unknown as StationLayout;
    const appended = [place('column', kinds.length + 50), place(kinds[0], kinds.length + 51)];
    const {melt} = traitWorld(L, {undrawn: new Set([undrawn]), walk: L.props.filter(p => p !== walled), append: appended});
    const fails: string[] = [];
    for (const p of props) {
      const why = PROP_PHYSICS_AUDIT[p.kind].why, got = melt.protection(p);
      const want = why === 'structure' || why === 'partition' ? 'building structure' : (BUNKER_OBJECTIVE_KINDS as readonly string[]).includes(p.kind) ? 'objective' : null;
      if (got !== want) fails.push(`${p.kind} (${why}): ${got} != ${want}`);
    }
    expect(fails).toEqual([]);
    for (const k of BUNKER_OBJECTIVE_KINDS) expect(melt.protection(props[kinds.indexOf(k)] ?? place(k, 0)), k).not.toBeNull();
    for (const r of riders) expect(melt.protection(r), r.kind).toBe('rides its host');
    expect(melt.protection(undrawn)).toBe('not drawn');
    expect(melt.protection(walled)).toBe('collision owned elsewhere');
    expect(melt.protection(gone)).toBe('gone');
    expect(melt.protection(carried)).toBeNull();
    expect(melt.protection(wrongCargo)).toBe('not a placement');
    for (const p of appended) expect(melt.protection(p)).toBe('not a placement');
    // the queries never return a protected one (a disc over the whole synthetic yard)
    const refs = melt.inDisc(60, 0, 20, 200).map(r => r.key).sort();
    const want = L.props.filter(p => melt.protection(p) === null).map(p => (p.cargo ? `c:${p.cargo}` : `p:${L.props.indexOf(p)}`)).sort();
    expect(refs).toEqual(want);
    expect(refs).toContain('c:st-09:main#7');
    expect(refs.length).toBeGreaterThan(250);
  });

  it('the market\'s trader displays (the stalls\' finite stock) never melt; the rest of the market can', () => {
    const L = LEVELS.market.generate('main', {levelSeed: 4242});
    const hosts = vendorDisplayHosts(L);
    expect(hosts.size).toBeGreaterThan(0);
    const {melt} = traitWorld(L);
    for (const i of hosts) expect(melt.protection(L.props[i]), L.props[i].kind).toBe('trader stock');
    const free = L.props.filter((p, i) => !hosts.has(i) && melt.protection(p) === null);
    expect(free.length).toBeGreaterThan(10);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------------------

describe('acid melt: the real station and the parked train', () => {
  it('the train\'s own boxes are never returned (fixtures are not placements); portable props aboard ARE — a pushed-in one and a carried one melt', () => {
    const c = meltStation(SUB());
    live.push(c.rt);
    // a carried prop arrives aboard from the train's record (world/trainPropCargo.ts)
    const rec: CargoPropJSON = {id: 'st-09:main#1000', kind: 'foldingChair', variant: 0, w: 0.46, d: 0.5, h: 0.82, x: 1.2, y: SPEC.floorY, z: 0.3, q: [0, 0, 0, 1]};
    c.props.restoreProps([rec]);
    const w = enterStation(c, SUB());
    const train = c.rt.train!, boxes = new Set(train.layoutBoxes);
    expect(boxes.size).toBeGreaterThan(50);
    for (const b of boxes) expect(c.melt.protection(b)).toBe('train structure');
    const p = playerTrainPlacement(w.L)!;
    // a station prop pushed into the car (the state a shove leaves it in)
    const pushed = w.L.props.find(q => !q.cargo && c.melt.protection(q) === null && w.ph.dynamicItems.isDynamicProp(q) && q.h > 0.3 && q.h < 1.2 && instDrawn(w, q))!;
    const at = trainToWorld(p, -2.5, SPEC.floorY, 0);
    const to = new THREE.Matrix4().compose(new THREE.Vector3(at.x, at.y, at.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(1, 1, 1));
    const from = new THREE.Matrix4().compose(new THREE.Vector3(pushed.x, pushed.y, pushed.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pushed.rot), new THREE.Vector3(1, 1, 1));
    expect(w.ph.dynamicItems.adoptLoose(pushed, w.L.props.indexOf(pushed), from, to)).toBe(true);
    const carried = w.L.props.find(q => q.cargo === rec.id)!;
    expect(carried).toBeTruthy();
    // a disc over the whole car at its floor: no train box, every ref an eligible placement
    const mid = trainToWorld(p, 0, SPEC.floorY, 0);
    const refs = [...c.melt.inDisc(mid.x, p.floorY, mid.z, SPEC.length / 2 + 1)];
    for (const r of refs) {
      const q = propOf(w, r);
      expect(q, r.key).toBeTruthy();
      expect(boxes.has(q!), r.key).toBe(false);
      expect(c.melt.protection(q!), r.key).toBeNull();
    }
    const keys = refs.map(r => r.key);
    expect(keys).toContain(`p:${w.L.props.indexOf(pushed)}`);
    expect(keys).toContain(`c:${rec.id}`);
    // the canister touching the car anywhere sticks to nothing of the train
    let probes = 0;
    for (const b of train.layoutBoxes) {
      if (probes++ > 120) break;
      const r = c.melt.atPoint(b.x, b.y + b.h, b.z, 0.05);
      if (r) expect(boxes.has(propOf(w, r)!), r.key).toBe(false);
    }
    // both melt aboard: the carried one leaves the train's records for good, the pushed one its station
    const ra = refs.find(r => r.key === `c:${rec.id}`)!, rb = refs.find(r => r.key === `p:${w.L.props.indexOf(pushed)}`)!;
    expect(c.melt.start(ra)).toBe(true);
    expect(c.melt.start(rb)).toBe(true);
    expect(c.props.props().map(r => r.id)).not.toContain(rec.id);
    step(c, MELT.seconds + 0.2);
    expect(c.melt.alive(ra) || c.melt.alive(rb)).toBe(false);
    expect(w.ph.dynamicItems.loose().some(l => l.prop === carried || l.prop === pushed)).toBe(false);
    expect(salvageOf(c)).toHaveLength(2);
    leaveStation(c);
    expect(c.props.props().map(r => r.id)).not.toContain(rec.id);
    const lane = c.h.run.laneStore<StationPropsJSON>(STATION_PROPS_LANE, w.key);
    expect((lane?.here ?? []).map(r => r.id)).not.toContain(rec.id);
    expect(acidMeltedOf(c.h.run.laneStore(ACID_MELT_LANE, w.key)).gone).toEqual([{i: w.L.props.indexOf(pushed), kind: pushed.kind}]);
  }, 60000);

  it('a holder: exposure -> start -> completion exactly once; its lots spill on real floor; one salvage by trait; persisted; a rebuild from the JSON keeps it gone, nothing twice', () => {
    const {c, w} = station();
    const holders = w.L.props.filter(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && (w.cm.holderFor(p)?.state.lots.length ?? 0) >= 2 && lone(w, p));
    const H = holders[0];
    expect(H).toBeTruthy();
    const hi = w.L.props.indexOf(H), serial = w.cm.holderFor(H)!.serial;
    const lots = w.cm.holderFor(H)!.state.lots.map(l => ({itemId: canonicalItemId(l.itemId), count: l.count, id: l.id}));
    const ref = refOf(c, w, H);
    expect(ref.label.length).toBeGreaterThan(2);
    expect([ref.x, ref.y, ref.z]).toEqual([H.x, H.y, H.z]);
    // pool contact below MELT.exposure: nothing yet; past it: melting (idempotent from then on)
    expect(c.melt.expose(ref, MELT.exposure * 0.6)).toBe(true);
    expect((c.melt.qa() as {melting: unknown[]}).melting).toHaveLength(0);
    expect(c.melt.expose(ref, MELT.exposure * 0.6)).toBe(true);
    expect((c.melt.qa() as {melting: {key: string}[]}).melting.map(m => m.key)).toEqual([ref.key]);
    expect(c.melt.start(ref)).toBe(true);
    expect(c.melt.expose(ref, 1)).toBe(true);
    expect(c.melt.counts.started).toBe(1);
    expect(c.melt.inDisc(H.x, H.y, H.z, 0.3).map(r => r.key)).not.toContain(ref.key); // (melting: no longer a pool candidate)
    expect(c.melt.atPoint(H.x, H.y + H.h / 2, H.z, H.hx + 0.1)?.key).toBe(ref.key); // (the stuck canister stays on it while it dissolves)
    expect(c.melt.alive(ref)).toBe(true);
    // dissolving: drawn by its copy (the shared instances hidden), holder gone at once, collider until the end
    expect(instDrawn(w, H)).toBe(false);
    expect(w.pd.isRetired(H)).toBe(true);
    expect(w.cm.holderFor(H)?.state.lots ?? []).toEqual([]);
    expect(H.h).toBeGreaterThan(0.5);
    expect(c.h.scene.getObjectByName(`acid-melt:${ref.key}`)).toBeTruthy();
    step(c, MELT.seconds * 0.5);
    expect(salvageOf(c)).toHaveLength(0);
    step(c, MELT.seconds * 0.5 + 0.1);
    // gone, exactly once
    expect(c.melt.counts.completed).toBe(1);
    expect(H.h).toBe(0);
    expect(H.blocksSight).toBe(false);
    expect(c.h.scene.getObjectByName(`acid-melt:${ref.key}`)).toBeUndefined();
    for (const f of [() => c.melt.expose(ref, 5), () => c.melt.start(ref), () => c.melt.alive(ref), () => c.melt.where(ref, {x: 0, y: 0, z: 0})]) expect(f()).toBe(false);
    // the lots, as the game's spill makes them (same item / count, the lot as provenance), each on a real floor inside the footprint
    const spilled = pickupsOf(c).filter(p => p.fromLot?.holder === serial);
    expect(spilled.map(p => ({itemId: p.itemId, count: p.count, id: p.fromLot!.lot})).sort((a, b) => a.id - b.id)).toEqual(lots.sort((a, b) => a.id - b.id));
    for (const p of spilled) {
      expect(Math.abs(p.x - H.x) <= H.hx + 0.01 && Math.abs(p.z - H.z) <= H.hz + 0.01, `${p.itemId} at ${p.x},${p.z}`).toBe(true);
      expect(onFloor(c, p.x, p.y - 0.004, p.z), `${p.itemId} y ${p.y}`).toBe(true);
    }
    const salv = salvageOf(c);
    expect(salv).toHaveLength(1);
    expect(salv[0].itemId).toBe(propSalvage(H.kind));
    expect(salv[0].count).toBe(1);
    expect(onFloor(c, salv[0].x, salv[0].y - 0.004, salv[0].z)).toBe(true);
    // nothing more however long it runs / whatever clears it
    step(c, 3);
    c.melt.clear();
    expect(salvageOf(c)).toHaveLength(1);
    expect(c.melt.counts.completed).toBe(1);
    // persisted in the station's memory; a save's JSON rebuilds it gone — hidden, no holder, no collider, no second spill / salvage
    const stored = c.h.run.laneStore(ACID_MELT_LANE, w.key);
    expect(stored).toEqual({v: 1, gone: [{i: hi, kind: H.kind}]});
    const n0 = pickupsOf(c).length;
    expect(n0).toBe(lots.length + 1);
    leaveStation(c);
    c.h.run.setLaneStore(ACID_MELT_LANE, JSON.parse(JSON.stringify(stored)), w.key);
    const L2 = SUB(), w2 = enterStation(c, L2), H2 = L2.props[hi];
    expect(H2.kind).toBe(H.kind);
    expect(H2.h).toBe(0);
    expect(H2.blocksSight).toBe(false);
    expect(H2.cargoGone).toBe(true);
    expect(w2.cm.holderFor(H2)?.state.lots ?? []).toEqual([]);
    expect(instDrawn(w2, H2)).toBe(false);
    expect(c.melt.protection(H2)).toBe('gone');
    expect(c.melt.inDisc(H2.x, H2.y, H2.z, 0.5).map(r => r.key)).not.toContain(`p:${hi}`);
    expect(c.melt.counts.restored).toBe(1);
    expect(c.melt.counts.salvage).toBe(1);
    expect(pickupsOf(c)).toHaveLength(0); // (the harness keeps no pickup memory: the spill / salvage are never made again)
    step(c, 1);
    expect(pickupsOf(c)).toHaveLength(0);
  }, 60000);

  it('salvage by trait: a powered / electronic prop gives electrical parts, plain furniture scrap metal — one each, started by the canister', () => {
    const {c, w} = station();
    const elec = w.L.props.find(p => c.melt.protection(p) === null && propSalvage(p.kind) === ELECTRICAL_PARTS && lone(w, p))!;
    const plain = w.L.props.find(p => c.melt.protection(p) === null && propSalvage(p.kind) === SCRAP_METAL && !w.ph.dynamicItems.isDynamicProp(p) && lone(w, p) && p !== elec)!;
    expect(elec && plain).toBeTruthy();
    for (const p of [elec, plain]) {
      const r = c.melt.atPoint(p.x, p.y + p.h * 0.5, p.z, Math.max(p.hx, p.hz) + 0.05);
      expect(r, p.kind).toBeTruthy();
      expect(propOf(w, r!)).toBe(p);
      expect(c.melt.start(r!)).toBe(true);
    }
    step(c, MELT.seconds + 0.2);
    expect(salvageOf(c).map(s => s.itemId).sort()).toEqual([ELECTRICAL_PARTS, SCRAP_METAL].sort());
    expect(c.melt.counts.salvage).toBe(2);
  }, 60000);

  it('clear() mid-melt (and with melts still queued beyond the visual cap) completes each exactly once; visuals dropped; persisted', () => {
    const {c, w} = station();
    const picks = w.L.props.filter(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && lone(w, p)).slice(0, MELT.maxActive + 3);
    expect(picks).toHaveLength(MELT.maxActive + 3);
    const refs = picks.map(p => refOf(c, w, p));
    for (const r of refs) expect(c.melt.start(r)).toBe(true);
    const qa0 = c.melt.qa() as {melting: {slot: number}[]};
    expect(qa0.melting.filter(m => m.slot >= 0)).toHaveLength(MELT.maxActive);
    expect(qa0.melting.filter(m => m.slot < 0)).toHaveLength(3);
    step(c, MELT.seconds * 0.4);
    expect(c.melt.counts.completed).toBe(0);
    c.melt.clear();
    expect(c.melt.counts.completed).toBe(picks.length);
    expect(salvageOf(c)).toHaveLength(picks.length);
    for (const p of picks) expect(p.h).toBe(0);
    expect(c.melt.group.children.filter(o => o.name.startsWith('acid-melt:'))).toHaveLength(0);
    let roots = 0;
    c.h.scene.traverse(o => { if (o.name.startsWith('acid-melt:')) roots++; });
    expect(roots).toBe(0);
    expect(acidMeltedOf(c.h.run.laneStore(ACID_MELT_LANE, w.key)).gone.map(g => g.i).sort((a, b) => a - b)).toEqual(picks.map(p => w.L.props.indexOf(p)).sort((a, b) => a - b));
    // the teardown's clear (Game.leaveSection) adds nothing
    step(c, 1);
    leaveStation(c);
    expect(c.melt.counts.completed).toBe(picks.length);
    expect(c.melt.counts.salvage).toBe(picks.length);
  }, 60000);

  it('the teardown completes a melt in progress (leaving the station mid-dissolve): spilled, salvaged and persisted once', () => {
    const {c, w} = station();
    const H = w.L.props.find(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && (w.cm.holderFor(p)?.state.lots.length ?? 0) >= 1 && lone(w, p))!;
    const lots = w.cm.holderFor(H)!.state.lots.length;
    expect(c.melt.start(refOf(c, w, H))).toBe(true);
    step(c, 0.5);
    let seen = -1;
    c.h.sectionHooks.push({teardown: () => { seen = pickupsOf(c).length; }}); // (a later lane's teardown — the memory save — sees the spill)
    leaveStation(c);
    expect(seen).toBe(lots + 1);
    expect(c.melt.counts.completed).toBe(1);
    expect(acidMeltedOf(c.h.run.laneStore(ACID_MELT_LANE, w.key)).gone).toEqual([{i: w.L.props.indexOf(H), kind: H.kind}]);
  }, 60000);

  it('pickups resting on a melted surface fall to the floor below (never float); before it melts they stay put', () => {
    const {c, w} = station();
    const T = w.L.props.find(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && !w.cm.holderFor(p) && p.h > 0.4 && p.h < 1.1 && p.hx > 0.3 && p.hz > 0.25 && lone(w, p))!;
    expect(T).toBeTruthy();
    const top = T.y + T.h, floor = c.h.levels!.supportAt(T.x, T.z, T.y + 0.05, 0.35)!.floor;
    const st = c.h.inv.makeStack('medkit', 1);
    c.pickups.add(st, T.x, top + 0.004, T.z, 0.3);
    const pk = c.pickups.list.find(p => p.stack === st)!;
    step(c, 0.5);
    expect(pk.obj.position.y).toBeCloseTo(top + 0.004, 2);
    expect(c.melt.start(refOf(c, w, T))).toBe(true);
    step(c, MELT.seconds + 0.1);
    expect(T.h).toBe(0);
    step(c, 2.5);
    expect(pk.obj.position.y, `${T.kind}: top ${top} floor ${floor}`).toBeLessThan(floor + 0.2);
    expect(pk.obj.position.y).toBeGreaterThan(floor - 0.05);
    expect(c.pickups.list.filter(p => p.stack.uid === st.uid)).toHaveLength(1);
  }, 60000);

  it('a loose prop melts where it lies (its body withdrawn), salvage at its new place', () => {
    const {c, w} = station();
    const B = w.L.props.find(p => c.melt.protection(p) === null && w.ph.dynamicItems.isDynamicProp(p) && p.h > 0.3 && instDrawn(w, p) && lone(w, p))!;
    const i = w.L.props.indexOf(B);
    expect(w.ph.dynamicItems.shootProp(B, i, new THREE.Vector3(B.x, B.y + B.h * 0.5, B.z), new THREE.Vector3(1, 0, 0), 30)).toBe(true);
    step(c, 3);
    const m = new THREE.Matrix4();
    expect(w.ph.dynamicItems.propMatrix(B, m)).toBe(true);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const r = c.melt.inDisc(pos.x, pos.y, pos.z, 0.2).find(x => x.key === `p:${i}`)!;
    expect(r).toBeTruthy();
    const where = {x: 0, y: 0, z: 0};
    expect(c.melt.where(r, where)).toBe(true);
    expect(Math.hypot(where.x - pos.x, where.z - pos.z)).toBeLessThan(0.6);
    expect(c.melt.start(r)).toBe(true);
    expect(w.ph.dynamicItems.loose().some(l => l.prop === B)).toBe(false);
    step(c, MELT.seconds + 0.1);
    const s = salvageOf(c);
    expect(s).toHaveLength(1);
    expect(Math.hypot(s[0].x - pos.x, s[0].z - pos.z)).toBeLessThan(0.8);
    expect(acidMeltedOf(c.h.run.laneStore(ACID_MELT_LANE, w.key)).gone).toEqual([{i, kind: B.kind}]);
  }, 60000);
});
