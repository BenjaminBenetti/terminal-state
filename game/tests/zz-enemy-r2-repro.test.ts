// SCRATCH (lane ENEMY, R2) — delete before finishing.
import {describe, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {setMallVariantOverride, MALL_VARIANTS} from '../src/gen/mall/frame';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {aggroSim} from './helpers/aggroSim';

const OUT = process.env.R2_OUT ?? '/tmp/r2-repro.json';
const ATRIUM = process.env.R2_ATRIUM !== '0';
const MALLS = (process.env.R2_MALLS ?? MALL_VARIANTS.map(v => `t3a:${v}`).join(',')).split(',');
const SCEN = (process.env.R2_SCEN ?? 'none,pistol,rifle,shotgun').split(',');
const SECS = Number(process.env.R2_SECS ?? 60);

function mall(spec: string): StationLayout {
  const [code, variant] = spec.split(':');
  if (variant) setMallVariantOverride(variant);
  try { return LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: codeToSeed(code)!, startWeapon: 'pistol'}); } finally { setMallVariantOverride(null); }
}

describe('R2 repro', () => {
  it('cross-atrium responders at the mall start', () => {
    const rows: unknown[] = [];
    const noise: Record<string, number> = {none: 0, pistol: 24, rifle: 30, shotgun: 38, fight: 30, walk: 0, torch: 0};
    for (const m of MALLS) {
      const layout = mall(m);
      const L = levelsOf(layout), sp = layout.playerSpawn, y0 = L.grid(0).floorAt(sp.x, sp.z);
      const walk: [number, number][] = [];
      for (const dx of [10, -10, 6, -6]) if (walk.length < 2 && L.walkLineClear(sp.x, y0, sp.z, sp.x + dx, sp.z, 0.4, y0)) walk.push([sp.x + dx, sp.z], [sp.x, sp.z]);
      for (const sc of SCEN) for (const atrium of [false, true]) {
        const t0 = performance.now();
        const shots = sc === 'none' || sc === 'walk' || sc === 'torch' ? [] : sc === 'fight' ? Array.from({length: 49}, (_, k) => 3 + k * 1.5) : Array.from({length: 8}, (_, k) => 3 + k * 0.5);
        const r = aggroSim(layout, {noise: noise[sc] || 1, shots, seconds: SECS, atrium, walk: sc === 'fight' || sc === 'walk' || sc === 'torch' ? walk : undefined, flashlight: sc === 'torch'});
        const row = {rules: atrium ? 'after' : 'before', mall: m, variant: layout.mall!.variant, scen: sc, enemies: layout.zombies.length, hordes: (layout.hordes ?? []).map(h => `L${h.level}:${h.members.length}`).join(' '), upperSpawns: r.upperSpawns, upper: r.upper.length, upperByCause: r.upperByCause, station: r.stationByCause, cameDown: r.cameDown, reached: r.reached, lured: r.lured, luredReached: r.luredReached, maxBurst: r.maxBurst, huntingUpperAtEnd: r.huntingUpperAtEnd, kills: r.kills, calls: r.callsHeard,
          ms: Math.round(performance.now() - t0), walk: walk.length, detail: r.upper.map(u => `${u.index}:L${u.level}${u.horde ? 'h' : ''}:${u.archetype[0]}:${u.cause}@${u.t}s/${u.dist}m`)};
        rows.push(row);
      }
    }
    writeFileSync(OUT, JSON.stringify(rows, null, 1));
  }, 1_200_000);
});
