// DOM heads-up display. Writes only when values change.

import {ICONS, LIGHT_ICONS, STAT_ICONS} from './icons';
import {itemIconHtml, itemIconsVersion} from './itemIcons';
import {itemDef} from '../items/items';
import {meleeDefOf} from '../weapons/weapons'; // lane KNIFE
import type {Inventory} from '../items/inventory';
import {AIRTANK_AIR_S, FILTER_LIFE_S, GEAR_SLOTS, isAirtank} from '../items/gear';
import {GEAR_ICONS} from './gearIcons';
import {ensureGearStyles} from './gearStyles';
import {CRITICAL, LOW} from '../player/survival';
import type {LimbInjury} from '../player/injuries'; // Iteration 16 (lane INJURY)
import type {MaskHudView} from '../gear/gasMask'; // task gasmask-breach-20261030 (mask lane)
import type {FuelHudView} from '../world/fuelPort'; // task train-fuel-system (lane PORT)
import {FUEL} from '../fuel/fuel'; // task studio-general-armor-20261107-231448-01 (the tank's pip row: one group per tank)
import {ARMOR, displayHalfPips, pipRows, pipsText, tempHalfPips} from '../player/armor'; // task studio-general-armor-20261107-231448-01 (the armour pips)
import {SURVIVAL_MAX} from '../player/survival';
import {BEERS, BEER_TUNING, isBeer} from '../items/beers'; // task studio-market-bar-20261108-225231-01 (lane BEER)

// Task studio-market-bar-20261108-225231-01 (lane BEER), kept apart from the armour / vitals styles above (small, additive):
//  - the OVERFILL of food / water (Second Supper Bock, up to 200 %): a GREEN band overlapping the top of the full bar for the part above
//    100 (its width = overfill / 100 of the bar), the base bar still showing beneath it; the percentage reads green;
//  - the TEMPORARY armour pips (Ironclad Stout, HudState.armorTemp): the top-most pips of the effective pool get the class `temp` (a pale
//    blue, the same pip shape); its glow 2 px = 4 px x ARMOR_PIP_SCALE, the half-size pips: task studio-armor-pip-half-size-20261110-022206-01);
//  - the ACTIVE timed beer: a compact row under the water bar — the beer's short name, its effect and the minutes : seconds left.
const BEER_CSS = `
#vitals .surv .bar { position: relative; }
#vitals .surv .bar .over { position: absolute; left: 0; top: 0; height: 55%; width: 0; background: #5ccf5f; box-shadow: 0 0 4px rgba(92, 207, 95, 0.65); transition: width 0.7s ease-out; pointer-events: none; }
#vitals .surv.overfill .pct { color: #7fe081; }
#armor-pips i.temp { background: #a9dcff; border-color: #24496e; box-shadow: 0 0 2px rgba(169, 220, 255, 0.7); }
#vitals #beer-tag { margin-top: 5px; font-size: 10.5px; letter-spacing: 0.12em; white-space: nowrap; color: #e6b65c; }
#vitals #beer-tag.none { display: none; }
#beer-tag .tag { display: flex; justify-content: center; color: #e6b65c; }
#beer-tag .tag svg { width: 26px; height: 13px; }
#beer-tag .fx { color: var(--cream-dim); letter-spacing: 0.06em; }
#beer-tag .left { margin-left: auto; color: var(--cream); font-variant-numeric: tabular-nums; }`;
const ensureBeerCss = (): void => {
  if (typeof document === 'undefined' || document.querySelector('#beer-css')) return;
  const st = document.createElement('style');
  st.id = 'beer-css';
  st.textContent = BEER_CSS;
  document.head.appendChild(st);
};
/** (lane BEER) "9:41". */
export const beerClock = (s: number): string => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** (lane BEER) The beer row's short effect. */
const BEER_FX: Readonly<Record<string, string>> = {
  speed: `+${Math.round((BEER_TUNING.speedMult - 1) * 100)}% SPEED`, pickup: 'LUCKY FINDS',
  armor: `+${Math.round(BEER_TUNING.tempArmor / ARMOR.pip)} ARMOR`, stealth: `${Math.round((1 - BEER_TUNING.perceptionMult) * 100)}% HIDDEN`,
};

// task studio-general-armor-20261107-231448-01: the ARMOUR pips — blue pips just above the health bar, as wide as it (ten pips a row = 25 %), in half-pip steps
// rounded down (player/armor.ts pipRows). A row past ten stacks on top of the one below, overlapping it by ARMOR.rowOverlap of its
// height; the HP row's top margin grows with the rows so nothing above the vitals is covered. No pips with no armour.
// Task studio-cosplay-general-20261108-225231-01 (user: "Armor pips should be circles, not squares."): each pip is a true CIRCLE (1:1,
// border-radius 50 %) as wide as its column — ten columns + nine gaps span exactly the health bar's (border-box) width — and a half pip
// is the same circle filled on its left half. Rows stack upward (flex column-reverse), each further row overlapping the one below by
// ARMOR.rowOverlap of a pip's height (a negative margin in % of the row width: a pip's diameter is (width - gaps) / ten). Presentation
// only: the counts are still pipRows(pool) (player/armor.ts), unchanged.
// Task studio-armor-pip-half-size-20261110-022206-01 (user: "the pips are simply to large. make them half as big"): every pip is HALF
// its previous width and height (ARMOR_PIP_SCALE): the row is half the bar's border-box width, anchored at the bar's left edge, with the
// column gap, the gap over the bar, the rim and the glow halved too, so ten circles + nine gaps still fill the row exactly and a wrapped
// row still overlaps by ARMOR.rowOverlap of a (now smaller) pip. The HP row reserves only the smaller stack. Counts / maths unchanged.
export const ARMOR_PIP_SCALE = 0.5;
/** The stack's offset above the bar's padding box: its 1 px border + the visible gap (2 px before, now 1 px); the column gap 2 -> 1 px. */
export const ARMOR_PIP_GAP = 1 + 2 * ARMOR_PIP_SCALE, ARMOR_PIP_COL_GAP = 2 * ARMOR_PIP_SCALE;
/** The HP row's fixed number width (styles.css `#hp-num { width: 34px }`): the bar = the row less the tag, two gaps and this. */
export const ARMOR_HP_NUM_W = 34;
/** CSS length of one pip's diameter inside #armor-pips (`100%` = the row width = ARMOR_PIP_SCALE x the health bar's border box). */
const PIP_D = `(100% - ${(ARMOR.pipsPerRow - 1) * ARMOR_PIP_COL_GAP}px) / ${ARMOR.pipsPerRow}`;
/** The HP row's top margin for `rows` pip rows: its own 6 px + the gap + the stack (one pip + (rows - 1) x (1 - overlap) pips). The
 * pip size follows the BAR's width, which the row's margin cannot reference: it is #vitals' width less the row's HP tag (20 px), two
 * 8 px gaps and the fixed 34 px HP number (styles.css), so the reserve fits the stack (no empty band over the smaller pips). */
export const armorRowMargin = (rows: number) => `calc(${6 + ARMOR_PIP_GAP}px + ${1 + (rows - 1) * (1 - ARMOR.rowOverlap)} * (${ARMOR_PIP_SCALE} * (100% - ${20 + 2 * 8 + ARMOR_HP_NUM_W}px) - ${(ARMOR.pipsPerRow - 1) * ARMOR_PIP_COL_GAP}px) / ${ARMOR.pipsPerRow})`;
/** The pip rows' markup (pipRows: bottom row first): one `.arow` per row, an `<i>` per pip, `<i class="half">` for a half pip. */
export const armorPipsHtml = (rows: readonly (readonly ('full' | 'half')[])[],
  cls: (p: 'full' | 'half', index: number) => string = p => (p === 'half' ? 'half' : '')): string =>
  rows.map((r, k) => `<div class="arow">${r.map((p, j) => { const c = cls(p, k * ARMOR.pipsPerRow + j); return c ? `<i class="${c}"></i>` : '<i></i>'; }).join('')}</div>`).join('');
export const ARMOR_CSS = `
#vitals .bar.health { position: relative; }
#armor-pips { position: absolute; left: -1px; width: calc((100% + 2px) * ${ARMOR_PIP_SCALE}); bottom: calc(100% + ${ARMOR_PIP_GAP}px); display: flex; flex-direction: column-reverse; pointer-events: none; }
#armor-pips.none { display: none; }
#armor-pips .arow { display: grid; grid-template-columns: repeat(${ARMOR.pipsPerRow}, 1fr); column-gap: ${ARMOR_PIP_COL_GAP}px; }
#armor-pips .arow + .arow { margin-bottom: calc(-${ARMOR.rowOverlap} * ${PIP_D}); }
#armor-pips i { display: block; width: 100%; aspect-ratio: 1 / 1; border-radius: 50%; box-sizing: border-box; background: #3d8fe0; border: ${ARMOR_PIP_SCALE}px solid #0d1d30; box-shadow: 0 0 ${3 * ARMOR_PIP_SCALE}px rgba(61, 143, 224, 0.45); }
#armor-pips i.half { background: linear-gradient(90deg, #3d8fe0 50%, rgba(13, 29, 48, 0.6) 50%); }
#armor-pips i.half.temp { background: linear-gradient(90deg, #a9dcff 50%, rgba(13, 29, 48, 0.6) 50%); }`;

// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train FUEL readout — a row at the top of the light panel in the
// battery meter's style (icon, label, four quarter pips per tank like the battery bar's cells, cream text; amber when the train cannot
// make one hop). Built on first use (no index.html markup), written only when what it shows changes (world/fuelPort.ts decides when it
// shows). Task gameplay-feedback-20261111 (lane TRAVEL): the four-tank train's sixteen pips are narrower (5 px, 1 px apart) so the row
// stays about as wide as the two-tank row was (~140 px).
const FUEL_CSS = `
#fuel-tag.none { display: none; }
#fuel-tag .pips { display: flex; gap: 1px; }
#fuel-tag .pips i { width: 5px; height: 7px; background: #111315; border: 1px solid #3a3f44; }
#fuel-tag .pips i.on { background: var(--cream); }
#fuel-tag .pips i.gap { margin-left: 4px; }
#fuel-tag .txt { color: var(--cream); white-space: nowrap; }
#fuel-tag.low .pips i.on { background: var(--mustard); }
#fuel-tag.low .txt, #fuel-tag.low .ico { color: var(--mustard); }`;

// Iteration 16 (lane INJURY): limb indicator — a row of the vitals (shown only while injured, so the healthy HUD is unchanged):
// a small body silhouette (seen from behind: your left on the left) with the injured arm / leg in red, and short labels.
// Built here (no index.html markup needed); styles injected once.
const LIMB_CSS = `
#vitals #limbs { margin-top: 5px; font-size: 10.5px; letter-spacing: 0.12em; white-space: nowrap; }
#vitals #limbs.none { display: none; }
#limbs .tag { display: flex; justify-content: center; }
#limbs svg { width: 12px; height: 22px; }
#limbs svg .p { fill: rgba(185, 177, 156, 0.45); }
#limbs svg .p.hurt { fill: var(--red); }
#limbs .txt { display: flex; gap: 14px; }
#limbs .txt span { display: none; color: var(--red); }
#limbs .txt span.on { display: inline; }
#limbs .txt small { color: var(--cream-dim); font-size: 10px; letter-spacing: 0.06em; margin-left: 3px; }`;
const LIMB_SVG = `<svg viewBox="0 0 20 38" aria-hidden="true"><circle class="p" cx="10" cy="4" r="3.4"/><rect class="p" x="6.4" y="8.3" width="7.2" height="12.4" rx="1.6"/>`
  + `<rect class="p arm-left" x="2.3" y="8.8" width="3.3" height="11.6" rx="1.6"/><rect class="p arm-right" x="14.4" y="8.8" width="3.3" height="11.6" rx="1.6"/>`
  + `<rect class="p leg-left" x="6.4" y="21.4" width="3.4" height="16" rx="1.6"/><rect class="p leg-right" x="10.2" y="21.4" width="3.4" height="16" rx="1.6"/></svg>`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Lane KNIFE: melee weapon held — #ammo shows a compact MELEE tag (no magazine / separator / reserve). */
const MELEE_CSS = `
#ammo.melee { font-size: 22px; letter-spacing: 0.22em; line-height: 1.6; }
#ammo.melee .sep, #ammo.melee #reserve { display: none; }`;
/** Task office-overhaul-20261030 (lane INTERACT): the worn backpack's gear slot index (HUD slot "6"). */
const BACK = GEAR_SLOTS.indexOf('backpack');
/** Task gasmask-breach-20261030 (mask lane): the gas mask's gear slot index (HUD cell "Q", left of quick slot 1). */
const MASK = GEAR_SLOTS.indexOf('mask');
/** Crosshair hold ring (E held on a grounded bag): circumference of the r=13 progress circle. */
const RING_C = 2 * Math.PI * 13;

export interface HudState {
  hp: number;
  maxHp: number;
  stamina: number;
  weaponName: string;
  mag: number | null;
  reserve: number;
  /** Lane KNIFE: a melee weapon is held — the ammo counter shows MELEE instead of rounds (no magazine / reserve). */
  melee?: boolean;
  hint: string;
  prompt: string;
  /** Item id shown as a 3D icon in front of the prompt (aimed floor pickup). */
  promptItem?: string;
  remaining: number;
  /** (campaign foundation) the objective's second line; undefined = the legacy infected count. */
  objLine?: string;
  total: number;
  area: string;
  spreadPx: number;
  aiming: boolean;
  flashlight: boolean;
  use: {label: string; progress: number} | null;
  /** Survival fullness 0-100 (FOOD = hunger, WATER = thirst); bars hidden when omitted. (lane BEER: up to 200 — the green overfill.) */
  food?: number;
  water?: number;
  /** Iteration 12 (LIGHT): flashlight battery (charge 0..1, light switched on, flicker amount 0..1, spare batteries carried). */
  battery?: {charge: number; on: boolean; flicker: number; spares: number};
  /** Iteration 12 (LIGHT): flares carried (grenade slot; G since task office-overhaul-20261030) and burning in the world. */
  flares?: {count: number; burning: number};
  /** (task studio-general-armor-20261107-231448-01) The worn armour pool (player/armor.ts armorPool): the blue pips above the health bar. */
  armor?: number;
  /**
   * Task studio-market-bar-20261108-225231-01 (lane BEER): the TEMPORARY armour (Ironclad Stout: 0.125 = 5 pips; Game.beerEffects.tempArmor()).
   * The pips then show the EFFECTIVE pool min(ARMOR.cap, armor + armorTemp) — what an enemy hit meets (player/armor.ts armorPool(worn,
   * temp)) — and its temporary share (the top-most pips; class `temp`) distinguishably. `armor` stays the worn pool.
   */
  armorTemp?: number;
  /** (lane BEER) The active timed beer (Game.beerEffects.active): its name / effect and the active seconds left; null = none. */
  beer?: {itemId: string; remaining: number} | null;
}

export class Hud {
  private readonly cache = new Map<string, string>();
  private hotbarVersion = -1;
  private readonly root = $('#hud');
  private readonly survShown: Record<'food' | 'water', number> = {food: -1, water: -1};
  /** Task office-overhaul-20261030 (INTERACT, #1): the worn backpack is in the hands (6): HUD slot 6 is the selected one. */
  private bagSelected = false;
  private ring: SVGCircleElement | null = null;
  private ringWrap: HTMLElement | null = null;
  private ringShown = -1;
  /** Task gasmask-breach-20261030 (mask lane): the gas mask's live face state (gear/gasMask.ts, every frame); null = off. */
  private mask: MaskHudView | null = null;

  constructor() {
    for (const k of ['food', 'water'] as const) {
      const ico = document.querySelector(`#surv-${k} .ico`);
      if (ico) ico.innerHTML = STAT_ICONS[k];
    }
    // Iteration 12 (LIGHT): light panel icons
    for (const [sel, svg] of [['#battery .ico', LIGHT_ICONS.battery], ['#flare-tag .ico', LIGHT_ICONS.flare]] as const) {
      const ico = document.querySelector(sel);
      if (ico) ico.innerHTML = svg;
    }
    this.buildLimbs(); // Iteration 16 (lane INJURY)
    if (!document.querySelector('#melee-css')) { // lane KNIFE: the MELEE tag in the ammo counter's place
      const st = document.createElement('style');
      st.id = 'melee-css';
      st.textContent = MELEE_CSS;
      document.head.appendChild(st);
    }
  }

  /** Iteration 16 (lane INJURY): the limb indicator row (last row of #vitals) and its styles. */
  private buildLimbs(): void {
    const vitals = document.querySelector('#vitals');
    if (!vitals || document.querySelector('#limbs')) return;
    if (!document.querySelector('#limbs-css')) {
      const st = document.createElement('style');
      st.id = 'limbs-css';
      st.textContent = LIMB_CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'limbs';
    el.className = 'row none';
    el.title = 'Limbs OK — no arm or leg injuries';
    el.innerHTML = `<span class="tag">${LIMB_SVG}</span><span class="txt"><span class="arm"></span><span class="leg"></span></span>`;
    vitals.appendChild(el);
  }

  /**
   * (task studio-general-armor-20261107-231448-01) The armour pips above the health bar (written only when the shown half-pip count changes).
   * Task studio-market-bar-20261108-225231-01 (lane BEER): `temp` = the temporary armour (Ironclad Stout). The pips show the EFFECTIVE pool
   * min(ARMOR.cap, pool + temp) (`pool` = the worn pool, as before); the top-most pips holding any of its temporary half pips (its share
   * under the cap: tempHalfPips) get the class `temp` (same shape, pale blue).
   */
  setArmor(worn: number, temp = 0): void {
    const pool = Math.min(ARMOR.cap, worn + (temp > 0 ? temp : 0)), share = pool - Math.min(worn, pool); // (lane BEER) the effective pool, temp's share in it
    const rows = pipRows(pool), keep = displayHalfPips(pool) - tempHalfPips(pool, share); // (lane BEER) the half pips that are worn armour
    const cls = (p: 'full' | 'half', i: number) => [p === 'half' ? 'half' : '', 2 * i + (p === 'half' ? 0 : 1) >= keep ? 'temp' : ''].filter(Boolean).join(' ');
    if (temp > 0) ensureBeerCss();
    this.set('armor', `${rows.map(r => r.join(',')).join('|')}#${keep}`, () => {
      const bar = document.querySelector('#vitals .bar.health') as HTMLElement | null;
      if (!bar) return;
      if (!document.querySelector('#armor-css')) {
        const st = document.createElement('style');
        st.id = 'armor-css';
        st.textContent = ARMOR_CSS;
        document.head.appendChild(st);
      }
      let el = document.querySelector('#armor-pips') as HTMLElement | null;
      if (!el) {
        el = document.createElement('div');
        el.id = 'armor-pips';
        bar.appendChild(el);
      }
      // (rows bottom first; ARMOR_CSS lays them out: circles, overlap, the bar's width; lane BEER's `temp` class on the temporary share)
      el.innerHTML = armorPipsHtml(rows, cls);
      el.classList.toggle('none', !rows.length);
      el.title = rows.length ? `Armor ${pipsText(pool)} pips (${+(pool * 100).toFixed(1)} %): cuts every enemy hit and may save you from its injury${share > 0 ? ` — ${pipsText(share)} of them temporary (Ironclad Stout)` : ''}` : '';
      const row = bar.parentElement as HTMLElement | null;
      if (row) row.style.marginTop = rows.length ? armorRowMargin(rows.length) : '';
    });
  }

  /**
   * Task studio-market-bar-20261108-225231-01 (lane BEER): the active timed beer — a compact row under the water bar (built on first use):
   * the beer's short name, its effect, the time left (m:ss, written once a second); hidden without one.
   */
  setBeer(b: {itemId: string; remaining: number} | null): void {
    const on = !!b && isBeer(b.itemId) && b.remaining > 0;
    this.set('beer', on ? `${b!.itemId}|${beerClock(b!.remaining)}` : '', () => {
      if (typeof document === 'undefined') return;
      let el = document.querySelector('#beer-tag') as HTMLElement | null;
      if (!el && !on) return;
      if (!el) {
        const water = document.querySelector('#surv-water');
        if (!water?.parentElement) return;
        ensureBeerCss();
        el = document.createElement('div');
        el.id = 'beer-tag';
        el.className = 'row none';
        el.innerHTML = `<span class="tag">${ICONS.beer}</span><span class="name"></span><span class="fx"></span><span class="left"></span>`;
        water.insertAdjacentElement('afterend', el);
      }
      el.classList.toggle('none', !on);
      if (!on || !isBeer(b!.itemId)) return;
      const spec = BEERS[b!.itemId];
      el.querySelector('.name')!.textContent = spec.short.toUpperCase();
      el.querySelector('.fx')!.textContent = BEER_FX[spec.effect] ?? '';
      el.querySelector('.left')!.textContent = beerClock(b!.remaining);
      el.title = `${spec.name}: ${BEER_FX[spec.effect] ?? ''} for ${beerClock(b!.remaining)} more (active play). Another timed beer makes you throw up and replaces it.`;
    });
  }

  /**
   * Iteration 16 (lane INJURY): show the injured arm / leg (player/injuries.ts; called every frame by its frame hook, writes only
   * on change). A new injury flashes the silhouette.
   */
  setLimbs(arm: LimbInjury | null, leg: LimbInjury | null, tip: string): void {
    const key = `${arm?.side ?? '-'}|${leg?.side ?? '-'}`;
    const before = this.cache.get('limbs');
    this.set('limbs', key, () => {
      const el = document.querySelector('#limbs') as HTMLElement | null;
      if (!el) return;
      el.title = tip;
      for (const side of ['left', 'right'] as const) {
        el.querySelector(`.arm-${side}`)?.classList.toggle('hurt', arm?.side === side);
        el.querySelector(`.leg-${side}`)?.classList.toggle('hurt', leg?.side === side);
      }
      for (const [cls, inj, what, fx] of [['arm', arm, 'ARM', 'aim sway'], ['leg', leg, 'LEG', 'limping']] as const) {
        const span = el.querySelector(`.txt .${cls}`);
        if (!span) continue;
        span.classList.toggle('on', !!inj);
        if (inj) span.innerHTML = `${inj.side === 'left' ? 'L' : 'R'} ${what}<small>${fx}</small>`;
      }
      el.classList.toggle('none', !arm && !leg);
      const was = before?.split('|') ?? ['-', '-'];
      if (before !== undefined && ((arm && was[0] === '-') || (leg && was[1] === '-'))) {
        el.animate?.([{filter: 'brightness(2.4)'}, {filter: 'brightness(1)'}], {duration: 1100, easing: 'ease-out'});
      }
    });
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  private set(key: string, value: string, apply: (v: string) => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply(value);
  }

  update(s: HudState, inv: Inventory): void {
    const hpFrac = Math.max(0, s.hp / s.maxHp);
    this.set('hp', String(Math.ceil(s.hp)), v => { $('#hp-num').textContent = v; $<HTMLElement>('#vitals .health .fill').style.width = `${hpFrac * 100}%`; $('#vitals .health').classList.toggle('low', hpFrac < 0.3); $('#vignette').classList.toggle('low', hpFrac < 0.3); });
    this.setArmor(s.armor ?? 0, s.armorTemp ?? 0); // task studio-general-armor-20261107-231448-01 (+ lane BEER: the temporary share)
    this.setBeer(s.beer ?? null); // (lane BEER) the active timed beer
    this.set('st', s.stamina.toFixed(0), v => { $<HTMLElement>('#vitals .stam .fill').style.width = `${v}%`; });
    this.set('wn', s.weaponName, v => { $('#weapon-name').textContent = v; });
    this.set('mag', s.melee ? 'melee' : s.mag === null ? '' : `${s.mag}|${s.reserve}`, v => {
      const ammo = $('#ammo');
      ammo.style.visibility = v ? 'visible' : 'hidden';
      ammo.classList.toggle('melee', v === 'melee'); // lane KNIFE: "MELEE" in place of the rounds counter
      if (v === 'melee') { $('#mag').textContent = 'MELEE'; $('#reserve').textContent = ''; ammo.classList.remove('empty'); }
      else if (v) { const [m, r] = v.split('|'); $('#mag').textContent = m; $('#reserve').textContent = r; ammo.classList.toggle('empty', m === '0'); }
    });
    this.set('hint', s.hint, v => { $('#weapon-hint').textContent = v; });
    this.set('prompt', `${s.prompt}|${s.prompt && s.promptItem ? s.promptItem : ''}|${itemIconsVersion()}`, () => {
      $('#prompt').innerHTML = s.prompt ? `${s.promptItem ? itemIconHtml(s.promptItem, 'pi') : ''}${s.prompt}` : '';
    });
    // (campaign foundation) an explicit objective line wins (the scavenge objective has none); else the legacy infected count
    this.set('obj', s.objLine !== undefined ? `line:${s.objLine}` : `${s.remaining}/${s.total}`, () => {
      $('#obj-count').textContent = s.objLine !== undefined ? s.objLine : s.remaining > 0 ? `${s.remaining} of ${s.total} infected remain` : 'All infected down — station clear';
    });
    this.set('area', s.area, v => { $('#area-name').textContent = v; });
    this.set('spread', `${Math.round(s.spreadPx)}|${s.aiming}`, () => {
      const ch = $('#crosshair');
      ch.style.setProperty('--gap', `${Math.max(3, Math.min(60, s.spreadPx))}px`);
      ch.classList.toggle('aim', s.aiming);
    });
    // Iteration 12 (LIGHT): the tag also tells a flat / flickering battery apart
    const flat = !!s.battery && s.battery.charge <= 0;
    this.set('fl', flat ? 'LIGHT DEAD · NEEDS BATTERY' : s.flashlight ? (s.battery && s.battery.flicker > 0 ? 'LIGHT FLICKERING · F' : 'LIGHT ON · F') : 'LIGHT OFF · F', v => { $('#flashlight-tag').textContent = v; });
    if (s.battery) this.batteryMeter(s.battery);
    if (s.flares) {
      const f = s.flares;
      this.set('flares', `${f.count}|${f.burning}`, () => {
        const el = document.querySelector('#flare-tag') as HTMLElement | null;
        if (!el) return;
        el.classList.toggle('none', f.count === 0);
        el.querySelector('.n')!.textContent = `${f.count}`;
        el.querySelector('.lit')!.textContent = f.burning ? ` · ${f.burning} lit` : '';
      });
    }
    this.set('use', s.use ? `${s.use.label}|${s.use.progress.toFixed(2)}` : '', v => {
      const bar = $('#usebar');
      bar.classList.toggle('show', !!v);
      if (s.use) { bar.querySelector('.label')!.textContent = s.use.label; (bar.querySelector('.fill') as HTMLElement).style.width = `${s.use.progress * 100}%`; }
    });
    this.survival('food', s.food);
    this.survival('water', s.water);
    const hv = inv.version * 64 + itemIconsVersion();
    if (hv !== this.hotbarVersion) {
      this.hotbarVersion = hv;
      // Per-slot redraw (the version bumps on every shot): only slots whose content changed are rebuilt.
      // data-bar/data-index make these slots drop targets while the inventory is open (inventoryUI.ts).
      // Task office-overhaul-20261030 (lane INTERACT): after quick slots 1-5 come slot "6" (the worn backpack: 6 takes it into the
      // hands, click sets it down) and slot "G" (the grenade slot: hold G to ready its throwable, release to throw).
      // Task gasmask-breach-20261030 (mask lane): BEFORE them, a compact cell "Q" = the gas mask (gear slot 'mask'; a drop onto
      // it wears a mask). Children: [Q, 1..5, 6, G] — it takes no numbered quick slot.
      // Task knife-windup-20261030 (lane SLOT): + slot "~" (the melee slot: ~ draws its weapon). It is the LAST child (indices of
      // Q / 1-5 / 6 / G unchanged) but shown between Q and quick slot 1, like the ~ key left of 1 (CSS order, ui/gearStyles.ts).
      const bar = $('#hotbar');
      const n = inv.hotbar.length;
      if (bar.children.length !== n + 4) {
        ensureGearStyles();
        bar.innerHTML = `<div class="slot maskslot" data-bar="gear" data-index="${MASK}" title="Q: put the gas mask on / take it off"></div>`
          + inv.hotbar.map((_, i) => `<div class="slot" data-bar="hotbar" data-index="${i}"></div>`).join('')
          + `<div class="slot bagslot" data-bar="gear" data-index="${BACK}" title="6: take your backpack off into your hands · click sets it down"></div>`
          + `<div class="slot throwslot" data-bar="throw" data-index="0" title="G: hold to ready the grenade slot's throwable (flare), release to throw"></div>`
          + `<div class="slot meleeslot" data-bar="melee" data-index="0" title="~: draw the melee slot's weapon · 1-5 / wheel go back to the quick slots"></div>`;
      }
      const meleeHeld = inv.meleeSelected && !this.bagSelected;
      inv.hotbar.forEach((st, i) => {
        const el = bar.children[i + 1] as HTMLElement;
        const def = st ? itemDef(st.itemId) : null;
        const key = `${st?.uid ?? 0}|${st?.itemId ?? ''}|${st?.count ?? 0}|${st?.mag ?? ''}|${itemIconsVersion()}`;
        el.classList.toggle('selected', i === inv.selected && !inv.meleeSelected && !this.bagSelected);
        if (el.dataset.k === key) return;
        el.dataset.k = key;
        const count = def && def.kind !== 'weapon' && st!.count > 1 ? `<span class="count">${st!.count}</span>` : def?.kind === 'weapon' && !meleeDefOf(def.id) ? `<span class="count">${st!.mag}</span>` : ''; // lane KNIFE: no rounds on a melee slot
        el.innerHTML = `<span class="key">${i + 1}</span>${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}`;
      });
      this.extraSlots(inv, bar.children[n + 1] as HTMLElement, bar.children[n + 2] as HTMLElement);
      this.meleeCell(inv, bar.children[n + 3] as HTMLElement, meleeHeld);
    }
    const q = $('#hotbar').children[0] as HTMLElement | undefined;
    if (q) this.maskSlot(inv, q); // mask lane: live state / filter every frame (rebuilt only on change)
  }

  /**
   * Task gasmask-breach-20261030 (mask lane): the HUD "Q" cell — the equipped gas mask's icon (dim "no mask" ghost without one),
   * ON / OFF (ON… / OFF… while it goes on / comes off), the fitted filter's bar and the spare filters carried (+N). Rebuilt only when
   * what it shows changes. Task filter-tension-airtank-20261104-072836: amber / red come from the mask system's RESERVE-aware tone
   * (gear/gasMask.ts: amber at <= 30 s of usable protection in total — fitted filter + drawable spares + a worn tank; red only with none
   * left), not from the fitted filter alone; the filter bar still shows the fitted filter exactly, and a worn Airtank Backpack adds
   * its own air bar (teal) above it.
   */
  private maskSlot(inv: Inventory, el: HTMLElement): void {
    const st = inv.gearSlots[MASK];
    const def = st ? itemDef(st.itemId) : null;
    const m = this.mask, state = def ? m?.state ?? 'off' : 'off';
    const frac = def ? Math.max(0, Math.min(1, (st!.filter ?? 0) / FILTER_LIFE_S)) : 0;
    const pct = Math.ceil(frac * 100 - 1e-9);
    const spares = inv.count('gas_filter');
    const back = inv.gearSlots[BACK], tank = back && isAirtank(back.itemId) ? back : null;
    const tankPct = tank ? Math.ceil(Math.max(0, Math.min(1, (tank.air ?? 0) / AIRTANK_AIR_S)) * 100 - 1e-9) : -1;
    const tone = def ? m?.tone ?? (pct <= 0 ? 'empty' : 'ok') : 'ok';
    const reserve = Math.ceil(m?.reserveS ?? 0);
    const key = `${st?.uid ?? 0}|${st?.itemId ?? ''}|${state}|${pct}|${spares}|${tankPct}|${tone}|${def ? reserve : 0}|${itemIconsVersion()}`;
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.classList.toggle('vacant', !def);
    el.classList.toggle('on', !!def && (state === 'on' || state === 'donning'));
    el.classList.toggle('low', !!def && tone === 'low');
    el.classList.toggle('empty', !!def && tone === 'empty');
    const label = state === 'on' ? 'ON' : state === 'donning' ? 'ON…' : state === 'doffing' ? 'OFF…' : 'OFF';
    const air = tank ? ` · airtank ${tankPct} % (used first)` : '';
    el.title = def ? `Gas mask ${label} · filter ${pct} % · ${spares} spare${air} · ${reserve} s of protection in all — Q puts it on / takes it off; it protects only while on with air left` : 'Q: gas mask — none worn (drag one here or wear it from Tab: gear)';
    el.innerHTML = `<span class="key">Q</span>${spares ? `<span class="count">+${spares}</span>` : ''}${def ? itemIconHtml(def.id) : `<span class="ghost">${GEAR_ICONS.gasmask}</span>`}`
      + `<span class="nm">${def ? label : 'no mask'}</span>${def && tank ? `<span class="fb tb"><i style="width:${tankPct}%"></i></span>` : ''}${def ? `<span class="fb"><i style="width:${pct}%"></i></span>` : ''}`;
  }

  /**
   * Task train-fuel-system (lane PORT): the train FUEL readout (world/fuelPort.ts: near / aboard the train; null hides it). Writes the
   * DOM only when the pips / text / tone change.
   */
  setFuel(v: FuelHudView | null): void {
    const key = v ? `${v.pips}|${v.low ? 1 : 0}|${v.text}` : '';
    if (key === this.fuelKey) return;
    this.fuelKey = key;
    if (typeof document === 'undefined') return;
    if (!this.fuelEl) {
      const panel = document.querySelector('#light-panel');
      if (!panel) return;
      if (!document.querySelector('#fuel-css')) {
        const st = document.createElement('style');
        st.id = 'fuel-css';
        st.textContent = FUEL_CSS;
        document.head.appendChild(st);
      }
      const el = document.createElement('div');
      el.id = 'fuel-tag';
      el.className = 'lrow none';
      panel.insertBefore(el, panel.firstChild); // above the flares / battery rows
      this.fuelEl = el;
    }
    const el = this.fuelEl;
    el.classList.toggle('none', !v);
    if (!v) return;
    el.classList.toggle('low', v.low);
    el.title = 'Train fuel: one tank = one stop. Pour fuel cans in at the fuel cap (E); fuel cans in the train chest and fuel carts inside the car are burnt by themselves when the train departs.';
    // (task studio-general-armor-20261107-231448-01; four tanks since task gameplay-feedback lane TRAVEL) the train's reserve: one group
    // of four quarter pips per tank (one group = one hop), FUEL.trainTankUnits pips in all
    const pips = Array.from({length: FUEL.trainTankUnits}, (_, i) => `<i class="${i < v.pips ? 'on' : ''}${i > 0 && i % FUEL.tankUnits === 0 ? ' gap' : ''}"></i>`).join('');
    el.innerHTML = `<span class="ico">${ICONS.fuelCan}</span><span class="pips">${pips}</span><span class="txt">${v.text.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))}</span>`;
  }
  private fuelKey = '';
  private fuelEl: HTMLElement | null = null;

  /** Task train-fuel-system (lane PORT): the fuel readout's shown text ('' hidden) — QA / tests. */
  get fuelShown(): string {
    return this.fuelKey;
  }

  /** Task gasmask-breach-20261030 (mask lane): the gas mask's face state (gear/gasMask.ts calls it every frame; applied by update). */
  setMask(view: MaskHudView | null): void {
    this.mask = view;
  }

  /**
   * Task knife-windup-20261030 (lane SLOT): HUD slot "~" — the melee slot in the grenade slot's style (teal key, dim "melee" ghost
   * when empty), mustard-selected while its weapon is in the hands. Melee weapons show no rounds.
   */
  private meleeCell(inv: Inventory, el: HTMLElement, held: boolean): void {
    const m = inv.melee;
    const def = m ? itemDef(m.itemId) : null;
    el.classList.toggle('vacant', !def);
    el.classList.toggle('selected', held && !!def);
    const k = `${m?.uid ?? 0}|${m?.itemId ?? ''}|${itemIconsVersion()}`;
    if (el.dataset.k === k) return;
    el.dataset.k = k;
    el.innerHTML = `<span class="key">~</span>${def ? itemIconHtml(def.id) : `<span class="ghost">${ICONS.knife}</span>`}<span class="nm">${def ? def.short : 'melee'}</span>`;
  }

  /** Task office-overhaul-20261030 (INTERACT): HUD slot 6 (worn backpack, dim "no bag" without one) and slot G (grenade slot). */
  private extraSlots(inv: Inventory, bagEl: HTMLElement, throwEl: HTMLElement): void {
    const bag = inv.gearSlots[BACK];
    const bagDef = bag ? itemDef(bag.itemId) : null;
    bagEl.classList.toggle('vacant', !bagDef);
    bagEl.classList.toggle('selected', this.bagSelected && !!bagDef);
    const bk = `${bag?.uid ?? 0}|${bag?.itemId ?? ''}|${itemIconsVersion()}`;
    if (bagEl.dataset.k !== bk) {
      bagEl.dataset.k = bk;
      bagEl.innerHTML = `<span class="key">6</span>${bagDef ? itemIconHtml(bagDef.id) : `<span class="ghost">${GEAR_ICONS.backpack}</span>`}<span class="nm">${bagDef ? bagDef.short : 'no bag'}</span>`;
    }
    const t = inv.throwSlot[0];
    const tDef = t ? itemDef(t.itemId) : null;
    throwEl.classList.toggle('vacant', !tDef);
    const tk = `${t?.uid ?? 0}|${t?.itemId ?? ''}|${t?.count ?? 0}|${itemIconsVersion()}`;
    if (throwEl.dataset.k !== tk) {
      throwEl.dataset.k = tk;
      throwEl.innerHTML = `<span class="key">G</span>${tDef ? itemIconHtml(tDef.id) : `<span class="ghost">${ICONS.flare}</span>`}<span class="nm">${tDef ? tDef.short : 'grenade'}</span>${t && t.count > 1 ? `<span class="count">${t.count}</span>` : ''}`;
    }
  }

  /**
   * Task office-overhaul-20261030 (INTERACT, #1): the worn backpack is (not) in the hands — slot 6 shows as the selected slot
   * instead of the quick slot (gear/system.ts calls it every frame; writes only on change).
   */
  setBagSelected(on: boolean): void {
    if (on === this.bagSelected) return;
    this.bagSelected = on;
    this.hotbarVersion = -1; // redraw the selection marks
  }

  /**
   * Task office-overhaul-20261030 (INTERACT, #1): a progress ring round the crosshair while E is held on a grounded bag (0..1),
   * hidden with null. Writes only on change.
   */
  setHoldRing(progress: number | null): void {
    const k = progress === null ? -1 : Math.round(Math.max(0, Math.min(1, progress)) * 100);
    if (k === this.ringShown) return;
    this.ringShown = k;
    if (typeof document === 'undefined') return;
    if (!this.ringWrap) {
      const host = document.querySelector('#hud');
      if (!host) return;
      ensureGearStyles();
      const wrap = document.createElement('div');
      wrap.id = 'hold-ring';
      wrap.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle class="track" cx="16" cy="16" r="13"/><circle class="arc" cx="16" cy="16" r="13" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/></svg>`;
      host.appendChild(wrap);
      this.ringWrap = wrap;
      this.ring = wrap.querySelector('circle.arc');
    }
    this.ringWrap?.classList.toggle('show', k >= 0);
    if (k >= 0) this.ring?.setAttribute('stroke-dashoffset', (RING_C * (1 - k / 100)).toFixed(2));
  }

  /** Task office-overhaul-20261030 (INTERACT): the hold ring's progress in percent (-1 hidden) — QA / tests. */
  get holdRing(): number {
    return this.ringShown;
  }

  /** FOOD / WATER bar: width eases (CSS), low/critical tint, and a "+N" pop when it goes up. */
  private survival(key: 'food' | 'water', v: number | undefined): void {
    const row = document.querySelector(`#surv-${key}`) as HTMLElement | null;
    if (!row) return;
    if (v === undefined) { row.style.display = 'none'; return; }
    row.style.display = '';
    const pct = Math.round(v);
    const prev = this.survShown[key];
    if (pct === prev) return;
    this.survShown[key] = pct;
    (row.querySelector('.fill') as HTMLElement).style.width = `${Math.max(0, Math.min(100, v))}%`;
    // (task studio-market-bar-20261108-225231-01, lane BEER) the overfill above 100: a green band overlapping the full bar (built on first use)
    const over = Math.max(0, Math.min(SURVIVAL_MAX, v - SURVIVAL_MAX));
    let band = row.querySelector('.bar .over') as HTMLElement | null;
    if (!band && over > 0) {
      ensureBeerCss();
      band = document.createElement('div');
      band.className = 'over';
      row.querySelector('.bar')?.appendChild(band);
    }
    if (band) band.style.width = `${over}%`;
    row.classList.toggle('overfill', over > 0);
    row.querySelector('.pct')!.textContent = `${pct}%`;
    row.classList.toggle('low', v <= LOW && v > CRITICAL);
    row.classList.toggle('crit', v <= CRITICAL);
    if (prev >= 0 && pct - prev >= 2) {
      const pop = document.createElement('span');
      pop.className = 'gain';
      pop.textContent = `+${pct - prev}`;
      row.appendChild(pop);
      pop.animate([{opacity: 0, transform: 'translateY(4px)'}, {opacity: 1, transform: 'translateY(-4px)', offset: 0.2}, {opacity: 0, transform: 'translateY(-14px)'}], {duration: 1400, easing: 'ease-out'});
      setTimeout(() => pop.remove(), 1400);
      row.animate([{filter: 'brightness(1.9)'}, {filter: 'brightness(1)'}], {duration: 900, easing: 'ease-out'});
    }
  }

  /**
   * Iteration 12 (LIGHT): BATTERY meter — fill + percentage; mustard below 25 % (the flicker band), red + pulse below 10 %,
   * "FLAT" at 0; dimmed while the light is switched off (no drain); spare batteries carried as "+N".
   */
  private batteryMeter(b: {charge: number; on: boolean; flicker: number; spares: number}): void {
    const pct = Math.max(0, Math.min(100, Math.ceil(b.charge * 100 - 1e-9)));
    this.set('battery', `${pct}|${b.on}|${b.spares}`, () => {
      const row = document.querySelector('#battery') as HTMLElement | null;
      if (!row) return;
      (row.querySelector('.fill') as HTMLElement).style.width = `${pct}%`;
      row.querySelector('.pct')!.textContent = pct > 0 ? `${pct}%` : 'FLAT';
      row.querySelector('.spare')!.textContent = b.spares > 0 ? `+${b.spares}` : '';
      row.classList.toggle('low', pct <= 25 && pct > 10);
      row.classList.toggle('crit', pct <= 10);
      row.classList.toggle('off', !b.on);
    });
  }

  /** Stance tag above the vitals (empty while standing). */
  setStance(crouched: boolean, standBlocked: boolean): void {
    this.set('stance', crouched ? (standBlocked ? 'CROUCHED · NO HEADROOM' : 'CROUCHED · C') : '', v => { $('#stance-tag').textContent = v; });
  }

  hitmarker(kill: boolean): void {
    const el = $('#hitmarker');
    el.classList.toggle('kill', kill);
    el.getAnimations().forEach(a => a.cancel());
    el.animate([{opacity: 1, transform: 'scale(1.15)'}, {opacity: 0, transform: 'scale(1)'}], {duration: kill ? 420 : 200, easing: 'ease-out'});
  }

  damage(angle: number, amount: number): void {
    const v = $('#vignette');
    v.animate([{opacity: Math.min(0.9, 0.35 + amount / 30)}, {opacity: 0}], {duration: 600, easing: 'ease-out'});
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad)`;
    $('#damage-dir').appendChild(arc);
    setTimeout(() => arc.remove(), 950);
  }

  toast(text: string, warn = false): void {
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.textContent = text;
    const box = $('#toasts');
    box.appendChild(t);
    while (box.children.length > 5) box.firstElementChild!.remove();
    setTimeout(() => t.remove(), 3300);
  }

  reset(): void {
    this.cache.clear();
    this.hotbarVersion = -1;
    this.setHoldRing(null); // Task office-overhaul-20261030 (INTERACT)
    this.survShown.food = this.survShown.water = -1;
    $('#toasts').innerHTML = '';
    $('#damage-dir').innerHTML = '';
  }
}

export const CONTROLS: [string, string][] = [
  // Task campaign-save-controls-fix-20261104-034806 (user: "Simply say, left click uses held item"; the grenade key throws whatever
  // grenade is equipped): item-agnostic action labels — one row per binding; item-specific uses (knife wind-up, batteries, slings,
  // flares) are all "Use held item" / "Throw equipped grenade". Bindings unchanged.
  ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', 'Shift'], ['Jump', 'Space'], ['Crouch (tap · hold)', 'C'],
  ['Use held item', 'Left click'], ['Aim down sights', 'Right click'], ['Reload', 'R'], ['Interact · take (hold to pick up)', 'E'],
  // task train-interaction-ux-20261112-063646: every draggable starts on a HELD E (core/holdGesture.ts); R turns a dragged device round
  ['Drag a cart or device (hold) · turn it round', 'E · R'],
  ['Quick slots', '1 – 5 · wheel'], ['Melee weapon', '~'], ['Throw equipped grenade', 'Hold G'],
  ['Gas mask on/off', 'Q'], ['Flashlight', 'F'], ['Quick heal', 'H'], ['Inventory', 'Tab or I'], ['Backpack slot', '6'],
  ['Climb ladder · let go', 'E · Space or S'], ['Mute', 'M'], ['Pause / release mouse', 'Esc'],
  // task studio-performance-recorder-20261103-043629 (lane RECORDER): debug/perfRecorderUi.ts RECORDER_KEYS (also Pause → Performance)
  ['Performance recording: start / stop · mark a stutter', 'F8 · F9'],
];

export function renderControls(el: HTMLElement): void {
  el.innerHTML = CONTROLS.filter(([a]) => a).map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('');
}
