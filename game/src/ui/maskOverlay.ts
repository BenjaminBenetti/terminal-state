// Task gasmask-breach-20261030 (mask lane): the CAMERA GAS MASK — what you see while the mask is on your face.
//
// A plain DOM / SVG layer inserted as the FIRST child of #hud (pointer-events none), so the vitals, hotbar, prompts, toasts,
// crosshair, hold ring and the debug overlay (#perf-overlay, fixed z 80) all stay above it. No render pass, no renderer or
// material change: one static full-viewport SVG (preserveAspectRatio none, so the visor always frames the screen) that the
// compositor slides with a CSS transform.
//  - a dark rubber bezel (vertical rubber gradient, a lighter retaining rim drawn in screen pixels) framing ONE wide visor with
//    rounded corners and a slight nose-bridge dip in its lower edge;
//  - layered, lightly tinted glass inside the visor: a grey-green tint that is fully clear over the middle (the crosshair and
//    the aim area stay untouched) and builds toward the rim, faint diagonal reflections in the upper corners, soft edge
//    condensation along the rim and in the lower corners;
//  - don / doff: the mask slides up onto the face (translateY + a slight scale) following GasMaskSystem's transition progress
//    (`cover` 0..1, eased), and back down; hidden at 0;
//  - the low / empty filter tone tints the visor edge (amber / pulsing red) on its own small layer (opacity only).
// Writes the DOM only when the rounded cover / tone change.

/** Visor-edge warning tone: ok, low filter (amber), empty filter on the face (red, pulsing). */
export type MaskTone = 'ok' | 'low' | 'empty';

/** Visor outline in a 1000 x 1000 box (stretched to the viewport): rounded corners, the nose-bridge dip at the bottom centre. */
export const VISOR_PATH = 'M210 92H790C880 92 932 142 936 232V636C936 758 880 848 760 862C662 872 592 852 546 814C524 796 476 796 454 814'
  + 'C408 852 338 872 240 862C120 848 64 758 64 636V232C68 142 120 92 210 92Z';

const CSS = `
#mask-view { position: absolute; inset: 0; overflow: hidden; pointer-events: none; visibility: hidden; }
#mask-view.show { visibility: visible; }
#mask-view .gm-face { position: absolute; inset: 0; transform-origin: 50% 100%; will-change: transform; }
#mask-view svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#mask-view .gm-warn { opacity: 0; transition: opacity 0.35s ease-out; will-change: opacity; }
#mask-view .gm-warn path { stroke: rgba(214, 162, 40, 0.75); }
#mask-view.low .gm-warn { opacity: 0.65; }
#mask-view.empty .gm-warn { opacity: 0.85; animation: gm-pulse 1.1s ease-in-out infinite; }
#mask-view.empty .gm-warn path { stroke: rgba(210, 52, 38, 0.85); }
@keyframes gm-pulse { 50% { opacity: 0.35; } }
`;

const SVG_GLASS = `<svg class="gm-glass" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
<defs>
  <clipPath id="gm-visor"><path d="${VISOR_PATH}"/></clipPath>
  <radialGradient id="gm-tint" cx="500" cy="470" r="560" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="rgb(150,172,148)" stop-opacity="0"/><stop offset="0.4" stop-color="rgb(150,172,148)" stop-opacity="0"/>
    <stop offset="0.72" stop-color="rgb(138,160,132)" stop-opacity="0.07"/><stop offset="1" stop-color="rgb(116,138,108)" stop-opacity="0.2"/>
  </radialGradient>
  <linearGradient id="gm-wash" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="rgb(170,190,170)" stop-opacity="0.05"/><stop offset="0.3" stop-color="rgb(170,190,170)" stop-opacity="0"/>
    <stop offset="0.7" stop-color="rgb(120,140,110)" stop-opacity="0"/><stop offset="1" stop-color="rgb(120,140,110)" stop-opacity="0.07"/>
  </linearGradient>
  <radialGradient id="gm-fog" cx="500" cy="480" r="590" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#e2ebe2" stop-opacity="0"/><stop offset="0.74" stop-color="#e2ebe2" stop-opacity="0"/>
    <stop offset="0.9" stop-color="#e2ebe2" stop-opacity="0.07"/><stop offset="1" stop-color="#eef3ee" stop-opacity="0.17"/>
  </radialGradient>
  <radialGradient id="gm-drop"><stop offset="0" stop-color="#eef3ee" stop-opacity="0.13"/><stop offset="1" stop-color="#eef3ee" stop-opacity="0"/></radialGradient>
  <linearGradient id="gm-shine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.075"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="gm-rubber" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#171a19"/><stop offset="0.45" stop-color="#0c0e0d"/><stop offset="1" stop-color="#1b1e1c"/>
  </linearGradient>
</defs>
<g clip-path="url(#gm-visor)">
  <rect x="0" y="0" width="1000" height="1000" fill="url(#gm-tint)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#gm-wash)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#gm-fog)"/>
  <ellipse cx="170" cy="790" rx="170" ry="80" fill="url(#gm-drop)"/><ellipse cx="830" cy="790" rx="170" ry="80" fill="url(#gm-drop)"/>
  <ellipse cx="500" cy="840" rx="120" ry="40" fill="url(#gm-drop)"/>
  <polygon points="150,110 330,110 205,470 112,470" fill="url(#gm-shine)"/>
  <polygon points="700,108 758,108 640,372 604,372" fill="url(#gm-shine)" opacity="0.7"/>
</g>
<path d="M-20 -20H1020V1020H-20Z${VISOR_PATH}" fill="url(#gm-rubber)" fill-rule="evenodd"/>
<path d="${VISOR_PATH}" fill="none" stroke="#2c312e" stroke-width="7" vector-effect="non-scaling-stroke"/>
<path d="${VISOR_PATH}" fill="none" stroke="rgba(150,160,152,0.22)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
</svg>`;

const SVG_WARN = `<svg class="gm-warn" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
<path d="${VISOR_PATH}" fill="none" stroke-width="9" vector-effect="non-scaling-stroke"/></svg>`;

let styled = false;
function ensureStyles(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const el = document.createElement('style');
  el.id = 'mask-view-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const ease = (c: number) => 1 - (1 - c) ** 3;

export class MaskOverlay {
  private el: HTMLElement | null = null;
  private face: HTMLElement | null = null;
  private key = '';
  /** Last cover written (0..1; QA / tests). */
  shown = 0;
  tone: MaskTone = 'ok';

  /** Creates the layer as the first child of #hud (no-op without a DOM / #hud). */
  mount(): boolean {
    if (this.el) return true;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false; // Node (no / canvas-only DOM)
    const host = document.querySelector('#hud');
    if (!host) return false;
    ensureStyles();
    const el = document.createElement('div');
    el.id = 'mask-view';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<div class="gm-face">${SVG_GLASS}${SVG_WARN}</div>`;
    host.insertBefore(el, host.firstChild);
    this.el = el;
    this.face = el.querySelector('.gm-face');
    return true;
  }

  /** The mask's cover (0 off the face .. 1 on) and the visor-edge tone; writes only on change. */
  set(cover: number, tone: MaskTone): void {
    const c = Math.max(0, Math.min(1, cover));
    const key = `${Math.round(c * 1000)}|${tone}`;
    if (key === this.key) return;
    this.key = key;
    this.shown = c;
    this.tone = tone;
    if (!this.mount() || !this.el) return;
    const e = ease(c);
    this.el.classList.toggle('show', c > 0);
    this.el.classList.toggle('low', tone === 'low');
    this.el.classList.toggle('empty', tone === 'empty');
    if (this.face) this.face.style.transform = c >= 1 ? 'none' : `translateY(${((1 - e) * 108).toFixed(2)}%) scale(${(1 + 0.12 * (1 - e)).toFixed(4)})`;
  }
}
