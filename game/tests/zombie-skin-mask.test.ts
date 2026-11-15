// Task studio-reactor-glowing-zombies-20261115-013245-01 (lane MASK): the irradiated zombies' packed SKIN MASK (a data texture built by
// tools/asset-pipeline/zombie/build-skin-mask.mjs from the shipped ordinary zombie bodies). Checks, on the REAL committed files:
//  - registry: the generated slots cover exactly the ZOMBIE_BODIES ids, unique (tile, channel) pairs inside the 2 x 2 RGB layout;
//  - file: the PNG exists with the recorded bytes / sha256, decodes to 1024² RGB, the free tile is empty, every slot is non-empty;
//  - provenance: inputs are each body's manifest GLB at its CURRENT sha256 (a re-cooked body must rebuild the mask), parameters and
//    coverage recorded per body, output hash = the generated TS;
//  - coverage bands: nude pale bodies mostly skin, base-layer bodies partial, clothed bodies lower, the gas-masked scavenger lowest;
//  - end to end through the helper: sampling the decoded mask at the body mesh's own UVs (the shader's mapping) reads skin on the
//    hands of every body, never on shoes / socks, never on the scavenger's gas-mask head;
//  - helper API: skinMaskSlot / skinMaskChannelSelect / skinMaskCoverage.
import {describe, expect, it, beforeAll} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {ZOMBIE_BODIES} from '../src/ai/outfits';
import {ZOMBIE_SKIN_MASK} from '../src/assets/zombieSkinMask.generated';
import {skinMaskSlot, skinMaskChannelSelect, skinMaskCoverage, SKIN_MASK_URL, type SkinMaskChannel} from '../src/ai/irradiatedSkinMask';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Prov {
  output: {url: string; width: number; height: number; bytes: number; sha256: string; tile: number};
  bodies: Record<string, {
    input: {glb: string; sha256: string; bytes: number; baseColorSha256: string};
    slot: {tile: [number, number]; channel: number};
    parameters: Record<string, unknown>;
    reasons: Record<string, string>;
    coverage: {surface: number; uv: number};
  }>;
  limits: string[];
}
const prov = JSON.parse(readFileSync(pub('assets/derivatives/zombie-skin-mask.json'), 'utf8')) as Prov;
const IDS = ZOMBIE_BODIES.map(b => b.id);
const SLOTS = ZOMBIE_SKIN_MASK.slots as Readonly<Record<string, {readonly tile: readonly [number, number]; readonly channel: number}>>;
const COVER = ZOMBIE_SKIN_MASK.coverage as Readonly<Record<string, number>>;

let mask: {data: Buffer; width: number; height: number; channels: number};
beforeAll(async () => {
  const {data, info} = await sharp(readFileSync(pub(ZOMBIE_SKIN_MASK.url))).raw().toBuffer({resolveWithObject: true});
  mask = {data, width: info.width, height: info.height, channels: info.channels};
});

/** Nearest-texel mask value (0..1) of `bodyId` at a body-mesh UV, through the runtime helper's mapping. */
function sampleMask(bodyId: string, u: number, v: number): number {
  const s = skinMaskSlot(bodyId)!;
  const x = Math.min(mask.width - 1, Math.floor((s.u0 + u * s.scale) * mask.width));
  const y = Math.min(mask.height - 1, Math.floor((s.v0 + v * s.scale) * mask.height));
  return mask.data[(y * mask.width + x) * mask.channels + s.channel] / 255;
}

describe('zombie skin mask: registry and layout', () => {
  it('covers exactly the ordinary zombie bodies, one unique RGB channel of one 2 x 2 tile each', () => {
    expect(Object.keys(SLOTS).sort()).toEqual([...IDS].sort());
    const seen = new Set<string>();
    for (const id of IDS) {
      const s = SLOTS[id];
      expect(s.tile[0] === 0 || s.tile[0] === 1).toBe(true);
      expect(s.tile[1] === 0 || s.tile[1] === 1).toBe(true);
      expect([0, 1, 2]).toContain(s.channel); // alpha deliberately unused (premultiplied uploads)
      const k = `${s.tile[0]},${s.tile[1]},${s.channel}`;
      expect(seen.has(k), `${id} shares slot ${k}`).toBe(false);
      seen.add(k);
    }
    expect(ZOMBIE_SKIN_MASK.size).toBe(1024);
    expect(ZOMBIE_SKIN_MASK.tile).toBe(512);
    expect(ZOMBIE_SKIN_MASK.url).toBe('assets/textures/zombie-skin-mask.png');
    expect(SKIN_MASK_URL).toBe(ZOMBIE_SKIN_MASK.url);
  });

  it('ships the PNG with the recorded size / hash, decoding to 1024² RGB', () => {
    const file = pub(ZOMBIE_SKIN_MASK.url);
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.length).toBe(ZOMBIE_SKIN_MASK.bytes);
    expect(sha(bytes)).toBe(ZOMBIE_SKIN_MASK.sha256);
    expect(bytes.length).toBeLessThan(400_000); // a data mask stays small
    expect([mask.width, mask.height, mask.channels]).toEqual([1024, 1024, 3]);
  });

  it('every slot holds a non-empty mask and the free tile / channels stay 0', () => {
    const used = new Set(IDS.map(id => `${SLOTS[id].tile[0]},${SLOTS[id].tile[1]},${SLOTS[id].channel}`));
    const T = ZOMBIE_SKIN_MASK.tile;
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = ty * T; y < (ty + 1) * T; y++) for (let x = tx * T; x < (tx + 1) * T; x++) sum += mask.data[(y * mask.width + x) * 3 + c];
      if (used.has(`${tx},${ty},${c}`)) expect(sum, `tile ${tx},${ty} ch ${c}`).toBeGreaterThan(0.02 * T * T * 255);
      else expect(sum, `unused tile ${tx},${ty} ch ${c}`).toBe(0);
    }
  });
});

describe('zombie skin mask: provenance', () => {
  it('records each body manifest GLB at its current sha256, the slot, parameters, reasons and coverage', () => {
    expect(Object.keys(prov.bodies).sort()).toEqual([...IDS].sort());
    expect(prov.output).toMatchObject({url: ZOMBIE_SKIN_MASK.url, width: 1024, height: 1024, bytes: ZOMBIE_SKIN_MASK.bytes, sha256: ZOMBIE_SKIN_MASK.sha256, tile: 512});
    for (const b of ZOMBIE_BODIES) {
      const p = prov.bodies[b.id];
      const url = MODEL_FILES[b.model as keyof typeof MODEL_FILES].url;
      expect(p.input.glb, b.id).toBe(url);
      const glb = readFileSync(pub(url));
      expect(sha(glb), `${b.id}: body GLB changed since the mask was built - rerun build-skin-mask.mjs`).toBe(p.input.sha256);
      expect(p.input.bytes).toBe(glb.length);
      expect(p.slot.tile).toEqual([...SLOTS[b.id].tile]);
      expect(p.slot.channel).toBe(SLOTS[b.id].channel);
      expect(Object.keys(p.parameters).length).toBeGreaterThan(5);
      expect(Object.keys(p.reasons).length).toBeGreaterThan(0);
      for (const why of Object.values(p.reasons)) expect(why.length).toBeGreaterThan(10);
      expect(p.coverage.surface).toBeCloseTo(COVER[b.id], 4);
    }
    expect(prov.limits.length).toBeGreaterThan(2);
  });
});

describe('zombie skin mask: coverage bands', () => {
  it('pale nude bodies are mostly skin, base-layer bodies partial, clothed bodies lower, the gas-masked scavenger lowest', () => {
    for (const id of ['paleGaze', 'paleRevenant', 'paleApparition']) expect(COVER[id], id).toBeGreaterThan(0.45);
    for (const id of ['paleGaze', 'paleRevenant', 'paleApparition']) expect(COVER[id], id).toBeLessThan(0.9); // hair, eyes, mouth stay out
    for (const id of ['heavyset', 'tall']) { expect(COVER[id], id).toBeGreaterThan(0.25); expect(COVER[id], id).toBeLessThan(0.65); }
    for (const id of ['lastshift', 'courier', 'agent']) { expect(COVER[id], id).toBeGreaterThan(0.08); expect(COVER[id], id).toBeLessThan(0.35); }
    expect(COVER.scavenger).toBeGreaterThan(0.02);
    expect(COVER.scavenger).toBeLessThan(0.15);
    for (const id of IDS) if (id !== 'scavenger') expect(COVER.scavenger, id).toBeLessThan(COVER[id]);
    for (const id of IDS) expect(skinMaskCoverage(id)).toBe(COVER[id]);
  });
});

describe('zombie skin mask: sampled at the body meshes\' own UVs (the shader mapping)', () => {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  /** Mean mask value over vertices whose dominant skin joint is one of `joints`. */
  async function meanByJoint(bodyId: string, model: string) {
    const doc = await io.read(pub(MODEL_FILES[model as keyof typeof MODEL_FILES].url));
    const prim = doc.getRoot().listMeshes().find(m => m.getName() === 'ZombieBody')!.listPrimitives()[0];
    const names = doc.getRoot().listSkins()[0].listJoints().map(j => j.getName());
    const uv = prim.getAttribute('TEXCOORD_0')!, J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
    const acc = new Map<string, {s: number; n: number}>();
    const e: number[] = [], je: number[] = [], we: number[] = [];
    for (let i = 0; i < uv.getCount(); i++) {
      uv.getElement(i, e); J.getElement(i, je); W.getElement(i, we);
      let k = 0;
      for (let q = 1; q < 4; q++) if (we[q] > we[k]) k = q;
      if (we[k] < 0.9) continue; // clearly inside one bone's region
      const joint = names[je[k]].replace(/^[LR]_/, '');
      const a = acc.get(joint) ?? {s: 0, n: 0};
      a.s += sampleMask(bodyId, e[0], e[1]); a.n++;
      acc.set(joint, a);
    }
    return (joint: string) => { const a = acc.get(joint); return a && a.n ? a.s / a.n : NaN; };
  }

  it('hands read as skin on every body; shoes / socks never; the scavenger\'s gas-mask head never', async () => {
    for (const b of ZOMBIE_BODIES) {
      const mean = await meanByJoint(b.id, b.model);
      expect(mean('Hand'), `${b.id} hands`).toBeGreaterThan(0.6);
      if (b.tags?.includes('pale')) expect(mean('Foot'), `${b.id} bare feet`).toBeGreaterThan(0.5);
      else expect(mean('Foot'), `${b.id} shoes / socks`).toBeLessThan(0.05);
    }
    const scav = await meanByJoint('scavenger', 'zombieBody_scavenger');
    expect(scav('Head')).toBeLessThan(0.02);
    expect(scav('UpperArm')).toBeLessThan(0.05); // jacket sleeves
  });
});

describe('zombie skin mask: helper API', () => {
  it('skinMaskSlot maps each body to its tile offset (UV units), scale and channel; unknown ids are null', () => {
    for (const id of IDS) {
      const s = skinMaskSlot(id)!;
      expect(s).not.toBeNull();
      expect(s.scale).toBe(0.5);
      expect(s.u0).toBe(SLOTS[id].tile[0] * 0.5);
      expect(s.v0).toBe(SLOTS[id].tile[1] * 0.5);
      expect(s.channel).toBe(SLOTS[id].channel);
    }
    expect(skinMaskSlot('nope')).toBeNull();
    expect(skinMaskSlot('toString')).toBeNull(); // own keys only
    expect(skinMaskSlot('')).toBeNull();
    expect(skinMaskCoverage('nope')).toBeNull();
  });

  it('skinMaskChannelSelect is one-hot', () => {
    for (const c of [0, 1, 2] as SkinMaskChannel[]) {
      const v = skinMaskChannelSelect(c);
      expect(v.length).toBe(4);
      expect(v.reduce((a, x) => a + x, 0)).toBe(1);
      expect(v[c]).toBe(1);
    }
  });
});
