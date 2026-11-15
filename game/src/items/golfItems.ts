// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf event's two items — the PUTTER (a light
// melee club, weapons/putter.ts) and the GOLF BALL (a loose physics ball, physics/golfBall.ts). items.ts spreads them into ITEMS after every
// existing item (catalogue order unchanged). Item ids: gen/skyways/events/golfContract.ts (PUTTER_ITEM / GOLF_BALL_ITEM).
// Both are PLACED ONLY: the mini-golf dresser (lane GOLF-COURSE) lays the putter on the course's front desk and one ball on each tee as
// ordinary layout pickups. Neither is ever loot, a weapon find / variety identity (items/weaponVariety.ts leaves name explicit ids), market
// stock (market/trade/stock.ts weaponRows: GOLF_EVENT_ONLY), a crafting result, the starter kit or the 1337 gear drop (no guns-only rule
// change: the putter is melee). Everything else is the common path: the putter is a kind 'weapon' item whose WeaponDef has `melee`
// (inventory melee slot, bags, the Lockbox, train cargo, saves, trades priced from its def); the ball is a passive kind 'supply' stack of
// ONE (one stack = one ball = one pickup = one physics body: a ball is never merged into a stack that would drop as one object).
// A leaf module: import only TYPES from items.ts.
import type {ItemDef, ItemDims} from './items';
import type {DamageClass, ItemPhysics} from '../damage/materials';
import {GOLF_BALL_ITEM, GOLF_BALL_MASS, GOLF_BALL_R, PUTTER_ITEM} from '../gen/skyways/events/golfContract';

/** HUD icon keys (ui/golfIcons.ts SVG fallbacks; the putter's 3D icon is its model, the ball's its code-built sphere). */
export type GolfIconKey = 'putter' | 'golfBall';

/** The item ids that exist only as the mini-golf event's placed pickups: never a random pool / market stock / variety identity. */
export const GOLF_EVENT_ONLY: readonly string[] = [PUTTER_ITEM, GOLF_BALL_ITEM];
export const isGolfEventItem = (id: string | null | undefined): boolean => !!id && GOLF_EVENT_ONLY.includes(id);

export const GOLF_ITEMS: Record<string, ItemDef> = {
  [PUTTER_ITEM]: {id: PUTTER_ITEM, name: 'Putter — "Mini-golf club"', short: 'Putter', kind: 'weapon', stackMax: 1, weaponId: PUTTER_ITEM, icon: 'putter',
    description: 'A course putter from a mini-golf front desk: rubber grip, steel shaft, a flat blade head. Stand behind a golf ball, look where it should go, hold the button for more power and release to putt — the longer the hold, the harder the stroke. It also works as a light club against the infected: quick, but it barely staggers them. Melee: no ammo, never runs out.'},
  [GOLF_BALL_ITEM]: {id: GOLF_BALL_ITEM, name: 'Golf ball', short: 'Golf ball', kind: 'supply', stackMax: 1, icon: 'golfBall',
    description: 'A white mini-golf ball. Nothing to use by hand: set it down on the course\'s turf and putt it with the putter — it rolls, rebounds off the rails and drops into a cup.'},
};

/** Impact class as a loose item (damage/materials.ts ITEM_CLASS): a steel-shafted club; a hard plastic ball. */
export const GOLF_CLASS: Readonly<Record<string, DamageClass>> = {[PUTTER_ITEM]: 'steel', [GOLF_BALL_ITEM]: 'plastic'};

/**
 * Rigid body as a loose item (damage/materials.ts ITEM_PHYSICS): a ~0.5 kg putter on a box collider like the other melee weapons; the ball a
 * regulation 45.9 g SPHERE (physics/dynamicItems.ts: radius from its model, the golf ball material and rolling resistance of
 * physics/golfBall.ts).
 */
export const GOLF_PHYSICS: Readonly<Record<string, ItemPhysics>> = {
  [PUTTER_ITEM]: {mass: 0.52, shape: 'box', mat: 'metal'},
  [GOLF_BALL_ITEM]: {mass: GOLF_BALL_MASS, shape: 'sphere', mat: 'ball'},
};

/**
 * Resting sizes (m): the putter lying on its side = its cooked model's bounds (assets/putterModel.generated.ts; world/pickups.ts lays weapons
 * down); the ball = its diameter (a sphere rests the same whichever way it lies: 'flat' = never laid down).
 */
export const GOLF_DIMS: Record<string, ItemDims> = {
  [PUTTER_ITEM]: {w: 0.89, d: 0.102, h: 0.029, shape: 'flat'},
  [GOLF_BALL_ITEM]: {w: GOLF_BALL_R * 2, d: GOLF_BALL_R * 2, h: GOLF_BALL_R * 2, shape: 'flat'},
};
