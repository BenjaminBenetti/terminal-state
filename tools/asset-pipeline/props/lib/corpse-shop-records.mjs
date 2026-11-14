// Task studio-corpse-market-shop-20261114-031614-01 (lane ASSET): the corpse market shop's PRIVATE generation records (read only) and
// the public bookkeeping shared by its two cooks (tools/asset-pipeline/props/build-corpse-shop-kit.mjs: the floor chute + the buyer's
// booth; tools/asset-pipeline/humans/build-corpse-buyer.mjs: the buyer himself).
//
// Reads (never modifies) the task folder kept OUTSIDE Git (reference/tasks/corpse-market-shop-20261114-031614/):
//   finance/ledger.jsonl          the single-writer finance ledger: reserve (Codex input sha256, request), posted (Meshy task id),
//                                 settle (billed credits), raw (master sha256 / bytes), accept rows per reservation
//   gen/codex/codex.jsonl         the Codex INITIAL conditioning images' result rows (sha256 / bytes)
//   gen/out/<ID>-a1.png           the Codex initial conditioning images
//   gen/raw/<ID>-<res>-<task>.glb the immutable Meshy T2.5 masters (+ <same>_textures/: Meshy's separate PBR map downloads)
// Every master / conditioning image is verified by sha256 against those rows before use (a mismatch fails the build loudly).
//
// Writes only public, hash-only records: the marked CREDITS.md section (composed from BOTH cooks' provenance files, so the section is
// identical whichever cook ran last) and each cook's own tools/release/public-inputs.json rows (+ the recomputed CREDITS.md row).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '../../../..');
export const TASK = 'studio-corpse-market-shop-20261114-031614-01';
export const TASK_DIR = 'reference/tasks/corpse-market-shop-20261114-031614';
export const PUB = path.join(ROOT, 'game/public');
export const KIT_PROV_REL = 'assets/derivatives/corpse-shop-kit-20261114.json';
export const BUYER_PROV_REL = 'assets/derivatives/market-corpse-buyer.json';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN corpse-shop-20261114 (build-corpse-shop-kit.mjs + build-corpse-buyer.mjs) -->';
const CREDITS_END = '<!-- END corpse-shop-20261114 -->';

export const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/** The private records' root: TS_REFERENCE_ROOT, else the first ancestor of the repo holding the task folder (a lane's worktree sits inside the studio checkout). */
export const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = ROOT; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) throw new Error(`private task folder ${TASK_DIR} not found above ${ROOT} (set TS_REFERENCE_ROOT)`); }
})();
const T = path.join(REF_ROOT, TASK_DIR);
/** Display path of a private file ('reference/tasks/…'; never an absolute local path). */
export const refRel = f => path.relative(REF_ROOT, f).split(path.sep).join('/');

/**
 * The three paid generations (reservation ids / Meshy task ids / master sha256 as recorded in the ledger; pinned here as well so a
 * rewritten ledger cannot silently swap a master).
 */
export const MASTERS = {
  CORPSE_BUYER: {res: 'R001', taskId: '01a1d825-e930-767a-ad6b-11cc65a6f728', sha256: '854760a34e678aa2da5425351e777ee284f8e53bf8afd2ad322b9f94617db60e'},
  CORPSE_CHUTE: {res: 'R002', taskId: '01a1d826-0dcd-7428-8cc9-24b345c650fd', sha256: '0b0458c3241547fe380adba0cc38fc213c297b9b14c814096b9cd5636552b3f8'},
  CORPSE_BOOTH: {res: 'R003', taskId: '01a1d826-3014-7351-9515-7449b2050d0e', sha256: 'cff87e745d5461a5d62297b20b95f1b5c2462e93faef46737ab3b7cda4a712e0'},
};

const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

/**
 * Verify one paid master against the private records. Returns the public (hash-only) provenance record and the master's absolute path.
 * Fails loudly on any mismatch (sha256 / bytes / missing ledger row / Codex input hash).
 */
export function verifyMaster(asset) {
  const pin = MASTERS[asset];
  if (!pin) throw new Error(`unknown asset ${asset}`);
  const ledger = readJsonl(path.join(T, 'finance/ledger.jsonl'));
  const rows = ledger.filter(r => r.res === pin.res && r.asset === asset);
  const one = ev => { const r = rows.filter(x => x.event === ev); if (r.length !== 1) throw new Error(`${asset}: ${r.length} '${ev}' ledger rows for ${pin.res} (want 1)`); return r[0]; };
  const reserve = one('reserve'), posted = one('posted'), settle = one('settle'), raw = one('raw'), accept = one('accept');
  if (posted.taskId !== pin.taskId) throw new Error(`${asset}: ledger task ${posted.taskId} != pinned ${pin.taskId}`);
  if (settle.status !== 'SUCCEEDED' || !(settle.billed > 0)) throw new Error(`${asset}: not a settled success (${settle.status}, billed ${settle.billed})`);
  if (raw.sha256 !== pin.sha256) throw new Error(`${asset}: ledger raw sha256 ${raw.sha256} != pinned ${pin.sha256}`);
  const file = path.join(T, 'gen/raw', `${asset}-${pin.res}-${pin.taskId}.glb`);
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== pin.sha256 || bytes.length !== raw.bytes) throw new Error(`${asset}: MASTER sha256 / size mismatch (${sha(bytes)} ${bytes.length} B; want ${pin.sha256} ${raw.bytes} B)`);
  // the Codex initial conditioning image: the ledger's reserve row, the Codex result row and the file itself agree
  const codexRows = readJsonl(path.join(T, 'gen/codex/codex.jsonl')).filter(r => r.phase === 'result' && r.id === asset && r.status === 'ok');
  if (codexRows.length !== 1) throw new Error(`${asset}: ${codexRows.length} ok Codex result rows (want 1)`);
  const cx = codexRows[0];
  const codexFile = path.join(T, 'gen/out', `${asset}-a${cx.attempt}.png`);
  const codexBytes = fs.readFileSync(codexFile);
  if (sha(codexBytes) !== cx.sha256 || sha(codexBytes) !== reserve.inputSha256 || codexBytes.length !== cx.bytes) throw new Error(`${asset}: Codex conditioning image sha256 mismatch`);
  // Meshy's separate PBR map downloads next to the master (hashed for the record; the cook uses the maps embedded in the master)
  const texDir = file.replace(/\.glb$/, '_textures');
  const providerMaps = fs.existsSync(texDir) ? Object.fromEntries(fs.readdirSync(texDir).sort().map(f => { const b = fs.readFileSync(path.join(texDir, f)); return [f, {bytes: b.length, sha256: sha(b)}]; })) : {};
  const {file_path: _drop, ...request} = reserve.params ?? {};
  return {
    file,
    record: {
      asset, reservation: pin.res, meshyTask: pin.taskId, tool: reserve.tool, request, creditsBilled: settle.billed,
      accepted: accept.note,
      codexInput: {file: refRel(codexFile), sha256: cx.sha256, bytes: cx.bytes, size: cx.size, attempt: cx.attempt},
      master: {file: refRel(file), sha256: pin.sha256, bytes: bytes.length},
      providerMaps: {dir: refRel(texDir), files: providerMaps},
    },
  };
}

/** Throw when a public record would carry a URL / token / local path. */
export function assertPublicSafe(text, what) {
  const hit = text.match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|Bearer |\/workspaces\/|\/home\/).{0,20}/i);
  if (hit) throw new Error(`URL / token / local path in ${what}: ...${hit[0]}...`);
}

/** The marked CREDITS.md section, composed from both cooks' provenance files (whichever exist). */
export function writeCredits() {
  const read = rel => { const f = path.join(PUB, rel); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const kit = read(KIT_PROV_REL), buyer = read(BUYER_PROV_REL);
  const items = [...(kit?.models ?? []).map(m => ({url: m.url, what: m.what, task: m.generation.meshyTask})),
    ...(buyer ? [{url: buyer.outputs.glb.path, what: buyer.what, task: buyer.generation.meshyTask}] : [])].sort((a, b) => (a.url < b.url ? -1 : 1));
  const billed = [...(kit?.models ?? []).map(m => m.generation.creditsBilled), ...(buyer ? [buyer.generation.creditsBilled] : [])];
  const section = [CREDITS_BEGIN, '## The Survivor Market\'s corpse buyer: floor chute, barred booth and the buyer', '',
    `Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (resized / re-encoded only: no reprojection, retexture or repaint). Task ${TASK} under the user's scoped credit grant (${billed.length} generations, each a first attempt, ${billed.reduce((a, b) => a + b, 0)} credits billed). The buyer is rigged and animated LOCALLY on CPU by \`tools/asset-pipeline/humans/build-corpse-buyer.mjs\` with the market humans' pipeline (the shared 18-joint skeleton measured on his body, automatic skin weights, the market humans' hand-authored procedural healthy clips; no provider rig or animation). Props cooked by \`tools/asset-pipeline/props/build-corpse-shop-kit.mjs\` (provenance: \`${KIT_PROV_REL}\`, \`${BUYER_PROV_REL}\`). AI-generated assets: provider terms apply; unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git.`, '',
    ...items.map(m => `- \`${m.url}\` — ${m.what} (Meshy task ${m.task}).`), CREDITS_END].join('\n');
  const src = fs.readFileSync(CREDITS, 'utf8');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
  fs.writeFileSync(CREDITS, re.test(src) ? src.replace(re, section) : `${src.replace(/\n*$/, '\n')}\n${section}\n`);
}

/** Add / update ONLY `paths` (public-relative) and the recomputed CREDITS.md row in tools/release/public-inputs.json. */
export function updateAllowlist(paths) {
  const raw = fs.readFileSync(ALLOW, 'utf8'), allow = JSON.parse(raw);
  if (JSON.stringify(allow, null, 2) + '\n' !== raw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
  const mine = new Set([...paths, 'assets/CREDITS.md']);
  const add = [...mine].map(p => { const b = fs.readFileSync(path.join(PUB, p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
  allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
}
