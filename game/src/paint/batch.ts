import * as THREE from 'three';
import {CAN_IDS, INK} from '../items/sprayPaint';
import {BRUSH, type Dab} from './record';

const vertices = 1 + 2 * BRUSH.sides;
const pigment = CAN_IDS.map(id => new THREE.Color(INK[id]));
// One draw per visible owner. A solid core and a feathered rim share the actual sampled surface.
export class PaintBatch {
  readonly mesh: THREE.Mesh;
  private capacity = 0;
  private drawn = 0;
  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'spray-paint';
    this.mesh.renderOrder = 2;
  }
  sync(dabs: Dab[]): void {
    if (dabs.length === this.drawn) return;
    const geometry = this.mesh.geometry;
    if (dabs.length > this.capacity) {
      this.capacity = 2 ** Math.ceil(Math.log2(dabs.length));
      geometry.dispose();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity*vertices*3),3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.capacity*vertices*3),3).setUsage(THREE.DynamicDrawUsage));
      geometry.boundingBox = new THREE.Box3();
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.capacity*vertices*4),4).setUsage(THREE.DynamicDrawUsage));
      const indices = [];
      for (let d=0; d<this.capacity; d++) {
        const c = d*vertices;
        for (let k=0; k<BRUSH.sides; k++) {
          const a=c+1+k, b=c+1+(k+1)%BRUSH.sides;
          indices.push(c,a,b, a,a+BRUSH.sides,b, b,a+BRUSH.sides,b+BRUSH.sides);
        }
      }
      geometry.setIndex(indices);
      this.drawn = 0;
    }
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute, color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const first = this.drawn*vertices;
    const normal = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (; this.drawn<dabs.length; this.drawn++) {
      const d = dabs[this.drawn], c = pigment[d[0]], base = this.drawn*vertices;
      normal.set(0,0,0);
      for (let k=0; k<BRUSH.sides; k++) {
        a.fromArray(d,4+3*k); b.fromArray(d,4+3*((k+1)%BRUSH.sides));
        normal.add(a.cross(b));
      }
      normal.normalize();
      for (let j=0; j<vertices; j++) {
        const outer = j > BRUSH.sides, f = j === 0 ? 0 : outer ? 1 : .68;
        const k = 4 + 3*((Math.max(j-1,0))%BRUSH.sides);
        pos.setXYZ(base+j,(d[1]+f*d[k])/1000,(d[2]+f*d[k+1])/1000,(d[3]+f*d[k+2])/1000);
        normals.setXYZ(base+j,normal.x,normal.y,normal.z);
        geometry.boundingBox!.expandByPoint(a.fromBufferAttribute(pos,base+j));
        color.setXYZW(base+j,c.r,c.g,c.b,outer ? 0 : .96);
      }
    }
    const n = this.drawn*vertices-first;
    for (const a of [pos,normals,color]) { a.addUpdateRange(first*a.itemSize,n*a.itemSize); a.needsUpdate=true; }
    geometry.setDrawRange(0,this.drawn*BRUSH.sides*9);
    // Only live positions, excluding reserved capacity.
    geometry.boundingSphere ??= new THREE.Sphere();
    geometry.boundingBox!.getBoundingSphere(geometry.boundingSphere);
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); }
}
