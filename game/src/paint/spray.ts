import * as THREE from 'three';
import type {Game} from '../game';
import {CAN_IDS, INK, isSprayCan, paintLeft, type CanId} from '../items/sprayPaint';
import {sectionId} from '../levels/types';
import type {PropPlacement} from '../gen/props';
import {raycastWorld} from '../combat/hitscan';
import {PaintBatch} from './batch';
import {BRUSH, PaintRecord, PAINT_PARTICIPANT, type Dab} from './record';

type Owner = {key: string; frame: THREE.Matrix4};
const identity = new THREE.Matrix4(), up = new THREE.Vector3(0,1,0);
const origin = new THREE.Vector3(), direction = new THREE.Vector3(), transform = new THREE.Matrix4();
const probe = new THREE.Mesh(), normMat = new THREE.Matrix3();
const idleGeometry = probe.geometry, idleMaterial = probe.material;
const rounds = (v: THREE.Vector3) => v.toArray().map(n => Math.round(n*1000));

/** Fit each rim vertex back to the impacted mesh. An edge or a hole clips that sector of the footprint. */
export function surfaceDab(hit: THREE.Intersection, matrix: THREE.Matrix4, frame: THREE.Matrix4, ink: CanId, incoming: THREE.Vector3): Dab {
  const normal = hit.face!.normal.clone().applyNormalMatrix(normMat.getNormalMatrix(matrix));
  if (normal.dot(incoming)>0) normal.negate();
  const x = new THREE.Vector3().crossVectors(Math.abs(normal.y)>.9 ? new THREE.Vector3(1,0,0) : up, normal).normalize();
  const y = new THREE.Vector3().crossVectors(normal,x);
  const inv = frame.clone().invert(), centre = hit.point.clone().addScaledVector(normal,.0018).applyMatrix4(inv);
  const dab = [CAN_IDS.indexOf(ink), ...rounds(centre)], ray = new THREE.Raycaster();
  ray.far = .037;
  probe.geometry = (hit.object as THREE.Mesh).geometry;
  probe.material = (hit.object as THREE.Mesh).material;
  probe.matrixWorld.copy(matrix);
  for (let k=0; k<BRUSH.sides; k++) {
    const a = 2*Math.PI*k/BRUSH.sides, radial = x.clone().multiplyScalar(Math.cos(a)).addScaledVector(y,Math.sin(a));
    let offset = new THREE.Vector3();
    for (const fraction of [1,.5]) {
      ray.set(hit.point.clone().addScaledVector(normal,.018).addScaledVector(radial,BRUSH.radius*fraction),normal.clone().negate());
      const samples: THREE.Intersection[] = [];
      probe.raycast(ray,samples);
      const sample = samples.sort((a,b)=>a.distance-b.distance)[0];
      if (!sample?.face) continue;
      const n = sample.face.normal.clone().applyNormalMatrix(normMat.getNormalMatrix(matrix));
      if (Math.abs(n.dot(normal)) < .72) continue;
      offset = sample.point.clone().addScaledVector(normal,.0018).applyMatrix4(inv).sub(centre);
      break;
    }
    dab.push(...rounds(offset));
  }
  return dab;
}

export class SprayPaint {
  readonly record = new PaintRecord();
  readonly batches = new Map<string,PaintBatch>();
  private readonly material = new THREE.MeshStandardMaterial({vertexColors:true, transparent:true, depthWrite:false, roughness:.86, metalness:.02,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1});
  private readonly props = new Map<string,PropPlacement>();
  private readonly indexed = new Set<THREE.Object3D>();
  private readonly ray = new THREE.Raycaster();
  private cooldown = 0;
  private section = '';
  private shownFull = false;
  private readonly plume: THREE.Points;
  private mistTime = 0;

  constructor(private readonly g: Game) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18*3),3).setUsage(THREE.DynamicDrawUsage));
    this.plume = new THREE.Points(geo,new THREE.PointsMaterial({size:.011,transparent:true,opacity:.62,depthWrite:false}));
    this.plume.visible = false; this.plume.frustumCulled=false;
    g.scene.add(this.plume);
    g.runParticipants.push({id:PAINT_PARTICIPANT,save:()=>this.record.save(),
      load:v=>{this.clear();this.record.load(v);},reset:()=>{this.clear();this.record.reset();}});
    g.sectionHooks.push({build:()=>this.build(), teardown:()=>this.clear()});
  }
  private build(): void {
    this.clear();
    this.section='station/'+sectionId(this.g.run.current);
    for (const p of this.g.layout.props) {
      if (p.cargoGone) continue;
      const id=this.g.trainPropCargo.idOf(p);
      if (id) this.props.set('prop/'+id,p);
    }
    for (const entries of this.g.damage.props.index.inst.values()) for (const e of entries) this.indexed.add(e.mesh);
    this.sync();
  }
  private clear(): void {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear(); this.props.clear(); this.indexed.clear(); this.section='';
    probe.geometry=idleGeometry; probe.material=idleMaterial;
    this.cooldown=0; this.shownFull=false; this.mistTime=0; this.plume.visible=false;
  }
  private frame(key: string): THREE.Matrix4 | undefined {
    const g = this.g, v = g.trainRuntime.view;
    if (key===this.section) return identity;
    let o: THREE.Object3D | undefined | null;
    if (key==='train') o=v?.root;
    else if (key.startsWith('door/')) { const [,i,k]=key.split('/'); o=v?.leaves[+i]?.[+k]; }
    else if (key.startsWith('cart/')) o=g.fuelCarts.viewOf(key.slice(5));
    else if (key.startsWith('prop/')) {
      const p=this.props.get(key);
      if (p && !p.cargoGone && p.h>0 && !g.damage.props.states.get(p)?.broken) {
        if (!g.physics.dynamicItems.propMatrix(p,transform)) transform.makeRotationY(p.rot).setPosition(p.x,p.y,p.z);
        return transform;
      }
      const ride=g.trainPropCargo.riding.find(r=>r.rec.id===key.slice(5));
      if (ride?.obj && v) {
        const r=ride.rec;
        v.root.updateWorldMatrix(true,false);
        return transform.compose(new THREE.Vector3(r.x,r.y,r.z),new THREE.Quaternion(...r.q),new THREE.Vector3(1,1,1)).premultiply(v.root.matrixWorld);
      }
    }
    if (!o?.parent) return;
    o.updateWorldMatrix(true,false); return o.matrixWorld;
  }
  sync(): void {
    for (const [key,dabs] of this.record.targets) {
      const frame=this.frame(key);
      let batch=this.batches.get(key);
      if (!frame) { if (batch) batch.mesh.visible=false; continue; }
      if (!batch) {batch=new PaintBatch(this.material);this.batches.set(key,batch);this.g.scene.add(batch.mesh);}
      batch.mesh.visible = true;
      if (!batch.mesh.matrix.equals(frame)) {
        batch.mesh.matrix.copy(frame);
        batch.mesh.matrixWorldNeedsUpdate = true;
      }
      batch.sync(dabs);
    }
  }
  private hit(): {hit:THREE.Intersection; matrix:THREE.Matrix4; owner:Owner|null} | undefined {
    const g = this.g, ray = this.ray;
    ray.set(origin, direction);
    ray.far = BRUSH.range;
    let closest: {hit:THREE.Intersection; matrix:THREE.Matrix4; owner:Owner|null} | undefined;
    function test(mesh: THREE.Mesh, key: string | null, instance?: THREE.Matrix4) {
      if (!mesh.isMesh || !mesh.visible || !mesh.material || (mesh.material as THREE.Material).visible === false) return;
      const hits: THREE.Intersection[] = [];
      if (instance) {
        probe.geometry = mesh.geometry;
        probe.material = mesh.material;
        probe.matrixWorld.copy(instance);
        probe.raycast(ray, hits);
      } else {
        mesh.raycast(ray, hits);
      }
      for (const hit of hits) {
        if (!hit.face || hit.distance >= ray.far) continue;
        const matrix = (instance ?? mesh.matrixWorld).clone();
        if (hit.instanceId !== undefined) {
          const local = new THREE.Matrix4();
          (mesh as THREE.InstancedMesh).getMatrixAt(hit.instanceId, local);
          matrix.multiply(local);
        }
        hit.object = mesh;
        ray.far = hit.distance;
        closest = {hit, matrix, owner: key ? {key, frame: identity} : null};
      }
    }
    // Structural meshes are chunked by the builder. For shared prop pools, only raycast the instances near the nozzle.
    g.world.group.traverseVisible(mesh => {
      if (!this.indexed.has(mesh)) test(mesh as THREE.Mesh, mesh.userData.paintSurface ? this.section : null);
    });
    for (const [key, p] of this.props) {
      if (p.cargoGone || Math.abs(p.x - origin.x) > BRUSH.range + p.hx || Math.abs(p.z - origin.z) > BRUSH.range + p.hz
        || origin.y < p.y - BRUSH.range || origin.y > p.y + p.h + BRUSH.range) continue;
      const state = g.damage.props.states.get(p);
      for (const entry of g.damage.props.index.inst.get(p) ?? []) {
        const matrix = new THREE.Matrix4();
        entry.mesh.getMatrixAt(entry.index, matrix);
        if (matrix.determinant() === 0) continue;
        test(entry.mesh, state?.broken ? null : key, matrix.premultiply(entry.mesh.matrixWorld));
      }
      for (const part of state?.parts ?? []) {
        if (part.mesh.parent) test(part.mesh, part.moving || state?.broken ? null : key);
      }
    }

    const roots = new Map<THREE.Object3D, string>();
    const train = g.trainRuntime.view;
    if (train) {
      roots.set(train.fixed, 'train');
      if (g.trainArmor?.group) roots.set(g.trainArmor.group, 'train');
      train.leaves.forEach((pair, i) => pair.forEach((leaf, k) => roots.set(leaf, `door/${i}/${k}`)));
    }
    const carts: THREE.Object3D[] = [];
    for (const cart of g.fuelCarts.bodies()) {
      const root = g.fuelCarts.viewOf(cart.uid);
      if (root) {
        roots.set(root, 'cart/' + cart.uid);
        if (cart.mode !== 'cargo') carts.push(root);
      }
    }
    function walk(object: THREE.Object3D, inherited: string | null = null): void {
      if (!object.visible) return;
      const key = roots.get(object) ?? inherited;
      test(object as THREE.Mesh, key);
      for (const child of object.children) walk(child, key);
    }
    if (train) walk(train.root);
    for (const cart of carts) walk(cart);
    // Animated container doors, nearby pickups and people occlude paint.
    g.containers?.group.traverseVisible(o => { if (!this.indexed.has(o)) test(o as THREE.Mesh, null); });
    for (const pickup of g.pickups.list) if (pickup.obj.position.distanceToSquared(origin) < 16) walk(pickup.obj);
    for (const actor of [...g.zombies, ...(g.marketPeople?.people ?? [])]) {
      if (actor.root.position.distanceToSquared(origin) < 25) walk(actor.root);
    }
    // Closed doors and invisible collision surfaces also stop the nozzle. The coarse train and struck prop boxes
    // may stand in front of their own rendered skins. Only the nearest real triangle receives a footprint.
    const distance = closest?.hit.distance ?? BRUSH.range;
    const stop = raycastWorld(g.levels, g.layout.props, origin, direction, distance, g.layout.trench.floorY);
    const blocker = stop.prop === undefined ? null : g.layout.props[stop.prop];
    const owner = closest?.owner;
    const hitProxy = blocker && (g.trainRuntime.train?.layoutBoxes.includes(blocker)
      || (owner && this.props.get(owner.key) === blocker));
    if (stop.kind !== 'none' && stop.t + .045 < distance && !hitProxy) {
      const hit = {point: ray.ray.at(stop.t, new THREE.Vector3()), distance: stop.t, object: g.world.group};
      return {hit, matrix: identity, owner: null};
    }
    if (closest && owner) {
      const frame = this.frame(owner.key);
      if (frame) owner.frame = frame.clone();
      else closest.owner = null;
    }
    return closest;
  }
  tick(dt: number, down: boolean): void {
    this.sync();
    this.mistTime -= dt;
    this.plume.visible = this.mistTime > 0 && down;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const g = this.g, can = g.inv.selectedStack();
    if (!this.section || !down || !can || !isSprayCan(can.itemId) || this.cooldown > 1e-6 || !paintLeft(can.paint)) return;

    this.cooldown = BRUSH.interval;
    g.camera.getWorldPosition(origin);
    g.camera.getWorldDirection(direction);
    const result = this.hit();
    if (result?.owner) {
      const dab = surfaceDab(result.hit, result.matrix, result.owner.frame, can.itemId, direction);
      const status = this.record.add(result.owner.key, dab);
      if (status === 'full') {
        if (!this.shownFull) g.hud.toast('Paint limit reached · existing marks kept', true);
        this.shownFull = true;
        return;
      }
      if (status === 'added') this.sync();
    }
    can.paint = paintLeft(can.paint) - 1;
    g.inv.version++;
    const end = result?.hit.point ?? origin.clone().addScaledVector(direction, BRUSH.range);
    const start = new THREE.Vector3(.12, -.08, -.32).applyMatrix4(g.camera.matrixWorld);
    const positions = this.plume.geometry.getAttribute('position') as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      const f = (i + .5) / positions.count, radius = .025 * f;
      point.lerpVectors(start, end, f);
      positions.setXYZ(i, point.x + radius * Math.sin(5*i), point.y + radius * Math.cos(3*i), point.z + radius * Math.sin(2*i));
    }
    positions.needsUpdate = true;
    (this.plume.material as THREE.PointsMaterial).color.setHex(INK[can.itemId]);
    this.plume.visible = true;
    this.mistTime = .085;
  }
}
