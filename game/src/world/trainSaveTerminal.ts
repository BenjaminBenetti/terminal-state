// Task studio-refinement-batch-20261113-035659-01 (lane SAVE): THE SAVE TERMINAL in the player's train — user: "Manual train save:
// small retro Fallout-esque CRT LEFT of the main drive terminal, labeled 'Save'. Interaction invokes the existing actual active-slot
// save path, truthfully reporting success/failure. Keep autosaves and Continue/Retry unchanged."
//
// installSaveTerminal(game) is called ONCE from the Game constructor (after the train and the ride); it only REGISTERS: sectionHooks
// (build = attach to the car's view root, forget the last result; teardown = detach unless the riding car keeps its view), a frameHook
// (the screen's redraw check, only near the terminal), sectionModelKeys (the reused CRT model is fetched with the car), warmRegistry
// pool 'train-save-terminal', and PlayerTrainRuntime.saveTerminal — the train's own aim (world/playerTrain.ts pickAim: the nearest of
// the doors, the Lockbox, the desk and this terminal, the same reach / partitions / occlusion, parked and riding) gives it its glow,
// its prompt and its [E], so the desk beside it never takes the key.
//
// FIXTURE (prop rules, docs/prop-affordances.md §6: a fixed part of the car — never a layout prop kind, cargo or equipment, so the
// acid / melt rules never reach it; NOT storage, nothing to open; no baked clutter: the keyboard is part of the terminal): the reused
// Meshy CRT terminal (P7 'crtTerminal', game/public/assets/models/p7-crt-terminal-t25.glb, its own maps kept) at 0.68 scale on a
// small steel wall shelf (plain geometry, plain material, like the plug sockets) in the strip between the desk's -Z end and the -Z
// lining: world/trainSaveTerminalPlace.ts. Task studio-scanner-console-refinements-20261114-031614-01 turned it to face INWARD (+Z,
// across the cab, toward the operator at the drive controls) — the model, its screen patch, the shelf, the aim box and the QA stand
// spot all follow the one placement. While the library has no model (Node tests, a failed fetch) a plain stand-in of the measured
// size stands there instead. Its solid box (shelf + terminal) is the train's (trainColliders / buildRideLocalModel).
//
// THE SCREEN is a DYNAMIC canvas texture drawn here (the texture rule's dynamic-text exemption: runtime status text over the generated
// model): a green phosphor "SAVE" heading, the ACTIVE slot, the slot's real last save (time + why, read from the slot through
// Game.lastSaveStatus), and the state of this terminal — "[E] SAVE GAME", why it cannot save now (Game.saveBlock), or the result of
// the last attempt. It sits on a curved patch fitted to the model's bulging glass (unlit, display-referred) and is redrawn only when
// what it shows changes (one string compare per frame while the player is near the car).
//
// [E] runs Game.saveNow(): the existing active-slot save path (commitSave -> SaveSlots.commit: validated, one write, read back). The
// result is reported truthfully: success -> "Game saved · slot N" (+ the commit's own warning when it has one), the existing click
// cue; any refusal / failure -> the result's own error as a warning toast + the denied sound, and the same on the screen. Repeated
// presses within SAVE_RT.cooldownMs are ignored.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Game} from '../game';
import type {StationLayout} from '../gen/stationTypes';
import {playerTrainPlacement} from '../gen/playerTrain';
import type {WarmupRegistry} from '../render/warmup';
import type {CommitResult} from '../save/slots';
import type {LastSaveStatus} from '../ui/loadingScreen';
import {displayReferred} from './lights';
import type {TrainFixtureLink} from './playerTrain';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {towerCue} from './towerShared';
import {SAVE_TERMINAL, SAVE_TERMINAL_MODEL, SAVE_TERMINAL_MODEL_KEY, saveTerminalPlacement, screenGlassZ, type SaveTerminalPlacement} from './trainSaveTerminalPlace';

// ---------------------------------------------------------------------------------------------------------------------------------
// The save API's result types (Game.saveBlock / Game.saveNow)

/** Why a manual save is refused before anything is captured or written. */
export type SaveRefusalCode = 'no-campaign' | 'not-playing' | 'dead' | 'moving' | 'busy' | 'no-train' | 'outside' | 'lift' | 'acid' | 'bad-slot' | 'conflict';
export interface SaveRefusal { ok: false; code: SaveRefusalCode; error: string }
/** Game.saveNow: a refusal, or the active slot's CommitResult (ok: written and read back; otherwise its own player-readable error). */
export type SaveNowResult = CommitResult | SaveRefusal;

/** Tuning (one place). */
export const SAVE_RT = {
  /** Presses closer together than this (ms) are ignored (one save per press, not a burst). */
  cooldownMs: 800,
  /** Beyond this (m, horizontal) from the terminal there is no per-frame work at all. */
  near: 12,
  /** The screen canvas (px; the patch is 0.30 x 0.24 m at scale 1: the same 5:4). */
  canvas: {w: 480, h: 384},
} as const;

/** Prompt / toast texts (user-visible, truthful). */
export const SAVE_TEXT = {
  prompt: (slot: number) => `<b>[E]</b> Save game · slot ${slot}`,
  /** The prompt while a save is not possible: the reason, no [E] promise. */
  blocked: (why: string) => `Save terminal · ${why}`,
  saved: (slot: number) => `Game saved · slot ${slot}`,
} as const;

/** The prompt's short reasons (else the refusal's own text without its "Not saved:" lead). */
const SHORT_REASON: Partial<Record<SaveRefusalCode, string>> = {
  'moving': 'saves only while the train is stopped',
  'bad-slot': 'this run has no save slot',
  'conflict': 'this run does not own its save slot',
  'no-campaign': 'this run is not saved',
  'lift': 'wait for the lift to stop',
  'acid': 'acid is still at work — a moment',
  'outside': 'step inside the train',
};

/** What a refusal says in the prompt / on the screen. */
export function refusalShort(r: SaveRefusal): string {
  return SHORT_REASON[r.code] ?? r.error.replace(/^Not saved:\s*/, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The screen's content (pure: tests read it; the canvas only draws it)

export type ScreenTone = 'ok' | 'dim' | 'warn';
export interface ScreenLine { text: string; tone: ScreenTone }
export interface SaveScreenModel { title: string; lines: ScreenLine[] }

/** The last attempt made at this terminal since the station was built (what the screen reports). */
export type TerminalResult = {ok: true; slot: number; at: string} | {ok: false; error: string};

const REASON_LABEL: Record<string, string> = {
  'departure': 'DEPARTURE', 'arrival': 'ARRIVAL', 'new-game': 'NEW GAME', 'ending': 'ENDING', 'manual': 'MANUAL', 'import': 'IMPORTED',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "14:32" (local time) of an ISO stamp; '--:--' when it is not a date. */
export function clockText(iso: string, seconds = false): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '--:--';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${seconds ? `:${pad2(d.getSeconds())}` : ''}`;
}

/** Wrap upper-case text into lines of at most `n` characters (words kept whole when they fit). */
export function wrapText(text: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= n) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
    while (cur.length > n) { out.push(cur.slice(0, n)); cur = cur.slice(n); }
  }
  if (cur) out.push(cur);
  return out;
}

/** Characters per screen line (the canvas font is sized for it). */
export const SCREEN_COLS = 22;

/**
 * The screen as it stands: the active slot, its real last save (`status`: Game.lastSaveStatus), then the terminal's state — why it
 * cannot save now (`block`), else the last attempt here (`result`), else the [E] invitation.
 */
export function saveScreenModel(i: {slot: number | null; status: LastSaveStatus | null; block: SaveRefusal | null; result: TerminalResult | null}): SaveScreenModel {
  const lines: ScreenLine[] = [];
  lines.push(i.slot !== null ? {text: `SLOT ${i.slot} · ACTIVE`, tone: 'ok'} : {text: 'NO SAVE SLOT', tone: 'warn'});
  const s = i.status;
  if (s?.ok) lines.push({text: `LAST ${clockText(s.meta.savedAt)} ${REASON_LABEL[s.meta.reason] ?? String(s.meta.reason).toUpperCase()}`.slice(0, SCREEN_COLS), tone: 'dim'});
  else if (s && i.slot !== null) lines.push({text: wrapText(s.message, SCREEN_COLS)[0] ?? '', tone: 'dim'});
  else lines.push({text: '', tone: 'dim'});
  lines.push({text: '', tone: 'dim'});
  if (i.block) {
    for (const t of wrapText(refusalShort(i.block), SCREEN_COLS).slice(0, 3)) lines.push({text: t, tone: 'warn'});
  } else if (i.result?.ok) {
    lines.push({text: `SAVED ${clockText(i.result.at, true)}`, tone: 'ok'});
    lines.push({text: '> [E] SAVE AGAIN', tone: 'dim'});
  } else if (i.result) {
    lines.push({text: 'SAVE FAILED', tone: 'warn'});
    for (const t of wrapText(i.result.error.replace(/^Not saved:\s*/, ''), SCREEN_COLS).slice(0, 3)) lines.push({text: t, tone: 'warn'});
  } else lines.push({text: '> [E] SAVE GAME_', tone: 'ok'});
  return {title: 'SAVE', lines};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The view (built once per runtime; kept across stations: the group moves from car view to car view)

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

const PHOSPHOR: Record<ScreenTone, string> = {ok: '#6dff97', dim: '#39b862', warn: '#ffb648'};

/** Draw the screen model onto its canvas (green phosphor on near-black glass, scanlines, a dark rim that melts into the CRT's glass). */
export function drawSaveScreen(ctx: CanvasRenderingContext2D, m: SaveScreenModel, w: number, h: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createRadialGradient(w / 2, h / 2, h * 0.08, w / 2, h / 2, h * 0.72);
  bg.addColorStop(0, '#0b2a13');
  bg.addColorStop(0.75, '#04140a');
  bg.addColorStop(1, '#010402');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const mx = Math.round(w * 0.085);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowBlur = 10;
  // the heading (the terminal's label)
  ctx.font = `bold ${Math.round(h * 0.24)}px "Courier New", Courier, monospace`;
  ctx.fillStyle = ctx.shadowColor = PHOSPHOR.ok;
  ctx.fillText(m.title, mx, Math.round(h * 0.29));
  ctx.fillRect(mx, Math.round(h * 0.335), w - 2 * mx, Math.max(2, Math.round(h * 0.01)));
  // the status lines
  const fs = Math.round((w - 2 * mx) / (SCREEN_COLS * 0.6));
  ctx.font = `bold ${fs}px "Courier New", Courier, monospace`;
  let y = Math.round(h * 0.335) + fs * 1.35;
  for (const l of m.lines.slice(0, 7)) {
    if (l.text) { ctx.fillStyle = ctx.shadowColor = PHOSPHOR[l.tone]; ctx.fillText(l.text, mx, y); }
    y += Math.round(fs * 1.15);
  }
  ctx.shadowBlur = 0;
  // scanlines + the rim
  ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
  for (let r = 0; r < h; r += 3) ctx.fillRect(0, r, w, 1);
  const rim = ctx.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 0.78);
  rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rim.addColorStop(1, 'rgba(1, 4, 2, 0.92)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, w, h);
}

/** The curved screen patch (model frame, metres at scale 1): fitted to the CRT's bulging glass, lifted off it, facing +Z. */
export function buildScreenGeometry(): THREE.BufferGeometry {
  const S = SAVE_TERMINAL.screen, nx = 12, ny = 10;
  const g = new THREE.PlaneGeometry(S.x1 - S.x0, S.y1 - S.y0, nx, ny);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (S.x0 + S.x1) / 2, y = pos.getY(i) + (S.y0 + S.y1) / 2;
    pos.setXYZ(i, x, y, screenGlassZ(x, y) + S.lift);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The steel wall shelf with its two L-brackets (train-local; one merged geometry). */
export function buildShelfGeometry(p: SaveTerminalPlacement): THREE.BufferGeometry {
  const S = p.shelf, parts: THREE.BufferGeometry[] = [];
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rotX = 0) => {
    const b = new THREE.BoxGeometry(sx, sy, sz);
    if (rotX) b.rotateX(rotX);
    parts.push(b.translate(x, y, z));
  };
  const lx = S.x1 - S.x0, lz = S.z1 - S.z0;
  box(lx, S.y1 - S.y0, lz, (S.x0 + S.x1) / 2, (S.y0 + S.y1) / 2, (S.z0 + S.z1) / 2); // the slab
  box(lx, 0.025, 0.008, (S.x0 + S.x1) / 2, S.y1 + 0.0125, S.z1 - 0.004); // a low lip along the front edge (the terminal never slides off)
  // two brackets: a plate on the lining + a strut from its foot to the slab's underside near the outer edge
  const wall = S.z0, drop = 0.2, plateT = 0.008, strutW = 0.022, reach = lz * 0.85;
  for (const x of [S.x0 + 0.035, S.x1 - 0.035]) {
    box(0.03, drop, plateT, x, S.y0 - drop / 2, wall + plateT / 2);
    const dz = reach, dy = drop - 0.01, len = Math.hypot(dz, dy), ang = Math.atan2(dy, dz);
    // a strut along +Z (box length on z), rotated about X so it climbs from the plate's foot to the underside of the slab
    const s = new THREE.BoxGeometry(strutW, 0.012, len);
    s.rotateX(-ang);
    parts.push(s.translate(x, S.y0 - drop / 2 + 0.005, wall + plateT + dz / 2));
  }
  const g = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The stand-in (no model yet): the monitor as a box behind its glass line, the keyboard as a slab (model frame, scale 1). */
function buildStandIn(): {root: THREE.Group; geos: THREE.BufferGeometry[]; mats: THREE.Material[]} {
  const M = SAVE_TERMINAL_MODEL, root = new THREE.Group();
  root.name = 'train-save-terminal-standin';
  const plastic = new THREE.MeshStandardMaterial({name: 'train-save-terminal-standin', color: 0xc9bc98, roughness: 0.7, metalness: 0});
  const back = -M.d / 2, face = -0.07; // (the bezel plane; the screen patch bulges in front of it)
  const mon = new THREE.BoxGeometry(M.w, M.h, face - back).translate(0, M.h / 2, (back + face) / 2);
  const kb = new THREE.BoxGeometry(M.w * 0.92, 0.05, 0.24).translate(0, 0.025, 0.125);
  for (const [g, n] of [[mon, 'train-save-terminal-standin-monitor'], [kb, 'train-save-terminal-standin-keyboard']] as const) {
    const o = new THREE.Mesh(g, plastic);
    o.name = n;
    o.raycast = () => {};
    root.add(o);
  }
  return {root, geos: [mon, kb], mats: [plastic]};
}

interface V3 { x: number; y: number; z: number }

/** What the terminal needs from Game (structural: tests drive it with the real train runtime and a small host). */
export interface SaveTerminalHost {
  player: {x: number; y: number; z: number; alive: boolean};
  state: string;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  trainRuntime?: {
    view: {root: THREE.Object3D} | null;
    train?: {placement: {level: number}} | null;
    spec?: PlayerTrainSpec;
    carPoint(x: number, y: number, z: number): V3 | null;
    saveTerminal: TrainFixtureLink | null;
  } | null;
  trainRide?: {riding: boolean} | null;
  propModels?: {get(key: string): {scene: THREE.Object3D} | undefined};
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  sectionModelKeys?: ((layout: StationLayout) => readonly string[])[];
  warmRegistry: WarmupRegistry;
  /** The save API (Game): why not now / save now / the active slot's last persisted save. */
  saveBlock(): SaveRefusal | null;
  saveNow(): SaveNowResult;
  lastSaveStatus(): LastSaveStatus;
  currentSlot: number | null;
  saveRevision: number;
}

export interface SaveTerminalOptions {
  /** The model's scene (default: the prop library's SAVE_TERMINAL_MODEL_KEY; null = none yet -> the stand-in). */
  model?: () => THREE.Object3D | null;
  /** Clock for the result stamps (default: new Date()). */
  now?: () => Date;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Game.sectionModelKeys: the reused CRT model for a level that parks the car. */
export function saveTerminalModelKeys(layout: StationLayout): string[] {
  return playerTrainPlacement(layout) && saveTerminalPlacement() ? [SAVE_TERMINAL_MODEL_KEY] : [];
}

export class SaveTerminalSystem implements TrainFixtureLink {
  readonly spec: PlayerTrainSpec;
  readonly place: SaveTerminalPlacement | null;
  /** Train-local root on the car's view root (the shelf + the fixture). */
  readonly group = new THREE.Group();
  /** The terminal at its placement (model frame: the model / stand-in and the screen patch). */
  readonly fixture = new THREE.Group();
  model: THREE.Object3D | null = null;
  standIn: THREE.Group | null = null;
  /** The screen patch, its canvas (null in Node) and texture. */
  readonly screen: THREE.Mesh;
  readonly texture: THREE.Texture;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  /** What the screen shows now (tests / QA). */
  shown: SaveScreenModel | null = null;
  /** The last attempt at this terminal since the station was built. */
  result: TerminalResult | null = null;
  readonly counts = {attached: 0, attempts: 0, saved: 0, refused: 0, ignored: 0, redraws: 0};
  /** The steel wall shelf (null without a placement). */
  readonly shelf: THREE.Mesh | null = null;
  private modelSrc: THREE.Object3D | null = null;
  private standInParts: {geos: THREE.BufferGeometry[]; mats: THREE.Material[]} | null = null;
  private resultSeq = 0;
  private lastPress = -Infinity;
  private key = '';
  private world: V3 | null = null;

  constructor(readonly host: SaveTerminalHost, readonly opts: SaveTerminalOptions = {}) {
    this.spec = host.trainRuntime?.spec ?? PLAYER_TRAIN_SPEC;
    this.place = saveTerminalPlacement(this.spec);
    this.group.name = 'train-save-terminal-group';
    this.fixture.name = 'train-save-terminal';
    this.group.add(this.fixture);
    const C = SAVE_RT.canvas;
    const c = hasCanvas() ? document.createElement('canvas') : null;
    const ctx = c && typeof c.getContext === 'function' ? (c.width = C.w, c.height = C.h, c.getContext('2d')) : null;
    this.canvas = ctx ? c : null;
    this.ctx = ctx;
    let tex: THREE.Texture;
    if (this.canvas && ctx) tex = new THREE.CanvasTexture(this.canvas);
    else { tex = new THREE.DataTexture(new Uint8Array([6, 24, 12, 255]), 1, 1); tex.needsUpdate = true; }
    tex.name = 'train-save-terminal-screen';
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    this.texture = tex;
    const mat = new MeshBasicNodeMaterial({name: 'train-save-terminal-screen', map: tex, color: 0xffffff, side: THREE.FrontSide});
    displayReferred(mat); // (a lit phosphor: drawn at its own brightness, never tone-mapped down into the dark glass)
    this.screen = new THREE.Mesh(buildScreenGeometry(), mat);
    this.screen.name = 'train-save-terminal-screen';
    this.screen.raycast = () => {};
    this.screen.castShadow = this.screen.receiveShadow = false;
    const p = this.place;
    if (p) {
      this.fixture.position.set(p.x, p.shelfY, p.z);
      this.fixture.rotation.set(0, p.yaw, 0);
      this.fixture.scale.setScalar(p.scale);
      this.fixture.add(this.screen);
      const steel = new THREE.MeshStandardMaterial({name: 'train-save-shelf-steel', color: 0x5d5f5c, roughness: 0.6, metalness: 0.55});
      const shelf = new THREE.Mesh(buildShelfGeometry(p), steel);
      shelf.name = 'train-save-terminal-shelf';
      shelf.raycast = () => {};
      this.group.add(shelf);
      this.shelf = shelf;
    }
  }

  // --- registration ----------------------------------------------------------------------------------------------------

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.update());
    h.sectionModelKeys?.push(saveTerminalModelKeys);
    h.warmRegistry.addPool('train-save-terminal', () => (this.attach() ? [this.group] : []));
    if (h.trainRuntime && this.place) h.trainRuntime.saveTerminal = this;
    return this;
  }

  // --- the fixture -------------------------------------------------------------------------------------------------------

  /** Parent the terminal to the current car view (none: detached). Cheap when already there. */
  attach(): boolean {
    const view = this.place ? this.host.trainRuntime?.view ?? null : null;
    if (!view) { if (this.group.parent) this.group.removeFromParent(); return false; }
    if (this.group.parent !== view.root) {
      view.root.add(this.group);
      this.counts.attached++;
      this.ensureModel();
      this.levelMeshes();
      if (this.shelf) this.host.atmosphere?.markShadows(this.shelf, false); // (the model is marked when it is placed; the screen never casts)
      this.redraw();
    } else this.ensureModel();
    return true;
  }

  /** The cooked model once the library has it; until then the stand-in (never nothing, never a crash). */
  private ensureModel(): void {
    if (!this.place) return;
    const src = this.opts.model ? this.opts.model() : this.host.propModels?.get(SAVE_TERMINAL_MODEL_KEY)?.scene ?? null;
    if (src) {
      if (src === this.modelSrc) return;
      if (this.model) this.fixture.remove(this.model);
      const m = src.clone(true); // (geometry / materials shared with the library: never disposed here)
      m.name = 'train-save-terminal-model';
      m.traverse(o => { o.raycast = () => {}; }); // (the car's box is the terminal for rays: trainColliders)
      this.fixture.add(m);
      this.model = m;
      this.modelSrc = src;
      this.dropStandIn();
      this.levelMeshes();
      this.host.atmosphere?.markShadows(m, false);
    } else if (!this.model && !this.standIn) {
      const s = buildStandIn();
      this.standIn = s.root;
      this.standInParts = {geos: s.geos, mats: s.mats};
      this.fixture.add(s.root);
      this.levelMeshes();
      this.host.atmosphere?.markShadows(s.root, false);
    }
  }

  private dropStandIn(): void {
    const s = this.standIn, p = this.standInParts;
    if (!s) return;
    this.fixture.remove(s);
    for (const g of p?.geos ?? []) g.dispose();
    for (const m of p?.mats ?? []) m.dispose();
    this.standIn = null;
    this.standInParts = null;
  }

  /** Every mesh carries the car's level (the culler's tag). */
  private levelMeshes(): void {
    const level = this.host.trainRuntime?.train?.placement.level ?? 0;
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
  }

  // --- TrainFixtureLink (world/playerTrain.ts pickAim / glow / prompt / [E]) -----------------------------------------------

  aimBox(): {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number} | null {
    return this.place && this.group.parent ? this.place.aim : null;
  }

  /** The terminal's own meshes (the model or the stand-in; never the screen or the shelf): the glow. */
  meshes(): THREE.Mesh[] {
    this.ensureModel();
    const out: THREE.Mesh[] = [];
    (this.model ?? this.standIn)?.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.highlightPrototype) out.push(m); });
    return out;
  }

  prompt(): string | null {
    const b = this.host.saveBlock();
    if (b) return SAVE_TEXT.blocked(refusalShort(b));
    return SAVE_TEXT.prompt(this.host.currentSlot ?? 0);
  }

  /** [E] on the aimed terminal: the real active-slot save, reported truthfully (toast + cue + the screen). */
  interact(): void {
    const t = nowMs();
    if (t - this.lastPress < SAVE_RT.cooldownMs) { this.counts.ignored++; return; }
    this.lastPress = t;
    this.counts.attempts++;
    const h = this.host;
    let r: SaveNowResult;
    try { r = h.saveNow(); } catch (err) { r = {ok: false, code: 'busy', error: `Not saved: ${String((err as Error)?.message ?? err)}`}; } // (saveNow never throws; belt and braces)
    const sfx = h.sfx as {denied?(): void; click?(pitch?: number): void} | null;
    if (r.ok) {
      this.counts.saved++;
      this.result = {ok: true, slot: r.slot, at: r.meta.savedAt || (this.opts.now?.() ?? new Date()).toISOString()};
      h.hud.toast(SAVE_TEXT.saved(r.slot));
      if (r.warning) h.hud.toast(r.warning, true);
      const at = this.world ?? this.terminalWorld();
      if (at) towerCue(h.sfx, 'click', at, {rate: 1.6, gain: 0.9});
      else sfx?.click?.(1.6);
    } else {
      this.counts.refused++;
      this.result = {ok: false, error: r.error};
      h.hud.toast(r.error, true);
      sfx?.denied?.();
    }
    this.resultSeq++;
    this.redraw();
  }

  // --- lifecycle ---------------------------------------------------------------------------------------------------------

  build(): void {
    this.result = null; // (a new station: the screen reports this visit's attempts only; the slot's real last save stays on it)
    this.resultSeq++;
    this.world = null;
    this.attach();
    this.redraw();
  }

  teardown(): void {
    this.world = null;
    if (this.host.trainRide?.riding && this.group.parent) return; // the riding car keeps its view (and the terminal)
    this.group.removeFromParent();
  }

  /** The terminal's world point (the screen's centre), null without a car. */
  terminalWorld(): V3 | null {
    const p = this.place;
    if (!p) return null;
    return this.host.trainRuntime?.carPoint(p.screen.x, p.screen.y, p.screen.z) ?? null;
  }

  // --- per frame: the screen -------------------------------------------------------------------------------------------

  /** What the screen's content depends on, as one cheap string. */
  private stateKey(): string {
    const h = this.host, b = h.saveBlock();
    return `${h.currentSlot ?? '-'}|${h.saveRevision}|${b?.code ?? ''}|${this.resultSeq}`;
  }

  /** Per playing frame: near the car only, one string compare; a redraw when what the screen shows changed. */
  update(): void {
    if (!this.attach()) return;
    const P = this.host.player, w = this.world ?? (this.world = this.terminalWorld());
    if (!w) return;
    if (this.host.trainRide?.riding) this.world = null; // (a moving car: its world point moves too)
    const dx = P.x - w.x, dz = P.z - w.z;
    if (dx * dx + dz * dz > SAVE_RT.near * SAVE_RT.near) return;
    if (this.stateKey() !== this.key) this.redraw();
  }

  /** Redraw the screen from the live state (Game.saveBlock / lastSaveStatus; this terminal's last result). */
  redraw(): void {
    const h = this.host;
    this.key = this.stateKey();
    let status: LastSaveStatus | null = null;
    try { status = h.lastSaveStatus(); } catch { status = null; }
    const m = saveScreenModel({slot: h.currentSlot, status, block: h.saveBlock(), result: this.result});
    this.shown = m;
    this.counts.redraws++;
    if (this.ctx) {
      drawSaveScreen(this.ctx, m, SAVE_RT.canvas.w, SAVE_RT.canvas.h);
      this.texture.needsUpdate = true;
    }
  }

  // --- QA ----------------------------------------------------------------------------------------------------------------

  qa() {
    const p = this.place;
    return {
      placed: !!p, attached: !!this.group.parent, model: !!this.model, standIn: !!this.standIn, shelf: !!this.shelf,
      at: p ? {x: p.x, z: p.z, shelfY: p.shelfY, yaw: p.yaw, scale: p.scale, screen: p.screen, facing: p.facing} : null,
      size: p ? {w: p.width, h: p.height, d: p.depth} : null, box: p?.box ?? null, top: p?.top ?? null,
      screen: this.shown, result: this.result, block: this.host.saveBlock(), counts: {...this.counts},
    };
  }
}

/** Installs the save terminal (one call in the Game constructor, after the train and the ride; registries only). */
export function installSaveTerminal(game: Game, opts: SaveTerminalOptions = {}): SaveTerminalSystem {
  return new SaveTerminalSystem(game as unknown as SaveTerminalHost, opts).install();
}

/** QA hooks for the lead's short serial browser spot check (spread into window.__LL by qa.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function saveTerminalQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {saveTerminal?: SaveTerminalSystem; saveNow?(): SaveNowResult; player: {x: number; y: number; z: number; yaw: number; pitch: number; vy: number; grounded: boolean}};
  return {
    /** The save terminal: placement, model / stand-in, the screen's lines, the last result, why it cannot save now. */
    saveTerminal: () => g.saveTerminal?.qa() ?? null,
    /** Stand at the drive controls (behind the desk's middle), looking at the terminal's screen (the prompt shows on the next frame). */
    saveTerminalGo: () => {
      const s = g.saveTerminal, p = s?.place, tr = s?.host.trainRuntime;
      if (!s || !p || !tr) return false;
      const at = tr.carPoint(p.driver.x, p.floorY, p.driver.z), aim = tr.carPoint(p.screen.x, p.screen.y, p.screen.z);
      if (!at || !aim) return false;
      const P = g.player;
      P.x = at.x; P.z = at.z; P.y = at.y; P.vy = 0; P.grounded = true;
      P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
      P.pitch = Math.atan2(aim.y - (at.y + 1.62), Math.hypot(aim.x - at.x, aim.z - at.z));
      return true;
    },
    /** Save now through the terminal's own path (toast + screen), as [E] on it would. */
    saveTerminalPress: () => { g.saveTerminal?.interact(); return g.saveTerminal?.result ?? null; },
  };
}
