// Task studio-skyways-rework-20261107-054512-01 (lane MAPS): the Skyways LOCAL DIRECTORY BOARDS on real seeds.
//  - the kind (gen/skyways/mapBoardKind.ts): registered in PROP_DEFS / PROP_DAMAGE (never breaks) / PROP_PHYSICS_AUDIT (static,
//    anchored) / OPENABLE_AUDIT (a sealed sign); its shape (a ~0.95 m face tilted 25 degrees, top 1.35 m) inside its collision box;
//  - the placement (gen/skyways/mapBoards.ts, layout version 3 only): 8-20 per map, the station concourse by the transit stair, a board
//    on every building's street lobby and skyway storey, bridge landings; each on flat public hub floor of its storey, off the
//    composition's walking lanes, door cells, run mouths, ramps, the landmark discs, the bridge lanes, the anchors' fronts; nothing
//    overlaps it; a clear reading strip in front; deterministic; older layout versions have none;
//  - the plan (world/skywaysMapPlan.ts) matches the layout: buildings, bridges (one skyway line each), the pedways, the runs, every
//    destination (anchors, landmark courts, the ramen restaurant, the food court, the station, the add-on event); YOU ARE HERE at the
//    board's projected position; the board's storey solid, the others faint; no forbidden words on any face;
//  - the renderer (world/skywaysMapBoards.ts) in Node with the canvas shim: bounded meshes / textures per storey, every instance on its
//    storey, the overlay quads at each board's marker / strip, textures released with the face mesh.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT, unclassifiedPhysicsKinds} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {compositionOf} from '../src/gen/compose';
import {cellsOfBox} from '../src/gen/placeKit';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {SKYWAYS_MAP_BOARD, SKYWAYS_MAPBOARD_KINDS, isSkywaysMapBoardKind} from '../src/gen/skyways/mapBoardKind';
import {SKYWAYS_MAP_BOARDS} from '../src/gen/skyways/mapBoards';
import {SKYWAYS_MAP_FORBIDDEN, skywaysBoardHere, skywaysMapPlan, skywaysMapTexts, storeyPhrase} from '../src/world/skywaysMapPlan';
import {MAP_FACE, OTHER_STOREY_FILL, SPACE_FILL, SKYWAYS_MAP_BOARD_BUILD, drawSkywaysBoardComposite, drawSkywaysMapFace, faceProjector, facePoint, hereOnFace,
  markerFlip, skywaysMapBoardBody, skywaysMapFaceGeometry} from '../src/world/skywaysMapBoards';
import {SkywaysMapRead, MAP_READ} from '../src/world/skywaysMapRead';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

/** Real seeds: both add-ons (prize-car display 1-3, 6; convention venue 4, 5) and four frame families. */
const SEEDS = [1, 2, 3, 4, 5, 6];
const cache = new Map<number, StationLayout>();
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol'} as never))); return l; };
const boardsOf = (L: StationLayout) => L.props.filter(p => p.kind === 'skywaysMapBoard');
const inside = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const cellsOf = (p: PropPlacement) => { const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz), out: [number, number][] = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]); return out; };

/** A 2D context that records what is drawn (fillRect with its style, every text) — no pixels. */
function recorder(): {ctx: CanvasRenderingContext2D; rects: {x: number; y: number; w: number; h: number; style: string}[]; texts: string[]} {
  const rects: {x: number; y: number; w: number; h: number; style: string}[] = [], texts: string[] = [];
  const st = {fillStyle: '#000' as unknown};
  const noop = () => {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => {
      if (k === 'fillRect') return (x: number, y: number, w: number, h: number) => rects.push({x, y, w, h, style: String(st.fillStyle)});
      if (k === 'fillText') return (s: string) => texts.push(s);
      if (k === 'measureText') return (s: string) => ({width: s.length * 8});
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({addColorStop: noop});
      if (k === 'fillStyle') return st.fillStyle;
      return noop;
    },
    set: (_t, k: string, v: unknown) => { if (k === 'fillStyle') st.fillStyle = v; return true; },
  });
  return {ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts};
}

describe('Skyways map boards: the kind', () => {
  it('is registered in every table: static anchored, a sealed sign (not openable), never breaks; its shape fits its box', () => {
    expect(SKYWAYS_MAPBOARD_KINDS).toEqual(['skywaysMapBoard']);
    expect(isSkywaysMapBoardKind('skywaysMapBoard')).toBe(true);
    const d = PROP_DEFS.skywaysMapBoard;
    expect(d).toMatchObject({w: 1.0, h: 1.35, blocksSight: false});
    expect(PROP_DAMAGE.skywaysMapBoard).toMatchObject({cls: 'steel', breaks: 'never'});
    expect(PROP_PHYSICS_AUDIT.skywaysMapBoard).toMatchObject({kind: 'skywaysMapBoard', cls: 'static', why: 'anchored', src: 'skyways'});
    expect(PROP_PHYSICS_AUDIT.skywaysMapBoard.how).toMatch(/bolted/);
    expect(unclassifiedPhysicsKinds()).not.toContain('skywaysMapBoard');
    const open = OPENABLE_AUDIT.filter(r => r.kind === 'skywaysMapBoard');
    expect(open.length).toBe(1);
    expect(open[0]).toMatchObject({cls: 'none', role: 'equipment'});
    expect(open[0].how).toMatch(/sealed/);
    // the drawn board: a ~0.95 m face tilted ~25 degrees, top 1.35 m, standing on its base plate, inside the collision box
    expect(SKYWAYS_MAP_BOARD.faceD).toBeCloseTo(0.95, 2);
    expect(SKYWAYS_MAP_BOARD.tilt * 180 / Math.PI).toBeCloseTo(25, 5);
    const body = skywaysMapBoardBody(), box = new THREE.Box3();
    for (const g of [body.steelDark, body.steelBright, skywaysMapFaceGeometry()]) { g.computeBoundingBox(); box.union(g.boundingBox!); }
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.35, 2);
    expect(box.max.x - box.min.x).toBeCloseTo(1.0, 2);
    expect(box.min.z).toBeGreaterThanOrEqual(-d.d / 2 - 1e-3);
    expect(box.max.z).toBeLessThanOrEqual(d.d / 2 + 1e-3);
    // the face looks up and forward (its normal tilted 25 degrees from horizontal), its centre at reading height
    const n = facePoint(MAP_FACE.px / 2, MAP_FACE.px / 2, 1).sub(facePoint(MAP_FACE.px / 2, MAP_FACE.px / 2, 0));
    expect(n.z).toBeGreaterThan(0.85);
    expect(Math.asin(n.y) * 180 / Math.PI).toBeCloseTo(25, 3);
    expect(SKYWAYS_MAP_BOARD.centerY).toBeGreaterThan(0.8);
    expect(SKYWAYS_MAP_BOARD.centerY).toBeLessThan(1.0);
  });
});

describe('Skyways map boards: placement on real seeds', () => {
  it('8-20 boards per map: the concourse by the transit stair, every building\'s street lobby and skyway storey, bridge landings', () => {
    const counts: number[] = [];
    for (const s of SEEDS) {
      const L = gen(s), info = L.skyways!, bs = boardsOf(L);
      counts.push(bs.length);
      expect(bs.length, `seed ${s}`).toBeGreaterThanOrEqual(8);
      expect(bs.length, `seed ${s}`).toBeLessThanOrEqual(SKYWAYS_MAP_BOARDS.max);
      // the concourse: one near the foot of the transit stair
      const transit = L.levelLinks.find(k => k.lower === 0 && /Concourse – Street level/.test(L.areas[L.traversal.stairs[k.traversalId ?? -1]?.area ?? -1]?.label ?? ''))!;
      expect(transit, `seed ${s}`).toBeTruthy();
      expect(bs.some(b => (b.level ?? 0) === 0 && Math.hypot(b.x - transit.bottom.x, b.z - transit.bottom.z) < 16), `seed ${s} concourse`).toBe(true);
      // every building: a board on its street level and on its skyway level (each has public hub floor on both)
      // (layout v3: a convention host's skyway floor is the event VENUE — the venue dresser's, no board inside it)
      for (const b of info.buildings) for (const lv of [1, 2]) {
        if (lv === info.addon.level && b.id === info.addon.building && info.addon.venue?.length) { expect(bs.some(p => p.level === lv && info.addon.venue!.some(v => v.area === p.area)), `seed ${s} venue`).toBe(false); continue; }
        expect(bs.some(p => p.level === lv && inside(b.rect, p.x, p.z)), `seed ${s} ${b.name} L${lv}`).toBe(true);
      }
      // bridge landings: most bridge ends have a board within 12 m of the landing inside the building
      let ends = 0, served = 0;
      for (const br of info.bridges) {
        const ax = br.axis === 'x', mid = ax ? (br.rect.z0 + br.rect.z1) / 2 : (br.rect.x0 + br.rect.x1) / 2;
        for (const e of ax ? [br.rect.x0, br.rect.x1] : [br.rect.z0, br.rect.z1]) {
          ends++;
          const [x, z] = ax ? [e, mid] : [mid, e];
          if (bs.some(p => p.level === br.level && Math.hypot(p.x - x, p.z - z) < 14)) served++;
        }
      }
      expect(served / ends, `seed ${s} bridge ends ${served}/${ends}`).toBeGreaterThanOrEqual(0.5);
    }
    expect(counts.length).toBe(SEEDS.length);
  });

  it('each stands on flat public hub floor of its storey, off lanes / doors / run mouths / ramps / landmark discs / bridge lanes / anchor fronts, overlapping nothing', () => {
    for (const s of SEEDS) {
      const L = gen(s), info = L.skyways!, comp = compositionOf(L);
      const anchorFronts = new Set((info.anchors ?? []).map(a => a.storefront));
      for (const b of boardsOf(L)) {
        const lv = b.level ?? 0, g = L.levels[lv].grid, a = L.areas[b.area], tag = `seed ${s} board ${b.x},${b.z} L${lv}`;
        expect(a.publicSpace && (a.level ?? 0) === lv && a.kind === 'concourse', tag).toBe(true);
        expect(info.addon.areas.includes(a.id), tag).toBe(false);
        expect(b.y, tag).toBeCloseTo(L.levels[lv].baseY, 3);
        expect([0, Math.PI / 2, Math.PI, -Math.PI / 2].some(r => Math.abs(r - b.rot) < 1e-6), tag).toBe(true);
        const lane = comp?.masks[lv]?.lane;
        for (const [cx, cy] of cellsOf(b)) {
          const i = g.idx(cx, cy);
          expect(g.cells[i], tag).toBe(FLOOR);
          expect(g.rampIdx[i], tag).toBeLessThan(0);
          expect(g.floorOf(i), tag).toBeCloseTo(b.y, 3);
          expect(g.area[i], tag).toBe(b.area);
          expect(g.blocked[i], tag).toBe(1);
          if (lane) expect(lane[i], `${tag} on a walking lane`).toBe(0);
        }
        // doors (rect +-1 cell), run mouths (every stand point of this storey), landmark discs, bridge lanes, the anchors' fronts
        for (const d of L.doors) {
          if ((d.level ?? L.areas[d.a].level ?? 0) !== lv) continue;
          const near = cellsOf(b).some(([cx, cy]) => cx >= d.x - 1 && cx <= d.x + d.w && cy >= d.y - 1 && cy <= d.y + d.h);
          expect(near, `${tag} at door ${d.id}`).toBe(false);
        }
        for (const k of L.levelLinks) for (const [plv, p] of [[k.lower, k.bottom], [k.upper, k.top]] as const) if (plv === lv) expect(Math.hypot(p.x - b.x, p.z - b.z), `${tag} run mouth`).toBeGreaterThan(2.5);
        for (const m of info.landmarks ?? []) if (m.level === lv) expect(Math.hypot(m.x - b.x, m.z - b.z), `${tag} landmark`).toBeGreaterThan(m.radius + 1);
        for (const br of info.bridges) if (br.level === lv) {
          const r = br.rect, L6 = SKYWAYS_MAP_BOARDS.bridgeLane, lane2 = br.axis === 'x' ? {x0: r.x0 - L6, z0: r.z0, x1: r.x1 + L6, z1: r.z1} : {x0: r.x0, z0: r.z0 - L6, x1: r.x1, z1: r.z1 + L6};
          // (sub-cell slack: the kit keeps whole cells)
          const e = 0.1;
          expect(b.x + b.hx <= lane2.x0 + e || b.x - b.hx >= lane2.x1 - e || b.z + b.hz <= lane2.z0 + e || b.z - b.hz >= lane2.z1 - e, `${tag} in bridge ${br.id}'s lane`).toBe(true);
        }
        for (const sf of L.storefronts) if ((sf.level ?? 0) === lv && anchorFronts.has(sf.id)) {
          const o = {x0: sf.ox * CELL - 2.5, z0: sf.oy * CELL - 2.5, x1: (sf.ox + sf.ow) * CELL + 2.5, z1: (sf.oy + sf.oh) * CELL + 2.5};
          expect(b.x + b.hx <= o.x0 || b.x - b.hx >= o.x1 || b.z + b.hz <= o.z0 || b.z - b.hz >= o.z1, `${tag} before anchor front ${sf.name}`).toBe(true);
        }
        // nothing else stands in its box; its reading strip (1.2 m in front) is open floor
        for (const q of L.props) {
          if (q === b || (q.level ?? 0) !== lv || q.mounted) continue;
          const sep = q.x + q.hx <= b.x - b.hx + 1e-3 || q.x - q.hx >= b.x + b.hx - 1e-3 || q.z + q.hz <= b.z - b.hz + 1e-3 || q.z - q.hz >= b.z + b.hz - 1e-3;
          expect(sep, `${tag} overlaps ${q.kind}`).toBe(true);
        }
        const fx = Math.round(Math.sin(b.rot)), fz = Math.round(Math.cos(b.rot)), d = PROP_DEFS.skywaysMapBoard.d / 2;
        for (const t of [0.3, 0.8, 1.1]) for (const off of [-0.35, 0, 0.35]) {
          const x = b.x + fx * (d + t) + fz * off, z = b.z + fz * (d + t) + fx * off, [cx, cy] = g.cellOf(x, z);
          expect(g.walkable(cx, cy), `${tag} reading strip`).toBe(true);
        }
      }
      expect(skywaysIssues(L), `seed ${s}`).toEqual([]);
    }
  });

  it('deterministic; layout versions 1 and 2 (the frozen generator) place none', () => {
    const a = boardsOf(gen(2)).map(p => [p.x, p.z, p.rot, p.level]);
    const b = boardsOf(LEVELS.skyways.generate('main', {levelSeed: 2, startWeapon: 'pistol'} as never) as StationLayout).map(p => [p.x, p.z, p.rot, p.level]);
    expect(b).toEqual(a);
    for (const v of [1, 2]) expect(boardsOf(LEVELS.skyways.generate('main', {levelSeed: 2, startWeapon: 'pistol', layoutVersion: v} as never) as StationLayout).length, `v${v}`).toBe(0);
  });
});

describe('Skyways map boards: the plan matches the layout', () => {
  it('buildings, bridges (one +15 line each through its deck), pedways, runs and every destination', () => {
    for (const s of SEEDS) {
      const L = gen(s), info = L.skyways!, plan = skywaysMapPlan(L)!;
      expect(plan.name).toBe(info.name);
      expect(plan.buildings.map(b => [b.id, b.name])).toEqual(info.buildings.map(b => [b.id, b.name]));
      // every building's public floor on both storeys (a convention host's skyway floor drawn as the event venue)
      for (const b of plan.buildings) for (const lv of [1, 2]) {
        const kind = lv === info.addon.level && b.id === info.addon.building && info.addon.venue?.length ? 'event' : 'hub';
        expect(plan.spaces.some(q => q.level === lv && q.kind === kind && inside(b.rect, (q.rect.x0 + q.rect.x1) / 2, (q.rect.z0 + q.rect.z1) / 2)), `seed ${s} ${b.name} L${lv}`).toBe(true);
      }
      const sky = plan.lines.filter(l => l.kind === 'skyway');
      expect(sky.map(l => l.id).sort()).toEqual(info.bridges.map(b => b.id).sort());
      for (const br of info.bridges) {
        const l = sky.find(q => q.id === br.id)!, c = {x: (br.rect.x0 + br.rect.x1) / 2, z: (br.rect.z0 + br.rect.z1) / 2};
        // the line crosses the deck along its axis (some segment spans the deck's middle), its ends inside the two buildings
        const crosses = l.pts.some((p, i) => i > 0 && (br.axis === 'x' ? Math.min(p.x, l.pts[i - 1].x) <= c.x && Math.max(p.x, l.pts[i - 1].x) >= c.x && Math.abs(p.z - c.z) < 0.5
          : Math.min(p.z, l.pts[i - 1].z) <= c.z && Math.max(p.z, l.pts[i - 1].z) >= c.z && Math.abs(p.x - c.x) < 0.5));
        expect(crosses, `seed ${s} ${br.id}`).toBe(true);
        const ra = info.buildings.find(b => b.id === br.a)!.rect, rb = info.buildings.find(b => b.id === br.b)!.rect;
        const [p0, p1] = [l.pts[0], l.pts[l.pts.length - 1]];
        expect((inside(ra, p0.x, p0.z) && inside(rb, p1.x, p1.z)) || (inside(rb, p0.x, p0.z) && inside(ra, p1.x, p1.z)), `seed ${s} ${br.id} ends`).toBe(true);
      }
      // pedways: every "Pedway to ..." piece drawn as a concourse line
      const ped = L.areas.filter(a => a.publicSpace && /^Pedway to /.test(a.label));
      expect(plan.lines.filter(l => l.kind === 'pedway').length).toBe(ped.length);
      // runs: one icon per stair well that links storeys
      const wells = new Set(L.levelLinks.map(k => L.traversal.stairs[k.traversalId ?? -1]?.area).filter(a => a !== undefined && !L.areas[a].ext));
      expect(plan.runs.length).toBe(wells.size);
      expect(plan.runs.filter(r => r.transit).length).toBe(1);
      // destinations: every anchor, every landmark court, the ramen restaurant, the food court, the station, the add-on event
      const texts = plan.labels.map(l => l.text);
      for (const an of info.anchors ?? []) expect(plan.labels.some(l => l.kind === 'anchor' && l.text === an.name && l.level === an.level), `seed ${s} ${an.name}`).toBe(true);
      for (const m of info.landmarks ?? []) expect(plan.labels.some(l => l.kind === 'landmark' && l.text === m.name && l.level === m.level), `seed ${s} ${m.name}`).toBe(true);
      if (info.restaurant) expect(texts, `seed ${s}`).toContain(info.restaurant.name);
      if (info.buildings.some(b => b.foodCourt)) expect(texts).toContain('Food court');
      expect(plan.labels.some(l => l.kind === 'station' && l.level === 0)).toBe(true);
      const ev = plan.labels.filter(l => l.kind === 'event');
      expect(ev.every(l => l.level === info.addon.level)).toBe(true);
      if (info.addon.id === 'prize-car') expect(ev.map(l => l.text)).toEqual(['Grand Prize Draw']);
      else if (info.addon.venue?.length) {
        // the venue's public parts by their event names (never its back of house)
        expect(ev.map(l => l.text)).toContain('Main stage hall');
        expect(ev.some(l => /^Exhibitors/.test(l.text))).toBe(true);
        expect(ev.some(l => /^Panel room/.test(l.text))).toBe(true);
        expect(ev.some(l => /backstage|storage|washroom/i.test(l.text))).toBe(false);
      } else expect(ev.length).toBe(1);
    }
  });

  it('YOU ARE HERE at the board\'s projected position (inside the plan); the floor context line names its storey and building', () => {
    for (const s of SEEDS) {
      const L = gen(s), info = L.skyways!, plan = skywaysMapPlan(L)!;
      for (const b of boardsOf(L)) {
        const lv = b.level ?? 0, here = skywaysBoardHere(plan, b), P = faceProjector(plan, lv), p = hereOnFace(plan, here);
        expect(here.level).toBe(lv);
        expect(p.x).toBeCloseTo(P.X(b.x), 6);
        expect(p.y).toBeCloseTo(P.Y(b.z), 6);
        expect(p.x).toBeGreaterThan(P.box.x0); expect(p.x).toBeLessThan(P.box.x1);
        expect(p.y).toBeGreaterThan(P.box.y0); expect(p.y).toBeLessThan(P.box.y1);
        // back to the world: within half a metre of the board
        expect(Math.abs((p.x - P.X(0)) / P.k - b.x)).toBeLessThan(0.5);
        const bld = info.buildings.find(q => inside(q.rect, b.x, b.z))!;
        expect(bld, `seed ${s}`).toBeTruthy();
        expect(here.line).toBe(`You are on the ${storeyPhrase(lv)}, ${bld.name}`);
        if (lv === 2) expect(here.line).toMatch(/^You are on the \+15 Skyway level, /);
        // the marker sprite stays on the printed circle
        const M = MAP_FACE.marker, x0 = markerFlip(p) ? p.x - (M.w - M.dot) : p.x - M.dot;
        for (const [x, y] of [[x0, p.y - M.h / 2], [x0 + M.w, p.y - M.h / 2], [x0, p.y + M.h / 2], [x0 + M.w, p.y + M.h / 2]]) expect(Math.hypot(x - 512, y - 512)).toBeLessThanOrEqual(MAP_FACE.r);
      }
    }
  });

  it('the board\'s storey is solid, the others faint; the face prints no forbidden words', () => {
    for (const s of [1, 2]) {
      const L = gen(s), plan = skywaysMapPlan(L)!;
      for (const b of boardsOf(L).slice(0, 4)) {
        const lv = b.level ?? 0, P = faceProjector(plan, lv), r = recorder();
        drawSkywaysBoardComposite(r.ctx, plan, skywaysBoardHere(plan, b), 1);
        const at = (q: {rect: {x0: number; z0: number}}) => r.rects.filter(f => Math.abs(f.x - P.X(q.rect.x0)) < 1e-6 && Math.abs(f.y - P.Y(q.rect.z0)) < 1e-6).map(f => f.style);
        for (const q of plan.spaces) {
          if (q.level === lv) expect(at(q), `seed ${s} L${lv} own ${q.kind}`).toContain(SPACE_FILL[q.kind]);
          else if (q.kind !== 'platform' && q.kind !== 'stair') expect(at(q), `other ${q.kind}`).toContain(OTHER_STOREY_FILL);
        }
        const all = [...r.texts, ...skywaysMapTexts(plan)];
        expect(all.some(t => t === 'YOU ARE HERE')).toBe(true);
        expect(all).toContain(skywaysBoardHere(plan, b).lines[0]);
        for (const t of all) expect(SKYWAYS_MAP_FORBIDDEN.test(t), t).toBe(false);
      }
    }
    // the storey face alone draws no marker (it is shared by every board of the storey)
    const r = recorder(), L = gen(1);
    drawSkywaysMapFace(r.ctx, skywaysMapPlan(L)!, 2, 1);
    expect(r.texts).not.toContain('YOU ARE HERE');
  });
});

describe('Skyways map boards: the renderer (Node, canvas shim)', () => {
  it('bounded: per storey 2 body + 1 face + 1 overlay mesh, storeys + 1 textures; every instance on its storey; the overlay quads on each board', () => {
    const L = gen(1), bs = boardsOf(L), mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(L, mats, {});
    const storeys = new Set(bs.map(b => b.level ?? 0));
    expect(SKYWAYS_MAP_BOARD_BUILD).toMatchObject({boards: bs.length, storeys: storeys.size, textures: storeys.size + 1, meshes: storeys.size * 4});
    const ims: THREE.InstancedMesh[] = [], overlays: THREE.Mesh[] = [];
    w.group.traverse(o => { if (o.name.startsWith('prop-skywaysMapBoard-')) ims.push(o as THREE.InstancedMesh); if (o.name.startsWith('skyways-map-board-overlay-')) overlays.push(o as THREE.Mesh); });
    expect(ims.length).toBe(storeys.size * 3);
    expect(overlays.length).toBe(storeys.size);
    for (const lv of storeys) {
      const n = bs.filter(b => (b.level ?? 0) === lv).length;
      for (const part of ['steelDark', 'steelBright', 'face']) {
        const im = ims.find(m => m.name === `prop-skywaysMapBoard-${part}` && m.userData.level === lv)!;
        expect(im, `${part} L${lv}`).toBeTruthy();
        expect(im.count).toBe(n);
      }
      const ov = overlays.find(m => m.userData.level === lv)!;
      expect(ov.geometry.attributes.position.count).toBe(8 * n);
      // each board's marker dot sits at its projected YOU ARE HERE point on the face
      const plan = skywaysMapPlan(L)!, pos = ov.geometry.attributes.position as THREE.BufferAttribute;
      bs.filter(b => (b.level ?? 0) === lv).forEach((b, i) => {
        const here = skywaysBoardHere(plan, b), p = hereOnFace(plan, here), M = MAP_FACE.marker, flip = markerFlip(p);
        const m4 = new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot), new THREE.Vector3(1, 1, 1));
        const x0 = flip ? p.x - (M.w - M.dot) : p.x - M.dot;
        const want = facePoint(x0, p.y + M.h / 2, 0.0045).applyMatrix4(m4); // the quad's first vertex (bottom-left)
        const got = new THREE.Vector3().fromBufferAttribute(pos, i * 8 + 4);
        expect(got.distanceTo(want), `board ${i}`).toBeLessThan(1e-4);
      });
    }
    // released with the world: disposing the storey face mesh disposes the build's textures
    const tex = new Set<THREE.Texture>();
    for (const im of ims) { const m = im.material as THREE.Material & {map?: THREE.Texture}; if (m.map && im.name.endsWith('-face')) tex.add(m.map); }
    for (const o of overlays) { const m = o.material as THREE.Material & {map?: THREE.Texture}; if (m.map) tex.add(m.map); }
    expect(tex.size).toBe(storeys.size + 1);
    let disposed = 0;
    for (const t of tex) t.addEventListener('dispose', () => disposed++);
    for (const im of ims) im.dispose();
    expect(disposed).toBe(tex.size);
  });
});

describe('Skyways map boards: the close-up read (E at a board)', () => {
  it('standing at a board\'s face and looking at it prompts; E opens / closes its face; walking off or turning away closes it; inert without boards', () => {
    const L = gen(1), b = boardsOf(L)[0];
    const host = {player: {x: 0, y: 0, z: 0, yaw: 0}, layout: L, state: 'playing', interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
      sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[]};
    const rt = new SkywaysMapRead(host).install();
    expect([host.interactHandlers.length, host.frameHooks.length, host.sectionHooks.length, host.promptProviders.length]).toEqual([1, 1, 1, 1]);
    host.sectionHooks[0].build!(L);
    expect(rt.boards.length).toBe(boardsOf(L).length);
    const fx = Math.sin(b.rot), fz = Math.cos(b.rot);
    const stand = (d: number, turn = 0) => { Object.assign(host.player, {x: b.x + fx * d, z: b.z + fz * d, y: b.y, yaw: b.rot + turn}); host.frameHooks[0](0.016); };
    stand(1.0);
    expect(rt.target).toBe(b);
    expect(host.promptProviders[0]()).toMatch(/Read the directory/);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(rt.open).toBe(b);
    expect(host.promptProviders[0]()).toMatch(/Close the directory/);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(rt.open).toBe(null);
    host.interactHandlers[0]();
    stand(MAP_READ.reach + 0.5);
    expect(rt.open).toBe(null);
    expect(host.promptProviders[0]()).toBe(null);
    expect(host.interactHandlers[0]()).toBe(false);
    stand(1.0, Math.PI); // facing away
    expect(rt.target).toBe(null);
    stand(-1.0); // behind the board
    expect(rt.target).toBe(null);
    host.sectionHooks[0].teardown!();
    host.sectionHooks[0].build!({...L, props: []} as StationLayout);
    stand(1.0);
    expect(host.promptProviders[0]()).toBe(null);
  });
});
