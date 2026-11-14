// Task studio-graphics-gpu-materials-toggle-20261114-212239-01: render/shaderTextShare.ts — every node-builder state points at the
// program maps' own shader strings (three r186 keeps a flat copy per state otherwise).
//  1. the states of an existing program are pointed at its string; the text three reads back is unchanged; counts are reported;
//  2. a state whose program does not exist yet is left alone and picked up once the maps have grown;
//  3. nothing built since the last call: the states are not even walked;
//  4. the duplicate copies are really released (measured on the heap);
//  5. internals of another shape: nothing happens, nothing throws;
//  6. it reads the fields three r186 really has (source pin), and the game calls it after the warm-up and in the frame.
import {describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import {shaderTextShared, shareShaderText} from '../src/render/shaderTextShare';

interface State { vertexShader: string | null; fragmentShader: string | null }
interface Stage { code: string }

/** A text built by concatenation at run time (never the same string object twice, as three's generated shaders). */
const build = (seed: string, kb = 1): string => {
  let s = `// ${seed}\n`;
  const line = `let v_${seed} = vec4<f32>( ${seed.length}.0 ) * nodeUniform${seed.length};\n`;
  while (s.length < kb * 1024) s += line;
  return s;
};

function fakeRenderer() {
  const cache = new Map<number, State>();
  const vertex = new Map<string, Stage>(), fragment = new Map<string, Stage>();
  let key = 0;
  /** As three: the state is built first (its own text), its programs are created at the first pipeline request. */
  const state = (v: string, f: string): State => { const st = {vertexShader: build(v), fragmentShader: build(f)}; cache.set(key++, st); return st; };
  const program = (st: State) => {
    if (!vertex.has(st.vertexShader!)) vertex.set(st.vertexShader!, {code: st.vertexShader!});
    if (!fragment.has(st.fragmentShader!)) fragment.set(st.fragmentShader!, {code: st.fragmentShader!});
  };
  return {renderer: {_nodes: {nodeBuilderCache: cache}, _pipelines: {programs: {vertex, fragment}}}, cache, vertex, fragment, state, program};
}

describe('shareShaderText', () => {
  it('points every state of an existing program at the program map\'s string; the text is unchanged; a second call does nothing', () => {
    const f = fakeRenderer();
    const a = f.state('wall', 'lit'), b = f.state('wall', 'lit'), c = f.state('floor', 'lit'), d = f.state('wall', 'shadow');
    for (const st of [a, b, c, d]) f.program(st);
    expect([f.vertex.size, f.fragment.size]).toEqual([2, 2]);
    const before = [a, b, c, d].map(st => [st.vertexShader, st.fragmentShader]);
    expect(shareShaderText(f.renderer)).toBe(4);
    expect([a, b, c, d].map(st => [st.vertexShader, st.fragmentShader])).toEqual(before); // the same text everywhere
    for (const st of [a, b, c, d]) {
      expect(f.vertex.get(st.vertexShader!)!.code).toBe(st.vertexShader); // still the key of its program
      expect(f.fragment.get(st.fragmentShader!)!.code).toBe(st.fragmentShader);
    }
    expect(shaderTextShared(f.renderer)).toEqual({states: 4, chars: before.flat().reduce((n, t) => n + t!.length, 0)});
    // nothing built since: the states are not walked again
    const values = vi.spyOn(f.cache, 'values');
    expect(shareShaderText(f.renderer)).toBe(0);
    expect(values).not.toHaveBeenCalled();
    expect(shaderTextShared(f.renderer).states).toBe(4);
  });

  it('a state whose program is not created yet is left alone, and shared once its program exists', () => {
    const f = fakeRenderer();
    const a = f.state('wall', 'lit');
    f.program(a);
    const late = f.state('prop', 'lit'); // built (compileAsync), its vertex program not requested yet
    expect(shareShaderText(f.renderer)).toBe(1);
    expect(shaderTextShared(f.renderer).states).toBe(1);
    expect(f.vertex.has(late.vertexShader!)).toBe(false);
    expect(shareShaderText(f.renderer)).toBe(0); // maps unchanged: not looked at again
    f.program(late);
    expect(shareShaderText(f.renderer)).toBe(1);
    expect(shaderTextShared(f.renderer).states).toBe(2);
    // a state added later for programs that already exist
    const again = f.state('prop', 'lit');
    expect(shareShaderText(f.renderer)).toBe(1);
    expect(f.vertex.get(again.vertexShader!)!.code).toBe(late.vertexShader);
    // a compute-like state (no render shaders) is finished at once and never blocks the others
    f.cache.set(999, {vertexShader: null, fragmentShader: null});
    expect(shareShaderText(f.renderer)).toBe(1);
    expect(shaderTextShared(f.renderer).states).toBe(4);
  });

  it('the duplicate copies are released: the heap shrinks by about what the duplicates held', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const f = fakeRenderer();
    const N = 60, KB = 256;
    const used = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
    const h0 = used();
    const states: State[] = [];
    for (let i = 0; i < N; i++) {
      // every state builds its own copy of the same two texts (as 60 materials that compile to one program)
      const st: State = {vertexShader: build('same-vertex', KB), fragmentShader: build('same-fragment', KB)};
      f.cache.set(i, st);
      f.program(st); // (the lookup flattens the state's string, as three's pipeline request does)
      states.push(st);
    }
    const h1 = used();
    const chars = states[0].vertexShader!.length + states[0].fragmentShader!.length;
    expect(h1 - h0).toBeGreaterThan(0.8 * N * chars); // the duplicates are really held (one byte a character)
    expect(shareShaderText(f.renderer)).toBe(N);
    const h2 = used();
    expect(h1 - h2).toBeGreaterThan(0.8 * (N - 1) * chars); // all but one copy of each text is gone
    expect(h2 - h0).toBeLessThan(3 * chars);
    expect(states.every(st => st.vertexShader === states[0].vertexShader && st.fragmentShader === states[0].fragmentShader)).toBe(true);
  });

  it('internals of another shape: nothing happens and nothing throws', () => {
    for (const r of [null, undefined, {}, {_nodes: {}}, {_nodes: {nodeBuilderCache: new Map()}}, {_nodes: {nodeBuilderCache: []}, _pipelines: {programs: {vertex: new Map(), fragment: new Map()}}},
      {_nodes: {nodeBuilderCache: new Map()}, _pipelines: {programs: {vertex: {}, fragment: new Map()}}}]) {
      expect(shareShaderText(r as never)).toBe(0);
    }
    const f = fakeRenderer();
    f.cache.set(1, null as never);
    f.cache.set(2, 7 as never);
    f.cache.set(3, {vertexShader: 5, fragmentShader: {}} as never);
    const good = f.state('wall', 'lit');
    f.program(good);
    f.vertex.set(build('odd'), {code: 'not its key'}); // a stage whose code is not its key is never copied from
    const odd: State = {vertexShader: build('odd'), fragmentShader: good.fragmentShader};
    f.cache.set(4, odd);
    expect(() => shareShaderText(f.renderer)).not.toThrow();
    expect(odd.vertexShader).toBe(build('odd'));
    expect(shaderTextShared({})).toEqual({states: 0, chars: 0});
  });

  it('reads the fields three r186 has, and the game calls it after the warm-up and in the frame', () => {
    const three = readFileSync(new URL('../../node_modules/three/build/three.webgpu.js', import.meta.url), 'utf8');
    expect(three).toMatch(/this\.nodeBuilderCache = new Map\(\);/);
    expect(three).toMatch(/let stageVertex = this\.programs\.vertex\.get\( nodeBuilderState\.vertexShader \);/);
    expect(three).toMatch(/stageVertex = new ProgrammableStage\( nodeBuilderState\.vertexShader, 'vertex', name \);/);
    expect(three).toMatch(/let stageFragment = this\.programs\.fragment\.get\( nodeBuilderState\.fragmentShader \);/);
    // the state's text is read nowhere else than as those keys / stage sources
    expect(three.match(/nodeBuilderState\.vertexShader/g)!.length).toBe(three.match(/this\.programs\.vertex\.(get|set)\( nodeBuilderState\.vertexShader|new ProgrammableStage\( nodeBuilderState\.vertexShader/g)!.length);
    expect(three.match(/nodeBuilderState\.fragmentShader/g)!.length).toBe(three.match(/this\.programs\.fragment\.(get|set)\( nodeBuilderState\.fragmentShader|new ProgrammableStage\( nodeBuilderState\.fragmentShader/g)!.length);
    const game = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    expect(game.match(/shareShaderText\(this\.renderer\)/g)).toHaveLength(2);
    expect(game).toMatch(/this\.warmup = res;\n\s+shareShaderText\(this\.renderer\);/);
  });
});
