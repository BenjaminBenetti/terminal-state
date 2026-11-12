// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTING BENCH'S RECIPE LIST — the overlay [E] on the bench opens
// (world/craftBench.ts owns when it opens / closes and does the craft; this file is what it shows and which keys are its own).
// Task train-interaction-ux-20261112-063646 (lane CRAFT-UI) made it a picture list: no crafting shortcuts, a 3D preview per recipe,
// materials as icons with have / need ratios, one short line of text per recipe.
//
// LOOK: the Lockbox view's language (ui/lockboxView.ts: a dark panel over the play view, a teal top edge, the red "not paused" line),
// with 14–16 px text. Title "Crafting bench"; ONE ROW PER RECIPE in craft/recipes.ts RECIPES order, left to right:
//   PREVIEW    the unit the recipe makes, rendered from its real runtime models by the inventory's own icon pass and cache
//              (ui/itemIcons.ts; world/craftPreview.ts registers the sources). While its models are not resident the frame is EMPTY —
//              never a glyph, a stand-in box or any other proxy picture;
//   NAME       craft/equipment.ts EQUIPMENT[kind].name + the recipe's one-sentence blurb;
//   MATERIALS  one chip per material the recipe costs (none for a material it does not cost): the material's inventory icon
//              (itemIconHtml: its rendered model, the SVG glyph as fallback) and "have / need" — GREEN (class ok) when there is enough,
//              RED (class short) when not. No names or sentences in the row: the chip's tooltip (ui/tooltip.ts) names the material and
//              says where the count is ("3 carried · 4 in the Lockbox");
//   CRAFT      the button — disabled unless the craft would go through now (craft/crafting.ts planCraft finds a plan AND the equipment
//              system would take the unit);
//   and, only when the equipment system refuses, ITS text on a line under the row (no room on the car floor, …). A shortage has no
//   sentence: the red ratio says it.
// The counts are craft/crafting.ts recipeNeeds over the very source list craft() pays from (carried, the worn backpack, the Lockbox,
// the chests aboard): what the list shows is what a craft takes. Under the list one line says what just happened (a craft: mustard;
// a refusal: red) next to Close.
//
// KEYS while it is open (a capture listener applies craftKeyAction, so none of these reaches the game): E closes; Esc / Tab / I close
// and go on to their usual meaning (pause / inventory); EVERY DIGIT IS SWALLOWED and does nothing (there is no crafting shortcut, and
// a digit must never switch a quick slot behind the list); the rest pass (WASD still walks — and walking away closes the view).
// Crafting is the row's button. Nothing is taken while closed or while typing in a field.
//
// The model (craftModel) and the markup (craftViewHtml) are pure: Node tests call them without a DOM; CraftView is the thin DOM shell
// (mounted in #app like the Lockbox view; its CSS is the marked "crafting bench view" block of styles.css).

import {EQUIPMENT, isEquipmentKind, type EquipmentKind} from '../craft/equipment';
import {countMaterials, planCraft, recipeNeeds, type MaterialCount, type MaterialSource} from '../craft/crafting';
import {RECIPES, type Recipe, type RecipeMaterial} from '../craft/recipes';
import {digitOfCode} from '../items/devGrant';
import {itemDef} from '../items/items';
import {isTypingTarget} from '../player/input';
import {itemIconHtml, itemIconUrl, onItemIconsChanged} from './itemIcons';
import {hideTooltip, refreshTooltip, tipAttrs} from './tooltip';

export const CRAFT_VIEW_ID = 'craftview';

export const CRAFT_VIEW_TEXT = {
  title: 'Crafting bench',
  live: '● Not paused — keep an eye out',
  craft: 'Craft',
  close: 'Close (E)',
  /** A material chip's tooltip when none of it is in reach: where the bench looks. */
  nowhere: 'None on you, in the Lockbox or in a chest in the car',
} as const;

/** The item-icon cache id of a unit's 3D preview (ui/itemIcons.ts extra sources; world/craftPreview.ts registers one per recipe). */
export const craftPreviewId = (kind: EquipmentKind): string => `equipment:${kind}`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Texts (pure)

/** Where a material's count is, only the places that hold some: "3 carried · 1 in your backpack · 4 in the Lockbox · 2 in chests". */
export function whereFromText(c: Pick<MaterialCount, 'carried' | 'backpack' | 'lockbox' | 'chests'>): string {
  const parts: string[] = [];
  if (c.carried > 0) parts.push(`${c.carried} carried`);
  if (c.backpack > 0) parts.push(`${c.backpack} in your backpack`);
  if (c.lockbox > 0) parts.push(`${c.lockbox} in the Lockbox`);
  if (c.chests > 0) parts.push(`${c.chests} in chests`);
  return parts.length ? parts.join(' · ') : CRAFT_VIEW_TEXT.nowhere;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The model (pure)

/** One material a recipe costs, as its chip shows it. */
export interface CraftNeedChip {
  material: RecipeMaterial;
  /** The material's name (the tooltip's heading and the chip's label for assistive technology — not shown in the row). */
  name: string;
  need: number;
  have: number;
  /** 'ok' (green): have >= need; 'short' (red). */
  state: 'ok' | 'short';
  /** Where `have` is (the tooltip's second line). */
  where: string;
}

export interface CraftRow {
  kind: EquipmentKind;
  name: string;
  blurb: string;
  /** The icon-cache id of its 3D preview (craftPreviewId). */
  preview: string;
  /** The materials it costs (a material it does not cost has no chip). */
  needs: CraftNeedChip[];
  /** The craft would go through now: planCraft finds a plan AND the equipment system would take the unit. */
  can: boolean;
  /** Why the equipment system would refuse it ('' when it would not). A shortage is not a reason here: its ratio is red. */
  reason: string;
}

export interface CraftViewModel {
  rows: CraftRow[];
}

/**
 * The list as it stands: every recipe against the SOURCES a craft would pay from (craft/crafting.ts craftSources — counted once) and
 * the equipment system's refusal (`block`, per kind).
 */
export function craftModel(sources: readonly MaterialSource[], block: (kind: EquipmentKind) => string | null, recipes: readonly Recipe[] = RECIPES): CraftViewModel {
  const counts = countMaterials(sources);
  return {rows: recipes.map((r): CraftRow => {
    const needs = recipeNeeds(r, sources, counts).map((n): CraftNeedChip => (
      {material: n.id, name: itemDef(n.id).name, need: n.need, have: n.have, state: n.ok ? 'ok' : 'short', where: whereFromText(n.where)}));
    const reason = block(r.kind) || '';
    return {kind: r.kind, name: EQUIPMENT[r.kind].name, blurb: r.blurb, preview: craftPreviewId(r.kind), needs, can: planCraft(r, sources).ok && !reason, reason};
  })};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The markup (pure)

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A row's preview frame: the cached render of the unit's real models, or the EMPTY frame while there is none (never a proxy). */
export function craftPreviewHtml(id: string): string {
  return `<div class="cv-preview${itemIconUrl(id) ? '' : ' cv-empty'}">${itemIconHtml(id, 'cv-img')}</div>`;
}

/** A material chip: the material's inventory icon + "have / need", green or red; the name and where the count is in its tooltip. */
export function craftNeedHtml(n: CraftNeedChip): string {
  const short = n.state === 'short';
  const tip = tipAttrs({head: n.name, lines: [`Have ${n.have} · need ${n.need}`, n.where], tone: short ? 'danger' : 'info'});
  return `<span class="cv-mat ${n.state}" data-material="${n.material}" role="img" aria-label="${esc(n.name)}: ${n.have} of ${n.need}"${tip}>`
    + `${itemIconHtml(n.material)}<span class="cv-ratio">${n.have} / ${n.need}</span></span>`;
}

/** The rows' markup (the list element's innerHTML). */
export function craftRowsHtml(m: CraftViewModel): string {
  return m.rows.map(r => `<div class="cv-row ${r.can ? 'cv-can' : 'cv-cant'}" data-kind="${r.kind}">`
    + craftPreviewHtml(r.preview)
    + `<div class="cv-what"><b class="cv-name">${esc(r.name)}</b><div class="cv-blurb">${esc(r.blurb)}</div></div>`
    + `<div class="cv-mats">${r.needs.map(craftNeedHtml).join('')}</div>`
    + `<div class="cv-do"><button class="cv-craft primary" type="button" data-kind="${r.kind}"${r.can ? '' : ' disabled'}>${CRAFT_VIEW_TEXT.craft}</button></div>`
    + (r.reason ? `<div class="cv-why">${esc(r.reason)}</div>` : '')
    + '</div>').join('');
}

/** The whole panel (the root element's innerHTML). */
export function craftViewHtml(m: CraftViewModel | null, note = '', noteBad = false): string {
  const T = CRAFT_VIEW_TEXT;
  return `<div class="cv-panel">`
    + `<div class="cv-head"><b class="cv-title">${T.title}</b><span class="cv-live">${T.live}</span></div>`
    + `<div class="cv-list">${m ? craftRowsHtml(m) : ''}</div>`
    + `<div class="cv-actions"><div class="cv-note${noteBad ? ' refused' : ''}" role="status">${esc(note)}</div><button class="cv-close" type="button">${T.close}</button></div>`
    + '</div>';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Keys (pure)

/** What a keydown does while the recipe list is (or is not) open. */
export type CraftKey =
  | {kind: 'pass'} // not the view's: the game / browser handles it as usual (WASD still walks)
  | {kind: 'swallow'} // consumed, nothing else (E's auto-repeat; EVERY digit — no crafting shortcut, never a quick slot)
  | {kind: 'close'} // E: consumed, closes the view
  | {kind: 'close-pass'}; // Tab / Esc / I: closes, then goes on (inventory / pause)

/** The view's key scope (pure; the bench's capture listener applies it). Nothing is taken while closed or while typing in a field. */
export function craftKeyAction(e: {code: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: unknown}, open: boolean): CraftKey {
  if (!open || isTypingTarget(e.target)) return {kind: 'pass'};
  if (e.code === 'KeyE') return e.repeat ? {kind: 'swallow'} : {kind: 'close'};
  if (e.code === 'Tab' || e.code === 'Escape' || e.code === 'KeyI') return {kind: 'close-pass'};
  // a digit does nothing here — and must not reach the game (quick slots 1–5, the bag key 6); a browser / OS chord keeps its meaning
  if (digitOfCode(e.code) !== null && !e.ctrlKey && !e.altKey && !e.metaKey) return {kind: 'swallow'};
  return {kind: 'pass'};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The view (DOM)

export interface CraftViewHost {
  /** The list as it stands (null: closed — nothing to show). */
  model(): CraftViewModel | null;
  /** [Craft] clicked on a row. */
  craft(kind: EquipmentKind): void;
  close(): void;
}

export class CraftView {
  private root: HTMLElement | null = null;
  private shown = false;
  /** The message under the list (refusals in red). */
  note = '';
  noteBad = false;
  /** The model last rendered (QA / tests; also without a DOM). */
  last: CraftViewModel | null = null;
  /** How many times it rendered (tests: redraws). */
  renders = 0;

  constructor(private readonly host: CraftViewHost) {
    // a preview / a material icon it shows was (re)rendered — the unit's models arrived while the list is open: redraw, so the empty
    // frame becomes the picture at once (like ui/lockboxView.ts)
    onItemIconsChanged(ids => { if (this.shown && this.shows(ids)) this.render(); });
  }

  get visible(): boolean {
    return this.shown;
  }

  /** One of `ids` is an icon the rendered list shows (a row's preview, a material chip). */
  private shows(ids: readonly string[]): boolean {
    return !!this.last && this.last.rows.some(r => ids.includes(r.preview) || r.needs.some(n => ids.includes(n.material)));
  }

  show(): void {
    this.mount();
    this.note = '';
    this.noteBad = false;
    this.shown = true;
    this.root?.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.shown = false;
    this.root?.classList.add('hidden');
    hideTooltip(); // the tooltip goes with the panel
  }

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    const el = document.createElement('section');
    el.id = CRAFT_VIEW_ID;
    el.className = 'hidden';
    el.setAttribute('aria-label', CRAFT_VIEW_TEXT.title);
    el.innerHTML = craftViewHtml(null);
    (document.querySelector('#app') ?? document.body).appendChild(el);
    this.root = el;
    el.addEventListener('click', e => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      if (t.closest('.cv-close')) { this.host.close(); return; }
      const b = t.closest('.cv-craft') as HTMLButtonElement | null;
      const kind = b && !b.disabled ? b.dataset.kind : undefined;
      if (isEquipmentKind(kind)) this.host.craft(kind);
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** The note under the list ('' clears it). */
  say(text: string, bad: boolean): void {
    this.note = text;
    this.noteBad = bad;
    const n = this.root?.querySelector('.cv-note');
    if (n) { n.textContent = text; n.classList.toggle('refused', bad); }
  }

  /** Redraw the rows from the host's model. */
  render(): void {
    const m = this.shown ? this.host.model() : null;
    if (!m) return;
    this.last = m;
    this.renders++;
    const root = this.root;
    if (!root) return; // no DOM (tests)
    const list = root.querySelector('.cv-list'), n = root.querySelector('.cv-note');
    if (list) list.innerHTML = craftRowsHtml(m);
    if (n) { n.textContent = this.note; n.classList.toggle('refused', this.noteBad); }
    refreshTooltip(); // (the hovered chip was replaced: its tooltip follows the new one)
  }
}
