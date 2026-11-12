// Task studio-turnstile-reload-visuals-20261112-063646-01 (the user: "Turnstile should eject old shell casings on reload, and show new
// shells appearing in the cylinder"): every fired Turnstile shell leaves its hull in its chamber (ItemStack.spent) until the reload opens
// the gun; fully open, exactly those hulls are thrown out (the 'eject' event, once) — live rounds stay in — and each new shell is seen
// sliding into its chamber, seated as it is counted. Covers: the bookkeeping (fire / eject / partial / cancel / switch / no reserve, a
// fuzz conserving rounds and hulls), the stack field through saves / validation / Lockbox / world memory, the held view on the real model
// (the chambers agree with the stack every frame, the thrown hulls are exactly the ejected ones and go to the world's bounded casing pool,
// the open gun turns its rear face to the eye) and that nothing else changed (other guns, timing, the 12-gauge casing resource).
// No browser, no git history.
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));

const {WEAPONS, WeaponController, reserveFor, weaponAmmoItem} = await import('../src/weapons/weapons');
type TriggerInput = import('../src/weapons/weapons').TriggerInput;
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {CylinderRounds, ThrownHulls, CHAMBERS, SHELL_IN, EXTRACT, OPEN_ROOM, THROW} = await import('../src/weapons/cylinderRounds');
const {GunParts, CYLINDER_INDEX} = await import('../src/weapons/gunParts');
type GunParts = import('../src/weapons/gunParts').GunParts;
const {Inventory, stackToJSON, stackFromJSON} = await import('../src/items/inventory');
type ItemStack = import('../src/items/inventory').ItemStack;
const {CasingSystem, MAX_CASINGS, CASING_LIFETIME, SHELL_PARTS} = await import('../src/physics/casings');
const {TrainLockbox} = await import('../src/run/trainLockbox');
const {stackRecord, stackFromRecord} = await import('../src/run/worldMemory');
const {Harness} = await import('./helpers/saveFixture');
const {saveFileText, restoreRun} = await import('../src/save/serialize');
const {parseSaveText} = await import('../src/save/validate');
const {checksumOf} = await import('../src/save/checksum');
const {WEAPON_VARIETY_MODELS} = await import('../src/assets/weaponVarietyModels.generated');

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const DT = 1 / 60;
const idle: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const T = WEAPONS.turnstile;
const R = T.reload as {kind: 'break'; start: number; eject: number; each: number; end: number; spentHulls?: true};
const press = (i: number) => ({pressed: i % 36 === 0, held: i % 36 === 0}); // a press every 0.6 s (the Turnstile cycles in 0.55 s)

let uid = 93000;
function rig(mag: number, reserve: number, itemId = 'turnstile') {
  const inv = new Inventory();
  if (reserve) inv.add(inv.makeStack('ammo_12ga', reserve));
  const stack: ItemStack = {uid: uid++, itemId, count: 1, mag};
  const wc = new WeaponController();
  wc.equip(stack);
  wc.update(2, idle, inv);
  return {inv, wc, stack};
}
type Rig = ReturnType<typeof rig>;
type Ev = ReturnType<InstanceType<typeof WeaponController>['update']>[number];
function run(r: Rig, seconds: number, input: (i: number) => Partial<TriggerInput> = () => ({})): (Ev & {t: number; open: number})[] {
  const out: (Ev & {t: number; open: number})[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) for (const e of r.wc.update(DT, {...idle, ...input(i)}, r.inv)) out.push({...e, t: (i + 1) * DT, open: r.wc.actionOpen});
  return out;
}
const of = <K extends Ev['type']>(ev: Ev[], type: K) => ev.filter(e => e.type === type) as Extract<Ev, {type: K}>[];
/** Four shots out of a full cylinder: two live rounds + four hulls. */
function fourFired(reserve: number) {
  const r = rig(6, reserve);
  expect(of(run(r, 2.2, press), 'fire').length).toBe(4);
  expect([r.stack.mag, r.stack.spent]).toEqual([2, 4]);
  return r;
}

// ------------------------------------------------------------------------------------------------------------------------------
describe('Turnstile reload visuals: hulls and rounds (WeaponController)', () => {
  it('each shot leaves its hull in the cylinder (live + hulls never past six); only the Turnstile keeps hulls', () => {
    const r = rig(6, 0);
    let fired = 0;
    for (let i = 0; i < 6 * 36; i++) {
      fired += of(r.wc.update(DT, {...idle, ...press(i)}, r.inv), 'fire').length;
      expect((r.stack.mag ?? 0) + (r.stack.spent ?? 0)).toBe(6);
      expect(r.stack.spent ?? 0).toBe(fired);
    }
    expect([fired, r.stack.mag, r.stack.spent]).toEqual([6, 0, 6]);
    expect(Object.values(WEAPONS).filter(w => w.reload.kind === 'break' && w.reload.spentHulls).map(w => w.id)).toEqual(['turnstile']);
    // every other gun (the Coach Gun's break action included): a shot keeps no hull, a reload throws nothing
    for (const w of Object.values(WEAPONS)) {
      if (w.melee || w.id === 'turnstile') continue;
      const o = rig(w.magazine, 0, w.id), ammo = weaponAmmoItem(w);
      if (ammo) o.inv.add(o.inv.makeStack(ammo, 100));
      const ev = [...run(o, 0.2, i => ({pressed: i === 0, held: i === 0})), ...(o.wc.update(DT, {...idle, reload: true}, o.inv)), ...run(o, 8)];
      expect(of(ev, 'fire').length, w.id).toBe(1);
      expect([o.stack.spent, of(ev, 'eject').length, o.stack.mag], w.id).toEqual([undefined, 0, w.magazine]);
    }
  });

  it('the reload throws out exactly the hulls, once, the moment the action is fully open; the live rounds stay; then only the missing shells go in (timing unchanged)', () => {
    const r = fourFired(10);
    const ev = [...r.wc.update(DT, {...idle, reload: true}, r.inv).map(e => ({...e, t: 0, open: 0})), ...run(r, 3)];
    const ej = of(ev, 'eject') as (Extract<Ev, {type: 'eject'}> & {t: number; open: number})[];
    expect(ej.map(e => [e.def.id, e.hulls])).toEqual([['turnstile', 4]]);
    expect(ej[0].open).toBe(1);
    expect(ej[0].t).toBeGreaterThanOrEqual(R.eject - DT - 1e-9);
    expect(ej[0].t).toBeLessThanOrEqual(R.eject + DT);
    // fully open only at that frame: the frame before it was still opening
    const before = rig(6, 10);
    run(before, 2.2, press);
    before.wc.update(DT, {...idle, reload: true}, before.inv);
    let lastOpen = 0;
    for (let i = 0; i < 60 && (before.stack.spent ?? 0) > 0; i++) { lastOpen = before.wc.actionOpen; before.wc.update(DT, idle, before.inv); }
    expect([lastOpen < 1, before.wc.actionOpen, before.stack.mag]).toEqual([true, 1, 2]);
    // the rest: four new shells, closed; ammo exact; the same stage times as before this task
    const shells = ev.filter(e => e.type === 'shellIn').map(e => e.t), end = ev.find(e => e.type === 'reloadEnd')!.t;
    expect(shells.length).toBe(4);
    expect(shells[0]).toBeCloseTo(R.start + R.each, 1);
    expect(end).toBeCloseTo(R.start + 4 * R.each + R.end, 1);
    expect([r.stack.mag, r.stack.spent, r.inv.count('ammo_12ga'), r.wc.reloading]).toEqual([6, undefined, 6, false]);
    expect([R.start, R.eject, R.each, R.end, T.magazine, T.interval, T.damage, T.pellets]).toEqual([0.6, 0.4, 0.5, 0.3, 6, 0.55, 14, 9]);
  });

  it('shellDue: the time until the shell going in is counted (null outside a load); it reaches 0 at its shellIn', () => {
    const r = rig(0, 3);
    expect(r.wc.shellDue).toBeNull();
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    const seen: number[] = [];
    for (let i = 0; i < 300 && r.wc.reloading; i++) {
      const due = r.wc.shellDue, ev = r.wc.update(DT, idle, r.inv);
      if (due !== null) seen.push(due);
      if (of(ev, 'shellIn').length) expect(due!).toBeLessThanOrEqual(DT + 1e-9); // the last frame before it: due within one frame
      if (r.wc.actionOpen < 1) expect(r.wc.shellDue).toBeNull(); // opening / closing: none going in
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(R.each + 1e-9);
    expect([r.stack.mag, r.inv.count('ammo_12ga'), r.wc.shellDue]).toEqual([3, 0, null]);
  });

  it('a partial reload keeps the unfired rounds; a trigger press while opening still clears the hulls (it opened) and loads none', () => {
    const r = rig(6, 10);
    run(r, 0.2, i => ({pressed: i === 0, held: i === 0}));
    expect([r.stack.mag, r.stack.spent]).toEqual([5, 1]);
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    const ev = run(r, 2);
    expect([of(ev, 'eject').map(e => e.hulls), of(ev, 'shellIn').length]).toEqual([[1], 1]);
    expect([r.stack.mag, r.stack.spent, r.inv.count('ammo_12ga')]).toEqual([6, undefined, 9]);
    const c = fourFired(10);
    c.wc.update(DT, {...idle, reload: true}, c.inv);
    const cancel = run(c, 1.5, i => ({pressed: i === 2, held: i === 2}));
    expect([of(cancel, 'eject').map(e => e.hulls), of(cancel, 'shellIn').length, of(cancel, 'reloadEnd').length, of(cancel, 'fire').length]).toEqual([[4], 0, 1, 0]);
    expect([c.stack.mag, c.stack.spent, c.inv.count('ammo_12ga')]).toEqual([2, undefined, 10]);
  });

  it('a switch before full open keeps the hulls in the gun (thrown at its next reload); after it they are gone; never thrown twice', () => {
    const pistol = {uid: uid++, itemId: 'pistol', count: 1, mag: 15};
    const a = fourFired(10);
    a.wc.update(DT, {...idle, reload: true}, a.inv);
    const early = run(a, R.eject / 2);
    a.wc.equip(pistol);
    a.wc.equip(a.stack);
    const back = run(a, 1);
    expect([of([...early, ...back], 'eject').length, a.stack.mag, a.stack.spent, a.wc.reloading]).toEqual([0, 2, 4, false]);
    a.wc.update(DT, {...idle, reload: true}, a.inv);
    expect(of(run(a, 1), 'eject').map(e => e.hulls)).toEqual([4]);
    const b = fourFired(10);
    b.wc.update(DT, {...idle, reload: true}, b.inv);
    const ev = run(b, R.eject + 0.05);
    b.wc.equip(pistol);
    b.wc.equip(b.stack);
    ev.push(...run(b, 1));
    b.wc.update(DT, {...idle, reload: true}, b.inv);
    ev.push(...run(b, 4));
    expect([of(ev, 'eject').map(e => e.hulls), b.stack.spent, b.stack.mag, b.inv.count('ammo_12ga')]).toEqual([[4], undefined, 6, 6]);
  });

  it('a slower hand (handling x1.6) stretches the reload alike: the eject still at full open, shellDue still reaching 0 at each shellIn; a long frame keeps the order', () => {
    const r = fourFired(10);
    r.wc.handling = 1.6;
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    const ev: (Ev & {t: number; open: number; due: number | null})[] = [];
    let due: number | null = null;
    for (let i = 0; i < 600 && r.wc.reloading; i++) {
      due = r.wc.shellDue;
      for (const e of r.wc.update(DT, idle, r.inv)) ev.push({...e, t: (i + 2) * DT, open: r.wc.actionOpen, due});
    }
    const ej = ev.find(e => e.type === 'eject')!;
    expect([ej.open, ej.t]).toEqual([1, expect.closeTo(R.eject * 1.6, 1)]);
    for (const e of ev.filter(x => x.type === 'shellIn')) expect(e.due!).toBeLessThanOrEqual(DT * 1.6 + 1e-9);
    expect(ev.find(e => e.type === 'reloadEnd')!.t).toBeCloseTo((R.start + 4 * R.each + R.end) * 1.6, 1);
    expect([r.stack.mag, r.stack.spent, r.inv.count('ammo_12ga')]).toEqual([6, undefined, 6]);
    // one long frame (a hitch) through the whole open + two shells: the hulls leave first, then the shells, nothing lost
    const h = fourFired(10);
    h.wc.update(DT, {...idle, reload: true}, h.inv);
    const types = h.wc.update(R.start + 2 * R.each + 0.01, idle, h.inv).map(e => e.type);
    expect(types).toEqual(['eject', 'shellIn', 'shellIn']);
    expect([h.stack.mag, h.stack.spent, h.inv.count('ammo_12ga')]).toEqual([4, undefined, 8]);
  });

  it('no 12-gauge in the reserve: the gun cannot open, so its hulls stay (as before this task: no reload without a round to load)', () => {
    const r = fourFired(0);
    expect(r.wc.canReload(r.inv)).toBe(false);
    const ev = [...r.wc.update(DT, {...idle, reload: true}, r.inv), ...run(r, 2)];
    expect([of(ev, 'eject').length, r.stack.mag, r.stack.spent]).toEqual([0, 2, 4]);
  });

  it('fuzz: 20 000 random frames never mint or lose a round or a hull: every shot is one hull, thrown out exactly once', () => {
    let seed = 24681357;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const r = rig(6, 40), start = (r.stack.mag ?? 0) + r.inv.count('ammo_12ga'), other = {uid: uid++, itemId: 'pistol', count: 1, mag: 15};
    let fired = 0, thrown = 0, held = false, ejects = 0, picked = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rnd();
      if (x < 0.002) { r.wc.equip(other); r.wc.equip(r.stack); }
      if (x > 0.9995) { r.inv.add(r.inv.makeStack('ammo_12ga', 6)); picked += 6; } // a pickup mid-run
      const pressed = x > 0.97;
      held = pressed || (held && x > 0.1);
      const ev = r.wc.update(DT, {...idle, pressed, held, reload: x > 0.5 && x < 0.505}, r.inv);
      fired += of(ev, 'fire').length;
      for (const e of of(ev, 'eject')) { thrown += e.hulls; ejects++; }
      const mag = r.stack.mag ?? 0, spent = r.stack.spent ?? 0;
      expect(mag + spent, `frame ${i}`).toBeLessThanOrEqual(6);
      expect(Number.isInteger(spent) && spent >= 0 && r.stack.spent !== 0).toBe(true); // absent when none
      expect(spent + thrown, `frame ${i}`).toBe(fired);
      expect(r.inv.count('ammo_12ga') + mag + fired, `frame ${i}`).toBe(start + picked);
    }
    expect([fired > 20, ejects > 3]).toEqual([true, true]);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('Turnstile reload visuals: the hulls travel with the gun (saves, validation, Lockbox, world memory)', () => {
  /** A Turnstile stack of `inv` (its own uid). */
  const turnstile = (mag: number, spent?: number, inv = new Inventory()): ItemStack => {
    const s = inv.makeStack('turnstile', 1, mag);
    if (spent !== undefined) s.spent = spent;
    return s;
  };

  it('stack JSON and world-memory records carry `spent`; an older stack without it means empty chambers', () => {
    const s = turnstile(2, 4);
    expect(stackFromJSON(stackToJSON(s))).toEqual(s);
    expect(stackToJSON(turnstile(3))).not.toHaveProperty('spent');
    const inv = new Inventory();
    const rec = stackRecord(s);
    expect([rec.mag, (rec as {spent?: number}).spent]).toEqual([2, 4]);
    const back = stackFromRecord(inv, rec);
    expect([back.itemId, back.mag, back.spent]).toEqual(['turnstile', 2, 4]);
  });

  it('Inventory invariants: hulls only in a hull-keeping gun, whole, never past its free chambers', () => {
    const check = (mk: (inv: InstanceType<typeof Inventory>) => ItemStack) => { const i = new Inventory(); i.add(mk(i)); return i.invariants(); };
    expect(check(i => turnstile(2, 4, i))).toEqual([]);
    expect(check(i => turnstile(3, 4, i)).join()).toMatch(/bad spent turnstile:4/);
    expect(check(i => turnstile(2, 1.5, i)).join()).toMatch(/bad spent/);
    expect(check(i => { const s = i.makeStack('coach_gun', 1, 0); s.spent = 1; return s; }).join()).toMatch(/coach_gun keeps no hulls/);
  });

  it('a save keeps them through Continue (export / import text); a save claiming hulls in another gun or past six is refused', () => {
    const h = new Harness();
    const s = turnstile(2, 4, h.inv);
    expect(h.inv.add(s)).toBe(0);
    const text = saveFileText(h.file());
    const parsed = parseSaveText(text);
    expect(parsed.ok, parsed.ok ? '' : String(parsed.error)).toBe(true);
    if (!parsed.ok) return;
    const back = new Harness();
    expect(restoreRun(parsed.value.run, back.target()).failed).toEqual([]);
    const got = back.inv.get(back.inv.find(s.uid)!)!;
    expect([got.itemId, got.mag, got.spent]).toEqual(['turnstile', 2, 4]);
    expect(back.inv.invariants()).toEqual([]);
    // edited copies (re-signed)
    const edit = (f: (st: Record<string, unknown>) => void) => {
      const raw = JSON.parse(text);
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (o.itemId === 'turnstile' && o.uid === s.uid) f(o); Object.values(o).forEach(walk); }
      };
      walk(raw);
      raw.checksum = checksumOf(raw.run); // a consistent file: the validator itself must refuse it
      const r = parseSaveText(JSON.stringify(raw));
      if (!r.ok) expect(String(r.error)).not.toMatch(/checksum/);
      return r;
    };
    const refused = (f: (st: Record<string, unknown>) => void) => { const r = edit(f); expect(r.ok).toBe(false); return r.ok ? '' : String(r.error); };
    expect(refused(st => { st.spent = 5; })).toMatch(/\.spent/); // 2 live + 5 hulls > 6 chambers
    expect(refused(st => { st.spent = -1; })).toMatch(/\.spent/);
    expect(refused(st => { st.spent = 1.5; })).toMatch(/\.spent/);
    expect(refused(st => { st.itemId = 'coach_gun'; st.mag = 0; st.spent = 1; })).toMatch(/coach_gun keeps no hulls/);
    expect(edit(st => { delete st.spent; }).ok).toBe(true); // an older save: no hulls
  });

  it('the Lockbox clamps them like rounds (never past the free chambers; none on a gun that keeps none)', () => {
    const lb = new TrainLockbox();
    lb.load({v: 1, slots: [
      {uid: 1, itemId: 'turnstile', count: 1, mag: 2, spent: 9},
      {uid: 2, itemId: 'turnstile', count: 1, mag: 6, spent: 3},
      {uid: 3, itemId: 'coach_gun', count: 1, mag: 1, spent: 1},
      {uid: 4, itemId: 'turnstile', count: 1, mag: 1, spent: 2},
    ]});
    expect(lb.slots.slice(0, 4).map(s => [s?.itemId, s?.mag, s?.spent])).toEqual([
      ['turnstile', 2, 4], ['turnstile', 6, undefined], ['coach_gun', 1, undefined], ['turnstile', 1, 2],
    ]);
    expect(stackFromJSON(lb.toJSON().slots[3])!.spent).toBe(2);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
const M = WEAPON_VARIETY_MODELS.turnstile!;
async function model(): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(PUBLIC, M.url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder for GLTFLoader
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const base = {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0};

describe('Turnstile reload visuals: the held view (the real Viewmodel and model)', () => {
  /** The game's wiring (game.ts): events -> the view; the view state from the held stack; thrown hulls that left -> the world sink. */
  async function heldRig(mag: number, reserve: number) {
    const vm = new Viewmodel({} as never, {});
    vm.setAspect(16 / 9);
    expect(vm.addModel('turnstile', await model())).toBe(true);
    vm.setItem('turnstile');
    let s = 12345;
    vm.thrownHulls!.rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const r = rig(mag, reserve);
    const main = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
    main.position.set(3, 1.6, -2);
    main.rotation.set(0.2, 0.7, 0, 'YXZ');
    main.updateMatrixWorld(true);
    const sunk: {pos: THREE.Vector3; dir: THREE.Vector3; speed: number}[] = [];
    const frame = (input: Partial<TriggerInput> = {}) => {
      const ev = r.wc.update(DT, {...idle, ...input}, r.inv);
      for (const e of ev) {
        if (e.type === 'fire') vm.fire(e.def);
        else if (e.type === 'shellIn') vm.shellBump();
        else if (e.type === 'eject') vm.ejectHulls(e.def, e.hulls);
      }
      vm.update(DT, {...base, reloading: r.wc.reloading, reloadProgress: r.wc.progress, actionOpen: r.wc.actionOpen, live: r.stack.mag ?? 0, spent: r.stack.spent ?? 0,
        shellDue: r.wc.shellDue !== null && reserveFor(T, r.inv) > 0 ? r.wc.shellDue : null});
      vm.flushHulls(main, (pos, dir, speed) => sunk.push({pos: pos.clone(), dir: dir.clone(), speed}));
      return ev;
    };
    for (let i = 0; i < 30; i++) frame();
    return {vm, r, frame, sunk, main, rounds: vm.heldRounds!};
  }
  /** The chamber index relative to the one under the barrel. */
  const relOf = (k: number, index: number) => ((k - index) % 6 + 6) % 6;

  it('the chambers show the stack every frame: live from the barrel on, hulls behind it, one shell sliding in only while it is being loaded', async () => {
    const {r, frame, rounds, vm} = await heldRig(6, 10);
    const parts = (vm as unknown as {items: Map<string, {parts: GunParts}>}).items.get('turnstile')!.parts;
    let shots = 0, loading = 0, seated = 0;
    const lastOut = new Map<number, number>();
    for (let i = 0; i < 9 * 60; i++) {
      const input = i < 4 * 36 ? press(i) : i === 4 * 36 + 30 ? {reload: true} : {};
      const ev = frame(input);
      shots += of(ev, 'fire').length;
      const st = rounds.states, idx = parts.chamberIndex, mag = r.stack.mag ?? 0, spent = r.stack.spent ?? 0;
      expect(st.filter(x => x === 'live').length, `frame ${i}`).toBe(mag);
      expect(st.filter(x => x === 'spent').length, `frame ${i}`).toBe(spent);
      st.forEach((x, k) => {
        const rel = relOf(k, idx);
        if (x === 'live') expect(rel).toBeLessThan(mag);
        if (x === 'spent') expect(rel).toBeGreaterThanOrEqual(6 - spent);
        if (x === 'loading') {
          expect(rel).toBe(mag);
          const out = rounds.shellOut(k).out;
          expect(out).toBeLessThanOrEqual(Math.min(SHELL_IN.from, OPEN_ROOM[rel]) + 1e-9);
          expect(out).toBeLessThanOrEqual((lastOut.get(k) ?? Infinity) + 1e-9); // only ever going in
          lastOut.set(k, out);
        }
      });
      const due = r.wc.shellDue;
      expect(st.filter(x => x === 'loading').length).toBe(due !== null && due < SHELL_IN.time && mag < 6 ? 1 : 0);
      if (of(ev, 'shellIn').length) { // counted: that chamber is a seated live round now
        seated++;
        const k = st.findIndex((x, kk) => x === 'live' && relOf(kk, idx) === mag - 1);
        expect(rounds.shellOut(k)).toEqual({shown: true, out: expect.closeTo(0, 9)});
        expect(lastOut.has(k)).toBe(true); // ... and it was seen going in first
      }
      loading = Math.max(loading, st.filter(x => x === 'loading').length);
      // shown only while the action is open (or a shell is going in): the closed gun's standing breech hides the rear face
      expect(rounds.shown).toBe(r.wc.actionOpen > 1e-3 || st.includes('loading'));
      if (r.wc.actionOpen === 0 && !r.wc.reloading) expect(rounds.shown).toBe(false);
      // the hulls rise with the extractor as it opens
      if (spent && r.wc.actionOpen >= 0.999) for (let k = 0; k < 6; k++) if (st[k] === 'spent') expect(rounds.shellOut(k).out).toBeCloseTo(EXTRACT.rise, 6);
    }
    expect([shots, seated, loading, r.stack.mag, r.stack.spent, r.wc.reloading]).toEqual([4, 4, 1, 6, undefined, false]);
  });

  it('the eject: exactly the ejected hulls fly out of the view, then into the world sink (bounded); the live rounds never leave', async () => {
    const {frame, rounds, vm, sunk, main} = await heldRig(6, 10);
    for (let i = 0; i < 4 * 36; i++) frame(press(i));
    for (let i = 0; i < 30; i++) frame();
    frame({reload: true});
    let ejectAt = -1, maxFlying = 0;
    for (let i = 0; i < 120; i++) {
      const ev = frame();
      if (of(ev, 'eject').length) {
        ejectAt = i;
        expect(vm.thrownHulls!.flying).toBe(4);
        expect(rounds.states.filter(x => x === 'live').length).toBe(2);
        expect(rounds.states.filter(x => x === 'spent').length).toBe(0);
      }
      maxFlying = Math.max(maxFlying, vm.thrownHulls!.flying);
    }
    expect(ejectAt).toBeGreaterThan(0);
    expect([maxFlying, vm.thrownHulls!.flying, sunk.length]).toEqual([4, 0, 4]);
    // each lands somewhere in front of the eye (the reprojected held-view point) moving off to the right, at a casing's speed
    const right = new THREE.Vector3(1, 0, 0).transformDirection(main.matrixWorld);
    for (const h of sunk) {
      const local = main.worldToLocal(h.pos.clone());
      expect(local.z).toBeLessThan(-0.05);
      expect(local.length()).toBeLessThan(1.5);
      expect(h.dir.dot(right)).toBeGreaterThan(0.3);
      expect(h.speed).toBeGreaterThan(0.5);
      expect(h.speed).toBeLessThan(4);
    }
    // a switch while hulls fly: they still go to the world (nothing stays on screen, nothing is dropped)
    const b = await heldRig(6, 10);
    for (let i = 0; i < 4 * 36; i++) b.frame(press(i));
    b.frame({reload: true});
    for (let i = 0; i < 60 && !b.vm.thrownHulls!.flying; i++) b.frame();
    expect(b.vm.thrownHulls!.flying).toBe(4);
    b.vm.setItem('pistol'); // a model-less item: the view holds nothing
    for (let i = 0; i < 90; i++) b.vm.update(DT, base), b.vm.flushHulls(b.main, (p) => b.sunk.push({pos: p.clone(), dir: new THREE.Vector3(), speed: 0}));
    expect([b.vm.thrownHulls!.flying, b.sunk.length]).toEqual([0, 4]);
    // an eject of a gun that is not held throws nothing
    b.vm.ejectHulls(WEAPONS.coach_gun, 2);
    b.vm.update(DT, base);
    expect(b.vm.thrownHulls!.flying).toBe(0);
  });

  it('the pool is bounded (six in flight; the oldest goes to the world first) and the world casing pool is unchanged (48 slots, 25 s)', () => {
    const t = new ThrownHulls();
    const cam = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 20);
    cam.updateMatrixWorld(true);
    const pose = {base: new THREE.Vector3(0.1, -0.1, -0.4), axis: new THREE.Vector3(0, 0, 1), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)), drawn: 0.013};
    for (let i = 0; i < 10; i++) t.throw(pose);
    expect([t.flying, t.takeReleased().length, t.root.children.length]).toEqual([6, 4, 6]);
    for (let i = 0; i < Math.ceil(THROW.life / DT) + 2; i++) t.update(DT, new THREE.Vector3(0, -1, 0), cam);
    expect([t.flying, t.takeReleased().length]).toEqual([0, 6]);
    expect([MAX_CASINGS, CASING_LIFETIME]).toEqual([48, 25]);
    expect(SHELL_PARTS).toEqual({hull: {radius: 0.0103, length: 0.054, centre: 0.008}, head: {radius: 0.0108, length: 0.016, centre: -0.027}});
    // the world side: a hull handed over (PhysicsSystem.ejectAt -> CasingSystem.eject as a 'shell' at its own speed) joins the one bounded
    // pool; a flood of them never grows it past MAX_CASINGS, and each fades out within CASING_LIFETIME
    const cs = new CasingSystem();
    for (let i = 0; i < 60; i++) cs.eject(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(1, 0.2, 0.3).normalize(), 'shell', {x: 0, y: 0, z: 0}, 2);
    expect(cs.live).toBe(MAX_CASINGS);
    for (let i = 0; i < (CASING_LIFETIME + 1) * 10; i++) cs.update(0.1);
    expect(cs.live).toBe(0);
  });

  it('chamber layout: on the cylinder (they turn with it, chamber k under the barrel after k shots), at the rear face, inside its rim', async () => {
    const gltf = await model();
    const root = gltf.scene.clone(true);
    const parts = GunParts.find(root, 6)!;
    const rounds = CylinderRounds.attach(root, 6)!;
    expect(rounds.group.parent?.name).toBe('Cylinder');
    root.updateMatrixWorld(true);
    const frames = (rounds as unknown as {slots: {frame: THREE.Object3D}[]}).slots.map(s => s.frame);
    const toModel = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
    const rest = frames.map(at), axis = root.getObjectByName('Cylinder')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
    for (const p of rest) {
      expect(Math.hypot(p.x - axis.x, p.y - axis.y)).toBeCloseTo(CHAMBERS.pitch, 6);
      expect(p.z).toBeCloseTo(M.markers.Eject![2], 6);
      expect(CHAMBERS.pitch + SHELL_PARTS.head.radius).toBeLessThan(0.039 - 0.0002); // a head stays inside the 39 mm rim
    }
    expect(rest[0].y - axis.y).toBeCloseTo(CHAMBERS.pitch, 6); // chamber 0 at the top, under the barrel
    for (let k = 1; k <= 6; k++) {
      parts.index();
      parts.apply(null, 0, CYLINDER_INDEX.delay + CYLINDER_INDEX.time + 0.01);
      root.updateMatrixWorld(true);
      expect(parts.chamberIndex).toBe(k % 6);
      expect(at(frames[k % 6]).distanceTo(rest[0]), `after ${k} shots`).toBeLessThan(1e-7);
    }
  });

  it('nothing is drawn for a stack that is not a gun\'s, and a fresh view (Continue / Retry) of the same stack shows the same rounds', async () => {
    const gltf = await model();
    const a = CylinderRounds.attach(gltf.scene.clone(true), 6)!, b = CylinderRounds.attach(gltf.scene.clone(true), 6)!;
    a.update(undefined, 3, 1, 0);
    expect([a.shown, a.states.every(x => x === 'empty')]).toEqual([false, true]);
    a.update(2, 4, 1, 3);
    b.update(2, 4, 1, 3);
    expect(a.states).toEqual(b.states);
    expect(a.states).toEqual(['spent', 'spent', 'spent', 'live', 'live', 'spent']);
    a.update(2, 4, 0, 3);
    expect(a.shown).toBe(false); // closed
  });

  it('only the Turnstile turns its open rear face to the eye; the Coach Gun\'s open pose and every other view are unchanged', () => {
    expect(Object.values(WEAPONS).filter(w => w.view.breakPresent).map(w => w.id)).toEqual(['turnstile']);
    expect(T.view.breakPresent).toEqual([0.5, 0.7, 0.3]);
  });

  it('warm-up reaches every chamber shell, mouth and thrown hull while they are hidden (their materials compile on the loading screen)', async () => {
    const vm = new Viewmodel({} as never, {});
    expect(vm.addModel('turnstile', await model())).toBe(true);
    vm.setItem('turnstile');
    for (let i = 0; i < 10; i++) vm.update(DT, {...base, live: 3, spent: 0}); // closed: every chamber mesh and thrown hull hidden
    vm.setItem(null);
    const ours: THREE.Mesh[] = [];
    const roundsRoot = vm.scene.getObjectByName('cylinder-rounds')!, thrownRoot = vm.thrownHulls!.root;
    for (const r of [roundsRoot, thrownRoot]) r.traverse(o => { if ((o as THREE.Mesh).isMesh) ours.push(o as THREE.Mesh); });
    expect(ours.length).toBe(6 * 4 + 6 * 3); // per chamber: mouth + head + hull + primer; per thrown hull: head + hull + primer
    const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    expect(ours.filter(shown)).toEqual([]); // hidden now
    // what render/warmup.ts does for the overlay pass: the hidden roots + every renderable visible, nothing else
    const hidden = vm.warmRoots();
    for (const o of hidden) o.visible = true;
    vm.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) o.visible = true; });
    expect(ours.filter(m => !shown(m)).map(m => m.parent?.name)).toEqual([]);
    const mats = new Set(ours.map(m => m.material as THREE.MeshStandardMaterial));
    expect(mats.size).toBe(4); // brass, hull plastic, primer, chamber mouth: one shared set
    expect(hidden.includes(thrownRoot)).toBe(false); // no extra warm root: the held-item roots are what they were
  });
});
