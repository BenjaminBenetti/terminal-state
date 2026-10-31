// Task track1-siren-blightbelly-20261031 (lane AUDIO): structural QC image for one clip (worker cannot listen) — title + gate
// verdict, 5 ms envelope (dBFS), log-frequency spectrogram (sequential one-hue ramp, 70 dB range re the clip maximum) with the
// YIN f0 of voiced frames overlaid. Input = the metrics object of lib/structural.mjs structure() (its private _stft / _track /
// _env5 / _actMask arrays) plus cueVerdict() and loudness(). Static PNG via sharp (declared dependency).
import sharp from 'sharp';

// Palette (dataviz reference instance, light surface): text tokens, sequential blue ramp, categorical slot 2 for the f0 marks.
const C = {surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', grid: '#e4e3df', env: '#2a78d6', f0: '#eb6834', pass: '#0ca30c', fail: '#d03b3b'};
const RAMP = ['#fcfcfb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
const ramp = v => {
  const t = Math.max(0, Math.min(1, v)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * f));
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const QC_IMG = {W: 1000, SPEC_H: 240, ENV_H: 110, ML: 64, MR: 16, TOP: 92, GAP: 26, F_LO: 50, F_HI: 16000};
export const QC_SURFACE = C.surface;

/** Render one clip's QC PNG to `file`. `title` = first line; `label` = what the clip is (e.g. 'raw' / 'shipped derivative'). */
export async function renderQc(file, {title, label, m, verdict, lu, sr = 44100}) {
  const {W, SPEC_H, ENV_H, ML, MR, TOP, GAP, F_LO, F_HI} = QC_IMG, IMG_W = ML + W + MR, IMG_H = TOP + ENV_H + GAP + SPEC_H + 44;
  const yOfHz = hz => SPEC_H - 1 - Math.round((Math.log(hz / F_LO) / Math.log(F_HI / F_LO)) * (SPEC_H - 1));
  const {_stft: st, _track: tr, _env5: env, _actMask: act} = m, dur = m.durationS;
  let mx = 1e-20;
  for (const p of st.frames) for (const v of p) if (v > mx) mx = v;
  const px = Buffer.alloc(W * SPEC_H * 3), binHz = sr / st.N;
  for (let col = 0; col < W; col++) {
    const t = (col + 0.5) / W * dur, fi = Math.max(0, Math.min(st.frames.length - 1, Math.round((t * sr - st.N / 2) / st.hop)));
    const p = st.frames[fi];
    for (let row = 0; row < SPEC_H; row++) {
      const hz = F_LO * Math.pow(F_HI / F_LO, (SPEC_H - 1 - row) / (SPEC_H - 1)), kf = hz / binHz, k0 = Math.floor(kf), fr = kf - k0;
      const v = (p[k0] ?? 0) * (1 - fr) + (p[k0 + 1] ?? 0) * fr;
      const c = ramp((10 * Math.log10(v / mx + 1e-20) + 70) / 70), o = (row * W + col) * 3;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
    }
  }
  const specPng = await sharp(px, {raw: {width: W, height: SPEC_H, channels: 3}}).png().toBuffer();
  const sx = t => ML + t / dur * W;
  const ey = db => TOP + ENV_H - Math.max(0, Math.min(1, (db + 60) / 60)) * ENV_H;
  const envPts = Array.from(env, (db, h) => `${sx((h + 0.5) * 0.005).toFixed(1)},${ey(db).toFixed(1)}`).join(' ');
  const specTop = TOP + ENV_H + GAP;
  const marks = tr.filter((p, i) => act[i] && p.f0 > 0 && p.ap <= 0.3 && i % 2 === 0)
    .map(p => `<circle cx="${sx(p.t).toFixed(1)}" cy="${(specTop + yOfHz(p.f0)).toFixed(1)}" r="2.6" fill="${C.f0}" stroke="${C.surface}" stroke-width="1"/>`).join('');
  const tStep = dur > 4 ? 1 : dur > 1.2 ? 0.5 : 0.1, tTicks = [];
  for (let t = 0; t <= dur + 1e-9; t += tStep) tTicks.push(t);
  const fTicks = [100, 200, 500, 1000, 2000, 5000, 10000];
  const failed = verdict.failed.length ? ` — failed: ${verdict.failed.join(', ')}` : '';
  const pitch = m.pitch.f0MedianHz ? `f0 median ${m.pitch.f0MedianHz} Hz, range ${m.pitch.rangeSt} st, ${m.pitch.notes} notes / ${m.pitch.noteSteps} steps, voiced ${(m.pitch.voicedFrac * 100).toFixed(0)} %` : `unvoiced (voiced ${(m.pitch.voicedFrac * 100).toFixed(0)} %)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${IMG_W}" height="${IMG_H}" font-family="DejaVu Sans, sans-serif">
<rect width="${IMG_W}" height="${IMG_H}" fill="${C.surface}"/>
<text x="${ML}" y="22" font-size="16" font-weight="bold" fill="${C.text}">${esc(title)} · ${esc(label)} · ${dur.toFixed(2)} s</text>
<text x="${ML}" y="42" font-size="12.5" fill="${C.text}"><tspan font-weight="bold" fill="${verdict.pass ? C.pass : C.fail}">${verdict.pass ? '✔ STRUCTURAL PASS' : '✘ STRUCTURAL FAIL'}</tspan><tspan fill="${C.text2}">  (${verdict.kind} gate; not a listening test)${esc(failed)}</tspan></text>
<text x="${ML}" y="60" font-size="12" fill="${C.text2}">peak ${m.peakDbfs} dBFS · RMS ${m.rmsDbfs} dBFS · ${lu.integratedLufs} LUFS (max momentary ${lu.momentaryMaxLufs}) · centroid ${m.spectral.centroidHz} Hz · flatness ${m.spectral.flatness} · quiet ${(m.quietFrac * 100).toFixed(0)} % · rise ${m.attack.riseMs} ms · last−first quarter ${m.decay.lastMinusFirstDb} dB</text>
<text x="${ML}" y="76" font-size="12" fill="${C.text2}">${esc(pitch)}</text>
${[0, -20, -40, -60].map(db => `<line x1="${ML}" x2="${ML + W}" y1="${ey(db)}" y2="${ey(db)}" stroke="${C.grid}" stroke-width="1"/><text x="${ML - 6}" y="${ey(db) + 4}" font-size="11" text-anchor="end" fill="${C.text2}">${db}</text>`).join('')}
<text x="14" y="${TOP + ENV_H / 2}" font-size="11" fill="${C.text2}" transform="rotate(-90 14 ${TOP + ENV_H / 2})" text-anchor="middle">level dBFS (5 ms)</text>
<polyline points="${envPts}" fill="none" stroke="${C.env}" stroke-width="2" stroke-linejoin="round"/>
<image x="${ML}" y="${specTop}" width="${W}" height="${SPEC_H}" xlink:href="data:image/png;base64,${specPng.toString('base64')}"/>
${fTicks.map(f => `<line x1="${ML - 4}" x2="${ML}" y1="${specTop + yOfHz(f)}" y2="${specTop + yOfHz(f)}" stroke="${C.text2}"/><text x="${ML - 6}" y="${specTop + yOfHz(f) + 4}" font-size="11" text-anchor="end" fill="${C.text2}">${f >= 1000 ? f / 1000 + 'k' : f}</text>`).join('')}
<text x="14" y="${specTop + SPEC_H / 2}" font-size="11" fill="${C.text2}" transform="rotate(-90 14 ${specTop + SPEC_H / 2})" text-anchor="middle">Hz (log) · 70 dB range</text>
${marks}
${tTicks.map(t => `<line x1="${sx(t)}" x2="${sx(t)}" y1="${specTop + SPEC_H}" y2="${specTop + SPEC_H + 4}" stroke="${C.text2}"/><text x="${sx(t)}" y="${specTop + SPEC_H + 17}" font-size="11" text-anchor="middle" fill="${C.text2}">${t.toFixed(tStep < 1 ? 1 : 0)} s</text>`).join('')}
<text x="${ML + W}" y="${specTop + SPEC_H + 34}" font-size="11" text-anchor="end" fill="${C.text2}">blue line = envelope · spectrogram light→dark = quiet→loud · orange dots = YIN f0 of voiced frames</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

/** Stack PNGs vertically into one overview image. */
export async function stackPngs(files, out) {
  const metas = await Promise.all(files.map(f => sharp(f).metadata()));
  const width = Math.max(...metas.map(m => m.width)), height = metas.reduce((s, m) => s + m.height, 0);
  let top = 0;
  const comps = files.map((f, i) => { const c = {input: f, top, left: 0}; top += metas[i].height; return c; });
  await sharp({create: {width, height, channels: 3, background: C.surface}}).composite(comps).png().toFile(out);
  return out;
}
