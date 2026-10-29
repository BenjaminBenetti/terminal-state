import {it} from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import {installStockCanvas, loadModel, stockProp} from './helpers/stockHelpers';
import {levelFixture, FIX} from './helpers/levelFixture';
import {SHELF_TIER_Y} from '../src/gen/props';
import {PhysicsSystem} from '../src/physics/world';
import {raycastWorld} from '../src/combat/hitscan';
import {ShelfStock} from '../src/world/shelfStock';
import {WEAPONS} from '../src/weapons/weapons';
function pellets(eye: THREE.Vector3, aim: THREE.Vector3, seed: number): THREE.Vector3[] {
  const def = WEAPONS.shotgun; const fwd = aim.clone().sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); const out: THREE.Vector3[] = [];
  for (let i = 0; i < def.pellets; i++) { const a = rnd() * Math.PI * 2, r = def.spreadHip * Math.sqrt(rnd()); out.push(fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize()); }
  return out;
}
it('debug', async () => {
  const out: string[] = [];
  await installStockCanvas(false);
  const shelf = await loadModel('shelf.glb');
  for (const seed of [21, 22, 23, 24]) {
    const L = levelFixture();
    const sh = stockProp('stockShelf', 22.5, 14.5, {variant: 1, y: FIX.upperY, level: 1, area: 2});
    L.props.push(sh);
    const ph = new PhysicsSystem(null, null); ph.build(L as never);
    const S = new ShelfStock(); S.filler.attach(ph); ph.holderBoxes = p => S.physicsBoxes(p, null); S.build(L as never, {models: {shelf}});
    const eye = new THREE.Vector3(22.6, FIX.upperY + 1.6, 14.5 + sh.hz + 2.5), aim = new THREE.Vector3(22.5, FIX.upperY + SHELF_TIER_Y[1] + 0.12, 14.6);
    for (const dir of pellets(eye, aim, seed)) { const fh = S.pelletHit(eye, dir, WEAPONS.shotgun.range, {t: WEAPONS.shotgun.range, kind: 'none'}, L.props, false); if (fh) S.shoot(fh, dir, WEAPONS.shotgun.damage); }
    void raycastWorld;
    const track = new Map<number, THREE.Vector3[]>();
    for (let f = 0; f < 600; f++) { ph.update(1 / 60); if (f % 6 === 0) for (const p of S.filler.pieces) { if (!track.has(p.id)) track.set(p.id, []); track.get(p.id)!.push(p.p.clone()); } }
    for (const p of S.filler.pieces) if (p.box.min.y < FIX.upperY - 0.025) out.push(`seed ${seed} piece ${p.id} home ${p.home.toArray().map(v => v.toFixed(2))} final ${p.p.toArray().map(v => v.toFixed(2))} path ${track.get(p.id)!.filter((_, i) => i % 5 === 0).map(v => v.toArray().map(x => x.toFixed(2)).join(',')).join(' > ')}`);
  }
  fs.writeFileSync('/tmp/props-lane/debug.txt', out.join('\n') || 'none');
}, 300000);
