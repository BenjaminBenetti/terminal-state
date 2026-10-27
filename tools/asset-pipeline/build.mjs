// Rebuild every runtime derivative from the read-only masters (CPU only, no inference/downloads).
// Each sub-pipeline verifies source SHA-256s and refuses to write under public/vision-board or reference/.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir = import.meta.dirname;
const only = process.argv[2];
for (const [name, script] of [['props', 'props/build-props.mjs'], ['zombie', 'zombie/build-zombie.mjs']]) {
  if (only && only !== name) continue;
  console.log(`\n=== ${name} ===`);
  execFileSync(process.execPath, ['--max-old-space-size=12000', path.join(dir, script)], {stdio: 'inherit'});
}
