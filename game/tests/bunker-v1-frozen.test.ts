// Task studio-bunker-rework-20261109-205115-01: THE FIRST BUNKER (layout version 1) is FROZEN. A station entered under the first
// release regenerates version 1 forever (gen/bunker/layoutVersion.ts): its holders / pickups / kills / lanes refer to that layout. These
// fingerprints were taken on main f8d678ec (before the version-2 rework) over the whole generated layout; any change to them is a save
// break for entered Bunkers, never a re-pin.

import {describe, expect, it} from 'vitest';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [9001, 16920, 4401 + 3 * 7919];

/** FNV-1a (32 bit) of a string, hex. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The parts of a layout a visited station's memory and the builder depend on. */
export function bunkerFingerprint(l: StationLayout): Record<string, string> {
  return {
    areas: fnv(JSON.stringify(l.areas.map(a => [a.id, a.x, a.y, a.w, a.h, a.level ?? 0, a.ceil, a.kind, a.type, a.label, a.purpose ?? '', a.lighting]))),
    doors: fnv(JSON.stringify(l.doors.map(d => [d.id, d.x, d.y, d.w, d.h, d.a, d.b, d.height, d.level ?? 0]))),
    grid: fnv(JSON.stringify(l.levels.map(v => [v.id, v.baseY, v.role, Array.from(v.grid.cells).join(''), Array.from(v.grid.floor).map(f => Math.round(f * 100)).join(',')]))),
    props: fnv(JSON.stringify(l.props.map(p => [p.kind, p.x, p.y ?? 0, p.z, p.rot, p.level ?? 0, p.area]))),
    pickups: fnv(JSON.stringify(l.pickups.map(p => [p.itemId, p.count, p.x, p.z, p.level ?? 0]))),
    zombies: fnv(JSON.stringify(l.zombies.map(z => [z.archetype ?? '', z.x, z.z, z.level ?? 0]))),
    lights: fnv(JSON.stringify(l.lights.map(q => [q.x, q.y, q.z, q.area, q.broken, q.flicker]))),
    bunker: fnv(JSON.stringify(l.bunker)),
    spawn: fnv(JSON.stringify(l.playerSpawn)),
  };
}

const FROZEN: Record<number, Record<string, string>> = {
  9001: {areas: '9039f659', doors: '923a977b', grid: 'b3c59f0b', props: '5eea1931', pickups: 'b6dfac8a', zombies: '95164246', lights: '6648a39f', bunker: 'd3c9f08f', spawn: 'bb5946aa'},
  16920: {areas: '8bc5b070', doors: 'fad6fcec', grid: '077b3ada', props: '03f64278', pickups: '98ee45c2', zombies: '8e3097d1', lights: 'bb6bcb42', bunker: 'cfbc38b5', spawn: '3a8f5066'},
  28158: {areas: '00a2503e', doors: '1db41e8a', grid: '59b8321d', props: '09e3ba96', pickups: '516b060f', zombies: '57ee9c18', lights: '553c3f69', bunker: '9a911454', spawn: 'c841cf77'},
};

describe('the first Bunker (layout version 1) is frozen', () => {
  for (const seed of SEEDS) it(`seed ${seed} regenerates version 1 exactly`, () => {
    const fp = bunkerFingerprint(generateBunkerLevel({levelSeed: seed, layoutVersion: 1}));
    expect(fp).toEqual(FROZEN[seed]);
  });
});
