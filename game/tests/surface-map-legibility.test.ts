// Task studio-surface-map-tent-cab-20261119-025201-01 (lane MAP): THE PLANNING MAP'S LEGIBILITY on REAL generated districts (Subway,
// Office and Mall hosts at surface version 2 — among them the user's own district: network 2's st-02 "Marlwick Tower", an Office host,
// levelSeed 61488949, "Easton Flats"). User: "the diagonal lines and overlapping text make it hard to read" — "I like the vibe! a lot!".
// States like theirs: the player at the tent's map table, the truck at its parked pose, every generated note, reports (an entered shop,
// the depot's units from the cargo lane, entered / searched / hostile figures, broken windows of explored buildings), the fog mostly
// unexplored (early) and partly explored (a walk through the core):
//  - no two placed label boxes overlap; no label covers a symbol (destination frames, note glyphs, blocked spans, the way back, YOU /
//    TRUCK); every label stays on the sheet; no leader runs through another label; the placer never had to overlap (stats.overlap 0);
//  - every marker of the model is drawn — its symbol at the model's own point (data-at) and its text visible in its label (the
//    checkpoint: its compound at the real place + the callout with CHECKPOINT and its notes); the model is not touched by drawing;
//  - the YOU / TRUCK / CHECKPOINT / way back / checkpoint note / nearby destination pile-up at the tent: all readable, none overlapping;
//  - a street name is printed (on its own street) or, only when the same name is printed nearby, skipped — never anything else;
//  - unexplored ground: a lighter wash and a sparser, finer, fainter hatch than before (6 m, 1.1 m lines at 0.45 over a 0.26 tint), the
//    legend swatch the same pattern with the same edge, the edge exactly between explored and unexplored cells; the table-top canvas
//    draws the same fog and its labels (YOU, TRUCK, destination names) without overlaps;
//  - the text estimate matches the user's sheet (their bold Arial names) and long notes / names wrap at a space.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {EXPLORE, exploreGridFor, isSet, markDisc} from '../src/world/surface/mapExplore';
import {buildPlanningMap, type MapState, type PlanningMap} from '../src/world/surface/mapModel';
import {MAP_FOG, MAP_FONT, MAP_WRAP, drawPlanningCanvas, fogEdges, layoutPlanningLabels, renderPlanningSvg, type MapCtx} from '../src/world/surface/mapDraw';
import {LABEL_RINGS, LINE, overlaps, placeLabels, segmentHitsBox, textWidth, wrapText, type LBox, type LabelReq} from '../src/world/surface/mapLabels';

type Host = 'subway' | 'office' | 'mall';
/** The user's district (network seed 2, st-02 Marlwick Tower) and other real v2 districts per host. */
const DISTRICTS: readonly [Host, number][] = [['office', 61488949], ['office', 9], ['subway', 7], ['subway', 21], ['mall', 13], ['mall', 4]];

const cache = new Map<string, SurfaceInfo>();
function district(host: Host, seed: number): SurfaceInfo {
  const key = `${host}:${seed}`;
  let s = cache.get(key);
  if (!s) {
    s = LEVELS[host].generate('surface', {levelSeed: seed, surfaceVersion: 2}).surface as SurfaceInfo;
    expect(s, key).toBeTruthy();
    s.portal.label ||= 'Back inside';
    cache.set(key, s);
  }
  return s;
}

const centre = (r: {x0: number; z0: number; x1: number; z1: number}) => ({x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2});

/** A run state like the user's: at the tent's map table, the truck parked, a shop near the tent entered, the cargo lane's depot report. */
function state(s: SurfaceInfo, explored: 'early' | 'partly'): MapState {
  const g = exploreGridFor(s.extent), r = s.checkpoint.mapTable.read, cp = centre(s.checkpoint.rect);
  markDisc(g, s.portal.pose.x, s.portal.pose.z, EXPLORE.revealM);
  markDisc(g, r.x, r.z, EXPLORE.revealM);
  const shops = s.buildings.filter(b => b.destination && b.enterable && b.id !== s.depot.building)
    .sort((a, b) => Math.hypot(centre(a.footprint).x - cp.x, centre(a.footprint).z - cp.z) - Math.hypot(centre(b.footprint).x - cp.x, centre(b.footprint).z - cp.z));
  const entered = shops.slice(0, explored === 'early' ? 1 : 4);
  for (const b of entered) markDisc(g, centre(b.footprint).x, centre(b.footprint).z, EXPLORE.interiorRevealM);
  if (explored === 'partly') { // a walk across the core and back along another street
    const C = s.core;
    for (let t = 0; t <= 1; t += 0.04) markDisc(g, C.x0 + (C.x1 - C.x0) * t, (C.z0 + C.z1) / 2, EXPLORE.revealM);
    for (let t = 0; t <= 1; t += 0.04) markDisc(g, (C.x0 + C.x1) / 2, C.z0 + (C.z1 - C.z0) * t, EXPLORE.revealM);
  }
  const stats = new Map(entered.map((b, i) => [b.id, [{holders: 5, searched: 1, hostiles: 0, down: 0}, {holders: 7, searched: 7, hostiles: 3, down: 3}, {holders: 0, searched: 0, hostiles: 4, down: 1}, {holders: 3, searched: 2, hostiles: 2, down: 1}][i % 4]]));
  const depot = centre(s.buildings.find(b => b.id === s.depot.building)!.footprint);
  return {
    explore: g, entered: new Set(entered.map(b => b.id)), stats,
    reports: [{...depot, text: 'Depot: 1 of 1 train unit here (item scanner)', kind: 'supply', source: 'cargo', key: 'recoverables'}],
    player: {x: r.x, z: r.z, yaw: r.yaw}, truck: {x: s.truck.x, z: s.truck.z, yaw: s.truck.yaw},
  };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** The SVG's label groups: id, member markers and the visible text (its lines joined by a space). */
function svgLabels(svg: string): Map<string, {markers: string[]; text: string; lines: string[]}> {
  const out = new Map<string, {markers: string[]; text: string; lines: string[]}>();
  for (const g of svg.matchAll(/<g class="spm-label [^"]*" data-label="([^"]*)" data-markers="([^"]*)">(.*?)<\/g>/g)) {
    const lines = [...g[3].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(t => unesc(t[1]));
    out.set(unesc(g[1]), {markers: g[2] ? g[2].split(' ') : [], text: lines.join(' '), lines});
  }
  return out;
}

function eachCase(f: (host: Host, seed: number, tag: 'early' | 'partly', s: SurfaceInfo, m: PlanningMap) => void) {
  for (const [host, seed] of DISTRICTS) for (const tag of ['early', 'partly'] as const) {
    const s = district(host, seed);
    f(host, seed, tag, s, buildPlanningMap(s, state(s, tag)));
  }
}

describe('Surface Run planning map: legible labels on real districts', () => {
  it('no label overlaps another label or any symbol; all on the sheet; no leader through other text; nothing forced', () => {
    eachCase((host, seed, tag, s, m) => {
      const key = `${host} ${seed} ${tag}`, L = layoutPlanningLabels(m), E = m.extent;
      expect(L.stats.overlap, key).toBe(0);
      expect(L.labels.length, key).toBe(L.stats.labels);
      for (let i = 0; i < L.labels.length; i++) {
        const a = L.labels[i].placed.box;
        expect(a.x0 >= E.x0 && a.x1 <= E.x1 && a.z0 >= E.z0 && a.z1 <= E.z1, `${key} ${L.labels[i].id} on the sheet`).toBe(true);
        for (let j = i + 1; j < L.labels.length; j++) expect(overlaps(a, L.labels[j].placed.box), `${key} ${L.labels[i].id} x ${L.labels[j].id}`).toBe(false);
        for (const ic of L.icons) expect(overlaps(a, ic.box), `${key} ${L.labels[i].id} over symbol ${ic.id}`).toBe(false);
        for (const f of L.fixed) expect(overlaps(a, f), `${key} ${L.labels[i].id} over AO CORE / title`).toBe(false);
        const l = L.labels[i].placed.leader;
        // (only a fallback flagged `crossed` — no clear line reached any free spot — may pass under other text)
        if (l && !L.labels[i].placed.crossed) for (let j = 0; j < L.labels.length; j++) if (j !== i) expect(segmentHitsBox(l[0], l[1], l[2], l[3], L.labels[j].placed.box), `${key} leader of ${L.labels[i].id} through ${L.labels[j].id}`).toBe(false);
        if (L.labels[i].placed.fallback) expect(l, `${key} ${L.labels[i].id}: a fallback keeps a leader`).not.toBeNull();
      }
      // the sheet reports its label statistics (QA)
      const svg = renderPlanningSvg(m);
      for (const [k, v] of [['fallback', L.stats.fallback], ['crossed', L.stats.crossed], ['overlap', 0], ['leaders', L.stats.leaders], ['displaced', L.stats.displaced]] as const) expect(svg, key).toContain(`data-label-${k}="${v}"`);
      expect(svg).toContain(`data-street-skipped="${L.stats.streetSkipped}"`);
      expect(L.stats.fallback, `${key}: fallbacks stay rare`).toBeLessThanOrEqual(8);
      expect(L.stats.crossed, `${key}: crossed leaders rarer still`).toBeLessThanOrEqual(2);
    });
  }, 120_000);

  it('every marker is drawn: its symbol at the model point, its text visible; drawing leaves the model untouched', () => {
    eachCase((host, seed, tag, s, m) => {
      const key = `${host} ${seed} ${tag}`, before = JSON.stringify(m);
      const svg = renderPlanningSvg(m), L = layoutPlanningLabels(m);
      expect(JSON.stringify(m), key).toBe(before);
      const labels = svgLabels(svg);
      const at = new Map([...svg.matchAll(/data-marker="([^"]+)" data-at="([^"]+)"/g)].map(g => [unesc(g[1]), g[2]]));
      const texts = (id: string) => [...labels.values()].filter(l => l.markers.includes(id));
      for (const mk of m.markers) {
        const callout = L.callout.includes(mk.id);
        // its symbol, at the model's own point
        if (!callout || mk.kind === 'checkpoint') expect(at.get(mk.id), `${key} ${mk.id} ${mk.kind} symbol`).toBe(`${n1(mk.x)},${n1(mk.z)}`);
        if (mk.kind === 'note' && !callout) { const g = L.glyphs.get(mk.id)!; expect(Math.hypot(g.x - mk.x, g.z - mk.z), `${key} ${mk.id} glyph beside its point`).toBeLessThanOrEqual(36); }
        if (mk.kind === 'blocked') continue; // (a symbol only: its note carries the words)
        // its text, visible in exactly one label
        const own = texts(mk.id);
        expect(own.length, `${key} ${mk.id} ${mk.kind} label`).toBe(1);
        const want = mk.kind === 'player' || mk.kind === 'truck' ? mk.label.toUpperCase() : mk.kind === 'checkpoint' ? 'CHECKPOINT' : mk.label;
        expect(own[0].text, `${key} ${mk.id}`).toContain(want);
        if (mk.kind === 'destination' || mk.kind === 'depot') expect(own[0].lines).toContain(mk.grid);
        if (callout) expect(own[0].markers[0], `${key} ${mk.id} in the checkpoint callout`).toBe(L.callout[0]);
      }
      // street names: printed on their street, or skipped only beside the same name printed nearby
      for (const st of m.streets.filter(q => q.label && q.name)) {
        const id = `s${st.id}`, lab = labels.get(id);
        if (lab) { expect(lab.text, key).toBe(st.name.toUpperCase()); continue; }
        expect(L.skipped, `${key} ${st.name}`).toContain(id);
        const near = L.labels.filter(l => l.kind === 'street' && l.lines[0].text === st.name.toUpperCase()).map(l => l.placed.box);
        expect(near.some(b => Math.hypot((b.x0 + b.x1) / 2 - st.label!.x, (b.z0 + b.z1) / 2 - st.label!.z) < LABEL_RINGS.sameName + 60), `${key} ${st.name} printed nearby`).toBe(true);
      }
    });
  }, 120_000);

  it("the tent pile-up: YOU, TRUCK, CHECKPOINT + its note, the way back and the destinations beside it are all readable", () => {
    const s = district('office', 61488949);
    expect(s.name).toBe('Easton Flats'); // (the user's district, as their screenshot shows it)
    s.portal.label = 'Back inside Marlwick Tower';
    const m = buildPlanningMap(s, state(s, 'early')), L = layoutPlanningLabels(m);
    const by = (kind: string) => L.labels.filter(l => l.kind === kind);
    const you = by('player')[0], truck = by('truck')[0], cp = by('callout')[0], portal = by('portal')[0];
    expect(you.lines[0].text).toBe('YOU');
    expect(truck.lines[0].text).toBe('TRUCK');
    expect(cp.lines[0].text).toBe('CHECKPOINT');
    expect(cp.lines.slice(1).map(l => l.text).join(' ')).toContain('Checkpoint: map table, radio, supply crates');
    expect(portal.lines[0].text).toBe('Back inside Marlwick Tower');
    // the YOU / TRUCK arrows stay at their real poses
    const r = s.checkpoint.mapTable.read;
    expect(m.markers.find(k => k.kind === 'player')).toMatchObject({x: r.x, z: r.z});
    expect(m.markers.find(k => k.kind === 'truck')).toMatchObject({x: s.truck.x, z: s.truck.z});
    // everything within 60 m of the compound: no two overlap, none over a symbol
    const C = s.checkpoint.rect, near: LBox = {x0: C.x0 - 60, z0: C.z0 - 60, x1: C.x1 + 60, z1: C.z1 + 60};
    const local = L.labels.filter(l => overlaps(l.placed.box, near));
    expect(local.length).toBeGreaterThanOrEqual(6);
    expect(local.some(l => l.kind === 'dest' && l.lines[0].text.startsWith('Starlite'))).toBe(true);
    for (const a of local) {
      for (const b of local) if (a !== b) expect(overlaps(a.placed.box, b.placed.box), `${a.id} x ${b.id}`).toBe(false);
      for (const ic of L.icons) expect(overlaps(a.placed.box, ic.box), `${a.id} over ${ic.id}`).toBe(false);
    }
    // the callout stands outside the compound (the compound itself is the place)
    expect(overlaps(cp.placed.box, C)).toBe(false);
  });
});

describe('Surface Run planning map: quieter fog, consistent legend and table copy', () => {
  it('unexplored ground is a lighter wash with a sparser, finer, fainter hatch; the legend swatch is the same', () => {
    const OLD = {spacing: 6, line: 1.1, lineOpacity: 0.45, washOpacity: 0.26}; // (main before this pass: mapDraw.ts spm-fog)
    expect(MAP_FOG.spacing).toBeGreaterThanOrEqual(OLD.spacing * 2);
    expect(MAP_FOG.line).toBeLessThanOrEqual(OLD.line / 2);
    expect(MAP_FOG.lineOpacity).toBeLessThan(OLD.lineOpacity * 0.75);
    expect(MAP_FOG.washOpacity).toBeLessThan(OLD.washOpacity * 0.6);
    expect(MAP_FOG.washOpacity).toBeGreaterThan(0.05); // (still clearly "not yet explored")
    const s = district('office', 61488949), m = buildPlanningMap(s, state(s, 'early')), svg = renderPlanningSvg(m);
    const pat = /<pattern id="spm-fog" width="([\d.]+)" height="([\d.]+)"[^>]*><rect [^>]*fill="([^"]+)" fill-opacity="([\d.]+)"\/><path [^>]*stroke="([^"]+)" stroke-width="([\d.]+)" stroke-opacity="([\d.]+)"\/><\/pattern>/.exec(svg)!;
    expect(pat, 'the fog pattern').toBeTruthy();
    expect(pat.slice(1).map(String)).toEqual([MAP_FOG.spacing, MAP_FOG.spacing, MAP_FOG.wash, MAP_FOG.washOpacity, MAP_FOG.hatch, MAP_FOG.line, MAP_FOG.lineOpacity].map(String));
    expect(svg).toContain('<g class="spm-fog" fill="url(#spm-fog)"');
    const swatch = /<g class="spm-legend-fog"[^>]*><rect [^>]*fill="url\(#spm-fog\)" stroke="([^"]+)" stroke-width="([\d.]+)"[^>]*stroke-dasharray="([^"]+)"/.exec(svg)!;
    expect(swatch, 'legend swatch').toBeTruthy();
    expect([swatch[1], swatch[2], swatch[3]]).toEqual([MAP_FOG.edge, String(MAP_FOG.edgeWidth), MAP_FOG.edgeDash]);
    expect(svg).toContain(`class="spm-fog-edge"`);
    expect(svg).toContain(`stroke-dasharray="${MAP_FOG.edgeDash}"`);
    expect(svg).toContain('Not yet explored');
    // buildings on unexplored ground are filled lighter than explored ones
    const op = new Map([...svg.matchAll(/data-building="(\d+)" fill="#bdb091" fill-opacity="([\d.]+)"/g)].map(g => [Number(g[1]), Number(g[2])]));
    for (const b of m.buildings.filter(q => q.condition === 'intact' && op.has(q.id))) expect(op.get(b.id), `building ${b.id}`).toBe(b.explored || b.entered ? 0.6 : MAP_FOG.building);
  });

  it('the fog edge lies exactly between unexplored and explored cells', () => {
    const s = district('subway', 7), st = state(s, 'partly'), g = st.explore, F = buildPlanningMap(s, st).fog;
    const fog = (c: number, r: number) => !isSet(g, r * g.w + c);
    const edges = fogEdges(F);
    expect(edges.length).toBeGreaterThan(10);
    for (const [x0, z0, x1, z1] of edges) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let t = F.cell / 2; t < len; t += F.cell) { // each cell side along it: fog on one side, explored on the other
        const x = x0 + (x1 - x0) / len * t, z = z0 + (z1 - z0) / len * t;
        const [a, b] = z0 === z1 ? [[Math.floor((x - F.x0) / F.cell), Math.round((z - F.z0) / F.cell) - 1], [Math.floor((x - F.x0) / F.cell), Math.round((z - F.z0) / F.cell)]]
          : [[Math.round((x - F.x0) / F.cell) - 1, Math.floor((z - F.z0) / F.cell)], [Math.round((x - F.x0) / F.cell), Math.floor((z - F.z0) / F.cell)]];
        expect(fog(a[0], a[1]), `${x},${z}`).not.toBe(fog(b[0], b[1]));
      }
    }
    // and every such boundary is drawn (count the cell sides)
    let sides = 0;
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) { if (c > 0 && fog(c - 1, r) !== fog(c, r)) sides++; if (r > 0 && fog(c, r - 1) !== fog(c, r)) sides++; }
    expect(edges.reduce((n, [x0, z0, x1, z1]) => n + Math.round(Math.hypot(x1 - x0, z1 - z0) / F.cell), 0)).toBe(sides);
  });

  it('the table-top canvas: the same fog wash, hatch and edge; YOU, TRUCK and every destination name drawn without overlaps', () => {
    for (const [host, seed] of [['office', 61488949], ['subway', 7], ['mall', 13]] as const) {
      const s = district(host, seed), m = buildPlanningMap(s, state(s, 'early'));
      const texts: {t: string; x: number; y: number; size: number; align: string; w: number | undefined}[] = [];
      const alphas: [string, number][] = [];
      const ctx = {fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, font: '', textAlign: 'left', globalAlpha: 1,
        save() {}, restore() {}, setTransform() {}, fillRect() { alphas.push(['fill:' + String(this.fillStyle), this.globalAlpha]); }, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
        stroke() { alphas.push(['stroke:' + String(this.strokeStyle), this.globalAlpha]); }, arc() {},
        fillText(t: string, x: number, y: number, w?: number) { texts.push({t, x, y, size: Number(/(\d+)px/.exec(this.font)![1]), align: this.textAlign, w}); },
      };
      drawPlanningCanvas(ctx as MapCtx, m, 1024);
      expect(alphas).toContainEqual(['fill:' + MAP_FOG.wash, MAP_FOG.washOpacity]);
      expect(alphas).toContainEqual(['stroke:' + MAP_FOG.hatch, MAP_FOG.lineOpacity]);
      expect(alphas).toContainEqual(['stroke:' + MAP_FOG.edge, MAP_FOG.edgeOpacity]);
      const labels = texts.filter(t => t.w !== undefined); // (the grid references in the margin carry no width)
      const box = (t: typeof texts[number]): LBox => {
        const x0 = t.align === 'left' ? t.x : t.align === 'right' ? t.x - t.w! : t.x - t.w! / 2;
        return {x0, z0: t.y - t.size * LINE.ascent, x1: x0 + t.w!, z1: t.y + t.size * LINE.descent};
      };
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(overlaps(box(labels[i]), box(labels[j])), `${host} ${labels[i].t} x ${labels[j].t}`).toBe(false);
      const shown = labels.map(t => t.t).join(' ');
      expect(shown).toContain('YOU');
      expect(shown).toContain('TRUCK');
      for (const mk of m.markers.filter(k => k.kind === 'destination' || k.kind === 'depot')) expect(shown, mk.label).toContain(wrapText(mk.label, MAP_WRAP.name)[0]);
      expect(labels.filter(t => t.t !== 'YOU' && t.t !== 'TRUCK').length).toBeGreaterThanOrEqual(m.markers.filter(k => k.kind === 'destination' || k.kind === 'depot').length);
    }
  });
});

describe('Surface Run planning map: the label placer', () => {
  it("estimates text as the user's sheet draws it; wraps long notes and names at a space", () => {
    // measured off their screenshot (5.63 px per metre): the bold name 87.4 m, the cursive note 77.4 m, the caps street name 66 m
    expect(Math.abs(textWidth('Commerce Hardware & Paint', {size: 6.4, bold: true}) - 87.4)).toBeLessThan(2);
    expect(Math.abs(textWidth('Movement inside 6th Rail Depot', {size: 6, cursive: true}) - 77.4)).toBeLessThan(4);
    expect(Math.abs(textWidth('COMMERCE AVENUE', {size: 6, track: 0.4}) - 66)).toBeLessThan(4);
    expect(wrapText('Kwik-E Corner: food and water, not yet searched', MAP_WRAP.note)).toEqual(['Kwik-E Corner: food and water,', 'not yet searched']);
    expect(wrapText('Checkpoint: map table, radio, supply crates', MAP_WRAP.note).join(' ')).toBe('Checkpoint: map table, radio, supply crates');
    expect(wrapText('Abandoned roadblock', MAP_WRAP.note)).toEqual(['Abandoned roadblock']);
    expect(wrapText('Commerce Hardware & Paint', MAP_WRAP.name)).toHaveLength(2);
    expect(MAP_FONT.note.size).toBeGreaterThanOrEqual(6); // (legibility: never smaller than before)
    expect(MAP_FONT.report.size).toBeGreaterThanOrEqual(4.8);
    expect(MAP_FONT.name.size).toBeGreaterThanOrEqual(6.4);
  });

  it('a crowd at one point: every label printed, none overlapping, the far ones with leaders and counted', () => {
    const reqs: LabelReq[] = Array.from({length: 40}, (_, i) => ({id: `l${i}`, ax: 100, az: 100, anchor: {x0: 97, z0: 97, x1: 103, z1: 103}, w: 30, h: 7, dirs: ['S', 'N', 'E', 'W', 'SE', 'SW', 'NE', 'NW']}));
    const res = placeLabels(reqs, [{box: {x0: 97, z0: 97, x1: 103, z1: 103}, tag: 'icon'}], {x0: 0, z0: 0, x1: 260, z1: 260});
    expect(res.placed.map(p => p.id)).toEqual(reqs.map(q => q.id)); // (priority order kept, nothing dropped)
    expect(res.stats.overlap).toBe(0);
    for (let i = 0; i < res.placed.length; i++) for (let j = i + 1; j < res.placed.length; j++) expect(overlaps(res.placed[i].box, res.placed[j].box)).toBe(false);
    expect(res.stats.fallback).toBeGreaterThan(0);
    expect(res.stats.fallback).toBe(res.placed.filter(p => p.fallback).length);
    for (const p of res.placed.filter(q => q.ring > 0 || q.fallback)) expect(p.leader).not.toBeNull();
    // deterministic
    expect(placeLabels(reqs, [{box: {x0: 97, z0: 97, x1: 103, z1: 103}, tag: 'icon'}], {x0: 0, z0: 0, x1: 260, z1: 260})).toEqual(res);
  });
});
