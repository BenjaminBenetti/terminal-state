// DOM heads-up display. Writes only when values change.

import {LIGHT_ICONS, STAT_ICONS} from './icons';
import {itemIconHtml, itemIconsVersion} from './itemIcons';
import {itemDef} from '../items/items';
import type {Inventory} from '../items/inventory';
import {CRITICAL, LOW} from '../player/survival';
import type {LimbInjury} from '../player/injuries'; // Iteration 16 (lane INJURY)

// Iteration 16 (lane INJURY): limb indicator — a small body silhouette right of the vitals; the injured arm / leg (its side)
// turns red with a short label. Built here (no index.html markup needed); styles injected once.
const LIMB_CSS = `
#limbs { position: absolute; left: calc(100% + 12px); bottom: 0; display: flex; align-items: flex-end; gap: 7px; font-size: 10.5px; letter-spacing: 0.12em; color: var(--cream-dim); white-space: nowrap; }
#limbs svg { width: 20px; height: 38px; overflow: visible; }
#limbs svg .p { fill: rgba(185, 177, 156, 0.42); transition: fill 0.4s; }
#limbs svg .p.hurt { fill: var(--red); }
#limbs .txt { display: flex; flex-direction: column; gap: 2px; padding-bottom: 1px; }
#limbs .txt span { display: none; color: var(--red); }
#limbs .txt span.on { display: block; }
#limbs .txt span small { color: var(--cream-dim); font-size: 10px; letter-spacing: 0.06em; }`;
const LIMB_SVG = `<svg viewBox="0 0 20 38" aria-hidden="true"><circle class="p" cx="10" cy="4" r="3.4"/><rect class="p" x="6.4" y="8.3" width="7.2" height="12.4" rx="1.6"/>`
  // seen from behind (first person): your left limbs on the left
  + `<rect class="p arm-left" x="2.3" y="8.8" width="3.3" height="11.6" rx="1.6"/><rect class="p arm-right" x="14.4" y="8.8" width="3.3" height="11.6" rx="1.6"/>`
  + `<rect class="p leg-left" x="6.4" y="21.4" width="3.4" height="16" rx="1.6"/><rect class="p leg-right" x="10.2" y="21.4" width="3.4" height="16" rx="1.6"/></svg>`;

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
    this.buildLimbs(); // Iteration 16 (lane INJURY)
  }

  /** Iteration 16 (lane INJURY): the limb indicator element (inside #vitals) and its styles. */
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
    el.title = 'Limbs OK — no arm or leg injuries';
    el.innerHTML = `${LIMB_SVG}<div class="txt"><span class="arm">ARM <small>aim sway</small></span><span class="leg">LEG <small>limping</small></span></div>`;
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
        if (inj) span.innerHTML = `${inj.side === 'left' ? 'L' : 'R'} ${what} <small>${fx}</small>`;
      }
      const was = before?.split('|') ?? ['-', '-'];
      if (before !== undefined && ((arm && was[0] === '-') || (leg && was[1] === '-'))) {
        el.animate?.([{filter: 'brightness(2.2)', transform: 'scale(1.12)'}, {filter: 'brightness(1)', transform: 'scale(1)'}], {duration: 900, easing: 'ease-out'});
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
  ['Flashlight (battery meter, bottom right)', 'F'], ['Throw flare: hold to ready, release to throw', 'Hold T · or hold click while held'],
  ['Swap in a battery (refills the light)', 'Click while held · inventory Use'],
  ['Mute', 'M'], ['Pause / release mouse', 'Esc'], ['Climb rescue ladder (track bed)', 'E · Space or S lets go'],
];

export function renderControls(el: HTMLElement): void {
  el.innerHTML = CONTROLS.filter(([a]) => a).map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('');
}
