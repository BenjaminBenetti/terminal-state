// Task studio-skyways-destinations-20261106-170011-01: the Skyways LAYOUT VERSION policy (save compatibility). A station a player
// ENTERED under GAME76 (the first Skyways release + its layout-variety pass) keeps regenerating exactly that layout — its memory's
// holders / pickups / kills / lanes refer to it — while every station not yet entered gets the destinations (version 2).
// The fingerprints below were computed on main e647f6cbd626d7d8547470b4a22ccf0f3839bb3f (GAME76) with LEVELS.skyways.generate and
// must stay identical for layoutVersion 1 (areas, props, pickups, enemies, lights, storefronts, links and the skyways record minus
// the version-2 fields).
// Task studio-skyways-rework-20261107-054512-01: version 3 is the rework; versions 1 and 2 regenerate through the FROZEN GAME77
// generator (gen/skyways/legacy77/). GAME77's version-2 fingerprints (the full skyways record, anchors / landmarks included) were
// computed on main be3173d7738024b26d7d06c42cddf118c3520a02 before any rework change and must stay identical too.
// Task studio-skywalk-variety-20261107-231448-01: version 4 is the building programmes; version 3 regenerates through the FROZEN
// version-3 core (gen/skyways/legacy80/). Version 3's fingerprints (the full skyways record, area / prop loot purposes included) were
// computed on main ebc2034a193ee29cccf42f289a93ac80c13cf4a4 (GAME80) before any change and must stay identical.
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {SKYWAYS_LAYOUT_LANE, SKYWAYS_LAYOUT_VERSION, skywaysLayoutVersionFor} from '../src/gen/skyways/layoutVersion';

const GAME76: Record<number, string> = {
  1: '19a6ccac2af3519e', 2: '74232f28eb73537a', 3: '5b90b162b2ffe93f', 4: 'c58c8d2097c8ab87', 5: 'cd48b823d876d92f',
  6: 'c28cdf9a57a4fede', 7: '1304a2aa4704d141', 8: 'bb126ff8b3a013f5', 707: '9c3d3cb7882b724b', 4242: '8a9fe6ca0fd854a6',
};

const GAME77: Record<number, string> = {
  1: '29d8bb0219a9f9dd', 2: '77b133b78c1d78de', 3: '0e8c6753b41e013d', 4: 'd9883095d3c641e4', 5: '3cc0620b42b648c6',
  6: '8bda6abfa44afb2e', 7: '75a1dd8f9dabb31c', 8: '2736a1641114b92f', 707: '4003fcc846daf4bb', 4242: '2f0908a92dfa53b8',
};

const GAME80: Record<number, string> = {
  1: '35c9f560bdb0676a', 2: '6f6ff17334434a0f', 3: '91a29aac6577fcb2', 4: 'ffdb73399586a0c2', 5: '54fef0374c6ad3d0',
  6: '326eff21283e9918', 7: '5b6d22f0301fafe4', 8: '13569124684b1c55', 707: '5cde7e9753278187', 4242: 'f7c8bd37849c4fc9',
  103855126: '0ce04ab0a6fc37ab',
};

const GAME84: Record<number, string> = {
  1: '512df8dc0ad42342', 2: '5ea49b8d24788f74', 3: '23dab03d7dd76489', 4: '4d724f53b8032d97', 5: 'c2a46f7f73e88f21',
  6: '0485fb09bb8135a9', 7: '4e3844fe8bae1794', 8: '0458082172e79528', 707: 'd6f8b82204453e84', 4242: '5c909fa35280f388',
  103855126: 'ee325ff2adcb0462',
};

function fingerprint80(seed: number): string {
  const l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 3} as never);
  const info = {...(l.skyways as unknown as Record<string, unknown>)};
  const fp = JSON.stringify({info, areas: l.areas.map(a => [a.x, a.y, a.w, a.h, a.label, a.type, a.ceil, a.level ?? 0, a.purpose ?? null]), props: l.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.level ?? 0, p.variant ?? 0, p.purpose ?? null]),
    pickups: l.pickups.map(p => [p.itemId, p.x, p.z]), zombies: l.zombies.map(z => [z.x, z.z, z.archetype]), lights: l.lights.length, sf: l.storefronts.length, links: l.levelLinks.length});
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 16);
}

/**
 * Task studio-skywalk-encounters-20261108-074144-01: version 4 (GAME81-84, the building programmes) — the full skyways record, every
 * area / prop with its loot purpose, every enemy record IN FULL (family, context, look, type, storey) and the hordes; computed on main
 * 63a5f92355f3841b2543b54318c4ee757f0fd5a2 before any version-5 change (the Siren / horde / cosplay / Mall-store pass).
 */
function fingerprint84(seed: number): string {
  const l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 4} as never);
  const info = {...(l.skyways as unknown as Record<string, unknown>)};
  const fp = JSON.stringify({info, areas: l.areas.map(a => [a.x, a.y, a.w, a.h, a.label, a.type, a.ceil, a.level ?? 0, a.purpose ?? null]), props: l.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.level ?? 0, p.variant ?? 0, p.purpose ?? null]),
    pickups: l.pickups.map(p => [p.itemId, p.x, p.z]), zombies: l.zombies, hordes: l.hordes ?? [], lights: l.lights.length, sf: l.storefronts, links: l.levelLinks.length});
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 16);
}

function fingerprint77(seed: number): string {
  const l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 2} as never);
  const info = {...(l.skyways as unknown as Record<string, unknown>)};
  const fp = JSON.stringify({info, areas: l.areas.map(a => [a.x, a.y, a.w, a.h, a.label, a.type, a.ceil, a.level ?? 0]), props: l.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.level ?? 0, p.variant ?? 0]),
    pickups: l.pickups.map(p => [p.itemId, p.x, p.z]), zombies: l.zombies.map(z => [z.x, z.z, z.archetype]), lights: l.lights.length, sf: l.storefronts.length, links: l.levelLinks.length});
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 16);
}

function fingerprint(seed: number, layoutVersion?: number): string {
  const l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion !== undefined ? {layoutVersion} : {})} as never);
  const info = {...(l.skyways as unknown as Record<string, unknown>)}; delete info.anchors; delete info.landmarks;
  const fp = JSON.stringify({info, areas: l.areas.map(a => [a.x, a.y, a.w, a.h, a.label, a.type, a.ceil, a.level ?? 0]), props: l.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.level ?? 0, p.variant ?? 0]),
    pickups: l.pickups.map(p => [p.itemId, p.x, p.z]), zombies: l.zombies.map(z => [z.x, z.z, z.archetype]), lights: l.lights.length, sf: l.storefronts.length, links: l.levelLinks.length});
  return crypto.createHash('sha256').update(fp).digest('hex').slice(0, 16);
}

describe('Skyways layout version (save compatibility)', () => {
  it('the policy: a station entered under GAME76 (visits, no record) keeps version 1; a recorded version is kept; a new station gets the current one', () => {
    expect(SKYWAYS_LAYOUT_VERSION).toBe(5);
    expect(skywaysLayoutVersionFor(undefined)).toBe(5);
    expect(skywaysLayoutVersionFor({visits: 0, lanes: {}})).toBe(5);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {}})).toBe(1);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 3}}})).toBe(3);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 4}}})).toBe(4);
    expect(skywaysLayoutVersionFor({visits: 3, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 5}}})).toBe(5); // (task studio-skywalk-encounters-20261108-074144-01)
    expect(skywaysLayoutVersionFor({visits: 0, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    // a malformed record falls back to the visit rule
    expect(skywaysLayoutVersionFor({visits: 1, lanes: {[SKYWAYS_LAYOUT_LANE]: {v: 9}}})).toBe(1);
  });

  it('version 1 regenerates GAME76 exactly (fingerprints pinned on main e647f6c)', () => {
    for (const [s, want] of Object.entries(GAME76)) expect(fingerprint(Number(s), 1), `seed ${s}`).toBe(want);
  });

  it('version 2 regenerates GAME77 exactly through the frozen generator (fingerprints pinned on main be3173d)', () => {
    for (const [s, want] of Object.entries(GAME77)) expect(fingerprint77(Number(s)), `seed ${s}`).toBe(want);
  });

  it('version 3 regenerates GAME78-80 exactly through the frozen version-3 core (fingerprints pinned on main ebc2034)', () => {
    for (const [s, want] of Object.entries(GAME80)) expect(fingerprint80(Number(s)), `seed ${s}`).toBe(want);
  });

  it('version 4 regenerates GAME81-84 exactly (fingerprints pinned on main 63a5f92, before version 5)', () => {
    for (const [s, want] of Object.entries(GAME84)) expect(fingerprint84(Number(s)), `seed ${s}`).toBe(want);
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
