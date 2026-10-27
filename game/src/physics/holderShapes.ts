// Iteration 07 (Lane K): collision of LOOT HOLDERS for loose items and chunks.
//
// Props are solid AABBs for walking, hitscan and ragdolls, but a holder's box contains its loot
// surfaces (shelf tiers, cooler / fridge shelves, cabinet interiors, crate floors), so an item that
// becomes a rigid body there must not start inside a solid box. Items and chunks therefore collide
// with the holder's real resting surfaces instead: a solid base under the lowest surface, a slab
// under every higher surface (so a shot can drops from tier to tier), and for enclosed holders
// (cabinets, crates, coolers, fridges, lockers, display cases) side / back walls and a roof around
// the surfaces (glazed fronts closed too). Holders with no surface inside their footprint (vending:
// spill area on the floor) stay one solid box. Pure maths on PropPlacement + holder-local surfaces.

import * as THREE from 'three';
import type {PropPlacement} from '../gen/props';

/** A holder-local resting surface (items/lootLayout.ts Surface): items stand on y within [x0,x1]x[z0,z1]. */
export interface SurfaceLike { y: number; x0: number; x1: number; z0: number; z1: number; clear: number }

const ENCLOSED = new Set(['cabinetTall', 'cabinetLow', 'crate', 'shopCooler', 'fridge', 'gunLocker', 'medCabinet', 'shopDisplay']);
/** Enclosed holders whose front is glass (closed for items unless it shattered). */
const GLAZED = new Set(['shopCooler', 'shopDisplay']);
const SLAB = 0.06;
const WALL = 0.04;

/**
 * World-space boxes (axis-aligned; props only ever turn in quarter turns) for items / chunks.
 * Returns null when the holder should stay one solid box.
 */
export function holderBoxes(p: PropPlacement, surfaces: readonly SurfaceLike[], o: {broken?: boolean; glassBroken?: boolean} = {}): THREE.Box3[] | null {
  if (o.broken) return [];
  const quarter = Math.round(p.rot / (Math.PI / 2)) & 1;
  const w = quarter ? p.hz * 2 : p.hx * 2, d = quarter ? p.hx * 2 : p.hz * 2, h = p.h;
  const inside = surfaces.filter(s => s.y > 0.03 && s.y < h + 0.01 && s.x1 > -w / 2 - 0.02 && s.x0 < w / 2 + 0.02 && s.z1 > -d / 2 - 0.02 && s.z0 < d / 2 + 0.02);
  if (!inside.length) return null;
  const local: [number, number, number, number, number, number][] = []; // x0, y0, z0, x1, y1, z1
  const m = 0.015;
  const cx = (v: number) => Math.max(-w / 2, Math.min(w / 2, v)), cz = (v: number) => Math.max(-d / 2, Math.min(d / 2, v));
  const sorted = [...inside].sort((a, b) => a.y - b.y);
  const low = sorted[0];
  // solid base below the lowest surface, over that surface's rect
  local.push([cx(low.x0 - m), 0, cz(low.z0 - m), cx(low.x1 + m), low.y, cz(low.z1 + m)]);
  for (const s of sorted.slice(1)) local.push([cx(s.x0 - m), s.y - SLAB, cz(s.z0 - m), cx(s.x1 + m), s.y, cz(s.z1 + m)]);
  if (ENCLOSED.has(p.kind)) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
    for (const s of inside) { x0 = Math.min(x0, s.x0); x1 = Math.max(x1, s.x1); z0 = Math.min(z0, s.z0); z1 = Math.max(z1, s.z1); top = Math.max(top, s.y + s.clear); }
    top = Math.min(h, top + 0.02);
    x0 -= 0.01; x1 += 0.01; z0 -= 0.01; z1 += 0.01;
    local.push([x0 - WALL, 0, z0 - WALL, x0, top, z1 + WALL]); // left
    local.push([x1, 0, z0 - WALL, x1 + WALL, top, z1 + WALL]); // right
    local.push([x0 - WALL, 0, z0 - WALL, x1 + WALL, top, z0]); // back
    local.push([x0 - WALL, top, z0 - WALL, x1 + WALL, Math.max(top + WALL, Math.min(h, top + WALL)), z1 + WALL]); // roof
    if (GLAZED.has(p.kind) && !o.glassBroken) local.push([x0 - WALL, 0, z1, x1 + WALL, top, z1 + WALL]); // glass front
  }
  // holder-local (front +Z, base origin, yaw p.rot) -> world AABBs
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const out: THREE.Box3[] = [];
  for (const [ax, ay, az, bx, by, bz] of local) {
    if (bx - ax < 1e-3 || by - ay < 1e-3 || bz - az < 1e-3) continue;
    const box = new THREE.Box3();
    for (const lx of [ax, bx]) for (const lz of [az, bz]) {
      const X = p.x + lx * c + lz * s, Z = p.z - lx * s + lz * c;
      box.expandByPoint(new THREE.Vector3(X, p.y + ay, Z));
      box.expandByPoint(new THREE.Vector3(X, p.y + by, Z));
    }
    out.push(box);
  }
  return out;
}
