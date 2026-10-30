// Task loot-reference-pages-20261030 (lane SITE): render the whole static site from ONE LootReference object.
//
// Output (all relative links; see tools/pages/validate.ts for the enforced allowlist):
//   index.html, playtest.html                         landing page, playtest access
//   loot/index.html, loot/how-to-read.html            levels index, probability definitions
//   loot/<level>/index.html                           level overview (profile, overrides, slot categories, contexts, specials)
//   loot/<level>/slot-<slot>.html                     every holder context of one slot category in that level
//   loot/<level>/floor.html, loot/<level>/economy.html loose floor program; scarcity / eligibility / stack sizes
//   loot/tables/index.html, loot/tables/<id>.html     every distinct (deduplicated) table
//   loot/items/index.html, loot/items/<id>.html       every item and where it can come from
//   loot/holders.html, loot/sources.html              slot categories & holder kinds; special sources
//   assets/site.css, assets/site.js, assets/favicon.svg
//   data/loot.json                                    the LootReference object itself
//   enemies/index.html, enemies/<level>.html,         Enemy spawns section (task enemy-spawn-tables-20261030, lane SITE):
//   enemies/families.html, enemies/how-to-read.html   rendered only from the EnemyReference object (render/enemies.ts)
//   data/enemies.json                                 the EnemyReference object itself
//   data/manifest.json                                byte count + SHA-256 of every other file
import siteCss from '../assets/site.css?raw';
import siteJs from '../assets/site.js?raw';
import type {EnemyReference} from '../enemyReferenceTypes';
import {LOOT_REFERENCE_SCHEMA, type LootReference} from '../lootReferenceTypes';
import {siteManifest} from '../validate';
import {makeSite, slotPage} from './common';
import {renderEnemyLevelPage} from './enemyLevel';
import {ENEMIES_FAMILIES, ENEMIES_HOW_TO, ENEMIES_INDEX, enemyLevelPage, makeEnemySite, renderEnemiesIndex, renderEnemyFamilies, renderEnemyHowTo} from './enemies';
import {type SiteContext} from './html';
import {renderItemPage, renderItemsIndex} from './items';
import {renderLanding, renderPlaytest} from './landing';
import {renderEconomyPage, renderFloorPage, renderLevelOverview, renderSlotPage} from './level';
import {renderHowToRead, renderLootIndex} from './lootIndex';
import {renderHoldersPage, renderSourcesPage} from './sources';
import {renderTablePage, renderTablesIndex} from './tables';

export const GAME_TITLE = 'Terminal State';

/** Authored in code (no art asset): the header's round "TS" signage mark. */
export const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
  + '<circle cx="32" cy="32" r="30" fill="#eda100"/>'
  + '<text x="32" y="41" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" text-anchor="middle" fill="#0b0b0b">TS</text>'
  + '</svg>\n';

/** Plain-JSON serialisation of a reference object (rejects non-finite numbers and non-plain values instead of silently nulling them). */
export function referenceJson(ref: LootReference | EnemyReference): string {
  const text = JSON.stringify(ref, (key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite number at ${key}`);
    if (value instanceof Map || value instanceof Set || typeof value === 'function' || typeof value === 'bigint') {
      throw new Error(`Non-JSON value at ${key}`);
    }
    return value;
  });
  return `${text}\n`;
}

export function renderSite(ref: LootReference, enemyRef: EnemyReference): Map<string, string> {
  if (ref.meta.schema !== LOOT_REFERENCE_SCHEMA) throw new Error(`LootReference schema ${ref.meta.schema}, renderer expects ${LOOT_REFERENCE_SCHEMA}`);
  if (enemyRef.meta.commit !== ref.meta.commit) throw new Error(`Loot (${ref.meta.commit}) and enemy (${enemyRef.meta.commit}) references come from different commits`);
  const ctx: SiteContext = {commit: ref.meta.commit, dataDigest: ref.meta.dataHash, enemyDigest: enemyRef.meta.dataHash, gameTitle: GAME_TITLE};
  const site = makeSite(ref, ctx);
  const enemies = makeEnemySite(enemyRef, ctx);
  const files = new Map<string, string>();
  const add = (path: string, text: string) => {
    if (files.has(path)) throw new Error(`Two pages render to ${path}`);
    files.set(path, text);
  };

  add('index.html', renderLanding(site, enemies));
  add('playtest.html', renderPlaytest(site));
  add('loot/index.html', renderLootIndex(site));
  add('loot/how-to-read.html', renderHowToRead(site));
  add('loot/holders.html', renderHoldersPage(site));
  add('loot/sources.html', renderSourcesPage(site));
  for (const level of ref.levels) {
    const dir = site.levelDir.get(level.id)!;
    add(`${dir}/index.html`, renderLevelOverview(site, level));
    for (const s of level.slots) if (s.contexts.length) add(slotPage(dir, s.slot), renderSlotPage(site, level, s.slot));
    add(`${dir}/floor.html`, renderFloorPage(site, level));
    add(`${dir}/economy.html`, renderEconomyPage(site, level));
  }
  add('loot/tables/index.html', renderTablesIndex(site));
  for (const t of Object.values(ref.tables)) add(site.tablePage.get(t.id)!, renderTablePage(site, t));
  add('loot/items/index.html', renderItemsIndex(site));
  for (const item of Object.values(ref.items)) add(site.itemPage.get(item.id)!, renderItemPage(site, item));
  add(ENEMIES_INDEX, renderEnemiesIndex(enemies));
  add(ENEMIES_FAMILIES, renderEnemyFamilies(enemies));
  add(ENEMIES_HOW_TO, renderEnemyHowTo(enemies));
  for (const level of enemyRef.levels) add(enemyLevelPage(level.id), renderEnemyLevelPage(enemies, level));
  add('assets/site.css', siteCss);
  add('assets/site.js', siteJs);
  add('assets/favicon.svg', FAVICON_SVG);
  add('data/loot.json', referenceJson(ref));
  add('data/enemies.json', referenceJson(enemyRef));

  const sorted = new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  sorted.set('data/manifest.json', siteManifest(sorted, {commit: ref.meta.commit, dataHash: ref.meta.dataHash, enemyDataHash: enemyRef.meta.dataHash}));
  return new Map([...sorted].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
