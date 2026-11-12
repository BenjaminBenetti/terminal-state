// Task studio-first-player-onboarding-20261111-234657-01: the FIRST-PLAYER ONBOARDING at the player's train — seven matching
// world-space 3D markers (a real mesh arrow + a short label each; never a camera-pinned HUD / DOM overlay):
//  - four above the train's actual fixtures (train-local, read from the same specs the fixtures use): the fuel cap on the platform-side
//    skin (fuel/trainPort.ts fuelPortLocal), the driving console in the cab (world/trainConsole.ts, the placed desk's measured box), the
//    zombie woodchipper's hopper (world/chipperPlace.ts + chipperSpec.ts anchors) and the ORIGINAL rear-compartment Lockbox
//    (spec.lockbox; crafted chests elsewhere are never targeted);
//  - three floating over the start platform beside the car (inventory / hotbar / controls), probed onto walkable platform floor with
//    headroom and clear of the platform's props.
// ACTIVATION: shown at every parked train while the browser-global onboarding record (ui/onboardingStore.ts, 'train') is not done.
// PRESENTED: only while the game is actually playing (frame hooks run in 'playing' only; this also checks host.state), the player alive,
// no lane owning the input (Game.inputOwners: an open Lockbox view over the screen, a carried corpse, a vomit fit — the inventory /
// pause / map are states of their own), within ONBOARDING.departDistance of the
// car's outer box, with at least one marker's label inside the view frustum AND in sight (a ray through the level and its props — the
// car's walls / partitions included, its window glass see-through) — for ONBOARDING.presentSeconds in total since this station was built.
// Loading / menus / the warm-up / a prebuilt station never count, a slab or wall between never counts, and a save imported far from the
// train is not "presented" until the player comes back to it.
// DISMISSAL: once presented, the FIRST time the player is departDistance (10 m) or more from the car's outer box (one train-area distance:
// walking around inside the car is always 0 m), all seven markers go together and the record is completed for this browser (every
// visit, reload, slot and new save). Riding the moving train hides them (no platform there); they come back at the next parked train.
// RESET ("Reset tutorials", the store's reset): re-armed at once — the current parked train shows them again (presentation starts over).
// NONBLOCKING: no collider, no layout.props / propIndex entry, no physics body, no shadow, raycast off; the fixtures' own aim / [E] /
// feeding / pour rules are untouched. Rendering: two display-referred unlit node materials per runtime (one canvas label atlas of the
// copy below typeset at runtime in the game's existing UI font on a plain UI plate — as the task asked: existing font resources /
// procedural geometry, no image asset, no generation — and the arrows' vertex-shaded mustard), FrontSide, opaque (alpha-tested plate
// corners), registered with the warm-up as pool 'train-onboarding'; disposed when the onboarding completes.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {StationLayout} from '../gen/stationTypes';
import type {Levels} from '../gen/levels';
import type {PropPlacement} from '../gen/props';
import {raycastWorld} from '../combat/hitscan';
import {CELL} from '../gen/grid';
import {trainSpawnLocal, trainToWorld, worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import type {WarmupRegistry} from '../render/warmup';
import {fuelPortLocal} from '../fuel/trainPort';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {consoleLocalRect, type ConsoleRect} from './trainConsole';
import {chipperPlacement, chipperToLocal} from './chipperPlace';
import {CHIPPER_ANCHORS} from './chipperSpec';
import {displayReferred} from './lights';
import type {OnboardingEvent, OnboardingStore} from '../ui/onboardingStore';

type P3 = {x: number; y: number; z: number};

// ---------------------------------------------------------------------------------------------
// The markers and their copy

export type OnboardingMarkerId = 'fuel' | 'console' | 'chipper' | 'lockbox' | 'inventory' | 'hotbar' | 'controls';

export interface OnboardingMarkerDef {
  id: OnboardingMarkerId;
  /** 'fixture': above a train fixture; 'platform': floating over the platform beside the car. */
  kind: 'fixture' | 'platform';
  /** The copy (one string). */
  text: string;
  /** How the label sets it (two or three lines: the items of `text` in order). */
  lines: readonly string[];
  /** Key names drawn as mustard keycaps (a key token followed by ':'). */
  keys?: readonly string[];
  /** A leading phrase drawn in mustard. */
  accent?: string;
}

export const ONBOARDING_MARKERS: readonly OnboardingMarkerDef[] = [
  {id: 'fuel', kind: 'fixture', text: 'Scavenge fuel. Refuel to travel.', lines: ['Scavenge fuel.', 'Refuel to travel.']},
  {id: 'console', kind: 'fixture', text: 'Drive the train. Explore the network.', lines: ['Drive the train.', 'Explore the network.']},
  {id: 'chipper', kind: 'fixture', text: 'Low on fuel? Grind zombie corpses.', lines: ['Low on fuel?', 'Grind zombie corpses.']},
  {id: 'lockbox', kind: 'fixture', text: 'Your storage travels with the train.', lines: ['Your storage travels', 'with the train.']},
  {id: 'inventory', kind: 'platform', text: 'Tab: open / close inventory.', lines: ['Tab:', 'open / close inventory.'], keys: ['Tab']},
  {id: 'hotbar', kind: 'platform', text: 'Bottom hotbar: switch weapons & gear.', lines: ['Bottom hotbar:', 'switch weapons & gear.'], accent: 'Bottom hotbar:'},
  {id: 'controls', kind: 'platform', text: 'F: flashlight · Shift: sprint · C: crouch.', lines: ['F: flashlight', 'Shift: sprint', 'C: crouch.'], keys: ['F', 'Shift', 'C']},
];

export const ONBOARDING = {
  /** Leaving the train area: the player's distance to the car's outer box (m) that completes a presented onboarding. */
  departDistance: 10,
  /** Seconds between sight checks while not yet presented (a blocked view costs ~0.6-1 ms of rays on a large station). */
  sightEvery: 0.1,
  /** Seconds of active, near, on-screen play before the markers count as presented. */
  presentSeconds: 1.5,
  /** A label further than this from the eye does not count as on screen (m). */
  viewDistance: 14,
  /** The label plate (m; 4:1 = one atlas row). */
  label: {w: 1.12, h: 0.28},
  /** Label centre above the car floor at the fixtures / above the platform floor (m: head height in the car, above heads outside). The
   *  fuel cap's (outside the platform-side skin, where the player walks) is a little lower: its plate's bottom still clears a standing
   *  eye (STAND_EYE 1.62) by 8 cm, and most of it shows through the saloon window above the cap (window head 1.85 above the floor). */
  fixtureY: 1.92,
  fuelY: 1.84,
  platformY: 2.45,
  /** Arrow: template length / head / shaft (m), its length range, the gap it keeps short of its target, the bob (m, Hz) and spin (rad/s). */
  arrow: {len: 0.4, headR: 0.095, headLen: 0.17, shaftR: 0.04, sides: 8, min: 0.22, max: 0.45, gap: 0.08, bob: 0.05, bobHz: 1.1, spin: 0.9},
  /** Platform markers: preferred distance in from the platform edge (m), their spacing along the car (m), the headroom they need. */
  platform: {depth: 2.6, spacing: 2.4, headroom: 2.75, minGap: 1.3},
} as const;

/** Copy colours (the game's UI palette: styles.css --charcoal / --cream / --mustard). */
const INK = {plate: '#16181b', border: '#d9a520', text: '#ece4cf', key: '#d9a520'} as const;
const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

// ---------------------------------------------------------------------------------------------
// Placement (pure)

/** One marker, train-local: the label centre, the point its arrow aims at, the label's home facing (yaw: 0 faces +Z) and swing. */
export interface MarkerPose {
  id: OnboardingMarkerId;
  label: P3;
  target: P3;
  /** The label turns toward the eye about +Y, at most `swing` (rad) away from `facing` — or from its reverse, seen from behind (the
   *  plate reads from both sides): it never swings into the car's walls. */
  facing: number;
  swing: number;
  /** Platform markers: no walkable, clear spot was found, the preferred spot is used unchecked. */
  fallback?: boolean;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The four fixture markers (train-local). `consoleRect` = the placed desk's measured box (PlayerTrainRuntime.consoleRect), else its dims. */
export function fixtureMarkerPoses(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, consoleRect: ConsoleRect | null = null): MarkerPose[] {
  const F = spec.floorY, Y = F + ONBOARDING.fixtureY, hw = spec.interior.halfWidth, W2 = ONBOARDING.label.w / 2;
  const out: MarkerPose[] = [];
  // the fuel cap: outside the platform-side (-Z) skin, the label just off the skin facing the platform
  const cap = fuelPortLocal(spec);
  out.push({id: 'fuel', label: {x: cap.x, y: F + ONBOARDING.fuelY, z: -(spec.width / 2 + 0.45)}, target: {...cap}, facing: Math.PI, swing: Math.PI / 4});
  // the driving console: above the desk's operator (-X) side, facing back into the cab (its doorway)
  const c = consoleLocalRect(spec, consoleRect), cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  const cSwing = Math.PI / 3, cMaxX = spec.interior.x1 - W2 * Math.sin(cSwing) - 0.05;
  out.push({id: 'console', label: {x: r4(Math.min(cx - 0.3, cMaxX)), y: Y, z: r4(cz)}, target: {x: r4(cx), y: r4(c.top), z: r4(cz)}, facing: -Math.PI / 2, swing: cSwing});
  // the woodchipper: above its hopper (where a carried body goes in), the label pulled toward the aisle, facing it
  const ch = chipperPlacement(spec);
  if (ch) {
    const A = CHIPPER_ANCHORS.hopper, hop = chipperToLocal(ch, A.x, A.y, A.z), sw = Math.PI / 3;
    out.push({id: 'chipper', label: {x: r4(hop.x), y: Y, z: r4(Math.min(hop.z, hw - W2 * Math.sin(sw) - 0.1))}, target: {x: r4(hop.x), y: r4(hop.y), z: r4(hop.z)}, facing: Math.PI, swing: sw});
  }
  // the ORIGINAL Lockbox in the rear compartment: the label across the compartment facing its doorway (+X), turned at most 36 degrees
  // (the compartment is barely longer than the label is wide); its centre 0.2 m off the doorway's centre line toward the box, so its
  // lettering reads through the doorway from the saloon's aisle and its arrow stays clear of the aisle's head height
  const lb = spec.lockbox;
  if (lb) {
    const dw = spec.rear?.doorway, dz = (dw ? (dw.z0 + dw.z1) / 2 : 0) + 0.2 * Math.sign(lb.z || 1);
    out.push({id: 'lockbox', label: {x: r4(lb.x), y: Y, z: r4(clamp(dz, -(hw - W2 - 0.04), hw - W2 - 0.04))}, target: {x: r4(lb.x), y: r4(F + lb.height), z: r4(lb.z)}, facing: Math.PI / 2, swing: Math.PI / 5});
  }
  return out;
}

/** What the platform probe reads (structural: tests pass the real Levels + layout). */
export interface PlatformProbe {
  levels: Pick<Levels, 'bands'>;
  layout: Pick<StationLayout, 'props'> & {areas?: readonly {id: number; x: number; y: number; w: number; h: number}[]};
}

/**
 * The three platform markers (train-local): in a row along the car, centred on the spawn's platform door, ONBOARDING.platform.depth in
 * from the platform edge (less on a shallow platform). Each is probed onto walkable floor at the car floor's height with headroom for the
 * label and clear of the platform's props (columns, signs, benches), shifted along / across the platform when blocked; never closer than
 * minGap to another. Fallback (nothing walkable found, e.g. a test layout): the preferred spot.
 */
export function platformMarkerPoses(p: TrainPlacement, probe: PlatformProbe | null, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): MarkerPose[] {
  const P = ONBOARDING.platform, F = spec.floorY, R = ONBOARDING.label.w / 2 + 0.1;
  const edge = Math.abs(worldToTrain(p, p.x, 0, p.platformEdgeZ).z) || spec.width / 2 + 0.5;
  const area = probe?.layout.areas?.find(a => a.id === p.platformArea);
  const platDepth = area ? area.h * CELL : P.depth + 1.5;
  const depth0 = clamp(Math.min(P.depth, platDepth - 1.0), 1.0, P.depth);
  const door = trainSpawnLocal(spec).x;
  const ids: OnboardingMarkerId[] = ['inventory', 'hotbar', 'controls'];
  const chosen: P3[] = [];
  const free = (lx: number, lz: number): {floor: number} | null => {
    if (!probe) return null;
    const w = trainToWorld(p, lx, 0, lz);
    const floorW = p.railTopY + F;
    const band = probe.levels.bands(w.x, w.z).find(b => b.level === p.level && Math.abs(b.floor - floorW) <= 0.35 && b.ceil - b.floor >= P.headroom);
    if (!band) return null;
    const y0 = band.floor + ONBOARDING.platformY - ONBOARDING.label.h / 2 - ONBOARDING.arrow.max, y1 = band.floor + ONBOARDING.platformY + ONBOARDING.label.h / 2;
    for (const q of probe.layout.props) {
      if ((q.level ?? 0) !== p.level || q.y >= y1 || q.y + q.h <= y0) continue;
      if (Math.abs(q.x - w.x) < q.hx + R && Math.abs(q.z - w.z) < q.hz + R) return null;
    }
    return {floor: band.floor - p.railTopY};
  };
  return ids.map((id, i) => {
    const x0 = door + (i - 1) * P.spacing;
    let pick: {x: number; z: number; floor: number} | null = null;
    outer: for (const dd of [0, -0.5, 0.5, -1, -1.4]) {
      const d = depth0 + dd;
      if (d < 0.9 || d > platDepth - 0.4) continue;
      for (const dx of [0, -0.5, 0.5, -1, 1]) {
        const lx = x0 + dx, lz = -(edge + d);
        if (chosen.some(c => Math.hypot(c.x - lx, c.z - lz) < P.minGap)) continue;
        const f = free(lx, lz);
        if (f) { pick = {x: lx, z: lz, floor: f.floor}; break outer; }
      }
    }
    const at = pick ?? {x: x0, z: -(edge + depth0), floor: F};
    chosen.push({x: at.x, y: 0, z: at.z});
    const y = at.floor + ONBOARDING.platformY;
    const pose: MarkerPose = {id, label: {x: r4(at.x), y: r4(y), z: r4(at.z)}, target: {x: r4(at.x), y: r4(at.floor + 1.95), z: r4(at.z)}, facing: 0, swing: Math.PI};
    if (!pick) pose.fallback = true;
    return pose;
  });
}

/** All seven markers in ONBOARDING_MARKERS order. */
export function onboardingMarkerPoses(p: TrainPlacement, probe: PlatformProbe | null, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, consoleRect: ConsoleRect | null = null): MarkerPose[] {
  const all = [...fixtureMarkerPoses(spec, consoleRect), ...platformMarkerPoses(p, probe, spec)];
  return ONBOARDING_MARKERS.map(d => all.find(q => q.id === d.id)).filter((q): q is MarkerPose => !!q);
}

/** The player's distance (m) from the train AREA: the car's whole outer box (rail top .. roof, full length / width). 0 anywhere inside. */
export function trainAreaDistance(p: Pick<TrainPlacement, 'x' | 'z' | 'railTopY' | 'front'>, wx: number, wy: number, wz: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): number {
  const l = worldToTrain(p, wx, wy, wz);
  const dx = Math.max(0, Math.abs(l.x) - spec.length / 2), dz = Math.max(0, Math.abs(l.z) - spec.width / 2);
  const dy = l.y < 0 ? -l.y : Math.max(0, l.y - spec.roofY);
  return Math.hypot(dx, dy, dz);
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The label's yaw for an eye at (ex, ez) (train-local): toward the eye, clamped to facing +- swing — or, with the eye behind the
 *  plate, to the reversed facing +- swing (its back quad reads the right way round). */
export function labelYaw(pose: Pick<MarkerPose, 'label' | 'facing' | 'swing'>, ex: number, ez: number): number {
  const dx = ex - pose.label.x, dz = ez - pose.label.z;
  if (dx * dx + dz * dz < 1e-8) return pose.facing;
  const want = Math.atan2(dx, dz);
  let base = pose.facing, d = wrapPi(want - base);
  if (Math.abs(d) > Math.PI / 2 && pose.swing < Math.PI / 2) { base = pose.facing + Math.PI; d = wrapPi(want - base); }
  return base + clamp(d, -pose.swing, pose.swing);
}

/** The arrow under a label (train-local): its tip, unit direction (tail -> tip, toward the target) and length. */
export function arrowPose(pose: Pick<MarkerPose, 'label' | 'target'>): {tip: P3; dir: P3; len: number} {
  const A = ONBOARDING.arrow, tail = {x: pose.label.x, y: pose.label.y - ONBOARDING.label.h / 2 - 0.03, z: pose.label.z};
  const v = {x: pose.target.x - tail.x, y: pose.target.y - tail.y, z: pose.target.z - tail.z};
  const dist = Math.hypot(v.x, v.y, v.z) || 1;
  const dir = {x: v.x / dist, y: v.y / dist, z: v.z / dist};
  const len = clamp(dist - A.gap, A.min, A.max);
  return {tip: {x: tail.x + dir.x * len, y: tail.y + dir.y * len, z: tail.z + dir.z * len}, dir, len};
}

// ---------------------------------------------------------------------------------------------
// The label atlas (one canvas: one row per marker)

export interface LabelRun { text: string; style: 'text' | 'key' | 'accent' }

/** A label line split into its drawn runs (keycaps: a `keys` token right before ':'; the accent phrase at the line start). */
export function labelRuns(def: Pick<OnboardingMarkerDef, 'keys' | 'accent'>, line: string): LabelRun[] {
  const runs: LabelRun[] = [];
  let rest = line;
  if (def.accent && rest.startsWith(def.accent)) { runs.push({text: def.accent, style: 'accent'}); rest = rest.slice(def.accent.length); }
  const keys = def.keys ?? [];
  if (!keys.length) { if (rest) runs.push({text: rest, style: 'text'}); return runs; }
  const re = new RegExp(`(^|\\s)(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=:)`, 'g');
  let at = 0;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    const k0 = m.index + m[1].length;
    if (k0 > at) runs.push({text: rest.slice(at, k0), style: 'text'});
    runs.push({text: m[2], style: 'key'});
    at = k0 + m[2].length;
  }
  if (at < rest.length) runs.push({text: rest.slice(at), style: 'text'});
  return runs;
}

const ATLAS = {w: 1024, row: 256, pad: 10, radius: 34, border: 6, font: 62, minFont: 40, keyPad: 12, lineGap: 1.18, lineGap3: 1.1} as const;

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Width of a line's runs at `px` (keycaps add their padding). */
function runsWidth(ctx: CanvasRenderingContext2D, runs: readonly LabelRun[], px: number): number {
  let w = 0;
  for (const r of runs) {
    ctx.font = `${r.style === 'text' ? 600 : 700} ${px}px ${FONT}`;
    w += ctx.measureText(r.text).width + (r.style === 'key' ? 2 * ATLAS.keyPad : 0);
  }
  return w;
}

/** Draws every marker's label into one atlas canvas (one font size for all: the largest that fits every line). */
export function drawLabelAtlas(ctx: CanvasRenderingContext2D, defs: readonly OnboardingMarkerDef[] = ONBOARDING_MARKERS): {font: number} {
  const W = ATLAS.w, H = ATLAS.row, inner = W - 2 * (ATLAS.pad + ATLAS.border + 30);
  ctx.clearRect(0, 0, W, H * defs.length);
  let px: number = ATLAS.font;
  for (const d of defs) for (const line of d.lines) {
    const runs = labelRuns(d, line);
    while (px > ATLAS.minFont && runsWidth(ctx, runs, px) > inner) px -= 2;
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  defs.forEach((d, i) => {
    const y0 = i * H;
    // the plate: charcoal, a mustard border, rounded corners (transparent outside: alpha-tested)
    ctx.fillStyle = INK.border;
    roundRect(ctx, ATLAS.pad, y0 + ATLAS.pad, W - 2 * ATLAS.pad, H - 2 * ATLAS.pad, ATLAS.radius);
    ctx.fill();
    ctx.fillStyle = INK.plate;
    const b = ATLAS.border;
    roundRect(ctx, ATLAS.pad + b, y0 + ATLAS.pad + b, W - 2 * (ATLAS.pad + b), H - 2 * (ATLAS.pad + b), ATLAS.radius - b);
    ctx.fill();
    const lh = px * (d.lines.length > 2 ? ATLAS.lineGap3 : ATLAS.lineGap), top = y0 + H / 2 - lh * (d.lines.length - 1) / 2;
    d.lines.forEach((line, li) => {
      const runs = labelRuns(d, line), cy = top + li * lh;
      let x = W / 2 - runsWidth(ctx, runs, px) / 2;
      for (const r of runs) {
        ctx.font = `${r.style === 'text' ? 600 : 700} ${px}px ${FONT}`;
        const tw = ctx.measureText(r.text).width;
        if (r.style === 'key') {
          ctx.strokeStyle = INK.key;
          ctx.lineWidth = 4;
          roundRect(ctx, x + 2, cy - px * 0.5, tw + 2 * ATLAS.keyPad - 4, px, 10);
          ctx.stroke();
          ctx.fillStyle = INK.key;
          ctx.fillText(r.text, x + ATLAS.keyPad, cy);
          x += tw + 2 * ATLAS.keyPad;
        } else {
          ctx.fillStyle = r.style === 'accent' ? INK.key : INK.text;
          ctx.fillText(r.text, x, cy);
          x += tw;
        }
      }
    });
  });
  return {font: px};
}

// ---------------------------------------------------------------------------------------------
// Materials + geometry

export interface OnboardingMaterials { label: MeshBasicNodeMaterial; arrow: MeshBasicNodeMaterial; atlas: THREE.Texture; font: number }

/** The two materials and the label atlas of one runtime (created when its markers first show; disposed when the onboarding completes). */
export function createOnboardingMaterials(): OnboardingMaterials {
  let atlas: THREE.Texture, font = 0;
  const rows = ONBOARDING_MARKERS.length;
  const c = hasCanvas() ? document.createElement('canvas') : null;
  const ctx = c && typeof c.getContext === 'function' ? (c.width = ATLAS.w, c.height = ATLAS.row * rows, c.getContext('2d')) : null;
  if (c && ctx) {
    font = drawLabelAtlas(ctx).font;
    atlas = new THREE.CanvasTexture(c);
  } else {
    atlas = new THREE.DataTexture(new Uint8Array([22, 24, 27, 255]), 1, 1);
    atlas.needsUpdate = true;
  }
  atlas.name = 'train-onboarding-labels';
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.anisotropy = 4;
  const label = new MeshBasicNodeMaterial({name: 'train-onboarding-label', map: atlas, color: 0xffffff, alphaTest: 0.5, side: THREE.FrontSide});
  const arrow = new MeshBasicNodeMaterial({name: 'train-onboarding-arrow', color: 0xffffff, vertexColors: true, side: THREE.FrontSide});
  displayReferred(label);
  displayReferred(arrow);
  return {label, arrow, atlas, font};
}

export function disposeOnboardingMaterials(m: OnboardingMaterials): void {
  m.label.dispose(); m.arrow.dispose(); m.atlas.dispose();
}

/** The arrow template: an 8-sided shaft + head along +Y, its tip at the origin pointing -Y, flat-shaded mustard vertex colours (a fixed
 *  key light baked per face, so the spin reads in any lighting). */
export function arrowGeometry(): THREE.BufferGeometry {
  const A = ONBOARDING.arrow;
  const head = new THREE.ConeGeometry(A.headR, A.headLen, A.sides);
  head.rotateX(Math.PI);
  head.translate(0, A.headLen / 2, 0);
  const shaftLen = A.len - A.headLen + 0.01;
  const shaft = new THREE.CylinderGeometry(A.shaftR, A.shaftR, shaftLen, A.sides);
  shaft.translate(0, A.headLen - 0.01 + shaftLen / 2, 0);
  const merged = mergeGeometries([head, shaft], false)!;
  head.dispose(); shaft.dispose();
  const g = merged.toNonIndexed();
  merged.dispose();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const n = g.getAttribute('normal'), col = new Float32Array(n.count * 3);
  const L = new THREE.Vector3(0.45, 0.75, 0.5).normalize(), base = new THREE.Color(INK.border).convertSRGBToLinear(), v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    const s = 0.42 + 0.58 * Math.max(0, v.dot(L));
    col[i * 3] = base.r * s; col[i * 3 + 1] = base.g * s; col[i * 3 + 2] = base.b * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A label plate for atlas row `row`: a front quad facing +Z and a back quad facing -Z with mirrored u (readable from both sides). */
export function labelGeometry(row: number, rows: number = ONBOARDING_MARKERS.length): THREE.BufferGeometry {
  const w = ONBOARDING.label.w / 2, h = ONBOARDING.label.h / 2, v0 = 1 - (row + 1) / rows, v1 = 1 - row / rows;
  const pos = [-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0, w, -h, 0, -w, -h, 0, -w, h, 0, w, h, 0];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  // back quad: seen from -Z its left is +X, so u runs 0 at +X .. 1 at -X (the text reads left to right from behind too)
  const uv = [0, v0, 1, v0, 1, v1, 0, v1, 0, v0, 1, v0, 1, v1, 0, v1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// The view (one group in the train-local frame)

export interface OnboardingMarkerView {
  pose: MarkerPose;
  label: THREE.Mesh;
  arrow: THREE.Mesh;
  /** Arrow rest pose (train-local tip / unit direction) and its alignment of the template's -Y onto the direction. */
  tip: THREE.Vector3;
  dir: THREE.Vector3;
  align: THREE.Quaternion;
  /** The label centre in world space (on-screen test). */
  world: THREE.Vector3;
}

export interface OnboardingView {
  root: THREE.Group;
  markers: OnboardingMarkerView[];
  geometries: THREE.BufferGeometry[];
}

const noRaycast = () => {};
const DOWN = new THREE.Vector3(0, -1, 0);

/** Builds the seven markers under one group posed like the car (train-local children). Nothing collides, casts or is raycast. */
export function buildOnboardingView(poses: readonly MarkerPose[], p: TrainPlacement, mats: OnboardingMaterials): OnboardingView {
  const root = new THREE.Group();
  root.name = 'train-onboarding';
  root.position.set(p.x, p.railTopY, p.z);
  root.rotation.set(0, p.yaw, 0);
  const arrowGeo = arrowGeometry();
  const geometries: THREE.BufferGeometry[] = [arrowGeo];
  const markers: OnboardingMarkerView[] = [];
  for (const pose of poses) {
    const row = ONBOARDING_MARKERS.findIndex(d => d.id === pose.id);
    const lg = labelGeometry(Math.max(0, row));
    geometries.push(lg);
    const label = new THREE.Mesh(lg, mats.label);
    label.name = `train-onboarding-label-${pose.id}`;
    label.position.set(pose.label.x, pose.label.y, pose.label.z);
    label.rotation.set(0, pose.facing, 0);
    const a = arrowPose(pose);
    const arrow = new THREE.Mesh(arrowGeo, mats.arrow);
    arrow.name = `train-onboarding-arrow-${pose.id}`;
    arrow.scale.set(1, a.len / ONBOARDING.arrow.len, 1);
    const dir = new THREE.Vector3(a.dir.x, a.dir.y, a.dir.z), tip = new THREE.Vector3(a.tip.x, a.tip.y, a.tip.z);
    const align = new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
    arrow.position.copy(tip);
    arrow.quaternion.copy(align);
    for (const m of [label, arrow]) {
      m.castShadow = false; m.receiveShadow = false; m.raycast = noRaycast;
      m.userData.level = p.level;
      m.userData.onboarding = pose.id;
      root.add(m);
    }
    const w = trainToWorld(p, pose.label.x, pose.label.y, pose.label.z);
    markers.push({pose, label, arrow, tip, dir, align, world: new THREE.Vector3(w.x, w.y, w.z)});
  }
  root.updateMatrixWorld(true);
  return {root, markers, geometries};
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** What the onboarding needs from Game (structural: tests drive it with a fake host). */
export interface OnboardingHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; alive: boolean};
  levels: Levels;
  layout: StationLayout;
  /** gen/playerTrain.ts playerTrainPlacement(layout), set by Game.buildSection before the section hooks (null: no train here). */
  trainPlacement?: TrainPlacement | null;
  state: string;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  warmRegistry: WarmupRegistry;
  /** world/playerTrain.ts PlayerTrainRuntime: the placed desk's box, the moving car's link (non-null while it moves), and which of
   *  layout.props are the car's see-through window glass (sight lines pass it). */
  trainRuntime?: {consoleRect: ConsoleRect | null; ride: unknown; isGlass?(box: PropPlacement | undefined): boolean} | null;
  /** Game.inputOwners: a lane view owns the mouse (an open Lockbox view, a carried corpse, a vomit fit) — not counted as presented. */
  inputOwners?: (() => boolean)[];
}

/** Where a label is sampled for sight (fractions of its width from the centre along the plate). */
const SIGHT_SAMPLES = [0, -1 / 3, 1 / 3] as const;

export interface OnboardingStatus {
  armed: boolean;
  built: boolean;
  visible: boolean;
  presented: boolean;
  presentedSeconds: number;
  distance: number;
  markers: {id: OnboardingMarkerId; label: P3; world: P3}[];
}

export class TrainOnboarding {
  view: OnboardingView | null = null;
  /** The parked train of the built station (null: none / torn down). */
  private section: {placement: TrainPlacement; layout: StationLayout; levels: Levels} | null = null;
  /** Presented at this station (ONBOARDING.presentSeconds of near, on-screen play), and the time counted so far. */
  presented = false;
  presentedT = 0;
  /** Distance to the train area on the last counted frame (status / tests). */
  distance = Infinity;
  private time = 0;
  private readonly v = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  /** The label materials / atlas, created with the first shown markers and disposed when the onboarding completes. */
  private mats: OnboardingMaterials | null = null;
  /** The store's state at the last event (a reload that leaves it armed keeps this station's presentation progress). */
  private wasArmed = true;
  /** The last sight check's result and its age (s; Infinity: check on the next counted frame). */
  private seen = false;
  private sightAge = Infinity;
  readonly counts = {shown: 0, hidden: 0, completed: 0, rearmed: 0};

  constructor(readonly host: OnboardingHost, readonly store: OnboardingStore, readonly spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.warmRegistry.addPool('train-onboarding', () => (this.view ? [this.view.root] : []));
    this.wasArmed = this.armed;
    this.store.subscribe(e => this.onStore(e));
    return this;
  }

  /** The train onboarding still has to be shown (not completed in this browser). */
  get armed(): boolean {
    return !this.store.isDone('train');
  }

  build(): void {
    this.teardown();
    const h = this.host, p = h.trainPlacement ?? null;
    if (!p || !h.levels || !h.layout) return;
    this.section = {placement: p, layout: h.layout, levels: h.levels};
    if (this.armed) this.show();
  }

  teardown(): void {
    this.hide();
    this.section = null;
    this.presented = false;
    this.presentedT = 0;
    this.distance = Infinity;
    this.sightAge = Infinity;
  }

  /** Build the markers at the current parked train (no-op without one / when already shown). */
  private show(): void {
    const s = this.section;
    if (!s || this.view) return;
    const poses = onboardingMarkerPoses(s.placement, {levels: s.levels, layout: s.layout}, this.spec, this.host.trainRuntime?.consoleRect ?? null);
    this.view = buildOnboardingView(poses, s.placement, (this.mats ??= createOnboardingMaterials()));
    this.view.root.visible = !this.riding();
    this.host.scene.add(this.view.root);
    this.counts.shown++;
  }

  private hide(): void {
    const v = this.view;
    if (!v) return;
    this.view = null;
    this.host.scene.remove(v.root);
    for (const g of v.geometries) g.dispose();
    this.counts.hidden++;
  }

  private riding(): boolean {
    return !!this.host.trainRuntime?.ride;
  }

  private onStore(e: OnboardingEvent): void {
    const was = this.wasArmed;
    this.wasArmed = this.armed;
    if (this.armed) {
      // re-armed (Reset tutorials here, or a reset in another tab seen by a reload): presentation starts over at the current train,
      // shown at once; a reload that changes nothing keeps this station's progress
      if (e.kind === 'reset' || !was) {
        this.presented = false;
        this.presentedT = 0;
        this.sightAge = Infinity;
      }
      if (e.kind === 'reset') this.counts.rearmed++;
      this.show();
    } else {
      this.hide();
      if (this.mats) { disposeOnboardingMaterials(this.mats); this.mats = null; }
    }
  }

  frame(dt: number): void {
    const v = this.view, s = this.section;
    if (!v || !s) return;
    const visible = !this.riding();
    v.root.visible = visible;
    if (!visible) return;
    this.time += dt;
    this.animate();
    const h = this.host;
    if (h.state !== 'playing' || !h.player.alive) { this.sightAge = Infinity; return; }
    const d = (this.distance = trainAreaDistance(s.placement, h.player.x, h.player.y, h.player.z, this.spec));
    if (!this.presented) {
      if (d < ONBOARDING.departDistance && !h.inputOwners?.some(f => f())) {
        if ((this.sightAge += dt) >= ONBOARDING.sightEvery) { this.sightAge = 0; this.seen = this.onScreen(); }
        if (this.seen) {
          this.presentedT += dt;
          if (this.presentedT >= ONBOARDING.presentSeconds) this.presented = true;
        }
      } else this.sightAge = Infinity;
      return;
    }
    if (d >= ONBOARDING.departDistance) {
      this.counts.completed++;
      this.store.complete('train'); // (the store's listener hides the markers and releases their materials)
      this.hide();
    }
  }

  /** At least one label lies inside the camera's view (in front, within the frustum and ONBOARDING.viewDistance) and in sight — its
   *  centre or a point a third of the way out to either end (a plate half behind a door jamb / window frame still reads). */
  onScreen(): boolean {
    const v = this.view, cam = this.host.camera;
    if (!v) return false;
    cam.updateMatrixWorld();
    const eye = this.eye.setFromMatrixPosition(cam.matrixWorld);
    for (const m of v.markers) {
      if (m.world.distanceTo(eye) > ONBOARDING.viewDistance) continue;
      m.label.updateWorldMatrix(true, false);
      for (const f of SIGHT_SAMPLES) {
        const at = m.label.localToWorld(this.at.set(f * ONBOARDING.label.w, 0, 0));
        const n = this.v.copy(at).project(cam);
        if (n.z > -1 && n.z < 1 && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && this.inSight(eye, at)) return true;
      }
    }
    return false;
  }

  /** Nothing solid between the eye and a label centre: the level's walls / floors / ceilings and its props — the car's own walls,
   *  partitions and fittings among them; the car's window glass is see-through (the ray continues past it). */
  inSight(eye: THREE.Vector3, at: THREE.Vector3): boolean {
    const s = this.section;
    if (!s) return false;
    const props = s.layout.props, glass = this.host.trainRuntime?.isGlass?.bind(this.host.trainRuntime);
    const dist = eye.distanceTo(at);
    if (dist < 1e-3) return true;
    const d = {x: (at.x - eye.x) / dist, y: (at.y - eye.y) / dist, z: (at.z - eye.z) / dist};
    let t0 = 0;
    for (let pass = 0; pass < 8; pass++) {
      const o = {x: eye.x + d.x * t0, y: eye.y + d.y * t0, z: eye.z + d.z * t0};
      const hit = raycastWorld(s.levels, props, o, d, dist - t0, s.layout.trench.floorY);
      if (hit.kind === 'none' || t0 + hit.t >= dist - 0.05) return true;
      if (hit.kind !== 'prop' || !glass?.(props[hit.prop!])) return false;
      t0 += hit.t + 0.02; // through the pane
    }
    return false;
  }

  /** The labels turn toward the eye (within their swing); the arrows bob along their direction and spin. */
  private animate(): void {
    const v = this.view, s = this.section;
    if (!v || !s) return;
    const cam = this.host.camera, A = ONBOARDING.arrow;
    const eye = this.v.setFromMatrixPosition(cam.matrixWorld);
    const e = worldToTrain(s.placement, eye.x, eye.y, eye.z);
    const bob = A.bob * (0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 * A.bobHz));
    this.spin.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.time * A.spin);
    for (const m of v.markers) {
      m.label.rotation.y = labelYaw(m.pose, e.x, e.z);
      m.arrow.position.copy(m.tip).addScaledVector(m.dir, -bob);
      m.arrow.quaternion.copy(this.q.copy(m.align).multiply(this.spin));
    }
  }

  /** QA / tests. */
  status(): OnboardingStatus {
    return {
      armed: this.armed, built: !!this.view, visible: !!this.view?.root.visible, presented: this.presented, presentedSeconds: this.presentedT,
      distance: this.distance, markers: (this.view?.markers ?? []).map(m => ({id: m.pose.id, label: {...m.pose.label}, world: {x: m.world.x, y: m.world.y, z: m.world.z}})),
    };
  }
}

export function installTrainOnboarding(host: OnboardingHost, store: OnboardingStore, spec?: PlayerTrainSpec): TrainOnboarding {
  return new TrainOnboarding(host, store, spec).install();
}
