// Task studio-skywalk-variety-20261107-231448-01 (lane PERF, user: "looking in some directions causes lag. Report attached."): the
// Skyways' render-object budget per view, measured in Node on the REAL build path (tests/helpers/skywaysPerfScene.ts: the generated
// layout, the game's world / holders + loot display / shelf stock builders with the stripped real models, the glazing / add-on /
// exterior section runtimes, the enemies, the floor pickups and the prize car), like tests/reactor-cpu-submit.test.ts.
//
// The user's native trace (Skyways station "Ambry Hill", level seed 103855126, WebGPU, quality high, 6 render passes; the player on the
// +15 storey around (33.6, 78.3) turning on the spot): CPU render submission tracked the draw count (corr 0.95, ~21 us / draw over all
// passes) — facing yaw 240-330 deg 840-980 draws / 19-20 ms, facing 30-120 deg 300-500 / 7-10 ms; GPU ~6 ms. The Skyways culler had no
// occlusion options: other buildings' shops, back rooms, holders and dressing behind their walls, every enemy / pickup / the car in the
// view cone (under the exterior's 700 m far plane), all drawn in the scene AND the flashlight's shadow pass. Fixes pinned here:
//  - the mall's slab + same- / cross-storey OCCLUSION on the Skyways, with its see-through structure — the glazed spans over their own
//    heights, the street air from the street up (world/skywaysOcclusion.ts) — and the WINDOW RULE: a storey seen through glass is a
//    candidate as a whole (the old portal rule culled a lobby seen from a bridge across the street: visible meshes hidden), plus meshes
//    rising over the roofs never level-culled (world/levelCulling.ts);
//  - fine per-storey cohorts and the per-storey, culler-decided loot display (world/builder.ts, containers.ts, storefrontBuilder.ts);
//  - enemies, pickups and the prize car decided from their boxes every update (world/reactor/cpuActorCulling.ts, now the Skyways too);
//  - correctness: a depth-buffered oracle — the eye (to the fog distance), the flashlight's shadow camera (its 30 m) — finds no visible
//    mesh hidden and no hidden moving object whose whole cull box shows a pixel, on the trace poses, bridges, atria, the street level
//    looking out of its windows, the skyway storey's windows, stair cores and the station, on layout versions 3 and 4.
// Estimates mirror three r186's render lists (one draw per visible mesh x material group in the frustum; transparent double-sided:
// two), the flashlight pass = castShadow meshes in its SpotLightShadow frustum on the camera's layers. No viewmodel / post / fog
// passes. NODE ESTIMATES of submitted render objects, never native timings: native frame times are unproven until played.
// LL_SKYWAYS_CPU_OUT=/tmp/x.txt writes the per-view numbers and the category census (vitest hides console output).
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {visibleMeshes} from './helpers/visibleMeshes';
import {PERF_EYE, categoryOf, censusLine, isCulled, perfDone, perfMeasure, skywaysPerfScene, type PerfPose, type SkywaysPerfScene} from './helpers/skywaysPerfScene';
import {CELL, FLOOR} from '../src/gen/grid';
import {SKYWAYS_LAYOUT_VERSION} from '../src/gen/skyways/layoutVersion';
import {skywaysOcclusionSee, skywaysWindowSpans} from '../src/world/skywaysOcclusion';

const OUT = process.env.LL_SKYWAYS_CPU_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

/** The trace's station (code 01PTZ4M, "Ambry Hill") and where the player turned (storey 2, the skyway level). */
const SEED = 103855126;
const TRACE = [{x: 33.62, z: 78.26}, {x: 40, z: 77}] as const;
const VERSIONS = [3, SKYWAYS_LAYOUT_VERSION] as const;

/**
 * The budget: scene + flashlight-shadow draws over the trace sweep (2 positions x 12 yaws, every 30 deg). Measured on the lane's branch
 * (layout v3 = v4 for this seed at the time): worst 486, total 8,005 per version; the same harness before the fixes (no occlusion, the
 * coarse cohorts, untracked movers): worst 966 (yaw 330 at (40, 77)), total 12,447 — the east-facing (240-330 deg) views 680-966 ->
 * 330-486. A failure means the Skyways' submitted work grew: measure again (LL_SKYWAYS_CPU_OUT) and decide consciously before raising a
 * cap. Version 4 is the live generator (its programmes are being reworked): its caps carry headroom, the share cut is the invariant.
 */
const BUDGET = {
  3: {worst: 540, total: 8800},
  4: {worst: 640, total: 10400},
  /** The rules (occlusion + window rule + tracking) must remove at least this share of the rules-off draws on every east-facing view. */
  eastCut: 0.25,
} as const;

/** The nearest open storey-2 floor cell centre to (x, z) within 6 m (the trace pose as generated; a reworked layout may move walls). */
function openNear(S: SkywaysPerfScene, level: number, x: number, z: number): {x: number; z: number} | null {
  const g = S.layout.levels[level].grid;
  let best: {x: number; z: number} | null = null, bd = Infinity;
  for (let dz = -6; dz <= 6; dz += CELL) for (let dx = -6; dx <= 6; dx += CELL) {
    const [cx, cy] = g.cellOf(x + dx, z + dz);
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.blocked[i]) continue;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = {x: (cx + 0.5) * CELL, z: (cy + 0.5) * CELL}; }
  }
  return best;
}

const deg = (d: number) => d * Math.PI / 180;
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** The oracle's poses (found from the layout, never hard-coded beyond the trace): trace, bridges, atria, windows, stair cores, station. */
function oraclePoses(S: SkywaysPerfScene): PerfPose[] {
  const L = S.layout, info = L.skyways!, outp: PerfPose[] = [];
  const base = (lv: number) => L.levels[lv].baseY;
  const ok = (lv: number, x: number, z: number) => { const g = L.levels[lv].grid, [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] === FLOOR && !g.blocked[g.idx(cx, cy)]; };
  for (const t of TRACE) { const p = openNear(S, 2, t.x, t.z); if (p) for (let d = 0; d < 360; d += 45) outp.push({name: 'trace', x: p.x, y: base(2) + PERF_EYE, z: p.z, yaw: deg(d), pitch: 0}); }
  for (const b of info.bridges) {
    const r = b.rect, mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    for (const d of [0, 90, 180, 270]) outp.push({name: `bridge-${b.id}`, x: mx, y: base(b.level) + PERF_EYE, z: mz, yaw: deg(d), pitch: d === 90 ? -0.25 : 0});
  }
  for (const b of info.buildings) if (b.atrium) {
    const r = b.atrium.rect, mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
    if (ok(1, mx, mz)) for (const d of [0, 120, 240]) outp.push({name: `atrium-floor-${b.id}`, x: mx, y: base(1) + PERF_EYE, z: mz, yaw: deg(d), pitch: 0.5});
    for (const [x, z] of [[r.x0 - 1, mz], [r.x1 + 1, mz], [mx, r.z0 - 1], [mx, r.z1 + 1]]) if (ok(2, x, z)) { outp.push({name: `atrium-rail-${b.id}`, x, y: base(2) + PERF_EYE, z, yaw: yawTo(x, z, mx, mz), pitch: -0.45}); break; }
  }
  const N = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]} as const;
  for (const w of info.windows) {
    if (w.kind !== 'window' || 'bridge' in w.host) continue;
    const cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2, n = N[w.side as keyof typeof N];
    const x = cx - n[0] * 3, z = cz - n[1] * 3;
    if (ok(w.level, x, z)) outp.push({name: `window-L${w.level}-${w.side}`, x, y: base(w.level) + PERF_EYE, z, yaw: yawTo(x, z, cx, cz), pitch: w.level === 1 ? 0.12 : -0.15});
  }
  for (const a of L.areas) {
    if (!/stair/.test(String((a as {purpose?: string}).purpose ?? a.type)) || a.level === undefined || a.level < 1) continue;
    const x = (a.x + a.w / 2) * CELL, z = (a.y + a.h / 2) * CELL;
    // (on the flight: the eye over its own floor there)
    if (ok(a.level, x, z) && outp.filter(p => p.name.startsWith('stair')).length < 6) outp.push({name: `stair-L${a.level}`, x, y: L.levels[a.level].grid.floorAt(x, z) + PERF_EYE, z, yaw: (a.id * 2.4) % (2 * Math.PI), pitch: -0.1});
  }
  const sp = L.playerSpawn;
  for (const yaw of [0, Math.PI]) outp.push({name: 'station', x: sp.x, y: (sp.y ?? 0) + PERF_EYE, z: sp.z, yaw, pitch: 0});
  return outp;
}

describe('the REAL Skyways: render objects per view (scene + flashlight shadow pass)', () => {
  it('the see-through structure: windows open their own heights only, the street air from the street up (never the underground storey)', async () => {
    const S = await skywaysPerfScene(SEED, 3);
    const info = S.layout.skyways!, see = skywaysOcclusionSee(S.layout), spans = skywaysWindowSpans(S.layout);
    expect(spans.length).toBe(info.windows.length);
    for (const w of spans) {
      expect(w.y0).toBeGreaterThanOrEqual(S.layout.levels[w.level].baseY);
      expect(w.y1).toBeLessThan(S.layout.levels[w.level].baseY + 4.5);
    }
    // no see rect opens anything at or under the street surface except a window of its own storey (the station storey has none)
    for (const r of see) expect(r.y0 ?? -Infinity, JSON.stringify(r)).toBeGreaterThanOrEqual(info.groundY);
    // the air never covers a building footprint
    const inside = (x: number, z: number) => info.buildings.some(b => x > b.rect.x0 && x < b.rect.x1 && z > b.rect.z0 && z < b.rect.z1);
    for (const r of see.filter(q => q.y1 === undefined)) expect(inside((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2), JSON.stringify(r)).toBe(false);
    const c = S.world.culler;
    expect(c.everyStorey).toBe(false);
    expect(c.windowRule).toBe(true);
  }, 600_000);

  for (const v of VERSIONS) it(`layout v${v}: the trace sweep (storey 2, 2 positions x 12 yaws) within budget; the rules cut every east-facing view`, async () => {
    const S = await skywaysPerfScene(SEED, v);
    let worst = 0, total = 0, offTotal = 0;
    for (const t of TRACE) {
      const p0 = openNear(S, 2, t.x, t.z);
      expect(p0, `an open storey-2 cell near (${t.x}, ${t.z})`).not.toBeNull();
      for (let d = 0; d < 360; d += 30) {
        const p: PerfPose = {name: 'trace', x: p0!.x, y: S.layout.levels[2].baseY + PERF_EYE, z: p0!.z, yaw: deg(d), pitch: 0};
        const off = perfMeasure(S, p, false);
        perfDone(off);
        const on = perfMeasure(S, p, true);
        const c = S.world.culler;
        const a = off.scene.total + off.shadow.total, b = on.scene.total + on.shadow.total;
        out(`v${v} (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) yaw ${d}: rules off ${off.scene.total} + ${off.shadow.total} = ${a} | on ${on.scene.total} + ${on.shadow.total} = ${b}; `
          + `slab ${c.slabCulled}, occluded ${c.occlusionCulled}, tracked hidden ${c.trackedCulled} / ${c.trackedCount}, air ${JSON.stringify(c.airStats.levels)}`);
        out(`    scene ${censusLine(on.scene)} | shadow ${censusLine(on.shadow)}`);
        expect(b, `v${v} yaw ${d}`).toBeLessThanOrEqual(a); // the rules only remove work here (no other storey's glass in sight)
        if (d >= 240 && d <= 330) expect(b, `v${v} yaw ${d} cut`).toBeLessThanOrEqual(a * (1 - BUDGET.eastCut));
        worst = Math.max(worst, b);
        total += b;
        offTotal += a;
        perfDone(on);
      }
    }
    out(`v${v}: worst ${worst}, total ${total} (rules off ${offTotal})`);
    expect(worst).toBeLessThanOrEqual(BUDGET[v === 3 ? 3 : 4].worst);
    expect(total).toBeLessThanOrEqual(BUDGET[v === 3 ? 3 : 4].total);
  }, 900_000);

  for (const v of VERSIONS) it(`layout v${v} oracle: no visible mesh culled (eye); nothing the rules hide is seen by the flashlight; no hidden mover's box shows`, async () => {
    const S = await skywaysPerfScene(SEED, v);
    const c = S.world.culler;
    const all = new THREE.Group(), withProxies = new THREE.Group();
    const proxyMat = new THREE.MeshBasicMaterial({side: THREE.DoubleSide, transparent: true, depthWrite: false}); // tested, never occludes
    // the exterior (shells, bridge outsides, the street and the city ground) occludes as in the game; the sky dome (follows the eye) not
    const ext = S.exteriorRoot ? [...S.exteriorRoot.children] : [];
    const dome = S.exteriorRoot?.getObjectByName('tower-ext-sky');
    const poses = oraclePoses(S);
    let checked = 0, bad = 0, torchBad = 0, boxBad = 0, hiddenBoxes = 0, newHidden = 0, airSeen = 0;
    const names = new Set<string>();
    try {
      if (dome) dome.visible = false;
      for (const p of poses) {
        const off = perfMeasure(S, p, false);
        perfDone(off);
        const shownOff = new Set<THREE.Object3D>();
        for (const o of S.roots) o.traverse(x => { if ((x as THREE.Mesh).isMesh && !isCulled(x)) shownOff.add(x); });
        const m = perfMeasure(S, p, true);
        if (c.airStats.levels.length) airSeen++;
        const fresh = new Set<THREE.Object3D>();
        for (const o of S.roots) o.traverse(x => { if ((x as THREE.Mesh).isMesh && isCulled(x) && shownOff.has(x)) fresh.add(x); });
        newHidden += fresh.size;
        for (const o of S.roots) all.add(o);
        for (const o of ext) all.add(o);
        const fromEye = visibleMeshes(all, m.cam, 256, 144, {minPx: 1, maxDist: c.maxDistance});
        const hidden = [...fromEye].filter(([mesh]) => isCulled(mesh)).map(([mesh, n]) => `${p.name}: ${categoryOf(S, mesh)} ${mesh.name} ${n}px`);
        let tb: string[] = [];
        if (checked % 2 === 0) {
          const fromTorch = visibleMeshes(all, m.torch.shadow.camera as THREE.PerspectiveCamera, 128, 128, {minPx: 1, maxDist: m.torch.distance});
          tb = [...fromTorch].filter(([mesh]) => fresh.has(mesh)).map(([mesh, n]) => `${p.name} torch: ${mesh.name} ${n}px`);
        }
        // every hidden enemy / pickup / the car: its whole cull box owns no pixel from the eye or the torch
        const boxes: THREE.Mesh[] = [];
        const tracked = (c as unknown as {tracked: Map<THREE.Object3D, {box(o: THREE.Box3): boolean; hidden: boolean}>}).tracked;
        for (const t of tracked.values()) {
          if (!t.hidden) continue;
          const b = new THREE.Box3();
          t.box(b);
          const px = new THREE.Mesh(new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), proxyMat);
          px.position.copy(b.getCenter(new THREE.Vector3()));
          boxes.push(px);
        }
        hiddenBoxes += boxes.length;
        let bb: string[] = [];
        if (boxes.length) {
          for (const o of [...all.children]) withProxies.add(o);
          withProxies.add(...boxes);
          const eyeBoxes = visibleMeshes(withProxies, m.cam, 256, 144, {minPx: 1, maxDist: c.maxDistance});
          const torchBoxes = visibleMeshes(withProxies, m.torch.shadow.camera as THREE.PerspectiveCamera, 128, 128, {minPx: 1, maxDist: m.torch.distance});
          bb = boxes.filter(b => eyeBoxes.has(b) || torchBoxes.has(b)).map(b => `${p.name}: box at ${b.position.toArray().map(q => q.toFixed(1))} ${eyeBoxes.get(b) ?? 0}/${torchBoxes.get(b) ?? 0}px`);
          withProxies.remove(...boxes);
          for (const b of boxes) b.geometry.dispose();
        }
        for (const o of [...all.children, ...withProxies.children]) { all.remove(o); withProxies.remove(o); }
        for (const o of ext) S.exteriorRoot!.add(o);
        out(`v${v} oracle ${p.name} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} yaw ${(p.yaw * 180 / Math.PI).toFixed(0)} pitch ${p.pitch}): `
          + `${off.scene.total} + ${off.shadow.total} -> ${m.scene.total} + ${m.shadow.total}, eye-visible ${fromEye.size}, newly hidden ${fresh.size}, air ${JSON.stringify(c.airStats.levels)}, `
          + `tracked hidden ${boxes.length}; visible-but-culled ${hidden.length} ${hidden.slice(0, 3).join(' ')}; torch ${tb.length} ${tb.slice(0, 3).join(' ')}; boxes ${bb.length} ${bb.slice(0, 3).join(' ')}`);
        bad += hidden.length; torchBad += tb.length; boxBad += bb.length;
        names.add(p.name.replace(/-.*$/, ''));
        expect(hidden).toEqual([]);
        expect(tb).toEqual([]);
        expect(bb).toEqual([]);
        checked++;
        perfDone(m);
      }
    } finally {
      for (const o of [...all.children, ...withProxies.children]) { all.remove(o); withProxies.remove(o); }
      if (S.exteriorRoot) for (const o of ext) if (o.parent !== S.exteriorRoot) S.exteriorRoot.add(o);
      if (dome) dome.visible = true;
      c.viewpoints = [];
      c.slabs = c.occlusion = c.windowRule = true;
    }
    out(`v${v} oracle poses ${checked} (${[...names].join(', ')}): visible-but-culled ${bad}, torch ${torchBad}, hidden mover boxes ${hiddenBoxes} (visible ${boxBad}); `
      + `meshes the rules hid ${newHidden}; poses with a storey seen through glass ${airSeen}`);
    expect(checked).toBeGreaterThan(40);
    for (const k of ['trace', 'bridge', 'atrium', 'window', 'station']) expect([...names], k).toContain(k);
    expect(newHidden).toBeGreaterThan(0); // the rules actually cull on these poses
    expect(hiddenBoxes).toBeGreaterThan(0); // and the tracked movers too
    expect(airSeen).toBeGreaterThan(0); // and the window rule fires (a storey seen through glass)
  }, 1_800_000);
});
