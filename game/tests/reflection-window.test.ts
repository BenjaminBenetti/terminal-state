// Task studio-baked-lighting-reflections-20261114-050258-01: the tower's window panes and the reflection probes.
//
// A tower window's glass sits 0.28 m INSIDE its wall's own cell (world/officeWindows.ts planWindows). The field there is the wall's:
// its texel holds no light, and its column belongs to whichever storey is open at that cell (the lobby level under an upper storey's
// perimeter wall), so a pane read at its own place reflected a fifth of the room's light, or another storey's probes. A pane is
// therefore a 'window' (render/reflectTag.ts): world/reflectionNode.ts reads the field and names the probes one cell out along its
// normal. This file checks that rule at every window span of a generated Office with the CPU mirror of the shader's choice
// (reflectLookup), against the plain glass rule at the same panes. Node / CPU only.
import {describe, expect, it} from 'vitest';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {drainSync} from '../src/core/pacedBuild';
import {LEVELS} from '../src/levels/registry';
import {stationLevels} from '../src/world/levelGeometry';
import {stationBakeInput} from '../src/world/lights';
import {bakeLightField, fieldSlot, levelGeometries, sampleField} from '../src/world/lightField';
import {REFLECTION_TIERS} from '../src/world/enhancedLighting';
import {bakeReflectionProbesSteps} from '../src/world/reflectionProbes';
import {reflectLookup, sampleProbes} from '../src/world/reflectionNode';
import {surfaceAlbedo} from '../src/world/surfaceAlbedo';
import {planWindows} from '../src/world/officeWindows';
import {readTowerInfo} from '../src/world/towerShared';

const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1];

describe('the tower\'s window panes', () => {
  it('a window reads the room it faces: its storey\'s slot, the room\'s light and the room\'s probes, at every span; the plain glass rule would not', () => {
    const L = LEVELS.office.generate('main', {levelSeed: 93}) as StationLayout;
    const input = stationBakeInput(L);
    const F = bakeLightField(input.source, input.params);
    const levels = stationLevels(L), geos = levelGeometries(input.source);
    const B = drainSync(bakeReflectionProbesSteps({field: F, geos, levels, albedo: surfaceAlbedo(F.w, F.h, levels, geos, null), lights: L.lights}, REFLECTION_TIERS.standard));
    const plans = planWindows(readTowerInfo(L)!).filter(p => p.span.kind === 'window');
    expect(plans.length).toBeGreaterThan(100);
    const W = B.gridW, H = B.gridH;
    const weight = (x: number, z: number, slot: number): number => {
      const i = Math.min(W - 1, Math.max(0, Math.floor(x / CELL))), j = Math.min(H - 1, Math.max(0, Math.floor(z / CELL))), o = (((slot * 2) * H + j) * W + i) * 4;
      return (B.grid[o] + B.grid[o + 1] + B.grid[o + 2] + B.grid[o + 3]) / 255;
    };
    let points = 0, glassOtherStorey = 0, windowUnderProbe = 0;
    const ratioWindow: number[] = [], ratioGlass: number[] = [], radWindow: number[] = [], radGlass: number[] = [];
    for (const p of plans) {
      // the glass plane is inside the wall: between its inner face and its outer one
      const depth = Math.abs(p.glass - p.inner);
      expect(depth).toBeGreaterThan(0.05);
      expect(depth).toBeLessThan(CELL);
      const N: [number, number, number] = [-p.n[0], 0, -p.n[1]]; // the pane faces the room
      for (const fa of [0.2, 0.5, 0.8]) {
        const a = p.a0 + (p.a1 - p.a0) * fa, y = (p.y0 + p.y1) / 2;
        const P: [number, number, number] = p.along === 'x' ? [a, y, p.glass] : [p.glass, y, a];
        // the room: the first cell inside the wall's inner face
        const rx = P[0] + N[0] * (depth + CELL * 0.5), rz = P[2] + N[2] * (depth + CELL * 0.5);
        const ri = Math.floor(rx / CELL), rj = Math.floor(rz / CELL);
        const room = fieldSlot(F, ri, rj, y);
        expect(geos[room.slot].open[rj * F.w + ri], 'the cell inside the window is the storey\'s room').toBeGreaterThan(0);
        const fr = sampleField(F, rx, y, rz), roomLight = lum(fr.amb) + lum(fr.dirColor);
        const w = reflectLookup('window', F, P[0], P[1], P[2], N), g = reflectLookup('glass', F, P[0], P[1], P[2], N);
        points++;
        // the window: the room's slot, always; the probes named from the room's own cell
        expect(w.slot, `span ${p.index}: the window reads its own storey`).toBe(room.slot);
        expect([Math.floor(w.at[0] / CELL), Math.floor(w.at[1] / CELL)]).toEqual([ri, rj]);
        expect(g.at).toEqual([P[0], P[2]]);
        if (weight(w.at[0], w.at[1], w.slot) > 0.3) windowUnderProbe++;
        if (g.slot !== room.slot) glassOtherStorey++;
        if (roomLight > 0.05) { ratioWindow.push(w.local / roomLight); ratioGlass.push(g.local / roomLight); }
        // what the pane reflects looking along the wall and into the room
        const dl = Math.hypot(0.6, 0.8), dir: [number, number, number] = p.along === 'x' ? [0.8 / dl, 0, N[2] * 0.6 / dl] : [N[0] * 0.6 / dl, 0, 0.8 / dl];
        radWindow.push(lum(sampleProbes(B, P[0], P[1], P[2], w.slot, dir, 0.15, w.local, 1, w.at)));
        radGlass.push(lum(sampleProbes(B, P[0], P[1], P[2], g.slot, dir, 0.15, g.local, 1, g.at)));
      }
    }
    expect(points).toBe(plans.length * 3);
    expect(ratioWindow.length).toBeGreaterThan(points * 0.9);
    // the window reads (nearly) the room's own light, everywhere; nearly every pane's room cell is under a probe
    expect(Math.min(...ratioWindow)).toBeGreaterThan(0.8);
    expect(Math.max(...ratioWindow)).toBeLessThan(1.25);
    expect(windowUnderProbe).toBeGreaterThan(points * 0.98);
    // the plain glass rule at the same panes: a fraction of the room's light, and on some spans another storey altogether
    expect(median(ratioGlass)).toBeLessThan(0.3);
    expect(glassOtherStorey).toBeGreaterThan(0);
    // so the window's reflection is the stronger one, by about the light it was missing
    const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
    expect(mean(radWindow)).toBeGreaterThan(mean(radGlass) * 2);
    expect(median(radWindow)).toBeGreaterThan(0.01);
    console.log(`reflection-window: ${plans.length} spans, ${points} points; light at the pane / the room's: window median ${median(ratioWindow).toFixed(2)}, glass rule median ${median(ratioGlass).toFixed(2)}; glass rule on another storey at ${glassOtherStorey} points; mean radiance window ${mean(radWindow).toFixed(4)}, glass rule ${mean(radGlass).toFixed(4)}`);
  }, 120_000);
});
