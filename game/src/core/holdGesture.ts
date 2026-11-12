// Task train-interaction-ux-20261112-063646 (lane DRAG; user: "ALL existing draggable items, including equipment and the fuel dolly,
// require HOLDING E to START dragging, with the existing crosshair hold-progress spinner. Quick normal interaction must not
// accidentally start dragging. … Cancel an unfinished hold normally on target/range/input-owner changes. Reuse the common
// interaction/drag mechanism rather than add per-kind exceptions."): THE ONE HOLD-TO-DRAG GESTURE. Pure (no three.js, no DOM, no Game):
// the fuel carts (world/fuelCarts.ts) and the train equipment (world/trainEquipment.ts) each own one HoldGesture and feed it their own
// facts every frame; the whole rule lives here.
//
// THE RULE (one for every draggable: the fuel cart, a device on its hand truck, the carried chest):
//  - E PRESSED while aiming at the thing only BEGINS the gesture (begin). Nothing happens on the press.
//  - E RELEASED before DRAG_HOLD_S = a TAP: the thing's normal interaction (the owner's), never a drag / carry.
//  - E HELD for DRAG_HOLD_S = the HOLD: the owner starts the drag / carry. A drag only ever starts with the key physically down.
//  - CANCELLED (nothing happens) the moment the owner's own conditions fail (`live`: playing, alive, not climbing, the train not riding,
//    the target still standing in the world), the input was wiped (`clears` changed: a menu, a blur), the aim is no longer on that
//    target within its reach (`aimed`), or ANOTHER input owner became active since the press (`foreign`: a view opening, a carried
//    body, throwing up, the gas mask going on …). An owner that was ALREADY active at the press does not cancel: E on a cart during a
//    mask change worked before and still does.
//  - THE RING: the crosshair hold ring (ui/hud.ts setHoldRing) shows the progress once the key has been down HOLD_RING_DELAY_S (a tap
//    never flashes it) and is cleared when the gesture ends. It is written ONLY while a gesture is pending and once at its end — never
//    every frame when idle (gear/system.ts writes it every frame, EARLIER in the frame: a later idle write here would wipe other
//    systems' rings).
// After the HOLD the gesture is over: releasing E does nothing; the next E press is the owner's ordinary "let go / put down".

/** E held this long on a draggable starts the drag / carry (the grounded backpack's time: gear BAG_HOLD_S); a shorter press is a TAP. */
export const DRAG_HOLD_S = 0.5;
/** The ring appears once the key has been down this long: a tap never flashes it. */
export const HOLD_RING_DELAY_S = 0.1;

/** What one step did: nothing pending / still pending / the TAP / the HOLD / cancelled. */
export type HoldStep = 'idle' | 'pending' | 'tap' | 'hold' | 'cancelled';

/** The owner's facts for one frame. */
export interface HoldFrame {
  /** E is down now. */
  down: boolean;
  /** The input's clear counter now (player/input.ts Input.clears): a change since the press wiped the keys. */
  clears: number;
  /** The owner's own conditions still hold (playing, alive, not climbing, no ride, the target standing in the world, hands not taken). */
  live: boolean;
  /** The aim is still on the SAME target within its reach (another part of it is fine). */
  aimed: boolean;
  /** The other input owners active now (foreignOwners()): one that was not active at the last look cancels. */
  foreign: number;
}

/**
 * The other input owners active now as a bit set (Game.inputOwners without `own`; owners past the 30th share the top bit). A bit that
 * was clear at the press / the last step and is set now is "another owner became active".
 */
export function foreignOwners(owners: readonly (() => boolean)[] | null | undefined, own: (() => boolean) | null): number {
  let m = 0;
  if (!owners) return m;
  for (let i = 0; i < owners.length; i++) {
    const f = owners[i];
    if (f !== own && f()) m |= 1 << Math.min(i, 30);
  }
  return m;
}

/** One pending E press on a target of type T (see the header: the rule). */
export class HoldGesture<T> {
  /** The thing E was pressed on (null: no gesture pending). */
  target: T | null = null;
  /** Seconds the key has been down. */
  t = 0;
  private clears = 0;
  private foreign = 0;

  /**
   * @param ring the crosshair ring (hud.setHoldRing): progress 0..1, null = hidden
   * @param holdS / ringDelayS the times (the shared defaults; a test may shorten them)
   */
  constructor(private readonly ring: (progress: number | null) => void = () => {}, readonly holdS: number = DRAG_HOLD_S, readonly ringDelayS: number = HOLD_RING_DELAY_S) {}

  get pending(): boolean { return this.target !== null; }

  /** 0..1 of the hold time, or null with nothing pending (QA / tests). */
  get progress(): number | null { return this.target === null ? null : Math.min(1, this.t / this.holdS); }

  /** E pressed on `target`: the gesture begins (nothing else happens). `clears` / `foreign` as they are at the press. */
  begin(target: T, clears = 0, foreign = 0): void {
    if (this.target !== null) this.end();
    this.target = target;
    this.t = 0;
    this.clears = clears;
    this.foreign = foreign;
  }

  /**
   * One frame. 'tap' / 'hold' / 'cancelled' end the gesture (the ring cleared; `target` is null afterwards: read it BEFORE the step).
   * The caller acts on 'tap' and 'hold'; 'cancelled' and 'idle' need nothing.
   */
  step(dt: number, f: HoldFrame): HoldStep {
    if (this.target === null) return 'idle';
    if (!f.live || f.clears !== this.clears || !f.aimed || (f.foreign & ~this.foreign) !== 0) { this.end(); return 'cancelled'; }
    this.foreign = f.foreign;
    // (the release is looked at before the clock: a drag never starts on a frame the key is already up)
    if (!f.down) { this.end(); return 'tap'; }
    this.t += dt;
    if (this.t >= this.holdS) { this.end(); return 'hold'; }
    this.ring(this.t >= this.ringDelayS ? this.t / this.holdS : null);
    return 'pending';
  }

  /** Drop a pending gesture with nothing done (the target left the world, a teardown, a restore, a state change). True: one was pending. */
  cancel(): boolean {
    if (this.target === null) return false;
    this.end();
    return true;
  }

  private end(): void {
    this.target = null;
    this.t = 0;
    this.ring(null);
  }
}
