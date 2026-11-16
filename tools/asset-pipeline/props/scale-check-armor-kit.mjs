// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO) — prop rule 5 scale check of the found TRAIN ARMOUR KIT
// (craft/equipment.ts kind 'armor-kit') as the runtime composes it: the fuel dolly's hand truck (as authored, at CART_LOOK.truckZ)
// with 2 x 2 train armour plates at KIT_LOOKS.armor (scale 0.45, from the nose plate top, back face 2 mm in front of the uprights),
// beside a runtime-scaled standing zombie, through scale-check.mjs's own loaders / measures / renderer. No new model or texture: both
// models are the cooked ones in game/public/assets/models.
// usage: node tools/asset-pipeline/props/scale-check-armor-kit.mjs <repo root> <out.png>   (writes <out>.json beside the sheet)
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const [wt, out] = process.argv.slice(2);
if (!wt || !out) throw new Error('usage: node scale-check-armor-kit.mjs <repo root> <out.png>');
const sc = await import(pathToFileURL(path.join(wt, 'tools/asset-pipeline/props/scale-check.mjs')).href);
const M = p => path.join(wt, 'game/public/assets/models', p);

// the game's numbers (world/fuelCartModel.ts CART_LOOK, world/trainEquipmentModel.ts KIT_LOOKS), recomputed from the same sources
const drumR = (Math.max(0.6262, 0.6313) / 2) * 0.72, uprightFront = -0.066, plateTop = 0.073;
const drumZt = uprightFront + drumR + 0.004, back = -0.5 / 2, front = drumZt + drumR, zc = (back + front) / 2;
const truckZ = -zc, drumZ = drumZt - zc;
const PLATE = [1.2, 0.9324, 0.1239], S = 0.45, ROWS = 2, LAYERS = 2, GAP = 0.004;
const kBack = drumZ - drumR + 0.002, w = PLATE[0] * S, h = PLATE[1] * S, d = PLATE[2] * S;

const truck = await sc.loadModel(M('p7-hand-truck-t25.glb'));
const plate = await sc.loadModel(M('train-armor-plate.glb'));
console.log('truck fitBox', truck.fitBox);
console.log('plate fitBox', plate.fitBox);
const tris = [];
for (const t of truck.tris) tris.push({...t, p: t.p.map(q => [q[0], q[1], q[2] + truckZ])});
for (let r = 0; r < ROWS; r++) for (let l = 0; l < LAYERS; l++) {
  const oy = plateTop + r * (h + GAP), oz = kBack + l * (d + GAP);
  for (const t of plate.tris) tris.push({...t, name: `plate-${r}-${l}/${t.name}`, p: t.p.map(q => [q[0] * S, q[1] * S + oy, q[2] * S + oz])});
}
const plateOnly = tris.filter(t => t.name.startsWith('plate-'));
const truckOnly = tris.filter(t => !t.name.startsWith('plate-'));
const full = sc.boundsOf(tris), pb = sc.boundsOf(plateOnly), tb = sc.boundsOf(truckOnly);
const contact = sc.contactOf(tris, 0), surf = sc.surfacesOf(tris);
const r3 = v => Math.round(v * 1000) / 1000;
const report = {
  kitLook: {scale: S, rows: ROWS, layers: LAYERS, gap: GAP, plate: [w, h, d].map(r3), back: r3(kBack), truckZ: r3(truckZ), plateTop},
  size: full.size.map(r3), bounds: {min: full.min.map(r3), max: full.max.map(r3)},
  plates: {size: pb.size.map(r3), min: pb.min.map(r3), max: pb.max.map(r3)},
  truck: {size: tb.size.map(r3), min: tb.min.map(r3), max: tb.max.map(r3)},
  contact, surfaces: surf.plateaus, mainSurface: surf.mainSurface, topSurface: surf.topSurface,
  footprint: {radius: 0.36, height: 1.25},
};
const z = await sc.loadZombie('lastshift', 1);
const fmt3 = a => a.map(v => v.toFixed(2)).join('×');
const zobj = {label: `zombie ${z.id}`, lines: [`zombie ${z.id} (reference)`, `${z.heightM.toFixed(2)} m tall · runtime scale ${z.scale.toFixed(2)}`], side: `zombie ${z.id}`,
  body: z.tris, loose: [], full: z.bounds, bb: null, plates: [], contact: null};
const kobj = {label: 'train armour kit', lines: ['train armour kit (hand truck + 2×2 plates ×0.45)', `${fmt3(report.size)} m (W×H×D)`,
  `plates ${fmt3(report.plates.size)} · ${contact.state} · ${contact.clusterCount} contacts`], side: 'train armour kit',
  body: tris, loose: [], full, bb: null, plates: surf.plateaus.filter(s => s.share >= 0.1 && s.y > 0.03).slice(0, 3), contact};
const sheet = await sc.renderSheet([zobj, kobj], out, {ppm: 200, refs: true, title: 'scale check — train armour kit beside zombie lastshift'});
fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify({...report, zombie: {heightM: z.heightM, size: z.bounds.size.map(r3)}, image: sheet.file}, null, 1));
console.log(JSON.stringify(report, null, 1));
