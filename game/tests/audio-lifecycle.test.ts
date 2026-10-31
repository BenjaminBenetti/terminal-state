import {describe, expect, it} from 'vitest';
import {ROOMS, Sfx, roomKindFor, humEmitters} from '../src/audio/sfx';
import {makeIR} from '../src/audio/reverb';
import {surfaceOf} from '../src/audio/surfaces';
import {FakeCtx, fakeBank, type Panner} from './helpers/fakeAudio';

const settle = () => new Promise(r => setTimeout(r, 40));
const panners = (c: FakeCtx) => c.nodes.filter(n => n.kind === 'panner') as Panner[];
const convolvers = (c: FakeCtx) => c.nodes.filter(n => n.kind === 'convolver').length;
/** 5 looping beds (wind, rumble, HVAC, fridge, buzz) + the positional fridge-hum emitter. */
// five beds + the fridge emitter + (task studio-alpha-track2-round2-20261031-01, R4) the two fan channels on the HVAC recording
const BED_LOOPS = 8;

function makeSfx() {
  const made: FakeCtx[] = [];
  const {bank, buffers} = fakeBank();
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  return {sfx, made, buffers};
}

describe('audio lifecycle (Sound Lab clip bank)', () => {
  it('survives pause -> New station -> resume three times with one context and one ambient system', async () => {
    const {sfx, made} = makeSfx();
    // Title -> Start (enterPlay: init, then setState('playing')).
    sfx.init();
    sfx.suspend(false);
    await settle();
    expect(made[0].state).toBe('running');
    const ambientSources = sfx.debugState().ambientSources;
    const convs = convolvers(made[0]);
    expect(ambientSources).toBe(BED_LOOPS);
    expect(sfx.debugState().bedsPlaying.sort()).toEqual(['buzz', 'fridge', 'hvac', 'rumble', 'wind']);
    expect(convs).toBe(2);

    for (let i = 0; i < 3; i++) {
      sfx.suspend(true); // setState('paused')
      if (i > 0) await settle(); // cycle 0: click New station while the suspend is still pending
      sfx.init(); // restart(): before the rebuild
      sfx.setWorld({occlusion: () => 0, emitters: [{x: 3, y: 1, z: 3}]}); // newStation()
      sfx.init(); // enterPlay()
      sfx.suspend(false); // setState('playing')
      await settle();
      sfx.setRoom(i % 2 ? 'tunnel' : 'large', i % 2 ? 'platform' : 'concourse');
      sfx.setListener(1, 1.6, 2, 0.3);

      const ctx = made[0];
      expect(made.length).toBe(1);
      expect(ctx.state).toBe('running');
      const d = sfx.debugState();
      expect(d).toMatchObject({contexts: 1, state: 'running', desired: 'running', ambientLoops: 1, ambientSources});
      expect(ctx.started.filter(s => s.loop).length).toBe(BED_LOOPS); // beds never restarted or duplicated
      expect(convolvers(ctx)).toBe(convs); // reverb slots are reused, never rebuilt

      const nodesBefore = ctx.nodes.length, startedBefore = ctx.started.length;
      sfx.shot('rifle');
      expect(ctx.started.length).toBeGreaterThan(startedBefore);
      expect(ctx.nodes.slice(nodesBefore).every(n => n.context === ctx)).toBe(true);
      expect(sfx.debugState().sounds).toBeGreaterThan(d.sounds);
    }

    // Cues requested while paused are dropped, not queued for a burst on resume.
    sfx.suspend(true);
    const before = made[0].started.length;
    sfx.footstep(false);
    sfx.impact(2, 1, 2, 'metal');
    sfx.casing(1, 0, 1, 3, 'rifle');
    expect(made[0].started.length).toBe(before);
  });

  it('routes world sounds through panners (HRTF for vocals), culls far ones and rate-limits casings', async () => {
    const {sfx, made} = makeSfx();
    sfx.init();
    await settle();
    const ctx = made[0];
    sfx.setListener(0, 1.6, 0, 0);
    expect(ctx.listener.pos).toEqual([0, 1.6, 0]);

    let p0 = panners(ctx).length;
    sfx.impact(3, 1, -4, 'concrete');
    expect(panners(ctx).length).toBe(p0 + 1);
    const imp = panners(ctx).at(-1)!;
    expect([imp.positionX.value, imp.positionY.value, imp.positionZ.value]).toEqual([3, 1, -4]);
    expect(imp.panningModel).toBe('equalpower');

    p0 = panners(ctx).length;
    sfx.groan(5, 1.6, 5, false);
    expect(panners(ctx).length).toBe(p0 + 1);
    expect(panners(ctx).at(-1)!.panningModel).toBe('HRTF');

    // own gunshot is listener-local: no panner
    p0 = panners(ctx).length;
    sfx.shot('shotgun');
    expect(panners(ctx).length).toBe(p0);

    // far away: culled, nothing created
    const n0 = ctx.nodes.length;
    sfx.impact(400, 1, 0, 'tile');
    sfx.bodyFall(300, 0, 0, 1);
    expect(ctx.nodes.length).toBe(n0);

    // a burst of 200 casing contacts in one instant plays only the bucket's burst
    const s0 = ctx.started.length;
    for (let i = 0; i < 200; i++) sfx.casing(0.5, 0, 0.5, 2.5, i % 2 ? 'rifle' : 'shell');
    expect(ctx.started.length - s0).toBeLessThanOrEqual(6);
    expect(ctx.started.length - s0).toBeGreaterThan(0);
    // ...and refills with time
    ctx.currentTime += 1;
    const s1 = ctx.started.length;
    sfx.casing(0.5, 0, 0.5, 2.5, 'rifle');
    expect(ctx.started.length).toBe(s1 + 1);

    // voice cap holds under a flood of low-priority world sounds
    for (let i = 0; i < 300; i++) { ctx.currentTime += 0.05; sfx.zombieStep(2, 2, true); sfx.impact(2, 1, 2, 'wood'); }
    expect(sfx.debugState().voices).toBeLessThanOrEqual(44);

    // room changes crossfade the two existing convolvers, ambience follows the area type
    sfx.setRoom('small', 'supply-closet');
    expect(sfx.debugState()).toMatchObject({room: 'small', area: 'supply-closet', convolvers: 2});
    sfx.setRoom('tunnel', 'platform');
    expect(sfx.debugState().beds.wind).toBeGreaterThan(0.5);
    expect(convolvers(ctx)).toBe(2);
  });

  it('consumable, vitals, container, traversal and ragdoll cues exist and start clip sources', async () => {
    const {sfx, made} = makeSfx();
    sfx.init();
    await settle();
    const ctx = made[0];
    const at = {x: 1, y: 1, z: 1};
    const cues = [
      () => sfx.eat('chips'), () => sfx.eat('mystery-food'), () => sfx.drink('cola'), () => sfx.drink('mystery-drink'), () => sfx.bodyFall(1, 0, 1, 0.8),
      () => sfx.reloadStart('rifle', true), () => sfx.reloadEnd('rifle'), () => sfx.reloadStart('shotgun'), () => sfx.reloadEnd('shotgun'), () => sfx.dry('shotgun'),
      () => sfx.containerOpen('cabinetTall', at), () => sfx.containerClose('crate', at), () => sfx.containerOpen('fridge', at), () => sfx.pry('vending', at),
      () => sfx.search(), () => sfx.ladder(), () => sfx.ladder(at), () => sfx.land(0.7), () => sfx.jump(), () => sfx.crouch(true), () => sfx.win(), () => sfx.death(),
    ];
    for (const f of cues) {
      const s0 = ctx.started.length;
      f();
      expect(ctx.started.length).toBeGreaterThan(s0);
    }
    // doorless surfaces only rummage (search), they have no open/close cue
    const s0 = ctx.started.length;
    sfx.containerOpen('shelf', at);
    sfx.containerClose('table', at);
    expect(ctx.started.length).toBe(s0);
    sfx.vitals(0.1, 0.1, 0.05);
    expect(ctx.started.length).toBeGreaterThan(s0);
  });
});

describe('reverb kernels (processing only)', () => {
  it('builds all four room IRs quickly at 48 kHz with finite, non-silent data', () => {
    const ctx = {sampleRate: 48000, createBuffer: (c: number, len: number, sr: number) => { const d = Array.from({length: c}, () => new Float32Array(len)); return {length: len, numberOfChannels: c, sampleRate: sr, duration: len / sr, getChannelData: (i: number) => d[i]}; }} as unknown as BaseAudioContext;
    const t0 = performance.now();
    const irs = (Object.keys(ROOMS) as (keyof typeof ROOMS)[]).map(k => makeIR(ctx, ROOMS[k]));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500); // one-time, page lifetime
    for (const b of irs) {
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        let peak = 0, finite = true;
        for (let i = 0; i < d.length; i++) { finite &&= Number.isFinite(d[i]); peak = Math.max(peak, Math.abs(d[i])); }
        expect(finite).toBe(true);
        expect(peak).toBeGreaterThan(0.01);
        expect(peak).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe('feedback mapping', () => {
  it('maps area types (incl. new ones) to reverb rooms with a size fallback', () => {
    expect(roomKindFor({type: 'platform', kind: 'platform', w: 120, h: 12})).toBe('tunnel');
    expect(roomKindFor({type: 'food-court', kind: 'concourse', w: 40, h: 30})).toBe('large');
    expect(roomKindFor({type: 'supply-closet', kind: 'closet', w: 5, h: 4})).toBe('small');
    expect(roomKindFor({type: 'service-corridor', kind: 'service', w: 40, h: 4})).toBe('medium');
    expect(roomKindFor({type: 'mystery-hall', kind: 'room', w: 60, h: 40})).toBe('large');
    expect(roomKindFor({type: 'mystery-box', kind: 'room', w: 6, h: 6})).toBe('small');
    expect(humEmitters([{kind: 'vending', x: 1, y: 0, z: 2, h: 1.85}, {kind: 'bench', x: 0, y: 0, z: 0, h: 0.8}])).toHaveLength(1);
  });

  it('guesses hit surfaces from area finish and prop kind', () => {
    const areas = [{kind: 'concourse', type: 'concourse', publicSpace: true}, {kind: 'room', type: 'storage', publicSpace: false}, {kind: 'platform', type: 'platform', publicSpace: true}];
    const grid = {areaAt: (x: number) => (x < 10 ? 0 : x < 20 ? 1 : 2)};
    const props = [{kind: 'crate', x: 5, y: 0, z: 5, hx: 0.3, hz: 0.2, h: 0.43}, {kind: 'vending', x: 6, y: 0, z: 5, hx: 0.47, hz: 0.42, h: 1.85}];
    const w = {grid, areas, props};
    expect(surfaceOf('wall', 5, 1, 0, 0, 1, w)).toBe('tile');
    expect(surfaceOf('wall', 15, 1, 0, 0, 1, w)).toBe('concrete');
    expect(surfaceOf('floor', 5, 0, 1, 0, 0, w)).toBe('tile');
    expect(surfaceOf('floor', 25, 0, 1, 0, 0, w)).toBe('concrete');
    expect(surfaceOf('floor', 25, -1.15, 1, 0, 0, w)).toBe('concrete');
    expect(surfaceOf('prop', 5.3, 0.2, 5, 1, 0, w)).toBe('wood');
    expect(surfaceOf('prop', 6, 1, 5.42, 0, 1, w)).toBe('metal');
    expect(surfaceOf('ceiling', 5, 3, 1, 0, 0, w)).toBe('concrete');
  });
});
