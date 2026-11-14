// Task studio-baked-lighting-reflections-20261114-050258-01 (lane CACHE): an in-memory fake of the IndexedDB subset that
// core/derivedCache.ts uses, for the Node tests (no dependency: `fake-indexeddb` is not installed and is not to be added).
//
// What it models, because the adapter's correctness rests on it:
//  - everything is delivered LATER, one event per task (setImmediate): open's upgradeneeded / success / error / blocked, each
//    request's success / error, a transaction's complete / abort;
//  - a transaction is ACTIVE only in the task that created it and inside its own request handlers; a request placed at any other
//    time throws TransactionInactiveError (stricter than a browser, which also allows the microtasks of those moments: code that
//    awaits something else inside a transaction fails here at once instead of now and then in a browser);
//  - requests of one transaction run in the order they were placed; transactions of one database run one at a time in the order
//    they were created (a browser lets read-only ones overlap; nothing may rely on that);
//  - a transaction is ATOMIC: its writes live in a private copy until it completes; an abort (abort(), a failed request whose error
//    was not preventDefault()ed, a throw inside a handler, a failed commit, a dropped connection) leaves the stores untouched, fails
//    the requests still waiting with AbortError and fires `abort` with the transaction's `error`;
//  - a transaction with nothing left to do commits by itself;
//  - values are STRUCTURED CLONES going in and coming out (a typed array is copied with its whole buffer, never shared);
//  - a store has a key path (the key is read from the value) or takes the key beside the value; keys are strings or finite numbers;
//  - open(name, version): a new or older database runs `upgradeneeded` (createObjectStore works only there), an existing one of a
//    newer version fails with VersionError; a closed connection throws InvalidStateError from transaction().
// What it does not have: indexes, cursors, key ranges, auto-increment, array / Date / binary keys, deleteDatabase, durability hints.
//
// Switches for the tests: `openMode` (open() throws, errors, reports blocked, or never settles; release() lets held opens finish),
// failNextPuts / failNextCommits (a QuotaExceededError-like failure that aborts the transaction), `hangTransactions` (nothing is
// delivered: a stuck transaction), closeConnections() (the browser drops them, with or without the `close` event), versionChange()
// (another tab wants the database: `versionchange` fires), records() / corrupt() (the raw stored values), `log` (every request placed), and
// `handlerErrors` (anything a handler of the code under test threw: it should stay empty).

type Key = string | number;

export interface FakeEvent {
  type: string;
  target: unknown;
  oldVersion?: number;
  newVersion?: number | null;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
type Handler = ((ev: FakeEvent) => void) | null;

export interface FakeLogEntry { db: string; store: string; op: 'get' | 'getAll' | 'getAllKeys' | 'count' | 'put' | 'delete' | 'clear'; key?: Key }

const defer = (fn: () => void): void => { setImmediate(fn); };
const domError = (name: string, message: string): DOMException => new DOMException(message, name);

function event(type: string, target: unknown, extra: Partial<FakeEvent> = {}): FakeEvent {
  return {type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra};
}

function validKey(key: unknown): Key {
  if (typeof key === 'string' || (typeof key === 'number' && Number.isFinite(key))) return key;
  throw domError('DataError', 'The parameter is not a valid key.');
}
/** IndexedDB key order for the two kinds kept here: numbers first, strings by code unit. */
function compareKeys(a: Key, b: Key): number {
  if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface StoreData { keyPath: string | null; records: Map<Key, unknown> }
interface DbData { name: string; version: number; stores: Map<string, StoreData>; queue: FakeTransaction[] }

export class FakeRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  readyState: 'pending' | 'done' = 'pending';
  onsuccess: Handler = null;
  onerror: Handler = null;
  transaction: {abort(): void} | null = null;
}

export class FakeOpenRequest extends FakeRequest {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

export class FakeObjectStore {
  constructor(private readonly tx: FakeTransaction, readonly name: string) {}
  get keyPath(): string | null { return this.tx.def(this.name).keyPath; }

  private place(op: FakeLogEntry['op'], key: Key | undefined, run: () => unknown): FakeRequest {
    if (op === 'put' || op === 'delete' || op === 'clear') this.tx.mustWrite();
    return this.tx.request({db: this.tx.db.name, store: this.name, op, ...(key === undefined ? {} : {key})}, run);
  }
  private sorted(): Key[] { return [...this.tx.read(this.name).keys()].sort(compareKeys); }

  get(key: unknown): FakeRequest {
    const k = validKey(key);
    return this.place('get', k, () => structuredClone(this.tx.read(this.name).get(k)));
  }
  getAll(): FakeRequest {
    return this.place('getAll', undefined, () => this.sorted().map(k => structuredClone(this.tx.read(this.name).get(k))));
  }
  getAllKeys(): FakeRequest { return this.place('getAllKeys', undefined, () => this.sorted()); }
  count(): FakeRequest { return this.place('count', undefined, () => this.tx.read(this.name).size); }
  put(value: unknown, key?: unknown): FakeRequest {
    this.tx.mustWrite();
    this.tx.mustBeActive();
    // Cloned when the request is placed, as a browser does: a later change to the caller's object is not stored.
    const stored: unknown = structuredClone(value);
    const path = this.keyPath;
    let k: Key;
    if (path !== null) {
      if (key !== undefined) throw domError('DataError', 'The store uses in-line keys and a key was provided.');
      k = validKey(stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>)[path] : undefined);
    } else k = validKey(key);
    return this.place('put', k, () => {
      this.tx.db.factory.takePutFailure();
      this.tx.write(this.name).set(k, stored);
      return k;
    });
  }
  delete(key: unknown): FakeRequest {
    const k = validKey(key);
    return this.place('delete', k, () => { this.tx.write(this.name).delete(k); return undefined; });
  }
  clear(): FakeRequest {
    return this.place('clear', undefined, () => { this.tx.write(this.name).clear(); return undefined; });
  }
}

export class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;
  state: 'active' | 'inactive' | 'finished' = 'active';
  /** The task that created it is over (requests may be delivered once it is first in line). */
  private created = false;
  private pending: {req: FakeRequest; run: () => unknown}[] = [];
  /** Requests placed so far. */
  private placed = 0;
  /** This transaction's private copies of the stores it wrote to. */
  private readonly work = new Map<string, Map<Key, unknown>>();

  constructor(readonly db: FakeDatabase, readonly scope: readonly string[], readonly mode: 'readonly' | 'readwrite') {
    const data = db.data;
    data.queue.push(this);
    defer(() => {
      if (this.state === 'active') this.state = 'inactive';
      this.created = true;
      if (data.queue[0] === this) this.drive();
    });
  }

  objectStore(name: string): FakeObjectStore {
    if (this.state === 'finished') throw domError('InvalidStateError', 'The transaction has finished.');
    if (!this.scope.includes(name)) throw domError('NotFoundError', `No object store '${name}' in this transaction.`);
    return new FakeObjectStore(this, name);
  }

  abort(): void {
    if (this.state === 'finished') throw domError('InvalidStateError', 'The transaction has finished.');
    this.finishAbort(null);
  }

  // ---- the fake's own plumbing (FakeObjectStore / FakeIndexedDb)

  def(name: string): StoreData {
    const def = this.db.data.stores.get(name);
    if (!def) throw domError('NotFoundError', `No object store '${name}'.`);
    return def;
  }
  mustBeActive(): void {
    if (this.state !== 'active') throw domError('TransactionInactiveError', 'The transaction is not active.');
  }
  mustWrite(): void {
    if (this.mode !== 'readwrite') throw domError('ReadOnlyError', 'The transaction is read-only.');
  }
  read(name: string): Map<Key, unknown> { return this.work.get(name) ?? this.def(name).records; }
  write(name: string): Map<Key, unknown> {
    let map = this.work.get(name);
    if (!map) { map = new Map(this.def(name).records); this.work.set(name, map); }
    return map;
  }
  request(entry: FakeLogEntry, run: () => unknown): FakeRequest {
    this.mustBeActive();
    const req = new FakeRequest();
    req.transaction = this;
    this.db.factory.log.push(entry);
    this.placed++;
    this.pending.push({req, run});
    return req;
  }

  /** Calls a handler the way a browser dispatches: the transaction is active inside it, and a throw aborts the transaction. */
  private dispatch(handler: Handler, ev: FakeEvent): void {
    if (!handler) return;
    if (!this.isFinished()) this.state = 'active';
    try {
      handler(ev);
    } catch (err) {
      this.db.factory.handlerErrors.push(err);
      this.finishAbort(domError('AbortError', 'A handler threw.'));
    }
    if (this.state === 'active') this.state = 'inactive';
  }

  /** One step, in its own task: the next request's result, or the commit when nothing is left. */
  private drive(): void {
    if (this.isFinished() || this.db.factory.hangTransactions) return;
    const next = this.pending.shift();
    if (!next) { this.commit(); return; }
    const {req, run} = next;
    let failure: DOMException | null = null;
    try {
      req.result = run();
    } catch (err) {
      failure = err instanceof DOMException ? err : domError('UnknownError', String(err));
    }
    req.readyState = 'done';
    if (failure) {
      req.error = failure;
      const ev = event('error', req);
      this.dispatch(req.onerror, ev);
      if (!this.isFinished() && !ev.defaultPrevented) {
        this.dispatch(this.onerror, ev);
        this.finishAbort(failure);
      }
    } else this.dispatch(req.onsuccess, event('success', req));
    if (!this.isFinished()) defer(() => this.drive());
  }

  private commit(): void {
    // A transaction that placed no request has nothing to commit and cannot fail at it.
    const failure = this.placed > 0 ? this.db.factory.takeCommitFailure() : null;
    if (failure) { this.finishAbort(failure); return; }
    for (const [name, map] of this.work) this.def(name).records = map;
    this.state = 'finished';
    defer(() => { if (this.oncomplete) this.oncomplete(event('complete', this)); });
    this.leave();
  }

  /** (A call, so that the compiler does not carry an earlier answer across a handler that may have ended the transaction.) */
  private isFinished(): boolean { return this.state === 'finished'; }

  /** Ends the transaction without its writes (nothing when it has ended). Internal: abort() is the public door. */
  finishAbort(error: DOMException | null): void {
    if (this.isFinished()) return;
    this.error = error;
    this.state = 'finished';
    this.work.clear();
    const rest = this.pending;
    this.pending = [];
    defer(() => {
      for (const {req} of rest) {
        req.error = domError('AbortError', 'The transaction was aborted.');
        req.readyState = 'done';
        try { if (req.onerror) req.onerror(event('error', req)); } catch (err) { this.db.factory.handlerErrors.push(err); }
      }
      try { if (this.onabort) this.onabort(event('abort', this)); } catch (err) { this.db.factory.handlerErrors.push(err); }
    });
    this.leave();
  }

  /** Out of the database's line; the next transaction starts. */
  private leave(): void {
    const queue = this.db.data.queue, at = queue.indexOf(this);
    if (at < 0) return;
    queue.splice(at, 1);
    const head = queue[0];
    if (at === 0 && head && head.created) defer(() => head.drive());
  }
}

export class FakeDatabase {
  onversionchange: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  closed = false;
  /** Inside open's upgradeneeded handler (createObjectStore is allowed). */
  upgrading = false;

  constructor(readonly factory: FakeIndexedDb, readonly data: DbData) {}
  get name(): string { return this.data.name; }
  get version(): number { return this.data.version; }
  get objectStoreNames(): {length: number; contains(name: string): boolean; item(i: number): string | null} {
    const names = [...this.data.stores.keys()].sort();
    return {length: names.length, contains: name => names.includes(name), item: i => names[i] ?? null};
  }

  createObjectStore(name: string, options: {keyPath?: string | null} = {}): {name: string; keyPath: string | null} {
    if (!this.upgrading) throw domError('InvalidStateError', 'Not inside a version change.');
    if (this.data.stores.has(name)) throw domError('ConstraintError', `Object store '${name}' already exists.`);
    const keyPath = options.keyPath ?? null;
    this.data.stores.set(name, {keyPath, records: new Map()});
    return {name, keyPath};
  }

  transaction(names: string | string[], mode: 'readonly' | 'readwrite' = 'readonly'): FakeTransaction {
    if (this.closed) throw domError('InvalidStateError', 'The database connection is closing.');
    const scope = typeof names === 'string' ? [names] : [...names];
    if (scope.length === 0) throw domError('InvalidAccessError', 'No object store named.');
    for (const n of scope) if (!this.data.stores.has(n)) throw domError('NotFoundError', `No object store '${n}'.`);
    if (mode !== 'readonly' && mode !== 'readwrite') throw new TypeError(`Bad transaction mode: ${String(mode)}`);
    return new FakeTransaction(this, scope, mode);
  }

  close(): void {
    this.closed = true;
    this.factory.forget(this);
  }
}

/** The factory: pass it as `indexedDB`. One instance is one browser profile; opening it twice is a page reload. */
export class FakeIndexedDb {
  /** What the next open() does: work, throw at once, fire `error`, fire `blocked` and wait, or never settle. */
  openMode: 'ok' | 'throw' | 'error' | 'blocked' | 'hang' = 'ok';
  openErrorName = 'UnknownError';
  /** While true no transaction makes progress (requests are never answered, nothing completes). */
  hangTransactions = false;
  /** Every request placed, in order. */
  readonly log: FakeLogEntry[] = [];
  /** Whatever a handler of the code under test threw. */
  readonly handlerErrors: unknown[] = [];
  /** open() calls so far. */
  opens = 0;

  private putFailures = 0;
  private putFailureName = 'QuotaExceededError';
  private commitFailures = 0;
  private commitFailureName = 'QuotaExceededError';
  private readonly dbs = new Map<string, DbData>();
  private readonly connections = new Set<FakeDatabase>();
  private held: (() => void)[] = [];

  open(name: string, version?: number): FakeOpenRequest {
    this.opens++;
    const mode = this.openMode;
    if (mode === 'throw') throw domError('SecurityError', 'The operation is insecure.');
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw new TypeError('The version must be a positive integer.');
    const req = new FakeOpenRequest();
    const finish = (): void => this.finishOpen(req, String(name), version);
    defer(() => {
      if (mode === 'error') this.failOpen(req, this.openErrorName, 'The database could not be opened.');
      else if (mode === 'blocked') { if (req.onblocked) req.onblocked(event('blocked', req)); this.held.push(finish); }
      else if (mode === 'hang') this.held.push(finish);
      else finish();
    });
    return req;
  }

  private failOpen(req: FakeOpenRequest, name: string, message: string): void {
    req.error = domError(name, message);
    req.readyState = 'done';
    if (req.onerror) req.onerror(event('error', req));
  }

  private finishOpen(req: FakeOpenRequest, name: string, version: number | undefined): void {
    const existing = this.dbs.get(name);
    const want = version ?? existing?.version ?? 1;
    if (existing && want < existing.version) { this.failOpen(req, 'VersionError', 'The stored database has a higher version.'); return; }
    const data: DbData = existing ?? {name, version: 0, stores: new Map(), queue: []};
    const db = new FakeDatabase(this, data);
    const succeed = (): void => {
      this.connections.add(db);
      req.result = db;
      req.readyState = 'done';
      if (req.onsuccess) req.onsuccess(event('success', req));
    };
    if (want === data.version) { succeed(); return; }
    // The version change: the stores as they were come back if the upgrade is aborted or its handler throws.
    const before = new Map(data.stores);
    let aborted = false;
    db.upgrading = true;
    req.result = db;
    req.transaction = {abort: () => { aborted = true; }};
    try {
      if (req.onupgradeneeded) req.onupgradeneeded(event('upgradeneeded', req, {oldVersion: data.version, newVersion: want}));
    } catch (err) {
      this.handlerErrors.push(err);
      aborted = true;
    }
    db.upgrading = false;
    req.transaction = null;
    if (aborted) {
      data.stores = before;
      db.closed = true;
      req.result = undefined;
      defer(() => this.failOpen(req, 'AbortError', 'The version change was aborted.'));
      return;
    }
    data.version = want;
    this.dbs.set(name, data);
    defer(succeed);
  }

  // ---- switches

  /** The next `n` put requests fail (the transaction aborts with that error unless the request's error is preventDefault()ed). */
  failNextPuts(n: number, name = 'QuotaExceededError'): void { this.putFailures = n; this.putFailureName = name; }
  /** The next `n` transactions that did something and reach their commit abort with that error instead (how a browser usually reports quota). */
  failNextCommits(n: number, name = 'QuotaExceededError'): void { this.commitFailures = n; this.commitFailureName = name; }
  /** Opens held by 'blocked' / 'hang' finish now (as successes, whatever `openMode` is by then). */
  release(): void {
    const held = this.held;
    this.held = [];
    for (const finish of held) defer(finish);
  }
  /**
   * The browser drops every connection (site data cleared, storage pressure): running transactions abort and `close` fires.
   * `fireClose` false = the event never comes: the page learns of it when its next transaction() throws InvalidStateError.
   */
  closeConnections(fireClose = true): void {
    for (const db of [...this.connections]) {
      db.closed = true;
      this.connections.delete(db);
      for (const tx of [...db.data.queue]) if (tx.db === db) tx.finishAbort(domError('AbortError', 'The connection was closed.'));
      if (fireClose) defer(() => { if (db.onclose) db.onclose(event('close', db)); });
    }
  }
  /** Another tab wants a newer version / to delete the database: every connection is told (`versionchange`). */
  versionChange(): void {
    for (const db of [...this.connections]) defer(() => { if (db.onversionchange) db.onversionchange(event('versionchange', db, {oldVersion: db.version, newVersion: null})); });
  }
  /** The committed records of a store, raw (the live Map: what a devtools panel would show; changing it changes the store). */
  records(db: string, store: string): Map<Key, unknown> {
    const def = this.dbs.get(db)?.stores.get(store);
    if (!def) throw new Error(`fake IndexedDB: no store ${db} / ${store}`);
    return def.records;
  }
  /** Replaces one stored value by `change(value)` (the value given is the stored one itself). */
  corrupt(db: string, store: string, key: Key, change: (value: unknown) => unknown): void {
    const records = this.records(db, store);
    if (!records.has(key)) throw new Error(`fake IndexedDB: no record ${String(key)} in ${db} / ${store}`);
    records.set(key, change(records.get(key)));
  }
  databases(): {name: string; version: number; stores: string[]}[] {
    return [...this.dbs.values()].map(d => ({name: d.name, version: d.version, stores: [...d.stores.keys()].sort()}));
  }
  openConnections(): number { return this.connections.size; }
  /** After everything queued so far has been delivered (`rounds` tasks). */
  async tick(rounds = 4): Promise<void> {
    for (let i = 0; i < rounds; i++) await new Promise<void>(resolve => { setImmediate(resolve); });
  }

  // ---- the fake's own plumbing

  forget(db: FakeDatabase): void { this.connections.delete(db); }
  takePutFailure(): void {
    if (this.putFailures <= 0) return;
    this.putFailures--;
    throw domError(this.putFailureName, 'The put failed.');
  }
  takeCommitFailure(): DOMException | null {
    if (this.commitFailures <= 0) return null;
    this.commitFailures--;
    return domError(this.commitFailureName, 'The commit failed.');
  }
}
