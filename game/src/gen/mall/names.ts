// Task mall-playtest-revision-20261031 (lane GEN, U01): the mall's SEEDED FICTIONAL NAME — "<Name> Center".
//
// User (playtest): "Better rename it 'X Center' (since I want the name to be randomized)". The name is built from fictional word
// parts (a Toronto-ish flavour, no real mall / brand names) and derived from the LEVEL seed only, so the same logical run, a revisit
// and a Travel back regenerate exactly the same name (the layout record layout.mall.name / layout.name carry it; the UI reads them or
// calls mallNameOf with the run's level seed). Different seeds vary; uniqueness across every seed is not required.
//
// Real-name guard: compound parts can accidentally spell a real centre ("Mapleview", "Northgate", "Fairview" ...). Such compounds are
// listed in REAL_NAME_BLOCKLIST and skipped deterministically (the next candidate in a seeded walk). This is a best-effort guard, not
// a legal clearance.

import {hashString} from '../../core/rng';

/** First parts (capitalised). */
export const MALL_NAME_HEADS: readonly string[] = [
  'Harbour', 'Maple', 'Lantern', 'Cedar', 'Granite', 'Willow', 'Copper', 'Heron', 'Juniper', 'Birch', 'Thistle', 'Alder',
  'Kestrel', 'Larch', 'Tamarack', 'Marten', 'Bracken', 'Quarry', 'Saltmarsh', 'Ember', 'Hollin', 'Ferris', 'Ashby', 'Tilbury',
];
/** Second parts (lower case, joined without a space). */
export const MALL_NAME_TAILS: readonly string[] = [
  'line', 'gate', 'brook', 'crest', 'field', 'mere', 'haven', 'wick', 'stone', 'ford', 'cross', 'hollow', 'reach', 'mount',
  'vale', 'ridge',
];

/**
 * Compounds that are (or closely spell) real shopping centres / retail brands — never produced. Lower case, no spaces.
 * (Best effort: common Canadian / US / UK centre names the parts above could form.)
 */
export const REAL_NAME_BLOCKLIST: ReadonlySet<string> = new Set([
  'mapleview', 'maplegrove', 'mapleridge', 'maplewood', 'cedarbrae', 'cedarcrest', 'cedarridge', 'willowbrook', 'willowcreek', 'birchmount',
  'birchwood', 'harbourfront', 'harbourside', 'harbourgate', 'stonegate', 'copperfield', 'granitecrest', 'alderwood', 'ashbyfield',
  'heronbrook', 'juniperridge', 'larchmount', 'brackenridge', 'quarryridge', 'tilburyfield', 'emberwick', 'ferrisfield',
  'northgate', 'southgate', 'eastgate', 'westgate', 'fairview', 'oakridge', 'woodbine', 'sherway', 'yorkdale', 'eaton', 'rideau',
  'galleria', 'promenade', 'cloverdale', 'westfield', 'brookfield', 'kingsway', 'kingsgate', 'stoneridge', 'rosedale', 'woodfield',
  'lakeside', 'crossgates', 'rivergate', 'hillcrest', 'limeridge', 'seaway', 'parkway', 'bayshore', 'centerpoint', 'markville',
]);

/** Every candidate compound in registry order (QA / tests: the blocklist removes the real ones). */
export function mallNameCandidates(): string[] {
  const out: string[] = [];
  for (const h of MALL_NAME_HEADS) for (const t of MALL_NAME_TAILS) {
    const word = h + t;
    if (!REAL_NAME_BLOCKLIST.has(word.toLowerCase())) out.push(word);
  }
  return out;
}

let cache: string[] | null = null;

/** The seeded display name of the mall of a level seed: "<Fictional compound> Center" (pure, deterministic). */
export function mallNameOf(levelSeed: number): string {
  cache ??= mallNameCandidates();
  const i = hashString('mall-name-v1', levelSeed >>> 0) % cache.length;
  return `${cache[i]} Center`;
}

/** Generic label for menus that have no level seed / layout yet (levels/registry.ts LEVELS.mall.name). */
export const MALL_GENERIC_NAME = 'Shopping Center';
