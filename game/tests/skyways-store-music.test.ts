// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): NORTHERN GROOVE RECORDS at layout version 3
// (gen/skyways/stores/music.ts + musicDress.ts / musicStock.ts / musicShapes.ts / kinds/music.ts; world/skywaysStoreMusic.ts):
//  - the user's requirement "the record store needs actual records in the holders": EVERY bay of EVERY record-bin rack in the store
//    holds a block of filed sleeves (none empty), each block hosted on its rack, standing on the rack's measured tray floor inside its
//    bay (no floating, no overlap); the new-arrivals ledges carry their faced-out rows; the sleeves never interpenetrate;
//  - both audits classify every new kind; storage is existing openables; the physics classes match the live physics;
//  - a believable store on real seeds of both formats: the cash desk (openable back counter), the stage corner and guitar wall, the
//    booths' / listening bar's console + turntable + headphones + stool, posters / signs, stocked back rooms;
//  - placement fit (in the store's areas, standing props never overlapping, lanes to every door), on-theme holder loot, the finish,
//    determinism, the renderer and the Codex atlases.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as THREE from 'three';
import {findStores, genSkyways, storeAreas, storeProps} from './helpers/skywaysStores';
import {layoutHolderDetails} from './helpers/lootEconomy';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {FLOOR} from '../src/gen/grid';
import {propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {dynamicKind} from '../src/physics/dynamicItems';
import {lootProfile} from '../src/items/lootTables';
import {isLootHolderKind} from '../src/items/loot';
import {purposeById, purposeLoot} from '../src/gen/purposes';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {SKYWAYS_STORES} from '../src/gen/skyways/stores/index';
import {STORE_MUSIC} from '../src/gen/skyways/stores/music';
import {STORE_MUSIC_KINDS, STORE_MUSIC_MALL_MODELS, STORE_MUSIC_SPECS} from '../src/gen/skyways/stores/kinds/music';
import {MUSIC_HOLDER_PURPOSE, skywaysMusicDressOf, type MusicDressResult} from '../src/gen/skyways/stores/musicDress';
import {BIN_BAYS, BIN_PLAY, BIN_ROWS, BIN_SLEEVE, BIN_STYLES, COVER_WALL, FACED_STYLES, binBayX, binBlock, binBlockFrame, binFloorY, facedRow} from '../src/gen/skyways/stores/musicStock';
import {MUSIC_ART} from '../src/gen/skyways/stores/musicArt';
import {ANCHOR_STYLES, anchorStyleOf} from '../src/gen/skyways/destinations/anchorStyles';
import {buildStoreMusicProp, binBlockGeometry, preloadStoreMusicArt, setStoreMusicArtMaterial, storeMusicArtMaterial} from '../src/world/skywaysStoreMusic';
import {SKYWAYS_STORE_MALL_MODELS} from '../src/gen/skyways/stores/kinds/index';
import {WorldMaterials} from '../src/world/materials';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SkywaysAnchor} from '../src/gen/skyways/skywaysTypes';

const ROOT = path.resolve(__dirname, '../..');
const MULTI = findStores('music', {format: 'multi-zone', count: 3, maxSeed: 40});
const HALL = findStores('music', {format: 'hall', count: 2, maxSeed: 60});
const HITS = [...MULTI, ...HALL];
const resOf = (l: StationLayout, an: SkywaysAnchor): MusicDressResult => skywaysMusicDressOf(l).find(r => r.anchor === an.id)!;
/** A world point in a prop's own frame (x right, z front). */
const toLocal = (host: PropPlacement, x: number, z: number): [number, number] => {
  const dx = x - host.x, dz = z - host.z, c = Math.cos(host.rot), s = Math.sin(host.rot);
  return [dx * c - dz * s, dx * s + dz * c];
};
const STORAGE_OK = new Set(['openable', 'existing', 'open']);
/** Same yaw (mod 2 pi). */
const sameYaw = (a: number, b: number): boolean => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-3;
const auditCls = new Map(OPENABLE_AUDIT.map(e => [e.kind, e.cls]));

describe('Northern Groove Records: kinds, audits, stock geometry (pure)', () => {
  it('every new kind is classified in both audits; the live physics matches its row; nothing new is storage', () => {
    for (const k of STORE_MUSIC_KINDS) {
      const spec = STORE_MUSIC_SPECS[k], a = OPENABLE_AUDIT.find(e => e.kind === k), ph = PROP_PHYSICS_AUDIT[k];
      expect(a, k).toBeTruthy();
      expect(['none', 'exception']).toContain(a!.cls);
      expect(spec.open.role).not.toBe('storage');
      expect(ph, k).toBeTruthy();
      expect(ph.cls).toBe(spec.phys.dynamic ? 'dynamic' : 'static');
      expect(dynamicKind(k), k).toBe(spec.phys.dynamic);
      if (spec.phys.dynamic) { expect(propPhysics(k).mass).toBe(spec.phys.mass); expect(propPhysics(k).onHost ?? false).toBe(!!spec.phys.onHost); }
      expect(spec.phys.how.length).toBeGreaterThan(20);
      expect(PROP_DEFS[k].w * PROP_DEFS[k].d * PROP_DEFS[k].h).toBeGreaterThan(0);
    }
    // the stock / booth equipment is light on-host decor; the stool a light floor prop; the boards / cards / posters mounted
    for (const k of ['skyMuBinRecords', 'skyMuFacedRecords', 'skyMuTurntable', 'skyMuHeadphones'] as const) expect(STORE_MUSIC_SPECS[k].phys).toMatchObject({dynamic: true, onHost: true});
    expect(STORE_MUSIC_SPECS.skyMuStool.phys).toMatchObject({dynamic: true});
    for (const k of ['skyMuCoverWall', 'skyMuBinLabel', 'skyMuGigPoster', 'skyMuSign'] as const) expect(STORE_MUSIC_SPECS[k].phys).toMatchObject({dynamic: false, why: 'mounted'});
    // the Mall model it uses is registered for Skyways (recorded)
    expect(STORE_MUSIC_MALL_MODELS).toEqual(['mall-mall-cashwrap-counter.glb']);
    expect(SKYWAYS_STORE_MALL_MODELS).toContain('mall-mall-cashwrap-counter.glb');
    expect(fs.existsSync(path.join(ROOT, 'game/public/assets/models/mall-mall-cashwrap-counter.glb'))).toBe(true);
  });

  it('every bin block style: ten-inch sleeves inside the narrowest bay, bottoms on the measured tray floor, the rearmost on its support, never interpenetrating', () => {
    const {s, t} = BIN_SLEEVE;
    const narrow = Math.min(...BIN_BAYS.map(([a, b]) => b - a));
    expect(s + 2 * BIN_PLAY).toBeLessThan(narrow);
    const fronts = new Set<number>();
    for (let v = 0; v < 2 * BIN_STYLES; v++) {
      const b = binBlock(v), row = BIN_ROWS[b.row];
      expect(b.row).toBe(v < BIN_STYLES ? 0 : 1);
      expect(b.sleeves.length, `style ${v}`).toBeGreaterThanOrEqual(6);
      fronts.add(b.sleeves.at(-1)!.cover);
      b.sleeves.forEach((q, k) => {
        expect(Math.abs(q.dx)).toBeLessThanOrEqual(BIN_PLAY + 1e-9);
        // supported: the bottom edge ON the tray floor, inside the row's floor span
        expect(Math.abs(q.y - binFloorY(row, q.z))).toBeLessThan(0.001);
        expect(q.z).toBeGreaterThan(row.support.z);
        expect(q.z).toBeLessThanOrEqual(row.zFront + 1e-9);
        // leaning back, never past a third of vertical
        expect(q.lean).toBeGreaterThan(0.1);
        expect(q.lean).toBeLessThan(0.45);
        if (k > 0) {
          // the next sleeve stands in front of the previous one's slab (bottom) and no more reclined (their planes part going up)
          const p = b.sleeves[k - 1];
          const dist = Math.cos(p.lean) * (q.z - p.z) + Math.sin(p.lean) * (q.y - p.y);
          expect(dist).toBeGreaterThanOrEqual(t - 1e-6);
          expect(q.lean).toBeLessThanOrEqual(p.lean + 1e-9);
        }
      });
      // the rearmost leans on its support: its back face within 1.5 mm of the support's corner / face (not floating off it)
      const r0 = b.sleeves[0], sp = row.support;
      const top = r0.y + s * Math.cos(r0.lean);
      const gap = top >= sp.top ? -(Math.cos(r0.lean) * (sp.z - r0.z) + Math.sin(r0.lean) * (sp.top - r0.y)) - t / 2 : (r0.z - s * Math.sin(r0.lean)) - sp.z - t / 2;
      expect(gap, `style ${v} rest gap`).toBeGreaterThanOrEqual(-1e-6);
      expect(gap, `style ${v} rest gap`).toBeLessThan(0.0015);
      // the box: inside the rack (front lip / back wall), above the floor everywhere
      expect(b.z0).toBeGreaterThan(-0.36);
      expect(b.z1).toBeLessThan(0.39);
      expect(b.y0).toBeGreaterThan(0.45);
    }
    // a customer sees a different front cover in every style
    expect(fronts.size).toBe(2 * BIN_STYLES);
    // the faced rows: five distinct covers each, inside the board
    for (let v = 0; v < FACED_STYLES; v++) {
      const row = facedRow(v);
      expect(new Set(row.map(q => q.cover)).size).toBe(row.length);
      for (const q of row) expect(Math.abs(q.x) + 0.315 / 2).toBeLessThan(COVER_WALL.w / 2);
    }
  });
});

describe('Northern Groove Records on real seeds (both formats)', () => {
  it('found the formats', () => {
    expect(MULTI.length).toBeGreaterThanOrEqual(2);
    expect(HALL.length).toBeGreaterThanOrEqual(1);
  });

  it('EVERY record holder is stocked: each rack has a block in every bay of both rows, hosted, on its measured tray floor, inside the bay, no overlaps', () => {
    for (const {seed, layout: l, anchor: an} of HITS) {
      const res = resOf(l, an), mine = new Set(storeAreas(l, an).all);
      const racks = l.props.map((p, i) => ({p, i})).filter(({p}) => p.kind === 'skyDRecordBins' && mine.has(p.area));
      expect(racks.length, `seed ${seed}`).toBeGreaterThanOrEqual(8);
      expect(new Set(res.racks)).toEqual(new Set(racks.map(r => r.i)));
      for (const {p: rack, i} of racks) {
        const blocks = l.props.filter(q => q.kind === 'skyMuBinRecords' && q.host === i);
        expect(blocks.length, `seed ${seed} rack ${i}: none empty`).toBe(12);
        const bays = new Set<string>();
        for (const b of blocks) {
          const blk = binBlock(b.variant), [lx, lz] = toLocal(rack, b.x, b.z);
          const col = BIN_BAYS.findIndex(([x0, x1]) => lx > x0 && lx < x1);
          expect(col, `seed ${seed}: block inside a bay`).toBeGreaterThanOrEqual(0);
          const f = binBlockFrame(b.variant, col);
          bays.add(`${blk.row}:${col}`);
          // on its support: the frame's base height on the rack, at the bay's centre and the block's depth
          expect(Math.abs(lx - binBayX(col))).toBeLessThan(0.002);
          expect(Math.abs(lz - f.z)).toBeLessThan(0.002);
          expect(Math.abs(b.y - (rack.y + f.y))).toBeLessThan(0.002);
          expect(sameYaw(b.rot, rack.rot)).toBe(true);
          // inside the rack's box (plan and height)
          expect(Math.abs(b.x - rack.x) + b.hx).toBeLessThanOrEqual(rack.hx + 0.002);
          expect(Math.abs(b.z - rack.z) + b.hz).toBeLessThanOrEqual(rack.hz + 0.002);
          expect(b.y + b.h).toBeLessThan(rack.y + PROP_DEFS.skyDRecordBins.h + 0.08);
          expect(b.y).toBeGreaterThan(rack.y + 0.4);
        }
        expect(bays.size, `seed ${seed} rack ${i}: twelve distinct bays`).toBe(12);
        // the genre card on its apron
        expect(l.props.filter(q => q.kind === 'skyMuBinLabel' && q.host === i).length).toBe(1);
      }
    }
  }, 120_000);

  it('the new-arrivals wall: wall-mounted on solid wall, three faced rows on its ledges (hosted, inside the board, distinct styles)', () => {
    for (const {seed, layout: l, anchor: an} of HITS) {
      const res = resOf(l, an);
      expect(res.coverWalls.length, `seed ${seed}`).toBe(1);
      const wi = res.coverWalls[0], w = l.props[wi];
      expect(w.mounted).toBe(true);
      const rows = l.props.filter(q => q.kind === 'skyMuFacedRecords' && q.host === wi);
      expect(rows.length).toBe(3);
      expect(new Set(rows.map(r => r.variant)).size).toBe(3);
      const ys = rows.map(r => Math.round((r.y - w.y) * 1000) / 1000).sort((a, b) => a - b);
      expect(ys).toEqual([...COVER_WALL.ledges].map(v => Math.round(v * 1000) / 1000));
      for (const r of rows) { const [lx] = toLocal(w, r.x, r.z); expect(Math.abs(lx)).toBeLessThan(0.01); expect(sameYaw(r.rot, w.rot)).toBe(true); }
    }
  }, 120_000);

  it('a whole store: cash desk with openable storage + till, stage corner, guitar wall, booths / listening bar, posters, back rooms stocked', () => {
    for (const {seed, layout: l, anchor: an} of HITS) {
      const res = resOf(l, an), props = storeProps(l, an), kinds = (k: string) => props.filter(p => p.kind === k).length;
      // the cash desk: counters with the till, an OPENABLE back counter / sideboard
      expect(res.cashDesk.counters.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(res.cashDesk.back).not.toBeNull();
      const back = l.props[res.cashDesk.back!];
      expect(['mallCashwrapCounter', 'cabinetLow']).toContain(back.kind);
      expect(STORAGE_OK.has(auditCls.get(back.kind)!)).toBe(true);
      expect(kinds('cashRegister')).toBeGreaterThanOrEqual(1);
      // the stage corner and the guitar wall
      for (const k of ['skyDPiano', 'skyDAmpStack', 'skyDDrumKit']) expect(kinds(k), `seed ${seed} ${k}`).toBe(1);
      expect(kinds('skyDGuitar')).toBeGreaterThanOrEqual(4);
      const roadCase = props.find(p => p.kind === 'footlocker');
      if (roadCase) expect(roadCase.purpose).toBe(MUSIC_HOLDER_PURPOSE.roadCase);
      // listening: a booth station in every zone (multi-zone) / the listening bar (hall); console + turntable + headphones + stool(s)
      const stations = res.booths.filter(b => b.console >= 0);
      if (an.zones.length) expect(stations.length, `seed ${seed} booths`).toBe(an.zones.length);
      else expect(stations.length).toBeGreaterThanOrEqual(1);
      for (const b of stations) {
        const c = l.props[b.console];
        expect(c.kind).toBe('cabinetLow');
        if (b.zone !== null) expect(c.area).toBe(b.zone); else expect(c.purpose).toBe(MUSIC_HOLDER_PURPOSE.listening);
        for (const ti of [b.turntable, b.headphones]) {
          expect(ti).not.toBeNull();
          const q = l.props[ti!];
          expect(q.host).toBe(b.console);
          expect(q.y).toBeCloseTo(c.y + PROP_DEFS.cabinetLow.h, 3);
          const [lx, lz] = toLocal(c, q.x, q.z);
          expect(Math.abs(lx) + q.hx).toBeLessThanOrEqual(PROP_DEFS.cabinetLow.w / 2 + 0.06);
          expect(Math.abs(lz)).toBeLessThan(PROP_DEFS.cabinetLow.d / 2);
        }
        expect(b.stools.length).toBeGreaterThanOrEqual(1);
        for (const si of b.stools) expect(l.props[si].kind).toBe('skyMuStool');
      }
      if (an.zones.length) expect(kinds('skyMuSign')).toBe(1);
      expect(kinds('skyMuGigPoster')).toBeGreaterThanOrEqual(2);
      // back rooms: each gets openable storage (lockers / cabinet / crate) beside the shelving
      const {stock} = storeAreas(l, an);
      expect(stock.length).toBeGreaterThanOrEqual(1);
      let storage = 0;
      for (const s of stock) {
        const here = l.props.filter(p => p.area === s);
        expect(here.some(p => ['shelf', 'stockShelf'].includes(p.kind)), `seed ${seed} back room ${s} shelving`).toBe(true);
        storage += here.filter(p => auditCls.get(p.kind) === 'openable' || auditCls.get(p.kind) === 'existing').length;
      }
      expect(storage, `seed ${seed} openable back-room storage`).toBeGreaterThanOrEqual(2);
    }
  }, 120_000);

  it('fit: every prop in the store\'s areas, standing props never overlap, nothing in a door strip, lanes to every door; the level validates', () => {
    for (const {seed, layout: l, anchor: an} of HITS) {
      const res = resOf(l, an), mine = new Set(storeAreas(l, an).all);
      for (const i of res.props) expect(mine.has(l.props[i].area), `seed ${seed} prop ${l.props[i].kind}`).toBe(true);
      // standing (unhosted, unmounted) props of this dresser: pairwise disjoint boxes (1 cm tolerance), on walkable cells
      const standing = res.props.map(i => l.props[i]).filter(p => p.host === undefined && !p.mounted && p.kind !== 'shopGlazing');
      for (let a = 0; a < standing.length; a++) for (let b = a + 1; b < standing.length; b++) {
        const p = standing[a], q = standing[b];
        if ((p.level ?? 0) !== (q.level ?? 0)) continue;
        const ov = Math.abs(p.x - q.x) < p.hx + q.hx - 0.011 && Math.abs(p.z - q.z) < p.hz + q.hz - 0.011;
        expect(ov, `seed ${seed}: ${p.kind} overlaps ${q.kind}`).toBe(false);
      }
      const g = l.levels[an.level].grid;
      for (const p of standing) { const [cx, cy] = g.cellOf(p.x, p.z); expect(g.cells[g.idx(cx, cy)]).toBe(FLOOR); }
      // lanes: every door of the sales floor / zones reached (no lane skipped)
      expect(res.skipped.filter(s => s.startsWith('lane to'))).toEqual([]);
      expect(res.lanes.some(x => x.to === 'aisle')).toBe(true);
      if (an.zones.length) expect(res.lanes.filter(x => x.to === 'zone').length).toBeGreaterThanOrEqual(an.zones.length);
      expect(skywaysIssues(l), `seed ${seed}`).toEqual([]);
    }
  }, 120_000);

  it('physics: the stock rests within its static hosts (never goes loose from a bay / ledge); booth equipment on the console top goes loose; stools are floor props', () => {
    const {layout: l, anchor: an} = HITS[0];
    const props = storeProps(l, an);
    for (const p of props.filter(q => q.kind === 'skyMuBinRecords' || q.kind === 'skyMuFacedRecords')) {
      const h = l.props[p.host!];
      expect(dynamicKind(h.kind)).toBe(false);
      // on-host decor goes loose only from its host's TOP (DynamicItems.restsOnStaticHost): a bay / ledge is below it
      expect(Math.abs(p.y - (h.y + h.h))).toBeGreaterThan(0.05);
    }
    for (const p of props.filter(q => q.kind === 'skyMuTurntable' || q.kind === 'skyMuHeadphones')) {
      const h = l.props[p.host!];
      expect(dynamicKind(h.kind)).toBe(false);
      expect(Math.abs(p.y - (h.y + h.h))).toBeLessThan(0.03);
    }
    for (const p of props.filter(q => q.kind === 'skyMuStool')) { expect(p.host).toBeUndefined(); expect(p.y).toBeCloseTo(l.areas[p.area].floorY ?? l.levels[p.level ?? 0].baseY ?? 0, 2); }
  }, 120_000);

  it('loot: the store\'s purposes and per-holder overrides are existing ones; every holder rolls on-theme rows (no ammo on the floor / in the booths)', () => {
    expect(STORE_MUSIC.purposes).toEqual({floor: 'mall-music', zones: 'office-listening', stock: 'mall-music-back', office: 'mall-music-back'});
    for (const id of [...Object.values(STORE_MUSIC.purposes), ...Object.values(MUSIC_HOLDER_PURPOSE)]) expect(purposeById(id), id).toBeTruthy();
    const FRONT_OK = new Set(['battery', 'flare', 'water', 'cola', 'juice', 'chocolate', 'chips', 'beans', 'bandage', 'noodles']);
    let holders = 0, lots = 0;
    for (const {seed, layout: l, anchor: an} of HITS) {
      const A = storeAreas(l, an), front = new Set([...A.floor, ...A.zones]);
      for (const h of layoutHolderDetails(l, lootProfile('skyways'))) {
        if (!A.all.has(h.prop.area)) continue;
        holders++;
        lots += h.lots.length;
        const spec = purposeLoot(h.areaType, h.kind);
        expect(spec, `seed ${seed} ${h.kind} @ ${h.areaType}`).toBeTruthy();
        if (front.has(h.prop.area)) for (const lot of h.lots) expect(FRONT_OK.has(lot.itemId), `seed ${seed} ${h.kind} @ ${h.areaType}: ${lot.itemId}`).toBe(true);
      }
      // the floor's holders roll the music store's rows; the booths the listening lounge's
      const floorHolder = l.props.find(p => p.area === an.floor && isLootHolderKind(p.kind) && !p.purpose);
      if (floorHolder) expect(l.areas[floorHolder.area].purpose).toBe('mall-music');
      for (const z of an.zones) expect(l.areas[z].purpose).toBe('office-listening');
      for (const s of an.stock) expect(l.areas[s].purpose).toBe('mall-music-back');
    }
    expect(holders).toBeGreaterThan(20);
    expect(lots).toBeGreaterThan(0);
    // no store pickups on the floor (noFloorLoot): the records are physical stock, not items
    for (const {layout: l, anchor: an} of HITS) {
      const A = storeAreas(l, an);
      expect(l.pickups.filter(p => A.all.has(p.area) && p.itemId.includes('record'))).toEqual([]);
    }
  }, 120_000);

  it('finish: the store\'s own palette (dark plum over a stained wainscot, dark boards; walnut-panelled carpeted booths) feeds the anchor styles, distinct from every other store', () => {
    expect(ANCHOR_STYLES.music).toEqual(anchorStyleOf(STORE_MUSIC.finish!));
    expect(ANCHOR_STYLES.music.floor).toEqual({kind: 'wood', tint: 0x4e3426});
    expect(ANCHOR_STYLES.music.zones?.floor).toEqual({kind: 'carpet', tint: 0x1d4448});
    expect(ANCHOR_STYLES.music.zones?.wall?.lowerTop).toBeGreaterThanOrEqual(3.5);
    for (const [f, st] of Object.entries(ANCHOR_STYLES)) if (f !== 'music') expect(JSON.stringify([st.wall.paint, st.floor]), f).not.toBe(JSON.stringify([ANCHOR_STYLES.music.wall.paint, ANCHOR_STYLES.music.floor]));
    expect(SKYWAYS_STORES.music).toBe(STORE_MUSIC);
  });

  it('determinism: the same seed dresses the store identically', () => {
    const {seed, anchor: an} = HITS[0];
    const fp = (l: StationLayout) => JSON.stringify(storeProps(l, l.skyways!.anchors!.find(a => a.id === an.id)!).map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.host ?? -1, p.purpose ?? '']));
    const again = LEVELS_GEN(seed);
    expect(fp(again)).toBe(fp(genSkyways(seed)));
  }, 120_000);
});

describe('Northern Groove Records: renderer and art', () => {
  it('draws every kind instanced (prop-<kind>-… names); a bin style\'s geometry is its sleeves; the atlas material when loaded, a plain stand-in otherwise', () => {
    const {layout: l, anchor: an} = HITS[0];
    const props = storeProps(l, an);
    const restore = installCanvasShim(false);
    const wm = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    for (const k of STORE_MUSIC_KINDS) {
      const list = props.filter(p => p.kind === k);
      if (!list.length) continue;
      const g = new THREE.Group();
      expect(buildStoreMusicProp(g, k, list, wm)).toBe(list.length);
      const ims = g.children.filter(o => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
      expect(ims.length, k).toBeGreaterThan(0);
      for (const im of ims) expect(im.name.startsWith(`prop-${k}-`)).toBe(true);
      expect(ims.reduce((s, im) => s + im.count, 0)).toBeGreaterThanOrEqual(list.length);
    }
    for (let v = 0; v < 2 * BIN_STYLES; v++) {
      const geo = binBlockGeometry(v), n = binBlock(v).sleeves.length;
      // four faces per sleeve (front, top, two sides) + the rearmost's back: 2 triangles each
      expect(geo.index!.count / 3).toBe((4 * n + 1) * 2);
      geo.computeBoundingBox();
      const b = binBlock(v);
      expect(geo.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-3);
      expect(geo.boundingBox!.max.y).toBeLessThanOrEqual(b.y1 - b.y0 + 1e-3);
    }
    expect(storeMusicArtMaterial('covers').name).toBe('store-music-covers-plain');
    const m = new THREE.MeshBasicMaterial();
    setStoreMusicArtMaterial('covers', m);
    expect(storeMusicArtMaterial('covers')).toBe(m);
    setStoreMusicArtMaterial('covers', null);
    restore();
  });

  it('the preload asks for exactly the store\'s two atlases (level-only skyways textures) and never rejects', async () => {
    const {layout: l} = HITS[0];
    const asked: string[] = [];
    const host = {levelResources: {load: async (_lv: string, url: string) => { asked.push(url); return url.includes('covers') ? new THREE.Texture() : null; }, own: <T,>(_lv: string, r: T) => r}};
    const r = await preloadStoreMusicArt(host, l);
    expect(asked.sort()).toEqual([MUSIC_ART.covers.url, MUSIC_ART.signs.url].sort());
    expect(r).toEqual({loaded: 1, missing: 1});
    expect(storeMusicArtMaterial('covers').name).toBe('store-music-covers');
    expect(storeMusicArtMaterial('signs').name).toBe('store-music-signs-plain');
    setStoreMusicArtMaterial('covers', null);
  });

  it('the Codex atlases: cooked files match the table, provenance records the six raw sources (crop / pack only)', () => {
    const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    for (const a of [MUSIC_ART.covers, MUSIC_ART.signs]) {
      expect(a.url.startsWith('assets/textures/skyways/stores/music/')).toBe(true);
      expect(sha(path.join(ROOT, 'game/public', a.url))).toBe(a.sha256);
    }
    const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/skyways-store-music-art-20261107.json'), 'utf8'));
    expect(prov.generator).toMatch(/Codex native image_gen/);
    expect(prov.status).toMatch(/unapproved prototype/);
    expect(Object.keys(prov.sources).sort()).toEqual(['covers-1', 'covers-2', 'covers-3', 'covers-4', 'posters', 'signs']);
    for (const s of Object.values(prov.sources) as {sha256: string; codex: {session: string}}[]) { expect(s.sha256).toMatch(/^[0-9a-f]{64}$/); expect(s.codex.session).toBeTruthy(); }
    expect(prov.files.map((f: {sha256: string}) => f.sha256)).toEqual([MUSIC_ART.covers.sha256, MUSIC_ART.signs.sha256]);
    for (const p of ['new-arrivals', 'listening-booths', 'poster-0', 'poster-3', 'genre-rock', 'genre-electronic']) expect(MUSIC_ART.signs.pieces[p], p).toBeTruthy();
    // the reviewed public inputs allowlist the cooked files at their exact size / hash
    const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const rel of [MUSIC_ART.covers.url, MUSIC_ART.signs.url, 'assets/derivatives/skyways-store-music-art-20261107.json']) {
      const f = path.join(ROOT, 'game/public', rel), e = allow.files.find(q => q.path === rel);
      expect(e, rel).toBeTruthy();
      expect(e!.bytes).toBe(fs.statSync(f).size);
      expect(e!.sha256).toBe(sha(f));
    }
  });
});

/** A fresh generation (bypassing the helper's cache). */
function LEVELS_GEN(seed: number): StationLayout {
  return LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
}
