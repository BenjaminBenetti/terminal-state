// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): THE END CREDITS' DOM — a subtle, legible column in
// the TOP-RIGHT of the viewport (world/reactor/credits.ts drives it; the rules are world/reactor/creditsLogic.ts).
//  - Placement: below the toast stack (#toasts: right 24 px, top 20 px) and above the light / weapon panels (bottom right); safe-area
//    insets respected; narrow enough to clear the centred pause panel on common widths. Non-blocking: pointer-events none except the end
//    card; no overlay, no camera / pointer-lock change.
//  - Motion: the strip's offset is CSS (`--rc-k` = progress 0..1 set per frame; no layout reads): the title enters at the window's
//    foot, the end card settles CREDITS.restPx below its top (creditsLogic.ts stripOffsetPx is the same formula). Top / bottom fades.
//  - Layout (task studio-alpha-reactor-ending-polish-20261104-034806-01): formal grouped sections — a heading, its rows tighter (role
//    over name; the row's text is its display string "Role — Name", the dash visually hidden), a gap after each section. Every block has
//    the exact height creditsLogic.ts creditBlocks sums (CREDITS_CONTENT_PX), so the CSS travel matches the logic's.
//  - The end card ("Thank you for playing" + "Main Menu") stays until used. It sits above the pause screen's dim (z-index 21 > .screen
//    20) so Esc (the pointer released) + a click reaches it; Enter while playing is read by the runtime (input.pressed); touch = click.
//  - Visible while playing; while paused only the end card (once reached); hidden in every other state.

import {CREDITS, CREDITS_CONTENT_PX, CREDITS_TITLE, CREDIT_SECTIONS, END_CARD} from '../world/reactor/creditsLogic';

export interface CreditsViewHandlers {
  /** The end card's button (click / tap / keyboard on the focused button). */
  onMainMenu(): void;
}

/** 'play': the column; 'paused': only the end card once reached; 'hidden': nothing. */
export type CreditsMode = 'play' | 'paused' | 'hidden';

const CSS_ID = 'reactor-credits-css';
const FADE_PX = 36;

function css(): string {
  const {restPx: r, titlePx, headingPx, rowPx, sectionGapPx} = CREDITS;
  const mask = `linear-gradient(to bottom,transparent 0,#000 ${FADE_PX}px,#000 calc(100% - ${FADE_PX}px),transparent 100%)`;
  return `#reactor-credits{--rc-h:clamp(160px,calc(100vh - 340px),${CREDITS.windowPx}px);position:absolute;z-index:21;`
    + 'top:calc(env(safe-area-inset-top,0px) + 132px);right:calc(env(safe-area-inset-right,0px) + 24px);'
    + `width:clamp(220px,calc(50vw - 396px),280px);height:var(--rc-h);overflow:hidden;pointer-events:none;text-align:right;`
    + `color:var(--cream,#ece4cf);font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,.85);-webkit-mask-image:${mask};mask-image:${mask}}`
    + `#reactor-credits .rc-strip{position:absolute;left:0;right:0;top:0;padding-right:2px;will-change:transform;`
    + `transform:translateY(calc(var(--rc-h) - var(--rc-k,0) * (var(--rc-h) + ${CREDITS_CONTENT_PX}px - ${r}px)))}`
    + `#reactor-credits .rc-ttl{height:${titlePx}px;overflow:hidden}`
    + '#reactor-credits .rc-title{font-size:19px;letter-spacing:.12em;text-transform:uppercase;color:var(--mustard,#d9a520)}'
    + `#reactor-credits .rc-sec{padding-bottom:${sectionGapPx}px}`
    + `#reactor-credits .rc-h{height:${headingPx}px;overflow:hidden;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--mustard,#d9a520)}`
    + `#reactor-credits .rc-row{position:relative;height:${rowPx}px;overflow:hidden;white-space:nowrap}`
    + '#reactor-credits .rc-role{display:block;font-size:11.5px;font-weight:500;letter-spacing:.04em;color:var(--cream-dim,#b9b19c)}'
    + '#reactor-credits .rc-sep{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'
    + '#reactor-credits .rc-name{display:block;margin-top:2px;font-size:15px;line-height:1.25;color:var(--cream,#ece4cf)}'
    + '#reactor-credits .rc-card{display:inline-block;max-width:100%;text-align:right;background:rgba(20,22,24,.8);'
    + 'border-right:4px solid var(--mustard,#d9a520);padding:12px 14px 10px;text-shadow:none}'
    + '#reactor-credits .rc-thanks{font-size:19px;letter-spacing:.04em;color:var(--cream,#ece4cf)}'
    + '#reactor-credits .rc-menu{margin-top:10px;visibility:hidden}'
    + '#reactor-credits .rc-hint{margin-top:6px;font-size:11.5px;font-weight:500;color:var(--cream-dim,#b9b19c);visibility:hidden}'
    + '#reactor-credits .rc-error{margin-top:6px;font-size:12.5px;line-height:1.35;color:var(--red,#c2463a);white-space:normal}'
    + `#reactor-credits.rc-end{height:auto;overflow:visible;-webkit-mask-image:none;mask-image:none}`
    + `#reactor-credits.rc-end .rc-strip{position:static;transform:none;padding-top:${r}px}`
    + '#reactor-credits.rc-end .rc-ttl,#reactor-credits.rc-end .rc-sec{display:none}'
    + '#reactor-credits.rc-end .rc-card{pointer-events:auto}'
    + '#reactor-credits.rc-end .rc-menu,#reactor-credits.rc-end .rc-hint{visibility:visible}'
    + '#reactor-credits.rc-hidden{display:none}';
}

function ensureCss(doc: Document): void {
  if (doc.querySelector(`#${CSS_ID}`)) return;
  const st = doc.createElement('style');
  st.id = CSS_ID;
  st.textContent = css();
  (doc.head ?? doc.body)?.appendChild(st);
}

export class CreditsView {
  readonly root: HTMLElement;
  readonly strip: HTMLElement;
  readonly card: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly error: HTMLElement;
  private ended = false;
  private mode: CreditsMode = 'hidden';
  private k = -1;

  constructor(private readonly doc: Document, parent: HTMLElement, handlers: CreditsViewHandlers) {
    ensureCss(doc);
    const el = (tag: string, cls: string, text?: string): HTMLElement => {
      const e = doc.createElement(tag);
      e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const add = (p: HTMLElement, ...c: HTMLElement[]): void => { for (const x of c) p.appendChild(x); };
    const root = el('div', 'rc-hidden');
    root.id = 'reactor-credits';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Credits');
    const strip = el('div', 'rc-strip');
    const head = el('div', 'rc-ttl');
    head.appendChild(el('div', 'rc-title', CREDITS_TITLE));
    strip.appendChild(head);
    // (creditsLogic.ts creditBlocks: the title, then per section its heading, its rows and the gap after it — the section's padding)
    for (const sec of CREDIT_SECTIONS) {
      const box = el('div', 'rc-sec');
      box.appendChild(el('div', 'rc-h', sec.heading));
      for (const row of sec.rows) {
        const e = el('div', 'rc-row');
        add(e, el('span', 'rc-role', row.role), el('span', 'rc-sep', ' — '), el('span', 'rc-name', row.name));
        box.appendChild(e);
      }
      strip.appendChild(box);
    }
    const card = el('div', 'rc-card');
    card.setAttribute('aria-live', 'polite');
    const btn = el('button', 'primary rc-menu', END_CARD.button) as HTMLButtonElement;
    btn.type = 'button';
    btn.id = 'btn-credits-menu';
    btn.addEventListener('click', e => { e.preventDefault?.(); if (this.ended) handlers.onMainMenu(); });
    const err = el('div', 'rc-error');
    err.hidden = true;
    add(card, el('div', 'rc-thanks', END_CARD.thanks), btn, el('div', 'rc-hint', END_CARD.hint), err);
    strip.appendChild(card);
    root.appendChild(strip);
    parent.appendChild(root);
    this.root = root; this.strip = strip; this.card = card; this.button = btn; this.error = err;
  }

  /** The scroll's progress 0..1 (CSS does the offset). */
  setProgress(k: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
    if (Math.abs(v - this.k) < 1e-4) return;
    this.k = v;
    this.root.style.setProperty('--rc-k', v.toFixed(5));
  }

  /** The end card at rest (stays until used): the lines go, the button and its hint show. */
  showEnd(): void {
    this.ended = true;
    this.setProgress(1);
    this.root.classList.add('rc-end');
    this.setMode(this.mode);
  }

  get atEnd(): boolean {
    return this.ended;
  }

  setMode(mode: CreditsMode): void {
    this.mode = mode;
    const show = mode === 'play' || (mode === 'paused' && this.ended);
    this.root.classList.toggle('rc-hidden', !show);
    // back in play (pointer locked): a button focused in the pause screen must not also take the Enter the runtime reads
    if (mode === 'play' && this.doc.activeElement === this.button) this.button.blur();
  }

  get visible(): boolean {
    return !this.root.classList.contains('rc-hidden');
  }

  /** The card's error line (null: none). */
  setError(text: string | null): void {
    this.error.textContent = text ?? '';
    this.error.hidden = !text;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** The view in the page (#app, else body); null without a DOM (Node: the runtime runs on its state alone). */
export function mountCreditsView(handlers: CreditsViewHandlers): CreditsView | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const parent = (document.querySelector('#app') as HTMLElement | null) ?? document.body;
  if (!parent) return null;
  return new CreditsView(document, parent, handlers);
}
