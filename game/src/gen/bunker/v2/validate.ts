// Task studio-bunker-rework-20261109-205115-01: version-2 checks on top of the shared Bunker validation (gen/bunker/validate.ts
// bunkerIssues: reachability, stairs + loops, objectives, hazards, clean routes, levelIssues / traversal / doorways / railings, enemy
// placement). Pure data.
//  - the spine: the lift shaft solid on every storey grid; every anchor apron open, unblocked floor of ONE area, reached from the start;
//    the stair landing doors cut; the lift record's six stops at the storey floors;
//  - the voids: the lower storey's tall cells inside the void rect only (covering it), the upper storey's void cells never open floor
//    (a well, railed by the derived rails), at least part of the well's rim walkable on the upper storey (a gallery);
//  - the floors: every storey's areas inside its envelope.

import {CELL, FLOOR} from '../../grid';
import {levelDistance} from '../../levelGen';
import type {StationLayout} from '../../stationTypes';
import {bunkerSpine, V2_BASES, V2_LEVELS} from './spine';

export function bunkerV2Issues(layout: StationLayout): string[] {
  const out: string[] = [];
  const info = layout.bunker;
  if (!info || info.version !== 2) return ['not a version-2 bunker'];
  const sp = bunkerSpine(), levels = layout.levels;
  const st = info.start, g0 = layout.grid, [sx, sy] = g0.cellOf(st.x, st.z);
  const dist = levelDistance(levels, sx, sy, 0, layout.levelLinks);
  // the lift shaft: solid everywhere
  for (const L of levels) {
    const g = L.grid;
    let open = 0;
    for (let y = sp.shaft.y; y < sp.shaft.y + sp.shaft.h; y++) for (let x = sp.shaft.x; x < sp.shaft.x + sp.shaft.w; x++) if (g.cells[g.idx(x, y)] !== 0) open++;
    if (open) out.push(`lift shaft: ${open} open cells on storey ${L.id}`);
  }
  const lift = info.lift;
  if (!lift || lift.stops.length !== V2_LEVELS || lift.stops.some((s, i) => s.level !== i || Math.abs(s.y - V2_BASES[i]) > 1e-6)) out.push('lift record');
  // the anchors
  for (const fr of sp.storeys) for (const an of fr.anchors) {
    const g = levels[fr.level].grid;
    let id = -2, bad = 0, blocked = 0, reached = 0;
    for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR) { bad++; continue; }
      if (id === -2) id = g.area[i]; else if (g.area[i] !== id) bad++;
      if (g.blocked[i]) blocked++;
      if (dist[fr.level][i] >= 0) reached++;
    }
    if (bad) out.push(`storey ${fr.level} ${an.id}: apron ${bad} cells not one open area`);
    if (an.id !== 'vaultHall' && blocked) out.push(`storey ${fr.level} ${an.id}: apron ${blocked} cells blocked`);
    if (!reached) out.push(`storey ${fr.level} ${an.id}: apron unreached`);
    if (an.cut) {
      let cut = 0;
      for (let y = an.gate.y; y < an.gate.y + an.gate.h; y++) for (let x = an.gate.x; x < an.gate.x + an.gate.w; x++) if (g.cells[g.idx(x, y)] === FLOOR) cut++;
      if (cut !== an.gate.w * an.gate.h) out.push(`storey ${fr.level} ${an.id}: landing door ${cut} of ${an.gate.w * an.gate.h} cells`);
    }
  }
  // the voids
  for (const v of sp.voids) {
    const lo = levels[v.lower].grid, up = levels[v.upper].grid;
    let cover = 0, upOpen = 0, rim = 0;
    for (let y = v.rect.y; y < v.rect.y + v.rect.h; y++) for (let x = v.rect.x; x < v.rect.x + v.rect.w; x++) {
      const i = lo.idx(x, y);
      if (lo.cells[i] === FLOOR && lo.ceil[i] >= v.ceil - 0.05) cover++;
      if (up.cells[i] === FLOOR) upOpen++;
    }
    if (cover !== v.rect.w * v.rect.h) out.push(`${v.id}: ${cover} of ${v.rect.w * v.rect.h} void cells tall on storey ${v.lower}`);
    if (upOpen) out.push(`${v.id}: ${upOpen} void cells open on storey ${v.upper}`);
    for (let y = v.rect.y - 1; y <= v.rect.y + v.rect.h; y++) for (let x = v.rect.x - 1; x <= v.rect.x + v.rect.w; x++) {
      if (x >= v.rect.x && x < v.rect.x + v.rect.w && y >= v.rect.y && y < v.rect.y + v.rect.h) continue;
      if (!up.inBounds(x, y)) continue;
      const i = up.idx(x, y);
      if (up.cells[i] === FLOOR && dist[v.upper][i] >= 0) rim++;
    }
    if (rim < Math.min(v.rect.w, v.rect.h)) out.push(`${v.id}: gallery rim ${rim} cells on storey ${v.upper}`);
    for (let i = 0; i < lo.cells.length; i++) {
      if (lo.cells[i] !== FLOOR || lo.ceil[i] <= V2_BASES[v.upper] - 0.3 || layout.areas[lo.area[i]]?.role === 'stair') continue;
      const x = i % lo.w, y = (i - x) / lo.w;
      if (!(x >= v.rect.x && x < v.rect.x + v.rect.w && y >= v.rect.y && y < v.rect.y + v.rect.h)) { out.push(`${v.id}: tall cell outside the void on storey ${v.lower}`); break; }
    }
  }
  // the floors inside their envelopes (the spine's own areas excepted)
  for (const a of layout.areas) {
    const L = a.level ?? 0, fr = sp.storeys[L];
    if (a.role === 'stair' || a.role === 'landing' || a.type === 'platform' || a.label === 'Vault vestibule') continue;
    const e = fr.envelope;
    if (a.x < e.x || a.y < e.y || a.x + a.w > e.x + e.w || a.y + a.h > e.y + e.h) out.push(`storey ${L}: ${a.label} outside the envelope`);
  }
  void CELL;
  return out;
}
