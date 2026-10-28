// DOM heads-up display. Writes only when values change.

import {LIGHT_ICONS, STAT_ICONS} from './icons';
import {itemIconHtml, itemIconsVersion} from './itemIcons';
import {itemDef} from '../items/items';
import type {Inventory} from '../items/inventory';
import {CRITICAL, LOW} from '../player/survival';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export interface HudState {
  hp: number;
  maxHp: number;
  stamina: number;
  weaponName: string;
  mag: number | null;
  reserve: number;
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
  /** Iteration 12 (LIGHT): flares carried (grenade slot, T) and burning in the world. */
  flares?: {count: number; burning: number};
}

export class Hud {
  private readonly cache = new Map<string, string>();
  private hotbarVersion = -1;
  private readonly root = $('#hud');
  private readonly survShown: Record<'food' | 'water', number> = {food: -1, water: -1};

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
    this.set('mag', s.mag === null ? '' : `${s.mag}|${s.reserve}`, v => {
      const ammo = $('#ammo');
      ammo.style.visibility = v ? 'visible' : 'hidden';
      if (v) { const [m, r] = v.split('|'); $('#mag').textContent = m; $('#reserve').textContent = r; ammo.classList.toggle('empty', m === '0'); }
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
      const bar = $('#hotbar');
      if (bar.children.length !== inv.hotbar.length) bar.innerHTML = inv.hotbar.map((_, i) => `<div class="slot" data-bar="hotbar" data-index="${i}"></div>`).join('');
      inv.hotbar.forEach((st, i) => {
        const el = bar.children[i] as HTMLElement;
        const def = st ? itemDef(st.itemId) : null;
        const key = `${st?.uid ?? 0}|${st?.itemId ?? ''}|${st?.count ?? 0}|${st?.mag ?? ''}|${itemIconsVersion()}`;
        el.classList.toggle('selected', i === inv.selected);
        if (el.dataset.k === key) return;
        el.dataset.k = key;
        const count = def && def.kind !== 'weapon' && st!.count > 1 ? `<span class="count">${st!.count}</span>` : def?.kind === 'weapon' ? `<span class="count">${st!.mag}</span>` : '';
        el.innerHTML = `<span class="key">${i + 1}</span>${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}`;
      });
    }
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
    this.survShown.food = this.survShown.water = -1;
    $('#toasts').innerHTML = '';
    $('#damage-dir').innerHTML = '';
  }
}

export const CONTROLS: [string, string][] = [
  ['Move', 'W A S D'], ['Look', 'Mouse'], ['Sprint', 'Shift'], ['Jump', 'Space'],
  ['Crouch (tap toggle · hold)', 'C'], ['Fire / eat · drink · use held item', 'Left click'],
  ['Aim down sights', 'Right click'], ['Reload', 'R'], ['Open · take aimed item · take all', 'E'], ['Quick slots', '1 – 5 · wheel'],
  ['Last item', 'Q'], ['Inventory', 'Tab or I'], ['Quick heal', 'H'], ['Drop held item', 'G'],
  // Iteration 12 (LIGHT): the flashlight runs on a battery (HUD meter); batteries are used like other items; T throws a flare
  ['Flashlight (battery meter, bottom right)', 'F'], ['Throw flare (grenade slot)', 'T · or click while held'],
  ['Swap in a battery (refills the light)', 'Click while held · inventory Use'],
  ['Mute', 'M'], ['Pause / release mouse', 'Esc'], ['Climb rescue ladder (track bed)', 'E · Space or S lets go'],
];

export function renderControls(el: HTMLElement): void {
  el.innerHTML = CONTROLS.filter(([a]) => a).map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('');
}
