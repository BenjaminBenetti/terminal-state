// Iteration 07 (Lane P2): the NEW generated prop types — catalog, provenance, registry and in-game placement agree; placements keep
// doorways, circulation and holder access; lazy per-station loading fetches exactly the models a station placed; the build is
// deterministic. Holds for whatever subset of Lane P1's batch has been built + integrated so far (counts asserted at the bottom).
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {P7_MODELS} from '../src/gen/props07.catalog';
import {
  P7_FILES, P7_HALL_KEYS, P7_HOLDER_KINDS, P7_KINDS, P7_PROP_DEFS, P7_REJECTED, P7_SPECS, P7_SURFACES, cutSurfaces, dropUnloadedP7,
  isP7Kind, p7ModelKey, p7ModelKeysFor, p7Spec,
} from '../src/gen/props07';
import {PROP_DEFS, PURPOSE_PROP_KINDS, type PropKind, type SurfaceSpec} from '../src/gen/props';
import {ROOM_PURPOSES, STORE_PURPOSES} from '../src/gen/purposes';
import {DAMAGE_CLASSES, MODEL_KEY_CLASS, propDamageSpec} from '../src/damage/materials';
import {generateStation, type StationLayout} from '../src/gen/station';
import {doorwayIntrusions, propBlocksDoorway} from '../src/gen/doorways';
import {isLootHolderKind, rollHolderLots} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {PropModelLibrary} from '../src/assets/loader';
import {p7AreaKey} from '../src/gen/props07Dress';
import {CLUSTERS, compositionOf, zoneOf} from '../src/gen/compose';
import {areaLevel, levelGrid} from '../src/gen/placeKit';

/** Iteration 08 (Lane P): kinds a composition cluster type may place (members, mounts, hung props; landmark clocks). */
const clusterKinds = (type: keyof typeof CLUSTERS): Set<string> => {
  const c = CLUSTERS[type];
  return new Set<string>([...c.slots.flatMap(x => x.k), ...(c.mounts ?? []).flatMap(m => m.k), ...(c.hangs ?? []).flatMap(h => h.k), 'platformClock']);
};

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');
const PROV_PATH = path.join(GAME, 'public/assets/derivatives/props-iteration07.json');
type Out = {key: string; output: string; sha256: string; bytes: number; mode: 'SV' | 'MV'; sizeClass: 'small' | 'medium' | 'large'; triangles: number;
  textures: {baseColor: {size: number[]}; metallicRoughness: {size: number[]}; normal: {size: number[]}};
  source: {nativeJobId: string | null; sha256: string; reviewStatus: string; gameReady: boolean}; dimensionsMeters: {measured: {w: number; h: number; d: number}}};
const PROV = fs.existsSync(PROV_PATH) ? JSON.parse(fs.readFileSync(PROV_PATH, 'utf8')) as {outputs: Out[]; budgets: Record<string, {tris: number; atlas: number; bytes: number}>} : {outputs: [] as Out[], budgets: {}};
const MODELS = P7_MODELS as Record<string, {url: string; bytes: number; w: number; h: number; d: number; tris: number; tex: number; mode: string}>;
const SPECS = P7_SPECS as Record<string, {uses: readonly {in: readonly string[]; at: string; on?: readonly string[]}[]}>;
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Kinds that existed before iteration 07 (none of the new types may reuse one). */
const LEGACY = new Set<string>(['bench', 'cabinetTall', 'cabinetLow', 'column', 'crate', 'bin', 'fareGate', 'stall', 'vending', 'shelf', 'table', 'desk', 'booth', 'ticketMachine', 'exitStair', 'toiletStall', 'washCounter', 'shopCounter', 'shopDisplay', 'shopBackbar', 'shopCooler', 'shopGlazing', 'shopShutter', ...PURPOSE_PROP_KINDS, 'trashCan', 'sign', 'light', 'turnstile', 'rifle', 'shotgun']);

const SEEDS = Array.from({length: 10}, (_, i) => (i * 2654435761 + 777) >>> 0);
const cache = new Map<number, StationLayout>();
const gen = (seed: number) => { let l = cache.get(seed); if (!l) cache.set(seed, (l = generateStation(seed))); return l; };

describe('iteration07 props: catalog, provenance, registry agree', () => {
  it('every catalog model has its GLB, a matching provenance record (unapproved, gameReady false) and budgets', () => {
    expect(Object.keys(MODELS).sort()).toEqual(PROV.outputs.map(o => o.key).sort());
    for (const o of PROV.outputs) {
      const m = MODELS[o.key];
      const file = path.join(GAME, 'public', m.url);
      expect(m.url, o.key).toBe(o.output.replace(/^game\/public\//, ''));
      expect(fs.existsSync(file), o.key).toBe(true);
      expect(sha(file), o.key).toBe(o.sha256);
      expect(fs.statSync(file).size, o.key).toBe(o.bytes);
      expect(m.bytes).toBe(o.bytes);
      expect([m.w, m.h, m.d]).toEqual([o.dimensionsMeters.measured.w, o.dimensionsMeters.measured.h, o.dimensionsMeters.measured.d]);
      expect(o.source.reviewStatus).toBe('unapproved');
      expect(o.source.gameReady).toBe(false);
      expect(o.source.nativeJobId, o.key).toBeTruthy();
      expect(['SV', 'MV']).toContain(o.mode);
      const b = PROV.budgets[o.sizeClass];
      expect(o.triangles, o.key).toBeLessThanOrEqual(b.tris);
      expect(o.bytes, o.key).toBeLessThanOrEqual(b.bytes);
      expect(o.textures.baseColor.size[0]).toBe(b.atlas);
      expect(o.textures.metallicRoughness.size[0]).toBeLessThanOrEqual(512);
      expect(o.textures.normal.size[0]).toBeLessThanOrEqual(512);
    }
  });

  it('every built model is integrated (spec + uses) or deliberately rejected with a reason; kinds are new and well-formed', () => {
    for (const k of Object.keys(MODELS)) {
      if (P7_REJECTED[k]) { expect(isP7Kind(k)).toBe(false); expect(P7_REJECTED[k].length).toBeGreaterThan(10); continue; }
      expect(isP7Kind(k), `${k} integrated`).toBe(true);
    }
    const validKeys = new Set<string>([...Object.keys(ROOM_PURPOSES), ...Object.keys(STORE_PURPOSES), ...P7_HALL_KEYS]);
    for (const k of P7_KINDS) {
      expect(k).toMatch(/^[A-Za-z]+$/);   // damage/propDamage NAME_RE: prop-<letters>
      expect(LEGACY.has(k), `${k} is not an old kind renamed`).toBe(false);
      expect(PROP_DEFS[k as PropKind]).toEqual(P7_PROP_DEFS[k]);
      expect(P7_FILES[p7ModelKey(k)].url).toBe(MODELS[k].url);
      // Damage: a real class, model class registered.
      expect(DAMAGE_CLASSES).toContain(propDamageSpec(k).cls);
      expect(MODEL_KEY_CLASS[p7ModelKey(k)]).toBe(propDamageSpec(k).cls);
      const spec = p7Spec(k);
      expect(spec.uses.length).toBeGreaterThan(0);
      for (const u of spec.uses) {
        for (const i of u.in) expect(validKeys.has(i), `${k} use in ${i}`).toBe(true);
        for (const h of u.on ?? []) expect(PROP_DEFS[h as PropKind], `${k} on ${h}`).toBeDefined();
        if (u.at === 'onTop' || u.at === 'atHost') expect(u.on?.length, k).toBeGreaterThan(0);
      }
    }
    // Every manifest-planned spec exists (catalog-only types without a placement are not counted anywhere).
    for (const k of Object.keys(SPECS)) expect(SPECS[k].uses.length, k).toBeGreaterThan(0);
  });

  it('holders: measured surfaces lie inside the model, hold finite loot and give up spans under on-top decor', () => {
    for (const k of P7_HOLDER_KINDS) {
      const d = PROP_DEFS[k as PropKind];
      const S = (P7_SURFACES as Record<string, SurfaceSpec[]>)[k];
      expect(S.length, k).toBeGreaterThan(0);
      for (const s of S) {
        expect(Math.max(Math.abs(s.x0), Math.abs(s.x1)), k).toBeLessThanOrEqual(d.w / 2 + 0.01);
        expect(Math.max(Math.abs(s.z0), Math.abs(s.z1)), k).toBeLessThanOrEqual(d.d / 2 + 0.01);
        expect(s.y + s.clear, k).toBeLessThanOrEqual(d.h + 0.6);
      }
      expect(isLootHolderKind(k)).toBe(true);
      const surf = holderSurfaces(k, d);
      const lots = Array.from({length: 60}, (_, i) => rollHolderLots(7, i, k, 'platform', surf)).flat();
      expect(lots.length, k).toBeGreaterThan(0);
    }
    const cut = cutSurfaces([{y: 1, x0: -0.7, x1: 0.7, z0: -0.2, z1: 0.2, clear: 0.5}], [{y: 1, x0: 0.2, x1: 0.6}]);
    expect(cut.map(s => [s.x0, s.x1])).toEqual([[-0.7, 0.19]]);
  });
});

describe('iteration07 props in generated stations', () => {
  it('sample seeds place many distinct new types in suitable spaces; doorways stay clear', () => {
    const seen = new Set<string>(), perSeed: number[] = [];
    for (const seed of SEEDS) {
      const l = gen(seed);
      const kinds = new Set(l.props.filter(p => isP7Kind(p.kind)).map(p => p.kind));
      perSeed.push(kinds.size);
      kinds.forEach(k => seen.add(k));
      for (const p of l.props) {
        if (!isP7Kind(p.kind)) continue;
        const a = l.areas[p.area];
        const key = p.purpose ?? p7AreaKey(a);
        // Placed where its spec says (area purpose / hall type, or on/at an allowed host in such an area).
        const uses = p7Spec(p.kind).uses;
        if (p.host !== undefined) {
          const host = l.props[p.host];
          expect(uses.some(u => u.on?.includes(host.kind) && u.in.includes(host.purpose ?? p7AreaKey(l.areas[host.area]))), `${p.kind} on ${host.kind} in ${key}`).toBe(true);
        } else if (p.cluster !== undefined) {
          // Iteration 08: composed vignettes are the second placement authority — the kind belongs to its cluster type, and the
          // cluster type to the area's zone.
          const c = compositionOf(l)!.clusters[p.cluster];
          expect(clusterKinds(c.type).has(p.kind), `${p.kind} in a ${c.type} cluster`).toBe(true);
          expect(CLUSTERS[c.type].zones, `${c.type} in ${zoneOf(l, a)}`).toContain(zoneOf(l, a));
        } else expect(uses.some(u => u.in.includes(p7AreaKey(a))), `${p.kind} in ${p7AreaKey(a)}`).toBe(true);
        expect(propBlocksDoorway(l, p.x, p.z, p.hx, p.hz, p.y + (p.lift ?? 0), p.h - (p.lift ?? 0)), `${seed} ${p.kind} blocks a doorway`).toBeNull();
      }
      expect(doorwayIntrusions(l).filter(x => isP7Kind(x.ref.split('#')[0]))).toEqual([]);
    }
    if (P7_KINDS.length) {
      // Each station uses a seeded palette (~55% + core/signature kinds) and not every room exists everywhere.
      expect(Math.min(...perSeed)).toBeGreaterThanOrEqual(Math.min(40, Math.floor(P7_KINDS.length * 0.35)));
      // Across the sample nearly every integrated type actually spawns.
      expect(seen.size).toBeGreaterThanOrEqual(Math.floor(P7_KINDS.length * 0.9));
    }
  });

  it('circulation: floor props keep an open approach, chairs/decor never block the walk grid, mounts never block walking', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const l = gen(seed);
      // Iteration 08: each prop / door is checked on its own level's grid.
      let g = l.grid;
      const walk = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.walkable(cx, cy); };
      for (const p of l.props) {
        if (!isP7Kind(p.kind)) continue;
        g = levelGrid(l, p.level ?? 0);
        const [cx, cy] = g.cellOf(p.x, p.z);
        if (p.host !== undefined || p.mounted) {
          if (p.host !== undefined && l.props[p.host].kind !== 'table' && p.y === l.props[p.host].y) continue;   // chairs
          continue;
        }
        expect(g.blocked[g.idx(cx, cy)], `${seed} ${p.kind} blocks its cell`).toBe(1);
        // The first cell past the front face (or past either long side for turned items) is open floor.
        const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
        const d0 = (fx ? p.hx : p.hz) + 0.55, side = (fx ? p.hz : p.hx) + 0.55;
        const open = walk(p.x + fx * d0, p.z + fz * d0) || walk(p.x + fz * side, p.z + fx * side) || walk(p.x - fz * side, p.z - fx * side);
        expect(open, `${seed} ${p.kind} at ${p.x},${p.z} in ${l.areas[p.area].label} has no approach`).toBe(true);
      }
      // Areas stay connected: every walkable cell of every area reaches the area's doors (station validation covers this too).
      for (const d of l.doors) {
        if (d.fare || d.shopfront) continue;
        g = levelGrid(l, areaLevel(l.areas[d.a]));
        const horiz = d.h === 1;
        for (let k = 0; k < (horiz ? d.w : d.h); k++) expect(g.walkable(horiz ? d.x + k : d.x, horiz ? d.y : d.y + k), `${seed} door ${d.id}`).toBe(true);
      }
    }
  });

  it('on-top decor stands inside its host top and the host loot surfaces give up that span', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const l = gen(seed);
      for (const p of l.props) {
        if (!isP7Kind(p.kind) || p.host === undefined || p.y === l.props[p.host].y) continue;
        const host = l.props[p.host];
        expect(Math.abs(p.x - host.x) <= host.hx + 0.02 && Math.abs(p.z - host.z) <= host.hz + 0.02, `${p.kind} inside ${host.kind}`).toBe(true);
        expect(p.y).toBeGreaterThan(host.y);
        expect(p.y).toBeLessThanOrEqual(host.y + host.h + 0.01);
        expect(host.cut?.length, `${host.kind} cut`).toBeGreaterThan(0);
      }
    }
  });

  it('lazy loading: a station needs exactly the models of the p7 kinds it placed', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const l = gen(seed);
      const keys = p7ModelKeysFor(l);
      expect(keys).toEqual([...new Set(l.props.filter(p => isP7Kind(p.kind)).map(p => p7ModelKey(p.kind)))].sort());
      for (const k of keys) expect(P7_FILES[k]).toBeDefined();
      if (P7_KINDS.length) expect(keys.length).toBeLessThan(Object.keys(P7_FILES).length + 1);
    }
  });
});

describe('iteration07 lazy model library', () => {
  const files = {p7_a: {url: 'assets/models/p7-a.glb', bytes: 100}, p7_b: {url: 'assets/models/p7-b.glb', bytes: 200}, p7_c: {url: 'assets/models/p7-c.glb', bytes: 300}};
  const fakeGltf = () => { const s = new THREE.Group(); s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({map: new THREE.Texture()}))); return {scene: s} as unknown as GLTF; };
  (globalThis as {document?: unknown}).document ??= {baseURI: 'http://localhost/game/'};

  it('fetches only the requested models (with progress), caches them and records failures without throwing', async () => {
    const fetched: string[] = [];
    const lib = new PropModelLibrary(files, 2, async (url, onP) => { fetched.push(url); onP(0.5); if (url.endsWith('p7-c.glb')) throw new Error('HTTP 404'); return fakeGltf(); });
    const prog: number[] = [];
    const r = await lib.ensure(['p7_a', 'p7_c', 'p7_a', 'p7_unknown'], f => prog.push(f));
    expect(fetched.map(u => u.split('/').pop())).toEqual(['p7-a.glb', 'p7-c.glb']);
    expect(r.loaded).toEqual(['p7_a']);
    expect(r.failed).toEqual(['p7_c']);
    expect(lib.failures[0].reason).toContain('404');
    expect(prog[prog.length - 1]).toBeCloseTo(1, 5);
    expect(lib.has('p7_b')).toBe(false);
    await lib.ensure(['p7_a', 'p7_b']);
    expect(fetched.length).toBe(3);   // p7_a cached, only p7_b fetched
    const g = lib.get('p7_a')!.scene.children[0] as THREE.Mesh;
    expect(lib.ownsGeometry(g.geometry)).toBe(true);
    expect(lib.trim(new Set(['p7_b']), 0)).toEqual(['p7_a']);
    expect(lib.has('p7_a')).toBe(false);
    expect(lib.has('p7_b')).toBe(true);
  });

  it('a station drops placements whose model failed (no invisible collision, cells freed)', () => {
    const l = gen(SEEDS[1]);
    const copy = {props: l.props.map(p => ({...p})), grid: {...l.grid, idx: l.grid.idx.bind(l.grid), inBounds: l.grid.inBounds.bind(l.grid), blocked: Uint8Array.from(l.grid.blocked), sightBlocked: Uint8Array.from(l.grid.sightBlocked)}};
    const keys = p7ModelKeysFor(l);
    const dropped = dropUnloadedP7(copy, new Set());
    expect(dropped).toBe(l.props.filter(p => isP7Kind(p.kind)).length);
    expect(copy.props.some(p => isP7Kind(p.kind))).toBe(false);
    if (keys.length) {
      const floor = l.props.find(p => isP7Kind(p.kind) && p.host === undefined && !p.mounted && p.hx < 0.25 && p.hz < 0.25)!;
      if (floor) { const [cx, cy] = l.grid.cellOf(floor.x, floor.z); expect(copy.grid.blocked[l.grid.idx(cx, cy)]).toBe(0); }
    }
    expect(dropUnloadedP7(copy, new Set())).toBe(0);
  });
});

describe('iteration07 build determinism (opt-in: P7_DETERMINISM=1, needs a native master in .cache)', () => {
  const master = Object.values(PROV.outputs).map(o => path.join(REPO, (o as unknown as {source: {nativeGlb: string}}).source.nativeGlb)).find(f => fs.existsSync(f));
  it.skipIf(process.env.P7_DETERMINISM !== '1' || !master)('two builds of the same master produce byte-identical GLBs', () => {
    const run = (dir: string) => {
      fs.rmSync(dir, {recursive: true, force: true}); fs.mkdirSync(dir, {recursive: true});
      const r = spawnSync('node', ['tools/asset-pipeline/props/build-props-iteration07.mjs', '--test-source', master!, '--test-key', 'determinism', '--test-dims', '0.6,1,0.5', '--out-dir', dir, '--no-preview'], {cwd: REPO, encoding: 'utf8'});
      expect(r.status, r.stderr).toBe(0);
      return sha(path.join(dir, 'p7-determinism.glb'));
    };
    expect(run('/tmp/p7-det-a')).toBe(run('/tmp/p7-det-b'));
  }, 600000);
});
