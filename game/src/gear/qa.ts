// Iteration 16 (lane GEAR): QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks of gear and
// the deployable backpack. They drive the same code paths as the keys (6 / click / E) and the transfer view.
import type {Game} from '../game';
import type {AnyRef} from '../items/inventory';
import {GEAR_SLOTS} from '../items/gear';

const ref = (spec: string): AnyRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as AnyRef['bar'], index: Number(n)} as AnyRef;
};

export function gearQaApi(game: Game) {
  const sys = () => game.gear;
  return {
    /** Gear / bag state: worn items, readied, view open, bags in the section, aimed bag, mods, pockets. */
    gear: () => ({...sys().qa(), mods: {...game.mods}, pockets: game.inv.pack.length, refusal: game.inv.refusal?.text ?? null}),
    /** Give one gear item (worn at once when its slot is empty, else pocketed; a second backpack is refused). */
    gearGive: (itemId: string) => {
      const st = game.inv.makeStack(itemId, 1);
      const left = game.inv.add(st);
      const at = game.inv.find(st.uid);
      game.syncHeld();
      return {left, at: at ? (at.bar === 'gear' ? `gear:${GEAR_SLOTS[at.index]}` : `${at.bar}:${at.index}`) : null};
    },
    /** 6 (ready) then a left click (set it down): null = placed, else the refusal text. */
    bagPlace: (): string | null => {
      const g = sys();
      if (!g.readied && !g.ready()) return 'no backpack / hands busy';
      const spot = g.placeSpot();
      if (typeof spot === 'string') { g.cancelReady(true); return spot; }
      return g.placeReadied() ? null : 'refused';
    },
    /** Open the nearest grounded bag within 2.3 m (as E would on an aimed bag). */
    bagOpen: (): boolean => {
      const g = sys(), p = game.player;
      const b = [...g.bags].sort((a, c) => Math.hypot(a.pose.x - p.x, a.pose.z - p.z) - Math.hypot(c.pose.x - p.x, c.pose.z - p.z))[0];
      return !!b && Math.hypot(b.pose.x - p.x, b.pose.z - p.z) < 2.3 && g.open(b);
    },
    /** Click-transfer in the open view ('pack:0', 'hotbar:2', 'bag:3'); returns the moved count. */
    bagQuick: (spec: string): number => sys().bagView.quick(ref(spec)),
    /** Drag-move in the open view; returns the move result. */
    bagMove: (from: string, to: string, count?: number): string => sys().bagView.move(ref(from), ref(to), count),
    /** "Wear it" in the open view. */
    bagWear: (): boolean => sys().wear(),
    /** Close the open view (as the Close button). */
    bagClose: (): void => sys().close('user'),
  };
}
