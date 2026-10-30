// Iteration 16 (lane GEAR): QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks of gear and
// the deployable backpack. They drive the same code paths as the keys (6 / click / E) and the transfer view.
// Task office-overhaul-20261030 (lane INTERACT): + the backpack slot (6 = held in front), the E tap / hold on a grounded bag
// (real Input keys: E down for N seconds, released by a timer), the grenade slot / flares (G), the bathroom stalls
// (world/stalls.ts stallQaApi). Short serial spot checks only (root CLAUDE.md).
import * as THREE from 'three';
import type {Game} from '../game';
import {THROW_REF, type AnyRef} from '../items/inventory';
import {GEAR_SLOTS} from '../items/gear';
import {stallQaApi} from '../world/stalls'; // Task office-overhaul-20261030 (INTERACT, #13): stalls(), stallOpen(i?), stallEnter(i?), stallSpec()

const ref = (spec: string): AnyRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as AnyRef['bar'], index: Number(n)} as AnyRef;
};

export function gearQaApi(game: Game) {
  const sys = () => game.gear;
  return {
    ...stallQaApi(game), // Task office-overhaul-20261030 (INTERACT, #13)
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
    // --- Task office-overhaul-20261030 (lane INTERACT) ---------------------------------------------------------------
    /** 6 (as the key): ready the worn backpack — the HUD slot 6 is selected and the bag is held in front (viewmodel item). */
    bagSlot: () => {
      const ok = sys().readied || sys().ready();
      return {ok, readied: sys().readied, held: game.viewmodel?.heldItem ?? null, hudSlot6: typeof document !== 'undefined' ? document.querySelector('#hotbar .slot.bagslot')?.className ?? null : null};
    },
    /** Aim the camera at the nearest grounded bag (within `maxDist`, default 3 m) so E acts on it; returns its id or null. */
    bagAim: (maxDist = 3): string | null => {
      const p = game.player;
      const b = [...sys().bags].sort((a, c) => Math.hypot(a.pose.x - p.x, a.pose.z - p.z) - Math.hypot(c.pose.x - p.x, c.pose.z - p.z))[0];
      if (!b || Math.hypot(b.pose.x - p.x, b.pose.z - p.z) > maxDist) return null;
      const eye = game.camera.getWorldPosition(new THREE.Vector3()), d = b.centre.sub(eye);
      p.yaw = Math.atan2(-d.x, -d.z);
      p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      return b.id;
    },
    /**
     * Hold E for `seconds` through the real Input (keydown state + a press; released by a timer): < 0.5 s opens the aimed
     * grounded bag on the release, >= 0.5 s picks it up and wears it. Resolves shortly after the release with the gear state.
     */
    bagHoldE: (seconds = 0.7): Promise<unknown> => new Promise(resolve => {
      const inp = game.input;
      inp.keys.add('KeyE');
      inp.pressed.add('KeyE');
      setTimeout(() => {
        inp.keys.delete('KeyE');
        setTimeout(() => resolve({...sys().qa(), mods: {...game.mods}, pockets: game.inv.pack.length, refusal: game.inv.refusal?.text ?? null}), 250);
      }, Math.max(16, seconds * 1000));
    }),
    /** Give `n` flares (the grenade slot fills first); where they went and the grenade slot's content. */
    flareGive: (n = 10) => {
      const st = game.inv.makeStack('flare', n);
      st.count = n;
      const left = game.inv.add(st);
      game.syncHeld();
      const t = game.inv.get(THROW_REF);
      return {left, total: game.inv.count('flare'), grenadeSlot: t ? `${t.itemId} x${t.count}` : null};
    },
    /** The grenade slot (G), flares carried / burning, and whether a G hold is readying one. */
    throwSlot: () => {
      const t = game.inv.get(THROW_REF);
      return {slot: t ? {itemId: t.itemId, count: t.count} : null, flares: game.inv.count('flare'), burning: game.flares.burningCount, readying: game.flareHold.active ? game.flareHold.source : null};
    },
  };
}
