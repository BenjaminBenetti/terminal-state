// Provenance / technical manifest for the rigged zombie derivative.
import fs from 'node:fs';
import path from 'node:path';
import {JOINTS} from './skeleton.mjs';

const noTiming = o => { if (!o) return o; const {ms, ...rest} = o; return rest; }; // keep the manifest deterministic
const r = (v, d = 4) => Array.isArray(v) ? v.map(x => +(+x).toFixed(d)) : +(+v).toFixed(d);

function catalogEntry(repo, id) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(repo, 'public/vision-board/core-assets.json'), 'utf8'));
    const a = j.assets.find(x => x.id === id);
    if (!a) return null;
    return {title: a.title, conceptImage: a.image, conceptImageSha256: a.sha256, conceptGenerator: a.generator, conceptGeneratorModel: a.generatorModel,
      reconstruction: {nativeJob: a.model?.nativeJob, steps: a.model?.steps, seed: a.model?.seed, resolution: a.model?.resolution, sourceImageSha256: a.model?.sourceImageSha256, manifestSha256: a.model?.manifestSha256},
      catalogStatus: {unrigged: a.model?.unrigged, gameReady: a.model?.gameReady}, catalogFile: 'public/vision-board/core-assets.json (read-only)'};
  } catch { return null; }
}

export function makeManifest(ctx) {
  const {body, coat, skel, bodyW, clips, verify, outBytes, outSha, deathHipsY, deathContact, bodyMesh, coatMesh, OPTIONS, CLIP_SPECS, OUT_GLB, OUT_JSON, REPO, death} = ctx;
  const src = (m, extra) => ({
    id: m.id, uploadId: m.uploadId, packagePath: m.file, sha256Expected: m.sha256, sha256Verified: m.sha256, bytes: m.bytes,
    triangles: m.triangles, vertices: m.vertices, textures: m.textures, material: m.material,
    provenance: catalogEntry(REPO, m.id), ...extra,
  });
  const meshInfo = (m, T, extra) => ({node: m.name, skinned: true, vertices: m.pos.length / 3, triangles: m.idx.length / 3,
    material: m.name + 'Material', doubleSided: false, baseColor: {size: [T.baseColor, T.baseColor], mimeType: 'image/jpeg', jpegQuality: T.jpegQuality, bytes: m.baseColor.length},
    metallicRoughness: {size: [T.metallicRoughness, T.metallicRoughness], mimeType: 'image/jpeg', channels: 'G roughness, B metalness (~0), R unused', bytes: m.metallicRoughness.length}, ...extra});
  const joints = JOINTS.map(([name, parent], i) => ({index: i, name, parent, bindWorldPosition: r(skel.joints[name]), bindLocalRotation: [0, 0, 0, 1]}));
  return {
    schema: 'the-last-line/derivative-manifest@1',
    asset: 'zombie-rigged',
    title: 'Last-shift zombie - rigged runtime derivative (prototype)',
    status: {approved: false, gameReady: false, stage: 'unapproved prototype derivative for the vertical slice; art/anatomy/deformation not certified', licenseClearance: 'none - evaluation quality does not grant commercial rights; masters are AI reconstructions of AI-generated concept images'},
    authoredOn: '2026-10-25',
    honesty: {
      mastersHadSkeleton: false,
      rig: 'NEW derivative skeleton and automatic skin weights created by this pipeline; the masters were static, unrigged AI reconstructions',
      animation: 'hand-authored procedural keyframes (periodic gait functions, eased keyframes, analytic 2-bone leg IK) - NOT motion capture',
      generation: 'no AI generation, inference, model download or network service was used to build this derivative',
    },
    outputs: {
      glb: {path: path.relative(REPO, OUT_GLB), bytes: outBytes, sha256: outSha, format: 'glTF 2.0 binary, no Draco/meshopt/KTX2, JPEG textures'},
      manifest: path.relative(REPO, OUT_JSON),
      rebuild: 'node tools/asset-pipeline/zombie/build-zombie.mjs && node tools/asset-pipeline/zombie/qa/render-qa.mjs',
    },
    conventions: {units: 'metres', up: '+Y', facing: '+Z (masters faced -Z and were rotated 180 deg about Y)', floor: 'y = 0, feet on the floor', origin: 'midpoint between the feet (bbox centres of the soles)',
      handedness: 'L_ = character left = +X when facing +Z', heightM: r(skel.H, 3), bindPose: 'A-pose (upper arms ~34 deg, forearms ~39 deg from vertical)'},
    sources: {
      body: src(body.master, {placement: {scale: r(body.placement.scale, 6), pivotNative: r(body.placement.pivot, 5), rotateYDeg: 180, note: body.placement.note}}),
      coat: coat ? src(coat.master) : null,
    },
    meshes: {
      ZombieBody: meshInfo(bodyMesh, OPTIONS.body.textures),
      ZombieCoat: coatMesh ? meshInfo(coatMesh, OPTIONS.coat.textures, {hideForUncoatedVariant: true}) : null,
      sharedSkin: 'both SkinnedMesh nodes reference the single skin "ZombieSkin" (same 18 joints)',
    },
    skeleton: {
      jointCount: joints.length, joints, root: 'Root (origin, floor)', inverseBindMatrices: 'pure translations (all bind rotations identity: joint frames are world-aligned)',
      ends: Object.fromEntries(Object.entries(skel.ends).map(([k, v]) => [k, r(v)])),
      estimation: skel.log,
      symmetrized: 'paired joints averaged left/right (raw per-side values in estimation.rawPaired)',
    },
    skinning: {
      influencesPerVertex: 4, weightsNormalized: true, jointsAccessor: 'UNSIGNED_SHORT', weightsAccessor: 'FLOAT',
      body: {method: 'region classification (arm flood fill behind armpit-acromion cut plane + torso-wall guard; legs below crotch by side) -> chain-parameterised weights with joint blends (tilted neck/head boundary) -> masked Laplacian smoothing -> top-4', ...bodyW.stats},
      coat: coat ? coat.skinStats : null,
    },
    pipeline: {
      order: ['verify master sha256', 'place in game space (scale, 180 deg Y, feet origin)', 'weld exact-position duplicates', 'detect skeleton from horizontal cross-sections',
        'meshoptimizer simplifyWithUpdate (position quadric, Prune+Regularize, head/hands importance attribute)', 'new UV unwrap (smoothed-normal cone charts, planar projection, horizon packing)',
        'bake base colour + metallicRoughness from the master (closest facing point + cage ray, 32 worker threads) at 2048, push-pull gutter fill, Lanczos downsample, JPEG',
        'coat: global per-axis fit -> same mesh/bake path -> back-drape taper -> sleeve retarget onto body arm bones -> bind-pose push-out -> weight transfer from body',
        'skin weights', 'procedural clips (FK/IK) sampled at 30 fps', 'CPU skinning floor verification', 'write GLB (gltf-transform)'],
      seamPreservingSimplifyRejected: {reason: 'the AI atlases have thousands of tiny charts (~35% of vertices are UV-seam duplicates): seam-preserving simplification stalled at 98,728 tris (body) / 135,994 (coat) for a 15k target; meshopt Permissive reached the target but collapses across seams and would smear texture. So geometry is simplified position-only and textures are re-baked onto a fresh UV layout (no smearing).',
        measuredDuringDevelopment: {bodySeamLocked: 98728, coatSeamLocked: 135994, bodyPermissive: 14778, coatPermissive: 14616}},
      normalAttributeWeight: 'comparison at 16k tris (body): normal weight 0 -> 396 folded faces / 5 slivers; 0.35 -> 984 / 108. Position-only error kept.',
      body: {options: OPTIONS.body, simplify: body.stats.simplify, unwrap: body.stats.unwrap, bake: noTiming(body.stats.bake), outVertices: body.stats.outVertices},
      coat: coat ? {options: OPTIONS.coat, simplify: coat.stats.simplify, unwrap: coat.stats.unwrap, bake: noTiming(coat.stats.bake), outVertices: coat.stats.outVertices,
        globalFit: coat.fit, backTaper: coat.backTaper, sleeveRetarget: coat.retarget, fitSkeleton: coat.fitJoints, pushOut: coat.pushOut} : null,
      textureResolutionJustification: `1024^2 base colour per mesh: the head/face charts get ${OPTIONS.body.density.head}x texel density (~${Math.round(body.stats.unwrap.texelsPerMetreBase * OPTIONS.body.density.head)} texels/m on the face vs ${Math.round(body.stats.unwrap.texelsPerMetreBase)} elsewhere), which keeps the gaunt face readable in close-up renders; 2048 was not needed. MR 512^2 (coat roughness is near-constant in the master, body varies).`,
    },
    clips: clips.map(c => {
      const S = CLIP_SPECS[c.name];
      const o = {name: c.name, durationS: c.duration, loop: c.loop, fps: OPTIONS.fps, keyframes: c.times.length, rotationTracks: Object.keys(c.rot).length, hipsTranslationTrack: true, rootMotion: false};
      if (c.name === 'Walk') Object.assign(o, {inPlace: true, impliedGroundSpeedMps: S.groundSpeed, gait: 'shamble with limp: right leg drags (3.5 cm lift vs 7.5 cm, shorter stance), hips dip/sway, arms raised forward, palms down-inward'});
      if (c.name === 'Run') Object.assign(o, {inPlace: true, impliedGroundSpeedMps: S.groundSpeed, gait: 'lurching chase with flight phase, torso pitched forward, reaching arms'});
      if (c.name === 'Idle') Object.assign(o, {description: 'hunched sway, head loll, breathing, arms hanging'});
      if (c.name === 'Attack') Object.assign(o, {impactTimeS: S.impactTime, phases: {windup: [0, 0.32], lunge: [0.32, 0.45], impact: 0.45, followThrough: [0.45, 0.58], recover: [0.58, 1.1]}, description: 'two-arm claw swipe with a lunge step; starts and ends on the Idle t=0 pose'});
      if (c.name === 'Hit') Object.assign(o, {description: 'flinch back with head snap, peak at 0.08 s, returns to Idle t=0 pose'});
      if (c.name === 'Death') Object.assign(o, {description: 'jolt, stagger back, knees buckle, topple onto the back (feet stay planted via IK), settle supine; Root stays at origin, Hips translate/rotate',
        finalPose: {hipsOffsetY: r(deathHipsY), solverTune: death?.tune, lowestPointPerRegionM: deathContact, restingBoundsM: death?.bounds, layout: 'supine, head toward -Z, heels toward +Z'}});
      return o;
    }),
    verification: {
      cpuSkinningFloorCheck: verify,
      notes: 'minYOverClip = lowest skinned vertex (body+coat) over all 30 fps frames; framesBelowMinus1cm lists frames sinking more than 1 cm.',
      mastersUnchangedAfterBuild: true,
      browserQA: 'see qa section (written by tools/asset-pipeline/zombie/qa/render-qa.mjs)',
    },
    limitations: [
      'Automatic, approximate skin weights (no hand painting): expect LBS volume loss at shoulders/elbows/hips in extreme poses and some coat-body interpenetration in motion.',
      'No mocap: all clips are hand-authored procedural keyframes; no facial rig, no finger joints (fingers are rigid with the hand), no twist bones (forearm twist limited to ~35 deg at the wrist).',
      'No cloth simulation: the coat is skinned to the body skeleton (skirt follows Hips plus 45% thigh influence, faded to Hips on the centre line); it cannot drape or flatten on the floor.',
      'Coat fitted by per-axis transform + back-drape taper + sleeve retarget + bind-pose push-out; the reconstructed coat interior/lining and the back of both masters are AI-hallucinated hidden-side geometry.',
      'Death clip lies supine because rigid coat front panels would prop a prone body ~15 cm off the floor; the pelvis rests ~5 cm up on the coat back panel (also in the uncoated variant).',
      'Walk/Run are in place; the game must move the character at roughly the implied ground speeds to avoid foot sliding.',
      'Textures re-baked from the masters at 2048 then downsampled to 1024 (MR 512): fine detail of the 4096 masters is lost; no normal map is baked.',
      'Joint heights without a visible landmark (hip, knee, elbow centres) use anthropometric ratios between measured landmarks.',
      'Raised-arm poses (Attack wind-up) let the T-shirt show through the coat yoke; the master hair strand loops near the ears simplify into small flap-like shells.',
      'Unapproved prototype: appearance, anatomy, deformation, performance budget and licensing are not certified; gameReady false.',
    ],
  };
}
