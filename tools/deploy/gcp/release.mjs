// Download only a successful main workflow's artifact. Never rebuild for deployment.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
import {readManifest, verifySite, sha256File, safeSitePath} from '../dynamic-app/site-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEMVER = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const fail = message => { throw new Error(message); };
export function settings(env) {
  if (!SEMVER.test(env.RELEASE_TAG ?? '')) fail('Use a SemVer tag: v1.2.3 (optional prerelease/build identifiers)');
  for (const key of ['DEPLOY_HOST', 'PUBLIC_DOMAIN']) {
    if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(env[key] ?? '') || env[key].includes('..')) fail(`Invalid ${key}`);
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(env.DEPLOY_USER ?? '')) fail('Invalid DEPLOY_USER');
  if (!/^\d+$/.test(env.DEPLOY_PORT ?? '') || Number(env.DEPLOY_PORT) < 1 || Number(env.DEPLOY_PORT) > 65535) fail('Invalid DEPLOY_PORT');
  // Decimal GB, never zero/unlimited. A missing environment variable must fail closed.
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(env.AUTO_CUTOFF_GB ?? '')) fail('AUTO_CUTOFF_GB must be a positive decimal number');
  const capBytes = Math.round(Number(env.AUTO_CUTOFF_GB) * 1e9);
  if (!Number.isSafeInteger(capBytes) || capBytes < 1e6) fail('AUTO_CUTOFF_GB must be at least 0.001 and fit a safe byte count');
  if (env.ACME_EMAIL && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(env.ACME_EMAIL)) fail('Invalid ACME_EMAIL');
  return {tag: env.RELEASE_TAG, domain: env.PUBLIC_DOMAIN, cap_bytes: capBytes, acme_email: env.ACME_EMAIL || ''};
}

export function successfulRun(runs, commit) {
  return runs.find(r => r.headSha === commit && r.headBranch === 'main' && r.status === 'completed'
    && r.conclusion === 'success' && ['push', 'workflow_dispatch'].includes(r.event));
}

async function fetchArtifact(env) {
  const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  if (!/^[a-f0-9]{40}$/.test(env.SOURCE_COMMIT ?? '')) fail('Missing SOURCE_COMMIT');
  // Tags may be pushed while main CI is running. Wait for its aggregate build check.
  for (let attempt = 0; attempt < 150; attempt++) {
    const runs = JSON.parse(gh('run', 'list', '--repo', env.GITHUB_REPOSITORY, '--workflow', 'game-build.yml',
      '--branch', 'main', '--commit', env.SOURCE_COMMIT, '--limit', '100',
      '--json', 'databaseId,headSha,headBranch,status,conclusion,event'));
    const run = successfulRun(runs, env.SOURCE_COMMIT);
    if (run) {
      gh('run', 'download', String(run.databaseId), '--repo', env.GITHUB_REPOSITORY,
        '--name', `terminal-state-web-${env.SOURCE_COMMIT}`, '--dir', 'artifacts/vm-input');
      console.log(`Downloaded successful main CI run ${run.databaseId} for ${env.SOURCE_COMMIT}`);
      return;
    }
    if (runs.length && runs.every(r => r.status === 'completed')) fail('Main CI did not succeed; deployment refused');
    if (attempt % 6 === 0) console.log('Waiting for successful main CI at the tagged commit…');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  fail('No successful main CI artifact after 25 minutes. Re-run this deployment after main CI succeeds.');
}

export function prepare({artifact, out, commit, config, quality = 11}) {
  if (fs.existsSync(out)) fail('Output already exists');
  if (JSON.stringify(fs.readdirSync(artifact).sort()) !== JSON.stringify(['manifest.json', 'site'])) fail('Unexpected artifact contents');
  const manifest = readManifest(path.join(artifact, 'manifest.json'));
  verifySite(path.join(artifact, 'site'), manifest, {hashes: true, expectedCommit: commit});
  fs.mkdirSync(out, {recursive: true});
  fs.cpSync(path.join(artifact, 'site'), path.join(out, 'site'), {recursive: true});
  fs.copyFileSync(path.join(artifact, 'manifest.json'), path.join(out, 'manifest.json'));
  let brBytes = 0, identityBytes = 0;
  for (const [rel] of manifest.files) {
    const file = path.join(out, 'site', rel), raw = fs.readFileSync(file);
    identityBytes += raw.length;
    let brSize = raw.length;
    // GLBs contain compressible geometry; JPEG/MP3/etc are already compressed.
    if (/\.(?:html|js|css|json|svg|txt|md|glb|gltf|bin|wasm)$/.test(rel) && raw.length > 256) {
      const br = zlib.brotliCompressSync(raw, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: quality}});
      const gz = zlib.gzipSync(raw, {level: 9});
      if (!zlib.brotliDecompressSync(br).equals(raw) || !zlib.gunzipSync(gz).equals(raw)) fail(`Compression mismatch: ${rel}`);
      for (const [suffix, buffer] of [['.br', br], ['.gz', gz]]) if (buffer.length < raw.length) {
        if (fs.existsSync(file + suffix)) fail(`Sidecar collision: ${rel}`);
        fs.writeFileSync(file + suffix, buffer);
      }
      brSize = Math.min(raw.length, br.length);
    }
    brBytes += brSize;
  }
  const deployment = {...config, commit, schema: 'terminal-state-vm-v1', files: []};
  const walk = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix + name, file = path.join(dir, name), st = fs.lstatSync(file);
      if (st.isDirectory()) walk(file, `${rel}/`);
      else {
        if (!st.isFile() || !safeSitePath(rel)) fail(`Unsafe staged file: ${rel}`);
        deployment.files.push({path: rel, bytes: st.size, sha256: sha256File(file)});
      }
    }
  };
  walk(path.join(out, 'site'));
  fs.writeFileSync(path.join(out, 'deploy.json'), JSON.stringify(deployment, null, 2) + '\n');
  // The VM re-verifies both the original manifest and the compressed representation hashes.
  for (const file of ['install.sh', 'bandwidth.py', 'bandwidth.service', 'nginx.conf', 'verify.py', 'cutoff.html']) {
    fs.copyFileSync(path.join(HERE, file), path.join(out, file));
  }
  console.log(`Verified ${manifest.fileCount} original files; identity ${identityBytes} B, Brotli-capable transfer ${brBytes} B (${((1 - brBytes / identityBytes) * 100).toFixed(1)}% smaller).`);
  return deployment;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2], env = process.env;
    if (command === 'validate') settings(env);
    else if (command === 'fetch') await fetchArtifact(env);
    else if (command === 'prepare') prepare({artifact: 'artifacts/vm-input', out: 'artifacts/vm-release', commit: env.SOURCE_COMMIT, config: settings(env)});
    else fail('Expected validate, fetch or prepare');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
