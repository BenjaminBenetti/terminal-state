// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the friendly market humans — model file, clip names and the SEEDED
// look picker. Pure data / logic (no three.js), so Node tests and the CPU QA agree with the runtime.
//
// The people are five healthy Meshy T2.5 base bodies (each in its own base layer: tee / long-sleeve, trousers, boots / sneakers) with
// ordinary wearables from the zombie wardrobe's catalogue fitted OFFLINE to each of them (tools/asset-pipeline/humans), all in ONE
// level-only file (market-human-cast.glb: LEVEL_ONLY_RULES 'market'). A look = body + at most one wearable per slot (upper, lower,
// head) + a stature scale 0.95..1.05. Looks are seeded from (station seed, role, index) on their OWN hash streams: no draw on any
// generator / game RNG stream. Traders (one per stall) are pairwise distinct; residents vary freely.

import {hashString, mulberry32} from '../core/rng';

/** Lazy prop-library key + file of the cast (catalogue bytes = the GLB's size; tests/market-people-assets.test.ts checks it). */
export const MARKET_HUMAN_KEY = 'market_humanCast';
export const MARKET_HUMAN_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {
  [MARKET_HUMAN_KEY]: {url: 'assets/models/market-human-cast.glb', bytes: 13_729_296},
};

/** The cast model keys a layout needs: only the market (layout.market) ever fetches the humans. */
export function marketHumanModelKeys(layout: {market?: unknown}): string[] {
  return layout.market ? [MARKET_HUMAN_KEY] : [];
}

/** The healthy clips every body carries (tools/asset-pipeline/humans/lib/clips.mjs HUMAN_CLIP_SPECS). Never the zombie set. */
export const HUMAN_CLIPS = ['Idle', 'Walk', 'Talk', 'Greet', 'Work', 'Sit'] as const;
export type HumanClip = typeof HUMAN_CLIPS[number];
/** One-shot clips (played once, then back to the loop that was running). */
export const HUMAN_ONE_SHOTS: readonly HumanClip[] = ['Greet'];

export type HumanSlot = 'upper' | 'lower' | 'head';
export const HUMAN_SLOTS: readonly HumanSlot[] = ['upper', 'lower', 'head'];

export interface HumanLook {
  body: string;
  wear: Partial<Record<HumanSlot, string>>;
  /** Stature multiplier (0.95..1.05). */
  scale: number;
}

/** What selection needs: the bodies and, per body, its fitted wearables (+ per-body layering exclusions). */
export interface HumanAvailability {
  bodies: readonly string[];
  /** Wearables fitted to `body`, in catalogue order. */
  wear(body: string): readonly {id: string; slot: HumanSlot}[];
  /** Two wearables may be worn together on `body` (the build's per-body layering gate). */
  compatible(body: string, a: string, b: string): boolean;
}

/** Weight of "nothing" per slot against a wearable of weight 1 (the bodies already wear a base layer, so bare is a real look). */
export const HUMAN_NONE_WEIGHTS: Readonly<Record<'trader' | 'resident', Record<HumanSlot, number>>> = {
  // stall keepers wear a jacket / shirt layer more often (distinct, readable silhouettes behind a counter)
  trader: {upper: 0.35, lower: 2.5, head: 1.6},
  resident: {upper: 1.2, lower: 2.0, head: 3.0},
};

export const humanLookKey = (l: HumanLook): string => [l.body, ...HUMAN_SLOTS.filter(s => l.wear[s]).map(s => `${s}=${l.wear[s]}`)].join('|');

/** One seeded look. `avoid` = look keys already taken (retried up to 12 times on a fresh draw of the same stream). */
export function pickHumanLook(seed: number, role: 'trader' | 'resident', index: number, av: HumanAvailability, opts: {body?: string; avoid?: ReadonlySet<string>} = {}): HumanLook {
  const rand = mulberry32(hashString(`market-human:${role}:${index}`, seed >>> 0));
  rand(); // decorrelate from the seed-adjacent first value
  const none = HUMAN_NONE_WEIGHTS[role];
  const pickW = <T>(items: [T, number][]): T => {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = rand() * total;
    for (const [v, w] of items) { r -= w; if (r < 0) return v; }
    return items[items.length - 1][0];
  };
  let look: HumanLook | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const body = opts.body && av.bodies.includes(opts.body) ? opts.body : av.bodies[Math.floor(rand() * av.bodies.length) % av.bodies.length];
    const wear: Partial<Record<HumanSlot, string>> = {};
    const picked: string[] = [];
    for (const slot of HUMAN_SLOTS) {
      const cands = av.wear(body).filter(w => w.slot === slot && picked.every(p => av.compatible(body, p, w.id)));
      if (!cands.length) continue;
      const w = pickW<string | null>([[null, none[slot]], ...cands.map(c => [c.id, 1] as [string, number])]);
      if (w) { wear[slot] = w; picked.push(w); }
    }
    look = {body, wear, scale: +(0.95 + rand() * 0.1).toFixed(4)};
    if (!opts.avoid?.has(humanLookKey(look))) break;
  }
  return look!;
}

/**
 * The market's cast: one trader per stall (pairwise distinct looks; the bodies dealt round a seeded shuffle, so the first five
 * traders are five different people) and `residents` residents. Deterministic per station seed.
 */
export function marketCast(seed: number, traders: number, residents: number, av: HumanAvailability): {traders: HumanLook[]; residents: HumanLook[]} {
  if (!av.bodies.length) return {traders: [], residents: []};
  const order = [...av.bodies];
  const shuffle = mulberry32(hashString('market-human:trader-bodies', seed >>> 0));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(shuffle() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const taken = new Set<string>();
  const out: HumanLook[] = [];
  for (let i = 0; i < traders; i++) {
    const l = pickHumanLook(seed, 'trader', i, av, {body: order[i % order.length], avoid: taken});
    taken.add(humanLookKey(l));
    out.push(l);
  }
  const res: HumanLook[] = [];
  for (let i = 0; i < residents; i++) res.push(pickHumanLook(seed, 'resident', i, av));
  return {traders: out, residents: res};
}

/** The loop a resident plays at a spot of each kind (layout.market.spots[].kind). */
export const SPOT_CLIP: Readonly<Record<'idle' | 'sit' | 'work' | 'cook' | 'sleep' | 'chat' | 'drink', HumanClip>> = {
  idle: 'Idle', sit: 'Sit', work: 'Work', cook: 'Work', sleep: 'Sit', chat: 'Talk',
  drink: 'Sit', // (task studio-market-bar-20261108-225231-01: a bar patron; the PEOPLE lane gives it a drinking clip)
};
