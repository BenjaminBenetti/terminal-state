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
// Pull requests into main run the full validation before merge (required check 'build'); only main uploads release artifacts.
assert(/^on:\n  push:\n    branches: \[main\]\n(?:  #.*\n)*  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n/m.test(workflow),'Expected push(main) + pull_request(main) + workflow_dispatch triggers');
assert(/^  build:\n(?:    #.*\n)*    name: build\n    runs-on:/m.test(workflow),'The validation job must be named build with no job-level condition');
const steps = workflow.split(/\n      - /).slice(1);
const uploads = steps.filter(st => /uses:\s*actions\/upload-artifact@/.test(st));
assert.equal(uploads.length,2);
for (const st of uploads) assert(/\n        if: github\.ref == 'refs\/heads\/main'\n/.test(st),'Release artifact uploads must be limited to main');
assert.equal((workflow.match(/^\s*if:/gm) ?? []).length,2,'Only the two upload steps may be conditional (validation always runs)');
const pkg=JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8'));
assert.equal(pkg.name,'terminal-state');
for(const alias of ['dev','build','preview']) assert.equal(pkg.scripts[alias],`npm run game:${alias}`);
assert.equal(pkg.scripts.test,'npm run game:test');
// Task track3-eaton-centre-20261031 (lane PACKAGE): the required `build` check (npm run ci:test) runs the packager tests AND the
// dynamic-app wrapper tests (tools/deploy/dynamic-app: server, site verification, staging, Dockerfile contract).
for (const t of ['tools/release/package-ci.test.mjs','tools/deploy/dynamic-app/dynamic-app.test.mjs'])
  assert((pkg.scripts['ci:test'] ?? '').split(/\s+/).includes(t),`package.json ci:test must run ${t}`);

// Task loot-reference-pages-20261030 (lane SITE): the separate reference-site workflow (pages.yml). It reuses the reviewed
// checkout / setup-node pins plus the three official Pages actions; validation for every trigger, deployment only from main.
const pages = fs.readFileSync(new URL('.github/workflows/pages.yml',root),'utf8');
const pagesPins = {
  'actions/checkout':pins['actions/checkout'],
  'actions/setup-node':pins['actions/setup-node'],
  'actions/upload-pages-artifact':'fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/configure-pages':'45bfe0192ca1faeb007ade9deae92b16b8254a0d',
  'actions/deploy-pages':'368f82528645a54fb793d4d04e342629a3f51346',
};
const pagesActions = [...pages.matchAll(/^\s*uses:\s*(\S+)@(\S+)\s*$/gm)];
assert.equal(pagesActions.length,5,'pages.yml: unexpected number of actions');
for (const [,name,pin] of pagesActions) assert.equal(pin,pagesPins[name],`pages.yml: unreviewed action ${name}`);
// Every pin used anywhere is recorded in docs/ci-action-pins.json.
const pinRecord = JSON.parse(fs.readFileSync(new URL('docs/ci-action-pins.json',root),'utf8'));
for (const [name,commit] of Object.entries({...pins,...pagesPins})) {
  assert(pinRecord.pins.some(p => p.action === name && p.commit === commit && p.gitLsRemote?.startsWith(`${commit}\trefs/tags/`)),
    `docs/ci-action-pins.json lacks ${name}@${commit}`);
}
assert(!/\b(?:pull_request_target|write-all|secrets\.)|contents:\s*write/.test(pages),'pages.yml: unexpected privileged workflow');
assert(/^on:\n  push:\n    branches: \[main\]\n(?:  #.*\n)*  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n/m.test(pages),
  'pages.yml: expected push(main) + pull_request(main) + workflow_dispatch triggers');
assert(/\npermissions:\n  contents: read\n\njobs:\n/.test(pages),'pages.yml: top-level permissions must be contents: read only');
assert(!/^  build:|^\s*name: build\s*$/m.test(pages),'pages.yml: the job name build is reserved for the required game check');
const jobs = pages.slice(pages.indexOf('\njobs:\n') + 1).split(/\n(?=  [a-z][\w-]*:\n)/).slice(1);
const job = id => jobs.find(j => j.startsWith(`  ${id}:\n`)) ?? assert.fail(`pages.yml: missing job ${id}`);
const mainOnly = "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
const buildJob = job('pages-build'), deployJob = job('pages-deploy');
assert.equal(jobs.length,2,'pages.yml: expected exactly the pages-build and pages-deploy jobs');
assert(/^  pages-build:\n(?:    #.*\n)*    name: pages-build\n    runs-on:/.test(buildJob),'pages.yml: pages-build must run unconditionally');
assert(!/\b(?:pages|id-token):\s*write|environment:/.test(buildJob),'pages.yml: pages-build must stay read-only');
for (const required of ['persist-credentials: false',"node-version: '22.16.0'","PUPPETEER_SKIP_DOWNLOAD: 'true'",'run: npm ci',
  'run: npm run pages:build','run: npm run pages:check','run: npm run pages:test','path: dist/pages/']) assert(buildJob.includes(required),`pages.yml: missing ${required}`);
const upload = buildJob.split(/\n      - /).find(st => /uses:\s*actions\/upload-pages-artifact@/.test(st));
assert(upload?.includes(`\n        if: ${mainOnly}\n`),'pages.yml: the Pages artifact upload must be limited to main');
assert.equal((buildJob.match(/^\s*if:/gm) ?? []).length,1,'pages.yml: only the upload step of pages-build may be conditional');
for (const required of ['    needs: pages-build\n',`    if: ${mainOnly}\n`,'    permissions:\n      contents: read\n      pages: write\n      id-token: write\n',
  '    environment:\n      name: github-pages\n      url: ${{ steps.deployment.outputs.page_url }}\n',
  '    concurrency:\n      group: pages-deploy\n      cancel-in-progress: false\n',
  'GH_TOKEN: ${{ github.token }}','git/ref/heads/main','SHA: ${{ github.sha }}','id: deployment']) assert(deployJob.includes(required),`pages.yml: pages-deploy lacks ${required.trim()}`);
for (const st of deployJob.split(/\n      - /).slice(2)) assert(st.includes("\n        if: steps.newest.outputs.deploy == 'true'\n"),'pages.yml: Pages steps must sit behind the newest-commit guard');
assert(!pages.includes('dist/game'),'pages.yml must not publish the game build');
for (const [script,cmd] of Object.entries({'pages:build':'node tools/pages/run.mjs build','pages:check':'node tools/pages/run.mjs check'})) {
  assert.equal(pkg.scripts[script],cmd,`package.json ${script}`);
}
assert(/^vitest run --config game\/vitest\.config\.ts .*tests\/pages-output\.test\.ts.*tests\/loot-reference\.test\.ts/.test(pkg.scripts['pages:test'] ?? ''),'package.json pages:test');
console.log('Pinned workflows (game build + reference site) and portable npm aliases verified.');
