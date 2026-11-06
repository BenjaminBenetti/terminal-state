// Skyways lane ASSET-C: the convention MASCOT statues (assets/models/skyways-mascot-poses.glb), cooked by
// tools/asset-pipeline/props/build-skyways-mascot.mjs from the community-supplied chibi figure by deterministic region skinning.
// Checks the runtime contract: one material / one texture set shared by one mesh node per baked pose (same topology, shared UV and
// index accessors), the per-pose triangle budget, grounded statues at 1.40 m, registry dims = the file's bounds, the point pose's
// pointDir really follows the posed arm, and provenance <-> release allowlist bind these exact bytes.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {getBounds} from '@gltf-transform/functions';
import {SKYWAYS_MASCOT} from '../src/assets/skywaysMascot.generated';

const MODEL = 'assets/models/skyways-mascot-poses.glb', SIDECAR = 'assets/derivatives/skyways-mascot-poses.json';
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('Skyways convention mascot statues (baked poses)', async () => {
  const bytes = readFileSync(pub(MODEL));
  const prov = JSON.parse(readFileSync(pub(SIDECAR), 'utf8'));
  const doc = await new NodeIO().readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const names = Object.keys(SKYWAYS_MASCOT.poses);

  it('one mesh node per pose, named as the registry, baked at identity; at least stand / wave / point / cheer / bow', () => {
    expect(nodes.map(n => n.getName())).toEqual(names);
    for (const want of ['stand', 'wave', 'point', 'cheer', 'bow']) expect(names).toContain(want);
    for (const n of nodes) {
      expect(n.getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      expect(n.listChildren()).toHaveLength(0);
      expect(n.getMesh()!.listPrimitives()).toHaveLength(1);
    }
  });

  it('one material and one texture set (the source maps re-encoded once: base colour 1024, normal 1024, metallic-roughness 512)', () => {
    const mats = root.listMaterials();
    expect(mats).toHaveLength(1);
    const m = mats[0];
    expect(m.getAlphaMode()).toBe('OPAQUE');
    expect(root.listTextures()).toHaveLength(3);
    for (const t of root.listTextures()) expect(t.getMimeType()).toBe('image/jpeg');
    expect(m.getBaseColorTexture()!.getSize()).toEqual([1024, 1024]);
    expect(m.getNormalTexture()!.getSize()).toEqual([1024, 1024]);
    expect(m.getMetallicRoughnessTexture()!.getSize()).toEqual([512, 512]);
    for (const n of nodes) expect(n.getMesh()!.listPrimitives()[0].getMaterial()).toBe(m);
    expect(root.listExtensionsUsed()).toHaveLength(0); // plain glTF: no Draco / meshopt / KTX2 decoder at runtime
  });

  it('same topology in every pose: shared UV + index accessors, equal vertex counts, <= 20k triangles each', () => {
    const prims = nodes.map(n => n.getMesh()!.listPrimitives()[0]);
    const uv = prims[0].getAttribute('TEXCOORD_0'), idx = prims[0].getIndices();
    const count = prims[0].getAttribute('POSITION')!.getCount();
    for (const [i, p] of prims.entries()) {
      expect(p.getAttribute('TEXCOORD_0')).toBe(uv);
      expect(p.getIndices()).toBe(idx);
      expect(p.getAttribute('POSITION')!.getCount()).toBe(count);
      expect(p.getAttribute('NORMAL')!.getCount()).toBe(count);
      const tris = p.getIndices()!.getCount() / 3;
      expect(tris).toBeLessThanOrEqual(20000);
      expect(tris).toBe(SKYWAYS_MASCOT.poses[names[i] as keyof typeof SKYWAYS_MASCOT.poses].tris);
    }
  });

  it('grounded statues; the stand is 1.40 m tall and centred; registry dims are the file bounds', () => {
    expect(SKYWAYS_MASCOT.height).toBe(1.4);
    for (const n of nodes) {
      const b = getBounds(n), reg = SKYWAYS_MASCOT.poses[n.getName() as keyof typeof SKYWAYS_MASCOT.poses];
      expect(Math.abs(b.min[1])).toBeLessThan(1e-4); // feet on the floor in every pose
      expect(b.max[0] - b.min[0]).toBeCloseTo(reg.w, 3);
      expect(b.max[1] - b.min[1]).toBeCloseTo(reg.h, 3);
      expect(b.max[2] - b.min[2]).toBeCloseTo(reg.d, 3);
      expect(b.max[1]).toBeGreaterThan(1.2); // no pose collapses the statue
    }
    const s = getBounds(nodes.find(n => n.getName() === 'stand')!);
    expect(s.max[1] - s.min[1]).toBeCloseTo(1.4, 3);
    expect(Math.abs(s.min[0] + s.max[0])).toBeLessThan(2e-3);
    expect(Math.abs(s.min[2] + s.max[2])).toBeLessThan(2e-3);
  });

  it('every pose but the stand moves geometry; the point pose points its arm horizontally along pointDir', () => {
    const pos = (name: string) => nodes.find(n => n.getName() === name)!.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getArray()!;
    const stand = pos('stand');
    for (const name of names.filter(n => n !== 'stand')) {
      const p = pos(name);
      let moved = 0;
      for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] - stand[i], p[i + 1] - stand[i + 1], p[i + 2] - stand[i + 2]) > 0.01) moved++;
      expect(moved, name).toBeGreaterThan(100);
    }
    const dir = SKYWAYS_MASCOT.poses.point.pointDir;
    expect(Math.hypot(dir[0], dir[1])).toBeCloseTo(1, 3);
    for (const name of names.filter(n => n !== 'point')) expect('pointDir' in SKYWAYS_MASCOT.poses[name as keyof typeof SKYWAYS_MASCOT.poses]).toBe(false);
    // the hand = the moved vertex farthest from the pointing arm's shoulder (recorded in the provenance rig)
    const shoulder = (prov.rig.arms as {side: string; shoulder: number[]}[]).find(a => (a.side.startsWith('-') ? -1 : 1) === Math.sign(dir[0]))!.shoulder;
    const p = pos('point');
    let tip = -1, far = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.hypot(p[i] - stand[i], p[i + 1] - stand[i + 1], p[i + 2] - stand[i + 2]) < 0.01) continue;
      const d = Math.hypot(p[i] - shoulder[0], p[i + 1] - shoulder[1], p[i + 2] - shoulder[2]);
      if (d > far) { far = d; tip = i; }
    }
    const h = [p[tip] - shoulder[0], p[tip + 2] - shoulder[2]], hl = Math.hypot(h[0], h[1]);
    expect(far).toBeGreaterThan(0.18); // a real arm's reach
    expect((h[0] * dir[0] + h[1] * dir[1]) / hl).toBeGreaterThan(0.97);
    expect(Math.abs(p[tip + 1] - shoulder[1])).toBeLessThan(0.07); // straight out to the side, horizontal
  });

  it('provenance (community-supplied source, no licence claim) and the release allowlist bind these exact bytes', () => {
    expect(prov).toMatchObject({id: 'skyways-mascot-poses', output: {url: MODEL, bytes: bytes.length, sha256: sha(bytes), nodes: names}});
    expect(prov.sourceStatus).toBe('community-supplied source via the user; creator / license links pending; no license or authorship claim');
    expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.convention).toMatch(/front \+Z/);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=/i);
    expect(SKYWAYS_MASCOT.url).toBe(MODEL);
    expect(SKYWAYS_MASCOT.bytes).toBe(bytes.length);
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const side = readFileSync(pub(SIDECAR));
    expect(allow.get(MODEL)).toEqual({path: MODEL, bytes: bytes.length, sha256: sha(bytes)});
    expect(allow.get(SIDECAR)).toEqual({path: SIDECAR, bytes: side.length, sha256: sha(side)});
  });
});
