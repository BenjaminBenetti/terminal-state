// Task studio-ui-subway-maps-20261108-074144-01 (user: "add map kiosks to the subway level, similar to the mall level"): the plan a Subway
// station map kiosk prints — the PUBLIC plan of THIS generated station, per storey, and its face drawing. Pure (no three.js): plain data
// from the layout plus a 2D-canvas drawing, so the kiosks' faces (world/subwayMapKiosks.ts), the close-up read (world/subwayMapRead.ts)
// and tests draw the same thing.
//
// What it shows (like the mall directory: world/mallArch.ts directoryPlanTexture): the kiosk's own storey — platforms, halls and passages,
// shops and washrooms, stairs (with where they lead, when that storey is public too), the fare line, the track beds along the platforms,
// area names, and YOU ARE HERE at the kiosk. Heads-up: the map is turned so "up" is the way the reader faces.
// What it never shows: anything that is not public space (back-of-house, staff rooms, the service level), the track extensions (tunnels
// and service annexes past the station: their areas carry `ext`), props, loot, pickups, enemies or anything else from play state. It reads
// the generated layout only, so a station's kiosks print the same plan on every visit.

import type {Area, StationLayout} from '../gen/stationTypes';
import {CELL, VOID} from '../gen/grid';
import {SUBWAY_MAP_KIOSK} from '../gen/subwayMapKioskKind';

/** Cell classes on the plan (0 = not printed). */
export const PLAN_CELL = {none: 0, platform: 1, hall: 2, shop: 3, washroom: 4, stairs: 5, track: 6} as const;
export type PlanCellClass = (typeof PLAN_CELL)[keyof typeof PLAN_CELL];

export interface PlanLabel { text: string; x: number; z: number; big: boolean; area: number }
export interface PlanStair { x: number; z: number; text: string }
export interface PlanStorey {
  level: number;
  /** "Platform level", "Upper concourse". */
  name: string;
  /** One class per grid cell (same indexing as the layout grid). */
  cells: Uint8Array;
  labels: PlanLabel[];
  /** Stair ends on this storey that lead to another PUBLIC storey ("Up to the upper concourse"). */
  stairs: PlanStair[];
  /** Fare lines (gate rows) on this storey: world segments. */
  fare: {x0: number; z0: number; x1: number; z1: number}[];
  /** World bounds of the printed cells. */
  bounds: {x0: number; z0: number; x1: number; z1: number};
}
export interface SubwayMapPlan { name: string; w: number; h: number; storeys: PlanStorey[] }

/** Words a kiosk face never prints (loot / play-state / spoiler words; tests scan every label for them). */
export const SUBWAY_MAP_FORBIDDEN = /\b(loot|ammo|weapon|rifle|pistol|shotgun|knife|zombie|infected|enemy|enemies|siren|horde|fuel|key|keys|cache|stash|secret|hidden|annex|tunnel|service|staff|crew|storage|utility|supply)\b/i;

const isPublic = (a: Area | undefined): a is Area => !!a && a.publicSpace && !a.ext && a.kind !== 'service';
const classOf = (a: Area): PlanCellClass => (a.kind === 'platform' ? PLAN_CELL.platform
  : a.type === 'shop' || a.type === 'eatery' ? PLAN_CELL.shop
  : a.type === 'washroom' ? PLAN_CELL.washroom
  : PLAN_CELL.hall);
const levelOf = (a: Area) => a.level ?? 0;

function storeyName(layout: StationLayout, level: number): string {
  if (level === 0) return 'Platform level';
  const role = layout.levels[level]?.role;
  return role === 'upper' ? 'Upper concourse' : role === 'lower' ? 'Lower level' : `Level ${level}`;
}

/** The public plan of a Subway layout (every storey with public space). */
export function subwayMapPlan(layout: StationLayout): SubwayMapPlan {
  const g0 = layout.grid, n = g0.w * g0.h;
  const storeys: PlanStorey[] = [];
  const levels = layout.levels?.length ? layout.levels : [{id: 0, grid: g0}];
  for (const L of levels) {
    const level = L.id, g = L.grid ?? g0;
    const cells = new Uint8Array(n);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const mark = (i: number, c: PlanCellClass) => {
      cells[i] = c;
      const cx = i % g.w, cy = Math.floor(i / g.w);
      x0 = Math.min(x0, cx * CELL); z0 = Math.min(z0, cy * CELL); x1 = Math.max(x1, (cx + 1) * CELL); z1 = Math.max(z1, (cy + 1) * CELL);
    };
    for (let i = 0; i < n; i++) {
      const a = layout.areas[g.area[i]];
      if (!isPublic(a) || levelOf(a) !== level && g.rampIdx[i] < 0) continue;
      if (g.cells[i] === VOID) continue;
      mark(i, g.rampIdx[i] >= 0 ? PLAN_CELL.stairs : classOf(a));
    }
    if (x0 === Infinity) continue; // no public space on this storey (the service level)
    // the track beds along the platforms (platform-face span only: the tunnels beyond stay off the plan)
    if (level === 0) {
      for (const t of layout.trenches ?? []) {
        for (let cz = Math.floor(t.z0 / CELL); cz < Math.ceil(t.z1 / CELL); cz++) for (let cx = Math.floor(t.platformX0 / CELL); cx < Math.ceil(t.platformX1 / CELL); cx++) {
          if (!g.inBounds(cx, cz)) continue;
          const i = g.idx(cx, cz);
          if (g.cells[i] === VOID && !cells[i]) mark(i, PLAN_CELL.track);
        }
      }
    }
    // labels: each printed area's name at its cells' centroid (platforms / halls big, shops / washrooms small)
    const sums = new Map<number, {x: number; z: number; k: number}>();
    for (let i = 0; i < n; i++) {
      if (!cells[i] || cells[i] === PLAN_CELL.track || cells[i] === PLAN_CELL.stairs) continue;
      const id = g.area[i], s = sums.get(id) ?? {x: 0, z: 0, k: 0};
      s.x += (i % g.w + 0.5) * CELL; s.z += (Math.floor(i / g.w) + 0.5) * CELL; s.k++;
      sums.set(id, s);
    }
    const labels: PlanLabel[] = [];
    for (const [id, s] of sums) {
      const a = layout.areas[id];
      const text = labelOf(layout, a);
      if (!text || s.k < 6 || SUBWAY_MAP_FORBIDDEN.test(text)) continue; // (a public stair named for the service level below: not printed)
      labels.push({text, x: s.x / s.k, z: s.z / s.k, big: a.kind === 'platform' || (a.kind === 'concourse' && s.k >= 40), area: id});
    }
    labels.sort((a, b) => Number(b.big) - Number(a.big) || a.area - b.area);
    storeys.push({level, name: storeyName(layout, level), cells, labels, stairs: [], fare: [], bounds: {x0, z0, x1, z1}});
  }
  // stair ends that lead to another public storey
  const pub = new Set(storeys.map(s => s.level));
  for (const k of layout.levelLinks ?? []) {
    if (k.kind !== 'stairs' || !pub.has(k.lower) || !pub.has(k.upper)) continue;
    const lo = storeys.find(s => s.level === k.lower)!, up = storeys.find(s => s.level === k.upper)!;
    lo.stairs.push({x: k.bottom.x, z: k.bottom.z, text: `Up to the ${up.name.toLowerCase()}`});
    up.stairs.push({x: k.top.x, z: k.top.z, text: `Down to the ${lo.name.toLowerCase()}`});
  }
  // the fare lines (gate rows in public openings)
  for (const d of layout.doors) {
    if (!d.fare) continue;
    const s = storeys.find(x => x.level === (d.level ?? 0));
    if (!s) continue;
    const along = d.w >= d.h;
    const x0 = d.x * CELL, z0 = d.y * CELL, x1 = (d.x + d.w) * CELL, z1 = (d.y + d.h) * CELL;
    s.fare.push(along ? {x0, z0: (z0 + z1) / 2, x1, z1: (z0 + z1) / 2} : {x0: (x0 + x1) / 2, z0, x1: (x0 + x1) / 2, z1});
  }
  return {name: layout.name, w: g0.w, h: g0.h, storeys};
}

/** A printed area name: its label, a shop's sign name, or nothing for a closed street exit's empty stair. */
function labelOf(layout: StationLayout, a: Area): string {
  if (a.storefront !== undefined && layout.storefronts[a.storefront]?.name) return layout.storefronts[a.storefront].name;
  return (a.label ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// The face (printed panel): header band, the plan (heads-up), the legend.

export interface KioskPose { x: number; z: number; rot: number; level?: number }

/** The face canvas size (px) at scale 1: the printed panel's proportions (faceW x faceH). */
export const KIOSK_FACE = {w: 512, h: Math.round(512 * SUBWAY_MAP_KIOSK.faceH / SUBWAY_MAP_KIOSK.faceW), header: 92, legend: 88, pad: 18} as const;

const INK = '#1d1f22', PAPER = '#ebe6d8', RED = '#c2362b';
const FILL: Record<number, string> = {1: '#c9c1aa', 2: '#f6f3ea', 3: '#ddd2b2', 4: '#c4d3d9', 5: '#a39d8f', 6: '#45484b'};

/** World point -> the reader's frame (u right, v ahead) of a kiosk facing `rot` (front +Z rotated; the reader looks along -front). */
export function readerFrame(p: KioskPose, x: number, z: number): {u: number; v: number} {
  const dx = x - p.x, dz = z - p.z, s = Math.sin(p.rot), c = Math.cos(p.rot);
  // the reader looks along f = (-sin rot, -cos rot); right = (cos rot, -sin rot)
  return {u: dx * c - dz * s, v: -dx * s - dz * c};
}

/** Where YOU ARE HERE goes: just in front of the kiosk (where the reader stands). */
export function hereOf(p: KioskPose): {x: number; z: number} {
  return {x: p.x + Math.sin(p.rot) * 0.6, z: p.z + Math.cos(p.rot) * 0.6};
}

type Ctx = Pick<CanvasRenderingContext2D, 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'strokeRect'
  | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'arc' | 'fillText' | 'measureText' | 'save' | 'restore' | 'closePath'> & {setLineDash?(d: number[]): void};

/** Stats of the last face drawn (tests). */
export const KIOSK_FACE_DRAW = {cells: 0, labels: 0, stairs: 0, here: {x: 0, y: 0}};

/**
 * Draw a kiosk's face into `ctx` at (ox, oy), KIOSK_FACE.w x KIOSK_FACE.h px (the caller scales the context for a bigger copy):
 * the header (STATION MAP, the station, this storey), the storey's plan turned heads-up and fitted, the labels, YOU ARE HERE, the legend.
 */
export function drawKioskFace(ctx: Ctx, plan: SubwayMapPlan, pose: KioskPose, ox = 0, oy = 0): void {
  const F = KIOSK_FACE, level = pose.level ?? 0;
  const st = plan.storeys.find(s => s.level === level) ?? plan.storeys[0];
  Object.assign(KIOSK_FACE_DRAW, {cells: 0, labels: 0, stairs: 0});
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(ox, oy, F.w, F.h);
  // header
  ctx.fillStyle = INK;
  ctx.fillRect(ox, oy, F.w, F.header);
  ctx.fillStyle = '#f3efe3';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('STATION MAP', ox + F.pad, oy + 40);
  ctx.font = '17px sans-serif';
  ctx.fillText(fit(ctx, `${plan.name} · ${st ? st.name : ''}`, F.w - 2 * F.pad), ox + F.pad, oy + 70);
  ctx.fillStyle = RED;
  ctx.fillRect(ox, oy + F.header - 6, F.w, 6);
  if (!st) { ctx.restore(); return; }
  // the plan, heads-up, fitted into the box between the header and the legend
  const box = {x: ox + F.pad, y: oy + F.header + F.pad, w: F.w - 2 * F.pad, h: F.h - F.header - F.legend - 2 * F.pad};
  const pts: {u: number; v: number}[] = [];
  for (const [x, z] of [[st.bounds.x0, st.bounds.z0], [st.bounds.x1, st.bounds.z0], [st.bounds.x0, st.bounds.z1], [st.bounds.x1, st.bounds.z1]]) pts.push(readerFrame(pose, x, z));
  const u0 = Math.min(...pts.map(p => p.u)), u1 = Math.max(...pts.map(p => p.u)), v0 = Math.min(...pts.map(p => p.v)), v1 = Math.max(...pts.map(p => p.v));
  const k = Math.min(box.w / Math.max(1, u1 - u0), box.h / Math.max(1, v1 - v0));
  const cx = box.x + (box.w - (u1 - u0) * k) / 2, cy = box.y + (box.h - (v1 - v0) * k) / 2;
  const toPx = (x: number, z: number) => { const r = readerFrame(pose, x, z); return {x: cx + (r.u - u0) * k, y: cy + (v1 - r.v) * k}; };
  const W = plan.w, cellPx = CELL * k + 0.6;
  for (let i = 0; i < st.cells.length; i++) {
    const c = st.cells[i];
    if (!c) continue;
    const p = toPx((i % W + 0.5) * CELL, (Math.floor(i / W) + 0.5) * CELL);
    ctx.fillStyle = FILL[c];
    ctx.fillRect(p.x - cellPx / 2, p.y - cellPx / 2, cellPx, cellPx);
    KIOSK_FACE_DRAW.cells++;
  }
  // outlines: a printed edge where a cell meets an unprinted one
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, k * 0.09);
  ctx.beginPath();
  const H = st.cells.length / W;
  for (let i = 0; i < st.cells.length; i++) {
    const c = st.cells[i];
    if (!c || c === PLAN_CELL.track) continue;
    const gx = i % W, gy = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx, ny = gy + dy;
      const nc = nx < 0 || ny < 0 || nx >= W || ny >= H ? 0 : st.cells[ny * W + nx];
      if (nc && nc !== PLAN_CELL.track) continue;
      // the shared edge between the two cells
      const ex = (gx + 0.5 + dx * 0.5) * CELL, ez = (gy + 0.5 + dy * 0.5) * CELL;
      const a = toPx(ex - dy * CELL / 2, ez - dx * CELL / 2), b = toPx(ex + dy * CELL / 2, ez + dx * CELL / 2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();
  // fare lines (dashed red)
  ctx.strokeStyle = RED;
  ctx.lineWidth = Math.max(1.5, k * 0.12);
  ctx.setLineDash?.([5, 4]);
  for (const f of st.fare) { const a = toPx(f.x0, f.z0), b = toPx(f.x1, f.z1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  ctx.setLineDash?.([]);
  // labels (greedy: no overlaps, inside the plan box)
  const taken: {x0: number; y0: number; x1: number; y1: number}[] = [];
  const place = (text: string, x: number, y: number, size: number, bold: boolean, color: string): boolean => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
    const t = fit(ctx, text, box.w * 0.6), w = ctx.measureText(t).width;
    const r = {x0: x - w / 2 - 3, y0: y - size / 2 - 2, x1: x + w / 2 + 3, y1: y + size / 2 + 2};
    if (r.x0 < box.x || r.x1 > box.x + box.w || r.y0 < box.y || r.y1 > box.y + box.h) return false;
    if (taken.some(o => r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1)) return false;
    taken.push(r);
    ctx.fillStyle = 'rgba(246, 243, 234, 0.85)';
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
    return true;
  };
  // YOU ARE HERE first (it always wins its spot): its dot's room is reserved, its label placed, then every other label keeps clear of
  // both; the dot itself is drawn last, over everything
  const here = toPx(hereOf(pose).x, hereOf(pose).z);
  KIOSK_FACE_DRAW.here = {x: here.x - ox, y: here.y - oy};
  taken.push({x0: here.x - 13, y0: here.y - 13, x1: here.x + 13, y1: here.y + 13});
  const hereUp = here.y - 26 > box.y + 10;
  place('YOU ARE HERE', here.x, hereUp ? here.y - 24 : here.y + 24, 15, true, RED);
  for (const l of st.labels) { const p = toPx(l.x, l.z); if (place(l.text, p.x, p.y, l.big ? 16 : 12, l.big, INK)) KIOSK_FACE_DRAW.labels++; }
  for (const s of st.stairs) { const p = toPx(s.x, s.z); if (place(`⇅ ${s.text}`, p.x, p.y, 12, false, '#3a3630')) KIOSK_FACE_DRAW.stairs++; }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(here.x, here.y, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(here.x, here.y, 8, 0, Math.PI * 2); ctx.fill();
  // legend
  const ly = oy + F.h - F.legend;
  ctx.fillStyle = INK;
  ctx.fillRect(ox, ly, F.w, 2);
  const keys: [string, string][] = [['Platform', FILL[1]], ['Concourse', FILL[2]], ['Shops', FILL[3]], ['Washroom', FILL[4]], ['Stairs', FILL[5]], ['Tracks', FILL[6]]];
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  keys.forEach(([name, col], i) => {
    const x = ox + F.pad + (i % 3) * ((F.w - 2 * F.pad) / 3), y = ly + 24 + Math.floor(i / 3) * 26;
    ctx.fillStyle = col;
    ctx.fillRect(x, y - 8, 22, 16);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - 8, 22, 16);
    ctx.fillStyle = INK;
    ctx.fillText(name, x + 30, y);
  });
  ctx.fillStyle = RED;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('- - fare line', ox + F.w - F.pad - 92, ly + 76);
  ctx.restore();
}

/** Shorten a line to `max` px with an ellipsis. */
function fit(ctx: Ctx, t: string, max: number): string {
  if (ctx.measureText(t).width <= max) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
