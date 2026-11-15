/** Surface Run's LOCAL checkpoint map. Every printed destination is taken from the generated section. */
import type {SurfaceInfo, SurfaceRect} from '../gen/surface/types';

export const SURFACE_EXPLORATION_LANE = 'surface.exploration';
export interface SurfaceExploration {v: 1; blocks: string[]; destinations: string[]}
export interface SurfaceMapPose {x: number; z: number; yaw?: number}
export interface SurfaceMapMarker extends SurfaceMapPose {
  id: string; label: string; kind: string; explored: boolean; intel?: string;
}
export interface SurfaceMapState {
  bounds: SurfaceRect;
  roads: SurfaceInfo['roads'];
  blocks: (SurfaceInfo['blocks'][number] & {explored: boolean})[];
  destinations: SurfaceMapMarker[];
  checkpoint: SurfaceMapPose;
  player: SurfaceMapPose;
  truck: SurfaceMapPose | null;
}

/** Strict structural check for the save reader; the actual layout narrows ids again on entry. */
export function surfaceExplorationProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'surface exploration must be an object';
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !['v', 'blocks', 'destinations'].includes(k)) || r.v !== 1) return 'unsupported surface exploration record';
  for (const [key, max] of [['blocks', 64], ['destinations', 16]] as const) {
    const list = r[key];
    const idPattern = key === 'blocks' ? /^[A-H][1-8]$/ : /^SR-(?:0[0-9]|1[0-5])$/;
    if (!Array.isArray(list) || list.length > max || list.some(id => typeof id !== 'string' || !idPattern.test(id)) || new Set(list).size !== list.length) return `malformed surface exploration ${key}`;
  }
  return null;
}

export function surfaceRectContains(r: SurfaceRect, p: SurfaceMapPose): boolean {
  return p.x >= r.x && p.z >= r.z && p.x <= r.x + r.w && p.z <= r.z + r.d;
}

/** Old / unknown ids never accumulate in the section's finite exploration record. */
export function readSurfaceExploration(raw: unknown, info: SurfaceInfo): SurfaceExploration {
  const rec = raw && typeof raw === 'object' ? raw as Partial<SurfaceExploration> : {};
  const keep = (v: unknown, ids: readonly string[]) => Array.isArray(v) ? ids.filter(id => v.includes(id)) : [];
  return {v: 1, blocks: keep(rec.blocks, info.blocks.map(b => b.id)), destinations: keep(rec.destinations, info.destinations.map(d => d.id))};
}

/** Marks only the place the player actually occupies, not a radius through walls. Returns true when it changed. */
export function exploreSurface(rec: SurfaceExploration, info: SurfaceInfo, player: SurfaceMapPose): boolean {
  let changed = false;
  for (const b of info.blocks) if (surfaceRectContains(b, player) && !rec.blocks.includes(b.id)) { rec.blocks.push(b.id); changed = true; }
  for (const d of info.destinations) if (surfaceRectContains(d, player) && !rec.destinations.includes(d.id)) { rec.destinations.push(d.id); changed = true; }
  return changed;
}

/** No campaign object is accepted here. The annotations are explicitly reported, unverified LOCAL observations. */
export function surfaceMapState(info: SurfaceInfo, explored: SurfaceExploration, player: SurfaceMapPose, truck: SurfaceMapPose | null): SurfaceMapState {
  return {
    bounds: {...info.bounds}, roads: info.roads,
    blocks: info.blocks.map(b => ({...b, explored: explored.blocks.includes(b.id)})),
    destinations: info.destinations.map(d => ({id: d.id, label: d.label, kind: d.kind, x: d.entrance.x, z: d.entrance.z,
      explored: explored.destinations.includes(d.id), ...(d.intel ? {intel: d.intel} : {})})),
    checkpoint: {x: info.checkpoint.map.x, z: info.checkpoint.map.z},
    player: {x: player.x, z: player.z, ...(player.yaw !== undefined ? {yaw: player.yaw} : {})},
    truck: truck ? {x: truck.x, z: truck.z, ...(truck.yaw !== undefined ? {yaw: truck.yaw} : {})} : null,
  };
}

const INK = '#d9dec2', DIM = '#9ba48e', PAPER = '#303e36', GRID = '#536454', GOLD = '#d3bf80';

/** A deliberately legible military planning sheet: real roads, numbered destinations and a separate report index. */
export function drawSurfaceMap(ctx: CanvasRenderingContext2D, state: SurfaceMapState, w = 1200, h = 930): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#6c7762'; ctx.lineWidth = 2; ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.fillStyle = INK; ctx.font = 'bold 30px monospace'; ctx.fillText('SURFACE RUN / LOCAL OPERATIONS', 34, 57);
  ctx.font = '15px monospace'; ctx.fillStyle = GOLD; ctx.fillText('TOXIC AIR · SEALED CAB ONLY · MASK / FILTER / AIRTANK OUTSIDE', 35, 86);
  ctx.fillStyle = DIM; ctx.font = '13px monospace'; ctx.fillText('FIELD SURVEY   |   REPORTS UNVERIFIED   |   CHECKPOINT SECTOR ONLY', 35, 109);
  const left = 38, top = 145, size = 740;
  const scale = size / Math.max(state.bounds.w, state.bounds.d);
  const X = (x: number) => left + (x - state.bounds.x) * scale;
  const Z = (z: number) => top + (z - state.bounds.z) * scale;
  ctx.fillStyle = '#202b26'; ctx.fillRect(left, top, size, size);
  for (const b of state.blocks) {
    ctx.fillStyle = b.explored ? '#4c5d46' : b.core ? '#39463b' : '#2f3a31';
    ctx.fillRect(X(b.x), Z(b.z), b.w * scale, b.d * scale);
    ctx.strokeStyle = GRID; ctx.lineWidth = 0.6; ctx.strokeRect(X(b.x), Z(b.z), b.w * scale, b.d * scale);
  }
  for (const r of state.roads) { ctx.fillStyle = '#87907a'; ctx.fillRect(X(r.x), Z(r.z), r.w * scale, r.d * scale); }
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.strokeRect(left, top, state.bounds.w * scale, state.bounds.d * scale);
  ctx.font = '12px monospace'; ctx.fillStyle = INK;
  for (let i = 0; i < 8; i++) {
    const x = left + (i + 0.5) * size / 8, y = top + (i + 0.5) * size / 8;
    ctx.fillText(String.fromCharCode(65 + i), x - 4, top - 10);
    ctx.fillText(String(i + 1), left - 18, y + 4);
  }
  const dot = (p: SurfaceMapPose, color: string, r: number) => { ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#18231c'; ctx.lineWidth = 2; ctx.stroke(); };
  const symbol = (p: SurfaceMapPose, color: string, truck: boolean) => {
    ctx.save(); ctx.translate(X(p.x), Z(p.z)); ctx.rotate(-(p.yaw ?? 0)); ctx.fillStyle = color; ctx.strokeStyle = '#18231c'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (truck) { ctx.rect(-5, -9, 10, 17); ctx.moveTo(-4, -5); ctx.lineTo(4, -5); }
    else { ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); }
    ctx.fill(); ctx.stroke(); ctx.restore();
  };
  dot(state.checkpoint, GOLD, 8);
  ctx.fillStyle = '#111c13'; ctx.font = 'bold 11px monospace'; ctx.fillText('CP', X(state.checkpoint.x) - 7, Z(state.checkpoint.z) + 4);
  const rx = 802;
  ctx.fillStyle = INK; ctx.font = 'bold 18px monospace'; ctx.fillText('DESTINATION INDEX', rx, top + 4);
  ctx.font = '13px monospace'; ctx.fillStyle = DIM; ctx.fillText('● entered    ○ unentered', rx, top + 27);
  state.destinations.forEach((d, i) => {
    const x = X(d.x), z = Z(d.z), y = top + 56 + i * 34;
    ctx.beginPath(); ctx.arc(x, z, 11, 0, 2 * Math.PI); ctx.fillStyle = d.explored ? '#b7c49b' : '#253629'; ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 12px monospace'; ctx.fillStyle = d.explored ? '#1e2c20' : INK; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x, z + 4); ctx.textAlign = 'left';
    ctx.fillStyle = d.explored ? '#cad5b5' : INK; ctx.font = 'bold 13px monospace'; ctx.fillText(`${String(i + 1).padStart(2, '0')} ${d.label}`, rx, y, w - rx - 30);
    ctx.font = '11px monospace'; ctx.fillStyle = DIM; ctx.fillText(`${d.kind.replace('-', ' ')} · ${d.explored ? 'entered' : 'unentered'}`, rx + 26, y + 14, w - rx - 50);
  });
  let iy = top + 635;
  ctx.fillStyle = GOLD; ctx.font = 'bold 15px monospace'; ctx.fillText('LOCAL REPORTS / UNVERIFIED', rx, iy); iy += 23;
  for (const d of state.destinations.filter(d => d.intel).slice(0, 3)) {
    const index = state.destinations.indexOf(d) + 1;
    const text = `${index}. ${d.intel}`;
    const words = text.split(' '); let line = '';
    ctx.font = '12px monospace'; ctx.fillStyle = DIM;
    for (const word of words) { const next = line ? `${line} ${word}` : word; if (ctx.measureText(next).width > w - rx - 34 && line) { ctx.fillText(line, rx, iy); iy += 15; line = word; } else line = next; }
    if (line) { ctx.fillText(line, rx, iy); iy += 19; }
  }
  if (state.truck) symbol(state.truck, '#c6a768', true);
  symbol(state.player, '#dce7c6', false);
  ctx.font = '12px monospace'; ctx.fillStyle = DIM;
  ctx.fillText('N ↑   GRID 28 m   |   PALE ARROW: YOU   |   AMBER: TRUCK / CHECKPOINT', left, h - 23);
  ctx.restore();
}
