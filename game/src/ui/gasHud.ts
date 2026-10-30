// Task gasmask-breach-20261030 (lane GAS): the breach-gas HUD — built on first use inside #hud (no index.html markup), styles
// injected once, DOM writes only on change:
//  - #gas-tag: "TOXIC GAS" (red, unprotected) or "FILTERING" (teal, protected) above the quick slots while the eye is in gas
//    (from GAS.HUD_MIN), with a hint ("Put on your gas mask (Q)" / "No filter" — the hint text is the gas system's);
//  - #gas-vignette: a green-tinted damage vignette that pulses while the gas is hurting you (strength ∝ dps);
//  - #gas-haze: the fallback when the volumetric pass is not running (?fog=off / unsupported): a green screen haze ∝ the eye
//    concentration, so you never stand in gas you cannot see. Inserted FIRST in #hud: every HUD element (and a camera mask
//    layer inserted before it later) draws above it.

const CSS = `
#gas-haze { position: absolute; inset: 0; opacity: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(96, 132, 64, 0.55) 0%, rgba(70, 104, 46, 0.8) 70%, rgba(48, 74, 30, 0.92) 100%); transition: opacity 0.25s linear; }
#gas-vignette { position: absolute; inset: 0; opacity: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 42%, rgba(70, 140, 40, 0.7) 100%); }
#gas-vignette.on { animation: gas-pulse 1.3s ease-in-out infinite; }
@keyframes gas-pulse { 0%, 100% { filter: brightness(0.75); } 50% { filter: brightness(1.25); } }
#gas-tag { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); display: none; align-items: center; gap: 10px;
  background: rgba(20, 22, 24, 0.72); padding: 5px 12px; border-bottom: 2px solid var(--red, #c8402e); white-space: nowrap; }
#gas-tag.show { display: flex; }
#gas-tag .t { font-size: 13px; letter-spacing: 0.18em; color: var(--red, #c8402e); }
#gas-tag .h { font-size: 12.5px; color: var(--cream, #ece4cf); font-weight: 500; }
#gas-tag .h:empty { display: none; }
#gas-tag.safe { border-color: var(--teal, #4f9a8f); }
#gas-tag.safe .t { color: var(--teal, #4f9a8f); }
#gas-tag.hurt .t { animation: gas-blink 0.9s steps(2, start) infinite; }
@keyframes gas-blink { to { opacity: 0.45; } }`;

/** What the gas HUD shows this frame. */
export interface GasHudState {
  /** Eye concentration (0..1). */
  c: number;
  protected: boolean;
  /** Damage per second being applied (0 when protected / below the threshold). */
  dps: number;
  dpsMax: number;
  /** Shown from this concentration. */
  min: number;
  hint: string;
  /** The volumetric gas is not drawn (fallback haze). */
  haze: boolean;
}

export class GasHud {
  private tag: HTMLElement | null = null;
  private vig: HTMLElement | null = null;
  private hazeEl: HTMLElement | null = null;
  private key = '';
  /** Last shown state (QA / tests). */
  shown = {tag: '', hint: '', vignette: 0, haze: 0};

  private ensure(): boolean {
    if (this.tag) return true;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false; // node tests
    const host = document.querySelector('#hud');
    if (!host) return false;
    if (!document.querySelector('#gas-css')) {
      const st = document.createElement('style');
      st.id = 'gas-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const mk = (id: string, html = '') => { const el = document.createElement('div'); el.id = id; el.innerHTML = html; return el; };
    this.hazeEl = mk('gas-haze');
    host.insertBefore(this.hazeEl, host.firstChild);
    this.vig = mk('gas-vignette');
    const red = host.querySelector('#vignette');
    if (red) host.insertBefore(this.vig, red); else host.appendChild(this.vig);
    this.tag = mk('gas-tag', '<span class="t"></span><span class="h"></span>');
    host.appendChild(this.tag);
    return true;
  }

  update(s: GasHudState): void {
    const inGas = s.c >= s.min;
    const tag = !inGas ? '' : s.protected ? 'FILTERING' : 'TOXIC GAS';
    const hint = inGas ? s.hint : '';
    const vig = s.dps > 0 ? Math.round((0.3 + 0.55 * Math.min(1, s.dps / s.dpsMax)) * 20) / 20 : 0;
    const haze = s.haze ? Math.round(Math.min(0.62, s.c * 0.75) * 40) / 40 : 0;
    const key = `${tag}|${hint}|${vig}|${haze}|${s.dps > 0}`;
    if (key === this.key) return;
    this.key = key;
    this.shown = {tag, hint, vignette: vig, haze};
    if (!this.ensure()) return;
    const t = this.tag!;
    t.classList.toggle('show', !!tag);
    t.classList.toggle('safe', s.protected);
    t.classList.toggle('hurt', s.dps > 0);
    t.querySelector('.t')!.textContent = tag;
    t.querySelector('.h')!.textContent = hint;
    this.vig!.style.opacity = String(vig);
    this.vig!.classList.toggle('on', vig > 0);
    this.hazeEl!.style.opacity = String(haze);
  }

  /** Nothing shown (no gas world, leaving play). */
  clear(): void {
    this.update({c: 0, protected: false, dps: 0, dpsMax: 1, min: 1, hint: '', haze: false});
  }
}
