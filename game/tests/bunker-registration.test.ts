// Task studio-bunker-level-20261109-072224-01 (lane LEVEL): THE BUNKER's registration — LevelId 'bunker' everywhere a level is enumerated
// (registry order / tier / labels, the spawn profile with its storey contexts + the damp-only Strainer, the loot / mask / pantry profiles,
// save archetypes, the campaign label, the paper map's station kind / glyph, the level-only Reactor kit it may load, the 'none' track
// extensions, the Game's objective line / version lane). The generated-layout checks (labels from layout.bunker) are the last block.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LEVELS, LEVEL_IDS, arrivalPose, clearLabel, isLevelId, levelDisplayName, levelTier, sectionLabel, storeyLabel, travelTargets} from '../src/levels/registry';
import {validateLevelRegistry} from '../src/levels/levelContract';
import {SAVE_ARCHETYPES} from '../src/save/validate';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {BASE_TABLES, PROFILES, validateLootProfile} from '../src/items/lootTables';
import {LEVEL_PANTRY, levelPreloadPantryIds} from '../src/items/pantryVariety';
import {FIELD_RATION, RATION_BRICK} from '../src/items/pantryFood';
import {
  BUNKER_SPAWN_PROFILE, CONTEXT_LOCKED_FAMILIES, OPT_IN_FAMILIES, SPAWN_CONTEXT_IDS, SPAWN_PROFILES, STRAINER_CONTEXTS, spawnProfile, validateSpawnProfile,
} from '../src/ai/spawnTables';
import {archetypeLabel} from '../src/campaign/network';
import {kindLabel, stationGlyph} from '../src/ui/paperMap';
import {assetAllowedIn, levelOfAsset} from '../src/assets/levelAssets';
import {REACTOR_X_KIT} from '../src/assets/reactorExpansionKit.generated';
import {REACTOR_KIT} from '../src/assets/reactorKit.generated';
import {TRACK_EXT_BUNKER, trackExtConfig} from '../src/gen/trackExt/config';
import {BUNKER_GENERIC_NAME, bunkerNameOf, generateBunkerLevel} from '../src/gen/bunker/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const share = (pool: readonly (readonly [string, number])[] | undefined, f: string) => pool?.find(([k]) => k === f)?.[1] ?? 0;

describe('the Bunker registration', () => {
  it('is a registered LevelId after the market (Skyways second-to-last, the Reactor last), tier 2, one continuous section, no track extensions', () => {
    expect(isLevelId('bunker')).toBe(true);
    expect(LEVEL_IDS).toEqual(['subway', 'office', 'mall', 'market', 'bunker', 'skyways', 'reactor']);
    expect(LEVEL_IDS.indexOf('skyways')).toBe(LEVEL_IDS.length - 2);
    expect(LEVEL_IDS[LEVEL_IDS.length - 1]).toBe('reactor');
    expect(LEVELS.bunker).toMatchObject({id: 'bunker', name: BUNKER_GENERIC_NAME, entry: 'main', trackExtensions: 'none'});
    expect(LEVELS.bunker.sections(1)).toEqual(['main']);
    expect(levelTier('bunker')).toBe(2);
    expect(validateLevelRegistry()).toEqual([]);
    expect(travelTargets('subway')).toContain('bunker');
    expect(travelTargets('bunker')).not.toContain('bunker');
    expect(SAVE_ARCHETYPES).toContain('bunker');
    expect([...SAVE_ARCHETYPES]).toEqual([...LEVEL_IDS]);
    // the zero-annex record answering the per-level questions (the registry itself declares 'none')
    expect(trackExtConfig('bunker')).toBe(TRACK_EXT_BUNKER);
    expect(TRACK_EXT_BUNKER.annex.max).toBe(0);
    // no franchise wording in the level's player-facing text
    for (const t of [LEVELS.bunker.name, LEVELS.bunker.blurb]) expect(t).not.toMatch(/vault[- ]?\d|vault-tec|overseer|fallout/i);
  });

  it('spawn profile: storey contexts + the damp zone; the Strainer only in the damp / annex pools; the Siren opt-in with a room rule', () => {
    const p = spawnProfile('bunker');
    expect(p).toBe(BUNKER_SPAWN_PROFILE);
    expect(SPAWN_PROFILES.bunker.id).toBe('bunker');
    expect(validateSpawnProfile(p)).toEqual([]);
    expect(Object.keys(p.contexts).sort()).toEqual(['damp', 'floor', 'ring', 'service', 'station']);
    expect(SPAWN_CONTEXT_IDS).toContain('damp');
    expect(STRAINER_CONTEXTS).toContain('damp');
    expect(CONTEXT_LOCKED_FAMILIES.strainer).toContain('damp');
    expect(share(p.families, 'strainer')).toBe(0);
    for (const [id, c] of Object.entries(p.contexts)) {
      const s = share(c?.families, 'strainer');
      if (id === 'damp') { expect(s).toBeGreaterThan(0); expect(s).toBeLessThan(0.5); } else if (id !== 'service') expect(s, id).toBe(0);
    }
    // the damp zone places one spawn per run: never a guaranteed Strainer
    expect(p.contexts.damp!.count).toEqual([1, 1]);
    expect(share(p.contexts.damp!.families, 'siren')).toBe(0);
    // the Siren: a real draw on the shelter storeys, an eligibility rule (never the station storey)
    expect(OPT_IN_FAMILIES).toContain('siren');
    expect(share(p.contexts.floor!.families, 'siren')).toBeGreaterThan(0);
    expect(share(p.contexts.ring!.families, 'siren')).toBeGreaterThan(0);
    expect(p.eligibility?.siren?.contexts).toEqual(['floor', 'ring']);
    expect(p.eligibility?.siren?.kinds).toEqual(['room']);
    expect(p.eligibility?.siren?.excludeRooms).toEqual(expect.arrayContaining(['washroom', 'stair-core']));
    expect(p.horde).toBeUndefined();
  });

  it('loot: the shared base tables, no overrides (no merchant / currency rules); masks and filters available; a shelf-stable pantry', () => {
    expect(PROFILES.bunker.id).toBe('bunker');
    expect(PROFILES.bunker.tables).toBe(BASE_TABLES);
    expect(PROFILES.bunker.overrides).toEqual({});
    expect(validateLootProfile(PROFILES.bunker)).toEqual([]);
    expect(MASK_LOOT.levels.bunker.masks[0]).toBeGreaterThanOrEqual(1);
    expect(MASK_LOOT.levels.bunker.filters[0]).toBeGreaterThanOrEqual(1);
    expect(LEVEL_PANTRY.bunker).toEqual(expect.arrayContaining([FIELD_RATION, RATION_BRICK]));
    expect(levelPreloadPantryIds('bunker')).toEqual(LEVEL_PANTRY.bunker);
  });

  it('labels: generic / seeded names, section / clear labels, the map / HUD wording, its own map glyph', () => {
    expect(levelDisplayName('bunker')).toBe(BUNKER_GENERIC_NAME);
    expect(levelDisplayName('bunker', 31337)).toBe(bunkerNameOf(31337));
    expect(bunkerNameOf(31337)).toBe(bunkerNameOf(31337));
    for (let s = 0; s < 60; s++) expect(bunkerNameOf(s * 7919)).not.toMatch(/vault|overseer/i);
    expect(sectionLabel({level: 'bunker', section: 'main'})).toBe('Station and shelter');
    expect(clearLabel({level: 'bunker', section: 'main'})).toBe('Shelter clear');
    expect(archetypeLabel('bunker')).toBe('Civil-defence shelter');
    expect(kindLabel('bunker')).toBe('Civil-defence shelter');
    const g = stationGlyph('bunker', {x: 10, y: 10}, 5, false);
    expect(g).toMatch(/<path/);
    for (const k of ['subway', 'office', 'mall', 'skyways', 'market', 'reactor', 'maintenance'] as const) expect(g).not.toBe(stationGlyph(k, {x: 10, y: 10}, 5, false));
  });

  it('assets: the Reactor kit stays the Reactor family but the Bunker may load it (arch, shelter hero props, the generator); other levels may not', () => {
    const urls = [REACTOR_X_KIT.blastDoor.url, REACTOR_X_KIT.bunkBed.url, REACTOR_X_KIT.radioConsole.url, REACTOR_X_KIT.airFilter.url, REACTOR_KIT.generator.url, REACTOR_KIT.controlConsole.url, REACTOR_KIT.switchgear.url, REACTOR_X_KIT.deconShower.url];
    for (const u of urls) {
      expect(levelOfAsset(u), u).toBe('reactor');
      expect(assetAllowedIn('bunker', u), u).toBe(true);
      expect(assetAllowedIn('reactor', u), u).toBe(true);
      expect(assetAllowedIn('subway', u), u).toBe(false);
      expect(assetAllowedIn('market', u), u).toBe(false);
    }
    expect(assetAllowedIn('bunker', 'assets/textures/reactor/x.png')).toBe(true);
    expect(assetAllowedIn('bunker', 'assets/models/mall-fountain.glb')).toBe(false); // nothing of the mall's
    expect(assetAllowedIn('bunker', 'assets/models/market-human-cast.glb')).toBe(false);
  });

  it('the Game: the Bunker objective line, its layout version lane (bunker.layout v1), the seed literals, the HUD storey line', () => {
    const src = fs.readFileSync(path.join(ROOT, 'game/src/game.ts'), 'utf8');
    expect(src).toMatch(/export const BUNKER_OBJECTIVE = '[^']*generators[^']*'/);
    expect(src).toMatch(/key\.level === 'bunker' \? BUNKER_OBJECTIVE/);
    expect(src).toMatch(/key\.level === 'bunker' \? BUNKER_LAYOUT_LANE/);
    expect(src).toMatch(/key\.level === 'bunker' \? bunkerLayoutVersionFor\(run\.peekMemory\(key\)\)/);
    expect(src).toMatch(/bunker: freshSeed\(\)/);
    expect(src).toMatch(/bunker: o\.seeds\?\.bunker \?\? freshSeed\(\)/);
    expect(src).toMatch(/this\.layout\.skyways \|\| this\.layout\.bunker\) && area >= 0 \? storeyLabel/);
    const main = fs.readFileSync(path.join(ROOT, 'game/src/main.ts'), 'utf8');
    expect(main).toMatch(/\['bunker', 'bunkerSeed'\]/);
  });
});

describe('the Bunker registration on a generated layout', () => {
  it('the display name = layout.name; storey labels from layout.bunker; the arrival pose of a non-train arrival is layout.bunker.start', () => {
    const seed = 4242;
    const L = generateBunkerLevel({levelSeed: seed});
    expect(L.bunker).toBeTruthy();
    expect(L.name).toBe(bunkerNameOf(seed));
    expect(levelDisplayName('bunker', seed)).toBe(L.name);
    for (const s of L.bunker!.storeys) expect(storeyLabel(L, s.level)).toBe(s.label);
    expect(storeyLabel(L, 0)).toBe(L.bunker!.storeys.find(s => s.level === 0)!.label);
    const pose = arrivalPose(L, {kind: 'return'});
    expect(pose.source).toBe('start');
    expect([pose.x, pose.z, pose.level ?? 0]).toEqual([L.bunker!.start.x, L.bunker!.start.z, L.bunker!.start.level]);
    // the registry's generate is the generator + the level-wide gear roll (no gear: identical)
    expect(JSON.stringify(LEVELS.bunker.generate('main', {levelSeed: seed}).areas)).toBe(JSON.stringify(L.areas));
  });
});
