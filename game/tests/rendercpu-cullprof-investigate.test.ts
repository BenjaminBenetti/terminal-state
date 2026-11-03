// Lane RENDER-CPU investigation (env-gated: LL_RCPU_PROF_OUT=/tmp/x.txt): V8 CPU profile of LevelCuller.update over mall yaw sweeps
// (self time by function), plus the timing of turning-in-place updates (the culler's real skip logic, 3° per frame).
import {appendFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {mallQaPose} from '../src/gen/mall/qa';
import {eyeCam, realMallScene, startPose, torchOn, type Pose} from './helpers/rendercpuMall';

const OUT = process.env.LL_RCPU_PROF_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };

describe.skipIf(!OUT)('RENDER-CPU: culler CPU profile on mall yaw sweeps', () => {
  it('profile', async () => {
    writeFileSync(OUT!, '');
    const M = await realMallScene(process.env.LL_RCPU_SEED ?? 't3a');
    const c = M.world.culler;
    const ps: Pose[] = [startPose(M.layout)];
    for (const [n, r] of [['ring-edge', 2], ['escalator', 1], ['court', undefined], ['shopfront', 1]] as const) { const p = mallQaPose(M.layout, n, r); if (p) ps.push({name: n + (r ?? ''), x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0}); }
    const sweep = (p: Pose, steps: number) => {
      const cam = eyeCam(p), fl = torchOn(cam);
      c.viewpoints = [fl];
      const ts: number[] = [];
      for (let s = 0; s < steps; s++) {
        cam.rotation.set(0, p.yaw + s * 2 * Math.PI / steps, 0, 'YXZ');
        cam.updateMatrixWorld(true);
        const a = performance.now();
        c.update(cam);
        ts.push(performance.now() - a);
      }
      cam.remove(fl, fl.target);
      return ts;
    };
    for (const p of ps) sweep(p, 120); // JIT warm
    const lines: string[] = [];
    for (const p of ps) {
      const ts = sweep(p, 120).sort((a, b) => a - b); // 3° per frame: the culler's own skip decides
      lines.push(`${p.name}: turning in place 3°/frame: median ${ts[60].toFixed(2)} p95 ${ts[114].toFixed(2)} max ${ts[119].toFixed(2)} ms`);
    }
    for (const l of lines) out(l);
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', {interval: 50});
    await session.post('Profiler.start');
    for (let k = 0; k < 3; k++) for (const p of ps) sweep(p, 120);
    const {profile} = await session.post('Profiler.stop') as {profile: {nodes: {id: number; callFrame: {functionName: string; url: string; lineNumber: number}; hitCount: number; children?: number[]}[]; samples: number[]; timeDeltas: number[]}};
    session.disconnect();
    const self = new Map<string, number>();
    let total = 0;
    for (const nd of profile.nodes) {
      const f = nd.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + nd.hitCount);
      total += nd.hitCount;
    }
    out(`profile samples ${total}`);
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 40)) out(`  ${(100 * v / total).toFixed(1).padStart(5)} %  ${k}`);
    expect(total).toBeGreaterThan(0);
    void THREE;
  }, 600_000);
});
