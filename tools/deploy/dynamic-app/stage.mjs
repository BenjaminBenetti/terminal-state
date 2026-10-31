// Task track3-eaton-centre-20261031 (lane PACKAGE): Main's staging step for the dynamic Docker app (CONTRACT.md). It turns an
// OFFICIAL, already downloaded CI artifact (`terminal-state-web-<sha>`: site/ + manifest.json) plus THIS wrapper source at
// the SAME commit into a Docker build context. Zero dependencies. It builds nothing, runs no Docker and deploys nothing.
//
//   node tools/deploy/dynamic-app/stage.mjs --commit <40-hex merged-main sha> --artifact <extracted artifact dir> \
//     [--manifest-artifact <extracted terminal-state-manifest-<sha>/manifest.json>] --out <new directory>
//
// Refuses unless: the manifest is valid and its commit is --commit; every site file matches its size AND sha256 with no
// extra / missing / symlinked file; the separately downloaded manifest (when given) is byte-identical; the repository
// checkout is AT --commit and the wrapper directory has no uncommitted change; --out does not exist yet.

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {COMMIT, WRAPPER_FILES, WRAPPER_SCHEMA, readManifest, sha256File, verifySite} from './site-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fail = m => { throw new Error(m); };

/** The wrapper source must be the committed source of `commit` (git checkout at that commit, wrapper dir unmodified). */
export function gitSourceCheck(commit, wrapperDir = HERE) {
  const git = (...a) => execFileSync('git', ['-C', wrapperDir, ...a], {encoding: 'utf8'}).trim();
  const head = git('rev-parse', 'HEAD');
  if (head !== commit) fail(`Wrapper checkout is at ${head}, not the artifact commit ${commit}`);
  const dirty = git('status', '--porcelain', '--untracked-files=all', '--', '.');
  if (dirty) fail(`Wrapper source has uncommitted changes:\n${dirty}`);
}

export function stage({commit, artifact, manifestArtifact = null, out, wrapperDir = HERE, sourceCheck = gitSourceCheck}) {
  if (!COMMIT.test(commit ?? '')) fail('--commit must be the full 40-hex merged-main commit');
  if (!artifact || !out) fail('--artifact and --out are required');
  if (fs.existsSync(out)) fail(`Output already exists: ${out}; stage into a new directory`);
  const manifestPath = path.join(artifact, 'manifest.json'), siteDir = path.join(artifact, 'site');
  const top = fs.readdirSync(artifact).sort();
  if (JSON.stringify(top) !== JSON.stringify(['manifest.json', 'site'])) fail(`Artifact must contain exactly manifest.json and site/ (found: ${top.join(', ')})`);
  const manifest = readManifest(manifestPath);
  if (manifestArtifact && !fs.readFileSync(manifestArtifact).equals(fs.readFileSync(manifestPath))) fail('The separate manifest artifact differs from the site artifact manifest');
  const verified = verifySite(siteDir, manifest, {hashes: true, expectedCommit: commit});
  sourceCheck(commit, wrapperDir);

  fs.mkdirSync(out, {recursive: false});
  for (const f of WRAPPER_FILES) fs.copyFileSync(path.join(wrapperDir, f), path.join(out, f));
  fs.copyFileSync(manifestPath, path.join(out, 'manifest.json'));
  fs.cpSync(siteDir, path.join(out, 'site'), {recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true});
  verifySite(path.join(out, 'site'), manifest, {expectedCommit: commit}); // copy complete (sizes); the image build re-hashes
  const record = {schema: WRAPPER_SCHEMA, commit, files: WRAPPER_FILES.map(f => ({path: f, sha256: sha256File(path.join(out, f))})),
    artifact: {fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, manifestSha256: manifest.sha256}};
  fs.writeFileSync(path.join(out, 'wrapper-source.json'), `${JSON.stringify(record, null, 2)}\n`);
  readableTree(out); // the image's uid 1000 must read root-owned copies whatever umask the download / staging used
  return {commit, out, files: verified.files, bytes: verified.bytes, manifestSha256: manifest.sha256};
}

/** Files 0644, directories 0755 (contents unchanged; nothing writable by group / others). */
function readableTree(dir) {
  fs.chmodSync(dir, 0o755);
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name), st = fs.lstatSync(f);
    if (st.isSymbolicLink()) fail(`Symlink in staged context: ${f}`);
    if (st.isDirectory()) readableTree(f); else fs.chmodSync(f, 0o644);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = {};
  for (let a = process.argv.slice(2), i = 0; i < a.length; i += 2) {
    if (!a[i].startsWith('--') || a[i + 1] === undefined) { console.error(`Unexpected argument: ${a[i]}`); process.exit(2); }
    o[a[i].slice(2)] = a[i + 1];
  }
  try {
    const r = stage({commit: o.commit, artifact: o.artifact && path.resolve(o.artifact), manifestArtifact: o['manifest-artifact'] && path.resolve(o['manifest-artifact']), out: o.out && path.resolve(o.out)});
    console.log(`Staged official site ${r.commit}: ${r.files} files / ${r.bytes} bytes (manifest sha256 ${r.manifestSha256}) -> ${r.out}`);
    console.log(`Next (Main only): docker build --build-arg SOURCE_COMMIT=${r.commit} -t terminal-state-dynamic:${r.commit} ${r.out}`);
  } catch (err) {
    console.error(`Staging FAILED: ${err.message}`);
    process.exit(1);
  }
}
