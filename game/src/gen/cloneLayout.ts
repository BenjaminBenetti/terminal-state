// Task studio-surface-host-ground-connectors-20261118-053602-01: a deep copy of a freshly GENERATED layout (the Surface Run crossings'
// anticipation: game.ts keeps a pristine copy of each world of a Surface station so a crossing never generates in play). Plain data,
// typed arrays (copied) and class instances (Grid, Levels: their prototype kept, own fields copied); shared references stay shared within
// the copy (a memo), cycles are safe. Functions, Maps and Sets are copied structurally. Pure.

export function cloneLayoutDeep<T>(v: T): T {
  return copy(v, new Map()) as T;
}

function copy(v: unknown, memo: Map<unknown, unknown>): unknown {
  if (v === null || typeof v !== 'object') return v;
  const hit = memo.get(v);
  if (hit !== undefined) return hit;
  if (ArrayBuffer.isView(v)) {
    const c = (v as unknown as {slice(): unknown}).slice();
    memo.set(v, c);
    return c;
  }
  if (Array.isArray(v)) {
    const c: unknown[] = new Array(v.length);
    memo.set(v, c);
    for (let i = 0; i < v.length; i++) c[i] = copy(v[i], memo);
    return c;
  }
  if (v instanceof Map) {
    const c = new Map();
    memo.set(v, c);
    for (const [k, x] of v) c.set(copy(k, memo), copy(x, memo));
    return c;
  }
  if (v instanceof Set) {
    const c = new Set();
    memo.set(v, c);
    for (const x of v) c.add(copy(x, memo));
    return c;
  }
  const c = Object.create(Object.getPrototypeOf(v)) as Record<string, unknown>;
  memo.set(v, c);
  for (const k of Object.keys(v)) c[k] = copy((v as Record<string, unknown>)[k], memo);
  return c;
}
