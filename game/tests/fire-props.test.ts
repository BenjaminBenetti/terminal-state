// Task studio-flamethrower-fire-20261114-031614-01 (user: "Damage player, zombies and exposed world props (not only movable/cargo
// props); protect train structure and ALL fixed fixtures. Preserve contents/UIDs when props burn out. No unrequested acid-salvage
// windfalls"): FIRE BURNS WORLD PROPS OUT through the melt engine (world/acidMelt.ts start(ref, 'fire')) over the REAL station build
// (helpers/acidMeltHost.ts: buildWorld, physics, damage, containers, pickups, the parked train, equipment, fuel carts), with the real
// fire rules (fire/fireSystem.ts) wired as the Game wires them (the bullet ray, Levels floor / sight):
//  - a holder set alight burns PROP_FIRE.burnSeconds, then is gone: its lots lie on real floor with their provenance, NO salvage, the
//    same record lane — a rebuild keeps it gone, nothing twice; clear() / the teardown complete a burn once;
//  - a chest burning spills the SAME ItemStack objects (uid / mag / a fuel tank's own fuel); a fuel cart every unit as cans; no salvage;
//  - end to end: the real stream on a real prop — it catches, burns out, leaves embers; `busy` / `burningOut` meanwhile (no save);
//  - what the acid may not melt, fire does not burn: the train's own boxes, building structure, objectives — fire only clings to them;
//  - the look: a charring ember-lit shell (no acid tint, no bubbles), the slot's acid look back for the next dissolve.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {EQUIPMENT} from '../src/craft/equipment';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {canonicalItemId} from '../src/items/calibers';
import {FUEL} from '../src/fuel/fuel';
import type {ItemStack, StackJSON} from '../src/items/inventory';
import {raycastShot} from '../src/physics/merchOnHost';
import {ACID_MELT_LANE, acidMeltedOf} from '../src/run/acidMeltRecord';
import {BURN, MELT, type MeltRef} from '../src/world/acidMelt';
import {refusalShort} from '../src/world/trainSaveTerminal';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {FIRE_PATCH, FLAME_FUEL, FUEL_TANK_ID, PROP_FIRE} from '../src/fire/flamethrowerSpec';
import {FireSystem, type V3} from '../src/fire/fireSystem';
import {stationRec} from './helpers/trainEquipmentHost';
import {enterStation, leaveStation, meltStation, pickupsOf, step, type MeltRig, type MeltWorld} from './helpers/acidMeltHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const SALVAGE = new Set<string>([ELECTRICAL_PARTS, SCRAP_METAL]);
const salvageOf = (c: MeltRig) => pickupsOf(c).filter(p => SALVAGE.has(p.itemId));
const BURN_S = PROP_FIRE.burnSeconds;

function station(o: Parameters<typeof meltStation>[1] = {}): {c: MeltRig; w: MeltWorld} {
  const c = meltStation(SUB(), o);
  live.push(c.rt);
  const w = enterStation(c, SUB());
  return {c, w};
}

function refOf(c: MeltRig, w: MeltWorld, p: PropPlacement): MeltRef {
  const i = w.L.props.indexOf(p);
  const r = c.melt.inDisc(p.x, p.y, p.z, 0.2).find(x => x.key === `p:${i}`);
  if (!r) throw new Error(`no ref for ${p.kind} #${i}`);
  return r;
}
function lone(w: MeltWorld, p: PropPlacement): boolean {
  const i = w.L.props.indexOf(p), top = p.y + p.h;
  return !w.L.props.some(q => q !== p && (q.host === i || (Math.abs(q.y - top) < 0.08 && Math.abs(q.x - p.x) < q.hx + p.hx && Math.abs(q.z - p.z) < q.hz + p.hz)));
}
function onFloor(c: MeltRig, x: number, y: number, z: number): boolean {
  const s = c.h.levels!.supportAt(x, z, y + 0.05, 0.35);
  return !!s && Math.abs(y - s.floor) < 0.02;
}

/** The fire rules over the rig's live world, wired as Game wires them. */
function fireOf(c: MeltRig, w: MeltWorld): FireSystem {
  const sys = new FireSystem();
  sys.env = {
    ray: (o, d, max) => raycastShot(c.h.levels!, w.L.props, o, d, max, w.L.trench.floorY),
    los: (a, b) => c.h.levels!.lineOfSight(a, b),
    floorAt: (x, z, y) => { const s = c.h.levels!.supportAt(x, z, y + 0.05, 0.35); return s && Number.isFinite(s.floor) ? s.floor : null; },
    melt: () => c.melt,
    rand: () => 0.5,
  };
  return sys;
}
/** Frames of the world + the melt + the fire; `spray`: a paid tick of stream every FLAME_FUEL.unitSeconds along (eye, dir). */
function burn(c: MeltRig, sys: FireSystem, seconds: number, spray?: {eye: V3; dir: V3}): void {
  const dt = 1 / 30;
  let owed = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    if (spray) { owed += dt; while (owed >= FLAME_FUEL.unitSeconds) { owed -= FLAME_FUEL.unitSeconds; sys.flame(spray.eye, spray.dir, FLAME_FUEL.unitSeconds); } }
    c.world?.ph.update(dt);
    c.melt.tick(dt);
    sys.tick(dt);
  }
}
/** An eye 2.2 m out from one of a prop's sides whose aim ray (to the prop's middle) meets THAT prop first; null: no clear side. */
function aimAt(c: MeltRig, w: MeltWorld, p: PropPlacement): {eye: V3; dir: V3} | null {
  const i = w.L.props.indexOf(p), ty = p.y + Math.min(p.h * 0.6, 0.9);
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const eye = {x: p.x + sx * (p.hx + 2.2), y: ty + 0.5, z: p.z + sz * (p.hz + 2.2)};
    if (c.h.levels!.supportAt(eye.x, eye.z, p.y + 0.05, 0.35) === null) continue;
    const l = Math.hypot(p.x - eye.x, ty - eye.y, p.z - eye.z), dir = {x: (p.x - eye.x) / l, y: (ty - eye.y) / l, z: (p.z - eye.z) / l};
    const hit = raycastShot(c.h.levels!, w.L.props, eye, dir, 8, w.L.trench.floorY);
    if (hit.kind === 'prop' && hit.prop === i) return {eye, dir};
  }
  return null;
}

describe('fire burns world props out through the melt engine', () => {
  it('a holder: burns PROP_FIRE.burnSeconds, then gone exactly once — lots spilled on real floor with provenance, NO salvage, persisted; a rebuild keeps it gone', () => {
    const {c, w} = station();
    const H = w.L.props.filter(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && (w.cm.holderFor(p)?.state.lots.length ?? 0) >= 2 && lone(w, p))[0];
    expect(H).toBeTruthy();
    const hi = w.L.props.indexOf(H), serial = w.cm.holderFor(H)!.serial;
    const lots = w.cm.holderFor(H)!.state.lots.map(l => ({itemId: canonicalItemId(l.itemId), count: l.count, id: l.id}));
    const ref = refOf(c, w, H);
    expect(c.melt.causeOf(ref)).toBeNull();
    expect(c.melt.start(ref, 'fire')).toBe(true);
    expect(c.melt.causeOf(ref)).toBe('fire');
    expect(c.melt.start(ref)).toBe(true); // (acid on a burning prop: it is already going — still a burn, no second melt)
    expect(c.melt.causeOf(ref)).toBe('fire');
    expect(c.melt.counts.started).toBe(1);
    expect([c.melt.busy, c.melt.burningOut]).toEqual([true, true]);
    const b = c.melt.burning();
    expect(b).toHaveLength(1);
    expect(b[0].ref).toBe(ref);
    expect(b[0].seconds).toBe(BURN_S);
    expect([b[0].box.min.y, b[0].box.max.y]).toEqual([H.y, H.y + H.h]);
    // it burns longer than a dissolve takes: still standing (collider kept), nothing spilled yet
    step(c, MELT.seconds + 0.5);
    expect(BURN_S).toBeGreaterThan(MELT.seconds + 0.6);
    expect(c.melt.counts.completed).toBe(0);
    expect(H.h).toBeGreaterThan(0.5);
    expect(pickupsOf(c)).toHaveLength(0);
    expect(c.melt.burning()[0].age).toBeGreaterThan(MELT.seconds);
    step(c, BURN_S - MELT.seconds);
    expect(c.melt.counts.completed).toBe(1);
    expect([H.h, H.blocksSight, H.cargoGone]).toEqual([0, false, true]);
    expect([c.melt.busy, c.melt.burningOut, c.melt.burning().length]).toEqual([false, false, 0]);
    expect(c.melt.alive(ref)).toBe(false);
    // the contents, as the game's spill makes them: same items / counts, the lot as provenance, on real floor in its footprint
    const all = pickupsOf(c);
    const spilled = all.filter(p => p.fromLot?.holder === serial);
    expect(spilled.map(p => ({itemId: p.itemId, count: p.count, id: p.fromLot!.lot})).sort((a, b2) => a.id - b2.id)).toEqual(lots.sort((a, b2) => a.id - b2.id));
    for (const p of spilled) {
      expect(Math.abs(p.x - H.x) <= H.hx + 0.01 && Math.abs(p.z - H.z) <= H.hz + 0.01, `${p.itemId} at ${p.x},${p.z}`).toBe(true);
      expect(onFloor(c, p.x, p.y - 0.004, p.z), `${p.itemId} y ${p.y}`).toBe(true);
    }
    // NO salvage: nothing but the contents lies there, and no salvage item was made at all
    expect(all).toHaveLength(lots.length);
    expect(salvageOf(c)).toHaveLength(0);
    expect(c.melt.counts.salvage).toBe(0);
    expect(c.melt.counts.burned).toBe(1);
    // gone is gone, whatever destroyed it: the same record; a rebuild from the JSON keeps it gone, no second spill
    step(c, 2);
    c.melt.clear();
    expect(pickupsOf(c)).toHaveLength(lots.length);
    const stored = c.h.run.laneStore(ACID_MELT_LANE, w.key);
    expect(stored).toEqual({v: 1, gone: [{i: hi, kind: H.kind}]});
    leaveStation(c);
    c.h.run.setLaneStore(ACID_MELT_LANE, JSON.parse(JSON.stringify(stored)), w.key);
    const L2 = SUB(), w2 = enterStation(c, L2), H2 = L2.props[hi];
    expect([H2.kind, H2.h, H2.cargoGone]).toEqual([H.kind, 0, true]);
    expect(w2.cm.holderFor(H2)?.state.lots ?? []).toEqual([]);
    expect(c.melt.protection(H2)).toBe('gone');
    expect(c.melt.inDisc(H2.x, H2.y, H2.z, 0.5).map(r => r.key)).not.toContain(`p:${hi}`);
    expect(pickupsOf(c)).toHaveLength(0);
    expect(c.melt.counts.salvage).toBe(0);
  }, 60000);

  it('an acid melt beside a burn keeps its salvage: exactly one for the dissolved prop, none for the burnt one', () => {
    const {c, w} = station();
    const pair = w.L.props.filter(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && p.h > 0.3 && lone(w, p) && !w.cm.holderFor(p)).slice(0, 2);
    expect(pair).toHaveLength(2);
    expect(c.melt.start(refOf(c, w, pair[0]))).toBe(true);
    expect(c.melt.start(refOf(c, w, pair[1]), 'fire')).toBe(true);
    step(c, BURN_S + 0.2);
    expect(c.melt.counts.completed).toBe(2);
    expect(c.melt.counts.salvage).toBe(1);
    const s = salvageOf(c);
    expect(s).toHaveLength(1);
    expect(Math.hypot(s[0].x - pair[0].x, s[0].z - pair[0].z)).toBeLessThan(Math.hypot(s[0].x - pair[1].x, s[0].z - pair[1].z));
    expect(acidMeltedOf(c.h.run.laneStore(ACID_MELT_LANE, w.key)).gone.map(g => g.i).sort((a, b) => a - b)).toEqual(pair.map(p => w.L.props.indexOf(p)).sort((a, b) => a - b));
  }, 60000);

  it('clear() mid-burn and the teardown complete a burn exactly once: contents out, no salvage, recorded', () => {
    const {c, w} = station();
    const hs = w.L.props.filter(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && (w.cm.holderFor(p)?.state.lots.length ?? 0) >= 1 && lone(w, p)).slice(0, 2);
    expect(hs).toHaveLength(2);
    const lots = hs.map(h => w.cm.holderFor(h)!.state.lots.length);
    expect(c.melt.start(refOf(c, w, hs[0]), 'fire')).toBe(true);
    step(c, 1);
    let outs = 0;
    c.melt.fire = {out: () => { outs++; }};
    c.melt.clear();
    expect(c.melt.counts.completed).toBe(1);
    expect(outs).toBe(0); // (a burn completed by clear() raises no burn-out cue: nothing is spawned into a world being left)
    expect(pickupsOf(c)).toHaveLength(lots[0]);
    expect(hs[0].h).toBe(0);
    expect(c.melt.start(refOf(c, w, hs[1]), 'fire')).toBe(true);
    step(c, 1);
    leaveStation(c);
    expect(c.melt.counts.completed).toBe(2);
    expect(c.melt.counts.salvage).toBe(0);
    expect(acidMeltedOf(c.h.run.laneStore(ACID_MELT_LANE, w.key)).gone).toHaveLength(2);
  }, 60000);

  it('the look: a charring, ember-lit shell that stands and then collapses — no acid tint, no bubbles; the slot is acid again for the next dissolve', () => {
    const {c, w} = station();
    const [A, B] = w.L.props.filter(p => c.melt.protection(p) === null && !w.ph.dynamicItems.isDynamicProp(p) && p.h > 0.8 && lone(w, p) && (w.pd.index.inst.get(p)?.length ?? 0) > 0);
    const ref = refOf(c, w, A);
    const cues: string[] = [];
    c.melt.fizz = () => { cues.push('fizz'); };
    c.melt.fire = {ignite: b => { cues.push(`ignite ${b.ref.key}`); }, out: b => { cues.push(`out ${b.ref.key}`); }};
    expect(c.melt.start(ref, 'fire')).toBe(true);
    expect(cues).toEqual([`ignite ${ref.key}`]); // (the fire's own cue, not the acid's fizz)
    step(c, BURN_S * 0.5);
    const root = c.h.scene.getObjectByName(`acid-melt:${ref.key}`)!;
    const shells: THREE.Mesh[] = [];
    root.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name === 'acid-melt-shell') shells.push(o as THREE.Mesh); });
    expect(shells.length).toBeGreaterThan(0);
    const shell = shells[0].material as THREE.MeshStandardMaterial;
    expect(shell.color.getHex()).toBe(BURN.color);
    expect(shell.emissive.getHex()).toBe(BURN.glow);
    expect(shell.emissive.r).toBeGreaterThan(shell.emissive.g * 2); // (ember red-orange, never green)
    expect(Math.max(shell.color.r, shell.color.g, shell.color.b)).toBeLessThan(0.1); // (char)
    expect(shell.opacity).toBeGreaterThan(0.5);
    const s = new THREE.Vector3();
    root.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.y).toBeCloseTo(1, 3); // (it stands while it burns ...)
    const bubbles = c.melt.group.getObjectByName('acid-melt-bubbles') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    for (let i = 0; i < bubbles.count; i++) { bubbles.getMatrixAt(i, m); expect(m.determinant()).toBe(0); }
    step(c, BURN_S * 0.42);
    root.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.y).toBeLessThan(0.5); // (... and collapses at the end)
    expect(s.y).toBeGreaterThan(BURN.sag);
    step(c, BURN_S * 0.1);
    expect(cues).toEqual([`ignite ${ref.key}`, `out ${ref.key}`]);
    expect(c.h.scene.getObjectByName(`acid-melt:${ref.key}`)).toBeUndefined();
    // the next melt in that slot is the acid's again
    const ref2 = refOf(c, w, B);
    expect(c.melt.start(ref2)).toBe(true);
    step(c, MELT.seconds * 0.5);
    const root2 = c.h.scene.getObjectByName(`acid-melt:${ref2.key}`)!;
    let acid: THREE.MeshStandardMaterial | null = null;
    root2.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name === 'acid-melt-shell') acid = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; });
    expect(acid!.color.getHex()).toBe(MELT.color);
    expect(acid!.emissive.getHex()).toBe(MELT.glow);
    expect(acid!.emissiveIntensity).toBe(0.8);
    expect(acid!.roughness).toBe(0.32);
    expect(cues).toEqual([`ignite ${ref.key}`, `out ${ref.key}`, 'fizz']);
  }, 60000);
});

describe('fire: crafted equipment and fuel carts burn out with everything they hold', () => {
  function world() {
    const L0 = SUB(), p = playerTrainPlacement(L0)!;
    const at = (lx: number) => trainToWorld(p, lx, SPEC.floorY, -3);
    const chestSlots = new Array<StackJSON | null>(EQUIPMENT.chest.slots).fill(null);
    chestSlots[0] = {uid: 9001, itemId: 'pistol', count: 1, mag: 3};
    chestSlots[7] = {uid: 9002, itemId: 'medkit', count: 2};
    const c = meltStation(L0, {here: [stationRec('chest', 1, at(1.5).x, p.floorY, at(1.5).z, 0, p.level, {slots: chestSlots})]});
    live.push(c.rt);
    const w = enterStation(c, SUB());
    const cw = trainToWorld(p, -3.5, SPEC.floorY, -2.8);
    c.carts.spawn({uid: 'cart:A', units: 5, x: cw.x, y: c.h.levels!.floorAt(cw.x, cw.z, p.floorY + 0.3), z: cw.z, yaw: Math.atan2(0, -p.platformSide), level: p.level});
    return {c, w, p};
  }

  it('a chest: the SAME stack objects come out (uid / mag / count — and a stored fuel tank with its own fuel); no salvage', () => {
    const {c} = world();
    const u = c.eq.units().find(x => x.uid === 'eq-1')!;
    const tank = c.h.inv.makeStack(FUEL_TANK_ID, 1);
    tank.fuel = 137;
    u.store!.slots[3] = tank;
    const held = u.store!.slots.filter((s): s is ItemStack => !!s);
    expect(held).toHaveLength(3);
    const r = c.melt.inDisc(u.body.x, u.body.y, u.body.z, 0.1).find(x => x.key === 'eq:eq-1')!;
    expect(c.melt.start(r, 'fire')).toBe(true);
    expect(c.eq.units().some(x => x.uid === 'eq-1')).toBe(false);
    expect(c.melt.burning().map(b => b.ref.key)).toEqual(['eq:eq-1']);
    step(c, BURN_S + 0.1);
    const got = pickupsOf(c);
    expect(got).toHaveLength(3);
    for (const s of held) expect(got.find(p => p.stack === s), `uid ${s.uid}`).toBeTruthy();
    expect(got.find(p => p.uid === 9001)?.mag).toBe(3);
    expect(got.find(p => p.stack === tank)!.stack.fuel).toBe(137);
    expect(new Set(got.map(p => p.uid)).size).toBe(3);
    expect(salvageOf(c)).toHaveLength(0);
    expect(c.melt.counts.salvage).toBe(0);
  }, 60000);

  it('a fuel cart: every unit comes out as a single fuel can, nothing rounded, nothing extra; no salvage', () => {
    const {c} = world();
    const cart = c.carts.bodies().find(x => x.uid === 'cart:A')!;
    const r = c.melt.inDisc(cart.body.x, cart.body.y, cart.body.z, 0.2).find(x => x.key === 'cart:cart:A')!;
    expect(c.melt.start(r, 'fire')).toBe(true);
    step(c, BURN_S + 0.1);
    const got = pickupsOf(c);
    expect(got.every(p => p.itemId === FUEL.canItem)).toBe(true);
    expect(got.map(p => p.count)).toEqual([1, 1, 1, 1, 1]);
    expect(got.reduce((n, p) => n + p.count * FUEL.canUnits, 0)).toBe(5);
    expect(c.melt.counts.salvage).toBe(0);
    expect(c.carts.all().some(x => x.uid === 'cart:A')).toBe(false);
  }, 60000);
});

describe('fire: the real stream in the real station', () => {
  it('end to end: the stream on a prop — fire clings to it, it catches, burns out (no save meanwhile), leaves embers that go out; no salvage', () => {
    const {c, w} = station();
    let P: PropPlacement | null = null, aim: {eye: V3; dir: V3} | null = null;
    for (const p of w.L.props) {
      if (c.melt.protection(p) !== null || w.ph.dynamicItems.isDynamicProp(p) || p.h < 0.6 || p.mounted || !lone(w, p) || w.cm.holderFor(p)) continue;
      aim = aimAt(c, w, p);
      if (aim) { P = p; break; }
    }
    expect(P && aim).toBeTruthy();
    const sys = fireOf(c, w), key = `p:${w.L.props.indexOf(P!)}`;
    burn(c, sys, 0.6, aim!);
    // fire on the prop's face, clinging to THAT prop (it would follow it)
    const on = sys.patches.filter(p => p.ref?.key === key);
    expect(on.length).toBeGreaterThanOrEqual(1);
    expect(on[0].face).toBe('wall');
    expect(c.melt.counts.started).toBe(0);
    burn(c, sys, PROP_FIRE.catchSeconds + 0.4, aim!);
    expect(sys.counts.propsCaught).toBe(1);
    expect(c.melt.counts.started).toBe(1);
    expect((c.melt.qa() as {melting: {key: string; cause: string}[]}).melting).toMatchObject([{key, cause: 'fire'}]);
    expect([c.melt.busy, c.melt.burningOut]).toEqual([true, true]);
    expect(refusalShort({ok: false, code: 'fire', error: 'Not saved: something is still burning out — save in a moment.'})).toMatch(/burning/);
    expect(sys.burns.map(b => b.ref.key)).toEqual([key]);
    // no more stream: it burns out on its own, exactly once
    burn(c, sys, PROP_FIRE.burnSeconds + 0.3);
    expect(c.melt.counts.completed).toBe(1);
    expect(sys.counts.propsOut).toBe(1);
    expect(P!.h).toBe(0);
    expect(c.melt.counts.salvage).toBe(0);
    expect(pickupsOf(c)).toHaveLength(0);
    expect(c.melt.busy).toBe(false);
    // the fire that clung to it fell as embers; everything is out a little later, and the system idles
    expect(sys.patches.every(p => p.ref === null && p.face === 'floor')).toBe(true);
    burn(c, sys, FIRE_PATCH.life + 1);
    expect(sys.patches).toHaveLength(0);
    expect(sys.active).toBe(false);
    expect(c.melt.counts.started).toBe(1); // (the embers set nothing else alight)
  }, 60000);

  it('the train\'s own boxes, building structure and objectives never burn: fire only clings to them and goes out', () => {
    const {c, w} = station();
    const sys = fireOf(c, w);
    const boxes = c.rt.train!.layoutBoxes;
    expect(boxes.length).toBeGreaterThan(50);
    const guarded = [
      ...boxes.filter(b => b.h > 1).slice(0, 3),
      ...w.L.props.filter(p => c.melt.protection(p) === 'building structure' && p.h > 1).slice(0, 3),
    ];
    let sprayed = 0;
    for (const p of guarded) {
      expect(c.melt.protection(p)).not.toBeNull();
      const aim = aimAt(c, w, p);
      if (!aim) continue;
      sprayed++;
      const h0 = p.h;
      burn(c, sys, PROP_FIRE.catchSeconds * 3, aim);
      burn(c, sys, 1);
      expect(sys.patches.length, p.kind).toBeGreaterThanOrEqual(1); // (it clings: the surface burns)
      expect(sys.patches.every(q => q.ref === null), p.kind).toBe(true);
      expect(p.h, p.kind).toBe(h0);
      burn(c, sys, FIRE_PATCH.life + 1);
    }
    expect(sprayed).toBeGreaterThanOrEqual(2);
    expect(c.melt.counts.started).toBe(0);
    expect(sys.counts.propsCaught).toBe(0);
    expect(c.melt.busy).toBe(false);
    for (const b of boxes) expect(c.melt.protection(b)).toBe('train structure');
    // the seam hands fire nothing it may not burn, anywhere in the station: no ref ever names a protected prop
    const safe = new Set(w.L.props.map((p, i) => (c.melt.protection(p) !== null ? `p:${i}` : '')).filter(Boolean));
    expect(safe.size).toBeGreaterThan(20);
    for (const p of w.L.props) {
      for (const r of c.melt.inDisc(p.x, p.y, p.z, Math.max(p.hx, p.hz) + 0.4)) expect(safe.has(r.key), `${p.kind} -> ${r.key}`).toBe(false);
      const r = c.melt.atPoint(p.x, p.y + p.h / 2, p.z, 0.3);
      if (r) expect(safe.has(r.key), `${p.kind} -> ${r.key}`).toBe(false);
    }
  }, 120000);
});
