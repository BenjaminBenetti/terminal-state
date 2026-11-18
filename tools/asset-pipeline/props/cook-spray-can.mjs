// node tools/asset-pipeline/props/cook-spray-can.mjs /private/path/to/master.glb output.glb
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {MeshoptSimplifier} from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

const input = fs.readFileSync(process.argv[2]);
if (createHash('sha256').update(input).digest('hex') !== '002d9b64225000605a66cad95c4ba2b9e1a842d105fffbb30a265578ac9e1f55') throw Error('Unexpected master');
const headerSize = input.readUInt32LE(12);
const source = JSON.parse(input.subarray(20, 20 + headerSize));
function attribute(index, Type, stride) {
  const a = source.accessors[index], v = source.bufferViews[a.bufferView];
  return new Type(input.buffer, input.byteOffset + 28 + headerSize + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * stride);
}
const prim = source.meshes[0].primitives[0];
const pos = attribute(prim.attributes.POSITION, Float32Array, 3);
const normal = attribute(prim.attributes.NORMAL, Float32Array, 3);
await MeshoptSimplifier.ready;
const weld = MeshoptSimplifier.generatePositionRemap(pos, 3);
const original = attribute(prim.indices, Uint32Array, 1);
const [tri] = MeshoptSimplifier.simplifySloppy(original.map(i => weld[i]), pos, 3, null, 1800 * 3, 1);
const [remap, count] = MeshoptSimplifier.compactMesh(tri);
const p = new Float32Array(count * 3), n = new Float32Array(count * 3);
for (let i = 0; i < remap.length; i++) {
  const j = remap[i];
  if (j >= count) continue;
  p.set([pos[i*3]*0.11, (pos[i*3+1]+1.00026)*0.11, pos[i*3+2]*0.11], j*3);
  n.set(normal.subarray(i*3,i*3+3), j*3);
}
// Enamel body, rolled steel rims and shoulder. Use one shared position/normal stream for both finishes.
const enamel = [], steel = [];
for (let t = 0; t < tri.length; t += 3) {
  const a = tri[t], b = tri[t+1], c = tri[t+2];
  const y = (p[a*3+1]+p[b*3+1]+p[c*3+1])/3;
  (y < .005 || (y > .173 && y < .199) ? steel : enamel).push(a,b,c);
}
const min = [], max = [];
for (let axis=0; axis<3; axis++) {
  const values=p.filter((_,i)=>i%3===axis);
  min.push(Math.min(...values)); max.push(Math.max(...values));
}
const arrays = [p,n,new Uint16Array(enamel),new Uint16Array(steel)];
let size=0;
const views=arrays.map(a=>{const byteOffset=size; size+=Math.ceil(a.byteLength/4)*4; return {buffer:0,byteOffset,byteLength:a.byteLength};});
const bin=Buffer.alloc(size);
arrays.forEach((a,i)=>Buffer.from(a.buffer).copy(bin,views[i].byteOffset));
const data={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[0,1].map(i=>({attributes:{POSITION:0,NORMAL:1},indices:2+i,material:i}))}],
  materials:[{name:'Enamel',pbrMetallicRoughness:{roughnessFactor:.4,metallicFactor:.16}},{name:'Rolled steel',pbrMetallicRoughness:{baseColorFactor:[.55,.57,.6,1],metallicFactor:.72,roughnessFactor:.32}}],
  accessors:[{bufferView:0,componentType:5126,type:'VEC3',count,min,max},{bufferView:1,componentType:5126,type:'VEC3',count},...[enamel,steel].map((a,i)=>({bufferView:2+i,componentType:5123,type:'SCALAR',count:a.length}))],bufferViews:views,buffers:[{byteLength:size}]};
const json=Buffer.from(JSON.stringify(data)), padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);
json.copy(padded);
const h=Buffer.alloc(20), bh=Buffer.alloc(8);
h.write('glTF'); h.writeUInt32LE(2,4); h.writeUInt32LE(28+padded.length+size,8); h.writeUInt32LE(padded.length,12); h.write('JSON',16);
bh.writeUInt32LE(size); bh.write('BIN\0',4);
fs.writeFileSync(process.argv[3],Buffer.concat([h,padded,bh,bin]));
console.log({triangles:tri.length/3,vertices:count,min,max,bytes:28+padded.length+size});
