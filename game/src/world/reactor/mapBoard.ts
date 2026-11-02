// Task reactor-expansion-20261101 (lane CONTROLS): THE FLOOR-MAP BOARDS' runtime (pure parts: mapBoardPlan.ts / mapBoardDraw.ts).
// installReactorMapBoards(game) is called ONCE from the Game constructor and only REGISTERS (inert on every level without
// layout.reactor):
//  - sectionHooks.build: the plan of every storey (once), one PHYSICAL board beside each objective instruction board — a rusted-steel
//    backing + frame on the wall, the self-lit map face (canvas texture) and a column of small round STOREY BUTTONS (elevator style:
//    the selected one lit amber) — each board showing its own storey first; teardown disposes the per-world canvases / materials.
//  - interactHandlers (E) + promptProviders + frameHooks: the button under the crosshair (within reach, its face toward you, nothing
//    structural between, no living enemy in front — the elevator / restart rules) shows "E — show <storey> on the map"; E selects it.
//  - the markers follow the live game: the restart record (the restart runtime's live state, else the persisted lane store), the
//    generators' record, the inventory and the live pickups — recomputed only when a cheap numeric signature of those changes; a board
//    redraws only when ITS key changes (storey, its markers, the floor counts, "you are here" quantised while you stand near it).
// Geometry is shared (module singletons); canvases / textures / face materials are per world.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import {REACTOR_LANE, loadReactorState, type ReactorRunState} from './runState';
import {reactorRestartOf} from './restart';
import {screenFacing} from './restartViews';
import {controlSkin, lampSkin} from './controlsSkin';
import {MAP_BOARD, MAP_PX, mapButtons, mapMarkers, markerOpen, markerSig, planMapBoards, planStoreys, storeyWarning, type MapBoardPose, type MapButton, type MapMarker, type MapPlan} from './mapBoardPlan';
import {drawMapFace} from './mapBoardDraw';
import {rayCylinder, towerCue, type P3} from '../towerShared';

/** Reach (m, eye to a button) and the pick radius of a button (m). */
export const MAP_REACH = 2.3;
const BUTTON_PICK_R = 0.055;
/** Marker sources are polled this often (s). */
const POLL_S = 0.25;
/** "You are here" follows the player while within this distance (m) of a board. */
const YOU_NEAR = 14;

export interface MapBoardHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; yaw?: number; alive: boolean};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[];
  levels: {raycast(o: P3, d: P3, maxDist: number): {kind: string; t: number}; levelAt(x: number, z: number, y: number): number};
  layout: StationLayout;
  inv: {count(itemId: string): number; version?: number};
  pickups?: {list: readonly {stack: {itemId: string}; x: number; y: number; z: number}[]} | null;
  run: {laneStore<T>(lane: string): T | undefined};
  sfx: unknown;
  state: string;
  interactHandlers: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
  world?: {culler?: unknown} | null;
}

interface Board {
  pose: MapBoardPose;
  root: THREE.Group;
  buttons: {b: MapButton; mesh: THREE.Mesh}[];
  selected: number;
  canvas: HTMLCanvasElement | null;
  texture: THREE.Texture;
  material: THREE.Material;
  key: string;
}

const geos = new Map<string, THREE.BufferGeometry>();
const G = (k: string, make: () => THREE.BufferGeometry) => { let g = geos.get(k); if (!g) geos.set(k, (g = make())); return g; };

const runtimes = new WeakMap<object, ReactorMapBoards>();
/** The map-board runtime installed into a host (QA / tests). */
export const reactorMapBoardsOf = (host: object): ReactorMapBoards | undefined => runtimes.get(host);

export class ReactorMapBoards {
  info: ReactorInfo | null = null;
  plan: MapPlan | null = null;
  readonly boards: Board[] = [];
  root: THREE.Group | null = null;
  markers: MapMarker[] = [];
  target: {board: Board; button: number} | null = null;
  prompt: string | null = null;
  readonly counts = {presses: 0, redraws: 0, markerBuilds: 0};
  private pollT = 0;
  private srcSig = NaN;
  private markerKey = '';
  /** Task reactor-playtest-round2-20261102 (lane GAS): the jam warning banner per tier index (null: none). */
  private warns: (string | null)[] = [];
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly eye: P3 = {x: 0, y: 0, z: 0};
  private readonly dir: P3 = {x: 0, y: 0, z: 0};

  constructor(readonly host: MapBoardHost) {}

  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.interact());
    h.promptProviders?.push(() => this.prompt);
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    if (this.info) this.teardown();
    const info = layout.reactor;
    if (!info) return;
    this.info = info;
    const openAt = (x: number, z: number, level: number): boolean => {
      const g = layout.levels?.[level]?.grid ?? (level === 0 ? layout.grid : null);
      if (!g) return true;
      const [cx, cy] = g.cellOf(x, z);
      return g.inBounds(cx, cy) && g.passable(cx, cy);
    };
    this.plan = planStoreys(layout, info);
    const root = new THREE.Group();
    root.name = 'reactor-map-boards';
    const levels = [...info.tiers].sort((a, b) => b.baseY - a.baseY).map(t => t.level);
    for (const pose of planMapBoards(layout, info, sc => screenFacing(sc, openAt))) {
      const b = this.buildBoard(pose, levels);
      root.add(b.root);
      this.boards.push(b);
    }
    this.host.scene.add(root);
    this.root = root;
    const culler = this.host.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(root);
    this.srcSig = NaN;
    this.pollT = 0;
    this.refresh();
  }

  teardown(): void {
    if (this.root) this.host.scene.remove(this.root);
    for (const b of this.boards) { b.texture.dispose(); b.material.dispose(); }
    this.boards.length = 0;
    this.root = null;
    this.info = null;
    this.plan = null;
    this.markers = [];
    this.target = null;
    this.prompt = null;
  }

  private buildBoard(pose: MapBoardPose, levels: readonly number[]): Board {
    const root = new THREE.Group();
    root.name = `reactor-map-board-${pose.screen}`;
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.y = Math.atan2(pose.nx, pose.nz);
    const W = MAP_BOARD.w, H = MAP_BOARD.h, D = MAP_BOARD.depth;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.userData.level = pose.level; root.add(m); return m; };
    // rusted-steel backing from inside the wall face to the map face, a frame round it (the existing Codex rusted-steel set)
    add(G(`back${W},${H}`, () => new THREE.BoxGeometry(W + 0.06, H + 0.06, D + 0.012)), controlSkin('steel'), 0, 0, -(D + 0.012) / 2 + 0.001);
    const t = 0.045;
    for (const [x, y, sx, sy] of [[0, (H + t) / 2, W + 2 * t, t], [0, -(H + t) / 2, W + 2 * t, t], [(W + t) / 2, 0, t, H], [-(W + t) / 2, 0, t, H]] as const)
      add(G(`frame${sx},${sy}`, () => new THREE.BoxGeometry(sx, sy, 0.04)), controlSkin('steel'), x, y, -0.005);
    // the self-lit map face
    const hasCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function';
    const canvas = hasCanvas ? document.createElement('canvas') : null;
    if (canvas) { canvas.width = MAP_PX.w; canvas.height = MAP_PX.h; }
    const texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.DataTexture(new Uint8Array([20, 26, 30, 255]), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const material = new MeshBasicNodeMaterial({map: texture, color: new THREE.Color(0.84, 0.84, 0.84)});
    material.name = `reactor-map-face-${pose.screen}`;
    add(G(`face${W},${H}`, () => new THREE.PlaneGeometry(W, H)), material, 0, 0, 0.002).name = `reactor-map-face-${pose.screen}`;
    // the storey buttons: brass bezels with a lens button (lit amber = the storey shown)
    const buttons = mapButtons(pose, levels).map(b => {
      const lx = (b.x - pose.x) * pose.rx + (b.z - pose.z) * pose.rz, ly = b.y - pose.y;
      add(G('bezel', () => new THREE.CylinderGeometry(MAP_BOARD.buttonR + 0.01, MAP_BOARD.buttonR + 0.01, 0.012, 20).rotateX(Math.PI / 2)), controlSkin('brass'), lx, ly, 0.008);
      const mesh = add(G('button', () => new THREE.CylinderGeometry(MAP_BOARD.buttonR, MAP_BOARD.buttonR, 0.022, 20).rotateX(Math.PI / 2)), lampSkin('lens'), lx, ly, 0.02);
      mesh.name = `reactor-map-button-L${b.level}`;
      return {b, mesh};
    });
    const board: Board = {pose, root, buttons, selected: pose.level, canvas, texture, material, key: ''};
    this.lightButtons(board);
    return board;
  }

  private lightButtons(b: Board): void {
    for (const q of b.buttons) q.mesh.material = lampSkin(q.b.level === b.selected ? 'litAmber' : 'lens');
  }

  // -------------------------------------------------------------------------------------------
  // Markers + redraws

  private liveState(): Readonly<ReactorRunState> | null {
    const info = this.info;
    if (!info) return null;
    // the restart runtime's live record (it polls the generators' record too), else the persisted one
    const rt = reactorRestartOf(this.host as object);
    return rt?.state ?? loadReactorState(this.host.run.laneStore(REACTOR_LANE), info.generators.length, info.zones.length);
  }

  /** Cheap numeric signature of everything the markers read (no allocation). */
  private sourceSig(s: Readonly<ReactorRunState>): number {
    let h = 17;
    const mix = (v: number) => { h = (Math.imul(h, 31) + (v | 0)) | 0; };
    for (const f of s.fuses) mix(f ? 1 : 2);
    mix(+s.breaker); mix(+s.valve); mix(+s.pump); mix(+s.keyInserted); mix(+s.rods);
    for (const g of s.generators) mix(g.started ? 3 : 4);
    mix(+s.restarted); for (const c of s.zoneClear) mix(c >= 1 ? 5 : 6); // (lane GAS) the jam warning banner follows the air
    mix(this.host.inv.count('reactor_key')); mix(this.host.inv.count('fuse_cartridge'));
    for (const p of this.host.pickups?.list ?? []) {
      const id = p.stack.itemId;
      if (id !== 'reactor_key' && id !== 'fuse_cartridge') continue;
      mix(id === 'reactor_key' ? 7 : 11); mix(Math.round(p.x * 4)); mix(Math.round(p.z * 4)); mix(Math.round(p.y * 4));
    }
    return h;
  }

  /** Recompute the markers when their sources changed, then redraw the boards whose content changed. */
  refresh(): void {
    const info = this.info, s = this.liveState();
    if (!info || !s) return;
    const sig = this.sourceSig(s);
    if (sig !== this.srcSig) {
      this.srcSig = sig;
      const pk = this.host.pickups?.list ?? [];
      this.markers = mapMarkers({
        info, state: s,
        carried: id => this.host.inv.count(id),
        pickups: id => pk.filter(p => p.stack.itemId === id).map(p => ({x: p.x, y: p.y, z: p.z})),
        levelAt: (x, z, y) => { try { const l = this.host.levels.levelAt(x, z, y + 0.1); return l >= 0 ? l : 0; } catch { return 0; } },
      });
      this.markerKey = markerSig(this.markers);
      this.warns = info.tiers.map(t => storeyWarning(info, s, t.level)); // (lane GAS) per tier index (levels are tier levels)
      this.markerKey += `|${this.warns.map(w => (w ? 1 : 0)).join('')}`;
      this.counts.markerBuilds++;
    }
    for (const b of this.boards) this.redraw(b);
  }

  /** The player's storey (or -1). */
  private playerLevel(): number {
    const P = this.host.player;
    try { return this.host.levels.levelAt(P.x, P.z, P.y + 0.1); } catch { return -1; }
  }

  private redraw(b: Board): void {
    const plan = this.plan, info = this.info;
    if (!plan || !info) return;
    const P = this.host.player, here = this.playerLevel();
    const near = Math.hypot(P.x - b.pose.x, P.z - b.pose.z) < YOU_NEAR;
    const yaw = this.cameraYaw();
    const you = here === b.selected && near ? {x: P.x, z: P.z, yaw} : null;
    const youKey = you ? `${Math.round(you.x * 2)},${Math.round(you.z * 2)},${Math.round((yaw / (Math.PI * 2)) * 16)}` : '-';
    const key = `${b.selected}|${this.markerKey}|${youKey}|${here}`;
    if (key === b.key) return;
    b.key = key;
    const ctx = typeof b.canvas?.getContext === 'function' ? b.canvas.getContext('2d') as CanvasRenderingContext2D | null : null;
    if (!ctx) return;
    const storey = plan.storeys.find(s => s.level === b.selected) ?? plan.storeys[0];
    const levels = b.buttons.map(q => q.b.level);
    drawMapFace(ctx, MAP_PX.w, MAP_PX.h, {
      plan, storey, markers: this.markers.filter(m => m.level === b.selected), you,
      board: b.selected === b.pose.level ? {x: b.pose.x, z: b.pose.z} : null,
      floors: levels.map(l => ({level: l, label: info.tiers.find(t => t.level === l)?.label ?? `L${l}`, need: this.markers.filter(m => m.level === l && markerOpen(m)).length, selected: l === b.selected, here: l === here})), // (lane GAS: jammed is not open)
      warn: this.warns[info.tiers.findIndex(t => t.level === b.selected)] ?? null, // (lane GAS) the jam banner on a gassed storey
    });
    b.texture.needsUpdate = true;
    this.counts.redraws++;
  }

  /** Camera yaw (camera convention: forward = (-sin, -cos)). */
  private cameraYaw(): number {
    this.host.camera.getWorldDirection(this.vDir);
    return Math.atan2(-this.vDir.x, -this.vDir.z);
  }

  // -------------------------------------------------------------------------------------------
  // Per frame: the storey button under the crosshair

  frame(dt: number): void {
    if (!this.info) { this.prompt = null; return; }
    this.target = this.host.state === 'playing' ? this.pick() : null;
    const t = this.target;
    this.prompt = t ? `E — show ${this.info.tiers.find(q => q.level === t.board.buttons[t.button].b.level)?.label ?? 'this floor'} on the map` : null;
    this.pollT -= dt;
    if (this.pollT <= 0) { this.pollT = POLL_S; this.refresh(); }
  }

  /** The storey button the view ray enters within reach, face toward the eye, unoccluded, no enemy in front. Allocation-free. */
  pick(): {board: Board; button: number} | null {
    const h = this.host;
    if (!h.player.alive || !this.boards.length) return null;
    h.camera.getWorldPosition(this.vEye); h.camera.getWorldDirection(this.vDir);
    const E = this.eye, D = this.dir;
    E.x = this.vEye.x; E.y = this.vEye.y; E.z = this.vEye.z;
    D.x = this.vDir.x; D.y = this.vDir.y; D.z = this.vDir.z;
    let best: Board | null = null, bi = -1, bt = MAP_REACH;
    for (const b of this.boards) {
      if (Math.hypot(b.pose.x - E.x, b.pose.z - E.z) > MAP_REACH + 1) continue;
      if (D.x * b.pose.nx + D.z * b.pose.nz > -0.05) continue; // looking at its face
      b.buttons.forEach((q, i) => {
        const ox = q.b.x - E.x, oy = q.b.y - E.y, oz = q.b.z - E.z;
        const tca = ox * D.x + oy * D.y + oz * D.z;
        if (tca <= 0) return;
        const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
        if (d2 > BUTTON_PICK_R * BUTTON_PICK_R) return;
        const t = tca - Math.sqrt(BUTTON_PICK_R * BUTTON_PICK_R - d2);
        if (t < bt) { bt = t; best = b; bi = i; }
      });
    }
    if (!best) return null;
    const hit = h.levels.raycast(E, D, bt + 0.02);
    if (hit.kind !== 'none' && hit.t < bt - 0.03) return null;
    for (const z of h.zombies) {
      const zb = z.brain;
      if (!zb.alive || z.ragdolled) continue;
      if (rayCylinder(E, D, zb.x, zb.z, zb.stats.radius + 0.05, zb.y, zb.y + 1.9, bt) !== null) return null;
    }
    return {board: best, button: bi};
  }

  /** E: select the storey of the button under the crosshair (true = handled). */
  interact(): boolean {
    if (!this.info || this.host.state !== 'playing') return false;
    const t = this.pick();
    if (!t) return false;
    this.select(t.board, t.board.buttons[t.button].b.level);
    const b = t.board.buttons[t.button].b;
    towerCue(this.host.sfx, 'click', {x: b.x, y: b.y, z: b.z}, {rate: 1.5, gain: 0.7});
    return true;
  }

  /** Shows storey `level` on board `b` (buttons relit, the face redrawn). */
  select(b: Board, level: number): void {
    this.counts.presses++;
    if (b.selected === level) return;
    b.selected = level;
    this.lightButtons(b);
    this.redraw(b);
  }

  /** QA: a compact report. */
  qa(): object {
    return {
      boards: this.boards.map(b => ({screen: b.pose.screen, level: b.pose.level, at: {x: +b.pose.x.toFixed(2), y: +b.pose.y.toFixed(2), z: +b.pose.z.toFixed(2)}, sameWall: b.pose.sameWall, selected: b.selected})),
      markers: this.markers.map(m => ({kind: m.kind, level: m.level, state: m.state, x: +m.x.toFixed(2), z: +m.z.toFixed(2)})),
      target: this.target ? {screen: this.target.board.pose.screen, level: this.target.board.buttons[this.target.button].b.level} : null,
      counts: {...this.counts},
    };
  }
}

/** Installs the floor-map boards into a Game (one call in the Game constructor; inert off the Reactor). */
export function installReactorMapBoards(host: MapBoardHost): ReactorMapBoards {
  return new ReactorMapBoards(host).install();
}
