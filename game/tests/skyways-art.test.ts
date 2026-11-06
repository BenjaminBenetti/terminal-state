// Task studio-skyways-level-20261106-054448-01 (lane ART): the Skyways level's ORIGINAL Codex-generated artwork ships as JPEG atlases
// (assets/skywaysArt.generated.ts, built by tools/asset-pipeline/props/build-skyways-art.mjs: crop / resize / pack only):
//  - every atlas file exists at its declared size (JPEG frame header), sRGB JPEG, allowlisted byte-exact;
//  - every piece's UV rect lies inside [0,1] (v = 0 at the image bottom), has its declared aspect, and slots never overlap;
//  - each atlas's provenance JSON matches the atlas bytes, is allowlisted, names one ledgered Codex call (session id, prompt sha256,
//    raw sha256) per source piece, every source a different call, and carries no prompt text, URLs, tokens or local paths.
// Needs no private files (the raw Codex outputs live outside Git) and no git history.
import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SKYWAYS_ART, SKYWAYS_CON_POSTERS, SKYWAYS_CON_BANNERS, SKYWAYS_CON_PRINTS, SKYWAYS_RAMEN_MENU_ITEMS, SKYWAYS_RAMEN_MENU_PRICES,
  type SkywaysArtAtlas, type SkywaysArtAtlasKey} from '../src/assets/skywaysArt.generated';

/** The atlases as plain records (piece lookup by any name). */
const atlases = () => Object.entries(SKYWAYS_ART) as [SkywaysArtAtlasKey, SkywaysArtAtlas][];

const PUB = fileURLToPath(new URL('../public/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const allow = JSON.parse(readFileSync(`${ROOT}tools/release/public-inputs.json`, 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
const entry = (p: string) => allow.files.find(f => f.path === p);

/** Declared atlas sizes and their slot (source) pieces; every other piece is a sub-rect inside one of these. */
const EXPECTED: Record<SkywaysArtAtlasKey, {file: string; width: number; height: number; slots: readonly string[]}> = {
  conPosters: {file: 'skyways-con-posters', width: 2048, height: 1536, slots: SKYWAYS_CON_POSTERS},
  conBanners: {file: 'skyways-con-banners', width: 1536, height: 1219, slots: SKYWAYS_CON_BANNERS},
  conStage: {file: 'skyways-con-stage', width: 1536, height: 1024, slots: ['backdrop']},
  conSigns: {file: 'skyways-con-signs', width: 1920, height: 768, slots: ['welcome', 'prints']},
  prizeBoard: {file: 'skyways-prize-board', width: 1024, height: 683, slots: ['board']},
  ramenArt: {file: 'skyways-ramen-art', width: 1536, height: 1366, slots: ['noren', 'menu', 'poster']},
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
  source: {file: string; sha256: string; bytes: number; width: number; height: number}; crop: Px; placed: Px; subPieces?: {name: string; placed: Px}[]};
type Prov = {schema: string; asset: string; generator: string; rebuild: string; status: string; output: {url: string; bytes: number; sha256: string; width: number; height: number; format: string}; pieces: ProvPiece[]};
const provOf = (file: string) => JSON.parse(readFileSync(`${PUB}assets/derivatives/${file}.json`, 'utf8')) as Prov;
/** Atlas pixel rect (y down) -> the generator's UV rect (v = 0 at the bottom, half-texel inset). */
const uvOfPx = (p: Px, W: number, H: number) => ({u0: (p.x + 0.5) / W, v0: 1 - (p.y + p.h - 0.5) / H, u1: (p.x + p.w - 0.5) / W, v1: 1 - (p.y + 0.5) / H});

describe('Skyways art atlases', () => {
  it('declares exactly the six atlases, under assets/textures/skyways/ (relative urls)', () => {
    expect(Object.keys(SKYWAYS_ART).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [key, a] of atlases()) {
      const e = EXPECTED[key];
      expect(a.url).toBe(`assets/textures/skyways/${e.file}.jpg`);
      expect([a.width, a.height], key).toEqual([e.width, e.height]);
    }
  });

  it('every atlas file exists at its declared size and is allowlisted byte-exact', () => {
    for (const a of Object.values(SKYWAYS_ART)) {
      const file = `${PUB}${a.url}`;
      expect(existsSync(file), a.url).toBe(true);
      const b = readFileSync(file);
      expect(jpegSize(b), a.url).toEqual([a.width, a.height]);
      expect(entry(a.url), `${a.url} allowlisted`).toEqual({path: a.url, bytes: b.length, sha256: sha(b)});
    }
  });

  it('every piece lies inside [0,1] with u0 < u1, v0 < v1 and its declared aspect', () => {
    for (const [key, a] of Object.entries(SKYWAYS_ART)) {
      for (const [name, p] of Object.entries(a.pieces)) {
        const label = `${key}/${name}`;
        for (const v of [p.u0, p.v0, p.u1, p.v1]) { expect(v, label).toBeGreaterThanOrEqual(0); expect(v, label).toBeLessThanOrEqual(1); }
        expect(p.u1, label).toBeGreaterThan(p.u0);
        expect(p.v1, label).toBeGreaterThan(p.v0);
        // pixel size = UV span + one texel (the half-texel inset on each side)
        const w = (p.u1 - p.u0) * a.width + 1, h = (p.v1 - p.v0) * a.height + 1;
        expect(p.aspect, label).toBeCloseTo(w / h, 3);
      }
    }
  });

  it('the slot pieces never overlap; the posters are 2:3 and the banners ~1:2.38; the named groups are complete', () => {
    for (const [key, a] of atlases()) {
      const slots = EXPECTED[key].slots.map(n => [n, a.pieces[n]] as const);
      for (const [n, p] of slots) expect(p, `${key}/${n}`).toBeDefined();
      for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
        const [, p] = slots[i], [, q] = slots[j];
        const overlap = p.u0 < q.u1 && q.u0 < p.u1 && p.v0 < q.v1 && q.v0 < p.v1;
        expect(overlap, `${key}: ${slots[i][0]} x ${slots[j][0]}`).toBe(false);
      }
    }
    expect(SKYWAYS_CON_POSTERS).toHaveLength(8);
    for (const n of SKYWAYS_CON_POSTERS) expect(SKYWAYS_ART.conPosters.pieces[n].aspect).toBeCloseTo(512 / 768, 3);
    expect(SKYWAYS_CON_BANNERS).toHaveLength(3);
    for (const n of SKYWAYS_CON_BANNERS) expect(SKYWAYS_ART.conBanners.pieces[n].aspect).toBeCloseTo(512 / 1219, 3);
    expect(SKYWAYS_CON_PRINTS).toHaveLength(4);
    // the menu art names six dishes and leaves one empty price strip per dish (prices are drawn at runtime, never baked)
    expect(SKYWAYS_RAMEN_MENU_ITEMS).toHaveLength(6);
    expect(SKYWAYS_RAMEN_MENU_PRICES).toHaveLength(SKYWAYS_RAMEN_MENU_ITEMS.length);
    for (const n of SKYWAYS_RAMEN_MENU_PRICES) expect(SKYWAYS_ART.ramenArt.pieces[n].aspect, n).toBeGreaterThan(8); // wide, short strips
  });

  it('sub-pieces (merch prints, menu dishes) lie inside their parent slot', () => {
    const inside = (c: {u0: number; v0: number; u1: number; v1: number}, p: typeof c) => c.u0 >= p.u0 && c.u1 <= p.u1 && c.v0 >= p.v0 && c.v1 <= p.v1;
    for (const n of SKYWAYS_CON_PRINTS) expect(inside(SKYWAYS_ART.conSigns.pieces[n], SKYWAYS_ART.conSigns.pieces.prints), n).toBe(true);
    for (const n of SKYWAYS_RAMEN_MENU_PRICES) expect(inside(SKYWAYS_ART.ramenArt.pieces[n], SKYWAYS_ART.ramenArt.pieces.menu), n).toBe(true);
  });
});

describe('Skyways art provenance', () => {
  it('one provenance JSON per atlas: matches the atlas bytes, allowlisted, one ledgered Codex call per slot piece', () => {
    const sessions = new Set<string>(), raws = new Set<string>(), calls = new Set<number>();
    let slotCount = 0;
    for (const [key, a] of atlases()) {
      const e = EXPECTED[key], rel = `assets/derivatives/${e.file}.json`;
      const pb = readFileSync(`${PUB}${rel}`);
      expect(entry(rel), `${rel} allowlisted`).toEqual({path: rel, bytes: pb.length, sha256: sha(pb)});
      const prov = provOf(e.file), img = readFileSync(`${PUB}${a.url}`);
      expect(prov.asset).toBe(e.file);
      expect(prov.generator).toBe('Codex native image_gen (owned Codex CLI)');
      expect(prov.rebuild).toBe('node tools/asset-pipeline/props/build-skyways-art.mjs');
      expect(prov.status).toMatch(/no licence or commercial clearance implied/);
      expect(prov.output).toEqual({url: a.url, bytes: img.length, sha256: sha(img), width: a.width, height: a.height, format: 'jpeg'});
      expect(prov.pieces.map(p => p.name)).toEqual([...e.slots]);
      const subNames = prov.pieces.flatMap(p => (p.subPieces ?? []).map(s => s.name));
      expect(Object.keys(a.pieces).sort()).toEqual([...e.slots, ...subNames].sort());
      for (const p of prov.pieces) {
        const label = `${key}/${p.name}`;
        slotCount++;
        expect(p.codex.generator, label).toBe('Codex native image_gen (owned Codex CLI)');
        expect(Number.isInteger(p.codex.ledgerCall) && p.codex.ledgerCall > 0, label).toBe(true);
        expect(p.codex.session, label).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(p.prompt.file, label).toMatch(/^art-\d\d(-r\d+)?\.txt$/);
        expect(p.prompt.sha256, label).toMatch(/^[a-f0-9]{64}$/);
        expect(p.source.sha256, label).toMatch(/^[a-f0-9]{64}$/);
        expect(p.source.file, label).toMatch(new RegExp(`^codex-${p.codex.ledgerCall}-exec-[0-9a-f-]{36}\\.png$`));
        expect(p.source.width * p.source.height, label).toBeGreaterThanOrEqual(1024 * 1024);
        // the crop lies inside the source and the placed slot reproduces the piece's UV rect
        expect(p.crop.x >= 0 && p.crop.y >= 0 && p.crop.x + p.crop.w <= p.source.width && p.crop.y + p.crop.h <= p.source.height, label).toBe(true);
        const uv = uvOfPx(p.placed, a.width, a.height), piece = a.pieces[p.name];
        for (const k of ['u0', 'v0', 'u1', 'v1'] as const) expect(piece[k], `${label}.${k}`).toBeCloseTo(uv[k], 5);
        sessions.add(p.codex.session); raws.add(p.source.sha256); calls.add(p.codex.ledgerCall);
      }
    }
    // every source is a different Codex call / image
    expect(sessions.size).toBe(slotCount);
    expect(raws.size).toBe(slotCount);
    expect(calls.size).toBe(slotCount);
  });

  it('public provenance carries no prompt text, URLs, tokens or local paths', () => {
    for (const e of Object.values(EXPECTED)) {
      const text = readFileSync(`${PUB}assets/derivatives/${e.file}.json`, 'utf8');
      expect(text).not.toMatch(/https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\/|~\//i);
      expect(text).not.toMatch(/Content rules|Key art:|PROMPT/);
      expect(JSON.parse(text)).not.toHaveProperty('pieces.0.prompt.text');
    }
  });
});
