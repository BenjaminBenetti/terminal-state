// Task loot-reference-pages-20261030 (lane SITE): command entry of the reference-site generator (bundled by tools/pages/vite.config.ts,
// invoked by tools/pages/run.mjs; see `npm run pages:build` / `npm run pages:check`).
//
//   build  generate the site into <root>/dist/pages/ (replacing only that generated, git-ignored directory)
//   check  validate <root>/dist/pages/ as written (allowlist, leaks, links, manifest) and prove it is byte-identical to a fresh
//          in-memory build of the same commit (determinism + no stale or foreign files)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {buildSite, sourceReader} from './build';
import {validateSite} from './validate';

export const OUTPUT_DIR = 'dist/pages';

/** Source commit: GITHUB_SHA, else `git rev-parse HEAD`, else 'local'. Needs no Git history (a shallow checkout is enough). */
export function resolveCommit(root: string, env: Readonly<Record<string, string | undefined>>): string {
  const fromEnv = env.GITHUB_SHA?.trim().toLowerCase();
  if (fromEnv && /^[0-9a-f]{40}$/.test(fromEnv)) return fromEnv;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000}).trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
  } catch {
    // Not a Git checkout (or no git binary): fall through.
  }
  return 'local';
}

/** Read a generated site from disk. Symlinks, special files and non-UTF-8 content are rejected. */
export function readSiteDir(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`Symlink in generated site: ${rel}`);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        const buf = fs.readFileSync(full);
        const text = buf.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(buf)) throw new Error(`Not UTF-8: ${rel}`);
        files.set(rel, text);
      } else throw new Error(`Special file in generated site: ${rel}`);
    }
  };
  walk(dir);
  return files;
}

function writeSite(outDir: string, files: ReadonlyMap<string, string>): void {
  fs.rmSync(outDir, {recursive: true, force: true});
  for (const [rel, text] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const target = path.join(outDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, text, 'utf8');
  }
}

function summary(files: ReadonlyMap<string, string>): string {
  const total = [...files.values()].reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0);
  return `${files.size} files, ${(total / 1024).toFixed(1)} KiB`;
}

export async function main(command: string, root: string, env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const outDir = path.join(path.resolve(root), ...OUTPUT_DIR.split('/'));
  if (command === 'build') {
    const commit = resolveCommit(root, env);
    const files = buildSite({commit, readSource: sourceReader(root)});
    const problems = validateSite(files);
    if (problems.length) {
      console.error(`Generated site failed validation (${problems.length}):\n  ${problems.slice(0, 50).join('\n  ')}`);
      return 1;
    }
    writeSite(outDir, files);
    console.log(`Reference site written to ${OUTPUT_DIR}/ (${summary(files)}; commit ${commit}).`);
    return 0;
  }
  if (command === 'check') {
    if (!fs.existsSync(outDir)) {
      console.error(`${OUTPUT_DIR}/ does not exist: run \`npm run pages:build\` first.`);
      return 1;
    }
    const onDisk = readSiteDir(outDir);
    const problems = validateSite(onDisk);
    let commit = 'local';
    try {
      commit = (JSON.parse(onDisk.get('data/manifest.json') ?? '{}') as {commit?: string}).commit ?? 'local';
    } catch {
      problems.push('data/manifest.json: unreadable');
    }
    const fresh = buildSite({commit, readSource: sourceReader(root)});
    const names = new Set([...onDisk.keys(), ...fresh.keys()]);
    for (const name of [...names].sort()) {
      if (!fresh.has(name)) problems.push(`${name}: present on disk but not produced by the generator (stale or foreign file)`);
      else if (!onDisk.has(name)) problems.push(`${name}: missing on disk`);
      else if (fresh.get(name) !== onDisk.get(name)) problems.push(`${name}: differs from a fresh build of commit ${commit} (non-deterministic or stale output)`);
    }
    if (problems.length) {
      console.error(`${OUTPUT_DIR}/ failed the check (${problems.length}):\n  ${problems.slice(0, 50).join('\n  ')}`);
      return 1;
    }
    console.log(`${OUTPUT_DIR}/ verified: allowlist, leak, link, accessibility-structure and manifest checks passed; byte-identical to a fresh build (${summary(onDisk)}; commit ${commit}).`);
    return 0;
  }
  console.error(`Unknown command ${command}`);
  return 2;
}
