// Iteration 12 (LIGHT): ?qa=1 hooks for the battery / body glow / flare checks (installed by qa.ts; never in normal play).
// light() reads state. DEBUG helpers (qa prefix) exist only so a scripted browser check can reach the flicker band, an empty
// battery or a flare throw without a long playthrough: qaSetBattery(charge), qaGiveItem(id, count). Throws use the real T key.

import type {Game} from '../game';
import {itemDef} from '../items/items';
import {sampleField} from '../world/lightField';
import {LF, activeLightField, probeLightFieldGPU, type FieldProbePoint, type ProbeOptions} from '../world/lightFieldNode'; // Iteration 13 (LIGHTING)
import {stationLevels} from '../world/levelGeometry';

interface FieldProbeValueLite { amb: number[]; dirColor: number[]; dir: number[] }
const lite = (v: {amb: readonly number[]; dirColor: readonly number[]; dir: readonly number[]}): FieldProbeValueLite =>
  ({amb: v.amb.map(x => +x.toFixed(4)), dirColor: v.dirColor.map(x => +x.toFixed(4)), dir: v.dir.map(x => +x.toFixed(3))});

export function lightQaApi(game: Game) {
  return {
    light: () => {
      const b = game.torch.battery;
      return {
        battery: {charge: +b.charge.toFixed(4), percent: b.percent, on: b.on, died: b.died, output: +b.output.toFixed(3), emitting: b.emitting, flicker: +b.flicker.toFixed(3), dipping: b.dipping, stats: {...b.stats}},
        spotIntensity: +game.torch.spot.intensity.toFixed(2),
        glow: {intensity: game.torch.glow.intensity, distance: game.torch.glow.distance, color: game.torch.glow.color.getHexString(), pos: game.torch.glow.position.toArray().map(v => +v.toFixed(2))},
        flares: game.flares.qa(),
        inventory: {battery: game.inv.count('battery'), flare: game.inv.count('flare')},
        sources: game.lightSources.list.map(s => ({id: s.id, kind: s.kind, active: s.active, level: s.level, intensity: +s.intensity.toFixed(3), attractRange: +s.attractRange.toFixed(1),
          at: [s.x, s.y, s.z].map(v => +v.toFixed(2)), spot: s.spot ? [s.spot.x, s.spot.y, s.spot.z].map(v => +v.toFixed(2)) : null})),
        attracting: game.lightSources.attracting().map(s => s.kind),
      };
    },
    /** DEBUG: set the flashlight charge (0..1), e.g. 0.12 to see the flicker band, 0 for a flat battery. */
    qaSetBattery: (charge: number) => {
      const b = game.torch.battery;
      b.charge = Math.max(0, Math.min(1, charge));
      if (b.charge <= 0) { b.on = false; b.died = true; }
      return {charge: b.charge, on: b.on};
    },
    /** DEBUG: put `count` of an item into the inventory (what did not fit is returned). */
    qaGiveItem: (itemId: string, count = 1) => {
      itemDef(itemId);
      const left = game.inv.add(game.inv.makeStack(itemId, count));
      game.syncHeld();
      return {itemId, given: count - left, left};
    },
    /**
     * Iteration 13 (LIGHTING) DEBUG: GPU vs CPU light field. Evaluates the TSL decode the lighting node uses (renderer's
     * actual backend) at points around the player (3 heights x 3 normals) and on the floor under fixtures of every level,
     * and compares it with sampleField (CPU mirror of the baked data) at the same circuit levels. Read-only.
     */
    qaFieldProbeRaw: async (o: ProbeOptions = {mode: 'const'}, n = 4) => {
      const p = game.player;
      const pts = Array.from({length: n}, (_, i) => ({p: [p.x + i, p.y + 0.05, p.z] as const, n: [0, 1, 0] as const}));
      return probeLightFieldGPU(game.renderer as never, pts, o);
    },
    qaFieldProbe: async (radius = 6, step = 1.5) => {
      const vol = activeLightField();
      const lp = game.lightPool;
      if (!vol || !lp) return {ok: false, reason: 'no station field bound'};
      const p = game.player, lv = stationLevels(game.layout);
      const pts: (FieldProbePoint & {tag: string})[] = [];
      const fl = p.y;
      const normals: [string, readonly [number, number, number] | null][] = [['up', [0, 1, 0]], ['side', [1, 0, 0]], ['none', null]];
      for (let dz = -radius; dz <= radius + 1e-6; dz += step) for (let dx = -radius; dx <= radius + 1e-6; dx += step) {
        for (const h of [0.05, 1.2, 2.4]) for (const [tag, nn] of normals) pts.push({p: [p.x + dx, fl + h, p.z + dz], n: nn, tag: `near/${tag}`});
      }
      lv.forEach((L, k) => {
        const lights = game.layout.lights.filter(l => (l.level ?? 0) === k && !l.broken).slice(0, 24);
        for (const l of lights) pts.push({p: [l.x, L.grid.floorAt(l.x, l.z) + 0.05, l.z], n: [0, 1, 0], tag: `fixture-floor/L${k}`});
      });
      const {values, levels} = await probeLightFieldGPU(game.renderer as never, pts);
      const lum = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      let maxAbs = 0, sumAbs = 0, maxRel = 0, darkLeaks = 0, nonFinite = 0, lit = 0, gpuDarkLit = 0;
      const sample: {tag: string; p: readonly number[]; gpu: FieldProbeValueLite; cpu: FieldProbeValueLite}[] = [];
      const worst: {tag: string; p: readonly number[]; gpu: number; cpu: number}[] = [];
      pts.forEach((q, i) => {
        const c = sampleField(vol.field, q.p[0], q.p[1], q.p[2], levels, q.n ?? undefined);
        const g = values[i];
        if (![...g.amb, ...g.dirColor].every(Number.isFinite)) { nonFinite++; return; }
        // irradiance on the surface the normal describes (N.L for the directional part; normal-less points: up)
        const nn = q.n ?? [0, 1, 0];
        const ndl = (d: readonly number[]) => Math.max(0, d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]);
        const ec = lum(c.amb) + lum(c.dirColor) * ndl(c.dir), eg = lum(g.amb) + lum(g.dirColor) * ndl(g.dir);
        const d = Math.abs(eg - ec);
        sumAbs += d; maxAbs = Math.max(maxAbs, d);
        if (ec > 0.05) { lit++; maxRel = Math.max(maxRel, d / ec); }
        if (ec === 0 && eg > 0.01) darkLeaks++;
        if (ec > 0.05 && eg === 0) gpuDarkLit++;
        if (i % 97 === 0) sample.push({tag: q.tag, p: q.p, gpu: lite(g), cpu: lite(c)});
        worst.push({tag: q.tag, p: q.p.map(v => +v.toFixed(2)), gpu: +eg.toFixed(4), cpu: +ec.toFixed(4)});
      });
      worst.sort((a, b) => Math.abs(b.gpu - b.cpu) - Math.abs(a.gpu - a.cpu));
      const cpuDark = pts.filter(q => { const c = sampleField(vol.field, q.p[0], q.p[1], q.p[2], levels, q.n ?? undefined); return lum(c.amb) + lum(c.dirColor) === 0; }).length;
      return {
        ok: nonFinite === 0, backend: (game.renderer.backend as unknown as {isWebGPUBackend?: boolean}).isWebGPUBackend ? 'webgpu' : 'webgl2',
        points: pts.length, lit, cpuDark, levels, bound: LF.bound.value, field: {w: vol.field.w, h: vol.field.h, depth: vol.field.depth, slots: vol.field.slots, cellScale: vol.field.cellScale ?? 1},
        gpuDarkLit, sample,
        meanAbs: +(sumAbs / Math.max(1, pts.length - nonFinite)).toFixed(5), maxAbs: +maxAbs.toFixed(5), maxRel: +maxRel.toFixed(4), darkLeaks, nonFinite,
        worst: worst.slice(0, 8),
      };
    },
  };
}
