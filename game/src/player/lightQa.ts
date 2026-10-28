// Iteration 12 (LIGHT): ?qa=1 hooks for the battery / body glow / flare checks (installed by qa.ts; never in normal play).
// light() reads state. DEBUG helpers (qa prefix) exist only so a scripted browser check can reach the flicker band, an empty
// battery or a flare throw without a long playthrough: qaSetBattery(charge), qaGiveItem(id, count). Throws use the real T key.

import type {Game} from '../game';
import {itemDef} from '../items/items';

export function lightQaApi(game: Game) {
  return {
    light: () => {
      const b = game.torch.battery;
      return {
        battery: {charge: +b.charge.toFixed(4), percent: b.percent, on: b.on, died: b.died, output: +b.output.toFixed(3), emitting: b.emitting, flicker: +b.flicker.toFixed(3), dipping: b.dipping, stats: {...b.stats}},
        spotIntensity: +game.torch.spot.intensity.toFixed(2),
        glow: {intensity: game.torch.glow.intensity, distance: game.torch.glow.distance, color: game.torch.glow.color.getHexString(), pos: game.torch.glow.position.toArray().map(v => +v.toFixed(2))},
        flares: game.flares.qa(),
        inventory: {battery: game.inv.count('battery'), flare: game.inv.count('flare')},
        sources: game.lightSources.list.map(s => ({id: s.id, kind: s.kind, active: s.active, level: s.level, intensity: +s.intensity.toFixed(3), attractRange: +s.attractRange.toFixed(1),
          at: [s.x, s.y, s.z].map(v => +v.toFixed(2)), spot: s.spot ? [s.spot.x, s.spot.y, s.spot.z].map(v => +v.toFixed(2)) : null})),
        attracting: game.lightSources.attracting().map(s => s.kind),
      };
    },
    /** DEBUG: set the flashlight charge (0..1), e.g. 0.12 to see the flicker band, 0 for a flat battery. */
    qaSetBattery: (charge: number) => {
      const b = game.torch.battery;
      b.charge = Math.max(0, Math.min(1, charge));
      if (b.charge <= 0) { b.on = false; b.died = true; }
      return {charge: b.charge, on: b.on};
    },
    /** DEBUG: put `count` of an item into the inventory (what did not fit is returned). */
    qaGiveItem: (itemId: string, count = 1) => {
      itemDef(itemId);
      const left = game.inv.add(game.inv.makeStack(itemId, count));
      game.syncHeld();
      return {itemId, given: count - left, left};
    },
  };
}
