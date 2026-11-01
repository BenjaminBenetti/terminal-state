// Task reactor-build-20261101 (lane RESTART): PERSISTENT LOCAL MILESTONES — the only thing this game keeps across page loads (a run
// itself is never saved). One small JSON record in localStorage, key 'terminal-state.milestones.v1':
//   {reactorRestarted: {at: ISO date, levelSeed}}
// written ONCE, the first time the reactor is restarted (later restarts keep the first record). The title screen shows a small
// earned badge from it (main.ts). Safe when storage is unavailable / full / blocked / holds garbage: reads give {}, writes give false.
// Pure (no DOM beyond the Storage interface, injectable for tests).

export const MILESTONES_KEY = 'terminal-state.milestones.v1';

export interface Milestones {
  reactorRestarted?: {at: string; levelSeed: number};
}

/** The subset of the Web Storage API used here (tests pass a fake). */
export type MilestoneStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** window.localStorage when it is reachable (private modes / sandboxed frames may throw on access), else null. */
export function defaultMilestoneStorage(): MilestoneStorage | null {
  try {
    const s = (globalThis as {localStorage?: MilestoneStorage}).localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/** The stored milestones ({} when none / unreadable / malformed). */
export function readMilestones(storage: MilestoneStorage | null = defaultMilestoneStorage()): Milestones {
  if (!storage) return {};
  try {
    const raw = storage.getItem(MILESTONES_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== 'object') return {};
    const out: Milestones = {};
    const r = (j as {reactorRestarted?: unknown}).reactorRestarted as {at?: unknown; levelSeed?: unknown} | undefined;
    if (r && typeof r === 'object' && typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at))) {
      out.reactorRestarted = {at: r.at, levelSeed: typeof r.levelSeed === 'number' && Number.isFinite(r.levelSeed) ? r.levelSeed >>> 0 : 0};
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Record "Reactor restarted / run complete" (first time only). True when it was written now; false when it already existed or the
 * storage is unavailable (the game never depends on it).
 */
export function recordReactorRestarted(levelSeed: number, now: Date = new Date(), storage: MilestoneStorage | null = defaultMilestoneStorage()): boolean {
  if (!storage) return false;
  const m = readMilestones(storage);
  if (m.reactorRestarted) return false;
  m.reactorRestarted = {at: now.toISOString(), levelSeed: Number.isFinite(levelSeed) ? levelSeed >>> 0 : 0};
  try {
    storage.setItem(MILESTONES_KEY, JSON.stringify(m));
    return true;
  } catch {
    return false;
  }
}

/** The title badge text ("" when not earned): "★ Reactor restarted · 1 Nov 2026". */
export function milestoneBadge(m: Milestones): string {
  const r = m.reactorRestarted;
  if (!r) return '';
  const d = new Date(r.at);
  const date = Number.isNaN(d.getTime()) ? '' : ` · ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
  return `★ Reactor restarted — run complete${date}`;
}
