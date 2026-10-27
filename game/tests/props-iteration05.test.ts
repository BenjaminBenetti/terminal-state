// Iteration 05 (Lane A): open-front cooler/display derivatives replace the picture-pane versions (user feedback item 4) and every
// iteration-05 prop listed in the manifest has a provenance record whose sha256 matches the shipped file.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {MODEL_FILES} from '../src/assets/manifest';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROV = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/props-iteration05.json'), 'utf8')) as {outputs: {key: string; output: string; sha256: string; modelKey: string; interiorSurfaces?: {y: number; clearM: number}[]}[]};
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

describe('iteration05 open-front cooler/display', () => {
  for (const [modelKey, key, file, size] of [['shopCooler', 'shopCoolerOpen', 'shop-cooler-open.glb', [0.75, 2.0, 0.75]], ['shopDisplay', 'shopDisplayOpen', 'shop-display-open.glb', [1.1, 0.7, 0.62]]] as const) {
    it(`${modelKey} uses ${file} with a transparent glass node, real interior surfaces and the old bbox`, async () => {
      expect(MODEL_FILES[modelKey].url).toBe(`assets/models/${file}`);
      const abs = path.join(GAME, 'public', MODEL_FILES[modelKey].url);
      const rec = PROV.outputs.find(o => o.key === key)!;
      expect(rec.sha256).toBe(sha(abs));
      expect(Math.abs(fs.statSync(abs).size - MODEL_FILES[modelKey].bytes)).toBeLessThan(20_000);
      expect(rec.interiorSurfaces!.length).toBeGreaterThanOrEqual(2);
      for (const s of rec.interiorSurfaces!) expect(s.clearM).toBeGreaterThan(0.15);
      const doc = await new NodeIO().read(abs);
      const nodes = doc.getRoot().listNodes().map(n => n.getName());
      expect(nodes).toEqual(expect.arrayContaining(['body', 'interior', 'glass']));
      const glass = doc.getRoot().listNodes().find(n => n.getName() === 'glass')!.getMesh()!.listPrimitives()[0].getMaterial()!;
      expect(glass.getAlphaMode()).toBe('BLEND');
      expect(glass.getBaseColorFactor()[3]).toBeLessThan(0.3);
      expect(glass.getBaseColorTexture()).toBeNull();   // no picture on the glass
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION')!; const lo = a.getMin([]), hi = a.getMax([]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], lo[k]); mx[k] = Math.max(mx[k], hi[k]); } }
      for (let k = 0; k < 3; k++) expect(mx[k] - mn[k]).toBeCloseTo(size[k], 2);
      expect(mn[1]).toBeCloseTo(0, 3);
    });
  }
  it('every iteration05 prop in the manifest exists and matches its provenance hash', () => {
    for (const o of PROV.outputs) {
      const entry = (MODEL_FILES as Record<string, {url: string}>)[o.modelKey];
      if (!entry || entry.url !== o.output.replace(/^game\/public\//, '')) continue;
      expect(sha(path.join(GAME, 'public', entry.url)), o.key).toBe(o.sha256);
    }
  });
});
