// Small dependency-free contract check, not a general YAML validator.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const workflow = fs.readFileSync(new URL('.github/workflows/game-build.yml',root),'utf8');
const pkg0 = JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8'));
const pins = {
  'actions/checkout':'3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node':'949feb2413d6458794dcd2491c4babbbce0c15c1',
  'actions/upload-artifact':'cf430e030ddbb5b0abf93d22962f4752f3646cd9',
};
const actions = [...workflow.matchAll(/^\s*uses:\s*(\S+)@(\S+)\s*$/gm)];
// (mall round 3 CI follow-up: checkout + setup-node in each of the six test shards, checks, bundle and build, + the two release uploads)
assert.equal(actions.length,20);
for (const [,name,pin] of actions) assert.equal(pin,pins[name],`Unreviewed action ${name}`);
for (const required of ['branches: [main]','workflow_dispatch:',"github.ref == 'refs/heads/main'",'contents: read',
  'persist-credentials: false',"node-version: '22.16.0'","PUPPETEER_SKIP_DOWNLOAD: 'true'",'run: npm ci',
  'run: npm run build','run: npm run ci:test','run: npm run ci:package',
  'name: terminal-state-web-${{ github.sha }}','path: artifacts/terminal-state-web/',
  'name: terminal-state-manifest-${{ github.sha }}','path: artifacts/terminal-state-web/manifest.json']) assert(workflow.includes(required),`Missing ${required}`);
assert(!/\b(?:pull_request_target|write-all|secrets\.)\b/.test(workflow),'Unexpected privileged workflow');
// Pull requests into main run the full validation before merge (required check 'build'); only main uploads release artifacts.
assert(/^on:\n  push:\n    branches: \[main\]\n(?:  #.*\n)*  pull_request:\n    branches: \[main\]\n  workflow_dispatch:\n/m.test(workflow),'Expected push(main) + pull_request(main) + workflow_dispatch triggers');
// Mall round 3 CI follow-up (user, 2026-11-01: six runners, no tests in the build step): the full Vitest suite runs as exactly SIX
// parallel shards (test-1..6) of the unchanged full-suite command; `bundle` compiles / packages in parallel with NO test execution and
// uploads the main-only release artifacts; `checks` runs this validator and ci:test; the required `build` is a lightweight aggregate
// that always runs after all of them and FAILS CLOSED — its first, unconditional step requires every result to be success (a job
// skipped by a failed `needs` would read as a passing required check), then the inventory step proves the shards ran every test file
// exactly once (tools/release/test-shards.mjs).
// PR-only tests (user, 2026-11-11: "tests run on pull requests only"): the shards and `checks` (this validator + ci:test) carry exactly
// PR_ONLY and run on pull requests, where `build` still requires every one of them to succeed and the inventory to hold before the
// merge. Runs on main (push / manual) only build, package and upload: `bundle` stays unconditional, and `build` then requires the bundle
// to succeed with the checks and every shard exactly `skipped` (a test job that ran, failed or was cancelled on main fails it).
const SHARDS = 6;
const PR_ONLY = "if: github.event_name == 'pull_request'";
const gameJobs = workflow.slice(workflow.indexOf('\njobs:\n') + 1).split(/\n(?=  [a-z][\w-]*:\n)/).slice(1);
const gameJob = id => gameJobs.find(j => j.startsWith(`  ${id}:\n`)) ?? assert.fail(`game-build.yml: missing job ${id}`);
const shardIds = Array.from({length: SHARDS}, (_, k) => `test-${k + 1}`);
assert.deepEqual(gameJobs.map(j => j.slice(2, j.indexOf(':'))),[...shardIds,'checks','bundle','build'],'game-build.yml: expected jobs test-1..6, checks, bundle, build');
assert.equal(pkg0.scripts['game:test'],'vitest run --config game/vitest.config.ts','package.json game:test must stay the full-suite command');
const common = ['persist-credentials: false',"node-version: '22.16.0'"];
for (let i = 1; i <= SHARDS; i++) {
  const t = gameJob(`test-${i}`);
  assert(new RegExp(`^  test-${i}:\\n(?:    #.*\\n)*    name: test \\(shard ${i}/${SHARDS}\\)\\n    ${PR_ONLY}\\n    runs-on: ubuntu-24\\.04\\n    timeout-minutes: 30\\n`).test(t),`test-${i}: name / pull requests only / standard runner / 30 min`);
  assert(!/^\s*needs:/m.test(t) && (t.match(/^\s*if:/gm) ?? []).length === 1,`test-${i}: no dependency and no condition but the pull-request one (every shard runs on every pull request)`);
  for (const required of [...common,"PUPPETEER_SKIP_DOWNLOAD: 'true'",'      - run: npm ci\n',
    `      - run: npm run game:test -- --shard=${i}/${SHARDS} --maxWorkers=1 --reporter=default --reporter=json --outputFile.json="$RUNNER_TEMP/vitest-shard.json"\n`,
    `      - id: shard\n        run: node tools/release/test-shards.mjs verify ${i} ${SHARDS} "$RUNNER_TEMP/vitest-shard.json"\n`,
    '      files: ${{ steps.shard.outputs.files }}\n','      tests: ${{ steps.shard.outputs.tests }}\n',
    '      skipped: ${{ steps.shard.outputs.skipped }}\n','      skippedFiles: ${{ steps.shard.outputs.skippedFiles }}\n']) assert(t.includes(required),`test-${i}: missing ${required.trim()}`);
}
const stepsOf = job => job.split(/\n      - /).slice(1);
const checksJob = gameJob('checks');
assert(new RegExp(`^  checks:\\n(?:    #.*\\n)*    name: checks\\n    ${PR_ONLY}\\n    runs-on: ubuntu-24\\.04\\n    timeout-minutes: 30\\n`).test(checksJob)
  && !/^\s*needs:/m.test(checksJob) && (checksJob.match(/^\s*if:/gm) ?? []).length === 1,'checks: pull requests only, standard runner, 30 min');
assert.deepEqual(stepsOf(checksJob).map(x => x.trim()).slice(2),['run: npm ci','run: npm run ci:check','run: npm run ci:test'],'checks: npm ci -> ci:check -> ci:test');
const bundle = gameJob('bundle');
assert(/^  bundle:\n(?:    #.*\n)*    name: bundle\n    runs-on: ubuntu-24\.04\n    timeout-minutes: 30\n/.test(bundle) && !/^\s*needs:/m.test(bundle) && !/^    if:/m.test(bundle),
  'bundle: no needs (parallel with the tests) and no job condition (builds / packages for every trigger), standard runner, 30 min');
const bundleSteps = stepsOf(bundle);
assert.deepEqual(bundleSteps.slice(2,5).map(x => x.trim()),['run: npm ci','run: npm run build','run: npm run ci:package'],'bundle: npm ci -> build -> ci:package');
assert(!/vitest|game:test|npm test|ci:test|test-shards/.test(bundle),'bundle: no test execution in the compile / package job');
const uploads = bundleSteps.filter(st => /uses:\s*actions\/upload-artifact@/.test(st));
assert.equal(uploads.length,2);
for (const st of uploads) assert(/\n        if: github\.ref == 'refs\/heads\/main'\n/.test(st),'Release artifact uploads must be limited to main');
assert.equal(bundleSteps.length,7,'bundle: checkout, setup-node, npm ci, build, ci:package, two uploads');
const build = gameJob('build');
const needIds = ['bundle','checks',...shardIds];
assert(new RegExp(`^  build:\\n(?:    #.*\\n)*    name: build\\n    needs: \\[${needIds.join(', ')}\\]\\n    if: \\$\\{\\{ always\\(\\) \\}\\}\\n    runs-on: ubuntu-24\\.04\\n    timeout-minutes: 30\\n    steps:\\n`).test(build),
  'The required job must be named build, need the bundle, the checks and all six shards, and always run (fail-closed aggregate)');
const steps = stepsOf(build);
assert.equal(steps.length,4,'build: gate, checkout, setup-node, inventory only (lightweight aggregate)');
// The gate's two branches, each fail-closed: a pull request needs every job `success`; any other event (main push / manual run) needs
// the bundle `success` and every test job exactly `skipped`.
const gateIf = (expected, msg) => `[ "$RESULTS" = '${expected.join(' ')}' ] || { echo "::error::${msg} (got: $RESULTS)"; exit 1; }`;
assert(steps[0] === `name: Require the bundle, the checks and every test shard
        env:
          EVENT: \${{ github.event_name }}
          RESULTS: ${needIds.map(j => `\${{ needs.${j}.result }}`).join(' ')}
        run: |
          echo "$EVENT: bundle checks test-1..6: $RESULTS"
          if [ "$EVENT" = 'pull_request' ]; then
            ${gateIf(needIds.map(() => 'success'),'the bundle, the checks and every test shard must succeed')}
          else
            ${gateIf(needIds.map(j => j === 'bundle' ? 'success' : 'skipped'),'$EVENT runs build and package only: the bundle must succeed with the checks and every test shard skipped')}
          fi`,
  'build: the unconditional first step must require every job to succeed on a pull request, and the bundle to succeed with the tests skipped otherwise');
const inv = steps[3];
assert(inv.startsWith(`name: Prove the shards ran the whole test inventory\n        ${PR_ONLY}\n        env:\n`),'build: the last step is the pull-request inventory proof');
for (let i = 1; i <= SHARDS; i++) for (const [k,o] of [['FILES','files'],['TESTS','tests'],['SKIPPED','skipped'],['SKIPPED_FILES','skippedFiles']])
  assert(inv.includes(`          SHARD_${i}_${k}: \${{ needs.test-${i}.outputs.${o} }}\n`),`build: inventory step lacks SHARD_${i}_${k}`);
assert(inv.includes(`\n        run: node tools/release/test-shards.mjs inventory ${SHARDS}`) && (inv.match(/\n\s*if:/g) ?? []).length === 1,`build: inventory ${SHARDS} on every pull request`);
assert(!/npm (?:ci|test|run)|vitest/.test(build),'build: aggregate only (no install / build / tests)');
assert(!/\brun: npm test\b/.test(workflow),'game-build.yml: the suite runs only in the shards');
// Every condition in the workflow: the six shards, checks and the inventory proof are pull-request only; build's always() gate and the
// two main-only uploads. Nothing else is conditional (bundle and the gate always run).
assert.deepEqual((workflow.match(/^\s*if:.*$/gm) ?? []).map(l => l.trim()).sort(),
  [...Array(SHARDS + 2).fill(PR_ONLY),'if: ${{ always() }}',"if: github.ref == 'refs/heads/main'","if: github.ref == 'refs/heads/main'"].sort(),
  "game-build.yml: only the tests (shards, checks, inventory) are pull-request only, plus build's always() gate and the two main-only uploads");
assert.deepEqual([...workflow.matchAll(/^\s*timeout-minutes:\s*(\d+)\s*$/gm)].map(m => m[1]),Array(SHARDS + 3).fill('30'),'game-build.yml: every job keeps the 30 min cap');
const pkg=JSON.parse(fs.readFileSync(new URL('package.json',root),'utf8'));
assert.equal(pkg.name,'terminal-state');
for(const alias of ['dev','build','preview']) assert.equal(pkg.scripts[alias],`npm run game:${alias}`);
assert.equal(pkg.scripts.test,'npm run game:test');
// Task track3-eaton-centre-20261031 (lane PACKAGE): the required `build` check (npm run ci:test) runs the packager tests AND the
// dynamic-app wrapper tests (tools/deploy/dynamic-app: server, site verification, staging, Dockerfile contract).
// (mall round 3 CI follow-up: + the test-shard proof's unit tests)
for (const t of ['tools/release/package-ci.test.mjs','tools/deploy/dynamic-app/dynamic-app.test.mjs','tools/release/test-shards.test.mjs'])
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
// Production is separate: a SemVer tag selects a successful main CI artifact;
// no privileged PR trigger, rebuild or third-party SSH action.
const prod = fs.readFileSync(new URL('.github/workflows/deploy-prod.yml', root), 'utf8');
const prodActions = [...prod.matchAll(/^\s*(?:- )?uses:\s*(\S+)@(\S+)\s*$/gm)];
assert.equal(prodActions.length, 2);
for (const [, name, pin] of prodActions) assert.equal(pin, pins[name], `deploy-prod.yml: unreviewed action ${name}`);
for (const required of ["tags: ['v*']", 'contents: read', 'actions: read', 'name: prod',
  'group: terminal-state-prod', 'cancel-in-progress: false', 'persist-credentials: false', 'fetch-depth: 0',
  "node-version: '22.16.0'", 'git merge-base --is-ancestor HEAD origin/main',
  'node tools/deploy/gcp/release.mjs validate', 'node tools/deploy/gcp/release.mjs fetch',
  'node tools/deploy/gcp/release.mjs prepare', 'vars.AUTO_CUTOFF_GB', 'vars.DEPLOY_KNOWN_HOSTS',
  'secrets.DEPLOY_KEY', 'bash tools/deploy/gcp/ssh-deploy.sh']) assert(prod.includes(required), `deploy-prod.yml: missing ${required}`);
assert(!/pull_request|workflow_dispatch|:\s*write|npm (?:ci|run build)/.test(prod), 'prod: tag-only, read-only artifact consumer');
assert(pkg.scripts['ci:test'].includes('tools/deploy/gcp/release.test.mjs')
  && pkg.scripts['ci:test'].includes('python3 tools/deploy/gcp/test_bandwidth.py'), 'ci:test must include deployment tests');
console.log('Pinned workflows (game build, reference site, production deploy) and portable npm aliases verified.');
