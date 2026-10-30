// Task loot-reference-pages-20261030 (lane SITE): Vite SSR build of the reference-site generator.
//
// The generator (tools/pages/cli.ts) imports the real game modules through DATA's buildLootReference, and those modules use
// bundler-style extensionless imports that plain Node cannot resolve. Instead of adding a TypeScript runner dependency, the
// existing Vite toolchain bundles the generator into ONE temporary Node module under node_modules/.cache (git-ignored, never
// published, never inside dist/game or dist/pages). tools/pages/run.mjs builds it and calls its exported main().
// Bare package imports stay external (Vite's SSR default) and resolve from the repository's node_modules at run time.
import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  // The generator reads no .env files and copies no public directory: nothing from the workspace leaks in implicitly.
  envDir: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: fileURLToPath(new URL('./cli.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('../../node_modules/.cache/terminal-state-pages', import.meta.url)),
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: false,
    minify: false,
    target: 'node22',
    reportCompressedSize: false,
    rolldownOptions: {output: {entryFileNames: 'pages-cli.mjs', format: 'es'}},
  },
});
