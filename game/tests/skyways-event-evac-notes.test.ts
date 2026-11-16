// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the evacuation centre's NOTES — the authored pool
// (gen/skyways/events/evacNotes.ts: short, readable, every story theme covered), their paper painters (world/skywaysEvacDraw.ts:
// dynamic canvas text, every word drawn on the paper) and the close-up READ (world/skywaysNotes.ts): the "[E] Read the note" prompt in
// reach while looking at a note, the paper overlay opening / closing (E, Esc, walking off, turning away, leaving play), pinned notes
// only from in front of their board, nothing solid between, inert without notes, and reading unlocks / changes nothing.

import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import type {PropPlacement} from '../src/gen/props';
import {EVAC_NOTES, EVAC_NOTE_THEMES, evacNoteText, type EvacNoteSlot} from '../src/gen/skyways/events/evacNotes';
import {EVAC_SPECS, EVAC_WARN_TEXTS, evacNoteOf, evacNoteVariant} from '../src/gen/skyways/events/evacKinds';
import {EVAC_PAINTERS} from '../src/world/skywaysEvacDraw';
import {SKYWAYS_EVENT_PAINTER_IDS} from '../src/world/skywaysEventDraw';
import {NOTE_READ, SkywaysNotes, installSkywaysNotes, noteOfProp, skywaysNotesOf, type SkywaysNotesHost} from '../src/world/skywaysNotes';
import {installFakeDom, type FakeDom, type FakeEl} from './helpers/fakeDom';

const SLOTS: readonly EvacNoteSlot[] = ['desk', 'board', 'medical', 'bed', 'rations', 'quarantine', 'family', 'office'];
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(s => /\w/.test(s));

describe('evacuation centre notes: the authored pool', () => {
  it('short, readable notes: unique ids, 2-5 sentences, at most 200 characters of body, a place to lie', () => {
    expect(EVAC_NOTES.length).toBeGreaterThanOrEqual(14);
    expect(EVAC_NOTES.length).toBeLessThan(32); // (a note variant's text index stays below the pinned offset)
    expect(new Set(EVAC_NOTES.map(n => n.id)).size).toBe(EVAC_NOTES.length);
    for (const n of EVAC_NOTES) {
      expect(n.id).toMatch(/^[a-z0-9-]+$/);
      const k = sentences(n.body).length;
      expect(k, n.id).toBeGreaterThanOrEqual(2);
      expect(k, n.id).toBeLessThanOrEqual(5);
      expect(n.body.length, n.id).toBeLessThanOrEqual(200);
      if (n.title) expect(n.title.length, n.id).toBeLessThanOrEqual(30);
      expect(n.at.length, n.id).toBeGreaterThan(0);
      for (const s of n.at) expect(SLOTS, n.id).toContain(s);
      expect(n.themes.length, n.id).toBeGreaterThan(0);
      const text = evacNoteText(n);
      expect(text).toContain(n.body);
      if (n.title) expect(text.startsWith(n.title)).toBe(true);
      if (n.sign) expect(text).toContain(`- ${n.sign}`);
    }
  });

  it('the story: ventilation failed, people turning, the reactor overrun — each theme in at least four notes, in its own words', () => {
    for (const t of EVAC_NOTE_THEMES) expect(EVAC_NOTES.filter(n => n.themes.includes(t)).length, t).toBeGreaterThanOrEqual(4);
    const words = {vent: /\b(air|filters?|fans?|vents?|extractor|ventilation|gas|seals?)\b/i, sick: /\b(fever|bit|bite|sick|isolation|turning|sleeping)\b/i,
      plant: /\b(reactor|plant)\b/i} as const;
    for (const n of EVAC_NOTES) for (const t of n.themes) expect(`${n.title ?? ''} ${n.body}`, `${n.id} ${t}`).toMatch(words[t]);
    // every place a note can lie has notes of its own; the barricaded room's notes tell of the sick
    for (const s of SLOTS) expect(EVAC_NOTES.some(n => n.at.includes(s)), s).toBe(true);
    for (const n of EVAC_NOTES.filter(x => x.at.includes('quarantine'))) expect(n.themes, n.id).toContain('sick');
    // environmental storytelling only: no codes, coordinates or loot pointers
    for (const n of EVAC_NOTES) expect(evacNoteText(n), n.id).not.toMatch(/\b(code|password|combination|keycard|stash|hidden)\b/i);
  });
});

/** A recording 2D context (no pixels): text widths from the font's px size times `wide`. */
function recorder(wide = 0.55) {
  const ops: {op: string; args: unknown[]; font: string; fill: string}[] = [];
  const st = {fillStyle: '', strokeStyle: '', lineWidth: 1, font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic'};
  const rec = (op: string) => (...args: unknown[]) => { ops.push({op, args, font: st.font, fill: String(st.fillStyle)}); };
  const ctx = Object.assign(st, {
    fillRect: rec('fillRect'), fillText: rec('fillText'), strokeRect: rec('strokeRect'),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {},
    measureText: (t: string) => ({width: t.length * Number(/(\d+)px/.exec(st.font)?.[1] ?? 10) * wide}),
  });
  return {ctx: ctx as unknown as CanvasRenderingContext2D, ops};
}
const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean);
const px = (font: string) => Number(/(\d+)px/.exec(font)?.[1] ?? 0);

describe('evacuation centre notes: the paper painters (dynamic canvas text)', () => {
  it('the note / warning faces name registered painters', () => {
    for (const id of ['evac-note', 'evac-warn']) expect(SKYWAYS_EVENT_PAINTER_IDS).toContain(id);
    for (const v of [evacNoteVariant(0, false), evacNoteVariant(3, true)]) for (const f of EVAC_SPECS.evacNote.faces!(v)) expect(f.paint).toBe('evac-note');
    for (const f of EVAC_SPECS.evacWarnBoard.faces!(0)) expect(f.paint).toBe('evac-warn');
  });

  it('every note fills its whole paper and writes its title, every word of its body and its signature (also with a wide fallback face)', () => {
    const P = EVAC_PAINTERS['evac-note'], [w, h] = P.px;
    for (const wide of [0.55, 0.72]) for (const [i, n] of EVAC_NOTES.entries()) for (const pinned of [false, true]) {
      const {ctx, ops} = recorder(wide);
      P.draw(ctx, w, h, evacNoteVariant(i, pinned));
      expect(evacNoteOf(evacNoteVariant(i, pinned))).toEqual({index: i, pinned});
      // the first fill covers the whole quad (an opaque paper: no transparent corners on the face)
      expect(ops[0].op).toBe('fillRect');
      expect(ops[0].args).toEqual([0, 0, w, h]);
      const texts = ops.filter(o => o.op === 'fillText').map(o => String(o.args[0]));
      const drawn = wordsOf(texts.join(' '));
      for (const word of wordsOf(n.body)) expect(drawn, `${n.id} (${wide}): ${word}`).toContain(word);
      if (n.title) for (const word of wordsOf(n.title)) expect(drawn, n.id).toContain(word);
      if (n.sign) expect(texts, n.id).toContain(`- ${n.sign}`);
      // every line inside the paper's width (wrapped / fitted to the measured width), at a readable size
      for (const o of ops.filter(x => x.op === 'fillText')) {
        expect(px(o.font), n.id).toBeGreaterThanOrEqual(16);
        expect(String(o.args[0]).length * px(o.font) * wide, `${n.id} (${wide}): ${o.args[0]}`).toBeLessThanOrEqual(w * 0.92);
      }
    }
  });

  it('a warning board paints both of its lines over a whole whitewash coat', () => {
    const P = EVAC_PAINTERS['evac-warn'], [w, h] = P.px;
    for (const wide of [0.55, 0.8]) for (const [v, lines] of EVAC_WARN_TEXTS.entries()) {
      const {ctx, ops} = recorder(wide);
      P.draw(ctx, w, h, v);
      expect(ops[0]).toMatchObject({op: 'fillRect', args: [0, 0, w, h]});
      const texts = ops.filter(o => o.op === 'fillText');
      expect(texts.map(o => o.args[0])).toEqual([...lines]);
      // big letters, never running off the sheet (a wide fallback face shrinks)
      for (const o of texts) {
        expect(px(o.font)).toBeGreaterThanOrEqual(h * 0.12);
        expect(String(o.args[0]).length * px(o.font) * wide).toBeLessThanOrEqual(w * 0.9);
      }
    }
  });
});

/** A fake grid: every cell floor except the `walls` (cell keys "x,y"). */
function fakeLayout(notes: Partial<PropPlacement>[], walls: string[] = []): StationLayout {
  const w = 40, h = 40, cells = new Uint8Array(w * h).fill(FLOOR);
  for (const k of walls) { const [x, y] = k.split(',').map(Number); cells[y * w + x] = 0; }
  const grid = {w, h, cells, inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h, idx: (x: number, y: number) => y * w + x};
  const props = notes.map(n => ({kind: 'evacNote', area: 0, hx: 0.1, hz: 0.14, rot: 0, variant: 0, ...n}) as PropPlacement);
  return {props, pickups: [], levels: [{grid}], grid} as unknown as StationLayout;
}
function gameHost(layout: StationLayout): SkywaysNotesHost & {player: {x: number; y: number; z: number; yaw: number}; state: string} {
  return {player: {x: 0, y: 0, z: 0, yaw: 0}, layout, state: 'playing', interactHandlers: [], frameHooks: [], sectionHooks: [], promptProviders: []};
}
/** Stand at (x, z) looking at (tx, tz). */
const lookAt = (h: SkywaysNotesHost, x: number, z: number, tx: number, tz: number, y = 0) => Object.assign(h.player, {x, z, y, yaw: Math.atan2(-(tx - x), -(tz - z))});
const tick = (h: SkywaysNotesHost) => { for (const f of h.frameHooks) f(1 / 60); };
const prompt = (h: SkywaysNotesHost) => h.promptProviders!.map(p => p()).find(Boolean) ?? null;
const pressE = (h: SkywaysNotesHost) => h.interactHandlers.some(f => f());

describe('evacuation centre notes: the close-up read (world/skywaysNotes.ts)', () => {
  let dom: FakeDom;
  const keys: ((e: unknown) => void)[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  let prevWin: unknown;
  beforeEach(() => {
    prevWin = g.window;
    keys.length = 0;
    g.window = {addEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') keys.push(f); }, removeEventListener() {}, innerWidth: 1280, innerHeight: 720};
    dom = installFakeDom();
  });
  afterEach(() => { dom.uninstall(); g.window = prevWin; });
  const overlay = () => dom.doc.body.children.find(c => c.id === 'skyways-note-read') as FakeEl | undefined;

  it('the Game installs it (one call in its constructor); inert where a layout has no notes', () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/installSkywaysNotes\(this\)/);
    const h = gameHost(fakeLayout([]));
    const rt = installSkywaysNotes(h);
    expect(skywaysNotesOf(h)).toBe(rt);
    for (const s of h.sectionHooks) s.build?.(h.layout);
    tick(h);
    expect(prompt(h)).toBe(null);
    expect(pressE(h)).toBe(false);
    expect(overlay()).toBeUndefined();
  });

  it('reach, height, facing, line of sight; a pinned note only from in front of its board; of two side by side the one looked at', () => {
    // a floor note at (10.25, 10.25) (cell 20, 20); a pinned pair on a board facing +z (rot 0) at z 15.0, 1.4 m up
    const L = fakeLayout([
      {x: 10.25, y: 0, z: 10.25, variant: evacNoteVariant(4, false)},
      {x: 15.0, y: 1.4, z: 15.0, mounted: true, rot: 0, variant: evacNoteVariant(0, true)},
      {x: 15.36, y: 1.4, z: 15.0, mounted: true, rot: 0, variant: evacNoteVariant(10, true)},
    ]);
    const h = gameHost(L), rt = new SkywaysNotes(h).install();
    rt.build(L);
    const [floor, pinA, pinB] = L.props;
    lookAt(h, 10.25, 11.25, 10.25, 10.25); tick(h);
    expect(rt.target).toBe(floor);
    expect(prompt(h)).toBe('<b>[E]</b> Read the note');
    lookAt(h, 10.25, 10.25 + NOTE_READ.reach + 0.2, 10.25, 10.25); tick(h);
    expect(rt.target, 'out of reach').toBe(null);
    lookAt(h, 10.25, 11.25, 10.25, 10.25, -3); tick(h);
    expect(rt.target, 'a storey below').toBe(null);
    lookAt(h, 10.25, 11.25, 10.25, 10.25); h.player.yaw += Math.PI; tick(h);
    expect(rt.target, 'looking away').toBe(null);
    lookAt(h, 10.25, 11.25, 10.25, 10.25); h.player.yaw += NOTE_READ.look + 0.1; tick(h);
    expect(rt.target, 'out of the corner of the eye').toBe(null);
    // the pinned pair: from in front (+z) the one looked at; from behind neither
    lookAt(h, 15.0, 16.0, 15.0, 15.0); tick(h);
    expect(rt.target).toBe(pinA);
    lookAt(h, 15.36, 16.0, 15.36, 15.0); tick(h);
    expect(rt.target).toBe(pinB);
    lookAt(h, 15.2, 14.2, 15.2, 15.0); tick(h);
    expect(rt.target, 'behind the board').toBe(null);
    // line of sight: a solid cell elsewhere changes nothing; one on the line between hides the note
    for (const [cell, seen] of [['10,21', true], ['20,21', false]] as const) {
      const W = fakeLayout([{x: 10.25, y: 0, z: 10.25, variant: evacNoteVariant(4, false)}], [cell]);
      const hw = gameHost(W), rw = new SkywaysNotes(hw).install();
      rw.build(W);
      lookAt(hw, 10.25, 11.4, 10.25, 10.25); tick(hw);
      expect(rw.target, `solid cell ${cell}`).toBe(seen ? W.props[0] : null);
    }
  });

  it('E opens the paper with the note\'s own text; E / Esc / walking off / turning away / leaving play close it', () => {
    const L = fakeLayout([{x: 10.25, y: 0, z: 10.25, variant: evacNoteVariant(4, false)}]);
    const h = gameHost(L), rt = installSkywaysNotes(h), p = L.props[0], n = noteOfProp(p)!;
    for (const s of h.sectionHooks) s.build?.(L);
    lookAt(h, 10.25, 11.2, 10.25, 10.25); tick(h);
    expect(pressE(h)).toBe(true);
    expect(rt.open).toBe(p);
    expect(prompt(h)).toBe('<b>[E]</b> Put the note down');
    const el = overlay()!;
    expect(el).toBeTruthy();
    expect(el.style.display).toBe('flex');
    expect(String(el.style.cssText)).toMatch(/pointer-events:none/);
    const card = el.children[0];
    expect(card.children.map(c => c.textContent)).toEqual([n.title, n.body, `- ${n.sign}`]);
    // E again: closed
    expect(pressE(h)).toBe(true);
    expect(rt.open).toBe(null);
    expect(el.style.display).toBe('none');
    // Esc
    pressE(h);
    expect(rt.open).toBe(p);
    expect(keys.length).toBe(1);
    keys[0]({key: 'Escape'});
    expect(rt.open).toBe(null);
    // walking off
    pressE(h); expect(rt.open).toBe(p);
    lookAt(h, 10.25, 14, 10.25, 10.25); tick(h);
    expect(rt.open).toBe(null);
    expect(prompt(h)).toBe(null);
    // turning away
    lookAt(h, 10.25, 11.2, 10.25, 10.25); tick(h); pressE(h); expect(rt.open).toBe(p);
    h.player.yaw += Math.PI; tick(h);
    expect(rt.open).toBe(null);
    // leaving play (pause / death / transit): no prompt, nothing opens, an open paper closes
    lookAt(h, 10.25, 11.2, 10.25, 10.25); tick(h); pressE(h); expect(rt.open).toBe(p);
    h.state = 'paused'; tick(h);
    expect(rt.open).toBe(null);
    expect(prompt(h)).toBe(null);
    expect(pressE(h)).toBe(false);
    expect(rt.counts).toEqual({opens: 5, closes: 5});
    // a re-open reuses the one overlay; teardown removes it
    h.state = 'playing'; tick(h); pressE(h);
    expect(dom.doc.body.children.filter(c => c.id === 'skyways-note-read').length).toBe(1);
    for (const s of h.sectionHooks) s.teardown?.();
    expect(rt.open).toBe(null);
    expect(rt.notes).toEqual([]);
    expect(overlay()).toBeUndefined();
  });

  it('on a generated shelter: every note reads its own text; reading changes nothing in the layout (no unlock, no loot, no record)', () => {
    const L = LEVELS.skyways.generate('main', {levelSeed: 2, startWeapon: 'pistol', layoutVersion: 7} as never) as StationLayout;
    const ev = L.skyways!.addon.evac!, gr = L.levels[L.skyways!.addon.level].grid;
    const h = gameHost(L), rt = installSkywaysNotes(h);
    for (const s of h.sectionHooks) s.build?.(L);
    expect(rt.notes.length).toBe(ev.notes.length);
    const before = JSON.stringify({props: L.props, pickups: L.pickups, evac: ev, areas: L.areas.map(a => a.label)});
    let read = 0;
    for (const n of ev.notes) {
      const p = L.props[n.prop], [ncx, ncy] = gr.cellOf(p.x, p.z), R = Math.ceil(NOTE_READ.reach / CELL);
      const cand: [number, number][] = [];
      for (let y = ncy - R; y <= ncy + R; y++) for (let x = ncx - R; x <= ncx + R; x++) {
        const i = gr.idx(x, y);
        if (gr.inBounds(x, y) && gr.cells[i] === FLOOR && !gr.blocked[i]) cand.push([x, y]);
      }
      cand.sort((a, b) => Math.hypot((a[0] + 0.5) * CELL - p.x, (a[1] + 0.5) * CELL - p.z) - Math.hypot((b[0] + 0.5) * CELL - p.x, (b[1] + 0.5) * CELL - p.z));
      for (const [x, y] of cand) {
        lookAt(h, (x + 0.5) * CELL, (y + 0.5) * CELL, p.x, p.z, gr.floorOf(gr.idx(x, y)));
        tick(h);
        if (rt.target !== p) continue;
        expect(pressE(h)).toBe(true);
        const card = overlay()!.children[0], note = EVAC_NOTES.find(q => q.id === n.id)!;
        expect(card.children.map(c => c.textContent)).toContain(note.body);
        pressE(h);
        read++;
        break;
      }
    }
    expect(read).toBe(ev.notes.length);
    expect(JSON.stringify({props: L.props, pickups: L.pickups, evac: ev, areas: L.areas.map(a => a.label)})).toBe(before);
  });
});
