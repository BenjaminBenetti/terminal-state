// Task reactor-build-20261101 (lane AIR): the Reactor's compact depth / air line ("Tier 3 · Zone 2 · air clearing 60 %") — built on
// first use inside the objective panel (#objective, else #hud; no index.html markup), styled like the gas HUD (ui/gasHud.ts: the
// dark pill, letter-spaced caps, red = toxic, teal = clear), DOM writes only on change. Shown only while a Reactor is built (the
// runtime clears it on every other level).

const CSS = `
#reactor-air { display: none; margin-top: 6px; padding: 3px 9px; background: rgba(20, 22, 24, 0.72); border-left: 2px solid var(--red, #c8402e);
  font-size: 11.5px; letter-spacing: 0.14em; color: var(--cream, #ece4cf); white-space: nowrap; width: max-content; }
#reactor-air.show { display: block; }
#reactor-air.clearing { border-color: #c9b04a; }
#reactor-air.clear { border-color: var(--teal, #4f9a8f); }
#reactor-air .k { color: #b8c06a; }
#reactor-air.clear .k { color: var(--teal, #4f9a8f); }
#reactor-air.toxic .k { color: var(--red, #c8402e); }`;

/** Tone of the line: toxic (uncleared gas), clearing (fans running), clear (cleared / clean air). */
export type AirTone = 'toxic' | 'clearing' | 'clear';

export class ReactorAirHud {
  private el: HTMLElement | null = null;
  private key = '';
  /** Last shown text / tone (QA / tests; '' = hidden). */
  shown = {text: '', tone: '' as AirTone | ''};

  private ensure(): boolean {
    if (this.el) return true;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false; // node tests
    const host = document.querySelector('#objective') ?? document.querySelector('#hud');
    if (!host) return false;
    if (!document.querySelector('#reactor-air-css')) {
      const st = document.createElement('style');
      st.id = 'reactor-air-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'reactor-air';
    el.innerHTML = '<span class="p"></span><span class="k"></span>';
    host.appendChild(el);
    this.el = el;
    return true;
  }

  /** `place` = "Tier 3 · Zone 2 · ", `status` = "air clearing 60 %" (the coloured part); empty place + status = hidden. */
  update(place: string, status: string, tone: AirTone): void {
    const key = `${place}|${status}|${tone}`;
    if (key === this.key) return;
    this.key = key;
    const show = !!(place || status);
    this.shown = {text: show ? `${place}${status}` : '', tone: show ? tone : ''};
    if (!this.ensure()) return;
    const el = this.el!;
    el.classList.toggle('show', show);
    el.classList.toggle('toxic', tone === 'toxic');
    el.classList.toggle('clearing', tone === 'clearing');
    el.classList.toggle('clear', tone === 'clear');
    el.querySelector('.p')!.textContent = place;
    el.querySelector('.k')!.textContent = status;
  }

  /** Hidden (another level, leaving the Reactor). */
  clear(): void {
    this.update('', '', 'clear');
  }
}
