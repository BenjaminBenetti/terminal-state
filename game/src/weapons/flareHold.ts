// Iteration 15 (user: "right now you click and the flare [throws] right away; it should be more like a video game where you
// click and you hold and ... the flare's held back just like the grenade ... and when you let go it throws the flare").
//
// Grenade-style flare input, for BOTH the T shortcut (from the inventory, whatever is in the hand) and left click with a flare
// in the held quick slot:
//  - press: the flare comes up and is pulled back (viewmodel pose `ready01`); nothing is struck, consumed, lit, lured or
//    heard yet;
//  - release: ONE throw (the caller strikes and tosses exactly one flare: throwables.throwOneFlare). A quick tap throws on
//    its release; holding never repeats the throw;
//  - cancelled with nothing spent by: the input being cleared (pause / inventory / pointer unlock / blur / death / restart /
//    loading all clear it), a timed use / consume animation / ladder, switching away from the held flare (left-click
//    hold), or running out of flares meanwhile;
//  - a press with no flare / at the burning cap is refused once (one message per press, never per frame); during the
//    0.6 s throw cooldown or without physics it is ignored silently (existing rules).
// The hold owns the left mouse button while active; Game keeps the gun from firing until that button is released.

export const FLARE_HOLD = {
  /** Seconds to reach the full pull-back pose (the throw itself never waits for it). */
  readyTime: 0.28,
} as const;

export type FlareHoldSource = 'key' | 'mouse';
export type FlareHoldCancel = 'input-cleared' | 'busy' | 'slot' | 'no-flare';

export interface FlareHoldInput {
  /** T held / pressed this frame. */
  keyDown: boolean;
  keyPressed: boolean;
  /** Left mouse button held / pressed this frame. */
  mouseDown: boolean;
  mousePressed: boolean;
  /** The selected quick-slot item is a flare (left click readies only then). */
  heldIsFlare: boolean;
  /** Hands busy: timed use, consume animation, ladder. */
  busy: boolean;
  /** Flares in the inventory. */
  flares: number;
  /** FlareSystem.refusal(): 'cap' | 'cooldown' | 'unavailable' | null. */
  refusal: 'cap' | 'cooldown' | 'unavailable' | null;
  /** Input.clears (bumped whenever held input is cleared: menus, blur, pointer unlock, state changes). */
  clears: number;
}

export type FlareHoldEvent =
  | {type: 'ready'; source: FlareHoldSource}
  | {type: 'release'; source: FlareHoldSource; heldFor: number}
  | {type: 'cancel'; source: FlareHoldSource; reason: FlareHoldCancel}
  | {type: 'refuse'; source: FlareHoldSource; reason: 'none' | 'cap'};

export class FlareHold {
  source: FlareHoldSource | null = null;
  /** Seconds the flare has been held back. */
  t = 0;
  private clears = 0;

  get active(): boolean {
    return this.source !== null;
  }

  /** Pull-back amount for the viewmodel pose (0 idle .. 1 fully drawn back). */
  get ready01(): number {
    return this.source ? Math.min(1, this.t / FLARE_HOLD.readyTime) : 0;
  }

  update(dt: number, i: FlareHoldInput): FlareHoldEvent[] {
    const src = this.source;
    if (src) {
      const why: FlareHoldCancel | null = i.clears !== this.clears ? 'input-cleared' : i.busy ? 'busy' : i.flares <= 0 ? 'no-flare'
        : src === 'mouse' && !i.heldIsFlare ? 'slot' : null;
      if (why) { this.reset(); return [{type: 'cancel', source: src, reason: why}]; }
      this.t += dt;
      if (!(src === 'key' ? i.keyDown : i.mouseDown)) {
        const heldFor = this.t;
        this.reset();
        return [{type: 'release', source: src, heldFor}];
      }
      return [];
    }
    const start: FlareHoldSource | null = i.keyPressed ? 'key' : i.mousePressed && i.heldIsFlare ? 'mouse' : null;
    if (!start || i.busy) return [];
    if (i.flares <= 0) return [{type: 'refuse', source: start, reason: 'none'}];
    if (i.refusal === 'cap') return [{type: 'refuse', source: start, reason: 'cap'}];
    if (i.refusal) return []; // cooldown after a throw / no physics: silent (existing rules)
    this.source = start;
    this.t = 0;
    this.clears = i.clears;
    const ev: FlareHoldEvent[] = [{type: 'ready', source: start}];
    // pressed and released between two frames (a quick tap): it throws now, on that release
    if (!(start === 'key' ? i.keyDown : i.mouseDown)) { this.reset(); ev.push({type: 'release', source: start, heldFor: 0}); }
    return ev;
  }

  /** Drop a hold without throwing (state changes call this too); returns the source it had. */
  cancel(): FlareHoldSource | null {
    const s = this.source;
    this.reset();
    return s;
  }

  private reset(): void {
    this.source = null;
    this.t = 0;
  }
}
