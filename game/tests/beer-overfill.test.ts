// Task studio-market-bar-20261108-225231-01 (lane BEER): SECOND SUPPER BOCK's OVERFILL — "Food/water beer sets both to 200%, 40 ties;
// overlapping green overfill bar". Survival.overfill SETS food AND water to 200 (not +200); the limits become 0..200 for food / water only;
// the overfill drains at the normal 8x rate with no expiry; ordinary food / drink keep their cap of 100 but never TRUNCATE an overfill;
// the empty 5 % max-HP / pain rules are unchanged; saves / snapshots / import validate 0..200. The HUD: a green band overlapping the full
// bar for the part above 100 (the base bar still visible), the temporary armour pips, the active beer's row.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {EMPTY_MAX_HP_PER_MIN, HUNGER_DRAIN, SURVIVAL_MAX, SURVIVAL_OVERFILL, Survival, THIRST_DRAIN} from '../src/player/survival';
import {itemDef} from '../src/items/items';
import {restoreCarry, takeSnapshot} from '../src/run/snapshot';
import {makeSaveFile, restoreRun, saveFileText} from '../src/save/serialize';
import {validateSaveFile} from '../src/save/validate';
import {Harness} from './helpers/saveFixture';
import {FakeEl, installFakeDom, type FakeDom} from './helpers/fakeDom';

describe('the Bock SETS food and water to 200; the overfill drains normally and never expires', () => {
  it('set, not add — from any level; never above 200', () => {
    const s = new Survival();
    s.hunger = 12; s.thirst = 151;
    expect(s.overfill()).toEqual({hunger: 188, thirst: 49});
    expect([s.hunger, s.thirst, SURVIVAL_OVERFILL]).toEqual([200, 200, 200]);
    expect(s.overfill()).toEqual({hunger: 0, thirst: 0});
    expect(s.overfill(500)).toEqual({hunger: 0, thirst: 0}); // never above the ceiling
  });

  it('drains at the current 8x metabolism from 200 — still overfilled after 10 minutes (no expiry), then down to the normal range', () => {
    const s = new Survival();
    s.overfill();
    for (let i = 0; i < 600; i++) s.update(1);
    expect(s.hunger).toBeCloseTo(200 - 600 * HUNGER_DRAIN, 6);
    expect(s.thirst).toBeCloseTo(200 - 600 * THIRST_DRAIN, 6);
    expect(s.hunger).toBeGreaterThan(SURVIVAL_MAX);
    const r = s.update(10000);
    expect([s.hunger, s.thirst]).toEqual([0, 0]);
    expect(r.warnings.length).toBeGreaterThan(0); // the ordinary warnings on the way down
  });

  it('ordinary food / drink: capped at 100, but an overfill is never truncated; a drain item (salty chips) still drains', () => {
    const s = new Survival();
    s.hunger = 80; s.thirst = 80;
    expect(s.consume(itemDef('water'))).toEqual({hunger: 0, thirst: 20}); // 80 + 35 -> 100
    s.thirst = 180;
    expect(s.consume(itemDef('water'))).toEqual({hunger: 0, thirst: 0});
    expect(s.thirst).toBe(180);
    s.hunger = 150;
    expect(s.consume(itemDef('chips'))).toEqual({hunger: 0, thirst: -4});
    expect([s.hunger, s.thirst]).toEqual([150, 176]);
    s.hunger = 99; // below the cap: fills to 100 only
    s.consume(itemDef('beans'));
    expect(s.hunger).toBe(100);
    expect(s.blockReason(itemDef('water'), 50, 100)).toBe("You're not thirsty"); // (at 176: as at a full 100)
  });

  it('the empty rule is unchanged: at 0 the player loses 5 % of max HP per active minute and grunts', () => {
    const s = new Survival();
    s.overfill();
    s.thirst = 0;
    const r = s.update(60, 100);
    expect(r.hpLoss).toBeCloseTo(100 * EMPTY_MAX_HP_PER_MIN, 9);
    expect(r.pain).toBe(true);
  });
});

describe('saves: food / water validate 0..200 (carry, Retry snapshot, import / export); vitals stay 0..100', () => {
  it('an overfilled run saves, imports and loads exactly; the Retry snapshot keeps it', () => {
    const h = new Harness();
    h.survival.overfill();
    h.survival.update(37.5);
    const [hu, th] = [h.survival.hunger, h.survival.thirst];
    h.takeEntry();
    h.survival.hunger = 120.25;
    const v = validateSaveFile(JSON.parse(saveFileText(h.file('arrival'))));
    expect(v.ok).toBe(true);
    const b = new Harness();
    if (v.ok) restoreRun(v.value.run, b.target());
    expect([b.survival.hunger, b.survival.thirst]).toEqual([120.25, th]);
    const live = new Survival();
    restoreCarry(h.run.entry!, {player: {hp: 0, stamina: 0, damageTaken: 0}, survival: live, battery: {charge: 0, on: false, died: false}, stats: {}});
    expect([live.hunger, live.thirst]).toEqual([hu, th]);
    const snap = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'}}, {inv: h.inv, player: h.player, survival: h.survival, battery: h.battery, participants: [], stats: {}}, {});
    expect(snap.survival.hunger).toBe(120.25);
  });

  it('200 is legal, above 200 / below 0 is refused (carry and entry); health above 100 is still refused', () => {
    const h = new Harness();
    h.takeEntry();
    const file = h.file('arrival');
    const check = (f: (run: {carry: {survival: {hunger: number; thirst: number}; vitals: {hp: number}}; entry: {survival: {thirst: number}}}) => void) => {
      const run = structuredClone(file.run) as never;
      f(run);
      return validateSaveFile(makeSaveFile(run, file.meta)).ok;
    };
    expect(check(r => { r.carry.survival.hunger = 200; r.carry.survival.thirst = 200; r.entry.survival.thirst = 200; })).toBe(true);
    expect(check(r => { r.carry.survival.hunger = 200.01; })).toBe(false);
    expect(check(r => { r.entry.survival.thirst = 200.5; })).toBe(false);
    expect(check(r => { r.carry.survival.thirst = -0.5; })).toBe(false);
    expect(check(r => { r.carry.vitals.hp = 150; })).toBe(false);
  });
});

describe('HUD: the green overfill band, the temporary armour pips, the active beer row', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('food at 180: the base bar full, a green band 80 % wide over it, the percentage green; back under 100 the band goes', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud() as unknown as {survival(k: 'food' | 'water', v: number): void};
    const row = dom.el('#surv-food');
    hud.survival('food', 180);
    expect(dom.el('.fill').style.width).toBe('100%');
    expect(dom.el('.bar .over').style.width).toBe('80%');
    expect(row.classList.contains('overfill')).toBe(true);
    expect(dom.el('.pct').textContent).toBe('180%');
    hud.survival('food', 92);
    expect(dom.el('.bar .over').style.width).toBe('0%');
    expect([row.classList.contains('overfill'), dom.el('.fill').style.width]).toEqual([false, '92%']);
    const {readFileSync} = await import('node:fs');
    const css = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(css).toMatch(/#vitals \.surv \.bar \.over \{ position: absolute; left: 0; top: 0; height: 55%;[^}]*background: #5ccf5f;/); // green, the top half: the base bar shows beneath
  });

  it('the Stout\'s 5 pips sit on top of the worn ones, marked temporary; capped, only its share shows', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const bar = dom.el('#vitals .bar.health');
    bar.parent = new FakeEl('div');
    const el = dom.el('#armor-pips');
    hud.setArmor(0.1, 0.125); // a vest (4 pips) + the Stout (5)
    expect((el.innerHTML.match(/<i><\/i>/g) ?? []).length).toBe(4);
    expect((el.innerHTML.match(/<i class="temp"><\/i>/g) ?? []).length).toBe(5);
    expect(el.title).toMatch(/Armor 9 pips \(22\.5 %\).* — 5 of them temporary \(Ironclad Stout\)/);
    hud.setArmor(0.75, 0.125); // capped at 80 %: 2 of the Stout's pips fit
    expect((el.innerHTML.match(/class="temp"/g) ?? []).length).toBe(2);
    hud.setArmor(0, 0.125); // naked: all five temporary
    expect((el.innerHTML.match(/class="temp"/g) ?? []).length).toBe(5);
    hud.setArmor(0.125); // no beer: the established pips, no temp class
    expect(el.innerHTML).not.toMatch(/temp/);
  });

  it('the active beer row: short name, effect, m:ss left (written once a second); hidden without one', async () => {
    const {Hud, beerClock} = await import('../src/ui/hud');
    const hud = new Hud();
    const tag = dom.el('#beer-tag');
    hud.setBeer({itemId: 'beer_lager', remaining: 581.2});
    expect([dom.el('.name').textContent, dom.el('.fx').textContent, dom.el('.left').textContent]).toEqual(['LAGER', '+25% SPEED', '9:42']);
    expect(tag.classList.contains('none')).toBe(false);
    expect(tag.title).toMatch(/^Express Line Lager: \+25% SPEED for 9:42 more/);
    hud.setBeer({itemId: 'beer_stout', remaining: 59.01});
    expect([dom.el('.name').textContent, dom.el('.fx').textContent, dom.el('.left').textContent]).toEqual(['STOUT', '+5 ARMOR', '1:00']);
    hud.setBeer({itemId: 'beer_porter', remaining: 3});
    expect(dom.el('.fx').textContent).toBe('25% HIDDEN');
    hud.setBeer(null);
    expect(tag.classList.contains('none')).toBe(true);
    expect([beerClock(600), beerClock(0.2), beerClock(-1)]).toEqual(['10:00', '0:01', '0:00']);
  });
});
