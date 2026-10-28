// Iteration 12 (AUDIO lane, user feedback #5): the player's confirmed enemy hit is a FOREGROUND, listener-relative layer.
// These tests check the Web Audio graph and scheduling with a fake context — they are not a listening test.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CUE_GAIN, HIT_CONFIRM, Sfx, hitConfirmPan} from '../src/audio/sfx';
import {FakeCtx, Node, Src, fakeBank} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settle = () => new Promise(r => setTimeout(r, 40));

type AnyNode = Node & {gain?: {value: number}; pan?: {value: number}; frequency?: unknown; threshold?: unknown; buffer?: unknown};
const isPanner = (n: Node) => n.kind === 'panner';
const isStereo = (n: AnyNode) => 'pan' in n;
const isFilter = (n: AnyNode) => 'frequency' in n;
const isComp = (n: AnyNode) => 'threshold' in n;
const isConv = (n: Node) => n.kind === 'convolver';

/** Every path from `src` to the destination. */
function paths(ctx: FakeCtx, src: Node): AnyNode[][] {
  const out: AnyNode[][] = [];
  const walk = (n: AnyNode, p: AnyNode[]) => {
    if (p.length > 24) return;
    const q = [...p, n];
    if (n === ctx.destination) { out.push(q); return; }
    for (const m of n.outputs) walk(m as AnyNode, q);
  };
  walk(src as AnyNode, []);
  return out;
}
/** The dry (non-reverb) path of a source and its gain product up to (excluding) the master gain feeding the compressor. */
function dry(ctx: FakeCtx, src: Node): {path: AnyNode[]; gain: number} {
  const ps = paths(ctx, src).filter(p => !p.some(isConv));
  expect(ps.length).toBe(1);
  const p = ps[0], ci = p.findIndex(isComp);
  let gain = 1;
  for (const n of p.slice(1, ci - 1)) if (n.gain) gain *= n.gain.value;
  return {path: p, gain};
}

async function setup() {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 3});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  sfx.setListener(0, 1.6, 0, 0); // facing -z; +x is to the right
  const flesh = new Set(bank.get('impactFlesh').map(c => c.buffer as unknown));
  const shots = new Set(['pistolShot', 'rifleShot', 'shotgunShot'].flatMap(c => bank.get(c as 'pistolShot').map(k => k.buffer as unknown)));
  const fleshSrcs = () => ctx.started.filter(s => flesh.has(s.buffer));
  return {sfx, ctx, fleshSrcs, shotSrc: () => ctx.started.filter(s => shots.has(s.buffer))[0] as Src | undefined};
}

describe('foreground player hit confirm: routing', () => {
  it('has no PannerNode, filter or ambience bus on its dry path: clip -> voice -> StereoPanner -> master -> compressor -> out', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    const p0 = ctx.nodes.filter(isPanner).length;
    sfx.shot('pistol');
    sfx.hitConfirm(0, 1.4, -60, {});
    expect(ctx.nodes.filter(isPanner).length).toBe(p0); // the confirm made no PannerNode
    const [src] = fleshSrcs();
    expect(src).toBeTruthy();
    const {path: p} = dry(ctx, src);
    expect(p.length).toBe(7); // source, clip gain, voice in, stereo panner, master, compressor, destination
    expect(p.some(isPanner)).toBe(false);
    expect(p.some(isFilter)).toBe(false);
    expect(isStereo(p[3])).toBe(true);
    expect(isComp(p[5])).toBe(true);
    // the master it feeds is the same one the player's gunshot feeds (the gunshot duck() acts on the separate ambience bus)
    const shot = ctx.started.find(s => !fleshSrcs().includes(s) && !s.loop)!;
    expect(dry(ctx, shot).path.at(-3)).toBe(p[4]);
    // only a small fixed reverb send besides the dry path
    const wet = paths(ctx, src).filter(q => q.some(isConv));
    expect(wet.length).toBeGreaterThan(0);
  });

  it('plays at one fixed level at any distance, with or without occlusion (no distance model, no occlusion filter)', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    const levels: number[] = [];
    for (const [i, d] of [2, 8, 30, 60, 90, 140].entries()) {
      if (i === 3) sfx.setWorld({occlusion: () => 1}); // fully blocked from here on
      ctx.currentTime += 2;
      sfx.shot('rifle');
      sfx.hitConfirm(d * 0.6, 1.2, -d * 0.8, {});
      const src = fleshSrcs().at(-1)!;
      const {path: p, gain} = dry(ctx, src);
      expect(p.some(isFilter) || p.some(isPanner)).toBe(false);
      levels.push(gain);
    }
    for (const g of levels) expect(g).toBeCloseTo(HIT_CONFIRM.level, 9);
    // far louder than the iteration-11 range level (CUE 0.5 x floor 0.4 = 0.2, x0.775 with capped occlusion)
    expect(HIT_CONFIRM.level / (CUE_GAIN.impactFlesh * 0.4)).toBeGreaterThan(3);
  });

  it('starts HIT_CONFIRM.delay after the shot onset (past the gunshot transient), immediately without a recent shot', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    ctx.currentTime = 10;
    sfx.shot('pistol');
    sfx.hitConfirm(0, 1.4, -40, {});
    expect(fleshSrcs()[0].startArgs[0] - 10).toBeCloseTo(HIT_CONFIRM.delay, 9);
    expect(HIT_CONFIRM.delay).toBeGreaterThanOrEqual(0.03);
    expect(HIT_CONFIRM.delay).toBeLessThanOrEqual(0.08);
    ctx.currentTime = 20; // no shot for 10 s (e.g. a future non-gun hit): no artificial delay
    sfx.hitConfirm(0, 1.4, -40, {});
    expect(fleshSrcs()[1].startArgs[0]).toBeCloseTo(20, 9);
  });

  it('pans restrainedly toward the hit (±HIT_CONFIRM.pan)', async () => {
    const L = {x: 0, z: 0, yaw: 0};
    expect(hitConfirmPan(L, 10, 0)).toBeCloseTo(HIT_CONFIRM.pan, 9); // right
    expect(hitConfirmPan(L, -10, 0)).toBeCloseTo(-HIT_CONFIRM.pan, 9); // left
    expect(hitConfirmPan(L, 0, -50)).toBeCloseTo(0, 9); // dead ahead
    expect(hitConfirmPan({x: 0, z: 0, yaw: Math.PI / 2}, 0, -10)).toBeCloseTo(HIT_CONFIRM.pan, 9); // turned left: ahead-point is now on the right
    expect(hitConfirmPan(L, 0, 0)).toBe(0);
    expect(HIT_CONFIRM.pan).toBeLessThanOrEqual(0.3);
    const {sfx, fleshSrcs, ctx} = await setup();
    sfx.shot('rifle');
    sfx.hitConfirm(30, 1.2, 0, {});
    expect(dry(ctx, fleshSrcs()[0]).path[3].pan!.value).toBeCloseTo(HIT_CONFIRM.pan, 9);
  });

  it('dips the player shot voice and the reverb return lightly around the confirm, then restores them', async () => {
    const {sfx, ctx, shotSrc} = await setup();
    ctx.currentTime = 5;
    sfx.shot('shotgun');
    const shotInp = (shotSrc()!.outputs[0] as AnyNode).outputs[0] as AnyNode & {gain: {setTargetAtTime: (v: number, t: number, c: number) => unknown}};
    const calls: [number, number][] = [];
    const orig = shotInp.gain.setTargetAtTime.bind(shotInp.gain);
    shotInp.gain.setTargetAtTime = (v: number, t: number, c: number) => { calls.push([v, t]); return orig(v, t, c); };
    sfx.hitConfirm(0, 1.2, -20, {});
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toBe(HIT_CONFIRM.shotDip);
    expect(calls[0][1]).toBeCloseTo(5 + HIT_CONFIRM.delay - 0.005, 9);
    expect(calls[1][0]).toBe(1);
    expect(calls[1][1]).toBeCloseTo(5 + HIT_CONFIRM.delay + HIT_CONFIRM.dipHold, 9);
    expect(HIT_CONFIRM.shotDip).toBeGreaterThanOrEqual(0.5); // light: no more than -6 dB
    expect(HIT_CONFIRM.reverbDip).toBeGreaterThanOrEqual(0.5);
  });
});

describe('foreground player hit confirm: aggregation and bounds', () => {
  it('one confirm per enemy per shot (pellets of one shot on one enemy never re-trigger)', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    const enemy = {};
    sfx.shot('shotgun');
    for (let i = 0; i < 9; i++) sfx.hitConfirm(0.1 * i, 1.2, -12, enemy);
    expect(fleshSrcs().length).toBe(1);
    ctx.currentTime += 1; // the next shot may confirm the same enemy again
    sfx.shot('shotgun');
    sfx.hitConfirm(0, 1.2, -12, enemy);
    expect(fleshSrcs().length).toBe(2);
  });

  it('several enemies in one shot: one each, staggered and progressively quieter (no loud stacked double-trigger)', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    ctx.currentTime = 3;
    sfx.shot('shotgun');
    for (const x of [-2, 0, 2]) sfx.hitConfirm(x, 1.2, -10, {});
    const s = fleshSrcs();
    expect(s.length).toBe(3);
    s.forEach((src, k) => {
      expect(src.startArgs[0] - 3).toBeCloseTo(HIT_CONFIRM.delay + k * HIT_CONFIRM.stagger, 9);
      expect(dry(ctx, src).gain).toBeCloseTo(HIT_CONFIRM.level * HIT_CONFIRM.multiGain ** k, 9);
    });
  });

  it('is bounded: own voice cap and token bucket; never more than HIT_CONFIRM.maxVoices at once', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    sfx.shot('shotgun');
    for (let i = 0; i < 12; i++) sfx.hitConfirm(i - 6, 1.2, -10, {});
    expect(fleshSrcs().length).toBe(HIT_CONFIRM.maxVoices);
    expect(sfx.debugState().confirmVoices).toBeLessThanOrEqual(HIT_CONFIRM.maxVoices);
    // sustained fire: 20 shots/s for 3 s, every shot a hit on a fresh enemy
    const before = fleshSrcs().length;
    for (let i = 0; i < 60; i++) {
      ctx.currentTime += 0.05;
      sfx.shot('rifle');
      sfx.hitConfirm(0, 1.2, -30, {});
      expect(sfx.debugState().confirmVoices).toBeLessThanOrEqual(HIT_CONFIRM.maxVoices);
    }
    const n = fleshSrcs().length - before;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(4 + 14 * 3 + 1); // bucket: burst 4, 14/s
  });

  it('a world-sound flood cannot steal it (exempt from the shared voice cap)', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    for (let i = 0; i < 80; i++) { sfx.groan(3, 1.6, 3, false); sfx.zombieAttack(2, 1.5, 2); }
    expect(sfx.debugState().voices).toBeGreaterThanOrEqual(44);
    ctx.currentTime += 0.01;
    sfx.shot('pistol');
    sfx.hitConfirm(0, 1.4, -50, {});
    expect(fleshSrcs().length).toBe(1);
  });

  it('is silent on a miss, and world / corpse flesh impacts stay spatial and distance-culled', async () => {
    const {sfx, ctx, fleshSrcs} = await setup();
    sfx.shot('rifle');
    expect(fleshSrcs().length).toBe(0);
    const p0 = ctx.nodes.filter(isPanner).length;
    ctx.currentTime += 1;
    sfx.impact(3, 1, -4, 'flesh'); // corpse hit: unchanged positional impact
    expect(ctx.nodes.filter(isPanner).length).toBe(p0 + 1);
    const n = fleshSrcs().length;
    sfx.impact(300, 1, 0, 'flesh');
    expect(fleshSrcs().length).toBe(n); // still culled beyond 50 m
  });

  it('game.ts calls it once per damaged enemy per shot (after pellet aggregation), passing the enemy', () => {
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    const calls = [...src.matchAll(/sfx\.hitConfirm\(([^)]*)\)/g)];
    expect(calls.length).toBe(1);
    expect(calls[0][1].split(',').map(s => s.trim())).toEqual(['e.point.x', 'e.point.y', 'e.point.z', 'z']);
    const before = src.slice(0, calls[0].index);
    // the nearest enclosing loop is the per-enemy damage map (never the per-pellet loop)
    expect(before.lastIndexOf('for (')).toBe(before.lastIndexOf('for (const [z, e] of dmg)'));
    expect(before.lastIndexOf('for (const [z, e] of dmg)')).toBeGreaterThan(before.lastIndexOf('for (let i = 0; i < def.pellets; i++)'));
  });
});
