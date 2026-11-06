// Task studio-skyways-destinations-20261106-170011-01 (lane ART2D): the Skyways destinations' ORIGINAL Codex-generated flat artwork
// (thirteen shop posters, six court plaques) ships as two JPEG atlases (assets/skywaysDestArt.generated.ts, built by
// tools/asset-pipeline/props/build-skyways-dest-art.mjs: crop / resize / pack only):
//  - both atlas files exist at their declared size (JPEG frame header, <= 2048 a side) and are allowlisted byte-exact;
//  - every piece's UV rect lies inside [0,1] (v = 0 at the image bottom) with its declared aspect (posters 2:3, plaques 3:2), and no
//    two pieces overlap;
//  - every anchor-shop family has at least one poster and every landmark family its own plaque (the type's family lists);
//  - each atlas's provenance JSON matches the atlas bytes, is allowlisted, names one ledgered Codex call (session id, prompt sha256,
//    raw sha256) per piece, every piece a different call, and carries no prompt text, URLs, tokens or local paths.
// Needs no private files (the raw Codex outputs live outside Git) and no git history.
import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SKYWAYS_DEST_ART, SKYWAYS_DEST_PLAQUES, SKYWAYS_DEST_PLAQUE_BY_LANDMARK, SKYWAYS_DEST_POSTERS, SKYWAYS_DEST_POSTERS_BY_FAMILY,
  type SkywaysDestArtAtlas, type SkywaysDestArtAtlasKey} from '../src/assets/skywaysDestArt.generated';
import {SKYWAYS_LANDMARK_FAMILIES, SKYWAYS_SHOP_FAMILIES} from '../src/gen/skyways/skywaysTypes';

const atlases = () => Object.entries(SKYWAYS_DEST_ART) as [SkywaysDestArtAtlasKey, SkywaysDestArtAtlas][];

const PUB = fileURLToPath(new URL('../public/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const allow = JSON.parse(readFileSync(`${ROOT}tools/release/public-inputs.json`, 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
const entry = (p: string) => allow.files.find(f => f.path === p);

/** Declared atlas files, their pieces (in slot order) and the pieces' aspect. */
const EXPECTED: Record<SkywaysDestArtAtlasKey, {file: string; pieces: readonly string[]; aspect: number}> = {
  posters: {file: 'skyways-d-posters', pieces: SKYWAYS_DEST_POSTERS, aspect: 2 / 3},
  plaques: {file: 'skyways-d-plaques', pieces: SKYWAYS_DEST_PLAQUES, aspect: 512 / 341},
};

function jpegSize(b: Buffer): [number, number] {
  expect(b.readUInt16BE(0)).toBe(0xffd8);
  let i = 2;
  while (i < b.length - 9) {
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no JPEG frame header');
}

type Px = {x: number; y: number; w: number; h: number};
type ProvPiece = {name: string; subject: string; codex: {generator: string; ledgerCall: number; session: string}; prompt: {file: string; sha256: string};
  source: {file: string; sha256: string; bytes: number; width: number; height: number}; crop: Px; placed: Px};
type Prov = {schema: string; asset: string; task: string; generator: string; rebuild: string; status: string;
  output: {url: string; bytes: number; sha256: string; width: number; height: number; format: string}; pieces: ProvPiece[]};
const provOf = (file: string) => JSON.parse(readFileSync(`${PUB}assets/derivatives/${file}.json`, 'utf8')) as Prov;
/** Atlas pixel rect (y down) -> the generator's UV rect (v = 0 at the bottom, half-texel inset). */
const uvOfPx = (p: Px, W: number, H: number) => ({u0: (p.x + 0.5) / W, v0: 1 - (p.y + p.h - 0.5) / H, u1: (p.x + p.w - 0.5) / W, v1: 1 - (p.y + 0.5) / H});

describe('Skyways destination art atlases', () => {
  it('declares the two atlases under assets/textures/skyways/ (skyways-d-*), files present at their size, allowlisted byte-exact', () => {
    expect(Object.keys(SKYWAYS_DEST_ART).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [key, a] of atlases()) {
      expect(a.url, key).toBe(`assets/textures/skyways/${EXPECTED[key].file}.jpg`);
      expect(Math.max(a.width, a.height), key).toBeLessThanOrEqual(2048);
      const file = `${PUB}${a.url}`;
      expect(existsSync(file), a.url).toBe(true);
      const b = readFileSync(file);
      expect(jpegSize(b), a.url).toEqual([a.width, a.height]);
      expect(entry(a.url), `${a.url} allowlisted`).toEqual({path: a.url, bytes: b.length, sha256: sha(b)});
    }
  });

  it('every piece lies inside [0,1] with its declared aspect, the pieces are exactly the listed ones and never overlap', () => {
    for (const [key, a] of atlases()) {
      const e = EXPECTED[key];
      expect(Object.keys(a.pieces), key).toEqual([...e.pieces]);
      const list = Object.entries(a.pieces);
      for (const [name, p] of list) {
        const label = `${key}/${name}`;
        for (const v of [p.u0, p.v0, p.u1, p.v1]) { expect(v, label).toBeGreaterThanOrEqual(0); expect(v, label).toBeLessThanOrEqual(1); }
        expect(p.u1, label).toBeGreaterThan(p.u0);
        expect(p.v1, label).toBeGreaterThan(p.v0);
        // pixel size = UV span + one texel (the half-texel inset on each side); posters ~2:3, plaques ~3:2, at least 340 px tall
        const w = (p.u1 - p.u0) * a.width + 1, h = (p.v1 - p.v0) * a.height + 1;
        expect(p.aspect, label).toBeCloseTo(w / h, 3);
        expect(p.aspect, label).toBeCloseTo(e.aspect, 3);
        expect(h, label).toBeGreaterThanOrEqual(340);
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const [, p] = list[i], [, q] = list[j];
        expect(p.u0 < q.u1 && q.u0 < p.u1 && p.v0 < q.v1 && q.v0 < p.v1, `${key}: ${list[i][0]} x ${list[j][0]}`).toBe(false);
      }
    }
  });

  it('every anchor-shop family has its posters and every landmark family its own court plaque', () => {
    expect(Object.keys(SKYWAYS_DEST_POSTERS_BY_FAMILY).sort()).toEqual([...SKYWAYS_SHOP_FAMILIES].sort());
    const used: string[] = [];
    for (const f of SKYWAYS_SHOP_FAMILIES) {
      const list: readonly string[] = SKYWAYS_DEST_POSTERS_BY_FAMILY[f];
      expect(list.length, f).toBeGreaterThanOrEqual(1);
      for (const n of list) expect(SKYWAYS_DEST_ART.posters.pieces, `${f}/${n}`).toHaveProperty(n);
      used.push(...list);
    }
    expect(used.sort()).toEqual([...SKYWAYS_DEST_POSTERS].sort()); // every poster belongs to exactly one family
    expect(SKYWAYS_DEST_POSTERS_BY_FAMILY.cinema).toHaveLength(3);
    expect(SKYWAYS_DEST_POSTERS_BY_FAMILY.music).toHaveLength(2);
    expect(Object.keys(SKYWAYS_DEST_PLAQUE_BY_LANDMARK).sort()).toEqual([...SKYWAYS_LANDMARK_FAMILIES].sort());
    const plaques = SKYWAYS_LANDMARK_FAMILIES.map(f => SKYWAYS_DEST_PLAQUE_BY_LANDMARK[f]);
    for (const n of plaques) expect(SKYWAYS_DEST_ART.plaques.pieces, n).toHaveProperty(n);
    expect(new Set(plaques).size).toBe(SKYWAYS_LANDMARK_FAMILIES.length);
    expect([...plaques].sort()).toEqual([...SKYWAYS_DEST_PLAQUES].sort());
  });
});

describe('Skyways destination art provenance', () => {
  it('one provenance JSON per atlas: matches the atlas bytes, allowlisted, one ledgered Codex call per piece', () => {
    const sessions = new Set<string>(), raws = new Set<string>(), calls = new Set<number>();
    let count = 0;
    for (const [key, a] of atlases()) {
      const e = EXPECTED[key], rel = `assets/derivatives/${e.file}.json`;
      const pb = readFileSync(`${PUB}${rel}`);
      expect(entry(rel), `${rel} allowlisted`).toEqual({path: rel, bytes: pb.length, sha256: sha(pb)});
      const prov = provOf(e.file), img = readFileSync(`${PUB}${a.url}`);
      expect(prov.asset).toBe(e.file);
      expect(prov.task).toBe('studio-skyways-destinations-20261106-170011-01');
      expect(prov.generator).toBe('Codex native image_gen (owned Codex CLI)');
      expect(prov.rebuild).toBe('node tools/asset-pipeline/props/build-skyways-dest-art.mjs');
      expect(prov.status).toMatch(/no licence or commercial clearance implied/);
      expect(prov.output).toEqual({url: a.url, bytes: img.length, sha256: sha(img), width: a.width, height: a.height, format: 'jpeg'});
      expect(prov.pieces.map(p => p.name)).toEqual([...e.pieces]);
      for (const p of prov.pieces) {
        const label = `${key}/${p.name}`;
        count++;
        expect(p.codex.generator, label).toBe('Codex native image_gen (owned Codex CLI)');
        expect(p.codex.ledgerCall >= 401 && p.codex.ledgerCall <= 449, label).toBe(true); // this lane's call-id range
        expect(p.codex.session, label).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(p.prompt.file, label).toBe(`art2d-${p.codex.ledgerCall}.txt`);
        expect(p.prompt.sha256, label).toMatch(/^[a-f0-9]{64}$/);
        expect(p.source.sha256, label).toMatch(/^[a-f0-9]{64}$/);
        expect(p.source.file, label).toMatch(new RegExp(`^codex-${p.codex.ledgerCall}-exec-[0-9a-f-]{36}\\.png$`));
        expect(p.source.width * p.source.height, label).toBeGreaterThanOrEqual(1024 * 1024);
        // the crop lies inside the source and the placed slot reproduces the piece's UV rect
        expect(p.crop.x >= 0 && p.crop.y >= 0 && p.crop.x + p.crop.w <= p.source.width && p.crop.y + p.crop.h <= p.source.height, label).toBe(true);
        const uv = uvOfPx(p.placed, a.width, a.height), piece = (a.pieces as Record<string, {u0: number; v0: number; u1: number; v1: number}>)[p.name];
        for (const k of ['u0', 'v0', 'u1', 'v1'] as const) expect(piece[k], `${label}.${k}`).toBeCloseTo(uv[k], 5);
        sessions.add(p.codex.session); raws.add(p.source.sha256); calls.add(p.codex.ledgerCall);
      }
    }
    expect(count).toBe(19);
    // every piece is a different Codex call / image
    expect(sessions.size).toBe(count);
    expect(raws.size).toBe(count);
    expect(calls.size).toBe(count);
  });

  it('public provenance carries no prompt text, URLs, tokens or local paths; the credits name the art', () => {
    for (const e of Object.values(EXPECTED)) {
      const text = readFileSync(`${PUB}assets/derivatives/${e.file}.json`, 'utf8');
      expect(text).not.toMatch(/https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\//i);
      expect(text).not.toMatch(/Content rules|Key art:|PROMPT|Lettering:/);
      expect(JSON.parse(text)).not.toHaveProperty('pieces.0.prompt.text');
    }
    const credits = readFileSync(`${PUB}assets/CREDITS.md`, 'utf8');
    for (const e of Object.values(EXPECTED)) expect(credits).toContain(`${e.file}.jpg`);
  });
});
