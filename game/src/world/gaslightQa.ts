// Task reactor-expansion-20261101 (lane GASLIGHT): QA hooks for the lead's short serial browser spot checks (spread into window.__LL by
// qa.ts). Uniform / record reads and live look edits only — no gameplay change:
//  - gaslight() -> the toxic-gas visibility state: the regional term (compiled / on / look / outdoor / shafts / the fallback c), the
//    breach gas gate, the eye exposure (c, source, fallback), the pit lamps (wall / post / steady / dying / skipped) and the open sky;
//  - gaslightShafts({gain, fade, colour}) -> tune the pit's light shafts live (VolumetricAtmosphere.shaftLook).
// (The gas look itself: lane AIR's reactorGasTune; the fallback: stand in gas with ?fog=off — eye.fallback reports its c.)
import type {StationLayout} from '../gen/stationTypes';
import {pitLampStats} from '../gen/reactor/gaslightLamps';

interface QaGame {
  layout?: StationLayout;
  atmosphere?: {
    active: boolean;
    shaftLook?: {gain: number; fade: number; colour: [number, number, number]};
    depthDebug?(): unknown;
    gasDebug?(): unknown;
  };
  gas?: {exposure: {c: number; source: unknown; fallback?: number; protected: boolean}} | null;
  world?: {reactorArch?: {pitSky: unknown; mountedLamps: readonly {model: boolean}[]}} | null;
}

export function gaslightQaApi(game: unknown) {
  const g = game as QaGame;
  return {
    gaslight: () => {
      const L = g.layout, arch = g.world?.reactorArch;
      const e = g.gas?.exposure;
      return {
        active: g.atmosphere?.active ?? false,
        regional: g.atmosphere?.depthDebug?.() ?? null,
        breach: g.atmosphere?.gasDebug?.() ?? null,
        eye: e ? {c: Math.round(e.c * 1000) / 1000, source: e.source, fallback: e.fallback ?? 0, protected: e.protected} : null,
        lamps: L ? pitLampStats(L) : null,
        modelLamps: arch ? arch.mountedLamps.filter(m => m.model).length : 0,
        sky: arch?.pitSky ?? null,
      };
    },
    gaslightShafts: (o: {gain?: number; fade?: number; colour?: [number, number, number]} = {}) => {
      const s = g.atmosphere?.shaftLook;
      if (!s) return null;
      if (typeof o.gain === 'number') s.gain = o.gain;
      if (typeof o.fade === 'number') s.fade = o.fade;
      if (o.colour) s.colour = [o.colour[0], o.colour[1], o.colour[2]];
      return {...s, colour: [...s.colour]};
    },
  };
}
