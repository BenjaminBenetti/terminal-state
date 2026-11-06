// Task studio-skyways-destinations-20261106-170011-01 (lane AUDIO): the Skyways DESTINATIONS' location sounds — where the Clock Court's
// tower movement ticks (and its bell strikes: audio/sfx.ts LOCATION_AUDIO.chime), where the Starfall Arcade's cabinets play their attract
// mode and where the Aurora Picture House's projector runs. Sound Lab clips (tools/audio-pipeline/skyways-destinations-build.mjs;
// provenance derivatives/audio-skyways-destinations.json); not auditioned by ear on the build worker.
//
// This module is pure placement (no Web Audio): skywaysLocationEmitters reads layout.skyways (the generator's landmark / anchor records,
// gen/skyways/skywaysTypes.ts) and audio/sfx.ts owns the channels. Inert without layout.skyways or without those destinations.
//  - clock: every landmark of family 'clock' -> clockTick at its centrepiece, `clock.lift` m over the court floor (the movement / faces;
//    the clock court is an atrium court: no storey gate — it is heard from the gallery above too);
//  - arcade: every anchor of family 'arcade' -> arcadeAttract at its sales floor's centre, cabinet-speaker height, its range covering the
//    floor and the lobby in front of its storefront, gated to its storey;
//  - cinema: every anchor of family 'cinema' WITH an auditorium (zones[0]; a cinema that fell back to a plain hall stays inert) ->
//    projectorRun at the auditorium's BACK wall — the wall toward the cinema's lobby (the anchor's `front` side; the projection booth sits
//    behind the audience, the screen on the far wall) — centred along it, `projector.inset` m into the room, at the booth's port height,
//    its range covering the auditorium, gated to its storey.

import {CELL} from '../gen/grid';
import type {Side, StationLayout} from '../gen/stationTypes';
import type {SkywaysAnchor, SkywaysLandmark} from '../gen/skyways/skywaysTypes';
import type {LocationEmitter} from '../audio/sfx';

/** Placement / level of each location sound (gains multiply the cue's CUE_GAIN; first estimates for the ear pass). */
export const SKYWAYS_DEST_AUDIO = {
  clock: {lift: 3, gain: 1, range: 26},
  arcade: {lift: 1.2, gain: 1, rangePad: 8},
  projector: {inset: 0.6, port: 3, ceilGap: 0.5, gain: 1, rangePad: 2},
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Floor height (absolute m) of a layout area. */
function floorOf(layout: Pick<StationLayout, 'areas' | 'levels'>, areaId: number): number | null {
  const a = layout.areas[areaId];
  if (!a) return null;
  return a.floorY ?? layout.levels[a.level ?? 0]?.baseY ?? null;
}

function clockEmitter(m: SkywaysLandmark): LocationEmitter {
  const C = SKYWAYS_DEST_AUDIO.clock;
  return {x: m.x, y: r3(m.y + C.lift), z: m.z, cue: 'clockTick', gain: C.gain, range: C.range};
}

function arcadeEmitter(layout: Pick<StationLayout, 'areas' | 'levels'>, an: SkywaysAnchor): LocationEmitter | null {
  const A = SKYWAYS_DEST_AUDIO.arcade, f = layout.areas[an.floor], y = floorOf(layout, an.floor);
  if (!f || y === null) return null;
  const x0 = f.x * CELL, z0 = f.y * CELL, x1 = (f.x + f.w) * CELL, z1 = (f.y + f.h) * CELL;
  const half = Math.hypot(x1 - x0, z1 - z0) / 2;
  return {x: r3((x0 + x1) / 2), y: r3(y + A.lift), z: r3((z0 + z1) / 2), cue: 'arcadeAttract', gain: A.gain, range: r3(half + A.rangePad), floorY: y};
}

function projectorEmitter(layout: Pick<StationLayout, 'areas' | 'levels'>, an: SkywaysAnchor): LocationEmitter | null {
  const P = SKYWAYS_DEST_AUDIO.projector, id = an.zones[0];
  const a = id === undefined ? undefined : layout.areas[id], y = id === undefined ? null : floorOf(layout, id);
  if (!a || y === null) return null;
  const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // the back wall: the auditorium's side toward the lobby (the anchor's front: N = -z, S = +z, W = -x, E = +x)
  const back: Side = an.front;
  const x = back === 'W' ? x0 + P.inset : back === 'E' ? x1 - P.inset : cx;
  const z = back === 'N' ? z0 + P.inset : back === 'S' ? z1 - P.inset : cz;
  const port = Math.min(P.port, Math.max(1.2, a.ceil - y - P.ceilGap));
  return {x: r3(x), y: r3(y + port), z: r3(z), cue: 'projectorRun', gain: P.gain, range: r3(Math.max(x1 - x0, z1 - z0) + P.rangePad), floorY: y};
}

/** The location emitters of a built layout (empty off the Skyways or without its destinations). Pure, deterministic. */
export function skywaysLocationEmitters(layout: Pick<StationLayout, 'areas' | 'levels' | 'skyways'>): LocationEmitter[] {
  const sk = layout.skyways;
  if (!sk) return [];
  const out: LocationEmitter[] = [];
  for (const m of sk.landmarks ?? []) if (m.family === 'clock') out.push(clockEmitter(m));
  for (const an of sk.anchors ?? []) {
    const e = an.family === 'arcade' ? arcadeEmitter(layout, an) : an.family === 'cinema' ? projectorEmitter(layout, an) : null;
    if (e) out.push(e);
  }
  return out;
}

/** The game surface this needs (a Game in the constructor; tests pass a stub). */
export interface SkywaysDestAudioHost {
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  sfx: {setLocationEmitters(list: readonly LocationEmitter[]): void};
}

/** One section hook: a built section hands its location emitters to the audio (none off the Skyways); teardown clears them. */
export function installSkywaysDestAudio(host: SkywaysDestAudioHost): void {
  host.sectionHooks.push({
    build: layout => host.sfx.setLocationEmitters(skywaysLocationEmitters(layout)),
    teardown: () => host.sfx.setLocationEmitters([]),
  });
}
