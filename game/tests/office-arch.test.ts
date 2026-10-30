// Task office-overhaul-20261030 (lane ARCH): office architecture (feedback item 3: "the office building uses the same walls as
// the subway station") + tenant palettes, and the heavy green exterior fog (item 2) incl. the roof's outdoor treatment.
//  - office storeys never resolve to the station's tile / painted block / wall-detail station treatments; the lobby is neutral;
//  - palette -> material parameters are bounded, the material count per storey is bounded, one program per surface kind;
//  - the green fog: hue / saturation, opacity at 30 / 80 / 150 m from every floor's eye height, thicker at street level;
//  - the roof (role 'roof'): outdoor floor / walls / no ceiling, outdoor scene fog while up there, the tower shell outside;
//  - the Subway and the office's station storey resolve exactly as before.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {buildBoth} from './helpers/tslShaders';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateStation} from '../src/gen/station';
import {planWallDetail, treatmentOf, finishFamily, RECIPES} from '../src/world/wallDetailPlan';
import {LevelColumns, extractWallFaces, stationLevels} from '../src/world/levelGeometry';
import {cutOfficeWindows} from '../src/world/officeProps';
import {
  CORE_WALL, LOBBY_PALETTE, LOWER, NEUTRAL_PALETTE, OfficeArch, OfficeSurfaceMaterial, WET_WALL, areaClass, boundColor, ceilingKindFor, ceilingMaterial,
  floorKindFor, floorMaterial, officeStyle, wallMaterial, type OfficeFinishFamily,
} from '../src/world/officeArch';
import {EXT_FOG, EXT_U, buildExterior, exteriorFogOpacity, exteriorFogTune, planExterior, setExteriorRoof} from '../src/world/exterior';
import {OfficeAtmosphere, ROOF_FOG, roofBlend} from '../src/world/officeAtmosphere';
import {MOOD} from '../src/world/lights';
import type {Area, StationLayout} from '../src/gen/stationTypes';
import type {TenantFinish, TenantPalette} from '../src/gen/office/overhaulTypes';

installCanvasShim(false);

const fakeEnv = (): Record<TextureKey, THREE.Texture> => {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
};
const levelCache = new Map<number, StationLayout>();
const office = (seed: number): StationLayout => {
  let l = levelCache.get(seed);
  if (!l) levelCache.set(seed, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'})));
  return l;
};
const STATION_WALLS = ['tileLower', 'tileUpper', 'tileBase', 'paint', 'tileShop'];
const STATION_TREATMENTS = ['platformTile', 'trackTunnel', 'trackFace', 'concourseTile', 'shopTile', 'servicePaint', 'stairCore', 'upperFinish', 'lowerConcrete'];
const hsl = (hex: number) => { const o = {h: 0, s: 0, l: 0}; new THREE.Color().setHex(hex, THREE.SRGBColorSpace).getHSL(o, THREE.SRGBColorSpace); return o; };
const FINISHES: TenantFinish[] = ['corporate', 'warm-wood', 'industrial', 'clinical', 'creative', 'luxury'];
const area = (o: Partial<Area>): Area => ({id: 0, x: 0, y: 0, w: 8, h: 8, kind: 'room', type: 'office-room', label: '', ceil: 3, parent: -1, depth: 0, publicSpace: false, lighting: 'dim', level: 3, ...o} as Area);

describe('office styles: tenant palette + finish -> bounded material parameters', () => {
  it('every palette x finish stays within the wall / carpet / accent bounds; finish families map to their lower walls / floors / ceilings', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const pal = (): TenantPalette => ({wall: Math.floor(rnd() * 0xffffff), accent: Math.floor(rnd() * 0xffffff), floor: Math.floor(rnd() * 0xffffff), trim: Math.floor(rnd() * 0xffffff), sign: 0xffffff});
    const kinds = new Set<number>(Object.values(LOWER));
    for (let i = 0; i < 60; i++) {
      const p = i === 0 ? {...NEUTRAL_PALETTE, wall: 0x000000, accent: 0x00ff00, floor: 0xffffff} : pal();
      for (const f of FINISHES) {
        const s = officeStyle(p, f);
        for (const w of [s.wall, s.accent]) {
          expect(kinds.has(w.kind)).toBe(true);
          expect(w.lowerTop).toBeGreaterThanOrEqual(0);
          expect(w.skirt).toBeLessThanOrEqual(0.2);
          expect(w.peel).toBeGreaterThanOrEqual(0); expect(w.peel).toBeLessThanOrEqual(1);
        }
        const wl = hsl(s.wall.paint);
        expect(wl.l, `${f} wall ${s.wall.paint.toString(16)}`).toBeGreaterThanOrEqual(0.2);
        expect(wl.l).toBeLessThanOrEqual(0.93);
        expect(wl.s).toBeLessThanOrEqual(0.41);
        const al = hsl(s.accent.paint);
        expect(al.l).toBeGreaterThanOrEqual(0.2); expect(al.l).toBeLessThanOrEqual(0.9); expect(al.s).toBeLessThanOrEqual(0.71);
        const cl = hsl(s.carpet);
        expect(cl.l).toBeGreaterThanOrEqual(0.09); expect(cl.l).toBeLessThanOrEqual(0.63); expect(cl.s).toBeLessThanOrEqual(0.46);
      }
    }
    const s = (f: OfficeFinishFamily) => officeStyle(NEUTRAL_PALETTE, f);
    expect(s('corporate').wall.kind).toBe(LOWER.paint);
    expect(s('warm-wood').wall.kind).toBe(LOWER.wood);
    expect(s('warm-wood').trimWood).toBe(true);
    expect(s('industrial').wall.kind).toBe(LOWER.concrete);
    expect(s('industrial').ceiling).toBe('raw');
    expect(s('industrial').open).toBe('concrete');
    expect(s('clinical').open).toBe('vinyl');
    expect(s('luxury').accent.kind).toBe(LOWER.stone);
    expect(s('luxury').wall.kind).toBe(LOWER.wood);
    expect(s('creative').wall.kind).toBe(LOWER.none);
    const lobby = officeStyle(LOBBY_PALETTE, 'lobby');
    expect([lobby.open, lobby.corridor, lobby.feature]).toEqual(['stone', 'stone', 'stone']);
    expect(lobby.wall.kind).toBe(LOWER.stone);
    expect(lobby.accent.kind).toBe(LOWER.wood);
    expect(boundColor(0xff00ff, 0.3, 0.6, 0.2)).not.toBe(0xff00ff);
  });

  it('area classes: washrooms / core / server / kitchens / labs / rooms / roof by type, purpose and label', () => {
    const st = officeStyle(NEUTRAL_PALETTE, 'corporate');
    expect(areaClass(area({type: 'washroom', publicSpace: true}))).toBe('wet');
    expect(areaClass(area({type: 'office-stair', purpose: 'office-stair'}))).toBe('core');
    expect(areaClass(area({type: 'supply-closet', kind: 'closet'}))).toBe('core');
    expect(areaClass(area({purpose: 'office-server', label: 'Server room'}))).toBe('server');
    expect(areaClass(area({purpose: 'office-break', label: 'Break room'}))).toBe('kitchen');
    expect(areaClass(area({purpose: 'company-lounge', label: 'Breakout lounge'}))).toBe('room');
    expect(areaClass(area({purpose: 'company-lab', label: 'Formulation lab'}))).toBe('lab');
    expect(areaClass(area({purpose: 'office-meeting', label: 'Meeting room'}))).toBe('room');
    expect(areaClass(area({type: 'office-open', kind: 'room', purpose: 'office-open'}))).toBe('work');
    expect(areaClass(area({type: 'office-corridor', kind: 'passage'}))).toBe('corridor');
    expect(areaClass(area({type: 'office-lobby', publicSpace: true}), {lobby: true})).toBe('lobby');
    expect(areaClass(area({}), {roof: true})).toBe('roof');
    expect(floorKindFor('wet', st)).toBe('wet');
    expect(floorKindFor('server', st)).toBe('server');
    expect(floorKindFor('kitchen', st)).toBe('tile');
    expect(floorKindFor('room', officeStyle(NEUTRAL_PALETTE, 'industrial'))).toBe('carpet');
    expect(floorKindFor('roof', st)).toBe('roof');
    expect(ceilingKindFor('roof', st)).toBeNull();
    expect(ceilingKindFor('room', officeStyle(NEUTRAL_PALETTE, 'industrial'))).toBe('grid');
    expect(ceilingKindFor('work', officeStyle(NEUTRAL_PALETTE, 'industrial'))).toBe('raw');
  });
});

describe('office storeys look like an office, not the station', () => {
  const layout = office(222);
  const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const w = buildWorld(layout, mats, {});
  const levels = stationLevels(layout);
  const arch = w.officeArch!;
  const officeArea = (id: number) => id >= 0 && (layout.areas[id]?.level ?? 0) >= 1;

  it('every wall face of an office storey area has an office finish; level-0 (station) faces are exactly as before', () => {
    let office = 0;
    for (const f of w.wallFaces) {
      if (officeArea(f.area)) {
        office++;
        expect(f.finish.startsWith('office-'), `${f.finish} @L${f.level} area ${layout.areas[f.area].type}`).toBe(true);
        expect(STATION_WALLS).not.toContain(f.finish);
      } else expect(f.finish.startsWith('office-')).toBe(false);
    }
    expect(office).toBeGreaterThan(200);
    // the station storey: the same finishes the builder produced before the office remap (same extractor, same order)
    const raw = cutOfficeWindows(extractWallFaces(layout, levels, new LevelColumns(levels), {tileLowerHeight: mats.tileLowerHeight}), layout);
    expect(raw.length).toBe(w.wallFaces.length);
    raw.forEach((f, i) => { if (!officeArea(f.area)) expect(w.wallFaces[i].finish).toBe(f.finish); });
  });

  it('office floors / ceilings resolve to office keys (carpet, hard floors by room, T-bar / plaster / slab ceilings)', () => {
    const want: [RegExp, RegExp][] = [
      [/server/, /^office-floor-server$/], [/break/, /^office-floor-tile$/], [/^office-private$|^office-meeting$/, /^office-carpet@/],
    ];
    let checked = 0;
    for (const L of levels) {
      if (L.id < 1) continue;
      const g = L.grid;
      for (let i = 0; i < g.cells.length; i++) {
        if (g.cells[i] !== 1 || g.rampIdx[i] >= 0 || !officeArea(g.area[i])) continue;
        const a = layout.areas[g.area[i]];
        const k = arch.floorKey(L.id, i)!;
        expect(k, `${a.type} ${a.purpose}`).toMatch(/^office-/);
        if (a.type === 'washroom') expect(k).toBe('office-floor-wet');
        for (const [p, re] of want) if (p.test(a.purpose ?? '')) { expect(k, a.purpose).toMatch(re); checked++; }
        const c = arch.ceilKey(L.id, g.area[i], i);
        expect(c === false || (typeof c === 'string' && c.startsWith('office-ceil-'))).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(50);
    // the iteration-16 mesh names stay: carpet + suspended ceiling on every tower storey (lobby: its security office), reveals
    const byName = new Map<string, Set<number>>();
    w.group.traverse(q => { let s = byName.get(q.name); if (!s) byName.set(q.name, (s = new Set())); s.add(q.userData.level ?? -1); });
    const floors = layout.office!.storeys.map(s => s.levelId).sort((a, b) => a - b);
    for (const n of ['office-carpet', 'office-drop-ceiling', 'office-window-reveals']) expect([...(byName.get(n) ?? [])].sort((a, b) => a - b), n).toEqual(floors);
  });

  it('no office-storey architecture mesh uses a station wall / floor / ceiling material; door frames are office joinery', () => {
    const station = new Set(['tileLower', 'tileUpper', 'tileBase', 'paint', 'terrazzo', 'ceiling', 'ceilingService'].map(k => mats.get(k as never)));
    const bad: string[] = [];
    let trims = 0;
    w.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) return;
      const lv = o.userData.level as number;
      if (!(lv >= 1)) return;
      if (o.name.startsWith('arch-') || o.name.startsWith('office-')) if (station.has(m.material as THREE.Material)) bad.push(`${o.name}`);
      if (o.name.startsWith('trim-') && (m.material as THREE.Material).name.startsWith('office-trim')) trims++;
    });
    expect(bad).toEqual([]);
    expect(trims).toBeGreaterThan(0);
  });

  it('the lobby is company-neutral: lobby style, stone floors in its halls, oak feature wall', () => {
    const lobby = arch.lobbyLevel;
    expect(arch.styleOf(lobby).finish).toBe('lobby');
    const halls = layout.areas.filter(a => (a.level ?? 0) === lobby && a.type === 'office-lobby');
    expect(halls.length).toBeGreaterThan(0);
    const g = levels[lobby].grid;
    for (const h of halls) {
      const i = g.idx(h.x + Math.floor(h.w / 2), h.y + Math.floor(h.h / 2));
      if (g.area[i] === h.id && g.rampIdx[i] < 0) expect(arch.floorKey(lobby, i)).toBe('office-floor-stone');
    }
    const wall = arch.material(`office-wall@${lobby}`) as OfficeSurfaceMaterial;
    expect(wall.ofA.getHex(THREE.SRGBColorSpace)).toBe(officeStyle(LOBBY_PALETTE, 'lobby').wall.paint);
    expect(w.wallFaces.some(f => f.finish === `office-accent@${lobby}`)).toBe(true);
    // tenant floors are not lobby-styled
    for (const s of layout.office!.storeys) if (s.levelId !== lobby) expect(arch.styleOf(s.levelId).finish).not.toBe('lobby');
  });

  it('wall detail: office faces take office treatments only — no station identity, fittings or cut damage; wear remains', () => {
    const plan = planWallDetail(layout, {faces: w.wallFaces});
    const officeFaces = new Set<number>();
    plan.faces.forEach((pf, i) => {
      if (!pf.face.finish.startsWith('office-')) return;
      officeFaces.add(i);
      expect(STATION_TREATMENTS).not.toContain(pf.treatment);
      expect(pf.finish).toBe('office');
    });
    expect(officeFaces.size).toBeGreaterThan(100);
    const kinds = new Map<string, number>();
    for (const f of plan.features) if (officeFaces.has(f.face)) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    for (const k of ['conduit', 'switchBox', 'pipe', 'cables', 'band', 'frieze', 'pilaster', 'tileLoss', 'spall', 'breach', 'recess', 'formwork']) expect(kinds.get(k) ?? 0, k).toBe(0);
    const wear = (kinds.get('streak') ?? 0) + (kinds.get('crack') ?? 0) + (kinds.get('scuff') ?? 0) + (kinds.get('damp') ?? 0);
    expect(wear).toBeGreaterThan(30);
    expect(treatmentOf({zone: 'service', finish: 'office-wall@3'})).toBe('officeWall');
    expect(treatmentOf({zone: 'concourse', finish: 'office-roof'})).toBe('officeRoof');
    expect(finishFamily('office-wet')).toBe('office');
    expect(RECIPES.officeWall.conduit + RECIPES.officeWall.switchBox + RECIPES.officeWall.pipe + RECIPES.officeWall.breach).toBe(0);
  });

  it('bounded materials: <= 5 per storey + shared; one program graph per surface kind; every storey has an accent wall', () => {
    const used = arch.usedMaterials();
    const perStorey = new Map<number, number>();
    for (const k of used.keys()) { const m = /@(\d+)$/.exec(k); if (m) perStorey.set(+m[1], (perStorey.get(+m[1]) ?? 0) + 1); }
    for (const [lv, n] of perStorey) expect(n, `storey ${lv}`).toBeLessThanOrEqual(5);
    expect(used.size).toBeLessThanOrEqual(56);
    const graphs = new Map<string, Set<unknown>>();
    for (const m of used.values()) {
      const kind = m.userData.officeArch as string | undefined;
      if (!kind) continue;
      let s = graphs.get(kind);
      if (!s) graphs.set(kind, (s = new Set()));
      s.add((m as OfficeSurfaceMaterial).colorNode);
    }
    for (const [k, s] of graphs) expect(s.size, k).toBe(1);
    expect([...graphs.keys()].sort()).toEqual(['ceiling', 'floor', 'wall']);
    const accentLevels = new Set(w.wallFaces.filter(f => f.finish.startsWith('office-accent@')).map(f => f.level));
    for (const s of layout.office!.storeys) expect(accentLevels.has(s.levelId), `accent on storey ${s.floor}`).toBe(true);
  });

  it('tenant palettes reach the materials (wall paint / carpet per storey; Area.tenant or layout.office.tenants)', () => {
    const tenantLevels = layout.office!.storeys.filter(s => s.floor >= 2);
    const walls = new Set(tenantLevels.map(s => (arch.material(`office-wall@${s.levelId}`) as OfficeSurfaceMaterial | undefined)?.ofA.getHex()));
    const tenanted = !!layout.office!.tenants?.length || layout.areas.some(a => a.tenant);
    if (tenanted) expect(walls.size).toBeGreaterThanOrEqual(3); // distinct companies, distinct walls
    for (const s of tenantLevels) {
      const st = arch.styleOf(s.levelId);
      const carpet = arch.material(`office-carpet@${s.levelId}`) as OfficeSurfaceMaterial | undefined;
      if (carpet) expect(carpet.ofA.getHex(THREE.SRGBColorSpace)).toBe(st.carpet);
    }
  });
});

describe('the Subway resolves exactly as before', () => {
  it('no office keys / materials anywhere in a Subway station; OfficeArch is off', () => {
    const l = generateStation(4242);
    const mats = new WorldMaterials(fakeEnv(), 3, {w: 1.2, h: 0.19, d: 0.17});
    expect(OfficeArch.for(l, mats, stationLevels(l))).toBeNull();
    const w = buildWorld(l, mats, {});
    for (const f of w.wallFaces) expect(f.finish.startsWith('office-')).toBe(false);
    w.group.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m)) expect(m.name.startsWith('office-'), o.name).toBe(false);
    });
    // and the exterior has no roof
    expect(EXT_U.roofY.value).toBeGreaterThan(1e8);
  });
});

describe('heavy green exterior fog', () => {
  it('colour: sickly green-grey (hue 75-150 deg, saturation 0.15-0.5), dark enough not to glow', () => {
    const c = new THREE.Color(...EXT_FOG.color);
    const o = {h: 0, s: 0, l: 0};
    c.getHSL(o, THREE.SRGBColorSpace);
    expect(o.h * 360).toBeGreaterThan(75);
    expect(o.h * 360).toBeLessThan(150);
    expect(o.s).toBeGreaterThan(0.15);
    expect(o.s).toBeLessThan(0.5);
    expect(Math.max(...EXT_FOG.color)).toBeLessThan(0.2);
    expect(EXT_FOG.color[1]).toBeGreaterThan(EXT_FOG.color[0]);
    expect(EXT_FOG.color[1]).toBeGreaterThan(EXT_FOG.color[2]);
    expect((EXT_U.haze.value as THREE.Color).toArray()).toEqual([...EXT_FOG.color]);
  });

  it('opacity of a level view ray at 30 / 80 / 150 m from every floor (and the roof): murky at 30, nearly gone by 80, gone by 150', () => {
    for (let floor = 2; floor <= 9; floor++) {
      const eye = 4.4 * (floor - 1) + 1.6;
      const o30 = exteriorFogOpacity(30, eye), o80 = exteriorFogOpacity(80, eye), o150 = exteriorFogOpacity(150, eye);
      expect(o30, `floor ${floor} 30 m`).toBeGreaterThan(0.35);
      expect(o30).toBeLessThan(0.72);
      expect(o80, `floor ${floor} 80 m`).toBeGreaterThan(0.75);
      expect(o80).toBeLessThan(0.98);
      expect(o150, `floor ${floor} 150 m`).toBeGreaterThan(0.95);
      expect(exteriorFogOpacity(120, eye)).toBeGreaterThan(0.9);
    }
    // the old dusk haze was 0.0036/m: 30 % at 100 m
    expect(1 - Math.exp(-0.0036 * 100)).toBeLessThan(0.31);
    expect(exteriorFogOpacity(100, 19.2)).toBeGreaterThan(0.9);
  });

  it('thicker near street level; looking down at the street from floor 8 reads through murk', () => {
    expect(exteriorFogOpacity(30, 2)).toBeGreaterThan(exteriorFogOpacity(30, 30) + 0.15);
    expect(exteriorFogOpacity(50, 2, 2)).toBeGreaterThan(exteriorFogOpacity(50, 32, 32));
    // the ring road below floor 8: still visible, heavily fogged
    const down = exteriorFogOpacity(Math.hypot(25, 32.4), 32.4, 0);
    expect(down).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(0.9);
    // monotonic in distance
    let prev = 0;
    for (let d = 5; d <= 200; d += 5) { const v = exteriorFogOpacity(d, 19); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  it('QA tune hook changes uniforms only and reports the mirror opacities', () => {
    const before = exteriorFogTune();
    const t = exteriorFogTune({base: 0.02});
    expect(EXT_U.hazeDensity.value).toBe(0.02);
    expect((t.opacityAt19m as {d30: number}).d30).toBeGreaterThan((before.opacityAt19m as {d30: number}).d30);
    exteriorFogTune({base: EXT_FOG.base});
    expect(EXT_U.hazeDensity.value).toBe(EXT_FOG.base);
  });
});

describe('the roof storey (role roof): outdoors', () => {
  it('roof areas: roof floor, roof walls, no ceiling (a low enclosed housing keeps one)', () => {
    const layout = office(222);
    const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const levels = stationLevels(layout);
    const top = layout.office!.roof?.level ?? Math.max(...layout.office!.storeys.map(s => s.levelId));
    // with STRUCT's roof the real roof storey; otherwise the top storey stands in for one (role handling, not geometry)
    const roofed = layout.office!.roof ? layout : {...layout, office: {...layout.office!, roof: {level: top, baseY: levels[top].baseY, parapet: 1.1, ladder: {bottom: {x: 0, y: 0, z: 0}, top: {x: 0, y: 0, z: 0}, yaw: 0, hatch: {x0: 0, z0: 0, x1: 1, z1: 1}}, structures: []}}};
    const arch = OfficeArch.for(roofed as StationLayout, mats, levels)!;
    expect(arch.roofLevel).toBe(top);
    const g = levels[top].grid;
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== 1 || g.rampIdx[i] >= 0 || (layout.areas[g.area[i]]?.level ?? 0) !== top) continue;
      const a = layout.areas[g.area[i]];
      if (areaClass(a) === 'core' && layout.office!.roof) continue;
      expect(arch.floorKey(top, i)).toBe('office-floor-roof');
      const c = arch.ceilKey(top, g.area[i], i);
      expect(c === false || c === 'office-ceil-core').toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(20);
    const faces = arch.remapFaces(buildWorld(layout, mats, {}).wallFaces.filter(f => f.level === top && (layout.areas[f.area]?.level ?? 0) === top && !f.slope), mats.tileLowerHeight);
    expect(faces.some(f => f.finish === 'office-roof')).toBe(true);
  });

  it('roof blend ramps over the hatch climb, only over the tower; the outdoor scene fog applies there and is restored below', () => {
    const roof = {baseY: 40, foot: {x0: 0, z0: 0, x1: 30, z1: 25}};
    expect(roofBlend(10, 38, 10, roof)).toBe(0);
    expect(roofBlend(10, 41.5, 10, roof)).toBe(1);
    expect(roofBlend(10, 40, 10, roof)).toBeGreaterThan(0);
    expect(roofBlend(10, 40, 10, roof)).toBeLessThan(1);
    expect(roofBlend(80, 41.5, 10, roof)).toBe(0);
    expect(roofBlend(10, 41.5, 10, null)).toBe(0);
    // a fake host: scene fog swaps to the green murk on the roof, back to the indoor fog below; the city stays shown
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    const ext = new THREE.Group(); ext.name = 'tower-exterior'; ext.visible = false; scene.add(ext);
    const camera = new THREE.PerspectiveCamera(); scene.add(camera);
    const host = {scene, camera, sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[]};
    const atm = new OfficeAtmosphere(host);
    host.sectionHooks[0].build!({office: {roof: {baseY: 40}, exterior: roof.foot}} as unknown as StationLayout);
    camera.position.set(10, 41.6, 10); camera.updateMatrixWorld(true);
    host.frameHooks[0](0.016);
    const fog = scene.fog as THREE.FogExp2;
    expect(atm.blend).toBe(1);
    expect(fog.density).toBeCloseTo(ROOF_FOG.density, 6);
    expect(fog.color.getHex()).toBe((EXT_U.haze.value as THREE.Color).getHex());
    expect(ext.visible).toBe(true);
    camera.position.set(10, 36, 10); camera.updateMatrixWorld(true);
    host.frameHooks[0](0.016);
    expect(fog.density).toBe(MOOD.fogDensity);
    expect(fog.color.getHex()).toBe(new THREE.Color(MOOD.fogColor).getHex());
    host.sectionHooks[0].teardown!();
  });

  it('the exterior from the roof: no indoor fog part above the deck, the tower shell below it (none without a roof)', () => {
    const plan = planExterior({foot: {x0: 0, z0: 0, x1: 30, z1: 25}, groundY: 5.5, eyeAbove: 30, seed: 9});
    setExteriorRoof(5.5 + 4.4 * 8);
    expect(EXT_U.roofY.value).toBeCloseTo(5.5 + 4.4 * 8 - 0.3, 6);
    const v = buildExterior(plan, {});
    const shell = v.root.getObjectByName('tower-ext-shell') as THREE.Mesh;
    expect(shell).toBeTruthy();
    const pos = shell.geometry.attributes.position, nor = shell.geometry.attributes.normal;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    expect(maxY).toBeCloseTo(5.5 + 4.4 * 8, 4);
    // faces point outward (never drawn from inside the tower)
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3 - 15, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3 - 12.5;
      expect(cx * nor.getX(i) + cz * nor.getZ(i)).toBeGreaterThan(0);
      const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1), c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      expect(n.dot(new THREE.Vector3().fromBufferAttribute(nor, i))).toBeGreaterThan(0.99);
    }
    setExteriorRoof(null);
    expect(buildExterior(plan, {}).root.getObjectByName('tower-ext-shell')).toBeUndefined();
    expect(EXT_U.roofY.value).toBeGreaterThan(1e8);
  });
});

describe('shaders build cleanly on both backends (WGSL + GLSL)', () => {
  const lights = () => [new THREE.PointLight(0xffffff, 1, 8)];
  const clean = (o: THREE.Object3D, what: string) => { for (const sh of buildBoth(o, {lights: lights()})) expect(sh.errors, `${what} (${sh.backend})`).toEqual([]); };

  it('office wall / floor / ceiling materials (with the decay hook)', () => {
    const mats = new WorldMaterials(fakeEnv(), 5, {w: 1.2, h: 0.19, d: 0.17});
    const geo = new THREE.BoxGeometry(2, 2, 2);
    clean(new THREE.Mesh(geo, wallMaterial(mats, 'office-test-wall', WET_WALL)), 'wall');
    clean(new THREE.Mesh(geo, wallMaterial(mats, 'office-test-core', CORE_WALL)), 'core wall');
    clean(new THREE.Mesh(geo, floorMaterial(mats, 'office-test-carpet', 'carpet', 0x445566)), 'carpet');
    clean(new THREE.Mesh(geo, floorMaterial(mats, 'office-test-stone', 'stone')), 'stone floor');
    clean(new THREE.Mesh(geo, ceilingMaterial(mats, 'office-test-grid', 'grid')), 'grid ceiling');
    const fr = buildBoth(new THREE.Mesh(geo, wallMaterial(mats, 'office-test-wall2', CORE_WALL)), {lights: lights()});
    for (const sh of fr) expect(sh.fragment.length).toBeGreaterThan(1000);
  });

  it('exterior ground / blocks / props / sky / tower shell', () => {
    setExteriorRoof(40);
    const v = buildExterior(planExterior({foot: {x0: 0, z0: 0, x1: 30, z1: 25}, groundY: 5.5, eyeAbove: 20, seed: 3}), {});
    const seen = new Map<THREE.Material, THREE.Mesh>();
    v.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !seen.has(m.material as THREE.Material)) seen.set(m.material as THREE.Material, m); });
    for (const m of seen.values()) clean(m, m.name); // (building re-parents the mesh: never inside the traversal)
    expect([...seen.keys()].map(m => m.name).sort()).toEqual(['tower-ext-block', 'tower-ext-facade', 'tower-ext-ground', 'tower-ext-prop', 'tower-ext-sky']);
    setExteriorRoof(null);
  });
});
