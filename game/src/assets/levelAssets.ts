// Task track3-eaton-centre-20261031 (lane PACKAGE): level-scoped runtime assets — which lazy files belong to ONE logical level,
// the selector that keeps them out of every other level's fetch and resident set, and working-set reporting. Pure data / logic
// (no three.js), so the generator-side tests and the CI packager's path families agree with the runtime.
//
// How a level's assets load (verified against game.ts / assets/loader.ts, 2026-10-31):
//  1. BOOT, once, behind the title screen (loadAssets: assets/manifest.ts MODEL_FILES + TEXTURE_FILES): weapons, zombie bodies /
//     outfits, the ratdog, a few station props, the station textures. Every level needs them; they stay resident.
//  2. PER LEVEL, behind THAT level's loading screen (Game.prepareSection, before anything of the new level is built):
//     the lazy prop library (PropModelLibrary) fetches exactly the keys the generated layout placed (p7ModelKeysFor + the
//     game's sectionModelKeys hooks, e.g. officeModelKeysFor — which also maps the mall's shop kinds), filtered here by
//     `selectLevelKeys`; then the section preloads run (level textures: LevelResources.load); then buildSection builds the
//     world and prepareGraphics warms every material / pipeline it discovers in the scene. Nothing of the level's world is
//     fetched mid-play (the library and LevelResources count any late fetch: `stats.late`).
//  3. RELEASE when the level changes (buildSection, right after the old world was torn down): the library keeps the new
//     layout's keys plus up to 16 recently used SHARED extras; files owned by another level are never kept as extras
//     (`foreignTo`), and LevelResources disposes every other level's textures / owned GPU resources (retainOnly).
//     Peak while travelling = the old level's resident set + the new level's fetch (the old world must stay intact until the
//     new one is ready, so a failed travel leaves the player where they were).
//  Outside this scheme (unchanged, small): module caches of assets/officeAssets.ts (gear / medical models used in every level,
//  the office textures, the tower's exterior wrecks) and world/officeProps.ts.
//
// Ownership is decided by the FILE PATH, never by the library key (the mall's shop kinds render through `office-<id>` keys,
// gen/mall/kinds.ts MALL_KIND_ASSET): a path is LEVEL-ONLY when it matches its level's rule below. Everything else is shared —
// office / company models stay shared because the mall's shops may reuse them; they are still fetched only when a layout uses
// them and released when no layout does.

/** A lazy runtime file (same shape as PropModelLibrary's file map). */
export interface LazyFile { url: string; bytes: number }
export type LazyFiles = Readonly<Record<string, LazyFile>>;

export interface LevelOnlyRule {
  /** levels/types.ts LevelId (string here so this module compiles before / independently of the registry). */
  level: string;
  /** Matches the level-only runtime paths (relative, as in the manifests: 'assets/models/…'). */
  path: RegExp;
  /** Other levels that may ALSO load these files (task studio-skyways-level-20261106-054448-01: the mall's café furniture in Skyways). */
  also?: readonly string[];
}

/**
 * Level-only runtime paths. Mall: every `assets/models/mall-*.glb` derivative (lane ASSETS, assets/mallAssets.ts) and every
 * texture under `assets/textures/mall/`. Same families as tools/release/package-ci.mjs `levelFamilies` (mall).
 */
export const LEVEL_ONLY_RULES: readonly LevelOnlyRule[] = [
  // task studio-skyways-level-20261106-054448-01: the mall's café furniture (its family stays the mall's) also furnishes the Skyways
  // ramen restaurant (gen/skyways/ramen.ts RAMEN_SEATING) — matched before the general mall rule; (task studio-market-bar-20261108-225231-01,
  // lane BAR) and the Survivor Market's upper-level bar (gen/market/v3/barDress.ts: its bistro tables and chairs)
  {level: 'mall', also: ['skyways', 'market'], path: /^(?:\.\/)?assets\/models\/mall-(?:cafe-bistro-table|cafe-chair|food-court-table-set)\.glb$/},
  // task studio-survivor-market-20261108-005807-01 (lane LEVEL): the mall's gun rack, plank shelving and camping tent also furnish the
  // Survivor Market's stalls / housing deck (gen/market/dress.ts; still the mall's family) — matched before the general mall rule
  {level: 'mall', also: ['skyways', 'market'], path: /^(?:\.\/)?assets\/models\/mall-(?:gun-wall-rack|outdoors-plank-shelving|camping-tent-display)\.glb$/},
  // (task studio-skyways-rework-20261107-054512-01: the Skyways stores reuse the mall's furniture / fixtures / textures — user: "unique
  // proper stores remixed from Subway / Mall / Office assets"; still the mall's family, never fetched by any other level)
  {level: 'mall', also: ['skyways'], path: /^(?:\.\/)?assets\/(?:models\/mall-[A-Za-z0-9_-]+\.glb|textures\/mall\/[A-Za-z0-9_/-]+\.(?:png|jpg|jpeg|webp|ktx2))$/},
  // task reactor-build-20261101 (lane ARCH): the Reactor's kit (assets/reactorKit.generated.ts: reactor-*.glb, textures/reactor/**).
  // Task studio-bunker-level-20261109-072224-01 (lane LEVEL): THE BUNKER reuses it (still the Reactor's family): the arch textures /
  // finishes (world/builder.ts BunkerArch), the shelter hero props (REACTOR_X_KIT bunk bed, radio console, air filtration unit, blast
  // door), the auxiliary generator (REACTOR_KIT.generator: the objective's three generators), control consoles / switchgear — a Bunker
  // fetches only the keys its own layout places (selectLevelKeys), never another level's
  {level: 'reactor', also: ['bunker'], path: /^(?:\.\/)?assets\/(?:models\/reactor-[A-Za-z0-9_-]+\.glb|textures\/reactor\/[A-Za-z0-9_/-]+\.(?:png|jpg|jpeg|webp|ktx2))$/},
  // task studio-skyways-level-20261106-054448-01: Skyways' kit (skyways-*.glb: the prize car, the mascot statues, street wrecks, the
  // ramen kitchen; textures/skyways/**: the convention / prize / ramen art atlases). The edible food models (item-*.glb) are shared.
  {level: 'skyways', path: /^(?:\.\/)?assets\/(?:models\/skyways-[A-Za-z0-9_-]+\.glb|textures\/skyways\/[A-Za-z0-9_/-]+\.(?:png|jpg|jpeg|webp|ktx2))$/},
  // task studio-survivor-market-20261108-005807-01 (lanes LEVEL + HUMANS): THE SURVIVOR MARKET's own files — market-*.glb (the friendly
  // humans' market-human-cast.glb: market/humanLooks.ts) and textures/market/** (the Codex-authored corrugated / plywood / tarp surfaces,
  // world/marketTextures.ts)
  // task studio-bunker-level-20261109-072224-01: the Bunker's own flavour models (assets/bunkerKit.generated.ts; build-bunker-kit.mjs)
  {level: 'bunker', path: /^(?:\.\/)?assets\/models\/bunker-[A-Za-z0-9_-]+\.glb$/},
  {level: 'market', path: /^(?:\.\/)?assets\/(?:models\/market-[A-Za-z0-9_-]+\.glb|textures\/market\/[A-Za-z0-9_/-]+\.(?:png|jpg|jpeg|webp|ktx2))$/},
];

/** The level that alone may load `url`, or null when it is shared. */
export function levelOfAsset(url: string): string | null {
  for (const r of LEVEL_ONLY_RULES) if (r.path.test(url)) return r.level;
  return null;
}

/** May `level` load the level-only file `url` (its owner, or a level its rule also allows)? Shared files: always. */
function allowedFor(level: string, url: string): boolean {
  for (const r of LEVEL_ONLY_RULES) if (r.path.test(url)) return r.level === level || (r.also?.includes(level) ?? false);
  return true;
}

/** The owning level of a lazy-library key (by its file path), or null when shared / unknown to `files`. */
export function levelOfKey(key: string, files: LazyFiles): string | null {
  const f = files[key];
  return f ? levelOfAsset(f.url) : null;
}

/** May `level` load `url`? Shared files: yes; level-only files: only their own level. */
export function assetAllowedIn(level: string, url: string): boolean {
  return allowedFor(level, url);
}

/**
 * The keys `level` may fetch (deduplicated, input order) and the FOREIGN ones: keys whose file belongs to another level (a
 * generator / mapping bug — never fetched, so another level's art is never downloaded or decoded here). Keys unknown to
 * `files` pass through (the library ignores undelivered models).
 */
export function selectLevelKeys(level: string, keys: readonly string[], files: LazyFiles): {keys: string[]; foreign: string[]} {
  const out: string[] = [], foreign: string[] = [], seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const f = files[k];
    (!f || allowedFor(level, f.url) ? out : foreign).push(k);
  }
  return {keys: out, foreign};
}

/** Predicate for PropModelLibrary.trim: a key owned by a level other than `level` (released, never kept as a recent extra). */
export function foreignTo(level: string, files: LazyFiles): (key: string) => boolean {
  return key => { const f = files[key]; return !!f && !allowedFor(level, f.url); };
}

export interface ByteCount { files: number; bytes: number }

export interface LevelWorkingSet {
  level: string;
  /** Every selected lazy file (catalogue bytes: the cooked GLB sizes, not decoded GPU memory). */
  total: ByteCount;
  /** Of which level-only (this level's own art) / shared. */
  levelOnly: ByteCount;
  shared: ByteCount;
  /** Keys rejected as another level's (see selectLevelKeys). */
  foreign: string[];
  /** Requested keys without a delivered file (ignored by the library). */
  undelivered: string[];
}

/** The lazy working set `level` fetches for `keys` (deterministic; used by tests, QA and the docs' byte numbers). */
export function levelWorkingSet(level: string, keys: readonly string[], files: LazyFiles): LevelWorkingSet {
  const {keys: ok, foreign} = selectLevelKeys(level, keys, files);
  const ws: LevelWorkingSet = {level, total: {files: 0, bytes: 0}, levelOnly: {files: 0, bytes: 0}, shared: {files: 0, bytes: 0}, foreign, undelivered: []};
  for (const k of ok) {
    const f = files[k];
    if (!f) { ws.undelivered.push(k); continue; }
    const bucket = levelOfAsset(f.url) === level ? ws.levelOnly : ws.shared;
    bucket.files++; bucket.bytes += f.bytes;
    ws.total.files++; ws.total.bytes += f.bytes;
  }
  return ws;
}

/** Declared lazy catalogue by owner ('shared' + each level-only owner): what exists, not what any one level loads. */
export function lazyCatalogue(files: LazyFiles): Record<string, ByteCount> {
  const out: Record<string, ByteCount> = {shared: {files: 0, bytes: 0}};
  for (const r of LEVEL_ONLY_RULES) out[r.level] ??= {files: 0, bytes: 0};
  const seen = new Set<string>();
  for (const f of Object.values(files)) {
    if (seen.has(f.url)) continue; // two keys may share one file
    seen.add(f.url);
    const b = out[levelOfAsset(f.url) ?? 'shared'];
    b.files++; b.bytes += f.bytes;
  }
  return out;
}
