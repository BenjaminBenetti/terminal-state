import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

// Static build: relative base so the game works under any app slug; publicDir holds only
// runtime derivatives (never the board snapshot or masters).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('../dist/game', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {host: '127.0.0.1', port: 5173},
  preview: {host: '127.0.0.1', port: 4180},
});
