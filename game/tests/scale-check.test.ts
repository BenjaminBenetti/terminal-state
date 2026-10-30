// Task office-props-physics-scale-20261030 (lane SCALE): the prop scale-check tool (tools/asset-pipeline/props/scale-check.mjs) —
// runtime transforms, furniture-only bounds, grounded contact and surface heights on a tiny synthetic GLB (a table with a loose
// beaker on top), the reference zombie's runtime height, and one CPU sheet render. The renders themselves are inspected by eye.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
type Bounds = {min: number[]; max: number[]; size: number[]};
type Report = {
  size: number[]; scale: number[]; turn: boolean; bounds: {min: number[]; max: number[]};
  body: {size: number[]; looseTris: number} | null;
  contact: {minY: number; gap: number; state: string; clusterCount: number; baseY: number; warning?: string};
  mainSurface: {y: number; share: number} | null; topSurface: {y: number} | null; warnings: string[];
};
interface Tool {
  measureProp(spec: Record<string, unknown>): Promise<Report & {_render: {body: unknown[]; loose: unknown[]; full: Bounds; bb: Bounds | null}}>;
  resolveKind(kind: string): Promise<{path: string; fit?: {type: string}; turn?: boolean; file: string | null}>;
  loadZombie(id?: string, scale?: number): Promise<{heightM: number; bounds: Bounds}>;
  scaleCheck(specs: Record<string, unknown>[], o: Record<string, unknown>): Promise<{image: string; props: Report[]; zombie: {heightM: number}}>;
}
let tool: Tool;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-check-test-'));
const glb = path.join(dir, 'table.glb');

/** Table 1.2 x 0.76 x 0.6 (four 4 cm legs, 4 cm top) with a separate 'loose-beaker' node 0.2 m tall on the top. */
async function writeTable(): Promise<void> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const mat = doc.createMaterial('table').setBaseColorFactor([0.6, 0.5, 0.4, 1]);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string) => {
    const P: number[] = [], I: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => { const o = P.length / 3; P.push(...a, ...b, ...c, ...d); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  };
  box(-0.6, 0.72, -0.3, 0.6, 0.76, 0.3, 'top');
  for (const [x, z] of [[-0.56, -0.26], [0.52, -0.26], [-0.56, 0.22], [0.52, 0.22]]) box(x, 0, z, x + 0.04, 0.72, z + 0.04, 'leg');
  box(0.2, 0.76, -0.05, 0.3, 0.96, 0.05, 'loose-beaker');
  await new NodeIO().write(glb, doc);
}

beforeAll(async () => {
  tool = await import(pathToFileURL(path.join(REPO, 'tools/asset-pipeline/props/scale-check.mjs')).href) as Tool;
  await writeTable();
});
afterAll(() => fs.rmSync(dir, {recursive: true, force: true}));

describe('scale-check measurements (synthetic table + loose beaker)', () => {
  it('reports the full bounds, the four leg contacts and the work-top height', async () => {
    const r = await tool.measureProp({file: glb});
    expect(r.size.map(v => +v.toFixed(3))).toEqual([1.2, 0.96, 0.6]);
    expect(r.contact.state).toBe('grounded');
    expect(r.contact.clusterCount).toBe(4);
    expect(r.mainSurface!.y).toBeCloseTo(0.76, 2);
    expect(r.body).toBeNull();
  });

  it('furniture-only bounds: --exclude a named loose part, or --below a height (exact clip)', async () => {
    const ex = await tool.measureProp({file: glb, exclude: 'beaker'});
    expect(ex.body!.size[1]).toBeCloseTo(0.76, 3);
    expect(ex.size[1]).toBeCloseTo(0.96, 3); // the full box still includes the beaker
    const below = await tool.measureProp({file: glb, below: 0.8});
    expect(below.body!.size[1]).toBeCloseTo(0.8, 3);
    expect(below._render.loose.length).toBeGreaterThan(0);
  });

  it('applies the runtime fits: office uniform k = min(w / sx, d / sz) + turn, box fit, lift -> floating', async () => {
    const u = await tool.measureProp({file: glb, fit: {type: 'uniform-wd', w: 0.6, d: 0.6}, turn: true, exclude: 'beaker'});
    expect(u.scale).toEqual([0.5, 0.5, 0.5]);
    expect(u.size.map(v => +v.toFixed(3))).toEqual([0.6, 0.48, 0.3]);
    // the beaker (x 0.2..0.3 in the file) stands at x -0.15..-0.1 after the scale and the half turn
    const xs = (u._render.loose as {p: number[][]}[]).flatMap(t => t.p.map(q => q[0]));
    expect(Math.min(...xs)).toBeCloseTo(-0.15, 3);
    expect(Math.max(...xs)).toBeCloseTo(-0.1, 3);
    const b = await tool.measureProp({file: glb, fit: {type: 'box', w: 1.2, h: 0.48, d: 0.6}});
    expect(b.warnings.some(w => w.includes('non-uniform'))).toBe(true);
    const f = await tool.measureProp({file: glb, lift: 0.05, floor: 0});
    expect(f.contact.state).toMatch(/^FLOATING 0\.05/);
  });
});

describe('scale-check runtime data and the reference zombie', () => {
  it('resolves kinds through the game data (openable box fit vs office uniform fit + FLIP)', async () => {
    const bench = await tool.resolveKind('labBench');
    expect(bench.path).toMatch(/^openable/);
    expect(bench.fit!.type).toBe('box');
    const bag = await tool.resolveKind('beanBag');
    expect(bag.path).toMatch(/^office/);
    expect(bag.fit!.type).toBe('uniform-wd');
    expect(bag.turn).toBe(true);
    expect((await tool.resolveKind('cubiclePartition')).file).toBeNull();
  });

  it('stands the zombie at its baked height and refuses to rescale it outside the game range', async () => {
    const z = await tool.loadZombie('lastshift', 1);
    expect(z.heightM).toBe(1.78);
    expect(z.bounds.size[1]).toBeCloseTo(1.78, 2);
    await expect(tool.loadZombie('lastshift', 1.3)).rejects.toThrow(/0\.95 \.\. 1\.05/);
  });

  it('the standing rules name the tool (root CLAUDE.md rules 4 / 5, docs/prop-affordances.md section 5)', () => {
    const claude = fs.readFileSync(path.join(REPO, 'CLAUDE.md'), 'utf8'), doc = fs.readFileSync(path.join(REPO, 'docs/prop-affordances.md'), 'utf8');
    for (const s of ['Never bake loose items into furniture', 'tools/asset-pipeline/props/scale-check.mjs', 'Never rescale the reference zombie']) expect(claude).toContain(s);
    for (const s of ['No baked clutter, real-world scale', 'tools/asset-pipeline/props/scale-check.mjs', '--below']) expect(doc).toContain(s);
  });

  it('writes a sheet PNG and a JSON report', async () => {
    const out = path.join(dir, 'sheet.png');
    const r = await tool.scaleCheck([{file: glb, exclude: 'beaker'}], {out, quiet: true, ppm: 80});
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
    expect(JSON.parse(fs.readFileSync(out.replace(/\.png$/, '.json'), 'utf8')).props[0].body.size[1]).toBeCloseTo(0.76, 3);
    expect(r.zombie.heightM).toBe(1.78);
  });
});
