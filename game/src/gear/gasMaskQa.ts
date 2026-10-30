// Task gasmask-breach-20261030 (mask lane): QA hooks (spread into window.__LL through gear/qa.ts) for SHORT serial browser spot
// checks of the gas mask. maskToggle() presses the very same path as Q (GasMaskSystem.press).
import type {Game} from '../game';
import {FILTER_LIFE_S} from '../items/gear';
import {GAS_MASK} from './gasMask';

export function gasMaskQaApi(game: Game) {
  const report = () => ({...game.gasMask.qa(), hudQ: typeof document !== 'undefined' ? document.querySelector('#hotbar .slot.maskslot')?.className ?? null : null});
  return {
    /** Mask state: off / donning / on / doffing, on, protects, fitted filter seconds + fraction, spares, tone, overlay cover. */
    mask: () => report(),
    /**
     * Give a gas mask with `filterFrac` (0..1, default 0.5) of one filter fitted: worn at once (equipped, OFF the face) when the
     * face slot is empty, else pocketed. Where it went.
     */
    maskGive: (filterFrac = 0.5) => {
      const st = game.inv.makeStack('gas_mask', 1);
      st.filter = Math.max(0, Math.min(1, filterFrac)) * FILTER_LIFE_S;
      const left = game.inv.add(st);
      const at = game.inv.find(st.uid);
      game.syncHeld();
      return {left, at: at ? `${at.bar}:${at.index}` : null, filterS: st.filter};
    },
    /** Give `n` spare filters (pockets first). Spares now carried where the mask can reach them. */
    filterGive: (n = 2) => {
      const st = game.inv.makeStack(GAS_MASK.filterItem, n);
      st.count = Math.max(1, Math.min(n, st.count));
      const left = game.inv.add(st);
      return {left, spares: game.inv.count(GAS_MASK.filterItem)};
    },
    /** Q: the same press path as the key (arbitration included); what it did and the state after. */
    maskToggle: () => ({result: game.gasMask.press(), ...report()}),
  };
}
