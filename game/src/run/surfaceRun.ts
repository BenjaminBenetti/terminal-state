/** Surface Run is pinned on first generation, independently of the base layout and enemy RNGs. */
import type {SectionMemory} from './memory';
import type {LevelId, SectionKey} from '../levels/types';

export const SURFACE_VERSION_LANE = 'surface.version';
export const SURFACE_VERSION = 1;
export const SURFACE_SECTION = 'surface';

export function surfaceVersionProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'surface version is not an object';
  const rec = raw as Record<string, unknown>;
  if (Object.keys(rec).length !== 1 || (rec.v !== 0 && rec.v !== SURFACE_VERSION)) return 'unsupported surface version';
  return null;
}

export function surfaceVersionFor(mem: Pick<SectionMemory, 'visits' | 'lanes'> | undefined): number {
  const rec = mem?.lanes[SURFACE_VERSION_LANE] as {v?: unknown} | undefined;
  if (rec && (rec.v === 0 || rec.v === SURFACE_VERSION)) return rec.v;
  return mem && mem.visits > 0 ? 0 : SURFACE_VERSION;
}

export function surfaceBaseKey(key: SectionKey): SectionKey {
  return {...key, section: 'main'};
}

export function surfaceBaseLevel(level: LevelId): level is 'subway' | 'office' | 'mall' {
  return level === 'subway' || level === 'office' || level === 'mall';
}

/** A section transition must stay within this station. It is never a campaign train journey. */
export function isSurfaceTransition(from: SectionKey, to: SectionKey): boolean {
  return surfaceBaseLevel(from.level) && from.level === to.level && from.station === to.station &&
    ((from.section === 'main' && to.section === SURFACE_SECTION) || (from.section === SURFACE_SECTION && to.section === 'main'));
}
