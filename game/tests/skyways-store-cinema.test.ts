// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): THE AURORA PICTURE HOUSE (gen/skyways/stores/cinema.ts) at
// layout version 3 over several seeds — a real old picture house: box office + rope queue, concession stand (openable cooler /
// cupboards, popcorn, candy case, REFRESHMENTS board), NOW SHOWING poster cases / stands, benches; the auditorium (screen, seat rows,
// aisles, EXIT); the staff side (openable filing cabinet / lockers) and stocked back rooms. Storage opens, loot on theme, fit / routes,
// physics classes, palette, the art kinds and their Codex atlas.
import {beforeAll, describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SkywaysAnchor} from '../src/gen/skyways/skywaysTypes';
import {STORE_CINEMA} from '../src/gen/skyways/stores/cinema';
import {CINEMA_PURPOSES} from '../src/gen/skyways/stores/cinemaDress';
import {STORE_CINEMA_KINDS, STORE_CINEMA_MALL_MODELS, STORE_CINEMA_SPECS} from '../src/gen/skyways/stores/kinds/cinema';
import {CINEMA_MENU_PIECE, CINEMA_POSTER_PIECES, cinemaArtAtlas, cinemaArtShape} from '../src/gen/skyways/stores/cinemaArt';
import {SKYWAYS_STORE_MALL_MODELS} from '../src/gen/skyways/stores/kinds/index';
import {ANCHOR_STYLES} from '../src/gen/skyways/destinations/anchorStyles';
import {OPENABLE_AUDIT, openableSpec} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {purposeById} from '../src/gen/purposes';
import {storeAreas} from './helpers/skywaysStores';

interface Hit { seed: number; layout: StationLayout; an: SkywaysAnchor; props: PropPlacement[] }
const HITS: Hit[] = [];
const gen = (seed: number) => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;

beforeAll(() => {
  for (let seed = 1; seed <= 40 && HITS.length < 6; seed++) {
    const layout = gen(seed), an = layout.skyways?.anchors?.find(a => a.family === 'cinema');
    if (!an) continue;
    const {all} = storeAreas(layout, an);
    HITS.push({seed, layout, an, props: layout.props.filter(p => all.has(p.area))});
  }
}, 600_000);

const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e.cls]));
const kinds = (h: Hit, ids: Iterable<number>) => { const s = new Set(ids); return h.props.filter(p => s.has(p.area)); };
const of = (ps: readonly PropPlacement[], k: string) => ps.filter(p => p.kind === k);
const lobbyIds = (h: Hit) => storeAreas(h.layout, h.an).floor;

describe('Skyways cinema store: kinds, art, audits', () => {
  it('its three art kinds are classified honestly in both audits (no storage: posters / board; the stand loose, the rest mounted)', () => {
    for (const k of STORE_CINEMA_KINDS) {
      expect(audit.get(k), k).toBe('none');
      expect(PROP_PHYSICS_AUDIT[k], k).toBeTruthy();
      expect(PROP_DEFS[k]).toEqual(STORE_CINEMA_SPECS[k].def);
    }
    expect(STORE_CINEMA_SPECS.storeCinemaPosterStand.phys).toMatchObject({dynamic: true, mass: 9, mat: 'pad'});
    expect(PROP_DEFS.storeCinemaPosterStand.physics).toMatchObject({dynamic: true, contact: true});
    expect(STORE_CINEMA_SPECS.storeCinemaPosterCase.phys).toMatchObject({dynamic: false, why: 'mounted'});
    expect(STORE_CINEMA_SPECS.storeCinemaMenuBoard.phys).toMatchObject({dynamic: false, why: 'mounted'});
    // the Mall model it uses is registered for Skyways
    for (const f of STORE_CINEMA_MALL_MODELS) expect(SKYWAYS_STORE_MALL_MODELS).toContain(f);
  });

  it('its art is the Codex atlas (four invented posters + the REFRESHMENTS board), cropped to each face without stretching', () => {
    const a = cinemaArtAtlas()!;
    expect(a).toBeTruthy();
    const file = path.join(__dirname, '../public', a.url);
    expect(fs.existsSync(file), a.url).toBe(true);
    const prov = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/derivatives/skyways-store-cinema-art-20261107.json'), 'utf8'));
    expect(prov.generator).toMatch(/Codex native image_gen/);
    expect(prov.status).toMatch(/unapproved prototype/);
    expect(prov.files).toHaveLength(5);
    for (const piece of [...CINEMA_POSTER_PIECES, CINEMA_MENU_PIECE]) expect(a.pieces[piece], piece).toBeTruthy();
    // CREDITS credits the art; no absolute local path / URL in the public provenance
    const credits = fs.readFileSync(path.join(__dirname, '../public/assets/CREDITS.md'), 'utf8');
    expect(credits).toContain('assets/textures/skyways/stores/cinema/cinema-art.jpg');
    expect(JSON.stringify(prov)).not.toMatch(/\/workspaces\/|\/home\/|https?:\/\//);
    // the cooked atlas, its provenance and CREDITS are allowlisted public inputs (bytes / sha256 as built)
    const allow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const rel of [a.url, 'assets/derivatives/skyways-store-cinema-art-20261107.json', 'assets/CREDITS.md']) {
      const row = allow.files.find(f => f.path === rel), b = fs.readFileSync(path.join(__dirname, '../public', rel));
      expect(row, rel).toBeTruthy();
      expect(row!.bytes, rel).toBe(b.length);
      expect(row!.sha256, rel).toBe(createHash('sha256').update(b).digest('hex'));
    }
    for (const k of STORE_CINEMA_KINDS) {
      const {parts, face} = cinemaArtShape(k, 1), def = PROP_DEFS[k];
      // the art sits inside the kind's box; its aspect is the piece's (posters 2:3, the board 3:2)
      expect(Math.abs(face.w / face.h - a.pieces[face.piece].aspect)).toBeLessThan(0.02);
      for (const q of parts) {
        expect(Math.abs(q.p[0]) + q.s[0] / 2).toBeLessThanOrEqual(def.w / 2 + 1e-6);
        expect(q.p[1] + q.s[1] / 2).toBeLessThanOrEqual(def.h + 1e-6);
        expect(Math.abs(q.p[2]) + q.s[2] / 2).toBeLessThanOrEqual(def.d / 2 + 1e-6);
      }
    }
  });
});

describe('Skyways cinema store: a real old picture house on every seed', () => {
  it('finds the store on several version-3 seeds (multi-zone: lobby + auditorium, at least one back room)', () => {
    expect(HITS.length).toBeGreaterThanOrEqual(5);
    for (const h of HITS) {
      expect(h.an.format).toBe('multi-zone');
      expect(h.an.zones.length).toBeGreaterThanOrEqual(1);
      expect(h.an.stock.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the lobby: box office + rope queue, the concession stand, NOW SHOWING cases, a bench; plates over the doors', () => {
    for (const h of HITS) {
      const L = kinds(h, lobbyIds(h)), at = `seed ${h.seed}`;
      expect(of(L, 'skyDTicketBooth'), at).toHaveLength(1);
      expect(of(L, 'skywaysPrizeStanchion').length, at).toBeGreaterThanOrEqual(2);
      // concession: counters with the till and the popcorn machine on top, the glass candy case / snack rack, the drinks cooler, the
      // cupboards, the REFRESHMENTS board; the popcorn cart or machine
      expect(of(L, 'shopCounter').length, at).toBeGreaterThanOrEqual(1);
      expect(of(L, 'shopDisplay').length + of(L, 'snackRack').length, at).toBeGreaterThanOrEqual(1);
      expect(of(L, 'shopCooler'), at).toHaveLength(1);
      expect(of(L, 'cabinetLow').length, at).toBeGreaterThanOrEqual(1);
      expect(of(L, 'storeCinemaMenuBoard'), at).toHaveLength(1);
      expect(of(L, 'popcornMachine').length + of(L, 'skyDPopcornCart').length, at).toBeGreaterThanOrEqual(1);
      expect(of(L, 'cashRegister'), at).toHaveLength(1);
      expect(of(L, 'storeCinemaPosterCase').length, at).toBeGreaterThanOrEqual(2);
      expect(new Set(of(L, 'storeCinemaPosterCase').map(p => p.variant)).size, at).toBeGreaterThanOrEqual(2);
      const texts = h.layout.signs.filter(s => storeAreas(h.layout, h.an).all.has(s.area)).map(s => s.text);
      expect(texts, at).toContain('SCREEN 1');
      expect(texts, at).toContain('EXIT');
      expect(texts, at).toContain('STAFF ONLY');
    }
    // across the seeds: the vintage cart, the stands, the benches, the soda fountain (where the wall takes the back counter)
    const all = HITS.flatMap(h => kinds(h, lobbyIds(h)));
    for (const k of ['skyDPopcornCart', 'storeCinemaPosterStand', 'bench', 'sodaFountain', 'popcornMachine', 'skyDPoster']) {
      expect(HITS.filter(h => of(kinds(h, lobbyIds(h)), k).length).length, k).toBeGreaterThanOrEqual(Math.ceil(HITS.length * 0.6));
    }
    expect(all.length).toBeGreaterThan(0);
  });

  it('the auditorium: the screen on the far wall, seat rows facing it, aisles from the door, EXIT, fire / first-aid kit by the door', () => {
    for (const h of HITS) {
      const aud = h.layout.areas[h.an.zones[0]], A = kinds(h, [aud.id]), at = `seed ${h.seed}`;
      const screen = of(A, 'skyDCinemaScreen');
      expect(screen, at).toHaveLength(1);
      const seats = of(A, 'skyDCinemaSeats');
      expect(seats.length, at).toBeGreaterThanOrEqual(12);
      // every row faces the screen (its front +Z toward the screen wall)
      for (const s of seats) {
        const fx = Math.sin(s.rot), fz = Math.cos(s.rot), dx = screen[0].x - s.x, dz = screen[0].z - s.z;
        expect(fx * dx + fz * dz, at).toBeGreaterThan(0);
      }
      expect(of(A, 'fireExtinguisherCabinet').length + of(A, 'firstAidWallKit').length, at).toBeGreaterThanOrEqual(1);
      // a bin by the doors (the lobby's or the auditorium's: openable spill holders)
      expect(of(h.props, 'bin').length, at).toBeGreaterThanOrEqual(1);
      // a walkable route from the auditorium door to the front (screen) zone and to the end of every seat row
      const g = h.layout.levels[aud.level ?? 0].grid;
      const door = h.layout.doors.find(d => d.b === aud.id || d.a === aud.id)!;
      const reach = bfs(g, aud.id, door);
      const [sx, sy] = g.cellOf(screen[0].x, screen[0].z);
      let nearScreen = false;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (reach.has(g.idx(sx + dx, sy + dy))) nearScreen = true;
      expect(nearScreen, `${at}: the screen front reachable`).toBe(true);
      // (a row is a run of touching blocks: its legroom is entered from an aisle at one of its ends)
      const ring = (s: PropPlacement) => {
        const [x0, y0, x1, y1] = [Math.floor((s.x - s.hx) / CELL) - 1, Math.floor((s.z - s.hz) / CELL) - 1, Math.floor((s.x + s.hx) / CELL) + 1, Math.floor((s.z + s.hz) / CELL) + 1];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (reach.has(g.idx(x, y))) return true;
        return false;
      };
      const alongX = Math.abs(Math.sin(seats[0].rot)) < 0.5, key = (s: PropPlacement) => `${Math.round((alongX ? s.z : s.x) * 10)}`;
      const rows = new Map<string, PropPlacement[]>();
      for (const s of seats) { const l = rows.get(key(s)); if (l) l.push(s); else rows.set(key(s), [s]); }
      for (const row of rows.values()) {
        row.sort((p, q) => (alongX ? p.x - q.x : p.z - q.z));
        let run: PropPlacement[] = [];
        const flush = () => { if (run.length) expect(ring(run[0]) || ring(run[run.length - 1]), `${at}: seat run at ${run[0].x},${run[0].z} reachable from an aisle`).toBe(true); run = []; };
        for (const s of row) {
          const prev = run[run.length - 1];
          if (prev && Math.abs((alongX ? s.x - prev.x : s.z - prev.z)) > PROP_DEFS.skyDCinemaSeats.w + 0.05) flush();
          run.push(s);
        }
        flush();
      }
    }
  });

  it('the staff side: openable filing cabinet / lockers on every seed (back rooms first), the back rooms stocked', () => {
    let cabinets = 0, lockers = 0;
    for (const h of HITS) {
      const P = h.props, at = `seed ${h.seed}`;
      const staff = P.filter(p => p.kind === 'filingCabinet' || p.kind === 'staffLockers');
      expect(staff.length, at).toBeGreaterThanOrEqual(1);
      cabinets += of(P, 'filingCabinet').length ? 1 : 0;
      lockers += of(P, 'staffLockers').length ? 1 : 0;
      for (const id of h.an.stock) {
        const holders = kinds(h, [id]).filter(p => isLootHolderKind(p.kind));
        expect(holders.length, `${at}: back room ${id} stocked`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(cabinets).toBeGreaterThanOrEqual(HITS.length - 1);
    expect(lockers).toBeGreaterThanOrEqual(HITS.length - 1);
  });
});

describe('Skyways cinema store: storage opens, loot on theme, fit, physics, palette', () => {
  it('every storage piece it places opens (existing openables), the rest is open shelving / a counter / a fixture with a reason', () => {
    for (const h of HITS) for (const p of h.props) {
      const cls = audit.get(p.kind);
      expect(cls, `${p.kind} classified`).toBeTruthy();
      if (['shopCooler', 'cabinetLow', 'chestFreezer', 'filingCabinet', 'staffLockers', 'cardboardBoxFlaps', 'bin', 'firstAidWallKit'].includes(p.kind)) {
        expect(['openable', 'existing'], p.kind).toContain(cls);
        // (the openables-system kinds animate their parts; the low cupboard is the existing two-door holder of containers.ts)
        if (cls === 'openable') expect(openableSpec(p.kind)?.parts.length ?? 0, p.kind).toBeGreaterThan(0);
      }
    }
  });

  it('loot: the store purposes exist and fit (concession kiosk / front of house / kitchen store room / private office); ammo only on the office purpose', () => {
    expect(STORE_CINEMA.purposes).toEqual(CINEMA_PURPOSES);
    for (const id of Object.values(CINEMA_PURPOSES)) expect(purposeById(id), id).toBeTruthy();
    const FOOD = new Set(['water', 'cola', 'juice', 'chips', 'chocolate', 'beans', 'noodles']);
    for (const h of HITS) {
      const A = storeAreas(h.layout, h.an);
      expect(h.layout.areas[h.an.floor].purpose).toBe(CINEMA_PURPOSES.floor);
      for (const z of h.an.zones) expect(h.layout.areas[z].purpose).toBe(CINEMA_PURPOSES.zones);
      for (const p of h.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const key = p.purpose ?? h.layout.areas[p.area].purpose!;
        const t = holderTable(p.kind as never, key);
        expect(t.source, `${p.kind} in ${key}`).not.toBe('legacy');
        const ammo = t.rows.some(r => r[0].startsWith('ammo'));
        if (ammo) expect(key, `${p.kind}: ammo only by the Office rule`).toBe(CINEMA_PURPOSES.office);
        // the concession's displays / cooler / snack rack sell food and drink
        if (A.floor.includes(p.area) && ['shopCooler', 'snackRack', 'shopDisplay', 'chestFreezer'].includes(p.kind)) {
          for (const [item] of t.rows) expect(FOOD.has(item) || item === 'battery', `${p.kind}: ${item}`).toBe(true);
        }
      }
    }
  });

  it('fit: every prop on its store\'s floor, no two floor props overlap, the lobby routes reach every door and the counter', () => {
    for (const h of HITS) {
      const g = h.layout.levels[h.an.level].grid, A = storeAreas(h.layout, h.an), at = `seed ${h.seed}`;
      const floorProps = h.props.filter(p => p.host === undefined && !p.mounted && !p.lift);
      for (const p of floorProps) {
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(A.all.has(g.area[g.idx(cx, cy)]), `${at}: ${p.kind} on its floor`).toBe(true);
      }
      for (let i = 0; i < floorProps.length; i++) for (let j = i + 1; j < floorProps.length; j++) {
        const a = floorProps[i], b = floorProps[j];
        const ox = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), oz = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 0.02 && oz > 0.02 && oy > 0.02, `${at}: ${a.kind} / ${b.kind} overlap`).toBe(false);
      }
      // from the storefront: every door of the lobby (the auditorium, the staff doors) and the counter's customer side
      const sf = h.layout.doors.find(d => d.shopfront && (d.a === h.an.floor || d.b === h.an.floor))!;
      const lobby = new Set(A.floor);
      const reach = bfsSet(g, lobby, sf);
      for (const d of h.layout.doors.filter(q => !q.shopfront && (lobby.has(q.a) || lobby.has(q.b)))) {
        let ok = false;
        for (let y = d.y - 1; y <= d.y + d.h && !ok; y++) for (let x = d.x - 1; x <= d.x + d.w && !ok; x++) if (reach.has(g.idx(x, y))) ok = true;
        expect(ok, `${at}: door ${d.a}->${d.b} reachable from the entry`).toBe(true);
      }
      for (const c of of(kinds(h, A.floor), 'shopCounter')) {
        const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
        const [cx, cy] = g.cellOf(c.x + fx * (PROP_DEFS.shopCounter.d / 2 + 0.45), c.z + fz * (PROP_DEFS.shopCounter.d / 2 + 0.45));
        expect(reach.has(g.idx(cx, cy)), `${at}: counter customer side reachable`).toBe(true);
      }
    }
  });

  it('physics classes: the queue posts, the poster stands and the popcorn cart move; the kiosk, seat rows and cases do not', () => {
    for (const k of ['skywaysPrizeStanchion', 'storeCinemaPosterStand', 'skyDPopcornCart']) expect(PROP_DEFS[k as never as keyof typeof PROP_DEFS].physics?.dynamic, k).toBe(true);
    for (const k of ['skyDTicketBooth', 'skyDCinemaSeats', 'storeCinemaPosterCase', 'storeCinemaMenuBoard', 'shopCounter']) expect(PROP_DEFS[k as never as keyof typeof PROP_DEFS].physics?.dynamic ?? false, k).toBe(false);
    // the round posts are placed as round colliders
    for (const h of HITS) for (const p of of(h.props, 'skywaysPrizeStanchion')) expect(p.round).toBe(true);
  });

  it('palette: deep red plaster over a wood dado, burgundy carpet; the auditorium darker; through ANCHOR_STYLES', () => {
    const st = ANCHOR_STYLES.cinema, f = STORE_CINEMA.finish!;
    expect(st.wall.kind).toBe('wood');
    expect(st.wall.paint).toBe(f.wall.paint);
    expect(st.floor.kind).toBe('carpet');
    const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
    expect(lum(st.zones!.wall!.paint)).toBeLessThan(lum(st.wall.paint));
    expect(lum(st.zones!.ceiling!.tint!)).toBeLessThan(lum(st.ceiling.tint!));
  });

  it('is deterministic (the same seed dresses the same store)', () => {
    const h = HITS[0], again = gen(h.seed);
    const an = again.skyways!.anchors!.find(a => a.family === 'cinema')!, {all} = storeAreas(again, an);
    const sig = (ps: readonly PropPlacement[]) => JSON.stringify(ps.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.purpose ?? '']));
    expect(sig(again.props.filter(p => all.has(p.area)))).toBe(sig(h.props));
  }, 120_000);
});

/** Cells reachable on foot inside one area from a door. */
function bfs(g: StationLayout['grid'], area: number, door: {x: number; y: number; w: number; h: number}): Set<number> {
  return bfsSet(g, new Set([area]), door);
}
function bfsSet(g: StationLayout['grid'], areas: ReadonlySet<number>, door: {x: number; y: number; w: number; h: number}): Set<number> {
  const ok = (x: number, y: number) => g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && !g.blocked[g.idx(x, y)] && areas.has(g.area[g.idx(x, y)]);
  const seen = new Set<number>(), st: [number, number][] = [];
  for (let y = door.y - 1; y <= door.y + door.h; y++) for (let x = door.x - 1; x <= door.x + door.w; x++) if (ok(x, y)) { seen.add(g.idx(x, y)); st.push([x, y]); }
  while (st.length) {
    const [x, y] = st.pop()!;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (ok(nx, ny) && !seen.has(g.idx(nx, ny))) { seen.add(g.idx(nx, ny)); st.push([nx, ny]); }
  }
  return seen;
}
