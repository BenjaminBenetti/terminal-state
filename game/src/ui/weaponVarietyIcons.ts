// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): inline SVG HUD glyphs for the twelve new weapons
// (items/weaponVarietyItems.ts), the same 64x32 silhouette style as ui/icons.ts (guns side-on, stock / grip at the left, muzzle to the
// right like the rifle / shotgun / pistol; melee weapons lying along X, grip at the left like the knife) — the HUD fallback while the
// rendered 3D icon (ui/itemIcons.ts, from the delivered model) is unavailable. Silhouettes only: no label or surface art.
import type {WeaponVarietyIconKey} from '../items/weaponVarietyItems';

const S = (body: string) => `<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true">${body}</svg>`;
const DARK = '#15171a';

export const WEAPON_VARIETY_ICONS: Record<WeaponVarietyIconKey, string> = {
  // compact SMG: folding wire stock, short receiver, long straight magazine ahead of the grip, short barrel
  hornet: S(`<rect x="5" y="11" width="11" height="2"/><rect x="5" y="15" width="11" height="2"/><rect x="4" y="11" width="2" height="6"/><rect x="16" y="10" width="26" height="7" rx="1"/><rect x="42" y="12" width="12" height="3"/><rect x="54" y="11.5" width="3" height="4"/><rect x="37" y="8" width="3" height="2"/><path d="M23 17h6l-2 8h-6z"/><rect x="32" y="17" width="5" height="12" rx="0.8"/>`),
  // long-slide target pistol: an extended slide past the frame, compensated muzzle, grip at the back
  longslide: S(`<rect x="10" y="9" width="44" height="6" rx="0.8"/><rect x="54" y="9.5" width="4" height="5"/><rect x="50" y="7" width="2" height="2"/><rect x="12" y="7.5" width="3" height="1.5"/><path d="M13 15h24v3H27l-2 2h-3l-2.5 9h-8l3-11h-1.5z"/><path d="M23 18h4l-1 3.5h-4z" fill="${DARK}" opacity="0.5"/>`),
  // bullpup carbine: the magazine behind the grip, the butt flush with the body, a short barrel and a carry optic
  stub: S(`<rect x="4" y="11" width="3" height="9" opacity="0.8"/><rect x="6" y="11" width="36" height="8" rx="1"/><rect x="42" y="13" width="14" height="3"/><rect x="56" y="12.5" width="3" height="4"/><rect x="22" y="7" width="12" height="3" rx="0.8"/><rect x="26" y="10" width="3" height="1"/><path d="M30 19h5l-1 7h-5z"/><path d="M14 19h6l1 8h-6z"/>`),
  // scoped DMR: long stock, receiver, a long barrel and a big scope on two rings
  overwatch: S(`<path d="M2 13h14l2-1h22v6H22l-4 4H8l-6 2z"/><rect x="40" y="13.5" width="21" height="2.5"/><rect x="19" y="5" width="19" height="4.5" rx="2"/><rect x="23" y="9.5" width="2" height="2.5"/><rect x="32" y="9.5" width="2" height="2.5"/><rect x="28" y="18" width="5" height="6" rx="0.8"/><path d="M20 18h4l-1 6h-4z"/>`),
  // side-by-side break action: a short stock, the action with two outside hammers, two barrels one over the other in profile
  coach_gun: S(`<path d="M2 16l14-4h8v6h-8l-12 6z"/><rect x="22" y="12" width="8" height="7" rx="1"/><rect x="22.5" y="9.5" width="2" height="2.5"/><rect x="26" y="9.5" width="2" height="2.5"/><rect x="30" y="11.5" width="30" height="2.5"/><rect x="30" y="14.5" width="30" height="2.5" opacity="0.8"/><rect x="32" y="17" width="10" height="2.5"/><rect x="24.5" y="19" width="1.5" height="3"/>`),
  // semi-auto box-magazine shotgun: a solid stock, a deep receiver, a thick barrel over the handguard, a wide box magazine
  thresher: S(`<path d="M2 14h12v6h-3L2 24z"/><rect x="14" y="11" width="24" height="8" rx="1"/><rect x="38" y="12" width="20" height="4"/><rect x="58" y="11.5" width="3" height="5"/><rect x="38" y="16" width="12" height="3"/><path d="M28 19h8l1 9h-8z"/><path d="M18 19h5l-2 7h-5z"/><rect x="24" y="8.5" width="6" height="2.5"/>`),
  // fire axe: a long haft with a wrapped grip; the head across its end — the flared, curved blade below, the pick above
  fire_axe: S(`<rect x="4" y="14.5" width="50" height="3.5" rx="1.5"/><rect x="4" y="14" width="10" height="4.5" rx="1.5" opacity="0.7"/><rect x="49" y="9" width="9" height="13" rx="1"/><path d="M49 21h9l4 7c-5 2-12 2-17 0z"/><path d="M50 9h7l-4-7z"/>`),
  // machete: a riveted grip, a short bolster, a long blade widening toward the tip
  machete: S(`<rect x="4" y="13" width="13" height="6" rx="2"/><circle cx="8" cy="16" r="1" fill="${DARK}" opacity="0.55"/><circle cx="13" cy="16" r="1" fill="${DARK}" opacity="0.55"/><rect x="17" y="12" width="2" height="8"/><path d="M19 13h30c6 0 11 1 13 3-3 3-8 4-13 4H19z"/>`),
  // sledgehammer: a long handle, a big block head
  sledgehammer: S(`<rect x="4" y="14.5" width="44" height="3.5" rx="1.5"/><rect x="4" y="14" width="9" height="4.5" rx="1.5" opacity="0.7"/><rect x="47" y="7" width="13" height="18" rx="1.5"/><rect x="47" y="10" width="13" height="2" fill="${DARK}" opacity="0.4"/><rect x="47" y="20" width="13" height="2" fill="${DARK}" opacity="0.4"/>`),
  // crowbar: a straight bar, the flat bent end at the left, the hook at the right
  crowbar: S(`<path d="M8 14.5l-5-2.5v2.5l4 3z"/><rect x="7" y="14.5" width="44" height="3" rx="1.5"/><path d="M50 14.5c6 0 9 3 9 7s-3 6-6 6h-2v-3h2c2 0 3-1 3-3s-2-4-6-4z"/>`),
  // aluminium bat: the knob at the left, a taped grip, the barrel thickening to the right
  slugger: S(`<rect x="4" y="13.5" width="3.5" height="5" rx="1"/><path d="M7.5 15h18l30-3.5c3 0 5 2 5 4.5s-2 4.5-5 4.5l-30-3.5h-18z"/><rect x="8" y="15" width="12" height="2" fill="${DARK}" opacity="0.4"/>`),
  // track shovel: a hand grip at the left, a long straight handle, the socket and a broad squared blade at the right
  track_shovel: S(`<rect x="2" y="12.5" width="4" height="7" rx="1.5"/><rect x="5" y="14.5" width="41" height="3" rx="1.5"/><path d="M46 14l6-2v8l-6-2z"/><path d="M52 8h8l2 8-2 8h-8z"/><path d="M54 11v10" stroke="${DARK}" stroke-width="1.2" opacity="0.4"/>`),
};
