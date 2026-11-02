// Task reactor-expansion-20261101 (lane MINES): the mines DRESS hook on fixture slots through the index.ts pipeline in miniature (crop +
// one station dresser pass + the hook + applyLighting): reachability kept (no pockets), the generator's stand point clear, the root
// CLAUDE.md prop rules (classified kinds, storage opens, grounded under the ceiling), the set pieces (hoist winch + winze, ore carts on
// the rail line, drill jumbo, cribs, rubble), fixtures / plates inside their bands and out of every doorway, the rail line, time.
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, type Grid} from '../src/gen/grid';
import {doorwayIssues} from '../src/gen/doorways';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import type {StationLayout} from '../src/gen/stationTypes';
import {MINE_PIECE, MINE_PIECE_OF, MINE_PIECE_SIZE, MINES_DRESS_STATS, alongPolyline, minesRailWorld} from '../src/gen/reactor/complex/minesDress';
import {minesFixture, minesLayout, FIX, type MinesFixture} from './reactor-x-mines-fixture';
import {MINES_ANCHORS, MINES_FIT, minesModelSize} from '../src/world/reactor/minesAssets';
import {planMinesVisuals} from '../src/world/reactor/minesVisuals';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const INWARD = ['S', 'E', 'N', 'W'] as const;
const built = new Map<string, {fx: MinesFixture; L: StationLayout; ms: number}>();
const get = (seed: number, inward: typeof INWARD[number]) => {
  const key = `${seed}${inward}`;
  let b = built.get(key);
  if (!b) { const fx = minesFixture(seed, {inward}); const L = minesLayout(fx, seed); b = {fx, L, ms: MINES_DRESS_STATS.ms}; built.set(key, b); }
  return b;
};
const cases = () => SEEDS.map((s, i) => [s, INWARD[i % 4]] as const);

function flood(g: Grid, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(g.w * g.h), st = [g.idx(sx, sy)];
  seen[st[0]] = 1;
  while (st.length) {
    const i = st.pop()!, x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = g.idx(x + dx, y + dy);
      if (!g.inBounds(x + dx, y + dy) || seen[j] || g.cells[j] !== FLOOR || g.blocked[j]) continue;
      seen[j] = 1; st.push(j);
    }
  }
  return seen;
}

describe('Reactor mines complex — dress (lane MINES)', () => {
  it('keeps every walkable cell of the workings reachable from the deck and the generator stand point clear', () => {
    for (const [seed, inward] of cases()) {
      const {fx, L} = get(seed, inward), g = L.levels[FIX.level].grid, c = fx.carve!;
      const seen = flood(g, fx.deck.x + 1, fx.deck.y + 1);
      let bad = 0;
      for (const id of c.areas) { const a = L.areas[id]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = g.idx(x, y); if (g.cells[i] === FLOOR && !g.blocked[i] && !seen[i]) bad++; } }
      expect(bad, `${seed} ${inward}: unreachable cells`).toBe(0);
      const ux = c.generator.use.x * CELL, uz = c.generator.use.y * CELL;
      expect(g.circleClear(ux, uz, 0.3), `${seed} ${inward} use point clear`).toBe(true);
      expect(seen[g.idx(Math.floor(c.generator.use.x), Math.floor(c.generator.use.y))]).toBe(1);
    }
  });

  it('places the mine set pieces: the hoist winch over its winze, ore carts on the rail line, the drill jumbo, cribs, the rubble', () => {
    let hoists = 0;
    for (const [seed, inward] of cases()) {
      const {fx, L} = get(seed, inward), mine = new Set(fx.carve!.areas);
      const pieces = L.props.filter(p => p.kind === 'annexMachine' && MINE_PIECE_OF[p.variant]);
      for (const p of pieces) { expect(mine.has(p.area)).toBe(true); expect(p.level).toBe(FIX.level); expect(p.y).toBeCloseTo(FIX.baseY, 3); }
      const n = (id: keyof typeof MINE_PIECE) => pieces.filter(p => p.variant === MINE_PIECE[id]).length;
      if (n('winch') && n('winze')) hoists++;
      expect(n('cart'), `${seed} ${inward} carts`).toBeGreaterThanOrEqual(1);
      expect(n('drill')).toBe(1);
      // the drill jumbo parks in the development heading (task reactor-playtest-round2-20261102)
      expect(pieces.find(p => p.variant === MINE_PIECE.drill)!.area, `${seed} ${inward} drill in the heading`).toBe(fx.carve!.rooms.find(r => r.key === 'heading')!.area);
      expect(n('crib')).toBeGreaterThanOrEqual(1);
      if (fx.carve!.rooms.some(r => r.key === 'collapse')) expect(n('rubble'), `${seed} ${inward} rubble`).toBe(1);
      // carts stand on the rail line, along it
      const rail = minesRailWorld(L, fx.carve!.rooms);
      const pts = alongPolyline(rail, 0.1);
      for (const p of pieces.filter(q => q.variant === MINE_PIECE.cart)) expect(Math.min(...pts.map(q => Math.hypot(q.x - p.x, q.z - p.z))), `${seed} cart on the rails`).toBeLessThan(0.15);
    }
    expect(hoists).toBeGreaterThanOrEqual(SEEDS.length - 1);
  });

  it('follows the prop rules: every kind classified (openables + physics), storage that opens, grounded props under the ceiling, nothing in a doorway', () => {
    const openCls = new Map(OPENABLE_AUDIT.map(e => [e.kind, e.cls]));
    for (const [seed, inward] of cases()) {
      const {fx, L} = get(seed, inward), g = L.levels[FIX.level].grid, mine = new Set(fx.carve!.areas);
      const props = L.props.filter(p => mine.has(p.area));
      expect(props.length).toBeGreaterThan(30);
      for (const p of props) {
        expect(openCls.has(p.kind), `${p.kind} in OPENABLE_AUDIT`).toBe(true);
        expect(PROP_PHYSICS_AUDIT[p.kind], `${p.kind} physics row`).toBeDefined();
        expect(p.level).toBe(FIX.level);
        const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i], `${p.kind} on floor`).toBe(FLOOR);
        expect(p.y).toBeGreaterThanOrEqual(g.floorOf(i) - 0.02);
        expect(p.y + p.h).toBeLessThanOrEqual(g.ceil[i] + 0.05);
      }
      // the magazine's storage opens (crates / cabinets / shelving through the existing openables) — an optional space since the seeded
      // graph (task reactor-playtest-round2-20261102): checked where the mine has one
      const mag = fx.carve!.rooms.find(r => r.key === 'magazine');
      if (mag) {
        const store = props.filter(p => p.area === mag.area && ['openable', 'existing', 'open'].includes(openCls.get(p.kind) ?? ''));
        expect(store.length, `${seed} magazine storage`).toBeGreaterThanOrEqual(2);
      }
      // no doorway of the workings is crossed by a prop, plate or fixture
      const doors = new Set(L.doors.filter(d => mine.has(d.a) || mine.has(d.b)).map(d => d.id));
      const bad = doorwayIssues(L).filter(s => doors.has(+s.split(' ')[1]));
      expect(bad, `${seed} ${inward}`).toEqual([]);
    }
  });

  it('hangs fixtures inside their bands (>= 1.9 m) and stencils the plates (adit name at the gallery, warnings, the way to the generator)', () => {
    for (const [seed, inward] of cases()) {
      const {fx, L} = get(seed, inward), g = L.levels[FIX.level].grid, mine = new Set(fx.carve!.areas);
      const lights = L.lights.filter(l => mine.has(l.area));
      for (const l of lights) {
        const [cx, cy] = g.cellOf(l.x, l.z), i = g.idx(cx, cy);
        expect(l.level).toBe(FIX.level);
        expect(l.y).toBeLessThanOrEqual(g.ceil[i] + 1e-3);
        expect(l.y).toBeGreaterThanOrEqual(g.floorOf(i) + 1.9);
      }
      expect(lights.filter(l => l.area === fx.carve!.generator.area).length).toBeGreaterThanOrEqual(4);
      const signs = L.signs.filter(s => s.level === FIX.level && (mine.has(s.area) || s.area === fx.deck.id));
      expect(signs.some(s => s.area === fx.deck.id && /ADIT/.test(s.text)), `${seed} ${inward} adit plate`).toBe(true);
      if (fx.carve!.rooms.some(r => r.key === 'magazine')) expect(signs.some(s => /MAGAZINE/.test(s.text))).toBe(true);
      expect(signs.some(s => /GENERATOR/.test(s.text))).toBe(true);
      for (const s of signs) { expect(s.y).toBeGreaterThan(FIX.baseY + 1.5); expect(s.kind).toBe('service'); }
    }
  });

  it('lays the rail line from the adit mouth through the junction and the haulage to the cavern, on the workings\' floor', () => {
    for (const [seed, inward] of cases()) {
      const {fx, L} = get(seed, inward), g = L.levels[FIX.level].grid, c = fx.carve!, mine = new Set(c.areas);
      const rail = minesRailWorld(L, c.rooms);
      expect(rail.length).toBeGreaterThanOrEqual(4);
      const at = (p: {x: number; z: number}) => { const [cx, cy] = g.cellOf(p.x, p.z); return g.area[g.idx(cx, cy)]; };
      expect(at(rail[0])).toBe(c.rooms.find(r => r.key === 'portal')!.area);
      expect(at(rail[rail.length - 1])).toBe(c.generator.area);
      for (const p of alongPolyline(rail, 0.25)) { const [cx, cy] = g.cellOf(p.x, p.z); expect(g.cells[g.idx(cx, cy)]).toBe(FLOOR); expect(mine.has(g.area[g.idx(cx, cy)])).toBe(true); }
      // right-angle runs only (plus the short jogs between parallel openings)
      for (let i = 0; i + 1 < rail.length; i++) { const dx = Math.abs(rail[i + 1].x - rail[i].x), dz = Math.abs(rail[i + 1].z - rail[i].z); expect(Math.min(dx, dz)).toBeLessThan(1e-6); }
    }
  });

  it('parks the drill jumbo at its REAL kit size (registry x MINES_FIT, lane PROPS\' value) in the heading, boom to the face, at fits up to 2.0', () => {
    const fit0 = MINES_FIT.drillRig;
    try {
      for (const fit of [1, 1.5, 2]) {
        MINES_FIT.drillRig = fit;
        const [L, H, Wd] = minesModelSize('drillRig');
        expect(MINE_PIECE_SIZE.drill).toEqual({l: L, w: Wd, h: H});
        for (const [seed, inward] of cases().slice(0, 4)) {
          const fx = minesFixture(seed, {inward}), Lo = minesLayout(fx, seed), tag = `fit ${fit} ${seed} ${inward}`;
          const hd = fx.carve!.rooms.find(r => r.key === 'heading')!;
          const drill = Lo.props.filter(p => p.kind === 'annexMachine' && p.variant === MINE_PIECE.drill);
          expect(drill.length, tag).toBe(1);
          const p = drill[0], alongX = p.hx >= p.hz;
          expect(p.area, `${tag} in the heading`).toBe(hd.area);
          // the collider IS the rig's real footprint / height (what you see is what you bump into)
          expect(2 * (alongX ? p.hx : p.hz)).toBeCloseTo(L, 2);
          expect(2 * (alongX ? p.hz : p.hx)).toBeCloseTo(Wd, 2);
          expect(p.h).toBeCloseTo(H, 2);
          const a = Lo.areas[hd.area];
          expect(p.y + p.h).toBeLessThanOrEqual(a.ceil + 1e-6);
          // the visuals: the model at the same fit, its boom end (model x * MINES_ANCHORS.drillRig.boom) toward the face, away from the
          // heading's opening (a minimal Reactor record on the fixture layout)
          const c = fx.carve!;
          (Lo as {reactor?: unknown}).reactor = {complexes: [{id: 'mines', level: FIX.level, areas: c.areas, rooms: c.rooms}], generators: []};
          const v = planMinesVisuals(Lo)!;
          expect(v.models.drillRig.length).toBe(1);
          const m = v.models.drillRig[0];
          expect([m.sx, m.sy, m.sz]).toEqual([fit, fit, fit]);
          const door = Lo.doors.find(d => d.a === a.id || d.b === a.id)!;
          const toFace = {x: p.x - (door.x + door.w / 2) * CELL, z: p.z - (door.y + door.h / 2) * CELL};
          const b = MINES_ANCHORS.drillRig.boom, boom = {x: b * Math.cos(m.yaw), z: -b * Math.sin(m.yaw)};
          expect(boom.x * toFace.x + boom.z * toFace.z, `${tag} boom to the face`).toBeGreaterThan(0.5 * Math.hypot(toFace.x, toFace.z));
        }
      }
    } finally { MINES_FIT.drillRig = fit0; }
  });

  it('dresses fast (< ~40 ms)', () => {
    const ms = cases().map(([s, i]) => get(s, i).ms).sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length / 2)]).toBeLessThan(40);
  });
});
