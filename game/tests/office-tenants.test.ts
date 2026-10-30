// Task office-overhaul-20261030 (lane TENANTS): the 20-company tenant system of the office tower (gen/office/companies.ts,
// tenants.ts, tower.ts company programs, companyDress.ts) plus feedback items 7 (executive suites), 8 (plants never block
// corridors) and 9 (server rooms hold servers). Node only (no GPU / browser).
import {describe, expect, it} from 'vitest';
import {COMPANIES, COMPANY_IDS, ROOMS, BASE_ROOMS, OPEN_STYLES, type RoomKey} from '../src/gen/office/companies';
import {COMPANY_KINDS, COMPANY_KIND_ASSET, COMPANY_KIND_AUDIT, COMPANY_PROP_DEFS, WATER_TOWER_STAND} from '../src/gen/office/companyKinds';
import {TENANT_FLOORS, TWO_FLOOR_CHANCE, officeTenants} from '../src/gen/office/tenants';
import {CORRIDOR_CLEAR_M, directoryLines, isNarrowPassage, passageClear} from '../src/gen/office/companyDress';
import {OFFICE_GEN_STATS, generateOfficeLevel, officeIssues, towerFrame} from '../src/gen/office/index';
import {officeModelKeysFor, isOfficeKind} from '../src/gen/office/kinds';
import {PROP_DEFS} from '../src/gen/props';
import {CELL} from '../src/gen/grid';
import {COMPANY_ASSET_SPECS, COMPANY_DIMS} from '../src/assets/companyDims.generated';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {ROOM_PURPOSES} from '../src/gen/purposes';
import {ITEMS} from '../src/items/items';
import type {StationLayout} from '../src/gen/stationTypes';
import {scarceOdds} from '../src/gen/office/spawns';

const cache = new Map<number, StationLayout>();
const times: number[] = [];
function gen(levelSeed: number): StationLayout {
  let l = cache.get(levelSeed);
  if (!l) {
    l = generateOfficeLevel({levelSeed, startWeapon: 'pistol'});
    cache.set(levelSeed, l);
    times.push(OFFICE_GEN_STATS.ms);
  }
  return l;
}
/** A few level seeds whose tenants cover all 20 companies (and at least one two-floor company). */
function coveringSeeds(): number[] {
  const seen = new Set<string>(), out: number[] = [];
  let span = false;
  for (let s = 1; s < 5000 && (seen.size < COMPANY_IDS.length || !span); s++) {
    const t = officeTenants(s);
    const fresh = t.filter(q => !seen.has(q.company)).length;
    const two = t.some(q => q.parts === 2);
    if (fresh >= 3 || (fresh > 0 && seen.size >= 15) || (two && !span && fresh > 0)) {
      out.push(s);
      for (const q of t) seen.add(q.company);
      span ||= two;
    }
  }
  return out;
}
const SEEDS = coveringSeeds();

describe('company catalogue', () => {
  it('20 companies, each with 2 signature kinds: 40 unique, mapped to the manifest D-codes of that company', () => {
    expect(COMPANY_IDS.length).toBe(20);
    const sig = COMPANY_IDS.flatMap(id => COMPANIES[id].signature);
    expect(sig.length).toBe(40);
    expect(new Set(sig).size).toBe(40);
    for (const id of COMPANY_IDS) {
      const c = COMPANIES[id];
      expect(c.id).toBe(id);
      expect(c.signature).toContain(c.hero);
      expect(c.name.length).toBeGreaterThan(3);
      expect(c.tagline.length).toBeGreaterThan(3);
      for (const k of c.signature) {
        const asset = COMPANY_KIND_ASSET[k]!;
        expect(COMPANY_ASSET_SPECS[asset].company, `${id} ${k}`).toBe(id);
        expect(COMPANY_ASSET_SPECS[asset].code).toMatch(/^D\d\d$/);
      }
      // Rooms of its program exist in the catalogue; its two floors differ.
      for (const r of [...c.program.rooms[0], ...c.program.rooms[1], ...c.program.ends[0], ...c.program.ends[1]]) expect(ROOMS[r as RoomKey], `${id} ${r}`).toBeDefined();
      for (const o of c.program.open) expect(OPEN_STYLES[o]).toBeDefined();
    }
    // Every D-code is somebody's signature; distinct palettes and programs.
    const dCodes = Object.entries(COMPANY_ASSET_SPECS).filter(([, s]) => s.code.startsWith('D')).map(([a]) => a).sort();
    expect(sig.map(k => COMPANY_KIND_ASSET[k]).sort()).toEqual(dCodes);
    expect(new Set(COMPANY_IDS.map(id => COMPANIES[id].palette.accent)).size).toBe(20);
    expect(new Set(COMPANY_IDS.map(id => JSON.stringify([COMPANIES[id].program.rooms, COMPANIES[id].program.open]))).size).toBe(20);
  });

  it('company / supporting kinds: footprints = measured dims or nominal size, model ids, openables audit, purposes', () => {
    for (const k of COMPANY_KINDS) {
      expect(isOfficeKind(k), k).toBe(true);
      const def = PROP_DEFS[k];
      expect(def, k).toBeDefined();
      expect(def).toEqual(COMPANY_PROP_DEFS[k]);
      const asset = COMPANY_KIND_ASSET[k];
      if (!asset) { expect(k).toBe('logoWall'); continue; }
      const spec = COMPANY_ASSET_SPECS[asset], dims = COMPANY_DIMS[asset];
      // (the water tower's tank stands on the kind's steel stand: its height adds the stand)
      if (dims) expect([def.w, def.h, def.d]).toEqual(dims.map((v, i) => Math.round((v + (i === 1 && k === 'waterTower' ? WATER_TOWER_STAND : 0)) * 1000) / 1000));
      else {
        const ext = spec.sizeAxis === 'h' ? def.h : spec.sizeAxis === 'w' ? def.w : Math.max(def.w, def.d, def.h);
        expect(ext, `${k} nominal ${spec.sizeAxis}`).toBeCloseTo(spec.sizeM, 2);
      }
    }
    // All E-codes but the toilet (lane INTERACT) are kinds here; roof / turnstile kinds for lane STRUCT.
    const eIds = Object.entries(COMPANY_ASSET_SPECS).filter(([id, s]) => s.code.startsWith('E') && id !== 'toilet').map(([id]) => id).sort();
    expect(Object.values(COMPANY_KIND_ASSET).filter(a => COMPANY_ASSET_SPECS[a!].code.startsWith('E')).sort()).toEqual(eIds);
    for (const k of ['roofHvac', 'waterTower', 'satelliteDish', 'securityTurnstile', 'pottedPlantSmall', 'planterTree']) expect(COMPANY_KINDS).toContain(k);
    for (const r of COMPANY_KIND_AUDIT) expect(OPENABLE_AUDIT.filter(e => e.kind === r.kind).length, r.kind).toBe(1);
    // Every company room purpose exists, its loot rows are real items.
    for (const key of Object.keys(ROOMS) as RoomKey[]) {
      const p = ROOM_PURPOSES[ROOMS[key].purpose];
      expect(p, key).toBeDefined();
      for (const spec of Object.values(p.loot)) for (const [id] of spec!.items) expect(ITEMS[id], `${key} ${id}`).toBeDefined();
    }
  });
});

describe('loot tilt (within the existing scarcity)', () => {
  it('a company floor shifts the mix of its scarce loose finds, never the expected count; holders follow its rooms\' themes', () => {
    const sum = (o: number[]) => o.reduce((a, b) => a + b, 0);
    const none = scarceOdds('none');
    for (const t of ['medical', 'food', 'ammo', 'light'] as const) expect(sum(scarceOdds(t)), t).toBeCloseTo(sum(none), 9);
    expect(scarceOdds('medical')[0]).toBeGreaterThan(none[0] * 1.5);
    expect(scarceOdds('light')[1] + scarceOdds('light')[2]).toBeGreaterThan(none[1] + none[2]);
    expect(scarceOdds('food')[3]).toBeGreaterThan(0);
    expect(none[3]).toBe(0);
    // Themed company rooms carry the company's theme (clinic -> medical, café -> food, security -> security).
    expect(ROOM_PURPOSES['office-dispensary'].theme).toBe('medical');
    expect(ROOM_PURPOSES['office-cafe'].theme).toBe('food');
    expect(ROOM_PURPOSES['office-control'].theme).toBe('security');
  });
});

describe('tenant assignment', () => {
  it('deterministic per level seed; floors 2..8 distinct companies; the lobby never a tenant', () => {
    for (const s of [1, 2, 3, 99, 4242]) {
      const a = officeTenants(s), b = officeTenants(s);
      expect(a).toEqual(b);
      expect(a.map(t => t.floor)).toEqual([...TENANT_FLOORS]);
      // Companies distinct except a two-floor run (parts 2, consecutive floors, reception on the lower one).
      const runs = a.filter(t => t.parts === 2);
      expect([0, 2]).toContain(runs.length);
      if (runs.length) {
        expect(runs[0].company).toBe(runs[1].company);
        expect(runs[1].floor).toBe(runs[0].floor + 1);
        expect([runs[0].part, runs[1].part]).toEqual([0, 1]);
      }
      expect(new Set(a.map(t => t.company)).size).toBe(7 - (runs.length ? 1 : 0));
      for (const t of a) {
        expect(t.name).toBe(COMPANIES[t.company].name);
        expect(t.palette).toEqual(COMPANIES[t.company].palette);
      }
    }
  });

  it('variety over seeds: every company on every floor, two-floor companies in ~a third of the levels', () => {
    const N = 3000;
    const perCompany = new Map<string, number>(), perFloor = new Map<string, number>();
    let spans = 0;
    const firsts = new Set<string>();
    for (let s = 0; s < N; s++) {
      const t = officeTenants(s * 7919 + 13);
      if (t.some(q => q.parts === 2)) spans++;
      firsts.add(t[0].company);
      for (const q of t) { perCompany.set(q.company, (perCompany.get(q.company) ?? 0) + 1); perFloor.set(`${q.floor}:${q.company}`, (perFloor.get(`${q.floor}:${q.company}`) ?? 0) + 1); }
    }
    expect(perCompany.size).toBe(20);
    expect(firsts.size).toBe(20);
    for (const f of TENANT_FLOORS) for (const id of COMPANY_IDS) expect(perFloor.get(`${f}:${id}`) ?? 0, `${f} ${id}`).toBeGreaterThan(0);
    const counts = [...perCompany.values()];
    expect(Math.min(...counts) / Math.max(...counts)).toBeGreaterThan(0.75);
    expect(spans / N).toBeGreaterThan(TWO_FLOOR_CHANCE - 0.05);
    expect(spans / N).toBeLessThan(TWO_FLOOR_CHANCE + 0.05);
    expect(spans / N).toBeGreaterThan(0.3);
    expect(spans / N).toBeLessThan(0.4);
  });
});

describe('company floors in the generated tower', () => {
  it('covering seeds generate valid levels in reasonable time', () => {
    expect(SEEDS.length).toBeLessThanOrEqual(10);
    const companies = new Set(SEEDS.flatMap(s => officeTenants(s).map(t => t.company)));
    expect(companies.size).toBe(20);
    for (const s of SEEDS) expect(officeIssues(gen(s), towerFrame(s)), `${s}`).toEqual([]);
    const sorted = times.slice().sort((a, b) => a - b);
    process.stdout.write(`\n[office-tenants] seeds ${SEEDS.join(',')} · generateOfficeLevel ms ${times.map(t => t.toFixed(0)).join(', ')} (median ${sorted[sorted.length >> 1].toFixed(0)})\n`);
    expect(sorted[sorted.length >> 1]).toBeLessThan(2000);
  }, 300000);

  it('every tenant floor: Area.tenant everywhere, its signature kinds, its distinctive rooms, a reception on its first floor, company labels', () => {
    const fp = new Map<string, Set<string>>();
    for (const s of SEEDS) {
      const l = gen(s);
      expect(l.office!.tenants!.map(t => t.floor)).toEqual([...TENANT_FLOORS]);
      for (const t of l.office!.tenants!) {
        const c = COMPANIES[t.company];
        // (scissor-stair runs span two storeys: no tenant, no company label)
        const areas = l.areas.filter(a => a.level === t.floor && a.role !== 'stair');
        const props = l.props.filter(p => p.level === t.floor);
        expect(areas.every(a => a.tenant === t.company), `${s} floor ${t.floor} tenant tags`).toBe(true);
        for (const k of c.signature) expect(props.filter(p => p.kind === k).length, `${s} floor ${t.floor} ${t.company} ${k}`).toBeGreaterThan(0);
        const part = t.part > 0 ? 1 : 0;
        for (const r of c.program.rooms[part]) {
          if (BASE_ROOMS.has(r)) continue;
          expect(areas.some(a => a.purpose === ROOMS[r].purpose), `${s} floor ${t.floor} ${t.company} room ${r}`).toBe(true);
        }
        const rec = areas.filter(a => a.purpose === 'office-tenant-reception');
        expect(rec.length, `${s} floor ${t.floor} reception`).toBe(t.part === 0 ? 1 : 0);
        if (rec.length) {
          const inRec = props.filter(p => p.area === rec[0].id).map(p => p.kind);
          expect(inRec).toContain('logoWall');
          expect(inRec).toContain('receptionDesk');
          expect(inRec, `${t.company} hero`).toContain(c.hero);
          const logo = l.signs.filter(q => q.area === rec[0].id && q.style && q.text === c.name.toUpperCase());
          expect(logo.length, `${t.company} logo plate`).toBe(1);
          // The reception opens onto the elevator lobby on the elevator door's axis.
          const e = l.office!.elevator;
          expect(Math.abs((rec[0].x + rec[0].w / 2) * CELL - e.door.x)).toBeLessThan(rec[0].w * CELL / 2);
        }
        for (const a of areas) if (a.type !== 'office-stair') expect(a.label.startsWith(`${c.short} · `), `${a.label}`).toBe(true);
        const key = `${t.company}:${part}`;
        if (!fp.has(key)) fp.set(key, new Set([...areas.map(a => a.purpose ?? ''), ...props.map(p => p.kind)]));
      }
    }
    // Meaningfully different floors: each company floor shares well under the whole of its room/prop vocabulary with any other.
    const keys = [...fp.keys()];
    let maxJ = 0;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (keys[i].split(':')[0] === keys[j].split(':')[0]) continue;
      const A = fp.get(keys[i])!, B = fp.get(keys[j])!;
      const inter = [...A].filter(x => B.has(x)).length;
      maxJ = Math.max(maxJ, inter / (A.size + B.size - inter));
    }
    process.stdout.write(`[office-tenants] ${keys.length} company floors, max room+prop vocabulary overlap (Jaccard) ${maxJ.toFixed(2)}\n`);
    expect(maxJ).toBeLessThan(0.85);
  }, 300000);

  it('the lobby is neutral (no tenant), with modern seating, planter trees and the tenant directory', () => {
    for (const s of SEEDS.slice(0, 3)) {
      const l = gen(s);
      expect(l.areas.filter(a => (a.level ?? 0) <= 1).every(a => !a.tenant)).toBe(true);
      const lobby = l.props.filter(p => p.level === 1);
      expect(lobby.some(p => p.kind === 'lobbySofa')).toBe(true);
      expect(lobby.some(p => p.kind === 'planterTree')).toBe(true);
      const head = l.signs.filter(q => q.level === 1 && q.text === 'TENANT DIRECTORY');
      expect(head.length, `${s} directory`).toBe(1);
      const lines = directoryLines(s);
      const plates = l.signs.filter(q => q.level === 1 && Math.abs(q.x - head[0].x) < 1e-6 && Math.abs(q.z - head[0].z) < 1e-6 && q.text !== 'TENANT DIRECTORY');
      expect(plates.map(q => q.text)).toEqual(lines.map(q => q.text));
      expect(plates.every(q => q.style)).toBe(true);
      expect(lines[0].text.startsWith('8')).toBe(true);
    }
  });

  it('item 7: floor 8 (and companies with one) get an executive suite with dedicated furniture, no generic desk / monitor', () => {
    for (const s of SEEDS) {
      const l = gen(s);
      const execs = l.areas.filter(a => a.purpose === 'office-exec');
      expect(execs.some(a => a.level === 8), `${s} floor 8 exec`).toBe(true);
      for (const t of l.office!.tenants!) if (COMPANIES[t.company].program.exec && t.part === t.parts - 1) expect(execs.some(a => a.level === t.floor), `${s} ${t.company}`).toBe(true);
      for (const a of execs) {
        const kinds = l.props.filter(p => p.area === a.id).map(p => p.kind);
        expect(kinds, `${s} exec ${a.id}`).toContain('executiveDesk');
        expect(kinds).toContain('executiveChair');
        expect(kinds.filter(k => k === 'chesterfieldSofa' || k === 'globeBar').length).toBeGreaterThan(0);
        expect(kinds).not.toContain('desk');
        expect(kinds).not.toContain('officeMonitor');
        expect(kinds).not.toContain('officeChair');
      }
    }
  });

  it('item 9: every server room holds rows of servers (>= 2 racks; cabinets / CRAC units across the tower)', () => {
    let rooms = 0, racks = 0, extras = 0;
    for (const s of SEEDS) {
      const l = gen(s);
      for (const a of l.areas.filter(q => q.purpose === 'office-server')) {
        const k = l.props.filter(p => p.area === a.id);
        const n = k.filter(p => p.kind === 'serverRack').length;
        expect(n, `${s} server room ${a.id} level ${a.level} ${a.w}x${a.h}`).toBeGreaterThanOrEqual(2);
        rooms++;
        racks += n;
        extras += k.filter(p => p.kind === 'serverCabinet' || p.kind === 'cracUnit').length;
      }
    }
    process.stdout.write(`[office-tenants] server rooms ${rooms}, racks ${racks} (mean ${(racks / rooms).toFixed(1)}), cabinets + CRAC ${extras}\n`);
    expect(rooms).toBeGreaterThan(SEEDS.length);
    expect(racks / rooms).toBeGreaterThanOrEqual(4);
    expect(extras).toBeGreaterThan(rooms);
  });

  it('delivered-model placement facts: kegerator in a corner with its -X side (portrait panel) on a wall, ship model / aquarium on a sideboard, no portal in a corridor', () => {
    let kegs = 0, boards = 0;
    for (const s of SEEDS) {
      const l = gen(s);
      for (const p of l.props) {
        const lv = p.level ?? 0, g = l.levels[lv].grid;
        if (p.kind === 'kegerator') {
          kegs++;
          const def = PROP_DEFS.kegerator, lx = Math.round(Math.cos(p.rot)), lz = Math.round(-Math.sin(p.rot));
          const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
          const side = g.cellOf(p.x - lx * (def.w / 2 + 0.2), p.z - lz * (def.w / 2 + 0.2));
          const back = g.cellOf(p.x - fx * (def.d / 2 + 0.2), p.z - fz * (def.d / 2 + 0.2));
          expect(g.area[g.idx(...side)] === p.area && g.walkable(...side), `${s} kegerator -X side open`).toBe(false);
          expect(g.area[g.idx(...back)] === p.area && g.walkable(...back), `${s} kegerator back open`).toBe(false);
        }
        if (p.kind === 'shipModel' || p.kind === 'aquarium') {
          boards++;
          expect(p.host, `${s} ${p.kind} on a sideboard`).toBeDefined();
          const h = l.props[p.host!];
          expect(h.kind).toBe('cabinetLow');
          expect(p.y).toBeCloseTo(h.y + PROP_DEFS.cabinetLow.h, 4);
        }
        if (p.kind === 'metalDetector') expect(l.areas[p.area].type).not.toBe('office-corridor');
      }
    }
    process.stdout.write(`[office-tenants] kegerators ${kegs}, sideboard pieces ${boards}\n`);
  });

  it('company models load lazily per layout: only the kinds present (tenants on this level)', () => {
    const l = gen(SEEDS[0]);
    const keys = officeModelKeysFor(l);
    const present = new Set(officeTenants(SEEDS[0]).map(t => t.company));
    for (const id of COMPANY_IDS) for (const k of COMPANIES[id].signature) {
      const key = `office-${COMPANY_KIND_ASSET[k]}`;
      expect(keys.includes(key), `${id} ${k}`).toBe(present.has(id));
    }
  });
});

describe('item 8: plants never block corridors', () => {
  it('~30 levels: every narrow corridor keeps >= 1.5 m clear at every cross-section; only small plants there; no plant in a door zone', () => {
    const seeds = [...SEEDS, ...Array.from({length: Math.max(0, 30 - SEEDS.length)}, (_, i) => 900 + i * 37)];
    let corridors = 0, plants = 0, worst = Infinity;
    for (const s of seeds) {
      const l = gen(s);
      for (const a of l.areas) {
        if (!isNarrowPassage(a)) continue;
        corridors++;
        const {clear} = passageClear(l, a);
        worst = Math.min(worst, clear);
        expect(clear, `${s} corridor ${a.id} level ${a.level}`).toBeGreaterThanOrEqual(CORRIDOR_CLEAR_M - 1e-6);
        const inside = l.props.filter(p => p.area === a.id && (p.kind === 'deadPlant' || p.kind === 'planterTree' || p.kind === 'pottedPlantSmall'));
        for (const p of inside) expect(p.kind, `${s} corridor plant`).toBe('pottedPlantSmall');
        plants += inside.length;
      }
      // No plant inside a door's own cells (+ 1 cell) on its level; none on the elevator landing strips / in stairwells.
      for (const p of l.props) {
        if (!(p.kind === 'deadPlant' || p.kind === 'planterTree' || p.kind === 'pottedPlantSmall') || !(p.level ?? 0)) continue;
        for (const d of l.doors) {
          if ((d.level ?? l.areas[d.a].level ?? 0) !== p.level) continue;
          const hit = p.x + p.hx > (d.x - 1) * CELL + 0.01 && p.x - p.hx < (d.x + d.w + 1) * CELL - 0.01 && p.z + p.hz > (d.y - 1) * CELL + 0.01 && p.z - p.hz < (d.y + d.h + 1) * CELL - 0.01;
          expect(hit, `${s} ${p.kind} at ${p.x},${p.z} level ${p.level} in door zone`).toBe(false);
        }
        expect(l.areas[p.area].type).not.toBe('office-stair');
      }
      expect(officeIssues(l, towerFrame(s)), `${s}`).toEqual([]);
    }
    process.stdout.write(`[office-tenants] ${seeds.length} levels: ${corridors} narrow corridors, worst clear width ${worst.toFixed(2)} m, ${plants} small corridor plants\n`);
    expect(plants).toBeGreaterThan(seeds.length);
  }, 600000);
});
