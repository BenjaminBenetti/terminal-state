// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane BOUNCE): what stops the flashlight's beam besides the fixed
// architecture (world/flashOccluders.ts) — the part of the live flashlight bounce that knows the game's props and characters.
// - GLASS: shop glazing is a pane (the beam passes), the hockey store's dasher boards are solid up to their boards, a box the caller
//   names (the player train's window glass) passes, and a collision-only box drawn as nothing but an upright glass pane (the Bunker
//   ward's cubicles) passes; everything else is its box. On real generated levels: which boxes pass, by kind;
// - a COLOUR for every registered prop kind, from its damage class (the test's own reading of the palettes);
// - the LIVE list: the layout's own array at every read;
// - CHARACTERS: the living, standing ones within the light's reach, the nearest FLASH_BODIES_MAX of them, feet to head;
// - the GAME'S WIRING (source pins): made with the station's prop index and the train's glass, dropped with the station, the
//   characters listed right before the bounce's one update a frame; nothing of a save is read or written.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {layoutFor} from './helpers/pacedBuildFixture';
import type {EnemyActor} from '../src/ai/creatureArchetypes';
import {ALL_PROP_KINDS, DAMAGE_MATERIALS, propDamageSpec} from '../src/damage/materials';
import type {PropPlacement} from '../src/gen/props';
import {HK_RINK_BOARD} from '../src/gen/skyways/stores/hockeyParts';
import type {ShopBox} from '../src/gen/storefronts';
import {
  FLASH_BODIES_MAX, FLASH_BODY_REACH, FLASH_GLAZING, FLASH_PROP_GREY, StationFlashOccluders, flashOccluders, flashPropAlbedo,
  type FlashBodyActor, type FlashOccluderLayout,
} from '../src/world/flashOccluders';

const prop = (kind: string, x: number, z: number, hx: number, hz: number, h: number, y = 0, more: Partial<PropPlacement> = {}): PropPlacement =>
  ({kind, x, z, y, rot: 0, area: 0, hx, hz, h, blocksSight: true, variant: 0, ...more}) as PropPlacement;
const lum = (v: ArrayLike<number>): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const actor = (x: number, z: number, brain: Partial<FlashBodyActor['brain']> = {}, more: Partial<FlashBodyActor> = {}): FlashBodyActor =>
  ({brain: {x, y: 0, z, alive: true, stats: {radius: 0.35}, ...brain}, ragdolled: false, ...more});
const bodiesOf = (occ: StationFlashOccluders): number[][] => Array.from({length: occ.bodyCount}, (_, i) => Array.from(occ.bodies.subarray(i * 5, i * 5 + 5)));

describe('glass: what passes the beam', () => {
  it('glazing by kind: both kinds are real prop kinds; shop glazing is a pane, the rink\'s dasher boards are solid up to their boards (1.1 m); any other kind is its whole box', () => {
    expect([...FLASH_GLAZING]).toEqual([['shopGlazing', 0], ['hkRinkBoard', HK_RINK_BOARD.boardTop]]);
    expect(HK_RINK_BOARD.boardTop).toBe(1.1);
    expect(HK_RINK_BOARD.h).toBeGreaterThan(HK_RINK_BOARD.boardTop); // (glass above the boards)
    for (const kind of FLASH_GLAZING.keys()) expect(ALL_PROP_KINDS as string[], kind).toContain(kind);
    const occ = flashOccluders({props: []});
    expect(occ.stops(prop('shopGlazing', 0, 0, 1, 0.05, 2.4))).toBe(false);
    expect(occ.stops(prop('hkRinkBoard', 0, 0, 1, 0.07, 1.88))).toBe(true);
    expect(occ.solidH).toBe(1.1);
    for (const kind of ['column', 'booth', 'vending', 'displayCase', 'annexMachine']) {
      expect(occ.stops(prop(kind, 0, 0, 0.4, 0.4, 2.3)), kind).toBe(true);
      expect(occ.solidH, kind).toBe(2.3);
    }
    // (a box that is gone — h = 0 — is the bounce's own rule: world/flashBounce.ts leaves out what is no higher than 0.02 m)
  });

  it('a box the caller names passes (the player train\'s window glass); the caller is not asked about glazing kinds', () => {
    const pane = prop('trainShell', 0, 0, 1, 0.05, 1), wall = prop('trainShell', 2, 0, 1, 0.05, 2.2), asked: PropPlacement[] = [];
    const occ = flashOccluders({props: [pane, wall]}, box => { asked.push(box); return box === pane; });
    expect(occ.stops(pane)).toBe(false);
    expect(occ.stops(wall)).toBe(true);
    expect(occ.solidH).toBe(2.2);
    expect(asked).toEqual([pane, wall]);
    expect(occ.stops(prop('shopGlazing', 0, 0, 1, 0.05, 2.4))).toBe(false);
    expect(occ.stops(prop('hkRinkBoard', 0, 0, 1, 0.07, 1.88))).toBe(true);
    expect(asked).toHaveLength(2);
    // no predicate: every such box is solid
    expect(flashOccluders({props: [pane]}).stops(pane)).toBe(true);
  });

  it('a collision-only box drawn as nothing but an upright glass pane passes: the pane stands in the box, runs its length, reaches from its foot to its top', () => {
    // a cubicle front: a box 2 m long and 0.12 m thick, 2.2 m high, not sight-blocking; its pane 0.04 m thick inside it
    const box = (more: Partial<PropPlacement> = {}): PropPlacement => prop('annexMachine', 10, 5, 1, 0.06, 2.2, 0, {blocksSight: false, ...more});
    const pane = (more: Partial<ShopBox> = {}): ShopBox => ({m: 'glassShopfront', x0: 9, x1: 11, y0: 0.1, y1: 2.2, z0: 4.98, z1: 5.02, ...more} as ShopBox);
    const passes = (p: PropPlacement, decor: ShopBox[]): boolean => {
      const occ = flashOccluders({props: [p], decor});
      expect(occ.panes.has(p)).toBe(!occ.stops(p));
      return occ.panes.has(p);
    };
    expect(passes(box(), [pane()])).toBe(true);
    // along z as well (a cubicle's side wall)
    expect(passes(prop('annexMachine', 10, 5, 0.06, 1, 2.2, 0, {blocksSight: false}), [{m: 'glassShopfront', x0: 9.98, x1: 10.02, y0: 0.1, y1: 2.2, z0: 4, z1: 6} as ShopBox])).toBe(true);
    // a pane among other decor, and a second pane: still that one box
    expect(passes(box(), [pane({m: 'frame' as ShopBox['m']}), pane(), pane({x0: 30, x1: 32})])).toBe(true);
    const not: Record<string, [PropPlacement, ShopBox[]]> = {
      'no decor at all': [box(), []],
      'the layout has no decor list': [box(), undefined as unknown as ShopBox[]],
      'a sight-blocking box (a machine)': [box({blocksSight: true}), [pane()]],
      'another kind': [prop('column', 10, 5, 1, 0.06, 2.2, 0, {blocksSight: false}), [pane()]],
      'decor of another material': [box(), [pane({m: 'frame' as ShopBox['m']})]],
      'a pane lower than 1.2 m (a counter\'s sneeze guard)': [box(), [pane({y0: 1.2, y1: 2.2})]],
      'a slab of glass 0.2 m thick': [prop('annexMachine', 10, 5, 1, 0.15, 2.2, 0, {blocksSight: false}), [pane({z0: 4.9, z1: 5.1})]],
      'a pane that sticks out of the box': [box(), [pane({x0: 8.9})]],
      'a pane beside the box': [box(), [pane({z0: 5.2, z1: 5.24})]],
      'a pane half the box\'s length (a window in a wall)': [box(), [pane({x0: 9.5, x1: 10.5})]],
      'a box much thicker than a pane (a machine with a window)': [prop('annexMachine', 10, 5, 1, 0.4, 2.2, 0, {blocksSight: false}), [pane()]],
      'a pane that ends well under the box\'s top': [box(), [pane({y1: 1.9})]],
      'a pane that starts well above the box\'s foot (a window over a counter)': [box(), [pane({y0: 0.5})]],
    };
    for (const [name, [p, decor]] of Object.entries(not)) expect(passes(p, decor), name).toBe(false);
  });

  it('on real generated levels the boxes that pass are glazing and nothing else: shopfront glazing in the Subway, the rink\'s boards above 1.1 m in the Skyways, cubicle panes in the Bunker', () => {
    const rows: string[] = [];
    const census = (level: 'subway' | 'skyways' | 'bunker', seed: number) => {
      const layout = layoutFor(level, seed), occ = flashOccluders(layout as FlashOccluderLayout);
      const pass = new Map<string, number>(), part = new Map<string, number>();
      let solid = 0;
      for (const p of layout.props) {
        if (!(p.h > 0.02)) continue;
        if (!occ.stops(p)) pass.set(p.kind, (pass.get(p.kind) ?? 0) + 1);
        else if (occ.solidH < p.h) part.set(p.kind, (part.get(p.kind) ?? 0) + 1);
        else solid++;
      }
      rows.push(`${level} seed ${seed}: ${layout.props.length} boxes — ${solid} solid, pass ${JSON.stringify([...pass])}, solid below glass ${JSON.stringify([...part])}, ${occ.panes.size} pane boxes`);
      return {layout, occ, pass, part, solid};
    };
    const subway = census('subway', 93), skyways = census('skyways', 93), bunker = census('bunker', 93);
    console.log(`flash occluders, what passes the beam on real levels:\n  ${rows.join('\n  ')}`);
    // the Subway: its shopfronts' glazing, and nothing else
    expect([...subway.pass.keys()]).toEqual(['shopGlazing']);
    expect(subway.pass.get('shopGlazing')).toBeGreaterThan(0);
    expect(subway.part.size + subway.occ.panes.size).toBe(0);
    expect(subway.solid).toBeGreaterThan(500);
    // the Skyways: glazing, and the hockey store's dasher boards in part
    expect([...skyways.pass.keys()].filter(k => k !== 'shopGlazing')).toEqual([]);
    expect([...skyways.part.keys()]).toEqual(['hkRinkBoard']);
    // the Bunker: every pane box is a collision-only annexMachine, and they are the only boxes of that kind that pass
    expect(bunker.occ.panes.size).toBeGreaterThan(0);
    for (const p of bunker.occ.panes) expect([(p as PropPlacement).kind, (p as PropPlacement).blocksSight]).toEqual(['annexMachine', false]);
    expect(bunker.pass.get('annexMachine')).toBe(bunker.occ.panes.size);
    expect([...bunker.pass.keys()].filter(k => k !== 'shopGlazing' && k !== 'annexMachine')).toEqual([]);
    // (its machines proper — sight-blocking, or with no pane in them — stop the beam)
    expect(bunker.layout.props.filter(p => p.kind === 'annexMachine' && p.h > 0.02 && bunker.occ.stops(p)).length).toBeGreaterThan(0);
  }, 240000);
});

describe('a colour for every prop kind', () => {
  // the test's own reading: the damage class's fragment palette (sRGB), its mean in linear light, half way to its own grey, capped
  const own = (cls: keyof typeof DAMAGE_MATERIALS): number[] => {
    if (cls === 'glass') return [0.25, 0.25, 0.25];
    const cs = DAMAGE_MATERIALS[cls].palette.map(hex => new THREE.Color().setHex(hex, THREE.SRGBColorSpace));
    const mean = [0, 1, 2].map(q => cs.reduce((t, c) => t + c.toArray()[q], 0) / cs.length), grey = lum(mean);
    return mean.map(v => Math.min(0.6, (v + grey) / 2));
  };

  it('every registered kind: its class\'s palette mean in linear light, drawn half way to its own grey, never above 0.6; glass kinds are a neutral 0.25', () => {
    expect(ALL_PROP_KINDS.length).toBeGreaterThan(50);
    expect(FLASH_PROP_GREY).toBe(0.25);
    const byClass = new Map<string, number>();
    let darkest = 1, palest = 0;
    for (const kind of ALL_PROP_KINDS) {
      const cls = propDamageSpec(kind).cls, a = flashPropAlbedo(kind), want = own(cls);
      byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
      for (let q = 0; q < 3; q++) expect(a[q], `${kind} (${cls}) channel ${q}`).toBeCloseTo(want[q], 6);
      expect(Math.max(...a), kind).toBeLessThanOrEqual(0.6 + 1e-6);
      expect(Math.min(...a), kind).toBeGreaterThan(0.005);
      darkest = Math.min(darkest, lum(a)); palest = Math.max(palest, lum(a));
      // one array per kind, made once
      expect(flashPropAlbedo(kind)).toBe(a);
    }
    console.log(`flash occluders, prop colours: ${ALL_PROP_KINDS.length} kinds in ${byClass.size} classes (${[...byClass].sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c} ${n}`).join(', ')}); ` +
      `luminance ${darkest.toFixed(3)} .. ${palest.toFixed(3)}; ${Object.keys(DAMAGE_MATERIALS).map(c => `${c} ${own(c as keyof typeof DAMAGE_MATERIALS).map(v => v.toFixed(2)).join('/')}`).join(', ')}`);
    expect(byClass.size).toBeGreaterThanOrEqual(5);
    // a class leans warm or cool, it does not tint: wood is warmer than steel, neither is saturated
    const wood = own('wood'), steel = own('steel');
    expect(wood[0] / wood[2]).toBeGreaterThan(steel[0] / steel[2]);
    expect(wood[0] / wood[2]).toBeLessThan(2.2);
    // a kind nobody registered is painted sheet metal; the albedo an occluder gives a box is its kind's
    const sheet = own('sheetMetal');
    Array.from(flashPropAlbedo('noSuchKindYet')).forEach((v, q) => expect(v).toBeCloseTo(sheet[q], 6));
    const occ = flashOccluders({props: []});
    expect(occ.albedo(prop('bench', 0, 0, 1, 0.3, 0.5))).toBe(flashPropAlbedo('bench'));
    // characters: dark worn cloth
    const cloth = own('cloth');
    Array.from(occ.bodyAlbedo).forEach((v, q) => expect(v).toBeCloseTo(cloth[q], 6));
    expect(lum(occ.bodyAlbedo)).toBeLessThan(0.12);
  });
});

describe('the live list', () => {
  it('`props` is the layout\'s own array at every read: a push, a splice, an edit in place and a list swapped for another are all seen', () => {
    const layout = {props: [prop('column', 1, 1, 0.3, 0.3, 3)]};
    const occ = flashOccluders(layout);
    expect(occ.props).toBe(layout.props);
    layout.props.push(prop('crate', 2, 2, 0.3, 0.3, 0.6));
    expect(occ.props).toHaveLength(2);
    layout.props[0].h = 0;
    expect(occ.props[0].h).toBe(0);
    layout.props.splice(0, 1);
    expect(occ.props).toHaveLength(1);
    const other = [prop('bench', 3, 3, 1, 0.3, 0.5)];
    layout.props = other;
    expect(occ.props).toBe(other);
  });
});

describe('characters in the beam\'s reach', () => {
  const eye = {x: 10, z: 10};

  it('a living, standing character is an upright cylinder from its feet: x, z, radius, feet, head (its own height, or 1.7 m)', () => {
    const occ = flashOccluders({props: []});
    occ.setBodies([actor(12, 11), actor(8, 9, {y: 3.2, stats: {radius: 0.5, height: 2.4}}), actor(9, 12, {y: -1.15, stats: {radius: 0.3, height: 0}})], eye);
    const got = bodiesOf(occ);
    expect(got).toHaveLength(3);
    [[12, 11, 0.35, 0, 1.7], [8, 9, 0.5, 3.2, 5.6], [9, 12, 0.3, -1.15, 0.55]].forEach((want, i) => want.forEach((v, q) => expect(got[i][q], `body ${i} field ${q}`).toBeCloseTo(v, 5)));
  });

  it('left out: the dead, the ragdolled, a root-placing creature while it climbs (on a wall or a ceiling), and anyone farther than the light reaches', () => {
    const occ = flashOccluders({props: []});
    expect(FLASH_BODY_REACH).toBe(30);
    const cases: [string, FlashBodyActor, boolean][] = [
      ['alive and standing', actor(11, 10), true],
      ['dead', actor(11, 10, {alive: false}), false],
      ['ragdolled', actor(11, 10, {}, {ragdolled: true}), false],
      ['a wall crawler on the wall', actor(11, 10, {climbing: true}, {placesRoot: true}), false],
      ['a wall crawler on the floor', actor(11, 10, {climbing: false}, {placesRoot: true}), true],
      ['a climbing flag on a creature that does not place its own root', actor(11, 10, {climbing: true}), true],
      ['30 m away', actor(10, 40), true],
      ['30.01 m away', actor(10, 40.01), false],
      ['far away', actor(300, 10), false],
    ];
    for (const [name, a, kept] of cases) {
      occ.setBodies([a], eye);
      expect(occ.bodyCount, name).toBe(kept ? 1 : 0);
    }
    // each call lists this frame's characters anew
    occ.setBodies(cases.map(c => c[1]), eye);
    expect(occ.bodyCount).toBe(cases.filter(c => c[2]).length);
    occ.setBodies([], eye);
    expect(occ.bodyCount).toBe(0);
  });

  it('more characters in reach than are kept: the nearest FLASH_BODIES_MAX, whatever their order', () => {
    expect(FLASH_BODIES_MAX).toBe(32);
    let seed = 0x7f4a7c15;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const crowd = Array.from({length: 90}, () => { const r = 0.5 + rnd() * 34, th = rnd() * 2 * Math.PI; return actor(eye.x + r * Math.cos(th), eye.z + r * Math.sin(th)); });
    const d = (a: FlashBodyActor): number => Math.hypot(a.brain.x - eye.x, a.brain.z - eye.z);
    const inReach = crowd.filter(a => d(a) <= FLASH_BODY_REACH);
    expect(inReach.length).toBeGreaterThan(FLASH_BODIES_MAX + 20);
    expect(inReach.length).toBeLessThan(crowd.length);
    const nearest = [...inReach].sort((a, b) => d(a) - d(b)).slice(0, FLASH_BODIES_MAX).map(a => `${Math.fround(a.brain.x)},${Math.fround(a.brain.z)}`).sort();
    const occ = flashOccluders({props: []});
    for (const order of [crowd, [...crowd].reverse(), [...crowd].sort((a, b) => d(b) - d(a)), [...crowd].sort((a, b) => a.brain.x - b.brain.x)]) {
      occ.setBodies(order, eye);
      expect(occ.bodyCount).toBe(FLASH_BODIES_MAX);
      expect(bodiesOf(occ).map(b => `${b[0]},${b[1]}`).sort()).toEqual(nearest);
    }
    expect(occ.bodies).toHaveLength(FLASH_BODIES_MAX * 5);
  });

  it('the game\'s enemies are such characters as they are (a type check: ai/creatureArchetypes.ts EnemyActor)', () => {
    const asBody = (a: EnemyActor): FlashBodyActor => a;
    const list = (occ: StationFlashOccluders, enemies: readonly EnemyActor[]): void => occ.setBodies(enemies, {x: 0, z: 0});
    expect([typeof asBody, typeof list]).toEqual(['function', 'function']);
  });
});

describe('the game\'s wiring', () => {
  const game = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
  const method = (name: string): string => {
    const at = game.search(new RegExp(`^  (?:private |async |\\*)*\\*?${name}\\(`, 'm'));
    expect(at, name).toBeGreaterThan(0);
    const end = game.slice(at + 1).search(/^  \}$/m);
    return game.slice(at, at + 1 + end);
  };

  it('a station\'s occluders are made from its layout right after its prop index, with the train\'s glass — its windows, and the whole car while it moves — and handed to the bounce', () => {
    expect(game).toMatch(/this\.propIndex = new PropIndex\(this\.levels, this\.layout\.props\);\n(?:\s*\/\/.*\n)*\s*this\.beamOccluders = flashOccluders\(this\.layout, box => this\.trainRuntime\.isGlass\(box\) \|\| \(this\.trainRide\.moving && !!this\.trainRuntime\.train\?\.layoutBoxes\.includes\(box\)\)\);\n\s*FLASH_BOUNCE\.occlude\(this\.beamOccluders\);/);
    expect(game.match(/flashOccluders\(/g)).toHaveLength(1);
    expect(game).toMatch(/private beamOccluders: StationFlashOccluders \| null = null;/);
  });

  it('they are dropped with the station (the torn-down station\'s boxes stop nothing), whatever its lighting', () => {
    const leave = method('leaveSection');
    expect(leave).toMatch(/\n    FLASH_BOUNCE\.occlude\(\(this\.beamOccluders = null\)\);/);
    expect(game.match(/FLASH_BOUNCE\.occlude\(/g)).toHaveLength(2);
  });

  it('each frame the characters are listed right before the bounce\'s update — one update a frame, after the flashlight itself is set', () => {
    expect(game).toMatch(/this\.updatePlayerLight\(dt, eye\);.*\n\s*this\.beamOccluders\?\.setBodies\(this\.zombies, eye\);.*\n\s*FLASH_BOUNCE\.update\(dt, this\.flashlight\);/);
    expect(game.match(/FLASH_BOUNCE\.update\(/g)).toHaveLength(1);
    expect(game.match(/\.setBodies\(/g)).toHaveLength(1);
  });

  it('nothing of a save: the occluders import no run / campaign / item / save module, keep nothing but this frame\'s cylinders, and read no clock or random number', () => {
    const src = readFileSync(new URL('../src/world/flashOccluders.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect([...src.matchAll(/from '([^']+)'/g)].map(m => m[1]).sort()).toEqual(['../damage/materials', '../gen/props', '../gen/skyways/stores/hockeyParts', '../gen/storefronts', './flashBounce']);
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|localStorage|sessionStorage/);
    // the layout's boxes are read, never written
    const layout = {props: [prop('column', 1, 1, 0.3, 0.3, 3), prop('shopGlazing', 2, 2, 1, 0.05, 2.4), prop('hkRinkBoard', 4, 4, 1, 0.07, 1.88)]}, before = JSON.stringify(layout);
    const occ = flashOccluders(layout);
    for (const p of layout.props) { occ.stops(p); occ.albedo(p); }
    occ.setBodies([actor(1, 2)], {x: 0, z: 0});
    expect(JSON.stringify(layout)).toBe(before);
  });
});
