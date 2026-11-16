// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE CHECKPOINT'S PLANNING MAP (world/surface/map*.ts) on a real
// district layout (LEVELS.<host>.generate('surface')), with fixture streets / notes / window spans where the layout has none yet:
//  - every marker stands on the real thing its ref names (a building, a street, a block, the checkpoint, the portal); every destination
//    building is marked with its real name and grid square; a note / report on no real place is never printed;
//  - reports are derived from real state (entered, searched holders, interior enemies down, broken windows explored, the depot's units;
//    a lane report replaces its default family);
//  - the exploration record: encode / decode round trip, a bounded string (SAVE_LIMITS.stringChars), malformed / foreign records read
//    empty; the runtime writes it to the district memory on change and restores it on re-entry;
//  - the live player / truck markers track their poses and headings;
//  - no campaign data: the map modules import nothing of the campaign, and no network station name reaches the printed sheet;
//  - the overlay's keys (Esc / E / Tab close, nothing else reaches the game) and the [E] at the map table opening it in the 'map' state.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {surfaceKeyOf} from '../src/gen/surface/surfaceRun';
import {SURFACE_FRAME} from '../src/gen/surface/index';
import {SAVE_LIMITS} from '../src/save/validate';
import {createRun} from '../src/run/runState';
import {generateNetwork} from '../src/campaign/network';
import {
  EXPLORE, SURFACE_LIFE_LANE, cellIndex, decodeBits, encodeBits, exploreGridFor, exploredCount, isExplored, markDisc, readLifeRecord, writeLifeRecord,
} from '../src/world/surface/mapExplore';
import {buildPlanningMap, gridRef, placeAt, refHolds, streetRect, type MapReportInput} from '../src/world/surface/mapModel';
import {drawPlanningCanvas, headingDeg, renderPlanningSvg, type MapCtx} from '../src/world/surface/mapDraw';
import {planningKeyAction} from '../src/world/surface/mapView';
import {SurfaceMapRuntime, rayBox} from '../src/world/surface/mapRuntime';

/** A district with fixture streets (the frame's block lines), notes, a blocked span and broken shop windows where GEN gave none. */
function fixture(host: 'subway' | 'office' | 'mall' = 'subway', seed = 7): {layout: StationLayout; s: SurfaceInfo} {
  const layout = LEVELS[host].generate('surface', {levelSeed: seed}) as StationLayout;
  const s = layout.surface as SurfaceInfo;
  const F = SURFACE_FRAME, line = (i: number) => F.margin + i * F.pitch, size = 2 * F.margin + F.blocks * F.pitch;
  if (!s.streets.length) {
    let id = 0;
    for (let i = 0; i <= F.blocks; i++) {
      s.streets.push({id: id++, name: `${['Calder', 'Halsey', 'Mercer', 'Dunmore', 'Orchard', 'Lyle', 'Pike', 'Garnet', 'Union'][i]} Street`, ax: line(i), az: F.margin, bx: line(i), bz: size - F.margin, width: F.street - 2 * F.sidewalk, sidewalk: F.sidewalk, rank: i === 4 ? 'avenue' : 'street'});
      s.streets.push({id: id++, name: `${['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'][i]} Avenue`, ax: F.margin, az: line(i), bx: size - F.margin, bz: line(i), width: F.street - 2 * F.sidewalk, sidewalk: F.sidewalk, rank: 'avenue'});
    }
    s.streets[4].blocked = [{x0: line(2) - 5, z0: line(3) + 20, x1: line(2) + 5, z1: line(3) + 28}]; // (street 4: the north-south one on line 2)
  }
  const shop = s.buildings.find(b => b.destination && b.id !== s.depot.building)!;
  if (!s.notes.length) {
    const c = {x: (shop.footprint.x0 + shop.footprint.x1) / 2, z: (shop.footprint.z0 + shop.footprint.z1) / 2};
    s.notes.push({x: c.x, z: c.z, text: 'Pharmacy looted', kind: 'supply'});
    s.notes.push({x: line(3), z: line(4) + 30, text: 'Gas pooling — mask up', kind: 'hazard'});
    s.notes.push({x: -60, z: -60, text: 'Off the sheet', kind: 'info'}); // on no real place: never printed
  }
  if (!s.windows.length) s.windows.push({id: `w${shop.id}`, building: shop.id, level: 0, x0: shop.footprint.x0, z0: shop.footprint.z1 - 0.5, x1: shop.footprint.x1, z1: shop.footprint.z1, side: 'S', sill: 0.4, head: 2.6, panes: ['intact', 'broken', 'broken', 'cracked'], room: shop.areas[0] ?? 0, shop: true});
  return {layout, s};
}

describe('Surface Run planning map: markers on real places', () => {
  it('every marker stands on the real thing it names; every destination is marked with its real name and grid square', () => {
    const {s} = fixture();
    const g = exploreGridFor(s.extent);
    const m = buildPlanningMap(s, {explore: g, entered: new Set(), player: {x: s.portal.pose.x, z: s.portal.pose.z, yaw: 0}, truck: {x: s.truck.x, z: s.truck.z, yaw: s.truck.yaw}});
    expect(m.markers.length).toBeGreaterThan(10);
    for (const mk of m.markers) {
      expect(refHolds(s, mk.ref, mk.x, mk.z), `${mk.id} ${mk.kind} ${JSON.stringify(mk.ref)}`).toBe(true);
      expect(mk.grid).toBe(gridRef(m.grid.xs, m.grid.zs, mk.x, mk.z));
    }
    // destinations: each destination building once, at its footprint, with its own name; the depot as the depot
    for (const b of s.buildings.filter(x => x.destination)) {
      const mk = m.markers.filter(k => k.ref.type === 'building' && k.ref.id === b.id && (k.kind === 'destination' || k.kind === 'depot'));
      expect(mk.length).toBe(1);
      expect(mk[0].label).toBe(b.name);
      const blk = s.blocks.find(q => q.id === b.block)!;
      expect(mk[0].grid).toBe(`${'ABCDEFGHJKLMNPQRSTUVWXYZ'[blk.col]}${blk.row + 1}`); // a grid square = one block
      expect(mk[0].kind).toBe(b.id === s.depot.building ? 'depot' : 'destination');
    }
    // the checkpoint / portal / blocked span / notes
    expect(m.markers.find(k => k.kind === 'checkpoint')!.ref).toEqual({type: 'checkpoint'});
    expect(m.markers.find(k => k.kind === 'portal')).toMatchObject({x: s.portal.pose.x, z: s.portal.pose.z});
    const blocked = m.markers.filter(k => k.kind === 'blocked');
    expect(blocked.length).toBe(s.streets.reduce((n, q) => n + (q.blocked?.length ?? 0), 0));
    for (const b of blocked) expect(b.ref.type).toBe('street');
    const notes = m.markers.filter(k => k.kind === 'note');
    expect(notes.map(k => k.label)).not.toContain('Off the sheet'); // on no real place: dropped
    expect(notes.length).toBe(s.notes.filter(n => placeAt(s, n.x, n.z)).length);
    // printed street names belong to real streets and sit on their own corridor
    const labelled = m.streets.filter(q => q.label);
    expect(labelled.length).toBeGreaterThan(0);
    for (const st of labelled) {
      expect(s.streets.some(q => q.id === st.id && q.name === st.name)).toBe(true);
      expect(placeAt(s, st.label!.x, st.label!.z)?.type === 'street' || placeAt(s, st.label!.x, st.label!.z)?.type === 'checkpoint').toBe(true);
      const r = streetRect(st);
      expect(st.label!.x >= r.x0 && st.label!.x <= r.x1 && st.label!.z >= r.z0 && st.label!.z <= r.z1).toBe(true);
    }
  });

  it('reports are derived from real state; a lane report replaces its default family; one on no place is dropped', () => {
    const {s} = fixture();
    const g = exploreGridFor(s.extent);
    const shop = s.buildings.find(b => b.destination && b.id !== s.depot.building)!;
    const none = buildPlanningMap(s, {explore: g, entered: new Set()});
    expect(none.markers.filter(k => k.kind === 'report' && k.ref.type === 'building' && k.ref.id === shop.id)).toEqual([]); // not entered, not explored: nothing
    expect(none.markers.some(k => k.kind === 'report' && /Train units reported/.test(k.label))).toBe(true); // the depot's units (layout record)
    const stats = new Map([[shop.id, {holders: 5, searched: 2, hostiles: 3, down: 3}]]);
    const m = buildPlanningMap(s, {explore: g, entered: new Set([shop.id]), stats});
    const rep = m.markers.filter(k => k.kind === 'report' && k.ref.type === 'building' && k.ref.id === shop.id).map(k => k.label);
    expect(rep).toContain('Cleared · Searched 2/5');
    expect(rep.some(l => /^Broken windows \(2\)/.test(l))).toBe(true); // the two broken panes of its span
    expect(m.markers.find(k => k.ref.type === 'building' && k.ref.id === shop.id && k.kind === 'destination')!.entered).toBe(true);
    const partial = buildPlanningMap(s, {explore: g, entered: new Set([shop.id]), stats: new Map([[shop.id, {holders: 0, searched: 0, hostiles: 4, down: 1}]])});
    expect(partial.markers.some(k => k.kind === 'report' && k.label === '1 hostile down' && k.tone === 'enemy')).toBe(true);
    const depot = s.buildings.find(b => b.id === s.depot.building)!;
    const lane: MapReportInput[] = [
      {x: (depot.footprint.x0 + depot.footprint.x1) / 2, z: (depot.footprint.z0 + depot.footprint.z1) / 2, text: '2 units at the depot · 1 on the truck', kind: 'supply', source: 'cargo', key: 'recoverables'},
      {x: -500, z: -500, text: 'nowhere', kind: 'info', source: 'test'},
    ];
    const withLane = buildPlanningMap(s, {explore: g, entered: new Set(), reports: lane});
    const labels = withLane.markers.filter(k => k.kind === 'report').map(k => k.label);
    expect(labels).toContain('2 units at the depot · 1 on the truck');
    expect(labels.some(l => /Train units reported/.test(l))).toBe(false); // replaced by the live report
    expect(labels).not.toContain('nowhere');
    for (const mk of withLane.markers) expect(refHolds(s, mk.ref, mk.x, mk.z)).toBe(true);
  });

  it('the live player and truck markers track their poses and headings', () => {
    const {s} = fixture();
    const g = exploreGridFor(s.extent);
    const at = (p: {x: number; z: number; yaw: number}, t: {x: number; z: number; yaw: number}) => {
      const m = buildPlanningMap(s, {explore: g, entered: new Set(), player: p, truck: t});
      return {p: m.markers.find(k => k.kind === 'player')!, t: m.markers.find(k => k.kind === 'truck')!};
    };
    const a = at({x: 200, z: 300, yaw: 0.3}, {x: 150, z: 390, yaw: -Math.PI / 2});
    expect(a.p).toMatchObject({x: 200, z: 300, yaw: 0.3});
    expect(a.t).toMatchObject({x: 150, z: 390, yaw: -Math.PI / 2});
    const b = at({x: 260, z: 140, yaw: 2}, {x: 300, z: 200, yaw: 1});
    expect(b.p).toMatchObject({x: 260, z: 140, yaw: 2});
    expect(b.t).toMatchObject({x: 300, z: 200});
    const G = buildPlanningMap(s, {explore: g, entered: new Set()}).grid;
    expect(b.p.grid).toBe(gridRef(G.xs, G.zs, 260, 140));
    expect(b.p.grid).toBe('D3'); // (x 260: between the x 200 / 264 street lines = column D; z 140: between 136 / 200 = row 3)
    expect(headingDeg(0)).toBeCloseTo(0); // north = up
    expect(headingDeg(-Math.PI / 2)).toBeCloseTo(90); // east = right
    expect(Math.abs(headingDeg(Math.PI))).toBeCloseTo(180);
    const off = buildPlanningMap(s, {explore: g, entered: new Set(), player: {x: -900, z: 0, yaw: 0}, truck: null});
    expect(off.markers.some(k => k.kind === 'player' || k.kind === 'truck')).toBe(false);
  });
});

describe('Surface Run planning map: exploration record', () => {
  it('encodes / decodes exactly, stays far below the save string bound, reads a foreign / malformed record as empty', () => {
    const {s} = fixture();
    const g = exploreGridFor(s.extent);
    expect(g.cell).toBe(EXPLORE.cell);
    expect(g.w).toBe(Math.ceil((s.extent.x1 - s.extent.x0) / EXPLORE.cell));
    for (const [x, z, r] of [[140, 390, 22], [300, 200, 9], [10, 10, 30], [520, 520, 5]] as const) markDisc(g, x, z, r);
    expect(isExplored(g, 140, 390)).toBe(true);
    expect(isExplored(g, 400, 60)).toBe(false);
    const rec = writeLifeRecord(g, [4, 2, 4, 999]);
    expect(rec.x.length).toBeLessThan(SAVE_LIMITS.stringChars);
    expect(JSON.stringify(rec).length).toBeLessThan(1200);
    const back = readLifeRecord(JSON.parse(JSON.stringify(rec)), s.extent, s.buildings.length);
    expect(back.restored).toBe(true);
    expect([...back.grid.bits]).toEqual([...g.bits]);
    expect([...back.entered].sort((a, b) => a - b)).toEqual([2, 4]); // (999: not a building of this layout)
    expect(exploredCount(back.grid)).toBe(exploredCount(g));
    // random round trips
    for (let n = 1; n < 40; n++) { const b = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 255); expect([...decodeBits(encodeBits(b), n)!]).toEqual([...b]); }
    // foreign / malformed
    expect(readLifeRecord({...rec, c: 4}, s.extent, 64).restored).toBe(false);
    expect(readLifeRecord({...rec, x: rec.x.slice(1)}, s.extent, 64).restored).toBe(false);
    expect(readLifeRecord({...rec, x: '!' + rec.x.slice(1)}, s.extent, 64).restored).toBe(false);
    expect(readLifeRecord('nope', s.extent, 64).restored).toBe(false);
    expect(readLifeRecord(undefined, s.extent, 64).restored).toBe(false);
    expect(cellIndex(g, -1, 0)).toBe(-1);
    // the fog is exactly the unexplored cells
    const m = buildPlanningMap(s, {explore: g, entered: new Set()});
    expect(m.fog.runs.reduce((n, [, c0, c1]) => n + c1 - c0 + 1, 0)).toBe(g.w * g.h - exploredCount(g));
    expect(m.explored).toBeCloseTo(exploredCount(g) / (g.w * g.h), 9);
  });

  it('the runtime explores around the player, records entered buildings in the district memory, restores them on re-entry, opens on [E]', () => {
    const {layout, s} = fixture();
    const key = surfaceKeyOf({level: 'subway', section: 'main', station: 'st-1'});
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 5, skyways: 6, reactor: 7}, start: key, levels: LEVELS});
    run.current = key;
    const shop = s.buildings.find(b => b.destination && b.id !== s.depot.building && b.areas.length)!;
    // the map table: a placement at the read pose's table (lane KIT's srMapTable stand-in)
    const r = s.checkpoint.mapTable.read;
    layout.props.push({kind: 'table', x: r.x, z: r.z - 1, y: 0, rot: 0, area: s.checkpoint.area, hx: 0.9, hz: 0.6, h: 0.78} as never);
    s.checkpoint.mapTable.prop = layout.props.length - 1;
    const states: string[] = [];
    const player = {x: s.portal.pose.x, z: s.portal.pose.z, y: 0, eye: 1.6, yaw: 0, pitch: 0, alive: true};
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
    expect(isExplored(rt.grid!, player.x, player.z)).toBe(true); // the arrival point at once
    const rec0 = run.laneStore<{x: string}>(SURFACE_LIFE_LANE, key)!;
    expect(rec0.x.length).toBeLessThan(SAVE_LIMITS.stringChars);
    // walk into the shop
    player.x = (shop.footprint.x0 + shop.footprint.x1) / 2; player.z = (shop.footprint.z0 + shop.footprint.z1) / 2; area = shop.areas[0];
    for (const f of game.frameHooks) f(0.5);
    expect(rt.entered.has(shop.id)).toBe(true);
    expect(run.laneStore<{e: number[]}>(SURFACE_LIFE_LANE, key)!.e).toContain(shop.id);
    // leave and come back: restored from the memory
    for (const h of game.sectionHooks) h.teardown?.();
    area = -1;
    player.x = s.portal.pose.x; player.z = s.portal.pose.z;
    const rt2 = rt; // the same installed runtime
    for (const h of game.sectionHooks) h.build?.(layout);
    expect(rt2.entered.has(shop.id)).toBe(true);
    expect(isExplored(rt2.grid!, (shop.footprint.x0 + shop.footprint.x1) / 2, (shop.footprint.z0 + shop.footprint.z1) / 2)).toBe(true);
    expect(rt2.counts.restored).toBe(1);
    // [E] at the table: stand at the read pose looking at it
    player.x = r.x; player.z = r.z + 0.2; player.yaw = 0; player.pitch = -0.6; area = -1;
    for (const f of game.frameHooks) f(0.016);
    expect(rt2.prompt).toMatch(/planning map/);
    expect(game.interactHandlers.some(h => h())).toBe(true);
    expect(game.state).toBe('map');
    expect(rt2.view!.isOpen).toBe(true);
    const shown = rt2.view!.svg;
    expect(shown).toContain('YOU');
    expect(shown).toContain(shop.name);
    rt2.view!.handleKey({code: 'Escape', key: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {}});
    expect(rt2.view!.isOpen).toBe(false);
    expect(game.state).toBe('playing');
    // looking away: no prompt
    player.yaw = Math.PI;
    for (const f of game.frameHooks) f(0.016);
    expect(rt2.prompt).toBeNull();
    expect(rayBox({x: 0, y: 1, z: 0}, {x: 1, y: 0, z: 0}, {x0: 2, x1: 3, y0: 0, y1: 2, z0: -1, z1: 1})).toBeCloseTo(2);
  });
});

describe('Surface Run planning map: drawing, keys and no campaign intel', () => {
  it('prints the grid, names, notes, fog, truck and YOU; draws the table-top copy', () => {
    const {s} = fixture('office', 9);
    const g = exploreGridFor(s.extent);
    markDisc(g, s.portal.pose.x, s.portal.pose.z, 40);
    const m = buildPlanningMap(s, {explore: g, entered: new Set(), player: {x: s.portal.pose.x, z: s.portal.pose.z, yaw: 0}, truck: {x: s.truck.x, z: s.truck.z, yaw: 0}});
    const svg = renderPlanningSvg(m);
    expect(svg.startsWith('<svg')).toBe(true);
    for (const c of m.grid.cols) expect(svg).toContain(`>${c}</text>`);
    expect(svg).toContain('YOU');
    expect(svg).toContain('TRUCK');
    expect(svg).toContain('CHECKPOINT');
    for (const b of s.buildings.filter(x => x.destination)) expect(svg).toContain(b.name.replace(/&/g, '&amp;'));
    expect(svg).toContain('Pharmacy looted');
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
    for (const f of ['mapModel', 'mapDraw', 'mapExplore', 'mapView', 'mapRuntime']) {
      const src = readFileSync(new URL(`../src/world/surface/${f}.ts`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from '[^']*campaign\//);
      expect(src).not.toMatch(/\.campaign\b/);
    }
    const {s} = fixture('mall', 13);
    const g = exploreGridFor(s.extent);
    const svg = renderPlanningSvg(buildPlanningMap(s, {explore: g, entered: new Set()}));
    const net = generateNetwork(424242);
    const names = net.nodes.map(n => n.name).filter(n => n.length > 4 && !s.buildings.some(b => b.name.includes(n)) && !s.name.includes(n));
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(svg.includes(n), n).toBe(false);
  });
});
