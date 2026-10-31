// Task mall-round2-20261031 (lane ARCH, M09 rendering). User: "I would also love if some hallways ended at doors out of the mall, where
// you can see the city through the glass with the green fog and all that." Clarification: the doors are "locked".
//
// Lane GEN places the street exits (a record per exit at a street-level hall end, honest NON-TRAVERSABLE collision, connectivity
// intact: gen/mall/*); this module RENDERS them. View only: no walkable outside, no Travel, no gas exposure (strictly visual).
//
// Per exit, in the exit's local frame (u along the opening, w outward from the hall-side wall plane, y above the street):
//  1. FRAME (lit, opaque; one merged mesh): the aluminium / bronze storefront door set(s) — jambs, head, transom, mullions, leaf stiles
//     and rails with kick plates — the reveal / vestibule pocket (floor mat + tile, side walls, soffit), the LOCK made legible: push
//     bars with a heavy chain wrapped through them and a padlock, plywood boards over lower panes, a taped paper notice ("THIS EXIT IS
//     LOCKED ... USE THE SUBWAY") and a "NO EXIT" plate on the glass, a dimly lit "EXIT CLOSED / DOORS LOCKED" box sign over the doors;
//  2. GLASS (transparent, dirty, double-sided; one mesh): every pane exactly inside GEN's collider (visual = collision). It writes depth
//     (like the roof glass: the screen-space interior haze stops at it) and draws after the exterior (renderOrder): far panes first;
//  3. STREET (unlit outdoor shading like the Office city: fake hemisphere + weak sun; one mesh): pavement slabs, curb, the road with
//     faded lane markings, the far pavement, ruined facades (atlas variants, jagged broken tops, exposed slabs), a second row of taller
//     silhouettes, wrecked cars, rubble, lamp posts, an entrance canopy; a backdrop box (back / sides / lid) painted with the roof's
//     own sky colour (world/mallExterior.ts mallSkyColour: the Office murk, the skyline ghost at the horizon). FOG = the Office's
//     outdoor green height fog (world/exterior.ts EXT_FOG through the EXT_U uniforms: base / ground / height / range / noise / drift)
//     over the OUTDOOR part of each view ray only — the ray's crossing of the exit plane comes from a per-vertex attribute (aExit), so
//     no Office per-section state (EXT_U.box / groundY / roofY) is read — toward the roof sky's horizon murk colour (murkAt), plus the
//     mall's indoor haze (MALL_FOG) over the indoor part, exactly as three's FogExp2 would;
//  4. FOG CARDS (transparent; one mesh): drifting murk layers parallel to the glass at increasing depths (parallax) + a low street
//     layer — the Office fog's PATCH variation (EXT_FOG.noise) on top of its mean (each card's opacity = the Office fog opacity of its
//     depth slice x the thick-patch structure), so the mean density is never counted twice.
// Cost (pinned in tests/mall-budget.test.ts): 4 draws per exit in the main pass (+ the frame in the flashlight shadow pass when lit),
// ~1.5-2.5 k triangles, one shared 1024 x 1024 canvas atlas for every exit, 4 shared materials (one program each). Culling: every
// mesh carries userData.aperture (the glazed opening): world/levelCulling.ts draws it only when its storey is shown AND the opening is
// potentially visible (frustum, fog distance, a sight ray through the free bands to the hall cells in front of it).
// Provenance: procedural canvas art drawn here at load (generic words only: no brands, no external imagery), procedural geometry and
// the Office's procedural stand-in props (world/exterior.ts fallbackPropGeometry). No provider job, no model / image asset.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial} from 'three/webgpu';
import {
  Fn, abs, attribute, cameraPosition, clamp, dFdx, dFdy, dot, exp, float, fract, length, max, min, mix, normalWorld, normalize, positionView,
  positionWorld, select, smoothstep, step, texture, time, uniform, uv, vec2, vec3,
} from 'three/tsl';
import {mulberry32} from '../core/rng';
import {canvasTexture} from './canvasTextures';
import {wmNoise} from './surfaceNodes';
import {EXT_FOG, EXT_U, exteriorFogOpacity, fallbackPropGeometry} from './exterior';
import {MALL_EXT_ORDER, MALL_SKY, gasColour, gasDensity, hazeSatCpu, mallSkyColour, murkAt} from './mallExterior';
import {MALL_FOG} from './mallAtmosphere';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;
type V3 = [number, number, number];
type Rect = {x0: number; z0: number; x1: number; z1: number};

// ---------------------------------------------------------------------------------------------------------------------------
// The exit record (lane GEN) -> a normalized spec

/** A locked street exit as this renderer needs it (world metres, absolute y). Derived from lane GEN's record (streetExitSpecs). */
export interface StreetExitSpec {
  id: string;
  /** Storey (layout.levels index) whose hall ends at the exit, and the street / pavement y outside (= that storey's floor). */
  level: number;
  streetY: number;
  /** Outward unit normal (axis-aligned): from the hall to the street. */
  nx: number;
  nz: number;
  /** The hall-side wall plane of the opening (x for E / W exits, z for N / S), the clear opening span along it (world coords on the
   *  other axis, s0 < s1) and its floor / head y. The hall's open cells end at this plane. */
  plane: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  /** GEN's non-traversable collider (world box): the glass is drawn inside it. */
  collider: {x0: number; z0: number; x1: number; z1: number; y0: number; y1: number};
  /** Exterior VIEW volume (world box): outside the mall footprint on every storey, never walkable. */
  view: {x0: number; z0: number; x1: number; z1: number; y0: number; y1: number};
  /** Vestibule pocket depth beyond the hall-side plane (m, >= the collider / wall depth): the outer door set stands at its end. */
  vestibule: number;
  /** Clear ceiling y of the hall in front of the opening (the lit sign goes on the wall above the doors when it fits). */
  hallCeil: number;
  /** Panes along the opening (lane GEN's MallStreetExit.panels: push-bar leaves, sidelights, the transom; world along coords). */
  panels: readonly {kind: 'door' | 'sidelight' | 'transom'; s0: number; s1: number; y0: number; y1: number}[];
  seed: number;
}

/** The culler's view of an exit (world/levelCulling.ts ExitAperture): the glazed opening on its hall-side plane. */
export interface StreetExitAperture { nx: number; nz: number; plane: number; s0: number; s1: number; y0: number; y1: number }

const SIDE_N: Record<string, [number, number]> = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]};
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Lane GEN's exit records (layout.mall.exits, read loosely: nothing breaks before / without them) -> normalized specs.
 * `ceilAt(level, x, z)`: the clear ceiling of a storey cell (the hall in front of the opening).
 */
export function streetExitSpecs(layout: {mall?: unknown}, ceilAt: (level: number, x: number, z: number) => number): StreetExitSpec[] {
  const raw = ((layout.mall as {exits?: unknown[]} | undefined)?.exits ?? []) as Record<string, unknown>[];
  const out: StreetExitSpec[] = [];
  raw.forEach((r, k) => {
    const side = String(r.side ?? '');
    const n = SIDE_N[side];
    const door = r.door as Record<string, number> | undefined;
    const view = r.view as StreetExitSpec['view'] | undefined;
    if (!n || !door || !view) return;
    const plane = num(door.plane, NaN), s0 = Math.min(num(door.s0, NaN), num(door.s1, NaN)), s1 = Math.max(num(door.s0, NaN), num(door.s1, NaN));
    if (![plane, s0, s1].every(Number.isFinite) || s1 - s0 < 0.6) return;
    const level = num(r.level, 0), streetY = num(r.streetY, num(door.y0, 0));
    const y0 = num(door.y0, streetY), y1 = num(door.y1, y0 + 2.4);
    const [nx, nz] = n, alongX = nz !== 0;
    // the collider: GEN's box, else the wall cell behind the plane (0.5 m)
    const c = r.collider as StreetExitSpec['collider'] | undefined;
    const collider = c && [c.x0, c.z0, c.x1, c.z1].every(Number.isFinite) ? {...c}
      : alongX ? {x0: s0, x1: s1, z0: Math.min(plane, plane + nz * 0.5), z1: Math.max(plane, plane + nz * 0.5), y0, y1}
        : {z0: s0, z1: s1, x0: Math.min(plane, plane + nx * 0.5), x1: Math.max(plane, plane + nx * 0.5), y0, y1};
    // the vestibule: GEN's pocket depth (its outer facade plane), at least the view volume's near face (the street starts there)
    const nearOf = (b: Rect) => (alongX ? (nz > 0 ? b.z0 - plane : plane - b.z1) : (nx > 0 ? b.x0 - plane : plane - b.x1));
    const facade = num(r.facade, NaN);
    const vest = Number.isFinite(facade) ? Math.abs(facade - plane) : num(r.vestibule, 0.5);
    const vestibule = Math.max(vest, nearOf(view), 0.3);
    const mid = (s0 + s1) / 2;
    const hx = alongX ? mid : plane - nx * 0.25, hz = alongX ? plane - nz * 0.25 : mid;
    const hall = r.hall as {ceil?: number} | undefined;
    const panels = (Array.isArray(r.panels) ? r.panels as StreetExitSpec['panels'] : [])
      .filter(p => p && (p.kind === 'door' || p.kind === 'sidelight' || p.kind === 'transom') && [p.s0, p.s1, p.y0, p.y1].every(Number.isFinite) && p.s1 > p.s0 && p.y1 > p.y0)
      .map(p => ({...p}));
    out.push({
      id: String(r.id ?? `X${k + 1}`), level, streetY, nx, nz, plane, s0, s1, y0, y1, collider, view: {...view}, vestibule,
      hallCeil: num(hall?.ceil, num(ceilAt(level, hx, hz), y1 + 0.6)), panels: panels.length ? panels : defaultPanels(s0, s1, y0, y1),
      seed: num(r.seed, 7919 * (k + 1)) >>> 0,
    });
  });
  return out;
}

/** Panes of an opening when the record carries none: 0.9 m leaf pairs centred, sidelights, a transom above 2.3 m. */
export function defaultPanels(s0: number, s1: number, y0: number, y1: number): StreetExitSpec['panels'] {
  const out: {kind: 'door' | 'sidelight' | 'transom'; s0: number; s1: number; y0: number; y1: number}[] = [];
  const w = s1 - s0, pairs = w >= 4.4 ? 2 : 1, doors = pairs * 1.8 + (pairs - 1) * 0.1;
  const a = s0 + Math.max(0, (w - doors) / 2), top = Math.min(y0 + 2.3, y1 - 0.1);
  if (a - s0 > 0.05) out.push({kind: 'sidelight', s0, s1: a, y0, y1: top});
  for (let p = 0; p < pairs; p++) {
    const b = a + p * 1.9, lw = Math.min(0.9, (w - (a - s0) * 2) / (2 * pairs));
    out.push({kind: 'door', s0: b, s1: b + lw, y0, y1: top}, {kind: 'door', s0: b + lw, s1: b + 2 * lw, y0, y1: top});
  }
  const end = out[out.length - 1].s1;
  if (s1 - end > 0.05) out.push({kind: 'sidelight', s0: end, s1, y0, y1: top});
  if (y1 - top > 0.15) out.push({kind: 'transom', s0, s1, y0: top + 0.05, y1});
  return out;
}

/** The culler aperture of an exit (the glazed opening on its hall-side plane). */
export const apertureOf = (s: StreetExitSpec): StreetExitAperture => ({nx: s.nx, nz: s.nz, plane: s.plane, s0: s.s0, s1: s.s1, y0: s.y0, y1: s.y1});

/**
 * Cuts each exit's opening out of the built wall faces on its hall-side plane (the face whose normal points into the hall, on the
 * exit's storey): an opening from the face bottom to the door head (min the face top), exactly like the lift doorways
 * (world/officeProps.ts cutOfficeShaftDoors). Collision is untouched (GEN's SOLID cells / collider).
 */
export function cutExitOpenings<F extends {level: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; nx: number; nz: number; slope?: unknown; openings: {s0: number; s1: number; top: number}[]}>(faces: F[], exits: readonly StreetExitSpec[]): F[] {
  if (!exits.length) return faces;
  return faces.map(f => {
    if (f.slope) return f;
    const fAlongX = Math.abs(f.z0 - f.z1) < 1e-9;
    let out = f;
    for (const e of exits) {
      const alongX = e.nz !== 0;
      if (f.level !== e.level || fAlongX !== alongX || Math.abs((fAlongX ? f.z0 : f.x0) - e.plane) > 1e-6) continue;
      const fn = fAlongX ? f.nz : f.nx;
      if (Math.sign(fn) !== -Math.sign(alongX ? e.nz : e.nx)) continue; // the hall-side face only
      const a0 = Math.min(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1), a1 = Math.max(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1);
      const s0 = Math.max(a0, e.s0), s1 = Math.min(a1, e.s1);
      if (s1 - s0 < 1e-4 || f.y0 >= e.y1 - 1e-4 || f.y1 <= e.y0 + 1e-4) continue;
      out = {...out, openings: [...out.openings, {s0: s0 - a0, s1: s1 - a0, top: Math.min(e.y1, f.y1)}]};
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The exit's local frame: u along the opening, y up from the street, w outward. along = (nz, 0, -nx) makes [along | up | out] a
// proper rotation (no winding flip).

export interface ExitFrame { origin: THREE.Vector3; along: THREE.Vector3; out: THREE.Vector3; m: THREE.Matrix4; inv: THREE.Matrix4 }
export function exitFrame(s: StreetExitSpec): ExitFrame {
  const alongX = s.nz !== 0, c = (s.s0 + s.s1) / 2;
  const origin = new THREE.Vector3(alongX ? c : s.plane, s.streetY, alongX ? s.plane : c);
  const along = new THREE.Vector3(s.nz, 0, -s.nx), out = new THREE.Vector3(s.nx, 0, s.nz);
  const m = new THREE.Matrix4().makeBasis(along, new THREE.Vector3(0, 1, 0), out).setPosition(origin);
  return {origin, along, out, m, inv: m.clone().invert()};
}

/** A world box in the exit frame: [u0, u1], [y0, y1] (relative to the street), [w0, w1]. */
function localBox(f: ExitFrame, b: {x0: number; z0: number; x1: number; z1: number; y0: number; y1: number}, streetY: number) {
  const v = new THREE.Vector3();
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) {
    v.set(x, streetY, z).applyMatrix4(f.inv);
    u0 = Math.min(u0, v.x); u1 = Math.max(u1, v.x); w0 = Math.min(w0, v.z); w1 = Math.max(w1, v.z);
  }
  return {u0, u1, w0, w1, y0: b.y0 - streetY, y1: b.y1 - streetY};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Atlas (one canvas for every exit: facades, ground, signage, boards; generic words only)

export const STREET_ATLAS_SIZE = 1024;
/** Atlas cells (px: x, y from the top, w, h) and the size (m) one repeat covers (tiling cells; 0 = stretched once). */
export const STREET_CELLS = {
  facadeOffice: {px: [0, 0, 256, 256], tile: [6.4, 6.8]},
  facadeBrick: {px: [256, 0, 256, 256], tile: [6.4, 6.8]},
  facadeGlass: {px: [512, 0, 256, 256], tile: [6.4, 6.8]},
  facadeRender: {px: [768, 0, 256, 256], tile: [6.4, 6.8]},
  shopA: {px: [0, 256, 256, 128], tile: [6.4, 4.2]},
  shopB: {px: [256, 256, 256, 128], tile: [6.4, 4.2]},
  paving: {px: [512, 256, 128, 128], tile: [2, 2]},
  asphalt: {px: [640, 256, 128, 128], tile: [4, 4]},
  lane: {px: [768, 256, 128, 128], tile: [4, 4]},
  curb: {px: [896, 256, 128, 64], tile: [2, 0.4]},
  roof: {px: [896, 320, 64, 64], tile: [4, 4]},
  white: {px: [960, 320, 32, 32], tile: [1, 1]},
  dirt: {px: [992, 320, 32, 32], tile: [3, 3]},
  plywood: {px: [0, 384, 256, 128], tile: [0, 0]},
  sign: {px: [256, 384, 512, 128], tile: [0, 0]},
  notice: {px: [768, 384, 192, 256], tile: [0, 0]},
  noExit: {px: [0, 512, 256, 128], tile: [0, 0]},
  mat: {px: [256, 512, 128, 128], tile: [0, 0]},
  tile: {px: [384, 512, 128, 128], tile: [1.2, 1.2]},
  soffit: {px: [512, 512, 128, 128], tile: [1.2, 1.2]},
  paint: {px: [640, 512, 128, 128], tile: [2, 2]},
} as const;
export type StreetCell = keyof typeof STREET_CELLS;
/** Words drawn on the atlas (tests: legible lock, generic text only). */
export const STREET_WORDS = {sign: ['EXIT CLOSED', 'DOORS LOCKED'], notice: ['NOTICE', 'THIS EXIT', 'IS LOCKED', 'MALL CLOSED', 'PLEASE USE', 'THE SUBWAY'], noExit: ['NO EXIT'], shops: ['DELI', 'LAUNDRY', 'PAWN', 'BAR', 'HARDWARE', 'DINER']} as const;

/** UV rect (x, y, w, h in 0..1, three's flipY: v = 0 at the image bottom) of a cell, inset by `pad` px. */
export function cellRect(c: StreetCell, pad = 2): [number, number, number, number] {
  const [x, y, w, h] = STREET_CELLS[c].px, S = STREET_ATLAS_SIZE;
  return [(x + pad) / S, 1 - (y + h - pad) / S, (w - 2 * pad) / S, (h - 2 * pad) / S];
}

let atlasTex: THREE.CanvasTexture | null = null;
/** The shared street-exit atlas (drawn once per page load; deterministic). */
export function streetAtlas(): THREE.CanvasTexture {
  if (atlasTex) return atlasTex;
  const S = STREET_ATLAS_SIZE;
  atlasTex = canvasTexture(S, S, 61031, (ctx, _w, _h, rnd) => {
    const cell = (c: StreetCell) => STREET_CELLS[c].px;
    const fill = (col: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    const grime = (x: number, y: number, w: number, h: number, n: number, a: number) => {
      for (let i = 0; i < n; i++) { const g = Math.floor(rnd() * 40); ctx.fillStyle = `rgba(${g}, ${g}, ${g - 4 < 0 ? 0 : g - 4}, ${a * rnd()})`; ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 4, 1 + rnd() * 4); }
    };
    const soot = (x: number, w: number, top: number, len: number) => {
      const g = ctx.createLinearGradient(0, top, 0, top - len);
      g.addColorStop(0, `rgba(12, 11, 10, ${0.3 + rnd() * 0.4})`); g.addColorStop(1, 'rgba(12, 11, 10, 0)');
      ctx.fillStyle = g; ctx.fillRect(x, top - len, w, len);
    };
    // --- facades: 2 bays x 2 storeys per cell (the cell bottom = the lower storey's floor) ---
    const windows = (cx: number, cy: number, frame: string, wall: (x: number, y: number, w: number, h: number) => void, win: [number, number, number, number]) => {
      for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
        const x = cx + bx * 128, y = cy + by * 128;
        wall(x, y, 128, 128);
        const [wx, wy, ww, wh] = win;
        const r = rnd();
        fill(frame, x + wx - 3, y + wy - 3, ww + 6, wh + 6);
        fill(r < 0.14 ? '#5c4a34' : r < 0.22 ? '#2b2420' : r < 0.3 ? '#28302c' : '#0b0c0d', x + wx, y + wy, ww, wh); // boards / burnt / dirty glass / hole
        if (r >= 0.22 && r < 0.3) { ctx.strokeStyle = 'rgba(160, 170, 160, 0.35)'; ctx.beginPath(); ctx.moveTo(x + wx, y + wy + wh * 0.3); ctx.lineTo(x + wx + ww * 0.6, y + wy + wh); ctx.stroke(); }
        if (r > 0.95) fill('rgba(255, 140, 60, 0.4)', x + wx + 6, y + wy + wh * 0.55, ww - 12, wh * 0.3); // a fire inside
        soot(x + wx - 4, ww + 8, y + wy, 30 + rnd() * 40);
      }
    };
    {
      const [x0, y0] = cell('facadeOffice');
      windows(x0, y0, '#3d3b38', (x, y, w, h) => { fill('#77726b', x, y, w, h); fill('#625e58', x, y + h - 22, w, 22); }, [16, 26, 96, 70]);
      grime(x0, y0, 256, 256, 500, 0.35);
    }
    {
      const [x0, y0] = cell('facadeBrick');
      windows(x0, y0, '#bdb3a2', (x, y, w, h) => {
        fill('#6e3f2e', x, y, w, h);
        ctx.fillStyle = 'rgba(40, 24, 18, 0.5)';
        for (let ry = 0; ry < h; ry += 8) { ctx.fillRect(x, y + ry, w, 1); for (let rx = (ry / 8) % 2 ? 0 : 8; rx < w; rx += 16) ctx.fillRect(x + rx, y + ry, 1, 8); }
      }, [30, 30, 68, 74]);
      grime(x0, y0, 256, 256, 600, 0.4);
    }
    {
      const [x0, y0] = cell('facadeGlass');
      fill('#2d3236', x0, y0, 256, 256);
      for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
        const r = rnd();
        fill(r < 0.2 ? '#050606' : r < 0.3 ? '#4d5552' : `rgb(${22 + gx * 2}, ${30 + gy * 2}, ${32 + gy})`, x0 + gx * 32 + 2, y0 + gy * 32 + 2, 28, 28);
      }
      for (let k = 0; k < 2; k++) fill('#55595a', x0, y0 + k * 128 + 118, 256, 10); // spandrel bands
      grime(x0, y0, 256, 256, 400, 0.3);
    }
    {
      const [x0, y0] = cell('facadeRender');
      windows(x0, y0, '#d6cfbf', (x, y, w, h) => { fill('#a69c88', x, y, w, h); fill('#3c3a36', x + 12, y + h - 10, w - 24, 6); }, [28, 22, 72, 80]);
      grime(x0, y0, 256, 256, 700, 0.45);
    }
    // --- ground-floor shopfronts: rolled shutters with tags / broken boarded windows; a faded fascia with a generic word ---
    for (const [c, word, word2] of [['shopA', 'DELI', 'LAUNDRY'], ['shopB', 'PAWN', 'DINER']] as const) {
      const [x0, y0] = cell(c);
      fill('#4a4844', x0, y0, 256, 128);
      for (let bx = 0; bx < 2; bx++) {
        const x = x0 + bx * 128;
        fill('#2b2a28', x + 4, y0 + 4, 120, 26); // fascia
        ctx.fillStyle = 'rgba(200, 186, 150, 0.55)'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(bx ? word2 : word, x + 64, y0 + 17);
        if (c === 'shopA') { // a rolled-down shutter
          fill('#6b6c69', x + 10, y0 + 34, 108, 94);
          ctx.fillStyle = 'rgba(30, 30, 30, 0.45)'; for (let s = 0; s < 94; s += 5) ctx.fillRect(x + 10, y0 + 34 + s, 108, 1);
          ctx.strokeStyle = `rgba(${120 + Math.floor(rnd() * 100)}, 40, 60, 0.6)`; ctx.lineWidth = 3; ctx.beginPath();
          ctx.moveTo(x + 22, y0 + 90); for (let k = 0; k < 5; k++) ctx.lineTo(x + 30 + k * 16, y0 + 70 + rnd() * 30); ctx.stroke();
        } else { // broken display window, part boarded
          fill('#08090a', x + 10, y0 + 34, 108, 94);
          fill('#6a5638', x + 10 + rnd() * 30, y0 + 60, 60, 68);
        }
      }
      grime(x0, y0, 256, 128, 300, 0.4);
    }
    // --- ground ---
    {
      const [x0, y0] = cell('paving');
      fill('#7b7872', x0, y0, 128, 128);
      ctx.fillStyle = 'rgba(40, 38, 35, 0.6)';
      for (let k = 0; k <= 2; k++) { ctx.fillRect(x0 + k * 64 - (k ? 1 : 0), y0, 2, 128); ctx.fillRect(x0, y0 + k * 64 - (k ? 1 : 0), 128, 2); }
      grime(x0, y0, 128, 128, 300, 0.35);
      ctx.fillStyle = 'rgba(52, 70, 34, 0.7)'; for (let i = 0; i < 40; i++) ctx.fillRect(x0 + (rnd() < 0.5 ? 63 : rnd() * 128), y0 + rnd() * 128, 2, 2); // weeds in the joints
    }
    for (const c of ['asphalt', 'lane'] as const) {
      const [x0, y0] = cell(c);
      fill('#2f2f30', x0, y0, 128, 128);
      grime(x0, y0, 128, 128, 500, 0.5);
      ctx.strokeStyle = 'rgba(14, 14, 14, 0.8)'; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); let x = x0 + rnd() * 128, y = y0 + rnd() * 128; ctx.moveTo(x, y); for (let s = 0; s < 6; s++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; ctx.lineTo(x, y); } ctx.stroke(); }
      if (c === 'lane') { ctx.fillStyle = 'rgba(196, 172, 96, 0.5)'; ctx.fillRect(x0, y0 + 62, 60, 4); } // faded dashed centre line (along u)
    }
    { const [x0, y0] = cell('curb'); fill('#8a8780', x0, y0, 128, 64); fill('#6c6a64', x0, y0 + 30, 128, 34); grime(x0, y0, 128, 64, 160, 0.4); }
    { const [x0, y0] = cell('roof'); fill('#2a2826', x0, y0, 64, 64); grime(x0, y0, 64, 64, 80, 0.4); }
    { const [x0, y0] = cell('white'); fill('#ffffff', x0, y0, 32, 32); }
    { const [x0, y0] = cell('dirt'); fill('#3d3a35', x0, y0, 32, 32); grime(x0, y0, 32, 32, 40, 0.5); }
    // --- door set dressing ---
    {
      const [x0, y0] = cell('plywood');
      fill('#a9875a', x0, y0, 256, 128);
      ctx.strokeStyle = 'rgba(110, 80, 44, 0.5)'; ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) { ctx.beginPath(); const y = y0 + rnd() * 128; ctx.moveTo(x0, y); ctx.bezierCurveTo(x0 + 80, y + (rnd() - 0.5) * 12, x0 + 170, y + (rnd() - 0.5) * 12, x0 + 256, y + (rnd() - 0.5) * 8); ctx.stroke(); }
      ctx.fillStyle = '#3a3a3a'; for (const [sx, sy] of [[8, 8], [248, 8], [8, 120], [248, 120], [128, 8], [128, 120]]) ctx.fillRect(x0 + sx - 2, y0 + sy - 2, 4, 4);
      ctx.fillStyle = 'rgba(30, 24, 18, 0.35)'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CLOSED', x0 + 128, y0 + 66);
      grime(x0, y0, 256, 128, 260, 0.35);
    }
    {
      const [x0, y0] = cell('sign');
      fill('#f2eee6', x0, y0, 512, 128);
      ctx.fillStyle = '#c4161c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 62px sans-serif'; ctx.fillText(STREET_WORDS.sign[0], x0 + 256, y0 + 50);
      ctx.font = 'bold 28px sans-serif'; ctx.fillText(STREET_WORDS.sign[1], x0 + 256, y0 + 104);
      grime(x0, y0, 512, 128, 200, 0.25);
    }
    {
      const [x0, y0] = cell('notice');
      fill('#e8e0c8', x0, y0, 192, 256);
      ctx.fillStyle = '#c4161c'; fill('#c4161c', x0 + 8, y0 + 10, 176, 36);
      ctx.fillStyle = '#f4efe2'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(STREET_WORDS.notice[0], x0 + 96, y0 + 29);
      ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 22px sans-serif';
      STREET_WORDS.notice.slice(1).forEach((t, i) => ctx.fillText(t, x0 + 96, y0 + 72 + i * 34 + (i >= 2 ? 10 : 0)));
      fill('rgba(220, 210, 170, 0.75)', x0, y0, 30, 14); fill('rgba(220, 210, 170, 0.75)', x0 + 162, y0, 30, 14); // tape
      grime(x0, y0, 192, 256, 160, 0.25);
    }
    {
      const [x0, y0] = cell('noExit');
      fill('#b5161b', x0, y0, 256, 128);
      ctx.strokeStyle = '#f4efe2'; ctx.lineWidth = 5; ctx.strokeRect(x0 + 8, y0 + 8, 240, 112);
      ctx.fillStyle = '#f4efe2'; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(STREET_WORDS.noExit[0], x0 + 128, y0 + 66);
      grime(x0, y0, 256, 128, 120, 0.25);
    }
    { const [x0, y0] = cell('mat'); fill('#232322', x0, y0, 128, 128); ctx.fillStyle = 'rgba(70, 70, 66, 0.6)'; for (let i = 6; i < 128; i += 8) ctx.fillRect(x0 + 6, y0 + i, 116, 3); grime(x0, y0, 128, 128, 120, 0.4); }
    { const [x0, y0] = cell('tile'); fill('#8d8a83', x0, y0, 128, 128); ctx.fillStyle = 'rgba(50, 48, 44, 0.6)'; ctx.fillRect(x0, y0 + 63, 128, 2); ctx.fillRect(x0 + 63, y0, 2, 128); grime(x0, y0, 128, 128, 200, 0.35); }
    { const [x0, y0] = cell('soffit'); fill('#cfccc4', x0, y0, 128, 128); ctx.fillStyle = 'rgba(80, 78, 72, 0.5)'; ctx.fillRect(x0, y0 + 63, 128, 2); ctx.fillRect(x0 + 63, y0, 2, 128); grime(x0, y0, 128, 128, 150, 0.3); }
    { const [x0, y0] = cell('paint'); fill('#b9b2a4', x0, y0, 128, 128); grime(x0, y0, 128, 128, 260, 0.35); }
  });
  atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;
  atlasTex.name = 'mall-street-atlas';
  return atlasTex;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Materials (shared by every exit: one program each)

/** Street-exit shading knobs (uniforms; QA: streetExitTune). */
export const STREET_EXIT = {light: 1.25, cards: 1.0, glass: 1.0, glow: 0.55} as const;
const indoorHaze = new THREE.Color(MALL_FOG.color);
export const STREET_U = {
  light: uniform(STREET_EXIT.light),
  cards: uniform(STREET_EXIT.cards),
  glass: uniform(STREET_EXIT.glass),
  glow: uniform(STREET_EXIT.glow),
  /** The mall's indoor haze (linear rgb, FogExp2 density) over the indoor part of a view ray (world/mallAtmosphere.ts MALL_FOG). */
  haze: uniform(new THREE.Vector4(indoorHaze.r, indoorHaze.g, indoorHaze.b, MALL_FOG.density)),
};

/** Fake outdoor light (the Office city's): hemisphere (EXT_U.sky / ground) + the weak low sun. */
const outdoorLight = (n: AnyNode): AnyNode => mix(EXT_U.ground, EXT_U.sky, n.y.mul(0.5).add(0.5)).add(EXT_U.sun.mul(max(dot(n, EXT_U.sunDir), 0)));

/**
 * Optical depth of the Office's outdoor green fog over L m of ray from eye height hc to point height hp above the street (world/exterior.ts
 * fogDepth, the same EXT_U uniforms): base x L + ground x mean(exp(-h / height)) x L + (L / range)^2.
 */
const fogDepth = (L: AnyNode, hc: AnyNode, hp: AnyNode): AnyNode => {
  const H = max(EXT_U.fogHeight, 0.5);
  const ec = exp(hc.negate().div(H)), ep = exp(hp.negate().div(H));
  const dh = hp.sub(hc);
  const meanE = select(abs(dh).lessThan(0.25), exp(hc.add(hp).mul(0.5).negate().div(H)), H.mul(ec.sub(ep)).div(select(abs(dh).lessThan(0.25), float(1), dh)));
  const r = L.div(max(EXT_U.fogRange, 1));
  return EXT_U.hazeDensity.add(EXT_U.fogGround.mul(meanE)).mul(L).add(r.mul(r));
};

/** Fraction of the eye -> point ray inside the mall (before it crosses the exit plane aExit = (nx, nz, d, streetY)). */
const insideFraction = (ex: AnyNode): AnyNode => {
  const n2 = vec2(ex.x, ex.y);
  const dC = dot(n2, cameraPosition.xz).sub(ex.z), dP = dot(n2, positionWorld.xz).sub(ex.z);
  return clamp(dC.negate().div(max(dP.sub(dC), 1e-3)), 0, 1);
};

/** The mall's indoor FogExp2 over the indoor part of the ray (three's FogExp2 uses the view depth). */
const indoorHazeOver = (col: AnyNode, tIn: AnyNode): AnyNode => {
  const d = STREET_U.haze.w.mul(positionView.z.negate().mul(tIn));
  return mix(col, STREET_U.haze.xyz, float(1).sub(exp(d.mul(d).negate())));
};

let streetMat: MeshBasicNodeMaterial | null = null;
/**
 * The street view: atlas albedo (tiling cells: aCell = the cell's uv rect, uv = repeats, gradient-correct sampling) x vertex colour x the
 * Office outdoor light, fogged by the Office's outdoor height fog over the outdoor part of the ray toward the roof sky's horizon murk;
 * backdrop faces (aCell.z < 0) = the roof's sky colour along the ray. Unlit, never three-fogged, opaque.
 */
export function streetExitMaterial(): MeshBasicNodeMaterial {
  if (streetMat) return streetMat;
  const m = new MeshBasicNodeMaterial({fog: false});
  m.name = 'mall-exit-street';
  const atlas = streetAtlas();
  m.colorNode = Fn(() => {
    const ex = attribute('aExit', 'vec4') as AnyNode, cell = attribute('aCell', 'vec4') as AnyNode;
    const C = cameraPosition, P = positionWorld, D = P.sub(C).toVar();
    const dist = length(D), dir = D.div(max(dist, 1e-3)).toVar();
    const tIn = insideFraction(ex).toVar();
    const outside = dist.mul(float(1).sub(tIn));
    const hc = max(C.y.sub(ex.w), 0), hp = max(P.y.sub(ex.w), 0);
    const drift = time.mul(EXT_U.fogDrift);
    const patch = wmNoise((vec3 as AnyNode)(P.x.add(drift).div(38), P.y.div(24), P.z.sub(drift.mul(0.4)).div(38))) as AnyNode;
    const tau = fogDepth(outside, hc, hp).mul(float(1).add(EXT_U.fogNoise.mul(patch.sub(0.5)).mul(2)));
    // the street dissolves into the murk toward the view volume's far / side faces (aView = its world box; the near side, at the
    // facade, excluded via the outward normal): no hard seam where the street meets the backdrop
    const vw = attribute('aView', 'vec4') as AnyNode, BIG = 1e3;
    const dx0 = P.x.sub(vw.x).add(step(0.5, ex.x).mul(BIG)), dx1 = vw.z.sub(P.x).add(step(0.5, ex.x.negate()).mul(BIG));
    const dz0 = P.z.sub(vw.y).add(step(0.5, ex.y).mul(BIG)), dz1 = vw.w.sub(P.z).add(step(0.5, ex.y.negate()).mul(BIG));
    const fadeL = clamp(min(vw.z.sub(vw.x), vw.w.sub(vw.y)).mul(0.2), 1.5, 5);
    const edge = float(1).sub(smoothstep(0.2, fadeL, min(min(dx0, dx1), min(dz0, dz1))));
    const outF = max(float(1).sub(exp(tau.negate())), edge);
    const t = uv() as AnyNode, span = abs(cell.zw) as AnyNode;
    const a = cell.xy.add(fract(t).mul(span));
    const tex = (texture(atlas, a) as AnyNode).grad(dFdx(t).mul(span), dFdy(t).mul(span)).rgb;
    const lit = tex.mul(attribute('color', 'vec3')).mul(outdoorLight(normalize(normalWorld as AnyNode))).mul(STREET_U.light);
    const street = mix(lit, murkAt(dir), outF);
    const col = select((cell.z as AnyNode).lessThan(0), mallSkyColour(dir), street);
    return vec3(indoorHazeOver(col, tIn));
  })();
  return (streetMat = m);
}

let cardMat: MeshBasicNodeMaterial | null = null;
/**
 * Drifting murk layers outside the glass: the gas colour of the roof exterior (lit rims / dark cores, the Office hue), opacity = the
 * slice's Office fog opacity (aCard.x) x the thick-patch structure of drifting world noise x soft edges (uv) x STREET_U.cards.
 */
export function streetFogCardMaterial(): MeshBasicNodeMaterial {
  if (cardMat) return cardMat;
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false});
  m.name = 'mall-exit-fog';
  const ex = attribute('aExit', 'vec4') as AnyNode, card = attribute('aCard', 'vec2') as AnyNode;
  const dir = normalize(positionWorld.sub(cameraPosition) as AnyNode) as AnyNode;
  const dens = gasDensity(positionWorld, 7);
  const t = uv() as AnyNode;
  const edge = smoothstep(0, 0.12, t.x).mul(smoothstep(0, 0.12, float(1).sub(t.x))).mul(smoothstep(0, 0.25, float(1).sub(t.y)));
  const foot = smoothstep(0.0, 0.7, positionWorld.y.sub(ex.w)); // soft where a card meets the street (no seam line)
  m.colorNode = gasColour(dir, dens.mul(0.6).add(0.2));
  m.opacityNode = clamp(card.x.mul(smoothstep(0.32, 0.82, dens)).mul(edge).mul(select(card.y.greaterThan(0.5), float(1), foot)).mul(STREET_U.cards), 0, 0.85);
  return (cardMat = m);
}

let glassMat: MeshBasicNodeMaterial | null = null;
/**
 * The doors' glass: unlit, dirty (smears, a grime band low down and round the edges, hand marks at push height), a faint murk tint,
 * grazing views denser; transparent, double-sided, DEPTH-WRITING (the interior haze stops at it, like the roof glass) — never a shadow
 * caster. uv = pane-local 0..1.
 */
export function streetExitGlassMaterial(): MeshBasicNodeMaterial {
  if (glassMat) return glassMat;
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false});
  m.name = 'mall-exit-glass';
  const t = uv() as AnyNode;
  const P = positionWorld as AnyNode;
  const smear = wmNoise(P.mul(vec3(2.2, 3.1, 2.2))) as AnyNode, fine = wmNoise(P.mul(11)) as AnyNode;
  const e = (t.x as AnyNode).min(t.x.oneMinus()).min(t.y.min(t.y.oneMinus()));
  const edge = float(1).sub(smoothstep(0.0, 0.12, e));
  const low = float(1).sub(smoothstep(0.05, 0.3, t.y));
  const v = normalize(cameraPosition.sub(positionWorld) as AnyNode);
  const fres = float(1).sub(abs(dot(normalize(normalWorld as AnyNode), v))).pow(2.5);
  const grime = clamp(smoothstep(0.45, 0.85, smear).mul(0.22).add(edge.mul(0.18)).add(low.mul(0.2)).add(fine.mul(0.06)), 0, 0.6);
  m.colorNode = mix(hazeSatNode().mul(1.4), vec3(0.2, 0.19, 0.16), clamp(grime.mul(1.6), 0, 1));
  m.opacityNode = clamp(float(0.1).add(grime).add(fres.mul(0.35)).mul(STREET_U.glass), 0, 0.92);
  return (glassMat = m);
}
/** (lazy import of the murk colour node for the glass tint) */
const hazeSatNode = (): AnyNode => murkAt(vec3(0, 0, 1));

let frameMat: MeshStandardNodeMaterial | null = null;
/** The door sets / vestibule / lock / signage: lit standard material, atlas map x vertex colour; the sign glows dimly (aGlow). */
export function streetExitFrameMaterial(): MeshStandardNodeMaterial {
  if (frameMat) return frameMat;
  const atlas = streetAtlas();
  const m = new MeshStandardNodeMaterial({map: atlas, vertexColors: true, roughness: 0.55, metalness: 0.15});
  m.name = 'mall-exit-frame';
  m.emissiveNode = (texture(atlas, uv()) as AnyNode).rgb.mul(attribute('aGlow', 'float')).mul(STREET_U.glow);
  return (frameMat = m);
}

/** Every material a street exit uses (warm-up coverage tests). */
export function streetExitMaterials(): THREE.Material[] {
  return [streetExitMaterial(), streetFogCardMaterial(), streetExitGlassMaterial(), streetExitFrameMaterial()];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry accumulation (local exit frame; transformed to world once)

class Acc {
  readonly a: Record<string, number[]> = {};
  readonly idx: number[] = [];
  /** `defaults`: per-mesh constant attributes (used when a vertex's extras omit them). */
  constructor(readonly sizes: Record<string, number>, readonly defaults: Record<string, readonly number[]> = {}) { for (const k of Object.keys(sizes)) this.a[k] = []; }
  get count(): number { return this.a.position.length / 3; }
  get empty(): boolean { return !this.idx.length; }
  /** Quad p0..p3 (local [u, y, w]); winding fixed to face `n`; uv per corner; constant extras. */
  quad(p: readonly V3[], n: V3, uvs: readonly (readonly [number, number])[], extra: Record<string, readonly number[]> = {}): void {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const d = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
    const order = d < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const b = this.count;
    for (const i of order) this.vert(p[i], n, uvs[i], extra);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  vert(p: readonly number[], n: readonly number[], t: readonly number[], extra: Record<string, readonly number[]>): void {
    this.a.position.push(p[0], p[1], p[2]);
    this.a.normal.push(n[0], n[1], n[2]);
    this.a.uv.push(t[0], t[1]);
    for (const k of Object.keys(this.sizes)) {
      if (k === 'position' || k === 'normal' || k === 'uv') continue;
      const v = extra[k] ?? this.defaults[k], s = this.sizes[k];
      for (let i = 0; i < s; i++) this.a[k].push(v?.[i] ?? 0);
    }
  }
  /** Append a non-indexed / indexed geometry already in local coordinates (its own normals; uv 0), constant extras. */
  geometry(g: THREE.BufferGeometry, mat: THREE.Matrix4, extra: Record<string, readonly number[]>, colorFromGeometry = false): void {
    const P = g.attributes.position, N = g.attributes.normal, Cc = g.attributes.color;
    const nm = new THREE.Matrix3().getNormalMatrix(mat), v = new THREE.Vector3(), n = new THREE.Vector3();
    const b = this.count;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mat);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      const ex = colorFromGeometry && Cc ? {...extra, color: [Cc.getX(i), Cc.getY(i), Cc.getZ(i)]} : extra;
      this.vert([v.x, v.y, v.z], [n.x, n.y, n.z], [0, 0], ex);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(b + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(b + i);
  }
  /** World mesh: positions / normals through the exit frame; null when empty. */
  mesh(f: ExitFrame, mat: THREE.Material, name: string): THREE.Mesh | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    const pos = this.a.position, nor = this.a.normal, v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(f.m); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z;
      v.set(nor[i], nor[i + 1], nor[i + 2]).transformDirection(f.m); nor[i] = v.x; nor[i + 1] = v.y; nor[i + 2] = v.z;
    }
    for (const [k, s] of Object.entries(this.sizes)) g.setAttribute(k, new THREE.Float32BufferAttribute(this.a[k], s));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/** Axis-aligned local box [u0, u1] x [y0, y1] x [w0, w1]: six quads; `face(n, corners)` returns uv + extras per face. */
function box(acc: Acc, u0: number, u1: number, y0: number, y1: number, w0: number, w1: number,
  face: (n: V3, c: V3[]) => {uv: [number, number][]; extra: Record<string, readonly number[]>} | null): void {
  if (u1 - u0 < 1e-5 || y1 - y0 < 1e-5 || w1 - w0 < 1e-5) return;
  const F: [V3, V3[]][] = [
    [[0, 0, -1], [[u0, y0, w0], [u1, y0, w0], [u1, y1, w0], [u0, y1, w0]]],
    [[0, 0, 1], [[u1, y0, w1], [u0, y0, w1], [u0, y1, w1], [u1, y1, w1]]],
    [[-1, 0, 0], [[u0, y0, w1], [u0, y0, w0], [u0, y1, w0], [u0, y1, w1]]],
    [[1, 0, 0], [[u1, y0, w0], [u1, y0, w1], [u1, y1, w1], [u1, y1, w0]]],
    [[0, 1, 0], [[u0, y1, w0], [u1, y1, w0], [u1, y1, w1], [u0, y1, w1]]],
    [[0, -1, 0], [[u0, y0, w1], [u1, y0, w1], [u1, y0, w0], [u0, y0, w0]]],
  ];
  for (const [n, c] of F) { const r = face(n, c); if (r) acc.quad(c, n, r.uv, r.extra); }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The street plan (pure data, local frame; tests check it stays inside the view volume)

export interface StreetBuilding { u0: number; u1: number; w0: number; w1: number; h: number; kind: 'office' | 'brick' | 'glass' | 'render' | 'collapsed'; shop: 'shopA' | 'shopB'; seed: number; row: 1 | 2 }
export interface StreetPlan {
  /** Local view volume: u, w (outward from the hall-side plane) and y (above the street). */
  vol: {u0: number; u1: number; w0: number; w1: number; y0: number; y1: number};
  /** Building line (outer door set / where the pavement starts), pavement / road / far pavement bands (w). */
  B: number;
  pavement: [number, number]; road: [number, number]; farPavement: [number, number];
  buildings: StreetBuilding[];
  cars: {u: number; w: number; yaw: number; kind: 'car' | 'bus'}[];
  rubble: {u: number; w: number; s: number}[];
  lamps: {u: number; w: number}[];
  /** Fog card depths (w) and their slice opacities (the Office fog over the slice from the previous card). */
  cards: {w: number; opacity: number}[];
  ground: {y: number; opacity: number};
}

/** Lays out the street outside an exit inside its view volume (deterministic per seed). */
export function planStreet(s: StreetExitSpec): StreetPlan {
  const f = exitFrame(s);
  const lb = localBox(f, s.view, s.streetY);
  const vol = {u0: lb.u0, u1: lb.u1, w0: Math.max(lb.w0, 0), w1: lb.w1, y0: Math.max(lb.y0, -0.5), y1: lb.y1};
  const r = mulberry32(s.seed ^ 0x5eed);
  const B = Math.min(Math.max(s.vestibule, vol.w0), vol.w1 - 2);
  const D = vol.w1 - B; // depth of the volume beyond the building line (lane GEN: 12-30 m)
  // bands: pavement, curb, road, curb, far pavement, then the facades across the street (>= 1.5 m of building before the backdrop)
  const curb = 0.25, back = 0.3;
  const pav = Math.min(4, Math.max(2.5, 0.2 * D)), farPav = Math.min(3.5, Math.max(1.5, 0.1 * D));
  const road = Math.min(11, Math.max(5, D - back - pav - farPav - 2 * curb - Math.max(1.5, 0.35 * D)));
  const pavement: [number, number] = [B, B + pav];
  const roadB: [number, number] = [B + pav + curb, B + pav + curb + road];
  const farP: [number, number] = [roadB[1] + curb, roadB[1] + curb + farPav];
  const wF = farP[1];
  const buildings: StreetBuilding[] = [];
  const kinds: StreetBuilding['kind'][] = ['office', 'brick', 'glass', 'render'];
  const yTop = Math.max(6, vol.y1 - 1);
  // row 1: facades across the street (a side-street gap or two), row 2: taller silhouettes behind (seen through the gaps / above)
  for (const row of [1, 2] as const) {
    const w0 = row === 1 ? wF : wF + 16, wMax = vol.w1 - back;
    if (w0 + (row === 1 ? 1 : 4) > wMax) continue;
    let u = vol.u0 + 0.5, gaps = 0;
    while (u < vol.u1 - 2) {
      if (row === 1 && gaps < 2 && r() < 0.22 && u > vol.u0 + 6) { u += 8 + r() * 3; gaps++; continue; } // a cross street
      const bw = Math.min(vol.u1 - 0.5 - u, 7 + r() * 9);
      if (bw < 3) break;
      const set = Math.min(r() * 1.4, Math.max(0, wMax - w0 - 1));
      const d = row === 1 ? 8 + r() * 6 : 10 + r() * 12;
      const hMax = row === 1 ? 26 : 40;
      const h = Math.min(yTop, (row === 1 ? 9 : 18) + r() * (hMax - (row === 1 ? 9 : 18)));
      const collapsed = row === 1 && r() < 0.12;
      buildings.push({u0: u, u1: u + bw, w0: w0 + set, w1: Math.min(wMax, w0 + set + d), h: collapsed ? 3 + r() * 3 : h, kind: collapsed ? 'collapsed' : kinds[Math.floor(r() * 4)],
        shop: r() < 0.5 ? 'shopA' : 'shopB', seed: Math.floor(r() * 1e9), row});
      u += bw + (r() < 0.3 ? 0.6 + r() * 1.5 : 0);
    }
  }
  // wrecks on the road (never right in front of the doors on the near lane), rubble, lamp posts on the near curb
  const cars: StreetPlan['cars'] = [];
  const nCars = road >= 4.9 ? 2 + Math.floor(r() * 2) : 0;
  for (let i = 0; i < nCars; i++) {
    const near = r() < 0.5;
    const bus = i === 0 && road > 9 && vol.u1 - vol.u0 > 20 && r() < 0.35, half = bus ? 6.3 : 2.6;
    let u = vol.u0 + half + r() * Math.max(0, vol.u1 - vol.u0 - 2 * half);
    if (near && Math.abs(u) < 3.5) u = (u < 0 ? -1 : 1) * (3.5 + r() * 2);
    u = Math.min(vol.u1 - half, Math.max(vol.u0 + half, u));
    const w = near ? roadB[0] + road * 0.28 : roadB[0] + road * (0.62 + r() * 0.2);
    if (cars.some(c => Math.abs(c.u - u) < 5.5 && Math.abs(c.w - w) < 2.5)) continue;
    cars.push({u, w, yaw: (r() - 0.5) * (bus ? 0.2 : 0.7) + (!bus && r() < 0.15 ? Math.PI / 2 : 0), kind: bus ? 'bus' : 'car'});
  }
  const rubble: StreetPlan['rubble'] = [];
  for (const b of buildings) if (b.kind === 'collapsed') rubble.push({u: (b.u0 + b.u1) / 2, w: b.w0 - 0.5, s: 0.9 + r() * 0.5});
  if (r() < 0.6) rubble.push({u: vol.u0 + 2 + r() * (vol.u1 - vol.u0 - 4), w: farP[0] + farPav * 0.5, s: 0.4 + r() * 0.3});
  const lamps: StreetPlan['lamps'] = [];
  for (const sg of [-1, 1]) { const u = sg * (5.5 + r() * 4); if (u > vol.u0 + 0.5 && u < vol.u1 - 0.5 && pav > 1.5) lamps.push({u, w: pavement[1] - 0.35}); }
  // fog cards: parallax layers outside the glass; each carries the Office fog opacity of its slice (eye height 1.6 m)
  const cards: StreetPlan['cards'] = [];
  let prev = B;
  for (const d of [2.5, 6, 11, 17, 25, 35]) {
    const w = B + d;
    if (w > vol.w1 - 1) break;
    cards.push({w, opacity: exteriorFogOpacity(w - prev, 1.6, 1.6) * EXT_FOG.noise * 2});
    prev = w;
  }
  const ground = {y: 0.45, opacity: Math.min(0.8, exteriorFogOpacity(8, 0.45, 0.45) * EXT_FOG.noise * 2)};
  return {vol, B, pavement, road: roadB, farPavement: farP, buildings, cars, rubble, lamps, cards, ground};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Build

export interface StreetExitStats { id: string; meshes: number; triangles: number; panes: number; buildings: number; cards: number }
export interface StreetExitView { meshes: THREE.Mesh[]; stats: StreetExitStats; plan: StreetPlan; aperture: StreetExitAperture; frame: ExitFrame }

const ALU: V3[] = [[0.56, 0.57, 0.56], [0.2, 0.18, 0.15]];
const tint = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k];

/** Builds one exit's four meshes (frame, glass, street, fog cards) in world space, tagged with its storey and aperture. */
export function buildStreetExit(s: StreetExitSpec): StreetExitView {
  const f = exitFrame(s);
  const plan = planStreet(s);
  const r = mulberry32(s.seed ^ 0xd00c);
  const exitAttr = (() => {
    // the exit plane in world: n . (x, z) = d (outward normal), the street y
    const d = s.nx * f.origin.x + s.nz * f.origin.z;
    return [s.nx, s.nz, d, s.streetY];
  })();
  // door-set heights are from the opening's floor (oy above the street; 0 when the hall floor is the pavement level)
  const hs = (s.s1 - s.s0) / 2, H = s.y1 - s.y0, B = plan.B, oy = s.y0 - s.streetY;
  // GEN's collider in local w (the SOLID cells behind the plane): the inner locked set stands just behind the hall-side plane, inside
  // it (visual = collision: the hall's last open cell ends at the plane, the glass is the first thing in the rock); the outer set in
  // the facade plane at the pocket's far end (also inside the collider when the pocket is GEN's)
  const cb = localBox(f, s.collider, s.streetY);
  const cw0 = Math.max(cb.w0, 0), cw1 = Math.max(cw0 + 0.08, Math.min(cb.w1, B));
  const wc = Math.min(cw0 + 0.12, (cw0 + cw1) / 2);
  const twoSets = B > 1.2;
  const wO = Math.max(wc + 0.6, Math.min(B, cw1) - 0.1);
  const finish = ALU[r() < 0.65 ? 0 : 1];
  // GEN's panes in local u (sorted), clamped inside the jambs
  const J = 0.08;
  const toU = (sw: number): number => (s.nz !== 0 ? (s.nz > 0 ? sw - f.origin.x : f.origin.x - sw) : (s.nx > 0 ? f.origin.z - sw : sw - f.origin.z));
  const panels = s.panels.map(p => {
    const a = toU(p.s0), b = toU(p.s1);
    return {kind: p.kind, u0: Math.max(-hs + J, Math.min(a, b)), u1: Math.min(hs - J, Math.max(a, b)), y0: p.y0 - s.y0, y1: p.y1 - s.y0};
  }).filter(p => p.u1 - p.u0 > 0.05).sort((p, q) => p.u0 - q.u0);

  // ---- FRAME + GLASS ------------------------------------------------------------------------------------------------------
  const frame = new Acc({position: 3, normal: 3, uv: 2, color: 3, aGlow: 1});
  const glassFar = new Acc({position: 3, normal: 3, uv: 2}), glassNear = new Acc({position: 3, normal: 3, uv: 2});
  let panes = 0;
  const atlasUv = (c: StreetCell, corners: [number, number][]) => { const [x, y, w, h] = cellRect(c); return corners.map(([a, b]) => [x + a * w, y + b * h] as [number, number]); };
  const solid = (col: V3, cell: StreetCell = 'white', glow = 0) => (n: V3, c: V3[]) => {
    // plain parts: the white texel (vertex colour carries the finish); textured parts: the cell stretched over the face
    const uvq = cell === 'white' ? atlasUv('white', [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]) : atlasUv(cell, faceUv(n, c));
    return {uv: uvq, extra: {color: col, aGlow: [glow]}};
  };
  const fbox = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, col: V3, cell: StreetCell = 'white', glow = 0) =>
    box(frame, u0, u1, y0 + oy, y1 + oy, w0, w1, solid(col, cell, glow));
  /** A flat textured panel facing -w (toward the hall) or +w, slightly proud. */
  const panel = (cell: StreetCell, u0: number, u1: number, y0: number, y1: number, w: number, facing: -1 | 1, col: V3 = [1, 1, 1], glow = 0) => {
    y0 += oy; y1 += oy;
    const c: V3[] = facing < 0 ? [[u0, y0, w], [u1, y0, w], [u1, y1, w], [u0, y1, w]] : [[u1, y0, w], [u0, y0, w], [u0, y1, w], [u1, y1, w]];
    frame.quad(c, [0, 0, facing], atlasUv(cell, [[0, 0], [1, 0], [1, 1], [0, 1]]), {color: col, aGlow: [glow]});
  };
  const pane = (acc: Acc, u0: number, u1: number, y0: number, y1: number, w: number) => {
    if (u1 - u0 < 0.02 || y1 - y0 < 0.02) return;
    y0 += oy; y1 += oy;
    const c: V3[] = [[u0, y0, w], [u1, y0, w], [u1, y1, w], [u0, y1, w]];
    const t: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    acc.quad(c, [0, 0, -1], t);
    acc.quad(c, [0, 0, 1], t);
    panes++;
  };
  /**
   * One storefront door set at depth w (glass plane), laid out from GEN's panels: jambs + head round the opening, a mullion at every
   * sidelight edge / gap, the transom bar under the transom; door leaves with stiles, top rail and kick plate; a pane in every
   * panel — the frame members and the panes tile the whole opening (no see-through gap without collision, no collider without a
   * visual). `hall`: the locked set the player faces (push bars, a chain + padlock through each leaf pair, notices, a boarded pane).
   */
  const doorSet = (w: number, acc: Acc, hall: boolean) => {
    const t = 0.06, HEAD = 0.1, alu = finish, kick = tint(ALU[0], 0.9), st = 0.09;
    fbox(-hs, -hs + J, 0, H, w - t, w + t, alu);
    fbox(hs - J, hs, 0, H, w - t, w + t, alu);
    fbox(-hs + J, hs - J, H - HEAD, H, w - t, w + t, alu);
    const low = panels.filter(p => p.kind !== 'transom');
    const tr = panels.find(p => p.kind === 'transom');
    const leafTop = low.length ? Math.max(...low.map(p => p.y1)) : H - HEAD;
    if (tr && leafTop < H - HEAD - 0.05) {
      fbox(-hs + J, hs - J, leafTop, Math.max(leafTop + 0.08, tr.y0 + 0.04), w - t, w + t, alu); // transom bar
      pane(acc, -hs + J, hs - J, Math.max(leafTop + 0.08, tr.y0 + 0.04), H - HEAD, w);
    } else if (leafTop < H - HEAD - 0.01) fbox(-hs + J, hs - J, leafTop, H - HEAD, w - t, w + t, alu); // a deep head instead
    // mullions: before / after a sidelight, across a gap between panels, and from the jambs to a first / last panel that leaves room
    let prevEnd = -hs + J, prevKind = 'jamb';
    for (const p of low) {
      if (p.u0 - prevEnd > 0.002 || p.kind === 'sidelight' || prevKind === 'sidelight') {
        const a = prevKind === 'jamb' ? prevEnd : prevEnd - 0.04, b = p.u0 + (p.u0 - prevEnd > 0.002 || prevKind === 'jamb' ? 0 : 0.04);
        if (b - a > 0.005) fbox(a, b, 0, leafTop, w - t, w + t, alu);
      }
      prevEnd = p.u1; prevKind = p.kind;
    }
    if (hs - J - prevEnd > 0.002) fbox(prevEnd, hs - J, 0, leafTop, w - t, w + t, alu);
    const doors: {u0: number; u1: number}[] = [];
    for (const p of low) {
      const m = 0.04;
      if (p.kind === 'sidelight') {
        const a = p.u0 + (p.u0 > -hs + J + 1e-3 ? m : 0), b = p.u1 - (p.u1 < hs - J - 1e-3 ? m : 0);
        fbox(a, b, 0, 0.12, w - t, w + t, alu); // sill
        pane(acc, a, b, 0.12, leafTop, w);
        continue;
      }
      doors.push(p);
      const a = p.u0, b = p.u1;
      fbox(a, a + st, 0, leafTop, w - t * 0.7, w + t * 0.7, alu);
      fbox(b - st, b, 0, leafTop, w - t * 0.7, w + t * 0.7, alu);
      fbox(a + st, b - st, leafTop - 0.09, leafTop, w - t * 0.7, w + t * 0.7, alu);
      fbox(a + st, b - st, 0, 0.26, w - t * 0.7, w + t * 0.7, kick); // kick plate / bottom rail
      pane(acc, a + st, b - st, 0.26, leafTop - 0.09, w);
      if (hall) {
        // push bar (panic bar) on the hall side with end brackets
        const pw = w - t * 0.7 - 0.07;
        fbox(a + st + 0.04, b - st - 0.04, 0.98, 1.04, pw - 0.025, pw + 0.025, tint(ALU[0], 1.1));
        for (const e of [a + st + 0.06, b - st - 0.06]) fbox(e - 0.025, e + 0.025, 0.96, 1.06, pw, w - t * 0.7, tint(ALU[0], 0.8));
      }
    }
    // leaf pairs: two door panels meeting edge to edge
    const pairs: number[] = [];
    for (let i = 0; i + 1 < doors.length; i++) if (Math.abs(doors[i].u1 - doors[i + 1].u0) < 0.02) { pairs.push((doors[i].u1 + doors[i + 1].u0) / 2); i++; }
    if (hall) {
      // the LOCK: a heavy chain wrapped round the two push bars of every pair across its meeting stiles, sagging, with a padlock
      const pw = w - t * 0.7 - 0.07, steel: V3 = [0.33, 0.32, 0.3];
      for (const c of pairs) {
        const wrap = (cu: number) => { for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const du = 0.03 * Math.cos(a), dy = 0.055 * Math.sin(a), dw = 0.04 * Math.sin(a); fbox(cu + du - 0.012, cu + du + 0.012, 1.01 + dy - 0.022, 1.01 + dy + 0.022, pw - 0.035 + dw - 0.012, pw - 0.035 + dw + 0.012, steel); } };
        wrap(c - 0.22); wrap(c + 0.22);
        const sagY = (u: number) => 1.0 - 0.17 * (1 - (u / 0.22) ** 2);
        for (let k = 0; k <= 8; k++) {
          const u = -0.22 + (0.44 * k) / 8, y = sagY(u), wl = pw - 0.06;
          if (k % 2) fbox(c + u - 0.03, c + u + 0.03, y - 0.012, y + 0.012, wl - 0.012, wl + 0.012, steel);
          else fbox(c + u - 0.012, c + u + 0.012, y - 0.012, y + 0.012, wl - 0.03, wl + 0.03, steel);
        }
        // padlock: brass body + steel shackle hanging from the low point of the chain
        const py = sagY(0) - 0.13, wl = pw - 0.06;
        fbox(c - 0.045, c + 0.045, py - 0.055, py + 0.03, wl - 0.018, wl + 0.018, [0.58, 0.46, 0.2]);
        fbox(c - 0.035, c - 0.02, py + 0.03, py + 0.1, wl - 0.008, wl + 0.008, steel);
        fbox(c + 0.02, c + 0.035, py + 0.03, py + 0.1, wl - 0.008, wl + 0.008, steel);
        fbox(c - 0.035, c + 0.035, py + 0.09, py + 0.11, wl - 0.008, wl + 0.008, steel);
      }
      // notices on the hall side of the glass (the first pair): the taped paper notice on one leaf, the NO EXIT plate on the other
      const gw = w - 0.014;
      if (doors.length >= 2) {
        const nl = r() < 0.5 ? 0 : 1, A = doors[nl], Bd = doors[1 - nl];
        const ca = (A.u0 + A.u1) / 2, cbu = (Bd.u0 + Bd.u1) / 2;
        panel('notice', ca - 0.21, ca + 0.21, 1.22, 1.78, gw, -1);
        panel('noExit', cbu - 0.21, cbu + 0.21, 1.42, 1.63, gw, -1);
      } else if (doors.length) panel('notice', (doors[0].u0 + doors[0].u1) / 2 - 0.21, (doors[0].u0 + doors[0].u1) / 2 + 0.21, 1.22, 1.78, gw, -1);
      // plywood over one leaf's lower pane (the hall side; inside the collider)
      if (doors.length) {
        const d = doors[Math.floor(r() * doors.length)];
        fbox(d.u0 + st, d.u1 - st, 0.27, 0.92, w - t * 0.7 - 0.03, w - t * 0.7 - 0.012, [1, 1, 1], 'plywood');
      }
    } else {
      // the street set: every leaf's lower pane boarded from the street side (their backs seen through the glass)
      for (const d of doors) fbox(d.u0 + st, d.u1 - st, 0.27, 1.1, w + t * 0.7 + 0.012, w + t * 0.7 + 0.03, [0.92, 0.9, 0.86], 'plywood');
    }
  };
  // reveal / vestibule pocket (indoors, lit): floor (mat + tile), side walls, soffit; the threshold under the inner set
  const tileUv = (n: V3, c: V3[]) => faceUv(n, c).map(([a, b]) => [a / 1.2, b / 1.2] as [number, number]);
  const pocket = (cell: StreetCell, corners: V3[], n: V3, col: V3) => {
    const c = corners.map(p => [p[0], p[1] + oy, p[2]] as V3);
    frame.quad(c, n, atlasUv(cell, tileUv(n, c).map(([a, b]) => [fract01(a), fract01(b)]) as [number, number][]), {color: col, aGlow: [0]});
  };
  if (B > 0.05) {
    pocket('paint', [[-hs, 0, 0], [-hs, 0, B], [-hs, H, B], [-hs, H, 0]], [1, 0, 0], [0.9, 0.88, 0.84]);
    pocket('paint', [[hs, 0, B], [hs, 0, 0], [hs, H, 0], [hs, H, B]], [-1, 0, 0], [0.9, 0.88, 0.84]);
    pocket('soffit', [[-hs, H, 0], [hs, H, 0], [hs, H, B], [-hs, H, B]], [0, -1, 0], [0.85, 0.84, 0.8]);
    pocket(B > 1.2 ? 'tile' : 'white', [[-hs, 0.004, 0], [-hs, 0.004, B], [hs, 0.004, B], [hs, 0.004, 0]], [0, 1, 0], B > 1.2 ? [1, 1, 1] : tint(ALU[0], 0.7));
    if (B > 1.2) {
      const mu = Math.min(hs, 1.1);
      frame.quad([[-mu, 0.012 + oy, wc + 0.15], [-mu, 0.012 + oy, wO - 0.15], [mu, 0.012 + oy, wO - 0.15], [mu, 0.012 + oy, wc + 0.15]], [0, 1, 0], atlasUv('mat', [[0, 0], [0, 1], [1, 1], [1, 0]]), {color: [1, 1, 1], aGlow: [0]});
    }
  }
  // the outer (street) set first in its own glass list: far panes draw before near ones (depth-writing glass)
  if (twoSets) doorSet(wO, glassFar, false);
  doorSet(wc, glassNear, true);
  // the lit box sign over the doors: on the wall above the opening when the hall ceiling leaves room, else on the transom glass
  {
    const sw = Math.min(1.4, 2 * hs - 0.3), sh = sw * 0.25;
    const above = s.hallCeil - s.y1 > sh + 0.2;
    const y0 = above ? H + 0.1 : Math.max(2.25, H - 0.12 - sh), wS = above ? -0.09 : wc - 0.075;
    fbox(-sw / 2 - 0.03, sw / 2 + 0.03, y0 - 0.03, y0 + sh + 0.03, wS, wS + (above ? 0.09 : 0.012), [0.16, 0.16, 0.16]);
    panel('sign', -sw / 2, sw / 2, y0, y0 + sh, wS - 0.003, -1, [1, 1, 1], 1);
  }
  // ---- STREET -------------------------------------------------------------------------------------------------------------
  const street = new Acc({position: 3, normal: 3, uv: 2, color: 3, aCell: 4, aExit: 4, aView: 4}, {aView: [s.view.x0, s.view.z0, s.view.x1, s.view.z1]});
  const V = plan.vol;
  const sx = (c: StreetCell): number[] => cellRect(c);
  const sky = [0, 0, -1, -1];
  const ground = (cell: StreetCell, u0: number, u1: number, w0: number, w1: number, y: number, col: V3 = [1, 1, 1]) => {
    const [tu, tw] = STREET_CELLS[cell].tile;
    street.quad([[u0, y, w0], [u1, y, w0], [u1, y, w1], [u0, y, w1]], [0, 1, 0], [[u0 / tu, w0 / tw], [u1 / tu, w0 / tw], [u1 / tu, w1 / tw], [u0 / tu, w1 / tw]], {color: col, aCell: sx(cell), aExit: exitAttr});
  };
  const vquad = (cell: StreetCell, a: [number, number], b: [number, number], y0: number, y1: number, n: V3, col: V3 = [1, 1, 1], s0 = 0) => {
    const [tu, tv] = STREET_CELLS[cell].tile;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    street.quad([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], n,
      [[s0 / tu, y0 / tv], [(s0 + len) / tu, y0 / tv], [(s0 + len) / tu, y1 / tv], [s0 / tu, y1 / tv]], {color: col, aCell: sx(cell), aExit: exitAttr});
  };
  const curbY = -0.15;
  ground('paving', V.u0, V.u1, plan.pavement[0], plan.pavement[1], 0);
  ground('curb', V.u0, V.u1, plan.pavement[1], plan.pavement[1] + 0.25, 0);
  vquad('curb', [V.u1, plan.pavement[1] + 0.25], [V.u0, plan.pavement[1] + 0.25], curbY, 0, [0, 0, 1]);
  // road: two lanes of asphalt with the dashed centre line between
  const [r0, r1] = plan.road, rm = (r0 + r1) / 2;
  ground('asphalt', V.u0, V.u1, r0, rm - 1, curbY);
  ground('lane', V.u0, V.u1, rm - 1, rm + 1, curbY);
  ground('asphalt', V.u0, V.u1, rm + 1, r1, curbY);
  vquad('curb', [V.u0, r1], [V.u1, r1], curbY, 0, [0, 0, -1]);
  ground('curb', V.u0, V.u1, r1, r1 + 0.25, 0);
  ground('paving', V.u0, V.u1, plan.farPavement[0], plan.farPavement[1], 0, [0.9, 0.9, 0.88]);
  ground('dirt', V.u0, V.u1, plan.farPavement[1], V.w1, 0.0);
  // buildings: a facade box (front / sides / top) with the ground-floor shop band, jagged broken tops, an exposed slab sometimes
  const facadeCell = (k: StreetBuilding['kind']): StreetCell => (k === 'brick' ? 'facadeBrick' : k === 'glass' ? 'facadeGlass' : k === 'render' ? 'facadeRender' : 'facadeOffice');
  const tone = (seed: number): V3 => { const q = mulberry32(seed)(); return [0.75 + q * 0.4, 0.75 + q * 0.38, 0.72 + q * 0.36]; };
  const massing = (b: StreetBuilding, u0: number, u1: number, w0: number, w1: number, y0: number, y1: number, shopBand: boolean) => {
    const cell = facadeCell(b.kind), col = tone(b.seed);
    const band = shopBand ? Math.min(4.2, y1) : y0;
    // the front (facing the mall: -w), then the two sides, then the roof
    // (texture u runs to the viewer's right, i.e. along -u: uv = -u / tile, continuous between bands)
    if (shopBand && band > y0) vquad(b.shop, [u1, w0], [u0, w0], y0, band, [0, 0, -1], col, -u1);
    if (y1 > band) vquad(cell, [u1, w0], [u0, w0], band, y1, [0, 0, -1], col, -u1);
    vquad(cell, [u0, w0], [u0, w1], y0, y1, [-1, 0, 0], tint(col, 0.85));
    vquad(cell, [u1, w1], [u1, w0], y0, y1, [1, 0, 0], tint(col, 0.85));
    const [tu, tw] = STREET_CELLS.roof.tile;
    street.quad([[u0, y1, w0], [u1, y1, w0], [u1, y1, w1], [u0, y1, w1]], [0, 1, 0], [[u0 / tu, w0 / tw], [u1 / tu, w0 / tw], [u1 / tu, w1 / tw], [u0 / tu, w1 / tw]], {color: col, aCell: sx('roof'), aExit: exitAttr});
  };
  for (const b of plan.buildings) {
    const q = mulberry32(b.seed);
    if (b.kind === 'collapsed') { massing(b, b.u0 + 0.6, b.u1 - 0.8, b.w0 + 1, b.w1, 0, b.h, false); continue; }
    const broken = b.h * (0.74 + q() * 0.16);
    massing(b, b.u0, b.u1, b.w0, b.w1, 0, broken, b.row === 1);
    const rem = 1 + Math.floor(q() * 3);
    for (let k = 0; k < rem; k++) {
      const wu = (b.u1 - b.u0) * (0.2 + q() * 0.35), wd = (b.w1 - b.w0) * (0.25 + q() * 0.4);
      const cu = b.u0 + q() * (b.u1 - b.u0 - wu), cw = b.w0 + q() * (b.w1 - b.w0 - wd);
      massing(b, cu, cu + wu, cw, cw + wd, broken, Math.min(V.y1 - 0.5, broken + (b.h - broken) * (0.5 + q())), false);
    }
    if (q() < 0.35 && b.row === 1) { const y = broken - 3.4 * (1 + Math.floor(q() * 2)); if (y > 4.5) massing(b, b.u0 - 0.4, b.u1 + 0.4, b.w0 - 0.5, b.w0 + 2.5, y, y + 0.3, false); }
  }
  // wrecks / rubble (the Office's procedural stand-ins, vertex-coloured), lamp posts, the entrance canopy
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const white = sx('white');
  const place = (g: THREE.BufferGeometry, u: number, y: number, w: number, yaw: number, sc: V3) => {
    m4.compose(new THREE.Vector3(u, y, w), qq.setFromAxisAngle(UP, yaw), new THREE.Vector3(...sc));
    street.geometry(g, m4, {color: [1, 1, 1], aCell: white, aExit: exitAttr}, true);
  };
  const carG = fallbackPropGeometry('car'), busG = fallbackPropGeometry('bus'), rubG = fallbackPropGeometry('rubble');
  // (the stand-ins are long along z: a car parked along the road (u) is turned a quarter)
  for (const c of plan.cars) place(c.kind === 'bus' ? busG : carG, c.u, curbY, c.w, Math.PI / 2 + c.yaw, [1, 1, 1]);
  for (const rb of plan.rubble) place(rubG, rb.u, rb.w > plan.road[0] && rb.w < plan.road[1] ? curbY : 0, rb.w, r() * 6.28, [rb.s, rb.s * 0.8, rb.s]);
  for (const g of [carG, busG, rubG]) g.dispose();
  const steelCol: V3 = [0.16, 0.16, 0.15];
  const sbox = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, col: V3) =>
    box(street, u0, u1, y0, y1, w0, w1, () => ({uv: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], extra: {color: col, aCell: white, aExit: exitAttr}}));
  for (const l of plan.lamps) {
    sbox(l.u - 0.07, l.u + 0.07, 0, 6.2, l.w - 0.07, l.w + 0.07, steelCol);
    sbox(l.u - 0.05, l.u + 0.05, 6.1, 6.2, l.w, l.w + 1.6, steelCol);
    sbox(l.u - 0.16, l.u + 0.16, 5.95, 6.12, l.w + 1.3, l.w + 1.8, [0.1, 0.1, 0.1]);
  }
  if (plan.pavement[1] - B > 2.2 && H < 3.0) sbox(-hs - 0.9, hs + 0.9, H + oy + 0.35, H + oy + 0.55, B, B + 1.9, [0.22, 0.22, 0.21]); // entrance canopy
  // backdrop box (back / sides / lid), facing the doors: the roof's own sky colour along each ray
  const bk = (c: V3[], n: V3) => street.quad(c, n, [[0, 0], [1, 0], [1, 1], [0, 1]], {color: [1, 1, 1], aCell: sky, aExit: exitAttr});
  const yb = Math.min(V.y0, curbY) - 0.3, yt = V.y1 - 0.05, wb = V.w1 - 0.05, wn = B;
  bk([[V.u0, yb, wb], [V.u1, yb, wb], [V.u1, yt, wb], [V.u0, yt, wb]], [0, 0, -1]);
  bk([[V.u0 + 0.05, yb, wn], [V.u0 + 0.05, yb, wb], [V.u0 + 0.05, yt, wb], [V.u0 + 0.05, yt, wn]], [1, 0, 0]);
  bk([[V.u1 - 0.05, yb, wb], [V.u1 - 0.05, yb, wn], [V.u1 - 0.05, yt, wn], [V.u1 - 0.05, yt, wb]], [-1, 0, 0]);
  bk([[V.u0, yt, wn], [V.u1, yt, wn], [V.u1, yt, wb], [V.u0, yt, wb]], [0, -1, 0]);
  // ---- FOG CARDS ----------------------------------------------------------------------------------------------------------
  const fog = new Acc({position: 3, normal: 3, uv: 2, aExit: 4, aCard: 2});
  const cardTop = Math.min(V.y1 - 0.3, 16);
  // far cards first (back-to-front for an eye inside)
  for (const c of [...plan.cards].reverse()) {
    fog.quad([[V.u0 + 0.1, curbY, c.w], [V.u1 - 0.1, curbY, c.w], [V.u1 - 0.1, cardTop, c.w], [V.u0 + 0.1, cardTop, c.w]], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], {aExit: exitAttr, aCard: [c.opacity, 0]});
  }
  const gw0 = B + 0.4, gw1 = V.w1 - 1;
  if (gw1 > gw0 + 1) fog.quad([[V.u0 + 0.1, plan.ground.y, gw0], [V.u1 - 0.1, plan.ground.y, gw0], [V.u1 - 0.1, plan.ground.y, gw1], [V.u0 + 0.1, plan.ground.y, gw1]], [0, 1, 0], [[0, 0.5], [1, 0.5], [1, 0.5], [0, 0.5]], {aExit: exitAttr, aCard: [plan.ground.opacity, 1]});

  // ---- meshes -------------------------------------------------------------------------------------------------------------
  const glass = new Acc({position: 3, normal: 3, uv: 2});
  for (const g of [glassFar, glassNear]) { // far set first
    const b0 = glass.count;
    for (const k of Object.keys(g.sizes)) glass.a[k].push(...g.a[k]);
    for (const i of g.idx) glass.idx.push(b0 + i);
  }
  const aperture = apertureOf(s);
  const out: THREE.Mesh[] = [];
  const named = (m: THREE.Mesh | null, part: string, order?: number) => {
    if (!m) return;
    m.name = `mall-exit-${s.id}-${part}`;
    m.userData.level = s.level;
    m.userData.aperture = aperture;
    m.userData.streetExit = s.id;
    if (order !== undefined) m.renderOrder = order;
    out.push(m);
  };
  named(frame.mesh(f, streetExitFrameMaterial(), 'frame'), 'frame');
  named(street.mesh(f, streetExitMaterial(), 'street'), 'street');
  named(fog.mesh(f, streetFogCardMaterial(), 'fog'), 'fog', MALL_EXT_ORDER.gas);
  named(glass.mesh(f, streetExitGlassMaterial(), 'glass'), 'glass', 0);
  const triangles = out.reduce((t, m) => t + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  return {meshes: out, stats: {id: s.id, meshes: out.length, triangles, panes, buildings: plan.buildings.length, cards: plan.cards.length}, plan, aperture, frame: f};
}

/** Face-local uv (metres) of an axis-aligned local quad: horizontal faces (u, w), vertical faces (along the face, y). */
function faceUv(n: V3, c: V3[]): [number, number][] {
  if (Math.abs(n[1]) > 0.5) return c.map(p => [p[0], p[2]] as [number, number]);
  const alongU = Math.abs(n[2]) > 0.5;
  const s0 = Math.min(...c.map(p => (alongU ? p[0] : p[2]))), y0 = Math.min(...c.map(p => p[1]));
  const s1 = Math.max(...c.map(p => (alongU ? p[0] : p[2]))), y1 = Math.max(...c.map(p => p[1]));
  const sl = Math.max(1e-6, s1 - s0), yl = Math.max(1e-6, y1 - y0);
  return c.map(p => [((alongU ? p[0] : p[2]) - s0) / sl, (p[1] - y0) / yl] as [number, number]);
}
/** Clamp a tile coordinate into the cell (the pocket's few faces stretch once; no shader tiling on the lit frame material). */
const fract01 = (v: number): number => Math.min(1, Math.max(0, v));

// ---------------------------------------------------------------------------------------------------------------------------
// CPU mirrors (tests / QA)

type RGB = [number, number, number];
/** Linear RGB the street fades into at the horizon (murkAt with dir.y = 0, no sun): the roof sky's horizon colour. */
export function streetMurkCpu(): RGB {
  const b = hazeSatCpu();
  return b.map(v => v * MALL_SKY.horizon) as RGB;
}
/** Opacity of the street fog over L m of ray at eye height hc to a point at height hp above the street: exactly the Office's. */
export function streetFogOpacity(L: number, hc = 1.6, hp = hc): number {
  return exteriorFogOpacity(L, hc, hp);
}

export interface StreetExitTune { light?: number; cards?: number; glass?: number; glow?: number }
/** QA: tune the street exits (uniform values only); returns the current values. */
export function streetExitTune(o: StreetExitTune = {}): Required<StreetExitTune> {
  for (const k of ['light', 'cards', 'glass', 'glow'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) STREET_U[k].value = o[k]!;
  return {light: STREET_U.light.value, cards: STREET_U.cards.value, glass: STREET_U.glass.value, glow: STREET_U.glow.value};
}
