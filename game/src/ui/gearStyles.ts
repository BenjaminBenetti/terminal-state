// Iteration 16 (lane GEAR): styles of the inventory gear panel, the grounded-bag transfer view and the 'click to aim' prompt.
// Injected once from JS (no edits to the shared stylesheet / index.html); uses the game's CSS variables and .slot look.
// Task gameplay-feedback-20261111 (lane STORAGE): the pockets grids (inventory screen, bag view) and the bag's own grid take their
// columns from POCKET_GRID / BACKPACK_GRID (one more row each, the same 6 columns) — a column count without a static rule gets one.

import {POCKET_GRID} from '../items/inventory';
import {BACKPACK_GRID} from '../items/gear';

/**
 * Grid columns of the pockets / a backpack's slots (the shape constants: items/inventory.ts POCKET_GRID, items/gear.ts BACKPACK_GRID):
 * the inventory screen's pockets, and a .bv-gN rule for a bag-view column count the static rules below (4-7) do not have.
 */
export const gridRules = (): string => {
  const cols = (n: number) => `grid-template-columns: repeat(${n}, 1fr);`;
  const extra = [...new Set([POCKET_GRID.columns, BACKPACK_GRID.columns])].filter(n => n < 4 || n > 7);
  return `#inv-pack { ${cols(POCKET_GRID.columns)} }\n${extra.map(n => `#bagview .bv-g${n} { ${cols(n)} }\n`).join('')}`;
};

const CSS = `
#inventory.screen { align-items: safe center; } /* the taller panel (gear row, 18 pockets + a chest rig's 4) scrolls from its top on short screens */
#inv-gear-wrap { margin: 6px 0 2px; }
#inv-gear-wrap h3 { display: flex; align-items: baseline; gap: 10px; }
#inv-gear-wrap h3 .gear-sum { font-size: 12px; font-weight: 400; color: var(--cream-dim); letter-spacing: 0; text-transform: none; }
#inv-gear { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; } /* mask lane: + the face (gas mask) slot */
#inv-gear .slot { height: 70px; }
#inv-gear .slot .gslot { position: absolute; left: 5px; top: 3px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--teal); }
#inv-gear .slot .ghost { color: #3a4046; display: flex; }
#inv-gear .slot .ghost svg { width: 46px; height: 24px; }
#inv-gear .slot.worn-bag { background: #1d1c18; }
#inv-gear-note { font-size: 12.5px; color: var(--cream-dim); margin-top: 4px; min-height: 1.1em; }
#inv-gear-note b { color: var(--mustard); }
#inv-detail .fx.refused, #bagview .bv-note.refused { color: var(--red); font-weight: 700; }
.slot.gear-extra { border-style: dashed; }
#bagview { position: fixed; inset: 0; z-index: 45; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 92px; pointer-events: auto; cursor: default; }
#bagview.hidden { display: none; }
#bagview .bv-panel { width: min(920px, calc(100vw - 24px)); background: rgba(16, 18, 20, 0.9); border: 1px solid #3a3f44; border-top: 3px solid var(--mustard); padding: 10px 14px 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6); color: var(--cream); font-size: 13px; }
#bagview .bv-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 6px; }
#bagview .bv-head b { font-size: 15px; letter-spacing: 0.04em; }
#bagview .bv-live { color: var(--red); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; animation: bv-pulse 1.4s ease-in-out infinite; }
@keyframes bv-pulse { 50% { opacity: 0.55; } }
#bagview .bv-cols { display: grid; grid-template-columns: 1fr 26px 1fr; gap: 8px; align-items: start; }
#bagview .bv-arrow { align-self: center; text-align: center; color: var(--cream-dim); font-size: 18px; }
#bagview h4 { margin: 4px 0 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cream-dim); font-weight: 600; }
#bagview .slots { display: grid; gap: 6px; }
#bagview .bv-g5 { grid-template-columns: repeat(5, 1fr); }
#bagview .bv-g6 { grid-template-columns: repeat(6, 1fr); }
#bagview .bv-g4 { grid-template-columns: repeat(4, 1fr); }
#bagview .slot { height: 58px; font-size: 11px; }
#bagview .slot img.ico3d { height: 36px; }
#bagview .slot svg { width: 44px; height: 24px; }
#bagview .slot .nm { font-size: 10.5px; }
#bagview .slot .count { top: 3px; bottom: auto; font-size: 11px; }
#bagview .slot.filled { cursor: grab; touch-action: none; }
#bagview.dragging, #bagview.dragging .slot { cursor: grabbing; }
#bagview .bv-note { min-height: 1.2em; margin-top: 6px; color: var(--mustard); }
#bagview .bv-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
#bagview .bv-actions button { padding: 6px 12px; }
#bagview .bv-help { margin-top: 4px; font-size: 11.5px; color: var(--cream-dim); }
#bagview-ghost { position: fixed; left: -40px; top: -27px; width: 80px; height: 54px; z-index: 61; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(21, 23, 26, 0.88); border: 1px solid var(--mustard); color: var(--cream); font-size: 11px; }
#bagview-ghost img.ico3d { width: 70px; height: 34px; object-fit: contain; }
#bagview-ghost svg { width: 46px; height: 24px; }
#gear-resume { position: fixed; inset: 0; z-index: 44; display: flex; align-items: center; justify-content: center; cursor: crosshair; }
#gear-resume.hidden { display: none; }
#gear-resume span { padding: 8px 16px; background: rgba(20, 22, 24, 0.82); border: 1px solid var(--teal); color: var(--cream); font-size: 14px; }
/* Task office-overhaul-20261030 (lane INTERACT): HUD slot 6 (worn backpack) + G (grenade slot) after quick slots 1-5; the
   inventory's quick-slot row gains the grenade slot; the crosshair hold ring (hold E on a grounded bag to wear it). */
#hotbar .slot.bagslot { margin-left: 10px; }
#hotbar .slot.throwslot { margin-left: 4px; }
#hotbar .slot.throwslot .key, #inv-hotbar .slot[data-bar="throw"] .key { color: var(--teal); }
#hotbar .slot.vacant { opacity: 0.55; }
#hotbar .slot.vacant .nm { color: var(--cream-dim); }
#hotbar .slot .ghost, #inv-hotbar .slot .ghost, #bagview .slot .ghost { color: #4a5157; display: flex; }
#hotbar .slot .ghost svg { width: 46px; height: 24px; }
#inv-hotbar { grid-template-columns: repeat(7, 1fr); }
#inv-hotbar .slot[data-bar="throw"] { border-style: dashed; }
#inv-hotbar .slot[data-bar="throw"].filled { border-style: solid; }
/* Task knife-windup-20261030 (lane SLOT): the melee slot "~" in the grenade slot's look (teal key; dashed while empty in the
   inventory / bag view). It is the LAST element of each slot row (stable indices for Q / 1-5 / 6 / G) but shown left of quick
   slot 1, where the ~ key sits: on the HUD after the gas-mask cell Q (order -2), with the Q cell's separation before slot 1.
   It shrinks with the numbered cells inside the hotbar band (styles.css). */
#hotbar .slot.maskslot { order: -2; }
#hotbar .slot.meleeslot { order: -1; margin-right: 6px; }
#hotbar .slot.meleeslot .key, #inv-hotbar .slot[data-bar="melee"] .key, #bagview .slot[data-bar="melee"] .key { color: var(--teal); }
#inv-hotbar .slot[data-bar="melee"], #bagview .slot[data-bar="melee"] { order: -1; border-style: dashed; }
#inv-hotbar .slot[data-bar="melee"].filled, #bagview .slot[data-bar="melee"].filled { border-style: solid; }
#bagview .bv-g7 { grid-template-columns: repeat(7, 1fr); }
#bagview .slot .ghost svg { width: 40px; height: 22px; }
#hold-ring { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; pointer-events: none; opacity: 0; transition: opacity 0.08s linear; }
#hold-ring.show { opacity: 1; }
#hold-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
#hold-ring circle { fill: none; stroke-width: 3; }
#hold-ring .track { stroke: rgba(20, 22, 24, 0.55); }
#hold-ring .arc { stroke: var(--mustard); stroke-linecap: round; }
`;

let injected = false;

/** Adds the gear styles once (no-op without a DOM). */
export function ensureGearStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.id = 'gear-styles';
  el.textContent = CSS + gridRules(); // (lane STORAGE: + the pockets / bag grid columns from the shape constants)
  document.head.appendChild(el);
}
