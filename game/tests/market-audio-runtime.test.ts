// Task studio-market-bar-20261108-225231-01 (lane AUDIO; user: "Background chatter; screams from fleeing survivors and angry grunts from
// attackers."): Game.marketAudio (market/audio/marketSounds.ts) on a stub host — the CHATTER: groups of calm people near the player murmur
// (level by head-count, the bar take near the bar's posts, a lone person is no crowd), it fades as people die / hide / leave, DUCKS out when
// the settlement turns hostile, stops on teardown and never runs on another level; the VOICES: per-person cooldowns, one voice per person,
// a density cap per window, staggered starts (a ripple, not a chord), never from a dead / hiding / gone person, following the person and
// silenced the moment they die or hide; the retch / register play anywhere.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import type {CrowdGroup, MarketVoiceKind} from '../src/audio/sfx';
import type {MarketLayout, MarketSpot} from '../src/gen/market/marketTypes';
import {HIDING_MODES, MARKET_SOUNDS, MarketSounds, marketAudioQaApi, type MarketAudioPerson} from '../src/market/audio/marketSounds';
import type {MarketAudioApi} from '../src/market/marketAudio';
import {fakeMarket} from './helpers/marketTradeFixture';

interface Handle { kind: MarketVoiceKind; x: number; y: number; z: number; rate: number; t: number; playing: boolean; stopped: number; setPos(x: number, y: number, z: number): void; stop(): void }

function rig(o: {people?: [string, number, number, number][]; spots?: MarketSpot[]} = {}) {
  const handles: Handle[] = [], chatter: CrowdGroup[][] = [], stops: number[] = [];
  let cash = 0, retch = 0, clock = 0, sfxCap = Infinity;
  const sfx = {
    marketCash: () => { cash++; return true; },
    marketRetch: () => { retch++; return 1.6; },
    marketVoice: (kind: MarketVoiceKind, x: number, y: number, z: number, opt?: {rate?: number}) => {
      if (handles.filter(h => h.playing).length >= sfxCap) return null;
      const h: Handle = {kind, x, y, z, rate: opt?.rate ?? 1, t: clock, playing: true, stopped: 0,
        setPos(px, py, pz) { this.x = px; this.y = py; this.z = pz; }, stop() { this.playing = false; this.stopped++; }};
      handles.push(h);
      return h;
    },
    crowdChatter: (g: readonly CrowdGroup[]) => { chatter.push(g.map(x => ({...x}))); },
    stopCrowd: (f?: number) => { stops.push(f ?? -1); },
  };
  const people: (MarketAudioPerson & {state: string; mode: string; actor: {x: number; y: number; z: number}})[] =
    (o.people ?? []).map(([id, x, y, z]) => ({id, state: 'alive', mode: 'calm', actor: {x, y, z}}));
  const host = {
    sfx, player: {x: 0, y: 0, z: 0},
    sectionHooks: [] as {build?(l: never): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[],
    marketPeople: {get roster() { return people.filter(p => p.state !== 'fled').map(p => ({id: p.id, actor: p.actor})); }},
    marketCombat: {people},
    marketHostility: {hostile: false},
  };
  const sys = new MarketSounds(host).install();
  sys.rand = () => 0; // cooldowns / gaps at their minimum (deterministic)
  const market: MarketLayout = {...fakeMarket(), v: 3, spots: o.spots ?? []};
  const build = (layout: unknown = {market}) => { for (const s of host.sectionHooks) s.build?.(layout as never); };
  const teardown = () => { for (const s of host.sectionHooks) s.teardown?.(); };
  const frame = (dt = 0.05) => { clock += dt; for (const f of host.frameHooks) f(dt); };
  const run = (s: number, dt = 0.05) => { for (let t = 0; t < s - 1e-9; t += dt) frame(dt); };
  const person = (id: string) => people.find(p => p.id === id)!;
  return {sys, host, people, person, handles, chatter, stops, build, teardown, frame, run, market,
    get cash() { return cash; }, get retch() { return retch; }, setSfxCap(n: number) { sfxCap = n; }};
}

const spot = (x: number, z: number, kind: MarketSpot['kind'], y = 0): MarketSpot => ({x, y, z, level: 0, yaw: 0, kind, area: 0});
/** A crowd of `n` people round (cx, cz) on storey y, ids `${tag}:i`. */
const crowd = (tag: string, n: number, cx: number, cz: number, y = 0): [string, number, number, number][] =>
  Array.from({length: n}, (_, i) => [`${tag}:${i}`, cx + Math.cos(i) * 1.5, y, cz + Math.sin(i) * 1.5]);

describe('market audio: the calm crowd\'s murmur', () => {
  it('in a market: groups of calm people murmur at their centroid (head height), level by head-count; a lone person is no crowd; the bar take at the bar', () => {
    const r = rig({people: [...crowd('a', 6, 6, 0), ...crowd('b', 2, -8, 4), ['lone', 0, 0, -14], ...crowd('bar', 3, 2, 12, 4.2)], spots: [spot(2, 12, 'drink', 4.2)]});
    r.build();
    r.frame();
    const g = r.chatter.at(-1)!;
    expect(g.length).toBe(3);
    const byLevel = [...g].sort((p, q) => q.level - p.level), full = MARKET_SOUNDS.chatter.full;
    expect(byLevel[0].cue).toBe('marketChatter'); // six people: the loudest
    expect(byLevel[0].x).toBeCloseTo(6, 0);
    expect(byLevel[0].y).toBeCloseTo(MARKET_SOUNDS.chatter.headY, 5);
    const bar = g.find(x => x.cue === 'marketBarChatter')!, pair = g.find(x => x.cue === 'marketChatter' && x.x < 0)!;
    expect(bar.y).toBeCloseTo(4.2 + MARKET_SOUNDS.chatter.headY, 5);
    expect(g.some(x => Math.abs(x.z + 14) < 1)).toBe(false); // the lone resident
    // levels by head-count (sqrt(n / full): 6 -> 1, 3 -> 0.71, 2 -> 0.58), together held to the cap (no full-volume chorus)
    expect(bar.level / byLevel[0].level).toBeCloseTo(Math.sqrt(3 / full), 5);
    expect(pair.level / byLevel[0].level).toBeCloseTo(Math.sqrt(2 / full), 5);
    expect(g.reduce((s, x) => s + x.level, 0)).toBeCloseTo(MARKET_SOUNDS.chatter.totalCap, 5);
    // regrouping cadence: one hand-over per tick, not per frame
    const n = r.chatter.length;
    r.run(1);
    expect(r.chatter.length - n).toBeGreaterThanOrEqual(Math.floor(1 / MARKET_SOUNDS.tick) - 1);
    expect(r.chatter.length - n).toBeLessThanOrEqual(Math.ceil(1 / MARKET_SOUNDS.tick) + 1);
  });

  it('fades as its people die / hide / leave; out of range it edges out', () => {
    const r = rig({people: crowd('a', 6, 5, 0)});
    r.build();
    r.frame();
    expect(r.chatter.at(-1)![0].level).toBe(1);
    r.person('a:0').state = 'dead';
    r.person('a:1').mode = 'hide';
    r.person('a:2').state = 'fled';
    r.run(0.3);
    expect(r.chatter.at(-1)![0].level).toBeCloseTo(Math.sqrt(3 / 6), 5);
    for (const id of ['a:3', 'a:4']) r.person(id).state = 'dead';
    r.run(0.3);
    expect(r.chatter.at(-1)).toEqual([]); // one person left: no crowd
    // a crowd near the range's edge is quieter than the same crowd near the player
    const near = rig({people: crowd('a', 6, 5, 0)}), far = rig({people: crowd('a', 6, MARKET_SOUNDS.chatter.range - 3, 0)});
    near.build(); far.build(); near.frame(); far.frame();
    expect(far.chatter.at(-1)![0].level).toBeLessThan(near.chatter.at(-1)![0].level);
  });

  it('DUCKS out the tick the settlement turns hostile (no calm people); stops on teardown; never runs on another level', () => {
    const r = rig({people: crowd('a', 5, 4, 2)});
    r.build();
    r.frame();
    expect(r.chatter.at(-1)!.length).toBe(1);
    r.host.marketHostility.hostile = true;
    r.run(MARKET_SOUNDS.tick + 0.05);
    expect(r.chatter.at(-1)).toEqual([]); // every channel fades (Sfx.crowdChatter([]))
    r.host.marketHostility.hostile = false;
    for (const p of r.people) p.mode = 'flee'; // (a calm frame never comes back while they run)
    r.run(MARKET_SOUNDS.tick + 0.05);
    expect(r.chatter.at(-1)).toEqual([]);
    for (const p of r.people) p.mode = 'calm';
    r.run(MARKET_SOUNDS.tick + 0.05);
    expect(r.chatter.at(-1)!.length).toBe(1);
    r.teardown();
    expect(r.stops).toEqual([MARKET_SOUNDS.teardownFade]);
    const n = r.chatter.length;
    r.run(2);
    expect(r.chatter.length).toBe(n); // nothing after leaving
    // another level (no layout.market): no murmur, no voices; the retch / register still play where they are called
    r.build({props: []});
    r.run(2);
    expect(r.chatter.length).toBe(n);
    const api: MarketAudioApi = r.sys;
    api.scream('a:0', 4, 0, 2);
    api.grunt('a:1', 4, 0, 2);
    r.run(1);
    expect(r.handles).toEqual([]);
    expect(r.sys.counts.offLevel).toBe(2);
    api.retch();
    api.cash();
    expect([r.retch, r.cash]).toEqual([1, 1]);
  });
});

describe('market audio: panic screams / angry grunts', () => {
  const six = crowd('p', 6, 6, 0);

  it('staggered starts (a ripple, not a chord), at most `perWindow` per window, then capped; each person keeps one pitch', () => {
    const r = rig({people: six});
    r.build();
    for (const [id, x, y, z] of six) r.sys.scream(id, x, y, z); // the provocation: everyone panics in one frame
    r.run(3);
    const S = MARKET_SOUNDS.scream;
    const ts = r.handles.map(h => h.t);
    expect(r.handles.length).toBe(S.perWindow);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(S.gap[0] - 0.051); // (frame quantised)
    expect(r.sys.counts.capped).toBe(six.length - S.perWindow);
    expect(r.handles.every(h => h.kind === 'scream')).toBe(true);
    for (const h of r.handles) { expect(h.rate).toBeGreaterThanOrEqual(S.rate[0]); expect(h.rate).toBeLessThanOrEqual(S.rate[1]); }
    // at the mouth: the person's feet + the head height
    expect(r.handles[0].y).toBeCloseTo(S.headY, 5);
  });

  it('per-person cooldown and one voice per person; a person keeps its pitch across calls', () => {
    const r = rig({people: six});
    r.build();
    r.sys.grunt('p:0', 6, 0, 0);
    r.frame();
    r.sys.grunt('p:0', 6, 0, 0); // within its cooldown
    expect([r.handles.length, r.sys.counts.cooldown]).toEqual([1, 1]);
    const G = MARKET_SOUNDS.grunt;
    r.handles[0].playing = false; // (the clip ended)
    r.run(G.cooldown[0] - 0.2);
    r.sys.grunt('p:0', 6, 0, 0);
    expect(r.handles.length).toBe(1);
    r.run(0.3);
    r.sys.grunt('p:0', 6, 0, 0);
    r.frame();
    expect(r.handles.length).toBe(2);
    expect(r.handles[1].rate).toBe(r.handles[0].rate);
    // one voice per person: still sounding -> a scream request from the same person waits its turn (dropped)
    r.sys.scream('p:0', 6, 0, 0);
    expect(r.sys.counts.busy).toBe(1);
    // different people have different pitches (deterministic per id)
    r.sys.grunt('p:1', 6, 0, 0);
    r.run(1);
    expect(r.handles.at(-1)!.rate).not.toBe(r.handles[0].rate);
  });

  it('never from a dead / hiding / gone person; a sounding voice follows its person and is silenced the frame they die or hide', () => {
    const r = rig({people: six});
    r.build();
    r.person('p:0').state = 'dead';
    r.person('p:1').mode = 'hide';
    r.person('p:2').state = 'fled';
    r.sys.scream('p:0', 6, 0, 0);
    r.sys.scream('p:1', 6, 0, 0);
    r.sys.scream('p:2', 6, 0, 0);
    r.sys.scream('stranger', 6, 0, 0);
    r.run(1);
    expect([r.handles.length, r.sys.counts.quiet]).toEqual([0, 4]);
    for (const m of HIDING_MODES) expect(r.sys.quiet((r.person('p:3').mode = m, 'p:3'))).toBe(true);
    r.person('p:3').mode = 'flee';
    // follows, then silenced when hiding
    r.sys.scream('p:3', 6, 0, 0);
    r.frame();
    const h = r.handles[0];
    r.person('p:3').actor.x = 9;
    r.frame();
    expect(h.x).toBe(9);
    r.person('p:3').mode = 'hide';
    r.frame();
    expect([h.playing, h.stopped, r.sys.counts.silenced]).toEqual([false, 1, 1]);
    // a staggered start whose person died while queued never sounds
    r.sys.grunt('p:4', 6, 0, 0);
    r.sys.grunt('p:5', 6, 0, 0); // queued behind p:4 by the stagger gap
    r.frame(0.01);
    r.person('p:5').state = 'dead';
    r.run(1);
    expect(r.handles.filter(x => x.kind === 'grunt').length).toBe(1);
    // teardown silences every sounding voice
    r.sys.grunt('p:4', 6, 0, 0);
    r.run(MARKET_SOUNDS.grunt.cooldown[1]);
    r.handles.forEach(x => { if (x.kind === 'grunt') x.playing = false; });
    r.sys.grunt('p:4', 6, 0, 0);
    r.frame();
    const g = r.handles.at(-1)!;
    expect(g.playing).toBe(true);
    r.teardown();
    expect(g.playing).toBe(false);
  });

  it('the audio\'s own voice cap answering null is counted, never retried in a loop', () => {
    const r = rig({people: six});
    r.setSfxCap(0);
    r.build();
    r.sys.scream('p:0', 6, 0, 0);
    r.run(1);
    expect([r.handles.length, r.sys.counts.screams, r.sys.counts.capped]).toEqual([0, 0, 1]);
  });
});

describe('market audio: wiring', () => {
  it('the Game constructor installs it as Game.marketAudio AFTER the market people / combat (its build and frame read them); QA exposes its state', () => {
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');
    const iPeople = src.indexOf('this.marketPeople = installMarketPeople(this)'), iCombat = src.indexOf('this.marketCombat = installMarketCombat(this)');
    const iAudio = src.indexOf('this.marketAudio = installMarketAudio(this)');
    expect(iPeople).toBeGreaterThan(0);
    expect(iCombat).toBeGreaterThan(iPeople);
    expect(iAudio).toBeGreaterThan(iCombat);
    const r = rig({people: crowd('a', 3, 3, 0)});
    r.build();
    r.frame();
    const qa = marketAudioQaApi(() => r.sys, () => 'sfx').marketAudio();
    expect(qa).toMatchObject({system: {market: true, hostile: false, groups: [{cue: 'marketChatter'}]}, sfx: 'sfx'});
    expect(marketAudioQaApi(() => undefined, () => null).marketAudio()).toEqual({system: null, sfx: null});
  });
});
