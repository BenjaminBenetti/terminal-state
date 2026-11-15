// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): bake workers for Node tests (world/lightBakePool.ts
// LightBakeWorkers).
//  - threadWorkers(): REAL threads. The worker's own script (src/world/lightBakeWorker.ts, bundled by vite into one classic script,
//    minified, as the game's build inlines it) runs in node:worker_threads behind the part of a browser Worker the pool uses. What
//    this does not show: a browser's Blob worker start-up and its structured-clone cost (Node's are its own).
//  - sameThreadWorkers(): the worker's tasks installed on a MessageChannel in THIS thread — every message is really copied /
//    transferred, nothing runs in parallel. No bundle, no thread: the protocol's cases, deterministic.
import {Worker as NodeWorker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import type {BakeWorker, LightBakeWorkers} from '../../src/world/lightBakePool';
import {installBakeTasks, type BakePort} from '../../src/world/lightBakeTasks';

const GAME = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = fileURLToPath(new URL('../../src/world/lightBakeWorker.ts', import.meta.url));

let script: Promise<string> | null = null;
/** The worker's script as one classic script (built once per test process). */
export function bakeWorkerScript(): Promise<string> {
  return (script ??= (async () => {
    const out = await build({
      configFile: false, logLevel: 'silent', root: GAME,
      build: {write: false, minify: true, target: 'es2022', lib: {entry: ENTRY, formats: ['iife'], name: 'lightBakeWorker'}},
    });
    const outputs = (Array.isArray(out) ? out : [out]) as unknown as {output: {type: string; code?: string}[]}[];
    const chunks = outputs.flatMap(o => o.output).filter(c => c.type === 'chunk');
    if (chunks.length !== 1 || typeof chunks[0].code !== 'string') throw new Error(`bakeWorkerScript: expected one chunk, got ${chunks.length}`);
    return chunks[0].code;
  })());
}

/** A worker thread's global scope, made to look like a browser worker's (self, postMessage, onmessage). */
const NODE_SCOPE = `const {parentPort} = require('node:worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', data => { const on = globalThis.onmessage; if (typeof on === 'function') on({data}); });
`;

export interface TestBakeWorkers extends LightBakeWorkers {
  /** Workers started so far / still running. */
  spawned: number;
  alive(): number;
}

/** `count` real worker threads per bake. */
export async function threadWorkers(count: number, extra: Partial<LightBakeWorkers> = {}): Promise<TestBakeWorkers> {
  const code = NODE_SCOPE + await bakeWorkerScript();
  let alive = 0;
  const pool: TestBakeWorkers = {
    count, spawned: 0, alive: () => alive, ...extra,
    spawn: () => {
      const thread = new NodeWorker(code, {eval: true});
      let running = true;
      const w: BakeWorker = {
        onmessage: null, onerror: null, onmessageerror: null,
        postMessage: (message, transfer) => { thread.postMessage(message, transfer as never); },
        terminate: () => { if (running) { running = false; alive--; } void thread.terminate(); },
      };
      thread.on('message', data => { w.onmessage?.({data} as MessageEvent); });
      thread.on('error', err => { w.onerror?.({message: String((err as Error)?.message ?? err)} as ErrorEvent); });
      thread.on('messageerror', () => { w.onmessageerror?.({} as MessageEvent); });
      pool.spawned++;
      alive++;
      return w;
    },
  };
  return pool;
}

/** `count` workers per bake that run in this thread, each behind a MessageChannel of its own. */
export function sameThreadWorkers(count: number, extra: Partial<LightBakeWorkers> = {}): TestBakeWorkers {
  let alive = 0;
  const pool: TestBakeWorkers = {
    count, spawned: 0, alive: () => alive, ...extra,
    spawn: () => {
      const ch = new MessageChannel();
      /** The ports it was handed with its role (its lines to the bake's other workers): a thread's end with it, these are closed. */
      const lines: MessagePort[] = [];
      const scope: BakePort = {postMessage: (message, transfer) => { ch.port2.postMessage(message, transfer); }, onmessage: null};
      ch.port2.onmessage = ev => {
        const m = ev.data as {op?: string; port?: MessagePort; ports?: MessagePort[]};
        if (m.op === 'part' && m.port) lines.push(m.port);
        if (m.op === 'lead' && m.ports) lines.push(...m.ports);
        scope.onmessage?.(ev);
      };
      installBakeTasks(scope);
      let running = true;
      const w: BakeWorker = {
        onmessage: null, onerror: null, onmessageerror: null,
        postMessage: (message, transfer) => { ch.port1.postMessage(message, transfer); },
        // (terminated: nothing more is delivered to it — a job it has not started never runs — and nothing it says is heard)
        terminate: () => {
          if (running) { running = false; alive--; }
          for (const p of [ch.port1, ch.port2, ...lines]) { p.onmessage = null; p.close(); }
        },
      };
      ch.port1.onmessage = ev => { w.onmessage?.(ev); };
      pool.spawned++;
      alive++;
      return w;
    },
  };
  return pool;
}
