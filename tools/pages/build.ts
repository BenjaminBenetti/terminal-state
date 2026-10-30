// Task loot-reference-pages-20261030 (lane SITE): build the static reference site IN MEMORY from the current game source.
//
// buildSite() = DATA's buildLootReference() (reads the real exported game values) -> renderSite() (pure rendering of that ONE object).
// The result maps site paths to UTF-8 text and is deterministic for a fixed source tree and commit: no timestamps, no environment
// reads, no absolute paths. Writing it to disk (dist/pages/) is the CLI's job (tools/pages/cli.ts).
import fs from 'node:fs';
import path from 'node:path';
import {buildLootReference} from './lootReference';
import {renderSite} from './render/site';

export interface SiteBuildOptions {
  /** Full source commit SHA, or 'local'. */
  commit: string;
  /** Reads a repo-relative game source file (used only to find declaration line numbers for source links). */
  readSource?: (repoPath: string) => string | null;
}

export function buildSite(opts: SiteBuildOptions): Map<string, string> {
  const reference = buildLootReference({commit: opts.commit, readSource: opts.readSource});
  return renderSite(reference);
}

/**
 * Source reader confined to the game's TypeScript sources and docs under `root`: anything else (or a missing file) reads as null.
 * The text is only searched for declaration lines; it is never published.
 */
export function sourceReader(root: string): (repoPath: string) => string | null {
  const base = path.resolve(root);
  return (repoPath: string) => {
    if (!/^(?:game\/src|docs)\/[A-Za-z0-9_./-]+\.(?:ts|md)$/.test(repoPath) || repoPath.split('/').includes('..')) return null;
    const file = path.resolve(base, repoPath);
    if (!file.startsWith(base + path.sep)) return null;
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
}
