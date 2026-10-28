// Iteration 12 (ATMOS): user feedback #4 — "when I open a cupboard or any item really my flash light does not light the inside,
// making it hard to see what is in it."
//
// Root cause (world/openables.ts interiorShadowSide): revealed interiors are closed liner boxes drawn BackSide. three r186's
// shadow pass draws `material.shadowSide ?? opposite(material.side)`, so the liners' OUTWARD faces — including the face spanning
// the opening — were rendered into the flashlight's spot shadow map. With the door open that invisible lid still occluded every
// liner wall and every item inside. A second, smaller source of the same kind: model-derived bodies kept inward-facing faces in
// the opening (the inside of a split-off door / window); they are never front-facing to a viewer outside the holder, but the
// structure shadow marking (shadowSide double) let them cast across the opening (world/openables.ts dropShadowOnlyFaces).
//
// These tests emulate both passes on the real holder geometry (runtime GLB derivatives, as game.ts marks them): rays from an
// eye in front of each opening find the surface the COLOUR pass shows (material.side rules, opaque only), then rays from the
// flashlight (camera-held, offset like game.ts) test that point against the SHADOW pass (shadowSide rule, visible casters):
//  - opened cupboards / crates / lockers / cabinets / coolers / freezers / drawers: what you see inside is lit;
//  - closed (opaque) doors still occlude the interior;
//  - no back-side interior material is left with the default (opposite-side) shadow rule.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped, openableModels, rowLayout} from './helpers/openablesFixture';
import {MODEL_FILES} from '../src/assets/manifest';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type Holder} from '../src/world/containers';
import {interiorShadowSide} from '../src/world/openables';
import {markShadows} from '../src/render/volumetric';
import {generateStation} from '../src/gen/station';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
let models: Record<string, GLTF> = {};
beforeAll(async () => {
  models = await openableModels();
  // the iteration-02 cupboards / crate split their own runtime models (+ the shelf insert)
  for (const k of ['cabinetTall', 'cabinetLow', 'crate', 'shelf'] as const) models[k] = await loadStripped(MODEL_FILES[k].url);
}, 120000);

const LEGACY = ['cabinetTall', 'cabinetLow', 'crate'];
/** Door / lid / pane / drawer holders ("cupboard / fridge / locker / drawer / any item"). */
const OPENABLE = ['staffLockers', 'safe', 'firstAidWallKit', 'fireExtinguisherCabinet', 'aedWallCabinet', 'shopCooler', 'chestFreezer',
  'newspaperVendingBox', 'filingCabinet', 'bin', 'wheelieBin', 'kitchenette', 'rollingToolChest', 'crashCart'];

function build(kinds: readonly string[], seed = 11) {
  const cm = new ContainerManager(models, mats, () => new Inventory());
  cm.build(rowLayout(kinds, {seed, gap: 1.2}));
  // like game.ts newStation: atmosphere.markShadows(containers.group, structure) with surfaceShadows on
  markShadows(cm.group, true, true);
  return cm;
}
const settle = (cm: ContainerManager, s = 1.2) => { for (let t = 0; t < s; t += 1 / 60) cm.update(1 / 60, t); cm.group.updateMatrixWorld(true); };

function openAll(cm: ContainerManager, h: Holder, only?: number): void {
  if (h.open) h.open.parts.forEach((_, i) => { if ((only === undefined || only === i) && !h.state.parts?.[i]) cm.interact({container: h, t: 1, lot: null, part: i}); });
  else if (!h.state.open) cm.interact(h);
}

// --- colour / shadow pass emulation -------------------------------------------------------------------------------------------
const FLIP: Record<THREE.Side, THREE.Side> = {[THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide};
/** three r186 WebGLShadowMap.getDepthMaterial (non-VSM): the side the shadow pass rasterises. */
const shadowPassSide = (m: THREE.Material): THREE.Side => m.shadowSide ?? FLIP[m.side];

type Pass = 'colour' | 'shadow';
/** Meshes a pass draws: visible (with every ancestor); shadow: castShadow; colour: opaque (glass does not hide what is behind). */
function drawn(root: THREE.Object3D, pass: Pass, skip?: (m: THREE.Mesh) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverseVisible(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || skip?.(m)) return;
    if (pass === 'shadow' ? m.castShadow : true) out.push(m);
  });
  return out;
}
const proxies = new Map<string, THREE.MeshBasicMaterial>();
const proxy = (m: THREE.Material, pass: Pass) => {
  const hidden = !m.visible || (pass === 'colour' && (m.transparent || m.colorWrite === false));
  const s = pass === 'shadow' ? shadowPassSide(m) : m.side;
  const key = `${hidden}|${s}`;
  let p = proxies.get(key);
  if (!p) proxies.set(key, (p = new THREE.MeshBasicMaterial({side: s, visible: !hidden})));
  return p;
};
/** Nearest surface a pass draws on the segment from -> from + dir * maxT. */
function firstHit(list: readonly THREE.Mesh[], pass: Pass, from: THREE.Vector3, dir: THREE.Vector3, maxT: number): {t: number; mesh: THREE.Mesh | null; hit?: THREE.Intersection} {
  const rc = new THREE.Raycaster(from, dir, 0, maxT);
  let best = {t: Infinity, mesh: null as THREE.Mesh | null, hit: undefined as THREE.Intersection | undefined};
  for (const m of list) {
    const saved = m.material;
    const swapped = Array.isArray(saved) ? saved.map(x => proxy(x, pass)) : proxy(saved, pass);
    if (!Array.isArray(swapped) && !swapped.visible) continue;
    m.material = swapped;
    try {
      for (const hit of rc.intersectObject(m, false)) {
        const mat = Array.isArray(m.material) ? m.material[hit.face?.materialIndex ?? 0] : m.material;
        if (!mat?.visible) continue;
        if (hit.distance < best.t) best = {t: hit.distance, mesh: m, hit};
        break;
      }
    } finally { m.material = saved; }
  }
  return best;
}

/** game.ts flashlight: camera-local (0.2, -0.15, 0.1) from the eye. */
function flashlightAt(eye: THREE.Vector3, look: THREE.Vector3): THREE.Vector3 {
  const fwd = look.clone().sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return eye.clone().addScaledVector(right, 0.2).addScaledVector(up, -0.15).addScaledVector(fwd, -0.1);
}

/** A compartment to look into: holder-local box, the axis its opening faces, and the part that closes it (-1: legacy doors). */
interface Compartment { part: number; box: THREE.Box3; normal: THREE.Vector3; slideOut: boolean; glass: boolean }
function compartments(h: Holder): Compartment[] {
  if (!h.open) {
    // iteration-02 cupboards (two doors, +Z) / crate (lid, +Y): the back-side interior box
    const liner = h.inner.find(o => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).side === THREE.BackSide) as THREE.Mesh | undefined;
    if (!liner) return [];
    liner.geometry.computeBoundingBox();
    return [{part: -1, box: liner.geometry.boundingBox!.clone(), normal: new THREE.Vector3(0, h.kind === 'crate' ? 1 : 0, h.kind === 'crate' ? 0 : 1), slideOut: false, glass: false}];
  }
  const rt = h.open;
  return rt.spec.parts.map((spec, i) => {
    const b = rt.model.parts[i].bounds;
    // the liner box, else (model interiors: fire / defibrillator cabinets, cooler) the space behind the closed door
    const cyl = spec.cylinder;
    const box = spec.cavity
      ? new THREE.Box3(new THREE.Vector3(spec.cavity[0], spec.cavity[1], spec.cavity[2]), new THREE.Vector3(spec.cavity[3], spec.cavity[4], spec.cavity[5]))
      : cyl ? new THREE.Box3(new THREE.Vector3(-cyl[0] * 0.7, cyl[1], -cyl[0] * 0.7), new THREE.Vector3(cyl[0] * 0.7, cyl[2], cyl[0] * 0.7))
        : new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, -h.prop.hz + 0.03), new THREE.Vector3(b.max.x, b.max.y, b.min.z));
    const d = b.getCenter(new THREE.Vector3()).sub(box.getCenter(new THREE.Vector3()));
    const ax = Math.abs(d.x) > Math.abs(d.y) && Math.abs(d.x) > Math.abs(d.z) ? 'x' : Math.abs(d.y) > Math.abs(d.z) ? 'y' : 'z';
    const normal = new THREE.Vector3();
    normal[ax] = Math.sign(d[ax]) || 1;
    const slideOut = spec.move.type === 'slide' && Math.abs(new THREE.Vector3(...spec.move.dir).normalize().dot(normal)) > 0.7;
    return {part: i, box, normal, slideOut, glass: !!spec.glass};
  });
}

/**
 * Looks into one opened compartment like a player: eye centred in front of it (above it for lids), at a standing / crouching
 * height looking slightly down, flashlight held as game.ts holds it. A 4 x 4 fan of view rays at the compartment; every
 * point the COLOUR pass shows inside it is tested against the SHADOW pass from the flashlight.
 */
function lookInside(cm: ContainerManager, h: Holder, c: Compartment, opts: {debug?: boolean; eyeY?: number} = {}): {seen: number; lit: number; occluders: string[]} {
  const skipLots = lotsSkip(cm);
  const colour = drawn(cm.group, 'colour'), shadow = drawn(cm.group, 'shadow', skipLots);
  const inv = h.matrix.clone().invert();
  const inside = c.box.clone().expandByScalar(0.012);
  const top = c.normal.y > 0.5;
  let seen = 0, lit = 0;
  const occluders = new Set<string>();
  for (const fa of [0.15, 0.38, 0.62, 0.85]) for (const fb of [0.15, 0.38, 0.62, 0.85]) {
    const target = top
      ? new THREE.Vector3(THREE.MathUtils.lerp(c.box.min.x, c.box.max.x, fa), c.box.min.y + 0.02, THREE.MathUtils.lerp(c.box.min.z, c.box.max.z, fb))
      : new THREE.Vector3(THREE.MathUtils.lerp(c.box.min.x, c.box.max.x, fa), THREE.MathUtils.lerp(c.box.min.y, c.box.max.y, fb), c.box.min.z + 0.02);
    const cx = (c.box.min.x + c.box.max.x) / 2;
    // eye heights are WORLD heights (the test hall floor is y 0; wall cabinets hang at their mount height)
    const tw = target.clone().applyMatrix4(h.matrix), baseY = new THREE.Vector3().setFromMatrixPosition(h.matrix).y;
    const eyeL = top
      ? new THREE.Vector3(cx + 0.05, Math.min(1.65, c.box.max.y + baseY + 0.8) - baseY, c.box.max.z + 0.3)
      : new THREE.Vector3(cx + 0.05, (opts.eyeY ?? THREE.MathUtils.clamp(tw.y + 0.35, 1.0, 1.65)) - baseY, c.box.max.z + 0.85);
    const eye = eyeL.applyMatrix4(h.matrix);
    const dir = tw.clone().sub(eye).normalize();
    const vis = firstHit(colour, 'colour', eye, dir, 4);
    if (!vis.mesh || !isOwn(cm, h, vis.mesh)) continue; // looking at something else (a neighbour, the floor)
    const p = eye.clone().addScaledVector(dir, vis.t);
    const pl = p.clone().applyMatrix4(inv);
    if (!inside.containsPoint(pl)) continue; // its outer skin / rim / front edge: not the inside
    seen++;
    const light = flashlightAt(eye, tw);
    const ld = p.clone().sub(light), dist = ld.length();
    ld.normalize();
    const occ = firstHit(shadow, 'shadow', light, ld, dist);
    // the visible surface itself is in the map (double-sided structure shadows; the pass bias covers that): 1.5 cm tolerance
    if (occ.t >= dist - 0.015) lit++;
    else if (occ.mesh) {
      occluders.add(`${occ.mesh.name || occ.mesh.parent?.name}/${(occ.mesh.material as THREE.Material).name}`);
      if (opts.debug) {
        const f = (v: THREE.Vector3) => v.toArray().map(x => x.toFixed(3)).join(',');
        const n = occ.hit!.face!.normal.clone().transformDirection(occ.mesh.matrixWorld).transformDirection(inv);
        console.log(`  ${h.kind}#${c.part}: seen (${f(pl)}) on ${vis.mesh.name || vis.mesh.parent?.name}/${(vis.mesh.material as THREE.Material).name}; light (${f(light.clone().applyMatrix4(inv))}); occluder at (${f(occ.hit!.point.clone().applyMatrix4(inv))}) n (${f(n)}) t ${occ.t.toFixed(3)}/${dist.toFixed(3)}`);
      }
    }
  }
  return {seen, lit, occluders: [...occluders]};
}
function isOwn(cm: ContainerManager, h: Holder, m: THREE.Object3D): boolean {
  const roots = [h.root, h.open?.root].filter(Boolean) as THREE.Object3D[];
  for (let o: THREE.Object3D | null = m; o; o = o.parent) if (roots.includes(o)) return true;
  // instanced bodies (container-body-<kind>) are shared per chunk: accept by name
  return m.name === `container-body-${h.kind}` || (cm as unknown as {display: {group: THREE.Group}}).display.group.children.includes(m);
}
const lotsSkip = (cm: ContainerManager) => {
  const lotMeshes = new Set<THREE.Object3D>();
  // the item instances (world/lootDisplay.ts) are what we look AT, not occluders of the container geometry
  (cm as unknown as {display: {group: THREE.Group}}).display.group.traverse(o => lotMeshes.add(o));
  return (m: THREE.Mesh) => lotMeshes.has(m);
};
/** Opens exactly one compartment (the others closed), like a player looking into it. */
function openOnly(cm: ContainerManager, h: Holder, part: number): void {
  if (!h.open) { if (!h.state.open) cm.interact(h); return; }
  h.open.parts.forEach((_, i) => { if (i !== part && h.state.parts?.[i]) cm.interact({container: h, t: 1, lot: null, part: i}); });
  if (!h.state.parts?.[part]) cm.interact({container: h, t: 1, lot: null, part});
}

describe('#4 flashlight inside opened containers (the shadow pass draws what the colour pass draws)', () => {
  it('opened cupboards / crates / lockers / cabinets / coolers / freezers / bins: what you see inside is lit by the flashlight', () => {
    const kinds = [...LEGACY, ...OPENABLE];
    const cm = build(kinds);
    const report: string[] = [], failed: string[] = [];
    const looked = new Set<string>();
    let seenAll = 0, litAll = 0;
    // one compartment index at a time across the row (each holder: that part open, the others closed)
    const maxParts = Math.max(...cm.all.map(h => Math.max(1, h.open?.parts.length ?? 1)));
    for (let k = 0; k < maxParts; k++) {
      const now = cm.all.filter(h => kinds.includes(h.kind) && k < Math.max(1, h.open?.parts.length ?? 1));
      for (const h of now) openOnly(cm, h, k);
      settle(cm);
      for (const h of now) {
        const c = compartments(h).find(x => x.part === k || x.part === -1);
        if (!c || c.slideOut) continue; // drawers carry their contents out of the cavity (the item test below covers them)
        const r = lookInside(cm, h, c, {debug: !!process.env.OCC_DEBUG});
        report.push(`${h.kind}#${c.part}: ${r.lit}/${r.seen} visible interior points lit${r.occluders.length ? ` (shadowed by ${r.occluders.join(', ')})` : ''}`);
        if (r.seen < 4) continue;
        looked.add(h.kind);
        seenAll += r.seen; litAll += r.lit;
        // real geometry still casts: a cupboard's centre stile / shelf boards, a crate's or bin's front wall over its floor seen
        // at a grazing angle, the freezer's stock boxes
        if (r.lit / r.seen < 0.75) failed.push(report.at(-1)!);
      }
    }
    // the newspaper box's door swings up overhead like an awning: look in from the height of its opening
    for (const h of cm.all.filter(x => x.kind === 'newspaperVendingBox')) {
      openOnly(cm, h, 0);
      settle(cm);
      const r = lookInside(cm, h, compartments(h)[0], {eyeY: 0.62, debug: !!process.env.OCC_DEBUG});
      report.push(`${h.kind}#0 (eye at the opening): ${r.lit}/${r.seen} visible interior points lit${r.occluders.length ? ` (shadowed by ${r.occluders.join(', ')})` : ''}`);
      expect(r.seen, 'the opened newspaper box shows its inside (no split remnant across the opening)').toBeGreaterThanOrEqual(8);
      if (r.lit / r.seen < 0.75) failed.push(report.at(-1)!);
    }
    console.log(`${report.join('\n')}\nall compartments: ${litAll}/${seenAll} visible interior points lit`);
    expect(failed, 'visible interior lit by the flashlight').toEqual([]);
    expect(litAll / seenAll).toBeGreaterThan(0.92);
    expect(looked.size, [...looked].join(', ')).toBeGreaterThanOrEqual(12);
    // Root cause, demonstrated: put the liners back on three's default shadow rule (shadowSide null -> opposite side) and the
    // inside of the very same opened cupboards / lockers / kitchenette cupboard goes dark again.
    for (const h of cm.all) openOnly(cm, h, 0);
    settle(cm);
    const liners = new Set<THREE.Material>();
    cm.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && m.material.side === THREE.BackSide) liners.add(m.material); });
    for (const m of liners) m.shadowSide = null;
    for (const kind of ['cabinetTall', 'cabinetLow', 'crate', 'staffLockers', 'kitchenette', 'firstAidWallKit']) {
      const h = cm.all.find(x => x.kind === kind)!;
      const r = lookInside(cm, h, compartments(h).find(x => x.part <= 0)!);
      console.log(`old rule: ${kind}: ${r.lit}/${r.seen} lit (shadowed by ${r.occluders.join(', ')})`);
      expect(r.seen, kind).toBeGreaterThan(3);
      expect(r.lit / r.seen, `${kind}: dark with the old shadow rule`).toBeLessThan(0.3);
    }
    for (const m of liners) interiorShadowSide(m);
  });

  it('closed (opaque) doors / lids still occlude the interior', () => {
    const kinds = [...LEGACY, ...OPENABLE];
    // the compartments (liner boxes) come from an opened twin of the same row; the probed row stays closed
    const twin = build(kinds), cm = build(kinds);
    settle(cm, 0.2);
    const shadow = drawn(cm.group, 'shadow', lotsSkip(cm));
    let probed = 0;
    for (const [i, h] of cm.all.entries()) {
      if (!kinds.includes(h.kind)) continue;
      const t = twin.all[i];
      for (const c of compartments(t)) {
        const spec = t.open?.spec.parts[c.part];
        if (c.glass || spec?.ajar || (t.open && !spec?.cavity && !spec?.cylinder)) continue; // glass shows its stock; forced safe stands ajar
        const ax = c.normal.x ? 'x' : c.normal.y ? 'y' : 'z';
        let blocked = 0, n = 0;
        // (off the exact centre: the iteration-02 cupboard's two doors meet in a real modelled seam groove there)
        for (const fa of [0.25, 0.42, 0.75]) for (const fb of [0.3, 0.5, 0.7]) {
          const inside = c.box.getCenter(new THREE.Vector3());
          const others = (['x', 'y', 'z'] as const).filter(k => k !== ax);
          inside[others[0]] = THREE.MathUtils.lerp(c.box.min[others[0]], c.box.max[others[0]], fa);
          inside[others[1]] = THREE.MathUtils.lerp(c.box.min[others[1]], c.box.max[others[1]], fb);
          const light = inside.clone();
          light[ax] = (c.normal[ax] > 0 ? c.box.max[ax] : c.box.min[ax]) + c.normal[ax] * 1.0;
          light[others[0]] += 0.05;
          const from = light.applyMatrix4(h.matrix), to = inside.applyMatrix4(h.matrix);
          const d = to.clone().sub(from), dist = d.length();
          n++;
          const hit = firstHit(shadow, 'shadow', from, d.normalize(), dist);
          if (hit.t < dist - 0.05) blocked++;
          else if (process.env.OCC_DEBUG) console.log(`  closed ${h.kind}#${c.part}: light ${light.toArray().map(x => x.toFixed(3))} -> inside ${inside.toArray().map(x => x.toFixed(3))} (local) unblocked`);
        }
        probed++;
        // doors / lids: everything; pulled-in drawer fronts: the reconstructed tool chest's top drawers have open pull channels at
        // handle height (model geometry, unchanged by this fix and leaking with or without it)
        if (c.slideOut) expect(blocked, `${h.kind}#${c.part}: the closed drawer front blocks the flashlight`).toBeGreaterThanOrEqual(Math.ceil(n * 2 / 3));
        else expect(blocked, `${h.kind}#${c.part}: the closed door / lid blocks the flashlight`).toBe(n);
      }
    }
    expect(probed).toBeGreaterThanOrEqual(15);
  });

  it('the items inside opened holders are reached by the flashlight (shelves and the holder still cast)', () => {
    const kinds = [...LEGACY, ...OPENABLE];
    let lots = 0, lit = 0;
    const misses: string[] = [];
    for (const seed of [3, 11, 29, 47]) {
      const cm = build(kinds, seed);
      const maxParts = Math.max(...cm.all.map(h => Math.max(1, h.open?.parts.length ?? 1)));
      for (let k = 0; k < maxParts; k++) {
        const now = cm.all.filter(h => kinds.includes(h.kind) && k < Math.max(1, h.open?.parts.length ?? 1));
        for (const h of now) openOnly(cm, h, k);
        settle(cm);
        const shadow = drawn(cm.group, 'shadow', lotsSkip(cm));
        for (const h of now) {
          const c = compartments(h).find(x => x.part === k || x.part === -1);
          if (!c) continue;
          for (const lot of h.state.lots) {
            if (h.open && lot.part !== k) continue;
            const p = cm.lotPoint(h, lot);
            if (!p) continue;
            const at = new THREE.Vector3(p.x, p.y, p.z);
            const al = at.clone().applyMatrix4(h.matrix.clone().invert());
            // a player in front of the compartment (above it for lids / a pulled-out drawer), standing or crouched
            const baseY = new THREE.Vector3().setFromMatrixPosition(h.matrix).y;
            const top = c.normal.y > 0.5 || c.slideOut;
            const eyeL = top
              ? new THREE.Vector3(al.x + 0.05, THREE.MathUtils.clamp(at.y + 0.75, 1.02, 1.62) - baseY, al.z + 0.45)
              : new THREE.Vector3((c.box.min.x + c.box.max.x) / 2 + 0.05, THREE.MathUtils.clamp(at.y + 0.35, 1.02, 1.62) - baseY, c.box.max.z + 0.85);
            const eye = eyeL.applyMatrix4(h.matrix);
            const light = flashlightAt(eye, at);
            lots++;
            // stop 3 cm short of the item's centre (its own instance is not an occluder of itself)
            const d = at.clone().sub(light), dist = d.length() - 0.03;
            const occ = firstHit(shadow, 'shadow', light, d.normalize(), dist);
            if (!Number.isFinite(occ.t)) lit++;
            else misses.push(`${h.kind}#${lot.part ?? -1}/${lot.itemId}: ${occ.mesh?.name || occ.mesh?.parent?.name}/${(occ.mesh?.material as THREE.Material)?.name}`);
          }
        }
      }
    }
    console.log(`items inside opened holders reached by the flashlight: ${lit}/${lots}${misses.length ? `\n  shadowed: ${misses.join('\n  shadowed: ')}` : ''}`);
    expect(lots).toBeGreaterThan(20);
    expect(lit / lots).toBeGreaterThan(0.85);
  });

  it('no back-side interior keeps the default opposite-side shadow rule (legacy + every openable, real station)', () => {
    const st = generateStation(24839);
    for (const variant of [models, {} as Record<string, GLTF>]) {
      const cm = new ContainerManager(variant, mats, () => new Inventory());
      cm.build(st, variant);
      markShadows(cm.group, true, true);
      for (const h of cm.all) openAll(cm, h);
      settle(cm, 1.0);
      let backSided = 0;
      cm.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          if (mat.side !== THREE.BackSide) continue;
          backSided++;
          expect(shadowPassSide(mat), `${m.name || mat.name}: back-side interior shadows from the faces it draws`).toBe(THREE.BackSide);
        }
      });
      expect(backSided).toBeGreaterThan(0);
    }
    // helper contract: only back-side materials change; front / double are left to the structure marking
    expect(interiorShadowSide(new THREE.MeshStandardMaterial()).shadowSide).toBe(null);
    expect(interiorShadowSide(new THREE.MeshStandardMaterial({side: THREE.BackSide})).shadowSide).toBe(THREE.BackSide);
  });
});
