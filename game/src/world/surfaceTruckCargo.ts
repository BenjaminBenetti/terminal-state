/** Finite physical salvage. Records own the cargo; meshes are presentation only. No loot rolls or crafting debit. */
import type {SurfaceDepotCargo} from '../gen/surface/types';
import type {RunParticipant} from '../run/snapshot';

export const SURFACE_SALVAGE_PARTICIPANT = 'surface-salvage';
export const SURFACE_CARGO_LIMIT = 256;
export type SurfaceCargoKind = SurfaceDepotCargo['kind'];
export type SurfaceCargoState = 'depot' | 'truck' | 'carried' | 'ground' | 'installed';
export interface SurfaceCargoRecord {
  uid: string;
  station: string;
  kind: SurfaceCargoKind;
  state: SurfaceCargoState;
  slot: number | null;
  x: number; y: number; z: number; yaw: number;
  /** The actual existing equipment UID, or armor fitted once. Null until successful recovery. */
  recoveredUid: string | null;
}
export interface SurfaceCargoJSON {v: 1; records: SurfaceCargoRecord[]}
const kinds: readonly string[] = ['armor', 'radar', 'scanner', 'sentry'];
const states: readonly string[] = ['depot', 'truck', 'carried', 'ground', 'installed'];
const keys = ['uid', 'station', 'kind', 'state', 'slot', 'x', 'y', 'z', 'yaw', 'recoveredUid'];
const finite = (v: unknown, limit: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;

export function surfaceCargoProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'salvage must be an object';
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => k !== 'v' && k !== 'records') || v.v !== 1 || !Array.isArray(v.records) || v.records.length > SURFACE_CARGO_LIMIT) return 'malformed salvage record';
  const ids = new Set<string>(), slots = new Set<string>(), recovered = new Set<string>();
  let carried = 0;
  for (const raw of v.records) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'malformed salvage unit';
    const r = raw as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some(k => !(k in r)) || Object.keys(r).some(k => !keys.includes(k))) return 'unexpected salvage fields';
    if (typeof r.uid !== 'string' || !/^sr-[A-Za-z0-9:_-]{1,64}-\d{1,10}-[A-Za-z0-9_-]{1,32}$/.test(r.uid) || ids.has(r.uid)) return 'duplicate or invalid salvage UID';
    ids.add(r.uid);
    if (typeof r.station !== 'string' || !/^[A-Za-z0-9:_-]{1,64}$/.test(r.station) || !kinds.includes(String(r.kind)) || !states.includes(String(r.state))) return 'invalid salvage origin or kind';
    if (!finite(r.x, 1e5) || !finite(r.y, 1e4) || !finite(r.z, 1e5) || !finite(r.yaw, 8)) return 'invalid salvage pose';
    if (r.state === 'truck') {
      if (!Number.isInteger(r.slot) || (r.slot as number) < 0 || (r.slot as number) > 3) return 'invalid truck attachment';
      const key = `${r.station}:${r.slot}`;
      if (slots.has(key)) return 'truck attachment occupied twice';
      slots.add(key);
    } else if (r.slot !== null) return 'unattached salvage has a truck slot';
    if (r.state === 'carried' && ++carried > 1) return 'more than one carried salvage unit';
    if (r.state === 'installed') {
      if (r.kind === 'armor' ? r.recoveredUid !== 'armor' : typeof r.recoveredUid !== 'string' || !/^eq-[1-9]\d{0,8}$/.test(r.recoveredUid)) return 'invalid recovered equipment UID';
      if (r.recoveredUid !== 'armor') {
        if (recovered.has(r.recoveredUid as string)) return 'equipment UID recovered twice';
        recovered.add(r.recoveredUid as string);
      }
    } else if (r.recoveredUid !== null) return 'unrecovered salvage has equipment ownership';
  }
  return null;
}

export class SurfaceCargo {
  readonly records: SurfaceCargoRecord[] = [];
  version = 0;
  get carried(): SurfaceCargoRecord | null { return this.records.find(r => r.state === 'carried') ?? null; }
  ensure(seed: number, station: string, list: readonly SurfaceDepotCargo[]): void {
    for (const c of list) {
      const uid = `sr-${station}-${seed >>> 0}-${c.id}`;
      if (this.records.some(r => r.uid === uid)) continue;
      if (this.records.length >= SURFACE_CARGO_LIMIT) throw new Error('Surface salvage capacity exceeded');
      this.records.push({uid, station, kind: c.kind, state: 'depot', slot: null, x: c.x, y: c.y, z: c.z, yaw: c.yaw, recoveredUid: null});
      this.version++;
    }
  }
  secure(uid: string, station: string): string | null {
    const r = this.records.find(r => r.uid === uid);
    if (!r || (r.station !== station && r.state !== 'carried') || !['depot', 'ground', 'carried'].includes(r.state)) return 'That cargo is unavailable';
    const slot = [0, 1, 2, 3].find(s => !this.records.some(k => k.station === station && k.state === 'truck' && k.slot === s));
    if (slot === undefined) return 'All four truck attachment points are occupied';
    r.state = 'truck'; r.station = station; r.slot = slot; this.version++;
    return null;
  }
  take(uid: string): string | null {
    if (this.carried) return 'Put down the cargo in your hands first';
    const r = this.records.find(r => r.uid === uid);
    if (!r || !['depot', 'ground', 'truck'].includes(r.state)) return 'That cargo is unavailable';
    r.state = 'carried'; r.slot = null; this.version++;
    return null;
  }
  drop(station: string, at: {x: number; y: number; z: number; yaw: number}): boolean {
    const r = this.carried;
    if (!r) return false;
    r.state = 'ground'; r.station = station; Object.assign(r, at); this.version++;
    return true;
  }
  /** Mark consumed only AFTER the existing upgrade/equipment API succeeds; refusal leaves the cargo in hand. */
  recover(install: (kind: SurfaceCargoKind) => {uid?: string; error?: string}): string | null {
    const r = this.carried;
    if (!r) return 'No salvage in your hands';
    const result = install(r.kind);
    if (!result.uid) return result.error ?? 'Recovery refused; cargo kept';
    r.state = 'installed'; r.recoveredUid = result.uid; this.version++;
    return null;
  }
  save(): SurfaceCargoJSON { return {v: 1, records: structuredClone(this.records)}; }
  load(data: unknown): void {
    this.records.length = 0;
    if (data !== undefined && surfaceCargoProblem(data) === null) this.records.push(...structuredClone((data as SurfaceCargoJSON).records));
    this.version++;
  }
  reset(): void { this.records.length = 0; this.version++; }
  participant(): RunParticipant { return {id: SURFACE_SALVAGE_PARTICIPANT, save: () => this.save(), load: d => this.load(d), reset: () => this.reset()}; }
}
