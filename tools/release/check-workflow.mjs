// Small dependency-free contract check, not a general YAML validator.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const workflow = fs.readFileSync(new URL('.github/workflows/game-build.yml',root),'utf8');
const pins = {
  'actions/checkout':'3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node':'949feb2413d6458794dcd2491c4babbbce0c15c1',
  'actions/upload-artifact':'cf430e030ddbb5b0abf93d22962f4752f3646cd9',
};
const actions = [...workflow.matchAll(/^\s*uses:\s*(\S+)@(\S+)\s*$/gm)];
assert.equal(actions.length,4);
for (const [,name,pin] of actions) assert.equal(pin,pins[name],`Unreviewed action ${name}`);
for (const required of ['branches: [main]','workflow_dispatch:',"github.ref == 'refs/heads/main'",'contents: read',
  'persist-credentials: false',"node-version: '22.16.0'","PUPPETEER_SKIP_DOWNLOAD: 'true'",'run: npm ci',
  'run: npm run build','run: npm test','run: npm run ci:test','run: npm run ci:package',
  'name: terminal-state-web-${{ github.sha }}','path: artifacts/terminal-state-web/',
  'name: terminal-state-manifest-${{ github.sha }}','path: artifacts/terminal-state-web/manifest.json']) assert(workflow.includes(required),`Missing ${required}`);
assert(!/\b(?:pull_request_target|write-all|secrets\.)\b/.test(workflow),'Unexpected privileged workflow');
const pkg=JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8'));
assert.equal(pkg.name,'terminal-state');
for(const alias of ['dev','build','preview']) assert.equal(pkg.scripts[alias],`npm run game:${alias}`);
assert.equal(pkg.scripts.test,'npm run game:test');
console.log('Pinned workflow and portable npm aliases verified.');
