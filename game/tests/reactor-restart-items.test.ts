// Task reactor-build-20261101 (lane RESTART): the restart parts in the item registry (ids, kind 'part', stacks, dims, icons, damage /
// physics classes), their models (kit GLB fitted to ITEM_DIMS; procedural stand-in with the same bounds when the GLB is missing), that
// they are FINITE (no loot table / economy category ever produces them), and the persistent local milestone (storage optional).
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {ITEMS, ITEM_DIMS, itemDef} from '../src/items/items';
import {ICONS} from '../src/ui/icons';
import {ITEM_CLASS, ITEM_PHYSICS} from '../src/damage/materials';
import {Inventory} from '../src/items/inventory';
import * as LT from '../src/items/lootTables';
import {econCat} from '../src/items/lootTables';
import {REACTOR_KIT} from '../src/assets/reactorKit.generated';
import {REACTOR_ITEM_IDS, reactorItemModel, reactorItemSource, registerReactorItemModels, resetReactorItemCache} from '../src/world/reactor/restartItems';
import {itemTemplate, registerItemModels} from '../src/world/pickups';
import {MILESTONES_KEY, milestoneBadge, readMilestones, recordReactorRestarted, type MilestoneStorage} from '../src/run/milestones';

afterEach(() => resetReactorItemCache());

const bounds = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe('restart parts in the item registry', () => {
  it('startup key + fuse cartridge: ids, names, kind part, stack sizes, icons, dims = kit dims, damage / physics classes', () => {
    expect(REACTOR_ITEM_IDS).toEqual(['reactor_key', 'fuse_cartridge']);
    expect(itemDef('reactor_key')).toMatchObject({name: 'Startup key', kind: 'part', stackMax: 1, icon: 'reactorKey'});
    expect(itemDef('fuse_cartridge')).toMatchObject({name: 'Fuse cartridge', kind: 'part', stackMax: 3, icon: 'fuseCartridge'});
    expect(Object.values(ITEMS).filter(d => d.kind === 'part').map(d => d.id).sort()).toEqual(['fuse_cartridge', 'reactor_key']);
    for (const id of REACTOR_ITEM_IDS) {
      expect(ICONS[itemDef(id).icon]).toMatch(/^<svg/);
      expect(ITEM_CLASS[id]).toBeDefined();
      expect(ITEM_PHYSICS[id].mass).toBeGreaterThan(0);
    }
    const kd = (k: readonly [number, number, number]) => [k[0], k[2], k[1]];
    expect([ITEM_DIMS.reactor_key.w, ITEM_DIMS.reactor_key.d, ITEM_DIMS.reactor_key.h]).toEqual(kd(REACTOR_KIT.reactorKey.dims));
    expect([ITEM_DIMS.fuse_cartridge.w, ITEM_DIMS.fuse_cartridge.d, ITEM_DIMS.fuse_cartridge.h]).toEqual(kd(REACTOR_KIT.fuseCartridge.dims));
  });

  it('parts go to the pockets first and stack as declared', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('fuse_cartridge', 2));
    inv.add(inv.makeStack('reactor_key', 1));
    expect(inv.hotbar.some(s => s?.itemId === 'fuse_cartridge' || s?.itemId === 'reactor_key')).toBe(false);
    expect(inv.count('fuse_cartridge')).toBe(2);
    expect(inv.take('reactor_key', 1)).toBe(1);
  });

  it('finite: no loot table, pool, reward or economy category ever names them', () => {
    for (const id of REACTOR_ITEM_IDS) expect(econCat(id)).toBeNull();
    const seen = new Set<unknown>();
    const hits: string[] = [];
    const walk = (v: unknown, path: string, depth: number): void => {
      if (depth > 9 || v === null || v === undefined) return;
      if (typeof v === 'string') { if ((REACTOR_ITEM_IDS as readonly string[]).includes(v)) hits.push(path); return; }
      if (typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (v instanceof Map) { for (const [k, x] of v) { walk(k, `${path}.<key>`, depth + 1); walk(x, `${path}.${String(k)}`, depth + 1); } return; }
      if (v instanceof Set) { for (const x of v) walk(x, `${path}[]`, depth + 1); return; }
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if ((REACTOR_ITEM_IDS as readonly string[]).includes(k)) hits.push(`${path}.${k}`);
        walk(x, `${path}.${k}`, depth + 1);
      }
    };
    for (const [k, v] of Object.entries(LT)) walk(v, k, 0);
    expect(hits).toEqual([]);
  });
});

describe('restart part models', () => {
  it('procedural stand-ins (no kit GLB loaded) match ITEM_DIMS within 1 mm, bottom-centre origin', () => {
    for (const id of REACTOR_ITEM_IDS) {
      const b = bounds(reactorItemModel(id)), d = ITEM_DIMS[id];
      expect(b.max.x - b.min.x, id).toBeCloseTo(d.w, 3);
      expect(b.max.z - b.min.z, id).toBeCloseTo(d.d, 3);
      expect(b.max.y - b.min.y, id).toBeLessThanOrEqual(d.h + 0.001);
      expect(b.min.y, id).toBeCloseTo(0, 4);
      expect((b.min.x + b.max.x) / 2, id).toBeCloseTo(0, 3);
      expect(reactorItemSource(id)).toMatch(/procedural stand-in/);
    }
  });

  it('a delivered model is fitted uniformly into ITEM_DIMS and becomes the item template (world, hands, icons, seated parts)', () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.124, 0.124), new THREE.MeshStandardMaterial())); // twice the real size, centred
    registerReactorItemModels({'reactor-fuseCartridge': {scene} as never});
    registerItemModels({}); // drops cached templates
    const t = itemTemplate('fuse_cartridge');
    const b = bounds(t);
    expect(b.max.x - b.min.x).toBeCloseTo(0.3, 3);
    expect(b.min.y).toBeCloseTo(0, 4);
    expect(reactorItemSource('fuse_cartridge')).toContain(REACTOR_KIT.fuseCartridge.url);
    registerReactorItemModels({fuse_cartridge: null});
    registerItemModels({});
    expect(reactorItemSource('fuse_cartridge')).toMatch(/procedural stand-in/);
  });
});

function memStorage(): MilestoneStorage & {data: Map<string, string>; writes: number} {
  const data = new Map<string, string>();
  const s = {data, writes: 0, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { s.writes++; data.set(k, v); }};
  return s;
}

describe('milestones (persistent local record)', () => {
  it('records "reactor restarted" once, in the documented shape, and shows a title badge', () => {
    const st = memStorage();
    expect(readMilestones(st)).toEqual({});
    expect(milestoneBadge(readMilestones(st))).toBe('');
    expect(recordReactorRestarted(0x7ea, new Date('2026-11-01T22:00:00Z'), st)).toBe(true);
    expect(JSON.parse(st.data.get(MILESTONES_KEY)!)).toEqual({reactorRestarted: {at: '2026-11-01T22:00:00.000Z', levelSeed: 0x7ea}});
    expect(recordReactorRestarted(5, new Date('2026-12-01T00:00:00Z'), st)).toBe(false); // first one kept
    expect(st.writes).toBe(1);
    expect(milestoneBadge(readMilestones(st))).toMatch(/^★ Reactor restarted — run complete · \d+ (Oct|Nov) 2026$/);
  });

  it('is safe when storage is unavailable, throws, or holds garbage', () => {
    expect(readMilestones(null)).toEqual({});
    expect(recordReactorRestarted(1, new Date(), null)).toBe(false);
    const throwing: MilestoneStorage = {getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); }};
    expect(readMilestones(throwing)).toEqual({});
    expect(recordReactorRestarted(1, new Date(), throwing)).toBe(false);
    const junk = memStorage();
    junk.data.set(MILESTONES_KEY, '{not json');
    expect(readMilestones(junk)).toEqual({});
    junk.data.set(MILESTONES_KEY, JSON.stringify({reactorRestarted: {at: 'yesterday-ish'}}));
    expect(readMilestones(junk)).toEqual({});
    expect(recordReactorRestarted(9, new Date('2026-11-02T00:00:00Z'), junk)).toBe(true);
  });
});
