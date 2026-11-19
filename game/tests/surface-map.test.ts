// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE CHECKPOINT'S PLANNING MAP (world/surface/map*.ts) on REAL
// generated districts (LEVELS.<host>.generate('surface'): GEN's streets, buildings, notes, windows, checkpoint and map table). Every
// expectation is derived from the generated layout (no fixed names); the only addition is one note placed on no real place:
//  - every marker stands on the real thing its ref names (a building, a street, a block, the checkpoint, the portal); every destination
//    building is marked with its real name and grid square; every generated note on a real place is printed, the note on none is not;
//  - reports are derived from real state (entered, searched holders, interior enemies down, the generated broken panes of a known
//    building, the depot's units; a lane report / a live lane's declared key replaces its default family);
//  - the exploration record: encode / decode round trip, a bounded string (SAVE_LIMITS.stringChars), malformed / foreign records read
//    empty; the runtime writes it to the district memory on change and restores it on re-entry;
//  - the live player / truck markers track their poses and headings;
//  - the map table: GEN's srMapTable placement (by index, else by kind near the read pose, else a reading box at the read pose);
//    [E] aimed at it from the read pose opens the overlay in the 'map' state;
//  - no campaign data: the map modules import nothing of the campaign, and no network station name reaches the printed sheet;
//  - the overlay's keys (Esc / E / Tab close, nothing else reaches the game).
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceBuilding, SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {surfaceKeyOf} from '../src/gen/surface/surfaceRun';
import {SAVE_LIMITS} from '../src/save/validate';
import {createRun} from '../src/run/runState';
import {generateNetwork} from '../src/campaign/network';
import {
  EXPLORE, SURFACE_LIFE_LANE, cellIndex, decodeBits, encodeBits, exploreGridFor, exploredCount, isExplored, markDisc, readLifeRecord, writeLifeRecord,
} from '../src/world/surface/mapExplore';
import {buildPlanningMap, gridRef, placeAt, recoverableName, refHolds, streetRect, type MapReportInput} from '../src/world/surface/mapModel';
import {depotRecoverables} from '../src/world/surface/cargoSeed';
import {drawPlanningCanvas, headingDeg, renderPlanningSvg, type MapCtx} from '../src/world/surface/mapDraw';
import {planningKeyAction} from '../src/world/surface/mapView';
import {MAP_TABLE_KIND, SurfaceMapRuntime, mapTablePlacement, rayBox} from '../src/world/surface/mapRuntime';

const COLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const centre = (b: SurfaceBuilding) => ({x: (b.footprint.x0 + b.footprint.x1) / 2, z: (b.footprint.z0 + b.footprint.z1) / 2});

/** A real district, plus ONE note on no real place (it must never be printed). `shop` = an enterable destination (with broken panes if any has). */
function district(host: 'subway' | 'office' | 'mall' = 'subway', seed = 7) {
  const layout = LEVELS[host].generate('surface', {levelSeed: seed}) as StationLayout;
  const s = layout.surface as SurfaceInfo;
  // GEN's real record: nothing stood in
  expect(s.streets.length, 'streets').toBeGreaterThan(0);
  expect(s.notes.length, 'notes').toBeGreaterThan(0);
  expect(s.buildings.some(b => b.destination), 'destinations').toBe(true);
  s.notes.push({x: s.extent.x0 - 300, z: s.extent.z0 - 300, text: 'Off the sheet', kind: 'info'});
  const broken = (id: number) => s.windows.filter(w => w.building === id).reduce((n, w) => n + w.panes.filter(p => p === 'broken').length, 0);
  const shops = s.buildings.filter(b => b.destination && b.enterable && b.areas.length && b.id !== s.depot.building);
  expect(shops.length).toBeGreaterThan(0);
  const shop = shops.find(b => broken(b.id) > 0) ?? shops[0];
  return {layout, s, shop, broken};
}

describe('Surface Run planning map: markers on real places', () => {
  it('every marker stands on the real thing it names; every destination is marked with its real name and grid square', () => {
    for (const [host, seed] of [['subway', 7], ['office', 9], ['mall', 13]] as const) {
      const {s} = district(host, seed);
      const g = exploreGridFor(s.extent);
      const m = buildPlanningMap(s, {explore: g, entered: new Set(), player: {x: s.portal.pose.x, z: s.portal.pose.z, yaw: 0}, truck: {x: s.truck.x, z: s.truck.z, yaw: s.truck.yaw}});
      expect(m.markers.length).toBeGreaterThan(10);
      for (const mk of m.markers) {
        expect(refHolds(s, mk.ref, mk.x, mk.z), `${host} ${mk.id} ${mk.kind} ${JSON.stringify(mk.ref)}`).toBe(true);
        expect(mk.grid).toBe(gridRef(m.grid.xs, m.grid.zs, mk.x, mk.z));
      }
      // destinations: each destination building once, at its footprint, with its own name; the depot as the depot
      for (const b of s.buildings.filter(x => x.destination)) {
        const mk = m.markers.filter(k => k.ref.type === 'building' && k.ref.id === b.id && (k.kind === 'destination' || k.kind === 'depot'));
        expect(mk.length).toBe(1);
        expect(mk[0].label).toBe(b.name || (b.id === s.depot.building ? 'Rail depot' : ''));
        const blk = s.blocks.find(q => q.id === b.block)!;
        expect(mk[0].grid, `${host} ${b.name}`).toBe(`${COLS[blk.col]}${blk.row + 1}`); // a grid square = one block
        expect(mk[0].kind).toBe(b.id === s.depot.building ? 'depot' : 'destination');
      }
      // the checkpoint / portal / blocked spans / notes
      expect(m.markers.find(k => k.kind === 'checkpoint')!.ref).toEqual({type: 'checkpoint'});
      expect(m.markers.find(k => k.kind === 'portal')).toMatchObject({x: s.portal.pose.x, z: s.portal.pose.z});
      const blocked = m.markers.filter(k => k.kind === 'blocked');
      expect(blocked.length).toBe(s.streets.reduce((n, q) => n + (q.blocked?.length ?? 0), 0));
      for (const b of blocked) expect(b.ref.type).toBe('street');
      const notes = m.markers.filter(k => k.kind === 'note');
      expect(notes.map(k => k.label)).not.toContain('Off the sheet'); // on no real place: dropped
      const real = s.notes.filter(n => n.text && placeAt(s, n.x, n.z));
      expect(real.length).toBe(s.notes.length - 1); // (every generated note stands on a real place)
      expect(notes.map(k => k.label)).toEqual(real.map(n => n.text));
      // printed street names belong to real streets and sit on their own corridor
      const labelled = m.streets.filter(q => q.label);
      expect(labelled.length).toBeGreaterThan(0);
      for (const st of labelled) {
        expect(s.streets.some(q => q.id === st.id && q.name === st.name)).toBe(true);
        const r = streetRect(st);
        expect(st.label!.x >= r.x0 && st.label!.x <= r.x1 && st.label!.z >= r.z0 && st.label!.z <= r.z1).toBe(true);
      }
    }
  });

  it('reports are derived from real state; a lane report or a live lane key replaces its default family; one on no place is dropped', () => {
    const {s, shop, broken} = district();
    const g = exploreGridFor(s.extent);
    const at = (m: ReturnType<typeof buildPlanningMap>, id: number) => m.markers.filter(k => k.kind === 'report' && k.ref.type === 'building' && k.ref.id === id).map(k => k.label);
    const none = buildPlanningMap(s, {explore: g, entered: new Set()});
    expect(at(none, shop.id)).toEqual([]); // not entered, not explored: nothing
    const reported = depotRecoverables(s, false).map(r => recoverableName(r.kind)); // (re-pin, follow-up lane FIXES: the ONE upgrade a first entry seeds)
    if (reported.length) expect(none.markers.some(k => k.kind === 'report' && k.label === `Train units reported: ${[...new Set(reported)].join(', ')}`)).toBe(true);
    const stats = new Map([[shop.id, {holders: 5, searched: 2, hostiles: 3, down: 3}]]);
    const m = buildPlanningMap(s, {explore: g, entered: new Set([shop.id]), stats});
    const rep = at(m, shop.id);
    expect(rep).toContain('Cleared · Searched 2/5');
    const n = broken(shop.id);
    if (n > 0) expect(rep).toContain(`Broken windows (${n}) — gas gets in`); // its generated broken panes
    else expect(rep.some(l => /Broken windows/.test(l))).toBe(false);
    expect(m.markers.find(k => k.ref.type === 'building' && k.ref.id === shop.id && k.kind === 'destination')!.entered).toBe(true);
    const partial = buildPlanningMap(s, {explore: g, entered: new Set([shop.id]), stats: new Map([[shop.id, {holders: 0, searched: 0, hostiles: 4, down: 1}]])});
    expect(partial.markers.some(k => k.kind === 'report' && k.label === '1 hostile down' && k.tone === 'enemy')).toBe(true);
    // explored (seen from the street) but never entered: only the window report
    const seen = exploreGridFor(s.extent);
    markDisc(seen, centre(shop).x, centre(shop).z, 3);
    expect(at(buildPlanningMap(s, {explore: seen, entered: new Set()}), shop.id)).toEqual(n > 0 ? [`Broken windows (${n}) — gas gets in`] : []);
    // a live lane covering 'windows' (AIR) with nothing to report: no default window report anywhere
    const covered = buildPlanningMap(s, {explore: seen, entered: new Set([shop.id]), stats, replace: ['windows']});
    expect(covered.markers.some(k => /Broken windows/.test(k.label))).toBe(false);
    expect(at(covered, shop.id)).toEqual(['Cleared · Searched 2/5']);
    // lane reports: one replaces the depot default, one on no place is dropped
    const depot = s.buildings.find(b => b.id === s.depot.building)!;
    const lane: MapReportInput[] = [
      {...centre(depot), text: 'Depot: 2 of 5 train units here (route radar, storage chest)', kind: 'supply', source: 'cargo', key: 'recoverables'},
      {x: s.extent.x0 - 500, z: s.extent.z0 - 500, text: 'nowhere', kind: 'info', source: 'test'},
    ];
    const withLane = buildPlanningMap(s, {explore: g, entered: new Set(), reports: lane});
    const labels = withLane.markers.filter(k => k.kind === 'report').map(k => k.label);
    expect(labels).toContain('Depot: 2 of 5 train units here (route radar, storage chest)');
    expect(labels.some(l => /Train units reported/.test(l))).toBe(false); // replaced by the live report
    expect(labels).not.toContain('nowhere');
    for (const mk of withLane.markers) expect(refHolds(s, mk.ref, mk.x, mk.z)).toBe(true);
  });

  it('the live player and truck markers track their poses and headings', () => {
    const {s} = district();
    const g = exploreGridFor(s.extent);
    const C = s.core, cx = (C.x0 + C.x1) / 2, cz = (C.z0 + C.z1) / 2;
    const G = buildPlanningMap(s, {explore: g, entered: new Set()}).grid;
    const at = (p: {x: number; z: number; yaw: number}, t: {x: number; z: number; yaw: number}) => {
      const m = buildPlanningMap(s, {explore: g, entered: new Set(), player: p, truck: t});
      return {p: m.markers.find(k => k.kind === 'player')!, t: m.markers.find(k => k.kind === 'truck')!};
    };
    for (const [p, t] of [[{x: cx - 40, z: cz + 30, yaw: 0.3}, {x: cx + 25, z: cz - 60, yaw: -Math.PI / 2}], [{x: cx + 70, z: cz - 10, yaw: 2}, {x: cx - 5, z: cz + 5, yaw: 1}]] as const) {
      const a = at(p, t);
      expect(a.p).toMatchObject({x: p.x, z: p.z, yaw: p.yaw, label: 'You'});
      expect(a.t).toMatchObject({x: t.x, z: t.z, yaw: t.yaw, label: 'Truck'});
      for (const mk of [a.p, a.t]) { // its grid square holds it
        expect(mk.grid).toBe(gridRef(G.xs, G.zs, mk.x, mk.z));
        const c = COLS.indexOf(mk.grid[0]), r = Number(mk.grid.slice(1)) - 1;
        expect(mk.x >= G.xs[c] && mk.x < G.xs[c + 1] && mk.z >= G.zs[r] && mk.z < G.zs[r + 1]).toBe(true);
      }
    }
    expect(headingDeg(0)).toBeCloseTo(0); // north = up
    expect(headingDeg(-Math.PI / 2)).toBeCloseTo(90); // east = right
    expect(Math.abs(headingDeg(Math.PI))).toBeCloseTo(180);
    const off = buildPlanningMap(s, {explore: g, entered: new Set(), player: {x: s.extent.x0 - 900, z: 0, yaw: 0}, truck: null});
    expect(off.markers.some(k => k.kind === 'player' || k.kind === 'truck')).toBe(false);
  });
});

describe('Surface Run planning map: exploration record', () => {
  it('encodes / decodes exactly, stays far below the save string bound, reads a foreign / malformed record as empty', () => {
    const {s} = district();
    const g = exploreGridFor(s.extent), E = s.extent, W = E.x1 - E.x0, H = E.z1 - E.z0;
    expect(g.cell).toBe(EXPLORE.cell);
    expect(g.w).toBe(Math.ceil(W / EXPLORE.cell));
    expect(g.h).toBe(Math.ceil(H / EXPLORE.cell));
    for (const [x, z, r] of [[E.x0 + W * 0.25, E.z0 + H * 0.7, 22], [E.x0 + W * 0.55, E.z0 + H * 0.4, 9], [E.x0 + 10, E.z0 + 10, 30], [E.x1 - 8, E.z1 - 8, 5]] as const) markDisc(g, x, z, r);
    expect(isExplored(g, E.x0 + W * 0.25, E.z0 + H * 0.7)).toBe(true);
    expect(isExplored(g, E.x0 + W * 0.75, E.z0 + H * 0.12)).toBe(false);
    const rec = writeLifeRecord(g, [4, 2, 4, 9999]);
    expect(rec.x.length).toBeLessThanOrEqual(EXPLORE.maxChars);
    expect(JSON.stringify(rec).length).toBeLessThan(SAVE_LIMITS.stringChars);
    const back = readLifeRecord(JSON.parse(JSON.stringify(rec)), s.extent, s.buildings.length);
    expect(back.restored).toBe(true);
    expect([...back.grid.bits]).toEqual([...g.bits]);
    expect([...back.entered].sort((a, b) => a - b)).toEqual([2, 4]); // (9999: not a building of this layout)
    expect(exploredCount(back.grid)).toBe(exploredCount(g));
    // random round trips
    for (let n = 1; n < 40; n++) { const b = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 255); expect([...decodeBits(encodeBits(b), n)!]).toEqual([...b]); }
    // foreign / malformed
    expect(readLifeRecord({...rec, c: 4}, s.extent, 64).restored).toBe(false);
    expect(readLifeRecord({...rec, x: rec.x.slice(1)}, s.extent, 64).restored).toBe(false);
    expect(readLifeRecord({...rec, x: '!' + rec.x.slice(1)}, s.extent, 64).restored).toBe(false);
    expect(readLifeRecord('nope', s.extent, 64).restored).toBe(false);
    expect(readLifeRecord(undefined, s.extent, 64).restored).toBe(false);
    expect(cellIndex(g, E.x0 - 1, E.z0)).toBe(-1);
    // the fog is exactly the unexplored cells
    const m = buildPlanningMap(s, {explore: g, entered: new Set()});
    expect(m.fog.runs.reduce((n, [, c0, c1]) => n + c1 - c0 + 1, 0)).toBe(g.w * g.h - exploredCount(g));
    expect(m.explored).toBeCloseTo(exploredCount(g) / (g.w * g.h), 9);
  });

  it("the map table is GEN's srMapTable: by its index, else by kind near the read pose, else a reading box at the read pose", () => {
    for (const [host, seed] of [['subway', 7], ['office', 9], ['mall', 13]] as const) {
      const {layout, s} = district(host, seed);
      const r = s.checkpoint.mapTable.read;
      const tp = mapTablePlacement(layout, s);
      expect(tp, host).not.toBeNull();
      expect(tp!.kind).toBe(MAP_TABLE_KIND);
      expect(Math.hypot(tp!.x - r.x, tp!.z - r.z)).toBeLessThan(3); // the reader stands at it
      const saved = s.checkpoint.mapTable.prop;
      s.checkpoint.mapTable.prop = layout.props.findIndex(p => p.kind !== MAP_TABLE_KIND); // a stale index
      expect(mapTablePlacement(layout, s)).toBe(tp);
      s.checkpoint.mapTable.prop = -1; // none yet
      expect(mapTablePlacement(layout, s)).toBe(tp);
      s.checkpoint.mapTable.prop = layout.props.indexOf(tp!); // the real index
      expect(mapTablePlacement(layout, s)).toBe(tp);
      s.checkpoint.mapTable.prop = saved;
      const bare = {...layout, props: layout.props.filter(p => p.kind !== MAP_TABLE_KIND)};
      expect(mapTablePlacement(bare, s)).toBeNull();
      const rt = new SurfaceMapRuntime({} as never);
      expect(rt.tableBox(layout, s)).toEqual({x0: tp!.x - tp!.hx, z0: tp!.z - tp!.hz, x1: tp!.x + tp!.hx, z1: tp!.z + tp!.hz, y0: tp!.y, y1: tp!.y + tp!.h});
      const box = rt.tableBox(bare, s)!; // in front of the reader
      const fx = -Math.sin(r.yaw), fz = -Math.cos(r.yaw);
      expect(box.x0 <= r.x + fx * 0.8 && r.x + fx * 0.8 <= box.x1 && box.z0 <= r.z + fz * 0.8 && r.z + fz * 0.8 <= box.z1).toBe(true);
    }
  });

  it('the runtime explores around the player, records entered buildings in the district memory, restores them on re-entry, opens on [E]', () => {
    const {layout, s, shop} = district();
    const key = surfaceKeyOf({level: 'subway', section: 'main', station: 'st-1'});
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 5, skyways: 6, reactor: 7}, start: key, levels: LEVELS});
    run.current = key;
    const r = s.checkpoint.mapTable.read;
    const states: string[] = [];
    const player = {x: s.portal.pose.x, z: s.portal.pose.z, y: s.portal.pose.y, eye: s.portal.pose.y + 1.6, yaw: 0, pitch: 0, alive: true};
    let area = -1;
    const game = {
      run, layout, player, state: 'playing', zombies: [], containers: null, skywaysCar: null,
      levels: {areaAt: () => area}, scene: {add() {}},
      sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as (() => boolean)[],
      promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: string) => void)[],
      layoutIndexOf: () => undefined, input: {down: () => true, suppressUntilRelease() {}},
      setState(st: string) { this.state = st; states.push(st); for (const f of this.stateListeners) f(st); },
      enterPlay() { this.setState('playing'); return Promise.resolve(); },
    };
    const rt = new SurfaceMapRuntime(game as never).install();
    for (const h of game.sectionHooks) h.build?.(layout);
    expect(rt.grid).not.toBeNull();
    expect(rt.box).toEqual(rt.tableBox(layout, s)); // GEN's table
    expect(isExplored(rt.grid!, player.x, player.z)).toBe(true); // the arrival point at once
    const rec0 = run.laneStore<{x: string}>(SURFACE_LIFE_LANE, key)!;
    expect(rec0.x.length).toBeLessThan(SAVE_LIMITS.stringChars);
    // walk into the shop
    Object.assign(player, centre(shop)); area = shop.areas[0];
    for (const f of game.frameHooks) f(0.5);
    expect(rt.entered.has(shop.id)).toBe(true);
    expect(run.laneStore<{e: number[]}>(SURFACE_LIFE_LANE, key)!.e).toContain(shop.id);
    // leave and come back: restored from the memory
    for (const h of game.sectionHooks) h.teardown?.();
    area = -1;
    player.x = s.portal.pose.x; player.z = s.portal.pose.z;
    for (const h of game.sectionHooks) h.build?.(layout);
    expect(rt.entered.has(shop.id)).toBe(true);
    expect(isExplored(rt.grid!, centre(shop).x, centre(shop).z)).toBe(true);
    expect(rt.counts.restored).toBe(1);
    // [E] at the table: stand at GEN's read pose, looking at the table, a little down
    Object.assign(player, {x: r.x, z: r.z, y: r.y, eye: r.y + 1.6, yaw: r.yaw, pitch: -0.5});
    for (const f of game.frameHooks) f(0.016);
    expect(rt.prompt).toMatch(/planning map/);
    expect(game.interactHandlers.some(h => h())).toBe(true);
    expect(game.state).toBe('map');
    expect(rt.view!.isOpen).toBe(true);
    const shown = rt.view!.svg;
    expect(shown).toContain('YOU');
    expect(shown).toContain(esc(shop.name));
    rt.view!.handleKey({code: 'Escape', key: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {}});
    expect(rt.view!.isOpen).toBe(false);
    expect(game.state).toBe('playing');
    // looking away: no prompt
    player.yaw = r.yaw + Math.PI;
    for (const f of game.frameHooks) f(0.016);
    expect(rt.prompt).toBeNull();
    expect(rayBox({x: 0, y: 1, z: 0}, {x: 1, y: 0, z: 0}, {x0: 2, x1: 3, y0: 0, y1: 2, z0: -1, z1: 1})).toBeCloseTo(2);
  });
});

describe('Surface Run planning map: drawing, keys and no campaign intel', () => {
  it('prints the grid, the real names and notes, fog, truck and YOU; draws the table-top copy', () => {
    const {s} = district('office', 9);
    const g = exploreGridFor(s.extent);
    markDisc(g, s.portal.pose.x, s.portal.pose.z, 40);
    const m = buildPlanningMap(s, {explore: g, entered: new Set(), player: {x: s.portal.pose.x, z: s.portal.pose.z, yaw: 0}, truck: {x: s.truck.x, z: s.truck.z, yaw: 0}});
    const svg = renderPlanningSvg(m);
    expect(svg.startsWith('<svg')).toBe(true);
    for (const c of m.grid.cols) expect(svg).toContain(`>${c}</text>`);
    expect(svg).toContain('YOU');
    expect(svg).toContain('TRUCK');
    expect(svg).toContain('CHECKPOINT');
    // (task studio-surface-map-tent-cab-20261119-025201-01, lane MAP: a long name / note wraps to two lines — read a label's lines as one)
    const shown = svg.replace(/<\/text><text[^>]*>/g, ' ');
    for (const b of s.buildings.filter(x => x.destination && x.name)) expect(shown).toContain(esc(b.name));
    const notes = s.notes.filter(n => n.text && placeAt(s, n.x, n.z));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(shown).toContain(esc(n.text)); // GEN's annotations, as generated
    expect(svg).not.toContain('Off the sheet');
    for (const st of m.streets.filter(q => q.label)) expect(svg).toContain(esc(st.name.toUpperCase()));
    expect((svg.match(/<rect [^>]*height="8"\/>/g) ?? []).length).toBeGreaterThanOrEqual(m.fog.runs.length); // (each fog run one rect)
    const calls: string[] = [];
    const ctx: MapCtx = new Proxy({} as MapCtx, {
      get: (_t, k) => (typeof k === 'string' && ['save', 'restore', 'setTransform', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'fillText'].includes(k) ? (...a: unknown[]) => { calls.push(`${k}:${a.length}`); } : undefined),
      set: () => true,
    });
    const out = drawPlanningCanvas(ctx, m, 1024);
    expect(out.scale).toBeGreaterThan(1);
    expect(calls.filter(c => c.startsWith('fillText')).length).toBeGreaterThan(s.buildings.filter(b => b.destination).length);
  });

  it('keys: Esc / E / Tab close (a fresh press), zoom / fit / pan, everything else is swallowed', () => {
    expect(planningKeyAction({code: 'Escape'})).toEqual({kind: 'close'});
    expect(planningKeyAction({code: 'KeyE'})).toEqual({kind: 'closeKey', code: 'KeyE'});
    expect(planningKeyAction({code: 'Tab', repeat: true})).toEqual({kind: 'swallow'});
    expect(planningKeyAction({code: 'Digit1'})).toEqual({kind: 'swallow'}); // never the hotbar
    expect(planningKeyAction({code: 'KeyF'})).toEqual({kind: 'fit'});
    expect(planningKeyAction({code: 'Equal'})).toEqual({kind: 'zoom', dir: 1});
    expect(planningKeyAction({code: 'ArrowLeft'}).kind).toBe('pan');
    expect(planningKeyAction({code: 'F5'})).toEqual({kind: 'pass'});
  });

  it('no campaign data: the map modules import nothing of the campaign; no network station name reaches the sheet', () => {
    for (const f of ['mapModel', 'mapDraw', 'mapExplore', 'mapView', 'mapRuntime', 'mapSources']) {
      const src = readFileSync(new URL(`../src/world/surface/${f}.ts`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from '[^']*campaign\//);
      expect(src).not.toMatch(/\.campaign\b/);
    }
    const {s} = district('mall', 13);
    const g = exploreGridFor(s.extent);
    const svg = renderPlanningSvg(buildPlanningMap(s, {explore: g, entered: new Set()}));
    const own = JSON.stringify(s); // (a name GEN's own pools also produced is the district's, not campaign intel)
    const names = generateNetwork(424242).nodes.map(n => n.name).filter(n => n.length > 4 && !own.includes(n));
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(svg.includes(esc(n)), n).toBe(false);
  });
});
