import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000,
    // CI: the hosted runner exposes 2 vCPUs and vitest's run-mode default is (cpus - 1) = ONE worker, so `npm test` ran the
    // suite file by file (main: ~691 s of the 20-minute job). Two workers use both cores. Local runs are unchanged (the
    // documented command passes --maxWorkers=1, which overrides this).
    ...(process.env.CI ? {maxWorkers: 2} : {}),
  },
});
