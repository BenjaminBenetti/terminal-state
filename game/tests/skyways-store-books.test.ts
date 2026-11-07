// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-BOOKS): PAPER PRAIRIE BOOKS at layout version 3 (gen/skyways/stores/
// books.ts, booksDress.ts; kinds/books.ts; world/skywaysStoreBooks.ts) over several seeds of both formats (two-level, hall):
//  - its storage opens (OPENABLE_AUDIT: openable / existing), its new kinds are classified (both audits, damage), scale-recorded;
//  - its holders roll on-theme loot (the store's purposes and the per-holder overrides: no ammo anywhere in the store's holders);
//  - fit: inside the store, no standing boxes overlapping, every sales piece reachable from the entry / the stair, lanes to every door;
//  - the store's program: the cash desk with an openable drawer cabinet, category bays with signs (fiction / local history / maps &
//    travel / children's / rare books), the reading nook (two wingbacks, a rug, a lamp), the children's corner and the rare-books
//    cabinets (the mezzanine / lower floor of a two-level store), stocked back rooms;
//  - books are LOOSE stock (rule 4): every book stack stands on a measured support of a real host (shelf / tier / top), none baked;
//  - the palette (full-height wood panelling, wood floor; the other storey carpet) is the store's own and no other family's;
//  - the renderer draws the signs / rugs as prop-<kind> instances with the atlas pieces' aspect, and the atlas is on file.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import {findStores, storeAreas, storeProps, storePickups, type StoreHit} from './helpers/skywaysStores';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {BOOKS_HOLDER_PURPOSE, BOOKS_STACK_BUDGET, booksStoreDressOf, packStart, type BooksStoreResult} from '../src/gen/skyways/stores/booksDress';
import {STORE_BOOKS} from '../src/gen/skyways/stores/books';
import {BOOKS_RUG_PIECES, BOOKS_SIGN, BOOKS_SIGN_BOARD, BOOKS_SIGN_PIECES, STORE_BOOKS_KINDS, STORE_BOOKS_MALL_MODELS, STORE_BOOKS_SPECS} from '../src/gen/skyways/stores/kinds/books';
import {BOOKS_ART} from '../src/gen/skyways/stores/booksArt.generated';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {CELL, FLOOR} from '../src/gen/grid';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {PROP_DAMAGE} from '../src/damage/materials';
import {purposeById} from '../src/gen/purposes';
import {compartmentTable, holderTable, isLootHolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {ANCHOR_STYLES} from '../src/gen/skyways/destinations/anchorStyles';
import {SKYWAYS_SHOP_FAMILIES} from '../src/gen/skyways/skywaysTypes';
import {bookTableTiers, bookcaseShelves} from '../src/gen/skyways/destinations/kindsShopsA';
import {levelOfAsset} from '../src/assets/levelAssets';
import {WorldMaterials} from '../src/world/materials';
import {buildStoreBooksProp, isStoreBooksDrawnKind, storeBooksPiece} from '../src/world/skywaysStoreBooks';
import type {StationLayout} from '../src/gen/stationTypes';
import {LEVELS} from '../src/levels/registry';

const PUB = path.resolve(__dirname, '../public');
const TWO = findStores('books', {format: 'two-level', count: 3});
const HALL = findStores('books', {format: 'hall', count: 3});
const ALL: StoreHit[] = [...TWO, ...HALL];
const resOf = (h: StoreHit): BooksStoreResult => booksStoreDressOf(h.layout).find(r => r.anchor === h.anchor.id)!;
const placed = (h: StoreHit): PropPlacement[] => resOf(h).props.map(i => h.layout.props[i]);
const audit = (k: string) => OPENABLE_AUDIT.find(r => r.kind === k);
/** The loot key a holder rolls with (containers.ts: the prop override, else its area's purpose). */
const keyOf = (L: StationLayout, p: PropPlacement) => p.purpose ?? L.areas[p.area]?.purpose ?? L.areas[p.area]?.type ?? 'default';

describe('Paper Prairie Books: kinds, assets, palette', () => {
  it('found stores of both formats', () => {
    expect(TWO.length).toBeGreaterThanOrEqual(2);
    expect(HALL.length).toBeGreaterThanOrEqual(2);
  });

  it('its two new kinds are classified in both audits, never break, and render from the Codex atlas (no model)', () => {
    expect([...STORE_BOOKS_KINDS]).toEqual(['skyBooksSign', 'skyBooksRug']);
    for (const k of STORE_BOOKS_KINDS) {
      expect(/^[A-Za-z]+$/.test(k)).toBe(true);
      const d = PROP_DEFS[k as PropKind];
      expect(d.w * d.d * d.h).toBeGreaterThan(0);
      expect(audit(k)?.cls, k).toBe('none');
      expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({src: 'skyways', cls: 'static'});
      expect(PROP_DAMAGE[k as PropKind], k).toMatchObject({breaks: 'never'});
      expect(STORE_BOOKS_SPECS[k].model).toBeUndefined();
      expect(isStoreBooksDrawnKind(k)).toBe(true);
    }
    expect(PROP_PHYSICS_AUDIT.skyBooksSign.why).toBe('mounted');
    expect(PROP_PHYSICS_AUDIT.skyBooksRug.why).toBe('flat');
    // real sizes (rule 5; docs/skyways-stores/books.md): a 1.05 x 0.29 m header on a 2.4 m case; a 2.4 x 1.6 m rug, 1.2 cm pile
    expect(PROP_DEFS.skyBooksSign).toMatchObject({w: 1.05, h: 0.29});
    expect(PROP_DEFS.skyBooksRug).toMatchObject({w: 2.4, d: 1.6, h: 0.012});
    // the atlas: every sign / rug piece mapped, aspect kept (the sign face 1.01 m wide fits the board; the rug 1.5 : 1)
    expect(fs.existsSync(path.join(PUB, BOOKS_ART.url))).toBe(true);
    expect(levelOfAsset(BOOKS_ART.url)).toBe('skyways');
    for (const k of [...BOOKS_SIGN_PIECES, ...BOOKS_RUG_PIECES]) expect(BOOKS_ART.pieces[k], k).toBeTruthy();
    for (const k of BOOKS_SIGN_PIECES) expect(BOOKS_SIGN_BOARD.face.w / BOOKS_ART.pieces[k].aspect).toBeLessThan(BOOKS_SIGN_BOARD.h);
    for (const k of BOOKS_RUG_PIECES) expect(Math.abs(BOOKS_ART.pieces[k].aspect - 1.5)).toBeLessThan(0.02);
    const prov = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/skyways-store-art-20261107.json'), 'utf8')).stores.books; // (the combined store-art record)
    expect(prov.generator).toMatch(/Codex native image_gen/);
    expect(prov.status).toMatch(/unapproved prototype/);
    expect(prov.sources).toHaveLength(2);
  });

  it('the Mall models it places are listed (a record) and on file', () => {
    for (const f of STORE_BOOKS_MALL_MODELS) expect(fs.existsSync(path.join(PUB, 'assets/models', f)), f).toBe(true);
    const mallKinds = new Set(ALL.flatMap(h => placed(h).map(p => p.kind)).filter(k => ['bookstoreBookcase', 'mallCashwrapCounter', 'glassDisplayCabinet', 'dresserDrawers', 'cardboardBoxFlaps'].includes(k)));
    expect(mallKinds.size).toBeGreaterThanOrEqual(4);
  });

  it('palette: full-height wood panelling, a wood floor, a plain ceiling; the other storey a wainscot on carpet — no other family\'s', () => {
    const st = ANCHOR_STYLES.books;
    expect(st.wall.kind).toBe('wood');
    expect(st.wall.lowerTop).toBeGreaterThanOrEqual(3.5);
    expect(st.floor.kind).toBe('wood');
    expect(st.ceiling.kind).toBe('plain');
    expect(st.upper?.floor?.kind).toBe('carpet');
    expect(st.upper?.wall?.kind).toBe('wood');
    const sig = (f: typeof st) => JSON.stringify([f.wall.kind, f.wall.lower, f.wall.lowerTop, f.floor.kind, f.floor.tint]);
    for (const fam of SKYWAYS_SHOP_FAMILIES) if (fam !== 'books') expect(sig(ANCHOR_STYLES[fam]), fam).not.toBe(sig(st));
  });

  it('grid packing: neighbours never share a cell (placeKit.cellsOfBox trims 4 cm)', () => {
    for (const w of [PROP_DEFS.skyDBookcase.w, PROP_DEFS.bookstoreBookcase.w, 0.9]) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const e = s + w, n = packStart(e);
        expect(Math.floor((n + 0.04) / CELL)).toBeGreaterThan(Math.floor((e - 0.04) / CELL));
        expect(n - e).toBeGreaterThanOrEqual(0.002 - 1e-9);
        s = n;
      }
    }
  });
});

describe('Paper Prairie Books: the store at version 3 (several seeds, both formats)', () => {
  it('purposes: the Mall bookstore on its floors, its stock room, the management office; the overrides are existing purposes', () => {
    for (const id of [STORE_BOOKS.purposes.floor, STORE_BOOKS.purposes.upper!, STORE_BOOKS.purposes.stock!, STORE_BOOKS.purposes.office!, ...Object.values(BOOKS_HOLDER_PURPOSE)]) expect(purposeById(id), id).toBeTruthy();
    for (const h of ALL) {
      const A = storeAreas(h.layout, h.anchor);
      for (const id of [...A.floor, ...A.upper]) expect(h.layout.areas[id].purpose, `seed ${h.seed} area ${id}`).toBe('mall-books');
      for (const id of A.stock) expect(h.layout.areas[id].purpose).toBe(h.layout.areas[id].type === 'stock-room' ? 'mall-books-back' : 'mall-management');
    }
  });

  it('the program: cash desk + drawer cabinet, signed category bays, stacks, the reading nook, the children\'s corner, rare books', () => {
    for (const h of ALL) {
      const r = resOf(h), L = h.layout, P = (i: number | null) => (i === null ? null : L.props[i]), tag = `seed ${h.seed} (${h.anchor.format})`;
      // the cash desk: a counter with the till, and an OPENABLE drawer cabinet (the cash-wrap's drawers or a dresser)
      expect(r.cash.counters.length, tag).toBeGreaterThanOrEqual(1);
      expect(P(r.cash.till)?.kind, tag).toBe('cashRegister');
      const drawers = P(r.cash.wrap) ?? P(r.cash.drawers);
      expect(drawers && audit(drawers.kind)?.cls, tag).toBe('openable');
      // signs: the core sections everywhere (+ children's / rare books where their corners stand)
      const signs = new Set(r.signs.map(i => L.props[i].variant));
      for (const v of [BOOKS_SIGN.fiction, BOOKS_SIGN.localHistory, BOOKS_SIGN.mapsTravel]) expect(signs.has(v), `${tag}: sign ${BOOKS_SIGN_PIECES[v]}`).toBe(true);
      if (r.kids) expect(signs.has(BOOKS_SIGN.childrens), tag).toBe(true);
      if (r.rare) expect(signs.has(BOOKS_SIGN.rareBooks), tag).toBe(true);
      expect(r.bays.length, tag).toBeGreaterThanOrEqual(3);
      // (U-shaped bays need wall length: every two-level store has them; a small hall may line its walls without spurs)
      if (h.anchor.format === 'two-level') expect(r.bays.some(b => b.spurs.length === 2), `${tag}: a spur-closed bay`).toBe(true);
      expect(placed(h).filter(p => p.kind === 'skyDBookcase' || p.kind === 'bookstoreBookcase').length, tag).toBeGreaterThanOrEqual(12);
      // the reading nook: two wingbacks + a rug (+ a lamp when against a wall)
      expect(r.nooks.length, tag).toBeGreaterThanOrEqual(1);
      const nook = r.nooks.find(n => n.level === h.anchor.level) ?? r.nooks[0];
      expect(nook.chairs.length, tag).toBeGreaterThanOrEqual(2);
      for (const c of nook.chairs) expect(L.props[c].kind).toBe('skyDWingbackChair');
      expect(P(nook.rug)?.kind).toBe('skyBooksRug');
      expect(r.nooks.some(n => n.lamp !== null && L.props[n.lamp].kind === 'skyDArcLamp'), `${tag}: a lamp`).toBe(true);
      // the children's corner and the rare books: upstairs / downstairs on a two-level store, on the sales floor of a hall
      expect(r.kids, tag).toBeTruthy();
      expect(r.rare, tag).toBeTruthy();
      expect(r.rare!.cabinets.length).toBeGreaterThanOrEqual(2);
      for (const c of r.rare!.cabinets) expect(L.props[c].kind).toBe('glassDisplayCabinet');
      if (h.anchor.format === 'two-level') {
        expect(r.kids!.level, tag).not.toBe(h.anchor.level);
        expect(r.rare!.level, tag).not.toBe(h.anchor.level);
        expect(P(r.rare!.desk)?.kind, `${tag}: the staff desk`).toBe('desk');
      }
      expect(P(r.kids!.dresser)?.kind).toBe('dresserDrawers');
      expect(P(r.kids!.rug)?.variant).toBe(1);
      expect(r.kids!.seats.length).toBeGreaterThanOrEqual(1);
      expect(r.skipped.filter(s => /^lane to|^no sign|^cash desk$/.test(s)), tag).toEqual([]);
    }
  });

  it('openables: every storage piece it places opens (OPENABLE_AUDIT openable / existing); nothing sealed but the till', () => {
    let openables = 0;
    for (const h of ALL) {
      for (const p of placed(h)) {
        const a = audit(p.kind);
        expect(a, p.kind).toBeTruthy();
        if (a!.role === 'storage' || isLootHolderKind(p.kind) && a!.cls !== 'open') expect(['openable', 'existing'], `${p.kind}`).toContain(a!.cls);
        if (a!.cls === 'exception') expect(p.kind).toBe('cashRegister');
        if (a!.cls === 'openable') openables++;
      }
    }
    expect(openables / ALL.length).toBeGreaterThanOrEqual(5);
  });

  it('loot: every holder of the store rolls an existing purpose\'s rows — on theme, never ammo (the store, its back rooms, its overrides)', () => {
    const profile = lootProfile('skyways');
    for (const h of ALL) {
      const L = h.layout;
      for (const p of storeProps(L, h.anchor)) {
        if (!isLootHolderKind(p.kind)) continue;
        const key = keyOf(L, p);
        expect(purposeById(key), `${p.kind} key ${key}`).toBeTruthy();
        const t = holderTable(p.kind, key, profile), c = compartmentTable(p.kind, key, profile);
        for (const [id] of [...t.rows, ...(c?.rows ?? [])]) expect(id, `seed ${h.seed} ${p.kind} (${key})`).not.toMatch(/^ammo/);
      }
      const r = resOf(h);
      if (r.kids) expect(L.props[r.kids.dresser!].purpose).toBe('mall-toys');
      if (r.rare?.desk != null) expect(L.props[r.rare.desk].purpose).toBe('mall-management');
      // no floor piles in the store
      expect(storePickups(L, h.anchor).filter(p => Math.abs(p.y - (L.areas[p.area].floorY ?? 0)) < 0.05)).toEqual([]);
    }
  });

  it('back rooms: stocked (shelving + openable storage; the office a desk with drawers); the bookshop adds cartons / cabinets', () => {
    for (const h of ALL) {
      const L = h.layout, r = resOf(h);
      expect(h.anchor.stock.length).toBeGreaterThanOrEqual(1);
      for (const id of h.anchor.stock) {
        const a = L.areas[id], ps = L.props.filter(p => p.area === id);
        const storage = ps.filter(p => ['openable', 'existing'].includes(audit(p.kind)?.cls ?? ''));
        expect(storage.length, `seed ${h.seed} ${a.type}`).toBeGreaterThanOrEqual(1);
        if (a.type === 'stock-room') expect(ps.some(p => p.kind === 'stockShelf' || p.kind === 'shelf'), `seed ${h.seed} stock shelving`).toBe(true);
        else expect(ps.some(p => p.kind === 'desk'), `seed ${h.seed} office desk`).toBe(true);
      }
      expect(r.back.reduce((n, b) => n + b.added.length, 0), `seed ${h.seed}: the bookshop's own back-room additions`).toBeGreaterThanOrEqual(1);
      expect(r.back.some(b => b.added.some(i => L.props[i].kind === 'cardboardBoxFlaps')), `seed ${h.seed}: book cartons`).toBe(true);
    }
  });

  it('no back room (an older / tight carve): a staff stock corner — shelving and openable storage near the cash desk', () => {
    const h = findStores('books', {count: 20, maxSeed: 30}).find(q => !q.anchor.stock.length);
    if (!h) return; // (every sampled store has a back room: nothing to check)
    const r = resOf(h), L = h.layout, corner = r.stockCorner.map(i => L.props[i]);
    expect(corner.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(2);
    expect(corner.some(p => ['openable', 'existing'].includes(audit(p.kind)?.cls ?? '')), `seed ${h.seed}: openable storage`).toBe(true);
    for (const p of corner) expect(p.purpose).toBe(BOOKS_HOLDER_PURPOSE.stockCorner);
  }, 120_000);

  it('books are loose stock on real supports (rule 4): every stack hosted on a measured shelf / tier / top, the budget kept', () => {
    const shelves = bookcaseShelves(), tiers = bookTableTiers().map(t => t.y), m09 = [0.36, 0.85, 1.25, 1.63];
    for (const h of ALL) {
      const L = h.layout, stacks = placed(h).filter(p => p.kind === 'skyDBookStack');
      expect(stacks.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(25);
      expect(stacks.length).toBeLessThanOrEqual(BOOKS_STACK_BUDGET);
      for (const s of stacks) {
        expect(s.host, 'hosted').toBeDefined();
        const host = L.props[s.host!], dy = +(s.y - host.y).toFixed(3);
        const ok = host.kind === 'skyDBookcase' ? shelves : host.kind === 'skyDBookTable' ? tiers : host.kind === 'bookstoreBookcase' ? m09 : [PROP_DEFS[host.kind].h];
        expect(ok.some(y => Math.abs(y - dy) < 0.002), `${host.kind} support ${dy}`).toBe(true);
        expect(PROP_PHYSICS_AUDIT.skyDBookStack.cls).toBe('dynamic');
        // on an openable / loot host the stack's span is cut from its loot surface
        if (isLootHolderKind(host.kind)) expect((host.cut ?? []).some(c => Math.abs(c.y - dy) < 0.002), `${host.kind} cut`).toBe(true);
      }
      // no bookcase with baked books (the law bookcase is the baked one: never here)
      expect(placed(h).some(p => p.kind === 'lawBookcase')).toBe(false);
    }
  });

  it('fit: inside the store, no standing boxes overlapping, every piece reachable from the entry / the stair, signs on their hosts', () => {
    for (const h of ALL) {
      const L = h.layout, A = storeAreas(L, h.anchor), mine = placed(h), tag = `seed ${h.seed}`;
      for (const p of mine) expect(A.all.has(p.area), `${tag} ${p.kind} area`).toBe(true);
      const standing = mine.filter(p => !p.mounted && p.host === undefined && p.kind !== 'skyBooksRug');
      const all = storeProps(L, h.anchor).filter(p => !p.mounted && p.host === undefined && p.kind !== 'skyBooksRug');
      for (const p of standing) for (const q of all) {
        if (p === q || (p.level ?? 0) !== (q.level ?? 0)) continue;
        const ox = p.hx + q.hx - Math.abs(p.x - q.x), oz = p.hz + q.hz - Math.abs(p.z - q.z);
        expect(ox > 0.012 && oz > 0.012, `${tag}: ${p.kind} @${p.x},${p.z} overlaps ${q.kind} @${q.x},${q.z}`).toBe(false);
      }
      // every free cell of each sales storey reachable from its way in (flood over the storey's pieces)
      const storeys = new Map<number, number[]>();
      for (const id of [...A.floor, ...A.upper]) { const lv = L.areas[id].level ?? 0; storeys.set(lv, [...(storeys.get(lv) ?? []), id]); }
      for (const [lv, ids] of storeys) {
        const g = L.levels[lv].grid, set = new Set(ids), ok = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && set.has(g.area[i]);
        const cells: number[] = [];
        for (const id of ids) { const a = L.areas[id]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (ok(g.idx(x, y))) cells.push(g.idx(x, y)); }
        const seen = new Uint8Array(g.w * g.h), stack = [cells[0]];
        seen[cells[0]] = 1;
        while (stack.length) { const c = stack.pop()!; for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && ok(n)) { seen[n] = 1; stack.push(n); } }
        const cut = cells.filter(i => !seen[i]);
        expect(cut.length, `${tag} storey ${lv}: ${cut.length} cells cut off`).toBe(0);
      }
      // every staff / zone door of the store gets a walking lane (no skipped lane), lanes are >= 1.2 m clear
      const r = resOf(h);
      expect(r.lanes.filter(l => l.to === 'door').length, tag).toBeGreaterThanOrEqual(1);
      for (const l of r.lanes) expect(l.half * 2).toBeGreaterThanOrEqual(1.2);
      // signs stand on a host's top (bookcase / cabinet / table) or flush on the wall over the children's dresser
      for (const i of r.signs) {
        const s = L.props[i];
        expect(s.mounted).toBe(true);
        expect(s.y - (L.areas[s.area].floorY ?? 0), `${tag} sign height`).toBeGreaterThan(1.0);
      }
    }
  });

  it('physics classes: the loose furniture moves (wingbacks, bean bags, chairs, stacks), the fixtures and holders stay', () => {
    const dyn = ['skyDWingbackChair', 'beanBag', 'officeChair', 'skyDBookStack', 'cafeBistroTable', 'skyDArcLamp', 'cardboardBoxFlaps'];
    const stat = ['skyDBookcase', 'bookstoreBookcase', 'mallCashwrapCounter', 'glassDisplayCabinet', 'dresserDrawers', 'shopCounter', 'skyDBookTable', 'skyBooksSign', 'skyBooksRug', 'desk'];
    for (const k of dyn) expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('dynamic');
    for (const k of stat) expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
    for (const h of ALL) for (const p of placed(h)) expect(PROP_PHYSICS_AUDIT[p.kind], p.kind).toBeTruthy();
  });

  it('deterministic: the same seed dresses the same store', () => {
    const h = ALL[0];
    const again = findStores('books', {format: h.anchor.format, count: 1});
    expect(again[0].seed).toBe(h.seed);
    // (the helper caches layouts: regenerate this seed afresh)
    const L2 = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const fp = (L: StationLayout) => JSON.stringify(storeProps(L, L.skyways!.anchors!.find(a => a.family === 'books')!).map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.purpose ?? '']));
    expect(fp(L2)).toBe(fp(h.layout));
  }, 120_000);
});

describe('world/skywaysStoreBooks.ts: the signs / rugs drawn as instanced prop meshes with their atlas pieces', () => {
  it('a sign board + a double-sided art face per variant, a rug quad per variant; a scaled table sign', () => {
    const un = installCanvasShim(false);
    try {
      const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
      const g = new THREE.Group();
      const p = (kind: PropKind, variant: number, o: Partial<PropPlacement> = {}): PropPlacement => ({kind, x: 2, z: 3, y: 2.4, rot: 0, area: 0, hx: 0.5, hz: 0.1, h: PROP_DEFS[kind].h, blocksSight: false, variant, mounted: true, ...o});
      expect(buildStoreBooksProp(g, 'skyBooksSign', [p('skyBooksSign', 0), p('skyBooksSign', 3), p('skyBooksSign', 7, {h: PROP_DEFS.skyBooksSign.h * 0.62, level: 1})], mats)).toBe(3);
      expect(buildStoreBooksProp(g, 'skyBooksRug', [p('skyBooksRug', 0, {y: 0, mounted: false}), p('skyBooksRug', 1, {y: 0, mounted: false})], mats)).toBe(2);
      const names = g.children.map(c => c.name).sort();
      expect(names).toContain('prop-skyBooksSign-board');
      for (const n of ['prop-skyBooksSign-art0', 'prop-skyBooksSign-art3', 'prop-skyBooksSign-art7', 'prop-skyBooksRug-art0', 'prop-skyBooksRug-art1']) expect(names, n).toContain(n);
      for (const c of g.children) { expect((c as THREE.InstancedMesh).isInstancedMesh).toBe(true); expect(c.userData.level).toBeDefined(); }
      // the art face's UVs lie inside its atlas piece; the table sign drawn at 0.62
      const art = g.children.find(c => c.name === 'prop-skyBooksSign-art3') as THREE.InstancedMesh, r = BOOKS_ART.pieces[storeBooksPiece('skyBooksSign', 3)];
      const uv = art.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(r.u0 - 1e-6); expect(uv.getX(i)).toBeLessThanOrEqual(r.u1 + 1e-6);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(r.v0 - 1e-6); expect(uv.getY(i)).toBeLessThanOrEqual(r.v1 + 1e-6);
      }
      const m = new THREE.Matrix4(), s = new THREE.Vector3();
      const small = g.children.find(c => c.name === 'prop-skyBooksSign-art7' && c.userData.level === 1) as THREE.InstancedMesh;
      small.getMatrixAt(0, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      expect(s.x).toBeCloseTo(0.62, 3);
    } finally { un(); }
  });
});
