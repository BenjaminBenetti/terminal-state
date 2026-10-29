// Iteration 17 (seamless, primary): QA walker + traversal trace (?qa=1 only, spread into window.__LL by qa.ts).
//
// Traversal evidence must come from the real game loop, not a teleport: walkTo() plans a route with the game's own
// PathFinder (storey-aware: stairs between storeys), then each frame steers the player's yaw toward the next waypoint and
// HOLDS the W key in the real Input — Player.update moves the body with its normal speed, collision, stairs and support.
// trace() samples every frame (gameplay clock, frames, x / y / z, storey, state) so a spot check can prove that y changes
// continuously across a floor boundary while the clock keeps running and no lifecycle entry point (generate / build /
// warm-up / loading / travel) is called (Game.lifecycleCounts).

import type {Waypoint} from './gen/grid';

interface WalkGame {
  readonly player: {x: number; y: number; z: number; yaw: number; pitch: number; alive: boolean};
  readonly input: {keys: Set<string>};
  readonly levels: {levelAt(x: number, z: number, y: number): number} | null;
  readonly pathfinder: {find(ax: number, az: number, bx: number, bz: number, radius?: number, maxExpand?: number, opts?: {ay?: number; by?: number}): Waypoint[] | null};
  readonly frameHooks: ((dt: number) => void)[];
  readonly state: string;
  readonly clock: number;
  readonly frames: number;
  readonly lifecycleCounts: Record<string, number>;
}

export interface TraceSample { t: number; f: number; x: number; y: number; z: number; level: number; state: string }

const ARRIVE = 0.35;
const STUCK_S = 4;
const TRACE_CAP = 30000;

export function walkerQaApi(game: unknown) {
  const g = game as WalkGame;
  let path: Waypoint[] = [];
  let i = 0;
  let status: 'idle' | 'walking' | 'arrived' | 'stuck' | 'no-path' = 'idle';
  let best = Infinity, bestT = 0;
  let tracing = false;
  const trace: TraceSample[] = [];

  const release = () => { g.input.keys.delete('KeyW'); g.input.keys.delete('ShiftLeft'); };

  g.frameHooks.push(() => {
    const p = g.player;
    if (tracing && trace.length < TRACE_CAP) {
      trace.push({t: +g.clock.toFixed(4), f: g.frames, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), level: g.levels ? g.levels.levelAt(p.x, p.z, p.y + 0.05) : 0, state: g.state});
    }
    if (status !== 'walking') return;
    if (!p.alive) { status = 'stuck'; release(); return; }
    // advance past reached waypoints (a waypoint with a y must also be reached in height: stairs)
    while (i < path.length) {
      const [wx, wz, , wy] = path[i];
      const d = Math.hypot(wx - p.x, wz - p.z);
      if (d < ARRIVE && (wy === undefined || Math.abs(wy - p.y) < 0.9)) { i++; best = Infinity; bestT = g.clock; } else break;
    }
    if (i >= path.length) { status = 'arrived'; release(); return; }
    const [wx, wz] = path[i];
    const dx = wx - p.x, dz = wz - p.z, d = Math.hypot(dx, dz);
    if (d < best - 0.05) { best = d; bestT = g.clock; } else if (g.clock - bestT > STUCK_S) { status = 'stuck'; release(); return; }
    p.yaw = Math.atan2(-dx, -dz); // camera convention: forward = (-sin yaw, -cos yaw)
    p.pitch = 0;
    g.input.keys.add('KeyW');
  });

  return {
    /** Walk (real input) to (x, z) on the storey whose floor is near y. Returns the planned waypoint count (0: no route). */
    walkTo: (x: number, z: number, y?: number, maxExpand = 400000): number => {
      const p = g.player;
      const found = g.pathfinder.find(p.x, p.z, x, z, 0.3, maxExpand, {ay: p.y, by: y});
      release();
      if (!found || !found.length) { status = 'no-path'; path = []; return 0; }
      path = found; i = 0; best = Infinity; bestT = g.clock; status = 'walking';
      return path.length;
    },
    walkStop: () => { status = 'idle'; release(); },
    walkStatus: () => ({status, index: i, waypoints: path.length, next: path[i] ?? null, player: {x: +g.player.x.toFixed(2), y: +g.player.y.toFixed(3), z: +g.player.z.toFixed(2)}}),
    /** Start (clearing) / stop the per-frame trace. */
    traceStart: () => { trace.length = 0; tracing = true; },
    traceStop: () => { tracing = false; return trace.length; },
    /** Trace summary: samples, clock span, y range, storeys visited, largest per-frame |dy| and dt gap, states seen. */
    traceSummary: () => {
      let maxDy = 0, maxDt = 0, minY = Infinity, maxY = -Infinity;
      const levels = new Set<number>(), states = new Set<string>();
      for (let k = 0; k < trace.length; k++) {
        const s = trace[k];
        minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        levels.add(s.level); states.add(s.state);
        if (k) { maxDy = Math.max(maxDy, Math.abs(s.y - trace[k - 1].y)); maxDt = Math.max(maxDt, s.t - trace[k - 1].t); }
      }
      const a = trace[0], b = trace[trace.length - 1];
      return {samples: trace.length, clock: a ? [a.t, b.t] : null, frames: a ? [a.f, b.f] : null, y: trace.length ? [minY, maxY] : null,
        levels: [...levels].sort((p, q) => p - q), states: [...states], maxStepDy: +maxDy.toFixed(4), maxStepDt: +maxDt.toFixed(4)};
    },
    /** Every n-th trace sample (for evidence files). */
    traceSamples: (every = 10) => trace.filter((_, k) => k % every === 0 || k === trace.length - 1),
    /** World lifecycle entry-point call counts (generate / prepare / build / leave / travel / warmup / loading). */
    lifecycle: () => ({...g.lifecycleCounts}),
  };
}
