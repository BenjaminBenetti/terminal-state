// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): the Surface Run crossing's gate and participant runners
// (world/surface/crossing.ts) — pure, no Game: which state refuses first, and that a participant failure never leaves a carried thing
// in two worlds (the ones already departed are aborted, in reverse order, before the crossing is refused).
import {describe, expect, it, vi} from 'vitest';
import {abortCrossers, arriveCrossers, departCrossers, surfaceCrossRefusal, type SurfaceCrossGate, type SurfaceCrosser} from '../src/world/surface/crossing';
import type {SectionKey} from '../src/levels/types';

const host: SectionKey = {level: 'subway', section: 'main', station: 'st-01'};
const district: SectionKey = {level: 'subway', section: 'surface', station: 'st-01'};
const open: SurfaceCrossGate = {busy: false, alive: true, state: 'playing', ready: true, moving: false, seated: false, climbing: false, to: district};

describe('surface crossing gate', () => {
  it('allows an open gate; refuses in order busy > dead > not ready > menu > no way > moving > seated > ladder > a participant', () => {
    expect(surfaceCrossRefusal(open, host)).toBeNull();
    const all: SurfaceCrossGate = {busy: true, alive: false, state: 'paused', ready: false, moving: true, seated: true, climbing: true, to: null};
    const order: [keyof SurfaceCrossGate, unknown, string][] = [
      ['busy', false, 'busy'], ['alive', true, 'dead'], ['ready', true, 'not-ready'], ['state', 'playing', 'not-playing'],
      ['to', district, 'no-access'], ['moving', false, 'moving'], ['seated', false, 'seated'], ['climbing', false, 'climbing']];
    const g: SurfaceCrossGate = {...all};
    for (const [k, fix, code] of order) {
      expect(surfaceCrossRefusal(g, host)?.code, `with ${k} still set`).toBe(code);
      (g as unknown as Record<string, unknown>)[k] = fix;
    }
    expect(surfaceCrossRefusal(g, host)).toBeNull();
    expect(surfaceCrossRefusal({...open, state: 'dead'}, host)?.code).toBe('dead');
    expect(surfaceCrossRefusal({...open, seated: true}, host)?.text).toBe('Get out of the truck first.');
  });

  it('asks the participants last, first refusal wins; a throwing refuse is a refusal, never a crossing', () => {
    const seen: string[] = [];
    const c = (name: string, r: string | null | 'throw'): SurfaceCrosser => ({name, depart() {}, arrive() {},
      refuse: (from, to) => { seen.push(`${name}:${from.section}->${to.section}`); if (r === 'throw') throw new Error('x'); return r; }});
    expect(surfaceCrossRefusal(open, host, [c('a', null), c('b', 'Set the cart down first'), c('c', 'never asked')])).toEqual({code: 'carrying', text: 'Set the cart down first'});
    expect(seen).toEqual(['a:main->surface', 'b:main->surface']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(surfaceCrossRefusal(open, host, [c('t', 'throw')])?.code).toBe('carrying');
    warn.mockRestore();
    seen.length = 0;
    expect(surfaceCrossRefusal({...open, moving: true}, host, [c('a', null)])?.code).toBe('moving');
    expect(seen, 'a game-state refusal never asks the participants').toEqual([]);
  });
});

describe('surface crossing participants', () => {
  const log: string[] = [];
  const p = (name: string, failDepart = false, failArrive = false): SurfaceCrosser => ({name,
    depart: (f, t) => { if (failDepart) throw new Error('stuck'); log.push(`${name}.depart ${f.section}->${t.section}`); },
    arrive: t => { if (failArrive) throw new Error('lost'); log.push(`${name}.arrive ${t.section}`); },
    abort: f => { log.push(`${name}.abort ${f.section}`); }});

  it('departs in order; a failure aborts the departed ones in reverse order and rethrows (nothing crosses)', () => {
    log.length = 0;
    expect(departCrossers([p('a'), p('b')], host, district).map(c => c.name)).toEqual(['a', 'b']);
    expect(log).toEqual(['a.depart main->surface', 'b.depart main->surface']);
    log.length = 0;
    expect(() => departCrossers([p('a'), p('b'), p('c', true), p('d')], host, district)).toThrow(/c could not depart \(stuck\)/);
    expect(log).toEqual(['a.depart main->surface', 'b.depart main->surface', 'b.abort main', 'a.abort main']);
  });

  it('arrives in order (a failed one is reported, the others still arrive); abort runs in reverse order', () => {
    log.length = 0;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(arriveCrossers([p('a'), p('b', false, true), p('c')], district)).toEqual(['b']);
    expect(log).toEqual(['a.arrive surface', 'c.arrive surface']);
    log.length = 0;
    abortCrossers([p('a'), p('b')], host);
    expect(log).toEqual(['b.abort main', 'a.abort main']);
    err.mockRestore();
  });
});
