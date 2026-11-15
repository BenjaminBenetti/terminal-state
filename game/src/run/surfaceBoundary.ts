/** Surface crossings release the outgoing world before preparing the incoming one. */
export interface SurfaceBoundarySteps {
  /** Capture the source memory/carry, then release its render resources. A failure propagates to the caller. */
  suspend(): void | Promise<void>;
  /** Prepare, build and fully warm the destination. */
  enter(): void | Promise<void>;
  /** Dispose any partial destination and rebuild the saved source, including its graphics warm-up. */
  restore(): void | Promise<void>;
  /** A replaced generation or lost device must never rebuild an obsolete source. */
  cancelled?(): boolean;
}

export type SurfaceBoundaryResult =
  | {ok: true}
  | {ok: false; error: unknown; restored: true}
  | {ok: false; error: unknown; restored: false; restoreError?: unknown; cancelled?: true};

/**
 * The caller owns world state and resource disposal. In particular, its async callbacks must also check their generation
 * after waits: this boundary can prevent a stale rollback, but cannot cancel an already running build or restore.
 * A suspend error throws because it may have released only part of the source; claiming a successful restore would be false.
 */
export async function runSurfaceBoundary(steps: SurfaceBoundarySteps): Promise<SurfaceBoundaryResult> {
  const cancelled = (error: unknown = new Error('Surface transition cancelled')): SurfaceBoundaryResult =>
    ({ok: false, error, restored: false, cancelled: true});
  if (steps.cancelled?.()) return cancelled();
  await steps.suspend();
  if (steps.cancelled?.()) return cancelled();
  try {
    await steps.enter();
    return steps.cancelled?.() ? cancelled() : {ok: true};
  } catch (error) {
    if (steps.cancelled?.()) return cancelled(error);
    try {
      await steps.restore();
      return steps.cancelled?.() ? cancelled(error) : {ok: false, error, restored: true};
    } catch (restoreError) {
      return {ok: false, error, restored: false, restoreError};
    }
  }
}
