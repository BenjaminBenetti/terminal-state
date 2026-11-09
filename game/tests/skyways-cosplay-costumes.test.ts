// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME): the convention's FULL cosplay costumes.
// User: "Current hat-only costumes are low effort. Full costume / clothing swap. 70% female zombie variants, preferably unclothed base
// variants IN COMPLETE CLOTHES for fit, no unclothed final characters."
// Pins: the female share (~70 %, seeded per spawn, local to the convention); every look a FULL costume (head piece, upper with sleeves,
// lower with legwear AND footwear; the unclothed bodies always both, covered in every validated frame); never in the ordinary / lingerie
// pools; the covered fallback (never a bare body) through the real ordinary library; lazy convention-only loading before the section is
// built and warmed up; the costume materials in the warm-up plan; provenance (Meshy masters pinned, maps kept), allowlist, bytes; the
// builder's --check.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {COSPLAY_BODY_WEIGHT, COSPLAY_COSTUMES, COSPLAY_FEMALE_SHARE, COSPLAY_FITS, COSPLAY_MODEL_FILES, cosplayBodyPresentation, cosplayLook, createCosplayLibrary, isCosplayWearable} from '../src/ai/cosplay';
import {COSPLAY_COSTUME_FILES} from '../src/ai/cosplayCostumes.generated';
import {LINGERIE_BUILD} from '../src/ai/lingerie.generated';
import {chooseSpawnLook, cosplayModelKeysFor} from '../src/ai/spawnLook';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES, ZombieLookLibrary} from '../src/ai/outfits';
import {planWarmup, warmKeys} from '../src/render/warmup';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUB = path.join(ROOT, 'game/public');
const RECORD = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/outfit-cosplay-costume.json'), 'utf8'));
const NUDE = new Set(ZOMBIE_BODIES.filter(b => b.nude).map(b => b.id));

describe('presentation: ~70 % female, seeded per spawn, local to the convention', () => {
  it('the expected female share over many seeded spawns is COSPLAY_FEMALE_SHARE; the pale unclothed bodies are preferred among the female ones', () => {
    expect(COSPLAY_FEMALE_SHARE).toBe(0.7);
    let n = 0, female = 0, pale = 0, tall = 0;
    for (let seed = 1; seed <= 600; seed++) for (let i = 0; i < 8; i++) {
      const l = cosplayLook(seed * 7919, 100 + i);
      const p = cosplayBodyPresentation(l.body);
      expect(p, l.body).toBeDefined();
      n++;
      if (p === 'female') { female++; if (NUDE.has(l.body)) pale++; if (l.body === 'tall') tall++; }
    }
    expect(female / n).toBeGreaterThan(0.66);
    expect(female / n).toBeLessThan(0.74);
    // the unclothed pale bodies are weighted above the base-layer tall woman wherever both fit
    expect(COSPLAY_BODY_WEIGHT.paleGaze).toBeGreaterThan(COSPLAY_BODY_WEIGHT.tall);
    expect(pale).toBeGreaterThan(0);
    expect(pale + tall).toBe(female);
    // the presentation table covers every shipped body; the ordinary registry has no such notion (the ordinary pool is untouched)
    for (const {body} of COSPLAY_FITS) expect(['female', 'male']).toContain(cosplayBodyPresentation(body));
    expect(ZOMBIE_BODIES.every(b => !('sex' in b) && !('presentation' in b))).toBe(true);
  });

  it('skirted costumes (the idol and the uniform) are on female bodies only; the kigurumi and the happi coat on both presentations', () => {
    for (const c of COSPLAY_COSTUMES) {
      const ps = new Set(c.bodies.map(b => cosplayBodyPresentation(b)));
      if (c.id === 'bear-idol' || c.id === 'rose-uniform') expect([...ps], c.id).toEqual(['female']);
      else expect(ps.size, c.id).toBe(2);
    }
  });

  it('old saves: a look is a pure function of (seed, spawn index) - a version-5 cosplay spawn simply wears the new costume (no reroll)', () => {
    const a = Array.from({length: 30}, (_, i) => cosplayLook(123456, i));
    const b = Array.from({length: 30}, (_, i) => cosplayLook(123456, i));
    expect(b).toEqual(a);
    expect(cosplayLook.length).toBe(3); // (seed, index, usable?) - nothing else is read
  });
});

describe('full costumes', () => {
  it('every shipped fit: head piece + upper (torso + both sleeves) + lower (waist / skirt + both legs + both shoes), all passing the gate in every clip', () => {
    expect(RECORD.costumes.map((c: {id: string}) => c.id)).toEqual(COSPLAY_COSTUMES.map(c => c.id));
    for (const {costume, body} of COSPLAY_FITS) {
      const f = RECORD.fits[`${costume}@${body}`];
      expect(f, `${costume} x ${body}`).toBeDefined();
      expect(f.failures, `${costume} x ${body}`).toEqual([]);
      expect(f.head.ok).toBe(true);
      const up = f.fit.upper.parts, lo = f.fit.lower.parts;
      for (const p of ['torso', 'sleeveL', 'sleeveR']) expect(up[p], `${costume} x ${body} upper ${p}`).toBeGreaterThan(100);
      for (const p of ['waist', 'legL', 'legR', 'shoeL', 'shoeR']) expect(lo[p], `${costume} x ${body} lower ${p}`).toBeGreaterThan(50);
      // validated through all six clips + the three ragdoll-like poses
      expect(Object.keys(f.summary).sort()).toEqual(['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk', 'ragdoll-crumple', 'ragdoll-sprawl', 'ragdoll-twist']);
    }
  });

  it('the unclothed bodies: every costume on them has an upper AND a lower, and the breast apices and the groin core are covered in EVERY frame', () => {
    const nudeFits = COSPLAY_FITS.filter(f => NUDE.has(f.body));
    expect(nudeFits.length).toBeGreaterThanOrEqual(6);
    for (const {costume, body} of nudeFits) {
      const c = COSPLAY_COSTUMES.find(x => x.id === costume)!;
      expect(c.pieces.upper && c.pieces.lower).toBeTruthy();
      const f = RECORD.fits[`${costume}@${body}`];
      expect(f.nude).toBe(true);
      for (const [clip, S] of Object.entries(f.summary) as [string, {coverage: {apex: number; groinCore: number; groin: number}}][]) {
        expect(S.coverage.apex, `${costume} x ${body} ${clip} apex`).toBe(1);
        expect(S.coverage.groinCore, `${costume} x ${body} ${clip} groin core`).toBe(1);
        expect(S.coverage.groin, `${costume} x ${body} ${clip} groin`).toBeGreaterThanOrEqual(0.85);
      }
    }
    // excluded pairs are recorded with their reasons (never shipped)
    for (const x of RECORD.gate.excluded) {
      expect(x.failures.length).toBeGreaterThan(0);
      expect(COSPLAY_FITS.some(f => f.costume === x.costume && f.body === x.body), `${x.costume} x ${x.body}`).toBe(false);
    }
  });

  it('garment over garment and hair, every shipped fit in every frame: the lower never pokes through the upper; no hair inside / through the costume, no hair island left lying on it', () => {
    // coordinator QA: the hakama showed through the happi coat (sushi-fan x heavyset), long dark hair through the back of the jackets
    // (pale bodies); the builder measures both on the shipped data (lib/costume-metrics.mjs) and the gate holds them
    const L = RECORD.gate.limits;
    expect(L.layerPokeVisible).toBeLessThanOrEqual(0.015);
    expect(L.hairUnderCloth).toBeLessThanOrEqual(6);
    expect(L.hairIslandVertices).toBe(0);
    for (const {costume, body} of COSPLAY_FITS) {
      const f = RECORD.fits[`${costume}@${body}`], k = `${costume} x ${body}`;
      for (const [clip, S] of Object.entries(f.summary) as [string, {layer: {covered: number; pokeVisible: number; pokeVisibleFraction: number}; hair: {visible: number; underCloth: number; islandVertices: number}}][]) {
        expect(S.layer, `${k} ${clip} layer`).toBeDefined();
        expect(S.layer.covered, `${k} ${clip}`).toBeGreaterThan(0);
        expect(S.layer.pokeVisibleFraction <= L.layerPokeVisible || S.layer.pokeVisible <= L.layerPokeVisibleCount, `${k} ${clip} lower through upper ${S.layer.pokeVisible}`).toBe(true);
        expect(S.hair, `${k} ${clip} hair`).toBeDefined();
        expect(S.hair.underCloth, `${k} ${clip} hair under the cloth`).toBeLessThanOrEqual(L.hairUnderCloth);
        expect(S.hair.islandVertices, `${k} ${clip} hair islands`).toBe(0);
      }
      // the fixes are data: the upper hides the lower it covers (hideWear) and the hair inside / through it (hideBodyTriangles)
      expect(f.fit.upper.layerHidden, k).toBeGreaterThan(0);
      expect(f.fit.upper.hair.hiddenByUpper, k).toBeGreaterThanOrEqual(0);
      if (NUDE.has(body)) expect(f.fit.upper.hair.hiddenByUpper, `${k}: long hair under the jacket hidden`).toBeGreaterThan(0);
    }
    const heavy = RECORD.fits['sushi-fan@heavyset'];
    expect(heavy, 'sushi-fan x heavyset ships (the coat cleared over the hakama)').toBeDefined();
    expect(Math.max(...Object.values(heavy.summary as Record<string, {layer: {pokeVisibleFraction: number}}>).map(S => S.layer.pokeVisibleFraction))).toBeLessThan(0.01);
  });

  it('never in the ordinary or the lingerie pools; the lingerie sets never on a cosplay body variant id', () => {
    for (const w of ZOMBIE_WEARABLES) expect(isCosplayWearable(w.id)).toBe(false);
    for (const s of LINGERIE_BUILD) { expect(isCosplayWearable(s.top)).toBe(false); expect(isCosplayWearable(s.bottom)).toBe(false); }
    for (const f of COSPLAY_COSTUME_FILES) expect(Object.values(MODEL_FILES as Record<string, {url: string}>).some(m => m.url === f.url), f.url).toBe(false);
  });
});

describe('provenance, allowlist, bytes, builder', () => {
  it('the Meshy masters are pinned (task ids, sha256), their PBR maps kept: every costume material has its base colour, normal and metallic-roughness maps', async () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'tools/asset-pipeline/zombie/cosplay-costumes.config.mjs'), 'utf8');
    for (const [id, g] of Object.entries(RECORD.sources.garments) as [string, {sha256: string; meshyTask: string; private: boolean; concept: {sha256: string}}][]) {
      const entry = cfg.slice(cfg.indexOf(`'${id}': {`), cfg.indexOf('simplify:', cfg.indexOf(`'${id}': {`)));
      expect(entry, id).toContain(`sha256: '${g.sha256}'`);
      expect(entry, id).toContain(`meshyTask: '${g.meshyTask}'`);
      expect(g.concept.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(g.private).toBe(true);
    }
    expect(RECORD.honesty.texture).toMatch(/no retexture/);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const f of COSPLAY_COSTUME_FILES.filter(x => x.slot !== 'head')) {
      const doc = await io.read(path.join(PUB, f.url));
      const mats = doc.getRoot().listMaterials();
      expect(mats.length, f.url).toBe(4);
      for (const m of mats) { expect(m.getBaseColorTexture(), m.getName()).not.toBeNull(); expect(m.getNormalTexture(), m.getName()).not.toBeNull(); expect(m.getMetallicRoughnessTexture(), m.getName()).not.toBeNull(); }
    }
  }, 60_000);

  it('three files (one per slot), allowlisted with exact bytes / sha256, small enough (shared textures, shared UVs / indices)', () => {
    const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    expect(COSPLAY_COSTUME_FILES.map(f => f.slot)).toEqual(['head', 'upper', 'lower']);
    let total = 0;
    for (const f of COSPLAY_COSTUME_FILES) {
      const buf = fs.readFileSync(path.join(PUB, f.url));
      total += buf.byteLength;
      const e = inputs.files.find(x => x.path === f.url)!;
      expect(e.bytes).toBe(buf.byteLength);
      expect(e.sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    }
    expect(total).toBeLessThan(12e6);
  });

  it('build-cosplay-costumes.mjs --check (structural): the shipped files match the record', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/asset-pipeline/zombie/build-cosplay-costumes.mjs'), '--check', '--structural'], {cwd: ROOT, encoding: 'utf8'});
    expect(out).toMatch(/mismatches: none/);
  });
});

describe('loading, fallback and warm-up', () => {
  it('the costume files are fetched with the section (prepareSection awaits them) BEFORE it is built and warmed up', () => {
    const src = fs.readFileSync(path.join(ROOT, 'game/src/game.ts'), 'utf8');
    expect(src).toMatch(/sectionModelKeys[^\n]*=\s*\[[^\]]*cosplayModelKeysFor[^\]]*\]/);
    expect(src).toMatch(/const lazyKeys = this\.modelKeysFor\(layout, key\.level\);\s*\n\s*await this\.propModels\.ensure\(lazyKeys, onProgress\);/);
    // a section is prepared (lazy files fetched), then built (enemies spawned: the cosplay actors), then warmed up
    const flow = /layout = await this\.prepareSection\([^;]*;[\s\S]{0,900}?this\.buildSection\(key, layout[\s\S]{0,600}?await this\.prepareGraphics\(ui\)/g;
    expect((src.match(flow) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/s\.look === 'cosplay' \? this\.cosplayLookLibrary\(models\)/);
    const z = (look?: 'cosplay') => ({x: 0, z: 0, yaw: 0, type: 'shambler' as const, area: 0, ...(look ? {look} : {})});
    expect(cosplayModelKeysFor({zombies: [z()]})).toEqual([]);
    expect(cosplayModelKeysFor({zombies: [z('cosplay')]})).toEqual(Object.keys(COSPLAY_MODEL_FILES).sort());
  });

  const models: Record<string, GLTF> = {};
  beforeAll(async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const load = async (file: string) => {
      const doc = await io.read(file);
      for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
      const bin = await io.writeBinary(doc);
      return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
    };
    const files = MODEL_FILES as Record<string, {url: string} | undefined>;
    for (const key of new Set([...ZOMBIE_BODIES.map(b => b.model), ...ZOMBIE_WEARABLES.map(w => w.model)])) { const f = files[key]; if (f && fs.existsSync(path.join(PUB, f.url))) models[key] = await load(path.join(PUB, f.url)); }
    for (const [key, f] of Object.entries(COSPLAY_MODEL_FILES)) models[key] = await load(path.join(PUB, f.url));
  }, 240_000);

  it('a costume that cannot be built (files not loaded / failed) takes the COVERED fallback through the real ordinary library: never a bare body', () => {
    const looks = new ZombieLookLibrary(models);
    for (let i = 0; i < 120; i++) {
      for (const special of [null, {isValid: () => false}]) {
        const pick = chooseSpawnLook(8080, i, {type: 'shambler', look: 'cosplay'}, looks, special);
        expect(pick.library).toBe('ordinary');
        expect(NUDE.has(pick.look.body), `#${i}`).toBe(false);
        const app = looks.build(pick.look);
        expect(NUDE.has(app.look.body)).toBe(false);
        const def = ZOMBIE_BODIES.find(b => b.id === app.look.body)!;
        for (const s of def.requires ?? []) expect(app.look.wear[s], `${def.id} requires ${s}`).toBeTruthy();
      }
    }
  });

  it('every built costume actor is on the warm-up plan: its body, head piece, upper and lower materials are compiled with the section', () => {
    const lib = createCosplayLibrary(models);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const actors = COSPLAY_FITS.map(({costume, body}) => {
      const c = COSPLAY_COSTUMES.find(x => x.id === costume)!;
      const app = lib.build({body, wear: {head: c.pieces.head, upper: c.pieces.upper, lower: c.pieces.lower}});
      app.root.position.set(40, 0, 40); // far from any 'view' neighbourhood: 'full' mode plans every renderable
      scene.add(app.root);
      return app;
    });
    const plan = planWarmup(scene, {mode: 'full', cameraMask: camera.layers.mask});
    const planned = new Set([...plan.items, ...plan.others].map(i => i.object));
    const keys = new Set(plan.items.flatMap(i => warmKeys(i.object as never)));
    for (const app of actors) for (const m of app.meshes) {
      expect(planned.has(m.mesh), `${app.look.body} ${m.slot}`).toBe(true);
      for (const k of warmKeys(m.mesh as never)) expect(keys.has(k), `${app.look.body} ${m.slot} ${k}`).toBe(true);
    }
    expect(actors.flatMap(a => a.meshes).filter(m => m.slot !== 'body').every(m => isCosplayWearable(m.wearable))).toBe(true);
  });
});
