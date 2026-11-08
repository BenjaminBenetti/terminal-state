// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the market humans' runtime file (market-human-cast.glb) and its
// provenance: present, allowlisted, level-only; five bodies on the shared 18-joint skeleton with the HEALTHY clip set (no zombie
// clip); the Meshy maps kept; every fitted wearable assembles onto its body; and the clips' posture is a living person's (upright,
// arms hanging / swinging low), checked against the same measure on a zombie body's walk.
import {beforeAll, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {assetAllowedIn, levelOfAsset, selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';
import {HUMAN_CLIPS, MARKET_HUMAN_KEY, MARKET_HUMAN_MODEL_FILES, type HumanClip} from '../src/market/humanLooks';
import {HumanWardrobe} from '../src/market/humanWardrobe';
import {HumanActor} from '../src/market/humanActor';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const ROOT = path.resolve(PUB, '../..');
const FILE = MARKET_HUMAN_MODEL_FILES[MARKET_HUMAN_KEY];
const PROV = 'assets/derivatives/market-human-cast.json';
const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
const BODIES = ['m1', 'f1', 'm2', 'f2', 'm3'];
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function loadStripped(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(PUB, rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

let gltf: GLTF;
let W: HumanWardrobe;
beforeAll(async () => { gltf = await loadStripped(FILE.url); W = new HumanWardrobe(gltf); });

describe('market-human-cast.glb: file, allowlist, level ownership', () => {
  it('exists at its catalogue size and is allowlisted with its provenance record', () => {
    const glb = readFileSync(path.join(PUB, FILE.url));
    expect(glb.length).toBe(FILE.bytes);
    const allow = JSON.parse(readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    const e = allow.files.find(f => f.path === FILE.url);
    expect(e).toEqual({path: FILE.url, bytes: glb.length, sha256: sha(glb)});
    const prov = readFileSync(path.join(PUB, PROV));
    expect(allow.files.find(f => f.path === PROV)).toEqual({path: PROV, bytes: prov.length, sha256: sha(prov)});
    const man = JSON.parse(prov.toString('utf8'));
    expect(man.outputs.glb).toMatchObject({path: FILE.url, bytes: glb.length, sha256: sha(glb)});
    expect(man.status.approved).toBe(false);
  });

  it('is level-only: the market fetches it, no other level ever does, and it is not a boot model', () => {
    expect(levelOfAsset(FILE.url)).toBe('market');
    expect(assetAllowedIn('market', FILE.url)).toBe(true);
    for (const lv of ['subway', 'office', 'mall', 'reactor', 'skyways']) {
      expect(assetAllowedIn(lv, FILE.url)).toBe(false);
      expect(selectLevelKeys(lv, [MARKET_HUMAN_KEY], MARKET_HUMAN_MODEL_FILES).foreign).toEqual([MARKET_HUMAN_KEY]);
    }
    expect(Object.values(MODEL_FILES).some(f => f.url === FILE.url)).toBe(false);
  });

  it('records the paid Meshy sources (never regenerated) and keeps their maps', async () => {
    const man = JSON.parse(readFileSync(path.join(PUB, PROV), 'utf8'));
    const tasks: Record<string, string> = {m1: '01a1b8b4-b5f9-7557-8d34-46b237f67db9', f1: '01a1b8b4-d832-7092-8f22-9307dc91f50e', m2: '01a1b8b4-e954-74e4-a594-b815ae92c032', f2: '01a1b8b5-0660-77f7-8b7a-2a36269cc294', m3: '01a1b8b5-1704-72f6-80b9-8887c45d933f'};
    for (const b of BODIES) expect(man.bodies[b].source.taskId).toBe(tasks[b]);
    // the body materials carry the Meshy base colour, metal-rough AND normal maps (re-encoded only)
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(PUB, FILE.url));
    for (const b of BODIES) {
      const m = doc.getRoot().listMaterials().find(x => x.getName() === `HumanBody_${b}_Material`)!;
      expect(m.getBaseColorTexture()?.getSize()).toEqual([2048, 2048]);
      expect(m.getMetallicRoughnessTexture()).toBeTruthy();
      expect(m.getNormalTexture()).toBeTruthy();
    }
    // the raw masters stay private: nothing of reference/ is shipped
    expect(existsSync(path.join(PUB, 'assets/models/human-m1-a1.glb'))).toBe(false);
  });
});

describe('bodies, skeleton, healthy clips', () => {
  it('holds five bodies, each a skinned mesh over the shared 18-joint skeleton, 1.62-1.85 m tall', () => {
    expect([...W.bodies].sort()).toEqual([...BODIES].sort());
    for (const b of BODIES) {
      const body = gltf.scene.getObjectByName('HumanBody_' + b) as THREE.SkinnedMesh;
      expect(body.isSkinnedMesh).toBe(true);
      expect(body.skeleton.bones.map(x => x.name)).toEqual(JOINTS.map(j => `${b}_${j}`));
      const h = body.userData.heightM as number;
      expect(h).toBeGreaterThanOrEqual(1.62);
      expect(h).toBeLessThanOrEqual(1.85);
    }
  });

  it('carries exactly the healthy clips per body (no zombie clip anywhere) and a ~1.3 m/s walk', () => {
    const names = gltf.animations.map(a => a.name);
    expect(names.sort()).toEqual(BODIES.flatMap(b => HUMAN_CLIPS.map(c => `${b}:${c}`)).sort());
    for (const n of names) expect(n).not.toMatch(/:(Attack|Hit|Death|Run)$/);
    for (const b of BODIES) {
      const ex = (gltf.scene.getObjectByName('HumanBody_' + b) as THREE.Mesh).userData;
      expect(ex.clips.Walk.groundSpeed).toBeGreaterThan(1.1);
      expect(ex.clips.Walk.groundSpeed).toBeLessThan(1.5);
      expect(W.clipsOf(b).size).toBe(HUMAN_CLIPS.length);
    }
  });

  it('assembles every fitted wearable onto its body (one skeleton per person, masks matched to the body build)', () => {
    let pairs = 0;
    for (const b of BODIES) {
      const wear = W.available.wear(b);
      expect(wear.length).toBeGreaterThanOrEqual(4);
      expect(new Set(wear.map(w => w.slot)).size).toBeGreaterThanOrEqual(2);
      for (const w of wear) {
        const app = W.build({body: b, wear: {[w.slot]: w.id}, scale: 1});
        expect(app.meshes.length).toBe(2);
        expect(app.meshes[1].skeleton).toBe(app.meshes[0].skeleton);
        expect(app.look.wear[w.slot]).toBe(w.id);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(25);
  });
});

/** World positions of named joints over a clip (sampled with a real mixer on an assembled actor). */
function sample(root: THREE.Object3D, clip: THREE.AnimationClip, joints: string[], n = 24): Record<string, THREE.Vector3[]> {
  const mixer = new THREE.AnimationMixer(root), act = mixer.clipAction(clip).play();
  const out: Record<string, THREE.Vector3[]> = Object.fromEntries(joints.map(j => [j, []]));
  for (let i = 0; i < n; i++) {
    act.time = (i / n) * clip.duration; mixer.update(0); root.updateMatrixWorld(true);
    for (const j of joints) out[j].push(root.getObjectByName(j)!.getWorldPosition(new THREE.Vector3()));
  }
  mixer.stopAllAction();
  return out;
}

describe('healthy posture (not the zombie clips)', () => {
  it('stands upright and keeps the hands low while idling and walking; the zombie walk fails the same measure', async () => {
    for (const b of BODIES) {
      const app = W.build({body: b, wear: {}, scale: 1});
      const bind = (j: string) => { app.root.updateMatrixWorld(true); return app.root.getObjectByName(`${b}_${j}`)!.getWorldPosition(new THREE.Vector3()); };
      const head0 = bind('Head').y, chest0 = bind('Chest').y;
      for (const c of ['Idle', 'Walk'] as HumanClip[]) {
        const s = sample(app.root, app.clips.get(c)!, [`${b}_Head`, `${b}_Chest`, `${b}_L_Hand`, `${b}_R_Hand`]);
        for (let i = 0; i < s[`${b}_Head`].length; i++) {
          expect(s[`${b}_Head`][i].y, `${b} ${c}: head upright`).toBeGreaterThan(head0 - 0.1);
          for (const h of ['L_Hand', 'R_Hand']) expect(s[`${b}_${h}`][i].y, `${b} ${c}: ${h} below the chest`).toBeLessThan(s[`${b}_Chest`][i].y - 0.15);
        }
      }
      void chest0;
      // the walk travels: the feet alternate front / back by most of a stride
      const w = sample(app.root, app.clips.get('Walk')!, [`${b}_L_Foot`]);
      const zs = w[`${b}_L_Foot`].map(v => v.z);
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.5);
      // sitting is on the floor
      const sit = sample(app.root, app.clips.get('Sit')!, [`${b}_Hips`], 4);
      expect(Math.max(...sit[`${b}_Hips`].map(v => v.y))).toBeLessThan(0.35);
    }
    const z = await loadStripped('assets/models/zombie-body-lastshift-t25.glb');
    const walk = z.animations.find(a => a.name === 'Walk')!;
    const zs = sample(z.scene, walk, ['Chest', 'L_Hand', 'R_Hand']);
    const reach = zs.L_Hand.some((h, i) => h.y > zs.Chest[i].y - 0.15) || zs.R_Hand.some((h, i) => h.y > zs.Chest[i].y - 0.15);
    expect(reach, 'the zombie walk reaches forward (the measure discriminates)').toBe(true);
  });

  it('an actor plays the loops with crossfades and the greeting once', () => {
    const app = W.build({body: 'f1', wear: {}, scale: 1.02});
    const a = new HumanActor(app, 0.5);
    expect(a.current).toBe('Idle');
    a.play('Talk');
    a.play('Greet', 0.2);
    expect(a.busy).toBe(true);
    for (let i = 0; i < 80; i++) a.animate(1 / 30);
    expect(a.busy).toBe(false);
    expect(a.current).toBe('Talk');
    expect(a.root.scale.x).toBeCloseTo(1.02, 6);
    a.dispose();
  });
});
