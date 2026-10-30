// DOM heads-up display. Writes only when values change.

import {ICONS, LIGHT_ICONS, STAT_ICONS} from './icons';
import {itemIconHtml, itemIconsVersion} from './itemIcons';
import {itemDef} from '../items/items';
import {meleeDefOf} from '../weapons/weapons'; // lane KNIFE
import type {Inventory} from '../items/inventory';
import {FILTER_LIFE_S, GEAR_SLOTS} from '../items/gear';
import {GEAR_ICONS} from './gearIcons';
import {ensureGearStyles} from './gearStyles';
import {CRITICAL, LOW} from '../player/survival';
import type {LimbInjury} from '../player/injuries'; // Iteration 16 (lane INJURY)
import {GAS_MASK, type MaskHudView} from '../gear/gasMask'; // task gasmask-breach-20261030 (mask lane)

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
  total: number;
  area: string;
  spreadPx: number;
  aiming: boolean;
  flashlight: boolean;
  use: {label: string; progress: number} | null;
  /** Survival fullness 0-100 (FOOD = hunger, WATER = thirst); bars hidden when omitted. */
  food?: number;
  water?: number;
  /** Iteration 12 (LIGHT): flashlight battery (charge 0..1, light switched on, flicker amount 0..1, spare batteries carried). */
  battery?: {charge: number; on: boolean; flicker: number; spares: number};
  /** Iteration 12 (LIGHT): flares carried (grenade slot; G since task office-overhaul-20261030) and burning in the world. */
  flares?: {count: number; burning: number};
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
    this.set('obj', `${s.remaining}/${s.total}`, () => {
      $('#obj-count').textContent = s.remaining > 0 ? `${s.remaining} of ${s.total} infected remain` : 'All infected down — station clear';
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
      const bar = $('#hotbar');
      const n = inv.hotbar.length;
      if (bar.children.length !== n + 3) {
        ensureGearStyles();
        bar.innerHTML = `<div class="slot maskslot" data-bar="gear" data-index="${MASK}" title="Q: put the gas mask on / take it off"></div>`
          + inv.hotbar.map((_, i) => `<div class="slot" data-bar="hotbar" data-index="${i}"></div>`).join('')
          + `<div class="slot bagslot" data-bar="gear" data-index="${BACK}" title="6: take your backpack off into your hands · click sets it down"></div>`
          + `<div class="slot throwslot" data-bar="throw" data-index="0" title="G: hold to ready the grenade slot's throwable (flare), release to throw"></div>`;
      }
      inv.hotbar.forEach((st, i) => {
        const el = bar.children[i + 1] as HTMLElement;
        const def = st ? itemDef(st.itemId) : null;
        const key = `${st?.uid ?? 0}|${st?.itemId ?? ''}|${st?.count ?? 0}|${st?.mag ?? ''}|${itemIconsVersion()}`;
        el.classList.toggle('selected', i === inv.selected && !this.bagSelected);
        if (el.dataset.k === key) return;
        el.dataset.k = key;
        const count = def && def.kind !== 'weapon' && st!.count > 1 ? `<span class="count">${st!.count}</span>` : def?.kind === 'weapon' && !meleeDefOf(def.id) ? `<span class="count">${st!.mag}</span>` : ''; // lane KNIFE: no rounds on a melee slot
        el.innerHTML = `<span class="key">${i + 1}</span>${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}`;
      });
      this.extraSlots(inv, bar.children[n + 1] as HTMLElement, bar.children[n + 2] as HTMLElement);
    }
    const q = $('#hotbar').children[0] as HTMLElement | undefined;
    if (q) this.maskSlot(inv, q); // mask lane: live state / filter every frame (rebuilt only on change)
  }

  /**
   * Task gasmask-breach-20261030 (mask lane): the HUD "Q" cell — the equipped gas mask's icon (dim "no mask" ghost without one),
   * ON / OFF (ON… / OFF… while it goes on / comes off), the fitted filter's bar and the spare filters carried (+N). Amber at
   * <= 20 % filter, red when the fitted filter is empty. Rebuilt only when what it shows changes.
   */
  private maskSlot(inv: Inventory, el: HTMLElement): void {
    const st = inv.gearSlots[MASK];
    const def = st ? itemDef(st.itemId) : null;
    const m = this.mask, state = def ? m?.state ?? 'off' : 'off';
    const frac = def ? Math.max(0, Math.min(1, (st!.filter ?? 0) / FILTER_LIFE_S)) : 0;
    const pct = Math.ceil(frac * 100 - 1e-9);
    const spares = inv.count('gas_filter');
    const key = `${st?.uid ?? 0}|${st?.itemId ?? ''}|${state}|${pct}|${spares}|${itemIconsVersion()}`;
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    const low = !!def && pct > 0 && frac <= GAS_MASK.lowFrac, empty = !!def && pct <= 0;
    el.classList.toggle('vacant', !def);
    el.classList.toggle('on', !!def && (state === 'on' || state === 'donning'));
    el.classList.toggle('low', low);
    el.classList.toggle('empty', empty);
    const label = state === 'on' ? 'ON' : state === 'donning' ? 'ON…' : state === 'doffing' ? 'OFF…' : 'OFF';
    el.title = def ? `Gas mask ${label} · filter ${pct} % · ${spares} spare — Q puts it on / takes it off; it protects only while on with filter left` : 'Q: gas mask — none worn (drag one here or wear it from Tab: gear)';
    el.innerHTML = `<span class="key">Q</span>${spares ? `<span class="count">+${spares}</span>` : ''}${def ? itemIconHtml(def.id) : `<span class="ghost">${GEAR_ICONS.gasmask}</span>`}`
      + `<span class="nm">${def ? label : 'no mask'}</span>${def ? `<span class="fb"><i style="width:${pct}%"></i></span>` : ''}`;
  }

  /** Task gasmask-breach-20261030 (mask lane): the gas mask's face state (gear/gasMask.ts calls it every frame; applied by update). */
  setMask(view: MaskHudView | null): void {
    this.mask = view;
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
  ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', 'Shift'], ['Jump', 'Space'],
  ['Crouch (tap toggle · hold)', 'C'], ['Fire · knife slash (hold to keep slashing) / eat · drink · use held item', 'Left click'],
  ['Aim down sights', 'Right click'], ['Reload', 'R'], ['Open · take aimed item · take all', 'E'], ['Quick slots (knife: 3 at the start)', '1 – 5 · wheel'],
  // Task gasmask-breach-20261030 (mask lane): Q = the gas mask (last-item cycling removed); it uses filters from your pockets
  ['Gas mask on/off', 'Q'], ['Inventory (drag an item out of it to drop it)', 'Tab or I'], ['Quick heal', 'H'],
  // Iteration 12 (LIGHT): the flashlight runs on a battery (HUD meter); batteries are used like other items.
  // Task office-overhaul-20261030 (INTERACT, #6): G throws the grenade slot's flare (T retired; G no longer drops)
  ['Flashlight (battery meter, bottom right)', 'F'], ['Throw the grenade slot\'s flare: hold to ready, release to throw', 'Hold G · or hold click while held'],
  ['Swap in a battery (refills the light)', 'Click while held · inventory Use'],
  // Iteration 16 (lane INJURY): bandages / med kits heal HP only; an injured arm / leg needs its own treatment
  ['Injured arm / leg (red on the HUD): apply an arm sling / leg splint', 'Click while held · inventory Use'],
  // Iteration 16 (lane GEAR): gear is worn from the inventory's gear panel; a backpack is only opened on the ground
  // Task office-overhaul-20261030 (INTERACT, #1): hold E on a grounded bag to pick it up and wear it
  ['Backpack: hold it (slot 6) · set it down · open it (world keeps running) · pick it up', '6 · click · tap E · hold E'],
  ['Mute', 'M'], ['Pause / release mouse', 'Esc'], ['Climb rescue ladder (track bed)', 'E · Space or S lets go'],
];

export function renderControls(el: HTMLElement): void {
  el.innerHTML = CONTROLS.filter(([a]) => a).map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('');
}
