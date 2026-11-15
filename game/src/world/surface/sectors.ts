/** The expedition's decorative meshes are bounded, independent sectors. Gameplay state is never owned by visibility. */
import * as THREE from 'three';
import {fogCullDistance} from '../levelCulling';

export interface SurfaceSector {id: string; root: THREE.Group; box: THREE.Box3}

export class SurfaceSectors {
  readonly sectors: SurfaceSector[] = [];
  readonly stats = {total: 0, visible: 0, candidates: 0, updates: 0, inactive: true};
  private readonly frustum = new THREE.Frustum();
  private readonly vp = new THREE.Matrix4();
  private readonly shadowFrustum = new THREE.Frustum();
  private readonly shadowVp = new THREE.Matrix4();
  private readonly eye = new THREE.Vector3();

  add(id: string, root: THREE.Group): void {
    root.updateMatrixWorld(true);
    this.sectors.push({id, root, box: new THREE.Box3().setFromObject(root)});
    this.stats.total = this.sectors.length;
  }

  /** Same fog transmittance limit as the existing world culler. Near sectors stay for torch shadows outside the view. */
  update(camera: THREE.Camera, density: number, active: boolean, shadow?: THREE.Camera | null): void {
    this.stats.inactive = !active;
    this.stats.visible = this.stats.candidates = 0;
    if (!active) { for (const s of this.sectors) s.root.visible = false; return; }
    this.stats.updates++;
    camera.updateWorldMatrix(true, false);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.vp, camera.coordinateSystem);
    if (shadow) {
      shadow.updateWorldMatrix(true, false);
      this.shadowVp.multiplyMatrices(shadow.projectionMatrix, shadow.matrixWorldInverse);
      this.shadowFrustum.setFromProjectionMatrix(this.shadowVp, shadow.coordinateSystem);
    }
    const distance = fogCullDistance(density);
    for (const s of this.sectors) {
      const d = s.box.distanceToPoint(this.eye);
      const inFog = d <= distance;
      if (inFog) this.stats.candidates++;
      s.root.visible = inFog && (d < 12 || this.frustum.intersectsBox(s.box) || !!shadow && this.shadowFrustum.intersectsBox(s.box));
      if (s.root.visible) this.stats.visible++;
    }
  }

  clear(): void {
    this.sectors.length = 0;
    this.stats.total = this.stats.visible = this.stats.candidates = 0;
    this.stats.inactive = true;
  }
}
