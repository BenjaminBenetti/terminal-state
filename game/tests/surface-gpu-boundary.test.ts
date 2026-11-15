import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {drainSurfaceGpu, type SurfaceGpuBackend} from '../src/world/surface/gpuBoundary';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function webgpu() {
  const work = deferred<void>(), loss = deferred<{reason: string; message: string}>();
  const queue = {onSubmittedWorkDone: vi.fn(() => work.promise)};
  return {work, loss, queue, backend: {isWebGPUBackend: true, device: {queue, lost: loss.promise}}};
}

/** A fence captures the submitted serial; it cannot signal until the simulated GPU has completed that work. */
function webgl() {
  const sync = {} as WebGLSync;
  const driver = {submitted: 3, completed: 0, fenceSerial: 0, contextLost: false, waitFailed: false};
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117 as const, ALREADY_SIGNALED: 0x911a as const, CONDITION_SATISFIED: 0x911c as const,
    TIMEOUT_EXPIRED: 0x911b as const, WAIT_FAILED: 0x911d as const,
    fenceSync: vi.fn((_condition: number, _flags: number): WebGLSync | null => { driver.fenceSerial = driver.submitted; return sync; }),
    flush: vi.fn(), finish: vi.fn(),
    clientWaitSync: vi.fn((_sync: WebGLSync, _flags: number, _timeout: number): number => driver.waitFailed ? gl.WAIT_FAILED : driver.completed >= driver.fenceSerial ? gl.CONDITION_SATISFIED : gl.TIMEOUT_EXPIRED),
    deleteSync: vi.fn(), isContextLost: vi.fn(() => driver.contextLost),
  };
  return {driver, gl, sync, backend: {isWebGLBackend: true, gl}};
}

describe('Surface Run GPU memory boundary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not report WebGPU readiness until previously submitted work actually completes', async () => {
    const {backend, queue, work} = webgpu();
    let ready = false;
    const drain = drainSurfaceGpu(backend).then(() => { ready = true; });
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20); expect(ready).toBe(false);
    work.resolve(); await vi.advanceTimersByTimeAsync(4); await drain;
    expect(ready).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates WebGPU queue rejection without claiming the world was drained', async () => {
    const {backend, work} = webgpu(), error = new Error('submitted work failed');
    const rejected = expect(drainSurfaceGpu(backend)).rejects.toBe(error);
    work.reject(error); await vi.advanceTimersByTimeAsync(4); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports WebGPU device loss even when its completion promise never resolves', async () => {
    const {backend, loss} = webgpu();
    const rejected = expect(drainSurfaceGpu(backend)).rejects.toThrow(/device lost: reset during surface transition/);
    loss.resolve({reason: 'unknown', message: 'reset during surface transition'});
    await vi.advanceTimersByTimeAsync(4); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one device-loss observer across repeated completed drains', async () => {
    const {backend, loss, work} = webgpu(), observe = vi.spyOn(loss.promise, 'then');
    work.resolve();
    const first = drainSurfaceGpu(backend); await vi.advanceTimersByTimeAsync(4); await first;
    const second = drainSurfaceGpu(backend); await vi.advanceTimersByTimeAsync(4); await second;
    expect(observe).toHaveBeenCalledTimes(1);
    expect(backend.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
  });

  it('cancels a stale WebGPU drain while its queue is still pending', async () => {
    const {backend} = webgpu(); let alive = true;
    const rejected = expect(drainSurfaceGpu(backend, () => alive)).rejects.toThrow(/cancelled/);
    alive = false; await vi.advanceTimersByTimeAsync(4); await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('yields while WebGL2 work is pending and deletes its fence only after it signals', async () => {
    const {backend, driver, gl, sync} = webgl();
    let ready = false;
    const drain = drainSurfaceGpu(backend).then(() => { ready = true; });
    expect(gl.fenceSync).toHaveBeenCalledWith(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    expect(gl.flush).toHaveBeenCalledTimes(1); expect(gl.clientWaitSync).not.toHaveBeenCalled();
    driver.completed = 2;
    await vi.advanceTimersByTimeAsync(4);
    expect(gl.clientWaitSync).toHaveBeenCalledWith(sync, 0, 0);
    expect(ready).toBe(false); expect(gl.deleteSync).not.toHaveBeenCalled();
    driver.completed = 3; await vi.advanceTimersByTimeAsync(4); await drain;
    expect(ready).toBe(true); expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(gl.finish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts an already-signalled WebGL2 fence through the same asynchronous cleanup path', async () => {
    const {backend, gl, sync} = webgl(); gl.clientWaitSync.mockReturnValue(gl.ALREADY_SIGNALED);
    const drain = drainSurfaceGpu(backend);
    expect(gl.deleteSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4); await drain;
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
  });

  it.each(['context-loss', 'wait-failed', 'cancelled'] as const)('refuses WebGL2 %s and releases the sync', async failure => {
    const {backend, driver, gl, sync} = webgl(); let alive = true;
    const rejected = expect(drainSurfaceGpu(backend, () => alive)).rejects.toThrow(failure === 'context-loss' ? /context is lost/ : failure === 'wait-failed' ? /fence wait failed/ : /cancelled/);
    if (failure === 'context-loss') driver.contextLost = true;
    if (failure === 'wait-failed') driver.waitFailed = true;
    if (failure === 'cancelled') alive = false;
    await vi.advanceTimersByTimeAsync(4); await rejected;
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(gl.finish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a lost WebGL2 context before allocating a sync', async () => {
    const {backend, driver, gl} = webgl(); driver.contextLost = true;
    await expect(drainSurfaceGpu(backend)).rejects.toThrow(/context is lost/);
    expect(gl.fenceSync).not.toHaveBeenCalled(); expect(gl.deleteSync).not.toHaveBeenCalled();
  });

  it('refuses failed WebGL2 fence creation', async () => {
    const {backend, gl} = webgl(); gl.fenceSync.mockReturnValue(null);
    await expect(drainSurfaceGpu(backend)).rejects.toThrow(/fence creation failed/);
    expect(gl.flush).not.toHaveBeenCalled(); expect(gl.deleteSync).not.toHaveBeenCalled();
  });

  it('deletes a created WebGL2 sync even if submitting its flush throws', async () => {
    const {backend, gl, sync} = webgl(), error = new Error('flush failed');
    gl.flush.mockImplementation(() => { throw error; });
    await expect(drainSurfaceGpu(backend)).rejects.toBe(error);
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
  });

  it('does not start work for an already cancelled boundary', async () => {
    const {backend, gl} = webgl();
    await expect(drainSurfaceGpu(backend, () => false)).rejects.toThrow(/cancelled/);
    expect(gl.fenceSync).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, undefined, {}, {isWebGLBackend: true, gl: {}}, {isWebGPUBackend: true, device: {queue: {onSubmittedWorkDone: () => Promise.resolve()}}}])(
    'refuses missing backend completion features instead of reporting fake readiness (%j)', async backend => {
      await expect(drainSurfaceGpu(backend as SurfaceGpuBackend | null | undefined)).rejects.toThrow(/requires an initialized/);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
