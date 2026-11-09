// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the convention cosplay zombies' LOOKS and ASSETS.
// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME): updated for the FULL costumes (head piece + upper + lower with legwear and
// footwear; skirted looks on female bodies, the kigurumi / happi coat on every presentation).
// Pins: the costumes are an ISOLATED wardrobe library (never in the ordinary pool; the lingerie library untouched), deterministic looks
// (consecutive spawns wear different costumes), the spawn-time choice (only 'cosplay'-tagged spawns, only when buildable exactly; else a
// covered ordinary fallback), the lazily loaded files (only for a layout holding a cosplay spawn; never boot files), and the shipped
// files' allowlist / provenance; with the real GLBs, every shipped (costume, body) fit builds through the real createCosplayLibrary.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {COSPLAY_COSTUMES, COSPLAY_FITS, COSPLAY_LOOK, COSPLAY_MODEL_FILES, COSPLAY_WEARABLES, cosplayLook, createCosplayLibrary, isCosplayWearable} from '../src/ai/cosplay';
import {COSPLAY_COSTUME_FILES} from '../src/ai/cosplayCostumes.generated';
import {LINGERIE_WEARABLES, lingerieLook} from '../src/ai/lingerie';
import {chooseSpawnLook, cosplayFallbackPool, cosplayLookUsable, cosplayModelKeysFor, lingerieModelKeysFor, type SpawnLookLibrary} from '../src/ai/spawnLook';
import {DEFAULT_ZOMBIE_POOL, pickZombieLook, type WardrobeAvailability, type ZombieLook} from '../src/ai/wardrobe';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES} from '../src/ai/outfits';
import type {ZombieSpawn} from '../src/gen/stationTypes';
import {COSPLAY_SPAWN_LOOK} from '../src/gen/skyways/cosplaySpawns';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUB = path.join(ROOT, 'game/public');
const COSTUME_IDS = COSPLAY_COSTUMES.map(c => c.id);

/** An ordinary availability over the ordinary registry (every pair supported): what pickZombieLook can ever choose from. */
const ORDINARY: SpawnLookLibrary = {
  available: {bodies: ZOMBIE_BODIES, wearables: ZOMBIE_WEARABLES, supports: () => true, outfits: ZOMBIE_WEARABLES.filter(w => w.slot === 'upper')} as WardrobeAvailability,
  isValid: () => true,
};
const spawn = (look?: 'cosplay' | 'lingerie'): Pick<ZombieSpawn, 'type' | 'look'> => ({type: 'shambler', ...(look ? {look} : {})});

describe('cosplay wardrobe: isolation', () => {
  it('the costume pieces are their own weight-0 wearables, never in the ordinary registry, the lingerie library or the boot manifest', () => {
    expect(COSPLAY_LOOK).toBe(COSPLAY_SPAWN_LOOK);
    expect(COSTUME_IDS).toEqual(['bear-idol', 'mascot-suit', 'sushi-fan', 'rose-uniform']);
    expect(COSPLAY_WEARABLES.length).toBe(12); // head + upper + lower of each of the four costumes
    for (const w of COSPLAY_WEARABLES) {
      expect(w.weight, w.id).toBe(0);
      expect(w.tags).toContain('cosplay');
      expect(w.id.startsWith('cosplay-')).toBe(true);
      expect(isCosplayWearable(w.id)).toBe(true);
      expect(ZOMBIE_WEARABLES.some(o => o.id === w.id || o.model === w.model), w.id).toBe(false);
      expect(LINGERIE_WEARABLES.some(o => o.id === w.id || o.model === w.model)).toBe(false);
    }
    for (const w of [...ZOMBIE_WEARABLES, ...LINGERIE_WEARABLES]) expect(isCosplayWearable(w.id)).toBe(false);
    for (const key of Object.keys(COSPLAY_MODEL_FILES)) expect((MODEL_FILES as Record<string, unknown>)[key], key).toBeUndefined();
    // the ordinary pool never yields a costume piece (it only knows the ordinary registry)
    const av = ORDINARY.available;
    for (let i = 0; i < 400; i++) for (const type of ['shambler', 'coated'] as const) {
      const l = pickZombieLook(777, i, type, av, DEFAULT_ZOMBIE_POOL);
      for (const id of Object.values(l.wear)) expect(isCosplayWearable(id)).toBe(false);
    }
  });

  it('every costume: a head piece, an upper and a lower, each a cosplay wearable of its slot, fitted to at least one body', () => {
    for (const c of COSPLAY_COSTUMES) {
      const slotOf = (id: string) => COSPLAY_WEARABLES.find(w => w.id === id)?.slot;
      expect([slotOf(c.pieces.head), slotOf(c.pieces.upper), slotOf(c.pieces.lower)], c.id).toEqual(['head', 'upper', 'lower']);
      for (const id of Object.values(c.pieces)) expect(isCosplayWearable(id), id).toBe(true);
      expect(c.bodies.length, c.id).toBeGreaterThanOrEqual(1);
      // never the scavenger (its built-in mask fills the head slot)
      expect(c.bodies).not.toContain('scavenger');
      // every piece's file variant list holds the costume's bodies
      for (const id of Object.values(c.pieces)) {
        const w = COSPLAY_COSTUME_FILES.flatMap(f => f.wearables).find(x => x.id === id)!;
        for (const b of c.bodies) expect(w.bodies, `${id} x ${b}`).toContain(b);
      }
    }
  });
});

describe('cosplay looks: deterministic, varied, buildable-only', () => {
  it('cosplayLook: a pure function of (seed, index); consecutive spawns wear different costumes; the body is one the costume fits', () => {
    for (const seed of [1, 42, 4242, 0xdeadbeef]) {
      const seen: string[] = [];
      for (let i = 0; i < 12; i++) {
        const l = cosplayLook(seed, i);
        expect(cosplayLook(seed, i)).toEqual(l);
        const c = COSPLAY_COSTUMES.find(x => x.id === l.costume)!;
        expect(c.bodies).toContain(l.body);
        expect(l.wear).toEqual({head: c.pieces.head, upper: c.pieces.upper, lower: c.pieces.lower});
        seen.push(l.costume);
      }
      expect(new Set(seen.slice(0, 4)).size, `seed ${seed}: the first four spawns`).toBe(4);
      for (let k = 1; k < seen.length; k++) expect(seen[k]).not.toBe(seen[k - 1]);
    }
    // `usable` restricts the choice (a costume with no usable body is skipped)
    const only = cosplayLook(9, 0, l => l.costume === 'sushi-fan');
    expect(only.costume).toBe('sushi-fan');
  });

  it('chooseSpawnLook: only a cosplay-tagged spawn wears a costume, only when the cosplay library builds it exactly; else a COVERED ordinary look', () => {
    const lib = {isValid: (l: ZombieLook) => !!l.wear.head && isCosplayWearable(l.wear.head)};
    const nude = new Set(ZOMBIE_BODIES.filter(b => b.nude).map(b => b.id));
    expect(nude.size).toBe(3);
    for (let i = 0; i < 40; i++) {
      const ordinary = {look: pickZombieLook(55, i, 'shambler', ORDINARY.available), library: 'ordinary'};
      const covered = {look: pickZombieLook(55, i, 'shambler', ORDINARY.available, cosplayFallbackPool(ORDINARY.available)), library: 'ordinary'};
      const c = chooseSpawnLook(55, i, spawn('cosplay'), ORDINARY, lib);
      expect(c.library).toBe('cosplay');
      expect(c.look).toEqual(cosplayLook(55, i, l => lib.isValid(l)));
      expect(cosplayLookUsable(c.look, lib)).toBe(true);
      // not loaded / not buildable -> the ordinary pick WITHOUT the unclothed bodies (never a bare body)
      const nl = chooseSpawnLook(55, i, spawn('cosplay'), ORDINARY, null), nb = chooseSpawnLook(55, i, spawn('cosplay'), ORDINARY, {isValid: () => false});
      expect(nl).toEqual(covered);
      expect(nb).toEqual(covered);
      expect(nude.has(nl.look.body), `#${i} ${nl.look.body}`).toBe(false);
      // an untagged spawn never, whatever library is passed (the ordinary pick, pale bodies included)
      expect(chooseSpawnLook(55, i, spawn(), ORDINARY, lib)).toEqual(ordinary);
      // a lingerie spawn keeps the lingerie path (a cosplay library never dresses it in a costume)
      const lg = chooseSpawnLook(55, i, spawn('lingerie'), ORDINARY, {isValid: () => true});
      expect(lg).toEqual({look: lingerieLook(55, i, () => true), library: 'lingerie'});
    }
  });

  it('lazy files: requested only by a layout holding a cosplay spawn (and the lingerie hook never asks for them)', () => {
    const z = (look?: 'cosplay') => ({x: 0, z: 0, yaw: 0, type: 'shambler' as const, area: 0, ...(look ? {look} : {})});
    expect(cosplayModelKeysFor({zombies: [z()]})).toEqual([]);
    expect(cosplayModelKeysFor({zombies: [z(), z('cosplay')]})).toEqual(Object.keys(COSPLAY_MODEL_FILES).sort());
    expect(Object.keys(COSPLAY_MODEL_FILES).sort()).toEqual(['outfit_cosplay_costume_head', 'outfit_cosplay_costume_lower', 'outfit_cosplay_costume_upper']);
    expect(lingerieModelKeysFor({zombies: [z('cosplay')]})).toEqual([]);
  });
});

describe('cosplay assets: shipped files, allowlist, provenance', () => {
  const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
  const record = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/outfit-cosplay-costume.json'), 'utf8'));
  it('every costume file + its provenance record is allowlisted with its exact bytes / sha256; the build record matches the files', () => {
    const files = [...COSPLAY_COSTUME_FILES.map(f => f.url), 'assets/derivatives/outfit-cosplay-costume.json'];
    for (const rel of files) {
      const buf = fs.readFileSync(path.join(PUB, rel));
      const e = inputs.files.find(f => f.path === rel);
      expect(e, rel).toBeDefined();
      expect(e!.bytes, rel).toBe(buf.byteLength);
      expect(e!.sha256, rel).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    }
    for (const f of COSPLAY_COSTUME_FILES) {
      const buf = fs.readFileSync(path.join(PUB, f.url));
      expect(buf.byteLength, f.url).toBe(f.bytes);
      expect(record.outputs[f.slot].sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    }
    expect(record.status.approved).toBe(false);
    expect(record.costumes.map((c: {id: string}) => c.id)).toEqual(COSTUME_IDS);
    // the previous dyed-garment pieces stay tracked + allowlisted (cooked inputs are never deleted), merely unreferenced now
    for (const rel of ['assets/models/outfit-cosplay-head.glb', 'assets/models/outfit-cosplay-upper.glb', 'assets/models/outfit-cosplay-lower.glb']) {
      expect(fs.existsSync(path.join(PUB, rel)), rel).toBe(true);
      expect(inputs.files.some(f => f.path === rel), rel).toBe(true);
    }
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// End to end with the real files: the shipped bodies + outfit-cosplay-costume-*.glb through createCosplayLibrary

async function loadStripped(file: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

describe('end to end: every shipped costume fit builds from the real files', () => {
  const models: Record<string, GLTF> = {};
  beforeAll(async () => {
    const bodies = new Set(COSPLAY_FITS.map(f => f.body));
    for (const b of ZOMBIE_BODIES.filter(x => bodies.has(x.id))) { const f = (MODEL_FILES as Record<string, {url: string} | undefined>)[b.model]; if (f) models[b.model] = await loadStripped(path.join(PUB, f.url)); }
    for (const [key, f] of Object.entries(COSPLAY_MODEL_FILES)) models[key] = await loadStripped(path.join(PUB, f.url));
  }, 180_000);

  it('createCosplayLibrary builds every (costume, body) fit with exactly its three pieces; the body is masked under them', () => {
    const lib = createCosplayLibrary(models); // = game.ts cosplayLookLibrary(boot models + the loaded lazy costumes)
    expect(COSPLAY_FITS.length).toBeGreaterThanOrEqual(12);
    for (const {costume, body} of COSPLAY_FITS) {
      const c = COSPLAY_COSTUMES.find(x => x.id === costume)!;
      const look = {body, wear: {head: c.pieces.head, upper: c.pieces.upper, lower: c.pieces.lower}};
      expect(lib.isValid(look), `${costume} x ${body}`).toBe(true);
      const app = lib.build(look);
      expect(app.look, `${costume} x ${body}`).toEqual(look);
      expect(app.meshes.map(m => m.slot).sort()).toEqual(['body', 'head', 'lower', 'upper']);
      expect(app.heavy).toBe(false);
      // the hit volumes stay the ordinary zombie's, the costume adding at most its capped bulk
      expect(app.hit.head).toBeGreaterThan(0.1);
      expect(app.hit.head).toBeLessThan(0.25);
      expect(app.hit.torso).toBeLessThan(0.32);
      const bodyMesh = app.meshes.find(m => m.slot === 'body')!.mesh;
      const template = models[ZOMBIE_BODIES.find(b => b.id === body)!.model].scene.getObjectByName('ZombieBody') as unknown as {geometry: {index: {count: number}}};
      expect(bodyMesh.geometry.index!.count, `${costume} x ${body}: body triangles hidden under the costume`).toBeLessThan(template.geometry.index.count * 0.85);
    }
    // a look outside the fits is never valid (a costume on a body it does not fit), so the spawn falls back to the covered ordinary pick
    const unfitted = COSPLAY_COSTUMES.flatMap(c => ZOMBIE_BODIES.filter(b => !c.bodies.includes(b.id)).map(b => ({body: b.id, wear: {head: c.pieces.head, upper: c.pieces.upper, lower: c.pieces.lower}})));
    expect(unfitted.length).toBeGreaterThan(0);
    for (const l of unfitted) expect(lib.isValid(l), `${l.body} ${l.wear.upper}`).toBe(false);
    // the cosplay library holds nothing but cosplay pieces
    expect(lib.wearables.filter(w => !isCosplayWearable(w.id))).toEqual([]);
    // every tagged spawn's look is buildable through the real library
    for (let i = 0; i < 16; i++) {
      const pick = chooseSpawnLook(4242, i, spawn('cosplay'), ORDINARY, lib);
      expect(pick.library).toBe('cosplay');
      expect(lib.build(pick.look).meshes.filter(m => m.slot !== 'body').every(m => isCosplayWearable(m.wearable))).toBe(true);
    }
  });
});
