// Task studio-death-retry-render-fix-20261114-044607-01 (the user's Chrome / WebGPU report: only after dying and loading the last save,
// at Tollbrook Camp, the world is obscured while the HUD and the held weapon stay clear; a window resize restores it, but at some angles
// the world stops turning while the fog moves). The REAL Game (src/game.ts: every lane, the asset boot, the campaign lifecycle, the
// warm-up, the atmosphere pipeline) runs in Node on three r186's real WebGPURenderer over the VALIDATING no-op device
// (helpers/validatingWebgpu.ts, helpers/headlessGame.ts): a command buffer that references a destroyed texture / buffer, or draws with a
// pipeline that does not match its pass, is rejected whole, as WebGPU does — the cause of the report: the parked car's persistent parts
// kept the previous station's light field after a same-station rebuild, so the station's scene pass was dropped on every frame that drew
// one of them (render/bindingRefresh.ts). Per route: a yaw sweep through every angle after the load, with no dropped submit.
//  - New campaign at a market station -> play (baseline);
//  - death -> "Load last save" (Game.loadLastSave: the dead world torn down, the same station rebuilt, the car at the saved pose);
//  - Pause -> Main menu -> Continue in the same session (the same rebuild with a live world: the same hazard).
// The hazard is asserted present, not assumed: render objects that sample the station light field and were built under the previous
// station are drawn after the load, and the previous station's field was released.
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

interface Binding { isSampledTexture?: boolean; texture?: unknown; textureNode?: {value?: unknown} }
interface RenderObject { id: number; object: {name: string; parent: unknown}; getBindings(): {bindings: Binding[]}[] }

describe('death -> Load last save on the WebGPU path (real Game, validating device)', () => {
  it('no dropped submit at any angle after Load last save or Main menu > Continue; the light field reaches the parts that outlive the station', async () => {
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const h = installHeadless();
    const {Game} = await import('../src/game');
    const {LF, activeLightField} = await import('../src/world/lightFieldNode');
    const game = new Game(h.canvas, false);
    const g = game as unknown as {player: {yaw: number; takeDamage(n: number): void}; state: string};
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    expect(game.gpu?.label).toBe('Renderer: WebGPU');
    await game.load(() => {});

    // every draw: the render object, and whether it samples the station light field (its node follows LF.tex)
    const drawn = new Map<string, Map<number, RenderObject>>();
    let phase = 'boot';
    const backend = game.renderer.backend as unknown as {draw(ro: RenderObject, info: unknown): void};
    const draw = backend.draw.bind(backend);
    backend.draw = (ro: RenderObject, info: unknown) => {
      let m = drawn.get(phase);
      if (!m) drawn.set(phase, (m = new Map()));
      m.set(ro.id, ro);
      draw(ro, info);
    };
    const fieldBindings = (ro: RenderObject) => ro.getBindings().flatMap(b => b.bindings).filter(b => b.isSampledTexture && b.textureNode?.value === LF.tex.value);
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    const sweep = async (name: string) => {
      phase = name;
      h.log.reset();
      await h.waitFrames(20);
      const y0 = g.player.yaw;
      for (let i = 0; i < 24; i++) { g.player.yaw = y0 + (i / 24) * Math.PI * 2; await h.waitFrames(2); }
      g.player.yaw = y0;
      await h.waitFrames(4);
      return {submits: h.log.submits, dropped: h.log.dropped, issues: h.log.issues.slice(0, 5).map(i => i.detail)};
    };

    // 1. a new campaign at a market station (the user's Tollbrook Camp is one)
    phase = 'newgame';
    const r = await game.newCampaign(1, {overwrite: true, dev: {level: 'market'}});
    expect(r).toMatchObject({ok: true, saved: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const base = await sweep('play');
    expect(base.submits).toBeGreaterThan(100);
    expect(base, 'baseline: nothing dropped').toMatchObject({dropped: 0, issues: []});

    // 2. death -> Load last save
    const field1 = activeLightField()!;
    const release1 = vi.spyOn(field1, 'dispose');
    g.player.takeDamage(1e6);
    expect(await until(() => g.state === 'dead', 300)).toBe(true);
    await h.waitFrames(30); // (the death screen keeps the frozen frame fresh)
    phase = 'reload';
    expect(await game.loadLastSave()).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const afterDeath = await sweep('after-death');
    expect(release1, 'the previous station field was released (after the warm-up)').toHaveBeenCalled();
    expect(activeLightField()).not.toBe(field1);
    // the hazard: render objects built under station 1 that sample the field are drawn after the load — bound to the NEW field
    const before = drawn.get('play')!;
    const outlived = [...drawn.get('after-death')!.values()].filter(ro => before.has(ro.id) && fieldBindings(ro).length > 0);
    expect(outlived.length, 'light-field render objects outliving the station swap (the parked car\'s parts)').toBeGreaterThan(0);
    expect(afterDeath, 'Load last save: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    for (const ro of outlived) for (const b of fieldBindings(ro)) expect(b.texture, ro.object.name).toBe(activeLightField()!.texture);

    // 3. Pause -> Main menu -> Continue in the same session (the same station rebuilt with a live world)
    const field2 = activeLightField()!;
    const release2 = vi.spyOn(field2, 'dispose');
    game.setState('paused');
    await h.waitFrames(10);
    game.returnToMenu();
    await h.waitFrames(10);
    phase = 'continue';
    expect(await game.continueCampaign(1)).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const afterMenu = await sweep('after-menu');
    expect(release2).toHaveBeenCalled();
    expect(afterMenu, 'Main menu > Continue: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});

    expect(frameErrors).toEqual([]);
    expect(errors).toEqual([]);
    h.stop();
  }, 600_000);
});
