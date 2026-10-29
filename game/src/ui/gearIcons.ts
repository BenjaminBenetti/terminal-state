// Iteration 16 (lane GEAR): inline SVG icons for gear items (same 64x32 silhouette style as ui/icons.ts). They are the
// fallback when the model-rendered icon (ui/itemIcons.ts) is missing, and the empty-slot hints of the gear panel.
import type {GearIconKey} from '../items/gear';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const GEAR_ICONS: Record<GearIconKey, string> = {
  // soft armor vest: shoulders, neck scoop, front panel
  vest: S(`<path d="M22 3h6l4 4 4-4h6l2 6v20H20V9z"/><rect x="25" y="12" width="14" height="12" rx="1" fill="${DARK}" opacity="0.4"/><rect x="20" y="25" width="24" height="2" fill="${DARK}" opacity="0.5"/>`),
  // chest rig: straps + a row of pouches
  rig: S(`<path d="M23 3h4l2 9h6l2-9h4l-2 11H25z"/><rect x="18" y="14" width="28" height="13" rx="1"/><path d="M25 14v13M32 14v13M39 14v13" stroke="${DARK}" stroke-width="1.5" opacity="0.6"/><rect x="19" y="16" width="26" height="3" fill="${DARK}" opacity="0.35"/>`),
  // daypack: rounded body, top handle, front pocket
  backpack: S(`<path d="M29 2h6v3h-6z"/><path d="M24 6h16a4 4 0 0 1 4 4v18a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V10a4 4 0 0 1 4-4z"/><rect x="25" y="17" width="14" height="9" rx="2" fill="${DARK}" opacity="0.4"/><path d="M24 12h16" stroke="${DARK}" stroke-width="1.4" opacity="0.5"/>`),
  // hard hat: dome + brim + ridge
  helmet: S(`<path d="M18 22a14 13 0 0 1 28 0z"/><rect x="12" y="22" width="40" height="4" rx="2"/><rect x="30" y="9" width="4" height="13" fill="${DARK}" opacity="0.35"/>`),
  // pair of work boots
  boots: S(`<path d="M14 6h8v14l8 3v5H12V8z"/><path d="M36 6h8v14l8 3v5H34V8z" opacity="0.75"/><rect x="12" y="26" width="18" height="2" fill="${DARK}" opacity="0.5"/><rect x="34" y="26" width="18" height="2" fill="${DARK}" opacity="0.5"/>`),
  // pair of gloves (fingers up)
  gloves: S(`<path d="M14 28V14l-3-4 2-1 3 3V5h2v8h1V3h2v10h1V5h2v10h1V8h2v12l-3 8z"/><path d="M38 28V14l-3-4 2-1 3 3V5h2v8h1V3h2v10h1V5h2v10h1V8h2v12l-3 8z" opacity="0.75"/>`),
};
