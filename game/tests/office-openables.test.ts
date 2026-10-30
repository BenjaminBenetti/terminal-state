// Task office-interactions-layout-20261030 (lane OPEN): the office-overhaul storage opens. User: "we need a pass to make sure
// 'reasonably openable' items from this update are openable. I encountered a large cabinet I could not open. The items inside should
// be related to the type of container it is if relevant." Root CLAUDE.md "Props — core design rules" (storage opens, finite themed
// loot, explicit classified exceptions) and docs/prop-affordances.md.
//
// Covers: every office kind classified in OPENABLE_AUDIT (role / class / reason); each new openable (lateral filing cabinet, server
// cabinet / rack, vault safe, executive desk, lab bench, exam table, specimen fridge, archive box) has animated parts split from its
// model + real compartment surfaces; contents finite / themed (HOLDER_ALLOW) / deterministic / remembered / never refilled / packed
// inside their surfaces; on generated Office levels every fitted door / drawer swing stays clear of walls, doorways and props and the
// holder is reachable; the Subway never places them.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels, rowLayout} from './helpers/openablesFixture';
import {OFFICE_KINDS} from '../src/gen/office/kinds';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateStation} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {PROP_DEFS} from '../src/gen/props';
import {Inventory} from '../src/items/inventory';
import {placementBox} from '../src/items/lootLayout';
import {rollHolderLots, isLootHolderKind, type Lot} from '../src/items/loot';
import {CONTAINER_THEMED, HOLDER_ALLOW, HOLDER_SLOTS, OPENABLE_TABLES, econCat, lootProfile} from '../src/items/lootTables';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type Holder} from '../src/world/containers';
import {FitIndex, blockedAt, partLocalMatrix} from '../src/world/openables';
import {OPENABLE_AUDIT, OPENABLE_CONTAINER_KINDS, OPENABLE_KINDS, openableSpec, partFace} from '../src/world/openablesSpec';
import {applyHolders, captureHolders} from '../src/run/worldMemory';
import type {StationLayout} from '../src/gen/station';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const NEW = ['officeFiling', 'executiveDesk', 'labBench', 'examTable', 'vaultSafe', 'serverCabinet', 'serverRack', 'biohazardFridge', 'archiveBoxes'] as const;
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
let models: Record<string, GLTF> = {};
beforeAll(async () => { models = await openableModels(); }, 120000);

const manager = (inv = new Inventory()) => ({cm: new ContainerManager(models, mats, () => inv), inv});
const settle = (cm: ContainerManager, s = 1.2) => { for (let t = 0; t < s; t += 1 / 60) cm.update(1 / 60, t); };
const target = (h: Holder, part: number, lot: Lot | null = null) => ({container: h, t: 1, lot, part});
const lotsKey = (h: Holder) => JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count, l.part, l.surface, +l.x.toFixed(4), +l.y.toFixed(4), +l.z.toFixed(4)]));
const carried = (inv: Inventory) => inv.hotbar.concat(inv.pack).reduce((n, s) => n + (s ? s.count : 0), 0);
/** Bounded Office seed set (the generator is heavy): levels are generated once and shared read-only. */
const OFFICE_SEEDS = [1, 2, 3];
const offices = new Map<number, StationLayout>();
const office = (s: number) => { let l = offices.get(s); if (!l) offices.set(s, (l = generateOfficeLevel({levelSeed: s, startWeapon: 'pistol'}))); return l; };

describe('audit: every office kind is classified (role, class, honest reason)', () => {
  it('each office / company / support kind appears once with a role; storage either opens or is a reasoned exception', () => {
    for (const k of OFFICE_KINDS) {
      const rows = OPENABLE_AUDIT.filter(e => e.kind === k);
      expect(rows.length, `audit ${k}`).toBe(1);
      const e = rows[0];
      expect(e.role, `${k} role`).toBeTruthy();
      expect(e.how.length, `${k} reason`).toBeGreaterThan(5);
      if (e.role === 'storage') expect(['openable', 'exception'], `${k}: storage opens or is an explicit exception`).toContain(e.cls);
      if (e.cls === 'exception') expect(e.how.length, `${k} exception reason`).toBeGreaterThan(30);
      if (e.cls === 'openable') expect(OPENABLE_KINDS as readonly string[], k).toContain(k);
    }
    // the audit's openable rows are exactly the openable specs (office ones included)
    expect(OPENABLE_AUDIT.filter(e => e.cls === 'openable').map(e => e.kind).sort()).toEqual([...OPENABLE_KINDS].sort());
    // the large-cabinet family the user ran into all open now
    for (const k of NEW) {
      expect(OPENABLE_AUDIT.find(e => e.kind === k), k).toMatchObject({cls: 'openable', role: 'storage'});
      expect(OPENABLE_CONTAINER_KINDS as readonly string[], k).toContain(k);
      expect(isLootHolderKind(k), k).toBe(true);
      // loot foundation: a slot, an own table, eligibility, container-themed
      expect(HOLDER_SLOTS[k], `${k} slot`).toBeTruthy();
      expect((OPENABLE_TABLES as Record<string, unknown>)[k], `${k} own table`).toBeTruthy();
      expect(HOLDER_ALLOW[k]?.length, `${k} allow`).toBeGreaterThan(0);
      expect(CONTAINER_THEMED.has(k), `${k} themed`).toBe(true);
      // eligibility covers the container's own rows (a kept original roll keeps its item: it must be an allowed category)
      for (const [id] of (OPENABLE_TABLES as Record<string, {items: readonly (readonly [string, number])[]}>)[k].items) expect(HOLDER_ALLOW[k], `${k} ${id}`).toContain(econCat(id));
    }
    // the previously wrong reasons are corrected from the models (no drawers modelled at all)
    expect(OPENABLE_AUDIT.find(e => e.kind === 'cctvConsole')?.cls).toBe('none');
    expect(OPENABLE_AUDIT.find(e => e.kind === 'receptionDesk')?.cls).toBe('none');
  });
});

describe('each new openable: parts split from its model, animated, with real compartments', () => {
  it('derived moving geometry, a revealed interior per loot compartment, readable prompts; parts open and close', () => {
    const {cm} = manager();
    cm.build(rowLayout([...NEW], {back: 3.5, seed: 9}));
    for (const k of NEW) {
      const h = cm.openList.find(x => x.kind === k)!;
      expect(h?.open, k).toBeTruthy();
      const rt = h.open!, spec = openableSpec(k)!;
      expect(spec.turn, `${k} office file turned`).toBe(true);
      expect(rt.model.source, k).toMatch(/runtime split/);
      expect(rt.parts.length, k).toBe(spec.parts.length);
      rt.model.parts.forEach((pm, i) => {
        const ps = spec.parts[i];
        const verts = pm.moving.reduce((n, q) => n + q.geo.attributes.position.count, 0);
        expect(verts, `${k} part ${i} derived geometry`).toBeGreaterThan(30);
        expect(pm.bounds.isEmpty(), `${k} part ${i} bounds`).toBe(false);
        // a revealed compartment: authored liner / tray / shelves, or (cavityHidden: the specimen fridge) the model's own cleared interior
        if (!ps.surfaces.length) expect(ps.contents, `${k} part ${i}: no compartment -> fixture contents`).toBeTruthy();
        else if (!ps.cavityHidden) expect(pm.inner.length + pm.tray.length, `${k} part ${i} compartment`).toBeGreaterThan(0);
        else expect(ps.replaceInterior, `${k} part ${i}: the model's interior is cleared for the compartment`).toBe(true);
        expect(cm.prompt(target(h, i)).startsWith(`<b>[E]</b> Open ${ps.name}`), `${k} ${i}`).toBe(true);
        // the moving part covers its closed compartment's opening (no gap to look through): its box reaches the liner's front
        if (ps.cavity && !ps.cavityHidden) {
          const face = partFace(ps), front = face > 0 ? ps.cavity[5] : ps.cavity[2];
          expect(face > 0 ? pm.bounds.max.z : -pm.bounds.min.z, `${k} ${i} front`).toBeGreaterThan(face * front);
        }
      });
      // open every part: it animates to its fitted opening, then closes again; nothing about the lots changes
      const before = lotsKey(h);
      for (let i = 0; i < rt.parts.length; i++) {
        h.state.parts![i] = true;
        settle(cm, 0.7);
        expect(rt.parts[i].t, `${k} ${i} opened`).toBe(1);
        expect(Math.abs(rt.parts[i].amount), `${k} ${i} opens`).toBeGreaterThan(0);
        const piv = rt.parts[i].pivot!;
        expect(piv.position.distanceTo(rt.model.parts[i].pivot) > 1e-3 || Math.abs(piv.quaternion.w) < 0.999, `${k} ${i} moved`).toBe(true);
        h.state.parts![i] = false;
        settle(cm, 0.6);
        expect(rt.parts[i].t, `${k} ${i} closed`).toBe(0);
      }
      expect(lotsKey(h), k).toBe(before);
    }
    // the executive desk's drawers are on its sitter side: they slide out along -Z, aimed / stood at from behind the desk
    const ed = cm.openList.find(x => x.kind === 'executiveDesk')!.open!;
    for (const p of ed.spec.parts) expect(p.move.type === 'slide' && p.move.dir[2] < 0).toBe(true);
    const a = cm.openables.aimPoint(ed, 0);
    expect(a.stand.z).toBeLessThan(cm.openList.find(x => x.kind === 'executiveDesk')!.prop.z - 0.5);
    // the server cabinet's glass doors open onto racked servers: fixture text, not "empty"
    const sc = cm.openList.find(x => x.kind === 'serverCabinet')!;
    const glass = sc.open!.spec.parts.findIndex(p => p.name === 'glass door');
    const events: string[] = [];
    cm.onEvent = e => { if (e.message) events.push(e.message); };
    cm.interact(target(sc, glass));
    expect(events.at(-1)).toMatch(/^Glass door: racked servers/);
    expect(cm.prompt(target(sc, glass))).toBe('<b>[E]</b> Close glass door');
  });

  it('every inner plate stays inside its leaf (the archive box lid\'s underside)', () => {
    const {cm} = manager();
    cm.build(rowLayout(['archiveBoxes'], {back: 3.5}));
    const pm = cm.openList[0].open!.model.parts[0];
    expect(pm.plate.length).toBe(1);
    const leaf = pm.moving.map(q => new THREE.Mesh(q.geo, new THREE.MeshBasicMaterial({side: THREE.DoubleSide})));
    const rc = new THREE.Raycaster(), pos = pm.plate[0].geo.attributes.position, v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k);
      rc.set(v.clone().add(new THREE.Vector3(Math.sign(-v.x) * 0.001, -0.002, Math.sign(0.14 - v.z) * 0.001)), new THREE.Vector3(0, 1, 0));
      rc.far = 0.2;
      expect(rc.intersectObjects(leaf, false).length, `plate vertex ${k}`).toBeGreaterThan(0);
    }
  });
});

describe('contents: finite, themed by container, deterministic, remembered, never refilled, packed inside', () => {
  it('only the container\'s own categories (HOLDER_ALLOW) in any room; each kind finds something over seeds', () => {
    // the container decides (CONTAINER_THEMED): the same kind in a server room, a vault, a clinic, a lounge or a plain hall
    const rooms = ['office-server', 'office-vault', 'office-exam', 'office-lounge', 'office-archive', 'office-exec', 'office-lab', 'storage', 'default'];
    const {cm} = manager();
    cm.build(rowLayout([...NEW], {back: 3.5}));
    const profile = lootProfile('office');
    const found = new Map<string, number>();
    for (const h of cm.openList) {
      const allow = HOLDER_ALLOW[h.kind]!;
      for (const room of rooms) for (let i = 0; i < 60; i++) {
        for (const l of rollHolderLots(424242 + i, i, h.kind, room, h.surfaces, profile)) {
          const c = econCat(l.itemId);
          expect(c && allow.includes(c), `${h.kind} in ${room}: ${l.itemId}`).toBe(true);
          expect(l.part, `${h.kind}: lots rest in a compartment`).not.toBeUndefined();
          found.set(h.kind, (found.get(h.kind) ?? 0) + 1);
        }
      }
    }
    for (const k of NEW) expect(found.get(k) ?? 0, `${k} holds something sometimes`).toBeGreaterThan(5);
    // ammo only by the deliberate rule: the vault safe and the executive desk's generic sidearm rows; never in filing, medical, server
    // or archive storage
    for (const k of ['officeFiling', 'labBench', 'examTable', 'biohazardFridge', 'serverCabinet', 'serverRack', 'archiveBoxes']) expect(HOLDER_ALLOW[k], k).not.toContain('ammo');
    expect(HOLDER_ALLOW.vaultSafe).toContain('ammo');
    console.info(`[office-openables] lots over 9 rooms x 60 seeds: ${[...found].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  });

  it('every lot lies inside its compartment surface (footprint and clearance)', () => {
    const profile = lootProfile('office');
    const {cm} = manager();
    cm.build(rowLayout([...NEW], {back: 3.5}));
    let n = 0;
    for (const h of cm.openList) for (let i = 0; i < 80; i++) {
      for (const l of rollHolderLots(777 + i, i, h.kind, 'default', h.surfaces, profile)) {
        const s = h.surfaces[l.surface], b = placementBox(l.itemId, l);
        expect(b.min[0], `${h.kind} ${l.itemId} x0`).toBeGreaterThanOrEqual(s.x0 - 1e-6);
        expect(b.max[0], `${h.kind} ${l.itemId} x1`).toBeLessThanOrEqual(s.x1 + 1e-6);
        expect(b.min[2], `${h.kind} ${l.itemId} z0`).toBeGreaterThanOrEqual(s.z0 - 1e-6);
        expect(b.max[2], `${h.kind} ${l.itemId} z1`).toBeLessThanOrEqual(s.z1 + 1e-6);
        expect(b.max[1], `${h.kind} ${l.itemId} clear`).toBeLessThanOrEqual(s.y + s.clear + 1e-6);
        expect(l.y).toBeCloseTo(s.y, 6);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('deterministic, finite, remembered: same seed same lots; taken lots never come back; reopening adds nothing', () => {
    const layout = rowLayout([...NEW, ...NEW], {back: 3.5, seed: 31});
    const a = manager(), b = manager();
    a.cm.build(layout, {}, lootProfile('office'));
    b.cm.build(layout, {}, lootProfile('office'));
    expect(b.cm.openList.map(lotsKey)).toEqual(a.cm.openList.map(lotsKey));
    expect(a.cm.openList.some(h => h.state.lots.length)).toBe(true);
    const total = a.cm.openList.reduce((n, h) => n + h.state.lots.reduce((m, l) => m + l.count, 0), 0);
    // take everything once (open -> take -> close per part), then again: nothing more
    const takeAll = () => { for (const h of a.cm.openList) for (let i = 0; i < h.open!.parts.length; i++) for (let k = 0; k < 3; k++) { a.cm.interact(target(h, i)); settle(a.cm, 0.05); } };
    let got = 0;
    a.cm.onEvent = e => { for (const t of e.result?.taken ?? []) got += t.count; };
    takeAll();
    const once = got, inHand = carried(a.inv);
    expect(once).toBeGreaterThan(0);
    takeAll();
    expect(got, 'never refilled').toBe(once);
    expect(carried(a.inv)).toBe(inHand);
    const left = a.cm.openList.reduce((n, h) => n + h.state.lots.reduce((m, l) => m + l.count, 0), 0);
    expect(once + left).toBe(total);
    // run memory: a rebuilt section re-rolls identically and drops what was taken (nothing new appears)
    const mem = captureHolders(a.cm);
    const c = manager();
    c.cm.build(layout, {}, lootProfile('office'));
    applyHolders(c.cm, mem);
    expect(c.cm.openList.map(lotsKey)).toEqual(a.cm.openList.map(lotsKey));
    expect(c.cm.openList.every(h => h.state.parts!.every(p => !p))).toBe(true);
  });
});

describe('generated Office levels: placed, clear to open, reachable; the Subway never places them', () => {
  it('fitted openings sweep clear of walls / doorways / props; most open fully; each holder is reachable from its stand point', () => {
    const counts = new Map<string, number>();
    let parts = 0, full = 0, reach = 0, holders = 0;
    const lots = {old: 0, new: 0, oldAmmo: 0, newAmmo: 0};
    const missed = new Map<string, number>();
    const m = new THREE.Matrix4(), w = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const seed of OFFICE_SEEDS) {
      const l = office(seed), lv = levelsOf(l);
      const {cm} = manager();
      cm.build(l, {}, lootProfile('office'));
      const fit = new FitIndex(l);
      for (const h of cm.all) for (const lot of h.state.lots) {
        const n = (NEW as readonly string[]).includes(h.kind) ? 'new' : 'old';
        lots[n]++;
        if (econCat(lot.itemId) === 'ammo') lots[n === 'new' ? 'newAmmo' : 'oldAmmo'] += lot.count;
      }
      for (const h of cm.openList) {
        if (!(NEW as readonly string[]).includes(h.kind)) continue;
        counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
        const ctx = fit.context(h.prop, !!h.open!.spec.seatAside);
        h.open!.parts.forEach((ps, i) => {
          const spec = h.open!.spec.parts[i], pm = h.open!.model.parts[i];
          const fullA = spec.move.type === 'hinge' ? spec.move.angle : spec.move.dist;
          parts++;
          if (Math.abs(ps.amount) >= Math.abs(fullA) * 0.8 - 1e-6) full++;
          expect(Math.sign(ps.amount) === Math.sign(fullA) || ps.amount === 0).toBe(true);
          expect(Math.abs(ps.amount)).toBeLessThanOrEqual(Math.abs(fullA) + 1e-9);
          partLocalMatrix(spec, pm.pivot, 0, m);
          const closed = pm.sweep.map(s => s.clone().add(pm.pivot).applyMatrix4(w.multiplyMatrices(h.open!.matrix, m)));
          for (const f of [0.5, 1]) {
            partLocalMatrix(spec, pm.pivot, ps.amount * f, m);
            w.multiplyMatrices(h.open!.matrix, m);
            pm.sweep.forEach((s, k) => {
              if (blockedAt(closed[k].x, closed[k].y, closed[k].z, ctx, h.prop, h.prop.y)) return;
              v.copy(s).add(pm.pivot).applyMatrix4(w);
              expect(blockedAt(v.x, v.y, v.z, ctx, h.prop, h.prop.y), `seed ${seed} ${h.kind} part ${i} at ${f}: into a wall / doorway / prop`).toBe(false);
            });
          }
        });
        // reach: from the stand point in front of its first part (behind the executive desk), 3D occlusion on its own storey
        holders++;
        const a = cm.openables.aimPoint(h.open!, 0);
        const eye = new THREE.Vector3(a.stand.x, lv.grid(h.prop.level ?? 0).floorAt(a.stand.x, a.stand.z) + 1.6, a.stand.z);
        const t = cm.target(eye, a.aim.clone().sub(eye).normalize(), lv);
        if (t?.container === h) reach++;
        else missed.set(h.kind, (missed.get(h.kind) ?? 0) + 1);
      }
    }
    console.info(`[office-openables] office seeds ${OFFICE_SEEDS.join(',')}: ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}; ${full}/${parts} parts open >= 80 %; ${reach}/${holders} reached from their stand point (not reached: ${[...missed].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`);
    expect(counts.size, 'the new storage kinds are placed on generated Office levels').toBeGreaterThanOrEqual(6);
    for (const k of ['officeFiling', 'serverRack', 'serverCabinet', 'executiveDesk']) expect(counts.get(k) ?? 0, k).toBeGreaterThan(0);
    expect(full / parts).toBeGreaterThan(0.8);
    // the new storage is a bounded addition to the Office economy (finite, mostly empty), not a second economy
    console.info(`[office-openables] holder lots: existing ${lots.old} (ammo ${lots.oldAmmo} rounds), new storage ${lots.new} (ammo ${lots.newAmmo} rounds)`);
    expect(lots.new / lots.old).toBeLessThan(0.2); // measured ~10-13 % (seeds 1-3; the denominator moves with the floor plans)
    expect(lots.newAmmo / lots.oldAmmo).toBeLessThan(0.05);
    // main's floor plans: 100 %; a front blocked by the next rack / a wall is a placement bug (gen/office: keep the door side clear)
    expect(reach / holders).toBeGreaterThan(0.8);
  });

  it('the Subway corpus never places the office storage kinds (Subway holders / goldens untouched)', () => {
    for (const seed of [1, 2, 3, 24839, 424242]) {
      const l = generateStation(seed);
      expect(l.props.filter(p => (NEW as readonly string[]).includes(p.kind)).map(p => p.kind), `seed ${seed}`).toEqual([]);
    }
    // the footprints are the office kinds' (measured model bounds), so the openables split fits the instanced model's box
    for (const k of NEW) expect(PROP_DEFS[k].w).toBeGreaterThan(0.3);
  });
});
