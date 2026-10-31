// Iteration 08 (USER-UPDATE-01, Lane I): openable loot holders — lids / doors / drawers / sliding panes on the existing holder
// model (world/openables.ts, world/openablesSpec.ts, world/containers.ts). "Make everything that is reasonably interactable,
// interactable. i.e. Opening things. For example garbage cans."
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels, rowLayout} from './helpers/openablesFixture';
import {FIX, levelFixture} from './helpers/levelFixture';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../src/gen/props';
import {generateStation} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {HOLDER_LABEL, isLootHolderKind, type Lot} from '../src/items/loot';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type ContainerEvent, type Holder} from '../src/world/containers';
import {FitIndex, SoundGate, blockedAt, partLocalMatrix} from '../src/world/openables';
import {OPENABLE_AUDIT, OPENABLE_CONTAINER_KINDS, OPENABLE_KINDS, isSpillHolderKind, openableSpec} from '../src/world/openablesSpec';
import {PhysicsSystem} from '../src/physics/world';
import {SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import type {StationLayout} from '../src/gen/station';

installCanvasShim(false);
// the shim has no clip(); item stand-in label atlases use it
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
let models: Record<string, GLTF> = {};
beforeAll(async () => { models = await openableModels(); }, 120000);

function manager(m: Record<string, GLTF | undefined>, inv = new Inventory()) {
  const events: ContainerEvent[] = [];
  const cm = new ContainerManager(m, mats, () => inv);
  cm.onEvent = e => events.push(e);
  return {cm, inv, events};
}
const settle = (cm: ContainerManager, s = 1.2) => { for (let t = 0; t < s; t += 1 / 60) cm.update(1 / 60, t); };
const lotsKey = (h: Holder) => JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count, l.part, l.surface, +l.x.toFixed(4), +l.y.toFixed(4), +l.z.toFixed(4)]));
const target = (h: Holder, part: number, lot: Lot | null = null) => ({container: h, t: 1, lot, part});
/** Seeds with every openable kind between them (incl. upper / lower storeys). Layouts are generated once (read-only here). */
const SEEDS = [1, 2, 3, 24839, 424242];
const layouts = new Map<number, StationLayout>();
const station = (seed: number) => { let l = layouts.get(seed); if (!l) layouts.set(seed, (l = generateStation(seed))); return l; };

describe('every loot-holder kind builds (no kind falls into the wrong model path)', () => {
  const kinds = (Object.keys(PROP_DEFS) as PropKind[]).filter(k => isLootHolderKind(k));
  for (const variant of ['no models', 'runtime models'] as const) {
    it(`${variant}: one placement of each of the ${kinds.length} holder kinds`, () => {
      const {cm} = manager(variant === 'no models' ? {} : models);
      expect(() => cm.build(rowLayout(kinds))).not.toThrow();
      expect(cm.all.length).toBe(kinds.length);
      for (const h of cm.all) expect(HOLDER_LABEL[h.kind], h.kind).toBeTruthy();
      // new container kinds are always openable; existing surface holders only with their model (else unchanged)
      for (const k of OPENABLE_KINDS) {
        const h = cm.all.find(x => x.kind === k)!;
        const spec = openableSpec(k)!;
        const active = spec.group === 'container' || !spec.model || variant === 'runtime models';
        expect(!!h.open, `${k} openable (${variant})`).toBe(active);
      }
      expect(() => { settle(cm, 0.2); cm.clear(); }).not.toThrow();
    });
  }
});

describe('every openable kind: holder, readable prompt, moving part, interior', () => {
  it('lid / door / drawer geometry (derived from the model or authored), prompt text and revealed interior per part', () => {
    const {cm} = manager(models);
    cm.build(rowLayout(OPENABLE_KINDS, {seed: 11}));
    for (const k of OPENABLE_KINDS) {
      const h = cm.all.find(x => x.kind === k)!;
      const spec = openableSpec(k)!;
      expect(h.open, k).toBeTruthy();
      const rt = h.open!;
      expect(rt.parts.length, k).toBe(spec.parts.length);
      if (spec.model) expect(rt.model.source, k).toMatch(/runtime split/);
      rt.model.parts.forEach((pm, i) => {
        const ps = spec.parts[i];
        const verts = pm.moving.reduce((n, q) => n + q.geo.attributes.position.count, 0);
        expect(verts, `${k} part ${i} moving geometry`).toBeGreaterThan(ps.region ? 30 : 7);
        expect(pm.bounds.isEmpty(), `${k} part ${i} bounds`).toBe(false);
        // something is revealed behind / inside every part (authored liner / tray / fill / plate, or the model's own interior)
        const revealed = pm.inner.length + pm.tray.length + pm.plate.length;
        // task office-interactions-layout-20261030 (lane OPEN), deliberate: a part without a compartment of its own names its fixture
        // contents (the server cabinet's glass doors: racked servers); a cavityHidden compartment shows the model's own cleared
        // interior (the specimen fridge: replaceInterior) instead of an authored liner.
        if (!ps.surfaces.length && !ps.holdsExposed && ps.contents) expect(ps.contents.length, `${k} part ${i} fixture contents`).toBeGreaterThan(5);
        else if (ps.cavityHidden && (ps.replaceInterior || ps.modelInterior)) expect(ps.surfaces.length, `${k} part ${i} cleared / modelled compartment`).toBeGreaterThan(0); // + lane RACK (office-props-physics-scale-20261030): the rack's modelled shelves
        else if (spec.loot || ps.surfaces.length) expect(revealed, `${k} part ${i} interior`).toBeGreaterThan(0);
        else expect(spec.contents || ps.holdsExposed, `${k} fixture contents`).toBeTruthy();
        const pr = cm.prompt(target(h, i));
        expect(pr.startsWith(`<b>[E]</b> Open ${ps.name}`), `${k} prompt ${pr}`).toBe(true); // glass doors add "(n items inside)"
      });
    }
    // HUD wording on representative kinds
    expect(cm.prompt(target(cm.all.find(x => x.kind === 'bin')!, 0))).toBe('<b>[E]</b> Open trash can');
    expect(cm.prompt(target(cm.all.find(x => x.kind === 'filingCabinet')!, 3))).toBe('<b>[E]</b> Open top drawer');
    expect(cm.prompt(target(cm.all.find(x => x.kind === 'staffLockers')!, 0))).toBe('<b>[E]</b> Open left locker');
  });

  it('every inner plate stays inside its leaf\'s outline (round lids: a disc inside the rim; doors: their rectangle inset)', () => {
    const {cm} = manager(models);
    cm.build(rowLayout(OPENABLE_KINDS, {seed: 3}));
    const rc = new THREE.Raycaster();
    const two = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
    let plates = 0;
    for (const h of cm.openList) {
      h.open!.model.parts.forEach((pm, i) => {
        if (!pm.plate.length) return;
        const leaf = pm.moving.map(q => new THREE.Mesh(q.geo, two));
        for (const plate of pm.plate) {
          plates++;
          plate.geo.computeBoundingBox();
          const bb = plate.geo.boundingBox!, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
          // the plate is thin along its normal: every vertex (pulled 1 mm toward the centre) must be covered by the leaf along it
          const axis = size.x < size.y && size.x < size.z ? 0 : size.y < size.z ? 1 : 2;
          const n = new THREE.Vector3().setComponent(axis, 1);
          const pos = plate.geo.attributes.position, v = new THREE.Vector3();
          for (let k = 0; k < pos.count; k++) {
            v.fromBufferAttribute(pos, k);
            const d = v.clone().sub(c).setComponent(axis, 0);
            if (d.length() > 1e-6) v.addScaledVector(d.normalize(), -0.001);
            let hit = false;
            for (const dir of [n, n.clone().negate()]) {
              rc.set(v.clone().addScaledVector(dir, -0.002), dir);
              rc.far = 0.35;
              if (rc.intersectObjects(leaf, false).length) { hit = true; break; }
            }
            expect(hit, `${h.kind} part ${i} plate vertex ${v.toArray().map(x => x.toFixed(3))} outside the leaf`).toBe(true);
          }
        }
      });
    }
    expect(plates).toBeGreaterThanOrEqual(8);
    expect(openableSpec('bin')!.parts[0].plateDisc).toBeTruthy(); // the round trash-can lid gets a disc, not a square
  });

  it('hinges / slides follow the spec pivots (lids hinge at the back rim, drawers slide out along the front normal)', () => {
    const {cm} = manager(models);
    cm.build(rowLayout(['bin', 'wheelieBin', 'filingCabinet', 'staffLockers', 'newspaperVendingBox']));
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const h of cm.openList) {
      h.open!.parts.forEach((ps, i) => {
        const spec = h.open!.spec.parts[i], pm = h.open!.model.parts[i];
        partLocalMatrix(spec, pm.pivot, ps.amount, m);
        // the part's front-centre after opening
        // the edge farthest from a lid's hinge line (a top-hinged flap: its bottom edge)
        const far = spec.move.type === 'hinge' && spec.move.axis === 'x' && pm.pivot.y > (pm.bounds.min.y + pm.bounds.max.y) / 2 ? pm.bounds.min.y : pm.bounds.max.y;
        const c = new THREE.Vector3((pm.bounds.min.x + pm.bounds.max.x) / 2, far, pm.bounds.max.z);
        v.copy(c).applyMatrix4(m);
        if (spec.move.type === 'slide') { expect(v.z - c.z, `${h.kind} ${i} slides out`).toBeCloseTo(ps.amount * spec.move.dir[2], 5); expect(v.x).toBeCloseTo(c.x, 5); }
        else if (spec.move.axis === 'x') expect(v.y, `${h.kind} lid front rises`).toBeGreaterThan(c.y + 0.05);
        else expect(v.z, `${h.kind} door swings out`).toBeGreaterThan(c.z + 0.05);
        // the pivot itself does not move
        const pv = pm.pivot.clone().applyMatrix4(m);
        if (spec.move.type === 'hinge') expect(pv.distanceTo(pm.pivot)).toBeLessThan(1e-6);
      });
    }
    const bin = cm.all.find(h => h.kind === 'bin')!.open!;
    expect(bin.model.parts[0].pivot.z).toBeLessThan(-0.2); // back rim
    const wb = cm.all.find(h => h.kind === 'wheelieBin')!.open!;
    expect(wb.model.parts[0].pivot.z).toBeLessThan(-0.3); // the handle bar at the back
  });
});

describe('open / close / take keep the finite lots (never re-rolled)', () => {
  it('toggling every compartment keeps ids / counts / placements; state persists; a rebuild rolls the same lots', () => {
    const kinds = OPENABLE_KINDS.filter(k => openableSpec(k)!.loot || openableSpec(k)!.shared);
    const layout = rowLayout([...kinds, ...kinds], {seed: 5});
    const {cm, events} = manager(models);
    cm.build(layout);
    const before = new Map(cm.openList.map(h => [h, lotsKey(h)]));
    expect(cm.openList.some(h => h.state.lots.some(l => l.part !== undefined))).toBe(true);
    for (const h of cm.openList) {
      for (let i = 0; i < h.open!.parts.length; i++) {
        if (h.state.lots.some(l => l.part === i)) continue; // empty compartments: open -> close
        cm.interact(target(h, i));
        settle(cm, 0.6);
        expect(h.state.parts![i], `${h.kind} ${i} open`).toBe(true);
        cm.interact(target(h, i));
        settle(cm, 0.6);
        expect(h.state.parts![i], `${h.kind} ${i} closed again`).toBe(false);
        expect(h.state.seen![i]).toBe(true);
      }
      expect(lotsKey(h), h.kind).toBe(before.get(h));
    }
    // opening a compartment that holds lots: the toast lists what is visibly inside; nothing appears or vanishes
    const full = cm.openList.find(h => h.state.lots.some(l => l.part !== undefined))!;
    const p = full.state.lots.find(l => l.part !== undefined)!.part!;
    const n0 = events.length;
    cm.interact(target(full, p));
    expect(events.slice(n0).find(e => e.type === 'open')?.message).toMatch(/^Inside: /);
    settle(cm);
    expect(lotsKey(full)).toBe(before.get(full));
    // re-close / re-open: no second "first open" toast, same lots
    full.state.parts![p] = false;
    settle(cm);
    const n1 = events.length;
    cm.interact(target(full, p));
    expect(events.slice(n1).some(e => e.message?.startsWith('Inside'))).toBe(false);
    expect(lotsKey(full)).toBe(before.get(full));
    // same seed -> same lots (deterministic), a different object graph
    const again = manager(models);
    again.cm.build(rowLayout([...kinds, ...kinds], {seed: 5}));
    expect(again.cm.openList.map(lotsKey)).toEqual(cm.openList.map(h => (h === full ? before.get(full)! : lotsKey(h))));
  });

  it('items in a closed compartment are hidden and untouchable; [E] on them opens the part first; then they are taken exactly once', () => {
    const {cm, inv} = manager(models);
    cm.build(rowLayout(['filingCabinet', 'staffLockers', 'safe', 'filingCabinet', 'staffLockers'], {seed: 21}));
    const h = cm.openList.find(x => x.state.lots.length)!;
    const lot = h.state.lots[0];
    const part = lot.part!;
    expect(cm.shotLots({x: h.prop.x, y: 0.5, z: h.prop.z + 3}, {x: 0, y: 0, z: -1}, 10).filter(s => s.holder === h)).toEqual([]);
    expect(cm.detachLot(h, lot.id)).toBeNull(); // not visible: cannot be lifted off by a shot
    const items0 = inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0);
    cm.interact(target(h, part, lot));
    expect(h.state.parts![part]).toBe(true); // opened, not taken
    expect(inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0)).toBe(items0);
    settle(cm);
    const inPart = h.state.lots.filter(l => l.part === part).reduce((n, l) => n + l.count, 0);
    expect(cm.prompt(target(h, part))).toMatch(/Take all/);
    cm.interact(target(h, part));
    const got = inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0) - items0;
    expect(got + h.state.lots.filter(l => l.part === part).reduce((n, l) => n + l.count, 0)).toBe(inPart);
    // now empty: close it; opening it again shows nothing new
    if (!h.state.lots.some(l => l.part === part)) {
      expect(cm.prompt(target(h, part))).toMatch(/Close .* — empty/);
      cm.interact(target(h, part));
      cm.interact(target(h, part));
      expect(cm.prompt(target(h, part))).toMatch(/Close/);
      expect(inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0) - items0).toBe(got);
    }
  });

  it('[E] on a desk / tool-chest top takes only what lies on top, never what is shut in its drawers', () => {
    const {cm, inv} = manager(models);
    let h: Holder | undefined;
    for (let seed = 1; seed < 200 && !h; seed++) {
      cm.build(rowLayout(['desk', 'rollingToolChest', 'kitchenette'], {seed}));
      h = cm.openList.find(x => x.state.lots.some(l => l.part === undefined) && x.state.lots.some(l => l.part !== undefined));
    }
    expect(h).toBeTruthy();
    const inside = JSON.stringify(h!.state.lots.filter(l => l.part !== undefined));
    expect(cm.prompt({container: h!, t: 1, lot: null, part: null})).toMatch(/Take all \(\d+\)/);
    cm.interact({container: h!, t: 1, lot: null, part: null});
    expect(h!.state.lots.some(l => l.part === undefined && inv.hasRoomFor(l.itemId))).toBe(false);
    expect(JSON.stringify(h!.state.lots.filter(l => l.part !== undefined))).toBe(inside);
  });

  it('drawers carry their lots: the items ride out with the tray and back in', () => {
    const {cm} = manager(models);
    let h: Holder | undefined;
    for (let seed = 1; seed < 60 && !h; seed++) {
      cm.build(rowLayout(['filingCabinet', 'rollingToolChest', 'crashCart'], {seed}));
      h = cm.openList.find(x => x.state.lots.some(l => l.part !== undefined && x.open!.spec.parts[l.part].move.type === 'slide'));
    }
    expect(h).toBeTruthy();
    const lot = h!.state.lots.find(l => l.part !== undefined && h!.open!.spec.parts[l.part].move.type === 'slide')!;
    const at0 = cm.lotPoint(h!, lot)!;
    cm.interact(target(h!, lot.part!));
    settle(cm);
    const at1 = cm.lotPoint(h!, lot)!;
    const travel = h!.open!.parts[lot.part!].amount;
    const fwd = new THREE.Vector3(Math.sin(h!.prop.rot), 0, Math.cos(h!.prop.rot));
    expect((at1.x - at0.x) * fwd.x + (at1.z - at0.z) * fwd.z).toBeCloseTo(travel, 3);
    expect(at1.y).toBeCloseTo(at0.y, 5);
    h!.state.parts![lot.part!] = false;
    settle(cm);
    const at2 = cm.lotPoint(h!, lot)!;
    expect(Math.hypot(at2.x - at0.x, at2.z - at0.z)).toBeLessThan(1e-6);
  });

  it('glass-door cooler: its stock is seen through the closed door but taken only once the door is open', () => {
    const {cm, inv} = manager(models);
    let h: Holder | undefined;
    for (let seed = 1; seed < 40 && !h; seed++) { cm.build(rowLayout(['shopCooler'], {seed})); h = cm.all.find(x => x.state.lots.length); }
    expect(h?.open).toBeTruthy();
    const lot = h!.state.lots[0];
    expect(lot.part).toBe(0);
    const o = {x: h!.prop.x, y: cm.lotPoint(h!, lot)!.y, z: h!.prop.z + 2};
    const at = cm.lotPoint(h!, lot)!;
    const d = new THREE.Vector3(at.x - o.x, at.y - o.y, at.z - o.z).normalize();
    expect(cm.shotLots(o, d, 5).some(s => s.lotId === lot.id)).toBe(true); // visible: shots still move cooler stock (iteration 07)
    expect(cm.prompt(target(h!, 0, lot))).toMatch(/Open cooler door/);
    cm.interact(target(h!, 0, lot));
    expect(inv.count(lot.itemId)).toBe(0);
    settle(cm);
    cm.interact(target(h!, 0, lot));
    expect(inv.count(lot.itemId)).toBeGreaterThan(0);
  });
});

describe('finite, unique contents across generated stations (all storeys)', () => {
  it('lot identities are unique per station; taking everything twice gives nothing more; openables stand on several storeys', () => {
    const levels = new Set<number>();
    const kindsSeen = new Set<string>();
    for (const seed of SEEDS) {
      const inv = new Inventory();
      const {cm} = manager(models, inv);
      cm.build(station(seed));
      const ids = cm.all.flatMap(h => h.state.lots.map(l => `${h.serial}:${l.id}`));
      expect(new Set(ids).size, `seed ${seed} unique lots`).toBe(ids.length);
      for (const h of cm.openList) { levels.add(h.prop.level ?? 0); kindsSeen.add(h.kind); }
      // every bin / newspaper box holds junk-tier things only (no ammo / first-aid kits)
      for (const h of cm.openList.filter(x => x.kind === 'bin' || x.kind === 'wheelieBin' || x.kind === 'newspaperVendingBox')) {
        for (const l of h.state.lots) expect(['ammo_556', 'ammo_12ga', 'medkit', 'rifle', 'shotgun'], `${h.kind} ${l.itemId}`).not.toContain(l.itemId);
      }
      const total = cm.openList.reduce((n, h) => n + h.state.lots.reduce((m, l) => m + l.count, 0), 0);
      const holders = cm.openList.slice(0, 40);
      const take = () => { for (const h of holders) for (let i = 0; i < h.open!.parts.length; i++) for (let k = 0; k < 3; k++) cm.interact(target(h, i)); };
      take();
      const once = inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0);
      take();
      expect(inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0), `seed ${seed} finite`).toBe(once);
      const left = cm.openList.reduce((n, h) => n + h.state.lots.reduce((m, l) => m + l.count, 0), 0);
      expect(left + once).toBeLessThanOrEqual(total);
      expect(inv.invariants()).toEqual([]);
    }
    expect([...levels].length, 'openables on more than one storey').toBeGreaterThan(1);
    for (const k of ['bin', 'newspaperVendingBox', 'staffLockers', 'filingCabinet', 'rollingToolChest', 'shopCooler', 'fireExtinguisherCabinet']) expect(kindsSeen.has(k), k).toBe(true);
  });

  it('loot economy: openables add a bounded share (bins / boxes mostly empty)', () => {
    let all = 0, open = 0, bins = 0, binLots = 0;
    for (const seed of SEEDS) {
      const {cm} = manager(models);
      cm.build(station(seed));
      for (const h of cm.all) {
        all += h.state.rolled;
        if (h.open && h.group === 'container') open += h.state.rolled;
        if (h.kind === 'bin') { bins++; binLots += h.state.rolled; }
      }
    }
    console.info(`[openables] new-container lots ${open} of ${all} (${(open / all * 100).toFixed(1)} %), bins ${bins} with ${binLots} lots`);
    expect(open / all).toBeLessThan(0.15);
    expect(binLots / bins).toBeLessThan(0.8);
  });
});

describe('clearance: parts open only as far as there is room (walls, doorways, other props) and add no collision', () => {
  it('generated stations: every fitted opening sweeps clear; most open fully; props keep their AABBs', () => {
    let parts = 0, full = 0;
    for (const seed of SEEDS) {
      const layout = station(seed);
      const boxes = new Map(layout.props.map(p => [p, [p.x, p.z, p.hx, p.hz, p.h]]));
      const {cm} = manager(models);
      cm.build(layout);
      const fit = new FitIndex(layout);
      const m = new THREE.Matrix4(), w = new THREE.Matrix4(), v = new THREE.Vector3();
      for (const h of cm.openList) {
        const ctx = fit.context(h.prop);
        h.open!.parts.forEach((ps, i) => {
          const spec = h.open!.spec.parts[i], pm = h.open!.model.parts[i];
          const fullA = spec.move.type === 'hinge' ? spec.move.angle : spec.move.dist;
          parts++;
          if (Math.abs(ps.amount) >= Math.abs(fullA) * 0.8 - 1e-6) full++;
          expect(Math.sign(ps.amount) === Math.sign(fullA) || ps.amount === 0).toBe(true);
          expect(Math.abs(ps.amount)).toBeLessThanOrEqual(Math.abs(fullA) + 1e-9);
          // at the fitted opening no sample that was free while closed is inside a wall, a doorway or another prop
          for (const f of [0.5, 1]) {
            partLocalMatrix(spec, pm.pivot, 0, m);
            const closed = pm.sweep.map(s => s.clone().add(pm.pivot).applyMatrix4(w.multiplyMatrices(h.open!.matrix, m)));
            partLocalMatrix(spec, pm.pivot, ps.amount * f, m);
            w.multiplyMatrices(h.open!.matrix, m);
            pm.sweep.forEach((s, k) => {
              if (k % 2) return; // every other sample (the fit itself checked all of them)
              if (blockedAt(closed[k].x, closed[k].y, closed[k].z, ctx, h.prop, h.prop.y)) return;
              v.copy(s).add(pm.pivot).applyMatrix4(w);
              expect(blockedAt(v.x, v.y, v.z, ctx, h.prop, h.prop.y), `seed ${seed} ${h.kind} part ${i} at ${f}`).toBe(false);
            });
          }
        });
        // opening it changes nothing about collision / nav
        h.state.parts = h.state.parts!.map(() => true);
      }
      settle(cm, 1);
      for (const [p, b] of boxes) expect([p.x, p.z, p.hx, p.hz, p.h]).toEqual(b);
    }
    console.info(`[openables] ${full}/${parts} parts open >= 80 % of their full swing / travel`);
    expect(full / parts).toBeGreaterThan(0.85);
  });

  it('a wall right behind a trash can limits the dome lid; a free-standing can opens fully', () => {
    const {cm} = manager(models);
    cm.build(rowLayout(['bin'], {back: 1.53}));
    const walled = cm.openList[0].open!.parts[0].amount;
    cm.build(rowLayout(['bin'], {back: 3.5}));
    const free = cm.openList[0].open!.parts[0].amount;
    expect(Math.abs(free)).toBeCloseTo(Math.abs(openableSpec('bin')!.parts[0].move.type === 'hinge' ? (openableSpec('bin')!.parts[0].move as {angle: number}).angle : 0), 5);
    expect(Math.abs(walled)).toBeLessThan(Math.abs(free));
    expect(Math.abs(walled)).toBeGreaterThan(20 * Math.PI / 180);
  });

  it('a locker bank packed against a neighbour: side-hinged doors stop short of it', () => {
    const {cm} = manager(models);
    cm.build(rowLayout(['staffLockers', 'staffLockers'], {gap: 0.02}));
    const right = cm.openList[0].open!.parts[2].amount;
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThanOrEqual((openableSpec('staffLockers')!.parts[2].move as {angle: number}).angle);
  });
});

describe('reach + occlusion in generated stations', () => {
  it('every openable is targeted (with 3D occlusion) from the spot in front of it, on its own storey, with an "Open …" prompt', () => {
    let n = 0;
    for (const seed of [1, 424242]) {
      const l = station(seed);
      const lv = levelsOf(l);
      const {cm} = manager(models);
      cm.build(l);
      for (const h of cm.openList) {
        const a = cm.openables.aimPoint(h.open!, 0);
        const eye = new THREE.Vector3(a.stand.x, lv.grid(h.prop.level ?? 0).floorAt(a.stand.x, a.stand.z) + 1.6, a.stand.z);
        const t = cm.target(eye, a.aim.clone().sub(eye).normalize(), lv);
        expect(t?.container, `seed ${seed} ${h.kind} at ${h.prop.x.toFixed(2)},${h.prop.z.toFixed(2)} level ${h.prop.level ?? 0}`).toBe(h);
        if (!t!.lot) expect(cm.prompt(t!)).toMatch(/^<b>\[E\]<\/b> Open /);
        n++;
      }
    }
    expect(n).toBeGreaterThan(150);
  });

  it('no wall-mounted container is hidden behind a tall floor prop of its area (gen/props07Dress.ts tallInFront)', () => {
    // Track 2 integration: seed 424242 (a first-aid kit 0.45 m behind a 1.83 m grill line) and stations the fix changed.
    let mounts = 0;
    for (const seed of [1, 424242, 9120, 183338]) {
      const l = station(seed);
      for (const m of l.props) {
        if (!m.mounted || !isLootHolderKind(m.kind) || !OPENABLE_CONTAINER_KINDS.includes(m.kind as never)) continue;
        mounts++;
        // the mount faces into its area: along X for a quarter turn, else along Z, toward the area's centre
        const a = l.areas[m.area], alongX = Math.abs(Math.sin(m.rot)) > 0.5;
        const sign = alongX ? Math.sign((a.x + a.w / 2) * 0.5 - m.x) : Math.sign((a.y + a.h / 2) * 0.5 - m.z);
        const d = alongX ? m.hx : m.hz, w = alongX ? m.hz : m.hx;
        const cx = alongX ? m.x + sign * (d + 0.45) : m.x, cz = alongX ? m.z : m.z + sign * (d + 0.45);
        const hx = alongX ? 0.4 : w, hz = alongX ? w : 0.4;
        for (const q of l.props) {
          if (q === m || q.area !== m.area || q.mounted || q.y + q.h <= m.y - 0.15) continue;
          expect(Math.abs(q.x - cx) < q.hx + hx && Math.abs(q.z - cz) < q.hz + hz, `seed ${seed} ${m.kind} at ${m.x.toFixed(2)},${m.z.toFixed(2)} behind ${q.kind}`).toBe(false);
        }
      }
    }
    expect(mounts).toBeGreaterThan(10);
  });
});

describe('item / chunk collision follows the compartments', () => {
  it('a closed can is one solid box for flying items; opened, its fill and walls take over (items rest inside, no roof)', () => {
    const {cm} = manager(models);
    cm.build(rowLayout(['bin', 'filingCabinet'], {back: 3.5}));
    const [bin, fc] = cm.openList;
    expect(cm.physicsBoxes(bin.prop)).toBeNull();
    expect(cm.physicsBoxes(fc.prop)).toBeNull();
    bin.state.parts![0] = true;
    fc.state.parts![0] = true;
    const boxes = cm.physicsBoxes(bin.prop)!;
    expect(boxes.length).toBeGreaterThanOrEqual(5); // fill base + 4 walls
    const fill = openableSpec('bin')!.parts[0].surfaces[0].y;
    expect(boxes.some(b => Math.abs(b.max.y - (bin.prop.y + fill + 0.002)) < 0.01)).toBe(true);
    expect(Math.max(...boxes.map(b => b.max.y))).toBeLessThan(bin.prop.y + bin.prop.h); // open top
    expect(cm.physicsBoxes(fc.prop)).toBeNull(); // a pulled-out drawer adds nothing (its tray travels out of the box)
  });
});

describe('render cost: closed holders draw nothing of their own', () => {
  it('bodies + closed parts are instanced per kind / chunk; own meshes only while open / moving / aimed; handed back when idle', () => {
    const {cm} = manager(models);
    cm.build(station(24839));
    const og = cm.openables.group;
    const instanced = og.children.filter(o => (o as THREE.InstancedMesh).isInstancedMesh).length;
    const ajar = cm.openList.filter(h => h.open!.spec.parts.some(p => p.ajar)).length;
    expect(cm.openables.active.size).toBe(ajar); // only forced-ajar safes keep their own meshes
    expect(og.children.length).toBe(instanced + ajar);
    const h = cm.openList.find(x => x.kind === 'filingCabinet' || x.kind === 'bin')!;
    cm.interact(target(h, 0));
    settle(cm, 0.2);
    expect(h.open!.root).toBeTruthy();
    expect(h.open!.parts[0].inner.every(o => o.visible)).toBe(true);
    h.state.parts![0] = false;
    settle(cm, 3);
    expect(h.open!.root).toBeNull();
    expect(cm.openables.active.size).toBe(ajar);
  });
});

describe('trash cans still go loose when shot (iteration-07 behaviour kept): the lid pops, the finite lots spill', () => {
  it('a shot can with lots spills them as the same lots (ids / counts) and its own lid / liner ride on the rigid body', () => {
    expect(isSpillHolderKind('bin') && isSpillHolderKind('wheelieBin')).toBe(true);
    const {cm, events} = manager(models);
    let layout: StationLayout | null = null;
    for (let seed = 1; seed < 80; seed++) {
      layout = rowLayout(['bin'], {seed, back: 3.5});
      cm.build(layout);
      if (cm.openList[0].state.lots.length) break;
    }
    const h = cm.openList[0];
    const lots = h.state.lots.map(l => [l.id, l.itemId, l.count]);
    expect(lots.length).toBeGreaterThan(0);
    const ph = new PhysicsSystem(null);
    ph.build(layout!);
    ph.holderBoxes = p => cm.physicsBoxes(p);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.95), new THREE.MeshStandardMaterial());
    body.matrixAutoUpdate = false;
    body.matrix.copy(h.matrix).multiply(new THREE.Matrix4().makeTranslation(0, 0.475, 0));
    ph.dynamicItems.detacher = {detachForPhysics: () => [body]};
    ph.dynamicItems.holderLoose = p => cm.goLoose(p);
    expect(ph.dynamicItems.isDynamicProp(h.prop)).toBe(true);
    for (let i = 0; i < 9; i++) ph.dynamicItems.shootProp(h.prop, 0, new THREE.Vector3(h.prop.x - 0.27, 0.75, h.prop.z), new THREE.Vector3(1, -0.05, 0).normalize(), 15 * SHOT_IMPULSE_PER_DAMAGE);
    const spill = events.find(e => e.type === 'spill')!;
    expect(spill).toBeTruthy();
    expect(spill.spilled!.map(s => [s.lot.id, s.lot.itemId, s.lot.count])).toEqual(lots);
    for (const s of spill.spilled!) expect(new THREE.Vector3().setFromMatrixPosition(s.matrix).y).toBeLessThan(h.prop.y + 0.2); // on the floor
    expect(h.state.lots.length).toBe(0);
    expect(h.open!.loose).toBe(true);
    const root = h.open!.root!;
    const before = root.matrix.clone();
    for (let i = 0; i < 240; i++) ph.update(1 / 60);
    expect(root.matrix.equals(before)).toBe(false); // carried by the rigid body
    // a loose can is no longer a holder target
    const eye = new THREE.Vector3(h.prop.x, 1.6, h.prop.z + 1.2);
    expect(cm.target(eye, new THREE.Vector3(h.prop.x, 0.5, h.prop.z).sub(eye).normalize(), layout!.grid)?.container ?? null).not.toBe(h);
  });
});

describe('storeys: openables on upper / lower levels use their absolute height, own storey and 3D occlusion', () => {
  it('a can on the deck and one on the platform below are separate; the deck can is not reachable through the slab', () => {
    const l = levelFixture();
    const mk = (y: number, level: number): PropPlacement => {
      const {hx, hz} = footprint('bin', 0);
      return Object.assign({kind: 'bin', x: 21.0, y, z: 9.0, rot: 0, area: level ? 2 : 0, hx, hz, h: PROP_DEFS.bin.h, blocksSight: false, variant: 0} as PropPlacement, level ? {level} : {});
    };
    l.props.push(mk(FIX.upperY, 1), mk(0, 0));
    const {cm} = manager(models);
    cm.build(l);
    const [deck, main] = [cm.openList.find(h => h.prop.level === 1)!, cm.openList.find(h => !h.prop.level)!];
    expect(deck.open!.matrix.elements[13]).toBeCloseTo(FIX.upperY, 6);
    expect(main.open!.matrix.elements[13]).toBeCloseTo(0, 6);
    expect(deck.serial).not.toBe(main.serial);
    const lv = levelsOf(l);
    // from the deck: aiming at the deck can's lid
    const a = cm.openables.aimPoint(deck.open!, 0).aim;
    const eye1 = new THREE.Vector3(21.0, FIX.upperY + 1.6, 10.2);
    const t1 = cm.target(eye1, a.clone().sub(eye1).normalize(), lv);
    expect(t1?.container).toBe(deck);
    expect(t1?.part).toBe(0);
    expect(cm.prompt(t1!)).toBe('<b>[E]</b> Open trash can');
    // from the platform below, aiming up through the deck slab at the same can: occluded
    const eye2 = new THREE.Vector3(21.0, 1.6, 10.2);
    const t2 = cm.target(eye2, a.clone().sub(eye2).normalize(), lv);
    expect(t2?.container).not.toBe(deck);
  });
});

describe('audit + sounds', () => {
  it('the audit covers every prop kind exactly once; openables match the specs; exceptions give a reason', () => {
    const kinds = Object.keys(PROP_DEFS);
    const seen = new Map<string, number>();
    for (const e of OPENABLE_AUDIT) seen.set(e.kind, (seen.get(e.kind) ?? 0) + 1);
    for (const k of kinds) expect(seen.get(k), `audit ${k}`).toBe(1);
    for (const k of seen.keys()) expect(kinds.includes(k), `audit kind ${k} exists`).toBe(true);
    expect(OPENABLE_AUDIT.filter(e => e.cls === 'openable').map(e => e.kind).sort()).toEqual([...OPENABLE_KINDS].sort());
    for (const e of OPENABLE_AUDIT.filter(x => x.cls === 'exception')) expect(e.how.length, e.kind).toBeGreaterThan(15);
    // the user's own example and the update's list are covered
    for (const k of ['bin', 'wheelieBin', 'staffLockers', 'filingCabinet', 'rollingToolChest', 'shopCooler', 'chestFreezer', 'newspaperVendingBox', 'safe', 'firstAidWallKit', 'fireExtinguisherCabinet', 'desk']) {
      expect(OPENABLE_AUDIT.find(e => e.kind === k)?.cls, k).toBe('openable');
    }
    for (const k of OPENABLE_CONTAINER_KINDS) expect(isLootHolderKind(k), k).toBe(true);
  });

  it('door / lid / drawer cues reuse existing holder cues (Sound Lab bank) and are rate-limited', () => {
    // audio/sfx.ts OPEN_CUE / CLOSE_CUE keys (cabinet / crate / cooler / drawer / vending clips)
    const OPEN = new Set(['cabinetTall', 'cabinetLow', 'gunLocker', 'medCabinet', 'staffLockers', 'locker', 'crate', 'fridge', 'shopCooler', 'desk', 'monitorDesk', 'kitchenette']);
    const CLOSE = new Set([...OPEN, 'vending']);
    for (const k of OPENABLE_KINDS) {
      const s = openableSpec(k)!.sound;
      expect(OPEN.has(s.open), `${k} open cue ${s.open}`).toBe(true);
      expect(CLOSE.has(s.close), `${k} close cue ${s.close}`).toBe(true);
    }
    const g = new SoundGate(0.22, 6);
    expect(g.allow(1, 0)).toBe(true);
    expect(g.allow(1, 0.1)).toBe(false);
    expect(g.allow(1, 0.3)).toBe(true);
    let n = 0;
    for (let k = 2; k < 20; k++) if (g.allow(k, 0.5)) n++;
    expect(n).toBeLessThanOrEqual(4); // 6 per second station-wide (2 already used)
  });
});
