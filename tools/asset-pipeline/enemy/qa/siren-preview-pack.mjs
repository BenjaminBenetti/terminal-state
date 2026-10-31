#!/usr/bin/env node
// Task studio-siren-clothing-refit-20261031-01 (lane PREVIEW): assembles the private human-review preview pack from the renders of
// siren-preview.mjs: preview/index.html (static, relative URLs, no remote dependency / telemetry / secret; strict CSP; no autoplay:
// a JS frame-stepper with play / pause / step / scrub over the same frames; the animated WebP files are links) and
// preview/manifest.json (every file: path, MIME, bytes, width / height, fps / duration, clip / time / view / light / backend, role).
//
// usage: node tools/asset-pipeline/enemy/qa/siren-preview-pack.mjs --preview <dir> --meta <dir> --input <pack-input.json>
//   pack-input.json (written by lane PREVIEW from FIT.done / the primary): task, branch, candidate {asset, sha256, bytes, gitSha},
//   baseline {...}, sources [...], fitSummary [...], fitChecks {...}, worst {...}, limitations [...], licence [...], notes [...].
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
if (!args.preview || !args.meta || !args.input) throw new Error('usage: --preview <dir> --meta <dir> --input <pack-input.json>');
const PREV = path.resolve(args.preview), META = path.resolve(args.meta);
const input = JSON.parse(fs.readFileSync(args.input, 'utf8'));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript'};

// ------------------------------------------------------------------------------------------------ meta records (by preview path)
const metaFiles = fs.readdirSync(META).filter(f => f.endsWith('.json') && !f.includes('summary'));
const byPath = new Map();
const summaries = Object.fromEntries(fs.readdirSync(META).filter(f => f.includes('summary')).map(f => [f, JSON.parse(fs.readFileSync(path.join(META, f), 'utf8'))]));
let anatomy = null;
for (const f of metaFiles) {
  const m = JSON.parse(fs.readFileSync(path.join(META, f), 'utf8'));
  anatomy ??= m.role === 'candidate' ? m.anatomy : null;
  for (const it of m.items) byPath.set(it.file, {...it, set: m.set});
}
const candSummary = Object.values(summaries).find(s => s.role === 'candidate' && s.motion) ?? Object.values(summaries).find(s => s.role === 'candidate') ?? {};
const motion = Object.values(summaries).find(s => s.role === 'candidate' && s.motion)?.motion ?? {};
const coverage = Object.values(summaries).find(s => s.role === 'candidate' && s.coverageProbe)?.coverageProbe ?? null;
const baseCoverage = Object.values(summaries).find(s => s.role === 'baseline' && s.coverageProbe)?.coverageProbe ?? null;
anatomy ??= candSummary.anatomy ?? null;

// ------------------------------------------------------------------------------------------------ files on disk
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const exists = f => fs.existsSync(path.join(PREV, f));

// ------------------------------------------------------------------------------------------------ HTML
const img = (f, alt, {w = null, cls = ''} = {}) => {
  if (!exists(f)) return `<p class="missing">MISSING: ${esc(f)}</p>`;
  const m = byPath.get(f);
  const wh = m ? ` width="${m.width}" height="${m.height}"` : '';
  return `<figure class="${cls}"><a href="${esc(f)}"><img src="${esc(f)}" alt="${esc(alt)}" loading="lazy"${wh}${w ? ` style="max-width:${w}px"` : ''}></a><figcaption>${esc(alt)}${m ? ` <span class="dim">· ${m.width}×${m.height} · ${(m.bytes / 1024).toFixed(0)} KB</span>` : ''}</figcaption></figure>`;
};
const list = items => `<ul>${items.map(i => `<li>${typeof i === 'string' ? esc(i) : i.html}</li>`).join('')}</ul>`;

function stepper(clip) {
  const m = motion[clip];
  if (!m) return `<p class="missing">no motion for ${esc(clip)}</p>`;
  const frames = m.frameTimes.map((t, i) => ({src: `motion/${clip}/f${String(i).padStart(3, '0')}.webp`, t}));
  const once = !m.cycles || m.cycles === 1 && clip !== 'Dormant';
  return `<div class="stepper" id="motion-${esc(clip)}" data-fps="${m.fps}" data-hold="${m.endHoldS ?? 0}" data-frames='${esc(JSON.stringify(frames))}'>
  <h4>${esc(clip)} <span class="dim">— clip ${m.clipDurationS} s · shown ${m.shownSpanS} s (${m.cycles > 1 ? m.cycles + ' cycles' : once ? 'whole clip' : '1 cycle'}) · ${m.frames} frames @ ${m.fps} fps · ${m.width}×${m.height}</span></h4>
  <img class="frame" src="${esc(frames[0].src)}" width="${m.width}" height="${m.height}" loading="lazy" alt="${esc(clip)} frame">
  <div class="controls">
    <button type="button" data-act="first" title="first frame">⏮</button>
    <button type="button" data-act="prev" title="previous frame (←)">◀ step</button>
    <button type="button" data-act="play" title="play / pause (space)">▶ play</button>
    <button type="button" data-act="next" title="next frame (→)">step ▶</button>
    <button type="button" data-act="last" title="last frame">⏭</button>
    <input type="range" min="0" max="${frames.length - 1}" value="0" aria-label="scrub ${esc(clip)}">
    <select aria-label="speed"><option value="1">1×</option><option value="0.5">½×</option><option value="0.25">¼×</option></select>
    <label><input type="checkbox" class="loop"${clip === 'Dormant' || clip === 'Run' ? ' checked' : ''}> loop</label>
    <span class="readout">frame 1/${frames.length} · t = ${frames[0].t.toFixed(3)} s</span>
  </div>
  <p class="dim">Animated WebP of the same frames (opens in a new tab and loops automatically there): <a href="${esc(m.webp.file)}" target="_blank" rel="noopener">${esc(m.webp.file)}</a> · ${m.width}×${m.height} · ${m.fps} fps · ${m.webp.durationS} s per loop${m.endHoldS ? ` (incl. ${m.endHoldS} s end hold)` : ''} · ${(m.webp.bytes / 1024).toFixed(0)} KB</p>
</div>`;
}

const STEPPER_JS = `
(function(){
  document.querySelectorAll('.stepper').forEach(function(el){
    var frames = JSON.parse(el.getAttribute('data-frames')), fps = +el.getAttribute('data-fps'), hold = +el.getAttribute('data-hold') || 0;
    var img = el.querySelector('img.frame'), range = el.querySelector('input[type=range]'), out = el.querySelector('.readout');
    var playBtn = el.querySelector('[data-act=play]'), loop = el.querySelector('.loop'), speed = el.querySelector('select');
    var i = 0, timer = null, loaded = false;
    function preload(){ if (loaded) return; loaded = true; frames.forEach(function(f){ var im = new Image(); im.src = f.src; }); }
    function show(k){ i = Math.max(0, Math.min(frames.length - 1, k)); img.src = frames[i].src; range.value = i; out.textContent = 'frame ' + (i + 1) + '/' + frames.length + ' \\u00b7 t = ' + frames[i].t.toFixed(3) + ' s'; }
    function stop(){ if (timer) { clearTimeout(timer); timer = null; } playBtn.textContent = '\\u25b6 play'; }
    function tick(){
      var dt = 1000 / (fps * (+speed.value || 1));
      if (i >= frames.length - 1) { if (!loop.checked) { stop(); return; } timer = setTimeout(function(){ show(0); tick(); }, dt + hold * 1000); return; }
      timer = setTimeout(function(){ show(i + 1); tick(); }, dt);
    }
    function play(){ preload(); if (timer) { stop(); return; } if (i >= frames.length - 1 && !loop.checked) show(0); playBtn.textContent = '\\u275a\\u275a pause'; tick(); }
    el.addEventListener('click', function(e){ var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return; preload();
      if (a === 'play') play(); else { stop(); if (a === 'first') show(0); if (a === 'prev') show(i - 1); if (a === 'next') show(i + 1); if (a === 'last') show(frames.length - 1); } });
    range.addEventListener('input', function(){ preload(); stop(); show(+range.value); });
    el.tabIndex = 0;
    el.addEventListener('keydown', function(e){ if (e.key === 'ArrowLeft') { stop(); show(i - 1); e.preventDefault(); } else if (e.key === 'ArrowRight') { stop(); show(i + 1); e.preventDefault(); } else if (e.key === ' ') { play(); e.preventDefault(); } });
  });
})();`;

const CSS = `
:root{color-scheme:dark}body{margin:0;background:#141518;color:#e6e7ea;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.banner{position:sticky;top:0;z-index:5;background:#8a1c1c;color:#fff;padding:10px 16px;font-weight:700;font-size:18px;letter-spacing:.02em;border-bottom:3px solid #ffcf3f;text-align:center}
main{max-width:1680px;margin:0 auto;padding:8px 20px 60px}h1{font-size:24px;margin:18px 0 6px}h2{font-size:20px;margin:34px 0 8px;padding-top:10px;border-top:1px solid #333}h3{font-size:16px;margin:20px 0 6px}h4{margin:8px 0 6px;font-size:15px}
a{color:#8fc8ff}.dim{color:#9aa1aa;font-weight:normal}.missing{color:#ff8a8a;font-weight:700}
figure{margin:8px 0 18px}figure img{max-width:100%;height:auto;display:block;border:1px solid #2c2e33;background:#222}figcaption{font-size:13px;color:#c2c6cc;margin-top:4px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}.grid2{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(560px,1fr))}
.legend{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px 24px;background:#1c1e22;border:1px solid #30333a;padding:12px 16px;border-radius:6px}
.key{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;vertical-align:-1px}
table{border-collapse:collapse;font-size:13px;margin:8px 0}td,th{border:1px solid #33363c;padding:4px 8px;text-align:left;vertical-align:top}th{background:#1f2125}
nav ul{columns:3;font-size:14px}code{background:#22252a;padding:1px 4px;border-radius:3px;font-size:13px}
.stepper{background:#1a1c20;border:1px solid #30333a;border-radius:6px;padding:10px;margin:12px 0}.stepper img.frame{max-width:100%;height:auto;display:block;background:#222}
.controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}.controls button{background:#2a2d33;color:#eee;border:1px solid #4a4f58;border-radius:4px;padding:4px 10px;cursor:pointer}.controls input[type=range]{flex:1;min-width:200px}
.readout{font-variant-numeric:tabular-nums;color:#ffe9a8}.warn{background:#2b2214;border:1px solid #6d5320;padding:8px 12px;border-radius:6px}
`;

function section(id, title, body) { return `<h2 id="${id}">${esc(title)}</h2>\n${body}`; }

const C = input.candidate, B = input.baseline;
const covTable = (cov, label) => {
  if (!cov) return '';
  const rows = Object.entries(cov.summary).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${Math.round(v.rightMin * 100)}–${Math.round(v.rightMax * 100)} %</td><td>${Math.round(v.leftMin * 100)}–${Math.round(v.leftMax * 100)} %</td></tr>`).join('');
  return `<table><tr><th>${esc(label)}: clip (sampled every 0.1 s)</th><th>wearer's RIGHT apex patch covered</th><th>wearer's LEFT apex patch covered</th></tr>${rows}</table>`;
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="robots" content="noindex,nofollow">
<title>Siren garment refit — preview (AWAITING USER APPROVAL)</title>
<style>${CSS}</style></head><body>
<div class="banner">AWAITING USER APPROVAL — NOT MERGED / NOT LIVE</div>
<main>
<h1>Siren garment refit — human-review preview</h1>
<p>Task <code>${esc(input.task)}</code> · branch <code>${esc(input.branch)}</code> · candidate commit <code>${esc(C.gitSha ?? 'TO BE FILLED BY THE PRIMARY')}</code> · generated ${esc(input.generatedAt)}</p>
<div class="warn"><b>Status:</b> human approval <b>pending</b>; merge <b>not allowed</b>; game publication <b>not allowed</b>. This page is evidence for <b>your</b> judgement of the fit — no metric, test or Studio statement approves it. Approval would apply only to the exact candidate asset <code>${esc(C.sha256)}</code> at the recorded commit.</div>
<nav><h3>Contents</h3><ul>
<li><a href="#overview">Overview</a></li><li><a href="#legend">Anatomical label legend</a></li><li><a href="#compare">Baseline vs candidate</a></li>
<li><a href="#static">Static fit set (candidate)</a></li><li><a href="#closeups">Close fit views</a></li><li><a href="#clips">Actual clips — contact sheets</a></li>
<li><a href="#motion">Actual clips — motion (frame stepper)</a></li><li><a href="#scale">Scale beside a runtime zombie</a></li><li><a href="#light">Gameplay-light approximation</a></li>
<li><a href="#worst">Worst remaining frame / region</a></li><li><a href="#limits">Source, method &amp; limitations</a></li><li><a href="manifest.json">manifest.json</a></li>
</ul></nav>

${section('overview', 'Overview', `
${list(input.overview ?? [])}
<table>
<tr><th></th><th>asset</th><th>sha256</th><th>bytes</th></tr>
<tr><td><b>CANDIDATE</b></td><td><code>${esc(C.asset)}</code></td><td><code>${esc(C.sha256)}</code></td><td>${esc(C.bytes)}</td></tr>
<tr><td><b>BASELINE</b> (main, previously integrated)</td><td><code>${esc(B.asset)}</code> @ ${esc(B.gitRef)}</td><td><code>${esc(B.sha256)}</code></td><td>${esc(B.bytes)}</td></tr>
</table>
<p class="dim">All images are <b>CPU software renders</b> made by a deterministic offline rasteriser from the GLB's own geometry, skin weights and animation clips — not GPU / WebGPU / browser renders and not captured game frames. Lighting is a neutral studio setup unless labelled "gameplay-light".</p>`)}

${section('legend', 'Anatomical label legend', `
<div class="legend">
<div><b>How the sides were established:</b> from the body geometry, not names or screen sides — ${esc(anatomy?.statement ?? '')}. Cues: ${esc(anatomy?.cues?.toes ?? '')}; ${esc(anatomy?.cues?.chest ?? '')}. Lane FIT verified the same independently (nose, bust, toes).</div>
<div><b>Camera convention (all cameras unmirrored):</b><br>FRONT — camera in front of her: the wearer's <b>RIGHT</b> appears on screen-<b>LEFT</b>.<br>BACK — camera behind her: the wearer's RIGHT is on screen-RIGHT.<br>WEARER'S LEFT side — camera at her left: her front faces screen-left.<br>WEARER'S RIGHT side — camera at her right: her front faces screen-right.<br>Every panel carries an orientation strip computed from its actual camera (e.g. "◀ wearer's RIGHT · LEFT ▶").</div>
<div><span class="key" style="background:#5fd7ff"></span><b>cyan</b> = wearer's RIGHT (breast apex / shoulder tag)<br><span class="key" style="background:#ffb35c"></span><b>orange</b> = wearer's LEFT<br>hollow dot = the tagged point is hidden behind geometry in that view</div>
<div><span class="key" style="background:#f21fbf"></span><b>magenta tint</b> = geometry below the floor (y &lt; 0), drawn <b>through</b> a translucent floor so skirt-through-floor is disclosed, not hidden (in the game the opaque floor hides it).<br>Ground plane y = 0 with a 0.5 m grid (studio) / 1 m grid (gameplay-light).</div>
<div><b>Target (user):</b> wearer's anatomical <b>RIGHT breast covered</b>, <b>LEFT exposed</b>; the torn one-strap dress kept; fitted to her body, moving with shoulders / torso / hips / legs.</div>
<div><b>Poses:</b> "Stand" = the Rise clip's final frame, which the game holds as her standing / Idle pose. "BIND / T-pose" = the rest pose of the skin, never shown in game (used once, for an unobstructed chest view).</div>
</div>`)}

${section('compare', 'Baseline vs candidate (identical cameras)', `
<p>BASELINE = the asset currently on main (${esc(B.sha256.slice(0, 12))}…). CANDIDATE = the refit (${esc(C.sha256.slice(0, 12))}…). Same body, same clips, same pose, same camera.</p>
${img('pair-front.jpg', 'Full body FRONT — baseline | candidate (orthographic, Stand pose)')}
${img('pair-three-quarter.jpg', 'Three-quarter — baseline | candidate (perspective 26°, az −35° toward the wearer\'s right, el 10°)')}
${img('pair-strap-waist.jpg', 'Chest / strap / waist close-ups — baseline (top) | candidate (bottom)')}
${coverage || baseCoverage ? `<h3>Coverage probe (geometric sanity check, not approval)</h3><p class="dim">${esc((coverage ?? baseCoverage).method)}</p>${covTable(baseCoverage, 'BASELINE')}${covTable(coverage, 'CANDIDATE')}` : ''}`)}

${section('static', 'Static fit set — candidate (Stand pose)', `
<div class="grid">
${img('candidate-front.jpg', 'FRONT — orthographic, elevation 0° (wearer\'s RIGHT on screen-left)')}
${img('candidate-back.jpg', 'BACK — orthographic, elevation 0°')}
${img('candidate-wearer-left.jpg', 'WEARER\'S LEFT side — orthographic, elevation 0°')}
${img('candidate-wearer-right.jpg', 'WEARER\'S RIGHT side — orthographic, elevation 0°')}
${img('candidate-three-quarter.jpg', 'THREE-QUARTER front-right — perspective 26°, az −35°, el 10°')}
</div>`)}

${section('closeups', 'Close fit views — candidate', `
<div class="grid2">
${img('fit-chest-strap.jpg', 'Chest / coverage edge + strap: FRONT (Stand) and front-right 3/4 (BIND / T-pose)')}
${img('fit-shoulder-underarm-right.jpg', 'Wearer\'s RIGHT shoulder / underarm (strap side): side + back-right 3/4')}
${img('fit-underarm-flank-left.jpg', 'Wearer\'s LEFT underarm / flank (intentionally exposed side): side + back-left 3/4')}
${img('fit-waist.jpg', 'Waist: FRONT + BACK')}
${img('fit-hip.jpg', 'Hip: wearer\'s RIGHT side + wearer\'s LEFT side')}
</div>`)}

${section('clips', 'Actual clips — contact sheets (candidate)', `
<p>The six runtime clips exactly as exported in the candidate GLB (timings / body motion unchanged): ${esc(Object.entries(C.clips ?? {}).map(([k, v]) => `${k} ${v} s`).join(' · '))}. Each sheet: top row front-right 3/4, bottom row back-left 3/4; orthographic, elevation 10°, one fixed camera per row fitted to the whole clip; times are clip seconds. Extra samples are added automatically at the deepest skirt-below-floor frame and the widest stride / maximum reach.</p>
${img('clips-overview.jpg', 'All six clips, three key poses each (index)')}
${['Dormant', 'Rise', 'Run', 'Attack', 'Hit', 'Death'].map(c => img(`clips-${c}.jpg`, `${c} — representative + extreme poses (clip seconds labelled)`)).join('\n')}`)}

${section('motion', 'Actual clips — motion with controls (candidate)', `
<p>Nothing plays automatically. Each viewer steps through the rendered frames of the actual clip (two synchronised body-relative views per frame: front-right 3/4 and back-left 3/4, orthographic el 10°). Controls: play / pause (space), step (← →), scrub, speed, loop. Dormant shows one 4 s cycle at 12 fps; Run two cycles at 15 fps; Rise / Attack / Hit / Death the whole clip at 15 fps (the animated WebP adds a brief end hold).</p>
${['Dormant', 'Rise', 'Run', 'Attack', 'Hit', 'Death'].map(stepper).join('\n')}`)}

${section('scale', 'Scale — beside an actual runtime-scaled zombie', `
${img('candidate-beside-zombie.jpg', 'Candidate beside zombie-body-lastshift-t25.glb (Idle @ 0 s, runtime root scale 1.00 = median of the game\'s 0.95–1.05), same ground plane; heights captioned')}`)}

${section('light', 'Gameplay-light approximation (standalone CPU render — NOT a captured game frame)', `
<p class="warn">These two images re-create the game's flashlight / ambient parameters in the offline CPU renderer (source: ${esc(input.gameplayLightSource ?? '')}). Not modelled: ${esc((input.gameplayNotModelled ?? []).join('; '))}. They indicate how the dress material reads under the dim torch; they are not gameplay proof and not GPU output.</p>
${img('candidate-gameplay-light-gamefov.jpg', 'Player view at the game\'s 75° vertical FOV, eye 1.6 m, 4 m away (Stand)')}
${img('candidate-gameplay-light-close.jpg', 'Closer crop of the same light (FOV 34°, 3 m): Stand and Dormant')}`)}

${section('worst', 'Worst remaining frame / region', `
${input.worst ? `<p>${esc(input.worst.text)}</p>${img('worst-frame.jpg', `Worst remaining frame reported by lane FIT: ${input.worst.clip} @ ${input.worst.t} s — ${input.worst.region}`)}` : '<p class="missing">Worst-frame view not available (see limitations).</p>'}
${input.fitChecks ? `<h3>Objective fit checks (lane FIT) — summary</h3>${list(input.fitChecks.summary ?? [])}<p class="dim">Full numbers: <code>${esc(input.fitChecks.path)}</code> (kept outside the preview folder; numbers do not approve the visual fit).</p>` : ''}`)}

${section('limits', 'Source, method & limitations', `
<h3>Source and provenance</h3>${list(input.sources ?? [])}
<h3>What changed (lane FIT, summarised)</h3>${list(input.fitSummary ?? [])}
<h3>Limitations and residuals (honest)</h3>${list(input.limitations ?? [])}
<h3>Preview method</h3>${list(input.method ?? [])}
<h3>Licence / approval caveats</h3>${list(input.licence ?? [])}
<p class="dim">Package: see <a href="manifest.json">manifest.json</a> for every file (MIME, bytes, dimensions, fps / duration, clip / time / view / light / role) and the total size.</p>`)}
</main>
<script>${STEPPER_JS}</script>
</body></html>
`;
fs.writeFileSync(path.join(PREV, 'index.html'), html);

// ------------------------------------------------------------------------------------------------ manifest
const files = [];
for (const f of walk(PREV).sort()) {
  const r = path.relative(PREV, f).split(path.sep).join('/');
  if (r === 'manifest.json') continue;
  const ext = path.extname(f).toLowerCase();
  const rec = {path: r, mime: MIME[ext] ?? 'application/octet-stream', bytes: fs.statSync(f).size};
  const m = byPath.get(r);
  if (m) {
    for (const k of ['width', 'height', 'fps', 'durationS', 'frames', 'animated', 'clip', 'timeS', 'clipDurationS', 'cycles', 'endHoldS', 'view', 'viewAzimuthDeg', 'projection', 'light', 'pair', 'roles', 'samples', 'zombie', 'siren', 'panels', 'region', 'notModelled', 'stepperFrame']) if (m[k] !== undefined) rec[k] = m[k];
    rec.role = m.pair ? 'baseline+candidate (paired)' : m.role;
    rec.backend = m.backend;
    rec.asset = m.asset; rec.assetSha256 = m.assetSha256;
    if (m.baselineSha256) rec.baselineSha256 = m.baselineSha256;
  } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    const md = await sharp(f, {animated: ext === '.webp'}).metadata();
    rec.width = md.width; rec.height = md.pageHeight ?? md.height;
    rec.note = 'no render meta record';
  } else if (r === 'index.html') { rec.role = 'review page'; rec.description = 'static review page; relative URLs only; strict CSP (no remote / network requests); no autoplay'; }
  files.push(rec);
}
const manifest = {
  schema: 'siren-refit-preview/1', task: input.task, branch: input.branch, generatedAt: input.generatedAt,
  status: {banner: 'AWAITING USER APPROVAL — NOT MERGED / NOT LIVE', humanApproval: 'pending', mergeAllowed: false, gamePublicationAllowed: false, approvalAppliesTo: 'the exact candidate commit + asset sha256 below; any appearance-affecting change needs new evidence and approval'},
  candidate: {gitSha: C.gitSha ?? 'TO_BE_FILLED_BY_PRIMARY (full 40-hex commit of the previewed candidate)', asset: C.asset, assetSha256: C.sha256, assetBytes: C.bytes, sidecar: C.sidecar ?? null, clips: C.clips ?? null},
  baseline: {gitRef: B.gitRef, asset: B.asset, assetSha256: B.sha256, assetBytes: B.bytes},
  sources: input.sourcesJson ?? null,
  provenanceAndLicence: input.licence ?? [],
  render: {backend: 'CPU software rasteriser (tools/asset-pipeline/enemy/lib/preview-raster.mjs; deterministic; 2x2 supersampled + lanczos3) — NOT GPU / WebGPU / browser, NOT captured game frames', tools: ['tools/asset-pipeline/enemy/qa/siren-preview.mjs', 'tools/asset-pipeline/enemy/qa/siren-preview-pack.mjs', 'tools/asset-pipeline/enemy/lib/preview-gltf.mjs', 'tools/asset-pipeline/enemy/lib/preview-raster.mjs', 'tools/asset-pipeline/enemy/lib/preview-anatomy.mjs'],
    anatomy, cameraConvention: 'unmirrored; FRONT: wearer\'s RIGHT on screen-LEFT; BACK: wearer\'s RIGHT on screen-RIGHT; WEARER\'S LEFT side: her front faces screen-left; WEARER\'S RIGHT side: her front faces screen-right',
    studioLight: input.studioLight, gameplayLight: {source: input.gameplayLightSource, notModelled: input.gameplayNotModelled}, belowFloor: 'magenta tint through a translucent floor (disclosed, not hidden)'},
  motion, coverageProbe: {candidate: coverage, baseline: baseCoverage},
  fitChecks: input.fitChecks ?? null, worst: input.worst ?? null, limitations: input.limitations ?? [],
  files,
  totals: null,
};
// total incl. manifest itself (iterate until the byte count is stable)
let total = files.reduce((a, f) => a + f.bytes, 0), mbytes = 0;
for (let k = 0; k < 5; k++) {
  manifest.totals = {files: files.length + 1, bytes: total + mbytes, mebibytes: +((total + mbytes) / 1048576).toFixed(2), note: 'includes manifest.json itself'};
  const s = JSON.stringify(manifest, null, 1);
  if (Buffer.byteLength(s) === mbytes) break;
  mbytes = Buffer.byteLength(s);
}
fs.writeFileSync(path.join(PREV, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`index.html + manifest.json: ${manifest.totals.files} files, ${manifest.totals.bytes} B (${manifest.totals.mebibytes} MiB)`);
