// Keyboard/mouse state with pointer lock. In QA mode (?qa=1, test automation only) mouse
// movement is accepted without pointer lock, because headless browsers cannot grant it.
//
// Crouch is C (iteration 05, user request: Ctrl was dropped because Ctrl+W closes the tab).
// Task office-overhaul-20261030 (lane INTERACT): G is the grenade slot (hold to ready, release to throw; it no longer drops) and
// 6 the backpack slot; E is tap / hold on a grounded bag (gear/system.ts reads Input.down('KeyE')).

/** Crouch key (tap toggles, hold > 0.3 s crouches while held). */
export const CROUCH_KEYS = ['KeyC'] as const;

export function isCrouchKey(code: string): boolean {
  return (CROUCH_KEYS as readonly string[]).includes(code);
}

/** Keys whose browser default is always suppressed (focus moves, scrolling, quick find). */
export const GAME_KEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyF', 'KeyH', 'KeyG', 'KeyE', 'KeyR', 'KeyI', 'KeyM', 'Slash']);

/** Whether a keydown's browser default should be cancelled. `active` = playing. */
export function shouldPreventKey(e: {code: string}, active: boolean): boolean {
  if (GAME_KEYS.has(e.code)) return true;
  return active && (/^Digit[1-6]$/.test(e.code) || isCrouchKey(e.code)); // Task office-overhaul-20261030 (INTERACT): 6 = the backpack slot
}

export class Input {
  readonly keys = new Set<string>();
  readonly pressed = new Set<string>();
  readonly mouse = [false, false, false];
  readonly mousePressed = [false, false, false];
  wheel = 0;
  dx = 0;
  dy = 0;
  /** Incremented by clear() so held-key state machines (crouch hold) can reset. */
  clears = 0;
  /** Gameplay input is only consumed while active (playing state). */
  active = false;
  onLockChange: (locked: boolean) => void = () => {};
  onKey: (code: string) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement, readonly qa: boolean) {
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && e.code !== 'Tab' && e.code !== 'Escape') return;
      if (shouldPreventKey(e, this.active)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        this.onKey(e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.clear());
    // Ask before leaving a run in progress (not in QA automation).
    window.addEventListener('beforeunload', e => {
      if (!this.active || this.qa) return;
      e.preventDefault();
      e.returnValue = '';
    });
    for (const b of document.querySelectorAll<HTMLButtonElement>('.btn-fullscreen')) b.addEventListener('click', () => void this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => this.fullscreenUi());
    this.fullscreenUi();
    const down = (e: MouseEvent) => {
      if (!this.active) return;
      if (e.button < 3) { this.mouse[e.button] = true; this.mousePressed[e.button] = true; }
      e.preventDefault();
    };
    canvas.addEventListener('mousedown', down);
    document.addEventListener('mousedown', e => { if (document.pointerLockElement === canvas) down(e); });
    window.addEventListener('mouseup', e => { if (e.button < 3) this.mouse[e.button] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('wheel', e => {
      if (!this.active) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, {passive: false});
    document.addEventListener('mousemove', e => {
      if (!this.active) return;
      if (this.locked || this.qa) { this.dx += e.movementX; this.dy += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => this.onLockChange(this.locked));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Resolves with whether the pointer is actually captured (handles promise and event-only APIs). */
  lock(): Promise<boolean> {
    if (this.qa || this.locked) return Promise.resolve(true);
    return new Promise(resolve => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        resolve(ok);
      };
      const onChange = () => finish(this.locked);
      const onError = () => finish(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (r && typeof r.then === 'function') r.then(() => finish(this.locked), () => finish(false));
      } catch {
        finish(false);
      }
      setTimeout(() => finish(this.locked), 1500);
    });
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Optional plain fullscreen toggle (title/pause buttons; user gesture). */
  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    try {
      await document.documentElement.requestFullscreen({navigationUI: 'hide'});
    } catch {
      this.fullscreenUi('The browser refused fullscreen.');
      return;
    }
    this.fullscreenUi();
  }

  private fullscreenUi(note?: string): void {
    const fs = !!document.fullscreenElement;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.btn-fullscreen')) b.textContent = fs ? 'Exit fullscreen' : 'Fullscreen';
    const text = note ?? (fs ? 'Fullscreen. Esc pauses; press Esc again (or the button) to leave fullscreen.' : 'Optional: play fullscreen.');
    for (const el of document.querySelectorAll<HTMLElement>('.fs-status')) el.textContent = text;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  clear(): void {
    this.clears++;
    this.keys.clear();
    this.mouse.fill(false);
    this.mousePressed.fill(false);
    this.pressed.clear();
    this.dx = this.dy = this.wheel = 0;
  }

  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.fill(false);
    this.wheel = 0;
    this.dx = this.dy = 0;
  }
}
