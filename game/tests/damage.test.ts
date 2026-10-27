// Iteration 06 (Lane D): material-strength damage / breaking. Node tests (no WebGL): registry
// coverage, shared-instance isolation, integrity staging + breaks, finite loot preserved on break,
// bounded debris / crater / wound pools, rest-space wounds, shader-hook chaining, determinism.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {generateStation, type StationLayout} from '../src/gen/station';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {SHAPE_MAT_KEYS} from '../src/gen/propShapes';
import {PURPOSE_MAT_KEYS} from '../src/gen/purposeShapes';
import {MODEL_FILES, TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {ITEMS} from '../src/items/items';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {StaticQuery} from '../src/physics/staticQuery';
import {raycastWorld, rayAabb} from '../src/combat/hitscan';
import {addShaderHook, shaderHookKeys} from '../src/render/shaderHooks';
import {
  ALL_PROP_KINDS, DAMAGE_CLASSES, DAMAGE_MATERIALS, ITEM_CLASS, PROP_DAMAGE, PURPOSE_KEY_CLASS, SHAPE_KEY_CLASS, STRUCTURAL_CLASS, STRUCTURAL_KEYS,
  WORLD_MAT_CLASS, damageStage, modelClass, partKeyClass, structuralKeyAt, wearableClass, zombieMeshClass,
} from '../src/damage/materials';
import {DMG_ANCHORS} from '../src/damage/glsl';
import {DEBRIS_CAPS, DEBRIS_SPAWN_BUDGET, DEBRIS_TOTAL_CAP, DebrisSystem} from '../src/damage/debris';
import {CRATER_CAP, CraterField} from '../src/damage/craters';
import {DMG_MAX, MAX_DETACHED, PROP_DAMAGE_HOOK} from '../src/damage/propDamage';
import {WOUND_HOOK, WOUND_MAX, installWounds, woundsOf} from '../src/damage/wounds';
import {DamageSystem} from '../src/damage/system';

installCanvasShim(false);
// the no-op shim lacks clip() (used by the item label atlas that ContainerManager builds)
{
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}

const SURFACES = ['concrete', 'tile', 'metal', 'flesh', 'wood', 'glass', 'sheet'];

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

interface Station { layout: StationLayout; mats: WorldMaterials; world: ReturnType<typeof buildWorld>; cm: ContainerManager; sys: DamageSystem; inv: Inventory; breaks: {kind: string; prop: PropPlacement}[] }

function station(seed: number): Station {
  const layout = generateStation(seed);
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const world = buildWorld(layout, mats, {});
  const inv = new Inventory();
  const cm = new ContainerManager({}, mats, () => inv);
  cm.build(layout);
  const sys = new DamageSystem(null, null);
  sys.rand = mulberry(5);
  const breaks: Station['breaks'] = [];
  sys.build(layout, mats, [world.group, cm.group], {
    ownMeshes: p => cm.ownMeshes(p),
    onBreak: e => { breaks.push({kind: e.kind, prop: e.prop}); const h = cm.holderFor(e.prop); if (h) cm.breakHolder(h, e.kind); },
  });
  return {layout, mats, world, cm, sys, inv, breaks};
}

function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Prop-local (front +Z, base origin) -> world. */
function toWorld(p: PropPlacement, lx: number, ly: number, lz: number): THREE.Vector3 {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return new THREE.Vector3(p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c);
}

/** Shoot prop `i` at a prop-local target from `dist` m in front (exact AABB entry like hitscan). */
function shootProp(st: Station, i: number, local: [number, number, number], damage = 24, pellet = false, dist = 1.4) {
  const p = st.layout.props[i];
  const target = toWorld(p, ...local);
  const front = new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot));
  const origin = target.clone().addScaledVector(front, dist).add(new THREE.Vector3(0, 0.05, 0));
  const dir = target.clone().sub(origin).normalize();
  const h = rayAabb(origin, dir, {x: p.x - p.hx, y: p.y, z: p.z - p.hz}, {x: p.x + p.hx, y: p.y + p.h, z: p.z + p.hz});
  expect(h, `ray reaches prop ${p.kind}`).toBeTruthy();
  const point = origin.clone().addScaledVector(dir, h!.t);
  return st.sys.hitWorld({t: h!.t, kind: 'prop', nx: h!.n[0], ny: h!.n[1], nz: h!.n[2], prop: i}, point, dir, {damage, pellet, weapon: pellet ? 'shotgun' : 'rifle'});
}

const fakeShader = () => ({vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, THREE.IUniform>});
type ShaderArg = Parameters<THREE.Material['onBeforeCompile']>[0];
function compile(m: THREE.Material): ReturnType<typeof fakeShader> {
  const sh = fakeShader();
  m.onBeforeCompile(sh as unknown as ShaderArg, {} as THREE.WebGLRenderer);
  return sh;
}

// ---------------------------------------------------------------------------------------

describe('damage material registry (coverage)', () => {
  it('every damage class has a complete, sane spec', () => {
    for (const c of DAMAGE_CLASSES) {
      const m = DAMAGE_MATERIALS[c];
      expect(m, c).toBeTruthy();
      expect(m.hardness).toBeGreaterThanOrEqual(0);
      expect(m.hardness).toBeLessThanOrEqual(1);
      expect(m.chip[0]).toBeGreaterThan(0);
      expect(m.chip[1]).toBeGreaterThanOrEqual(m.chip[0]);
      expect(m.chips[1]).toBeGreaterThanOrEqual(m.chips[0]);
      expect(m.palette.length).toBeGreaterThan(0);
      expect(m.markMax).toBeGreaterThanOrEqual(m.markSize);
      expect(SURFACES, `${c} sound`).toContain(m.sound);
      expect(DEBRIS_CAPS[m.shape], `${c} shape`).toBeGreaterThan(0);
    }
  });

  it('maps every prop kind, shape key, purpose key, model key, world material, item and zombie slot', () => {
    for (const k of Object.keys(PROP_DEFS)) expect(PROP_DAMAGE[k as keyof typeof PROP_DAMAGE], k).toBeTruthy();
    expect(ALL_PROP_KINDS.length).toBe(Object.keys(PROP_DEFS).length);
    for (const k of SHAPE_MAT_KEYS) expect(DAMAGE_CLASSES, k).toContain(SHAPE_KEY_CLASS[k]);
    for (const k of PURPOSE_MAT_KEYS) expect(DAMAGE_CLASSES, k).toContain(PURPOSE_KEY_CLASS[k]);
    for (const k of Object.keys(MODEL_FILES)) expect(DAMAGE_CLASSES, k).toContain(modelClass(k));
    expect(modelClass('zombieBody_anything')).toBe('flesh');
    expect(modelClass('outfit_trench')).toBe('cloth');
    expect(modelClass('outfit_gasmask')).toBe('rubber');
    const mats = new WorldMaterials(fakeEnvTextures(), 3, {w: 1.2, h: 0.19, d: 0.17});
    for (const k of Object.keys(mats.scale)) expect(DAMAGE_CLASSES, k).toContain(WORLD_MAT_CLASS[k]);
    for (const k of STRUCTURAL_KEYS) expect(DAMAGE_CLASSES, k).toContain(STRUCTURAL_CLASS[k]);
    for (const id of Object.keys(ITEMS)) expect(DAMAGE_CLASSES, id).toContain(ITEM_CLASS[id]);
    expect(zombieMeshClass('body', null)).toBe('flesh');
    expect(zombieMeshClass('upper', 'hoodie')).toBe('cloth');
    expect(zombieMeshClass('lower', 'cargo-pants')).toBe('cloth');
    expect(zombieMeshClass('face', 'gas-mask')).toBe('rubber');
    expect(zombieMeshClass('head', 'hardhat')).toBe('plastic');
    expect(zombieMeshClass(undefined, null, 'ZombieBody')).toBe('flesh');
    expect(wearableClass('beanie', 'head')).toBe('cloth');
    expect(partKeyClass('menuBoard:pizza', 'steel')).toBe('screen');
    expect(partKeyClass('shopCooler-open-glass', 'sheetMetal')).toBe('glass');
    // breakable kinds: integrity finite, everything else stages only
    for (const [k, s] of Object.entries(PROP_DAMAGE)) {
      if (s.breaks !== 'never') expect(Number.isFinite(s.integrity), k).toBe(true);
      if (s.glass) expect(s.glass.integrity, k).toBeGreaterThan(0);
    }
  });

  it('classifies every structural surface a bullet can hit in generated stations (deterministic)', () => {
    for (const seed of [9001, 424242]) {
      const L = generateStation(seed);
      const w = {grid: L.grid, areas: L.areas, trenches: L.trenches};
      const seen = new Set<string>();
      const rand = mulberry(seed);
      let n = 0;
      for (let i = 0; i < 1500; i++) {
        const a = L.areas[Math.floor(rand() * L.areas.length)];
        const x = (a.x + rand() * a.w) * 0.5, z = (a.y + rand() * a.h) * 0.5, y0 = L.grid.floorAt(x, z) + 0.4 + rand() * 1.8;
        const ang = rand() * Math.PI * 2, pitch = (rand() - 0.5) * 2.4;
        const d = {x: Math.cos(pitch) * Math.sin(ang), y: Math.sin(pitch), z: Math.cos(pitch) * Math.cos(ang)};
        const wh = raycastWorld(L.grid, L.props, {x, y: y0, z}, d, 30, L.trench.floorY);
        if (wh.kind === 'none' || wh.kind === 'prop') continue;
        const px = x + d.x * wh.t, py = y0 + d.y * wh.t, pz = z + d.z * wh.t;
        const key = structuralKeyAt(wh.kind, px, py, pz, wh.nx, wh.nz, w);
        expect(STRUCTURAL_KEYS as readonly string[], `${wh.kind} @${px.toFixed(1)},${pz.toFixed(1)}`).toContain(key);
        expect(structuralKeyAt(wh.kind, px, py, pz, wh.nx, wh.nz, w)).toBe(key); // deterministic
        seen.add(`${wh.kind}:${key}`);
        n++;
      }
      expect(n).toBeGreaterThan(800);
      // the main finishes all occur
      for (const k of ['wall:tileLower', 'floor:terrazzo', 'ceiling:ceiling']) expect([...seen], `${seed} ${k}`).toContain(k);
      console.info(`[damage] seed ${seed}: ${n} structural hits -> ${[...seen].sort().join(' ')}`);
    }
  });

  it('stages integrity: marked, heavily damaged, broken', () => {
    expect(damageStage(110, 110, 0)).toBe(0);
    expect(damageStage(86, 110, 1)).toBe(1);
    expect(damageStage(50, 110, 3)).toBe(2);
    expect(damageStage(-1, 110, 5)).toBe(3);
    expect(damageStage(Infinity, Infinity, 3)).toBe(1);
    expect(damageStage(Infinity, Infinity, 9)).toBe(2);
  });
});

describe('per-instance prop damage on a built station (Node, procedural props)', () => {
  it('hitting one instance never touches another instance sharing its geometry / materials', () => {
    const st = station(9001);
    const L = st.layout;
    // two tables drawn by the same instanced meshes
    const tables = L.props.map((p, i) => ({p, i})).filter(({p}) => p.kind === 'table');
    expect(tables.length).toBeGreaterThan(2);
    const [A, B] = tables;
    const entriesA = st.sys.props.index.inst.get(A.p)!, entriesB = st.sys.props.index.inst.get(B.p)!;
    expect(entriesA.length).toBeGreaterThan(1);
    const shared = entriesA.find(ea => entriesB.some(eb => eb.mesh === ea.mesh))!;
    expect(shared, 'A and B share an InstancedMesh').toBeTruthy();
    const ib = entriesB.find(e => e.mesh === shared.mesh)!;
    const before = new THREE.Matrix4();
    shared.mesh.getMatrixAt(ib.index, before);
    const sharedMat = shared.mesh.material as THREE.Material;
    const t0 = performance.now();
    const r = shootProp(st, A.i, [0, PROP_DEFS.table.h - 0.01, 0.5]);
    const ms = performance.now() - t0;
    expect(r.object).toBe('prop');
    const sA = st.sys.props.states.get(A.p)!;
    expect(sA.hits).toBe(1);
    expect(sA.parts?.length).toBeGreaterThan(0);
    expect(st.sys.props.states.get(B.p)).toBeUndefined();
    // A's instances collapsed in the shared meshes, B's untouched
    const m = new THREE.Matrix4();
    for (const e of entriesA) { e.mesh.getMatrixAt(e.index, m); expect(m.elements.slice(0, 15).every(v => v === 0)).toBe(true); }
    shared.mesh.getMatrixAt(ib.index, m);
    expect(m.equals(before)).toBe(true);
    // A drawn with its own patched clones; the shared material stays unpatched
    for (const q of sA.parts!) {
      expect(q.mesh.material).not.toBe(sharedMat);
      expect(shaderHookKeys(q.mesh.material as THREE.Material)).toContain(PROP_DAMAGE_HOOK);
    }
    expect(shaderHookKeys(sharedMat)).not.toContain(PROP_DAMAGE_HOOK);
    expect(sA.parts!.some(q => q.u.uDmgN.value === 1)).toBe(true);
    console.info(`[damage] first hit on a table: detach ${sA.parts!.length} parts in ${ms.toFixed(1)} ms`);
  });

  it('crate: staged damage, then splinters; its finite lots stay (same ids / counts) and are takeable', () => {
    const st = station(9001);
    const L = st.layout;
    const crates = L.props.map((p, i) => ({p, i})).filter(({p}) => p.kind === 'crate');
    const holderOf = (p: PropPlacement) => st.cm.holderFor(p)!;
    // a crate with loot
    const c = crates.find(({p}) => holderOf(p).state.lots.length > 0) ?? crates[0];
    const other = crates.find(x => x !== c)!;
    const h = holderOf(c.p);
    const lotsBefore = h.state.lots.map(l => ({id: l.id, itemId: l.itemId, count: l.count}));
    const allLotsBefore = st.cm.all.reduce((n, x) => n + x.state.lots.reduce((s, l) => s + l.count, 0), 0);
    const stages: number[] = [];
    for (let k = 0; k < 5; k++) stages.push(shootProp(st, c.i, [0, PROP_DEFS.crate.h * 0.5, PROP_DEFS.crate.d / 2]).stage ?? -1);
    expect(stages).toEqual([1, 1, 2, 2, 3]);
    const s = st.sys.props.states.get(c.p)!;
    expect(s.broken).toBe(true);
    expect(st.breaks.map(b => b.kind)).toEqual(['splinter']);
    expect(c.p.h).toBeLessThanOrEqual(0.02); // rubble: no longer blocks walking / bullets
    expect(s.parts!.every(q => !q.mesh.visible)).toBe(true);
    expect(h.broken).toBe(true);
    expect(h.root?.visible).toBe(false);
    expect(h.state.open).toBe(true);
    expect(h.state.lots.map(l => ({id: l.id, itemId: l.itemId, count: l.count}))).toEqual(lotsBefore);
    // the other crate is untouched
    expect(st.sys.props.states.get(other.p)).toBeUndefined();
    expect(holderOf(other.p).broken).toBeFalsy();
    // another hit lands on the rubble / floor, nothing re-breaks
    expect(shootProp(st, c.i, [0, 0.01, PROP_DEFS.crate.d / 2]).object).toBe('floor');
    expect(st.breaks.length).toBe(1);
    // take everything from the smashed crate: exactly the rolled counts move into the inventory
    const want = new Map<string, number>();
    for (const l of lotsBefore) want.set(l.itemId, (want.get(l.itemId) ?? 0) + l.count);
    const have0 = new Map([...want.keys()].map(k => [k, st.inv.count(k)]));
    st.cm.interact(h);
    let moved = 0;
    for (const [k, n] of want) { const got = st.inv.count(k) - have0.get(k)!; expect(got).toBeLessThanOrEqual(n); moved += got; }
    const left = h.state.lots.reduce((n, l) => n + l.count, 0);
    expect(moved + left).toBe(lotsBefore.reduce((n, l) => n + l.count, 0));
    expect(st.inv.invariants()).toEqual([]);
    // no loot created or destroyed anywhere
    const allLotsAfter = st.cm.all.reduce((n, x) => n + x.state.lots.reduce((s2, l) => s2 + l.count, 0), 0);
    expect(allLotsAfter + moved).toBe(allLotsBefore);
    expect(st.cm.prompt(h)).toMatch(/smashed crate|Smashed crate/);
  });

  it('glass: cooler door and shopfront glazing crack, then shatter (hidden + collision update); lots untouched', () => {
    const st = station(9001);
    const L = st.layout;
    const ci = L.props.findIndex(p => p.kind === 'shopCooler');
    const cooler = L.props[ci];
    const h = st.cm.holderFor(cooler)!;
    const lots0 = JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count]));
    const r1 = shootProp(st, ci, [0, 1.0, PROP_DEFS.shopCooler.d / 2]);
    expect(r1.material).toBe('glass');
    expect(r1.broke ?? null).toBeNull();
    const r2 = shootProp(st, ci, [0.1, 1.2, PROP_DEFS.shopCooler.d / 2]);
    expect(r2.broke).toBe('shatter');
    const s = st.sys.props.states.get(cooler)!;
    expect(s.glassBroken).toBe(true);
    const glass = s.parts!.filter(q => q.glass);
    expect(glass.length).toBeGreaterThan(0);
    expect(glass.every(q => !q.mesh.visible)).toBe(true);
    expect(s.parts!.some(q => !q.glass && q.mesh.visible)).toBe(true);
    expect(JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count]))).toBe(lots0);
    // glazing: merged shopfront triangles cut out for this one pane, which shatters to the plinth
    const gi = L.props.findIndex(p => p.kind === 'shopGlazing');
    const gz = L.props[gi];
    const quarter = Math.round(gz.rot / (Math.PI / 2)) & 1;
    const shootGlazing = () => {
      const front = new THREE.Vector3(Math.sin(gz.rot), 0, Math.cos(gz.rot));
      // glazing props carry the wall frame's yaw: approach from whichever side is open
      for (const sgn of [1, -1]) {
        const o = new THREE.Vector3(gz.x, 1.4, gz.z).addScaledVector(quarter ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), sgn * 1.5);
        const dir = new THREE.Vector3(gz.x, 1.3, gz.z).sub(o).normalize();
        const hh = rayAabb(o, dir, {x: gz.x - gz.hx, y: gz.y, z: gz.z - gz.hz}, {x: gz.x + gz.hx, y: gz.y + gz.h, z: gz.z + gz.hz});
        if (!hh) continue;
        void front;
        return st.sys.hitWorld({t: hh.t, kind: 'prop', nx: hh.n[0], ny: hh.n[1], nz: hh.n[2], prop: gi}, o.clone().addScaledVector(dir, hh.t), dir, {damage: 24, pellet: false, weapon: 'rifle'});
      }
      throw new Error('no ray to glazing');
    };
    const g1 = shootGlazing();
    expect(g1.material).toBe('glass');
    const cuts = st.sys.props.states.get(gz)!.cuts;
    expect(cuts.length).toBeGreaterThan(0);
    // the cut triangles are degenerate in the shared shopfront mesh (other panes keep theirs)
    const idx = cuts[0].mesh.geometry.index!.array;
    const t = cuts[0].tris[0];
    expect(idx[t * 3]).toBe(idx[t * 3 + 1]);
    expect(shootGlazing().broke).toBe('shatter');
    expect(gz.h).toBeLessThanOrEqual(0.3);
  });

  it('vending: the glass front cracks, then gives way like a pry (contents spill once, nothing re-rolled)', () => {
    const st = station(9001);
    const L = st.layout;
    const vi = L.props.findIndex(p => p.kind === 'vending' && st.cm.holderFor(p)!.state.lots.length > 0);
    const v = L.props[vi];
    const h = st.cm.holderFor(v)!;
    expect(h.state.open).toBe(false);
    const lots0 = JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count]));
    const d = PROP_DEFS.vending;
    const res: (string | null | undefined)[] = [];
    for (let k = 0; k < 5 && !h.state.open; k++) res.push(shootProp(st, vi, [-d.w * 0.1, d.h * 0.58, d.d / 2 + 0.01]).broke);
    expect(res[res.length - 1]).toBe('open');
    expect(res.length).toBeGreaterThanOrEqual(3);
    expect(h.state.open).toBe(true);
    expect(JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count]))).toBe(lots0);
  });

  it('bounded: detaching stops at MAX_DETACHED (later hits still register, fall back to decals)', () => {
    const st = station(1);
    const L = st.layout;
    const many = L.props.map((p, i) => ({p, i})).filter(({p}) => ['table', 'bench', 'bin', 'column', 'shelf', 'stockShelf', 'shopCounter', 'cabinetLow', 'cabinetTall'].includes(p.kind)).slice(0, MAX_DETACHED + 12);
    expect(many.length).toBeGreaterThan(MAX_DETACHED);
    let unmarked = 0;
    const t0 = performance.now();
    for (const {p, i} of many) {
      const r = st.sys.hitWorld({t: 1, kind: 'prop', nx: 0, ny: 1, nz: 0, prop: i}, new THREE.Vector3(p.x, p.y + p.h, p.z), new THREE.Vector3(0, -1, 0), {damage: 24, pellet: false, weapon: 'rifle'});
      if (r.object === 'prop' && !st.sys.props.states.get(p)!.parts) unmarked++;
    }
    const ms = (performance.now() - t0) / many.length;
    expect(st.sys.props.detachedCount).toBeLessThanOrEqual(MAX_DETACHED);
    expect(unmarked).toBeGreaterThan(0);
    console.info(`[damage] ${many.length} prop hits: ${st.sys.props.detachedCount} detached (cap ${MAX_DETACHED}), ${st.sys.props.clones} material clones, ${ms.toFixed(2)} ms/hit avg`);
    // per-prop damage lines are bounded too
    const s = st.sys.props.states.get(many[0].p)!;
    for (let k = 0; k < 30; k++) st.sys.hitWorld({t: 1, kind: 'prop', nx: 0, ny: 1, nz: 0, prop: many[0].i}, new THREE.Vector3(many[0].p.x + (k % 7) * 0.09 - 0.3, many[0].p.y + many[0].p.h, many[0].p.z + Math.floor(k / 7) * 0.08 - 0.15), new THREE.Vector3(0, -1, 0), {damage: 24, pellet: false, weapon: 'rifle'});
    for (const q of s.parts!) expect(q.lines.length).toBeLessThanOrEqual(DMG_MAX);
  });

  it('structural hits leave persistent craters that deepen in place; chunks fly and land on the floor', () => {
    const st = station(424242);
    const L = st.layout;
    const sp = L.playerSpawn;
    const e = {x: sp.x, y: L.grid.floorAt(sp.x, sp.z) + 1.6, z: sp.z};
    // a wall straight ahead of some direction
    let hit: {wh: ReturnType<typeof raycastWorld>; p: THREE.Vector3; d: THREE.Vector3} | null = null;
    for (let i = 0; i < 64 && !hit; i++) {
      const a = i / 64 * Math.PI * 2, d = new THREE.Vector3(Math.sin(a), -0.15, Math.cos(a)).normalize();
      const wh = raycastWorld(L.grid, L.props, e, d, 25, L.trench.floorY);
      if (wh.kind === 'wall' && wh.t > 1.5) hit = {wh, p: new THREE.Vector3(e.x, e.y, e.z).addScaledVector(d, wh.t), d};
    }
    expect(hit).toBeTruthy();
    const {wh, p, d} = hit!;
    const r1 = st.sys.hitWorld(wh, p, d, {damage: 24, pellet: false, weapon: 'rifle'});
    expect(['wall']).toContain(r1.object);
    expect(DAMAGE_CLASSES).toContain(r1.material as (typeof DAMAGE_CLASSES)[number]);
    for (let k = 0; k < 4; k++) st.sys.hitWorld(wh, p.clone().add(new THREE.Vector3(0.01 * k, 0.005 * k, 0)), d, {damage: 24, pellet: false, weapon: 'rifle'});
    expect(st.sys.craters.count).toBe(1);
    expect(st.sys.craters.list[0].depth).toBeGreaterThan(0.6);
    expect(st.sys.craters.list[0].size).toBeGreaterThan(DAMAGE_MATERIALS[r1.material as 'tile'].markSize);
    const live = st.sys.debris.live;
    expect(live).toBeGreaterThan(5);
    for (let k = 0; k < 60 * 4; k++) st.sys.update(1 / 60);
    // every chip came to rest on a supporting surface near the floor below the hit (never in the wall)
    const q = new StaticQuery(L);
    const rest = st.sys.debris.list(200);
    expect(rest.length).toBe(st.sys.debris.live);
    for (const r of rest) {
      expect(r.rest, `${r.shape} settled`).toBe(true);
      expect(q.insideSolid(r.x, r.y + 0.002, r.z), 'not inside solid').toBe(false);
      expect(r.y).toBeGreaterThan(q.surfaceBelow(r.x, r.z, r.y + 0.05) - 0.01);
      expect(r.y).toBeLessThan(q.surfaceBelow(r.x, r.z, r.y + 0.05) + 0.08);
    }
  });
});

describe('bounded pools', () => {
  it('debris never exceeds its caps or per-frame spawn budget, and fades away', () => {
    const d = new DebrisSystem();
    d.rand = mulberry(3);
    let maxLive = 0;
    for (let f = 0; f < 120; f++) {
      let ok = 0;
      for (let i = 0; i < 400; i++) if (d.spawn({x: 0, y: 1, z: 0, vx: 1, vy: 2, vz: 0, size: 0.03, color: new THREE.Color(1, 0, 0), shape: (['chunk', 'shard', 'glass', 'splinter', 'flake', 'blob'] as const)[i % 6]})) ok++;
      expect(ok).toBeLessThanOrEqual(DEBRIS_SPAWN_BUDGET);
      const t0 = performance.now();
      d.update(1 / 60);
      if (f === 119) console.info(`[damage] debris update with ${d.live} live pieces: ${(performance.now() - t0).toFixed(2)} ms`);
      maxLive = Math.max(maxLive, d.live);
      for (const [k, n] of Object.entries(d.liveByShape())) expect(n, k).toBeLessThanOrEqual(DEBRIS_CAPS[k as keyof typeof DEBRIS_CAPS]);
    }
    expect(maxLive).toBeLessThanOrEqual(DEBRIS_TOTAL_CAP);
    expect(d.dropped).toBeGreaterThan(0);
    for (const p of Object.values(d.pools)) expect(p.pieces.length).toBe(DEBRIS_CAPS[p.shape]);
    for (let f = 0; f < 60 * 80; f++) d.update(1 / 60);
    expect(d.live).toBe(0);
  });

  it('craters merge on the same spot and stay within CRATER_CAP', () => {
    const c = new CraterField();
    const spec = {size: 0.07, maxSize: 0.3, depth: 0.25, substrate: new THREE.Color(0.6, 0.6, 0.6), surface: new THREE.Color(0.9, 0.9, 0.9), style: 0 as const};
    const n = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 6; i++) c.hit(new THREE.Vector3(0.005 * i, 1.2, 0), n, spec, mulberry(1));
    expect(c.count).toBe(1);
    expect(c.merges).toBe(5);
    expect(c.list[0].depth).toBeCloseTo(Math.min(1, 0.25 * 0.8 + 0.25 * 2 + 0.125 * 3), 0);
    expect(c.list[0].size).toBeLessThanOrEqual(0.3);
    for (let i = 0; i < CRATER_CAP + 80; i++) c.hit(new THREE.Vector3(i * 0.5, 1.2, 0), n, spec, mulberry(i));
    expect(c.count).toBe(CRATER_CAP);
    expect(c.mesh.count).toBe(CRATER_CAP);
    // a hit on a perpendicular face never merges into a wall crater
    const before = c.count, m0 = c.merges;
    c.hit(new THREE.Vector3((CRATER_CAP + 79) * 0.5, 1.2, 0), new THREE.Vector3(0, 1, 0), spec);
    expect(c.merges).toBe(m0);
    expect(c.count).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------
// Zombie wounds on a synthetic rig: body + one wearable bound to the same skeleton

function rig(mats?: THREE.MeshStandardMaterial[]) {
  const bodyGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.6, 24, 32);
  bodyGeo.translate(0, 0.8, 0);
  const wearGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.7, 24, 14, true);
  wearGeo.translate(0, 0.95, 0);
  for (const g of [bodyGeo, wearGeo]) {
    const p = g.attributes.position, n = p.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const y = p.getY(i); si[i * 4] = y < 0.6 ? 0 : y < 1.3 ? 1 : 2; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  const hips = new THREE.Bone(), spine = new THREE.Bone(), head = new THREE.Bone();
  hips.name = 'Hips'; spine.name = 'Spine'; head.name = 'Head';
  spine.position.set(0, 0.6, 0); head.position.set(0, 0.7, 0);
  hips.add(spine); spine.add(head);
  const m = mats ?? [new THREE.MeshStandardMaterial({color: 0x8a8f7a}), new THREE.MeshStandardMaterial({color: 0x3a3d3a})];
  const body = new THREE.SkinnedMesh(bodyGeo, m[0]);
  body.name = 'ZombieBody';
  body.userData = {slot: 'body', wearable: null};
  body.add(hips);
  const root = new THREE.Group();
  root.add(body);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([hips, spine, head]);
  body.bind(skeleton);
  const wear = new THREE.SkinnedMesh(wearGeo, m[1]);
  wear.name = 'ZombieWear_upper';
  wear.userData = {slot: 'upper', wearable: 'hoodie'};
  root.add(wear);
  wear.bind(skeleton, body.bindMatrix);
  return {root, body, wear, spine, mats: [...m] as THREE.Material[], skeleton};
}

/** World position of a rest-space point skinned rigidly by bone j of `mesh`. */
function skinPoint(mesh: THREE.SkinnedMesh, j: number, rest: THREE.Vector3): THREE.Vector3 {
  const sk = mesh.skeleton;
  return rest.clone().applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(sk.bones[j].matrixWorld).multiply(sk.boneInverses[j]).multiply(mesh.bindMatrix));
}

describe('zombie wounds (rest-space, per actor)', () => {
  it('gives each actor its own patched material clones; wounds on one never mark another', () => {
    const shared = [new THREE.MeshStandardMaterial({color: 0x8a8f7a}), new THREE.MeshStandardMaterial({color: 0x3a3d3a})];
    const A = rig(shared), B = rig(shared);
    const wa = installWounds(A), wb = installWounds(B);
    expect(installWounds(A)).toBe(wa); // idempotent
    expect(woundsOf(A)).toBe(wa);
    expect(A.body.material).not.toBe(shared[0]);
    expect(A.body.material).not.toBe(B.body.material);
    expect(A.wear.material).not.toBe(B.wear.material);
    expect(shaderHookKeys(A.body.material as THREE.Material)).toContain(WOUND_HOOK);
    expect(shaderHookKeys(shared[0])).not.toContain(WOUND_HOOK);
    // the actor's own material list (hit flash / dispose) points at the clones
    expect(A.mats).toContain(A.body.material);
    expect(wa.layers.map(l => [l.slot, l.cls])).toEqual([['body', 'flesh'], ['upper', 'cloth']]);
    A.root.position.set(3, 0, 2);
    A.root.updateMatrixWorld(true);
    const rest = new THREE.Vector3(0, 1.0, 0.17);
    const world = skinPoint(A.wear, 1, rest);
    const r = wa.add({point: world.clone().add(new THREE.Vector3(0, 0, 0.04)), dir: new THREE.Vector3(0, 0, -1), part: 'torso', damage: 24})!;
    expect(r.slot).toBe('upper');
    expect(r.cls).toBe('cloth');
    expect(r.entry.distanceTo(world)).toBeLessThan(0.02);
    expect(wa.count).toBe(1);
    expect(wa.uniforms.uWoundN.value).toBe(1);
    expect(wb.uniforms.uWoundN.value).toBe(0);
    // a torso hit below the garment hem enters the skin
    const restLow = new THREE.Vector3(0, 0.45, 0.15);
    const r2 = wa.add({point: skinPoint(A.body, 0, restLow).add(new THREE.Vector3(0, 0, 0.05)), dir: new THREE.Vector3(0, 0, -1), part: 'torso', damage: 24})!;
    expect(r2.slot).toBe('body');
    expect(r2.cls).toBe('flesh');
  });

  it('wounds live in bind space: the same body point hit in two different poses is one wound', () => {
    const A = rig();
    const w = installWounds(A);
    const rest = new THREE.Vector3(0, 1.05, 0.17);
    A.spine.rotation.set(0, 0, 0.5);
    A.root.rotation.y = 0.8;
    A.root.updateMatrixWorld(true);
    const n1 = new THREE.Vector3(0, 0, 1).transformDirection(new THREE.Matrix4().copy(A.spine.matrixWorld).multiply(A.skeleton.boneInverses[1]));
    const p1 = skinPoint(A.wear, 1, rest);
    w.add({point: p1.clone().addScaledVector(n1, 0.03), dir: n1.clone().negate(), part: 'torso', damage: 24});
    const c1 = w.wounds[0].c.clone();
    expect(c1.distanceTo(rest)).toBeLessThan(0.02);
    // ragdoll-like new pose: bend the other way, turn the body around and move it
    A.spine.rotation.set(0.4, 0, -0.6);
    A.root.rotation.y = -2.1;
    A.root.position.set(-4, 0.3, 7);
    A.root.updateMatrixWorld(true);
    const n2 = new THREE.Vector3(0, 0, 1).transformDirection(new THREE.Matrix4().copy(A.spine.matrixWorld).multiply(A.skeleton.boneInverses[1]));
    const p2 = skinPoint(A.wear, 1, rest);
    expect(p2.distanceTo(p1)).toBeGreaterThan(1); // the surface point moved a lot in the world
    const r = w.add({point: p2.clone().addScaledVector(n2, 0.03), dir: n2.clone().negate(), part: 'torso', damage: 24})!;
    expect(r.merged).toBe(true);
    expect(w.count).toBe(1);
    expect(w.wounds[0].c.distanceTo(c1)).toBeLessThan(0.02);
    expect(w.wounds[0].strength).toBeGreaterThan(0.42);
  });

  it('caps wounds per zombie (nearby hits merge, shotgun pellets grow tears) and seeds deterministically', () => {
    const A = rig(), B = rig();
    const wa = installWounds(A), wb = installWounds(B);
    for (const [w, actor] of [[wa, A], [wb, B]] as const) {
      actor.root.updateMatrixWorld(true);
      for (let i = 0; i < 40; i++) {
        const ang = i * 0.7, y = 0.25 + (i % 10) * 0.12;
        const rest = new THREE.Vector3(Math.sin(ang) * 0.15, y, Math.cos(ang) * 0.15);
        const j = y < 0.6 ? 0 : y < 1.3 ? 1 : 2;
        const p = skinPoint(actor.body, j, rest);
        const n = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        w.add({point: p.addScaledVector(n, 0.03), dir: n.clone().negate(), part: 'torso', damage: 15, pellet: true});
      }
    }
    expect(wa.count).toBeLessThanOrEqual(WOUND_MAX);
    expect(wa.hits).toBe(40);
    expect(wa.wounds.map(x => x.seed)).toEqual(wb.wounds.map(x => x.seed));
    expect(wa.wounds.map(x => +x.r.toFixed(5))).toEqual(wb.wounds.map(x => +x.r.toFixed(5)));
    for (const x of wa.wounds) expect(x.r).toBeLessThanOrEqual(DAMAGE_MATERIALS.flesh.markMax * 1.15 + 1e-6);
  });

  it('chains with earlier hooks (other lanes / iteration-04 world mapping) and keeps three anchors', () => {
    for (const m of [THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.standard.fragmentShader]) expect(m.length).toBeGreaterThan(100);
    for (const a of DMG_ANCHORS.vertex) expect(THREE.ShaderLib.standard.vertexShader).toContain(a);
    for (const a of DMG_ANCHORS.fragment) expect(THREE.ShaderLib.standard.fragmentShader).toContain(a);
    const src = new THREE.MeshStandardMaterial();
    addShaderHook(src, 'lane-x-test', sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n// LANE_X_MARK'); });
    const A = rig([src, new THREE.MeshStandardMaterial()]);
    installWounds(A);
    const mat = A.body.material as THREE.Material;
    expect(shaderHookKeys(mat)).toEqual(['lane-x-test', WOUND_HOOK]);
    expect(mat.customProgramCacheKey()).toContain(WOUND_HOOK);
    expect(mat.customProgramCacheKey()).toContain('lane-x-test');
    const sh = compile(mat);
    expect(sh.fragmentShader).toContain('// LANE_X_MARK');
    expect(sh.fragmentShader).toContain('woundField( vWoundP )');
    expect(sh.vertexShader).toContain('vWoundP = transformed;');
    expect(sh.vertexShader.indexOf('vWoundP = transformed;')).toBeLessThan(sh.vertexShader.indexOf('#include <skinning_vertex>'));
    expect(sh.fragmentShader).toContain('#include <lights_fragment_begin>'); // light-field chunk path intact
    expect(sh.uniforms.uWoundA).toBeTruthy();
    // prop damage clone of a world-mapped shape material keeps the iteration-04 mapping
    const st = station(2);
    const L = st.layout;
    const ti = L.props.findIndex(p => p.kind === 'table');
    shootProp(st, ti, [0, PROP_DEFS.table.h - 0.01, 0.5]);
    const part = st.sys.props.states.get(L.props[ti])!.parts!.find(q => (q.mesh.material as THREE.Material).userData.worldMapping)!;
    expect(part).toBeTruthy();
    const pm = part.mesh.material as THREE.Material;
    expect(pm.customProgramCacheKey()).toContain('world-mapped-v1');
    expect(pm.customProgramCacheKey()).toContain(PROP_DAMAGE_HOOK);
    const ps = compile(pm);
    expect(ps.vertexShader).toContain('vWmPos');
    expect(ps.fragmentShader).toContain('dmgField( vDmgP');
    expect(ps.uniforms.uWmMap).toBeTruthy();
    expect(ps.uniforms.uDmgA).toBeTruthy();
    expect(shapeMaterial(st.mats, 'counter').customProgramCacheKey()).not.toContain(PROP_DAMAGE_HOOK);
  });
});

describe('damage shaders resolve in order (no WebGL in Node: declaration-before-use check)', () => {
  const resolve = (src: string): string => src.replace(/#include <(\w+)>/g, (_m, n: string) => resolve((THREE.ShaderChunk as unknown as Record<string, string>)[n] ?? ''));
  const before = (src: string, decl: string, use: string) => {
    const a = src.indexOf(decl), b = src.indexOf(use);
    expect(a, `declares ${decl}`).toBeGreaterThanOrEqual(0);
    expect(b, `uses ${use}`).toBeGreaterThanOrEqual(0);
    expect(a, `${decl} before ${use}`).toBeLessThan(b);
  };
  it('wound, prop-damage and crater hooks insert after the declarations they use', () => {
    // wounds (skinned standard material)
    const A = rig();
    installWounds(A);
    const w = compile(A.body.material as THREE.Material);
    const wv = resolve(w.vertexShader), wfr = resolve(w.fragmentShader);
    before(wv, 'vec3 transformed', 'vWoundP = transformed;');
    before(wv, 'vWoundP = transformed;', 'skinVertex');
    before(wv, 'float woundDisp', 'woundDisp( transformed )');
    for (const [d, u] of [['vec4 diffuseColor', 'vec4 wf ='], ['float dmgNoise', 'dmgNoise( q )'], ['vec4 woundField', 'woundField( vWoundP )'], ['float roughnessFactor', 'roughnessFactor = mix( roughnessFactor, 0.34'],
      ['float metalnessFactor', 'metalnessFactor *= 1.0 - wf.x'], ['float faceDirection', 'faceDirection );'], ['vec3 dmgPerturb', 'normal = dmgPerturb'], ['varying vec3 vViewPosition', '- vViewPosition, normal']] as const) before(wfr, d, u);
    expect(wfr.match(/#define DMG_COMMON/g)?.length).toBe(1);
    // prop damage (world-mapped shape material clone)
    const st = station(3);
    const ti = st.layout.props.findIndex(p => p.kind === 'table');
    shootProp(st, ti, [0, PROP_DEFS.table.h - 0.01, 0.5]);
    for (const q of st.sys.props.states.get(st.layout.props[ti])!.parts!) {
      const sh = compile(q.mesh.material as THREE.Material);
      const pv = resolve(sh.vertexShader), pf = resolve(sh.fragmentShader);
      before(pv, 'vec3 transformed', 'vDmgP = ( uDmgRest');
      for (const [d, u] of [['vec4 diffuseColor', 'int dMode = uDmgMode'], ['vec4 dmgField', 'dmgField( vDmgP'], ['float roughnessFactor', 'roughnessFactor = mix( roughnessFactor, 0.38'], ['float metalnessFactor', 'metalnessFactor = mix( metalnessFactor, 0.75'],
        ['vec3 normal', 'normal = dmgPerturb'], ['vec3 totalEmissiveRadiance', 'totalEmissiveRadiance *= ( 1.0 - uDmgDead )'], ['uniform vec3 uDmgSub', 'uDmgSub *']] as const) before(pf, d, u);
      expect(pf).toContain('vWmPos'); // iteration-04 world mapping still there
    }
    // craters (instanced decal)
    const c = new CraterField();
    const cs = compile(c.mesh.material as THREE.Material);
    const cf = resolve(cs.fragmentShader), cv = resolve(cs.vertexShader);
    before(cv, 'vec3 transformed', 'vCrUv = uv');
    before(cf, 'vec4 diffuseColor', 'crP = vCrUv');
    before(cf, 'float crR;', 'crR = length( crP )');
    before(cf, 'vec3 normal', 'normal = normalize( T * nT.x');
  });
});

describe('loose pickups', () => {
  it('a near-miss knocks a pickup a little; it stays on reachable floor and is never removed', () => {
    const L = generateStation(424242);
    const sp = L.playerSpawn;
    const sys = new DamageSystem(null, null);
    sys.rand = mulberry(9);
    const obj = new THREE.Object3D();
    const y0 = L.grid.floorAt(sp.x, sp.z);
    const pk = {stack: {itemId: 'cola', uid: 7}, x: sp.x, y: y0, z: sp.z, obj};
    const list = [pk];
    sys.build(L, null, [], {pickups: () => list});
    const o = {x: sp.x - 3, y: y0 + 0.08, z: sp.z}, d = {x: 1, y: 0, z: 0};
    expect(sys.knockPickups(o, d, 10)).toBe(1);
    for (let i = 0; i < 240; i++) sys.update(1 / 60);
    expect(list.length).toBe(1);
    const moved = Math.hypot(pk.x - sp.x, pk.z - sp.z);
    expect(moved).toBeGreaterThan(0.05);
    expect(moved).toBeLessThan(2.5);
    expect(L.grid.passable(...L.grid.cellOf(pk.x, pk.z))).toBe(true);
    expect(Math.abs(pk.y - L.grid.floorAt(pk.x, pk.z))).toBeLessThan(0.5);
    expect(obj.position.x).toBeCloseTo(pk.x, 6);
  });
});
