// Task studio-subway-rework-m2-finishing-20261117-111246-01: SCHEME CONTRAST and the CAVERN'S NEUTRAL RELIEF.
// User (main visual review M2): "Civic and heritage read almost identically warm-brown from the submitted play-distance views. Make their
// approved local finish / trim / column / furnishing language legible; brutalist should have its own structural character" and the cavern
// "remains almost entirely the same red-orange rough surface. Keep its strong identity hue, but use believable neutral stone / plinth /
// door / service / waiting accents and hierarchy".
//  - the finish schemes (world/subwayFinish.ts): every grand hall's field / upper / pier / accent is its own (heritage, civic, brutalist
//    pairwise different; no two themes share a hall language), the new zones are preloaded and generated sets, civic plaster neutral;
//  - SubwayArch (world/subwayArch.ts): pier / accent / panel keys resolve to their finishes, never wall-detail cut hosts; the scheme's
//    column paint lands at its target;
//  - the kit (world/subwayKit.ts): a brutalist station draws deep FINS (deeper than any pilaster) and its accent string course;
//  - the cavern (world/subwayKitCavern.ts): granite wainscot, precast cap / ledge / portal frames and enamel backings in neutral (non-rock)
//    keys while the rock keeps the identity's paint; portal frames never cover an opening; a version-1 station draws none of it.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {STATION_THEMES} from '../src/gen/stationPlans';
import type {Area, StationIdentity, StationLayout} from '../src/gen/stationTypes';
import type {CeilingForm} from '../src/gen/subwayCeilings';
import type {Level} from '../src/gen/levels';
import {CELL} from '../src/gen/grid';
import {WorldMaterials, COLUMN_PAINT, columnPaintGradeCpu} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {ARCH_CLASS, ZONES, finishSchemeOf, greyTint, paintTint, schemeTextures, type FinishScheme, type ZoneFinish} from '../src/world/subwayFinish';
import {SUBWAY_WALL_TAG, SubwayArch, columnPaintMultiplier, subwayArchKeysOf} from '../src/world/subwayArch';
import {FIN, PILASTER, buildSubwayKit, freeSpans} from '../src/world/subwayKit';
import {BACKING, PORTAL, buildCavernKit, type CavernKitApi} from '../src/world/subwayKitCavern';
import {SUBWAY_ARCH_TEXTURES} from '../src/assets/subwayArchTextures.generated';
import type {TreatFace} from '../src/world/wallDetailFaces';

installCanvasShim(false);

const identity = (theme: string): StationIdentity => { const {label: _l, ...t} = STATION_THEMES[theme]; return {theme, ...t, plate: {...t.plate}}; };
const scheme = (theme: string): FinishScheme => finishSchemeOf({identity: identity(theme)})!;
const same = (p: ZoneFinish, q: ZoneFinish) => p.tex === q.tex && String(p.tint) === String(q.tint);
/** The finish's linear albedo (the set's measured mean x tint). */
const albedo = (f: ZoneFinish) => SUBWAY_ARCH_TEXTURES[f.tex].mean.map((m, i) => m * (f.tint?.[i] ?? 1));
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Max channel / min channel of a colour (1 = neutral grey). */
const cast = (c: readonly number[]) => Math.max(...c) / Math.min(...c);
const TILE_THEMES = ['heritage', 'civic', 'municipal', 'terracotta', 'moderne', 'brutalist'] as const;
const CAVERNS = Object.keys(STATION_THEMES).filter(t => STATION_THEMES[t].walls === 'rock');
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const meshes = (w: BuiltWorld): THREE.Mesh[] => { const out: THREE.Mesh[] = []; w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
/** A SubwayArch over a bare layout (keys / materials only). */
const archOf = (theme: string, areas: Area[] = []) =>
  SubwayArch.for({identity: identity(theme), areas, props: [], signs: [], lights: []} as unknown as StationLayout, mats(), [{} as Level])!;
const hallArea = {id: 0, type: 'fare-hall', role: 'grand-ticket-hall', publicSpace: true, ceil: 9, x: 0, y: 0, w: 10, h: 10} as unknown as Area;
const plainArea = {id: 1, type: 'concourse', publicSpace: true, ceil: 4, x: 0, y: 0, w: 10, h: 10} as unknown as Area;

describe('scheme contrast: every grand hall speaks its own language', () => {
  it('heritage / civic / brutalist hall field, upper, pier and accent differ pairwise', () => {
    const s = ['heritage', 'civic', 'brutalist'].map(scheme);
    const zones: [string, (x: FinishScheme) => ZoneFinish][] = [['field', x => x.hall.field], ['upper', x => x.hall.upper], ['pier', x => x.hall.pier], ['accent', x => x.accent]];
    for (const [zone, get] of zones) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(same(get(s[i]), get(s[j])), `${zone} ${i} ${j}`).toBe(false);
    // the dominant hall wall is no longer a shared limestone: heritage stone + cream brick, civic blue tile + white, brutalist precast
    expect(s.map(x => x.hall.upper.tex)).toEqual(['tileCream', 'tileWhiteLarge', 'concretePrecast']);
    expect(s.map(x => x.hall.pier.tex)).toEqual(['bandOxblood', 'bandNavy', 'concretePrecast']);
    expect(s.map(x => x.accent.tex)).toEqual(['bandOxblood', 'bandNavy', 'bandOrange']);
  });

  it('no two themes share a hall language; piers and accents stand off their hall walls', () => {
    const sig = TILE_THEMES.map(t => { const s = scheme(t); return JSON.stringify([s.hall.field, s.hall.upper, s.hall.pier, s.accent, s.hall.ceil]); });
    expect(new Set(sig).size).toBe(TILE_THEMES.length);
    for (const t of TILE_THEMES) {
      const s = scheme(t);
      // the pier and accent are a different set from the hall's field and upper, or (a fin scheme: the same precast) a clearly other value
      for (const wall of [s.hall.field, s.hall.upper]) {
        expect(s.accent.tex, t).not.toBe(wall.tex);
        if (s.pierForm === 'fin') expect(Math.abs(lum(albedo(s.hall.pier)) / lum(albedo(wall)) - 1), t).toBeGreaterThan(0.1);
        else expect(s.hall.pier.tex, t).not.toBe(wall.tex);
      }
    }
    // a civic hall's plaster is a neutral white (no warm cast), heritage keeps the warm one
    expect(cast(albedo(scheme('civic').hall.ceil))).toBeLessThan(1.03);
    expect(cast(albedo(scheme('heritage').hall.ceil))).toBeGreaterThan(1.2);
    expect(greyTint('concretePrecast', 0.5).map((t, i) => t * SUBWAY_ARCH_TEXTURES.concretePrecast.mean[i]).every(v => Math.abs(v - 0.5) < 1e-3)).toBe(true);
    // only brutalist draws fins
    expect(TILE_THEMES.filter(t => scheme(t).pierForm === 'fin')).toEqual(['brutalist']);
  });

  it("every scheme's sets (pier, accent, panel included) are in its preload list and are generated sets", () => {
    for (const theme of Object.keys(STATION_THEMES)) {
      const s = scheme(theme), list = schemeTextures(s), keys = subwayArchKeysOf({identity: identity(theme)});
      for (const f of [s.pier, s.accent, s.hall.pier, s.dado, s.trim, ...(s.panel ? [s.panel] : [])]) {
        expect(list, `${theme} ${f.tex}`).toContain(f.tex);
        expect(keys, `${theme} ${f.tex}`).toContain(f.tex);
      }
      for (const k of list) expect(SUBWAY_ARCH_TEXTURES[k], `${theme} ${k}`).toBeTruthy();
    }
  });

  it('pier / accent / panel keys resolve to their finishes; never wall-detail cut hosts; a hall pier keys apart only when it differs', () => {
    for (const theme of [...TILE_THEMES, 'cavernRed']) {
      const sub = archOf(theme, [hallArea, plainArea]), s = sub.scheme;
      const pier = sub.pierKey(hallArea), accent = sub.accentKey();
      expect(pier).toMatch(new RegExp(`^subway-${ARCH_CLASS[s.hall.pier.tex]}-pier(-hall)?$`));
      expect(accent).toBe(`subway-${ARCH_CLASS[s.accent.tex]}-accent`);
      expect(pier.endsWith('-hall'), theme).toBe(!same(s.hall.pier, s.pier));
      for (const [k, tex] of [[pier, s.hall.pier.tex], [sub.pierKey(plainArea), s.pier.tex], [accent, s.accent.tex]] as const) {
        const m = sub.material(k)!;
        expect(m, `${theme} ${k}`).toBeTruthy();
        expect(m.userData.subwayArchTex, `${theme} ${k}`).toBe(tex);
        expect(m.userData[SUBWAY_WALL_TAG], `${theme} ${k}`).toBeUndefined();
      }
      if (s.panel) expect(sub.material(sub.panelKey()!)!.userData.subwayArchTex).toBe(s.panel.tex); else expect(sub.panelKey()).toBeNull();
    }
  });

  it("the station columns take the scheme's paint (render-only clone, one per station); the cavern keeps the default", () => {
    const base = mats().get('columnPaint');
    for (const theme of TILE_THEMES) {
      const sub = archOf(theme), target = sub.scheme.columnPaint!;
      const m = sub.columnMaterial(base) as THREE.Material & {color: THREE.Color};
      expect(m).not.toBe(base);
      expect(sub.columnMaterial(base)).toBe(m);
      const k = columnPaintMultiplier(target);
      // the graded paint lands at the scheme's target (the multiplier is the inverse of the grade's power curve)
      COLUMN_PAINT.base.forEach((c, i) => expect(columnPaintGradeCpu(c * k[i], i as 0 | 1 | 2), `${theme} ${i}`).toBeCloseTo(target[i], 2));
      const bc = (base as THREE.Material & {color: THREE.Color}).color;
      expect(m.color.r).toBeCloseTo(bc.r * k[0], 6); expect(m.color.g).toBeCloseTo(bc.g * k[1], 6); expect(m.color.b).toBeCloseTo(bc.b * k[2], 6);
      expect((m.userData.lightAlbedo as number[])[0]).toBeCloseTo(target[0], 2);
    }
    const civic = archOf('civic').scheme.columnPaint!, heritage = archOf('heritage').scheme.columnPaint!;
    expect(civic[2]).toBeGreaterThan(civic[0] * 2); // navy
    expect(heritage[0]).toBeGreaterThan(heritage[2] * 2); // oxblood
    expect(archOf('cavernRed').columnMaterial(base)).toBe(base);
  });

  it('a brutalist station draws deep fins (deeper than any pilaster), its orange accent course; a civic one navy pilasters', () => {
    expect(FIN.proud).toBeGreaterThanOrEqual(3 * PILASTER.proud);
    expect(FIN.low).toBeLessThanOrEqual(0.3); // (the player's radius: no walking into a fin's lower blade)
    const boxesOf = (seed: number) => {
      const L = LEVELS.subway.generate('main', {levelSeed: seed, layoutVersion: 3});
      const w = buildWorld(L, mats(), {});
      const sub = w.subwayArch!;
      const got: {mat: string; s: [number, number, number]}[] = [];
      buildSubwayKit({box: (mat, _x, _y, _z, sx, sy, sz) => got.push({mat, s: [sx, sy, sz]}), geo: () => {}},
        {layout: L, gridOf: l => L.levels?.[l]?.grid ?? L.grid, faces: w.wallFaces, sub});
      return {L, w, sub, got};
    };
    const b = boxesOf(3);
    expect(b.L.identity!.theme).toBe('brutalist');
    expect(b.w.subwayArch!.kit!.fins).toBeGreaterThan(10);
    const pierKeys = new Set(b.L.areas.map(a => b.sub.pierKey(a)));
    // a pier box's plan, sorted (the arcade beams — long, 0.36 m deep — excluded by their height)
    const plans = (got: typeof b.got, keys: Set<string>) => got.filter(g => keys.has(g.mat) && g.s[1] >= 0.5).map(g => [g.s[0], g.s[2]].sort((p, q) => p - q)).filter(p => p[1] < 1);
    const fins = plans(b.got, pierKeys);
    expect(fins.length).toBeGreaterThan(10);
    expect(Math.max(...fins.map(p => p[1]))).toBeCloseTo(FIN.proud, 3);
    expect(fins.every(p => p[0] <= FIN.w + 1e-6)).toBe(true);
    expect(b.got.some(g => g.mat === b.sub.accentKey())).toBe(true);
    expect(b.sub.material(b.sub.accentKey())!.userData.subwayArchTex).toBe('bandOrange');
    const c = boxesOf(4);
    expect(c.L.identity!.theme).toBe('civic');
    const pil = plans(c.got, new Set(c.L.areas.map(a => c.sub.pierKey(a))));
    expect(pil.length).toBeGreaterThan(10);
    // every civic pier box is a pilaster: shallower than the fins
    expect(Math.max(...pil.map(p => Math.min(p[0], p[1])))).toBeLessThan(FIN.low);
    expect(c.w.subwayArch!.kit!.fins ?? 0).toBe(0);
    expect(c.sub.material(c.sub.pierKey(c.L.areas.find(a => a.role === 'grand-ticket-hall')))!.userData.subwayArchTex).toBe('bandNavy');
  }, 240_000);
});

describe("the cavern's neutral relief", () => {
  it('wainscot, cap, ledge, portal and panel finishes are neutral (non-rock) sets; the rock keeps the identity paint', () => {
    for (const theme of CAVERNS) {
      const s = scheme(theme), t = STATION_THEMES[theme];
      expect(s.rock!.wall).toEqual({tex: 'rockPainted', tint: paintTint(t.wallTint, 0.92)});
      for (const [zone, f] of [['wainscot', s.dado], ['trim', s.trim], ['accent', s.accent], ['pier', s.pier]] as const) {
        expect(ARCH_CLASS[f.tex], `${theme} ${zone}`).not.toBe('rock');
        expect(cast(albedo(f)), `${theme} ${zone}`).toBeLessThan(1.02);
      }
      expect(s.panel && ARCH_CLASS[s.panel.tex]).not.toBe('rock');
      // the wainscot reads apart from both the rock above it and the floor below it (a lighter honed granite)
      expect(lum(albedo(s.dado))).toBeGreaterThan(lum(albedo(s.floor)) * 1.1);
      // the precast mouldings / portal frames a step lighter again (the cove troughs no longer read as black lines along the vault)
      expect(lum(albedo(s.accent))).toBeGreaterThan(lum(albedo(s.dado)) * 1.1);
      expect(same(s.trim, s.accent)).toBe(true);
      const sub = archOf(theme, [plainArea]);
      expect(sub.zoneFinish('dado', plainArea).key).toBe('subway-stone-dado');
      for (const z of ['field', 'upper'] as const) expect(sub.zoneFinish(z, plainArea)).toEqual({finish: s.rock!.wall, key: 'subway-rock-dado'});
      expect(sub.trimKey()).toBe('subway-concrete-trim');
      expect(sub.accentKey()).toBe('subway-concrete-accent');
      expect(sub.material('subway-rock-dado')!.userData.subwayArchTex).toBe('rockPainted');
      expect(sub.material('subway-stone-dado')!.userData[SUBWAY_WALL_TAG]).toBe(true);
    }
  });

  // a synthetic 20 m rock wall (normal +z) under a rock vault springing at 4.9 m, three openings, a bench, a wall sign
  const face = (): TreatFace => ({level: 0, area: 0, areaType: 'concourse', zone: 'concourse', x0: 0, z0: 0, x1: 20, z1: 0, nx: 0, nz: 1, y0: 0, y1: 6.5,
    finish: 'subway-stone-plinth', seed: 1, base: 0,
    openings: [{s0: 4, s1: 6, top: 2.6}, {s0: 6.3, s1: 7.5, top: 2.4}, {s0: 19.7, s1: 20, top: 2.5}, {s0: 15, s1: 15.6, top: 1.2}]});
  const cavernApi = (theme = 'cavernRed') => {
    const area = {...plainArea, id: 0, ceil: 6.7} as Area;
    const layout = {identity: identity(theme), areas: [area], lights: [],
      props: [{kind: 'bench', x: 10, z: 0.32, y: 0, rot: 0, area: 0, hx: 0.9, hz: 0.3, h: 0.9}, {kind: 'crate', x: 13, z: 0.4, y: 0, rot: 0, area: 0, hx: 0.4, hz: 0.4, h: 0.8}],
      signs: [{x: 11.6, y: 2.0, z: 0.03, rot: 0, kind: 'info', text: 'x', area: 0, w: 0.8}]} as unknown as StationLayout;
    const sub = SubwayArch.for(layout, mats(), [{} as Level])!;
    const form = {kind: 'rock', spring: 4.9, ceil: 6.7, bays: {alongX: true}} as unknown as CeilingForm;
    const boxes: {mat: string; c: [number, number, number]; s: [number, number, number]}[] = [];
    const api: CavernKitApi = {layout, sub, faces: [face()], formOf: () => form, freeSpans,
      box: (mat, cx, cy, cz, sx, sy, sz) => boxes.push({mat, c: [cx, cy, cz], s: [sx, sy, sz]}),
      nearWall: () => [[12.6 - 0.08, 13.4 + 0.08]]};
    return {api, sub, boxes};
  };

  it('portal frames stand beside and above each public opening, never across one; cap, ledge and backings in their keys', () => {
    const {api, sub, boxes} = cavernApi();
    const st = buildCavernKit(api);
    const f = face();
    const span = (b: typeof boxes[number]): [number, number] => [b.c[0] - b.s[0] / 2, b.c[0] + b.s[0] / 2];
    const yr = (b: typeof boxes[number]): [number, number] => [b.c[1] - b.s[1] / 2, b.c[1] + b.s[1] / 2];
    // nothing the cavern draws covers an opening below its head
    for (const b of boxes) for (const o of f.openings) {
      const [a0, a1] = span(b), [y0] = yr(b);
      expect(a1 > o.s0 + 1e-6 && a0 < o.s1 - 1e-6 && y0 < o.top - 1e-6, `${b.mat} ${a0.toFixed(2)}-${a1.toFixed(2)} y ${y0.toFixed(2)} over ${o.s0}-${o.s1}`).toBe(false);
    }
    const accent = boxes.filter(b => b.mat === sub.accentKey());
    // door 1: its left jamb (its right one would cross door 2) and a lintel; door 2: both jambs fail (door 1 / clear), lintel only up to door 1;
    // the 0.3 m opening at the face end and the low hatch are not framed
    const jambs = accent.filter(b => yr(b)[0] < 0.01);
    expect(jambs.map(b => span(b).map(v => +v.toFixed(2)))).toEqual([[3.6, 4], [7.5, 7.9]]);
    for (const j of jambs) { expect(j.s[2]).toBeCloseTo(PORTAL.proud, 6); expect(j.c[2]).toBeGreaterThan(0); }
    const lintels = accent.filter(b => yr(b)[0] > 2);
    expect(lintels.length).toBeGreaterThanOrEqual(2);
    expect(st.portals).toBe(2);
    expect(st.jambs).toBe(2);
    // the wainscot cap at the dado height in the trim; the spring-line ledge under the vault's springing in the trim
    const trim = boxes.filter(b => b.mat === sub.trimKey());
    expect(trim.some(b => Math.abs(b.c[1] - ZONES.dado) < 1e-6)).toBe(true);
    expect(trim.some(b => Math.abs(yr(b)[1] - (4.9 - 0.04 - 0.005)) < 1e-6)).toBe(true);
    expect(st.caps).toBeGreaterThan(0);
    expect(st.ledges).toBeGreaterThan(0);
    // the bench's backing (enamel) above the wainscot, cut clear of the wall sign over it; the crate gets none
    const panels = boxes.filter(b => b.mat === sub.panelKey());
    expect(panels.length).toBe(1);
    const [p0, p1] = span(panels[0]);
    expect(p0).toBeCloseTo(10 - 0.9 - BACKING.pad, 6);
    expect(p1).toBeCloseTo(11.6 - 0.5, 6);
    expect(yr(panels[0])[0]).toBeGreaterThan(ZONES.dado);
    expect(st.backings).toBe(1);
  });

  it('a tile or concrete scheme draws no cavern relief', () => {
    for (const theme of TILE_THEMES) {
      const layout = {identity: identity(theme), areas: [plainArea], props: [], signs: [], lights: []} as unknown as StationLayout;
      const boxes: string[] = [];
      const st = buildCavernKit({layout, sub: SubwayArch.for(layout, mats(), [{} as Level])!, faces: [face()], formOf: () => null, freeSpans,
        box: mat => boxes.push(mat), nearWall: () => []});
      expect(boxes, theme).toEqual([]);
      expect(st).toEqual({caps: 0, portals: 0, jambs: 0, ledges: 0, backings: 0});
    }
  });

  it('a built cavern: neutral relief on its public walls, out of every doorway; version 1 draws none', () => {
    const L = LEVELS.subway.generate('main', {levelSeed: 2, layoutVersion: 3});
    expect(L.identity!.walls).toBe('rock');
    const w = buildWorld(L, mats(), {});
    const k = w.subwayArch!.kit!;
    expect(k.cavern!.caps).toBeGreaterThan(50);
    expect(k.cavern!.portals).toBeGreaterThan(10);
    expect(k.cavern!.ledges).toBeGreaterThan(5);
    expect(k.cavern!.backings).toBeGreaterThan(5);
    const named = (re: RegExp) => meshes(w).filter(m => re.test(m.name));
    expect(named(/^trim-subway-concrete-accent@/).length).toBeGreaterThan(0);
    expect(named(/^trim-subway-tile-panel@/).length).toBeGreaterThan(0);
    expect(named(/^arch-subway-stone-dado@/).length).toBeGreaterThan(0);
    // the painted rock still covers the walls above the wainscot and the vault, in the identity's paint
    const rock = named(/^arch-subway-rock-dado@/);
    expect(rock.length).toBeGreaterThan(0);
    expect((rock[0].material as THREE.Material).userData.subwayArchTex).toBe('rockPainted');
    // nothing the kit draws stands in a door opening below its head
    const doors = L.doors.map(d => ({x0: d.x * CELL, z0: d.y * CELL, x1: (d.x + d.w) * CELL, z1: (d.y + d.h) * CELL}));
    for (const m of named(/^trim-subway-/)) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 2) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (y > 2.0 || y < 0.05) continue;
        const inside = doors.find(d => x > d.x0 + 0.12 && x < d.x1 - 0.12 && z > d.z0 + 0.12 && z < d.z1 - 0.12);
        expect(inside, `${m.name} vertex in a doorway at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`).toBeUndefined();
      }
    }
    const w1 = buildWorld(LEVELS.subway.generate('main', {levelSeed: 2, layoutVersion: 1}), mats(), {});
    expect(w1.subwayArch).toBeUndefined();
    expect(meshes(w1).some(m => /^(arch|trim)-subway-/.test(m.name))).toBe(false);
    expect(finishSchemeOf({})).toBeNull();
  }, 240_000);
});
