// Task mall-round2-20261031 (lane RUNTIME, M02): "Elevator has 2 lobby levels. The subway level is incorrectly labeled 'L'".
// CAUSE: gen/mall/elevator.ts authors the mall's stop labels ('S' station, '1' / '2' / '3' retail) and readTowerInfo keeps them on
// every StopInfo, but the label consumers called the Office numbering floorLabel(floor) = floor <= 1 ? 'L' : String(floor), so the
// mall's floors 0 AND 1 both read 'L' on the cab buttons (+ ids, braille), the landing call ids / lantern keys, the live floor
// indicator, the HUD prompts ('Lobby (L)') and the QA readout — and the button atlas had no 'S' / '1' cell at all.
// FIX: every consumer reads the stop's own label (towerShared stopLabel / StopInfo.label); the atlas gains 'S' / '1' in free cells.
// Physical stops, destinations, doors and collision are untouched; the Office (labels L / 2..8 === floorLabel) is unchanged.

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {mallFixture} from './helpers/mallFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildElevatorView, buttonGlyphCells, indicatorState, planElevator} from '../src/world/elevator';
import {floorLabel, readTowerInfo, stopLabel} from '../src/world/towerShared';
import {mallTowerRecord} from '../src/gen/mall/elevator';
import {levelsOf} from '../src/gen/levels';
import {WarmupRegistry} from '../src/render/warmup';
import {markShadows} from '../src/render/volumetric';
import {installTower, type TowerHost} from '../src/world/towerRuntime';
import {towerQaApi} from '../src/world/towerQa';
import {Player} from '../src/player/player';
import {PickupManager} from '../src/world/pickups';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** The Office's v2 record shape (labels as gen/office/index.ts authors them: 'L', then the floor number). */
const OFFICE = {
  seed: 4242, grid: {w: 1, h: 1}, levels: [1, 2, 3, 4].map(f => ({id: f, baseY: 5.6 + 4.4 * (f - 1), grid: {w: 1, h: 1}})),
  office: {
    version: 2, floors: [1, 2, 3, 4], floorHeight: 4.4, groundY: 5.6,
    storeys: [1, 2, 3, 4].map(f => ({floor: f, levelId: f, baseY: 5.6 + 4.4 * (f - 1), label: f === 1 ? 'L' : String(f), clear: f === 1 ? 4 : 2.9})),
    elevator: {
      cab: {x0: 10, z0: 10, x1: 12.5, z1: 12}, shaft: {x0: 9.5, z0: 9.5, x1: 13, z1: 12.5}, doorSide: 'N', door: {x: 11.25, z: 10, width: 1.5}, cabHeight: 2.6,
      panel: {x: 12.2, dy: 1.2, z: 10.02},
      stops: [1, 2, 3, 4].map(f => ({floor: f, levelId: f, y: 5.6 + 4.4 * (f - 1), area: -1, callPanel: {x: 12.6, y: 5.6 + 4.4 * (f - 1) + 1.2, z: 9.5}, landing: {x: 11.25, z: 8.6}})),
    },
    windows: [], exterior: {x0: 0, z0: 0, x1: 30, z1: 25}, stairs: {well: null, landings: []}, name: 'T',
  },
};

let cached: StationLayout | null = null;
const mall = (): StationLayout => (cached ??= mallFixture().layout);

describe('elevator stop labels: the mall station is S, the retail floors 1 / 2 / 3; the Office keeps L / 2..8', () => {
  it('the mall record: four physical stops (station + 3 retail floors) with distinct labels S / 1 / 2 / 3, no second "L"', () => {
    const layout = mall();
    const info = readTowerInfo(layout)!;
    const st = info.elevator!.stops;
    expect(st.map(s => s.floor)).toEqual([0, 1, 2, 3]);
    expect(st.map(s => s.label)).toEqual(['S', '1', '2', '3']);
    expect(st.map(s => s.name)).toEqual(['Subway', 'Level 1', 'Level 2', 'Level 3']);
    // the base numbering would have read L, L, 2, 3 (the "two lobby levels")
    expect(st.map(s => floorLabel(s.floor))).toEqual(['L', 'L', '2', '3']);
    expect(st.map(s => stopLabel(st, s.floor))).toEqual(['S', '1', '2', '3']);
    // physical stops unchanged: each stop at its storey's floor (the record's storeys = layout.mall.storeys), landings / panels per stop
    const rec = mallTowerRecord(layout)!;
    const storeys = layout.mall!.storeys;
    for (const s of st) {
      expect(s.y).toBe(storeys.find(q => q.level === s.floor)!.baseY);
      expect(s.levelId).toBe(s.floor);
    }
    expect((rec.elevator as {stops: {y: number}[]}).stops.map(s => s.y)).toEqual(st.map(s => s.y));
  });

  it('cab buttons, landing call buttons and lanterns use the stop labels; every label has its own atlas cell', () => {
    const info = readTowerInfo(mall())!;
    const plan = planElevator(info.elevator!);
    expect(plan.carButtons.map(b => b.id)).toEqual(['car-S', 'car-1', 'car-2', 'car-3', 'car-open', 'car-close', 'car-alarm']);
    expect(plan.carButtons.filter(b => b.kind === 'floor').map(b => [b.glyph, b.floor, b.stop])).toEqual([['S', 0, 0], ['1', 1, 1], ['2', 2, 2], ['3', 3, 3]]);
    expect(plan.hallButtons.map(l => l.map(b => b.id))).toEqual([['hall-S-up'], ['hall-1-up', 'hall-1-down'], ['hall-2-up', 'hall-2-down'], ['hall-3-down']]);
    // destinations: a floor button / call targets its own physical stop
    for (const b of plan.buttons) if (b.stop >= 0) expect(info.elevator!.stops[b.stop].floor).toBe(b.floor);
    const ids = plan.buttons.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some(id => /-L(-|$)/.test(id))).toBe(false);
    // the atlas: every glyph its own cells (no fallback to cell 0 = 'L'), cells never shared, label / flat cells untouched
    const cells = buttonGlyphCells();
    const byGlyph = new Map(cells.map(c => [c.glyph, c]));
    for (const g of ['S', '1', '2', '3']) expect(byGlyph.has(g), `atlas glyph ${g}`).toBe(true);
    const used = cells.flatMap(c => [c.unlit, c.lit]);
    expect(new Set(used).size).toBe(used.length);
    for (const c of used) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(64); expect([48, 49, 50, 51, 52, 53, 56, 57, 58, 59]).not.toContain(c); }
    expect(byGlyph.get('S')!.unlit).not.toBe(byGlyph.get('L')!.unlit);
    expect(byGlyph.get('1')!.unlit).not.toBe(byGlyph.get('L')!.unlit);
    // the view: lantern overlays keyed by the stop labels, lit overlays per button id
    const view = buildElevatorView(plan, mats, {glass: true});
    for (const k of ['lantern-S-up', 'lantern-S-down', 'lantern-1-up', 'lantern-3-down', 'car-S', 'car-1', 'hall-S-up', 'hall-1-down']) expect(view.lit.has(k), k).toBe(true);
    expect([...view.lit.keys()].some(k => /-L-|-L$/.test(k))).toBe(false);
  });

  it('the live runtime: indicator S at the station, S -> 1 -> 2 -> 3 on a ride, prompts "Subway (S)" / "Level 1", QA readout by label', () => {
    const layout = mall();
    const P = new Player();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
    scene.add(camera);
    const host = {
      scene, camera, player: P, zombies: [], levels: levelsOf(layout as never), layout, mats, sfx: null,
      hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(),
      atmosphere: {markShadows: (root: THREE.Object3D, s: boolean) => { markShadows(root, true, s); }},
      interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
      sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
      stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
      state: 'playing', warming: false, prepareBeforeShow: async () => {},
      pickups: new PickupManager({}), world: {culler: {enabled: true, register: vi.fn()}},
      travel: vi.fn(async () => ({ok: true})), setState: vi.fn(), fade: vi.fn(),
    };
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!, stops = e.plan.info.stops;
    // the cab waits at the station stop: the indicator shows S (was 'L')
    expect(e.logic.floor).toBe(0);
    expect(indicatorState().last).toBe('S|0');
    // prompts name the mall's storeys (the Office wording stays 'Lobby (L)' / 'Floor n', below)
    expect(e.prompts.get('car-S')![0]).toMatch(/Subway \(S\)$/);
    expect(e.prompts.get('car-1')![0]).toMatch(/Level 1$/);
    expect(e.prompts.get('car-3')![2]).toMatch(/Level 3 · here/);
    expect([...e.prompts.values()].flat().some(t => /Lobby/.test(t))).toBe(false);
    const qa = towerQaApi({tower: rt, player: P, camera, levels: host.levels});
    expect(qa.liftState()).toMatchObject({elevator: true, floor: 'S', indicator: 'S|0'});
    expect((qa.tower() as {stops: {label: string}[]}).stops.map(s => s.label)).toEqual(['S', '1', '2', '3']);
    // call it to the top landing: the indicator steps through every stop label on the way and stops on 3 (same physical stops)
    P.spawn(stops[0].landing.x, stops[0].landing.z, 0, stops[0].y);
    expect(rt.callFloor(3)).toBe(true);
    expect(qa.liftState()).toMatchObject({queue: ['3']});
    const seen: string[] = [];
    for (let i = 0; i < 60 * 40 && !(e.logic.y === stops[3].y && !e.logic.moving); i++) {
      for (const f of host.frameHooks) f(1 / 60);
      const t = indicatorState().last.split('|')[0];
      if (seen[seen.length - 1] !== t) seen.push(t);
    }
    expect(e.logic.y).toBe(stops[3].y);
    expect(seen).toEqual(['S', '1', '2', '3']);
    expect(qa.liftState()).toMatchObject({floor: '3'});
    expect(host.travel).not.toHaveBeenCalled();
  });

  it('the Office is unchanged: L / 2..n ids, lanterns and glyph cells; a record without labels still numbers L / 2..', () => {
    const info = readTowerInfo(OFFICE as never)!;
    const st = info.elevator!.stops;
    expect(st.map(s => s.label)).toEqual(['L', '2', '3', '4']);
    expect(st.every(s => s.name === undefined)).toBe(true);
    expect(st.map(s => s.label)).toEqual(st.map(s => floorLabel(s.floor))); // the Office labels ARE the old numbering
    const plan = planElevator(info.elevator!);
    expect(plan.carButtons.map(b => b.id)).toEqual(['car-L', 'car-2', 'car-3', 'car-4', 'car-open', 'car-close', 'car-alarm']);
    expect(plan.hallButtons.map(l => l.map(b => b.id))).toEqual([['hall-L-up'], ['hall-2-up', 'hall-2-down'], ['hall-3-up', 'hall-3-down'], ['hall-4-down']]);
    // the Office glyphs keep their atlas cells (L / 2..15 then the symbols: cells 0.. and lit 24..)
    const cells = new Map(buttonGlyphCells().map(c => [c.glyph, c]));
    ['L', '2', '3', '4', '5', '6', '7', '8'].forEach((g, i) => expect([cells.get(g)!.unlit, cells.get(g)!.lit]).toEqual([i, 24 + i]));
    ['open', 'close', 'alarm', 'up', 'down', 'key', 'lantern-up', 'lantern-down'].forEach((g, i) => expect(cells.get(g)!.unlit).toBe(15 + i));
    const view = buildElevatorView(plan, mats, {});
    for (const k of ['lantern-L-up', 'lantern-4-down', 'car-L', 'hall-L-up']) expect(view.lit.has(k), k).toBe(true);
    // a record without storey labels: the numbering fallback (as before)
    const bare = JSON.parse(JSON.stringify(OFFICE));
    for (const s of bare.office.storeys) delete s.label;
    expect(readTowerInfo(bare)!.elevator!.stops.map(s => s.label)).toEqual(['L', '2', '3', '4']);
    expect(stopLabel([], 1)).toBe('L');
    expect(stopLabel([], 6)).toBe('6');
  });
});
