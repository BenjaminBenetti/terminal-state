/** Surface Run: RNG-isolated local expeditions. A station must opt in with its recorded surfaceVersion. */
import {hashString, Rng} from '../../core/rng';
import {FILTER_LIFE_S} from '../../items/gear';
import type {LevelId, SectionGenContext} from '../../levels/types';
import {ANNEX_CACHE} from '../annexCache';
import {CELL, FLOOR, Grid, SOLID} from '../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import type {Area, Door, Rect, RoomType, StationLayout, Trench} from '../stationTypes';
import {layStairRun} from '../traversal';
import type {SurfaceAccess, SurfaceBaseLevel, SurfaceBlock, SurfaceDestination, SurfaceDressing, SurfaceInfo, SurfacePose, SurfaceRect} from './types';
export type * from './types';

export const SURFACE_VERSION = 1;
export const SURFACE_CHANCE = 0.25;
export const SURFACE_BLOCK_SIZE = 28;
export const SURFACE_BLOCKS = 8;
const SKY_CEIL = 12;
const BOUNDS: SurfaceRect = {x: 4, z: 4, w: 232, d: 232};
const CORE: SurfaceRect = {x: 68, z: 68, w: 104, d: 104};
const SKY_TINT = [0.68, 0.88, 0.75] as const;

export function isSurfaceBaseLevel(level: LevelId | string): level is SurfaceBaseLevel {
  return level === 'subway' || level === 'office' || level === 'mall';
}

/** Exactly one of four independent seed buckets. No draws from the original level generator. */
export function surfaceEligible(level: LevelId | string, levelSeed: number, version = 0): boolean {
  return version === SURFACE_VERSION && isSurfaceBaseLevel(level) && (hashString('surface-run-presence-v1', levelSeed >>> 0) & 3) === 0;
}

/** Only the local expedition is generated; the base level and its existing add-ons are untouched. */
export function generateSurfaceLevel(ctx: SectionGenContext, baseLevel: SurfaceBaseLevel): StationLayout {
  const seed = hashString('surface-run-layout-v1', ctx.levelSeed >>> 0);
  const rng = new Rng(seed), g = new Grid(480, 480);
  const outdoor = area(0, BOUNDS, 'concourse', 'office-roof', SKY_CEIL, 'Toxic street grid', -1);
  const trench: Trench = {x0: 0, x1: 0, z0: 0, z1: 0, floorY: -1.15, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0};
  const open = new Uint8Array(g.cells.length), tops = new Float32Array(g.cells.length);
  const layout: StationLayout = {
    seed, attempt: 0, name: 'Surface Run', archetype: 'side-mezzanine', towards: ['Underground', 'Quarantine perimeter'],
    grid: g, areas: [outdoor], doors: [], props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 44, z: 194, yaw: 0}, trench, trenches: [], platform: 0, platforms: [],
    traversal: {stairs: [], ladders: [], underpasses: []},
    levels: [{id: 0, role: 'roof', baseY: 0, grid: g, rails: [], sky: {y: 0, ceil: SKY_CEIL, top: 3.6, tops, open, outdoor: {level: 0, y: 3.6}}}],
    levelLinks: [], rails: [], startWeapon: ctx.startWeapon ?? 'rifle',
  };
  stamp(g, BOUNDS, FLOOR, outdoor.id, SKY_CEIL);
  forRect(g, BOUNDS, i => {open[i] = 1;});
  const truck = {x: 55, y: 0, z: 191, yaw: Math.PI, level: 0, area: 0};
  const info: SurfaceInfo = {
    version: 1, seed: ctx.levelSeed >>> 0, baseLevel, bounds: {...BOUNDS}, coreBounds: {...CORE}, blockSize: SURFACE_BLOCK_SIZE,
    blocks: [], roads: [], destinations: [], shells: [], dressing: [],
    checkpoint: {x: 40, z: 180, w: 20, d: 20, y: 0, map: {x: 45, y: 0.82, z: 185}, return: {x: 44, y: 0, z: 194, yaw: 0, level: 0}, truck},
    truck, depotCargo: [], exteriorSpawns: [], interiorSpawnIndices: [],
  };
  layout.surface = info;
  for (let k = 0; k <= 8; k++) {
    info.roads.push({id: `E${k + 1}`, axis: 'x', x: 4, z: 4 + 28 * k, w: 232, d: 8});
    info.roads.push({id: `N${k + 1}`, axis: 'z', x: 4 + 28 * k, z: 4, w: 8, d: 232});
  }
  const programmes = rng.fork('programmes').shuffle([
    'pharmacy', 'convenience', 'office', 'shopping-centre', 'office', 'coffee', 'shopping-centre', 'tech',
    'shopping-centre', 'office', 'convenience', 'pharmacy', 'keys', 'shopping-centre', 'office', 'depot',
  ]);
  // The depot's real loading bay is deliberately fixed in the south-east core lot, for repeatable cargo navigation.
  const depotAt = programmes.indexOf('depot');
  [programmes[depotAt], programmes[15]] = [programmes[15], programmes[depotAt]];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const block: SurfaceBlock = {id: `${String.fromCharCode(65 + col)}${row + 1}`, col, row, x: 12 + col * 28, z: 12 + row * 28, w: 20, d: 20, core: col >= 2 && col <= 5 && row >= 2 && row <= 5};
    info.blocks.push(block);
    const br = rng.fork(`block:${block.id}`);
    // The Office roof's existing source height/power reaches ground level within the field's finite range.
    if ((row + col) % 2 === 0) layout.lights.push({x: block.x - 3, y: 4.2, z: block.z - 3, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 0.8, dying: false, virtual: true, tint: SKY_TINT});
    if (block.core) {
      const n = (row - 2) * 4 + col - 2;
      addDestination(layout, info, block, programmes[n], n, br);
    } else if (!(col === 1 && row === 6) && br.chance(0.42)) {
      const shell = {block: block.id, x: block.x + 4, z: block.z + 3, w: br.pick([10, 12, 14]), d: br.pick([10, 12, 14]), height: br.int(9, 28), variant: br.int(0, 4)};
      info.shells.push(shell);
      stamp(g, shell, SOLID, 0, 0);
      forRect(g, shell, i => {open[i] = 0; tops[i] = shell.height;});
    }
    if (!(col === 1 && row === 6) && br.chance(block.core ? 0.72 : 0.38)) {
      const wreck = {kind: 'wreck' as const, x: block.x + 6, z: block.z - 1.2, yaw: 0, variant: br.int(0, 3), w: 4.6, d: 1.7809, h: 1.3055};
      addDressing(layout, info, wreck);
    }
    if (!block.core && !(col === 1 && row === 6) && !info.shells.some(s => s.block === block.id) && br.chance(0.4)) {
      addDressing(layout, info, {kind: 'rubble', x: block.x + 8, z: block.z + 9, yaw: 0, variant: br.int(0, 2), w: 5, d: 4.7449, h: 1.801});
    }
    if ((row + col) % 3 === 0) addDressing(layout, info, {kind: 'lamp', x: block.x - 0.3, z: block.z - 0.3, yaw: 0, variant: br.int(0, 2), w: 0.22, d: 0.22, h: 4.6});
  }
  // A ruined bus is on the shoulder, never across the only route into the outer blocks.
  addDressing(layout, info, {kind: 'bus', x: 108, z: 34.4, yaw: 0, variant: 0, w: 12, d: 3.7612, h: 4.3417});
  // Checkpoint furniture is ordinary finite loot/storage. No fuel or oxygen subsystem is introduced.
  fixedBox(layout, 45, 185, 2.8, 2.1, 0.82);
  placeProp(layout, 'footlocker', 42, 183, 0, 0);
  placeProp(layout, 'bedroll', 42, 187, 0, 0);
  const lantern = {x: 46.1, y: 0.83, z: 185.75};
  placeProp(layout, 'campLantern', lantern.x, lantern.z, 0, 0, lantern.y);
  // Appending preserves every existing fixture's index and flicker circuit. These are local baked sources, not live lights.
  layout.lights.push({...lantern, y: lantern.y + ANNEX_CACHE.lantern.lift, rot: 0, area: 0, broken: false, flicker: false,
    warm: true, power: ANNEX_CACHE.lantern.power, dying: false, virtual: true});
  for (const z of [truck.z, 185]) layout.lights.push({x: truck.x, y: 4.2, z, rot: 0, area: 0, broken: false, flicker: false,
    warm: false, power: 0.8, dying: false, virtual: true, tint: SKY_TINT});
  for (const x of [40.5, 49.5]) for (const z of [180.5, 189.5]) fixedBox(layout, x, z, 0.1, 0.1, 3);
  fixedBox(layout, 40.35, 185, 0.055, 9.6, 2.35);
  fixedBox(layout, 49.65, 185, 0.055, 9.6, 2.35);
  fixedBox(layout, 45, 180.3, 9.2, 0.055, 2.35);
  // The pitched canvas also stops bullets and falling physics. Thin raised strips follow its actual slope;
  // they never block navigation on the floor beneath it.
  for (let k = 0; k < 20; k++) {
    const x = 40.3 + (k + 0.5) * 9.4 / 20, y = 3.5 - Math.abs(x - 45) * 1.2 / 4.7;
    layout.props.push({kind: 'annexMachine', x, y: y - 0.09, z: 185, rot: 0, area: 0,
      hx: 9.4 / 40, hz: 4.85, h: 0.18, blocksSight: true, variant: 0, level: 0});
  }
  // A real roofed stair head makes the section boundary a plausible closed transit door, rather than a floating portal.
  const head = {x: 42, z: 195, w: 4, d: 4}, vestibule = {x: 42.5, z: 195.5, w: 3, d: 3};
  const airlock = area(layout.areas.length, vestibule, 'passage', 'exit-stair', 3.2, 'Checkpoint stair head', 0);
  layout.areas.push(airlock);
  stamp(g, head, SOLID, 0, 0);
  stamp(g, vestibule, FLOOR, airlock.id, 3.2);
  forRect(g, head, i => {open[i] = 0; tops[i] = 3.5;});
  addDoor(layout, {x: 43, z: 195, w: 2, d: 0.5}, 0, airlock.id, 2.55);
  layout.props.push({kind: 'annexMachine', x: 44, y: 0, z: 195.1, rot: Math.PI, area: airlock.id,
    hx: 0.7, hz: 0.06, h: 2.55, blocksSight: true, variant: 0, level: 0});
  layout.signs.push({x: 44, y: 2.83, z: 194.96, rot: Math.PI, area: airlock.id, kind: 'exit', text: 'UNDERGROUND TRANSIT', w: 2.7});
  layout.pickups.push({itemId: 'gas_mask', count: 1, filter: FILTER_LIFE_S / 2, x: 44, y: 0, z: 188.3, area: 0},
    {itemId: 'gas_filter', count: 1, x: 43.2, y: 0, z: 183, area: 0}, {itemId: 'water', count: 1, x: 43.8, y: 0, z: 183, area: 0});
  // Slots are separate from permanent enemies. Runtime chooses away/off-camera slots and caps its recycled pool.
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const x = 8 + col * 28, z = 22 + row * 28;
    if (Math.hypot(x - truck.x, z - truck.z) < 32 || !g.circleClear(x, z, 0.6)) continue;
    info.exteriorSpawns.push({x, z, y: 0, level: 0, yaw: rng.fork(`outside:${col}:${row}`).range(-Math.PI, Math.PI), type: (col + row) % 5 === 0 ? 'coated' : 'shambler', area: 0});
  }
  const depot = info.destinations.find(d => d.kind === 'depot')!;
  info.depotCargo = (['armor', 'radar', 'scanner', 'sentry'] as const).map((kind, n) => ({id: `SR-salvage-${kind}`, kind, x: depot.x + 9 + (n % 2) * 3, z: depot.z + 5 + Math.floor(n / 2) * 3, y: 0, yaw: n * Math.PI / 2, level: 0}));
  return layout;
}

function area(id: number, r: SurfaceRect, kind: Area['kind'], type: RoomType, ceil: number, label: string, parent: number): Area {
  return {id, x: Math.round(r.x / CELL), y: Math.round(r.z / CELL), w: Math.round(r.w / CELL), h: Math.round(r.d / CELL), kind, type, ceil, label, parent, depth: parent < 0 ? 0 : 1, publicSpace: kind === 'concourse', lighting: 'dim'};
}
function forRect(g: Grid, r: SurfaceRect, fn: (i: number) => void): void {
  for (let z = Math.round(r.z / CELL); z < Math.round((r.z + r.d) / CELL); z++) for (let x = Math.round(r.x / CELL); x < Math.round((r.x + r.w) / CELL); x++) if (g.inBounds(x, z)) fn(g.idx(x, z));
}
function stamp(g: Grid, r: SurfaceRect, value: number, areaId: number, ceil: number): void {
  forRect(g, r, i => {g.cells[i] = value; g.area[i] = areaId; g.ceil[i] = ceil;});
}
function addDestination(layout: StationLayout, info: SurfaceInfo, block: SurfaceBlock, programme: string, n: number, rng: Rng): void {
  const kind = programme === 'depot' ? 'depot' : programme === 'office' ? 'office' : programme === 'shopping-centre' ? 'shopping-centre' : 'store';
  const inset = kind === 'depot' ? 0.5 : rng.pick([1, 1.5, 2]);
  const r: SurfaceRect = {x: block.x + inset, z: block.z + inset, w: 20 - inset * 2, d: 20 - inset * 2};
  const height = kind === 'depot' ? 5.4 : kind === 'shopping-centre' ? 4.6 : kind === 'office' ? 3.4 : 3.8;
  const names: Record<string, string> = {pharmacy: 'Mercer Pharmacy', convenience: 'Last Stop Grocer', coffee: 'Ash Street Coffee', tech: 'Northline Electronics', keys: 'Copper Key Hardware', office: ['Calder Survey & Title', 'Brackett Adjusters', 'Eastline Accounts', 'Sable Logistics'][n % 4], 'shopping-centre': ['Cinder Court Shops', 'Mercer Mini Mall', 'Ash Arcade', 'Briar Corner Shops'][n % 4], depot: 'Municipal Rail Repair Depot'};
  const d: SurfaceDestination = {...r, id: `SR-${String(n).padStart(2, '0')}`, block: block.id, label: names[programme] ?? programme, kind, entrance: {x: r.x + r.w / 2, z: r.z + r.d + 0.3}, areaIds: [], height, facade: rng.int(0, 5)};
  if (kind === 'depot') d.intel = 'Rail workshop reported intact. Recoverable equipment may remain.';
  else if (n % 5 === 1) d.intel = 'Faded holdout markings. Report unconfirmed; no current contact.';
  else if (n % 5 === 3) d.intel = 'Street patrol reported infected movement inside.';
  info.destinations.push(d);
  stamp(layout.grid, r, SOLID, 0, 0);
  forRect(layout.grid, r, i => {layout.levels[0].sky!.open![i] = 0; layout.levels[0].sky!.tops![i] = height + 0.3;});
  const room = (rr: SurfaceRect, label: string, purpose: string, type: RoomType = 'storage'): Area => {
    const a = area(layout.areas.length, rr, type === 'office-corridor' ? 'passage' : 'room', type, height, label, 0);
    a.purpose = purpose; layout.areas.push(a); d.areaIds.push(a.id); stamp(layout.grid, rr, FLOOR, a.id, height); return a;
  };
  const inside = {x: r.x + 0.5, z: r.z + 0.5, w: r.w - 1, d: r.d - 1};
  let front: Area;
  if (kind === 'office') {
    const cw = 2.5, side = (inside.w - cw - 1) / 2;
    const corridor = room({x: inside.x + side + 0.5, z: inside.z, w: cw, d: inside.d}, 'Entrance corridor', 'office-corridor', 'office-corridor'); front = corridor;
    for (let sideN = 0; sideN < 2; sideN++) for (let row = 0; row < 2; row++) {
      const rr = {x: inside.x + sideN * (side + cw + 1), z: inside.z + row * (inside.d / 2 + 0.25), w: side, d: inside.d / 2 - 0.25};
      const purpose = row === 0 ? (sideN ? 'office-server' : 'office-private') : (sideN ? 'office-break' : 'office-meeting');
      const a = room(rr, `${d.label} · ${purpose.replace('office-', '')}`, purpose, 'office-room');
      const plane = sideN === 0 ? rr.x + rr.w : rr.x - 0.5;
      addDoor(layout, {x: plane, z: rr.z + rr.d / 2 - 0.75, w: 0.5, d: 1.5}, corridor.id, a.id, 2.6);
    }
  } else if (kind === 'shopping-centre') {
    const hallD = 3, shopD = inside.d - hallD - 0.5;
    front = room({x: inside.x, z: inside.z + shopD + 0.5, w: inside.w, d: hallD}, `${d.label} · arcade`, 'service-corridor', 'concourse');
    const sw = (inside.w - 1) / 3;
    for (let k = 0; k < 3; k++) {
      const rr = {x: inside.x + k * (sw + 0.5), z: inside.z, w: sw, d: shopD};
      const purpose = ['convenience', 'pharmacy', n % 2 ? 'phone' : 'coffee'][k];
      const a = room(rr, `${d.label} · ${purpose}`, purpose, 'shop');
      addDoor(layout, {x: rr.x + rr.w / 2 - 1, z: rr.z + rr.d, w: 2, d: 0.5}, front.id, a.id, 2.8);
    }
  } else if (kind === 'depot') {
    front = room(inside, 'Train repair hall', 'workshop', 'utility');
    // Service office partitions leave the wide central loading aisle continuous.
    const office = room({x: inside.x, z: inside.z, w: 5, d: 5}, 'Dispatch office', 'office-private', 'office-room');
    // Real partitions around the dispatch room, with a worker door into the hall.
    stamp(layout.grid, {x: inside.x + 5, z: inside.z, w: 0.5, d: 5.5}, SOLID, 0, 0);
    stamp(layout.grid, {x: inside.x, z: inside.z + 5, w: 5.5, d: 0.5}, SOLID, 0, 0);
    addDoor(layout, {x: inside.x + 1.5, z: inside.z + 5, w: 1.5, d: 0.5}, front.id, office.id, 2.6);
  } else {
    const backD = rng.pick([4, 5, 6]), frontD = inside.d - backD - 0.5;
    const back = room({x: inside.x, z: inside.z, w: inside.w, d: backD}, `${d.label} · stock room`, 'stock-room', 'stock-room');
    front = room({x: inside.x, z: inside.z + backD + 0.5, w: inside.w, d: frontD}, d.label, programme, programme === 'coffee' ? 'eatery' : 'shop');
    addDoor(layout, {x: inside.x + 1.5, z: inside.z + backD, w: 1.5, d: 0.5}, front.id, back.id, 2.6);
  }
  const entryW = kind === 'depot' ? 4.5 : kind === 'shopping-centre' ? 3 : 2;
  addDoor(layout, {x: r.x + r.w / 2 - entryW / 2, z: r.z + r.d - 0.5, w: entryW, d: 0.5}, 0, front.id, kind === 'depot' ? 4.2 : 2.8);
  layout.signs.push({x: r.x + r.w / 2, y: kind === 'depot' ? 4.5 : 3.05, z: r.z + r.d + 0.03, rot: 0, kind: 'info', text: d.label.toUpperCase(), area: front.id, w: Math.min(7, r.w - 1)});
  for (const id of d.areaIds) furnishRoom(layout, layout.areas[id], rng.fork(`room:${id}`));
  // A small finite permanent population, spawned inside the actual rooms; exterior recycling never touches these indices.
  const occupants = kind === 'depot' ? 4 : kind === 'shopping-centre' ? 3 : 2;
  for (let k = 0; k < occupants; k++) {
    const a = layout.areas[d.areaIds[k % d.areaIds.length]];
    for (let tries = 0; tries < 20; tries++) {
      const x = (a.x + rng.int(2, Math.max(2, a.w - 3)) + 0.5) * CELL, z = (a.y + rng.int(2, Math.max(2, a.h - 3)) + 0.5) * CELL;
      if (!layout.grid.circleClear(x, z, 0.48) || layout.grid.areaAt(x, z) !== a.id) continue;
      info.interiorSpawnIndices.push(layout.zombies.length);
      layout.zombies.push({x, z, y: 0, level: 0, area: a.id, yaw: rng.range(-Math.PI, Math.PI), type: k % 5 === 3 ? 'coated' : 'shambler'}); break;
    }
  }
}
function addDoor(layout: StationLayout, r: SurfaceRect, a: number, b: number, height: number): void {
  const rr: Rect = {x: Math.round(r.x / CELL), y: Math.round(r.z / CELL), w: Math.max(1, Math.round(r.w / CELL)), h: Math.max(1, Math.round(r.d / CELL))};
  const door: Door = {...rr, id: layout.doors.length, a, b, height, arch: true, noFrame: true}; layout.doors.push(door);
  stamp(layout.grid, {x: rr.x * CELL, z: rr.y * CELL, w: rr.w * CELL, d: rr.h * CELL}, FLOOR, b, height);
}
function placeProp(layout: StationLayout, kind: PropKind, x: number, z: number, areaId: number, rot = 0, y = 0): void {
  const def = PROP_DEFS[kind], swap = Math.abs(Math.sin(rot)) > 0.5;
  const p: PropPlacement = {kind, x, y, z, rot, area: areaId, hx: (swap ? def.d : def.w) / 2, hz: (swap ? def.w : def.d) / 2, h: def.h, blocksSight: def.blocksSight, variant: 0};
  // Keep all circulation and doors real: do not force a fixture over a wall or another fixture.
  if (y < 0.2 && !layout.grid.circleClear(x, z, Math.min(p.hx, p.hz) + 0.1)) return;
  layout.props.push(p);
  if (y < 0.2) blockProp(layout.grid, p);
}
function blockProp(g: Grid, p: PropPlacement): void {
  // Thin poles/curtains still occupy cells. Round-to-nearest can erase a <0.5m footprint from navigation.
  for (let z = Math.floor((p.z - p.hz) / CELL); z < Math.ceil((p.z + p.hz) / CELL); z++) for (let x = Math.floor((p.x - p.hx) / CELL); x < Math.ceil((p.x + p.hx) / CELL); x++) {
    if (!g.inBounds(x, z)) continue;
    const i = g.idx(x, z); g.blocked[i] = 1; if (p.blocksSight) g.sightBlocked[i] = 1;
  }
}
/** Collision-only parts are rendered by the checkpoint/city view from this same measured contract. */
function fixedBox(layout: StationLayout, x: number, z: number, w: number, d: number, h: number): void {
  const p: PropPlacement = {kind: 'annexMachine', x, y: 0, z, rot: 0, area: 0, hx: w / 2, hz: d / 2, h, blocksSight: h > 1.6, variant: 0, level: 0};
  layout.props.push(p); blockProp(layout.grid, p);
}
function furnishRoom(layout: StationLayout, a: Area, rng: Rng): void {
  const x = a.x * CELL, z = a.y * CELL, w = a.w * CELL, d = a.h * CELL;
  const purpose = a.purpose ?? '';
  let fixtures: PropKind[] = purpose.startsWith('office-') ? ['desk', 'officeFiling', 'officeChair', 'officeShelf'] : purpose === 'workshop' ? ['repairBench', 'shelf', 'crate', 'cabinetTall'] : purpose === 'pharmacy' ? ['medCabinet', 'stockShelf', 'shopCounter'] : purpose === 'coffee' ? ['espressoBar', 'shopCounter', 'table', 'fridge'] : purpose === 'stock-room' ? ['shelf', 'crate', 'cartonStack'] : ['stockShelf', 'shopCounter', 'shelf', 'snackRack'];
  if (purpose === 'office-server') fixtures = ['serverRack', 'serverRack', 'officeShelf'];
  if (purpose === 'office-break') fixtures = ['kitchenette', 'fridge', 'table'];
  if (purpose === 'office-meeting') fixtures = ['conferenceTable', 'officeChair', 'officeFiling'];
  if (purpose === 'service-corridor' || purpose === 'office-corridor') fixtures = ['bin', 'bench'];
  const positions = [[x + 1.25, z + 1.2], [x + w - 1.25, z + 1.2], [x + 1.25, z + d - 1.3], [x + w - 1.25, z + d - 1.3]];
  fixtures.forEach((kind, n) => {if (PROP_DEFS[kind]) placeProp(layout, kind, positions[n][0], positions[n][1], a.id, n % 2 ? Math.PI : 0);});
  // Loose supplies are part of the ordinary section memory and do not refill.
  const pool = purpose === 'pharmacy' ? ['bandage', 'medkit', 'gas_filter'] : purpose.startsWith('office-') ? ['electrical_parts', 'battery', 'water'] : purpose === 'workshop' || purpose === 'stock-room' ? ['scrap_metal', 'electrical_parts', 'gas_filter'] : ['water', 'beans', 'chocolate'];
  const cx = x + w / 2, cz = z + d / 2;
  if (layout.grid.circleClear(cx, cz, 0.35)) layout.pickups.push({itemId: rng.pick(pool), count: 1, x: cx, y: 0, z: cz, area: a.id});
  layout.lights.push({x: cx, y: a.ceil - 0.25, z: cz, rot: 0, area: a.id, broken: rng.chance(0.25), flicker: rng.chance(0.25), warm: rng.chance(0.55), power: 0.45, dying: false});
}
function addDressing(layout: StationLayout, info: SurfaceInfo, d: SurfaceDressing): void {
  info.dressing.push(d);
  const swap = Math.abs(Math.sin(d.yaw)) > 0.5;
  const p: PropPlacement = {kind: 'annexMachine', x: d.x, y: 0, z: d.z, rot: d.yaw, area: 0, hx: (swap ? d.d : d.w) / 2, hz: (swap ? d.w : d.d) / 2, h: d.h, blocksSight: d.h > 1.6, variant: 0};
  layout.props.push(p); blockProp(layout.grid, p);
}

/** Add a genuine localized, occluded route to a NEW base world. No array deletion, core RNG, or index translation. */
export function appendSurfaceAccess(layout: StationLayout, level: SurfaceBaseLevel, _levelSeed = layout.seed): SurfaceAccess {
  if (layout.surfaceAccess) return layout.surfaceAccess;
  if (level === 'office') {
    const span = layout.office?.windows.find(w => w.kind === 'entrance');
    if (span) {
      const inward = span.side === 'N' ? [0, 1] : span.side === 'S' ? [0, -1] : span.side === 'W' ? [1, 0] : [-1, 0];
      const access: SurfaceAccess = {x: (span.x0 + span.x1) / 2 + inward[0] * 1.1, y: span.baseY, z: (span.z0 + span.z1) / 2 + inward[1] * 1.1, yaw: Math.atan2(inward[0], inward[1]), level: span.level, kind: 'exterior-exit', label: 'SURFACE RUN · Exterior checkpoint'};
      // The old lobby exit is deliberately barricaded. Keep those finite crates and their indices, beside the opening.
      const approach: SurfaceRect = {x: access.x - (inward[0] ? 1.7 : 1.1), z: access.z - (inward[1] ? 1.7 : 1.1), w: inward[0] ? 3.4 : 2.2, d: inward[1] ? 3.4 : 2.2};
      const grid = layout.levels[access.level].grid;
      for (const p of layout.props) if ((p.level ?? 0) === access.level && p.y < access.y + 0.3 && p.y + p.h > access.y && overlapProp(p, approach)) {
        const old = {x: p.x - p.hx, z: p.z - p.hz, w: p.hx * 2, d: p.hz * 2};
        forRect(grid, old, i => {grid.blocked[i] = 0; grid.sightBlocked[i] = 0;});
        relocateFixture(layout, p, layout.areas[p.area], approach);
        // Restore any neighbouring footprint whose cells the old box shared.
        for (const q of layout.props) if (q !== p && (q.level ?? 0) === access.level && q.y < access.y + 0.3 && overlapProp(q, old)) blockProp(grid, q);
      }
      layout.surfaceAccess = access; addAccessSign(layout, access); return access;
    }
  }
  if (level === 'mall') {
    const e = layout.mall?.exits?.find(exit => exit.kind === 'entrance-hall') ?? layout.mall?.exits?.[0];
    if (e) {
      const xAxis = e.side === 'N' || e.side === 'S';
      const inward = e.side === 'N' ? [0, 1] : e.side === 'S' ? [0, -1] : e.side === 'W' ? [1, 0] : [-1, 0];
      const access: SurfaceAccess = {x: (xAxis ? (e.door.s0 + e.door.s1) / 2 : e.door.plane) + inward[0] * 1.1, y: e.streetY, z: (xAxis ? e.door.plane : (e.door.s0 + e.door.s1) / 2) + inward[1] * 1.1, yaw: Math.atan2(inward[0], inward[1]), level: e.level, kind: 'exterior-exit', label: 'SURFACE RUN · Exterior checkpoint'};
      layout.surfaceAccess = access; addAccessSign(layout, access); return access;
    }
  }
  // Subway's 4x10m closed exit becomes two full flights and landings, eight metres of ascent behind masonry walls.
  // Prefer an exit outside every upper-storey footprint, then the least furnished one. The sealed prop keeps its index.
  const candidates = layout.areas.filter(a => a.type === 'exit-stair' && (a.level ?? 0) === 0 && Math.min(a.w, a.h) >= 8 && Math.max(a.w, a.h) >= 20);
  const overhead = (a: Area): number => {
    let n = 0;
    for (const lv of layout.levels) if (lv.id !== (a.level ?? 0)) {
      for (let z = a.y; z < a.y + a.h; z++) for (let x = a.x; x < a.x + a.w; x++) {
        const i = lv.grid.idx(x, z);
        if (lv.grid.cells[i] !== SOLID && lv.grid.floor[i] < 10.7 && lv.grid.ceil[i] > 0) n++;
      }
    }
    return n;
  };
  candidates.sort((a, b) => overhead(a) - overhead(b) || layout.props.filter(p => p.area === a.id && p.kind !== 'exitStair').length - layout.props.filter(p => p.area === b.id && p.kind !== 'exitStair').length || a.id - b.id);
  const a = candidates[0];
  if (!a) throw new Error(`Surface Run: ${level} has no physical exterior access`);
  const g = layout.levels[a.level ?? 0].grid, axis = a.w >= a.h ? 'x' : 'z';
  const door = layout.doors.find(d => d.a === a.id || d.b === a.id);
  const from = axis === 'x' ? (door && door.x < a.x ? 'lo' : 'hi') : (door && door.y < a.y ? 'lo' : 'hi');
  const base = g.floorAt((a.x + 0.5) * CELL, (a.y + 0.5) * CELL);
  const width = axis === 'x' ? a.h : a.w, length = axis === 'x' ? a.w : a.h;
  const firstWidth = Math.floor((width - 1) / 2), secondWidth = width - firstWidth - 1;
  const lane = (n: number): Rect => {
    const at = n ? firstWidth + 1 : 0, span = n ? secondWidth : firstWidth;
    return axis === 'x' ? {x: a.x, y: a.y + at, w: length, h: span} : {x: a.x + at, y: a.y, w: span, h: length};
  };
  for (let z = a.y; z < a.y + a.h; z++) for (let x = a.x; x < a.x + a.w; x++) {const i = g.idx(x, z); g.blocked[i] = 0; g.sightBlocked[i] = 0; g.cells[i] = SOLID;}
  const first = lane(0), second = lane(1);
  const carve = (r: Rect): void => {for (let z = r.y; z < r.y + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) {const i = g.idx(x, z); g.cells[i] = FLOOR; g.area[i] = a.id;}};
  carve(first); carve(second);
  // Reserve one metre at the high end of each run for a genuinely flat landing.
  const shrinkHigh = (r: Rect, start: 'lo' | 'hi'): Rect => axis === 'x' ? {...r, x: r.x + (start === 'hi' ? 2 : 0), w: r.w - 2} : {...r, y: r.y + (start === 'hi' ? 2 : 0), h: r.h - 2};
  const flights = [...layStairRun(g, shrinkHigh(first, from), a.id, axis, from, base, base + 4), ...layStairRun(g, shrinkHigh(second, from === 'lo' ? 'hi' : 'lo'), a.id, axis, from === 'lo' ? 'hi' : 'lo', base + 4, base + 8)];
  const topLanding: Rect = axis === 'x' ? {x: from === 'lo' ? a.x : a.x + a.w - 2, y: second.y, w: 2, h: second.h} : {x: second.x, y: from === 'lo' ? a.y : a.y + a.h - 2, w: second.w, h: 2};
  for (let z = topLanding.y; z < topLanding.y + topLanding.h; z++) for (let x = topLanding.x; x < topLanding.x + topLanding.w; x++) {const i = g.idx(x, z); g.floor[i] = base + 8; g.ceil[i] = base + 10.7; g.rampIdx[i] = -1;}
  for (const f of flights) {f.id = layout.traversal.stairs.length; layout.traversal.stairs.push(f);}
  // A cross-lane landing at the far end joins the two flights at exactly +4m.
  const landing: Rect = axis === 'x' ? {x: from === 'lo' ? a.x + a.w - 2 : a.x, y: a.y, w: 2, h: width} : {x: a.x, y: from === 'lo' ? a.y + a.h - 2 : a.y, w: width, h: 2};
  carve(landing);
  for (let z = landing.y; z < landing.y + landing.h; z++) for (let x = landing.x; x < landing.x + landing.w; x++) {const i = g.idx(x, z); g.floor[i] = base + 4; g.ceil[i] = base + 6.7; g.rampIdx[i] = -1;}
  // Preserve every placement index. Only the sealed staircase's decorative shell is retired under the new real stair geometry.
  for (const p of layout.props.filter(p => p.area === a.id)) {
    if (p.kind === 'exitStair') {p.kind = 'annexMachine'; p.y = -30; p.hx = p.hz = p.h = 0.001; p.blocksSight = false;}
    else relocateFixture(layout, p, layout.areas[a.parent]);
  }
  const across = (axis === 'x' ? second.y + second.h / 2 : second.x + second.w / 2) * CELL;
  const end = ((axis === 'x' ? a.x : a.y) + (from === 'lo' ? 1.6 : length - 1.6)) * CELL;
  const bottomAcross = (axis === 'x' ? first.y + first.h / 2 : first.x + first.w / 2) * CELL;
  const near = ((axis === 'x' ? a.x : a.y) + (from === 'lo' ? 0.6 : length - 0.6)) * CELL;
  const access: SurfaceAccess = {x: axis === 'x' ? end : across, y: base + 8, z: axis === 'x' ? across : end, yaw: axis === 'x' ? (from === 'lo' ? Math.PI / 2 : -Math.PI / 2) : (from === 'lo' ? 0 : Math.PI), level: a.level ?? 0, kind: 'stairwell', label: 'SURFACE RUN · Checkpoint airlock', approach: {x: axis === 'x' ? near : bottomAcross, y: base, z: axis === 'x' ? bottomAcross : near, yaw: axis === 'x' ? (from === 'lo' ? -Math.PI / 2 : Math.PI / 2) : (from === 'lo' ? Math.PI : 0), level: a.level ?? 0}};
  a.label = 'Surface checkpoint stairwell'; a.ceil = base + 10.7;
  for (const pickup of layout.pickups) if (pickup.area === a.id) pickup.y = g.floorAt(pickup.x, pickup.z);
  for (const sign of layout.signs) if (sign.area === a.id && /SEALED|EXIT CLOSED/.test(sign.text)) sign.text = 'SURFACE CHECKPOINT · TOXIC AIR';
  // The closed door is the actual collision/occlusion boundary; runtime draws the identical leaf before the loading transition.
  const dx = -Math.sin(access.yaw) * 0.7, dz = -Math.cos(access.yaw) * 0.7, swap = Math.abs(Math.sin(access.yaw)) > 0.5;
  layout.props.push({kind: 'annexMachine', x: access.x + dx, y: access.y, z: access.z + dz, rot: access.yaw, area: a.id,
    hx: swap ? 0.06 : 0.7, hz: swap ? 0.7 : 0.06, h: 2.55, blocksSight: true, variant: 0, level: access.level});
  addAccessSign(layout, access.approach!);
  layout.surfaceAccess = access; addAccessSign(layout, access);
  return access;
}

/** Keep each new-world fixture and its index, but leave both narrow stair lanes unobstructed. */
function relocateFixture(layout: StationLayout, p: PropPlacement, parent: Area | undefined, avoid?: SurfaceRect): void {
  const g = layout.levels[parent?.level ?? 0]?.grid;
  if (!parent || !g) throw new Error('Surface stairwell has no parent concourse');
  const marginX = Math.ceil((p.hx + 0.4) / CELL), marginZ = Math.ceil((p.hz + 0.4) / CELL);
  const positions: {x: number; z: number; d: number}[] = [];
  for (let z = parent.y + marginZ; z < parent.y + parent.h - marginZ; z += 2) for (let x = parent.x + marginX; x < parent.x + parent.w - marginX; x += 2) {
    const wx = (x + 0.5) * CELL, wz = (z + 0.5) * CELL;
    if (avoid && wx + p.hx > avoid.x && wx - p.hx < avoid.x + avoid.w && wz + p.hz > avoid.z && wz - p.hz < avoid.z + avoid.d) continue;
    if (Math.hypot(wx - layout.playerSpawn.x, wz - layout.playerSpawn.z) < Math.hypot(p.hx, p.hz) + 1) continue;
    if (layout.pickups.some(q => (q.level ?? 0) === (parent.level ?? 0) && Math.abs(q.x - wx) < p.hx + 0.4 && Math.abs(q.z - wz) < p.hz + 0.4)) continue;
    if (layout.doors.some(q => (q.level ?? 0) === (parent.level ?? 0) && wx + p.hx > q.x * CELL - 0.8 && wx - p.hx < (q.x + q.w) * CELL + 0.8 && wz + p.hz > q.y * CELL - 0.8 && wz - p.hz < (q.y + q.h) * CELL + 0.8)) continue;
    if (g.areaAt(wx, wz) !== parent.id || !g.circleClear(wx, wz, Math.hypot(p.hx, p.hz) + 0.2)) continue;
    if (layout.props.some(q => q !== p && (q.level ?? 0) === (parent.level ?? 0) && Math.abs(q.x - wx) < q.hx + p.hx + 0.2 && Math.abs(q.z - wz) < q.hz + p.hz + 0.2)) continue;
    positions.push({x: wx, z: wz, d: Math.hypot(wx - p.x, wz - p.z)});
  }
  const at = positions.sort((q, r) => q.d - r.d || q.x - r.x || q.z - r.z)[0];
  if (!at) throw new Error(`Surface stairwell cannot relocate ${p.kind} safely`);
  p.x = at.x; p.z = at.z; p.y = g.floorAt(at.x, at.z); p.area = parent.id; p.level = parent.level ?? 0;
  blockProp(g, p);
}
function overlapProp(p: PropPlacement, r: SurfaceRect): boolean {
  return p.x + p.hx > r.x && p.x - p.hx < r.x + r.w && p.z + p.hz > r.z && p.z - p.hz < r.z + r.d;
}
function addAccessSign(layout: StationLayout, p: SurfacePose): void {
  const areaId = layout.levels[p.level]?.grid.areaAt(p.x, p.z) ?? 0;
  layout.signs.push({x: p.x, y: p.y + 1.7, z: p.z, rot: p.yaw, kind: 'exit', text: 'SURFACE RUN · TOXIC OUTDOORS', area: Math.max(0, areaId), w: 2.4, level: p.level});
}
