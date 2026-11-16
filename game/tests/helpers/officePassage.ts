// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS, follow-up 1): the checks of the Office street door's walk-up
// passage (gen/surface/accessDoor.ts OFFICE_PASSAGE) between a plain tower (L0) and the same tower with its access (L1). Returns the
// problems found (empty: the passage is open, only barricade pieces moved, legally) and what moved — tests/surface-access.test.ts.
import {OFFICE_PASSAGE, accessOutward} from '../../src/gen/surface/accessDoor';
import {FLOOR, type Grid} from '../../src/gen/grid';
import {cellsOfBox} from '../../src/gen/placeKit';
import {levelDistance} from '../../src/gen/levelGen';
import {validateLayout, type StationLayout} from '../../src/gen/station';

export interface PassageReport {problems: string[]; moved: number[]; mid: number}

const plain = (x: unknown) => JSON.stringify(x);
const without = (o: object, ...keys: string[]) => { const c: Record<string, unknown> = {...o}; for (const k of keys) delete c[k]; return plain(c); };

export function officePassageReport(L0: StationLayout, L1: StationLayout): PassageReport {
  const problems: string[] = [], bad = (s: string) => { if (problems.length < 40) problems.push(s); };
  const a = L1.surfaceAccess, ent = L1.office?.windows.find(w => w.kind === 'entrance');
  if (!a || a.kind !== 'office-door' || !a.door || !ent) return {problems: ['no office door access'], moved: [], mid: NaN};
  const level = a.door.level, out = accessOutward(ent.side)!, alongX = out[1] !== 0;
  const plane = alongX ? a.door.z : a.door.x, mid = alongX ? a.door.x : a.door.z;
  const local = (x: number, z: number): [number, number] => alongX ? [x - mid, (z - plane) * -out[1]] : [z - mid, (x - plane) * -out[0]];
  const g0 = L0.levels[level].grid, g1: Grid = L1.levels[level].grid;
  const standing = (L: StationLayout, i: number) => { const p = L.props[i]; return (p.level ?? 0) === level && !p.mounted && p.host === undefined && !p.cargoGone && p.h > 0.05; };

  // props: the same list; only barricade pieces (and their on-top decor) changed, and only in x / z
  if (L1.props.length !== L0.props.length) bad(`props ${L0.props.length} -> ${L1.props.length}`);
  const moved: number[] = [];
  L0.props.forEach((p, i) => {
    const q = L1.props[i];
    if (!q || plain(p) === plain(q)) return;
    if (without(p, 'x', 'z') !== without(q, 'x', 'z')) { bad(`prop ${i} (${p.kind}) changed beyond its position`); return; }
    if (p.host !== undefined) return; // (checked with its host below)
    if (![...OFFICE_PASSAGE.kinds, ...OFFICE_PASSAGE.loose].includes(p.kind as never)) { bad(`prop ${i} (${p.kind}) moved: not a barricade piece / light loose prop`); return; }
    moved.push(i);
  });
  L0.props.forEach((p, i) => {
    const q = L1.props[i];
    if (p.host === undefined || !q) return;
    const h0 = L0.props[p.host], h1 = L1.props[p.host];
    const rel = (a0: number, b0: number, a1: number, b1: number) => Math.abs((a1 - b1) - (a0 - b0)) < 0.002;
    if (!rel(p.x, h0.x, q.x, h1.x) || !rel(p.z, h0.z, q.z, h1.z)) bad(`decor ${i} did not keep its place on host ${p.host}`);
  });
  for (const i of moved) {
    const p0 = L0.props[i], p = L1.props[i];
    if (!standing(L1, i)) bad(`moved ${i} is not a standing prop`);
    // grounded on the same floor, its cells the area's open floor (blocked by it now)
    if (Math.abs(g1.floorAt(p.x, p.z) - g0.floorAt(p0.x, p0.z)) > 0.01 || Math.abs(p.y - g1.floorAt(p.x, p.z)) > 0.05) bad(`moved ${i} not on the floor`);
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = g1.idx(cx, cy);
      if (g1.cells[c] !== FLOOR || g1.area[c] !== p.area || !g1.blocked[c]) bad(`moved ${i}: cell ${cx},${cy} not its area's blocked floor`);
      if (!!p.blocksSight !== !!g1.sightBlocked[c] && p.blocksSight) bad(`moved ${i}: cell ${cx},${cy} sight mask`);
    }
    // no overlap with any other standing piece of the storey
    L1.props.forEach((o, k) => {
      if (k === i || !standing(L1, k)) return;
      const ox = Math.min(p.x + p.hx, o.x + o.hx) - Math.max(p.x - p.hx, o.x - o.hx), oz = Math.min(p.z + p.hz, o.z + o.hz) - Math.max(p.z - p.hz, o.z - o.hz);
      const oy = Math.min(p.y + p.h, o.y + o.h) - Math.max(p.y, o.y);
      if (ox > 0.005 && oz > 0.005 && oy > 0.005) bad(`moved ${i} (${p.kind}) overlaps ${k} (${o.kind})`);
    });
  }

  // the passage: no standing prop box in it; its cells walkable from 0.25 m in front of the wall to its depth
  const half = OFFICE_PASSAGE.width / 2;
  L1.props.forEach((o, k) => {
    if (!standing(L1, k)) return;
    const [s, d] = local(o.x, o.z), [hs, hd] = alongX ? [o.hx, o.hz] : [o.hz, o.hx];
    if (Math.abs(s) < half + hs - 0.005 && d - hd < OFFICE_PASSAGE.depth - 0.005 && d + hd > 0.005) bad(`prop ${k} (${o.kind}) stands in the passage (s ${s.toFixed(2)} d ${d.toFixed(2)})`);
  });
  // every grid cell the 1.2 m passage touches is walkable (sampled 1 cm inside its edges)
  const ss = [-half + 0.01, ...Array.from({length: 11}, (_, k) => -half + 0.1 * (k + 1)), half - 0.01];
  for (let d = 0.01; d < OFFICE_PASSAGE.depth; d += 0.1) for (const s of ss) {
    const x = alongX ? mid + s : plane - out[0] * d, z = alongX ? plane - out[1] * d : mid + s;
    if (!g1.walkable(...g1.cellOf(x, z))) bad(`passage point s ${s.toFixed(2)} d ${d.toFixed(2)} not walkable`);
  }
  for (let d = 0.5; d <= OFFICE_PASSAGE.depth; d += 0.25) {
    const x = alongX ? mid : plane - out[0] * d, z = alongX ? plane - out[1] * d : mid;
    if (!g1.circleClear(x, z, 0.45)) bad(`passage centre d ${d.toFixed(2)}: no 0.45 m circle`);
  }

  // grids: only the prop masks under the moved pieces' old / new boxes differ
  const boxes = moved.flatMap(i => [L0.props[i], L1.props[i]]).map(p => cellsOfBox(p.x, p.z, p.hx, p.hz));
  L0.levels.forEach((Lv, k) => {
    const a0 = Lv.grid, a1 = L1.levels[k].grid;
    for (let c = 0; c < a0.cells.length; c++) {
      if (a0.cells[c] !== a1.cells[c] || a0.floor[c] !== a1.floor[c] || a0.ceil[c] !== a1.ceil[c] || a0.area[c] !== a1.area[c]) { bad(`level ${k} cell ${c}: geometry changed`); continue; }
      if (a0.blocked[c] === a1.blocked[c] && a0.sightBlocked[c] === a1.sightBlocked[c]) continue;
      const cx = c % a0.w, cy = Math.floor(c / a0.w);
      if (k !== level || !boxes.some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)) bad(`level ${k} cell ${cx},${cy}: mask changed outside the moved pieces`);
    }
  });
  // the cells the pieces left: their old mask was the standing props' (nothing else blocked them: re-deriving lost nothing)
  for (const i of moved) {
    const p = L0.props[i], [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = g1.idx(cx, cy);
      const by = L1.props.some((o, k) => standing(L1, k) && (() => { const b = cellsOfBox(o.x, o.z, o.hx, o.hz); return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; })());
      if (!!g1.blocked[c] !== by) bad(`left cell ${cx},${cy}: blocked ${g1.blocked[c]} but props ${by}`);
    }
  }

  // pickups: only loose items on a moved piece's top moved, with it
  if (L1.pickups.length !== L0.pickups.length) bad('pickups count');
  L0.pickups.forEach((k, j) => {
    const q = L1.pickups[j];
    if (!q || plain(k) === plain(q)) return;
    if (without(k, 'x', 'z') !== without(q, 'x', 'z')) bad(`pickup ${j} changed beyond its position`);
    const on = moved.find(i => { const p = L0.props[i]; return Math.abs(k.x - p.x) <= p.hx && Math.abs(k.z - p.z) <= p.hz && k.y >= p.y + p.h - 0.05; });
    if (on === undefined) bad(`pickup ${j} moved without a moved piece under it`);
    else if (Math.abs((q.x - k.x) - (L1.props[on].x - L0.props[on].x)) > 0.002 || Math.abs((q.z - k.z) - (L1.props[on].z - L0.props[on].z)) > 0.002) bad(`pickup ${j} not carried with ${on}`);
  });
  // everything else of the layout unchanged (the EXIT plate appended)
  for (const k of ['areas', 'doors', 'lights', 'zombies', 'decor', 'levelLinks', 'playerSpawn'] as const) if (plain(L1[k]) !== plain(L0[k])) bad(`${k} changed`);
  if (plain(L1.signs.slice(0, L0.signs.length)) !== plain(L0.signs) || L1.signs.length !== L0.signs.length + 1) bad('signs: not one appended plate');

  // reachable: the return pose and the passage from the spawn; nothing reachable before is cut off (except under the moved pieces)
  const [sx, sy] = g1.cellOf(L1.playerSpawn.x, L1.playerSpawn.z);
  const d0 = levelDistance(L0.levels, sx, sy, 0, L0.levelLinks), d1 = levelDistance(L1.levels, sx, sy, 0, L1.levelLinks);
  const rp = a.returnPose, [rx, ry] = g1.cellOf(rp.x, rp.z);
  if (d1[rp.level][g1.idx(rx, ry)] < 0) bad('return pose unreachable from the spawn');
  const front = alongX ? g1.cellOf(mid, plane - out[1] * 0.4) : g1.cellOf(plane - out[0] * 0.4, mid);
  if (d1[level][g1.idx(...front)] < 0) bad('the door front unreachable from the spawn');
  L1.levels.forEach((Lv, k) => {
    for (let c = 0; c < d0[k].length; c++) if (d0[k][c] >= 0 && d1[k][c] < 0 && !Lv.grid.blocked[c]) bad(`level ${k} cell ${c} cut off`);
  });
  const base = new Set(validateLayout(L0));
  for (const x of validateLayout(L1)) if (!base.has(x)) bad(`validator: ${x}`);
  return {problems, moved, mid};
}
