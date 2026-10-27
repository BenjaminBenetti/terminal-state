#!/usr/bin/env node
// Depth (z) histogram of a source GLB after +Z-facing nominal placement - used to find strap/loop
// geometry trailing behind rigid items (masks) before trimming.  node qa/depth-histogram.mjs <glb> [facing=-1]
import {loadSource} from '../lib/source.mjs';
import {bounds} from '../lib/mesh.mjs';
const [file, facingArg] = process.argv.slice(2);
const m = await loadSource({id: 'h', file});
const b = bounds(m.pos), H = b.max[1] - b.min[1], sg = (+(facingArg ?? -1)) < 0 ? -1 : 1;
const zs = []; for (let i = 0; i < m.pos.length; i += 3) zs.push(sg * (m.pos[i + 2] - (b.min[2] + b.max[2]) / 2) / H);
let lo = Infinity, hi = -Infinity; for (const z of zs) { if (z < lo) lo = z; if (z > hi) hi = z; }
const nb = 30, hist = new Array(nb).fill(0);
for (const z of zs) hist[Math.min(nb - 1, Math.floor((z - lo) / (hi - lo) * nb))]++;
hist.forEach((c, k) => console.log((lo + (k + 0.5) * (hi - lo) / nb).toFixed(3), String(c).padStart(7), '#'.repeat(Math.round(60 * c / Math.max(...hist)))));
