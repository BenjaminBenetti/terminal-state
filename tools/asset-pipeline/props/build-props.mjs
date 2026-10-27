#!/usr/bin/env node
// The Last Line - runtime prop/weapon derivatives (prototype, unapproved, gameReady false).
// Usage: node tools/asset-pipeline/props/build-props.mjs [--only rifle,shotgun,...] [--skip-env]
// Reads the packaged read-only masters in public/vision-board/models (sha256-verified against
// local-model-map.json) and writes ONLY to game/public/assets/{models,textures,derivatives} and
// qa-artifacts/assets/props. Refuses to write under public/vision-board/ or reference/.
// Deterministic: no timestamps, fixed parameters, order-independent parallel bake.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {loadDense, simplifyGeometry, sha256File, sha256Buf} from './lib/dense.mjs';
import {unwrap} from './lib/unwrap.mjs';
import {bake} from './lib/bake.mjs';
import {encodeImage, writeMeshGlb} from './lib/glb.mjs';
import {mat3mul, det3, rotY, transformPositions, bbox, barrelAlignment, barrelTopPitch, minAreaYaw, findMuzzle, findGrip} from './lib/orient.mjs';
import {readProcedural, encodeTexture, decodeRGB, findJoints, rowFractions, runsAbove, flipGreenPng} from './lib/envtex.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = path.join(REPO, 'public/vision-board');
const OUT = {
  models: path.join(REPO, 'game/public/assets/models'),
  textures: path.join(REPO, 'game/public/assets/textures'),
  derivatives: path.join(REPO, 'game/public/assets/derivatives'),
  qa: path.join(REPO, 'qa-artifacts/assets/props'),
};
const FORBIDDEN = [path.join(REPO, 'public/vision-board'), path.join(REPO, 'reference')];

function guardedWrite(file, bytes) {
  const abs = path.resolve(file);
  for (const f of FORBIDDEN) if (abs === f || abs.startsWith(f + path.sep)) throw new Error(`refusing to write under ${path.relative(REPO, f)}/: ${abs}`);
  if (!Object.values(OUT).some(o => abs.startsWith(o + path.sep))) throw new Error(`refusing to write outside owned output roots: ${abs}`);
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, bytes);
  return {path: path.relative(REPO, abs), bytes: bytes.length, sha256: sha256Buf(bytes)};
}

const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const skipEnv = args.includes('--skip-env');
const log = (...a) => console.log(...a);

const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ROT_Y_180 = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];

// Per-output configuration. axisMap rows give output x,y,z in terms of source x,y,z.
const MESH_ASSETS = [
  {
    key: 'rifle', out: 'rifle.glb', id: 'assault-rifle-03', kind: 'gun',
    axisMap: [[0, 0, 1], [0, 1, 0], [1, 0, 0]],
    orientationEvidence: 'Source muzzle is at source -X (thin 3.5 cm flash hider; the 15.6 cm tall stock is at +X) and the concept-matching side (rendered from -Z it reproduces the muzzle-right concept) faces source -Z. The concept shows the rifle\'s RIGHT side, so placing it on -X with muzzle -Z requires a mirror: x\'=z, y\'=y, z\'=x (det -1, winding flipped, handedness of the prop reversed).',
    yaw: 'barrel', pitchSection: [0.0, 0.08], target: {axis: 2, meters: 0.92, label: 'overall length'}, tris: 25000, atlas: 2048, grip: 'pistol-grip', origin: 'bbox-center',
  },
  {
    key: 'shotgun', out: 'shotgun.glb', id: 'shotgun-07', kind: 'gun',
    axisMap: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    orientationEvidence: 'Source muzzle is at source +X (stock/butt 15 cm tall at -X) and the concept side (muzzle-left profile, white/red stock marks; one-sided shell carrier protrudes to z=-0.098) faces source -Z. Pure +90 deg rotation about Y: x\'=z, z\'=-x puts the muzzle at -Z and the concept side at -X.',
    yaw: 'barrel', pitchSection: [0.10, 0.30], target: {axis: 2, meters: 1.0, label: 'overall length'}, tris: 25000, atlas: 2048, grip: 'stock-wrist', origin: 'bbox-center',
  },
  {
    key: 'bench', out: 'bench.glb', id: 'env-bench-03', kind: 'prop', axisMap: IDENT,
    orientationEvidence: 'Seat extends toward source +Z with the backrest at -Z (side render); the source -Z view matches the multi-view "back" input (framed recessed panels). Front (sitting side) is already +Z: identity.',
    yaw: 'min-area', target: {axis: 0, meters: 1.8, label: 'length'}, tris: 7000, atlas: 1024, origin: 'bottom-center',
  },
  {
    key: 'light', out: 'light.glb', id: 'env-light-03', kind: 'prop', axisMap: IDENT,
    orientationEvidence: 'Mounting bracket with fasteners is on top (+Y); the brighter cream diffuser face that best matches the front input is +Z (the reconstruction shows diffuser through straps on both faces; the multi-view "back" input was a plain plate, not reproduced). Identity.',
    yaw: 'min-area', target: {axis: 0, meters: 1.2, label: 'length'}, tris: 3000, atlas: 1024, origin: 'top-center',
  },
  {
    key: 'cabinet-tall', out: 'cabinet-tall.glb', id: 'cabinet-tall-03', kind: 'prop', axisMap: ROT_Y_180,
    orientationEvidence: 'Doors, handles, painted numeral and repair plate are on source -Z; rotate 180 deg about Y so the front faces +Z.',
    yaw: 'min-area', target: {axis: 1, meters: 1.9, label: 'height'}, tris: 6500, atlas: 1024, origin: 'bottom-center',
  },
  {
    key: 'cabinet-low', out: 'cabinet-low.glb', id: 'cabinet-low-03', kind: 'prop', axisMap: ROT_Y_180,
    orientationEvidence: 'Doors, mismatched handles and lower-left repair plate are on source -Z; rotate 180 deg about Y so the front faces +Z.',
    yaw: 'min-area', target: {axis: 1, meters: 0.85, label: 'height'}, tris: 6500, atlas: 1024, origin: 'bottom-center',
  },
];

const ENV_ASSETS = [
  {key: 'wall', id: 'env-wall-03'}, {key: 'platform', id: 'env-platform-03'}, {key: 'ceiling', id: 'env-ceiling-03'}, {key: 'tunnel', id: 'env-tunnel-03'},
];

const modelMap = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'local-model-map.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'core-assets.json'), 'utf8'));
const catalogEntry = id => catalog.assets.find(a => a.id === id) ?? (() => { throw new Error(`catalog entry ${id} missing`); })();

function verifiedSource(id) {
  const m = modelMap.models.find(x => x.id === id);
  if (!m) throw new Error(`${id} not in local-model-map.json`);
  const file = path.join(SRC_DIR, m.packagePath);
  const sha = sha256File(file);
  if (sha !== m.sha256) throw new Error(`${id}: sha256 mismatch ${sha} != ${m.sha256}`);
  const cat = catalogEntry(id);
  if (cat.model?.modelSha256 && cat.model.modelSha256 !== sha) throw new Error(`${id}: catalog modelSha256 mismatch`);
  return {file, rel: path.relative(REPO, file), sha256: sha, bytes: fs.statSync(file).size, uploadId: m.uploadId, generationMode: m.generationMode, catalog: cat};
}

const r6 = v => Math.round(v * 1e6) / 1e6;
const r4 = v => Math.round(v * 1e4) / 1e4;
const vec = a => a.map(r6);

async function buildMesh(cfg) {
  const t0 = Date.now();
  const src = verifiedSource(cfg.id);
  log(`\n== ${cfg.key} <- ${cfg.id} (${src.rel}, sha256 verified)`);
  const dense = await loadDense(src.file);
  const P0 = transformPositions(dense.P, cfg.axisMap);
  let yawDeg = 0, alignment;
  if (cfg.yaw === 'barrel') {
    alignment = barrelAlignment(P0);
    yawDeg = -alignment.yawDeg;
  } else {
    const d = minAreaYaw(P0);
    alignment = {minAreaYawDeg: d, applied: Math.abs(d) >= 0.3};
    yawDeg = Math.abs(d) >= 0.3 ? d : 0;
  }
  const R = mat3mul(rotY(yawDeg), cfg.axisMap);
  const det = det3(R);

  const simp = await simplifyGeometry(dense, cfg.tris);
  log(`  simplified ${dense.stats.triangles} -> ${simp.idx.length / 3} tris, error ${simp.errorAbsolute.toExponential(3)} source units`);
  const pad = 4;
  const low = unwrap(simp.pos, simp.idx, {atlas: cfg.atlas, pad});
  log(`  unwrap: ${low.stats.charts} charts, fill ${(low.stats.chartAreaFraction * 100).toFixed(1)}%`);
  const searchRadius = Math.max(0.02, 6 * simp.errorAbsolute);
  const baked = await bake(dense, low, {atlas: cfg.atlas, supersample: 2, mrDiv: 2, normalDiv: 2, searchRadius, log: s => log('   ', s)});

  // final transform: p' = s R p + t ; normals R n ; winding flipped if mirrored
  const lowR = transformPositions(low.pos, R);
  const bbR = bbox(lowR);
  const s = cfg.target.meters / bbR.size[cfg.target.axis];
  const bbS = bbox(transformPositions(low.pos, R, s));
  let t;
  if (cfg.origin === 'bbox-center') t = bbS.center.map(v => -v);
  else if (cfg.origin === 'bottom-center') t = [-bbS.center[0], -bbS.min[1], -bbS.center[2]];
  else if (cfg.origin === 'top-center') t = [-bbS.center[0], -bbS.max[1], -bbS.center[2]];
  const pos = transformPositions(low.pos, R, s, t);
  const nrm = transformPositions(low.nrm, R);
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  const idx = Uint32Array.from(low.idx);
  if (det < 0) for (let f = 0; f < idx.length; f += 3) { const tmp = idx[f + 1]; idx[f + 1] = idx[f + 2]; idx[f + 2] = tmp; }
  const outBB = bbox(pos);

  const children = [];
  let anchors = null;
  if (cfg.kind === 'gun') {
    const DP = transformPositions(dense.P, R, s, t);
    const residual = barrelAlignment(DP);
    const pitch = barrelTopPitch(DP, cfg.pitchSection);
    const muzzle = findMuzzle(DP);
    const grip = findGrip(DP, cfg.grip);
    children.push({name: 'Muzzle', translation: vec(muzzle.position)}, {name: 'Grip', translation: vec(grip.position)});
    anchors = {
      Muzzle: {position: vec(muzzle.position), method: 'Barrel = dense-source vertices in the front 4 cm whose height is within 2.8 cm of the front-most top; tip z = min z of those; x/y = centre of the barrel cross-section within 1 cm of the tip.', details: {frontTopY: r6(muzzle.frontTopY), barrelCrossSectionX: vec(muzzle.barrelCrossSection.x), barrelCrossSectionY: vec(muzzle.barrelCrossSection.y), frontMostZ: r6(muzzle.frontMostZ)}},
      Grip: {position: vec(grip.position), method: cfg.grip === 'pistol-grip'
        ? 'Bottom profile (5 mm bins along Z): magazine = deepest run; pistol grip = deepest bin behind it and ahead of the rear 25% (stock); receiver bottom = highest underside between them; Grip = centroid of dense vertices in the grip run 1-6 cm below the receiver bottom (upper grip, just behind the trigger).'
        : 'No pistol grip: trigger guard = deepest two-sided local protrusion of the bottom profile between 45% and 70% of the length (5 mm bins, 5 cm windows); Grip = centre of the cross-section 4 cm behind the guard\'s rear edge (stock wrist where the firing hand wraps).',
        details: JSON.parse(JSON.stringify(grip, (k, v) => typeof v === 'number' ? r6(v) : v))},
      barrelAlignment: {
        yawResidualDegAfterCorrection: r4(residual.yawDeg),
        pitchMeasuredNotCorrectedDeg: r4(pitch.pitchDeg),
        pitchMethod: `Theil-Sen slope of the barrel top line (1 cm slice maxima) over ${pitch.section[0] * 100}-${pitch.section[1] * 100}% of the length from the muzzle (${pitch.samples} slices; top line range ${(pitch.topLineRangeMeters * 1000).toFixed(1)} mm). Level within this tolerance; no pitch rotation applied (concept profiles were level).`,
      },
    };
    log(`  Muzzle ${anchors.Muzzle.position}  Grip ${anchors.Grip.position}`);
  }

  const color = await encodeImage(baked.color.data, baked.color.size, baked.color.size, 'color');
  const orm = await encodeImage(baked.mr.data, baked.mr.size, baked.mr.size, 'orm');
  const normal = await encodeImage(baked.normal.data, baked.normal.size, baked.normal.size, 'normal');
  const status = 'prototype runtime derivative of an unapproved AI-reconstructed master; reviewStatus unapproved; gameReady false; no license clearance';
  const glb = await writeMeshGlb({
    name: cfg.key, mesh: {pos, nrm, uv: low.uv, idx}, textures: {color, orm, normal}, material: dense.material, children,
    extras: {sourceId: cfg.id, uploadId: src.uploadId, sourceSha256: src.sha256, units: 'meters', provisionalDimensionsMeters: vec(outBB.size), status, pipeline: 'tools/asset-pipeline/props/build-props.mjs'},
  });
  const written = guardedWrite(path.join(OUT.models, cfg.out), glb);
  log(`  wrote ${written.path} ${written.bytes} bytes (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  return {
    output: written.path, key: cfg.key, kind: cfg.kind, bytes: written.bytes, sha256: written.sha256,
    triangles: idx.length / 3, vertices: pos.length / 3,
    textures: {
      baseColor: {size: [baked.color.size, baked.color.size], mime: color.mime, bytes: color.bytes.length},
      metallicRoughness: {size: [baked.mr.size, baked.mr.size], mime: orm.mime, bytes: orm.bytes.length, channels: 'R=255 (unused; occlusion-neutral), G=roughness, B=metalness'},
      normal: {size: [baked.normal.size, baked.normal.size], mime: normal.mime, bytes: normal.bytes.length, convention: 'tangent space, glTF +Y (green) = image up; baked for three.js derivative tangent frame (no TANGENT attribute)'},
    },
    material: {metallicFactor: dense.material.metallicFactor, roughnessFactor: dense.material.roughnessFactor, doubleSided: false, alphaMode: 'OPAQUE'},
    source: {
      id: cfg.id, title: src.catalog.title, uploadId: src.uploadId, path: src.rel, sha256: src.sha256, sha256Verified: true, bytes: src.bytes,
      generationMode: src.generationMode, reviewStatus: src.catalog.model?.reviewStatus ?? null, gameReady: src.catalog.model?.gameReady ?? null,
      triangles: dense.stats.triangles, vertices: dense.stats.vertices, textures: dense.material.textures,
      boundsSourceUnits: {min: vec(dense.bbox.min), max: vec(dense.bbox.max)},
    },
    transform: {
      description: 'p_out = scale * R * p_source + translation (baked into vertices; node transform is identity)',
      axisMap: cfg.axisMap, alignmentYawDeg: r4(yawDeg), alignment: JSON.parse(JSON.stringify(alignment, (k, v) => typeof v === 'number' ? r4(v) : v)),
      R: R.map(r => r.map(r6)), determinant: Math.round(det), mirrored: det < 0, scale: r6(s), translation: vec(t),
      orientationEvidence: cfg.orientationEvidence,
      origin: cfg.origin === 'bbox-center' ? 'bounding-box centre' : cfg.origin === 'bottom-center' ? 'bottom centre (y=0 is floor contact; x/z bbox centre)' : 'top centre (y=0 is the top/mounting face; fixture hangs down to negative y; x/z bbox centre)',
    },
    dimensionsMeters: {provisional: true, chosen: `${cfg.target.label} ${cfg.target.meters} m (uniform scale; other dimensions follow source proportions)`, bbox: {min: vec(outBB.min), max: vec(outBB.max), size: vec(outBB.size)}},
    conventions: cfg.kind === 'gun'
      ? {units: 'meters', muzzle: '-Z', up: '+Y', referenceSide: '-X (side seen by a right-handed first-person camera)', origin: 'bounding-box centre'}
      : {units: 'meters', front: '+Z', up: '+Y', origin: cfg.origin},
    anchors,
    pipeline: [
      {step: 'verify-source', detail: 'sha256 vs public/vision-board/local-model-map.json and catalog model.modelSha256'},
      {step: 'simplify', tool: 'meshoptimizer MeshoptSimplifier.simplify', options: {targetTriangles: cfg.tris, targetError: 1.0, flags: simp.flags}, resultTriangles: idx.length / 3, errorRelative: r6(simp.error), errorSourceUnits: r6(simp.errorAbsolute), errorMeters: r6(simp.errorAbsolute * s), droppedDegenerate: simp.droppedDegenerate, note: 'geometry only; source UVs discarded; weld by exact position after collapse'},
      {step: 'unwrap', tool: 'lib/unwrap.mjs (6-axis box-projection charts, 4 smoothing passes, small-chart merge <=6 faces, min-area rotation, shelf packing)', options: {atlas: cfg.atlas, paddingPx: pad, minDot: 0.25, creaseDeg: 50}, stats: JSON.parse(JSON.stringify(low.stats, (k, v) => typeof v === 'number' ? r6(v) : v))},
      {step: 'bake', tool: 'lib/bake.mjs + bake-worker.mjs (closest same-facing dense surface via uniform grid; bilinear source texture sampling; dense vertex normals -> tangent space)', options: {supersample: 2, searchRadiusSourceUnits: r6(searchRadius), dilationPx: 32, mrDiv: 2, normalDiv: 2}, stats: JSON.parse(JSON.stringify(baked.stats, (k, v) => typeof v === 'number' ? r6(v) : v))},
      {step: 'transform', detail: 'axis map + alignment yaw + uniform scale + origin translation baked into vertices; normals rotated; winding flipped when mirrored'},
      {step: 'encode', detail: 'baseColor JPEG q86 4:4:4, metallicRoughness JPEG q90 4:4:4, normal PNG; plain glTF 2.0 binary, no extensions'},
    ],
    limitations: [
      'Source is an AI reconstruction (Pixal3D-family local generation from concept images): hidden/back/underside surfaces and texture are inferred, not designed; some details are blurred or mirrored copies.',
      `Simplified from ${dense.stats.triangles} to ${idx.length / 3} triangles; thin parts and small protrusions lose geometric detail (max simplification error ~${(simp.errorAbsolute * s * 1000).toFixed(1)} mm); fine relief is approximated by the baked normal map only.`,
      'Textures re-baked onto a new automatic atlas (box-projection charts); chart seams can show faint discontinuities at grazing angles and at distant mip levels.',
      'Provisional real-world scale chosen by this pipeline, not measured or approved.',
      'Prototype derivative: source reviewStatus unapproved, gameReady false; not approved art; no commercial/model license clearance asserted.',
      ...(det < 0 ? ['Mirrored relative to the concept so the concept side faces the player (-X): any lettering/markings appear reversed and the prop is a left/right-swapped version of the reference rifle.'] : []),
      ...(cfg.kind === 'gun' ? ['Muzzle/Grip anchors are geometric estimates for prototype hand/aim placement, not rig-authored sockets.'] : []),
    ],
  };
}

// ---------------------------------------------------------------- environment textures + sign
function metersFromBottom(py, H, heightM) { return r4((H - py) / H * heightM); }

async function buildEnv() {
  const table = [];
  const sheetItems = [];
  for (const e of ENV_ASSETS) {
    const src = verifiedSource(e.id);
    const {mats, prims} = await readProcedural(src.file);
    const front = prims.find(p => p.material === 'working-face');
    const W = r4(front.max[0] - front.min[0]), H = r4(front.max[1] - front.min[1]);
    const back = prims.find(p => p.material === 'authored-backing');
    const T = r4(back.max[2] - back.min[2]);
    log(`\n== env ${e.key} <- ${e.id} (sha256 verified) face ${W} x ${H} m, backing depth ${T} m`);
    for (const m of mats) {
      const features = {};
      const colorImg = await decodeRGB(m.textures.color.getImage());
      let spans;
      if (m.name === 'working-face') {
        spans = {uMeters: W, vMeters: H, region: 'UV 0..1 x 0..1 covers the whole front (+Z) working face; u=0 at the left (-X) edge, v=0 at the TOP edge (glTF convention), v=1 at the bottom edge'};
        const rows = findJoints(colorImg, 'row'), cols = findJoints(colorImg, 'col');
        const c = r => (r[0] + r[1] + 1) / 2;
        features.horizontalJointsMetersFromBottom = rows.runs.map(r => metersFromBottom(c(r), colorImg.height, H));
        features.verticalJointsMetersFromLeft = cols.runs.map(r => r4(c(r) / colorImg.width * W));
        if (e.key === 'wall') {
          const teal = rowFractions(colorImg, (r, g, b) => g - r > 25 && b - r > 25);
          const charcoal = rowFractions(colorImg, (r, g, b) => Math.max(r, g, b) < 85 && !(g - r > 25 && b - r > 25));
          const tr = runsAbove(teal, 0.5), cr = runsAbove(charcoal, 0.5);
          const span = (runs) => ({topMetersFromBottom: metersFromBottom(runs[0][0], colorImg.height, H), bottomMetersFromBottom: metersFromBottom(runs[runs.length - 1][1] + 1, colorImg.height, H), pixelRows: runs});
          features.tealBandTileFaces = span(tr);
          features.charcoalBaseTileFaces = span(cr);
          // course (row) module from joints between cream courses
          const js = features.horizontalJointsMetersFromBottom;
          const diffs = js.slice(1).map((v, i) => r4(Math.abs(v - js[i])));
          features.courseHeightMeters = diffs.length ? r4(diffs.sort((a, b) => a - b)[diffs.length >> 1]) : null;
          // tile width from the vertical joints inside the top course
          const band = {data: colorImg.data.subarray(3 * colorImg.width * 4, 3 * colorImg.width * Math.round(colorImg.height / 12 - 4)), width: colorImg.width, height: Math.round(colorImg.height / 12 - 4) - 4};
          const vj = findJoints(band, 'col').runs.map(r => r4((r[0] + r[1] + 1) / 2 / colorImg.width * W));
          features.topCourseVerticalJointsMetersFromLeft = vj;
          features.tileWidthMeters = vj.length > 1 ? r4(vj.slice(1).map((v, i) => v - vj[i]).sort((a, b) => a - b)[(vj.length - 1) >> 1]) : null;
          features.note = 'Running-bond tiles: alternate courses offset by half a tile. Joint/band heights include the 2 px grout margins of each course; "tile faces" exclude grout.';
        }
        if (e.key === 'platform') {
          const edge = prims.find(p => p.material === 'integrated-safety-edge');
          features.safetyEdgeOverlay = {material: 'integrated-safety-edge', coversMetersFromBottom: [0, r4(edge.max[1] - front.min[1])], raisedMeters: r4(edge.max[2] - front.max[2]), note: 'separate raised plate + 200 tactile bumps (5 rows x 40) sitting on top of the bottom strip of the working face; the face texture continues underneath'};
          features.orientationNote = 'Catalog upright display: X right, Y up, face +Z. In a level the slab face lies flat as the platform top; the bottom edge (safety strip) is the track-side edge.';
        }
      } else if (m.name === 'authored-backing') {
        spans = {region: 'each of the 5 non-front faces of the backing box maps the FULL 0..1 texture (stretched per face)', faces: {back: [W, H], leftRight: [T, H], topBottom: [W, T]}};
      } else if (m.name === 'integrated-safety-edge') {
        const edge = prims.find(p => p.material === 'integrated-safety-edge');
        const ew = r4(edge.max[0] - edge.min[0]);
        const cols = findJoints(colorImg, 'col', {k: 2});
        spans = {uMeters: ew, vMeters: r4(edge.max[1] - edge.min[1]), region: 'full 0..1 on the front of the raised edge plate (also its sides/top); tactile bump caps use radial 0..1 UVs'};
        features.darkGroovesMetersFromLeft = cols.runs.map(r => r4((r[0] + r[1] + 1) / 2 / colorImg.width * ew));
      }
      for (const [channel, tex] of Object.entries(m.textures)) {
        const srcBytes = tex.getImage();
        const meta = await sharp(Buffer.from(srcBytes)).metadata();
        const kind = channel === 'color' ? 'color' : channel === 'orm' ? 'orm' : 'normal';
        const enc = await encodeTexture(srcBytes, kind, 1024);
        const name = `${e.key}-${m.name}-${channel}.${enc.ext}`;
        const w = guardedWrite(path.join(OUT.textures, name), enc.bytes);
        table.push({
          file: w.path, bytes: w.bytes, sha256: w.sha256, size: [enc.width, enc.height], format: enc.mime,
          channel: channel === 'orm' ? 'packed ORM: R=255 (no occlusion), G=roughness, B=metalness (0)' : channel === 'normal' ? 'tangent-space normal, glTF convention (+Y/green = image up); GREEN INVERTED from source' : 'base colour (sRGB)',
          source: {asset: e.id, uploadId: src.uploadId, glbSha256: src.sha256, material: m.name, image: tex.getName(), size: [meta.width, meta.height], sha256: sha256Buf(Buffer.from(srcBytes))},
          spans, features: channel === 'color' ? features : undefined, materialNormalScale: channel === 'normal' ? m.normalScale : undefined,
          encoding: enc.mime === 'image/png' ? 'PNG lossless' : `JPEG q${enc.quality} 4:4:4`,
        });
        sheetItems.push({file: path.join(OUT.textures, name), label: `${name}  ${enc.width}x${enc.height}`, sub: spans.uMeters ? `spans ${spans.uMeters} x ${spans.vMeters} m` : 'backing: full texture per face'});
        log(`  ${name} ${enc.width}x${enc.height} ${w.bytes} B`);
      }
    }
  }
  await contactSheet(sheetItems, path.join(OUT.qa, 'textures-sheet.png'));
  return table;
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
async function contactSheet(items, outFile) {
  const cw = 800, ch = 330, iw = 780, ih = 270, top = 50;
  const rows = Math.ceil(items.length / 2);
  const comps = [];
  for (const [i, it] of items.entries()) {
    const x = (i % 2) * cw, y = top + Math.floor(i / 2) * ch;
    const img = await sharp(it.file).resize(iw, ih, {fit: 'inside', kernel: 'lanczos3'}).png().toBuffer();
    const meta = await sharp(img).metadata();
    comps.push({input: img, left: x + 10, top: y + 8});
    const svg = `<svg width="${cw}" height="44" xmlns="http://www.w3.org/2000/svg"><text x="10" y="18" font-family="DejaVu Sans" font-size="15" font-weight="bold" fill="#fff">${esc(it.label)}</text><text x="10" y="38" font-family="DejaVu Sans" font-size="13" fill="#bbb">${esc(it.sub)} (shown ${meta.width}x${meta.height})</text></svg>`;
    comps.push({input: Buffer.from(svg), left: x, top: y + ch - 48});
  }
  const title = `<svg width="${2 * cw}" height="${top}" xmlns="http://www.w3.org/2000/svg"><text x="12" y="32" font-family="DejaVu Sans" font-size="22" font-weight="bold" fill="#fff">Extracted procedural environment textures (game/public/assets/textures) - normals green-inverted to glTF convention</text></svg>`;
  comps.push({input: Buffer.from(title), left: 0, top: 0});
  const png = await sharp({create: {width: 2 * cw, height: top + rows * ch, channels: 3, background: '#1d1f22'}}).composite(comps).png().toBuffer();
  guardedWrite(outFile, png);
}

async function buildSign() {
  const id = 'env-sign-03';
  const src = verifiedSource(id);
  log(`\n== sign <- ${id} (sha256 verified)`);
  const io = new NodeIO();
  const doc = await io.read(src.file);
  const root = doc.getRoot();
  const texLog = [];
  for (const tex of root.listTextures()) {
    const name = tex.getName();
    const kind = /normal/.test(name) ? 'normal' : /metallic/.test(name) ? 'orm' : 'color';
    const before = await sharp(Buffer.from(tex.getImage())).metadata();
    const enc = await encodeTexture(tex.getImage(), kind, 1024);
    tex.setImage(new Uint8Array(enc.bytes)).setMimeType(enc.mime).setURI('').setName(name.replace(/\.png$/, '.' + enc.ext));
    texLog.push({texture: name, from: [before.width, before.height], to: [enc.width, enc.height], format: enc.mime, greenInverted: !!enc.greenFlipped});
  }
  const node = root.listNodes()[0];
  node.setName('sign');
  node.setExtras({sourceId: id, uploadId: src.uploadId, sourceSha256: src.sha256, units: 'meters', status: 'procedural draft re-export; unreviewed/unapproved; gameReady false', pipeline: 'tools/asset-pipeline/props/build-props.mjs'});
  const prims = root.listMeshes()[0].listPrimitives();
  let tris = 0; const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    tris += p.getIndices().getCount() / 3;
    const a = p.getAttribute('POSITION'); const mn = a.getMin([]), mx = a.getMax([]);
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], mn[c]); max[c] = Math.max(max[c], mx[c]); }
  }
  const glb = Buffer.from(await io.writeBinary(doc));
  const w = guardedWrite(path.join(OUT.models, 'sign.glb'), glb);
  log(`  wrote ${w.path} ${w.bytes} bytes`);
  return {
    output: w.path, key: 'sign', kind: 'procedural-reexport', bytes: w.bytes, sha256: w.sha256, triangles: tris, primitives: prims.length,
    textures: texLog,
    source: {id, uploadId: src.uploadId, path: src.rel, sha256: src.sha256, sha256Verified: true, bytes: src.bytes, generationMode: 'procedural', reviewStatus: src.catalog.model?.reviewStatus ?? null, gameReady: src.catalog.model?.gameReady ?? null},
    transform: {description: 'none: geometry, materials, samplers and node layout preserved byte-for-byte except texture images and node name/extras', origin: 'centre of the backing plate', front: '+Z'},
    dimensionsMeters: {provisional: true, native: '1.8 x 0.38 m face, 0.018 m plate (rim/fasteners to +0.018 z)', bbox: {min: vec(min), max: vec(max), size: vec([0, 1, 2].map(c => max[c] - min[c]))}},
    pipeline: [{step: 'verify-source'}, {step: 'texture-downsize', detail: 'long side <= 1024 (lanczos3); colour JPEG q85 4:4:4, metallic-roughness JPEG q90 4:4:4, normal PNG with GREEN INVERTED to glTF convention and renormalised'}, {step: 'write', tool: 'gltf-transform NodeIO'}],
    limitations: ['Procedural draft (provisional dimensions, unreviewed); not approved art; no blanket license clearance (vendored DejaVu font notice applies to the lettering).', 'Normal map green channel inverted relative to the source (source used green-down; verified by grazing-light render).'],
  };
}

// ---------------------------------------------------------------- main
const pkgVersion = p => { try { return JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', p, 'package.json'), 'utf8')).version; } catch { return null; } };
const t0 = Date.now();
const outputs = [];
const manifestPath = path.join(OUT.derivatives, 'props.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
for (const cfg of MESH_ASSETS) {
  if (only && !only.includes(cfg.key)) { const prev = previous?.outputs?.find(o => o.key === cfg.key); if (prev) outputs.push(prev); continue; }
  outputs.push(await buildMesh(cfg));
  if (global.gc) global.gc();
}
if (!only || only.includes('sign')) outputs.push(await buildSign());
else { const prev = previous?.outputs?.find(o => o.key === 'sign'); if (prev) outputs.push(prev); }
const envTable = skipEnv ? previous?.environmentTextures?.table ?? [] : await buildEnv();

const manifest = {
  schema: 'last-line-props-derivatives-v1',
  status: 'PROTOTYPE runtime derivatives for the first playable slice. All sources are unapproved (reviewStatus unapproved/unreviewed, gameReady false). Outputs inherit that status: not approved art, not production assets, no commercial/model license clearance asserted. Dimensions are provisional choices of this pipeline.',
  rebuild: 'node tools/asset-pipeline/props/build-props.mjs   (QA renders: node tools/asset-pipeline/props/qa-props.mjs)',
  deterministic: 'Fixed parameters, no timestamps, order-independent parallel bake; identical inputs + tool versions reproduce identical bytes.',
  tooling: {node: process.version, three: pkgVersion('three'), '@gltf-transform/core': pkgVersion('@gltf-transform/core'), meshoptimizer: pkgVersion('meshoptimizer'), sharp: pkgVersion('sharp')},
  conventions: {
    units: 'meters', up: '+Y', handedness: 'right-handed (glTF)',
    guns: 'muzzle -Z, top +Y, concept/reference side faces -X (seen by a right-handed first-person camera), origin at bounding-box centre; child empties "Muzzle" and "Grip"',
    props: 'front +Z; origin bottom-centre (y=0 floor contact) except light.glb: top-centre (y=0 = top mounting face, fixture hangs below)',
    files: 'plain glTF 2.0 binary; no Draco/meshopt/KTX2/webp extensions; JPEG/PNG textures; no TANGENT attribute (three.js derivative tangents; normal maps baked for that)',
  },
  outputs,
  environmentTextures: {
    directory: 'game/public/assets/textures',
    naming: '<asset>-<material>-<color|orm|normal>.<ext>',
    normalMapNote: 'The procedural kit (reference/tools/procedural-environment-kit/generate_v2.py) encodes normal green as -dH/dv with v pointing image-down ("green down"). glTF/three.js expect green = image-up, so tiles rendered with the source maps light from the wrong vertical direction (grazing-light check: qa-artifacts/assets/props/procedural-normal-green-check.png). All extracted normal maps (and sign.glb) have the GREEN channel INVERTED to the glTF convention. Sources untouched.',
    uvNote: 'Working-face textures are authored for one panel: UV 0..1 spans the whole face (sizes below). To tile level geometry at real scale, repeat every <uMeters> horizontally and <vMeters> vertically (or map a sub-range). They are NOT seamless by construction (noise/spots at the borders); joints are measured from pixels.',
    table: envTable,
  },
  sourceAudit: {modelMap: 'public/vision-board/local-model-map.json', catalog: 'public/vision-board/core-assets.json', note: 'Masters read-only; no file under public/vision-board/ or reference/ was written.'},
};
guardedWrite(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
log(`\nwrote ${path.relative(REPO, manifestPath)} (${((Date.now() - t0) / 1000).toFixed(1)} s total)`);
