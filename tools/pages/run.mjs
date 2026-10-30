// Task loot-reference-pages-20261030 (lane SITE): runner for `npm run pages:build` / `npm run pages:check`.
//
//   node tools/pages/run.mjs build   → generate the static reference site into dist/pages/ (git-ignored)
//   node tools/pages/run.mjs check   → validate dist/pages/ (allowlist, leaks, links, manifest) and prove it equals a fresh build
//
// No new dependencies: Vite (already locked for the game) SSR-bundles tools/pages/cli.ts into a temporary module under
// node_modules/.cache/terminal-state-pages/, which this script then imports. That temporary module is never published.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const command = process.argv[2];
if (command !== 'build' && command !== 'check') {
  console.error('Usage: node tools/pages/run.mjs <build|check>');
  process.exit(2);
}

await build({configFile: path.join(ROOT, 'tools/pages/vite.config.ts'), logLevel: 'warn'});
const cli = await import(pathToFileURL(path.join(ROOT, 'node_modules/.cache/terminal-state-pages/pages-cli.mjs')).href);
process.exitCode = await cli.main(command, ROOT, process.env);
