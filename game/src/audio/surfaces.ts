// Surface guess for hitscan hit points (drives impact sound bank + visual impact style).
// Mirrors the builder's finish rules: public spaces have tiled walls and terrazzo floors,
// back-of-house is painted block/concrete; props map by kind (unknown kinds -> metal).

import type {Surface} from './sfx';

const PROP_SURFACE: Record<string, Surface> = {
  bench: 'metal', cabinetTall: 'metal', cabinetLow: 'metal', column: 'metal', bin: 'metal', fareGate: 'metal',
  vending: 'metal', shelf: 'metal', trashCan: 'metal', locker: 'metal',
  crate: 'wood', stall: 'wood', table: 'wood', counter: 'wood', pallet: 'wood',
};

interface AreaLike { kind: string; type: string; publicSpace: boolean }
interface PropLike { kind: string; x: number; y: number; z: number; hx: number; hz: number; h: number }
interface GridLike { areaAt(x: number, z: number): number }

export interface SurfaceWorld { grid: GridLike; areas: readonly AreaLike[]; props: readonly PropLike[] }

/** The prop whose box contains point p (within eps), nearest centre first. */
export function propAt(props: readonly PropLike[], x: number, y: number, z: number, eps = 0.04): PropLike | null {
  let best: PropLike | null = null, bd = Infinity;
  for (const p of props) {
    const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z);
    if (dx > p.hx + eps || dz > p.hz + eps || y < p.y - eps || y > p.y + p.h + eps) continue;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function surfaceOf(kind: 'wall' | 'floor' | 'ceiling' | 'prop' | 'none' | string, x: number, y: number, z: number, nx: number, nz: number, w: SurfaceWorld): Surface {
  if (kind === 'prop') {
    const p = propAt(w.props, x, y, z);
    return (p && PROP_SURFACE[p.kind]) || 'metal';
  }
  if (kind === 'ceiling') return 'concrete';
  // step back off the face into the space the bullet travelled through
  const ai = w.grid.areaAt(x + nx * 0.25, z + nz * 0.25);
  const a = ai >= 0 ? w.areas[ai] : undefined;
  if (kind === 'floor') {
    if (y < -0.2 || !a) return 'concrete'; // track bed / unknown
    if (a.type === 'washroom') return 'tile';
    return a.publicSpace && a.kind !== 'platform' ? 'tile' : 'concrete';
  }
  // walls: builder tiles public spaces (and the trench far wall, area -1)
  return !a || a.publicSpace || a.type === 'washroom' ? 'tile' : 'concrete';
}
