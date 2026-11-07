// Task studio-skyways-destinations-20261106-170011-01: the Skyways LAYOUT VERSION policy (save compatibility). A station a player
// ENTERED under GAME76 (the first Skyways release + its layout-variety pass) keeps regenerating exactly that layout — its memory's
// holders / pickups / kills / lanes refer to it — while every station not yet entered gets the destinations (version 2).
// The fingerprints below were computed on main e647f6cbd626d7d8547470b4a22ccf0f3839bb3f (GAME76) with LEVELS.skyways.generate and
// must stay identical for layoutVersion 1 (areas, props, pickups, enemies, lights, storefronts, links and the skyways record minus
// the version-2 fields).
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {SKYWAYS_LAYOUT_LANE, SKYWAYS_LAYOUT_VERSION, skywaysLayoutVersionFor} from '../src/gen/skyways/layoutVersion';

const GAME76: Record<number, string> = {
  1: '19a6ccac2af3519e', 2: '74232f28eb73537a', 3: '5b90b162b2ffe93f', 4: 'c58c8d2097c8ab87', 5: 'cd48b823d876d92f',
  6: 'c28cdf9a57a4fede', 7: '1304a2aa4704d141', 8: 'bb126ff8b3a013f5', 707: '9c3d3cb7882b724b', 4242: '8a9fe6ca0fd854a6',
};

function fingerprint(seed: number, layoutVersion?: number): string {
  const l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion !== undefined ? {layoutVersion} : {})} as never);
  const info = {...(l.skyways as unknown as Record<string, unknown>)}; delete info.anchors; delete info.landmarks;
  const fp = JSON.stringify({info, areas: l.areas.map(a => [a.x, a.y, a.w, a.h, a.label, a.type, a.ceil, a.level ?? 0]), props: l.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.level ?? 0, p.variant ?? 0]),
    pickups: l.pickups.map(p => [p.itemId, p.x, p.z]), zombies: l.zombies.map(z => [z.x, z.z, z.archetype]), lights: l.lights.length, sf: l.storefronts.length, links: l.levelLinks.length});
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 16);
}

describe('Skyways layout version (save compatibility)', () => {
  it('the policy: a station entered under GAME76 (visits, no record) keeps version 1; a recorded version is kept; a new station gets the current one', () => {
    // (task studio-alpha-skyways-shops-20261107-054512-01: the Skyways rework is version 3; a recorded version 2 keeps 2)
    expect(SKYWAYS_LAYOUT_VERSION).toBe(3);
    expect(skywaysLayoutVersionFor(undefined)).toBe(3);
    expect(skywaysLayoutVersionFor({visits: 0, lanes: {}})).toBe(3);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {}})).toBe(1);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(skywaysLayoutVersionFor({visits: 0, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    // a malformed record falls back to the visit rule
    expect(skywaysLayoutVersionFor({visits: 1, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 9}}})).toBe(1);
  });

  it('version 1 regenerates GAME76 exactly (fingerprints pinned on main e647f6c)', () => {
    for (const [s, want] of Object.entries(GAME76)) expect(fingerprint(Number(s), 1), `seed ${s}`).toBe(want);
  });

  it('version 2 adds the destinations: anchors and landmark courts', () => {
    const l = LEVELS.skyways.generate('main', {levelSeed: 4, startWeapon: 'pistol', layoutVersion: 2} as never);
    expect(l.skyways!.anchors!.length).toBeGreaterThanOrEqual(3);
    expect(l.skyways!.landmarks!.length).toBeGreaterThanOrEqual(1);
    const old = LEVELS.skyways.generate('main', {levelSeed: 4, startWeapon: 'pistol', layoutVersion: 1} as never);
    expect(old.skyways!.anchors ?? []).toEqual([]);
    expect(old.skyways!.landmarks ?? []).toEqual([]);
  });
});
