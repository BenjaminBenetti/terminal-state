// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): SURFACE RUN — the [E] way up / out of a host station and the way
// back down / in from its district, installed by world/surface/install.ts. Inert outside a Surface Run layout (`layout.surfaceAccess` on a
// host station's 'main', `layout.surface` on the district).
//  - Host station: the access (gen/surface/access.ts) — its street door is drawn here (world/surface/accessView.ts; the Mall's is its own
//    street exit, world/mallStreetExit.ts) and standing in its [E] box looking at the door offers "Go up to the street" (Subway) /
//    "Go out to the street" (Office / Mall).
//  - District: GEN's portal (layout.surface.portal) — its prompt label is set here from the station ("Back down to <Station>" for the
//    subway entrance stair, "Back inside <Station>" for a building's street doors).
// The press runs Game.crossSurface (the loading screen, the crossing participants, the warm-up); a refusal (moving train, in the truck's
// seat, on a ladder, a crossing participant's "set it down first", …) is shown in the prompt and toasted on the press — nothing changes.

import type * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {SBox} from '../../gen/surface/surfaceTypes';
import {hostKeyOf} from '../../gen/surface/surfaceRun';
import {buildAccessDoor} from './accessView';

/** How the player must stand at a way: inside its box (feet within y0..y1), looking within `look` rad of its focus (or right at it). */
export const ACCESS_AIM = {look: 1.0, near: 0.8};

/** The section's way to the other world (null: none). */
export interface SurfaceWay {
  dir: 'up' | 'down';
  /** The [E] box (absolute y). */
  trigger: SBox;
  /** What the player looks at (the door / the portal's middle). */
  focus: {x: number; z: number};
  /** The prompt's action ("Go up to the street", "Back down to Bramley Rd"). */
  label: string;
}

const runtimes = new WeakMap<object, SurfaceAccessRuntime>();
/** The access runtime of a game (QA / tests). */
export const surfaceAccessOf = (game: object): SurfaceAccessRuntime | undefined => runtimes.get(game);

export class SurfaceAccessRuntime {
  way: SurfaceWay | null = null;
  /** The player stands at the way, looking at it (this frame). */
  aimed = false;
  /** The drawn street door (host: Subway / Office), in the world group. */
  door: THREE.Group | null = null;
  readonly counts = {builds: 0, presses: 0, refused: 0, crossings: 0};

  constructor(readonly game: Game) {}

  install(): this {
    const g = this.game;
    runtimes.set(g, this);
    g.sectionHooks.push({build: layout => this.build(layout as StationLayout), teardown: () => this.teardown()});
    g.frameHooks.push(() => this.frame());
    g.interactHandlers.push(() => this.interact());
    g.promptProviders.push(() => this.prompt());
    return this;
  }

  /** The section's way (and the host's door mesh), after its world is built — before the warm-up, so the door compiles with it. */
  build(layout: StationLayout): void {
    this.teardown();
    const g = this.game;
    if (layout.surface) {
      const p = layout.surface.portal;
      const host = hostKeyOf(g.run.current), name = g.surfaceStationName(host);
      p.label = p.kind === 'stair' ? `Back down to ${name}` : `Back inside ${name}`;
      const t = p.trigger;
      this.way = {dir: 'down', trigger: t, focus: {x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2}, label: p.label};
    } else if (layout.surfaceAccess) {
      const a = layout.surfaceAccess, t = a.trigger;
      let focus = {x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2};
      if (a.door) focus = {x: a.door.x, z: a.door.z};
      else if (a.exit) {
        const e = layout.mall?.exits?.find(x => x.id === a.exit);
        if (e) focus = e.side === 'N' || e.side === 'S' ? {x: (e.door.s0 + e.door.s1) / 2, z: e.door.plane} : {x: e.door.plane, z: (e.door.s0 + e.door.s1) / 2};
      }
      this.way = {dir: 'up', trigger: t, focus, label: a.kind === 'subway-stair' ? 'Go up to the street' : 'Go out to the street'};
      if (a.door && g.world && g.mats) {
        this.door = buildAccessDoor(g.mats, a.door, a.kind === 'subway-stair');
        g.world.group.add(this.door);
      }
    }
    if (this.way) this.counts.builds++;
  }

  teardown(): void {
    // (the door's geometry is disposed with the world group by Game.leaveSection; only the reference goes here)
    this.door?.removeFromParent();
    this.door = null;
    this.way = null;
    this.aimed = false;
  }

  /** Whether the player stands at the way looking at it. */
  aimedNow(): boolean {
    const w = this.way, g = this.game, p = g.player;
    if (!w || g.state !== 'playing' || g.surfaceCrossing) return false;
    const t = w.trigger;
    if (p.x < t.x0 || p.x > t.x1 || p.z < t.z0 || p.z > t.z1 || p.y < t.y0 || p.y > t.y1) return false;
    const dx = w.focus.x - p.x, dz = w.focus.z - p.z, d = Math.hypot(dx, dz);
    if (d < ACCESS_AIM.near) return true;
    // the view's forward is (-sin yaw, -cos yaw)
    const cos = (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / d;
    return Math.acos(Math.max(-1, Math.min(1, cos))) <= ACCESS_AIM.look;
  }

  frame(): void {
    this.aimed = this.aimedNow();
  }

  prompt(): string | null {
    if (!this.aimed || !this.way) return null;
    const r = this.game.surfaceCrossRefusal();
    if (r?.code === 'busy') return null;
    return r ? `${this.way.label} — ${r.text}` : `<b>[E]</b> ${this.way.label}`;
  }

  interact(): boolean {
    if (!this.aimed || !this.way) return false;
    this.counts.presses++;
    const r = this.game.surfaceCrossRefusal();
    if (r) {
      this.counts.refused++;
      if (r.code !== 'busy') { this.game.hud.toast(r.text, true); this.game.sfx.denied(); }
      return true;
    }
    this.counts.crossings++;
    void this.game.crossSurface();
    return true;
  }
}

export function installSurfaceAccess(game: Game): void {
  new SurfaceAccessRuntime(game).install();
}
