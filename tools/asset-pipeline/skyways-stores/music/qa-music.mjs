#!/usr/bin/env node
// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): CPU QA for Northern Groove Records' own kinds (no browser /
// GPU): loads the runtime's own geometry builders through Vite's SSR loader (world/skywaysStoreMusic.ts — the exact sleeves / parts
// the game draws) and
//  --glb <dir>     writes one GLB per drawn kind (flat colours per shape material; sleeves / art faces textured from the atlases) for
//                  the scale check: node tools/asset-pipeline/props/scale-check.mjs --prop <dir>/<kind>.glb ...
//  --render <png>  renders a stocked record-bin rack pair (the real Meshy rack model, every bay filled, the genre cards), the
//                  new-arrivals board with its faced rows and a listening station, with the Codex atlases (deterministic CPU raster,
//                  tools/asset-pipeline/enemy/lib/preview-raster.mjs; studio light).
// usage: node tools/asset-pipeline/skyways-stores/music/qa-music.mjs [--glb <dir>] [--render <png>]
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {Document, NodeIO} from '@gltf-transform/core';

const root = path.resolve(import.meta.dirname, '../../../..');
const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const glbDir = opt('--glb'), renderOut = opt('--render');
const COVERS = path.join(root, 'game/public/assets/textures/skyways/stores/music/music-covers.jpg');
const SIGNS = path.join(root, 'game/public/assets/textures/skyways/stores/music/music-signs.jpg');
/** Flat stand-in colours (sRGB) per shape material for the exported GLBs / renders. */
const FLAT = {black: 0x1a1a1c, woodVeneer: 0x6b4a2e, wood: 0x9a7448, steelDark: 0x3c4046, steelBright: 0xb8bcc2, accent: 0xb33a2a, plasticSeat: 0x2a2a30, panel: 0xd8d2c4};

const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const M = await server.ssrLoadModule('/src/world/skywaysStoreMusic.ts');
  const S = await server.ssrLoadModule('/src/gen/skyways/stores/musicShapes.ts');
  const K = await server.ssrLoadModule('/src/gen/skyways/stores/musicStock.ts');
  const THREE = await server.ssrLoadModule('three');

  /** A geometry (non-indexed or indexed) to flat arrays. */
  const arrays = (g, m4) => {
    const geo = g.index ? g : g;
    const pos = Float32Array.from(geo.attributes.position.array), nrm = Float32Array.from(geo.attributes.normal.array), uv = geo.attributes.uv ? Float32Array.from(geo.attributes.uv.array) : new Float32Array(pos.length / 3 * 2);
    if (m4) {
      const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m4);
      for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m4); pos.set([v.x, v.y, v.z], i); n.set(nrm[i], nrm[i + 1], nrm[i + 2]).applyMatrix3(nm).normalize(); nrm.set([n.x, n.y, n.z], i); }
    }
    const idx = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({length: pos.length / 3}, (_, i) => i);
    return {pos, nrm, uv, idx};
  };
  const partGeos = parts => parts.map(p => {
    const g = 'box' in p ? new THREE.BoxGeometry(...p.box) : new THREE.CylinderGeometry(p.cyl.r, p.cyl.r, p.cyl.h, p.cyl.seg ?? 16);
    if (p.rx) g.rotateX(p.rx); if (p.rz) g.rotateZ(p.rz);
    g.translate(...p.p);
    return {m: p.m, g};
  });
  /** A kind's drawn pieces: [{tex: 'covers' | 'signs' | null, color, geo}] in its prop frame. */
  const pieces = kind => {
    const out = [];
    const addParts = parts => { for (const {m, g} of partGeos(parts)) out.push({tex: null, color: FLAT[m] ?? 0x888888, geo: g}); };
    const addFaces = faces => { for (const f of faces) out.push({tex: f.atlas, color: 0xffffff, geo: M.musicFaceGeometry(f)}); };
    switch (kind) {
      case 'skyMuTurntable': addParts(S.turntableParts()); break;
      case 'skyMuHeadphones': addParts(S.headphonesParts()); break;
      case 'skyMuStool': addParts(S.stoolParts()); break;
      case 'skyMuCoverWall': { const c = S.coverWallParts(); addParts(c.parts); addFaces(c.faces); break; }
      case 'skyMuBinLabel': { const c = S.binLabelParts('jazz'); addParts(c.parts); addFaces(c.faces); break; }
      case 'skyMuGigPoster': { const c = S.posterParts(0); addParts(c.parts); addFaces(c.faces); break; }
      case 'skyMuSign': { const c = S.signParts('listening-booths'); addParts(c.parts); addFaces(c.faces); break; }
      case 'skyMuFacedRecords': out.push({tex: 'covers', color: 0xffffff, geo: M.facedRowGeometry(3)}); break;
      case 'skyMuBinRecords': out.push({tex: 'covers', color: 0xffffff, geo: M.binBlockGeometry(4)}); break;
    }
    return out;
  };

  if (glbDir) {
    fs.mkdirSync(glbDir, {recursive: true});
    const io = new NodeIO();
    for (const kind of ['skyMuTurntable', 'skyMuHeadphones', 'skyMuStool', 'skyMuCoverWall', 'skyMuBinLabel', 'skyMuGigPoster', 'skyMuSign', 'skyMuFacedRecords', 'skyMuBinRecords']) {
      const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene(kind), node = doc.createNode(kind);
      scene.addChild(node);
      const mesh = doc.createMesh(kind);
      const texs = {};
      for (const pc of pieces(kind)) {
        const a = arrays(pc.geo);
        const prim = doc.createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(a.pos).setBuffer(buf))
          .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(a.nrm).setBuffer(buf))
          .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(a.uv, (v, i) => (i % 2 ? 1 - v : v))).setBuffer(buf))
          .setIndices(doc.createAccessor().setType('SCALAR').setArray(a.idx).setBuffer(buf));
        const c = new THREE.Color(pc.color).convertSRGBToLinear();
        const mat = doc.createMaterial().setBaseColorFactor([c.r, c.g, c.b, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
        if (pc.tex) {
          texs[pc.tex] ??= doc.createTexture(pc.tex).setImage(fs.readFileSync(pc.tex === 'covers' ? COVERS : SIGNS)).setMimeType('image/jpeg');
          mat.setBaseColorTexture(texs[pc.tex]);
        }
        prim.setMaterial(mat);
        mesh.addPrimitive(prim);
      }
      node.setMesh(mesh);
      await io.write(path.join(glbDir, `${kind}.glb`), doc);
    }
    console.log(`glb -> ${glbDir}`);
  }

  if (renderOut) {
    const R = path.join(root, 'tools/asset-pipeline/enemy/lib/');
    const {loadGlb, posePrim, worldMatrices} = await import(path.join(R, 'preview-gltf.mjs'));
    const {makeCamera, render, prepareMaterial, compose, encode} = await import(path.join(R, 'preview-raster.mjs'));
    const draws = [];
    const matOf = async (tex, color) => {
      const c = new THREE.Color(color).convertSRGBToLinear();
      return prepareMaterial({baseColorFactor: [c.r, c.g, c.b, 1], metallicFactor: 0, roughnessFactor: 0.8, normalScale: 1, ...(tex ? {baseColor: {bytes: fs.readFileSync(tex === 'covers' ? COVERS : SIGNS)}} : {})}, {maxTex: 2048});
    };
    // (three's UV v = 0 at the image bottom; the rasteriser samples glTF-style v = 0 at the top)
    const flipV = uv => Float32Array.from(uv, (v, i) => (i % 2 ? 1 - v : v));
    const addGeo = async (geo, m4, tex, color) => { const a = arrays(geo, m4); draws.push({pos: a.pos, nrm: a.nrm, uv: flipV(a.uv), idx: a.idx, mat: await matOf(tex, color)}); };
    const addKind = async (kind, m4) => { for (const pc of pieces(kind)) await addGeo(pc.geo, m4, pc.tex, pc.color); };
    const T = (x, y, z, rot = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
    // two racks back to back (the island pair), every bay stocked like the dresser does (row styles alternate)
    const rack = await loadGlb(path.join(root, 'game/public/assets/models/skyways-d-mu-bins.glb'));
    const W = worldMatrices(rack, null);
    for (const [rz, rrot] of [[0.39, 0], [-0.39, Math.PI]]) {
      const m4 = T(0, 0, rz, rrot);
      for (const p of rack.prims) {
        const {pos, nrm} = posePrim(rack, p, null, W);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        const a = arrays(g, m4);
        draws.push({pos: a.pos, nrm: a.nrm, uv: p.uv, idx: p.idx, mat: await prepareMaterial(p.material)});
      }
      let k = rrot ? 7 : 0;
      for (const row of [0, 1]) for (let col = 0; col < 6; col++) {
        const v = row * K.BIN_STYLES + (k++ * 3) % K.BIN_STYLES, f = K.binBlockFrame(v, col);
        const local = new THREE.Vector3(f.x, f.y, f.z).applyMatrix4(m4);
        await addGeo(M.binBlockGeometry(v), T(local.x, local.y, local.z, rrot), 'covers', 0xffffff);
      }
      const lab = new THREE.Vector3(0, 0.36, 0.39 + 0.004).applyMatrix4(m4);
      for (const pc of (() => { const c = S.binLabelParts(rrot ? 'soul' : 'rock'); return [...partGeos(c.parts).map(q => ({tex: null, color: FLAT[q.m], geo: q.g})), ...c.faces.map(f => ({tex: 'signs', color: 0xffffff, geo: M.musicFaceGeometry(f)}))]; })()) await addGeo(pc.geo, T(lab.x, lab.y, lab.z, rrot), pc.tex, pc.color);
    }
    // the new arrivals board on a "wall" at x = 2.6 facing -x, its faced rows on the ledges
    const wallRot = -Math.PI / 2, wd = S.COVER_WALL_DEPTH, base = K.COVER_WALL_BASE_Y;
    await addGeo(new THREE.BoxGeometry(0.1, 3, 4), T(2.65, 1.5, 0), null, 0x2d2433);
    await addKind('skyMuCoverWall', T(2.6 - wd / 2, base, 0, wallRot));
    for (const [i, ly] of K.COVER_WALL.ledges.entries()) {
      const lz = -wd / 2 + K.COVER_WALL.t + K.COVER_WALL.ledgeD / 2;
      const c = new THREE.Vector3(0, base + ly, lz).applyMatrix4(new THREE.Matrix4().makeRotationY(wallRot)).add(new THREE.Vector3(2.6 - wd / 2, 0, 0));
      await addGeo(M.facedRowGeometry(i * 4 + 1), T(c.x, c.y, c.z, wallRot), 'covers', 0xffffff);
    }
    // a listening station: the sideboard stand-in box (0.85 m), turntable / headphones on it, a stool
    await addGeo(new THREE.BoxGeometry(1.87, 0.85, 0.79).translate(0, 0.425, 0), T(-2.4, 0, -0.6, Math.PI / 2), null, 0x5a4636);
    await addKind('skyMuTurntable', T(-2.4, 0.85, -0.15, Math.PI / 2));
    await addKind('skyMuHeadphones', T(-2.4, 0.85, -1.0, Math.PI / 2 + 0.4));
    await addKind('skyMuStool', T(-1.4, 0, -0.3, -Math.PI / 2));
    const views = [
      {name: 'customer at the bins (eye 1.6 m)', eye: [0.4, 1.6, 1.7], target: [0, 0.7, 0.1], fov: 50},
      {name: 'bins from above', eye: [1.2, 2.6, 2.0], target: [0, 0.6, 0], fov: 45},
      {name: 'new arrivals wall', eye: [0.6, 1.6, 0.8], target: [2.6, 1.6, 0], fov: 55},
      {name: 'listening station', eye: [-0.6, 1.5, 0.8], target: [-2.3, 0.8, -0.6], fov: 50},
    ];
    const panels = [];
    for (const v of views) {
      const cam = makeCamera({type: 'persp', eye: v.eye, target: v.target, fovDeg: v.fov, w: 800, h: 560});
      panels.push({img: await render(draws, cam, {floor: {y: 0, half: 4, grid: 0.5}}), title: v.name});
    }
    const sheet = await compose(panels, {cols: 2, title: 'Northern Groove Records — record stock (CPU raster of the runtime geometry + Codex atlases; studio light)'});
    fs.mkdirSync(path.dirname(renderOut), {recursive: true});
    await encode(sheet, renderOut);
    console.log(`render -> ${renderOut}`);
  }
} finally {
  await server.close();
}
