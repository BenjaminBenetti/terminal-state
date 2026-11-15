import {describe, expect, it, vi} from 'vitest';
import {BoxGeometry, DataTexture, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, Object3D, Points, PointsMaterial, Sprite, SpriteMaterial, type Material} from 'three';
import {MeshStandardNodeMaterial, type Node} from 'three/webgpu';
import {materialColor} from 'three/tsl';
import {addNodeHook, applyNodeHooks, nodeHookKeys} from '../src/render/nodeHooks';
import {releaseSurfaceMaterialPrograms} from '../src/world/surface/gpuBoundary';

describe('Surface material program release preserves source assets', () => {
  it('disposes each unique drawable material once without touching maps, geometry, PBR values or Node hooks', () => {
    const textures = Array.from({length: 6}, () => new DataTexture(new Uint8Array([80, 95, 70, 255]), 1, 1));
    const images = textures.map(t => t.image), textureDisposals = textures.map(t => vi.spyOn(t, 'dispose'));
    const geometry = new BoxGeometry(2, 3, 4), geometryDispose = vi.spyOn(geometry, 'dispose');
    const pbr = new MeshStandardMaterial({map: textures[0], normalMap: textures[1], roughnessMap: textures[2], metalnessMap: textures[3], aoMap: textures[4], envMap: textures[5],
      color: 0x3e4d36, emissive: 0x15120b, emissiveIntensity: 0.23, roughness: 0.73, metalness: 0.42, aoMapIntensity: 0.65, side: DoubleSide, opacity: 0.85, transparent: true, depthWrite: false});
    pbr.normalScale.set(0.6, 0.7); pbr.userData = {asset: 'existing-surface-pbr', unchanged: [1, 2, 3]};
    const node = new MeshStandardNodeMaterial({map: textures[0], normalMap: textures[1], roughnessMap: textures[2], roughness: 0.64, metalness: 0.27});
    node.colorNode = materialColor;
    const keepColor = vi.fn((previous: Node | null) => previous);
    addNodeHook(node, {key: 'existing-surface-hook', stage: 'color', order: 100, fn: keepColor});
    const nodeRefs = {color: node.colorNode, position: node.positionNode, output: node.outputNode,
      setup: node.setupDiffuseColor, beforeCompile: node.onBeforeCompile, cacheKey: node.customProgramCacheKey};
    const pbrBefore = {uuid: pbr.uuid, version: pbr.version, color: pbr.color.clone(), emissive: pbr.emissive.clone(), emissiveIntensity: pbr.emissiveIntensity,
      roughness: pbr.roughness, metalness: pbr.metalness, normalScale: pbr.normalScale.clone(), aoMapIntensity: pbr.aoMapIntensity,
      side: pbr.side, opacity: pbr.opacity, transparent: pbr.transparent, depthWrite: pbr.depthWrite, userData: pbr.userData};
    const nodeBefore = {version: node.version, roughness: node.roughness, metalness: node.metalness};
    const line = new LineBasicMaterial(), points = new PointsMaterial(), sprite = new SpriteMaterial({map: textures[0]});
    const expected = [pbr, node, line, points, sprite], events = new Map<Material, number>();
    for (const material of expected) material.addEventListener('dispose', () => { events.set(material, (events.get(material) ?? 0) + 1); });
    const root = new Group(), other = new Group(), hidden = new Group(); hidden.visible = false;
    const multi = new Mesh(geometry, [pbr, node, pbr]);
    root.add(multi, hidden, new Points(geometry, points), new Sprite(sprite)); hidden.add(new Mesh(geometry, node));
    other.add(new Mesh(geometry, pbr), new Line(geometry, line));
    const ignored = new MeshStandardMaterial(), ignoredDispose = vi.spyOn(ignored, 'dispose');
    const nonDrawable = Object.assign(new Object3D(), {material: ignored}); root.add(nonDrawable);

    // Overlapping root references and material arrays must not retire a shared material more than once.
    expect(releaseSurfaceMaterialPrograms([root, other, hidden, multi])).toBe(5);
    expect(expected.map(material => events.get(material))).toEqual([1, 1, 1, 1, 1]);
    expect(ignoredDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
    for (let i = 0; i < textures.length; i++) { expect(textureDisposals[i]).not.toHaveBeenCalled(); expect(textures[i].image).toBe(images[i]); }
    expect([pbr.map, pbr.normalMap, pbr.roughnessMap, pbr.metalnessMap, pbr.aoMap, pbr.envMap]).toEqual(textures);
    expect({uuid: pbr.uuid, version: pbr.version, color: pbr.color, emissive: pbr.emissive, emissiveIntensity: pbr.emissiveIntensity,
      roughness: pbr.roughness, metalness: pbr.metalness, normalScale: pbr.normalScale, aoMapIntensity: pbr.aoMapIntensity,
      side: pbr.side, opacity: pbr.opacity, transparent: pbr.transparent, depthWrite: pbr.depthWrite, userData: pbr.userData}).toEqual(pbrBefore);
    expect(pbr.userData).toBe(pbrBefore.userData);
    expect({version: node.version, roughness: node.roughness, metalness: node.metalness}).toEqual(nodeBefore);
    expect(node.map).toBe(textures[0]); expect(node.normalMap).toBe(textures[1]); expect(node.roughnessMap).toBe(textures[2]);
    expect(node.colorNode).toBe(nodeRefs.color); expect(node.positionNode).toBe(nodeRefs.position); expect(node.outputNode).toBe(nodeRefs.output);
    expect(node.setupDiffuseColor).toBe(nodeRefs.setup); expect(node.onBeforeCompile).toBe(nodeRefs.beforeCompile); expect(node.customProgramCacheKey).toBe(nodeRefs.cacheKey);
    expect(nodeHookKeys(node)).toEqual(['existing-surface-hook']); expect(keepColor).toHaveBeenCalledTimes(1);
    applyNodeHooks(node); expect(keepColor).toHaveBeenCalledTimes(2); expect(node.colorNode).toBe(nodeRefs.color);
    // The same material objects remain attachable to a future scene and keep their exact asset references.
    const next = new Mesh(geometry, pbr); expect(next.material).toBe(pbr); expect(next.material.map).toBe(textures[0]);

    geometry.dispose(); for (const texture of textures) texture.dispose();
  });

  it('returns zero for absent drawables and does not treat a group material field as renderable', () => {
    const material = new MeshStandardMaterial(), disposed = vi.spyOn(material, 'dispose');
    const group = Object.assign(new Group(), {material});
    expect(releaseSurfaceMaterialPrograms([])).toBe(0);
    expect(releaseSurfaceMaterialPrograms([group])).toBe(0);
    expect(disposed).not.toHaveBeenCalled();
  });
});
