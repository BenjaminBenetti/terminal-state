// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): read-only source records for the friendly market humans.
//
// The private raw masters live under the studio's external `reference/` mount (never in Git / game/public):
//   reference/tasks/survivor-market-20261108-005807/meshy/raw/human-<id>-a1.glb  (five Meshy T2.5 image-to-3D bases, PAID, A-pose)
//   reference/tasks/meshy-game-replacement-20261029/assets/                    (the zombie wardrobe's accepted T2.5 garment / body
//                                                                                deliveries: the canonical garment body + the wearables)
// A git worktree has no `reference/` of its own: the root is the checkout's own `reference/` when present, else the MAIN checkout's
// (the parent of the shared git directory), else LL_REFERENCE. Every source is pinned by sha256 (a differing file fails the build).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {REPO} from '../../zombie/lib/master.mjs';

export const HUMANS_TASK = 'studio-survivor-market-20261108-005807-01';

let refRoot = null;
/** Absolute path of the external reference/ mount (see the header). */
export function referenceRoot() {
  if (refRoot) return refRoot;
  const cands = [process.env.LL_REFERENCE, path.join(REPO, 'reference')];
  try {
    const common = execFileSync('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
    cands.push(path.join(path.dirname(common), 'reference'));
  } catch { /* not a git checkout */ }
  refRoot = cands.find(c => c && fs.existsSync(path.join(c, 'tasks'))) ?? null;
  if (!refRoot) throw new Error('reference/ mount not found (set LL_REFERENCE): the private raw masters are needed to build');
  return refRoot;
}

/** Display path of a reference file ('reference/…', as in the zombie manifests). */
export const refRel = f => path.join('reference', path.relative(referenceRoot(), f));

export const MARKET_TASK_DIR = () => path.join(referenceRoot(), 'tasks/survivor-market-20261108-005807');

/** The five paid Meshy T2.5 human bases (meshy/LEDGER.jsonl: task ids / price; concepts/CONCEPT-LEDGER.jsonl: the Codex inputs). */
export const HUMAN_MASTERS = {
  m1: {taskId: '01a1b8b4-b5f9-7557-8d34-46b237f67db9', sha256: '15ac73a251a39bfd1455f8a759d22d49a9db04bc941c035c423272b27f518a08', concept: '7e590ab9e2f8b2c9a5dfc48cf7e88fe78c353cd19fecd532067c757609566295'},
  f1: {taskId: '01a1b8b4-d832-7092-8f22-9307dc91f50e', sha256: '03d25a83aa34a88f6d7ec4207c2957f007e067d89356d7d229374138ab690fb3', concept: '1866b5773abc37a284910bf9111476c251237bfec2be5874baacd64b8077e1fd'},
  m2: {taskId: '01a1b8b4-e954-74e4-a594-b815ae92c032', sha256: '397079b54c637963ad54333ff88314a477d84e68eb0da99a3df7e018b547bfc7', concept: '97c3d3306b106ded78414e550c7724d72f860e6328395783283eb580a87e50b9'},
  f2: {taskId: '01a1b8b5-0660-77f7-8b7a-2a36269cc294', sha256: 'd0e1d8264473547e98b80b581fbf001361fbb5b83d23a41dfe043a67290251e7', concept: '9f7927bec99cec57248784b4811728432e30a03fa0ef2bdd281eede37f39fa6b'},
  m3: {taskId: '01a1b8b5-1704-72f6-80b9-8887c45d933f', sha256: '296078cc0fbfa2336274f7bde30cbd72408f28dd1754e8223ea1609fe0b99c34', concept: 'fcc3828d50b6834157ffe5e28289706efb8d377b98b0a43244f85adad78cca62'},
};

/** loadSource-compatible record of one human base (+ provenance for the manifest). */
export function humanSource(id) {
  const m = HUMAN_MASTERS[id];
  if (!m) throw new Error('unknown human base ' + id);
  const dir = MARKET_TASK_DIR();
  const file = path.join(dir, `meshy/raw/human-${id}-a1.glb`);
  if (!fs.existsSync(file)) throw new Error(`human base ${id}: ${file} missing`);
  return {id: 'human:' + id, file, sha256: m.sha256, displayName: `human-${id}-a1`,
    meshy: {asset: 'human:' + id, attempt: 'a1', taskId: m.taskId, provider: 'Meshy meshy_image_to_3d (ai_model meshy-t2.5, model_type smart-topology, pose_mode a-pose, 2K PBR textures, target 20k triangles)',
      ledger: refRel(path.join(dir, 'meshy/LEDGER.jsonl')), raw: refRel(file), inputImage: refRel(path.join(dir, `concepts/${id}-a1.png`)), inputImageSha256: m.concept,
      conceptLedger: refRel(path.join(dir, 'concepts/CONCEPT-LEDGER.jsonl')), conceptProvider: 'Codex native image generation (initial concept, approved in the task)'}};
}

// ---- the zombie wardrobe's T2.5 deliveries (canonical garment body + the ordinary wearables), resolved like zombie/lib/t25.mjs
const T25_ASSETS = () => path.join(referenceRoot(), 'tasks/meshy-game-replacement-20261029/assets');
let delivered = null;

/**
 * t25Source (zombie/lib/t25.mjs) against the resolved reference root: the same record shape (`t25` set, so loadAnySource densifies
 * it; the same sha256 / densify fraction / lid trim, so the zombie build's stage-cache keys apply unchanged).
 */
export function wardrobeT25Source(pin, densifyFrac, extra = {}) {
  delivered ??= JSON.parse(fs.readFileSync(path.join(T25_ASSETS(), 'DELIVERED.json'), 'utf8'));
  const d = delivered.assets?.[pin.asset];
  if (!d || d.status !== 'SUCCEEDED' || d.review !== 'accepted') throw new Error(`${pin.asset}: not an accepted T2.5 delivery`);
  if (pin.attempt && d.attempt !== pin.attempt) throw new Error(`${pin.asset}: delivered attempt ${d.attempt} != pinned ${pin.attempt}`);
  if (d.sha256 !== pin.sha256) throw new Error(`${pin.asset}: delivered sha256 ${d.sha256} != pinned ${pin.sha256}`);
  const file = path.join(T25_ASSETS(), d.nativeGlb);
  if (!fs.existsSync(file)) throw new Error(`${pin.asset}: ${file} missing`);
  // the original reference image (the zombie colour-grade policy reads it): DELIVERED.json records studio-absolute paths
  return {id: pin.asset, file, sha256: d.sha256, densifyFrac, ...extra, inputPng: d.inputImage, inputPngSha256: d.inputImageSha256, jobId: d.taskId, displayName: pin.asset,
    t25: {asset: pin.asset, attempt: d.attempt, taskId: d.taskId, nativeGlb: refRel(file), nativeSha256: d.sha256, inputImage: mapRef(d.inputImage), review: d.review}};
}

/** A studio-absolute reference path -> the same file under the resolved root (null when absent). */
function mapRef(f) {
  if (!f) return null;
  if (fs.existsSync(f)) return f;
  const i = f.indexOf('/reference/');
  const g = i >= 0 ? path.join(referenceRoot(), f.slice(i + '/reference/'.length)) : null;
  return g && fs.existsSync(g) ? g : null;
}
