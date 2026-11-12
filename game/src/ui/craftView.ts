// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTING BENCH'S RECIPE LIST — the overlay [E] on the bench opens
// (world/craftBench.ts owns when it opens / closes and does the craft; this file is what it shows and which keys are its own).
//
// LOOK: the Lockbox view's language (ui/lockboxView.ts: a dark panel over the play view, a teal top edge, the red "not paused" line),
// with 14–16 px text. Title "Crafting bench"; ONE ROW PER RECIPE in craft/recipes.ts RECIPES order: its number key, the unit's name
// (craft/equipment.ts EQUIPMENT[kind].name), the recipe's blurb, one line per material —
//   "Scrap metal 4 · have 7"                     enough (green)
//   "Scrap metal 4 · have 1 — need 3 more"       short (red)
//   "Electrical parts —"                         the recipe needs none (dim)
// — and a [Craft (n)] button. The button is DISABLED with the reason next to it whenever the craft would be refused: the equipment
// system's own refusal text first (no room on the car floor, …), else what is missing ("Need 3 more Scrap metal") — exactly the text
// craft/crafting.ts craft() would refuse with. FOOTER: each material's total and where it is —
//   "Scrap metal 7 — carried 3 · backpack 0 · Lockbox 4 · chests 0".
// A note line under it says what just happened (a craft: mustard; a refusal: red).
//
// KEYS while it is open (a capture listener applies craftKeyAction, so none of these reaches the game): E closes; Esc / Tab / I close
// and go on to their usual meaning (pause / inventory); 1–4 craft that row; every other digit is swallowed (never a quick slot); the
// rest pass (WASD still walks — and walking away closes the view). Nothing is taken while closed or while typing in a field.
//
// The model (craftModel) and the markup (craftViewHtml) are pure: Node tests call them without a DOM; CraftView is the thin DOM shell
// (mounted in #app like the Lockbox view; its CSS is the marked "crafting bench view" block of styles.css).

import {EQUIPMENT, isEquipmentKind, type EquipmentKind} from '../craft/equipment';
import {missingText, type MaterialCount, type MaterialCounts, type MissingMaterials} from '../craft/crafting';
import {RECIPES, RECIPE_MATERIALS, type Recipe, type RecipeMaterial} from '../craft/recipes';
import {digitOfCode} from '../items/devGrant';
import {itemDef} from '../items/items';
import {isTypingTarget} from '../player/input';

export const CRAFT_VIEW_ID = 'craftview';

export const CRAFT_VIEW_TEXT = {
  title: 'Crafting bench',
  live: '● Not paused — keep an eye out',
  craft: 'Craft',
  close: 'Close (E)',
  help: 'Press 1–4 or click Craft · materials are taken from your pockets first, then your worn backpack, the Lockbox and the chests in the car · walking away or getting hit closes the bench',
  none: '—',
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Texts (pure)

/** One cost line: "Scrap metal 4 · have 7" / "Scrap metal 4 · have 1 — need 3 more" / "Electrical parts —" (the recipe needs none). */
export function costText(name: string, need: number, have: number): string {
  if (!(need > 0)) return `${name} ${CRAFT_VIEW_TEXT.none}`;
  return have >= need ? `${name} ${need} · have ${have}` : `${name} ${need} · have ${have} — need ${need - have} more`;
}

/** Where a material's total is: "carried 3 · backpack 0 · Lockbox 4 · chests 0". */
export function whereFromText(c: Pick<MaterialCount, 'carried' | 'backpack' | 'lockbox' | 'chests'>): string {
  return `carried ${c.carried} · backpack ${c.backpack} · Lockbox ${c.lockbox} · chests ${c.chests}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The model (pure)

export interface CraftCostLine {
  material: RecipeMaterial;
  name: string;
  need: number;
  have: number;
  /** How many more are needed (0: enough / none needed). */
  short: number;
  state: 'ok' | 'short' | 'none';
  text: string;
}

export interface CraftRow {
  kind: EquipmentKind;
  /** Its number key ('1'..). */
  key: string;
  name: string;
  blurb: string;
  costs: CraftCostLine[];
  /** The craft would go through now. */
  can: boolean;
  /** Why not ('' when it can): the equipment system's refusal, else the missing materials. */
  reason: string;
}

export interface CraftTotalLine {
  material: RecipeMaterial;
  name: string;
  total: number;
  where: string;
  /** "Scrap metal 7 — carried 3 · backpack 0 · Lockbox 4 · chests 0". */
  text: string;
}

export interface CraftViewModel {
  rows: CraftRow[];
  totals: CraftTotalLine[];
}

/** The list as it stands: every recipe against the counted materials and the equipment system's refusal (`block`, per kind). */
export function craftModel(counts: MaterialCounts, block: (kind: EquipmentKind) => string | null, recipes: readonly Recipe[] = RECIPES): CraftViewModel {
  const rows = recipes.map((r, i): CraftRow => {
    const missing: MissingMaterials = {};
    const costs = RECIPE_MATERIALS.map((m): CraftCostLine => {
      const name = itemDef(m).name, need = r.cost[m], have = counts[m].total, short = Math.max(0, need - have);
      if (short > 0) missing[m] = short;
      return {material: m, name, need, have, short, state: !(need > 0) ? 'none' : short > 0 ? 'short' : 'ok', text: costText(name, need, have)};
    });
    const reason = block(r.kind) || missingText(missing);
    return {kind: r.kind, key: String(i + 1), name: EQUIPMENT[r.kind].name, blurb: r.blurb, costs, can: !reason, reason};
  });
  const totals = RECIPE_MATERIALS.map((m): CraftTotalLine => {
    const name = itemDef(m).name, c = counts[m], where = whereFromText(c);
    return {material: m, name, total: c.total, where, text: `${name} ${c.total} — ${where}`};
  });
  return {rows, totals};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The markup (pure)

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The rows' markup (the list element's innerHTML). */
export function craftRowsHtml(m: CraftViewModel): string {
  return m.rows.map(r => `<div class="cv-row ${r.can ? 'cv-can' : 'cv-cant'}" data-kind="${r.kind}">`
    + `<div class="cv-key">${esc(r.key)}</div>`
    + `<div class="cv-what"><b class="cv-name">${esc(r.name)}</b><div class="cv-blurb">${esc(r.blurb)}</div></div>`
    + `<div class="cv-costs">${r.costs.map(c => `<div class="cv-cost ${c.state}">${esc(c.text)}</div>`).join('')}</div>`
    + `<div class="cv-do"><button class="cv-craft primary" type="button" data-kind="${r.kind}"${r.can ? '' : ' disabled'}>${CRAFT_VIEW_TEXT.craft} (${esc(r.key)})</button>`
    + `<div class="cv-why">${esc(r.reason)}</div></div>`
    + '</div>').join('');
}

/** The footer's markup: the two material totals and where they are. */
export function craftTotalsHtml(m: CraftViewModel): string {
  return m.totals.map(t => `<div class="cv-total" data-material="${t.material}"><b>${esc(t.name)} ${t.total}</b> <span>— ${esc(t.where)}</span></div>`).join('');
}

/** The whole panel (the root element's innerHTML). */
export function craftViewHtml(m: CraftViewModel | null, note = '', noteBad = false): string {
  const T = CRAFT_VIEW_TEXT;
  return `<div class="cv-panel">`
    + `<div class="cv-head"><b class="cv-title">${T.title}</b><span class="cv-live">${T.live}</span></div>`
    + `<div class="cv-list">${m ? craftRowsHtml(m) : ''}</div>`
    + `<div class="cv-foot">${m ? craftTotalsHtml(m) : ''}</div>`
    + `<div class="cv-note${noteBad ? ' refused' : ''}">${esc(note)}</div>`
    + `<div class="cv-actions"><span class="cv-help">${T.help}</span><button class="cv-close" type="button">${T.close}</button></div>`
    + '</div>';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Keys (pure)

/** What a keydown does while the recipe list is (or is not) open. */
export type CraftKey =
  | {kind: 'pass'} // not the view's: the game / browser handles it as usual (WASD still walks)
  | {kind: 'craft'; index: number} // 1–4: consumed, crafts that row
  | {kind: 'swallow'} // consumed, nothing else (auto-repeat; any other digit — never a quick slot)
  | {kind: 'close'} // E: consumed, closes the view
  | {kind: 'close-pass'}; // Tab / Esc / I: closes, then goes on (inventory / pause)

/** The view's key scope (pure; the bench's capture listener applies it). Nothing is taken while closed or while typing in a field. */
export function craftKeyAction(e: {code: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: unknown}, open: boolean, rows: number = RECIPES.length): CraftKey {
  if (!open || isTypingTarget(e.target)) return {kind: 'pass'};
  if (e.code === 'KeyE') return e.repeat ? {kind: 'swallow'} : {kind: 'close'};
  if (e.code === 'Tab' || e.code === 'Escape' || e.code === 'KeyI') return {kind: 'close-pass'};
  const d = digitOfCode(e.code);
  if (d !== null && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const n = Number(d);
    return !e.repeat && n >= 1 && n <= rows ? {kind: 'craft', index: n - 1} : {kind: 'swallow'};
  }
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

  constructor(private readonly host: CraftViewHost) {}

  get visible(): boolean {
    return this.shown;
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

  /** Redraw the rows and the totals from the host's model. */
  render(): void {
    const m = this.shown ? this.host.model() : null;
    if (!m) return;
    this.last = m;
    this.renders++;
    const root = this.root;
    if (!root) return; // no DOM (tests)
    const list = root.querySelector('.cv-list'), foot = root.querySelector('.cv-foot'), n = root.querySelector('.cv-note');
    if (list) list.innerHTML = craftRowsHtml(m);
    if (foot) foot.innerHTML = craftTotalsHtml(m);
    if (n) { n.textContent = this.note; n.classList.toggle('refused', this.noteBad); }
  }
}
