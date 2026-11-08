// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's registration — LevelId 'market' everywhere a level
// is enumerated (registry order, labels, spawn / loot / mask profiles, save archetypes, the map's station kind / glyph / key), its
// level-only art (the Codex-authored textures: textures/market/**, shipped through tools/release/public-inputs.json), and the mall
// furniture it may load.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LEVELS, LEVEL_IDS, clearLabel, isLevelId, levelDisplayName, levelTier, sectionLabel, storeyLabel, travelTargets} from '../src/levels/registry';
import {validateLevelRegistry} from '../src/levels/levelContract';
import {SAVE_ARCHETYPES} from '../src/save/validate';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {PROFILES, validateLootProfile} from '../src/items/lootTables';
import {archetypeLabel} from '../src/campaign/network';
import {kindLabel, stationGlyph} from '../src/ui/paperMap';
import {assetAllowedIn, levelOfAsset} from '../src/assets/levelAssets';
import {MARKET_TEXTURES} from '../src/assets/marketTextures.generated';
import {MARKET_GENERIC_NAME, generateMarketLevel, marketNameOf} from '../src/gen/market/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the Survivor Market registration', () => {
  it('is a registered LevelId before Skyways (Skyways second-to-last, the Reactor last), one continuous section, no track extensions', () => {
    expect(isLevelId('market')).toBe(true);
    expect(LEVEL_IDS).toEqual(['subway', 'office', 'mall', 'market', 'skyways', 'reactor']);
    expect(LEVELS.market).toMatchObject({id: 'market', name: MARKET_GENERIC_NAME, entry: 'main', trackExtensions: 'none'});
    expect(LEVELS.market.sections(1)).toEqual(['main']);
    expect(levelTier('market')).toBe(1);
    expect(validateLevelRegistry()).toEqual([]);
    expect(travelTargets('subway')).toContain('market');
    expect(SAVE_ARCHETYPES).toContain('market');
    expect(MASK_LOOT.levels.market).toEqual({masks: [0, 0], filters: [0, 0]});
    expect(validateLootProfile(PROFILES.market)).toEqual([]);
  });

  it('labels: the seeded settlement name (= layout.name), storeys, section / clear labels, the map / HUD wording', () => {
    const L = generateMarketLevel({levelSeed: 31337});
    expect(levelDisplayName('market', 31337)).toBe(L.name);
    expect(L.name).toBe(marketNameOf(31337));
    expect(levelDisplayName('market')).toBe(MARKET_GENERIC_NAME);
    expect([storeyLabel(L, 0), storeyLabel(L, 1)]).toEqual(['Market floor', 'Housing deck']);
    expect(sectionLabel({level: 'market', section: 'main'})).toBe('Station and settlement');
    expect(clearLabel({level: 'market', section: 'main'})).toBe('Market clear');
    expect(archetypeLabel('market')).toBe('Survivor market');
    expect(kindLabel('market')).toBe('Survivor market');
    // its own map glyph (a tent), never the Subway's dot
    expect(stationGlyph('market', {x: 10, y: 10}, 5, false)).not.toBe(stationGlyph('subway', {x: 10, y: 10}, 5, false));
    expect(stationGlyph('market', {x: 10, y: 10}, 5, false)).toMatch(/<path/);
  });

  it('level-only art: textures/market/** belong to the market (listed + hashed in public-inputs.json); it may load the mall racks / shelving / tent', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const t of Object.values(MARKET_TEXTURES)) {
      expect(levelOfAsset(t.url)).toBe('market');
      expect(assetAllowedIn('subway', t.url)).toBe(false);
      const buf = fs.readFileSync(path.join(ROOT, 'game/public', t.url));
      expect(buf.length).toBe(t.bytes);
      const row = allow.files.find(f => f.path === t.url);
      expect(row).toEqual({path: t.url, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')});
    }
    const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/market-textures.json'), 'utf8'));
    expect(Object.keys(prov.textures).sort()).toEqual(['market-corrugated-roof', 'market-corrugated-wall', 'market-plywood', 'market-tarp']);
    for (const r of Object.values(prov.textures) as {codex: {generator: string; session: string}}[]) expect(r.codex.generator).toMatch(/Codex native image_gen/);
    for (const f of ['mall-gun-wall-rack', 'mall-outdoors-plank-shelving', 'mall-camping-tent-display']) {
      expect(assetAllowedIn('market', `assets/models/${f}.glb`)).toBe(true);
      expect(levelOfAsset(`assets/models/${f}.glb`)).toBe('mall');
    }
    expect(assetAllowedIn('market', 'assets/models/mall-fountain.glb')).toBe(false); // nothing else of the mall's
  });
});
