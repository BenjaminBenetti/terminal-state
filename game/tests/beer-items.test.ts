// Task studio-market-bar-20261108-225231-01 (lane BEER): THE FIVE BEERS as items — bar stock only (never loot, never generated, never a
// dev drop), the user's prices (20 / 20 / 20 / 20 / 40 ties), a real icon (the 3D render of the bottle; the SVG glyph as its fallback),
// the in-game tooltip with the effect and its duration, and the CODE-BUILT long-neck bottle wearing each beer's OWN Codex label (one
// label atlas: provenance, release rows and the generated rects agree).
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {ITEMS, ITEM_DIMS, effectText, itemDef, useHint} from '../src/items/items';
import {BEERS, BEER_DIMS, BEER_IDS, BEER_RULE_NOTE, beerEffectText, isBeer, isTimedBeer} from '../src/items/beers';
import {econCat, GEAR_WEIGHTS, GLOBAL_POOL, LEGACY_POOL, LIMB_ECONOMY} from '../src/items/lootTables';
import {devGrantBundle} from '../src/items/devGrant';
import {ITEM_CLASS, ITEM_PHYSICS} from '../src/damage/materials';
import {ICONS} from '../src/ui/icons';
import {itemTip, itemTipLines} from '../src/ui/itemTip';
import {baseCents} from '../src/market/trade/value';
import {buyPrice} from '../src/market/trade/stalls';
import {BEER_BOTTLE, BEER_LOOK, beerLabelArc, beerModel, beerModelSource, resetBeerModel, setBeerLabelTexture} from '../src/market/beer/beerModel';
import {BEER_LABEL_ATLAS} from '../src/assets/beerLabels.generated';
import {itemModelSources, itemTemplate} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {generateMarketLevel} from '../src/gen/market/index';

installCanvasShim(false);

const SRC = join(__dirname, '../src'), PUB = join(__dirname, '../public'), ROOT = join(__dirname, '../..');
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('the five beers: bar stock only, the user\'s prices', () => {
  it('ids / names / kinds: consumables you drink, stacks of 6, glass (class / physics), a real icon key (not the cola placeholder)', () => {
    expect(BEER_IDS).toEqual(['beer_lager', 'beer_pilsner', 'beer_stout', 'beer_porter', 'beer_bock']);
    for (const id of BEER_IDS) {
      const d = itemDef(id);
      expect([d.name, d.kind, d.verb, d.stackMax, d.icon]).toEqual([BEERS[id].name, 'consumable', 'drink', 6, 'beer']);
      expect([ITEM_CLASS[id], ITEM_PHYSICS[id].mat, ITEM_PHYSICS[id].shape]).toEqual(['glass', 'glass', 'cylinder']);
      expect(isBeer(id)).toBe(true);
      expect(isTimedBeer(id)).toBe(id !== 'beer_bock');
      expect(d.hunger ?? d.thirst ?? d.heal).toBeUndefined(); // (their effects are the beer system's, committed on the drink)
    }
    expect(ICONS.beer).toMatch(/^<svg/);
  });

  it('20 ties a timed beer, 40 the Bock — in the one value path and at the bar (every stall sells at full value)', () => {
    expect(BEER_IDS.map(id => baseCents(id))).toEqual([2000, 2000, 2000, 2000, 4000]);
    expect(BEER_IDS.map(id => buyPrice({itemId: id}, 1))).toEqual([20, 20, 20, 20, 40]);
    expect(buyPrice({itemId: 'beer_bock'}, 3)).toBe(120);
  });

  it('never loot: no loot category / pool / named table, no generator, no dev drop; a generated market places none', () => {
    for (const id of BEER_IDS) expect(econCat(id), id).toBeNull();
    const rows = [...Object.values(GLOBAL_POOL).flat(), ...Object.values(LEGACY_POOL).flat(), ...LIMB_ECONOMY.pool, ...Object.entries(GEAR_WEIGHTS)];
    expect(rows.some(r => isBeer(r[0] as string))).toBe(false);
    expect(devGrantBundle().some(l => isBeer(l.itemId))).toBe(false);
    const offenders = walk(SRC).filter(f => /[\\/](gen|items[\\/]loot|items[\\/]devGrant)/.test(f) && /beer_(lager|pilsner|stout|porter|bock)|BEER_IDS|BEER_ITEMS|items\/beers/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    const L = generateMarketLevel({levelSeed: 4242});
    expect(L.pickups.some(p => isBeer(p.itemId))).toBe(false);
  });
});

describe('the tooltip / hint: the effect and its duration', () => {
  it('each beer says what it does for how long; timed beers carry the one-at-a-time rule; the Bock is instant', () => {
    expect(BEER_IDS.map(id => beerEffectText(id))).toEqual([
      '+25 % ground speed for 10 min (timed beer)',
      '10 % chance a new find is doubled for 10 min (timed beer)',
      '+5 armour pips for 10 min (timed beer)',
      '25 % harder to detect for 10 min (timed beer)',
      'sets food and water to 200 % · not a timed buff',
    ]);
    const inv = new Inventory();
    const lager = itemTipLines(inv.makeStack('beer_lager', 2));
    expect(lager).toEqual(['+25 % ground speed for 10 min (timed beer)', BEER_RULE_NOTE]);
    expect(itemTip(inv.makeStack('beer_lager', 2)).head).toBe('Express Line Lager ×2');
    expect(itemTipLines(inv.makeStack('beer_bock', 1))).toEqual(['sets food and water to 200 % · not a timed buff']);
    expect(BEER_RULE_NOTE).toMatch(/throw up and replaces it/);
    expect(effectText(itemDef('beer_stout'))).toBe('+5 armour pips for 10 min (timed beer)');
    expect(useHint(itemDef('beer_porter'))).toBe('Click to drink · 25 % harder to detect for 10 min (timed beer)');
    expect(effectText(itemDef('water'))).toBe('+35 water'); // (other items unchanged)
  });
});

describe('the bottle: a code-built long-neck with its beer\'s OWN Codex label', () => {
  it('grounded, centred, inside its ITEM_DIMS (62 mm x 235 mm): glass, label, crown cap; the item template / icon use it', () => {
    resetBeerModel();
    for (const id of BEER_IDS) {
      const o = beerModel(id);
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const d = ITEM_DIMS[id];
      expect(d).toEqual(BEER_DIMS[id]);
      expect(Math.abs(b.min.y)).toBeLessThan(1e-6);
      expect([Math.abs(c.x) < 1e-3, Math.abs(c.z) < 1e-3]).toEqual([true, true]);
      expect(size.y).toBeCloseTo(d.h, 4);
      expect(size.x).toBeLessThanOrEqual(d.w + 0.0011); // (the label band sits 0.4 mm proud of the 62 mm body)
      expect(size.x).toBeGreaterThan(d.w - 0.001);
      expect(o.children.map(m => m.name)).toEqual(['beer-glass', 'beer-label', 'beer-cap']);
      expect(itemTemplate(id).children.length).toBe(3);
      expect(itemModelSources()[id]).toMatch(/^code-built long-neck bottle/);
    }
    expect(new Set(Object.values(BEER_LOOK).map(l => l.glass)).size).toBe(5); // five glass colours
    expect(new Set(Object.values(BEER_LOOK).map(l => l.cap)).size).toBe(5); // five crowns
    expect(BEER_BOTTLE.profile[0][0]).toBe(0);
  });

  it('each label band shows exactly its beer\'s rect of the atlas, the art\'s 3 : 2 wrapped round the front (+Z), left to right', () => {
    resetBeerModel();
    const rects = new Set<string>();
    for (const id of BEER_IDS) {
      const lab = beerModel(id).children[1] as THREE.Mesh, uv = lab.geometry.attributes.uv, pos = lab.geometry.attributes.position;
      const [u0, v0, u1, v1] = BEER_LABEL_ATLAS.rect[id];
      rects.add(BEER_LABEL_ATLAS.rect[id].join(','));
      let umin = 1, umax = 0, vmin = 1, vmax = 0;
      for (let i = 0; i < uv.count; i++) { umin = Math.min(umin, uv.getX(i)); umax = Math.max(umax, uv.getX(i)); vmin = Math.min(vmin, uv.getY(i)); vmax = Math.max(vmax, uv.getY(i)); }
      expect([umin, umax, vmin, vmax].map(v => +v.toFixed(5))).toEqual([u0, u1, v0, v1].map(v => +v.toFixed(5)));
      // the label's middle column faces the front; u grows from -X to +X (not mirrored seen from the front)
      let front = -1, left = -1;
      for (let i = 0; i < pos.count; i++) { if (front < 0 || pos.getZ(i) > pos.getZ(front)) front = i; if (left < 0 || pos.getX(i) < pos.getX(left)) left = i; }
      expect(uv.getX(front)).toBeCloseTo((u0 + u1) / 2, 2);
      expect(uv.getX(left)).toBeLessThan((u0 + u1) / 2);
    }
    expect(rects.size).toBe(5);
    expect(beerLabelArc() * (BEER_BOTTLE.radius + BEER_BOTTLE.label.lift)).toBeCloseTo(BEER_LABEL_ATLAS.aspect * BEER_BOTTLE.label.h, 9);
  });

  it('no label art in code: plain paper until the atlas texture arrives, then the one shared label material maps it', () => {
    resetBeerModel();
    setBeerLabelTexture(null);
    const m = (beerModel('beer_porter').children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect([m.map, m.color.getHex()]).toEqual([null, 0xe8dcc0]);
    expect(beerModelSource()).toMatch(/NOT loaded/);
    const tex = new THREE.Texture();
    setBeerLabelTexture(tex);
    expect([m.map === tex, m.color.getHex()]).toEqual([true, 0xffffff]);
    expect((beerModel('beer_bock').children[1] as THREE.Mesh).material).toBe(m); // one material, one texture for all five
    setBeerLabelTexture(null);
    const model = readFileSync(join(SRC, 'market/beer/beerModel.ts'), 'utf8');
    expect(model).not.toMatch(/getContext|fillText|CanvasTexture|canvasTexture/);
    expect(readFileSync(join(SRC, 'game.ts'), 'utf8')).toMatch(/await preloadBeerLabels\(\);[^\n]*\n\s*registerItemModels\(/);
  });

  it('the label atlas: the Codex provenance (five calls, no prompt text / URLs / local paths), the release rows and the rects agree', () => {
    const jpg = readFileSync(join(PUB, BEER_LABEL_ATLAS.url));
    const provText = readFileSync(join(PUB, 'assets/derivatives/beer-labels.json'), 'utf8'), prov = JSON.parse(provText);
    expect(prov.atlas.sha256).toBe(sha(jpg));
    expect([prov.atlas.bytes, BEER_LABEL_ATLAS.bytes]).toEqual([jpg.length, jpg.length]);
    expect(Object.keys(prov.labels)).toEqual(BEER_IDS);
    for (const id of BEER_IDS) {
      const l = prov.labels[id];
      expect(l.codex.generator).toBe('Codex native image_gen (owned Codex CLI)');
      expect(l.codex.session).toMatch(/^[0-9a-f-]{36}$/);
      expect(l.prompt.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(l.atlasRect.uv).toEqual([...BEER_LABEL_ATLAS.rect[id]]);
    }
    expect(new Set(BEER_IDS.map(id => prov.labels[id].codex.ledgerCall)).size).toBe(5);
    expect(provText).not.toMatch(/https?:|\/home\/|\/workspaces\/|~\/|screen-print|PROMPT/);
    const allow = JSON.parse(readFileSync(join(ROOT, 'tools/release/public-inputs.json'), 'utf8'));
    for (const [rel, buf] of [[BEER_LABEL_ATLAS.url, jpg], ['assets/derivatives/beer-labels.json', Buffer.from(provText)]] as const) {
      const row = allow.files.find((f: {path: string}) => f.path === rel);
      expect(row, rel).toEqual({path: rel, bytes: buf.length, sha256: sha(buf)});
    }
    for (const r of Object.values(BEER_LABEL_ATLAS.rect)) { expect(r[0]).toBeLessThan(r[2]); expect(r[1]).toBeLessThan(r[3]); for (const v of r) expect(v >= 0 && v <= 1).toBe(true); }
    expect(ITEMS.beer_lager).toBeDefined();
  });
});
