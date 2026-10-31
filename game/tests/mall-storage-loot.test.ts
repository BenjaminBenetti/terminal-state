// Task mall-playtest-revision-20261031 (lane SHOPS, U10 — user: "a lot of drawers and cupboards are openable however I'm not seeing much
// loot in them ... just make sure we put loot inside the drawers and cupboards"). Layout-agnostic (single-prop rolls + one row of real
// openables with their runtime models; no mall generator): the whole chain plan -> fit -> transforms -> visible -> targeted -> taken ->
// remembered, and the causes fixed (lanes/SHOPS.done U10):
//  - PLAN: the mall profile's per-compartment STORAGE FILL (items/lootTables.ts MALL_STORAGE_FILL, items/loot.ts storageFill) — themed,
//    finite, deterministic; the Subway / Office / baseline profiles have none (their loot goldens stay byte-identical);
//  - FIT: the medicine cabinet's 33 pill drawers held nothing by construction (6 cm loot surface) — every fill compartment now takes
//    at least one item of its own pool;
//  - TRANSFORMS: a sliding LID (chest-freezer pane) no longer carries its compartment's lots off over the other half;
//  - GEOMETRY: no lot is buried in a compartment's authored interior (the freezer's frozen packs stood on its loot surface);
//  - VISIBILITY: a carton's finds lie on its packing and both flaps open together (no half hidden under a closed flap).
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels, rowLayout} from './helpers/openablesFixture';
import {PROP_DEFS} from '../src/gen/props';
import type {Grid} from '../src/gen/grid';
import {
  BASELINE_PROFILE, HOLDER_ALLOW, MALL_STORAGE_FILL, PROFILES, STORAGE_FILL_CATS, econCat, lootProfile, validateLootProfile, type LootProfile,
} from '../src/items/lootTables';
import {compartmentTable, holderTable, isContainerKind, isLootHolderKind, rollHolderLots, type HolderKind, type Lot} from '../src/items/loot';
import {holderSurfaces, packItems, placementBox} from '../src/items/lootLayout';
import {OPENABLE_SPECS, openableSpec} from '../src/world/openablesSpec';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type Holder} from '../src/world/containers';
import {applyHolders, captureHolders} from '../src/run/worldMemory';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const MALL = lootProfile('mall');
/** The same mall profile without its storage fill (what the mall rolled before the fix). */
const NO_FILL: LootProfile = {...MALL, tables: {...MALL.tables, storageFill: undefined}};
const FILL_ID = 600;
const isFill = (l: Lot) => l.id % 1000 >= FILL_ID;
/** Loot key a kind stands under in the mall (its typical shop / stock room purpose). */
const AREA: Readonly<Record<string, string>> = {
  mallCashwrapCounter: 'mall-clothing', pharmacyDispensaryCounter: 'mall-pharmacy', medicineDrawerCabinet: 'mall-pharmacy', dresserDrawers: 'mall-home',
  glassDisplayCabinet: 'mall-electronics', mallKioskCart: 'mall-kiosk', bookstoreBookcase: 'mall-books', storageTote: 'mall-clothing-back',
  cardboardBoxFlaps: 'mall-department-back', gunSafeTall: 'mall-guns-back', cabinetTall: 'mall-home-back', cabinetLow: 'mall-management', staffLockers: 'mall-clothing-back',
  kitchenette: 'mall-food-back', desk: 'mall-management', monitorDesk: 'mall-security', filingCabinet: 'mall-management', officeFiling: 'mall-management',
  chestFreezer: 'mall-grocery', examTable: 'mall-clinic', labBench: 'mall-clinic-back', biohazardFridge: 'mall-clinic-back', crashCart: 'mall-first-aid',
  rollingToolChest: 'mall-hardware-back',
};
const surfacesOf = (kind: string) => holderSurfaces(kind as HolderKind, (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number}>)[kind]);
/** Compartment keys of a holder kind: openable part indices, or -1 for a one-door / one-lid container. */
function compartments(kind: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const single = !openableSpec(kind) && isContainerKind(kind);
  surfacesOf(kind).forEach((s, i) => { const c = s.part ?? (single ? -1 : undefined); if (c !== undefined) out.set(c, [...(out.get(c) ?? []), i]); });
  return out;
}
const N = 160;
const rolls = new Map<string, Lot[][]>();
const rollsOf = (kind: string, prof: LootProfile, tag: string) => {
  const k = `${kind}:${tag}`;
  let v = rolls.get(k);
  if (!v) rolls.set(k, (v = Array.from({length: N}, (_, i) => rollHolderLots(1000 + i * 7919, i, kind as HolderKind, AREA[kind] ?? 'default', surfacesOf(kind), prof))));
  return v;
};

describe('plan: the mall storage fill (themed, finite, deterministic; old levels untouched)', () => {
  it('only the mall profile fills storage; every fill row is a valid, classified storage kind', () => {
    expect(BASELINE_PROFILE.tables.storageFill).toBeUndefined();
    expect(PROFILES.subway.tables.storageFill).toBeUndefined();
    expect(PROFILES.office.tables.storageFill).toBeUndefined();
    expect(MALL.tables.storageFill).toBe(MALL_STORAGE_FILL);
    expect(validateLootProfile(MALL)).toEqual([]);
    for (const [kind, f] of Object.entries(MALL_STORAGE_FILL)) {
      expect(isLootHolderKind(kind), kind).toBe(true);
      expect(compartments(kind).size, `${kind} has compartments`).toBeGreaterThan(0);
      expect(f!.chance, kind).toBeGreaterThan(0);
      expect(f!.chance, kind).toBeLessThanOrEqual(0.4);
      for (const c of f!.cats ?? STORAGE_FILL_CATS) expect(c === 'material', `${kind}: no crafting materials`).toBe(false);
      if ((f!.cats ?? STORAGE_FILL_CATS).includes('ammo')) expect(kind, 'ammo only by the arms rule').toBe('gunSafeTall');
    }
  });

  it('fit: every compartment of a filled kind can hold at least one item of its fill pool (the pill drawers held none)', () => {
    for (const kind of Object.keys(MALL_STORAGE_FILL)) {
      const f = MALL_STORAGE_FILL[kind]!, cats = f.cats ?? STORAGE_FILL_CATS, allow = HOLDER_ALLOW[kind];
      const t = compartmentTable(kind as HolderKind, AREA[kind], MALL) ?? holderTable(kind as HolderKind, AREA[kind], MALL);
      const pool = t.rows.filter(([id, w]) => { const c = econCat(id); return w > 0 && c !== null && cats.includes(c) && (!allow || allow.includes(c)); }).map(r => r[0]);
      expect(pool.length, `${kind} fill pool under ${AREA[kind]}`).toBeGreaterThan(0);
      const s = surfacesOf(kind);
      for (const [c, idx] of compartments(kind)) {
        // shared Subway kinds whose specs the Subway loot golden pins: the crash cart's 11 cm upper drawers take no dressing (only its
        // deep bottom drawer fills) and the tool chest's 5-7 cm top-chest drawers hardly a torch cell (recorded in lanes/SHOPS.done U10)
        if ((kind === 'crashCart' && c > 0) || (kind === 'rollingToolChest' && c >= 5)) continue;
        const fits = pool.filter(id => packItems([id], idx.map(i => s[i]), () => 0.5, false)[0]);
        expect(fits.length, `${kind} compartment ${c} fits one of ${pool.join(', ')}`).toBeGreaterThan(0);
      }
    }
    // the medicine cabinet's pill drawers specifically: a dressing goes in (snug packing), a first-aid kit does not
    const pill = surfacesOf('medicineDrawerCabinet').filter(q => q.part === 3);
    expect(packItems(['bandage'], pill, () => 0.5, false)[0]).toBeTruthy();
    expect(packItems(['medkit'], pill, () => 0.5, false)[0]).toBeNull();
  });

  it('per-compartment loot: drawers / cupboards now hold something often (not always); themed; compartments only; no materials / stray ammo', () => {
    const DRAWERS = ['mallCashwrapCounter', 'pharmacyDispensaryCounter', 'dresserDrawers', 'glassDisplayCabinet', 'mallKioskCart', 'bookstoreBookcase', 'storageTote', 'cardboardBoxFlaps', 'cabinetTall', 'desk', 'kitchenette'];
    for (const kind of DRAWERS) {
      const comps = compartments(kind);
      const rate = (prof: LootProfile, tag: string) => {
        let filled = 0;
        for (const lots of rollsOf(kind, prof, tag)) filled += [...comps.keys()].filter(c => lots.some(l => (l.part ?? -1) === c)).length;
        return filled / (N * comps.size);
      };
      const before = rate(NO_FILL, 'off'), after = rate(MALL, 'on');
      expect(after, `${kind}: ${before.toFixed(3)} -> ${after.toFixed(3)} of its compartments hold loot`).toBeGreaterThan(before + 0.05);
      expect(after, kind).toBeGreaterThan(0.08);
      expect(after, `${kind}: not every compartment`).toBeLessThan(0.75);
    }
    for (const kind of Object.keys(MALL_STORAGE_FILL)) {
      const f = MALL_STORAGE_FILL[kind]!, cats = f.cats ?? STORAGE_FILL_CATS, allow = HOLDER_ALLOW[kind];
      const single = !openableSpec(kind) && isContainerKind(kind);
      for (const lots of rollsOf(kind, MALL, 'on')) {
        expect(new Set(lots.map(l => l.id)).size, `${kind}: unique lot ids`).toBe(lots.length);
        for (const l of lots.filter(isFill)) {
          const c = econCat(l.itemId)!;
          expect(cats.includes(c) && (!allow || allow.includes(c)), `${kind} fill ${l.itemId}`).toBe(true);
          expect(single || l.part !== undefined, `${kind}: fill lots lie in a compartment, never on an exposed top`).toBe(true);
          expect(lots.filter(q => (q.part ?? -1) === (l.part ?? -1) && !isFill(q)), `${kind}: only empty compartments are filled`).toEqual([]);
        }
      }
    }
    // the roll's own lots are untouched by the fill (same ids, items, placements) and the whole result is deterministic
    for (const kind of ['mallCashwrapCounter', 'storageTote', 'cabinetTall']) {
      const on = rollsOf(kind, MALL, 'on'), off = rollsOf(kind, NO_FILL, 'off');
      on.forEach((lots, i) => expect(lots.filter(l => !isFill(l))).toEqual(off[i]));
      expect(rollHolderLots(1000, 0, kind as HolderKind, AREA[kind], surfacesOf(kind), MALL)).toEqual(on[0]);
    }
  });

  it('geometry: no lot is buried in its compartment\'s authored interior (trays, liners, frozen stock); none floats outside it', () => {
    for (const kind of Object.keys(OPENABLE_SPECS)) {
      // trash lumps in a bin are rubbish the finds lie among (iteration 08 dressing, outside this issue): skipped, recorded in SHOPS.done
      if (kind === 'bin' || kind === 'wheelieBin' || !isLootHolderKind(kind) || !(kind in PROP_DEFS)) continue;
      const spec = openableSpec(kind)!, s = surfacesOf(kind);
      for (let i = 0; i < 40; i++) {
        for (const l of rollHolderLots(77 + i * 131, i, kind as HolderKind, AREA[kind] ?? 'default', s, MALL)) {
          if (l.part === undefined) continue;
          const b = placementBox(l.itemId, l), p = spec.parts[l.part];
          for (const q of [...(p.inner ?? []), ...(p.tray ?? [])].map(x => x.b)) {
            const e = 0.004;
            const hit = b.min[0] < q[3] - e && b.max[0] > q[0] + e && b.min[1] < q[4] - e && b.max[1] > q[1] + e && b.min[2] < q[5] - e && b.max[2] > q[2] + e;
            expect(hit, `${kind} part ${l.part}: ${l.itemId} at ${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)} inside [${q.join(', ')}]`).toBe(false);
          }
          if (p.cavity) {
            const c = p.cavity, e = 0.012;
            expect(b.min[0] >= c[0] - e && b.max[0] <= c[3] + e && b.max[1] <= c[4] + e && b.min[2] >= c[2] - e && b.max[2] <= c[5] + e, `${kind} part ${l.part}: ${l.itemId} inside its cavity`).toBe(true);
          }
        }
      }
    }
  });
});

describe('runtime: open -> see -> take -> remember (real openables + their models)', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let models: Record<string, GLTF> = {};
  beforeAll(async () => { models = await openableModels(); }, 120000);
  const ROW = ['mallCashwrapCounter', 'pharmacyDispensaryCounter', 'medicineDrawerCabinet', 'chestFreezer', 'cardboardBoxFlaps', 'storageTote'];
  const build = (seed: number, inv = new Inventory()) => {
    const layout = rowLayout(ROW, {seed, gap: 1.2});
    for (const p of layout.props) p.purpose = AREA[p.kind] ?? 'mall-home';
    const cm = new ContainerManager(models, mats, () => inv);
    cm.build(layout, models, MALL);
    return {layout, cm, inv};
  };
  const settle = (cm: ContainerManager, s = 1.2) => { for (let t = 0; t < s; t += 1 / 60) cm.update(1 / 60, t); };
  /** A lot of `h` is seen from a standing or crouching player 0.32-0.9 m in front of its compartment (no non-transparent mesh in between). */
  function seen(cm: ContainerManager, h: Holder, l: Lot, grid: Grid): boolean {
    cm.group.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    cm.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && o.parent?.name !== 'loot-items' && !(m.material as THREE.Material).transparent) meshes.push(o); });
    const box = h.lotBoxes.get(l.id)!, c = box.getCenter(new THREE.Vector3());
    for (const d of [0.32, 0.6, 0.9]) for (const eh of [1.62, 1.02]) {
      const eye = new THREE.Vector3(l.x, 0, h.prop.hz + d).applyMatrix4(h.matrix);
      eye.y = h.prop.y + eh;
      const dir = c.clone().sub(eye).normalize(), entry = new THREE.Ray(eye, dir).intersectBox(box, new THREE.Vector3());
      const tEntry = entry ? entry.distanceTo(eye) : c.distanceTo(eye);
      const hits = new THREE.Raycaster(eye, dir, 0, tEntry).intersectObjects(meshes, false).filter(x => !box.containsPoint(x.point) && x.distance < tEntry - 0.02);
      if (!hits.length && cm.target(eye, dir, grid)?.lot?.id === l.id) return true;
    }
    return false;
  }

  it('a drawer and a cupboard: their themed finds show once opened, are targeted and taken exactly once; taken stays taken on revisit, the rest stays', () => {
    // the seed whose (only) cash wrap has a stocked drawer and whose dispensary a stocked cupboard (cheap pure rolls; then one build)
    const roll = (seed: number, kind: string) => rollHolderLots(seed, 0, kind as HolderKind, AREA[kind], surfacesOf(kind), MALL);
    let seed = 1;
    while (seed < 400 && !(roll(seed, 'mallCashwrapCounter').some(l => l.part! <= 4) && roll(seed, 'pharmacyDispensaryCounter').some(l => l.part! >= 4))) seed++;
    const built = build(seed++);
    const cw = built.cm.openList.find(h => h.kind === 'mallCashwrapCounter')!, dc = built.cm.openList.find(h => h.kind === 'pharmacyDispensaryCounter')!;
    const d = [0, 1, 2, 3, 4].find(p => cw.state.lots.some(l => l.part === p)), c = [4, 5, 6, 7, 8, 9].find(p => dc.state.lots.some(l => l.part === p));
    expect(d !== undefined && c !== undefined, 'a filled cash-wrap drawer and a filled dispensary cupboard').toBe(true);
    const picked = {drawer: [cw, d!] as [Holder, number], cupboard: [dc, c!] as [Holder, number]};
    const {layout, cm, inv} = built;
    const lotsKey = (h: Holder) => JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count, l.part]));
    const before = new Map(cm.all.map(h => [h, lotsKey(h)]));
    const taken: {h: Holder; id: number; itemId: string}[] = [];
    for (const [h, part] of [picked.drawer, picked.cupboard]) {
      const lot = h.state.lots.find(l => l.part === part)!;
      expect(seen(cm, h, lot, layout.grid), `${h.kind} part ${part} closed: not seen`).toBe(false);
      cm.interact({container: h, t: 1, lot: null, part});
      settle(cm);
      expect(h.state.parts![part], `${h.kind} part ${part} opens`).toBe(true);
      expect(seen(cm, h, lot, layout.grid), `${h.kind} part ${part} ${lot.itemId}: seen + targeted once open`).toBe(true);
      const n0 = inv.hotbar.concat(inv.pack).filter(s => s?.itemId === lot.itemId).reduce((a, s) => a + s!.count, 0), count = lot.count;
      cm.interact({container: h, t: 1, lot, part});
      const n1 = inv.hotbar.concat(inv.pack).filter(s => s?.itemId === lot.itemId).reduce((a, s) => a + s!.count, 0);
      expect(n1 - n0, `${lot.itemId} taken`).toBe(count);
      expect(h.state.lots.some(l => l.id === lot.id)).toBe(false);
      taken.push({h, id: lot.id, itemId: lot.itemId});
    }
    // revisit: the section memory applied onto a fresh build of the same level
    const mem = captureHolders(cm);
    const again = build(seed - 1);
    applyHolders(again.cm, mem);
    for (const t of taken) {
      const h2 = again.cm.all.find(h => h.kind === t.h.kind && h.prop.x === t.h.prop.x)!;
      expect(h2.state.lots.some(l => l.id === t.id), `${t.itemId} taken stays taken`).toBe(false);
      expect(JSON.stringify(h2.state.lots.map(l => [l.id, l.itemId, l.count, l.part]))).toBe(lotsKey(t.h));
      expect(h2.state.parts!.every(p => !p), 'compartments come back closed').toBe(true);
    }
    for (const h of cm.all) if (!taken.some(t => t.h === h)) {
      const h2 = again.cm.all.find(q => q.kind === h.kind && q.prop.x === h.prop.x)!;
      expect(lotsKey(h2), `${h.kind} untouched`).toBe(before.get(h));
    }
  });

  it('a chest-freezer pane slides away without carrying the finds; a carton opens both flaps and its finds show on its packing', () => {
    const roll = (seed: number, kind: string) => rollHolderLots(seed, 0, kind as HolderKind, AREA[kind], surfacesOf(kind), MALL);
    let seed = 1;
    while (seed < 2000 && !(roll(seed, 'chestFreezer').some(l => l.part === 0) && roll(seed, 'cardboardBoxFlaps').some(l => l.part === 1))) seed++;
    const b = build(seed), grid = b.layout.grid, cm = b.cm;
    const freezer = cm.openList.find(h => h.kind === 'chestFreezer' && h.state.lots.some(l => l.part === 0));
    const carton = cm.openList.find(h => h.kind === 'cardboardBoxFlaps' && h.state.lots.some(l => l.part === 1));
    expect(freezer && carton, 'a seed with a stocked freezer half and a stocked back carton half').toBeTruthy();
    const lot = freezer!.state.lots.find(l => l.part === 0)!;
    const at0 = cm.lotPoint(freezer!, lot)!;
    cm.interact({container: freezer!, t: 1, lot: null, part: 0});
    settle(cm);
    expect(freezer!.open!.parts[0].amount, 'the pane opens fully').toBeGreaterThan(0.6);
    const at1 = cm.lotPoint(freezer!, lot)!;
    expect(Math.hypot(at1.x - at0.x, at1.y - at0.y, at1.z - at0.z), 'the find stays in the basin').toBeLessThan(1e-6);
    expect(seen(cm, freezer!, lot, grid), `freezer ${lot.itemId} seen + targeted`).toBe(true);
    // the carton: [E] on its front flap opens both; the back half's find is seen from the front
    const back = carton!.state.lots.find(l => l.part === 1)!;
    expect(back.y).toBeGreaterThan(0.15); // on the packing, not the box floor
    cm.interact({container: carton!, t: 1, lot: null, part: 0});
    settle(cm);
    expect(carton!.state.parts).toEqual([true, true]);
    expect(seen(cm, carton!, back, grid), `carton back-half ${back.itemId} seen + targeted from the front`).toBe(true);
    const frontEmpty = !carton!.state.lots.some(l => l.part === 0);
    cm.interact({container: carton!, t: 1, lot: null, part: 0}); // takes what lies in the front half, else closes both flaps
    if (frontEmpty) expect(carton!.state.parts).toEqual([false, false]);
  });
});
