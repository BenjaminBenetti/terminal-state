// Task studio-market-bar-20261108-225231-01 (lane AUDIO): THE MARKET'S SOUNDS — Game.marketAudio (the seam market/marketAudio.ts
// MarketAudioApi). User: "Subtle cash-register sound on buy/sell." "Background chatter; screams from fleeing survivors and angry grunts from
// attackers." Sound Lab clips (audio/sfx.ts MARKET_AUDIO plays them; provenance derivatives/audio-market-bar.json; not auditioned by ear).
// installMarketAudio(game) is called ONCE in the Game constructor (after the market people / combat installs: its section build reads them)
// and only registers a section hook + a frame hook; it is inert on every level without `layout.market` (no chatter, no voices).
//
//  - cash(): ONE subtle register cue — the trade's success commit calls it (market/trade/tradeSystem.ts TradeSystem.done: a successful
//    sell / buy, Confirm or Ctrl+click alike); never a preview / quote / refusal / cancel / theft (those never reach the commit).
//  - CHATTER: every `tick` s the calm people near the player (market/marketPeople.ts roster; calm = the settlement is not hostile and the
//    person's combat record, if any, is alive, neither hiding nor alarmed: HIDING_MODES / ALARMED_MODES) are grouped (greedy: the nearest
//    ungrouped person and everyone within `groupRadius` m on its storey) — a group of at least `minPeople` is a murmur at its centroid's
//    head height, its level sqrt(n / full) (more people, louder; capped at 1) with an edge fade at the range, the nearest `voices` groups;
//    a group within `barRadius` of a bar post (layout v3's 'drink' spots / a 'bar' stall's trader) murmurs with the BAR take. The levels sum to at most `totalCap`. Sfx.crowdChatter turns the
//    groups into at most three positional loops on the ambient bus (own-shot ducking, pause mute). HOSTILE: no calm people — every channel
//    fades (the murmur DUCKS out; the screams / grunts take over). Dead / hiding / gone people never count. Teardown / leaving the level:
//    Sfx.stopCrowd. Other levels: nothing.
//  - scream(id, x, y, z) / grunt(id, x, y, z): the PEOPLE lane calls them at events (a fleer panics / runs, a fighter draws / is hit / now
//    and then while fighting); x, y, z = the person's FEET (actor.x / y / z; the mouth height is added here). Each request passes, in order:
//    the person is live (not dead, not hiding — HIDING_MODES —, still in the roster), its own cooldown (`cooldown` s after its last
//    accepted one), one voice per person at a time, the kind's density cap (`perWindow` starts in any `window` s, queued ones included),
//    then it is STAGGERED: it starts at least `gap` s after the kind's previous start (the provocation turns everyone at once — a ripple,
//    not a chord), within `maxWait` s or it is dropped. At its start the person's CURRENT position is used and it must still be live; the
//    voice follows the person and fades the frame they die / hide / vanish. Each person keeps one voice pitch (`rate`, from its id).
//  - retch(): the player's retch (the throw-up action, Game.vomit) — on ANY level (a beer can be drunk anywhere).
import type {MarketLayout} from '../../gen/market/marketTypes';
import type {CrowdCue, CrowdGroup, MarketVoiceHandle, MarketVoiceKind} from '../../audio/sfx';
import {hashString} from '../../core/rng';
import type {MarketAudioApi} from '../marketAudio';

/** Tuning (first estimates for the ear pass). */
export const MARKET_SOUNDS = {
  /** Crowd regrouping cadence (s). */
  tick: 0.25,
  chatter: {range: 30, groupRadius: 7, groupRise: 2.2, minPeople: 2, full: 6, edge: 0.25, voices: 3, totalCap: 1.8, barRadius: 5, headY: 1.5},
  scream: {cooldown: [5, 9] as const, gap: [0.25, 0.5] as const, maxWait: 1.2, window: 2, perWindow: 4, queue: 6, rate: [0.9, 1.1] as const, headY: 1.55},
  grunt: {cooldown: [2.5, 5] as const, gap: [0.15, 0.35] as const, maxWait: 0.8, window: 2, perWindow: 5, queue: 6, rate: [0.9, 1.08] as const, headY: 1.5},
  /** Fade of a person's voice when they die / hide / vanish (s); of the murmur on teardown (s). */
  silenceFade: 0.15, teardownFade: 0.4,
} as const;

/** Combat modes in which a person is HIDING (market/combat/marketCombat.ts; the PEOPLE lane's refuge hiding): silent. */
export const HIDING_MODES: ReadonlySet<string> = new Set(['hide', 'hidden', 'hiding', 'cower', 'cowering']);
/** Combat modes of an ALARMED person (panicking / fleeing / fighting): never part of the calm murmur. Any other live mode counts as calm. */
export const ALARMED_MODES: ReadonlySet<string> = new Set(['panic', 'flee', 'draw', 'engage', 'move', 'cover', 'reload']);

/** The Sfx surface this needs (audio/sfx.ts). */
export interface MarketSfx {
  marketCash(): boolean;
  marketVoice(kind: MarketVoiceKind, x: number, y: number, z: number, o?: {rate?: number}): MarketVoiceHandle | null;
  marketRetch(): number;
  crowdChatter(groups: readonly CrowdGroup[]): void;
  stopCrowd(fadeS?: number): void;
}
interface Pt { x: number; y: number; z: number }
/** A combat record of a person (market/combat/marketCombat.ts MarketCombatant): alive / dead / fled, its mode, its actor. */
export interface MarketAudioPerson { readonly id: string; readonly state: string; readonly mode: string; readonly actor: Pt }

/** What it needs from Game (structural: tests drive it with stubs). */
export interface MarketAudioHost {
  sfx: MarketSfx;
  player: Pt;
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  /** The market's people (traders + residents) with their ids; read live. */
  marketPeople?: {readonly roster: readonly {readonly id: string; readonly actor: Pt}[]} | null;
  /** Their combat records (state / mode); read live. */
  marketCombat?: {readonly people: readonly MarketAudioPerson[]} | null;
  marketHostility?: {readonly hostile: boolean} | null;
}

interface Pending { kind: MarketVoiceKind; id: string; at: number; until: number; x: number; y: number; z: number }

const between = (r: number, a: readonly [number, number]) => a[0] + r * (a[1] - a[0]);
/** A deterministic 0..1 per (person id, salt) — the person's own voice pitch. */
const unit = (id: string, salt: string) => (hashString(`${salt}:${id}`, 0x6d61726b) >>> 0) / 4294967296;

export class MarketSounds implements MarketAudioApi {
  /** This station's market (null: not a market — everything inert but the retch / register). */
  market: MarketLayout | null = null;
  /** Bar posts (layout v3 'drink' spots, a 'bar' stall's trader): a crowd near one murmurs with the bar take. */
  barPosts: Pt[] = [];
  /** Gameplay clock (s; frames only). */
  clock = 0;
  private tickT = 0;
  private next = new Map<string, number>();
  private voices = new Map<string, {kind: MarketVoiceKind; h: MarketVoiceHandle}>();
  private pending: Pending[] = [];
  private starts: Record<MarketVoiceKind, number[]> = {scream: [], grunt: []};
  private lastStart: Record<MarketVoiceKind, number> = {scream: -Infinity, grunt: -Infinity};
  /** The groups handed to the audio at the last tick (QA / tests). */
  lastGroups: CrowdGroup[] = [];
  /** QA / tests. */
  readonly counts = {cash: 0, retch: 0, screams: 0, grunts: 0, requests: 0, offLevel: 0, quiet: 0, cooldown: 0, busy: 0, capped: 0, late: 0, silenced: 0, ticks: 0};
  /** Random source of cooldowns / gaps (tests may pin it). */
  rand: () => number = Math.random;

  constructor(readonly host: MarketAudioHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: (layout: never) => this.build(layout as {market?: MarketLayout} | null), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    return this;
  }

  // ------------------------------------------------------------------------------------------------------------------- the API

  cash(): void {
    this.counts.cash++;
    this.host.sfx.marketCash();
  }

  scream(personId: string, x: number, y: number, z: number): void { this.request('scream', personId, x, y, z); }

  grunt(personId: string, x: number, y: number, z: number): void { this.request('grunt', personId, x, y, z); }

  retch(): void {
    this.counts.retch++;
    this.host.sfx.marketRetch();
  }

  // ------------------------------------------------------------------------------------------------------------------- lifecycle

  build(layout: {market?: MarketLayout} | null): void {
    this.teardown();
    const m = layout?.market;
    if (!m || !Array.isArray(m.stalls)) return;
    this.market = m;
    this.barPosts = [
      ...(m.spots ?? []).filter(s => s.kind === 'drink').map(s => ({x: s.x, y: s.y, z: s.z})),
      ...m.stalls.filter(s => (s.id as string) === 'bar').map(s => ({x: s.trader.x, y: s.trader.y, z: s.trader.z})),
    ];
    this.tickT = MARKET_SOUNDS.tick; // the first frame groups at once
  }

  teardown(): void {
    const was = this.market !== null || this.voices.size > 0;
    this.market = null;
    this.barPosts = [];
    for (const v of this.voices.values()) v.h.stop(MARKET_SOUNDS.silenceFade);
    this.voices.clear();
    this.pending = [];
    this.next.clear();
    this.starts = {scream: [], grunt: []};
    this.lastStart = {scream: -Infinity, grunt: -Infinity};
    this.lastGroups = [];
    if (was) this.host.sfx.stopCrowd(MARKET_SOUNDS.teardownFade);
  }

  frame(dt: number): void {
    if (!this.market) return;
    const d = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.clock += d;
    this.startDue();
    this.follow();
    this.tickT += d;
    if (this.tickT >= MARKET_SOUNDS.tick) {
      this.tickT = 0;
      this.counts.ticks++;
      this.lastGroups = this.groups();
      this.host.sfx.crowdChatter(this.lastGroups);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- people

  private get hostile(): boolean { return this.host.marketHostility?.hostile === true; }

  /** A person's combat record (undefined: none — no combat system, or not a person of this market). */
  private record(id: string): MarketAudioPerson | undefined {
    return this.host.marketCombat?.people.find(p => p.id === id);
  }

  /** Where a person is now (the combat record's actor, else the roster's), or null when not in this market. */
  private where(id: string): Pt | null {
    const r = this.record(id);
    if (r) return r.actor;
    return this.host.marketPeople?.roster.find(p => p.id === id)?.actor ?? null;
  }

  /** Dead, fled (gone), hiding, or not a person of this market (when the market knows its people). */
  quiet(id: string): boolean {
    const r = this.record(id);
    if (r) return r.state !== 'alive' || HIDING_MODES.has(r.mode);
    const combat = this.host.marketCombat?.people.length ?? 0, roster = this.host.marketPeople?.roster;
    if (combat > 0) return true; // the combat system knows everyone: not among them = gone
    return !!roster && roster.length > 0 && !roster.some(p => p.id === id);
  }

  // ------------------------------------------------------------------------------------------------------------------- voices

  private request(kind: MarketVoiceKind, id: string, x: number, y: number, z: number): void {
    this.counts.requests++;
    if (!this.market) { this.counts.offLevel++; return; }
    if (typeof id !== 'string' || ![x, y, z].every(Number.isFinite)) return;
    if (this.quiet(id)) { this.counts.quiet++; return; }
    const K = MARKET_SOUNDS[kind], now = this.clock, key = `${kind}:${id}`;
    if (now < (this.next.get(key) ?? -Infinity)) { this.counts.cooldown++; return; }
    if (this.voices.get(id)?.h.playing || this.pending.some(p => p.id === id)) { this.counts.busy++; return; }
    const queued = this.pending.filter(p => p.kind === kind).length;
    this.starts[kind] = this.starts[kind].filter(t => now - t < K.window);
    if (this.starts[kind].length + queued >= K.perWindow || queued >= K.queue) { this.counts.capped++; return; }
    const at = Math.max(now, this.lastStart[kind] + between(this.rand(), K.gap));
    if (at - now > K.maxWait) { this.counts.capped++; return; }
    this.next.set(key, now + between(this.rand(), K.cooldown));
    this.lastStart[kind] = at;
    this.pending.push({kind, id, at, until: now + K.maxWait + 0.25, x, y, z});
    this.startDue();
  }

  /** Start the queued voices whose time has come (the person's current position; still live). */
  private startDue(): void {
    if (!this.pending.length) return;
    const now = this.clock, keep: Pending[] = [];
    for (const p of this.pending) {
      if (p.at > now + 1e-9) { if (now <= p.until) keep.push(p); else this.counts.late++; continue; }
      if (this.quiet(p.id)) { this.counts.quiet++; continue; }
      const K = MARKET_SOUNDS[p.kind], pos = this.where(p.id) ?? p;
      const h = this.host.sfx.marketVoice(p.kind, pos.x, pos.y + K.headY, pos.z, {rate: between(unit(p.id, p.kind), K.rate)});
      this.starts[p.kind].push(now);
      if (!h) { this.counts.capped++; continue; }
      this.voices.set(p.id, {kind: p.kind, h});
      if (p.kind === 'scream') this.counts.screams++; else this.counts.grunts++;
    }
    this.pending = keep;
  }

  /** Sounding voices follow their people; a person who died / hid / vanished is silenced; ended ones are forgotten. */
  private follow(): void {
    for (const [id, v] of this.voices) {
      if (!v.h.playing) { this.voices.delete(id); continue; }
      if (this.quiet(id)) { v.h.stop(MARKET_SOUNDS.silenceFade); this.voices.delete(id); this.counts.silenced++; continue; }
      const p = this.where(id);
      if (p) v.h.setPos(p.x, p.y + MARKET_SOUNDS[v.kind].headY, p.z);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- chatter

  /** The calm people's murmur groups near the player (none while hostile / off the market). */
  groups(): CrowdGroup[] {
    if (!this.market || this.hostile) return [];
    const C = MARKET_SOUNDS.chatter, P = this.host.player, roster = this.host.marketPeople?.roster ?? [];
    const pts: (Pt & {d: number})[] = [];
    for (const r of roster) {
      const rec = this.record(r.id);
      if (rec && (rec.state !== 'alive' || HIDING_MODES.has(rec.mode) || ALARMED_MODES.has(rec.mode))) continue;
      const a = rec?.actor ?? r.actor;
      if (![a.x, a.y, a.z].every(Number.isFinite)) continue;
      const d = Math.hypot(a.x - P.x, a.y - P.y, a.z - P.z);
      if (d < C.range) pts.push({x: a.x, y: a.y, z: a.z, d});
    }
    pts.sort((p, q) => p.d - q.d);
    const used = new Uint8Array(pts.length), out: CrowdGroup[] = [];
    for (let i = 0; i < pts.length && out.length < C.voices; i++) {
      if (used[i]) continue;
      const seed = pts[i], members: Pt[] = [];
      for (let j = i; j < pts.length; j++) {
        if (used[j] || Math.abs(pts[j].y - seed.y) > C.groupRise || Math.hypot(pts[j].x - seed.x, pts[j].z - seed.z) > C.groupRadius) continue;
        used[j] = 1;
        members.push(pts[j]);
      }
      if (members.length < C.minPeople) continue; // one person alone is not a crowd
      const n = members.length, cx = members.reduce((s, m) => s + m.x, 0) / n, cy = members.reduce((s, m) => s + m.y, 0) / n, cz = members.reduce((s, m) => s + m.z, 0) / n;
      const d = Math.hypot(cx - P.x, cy - P.y, cz - P.z), edge = Math.max(0, Math.min(1, (C.range - d) / (C.edge * C.range)));
      const level = Math.min(1, Math.sqrt(n / C.full)) * edge;
      if (level <= 0) continue;
      const bar = this.barPosts.some(b => Math.abs(b.y - cy) <= C.groupRise && Math.hypot(b.x - cx, b.z - cz) <= C.barRadius);
      const cue: CrowdCue = bar ? 'marketBarChatter' : 'marketChatter';
      out.push({x: cx, y: cy + C.headY, z: cz, level, cue});
    }
    const sum = out.reduce((s, g) => s + g.level, 0);
    if (sum > C.totalCap) for (const g of out) g.level *= C.totalCap / sum;
    return out;
  }

  /** QA: a compact state report. */
  qa() {
    return {market: !!this.market, hostile: this.hostile, groups: this.lastGroups.map(g => ({cue: g.cue, level: +g.level.toFixed(3)})), voices: this.voices.size,
      pending: this.pending.length, counts: {...this.counts}};
  }
}

/** Installs the market's sounds into a Game (one call in the Game constructor, after the market people / combat). */
export function installMarketAudio(game: unknown): MarketSounds {
  return new MarketSounds(game as MarketAudioHost).install();
}

/** QA hook (spread into window.__LL by qa.ts) for SHORT serial browser spot checks: the system's groups / voices / counts + the Sfx side. */
export function marketAudioQaApi(sys: () => unknown, sfxState: () => unknown) {
  return {
    /** {system: groups handed to the audio, sounding voices, queued starts, counters; sfx: crowd channels (murmur, level), voices, counters}. */
    marketAudio: () => { const s = sys(); return {system: s instanceof MarketSounds ? s.qa() : null, sfx: sfxState()}; },
  };
}
