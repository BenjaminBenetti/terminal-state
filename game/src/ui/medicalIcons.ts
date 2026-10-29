// Iteration 16 (lane INJURY): inline SVG icons for limb-treatment items (same 64x32 silhouette style as ui/icons.ts). They are the
// fallback when the rendered 3D icon (ui/itemIcons.ts) is missing, and the HUD hotbar / prompt / drag ghost use them the same way.
import type {MedicalIconKey} from '../items/medical';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const MEDICAL_ICONS: Record<MedicalIconKey, string> = {
  // rolled splint seen from the side: a roll (spiral end at the left) with two straps around it
  legsplint: S(`<rect x="16" y="6" width="34" height="20" rx="3"/><ellipse cx="16" cy="16" rx="6" ry="10"/><path d="M16 9a5 7 0 1 1 0 14a3 4.5 0 1 1 0-9" fill="none" stroke="${DARK}" stroke-width="1.6" opacity="0.55"/><rect x="24" y="5" width="4" height="22" fill="${DARK}" opacity="0.5"/><rect x="39" y="5" width="4" height="22" fill="${DARK}" opacity="0.5"/>`),
  // flat packet: triangle sling printed on it and the wrap roll bulge at the right
  armsling: S(`<rect x="8" y="7" width="48" height="19" rx="2"/><path d="M14 11h22l-11 12z" fill="${DARK}" opacity="0.5"/><ellipse cx="46" cy="16.5" rx="6" ry="6.5" fill="${DARK}" opacity="0.38"/><ellipse cx="46" cy="16.5" rx="2.4" ry="2.6"/><rect x="8" y="5" width="48" height="3" opacity="0.7"/>`),
  // zipped pouch with a handle and a cross patch
  traumakit: S(`<path d="M10 10h44l2 4v13H8V14z"/><rect x="24" y="5" width="16" height="4" rx="1.5" opacity="0.8"/><path d="M28 13h8v4h4v6h-4v4h-8v-4h-4v-6h4z" fill="${DARK}" opacity="0.6"/><rect x="9" y="12.5" width="46" height="1.4" fill="${DARK}" opacity="0.45"/>`),
};
