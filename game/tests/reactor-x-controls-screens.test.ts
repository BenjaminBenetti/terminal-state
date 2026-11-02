// Task reactor-expansion-20261101 (lane CONTROLS): the instruction boards' text always FITS (user feedback: 'instructions on the
// "Switchgear - control power" sign are slightly cut off, increase sign size'). Every fillText of every Reactor screen — in every restart
// state, on the old 1.6 x 1.0 m board and the new sizes — is measured with a CONSERVATIVE monospace advance (0.62 em: DejaVu Sans Mono
// is 0.602) and must lie inside the canvas; the switchgear board is now 2.2 x 1.3 m on real layouts and stays on a solid wall span. The
// floor-map face's text fits too.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR} from '../src/gen/grid';
import {drawReactorScreen, screenPixels, type ReactorScreenId, type ScreenModel} from '../src/world/reactor/restartScreens';
import {emptyReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {VENT_TOWERS} from '../src/world/reactor/restartWin';
import {drawMapFace} from '../src/world/reactor/mapBoardDraw';
import {MAP_PX, planStoreys, mapMarkers} from '../src/world/reactor/mapBoardPlan';

interface Drawn { s: string; x: number; y: number; px: number; align: string }

/** A recording 2D context: every text with its font size; measureText = 0.62 em per glyph (conservative for the monospace face). */
function recorder(): {ctx: CanvasRenderingContext2D; texts: Drawn[]} {
  const texts: Drawn[] = [];
  const st = {font: '10px monospace', textAlign: 'left'};
  const px = () => parseFloat(/(\d+(?:\.\d+)?)px/.exec(st.font)?.[1] ?? '10');
  const noop = () => {};
  const ctx = {
    set font(v: string) { st.font = v; }, get font() { return st.font; },
    set textAlign(v: string) { st.textAlign = v; }, get textAlign() { return st.textAlign; },
    textBaseline: 'middle', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    measureText: (t: string) => ({width: [...t].length * px() * 0.62}),
    fillText: (s: string, x: number, y: number) => { texts.push({s, x, y, px: px(), align: st.textAlign}); },
    fillRect: noop, strokeRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, closePath: noop,
    save: noop, restore: noop, setLineDash: noop,
  };
  return {ctx: ctx as unknown as CanvasRenderingContext2D, texts};
}

function outside(texts: readonly Drawn[], W: number, H: number): string[] {
  const bad: string[] = [];
  for (const t of texts) {
    const w = [...t.s].length * t.px * 0.62;
    const x0 = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x, x1 = x0 + w;
    if (x0 < 2 - 1e-6 || x1 > W - 2 + 1e-6 || t.y - t.px / 2 < 0 || t.y + t.px / 2 > H) bad.push(`"${t.s}" ${x0.toFixed(0)}..${x1.toFixed(0)} @${t.px}px / ${W}x${H}`);
  }
  return bad;
}

const tiers = [{label: 'Rim', color: 0xd8d4c8, zone: -1}, {label: 'Tier 1', color: 0xd9b23a, zone: 0}, {label: 'Tier 2', color: 0xd9792e, zone: 0},
  {label: 'Tier 3', color: 0xb53a2e, zone: 1}, {label: 'Tier 4', color: 0x7a4ab0, zone: 1}, {label: 'Core floor', color: 0x3aa6a0, zone: 2}];

function states(): ReactorRunState[] {
  const out: ReactorRunState[] = [];
  const s = emptyReactorState(3, 3);
  const push = (f: (q: ReactorRunState) => void) => { f(s); out.push(JSON.parse(JSON.stringify(s))); };
  push(() => {});
  push(q => { q.fuses[0] = true; });
  push(q => { q.fuses[1] = true; });
  push(q => { q.breaker = true; });
  push(q => { q.valve = true; });
  push(q => { q.pump = true; });
  push(q => { q.keyInserted = true; });
  push(q => { q.rods = true; q.restarted = true; q.restartedAt = 10; });
  return out;
}

describe('Reactor instruction screens: no text is cut', () => {
  const ids: ReactorScreenId[] = ['pitBoard', 'switchgearBoard', 'pumpBoard', 'controlMonitor'];
  for (const [w, h] of [[1.6, 1.0], [2.2, 1.3], [2.4, 1.3], [2.5, 1.4], [1.2, 0.7]] as const) {
    it(`${w} x ${h} m boards, every restart state`, () => {
      const {pw, ph} = screenPixels(w, h);
      const bad: string[] = [];
      for (const st of states()) for (const id of ids) for (const towers of [VENT_TOWERS.map(() => 'standby'), VENT_TOWERS.map(() => 'power'), VENT_TOWERS.map(() => 'online')] as const) {
        const m: ScreenModel = {state: st, tiers, zones: [{generator: 0}, {generator: 1}, {generator: 2}], winT: st.restarted ? 5 : null, towers: towers as never, core: 0.5, pumpK: 0.5,
          next: 'Next: find the startup key — Rim control office (it opens the console key switch)'};
        const {ctx, texts} = recorder();
        drawReactorScreen(ctx, id, m, pw, ph);
        for (const b of outside(texts, pw, ph)) bad.push(`${id}: ${b}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('the switchgear instruction board is enlarged on real layouts (2.2 x 1.3 m) on a solid wall span', () => {
    for (const seed of [9100, 218558]) {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}), r = L.reactor!;
      const sc = r.screens.find(s => s.id === 'switchgearBoard')!;
      expect(sc.w).toBeCloseTo(2.2, 6);
      expect(sc.h).toBeCloseTo(1.3, 6);
      const g = L.levels[sc.level].grid, nx = -Math.sin(sc.yaw), nz = -Math.cos(sc.yaw), rx = -nz, rz = nx;
      for (let s = -sc.w / 2 - 0.07; s <= sc.w / 2 + 0.07; s += 0.2) {
        // one side of the plane is the wall (solid), the other the room (floor)
        const a = g.cellOf(sc.x + rx * s + nx * 0.25, sc.z + rz * s + nz * 0.25), b = g.cellOf(sc.x + rx * s - nx * 0.25, sc.z + rz * s - nz * 0.25);
        const ca = g.cells[g.idx(a[0], a[1])], cb = g.cells[g.idx(b[0], b[1])];
        expect((ca === FLOOR) !== (cb === FLOOR), `seed ${seed} span ${s.toFixed(2)}`).toBe(true);
      }
      const floorY = r.tiers.find(t => t.level === sc.level)!.baseY;
      expect(sc.y + sc.h / 2 + 0.12 - floorY).toBeLessThan(Math.min(...Array.from({length: 3}, (_, k) => { const [cx, cy] = g.cellOf(sc.x + nx * (0.3 + k * CELL), sc.z + nz * (0.3 + k * CELL)); return g.ceil[g.idx(cx, cy)] - floorY; })));
    }
  }, 60_000);

  it('the floor-map face: every text inside the canvas on every storey', () => {
    const L = LEVELS.reactor.generate('main', {levelSeed: 9100}), r = L.reactor!;
    const plan = planStoreys(L, r);
    const markers = mapMarkers({info: r, state: emptyReactorState(r.generators.length, r.zones.length), carried: () => 0,
      pickups: id => L.pickups.filter(p => p.itemId === id), levelAt: () => 0});
    const bad: string[] = [];
    for (const storey of plan.storeys) {
      const {ctx, texts} = recorder();
      drawMapFace(ctx, MAP_PX.w, MAP_PX.h, {plan, storey, markers: markers.filter(m => m.level === storey.level), you: {x: 30, z: 30, yaw: 1}, board: null,
        floors: plan.storeys.map(s => ({level: s.level, label: s.label, need: 3, selected: s.level === storey.level, here: s.level === 0}))});
      for (const b of outside(texts, MAP_PX.w, MAP_PX.h)) if (!/YOU ARE HERE|^H|^[A-Z ]+$|^[KFBVPSRG]\d?$/.test(b.split('"')[1])) bad.push(`${storey.label}: ${b}`);
      expect(texts.length).toBeGreaterThan(8);
    }
    expect(bad).toEqual([]);
  }, 60_000);
});
