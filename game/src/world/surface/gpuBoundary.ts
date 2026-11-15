type SurfaceGl = Pick<WebGL2RenderingContext,
  'SYNC_GPU_COMMANDS_COMPLETE' | 'ALREADY_SIGNALED' | 'CONDITION_SATISFIED' | 'TIMEOUT_EXPIRED' | 'WAIT_FAILED' |
  'fenceSync' | 'flush' | 'clientWaitSync' | 'deleteSync' | 'isContextLost'>;
interface SurfaceDevice {
  queue?: {onSubmittedWorkDone?(): PromiseLike<unknown>};
  lost?: PromiseLike<{reason?: string; message?: string}>;
}
/** The initialized three WebGPUBackend / WebGLBackend fields used by this boundary. */
export interface SurfaceGpuBackend {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: SurfaceDevice | null;
  gl?: Partial<SurfaceGl> | null;
}

const POLL_MS = 4;
const yieldGpu = () => new Promise<void>(resolve => setTimeout(resolve, POLL_MS));
const deviceLosses = new WeakMap<SurfaceDevice, {lost: boolean; error: unknown}>();

function deviceLoss(device: SurfaceDevice): {lost: boolean; error: unknown} {
  let status = deviceLosses.get(device);
  if (!status) {
    status = {lost: false, error: undefined}; deviceLosses.set(device, status);
    const current = status;
    // One observer per device, rather than retaining another loss listener after every surface crossing.
    Promise.resolve(device.lost).then(info => {
      current.lost = true;
      current.error = new Error(`Surface GPU device lost${info?.message || info?.reason ? `: ${info.message || info.reason}` : ''}`);
    }, error => { current.lost = true; current.error = error; });
  }
  return status;
}

function assertAlive(alive: () => boolean): void {
  if (!alive()) throw new Error('Surface transition cancelled while draining GPU');
}

/**
 * Wait for work already submitted to the initialized renderer before crossing the surface memory boundary.
 * This never calls gl.finish(), blocks the browser loop, recreates a renderer or claims readiness without a fence/queue.
 * Missing backends (including test doubles) are refused; callers that have no renderer must explicitly skip this boundary.
 */
export async function drainSurfaceGpu(backend: SurfaceGpuBackend | null | undefined, alive: () => boolean = () => true): Promise<void> {
  assertAlive(alive);
  if (backend?.isWebGPUBackend === true) {
    const device = backend.device, queue = device?.queue;
    if (!device || !queue || typeof queue.onSubmittedWorkDone !== 'function' || !device.lost || typeof device.lost.then !== 'function') {
      throw new Error('Surface WebGPU boundary requires an initialized device queue and loss signal');
    }
    const loss = deviceLoss(device);
    let finished = false, failed = false, failure: unknown;
    const submitted = queue.onSubmittedWorkDone();
    if (!submitted || typeof submitted.then !== 'function') throw new Error('Surface WebGPU queue did not return a completion promise');
    Promise.resolve(submitted).then(() => { finished = true; }, error => { failed = true; failure = error; });
    for (;;) {
      assertAlive(alive);
      if (loss.lost) throw loss.error;
      if (failed) throw failure;
      if (finished) return;
      await yieldGpu();
    }
  }
  const candidate = backend?.isWebGLBackend === true ? backend.gl : null;
  const functions = ['fenceSync', 'flush', 'clientWaitSync', 'deleteSync', 'isContextLost'] as const;
  const constants = ['SYNC_GPU_COMMANDS_COMPLETE', 'ALREADY_SIGNALED', 'CONDITION_SATISFIED', 'TIMEOUT_EXPIRED', 'WAIT_FAILED'] as const;
  if (!candidate || functions.some(key => typeof candidate[key] !== 'function') || constants.some(key => typeof candidate[key] !== 'number')) {
    throw new Error('Surface GPU boundary requires an initialized WebGPU or WebGL2 backend');
  }
  const gl = candidate as SurfaceGl;
  if (gl.isContextLost()) throw new Error('Surface WebGL2 context is lost');
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) throw new Error('Surface WebGL2 fence creation failed');
  try {
    gl.flush();
    for (;;) {
      await yieldGpu();
      assertAlive(alive);
      if (gl.isContextLost()) throw new Error('Surface WebGL2 context is lost');
      const result = gl.clientWaitSync(sync, 0, 0);
      if (result === gl.ALREADY_SIGNALED || result === gl.CONDITION_SATISFIED) return;
      if (result === gl.WAIT_FAILED) throw new Error('Surface WebGL2 fence wait failed');
      if (result !== gl.TIMEOUT_EXPIRED) throw new Error(`Surface WebGL2 fence returned an unknown status (${result})`);
    }
  } finally {
    gl.deleteSync(sync);
  }
}
