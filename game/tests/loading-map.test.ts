// Task studio-initial-loading-subway-graphic-20261111-070741-01: the loading screen's subway-map graphic (ui/loadingMap.ts).
//  - progress is the load's own: the stages game.ts reports land on one 0..1 scale that never runs backwards within a load and
//    reaches 1 only at complete() (the real Game.showLoading / progressTo / readyLine on a recording meter; the flow test with the
//    real continueCampaign is in menu-polish.test.ts, next to the loading screen's other checks);
//  - the drawing is a pure function of that number: nothing drawn at 0, everything at 1 and only at 1, lines / branches / stations
//    filling in between, never un-drawing;
//  - it is decoration: a fixed design with no text, built from nothing but its own data (no campaign, layout, seed or save);
//  - the DOM view shows exactly that frame, starts over with each load, and the screen behind it is opaque;
//  - the caption is the exact requested line in a quiet style; the journey's presentation is untouched;
//  - loading -> play: the screen stays over the canvas until a frame of play has been drawn (coverUntilPlayDrawn), holding nothing.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  LOADING_CSS, LOADING_MAP, LOAD_STAGES, LoadProgress, LoadingMapView, loadingMapFrame, loadingMapSvg, type LoadMeter, type LoadStage,
} from '../src/ui/loadingMap';
import {coverUntilPlayDrawn} from '../src/ui/loadingScreen';
import {MiniEl, installMiniDom} from './helpers/paperMapDom';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const STEPS = 1000;
const sweep = Array.from({length: STEPS + 1}, (_, k) => k / STEPS);
const complete = (p: number) => { const f = loadingMapFrame(p); return f.lines.every(v => v === 1) && f.stations.every(Boolean); };

describe('the load\'s progress (LoadProgress): truthful, monotonic, finished only when the game says so', () => {
  it('each stage has its own share of the scale, in the order the load runs them, and none of them reaches the end', () => {
    const order: LoadStage[] = ['props', 'textures', 'graphics'];
    expect(Object.keys(LOAD_STAGES)).toEqual(order);
    let prev = 0;
    for (const s of order) {
      const [a, b] = LOAD_STAGES[s];
      expect(a, s).toBeGreaterThanOrEqual(prev);
      expect(b, s).toBeGreaterThan(a);
      prev = b;
    }
    expect(LOAD_STAGES.props[0]).toBe(0);
    expect(prev).toBeLessThan(1); // the last stretch is complete()'s alone
  });

  it('a stage maps linearly into its share; out-of-range and non-finite fractions are clamped', () => {
    const p = new LoadProgress();
    expect(p.value).toBe(0);
    expect(p.stage('props', 0)).toBe(0);
    expect(p.stage('props', 0.5)).toBeCloseTo(0.21, 12);
    expect(p.stage('props', 1)).toBeCloseTo(0.42, 12);
    expect(p.stage('props', 7)).toBeCloseTo(0.42, 12);
    expect(new LoadProgress().stage('graphics', -3)).toBeCloseTo(0.52, 12);
    expect(new LoadProgress().stage('graphics', Number.NaN)).toBeCloseTo(0.52, 12);
    expect(new LoadProgress().stage('textures', 0.5)).toBeCloseTo(0.49, 12);
  });

  it('never runs backwards within a load: a stage that restarts, or an earlier stage reported late, changes nothing', () => {
    const p = new LoadProgress();
    p.stage('props', 0.8);
    expect(p.stage('props', 0.1)).toBeCloseTo(0.42 * 0.8, 12);
    p.stage('graphics', 0.6);
    const at = p.value;
    expect(p.stage('graphics', 0)).toBe(at); // (the warm-up re-zeroes its own count: the old bar jumped back to 0 %)
    expect(p.stage('textures', 1)).toBe(at);
    expect(p.stage('props', 1)).toBe(at);
    let last = 0;
    const q = new LoadProgress();
    for (const [s, f] of [['props', 0.2], ['props', 0.9], ['props', 0.4], ['textures', 0.3], ['graphics', 0], ['graphics', 0.5], ['graphics', 0.2], ['graphics', 1]] as [LoadStage, number][]) {
      const v = q.stage(s, f);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('is 1 only after complete(): every stage fully done still leaves the map unfinished; reset() starts the next load at 0', () => {
    const p = new LoadProgress();
    for (const s of Object.keys(LOAD_STAGES) as LoadStage[]) p.stage(s, 1);
    expect(p.value).toBeLessThan(1);
    expect(complete(p.value)).toBe(false);
    expect(p.complete()).toBe(1);
    expect(complete(p.value)).toBe(true);
    expect(p.reset()).toBe(0);
    expect(p.value).toBe(0);
    // a load whose warm-up is skipped (?warmup=off, no renderer): the models, then ready
    p.stage('props', 1);
    expect(p.complete()).toBe(1);
  });
});

describe('the drawing (LOADING_MAP / loadingMapFrame): fills in with progress, complete only at 1', () => {
  it('is a small network: several lines, a fork and branches off interchanges, and all three kinds of station mark', () => {
    const m = LOADING_MAP;
    expect(m.lines.length).toBeGreaterThanOrEqual(5);
    expect(new Set(m.lines.map(l => l.color)).size).toBe(3);
    for (const kind of ['stop', 'interchange', 'terminus'] as const) expect(m.stations.filter(s => s.kind === kind).length, kind).toBeGreaterThanOrEqual(4);
    // branches: more than one stretch sets off from the same point (the fork; the line crossing the trunk)
    const starts = m.lines.map(l => /^M ([\d.]+ [\d.]+)/.exec(l.d)![1]);
    expect(starts.filter((s, i) => starts.indexOf(s) !== i).length).toBeGreaterThanOrEqual(2);
    // every stretch's share of the load is a real interval inside 0..1, and the octolinear paths are well-formed
    for (const l of m.lines) {
      expect(l.from).toBeGreaterThanOrEqual(0);
      expect(l.to).toBeGreaterThan(l.from);
      expect(l.to).toBeLessThanOrEqual(1);
      expect(l.length).toBeGreaterThan(50);
      expect(l.d).toMatch(/^M [\d.]+ [\d.]+( (L [\d.]+ [\d.]+|A 16 16 0 0 [01] [\d.]+ [\d.]+))+$/);
    }
    // every mark sits inside the view box with its ring
    const [x0, y0, w, h] = m.viewBox;
    for (const s of m.stations) {
      expect(s.x - 10).toBeGreaterThanOrEqual(x0);
      expect(s.x + 10).toBeLessThanOrEqual(x0 + w);
      expect(s.y - 10).toBeGreaterThanOrEqual(y0);
      expect(s.y + 10.5).toBeLessThanOrEqual(y0 + h);
    }
  });

  it('nothing grows out of thin air: a stretch starts at the origin or where an earlier stretch has already arrived', () => {
    const m = LOADING_MAP;
    expect(m.lines[0].from).toBe(0);
    m.lines.forEach((l, i) => {
      if (i === 0) return;
      // its first point is a lit interchange by the time it starts
      const [x, y] = /^M ([\d.]+) ([\d.]+)/.exec(l.d)!.slice(1).map(Number);
      const st = m.stations.find(s => s.x === x && s.y === y);
      expect(st?.kind, `line ${i}`).toBe('interchange');
      expect(st!.lit).toBeLessThanOrEqual(l.from + 1e-12);
      expect(m.lines.slice(0, i).some(e => e.from < l.from && e.to >= l.from - 1e-12), `line ${i}`).toBe(true);
    });
  });

  it('at 0 only the first terminus is lit and no line is drawn; at 1 everything is drawn and lit', () => {
    const a = loadingMapFrame(0);
    expect(a.lines.every(v => v === 0)).toBe(true);
    expect(a.stations.filter(Boolean).length).toBe(1);
    expect(LOADING_MAP.stations[a.stations.indexOf(true)]).toMatchObject({kind: 'terminus', lit: 0});
    expect(complete(1)).toBe(true);
    // out-of-range / non-finite input is clamped, never "more than done"
    expect(loadingMapFrame(-1)).toEqual(a);
    expect(loadingMapFrame(Number.NaN)).toEqual(a);
    expect(loadingMapFrame(5)).toEqual(loadingMapFrame(1));
  });

  it('is complete ONLY at 1: not at the end of the last stage, not a hair before the end', () => {
    for (const p of sweep) expect(complete(p), `p = ${p}`).toBe(p === 1);
    expect(complete(LOAD_STAGES.graphics[1])).toBe(false);
    expect(complete(1 - 1e-9)).toBe(false);
    // what is still missing just before the end is visible, not a rounding sliver: whole station marks and a real length of line
    const f = loadingMapFrame(LOAD_STAGES.graphics[1]);
    expect(f.stations.filter(v => !v).length).toBeGreaterThanOrEqual(2);
    const missing = LOADING_MAP.lines.reduce((s, l, i) => s + l.length * (1 - f.lines[i]), 0);
    expect(missing).toBeGreaterThan(20);
    expect(LOADING_MAP.stations.filter(s => s.lit === 1).every(s => s.kind === 'terminus')).toBe(true);
  });

  it('only ever fills in: a line never shortens and a lit station never goes dark as progress rises', () => {
    let prev = loadingMapFrame(0);
    for (const p of sweep.slice(1)) {
      const f = loadingMapFrame(p);
      f.lines.forEach((v, i) => { expect(v, `line ${i} at ${p}`).toBeGreaterThanOrEqual(prev.lines[i]); expect(v).toBeLessThanOrEqual(1); });
      f.stations.forEach((v, i) => { if (prev.stations[i]) expect(v, `station ${i} at ${p}`).toBe(true); });
      prev = f;
    }
  });

  it('progress shows all the way: every twentieth of the load draws more line, and every stage lights stations of its own', () => {
    const drawn = (p: number) => { const f = loadingMapFrame(p); return LOADING_MAP.lines.reduce((s, l, i) => s + l.length * f.lines[i], 0); };
    const lit = (p: number) => loadingMapFrame(p).stations.filter(Boolean).length;
    for (let k = 0; k < 20; k++) expect(drawn((k + 1) / 20), `${k}/20`).toBeGreaterThan(drawn(k / 20) + 10);
    for (const s of ['props', 'graphics'] as const) expect(lit(LOAD_STAGES[s][1]), s).toBeGreaterThanOrEqual(lit(LOAD_STAGES[s][0]) + 4);
    expect(lit(1)).toBe(LOADING_MAP.stations.length);
  });

  it('a station lights when a line\'s drawn end gets there: it is on a stretch whose share of the load covers that moment', () => {
    for (const s of LOADING_MAP.stations) {
      expect(s.lit).toBeGreaterThanOrEqual(0);
      expect(s.lit).toBeLessThanOrEqual(1);
      expect(LOADING_MAP.lines.some(l => l.color === s.color && l.from <= s.lit + 1e-12 && s.lit <= l.to + 1e-12), `${s.x},${s.y}`).toBe(true);
      if (s.lit > 0) expect(loadingMapFrame(s.lit - 1e-6).stations[LOADING_MAP.stations.indexOf(s)]).toBe(false);
      expect(loadingMapFrame(s.lit).stations[LOADING_MAP.stations.indexOf(s)]).toBe(true);
    }
  });
});

describe('decoration only: a fixed design that knows nothing about the player\'s network', () => {
  it('the module is self-contained: no imports, no randomness, no clock, no storage, nothing from the campaign / levels / saves', () => {
    const src = SRC('src/ui/loadingMap.ts');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(|Math\.random|Date\.|performance\.|localStorage|sessionStorage|fetch\(/);
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/campaign|network|seed|layout|paperMap|save/i);
    // no waiting of its own: nothing here can hold play back for an animation
    expect(code).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|await |Promise|animationend|transitionend/);
  });

  it('the same drawing every time, with no words on it (no station or line names)', () => {
    expect(loadingMapSvg(0.37)).toBe(loadingMapSvg(0.37));
    expect(JSON.stringify(LOADING_MAP)).toBe(JSON.stringify(LOADING_MAP));
    for (const p of [0, 0.5, 1]) {
      const svg = loadingMapSvg(p);
      expect(svg).not.toMatch(/<text|<title|<desc|<tspan|aria-label/);
      expect(svg.replace(/<[^>]*>/g, '')).toBe(''); // markup only
      expect(svg).toMatch(/^<svg class="lm" viewBox="[\d. ]+" aria-hidden="true" focusable="false">/);
    }
  });

  it('game.ts only hands it progress (a type import), and the paper map / campaign code does not know it', () => {
    const game = SRC('src/game.ts');
    expect(game).toMatch(/^import type \{LoadMeter\} from '\.\/ui\/loadingMap';/m);
    expect(game.match(/from '\.\/ui\/loadingMap'/g)).toHaveLength(1);
    for (const f of ['src/ui/paperMap.ts', 'src/campaign/discovery.ts', 'src/campaign/types.ts']) expect(SRC(f), f).not.toMatch(/loadingMap/);
  });
});

describe('the markup (loadingMapSvg)', () => {
  it('one unlit and one coloured path per stretch, one mark per station; the coloured paths are dashed to their own length', () => {
    const svg = loadingMapSvg(0);
    const n = LOADING_MAP.lines.length;
    expect(svg.match(/<path d="/g)).toHaveLength(n);
    expect(svg.match(/<path class="lm-line"/g)).toHaveLength(n);
    expect(svg.match(/<circle class="lm-st /g)).toHaveLength(LOADING_MAP.stations.length);
    LOADING_MAP.lines.forEach(l => {
      const len = String(Math.round(l.length * 100) / 100);
      expect(svg).toContain(`d="${l.d}" stroke="${l.color}" stroke-dasharray="${len} ${len}" style="stroke-dashoffset:${len};visibility:hidden"`);
    });
    // unlit below, colour over it, marks on top
    expect(svg.indexOf('lm-ghost')).toBeLessThan(svg.indexOf('lm-lines'));
    expect(svg.indexOf('lm-lines')).toBeLessThan(svg.indexOf('lm-stations'));
  });

  it('at 1 every path is fully drawn and every mark is on; in between it matches the frame', () => {
    const done = loadingMapSvg(1);
    expect(done.match(/stroke-dashoffset:0;visibility:visible/g)).toHaveLength(LOADING_MAP.lines.length);
    expect(done.match(/class="lm-st lm-\w+ on"/g)).toHaveLength(LOADING_MAP.stations.length);
    const p = 0.6, f = loadingMapFrame(p), svg = loadingMapSvg(p);
    expect(svg.match(/visibility:visible/g)).toHaveLength(f.lines.filter(v => v > 0).length);
    expect(svg.match(/class="lm-st lm-\w+ on"/g)).toHaveLength(f.stations.filter(Boolean).length);
  });
});

describe('the DOM view (LoadingMapView)', () => {
  /** The mini DOM's own serialisation of a markup string. */
  const miniHtml = (markup: string) => { const box = new MiniEl(null, 'div'); box.innerHTML = markup; return box.innerHTML; };

  function mount() {
    const dom = installMiniDom(1280, 720);
    dom.doc.body.innerHTML = '<section id="title" class="screen" data-mode="loading"><div class="loading-card"><div id="loading-map" class="loading-map"></div></div></section>';
    const host = dom.doc.querySelector('#loading-map')!;
    const view = new LoadingMapView(host as unknown as HTMLElement, dom.doc as unknown as Document);
    const lines = () => host.querySelectorAll('.lm-line'), stations = () => host.querySelectorAll('.lm-st');
    /** What the elements show now: per line the drawn fraction (from its dash offset), per station its lit class. */
    const shown = () => ({
      lines: lines().map((el, i) => {
        const inline = /stroke-dashoffset:([\d.]+);visibility:(\w+)/.exec(el.getAttribute('style') ?? '')!;
        const off = Number(el.style.strokeDashoffset ?? inline[1]), vis = String(el.style.visibility ?? inline[2]);
        const v = 1 - off / LOADING_MAP.lines[i].length;
        expect(vis, `line ${i}`).toBe(v > 1e-4 ? 'visible' : 'hidden');
        return v;
      }),
      stations: stations().map(el => el.classList.contains('on')),
    });
    const matches = (p: number) => {
      const s = shown(), f = loadingMapFrame(p);
      s.lines.forEach((v, i) => expect(v, `line ${i} at ${p}`).toBeCloseTo(f.lines[i], 4));
      expect(s.stations).toEqual(f.stations);
    };
    return {dom, host, view, lines, stations, shown, matches};
  }

  it('mounts the empty map and its styles once', () => {
    const m = mount();
    try {
      expect(m.host.querySelectorAll('svg').length).toBe(1);
      expect(m.host.innerHTML).toBe(miniHtml(loadingMapSvg(0)));
      expect(m.view.value).toBe(0);
      m.matches(0);
      expect(m.dom.doc.head.querySelectorAll('#loading-map-css').length).toBe(1);
      expect(m.dom.doc.getElementById('loading-map-css')!.textContent).toBe(LOADING_CSS);
      new LoadingMapView(m.host as unknown as HTMLElement, m.dom.doc as unknown as Document);
      expect(m.dom.doc.head.querySelectorAll('#loading-map-css').length).toBe(1);
    } finally { m.dom.uninstall(); }
  });

  it('shows exactly the frame of the load\'s progress at every report, and the finished map only on complete()', () => {
    const m = mount();
    try {
      const meter: LoadMeter = m.view;
      const reports: [LoadStage, number][] = [['props', 0.1], ['props', 0.55], ['props', 1], ['textures', 0.5], ['graphics', 0], ['graphics', 0.31], ['graphics', 0.3], ['graphics', 0.77], ['graphics', 1]];
      let last = 0;
      for (const [s, f] of reports) {
        meter.stage(s, f);
        expect(m.view.value).toBeGreaterThanOrEqual(last);
        last = m.view.value;
        m.matches(last);
        expect(m.shown().stations.every(Boolean)).toBe(false);
      }
      expect(last).toBeCloseTo(LOAD_STAGES.graphics[1], 12);
      meter.complete();
      expect(m.view.value).toBe(1);
      m.matches(1);
      expect(m.shown().lines.every(v => v === 1)).toBe(true);
      expect(m.shown().stations.every(Boolean)).toBe(true);
    } finally { m.dom.uninstall(); }
  });

  it('reset() starts the next load on a fresh empty map (new elements: the finished lines do not animate away)', () => {
    const m = mount();
    try {
      m.view.stage('graphics', 1);
      m.view.complete();
      const before = m.lines()[0];
      m.view.reset();
      expect(m.view.value).toBe(0);
      expect(m.lines()[0]).not.toBe(before);
      m.matches(0);
      m.view.stage('props', 0.5);
      m.matches(LOAD_STAGES.props[1] * 0.5);
    } finally { m.dom.uninstall(); }
  });
});

describe('the screen around it (index.html, styles)', () => {
  const html = SRC('index.html');
  const card = /<div class="loading-card">[\s\S]*?\n {6}<\/div>/.exec(html)![0];

  it('the loading card: the place name, the map\'s mount, the exact caption under it; the bar is gone, the status line stays', () => {
    expect(card).toContain('<h2 id="station-intro" class="loading-place"></h2>');
    expect(card).toContain('<div id="loading-map" class="loading-map"></div>');
    expect(card).toContain('<p class="loading-goal">The Reactor .... Restart the Reactor</p>');
    expect(card.indexOf('id="station-intro"')).toBeLessThan(card.indexOf('id="loading-map"'));
    expect(card.indexOf('id="loading-map"')).toBeLessThan(card.indexOf('class="loading-goal"'));
    expect(card).not.toMatch(/class="(track|fill)"/);
    expect(card).toContain('<div id="load"><div class="label" role="status" aria-live="polite">Loading…</div></div>');
    expect(html.match(/The Reactor \.\.\.\. Restart the Reactor/g)).toHaveLength(1);
    expect(`${SRC('src/game.ts')}\n${SRC('src/main.ts')}`).not.toMatch(/#load \.fill/);
  });

  it('the caption is quiet: body font, regular weight, small, dimmed, not transformed or animated', () => {
    const rule = /\.loading-card \.loading-goal \{([^}]*)\}/.exec(LOADING_CSS)![1];
    expect(rule).toMatch(/font-weight: 400;/);
    expect(rule).toMatch(/color: var\(--cream-dim\);/);
    expect(Number(/font-size: (\d+)px;/.exec(rule)![1])).toBeLessThanOrEqual(16);
    expect(rule).not.toMatch(/text-transform|animation|text-shadow|font-family|var\(--mustard\)|var\(--red\)/);
    const place = Number(/\.loading-place \{ font-size: (\d+)px;/.exec(LOADING_CSS)![1]);
    expect(Number(/font-size: (\d+)px;/.exec(rule)![1])).toBeLessThan(place / 1.5);
  });

  it('the loading screen is opaque: no translucent background, no blur of the canvas, no menu backdrop fading through', () => {
    const rule = /#title\[data-mode="loading"\]\.screen \{([^}]*)\}/.exec(LOADING_CSS)![1];
    expect(rule).toMatch(/background: radial-gradient\(/);
    expect(rule).not.toMatch(/rgba\(|transparent|hsla\(|\/ ?0?\.\d/);
    for (const c of rule.match(/#[0-9a-f]+/gi)!) expect(c).toMatch(/^#[0-9a-f]{6}$/i); // (no 8-digit / 4-digit alpha colours)
    expect(rule).toMatch(/backdrop-filter: none;/);
    expect(LOADING_CSS).toMatch(/#title\[data-mode="loading"\] #title-backdrop \{ display: none; \}/);
    // the old see-through card is gone from the menu's styles; the menu still hides the card and the loading mode the menu
    const menu = SRC('src/ui/mainMenu.ts');
    expect(menu).not.toMatch(/data-mode="loading"\]\.screen/);
    expect(menu).toContain('#title[data-mode="menu"] .loading-card { display: none; }');
    expect(menu).toContain('#title[data-mode="loading"] .mm-side, #title[data-mode="loading"] .mm-overlay { display: none; }');
  });

  it('a short window drops the renderer badge from the loading screen only (it would sit on the caption); the menu keeps it', () => {
    const rules = [...LOADING_CSS.matchAll(/^.*\.gpu-badge.*$/gm)].map(m => m[0]);
    expect(rules).toEqual(['@media (max-height: 560px) { #title[data-mode="loading"] > .gpu-badge { display: none; } }']);
    // the badge is still a direct child of #title, where that selector finds it
    expect(SRC('src/render/backend.ts')).toMatch(/for \(const id of \['title', 'pause'\]\)[\s\S]{0,200}':scope > \.gpu-badge'/);
  });

  it('the map\'s motion is a short visual smoothing only, and it is off for reduced motion', () => {
    const times = [...LOADING_CSS.matchAll(/transition: ([^;]+);/g)].flatMap(m => [...m[1].matchAll(/([\d.]+)s/g)].map(t => Number(t[1])));
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) expect(t).toBeLessThanOrEqual(0.3);
    expect(LOADING_CSS).not.toMatch(/animation|@keyframes|transition-delay/);
    expect(LOADING_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.lm-line, \.lm-st \{ transition: none; \} \}/);
  });
});

describe('game.ts: the map is told the truth, and only the loading screen changed', () => {
  const game = SRC('src/game.ts'), main = SRC('src/main.ts');
  const body = (from: string, to: string) => { const a = game.indexOf(from); expect(a, from).toBeGreaterThan(0); const b = game.indexOf(to, a + from.length); expect(b, to).toBeGreaterThan(a); return game.slice(a, b); };

  it('main.ts mounts the view on the loading card and gives it to the game', () => {
    expect(main).toMatch(/game\.loadMeter = new LoadingMapView\(\$\('#loading-map'\)\);/);
  });

  it('each stage reports where the bar was written: the models, the mall\'s textures, the warm-up (re-zeroed, then per unit)', () => {
    expect(body('  private progressTo(', '\n  }')).toContain("ui.meter?.stage('props', f);");
    expect(body('  private async stageLevelTextures(', '\n  }')).toContain("progress: (done, total) => { ui.meter?.stage('textures', done / Math.max(1, total)); },");
    const warm = body('  private async runWarmup(', '\n  }');
    expect(warm).toContain("meter?.stage('graphics', 0);");
    expect(warm).toContain("onProgress: (p: WarmupProgress) => { meter?.stage('graphics', p.done / Math.max(1, p.total)); label.textContent = warmupLabel(p); },");
    expect(game.match(/meter\?\.stage\(/g)).toHaveLength(4);
    expect(body('  private showLoading(', '\n  }')).toContain('ui.meter?.reset();');
  });

  it('the map is finished in ONE place, readyLine, which every load reaches only after its warm-up has resolved', () => {
    expect(game.match(/meter\?\.complete\(\)/g)).toHaveLength(1);
    expect(body('  private readyLine(', '\n  }')).toContain('ui.meter?.complete();');
    const calls = [...game.matchAll(/this\.readyLine\(ui, w\);/g)];
    expect(calls).toHaveLength(4); // continue / new game / retry / menu travel
    for (const c of calls) {
      const before = game.slice(c.index! - 320, c.index!);
      expect(before).toMatch(/const w = await this\.prepareGraphics\(ui\);[^\n]*\n\s*if \(w\.status === 'cancelled'\) return [^\n]*\n\s*$/);
    }
    // and nothing waits on the map: no timer / frame wait between "ready" and entering play
    const ready = body('  private readyLine(', '\n  }');
    expect(ready).not.toMatch(/await|setTimeout|requestAnimationFrame|then\(/);
  });

  it('loading -> play: the screen is put back over the canvas until a frame of play is drawn, then goes; play is not held', () => {
    const classes = new Set<string>(['screen', 'hidden']); // (setState has just hidden it)
    const screen = {classList: {add: (c: string) => { classes.add(c); }, remove: (c: string) => { classes.delete(c); }}};
    let state = 'playing';
    const queue: (() => void)[] = [];
    coverUntilPlayDrawn(screen, () => state === 'playing', fn => queue.push(fn));
    expect(classes.has('hidden')).toBe(false); // still covering: the canvas holds the pre-play frame
    expect(queue).toHaveLength(1); // one callback after the loop's frame; no timer, nothing awaited
    queue.shift()!();
    expect(classes.has('hidden')).toBe(true);
    // the state moved on before that frame (a pause, the menu, another load): setState owns the screens — nothing is hidden here
    for (const next of ['paused', 'title', 'loading', 'dead']) {
      classes.delete('hidden'); // (as setState left it for a state that shows the title; for the others it re-hid it itself)
      state = 'playing';
      coverUntilPlayDrawn(screen, () => state === 'playing', fn => queue.push(fn));
      state = next;
      queue.shift()!();
      expect(classes.has('hidden'), next).toBe(false);
    }
    // main.ts: only for a load that ends in play, on the next animation frame (the game loop's callback is registered before it)
    expect(main).toMatch(/if \(s === 'playing' && prev === 'loading'\) coverUntilPlayDrawn\(titleEl, \(\) => game\.state === 'playing', fn => requestAnimationFrame\(fn\)\);/);
    expect(main.indexOf('const loop = (time: number) =>')).toBeGreaterThan(0);
    const helper = SRC('src/ui/loadingScreen.ts');
    expect(helper.slice(helper.indexOf('export function coverUntilPlayDrawn'), helper.indexOf('/** What the death screen')).replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/setTimeout|await|Promise/);
  });

  it('the pause panel\'s re-warm has no map; the train journey never shows the loading screen', () => {
    expect(game).toContain('const w = await this.prepareGraphics({meter: null, label: line, button: resume});');
    const journey = body('  async travelToStation(', '\n  /**');
    expect(journey.length).toBeGreaterThan(3000);
    expect(journey).not.toMatch(/showLoading\(|loadMeter|meter\?\./);
  });
});
