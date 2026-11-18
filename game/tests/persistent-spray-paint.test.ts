import {Grid, FLOOR} from '../src/gen/grid';
import {singleLevel} from '../src/gen/levels';
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {generateMarketLevel} from '../src/gen/market/index';
import {fitPaintShop, placePaintFinds} from '../src/gen/paintSupplies';
import {MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import {PaintRecord, BRUSH, validPaint, PAINT_PARTICIPANT} from '../src/paint/record';
import {surfaceDab, SprayPaint} from '../src/paint/spray';
import {CAN_FILL, CAN_IDS, INK, isSprayCan} from '../src/items/sprayPaint';
import {Inventory, stackToJSON} from '../src/items/inventory';
import {MarketStock} from '../src/market/trade/stock';
import {buy, sell} from '../src/market/trade/transactions';
import {stackFromRecord, stackRecord} from '../src/run/worldMemory';
import {SaveSlots} from '../src/save/slots';
import {validateSaveFile} from '../src/save/validate';
import {restoreRun} from '../src/save/serialize';
import {restoreParticipants} from '../src/run/snapshot';
import {FakeStorage, Harness} from './helpers/saveFixture';

const mark = (x:number) => [0,x,0,0,...Array(24).fill(2)];
const hostRecord = (h:Harness) => {
  const p=new PaintRecord();
  h.participants.push({id:PAINT_PARTICIPANT,save:()=>p.save(),load:v=>p.load(v),reset:()=>p.reset()});
  return p;
};

describe('finite paint and campaign ownership',()=>{
  it('spends fill on a held trigger, including a miss, and stops on the last unit',()=>{
    const inv=new Inventory(), can=inv.makeStack('spray_blue',1), scene=new THREE.Scene();
    can.paint=2;inv.set({bar:'hotbar',index:0},can);
    const s=new SprayPaint({inv,scene,camera:new THREE.PerspectiveCamera(),runParticipants:[],sectionHooks:[]} as never);
    Object.assign(s,{section:'station:s1:main',hit:()=>undefined});
    s.tick(.1,false);expect(can.paint).toBe(2);
    s.tick(.1,true);s.tick(.01,true);expect(can.paint).toBe(1);
    s.tick(.1,true);s.tick(10,true);expect(can.paint).toBe(0);
    expect(s.record.count).toBe(0);
  });
  it('hits the nearest surface within reach and follows a rotating prop onto a different station and back',()=>{
    const inv = new Inventory(), can = inv.makeStack('spray_green',1);
    inv.set({bar:'hotbar',index:0},can);
    const grid = new Grid(24,24); grid.cells.fill(FLOOR);grid.ceil.fill(10);
    const scene = new THREE.Scene(), group = new THREE.Group(), camera = new THREE.PerspectiveCamera();
    camera.position.set(4,1.2,4);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(3,2),new THREE.MeshBasicMaterial());
    wall.position.set(4,1,2); wall.userData.paintSurface=true;
    const bin = new THREE.InstancedMesh(new THREE.BoxGeometry(.6,.7,.5),new THREE.MeshBasicMaterial(),1);
    group.add(wall,bin);scene.add(group);
    const prop = {x:4,y:.85,z:3,rot:0,hx:.3,hz:.25,h:.7,kind:'bin',level:0,area:0,cargoGone:false};
    const matrix = new THREE.Matrix4().makeTranslation(4,1.2,3);
    bin.setMatrixAt(0,matrix);group.updateMatrixWorld(true);
    const scope = {station:'st-01',section:'main',level:'subway'};
    const hooks: {build():void;teardown():void}[]=[];
    const layout = {props:[prop],trench:{floorY:-2}};
    const body = new THREE.Matrix4();
    const dynamicItems = {restHeight:()=>.7, propMatrix:(_p:typeof prop,out:THREE.Matrix4)=>{
      if (prop.h>0) return false;
      out.copy(body); return true;
    }};
    const parts = new Map<typeof prop,{parts:{mesh:THREE.Mesh;created:boolean;moving:boolean}[]}>();
    const g = {scene,world:{group},camera,inv,levels:singleLevel(grid),layout,run:{current:scope},
      sectionHooks:hooks,runParticipants:[],trainRuntime:{view:null},
      trainPropCargo:{idOf:()=> 'st-01:main#8',riding:[]},fuelCarts:{bodies:()=>[]},
      damage:{props:{index:{inst:new Map([[prop,[{mesh:bin,index:0}]]])},states:parts}},
      physics:{dynamicItems},zombies:[],pickups:{list:[]}};
    const spray=new SprayPaint(g as never);hooks[0].build();spray.tick(.1,true);
    expect([...spray.record.targets.keys()]).toEqual(['prop/st-01:main#8']);
    const mark=spray.record.save();
    prop.x=5.5;prop.rot=Math.PI/2;
    bin.setMatrixAt(0,matrix.makeRotationY(prop.rot).setPosition(prop.x,1.2,3));
    spray.tick(.1,false);
    expect(spray.batches.get('prop/st-01:main#8')!.mesh.matrix.elements[12]).toBe(5.5);
    // The visible wall now receives paint. A nearer unsupported pane prevents any more paint beyond it.
    spray.tick(.1,true);expect(spray.record.targets.has('station/st-01:main')).toBe(true);
    const blocker=wall.clone();blocker.userData={};blocker.position.z=3.2;group.add(blocker);group.updateMatrixWorld(true);
    const n=spray.record.count;camera.position.x+=.12;spray.tick(.1,true);
    expect(spray.record.count).toBe(n);
    blocker.removeFromParent();camera.position.z=5;spray.tick(.1,true);expect(spray.record.count).toBe(n);
    hooks[0].teardown();expect(spray.batches.size).toBe(0);
    scope.station='st-02';hooks[0].build();
    expect([...spray.batches.keys()]).toEqual(['prop/st-01:main#8']);
    expect(spray.record.save()[0]).toEqual(mark[0]);
    hooks[0].teardown();scope.station='st-01';hooks[0].build();
    expect(spray.batches.has('station/st-01:main')).toBe(true);
    // DynamicItems clears the static collider as it detaches the real parts, and can lift and tilt them far above their source.
    prop.h=0;bin.setMatrixAt(0,new THREE.Matrix4().makeScale(0,0,0));
    body.makeRotationZ(.32).setPosition(4,6,3);
    const detached = new THREE.Mesh(bin.geometry,bin.material);
    detached.matrixAutoUpdate=false;detached.matrix.copy(body).multiply(new THREE.Matrix4().makeTranslation(0,.35,0));
    detached.matrixWorldNeedsUpdate=true;scene.add(detached);parts.set(prop,{parts:[{mesh:detached,created:true,moving:true}]});
    camera.position.set(4,6.35,4);
    spray.tick(.1,true);
    const batch=spray.batches.get('prop/st-01:main#8')!;
    expect(batch.mesh.visible).toBe(true);expect(batch.mesh.matrix.equals(body)).toBe(true);
    expect(spray.record.targets.get('prop/st-01:main#8')).toHaveLength(2);
    expect(spray.record.targets.get('prop/st-01:main#8')![0]).toEqual(mark[0][1][0]);
    // Arrival builds with the parked prop hidden behind its riding copy. The cargo system then
    // releases the same placement without rebuilding the station or allocating another identity.
    hooks[0].teardown();scope.station='st-02';prop.cargoGone=true;hooks[0].build();
    expect(spray.batches.has('prop/st-01:main#8')).toBe(false);
    prop.cargoGone=false;spray.sync();
    expect(spray.batches.get('prop/st-01:main#8')!.mesh.matrix.equals(body)).toBe(true);
  });
  it('retains the same can through payment, resale, empty stock, chest, loose pickups and cargo',()=>{
    const inv=new Inventory(), make=(id:string,n:number)=>inv.makeStack(id,n);
    const base=MarketStock.seed('station',101,make,MARKET_STALLS_ALL), old=base.toJSON();
    const stock=MarketStock.fromJSON(old);
    expect(stock.stockPaint(make,['paint'])).toBe(true);
    for(const s of MARKET_STALLS_ALL) expect(stock.stalls[s]).toEqual(base.stalls[s]);
    expect(stock.stalls.paint.map(s=>s.itemId)).toEqual(CAN_IDS);
    const can=stock.stalls.paint[0], uid=can.uid, ctx={inv,stock,stall:'paint' as const};
    expect(buy(ctx,0).ok).toBe(false);
    inv.add(make('rail_ties',100));expect(buy(ctx,0).ok).toBe(true);
    expect(inv.get(inv.find(uid)!)).toBe(can);
    can.paint=48;
    expect(sell(ctx, inv.find(uid)!).ok).toBe(true);
    expect(buy(ctx,stock.stalls.paint.findIndex(s=>s.uid===uid)).ok).toBe(true);
    expect(inv.get(inv.find(uid)!)).toEqual(can);
    while(stock.stalls.paint.length) expect(buy(ctx,0).ok).toBe(true);
    const empty=MarketStock.fromJSON(stock.toJSON());
    expect(empty.stockPaint(make,['paint'])).toBe(false);expect(empty.stalls.paint).toEqual([]);
    const h=new Harness();h.inv=inv;
    inv.storeQuick(h.train.lockbox.slots,inv.find(uid)!);
    expect(h.train.lockbox.slots[0]).toBe(can);
    inv.storeQuick(h.train.lockbox.slots,{bar:'store',index:0});
    const dropped=inv.detach(inv.find(uid)!)!;
    expect(stackFromRecord(inv,stackRecord(dropped))).toEqual(can);
    can.paint=0;
    h.train.cargo.add({kind:'item',stack:stackToJSON(can)!,x:0,y:0,z:0,q:[0,0,0,1]});
    const file=h.file();expect(validateSaveFile(file).ok).toBe(true);
    const restored=new Harness();restoreRun(file.run,restored.target());
    expect(restored.train.cargo.records()[0].stack).toMatchObject({uid,paint:0});
  });
  it('round trips the live and Retry layers independently through slot export/import and restore',async()=>{
    const h=new Harness(), r=hostRecord(h), can=h.inv.makeStack('spray_orange',1);
    h.inv.add(can);
    // Use the actual section key and canonical generated prop identity.
    r.add('train',mark(40));const station='station/'+h.run.current.station+':main';
    r.add(station,mark(6000));r.add('prop/'+h.run.current.station+':main#10',mark(0));
    can.paint=84;h.takeEntry();can.paint=19;r.add('train',mark(70));
    const slots=new SaveSlots({storage:new FakeStorage()});
    const file=h.file('manual');
    expect(slots.commit(1,file).ok).toBe(true);
    const exp=slots.exportFile(1);expect(exp.ok).toBe(true);if(!exp.ok)throw Error(exp.error);
    expect((await slots.importFile(2,exp.text)).ok).toBe(true);
    const read=slots.read(2);if(!read.ok)throw Error(read.error);
    const out=new Harness(), other=hostRecord(out);restoreRun(read.file.run,out.target());
    expect(other.save()).toEqual(r.save());expect(out.inv.get(out.inv.find(can.uid)!)?.paint).toBe(19);
    const snap=out.run.entry!;restoreParticipants(snap,out.participants);
    expect(other.targets.get('train')).toEqual([mark(40)]);expect(snap.inventory.get(snap.inventory.find(can.uid)!)?.paint).toBe(84);
  });
  it('keeps old marks intact at capacity and rejects malformed imported geometry',()=>{
    const p=new PaintRecord();
    for(let i=0;i<BRUSH.marks;i++)expect(p.add('train',mark(i*11))).toBe('added');
    const full=p.save();expect(validPaint(full)).toBe(true);
    expect(p.add('train',mark(-300))).toBe('full');expect(p.save()).toEqual(full);
    full[0][1][0][4]=999;expect(validPaint(full)).toBe(false);
  });
  it('projects only onto the struck surface, encoding a moving target in its own frame',()=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(.12,1),new THREE.MeshBasicMaterial());
    m.position.set(5,2,1);m.rotation.y=.7;m.updateMatrixWorld();
    const centre=m.localToWorld(new THREE.Vector3(.051,0,0)),n=new THREE.Vector3(0,0,1).transformDirection(m.matrixWorld);
    const ray=new THREE.Raycaster(centre.clone().add(n),n.clone().negate(),0,BRUSH.range);
    const dab=surfaceDab(ray.intersectObject(m)[0],m.matrixWorld,m.matrixWorld,'spray_blue',ray.ray.direction);
    expect(dab.slice(0,4)).toEqual([3,51,0,2]);
    for(let k=4;k<dab.length;k+=3)expect(dab[1]+dab[k]).toBeLessThanOrEqual(60);
    m.position.x+=2;m.updateMatrixWorld();
    expect(new THREE.Vector3(dab[1]/1000,0,.002).applyMatrix4(m.matrixWorld).x-centre.x).toBeCloseTo(2,2);
  });
});

describe('paint stock and assets',()=>{
  it.each([1,2,3,4,5,6,7])('adds only a sign and sales point to an already generated v%i Market',v=>{
    const layout=generateMarketLevel({levelSeed:99,layoutVersion:v});
    const before=JSON.stringify([layout.props,layout.market?.stalls,layout.market?.spots,layout.pickups]);
    const signs=layout.signs.length;fitPaintShop(layout);fitPaintShop(layout);placePaintFinds(layout);
    expect(layout.market?.paintShop?.id).toBe('paint');
    expect(layout.signs.length).toBe(signs+1);
    expect(JSON.stringify([layout.props,layout.market?.stalls,layout.market?.spots,layout.pickups])).toBe(before);
  });
  it('finds one can deterministically on clear furniture and loads one shared, self-contained mesh',()=>{
    const l={seed:4,props:[{kind:'crate',x:4,y:0,z:2,h:1,area:0}],pickups:[]} as never;
    placePaintFinds(l);placePaintFinds(l);
    const items=(l as {pickups:{itemId:string;y:number}[]}).pickups;
    expect(items).toHaveLength(1);expect(isSprayCan(items[0].itemId)).toBe(true);expect(items[0].y).toBe(1);
    const b=readFileSync(new URL('../public/assets/models/spray-can.glb',import.meta.url)),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
    expect(b.length).toBeLessThan(32000);expect(j.meshes).toHaveLength(1);
    expect(j.materials.map((m:{name:string})=>m.name)).toEqual(['Enamel','Rolled steel']);
    expect(j.buffers[0].uri).toBeUndefined();expect(new Set(Object.values(INK)).size).toBe(7);
    expect(new Inventory().makeStack(CAN_IDS[0],9)).toMatchObject({count:1,paint:CAN_FILL});
  });
});
