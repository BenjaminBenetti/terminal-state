// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract): SURFACE RUN's presence roll, version lane, section keys and
// asset family (gen/surface/surfaceRun.ts, assets/levelAssets.ts), and the district generator's contract frame (gen/surface/index.ts).
import {describe, expect, it} from 'vitest';
import {
  SURFACE_CHANCE, SURFACE_LANE, SURFACE_VERSION, hostKeyOf, isSurfaceKey, sectionAssetLevel, surfaceKeyOf, surfacePresent, surfaceRoll,
  surfaceSeed, surfaceVersionFor,
} from '../src/gen/surface/surfaceRun';
import {assetAllowedIn, levelOfAsset} from '../src/assets/levelAssets';
import {LEVELS} from '../src/levels/registry';

describe('Surface Run presence roll', () => {
  it('is a deterministic ~25 % roll on the three host archetypes only, gated by the version', () => {
    let hits = 0;
    const N = 4000;
    for (let s = 1; s <= N; s++) {
      expect(surfaceRoll(s)).toBe(surfaceRoll(s));
      if (surfacePresent('subway', s, SURFACE_VERSION)) hits++;
      expect(surfacePresent('office', s, SURFACE_VERSION)).toBe(surfaceRoll(s) < SURFACE_CHANCE);
      expect(surfacePresent('reactor', s, SURFACE_VERSION)).toBe(false);
      expect(surfacePresent('skyways', s, SURFACE_VERSION)).toBe(false);
      expect(surfacePresent('subway', s, 0)).toBe(false);
      expect(surfacePresent('subway', s, undefined)).toBe(false);
    }
    expect(hits / N).toBeGreaterThan(0.22);
    expect(hits / N).toBeLessThan(0.28);
  });

  it('the district seed is its own stream (never the host seed)', () => {
    for (let s = 1; s < 50; s++) expect(surfaceSeed(s)).not.toBe(s);
    expect(surfaceSeed(7)).toBe(surfaceSeed(7));
  });

  it('version lane: recorded wins; visited without a record stays 0; never entered gets the current', () => {
    expect(surfaceVersionFor(undefined)).toBe(SURFACE_VERSION);
    expect(surfaceVersionFor({visits: 0, lanes: {}})).toBe(SURFACE_VERSION);
    expect(surfaceVersionFor({visits: 3, lanes: {}})).toBe(0);
    expect(surfaceVersionFor({visits: 3, lanes: {[SURFACE_LANE]: {v: 1}}})).toBe(1);
    expect(surfaceVersionFor({visits: 0, lanes: {[SURFACE_LANE]: {v: 0}}})).toBe(0);
    expect(surfaceVersionFor({visits: 3, lanes: {[SURFACE_LANE]: {v: 99}}})).toBe(0); // invalid record: treated as absent
  });
});

describe('Surface Run section keys and asset family', () => {
  it('maps host <-> district keys and the district loads as its own family', () => {
    const host = {level: 'mall' as const, section: 'main', station: 'st-4'};
    const sk = surfaceKeyOf(host);
    expect(sk).toEqual({level: 'mall', section: 'surface', station: 'st-4'});
    expect(isSurfaceKey(sk)).toBe(true);
    expect(isSurfaceKey(host)).toBe(false);
    expect(hostKeyOf(sk)).toEqual(host);
    expect(sectionAssetLevel(sk)).toBe('surface');
    expect(sectionAssetLevel(host)).toBe('mall');
  });

  it('surface-* files are the district family; it may reuse the mall / reactor / skyways kits; no other level loads them', () => {
    expect(levelOfAsset('assets/models/surface-military-truck.glb')).toBe('surface');
    expect(levelOfAsset('assets/textures/surface/asphalt.jpg')).toBe('surface');
    expect(assetAllowedIn('surface', 'assets/models/surface-military-truck.glb')).toBe(true);
    for (const lv of ['subway', 'office', 'mall', 'skyways', 'reactor', 'market', 'bunker']) expect(assetAllowedIn(lv, 'assets/models/surface-military-truck.glb')).toBe(false);
    expect(assetAllowedIn('surface', 'assets/models/mall-glass-counter.glb')).toBe(true);
    expect(assetAllowedIn('surface', 'assets/models/reactor-crane.glb')).toBe(true);
    expect(assetAllowedIn('surface', 'assets/models/skyways-wreck-suv.glb')).toBe(true);
    expect(assetAllowedIn('surface', 'assets/models/market-human-cast.glb')).toBe(false);
    expect(assetAllowedIn('subway', 'assets/models/skyways-wreck-suv.glb')).toBe(false); // (unchanged for every other level)
  });
});

describe('Surface Run district generator contract', () => {
  it('generates the 8 x 8-block frame with a ~4 x 4 core, a portal, a checkpoint, the truck and the depot', () => {
    const a = LEVELS.subway.generate('surface', {levelSeed: 11});
    const s = a.surface!;
    expect(s).toBeTruthy();
    expect(s.cols).toBe(8);
    expect(s.rows).toBe(8);
    expect(s.blocks.length).toBe(64);
    expect(s.blocks.filter(b => b.core).length).toBeGreaterThanOrEqual(12);
    expect(s.blocks.filter(b => b.core).length).toBeLessThanOrEqual(20);
    expect(s.seed).toBe(surfaceSeed(11));
    expect(s.depot.recoverables.length).toBeGreaterThan(0);
    expect(s.buildings.some(b => b.destination && b.enterable)).toBe(true);
    const b = LEVELS.subway.generate('surface', {levelSeed: 11});
    expect(b.surface!.buildings.map(x => x.name)).toEqual(s.buildings.map(x => x.name)); // deterministic
    expect(LEVELS.mall.generate('surface', {levelSeed: 11}).surface!.host).toBe('mall');
  });

  it('a host layout gets no access without a surface version (pinned direct-registry callers unchanged)', () => {
    expect(LEVELS.subway.generate('main', {levelSeed: 5}).surfaceAccess).toBeUndefined();
  });
});
