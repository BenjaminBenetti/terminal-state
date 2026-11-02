// Task reactor-expansion-20261101 (lane HOST): a SAMPLE side-complex carver for the host tests ONLY (never shipped) — proves the
// host path end to end against the contract (gen/reactor/complex/types.ts): six areas inside the slot's region (an entry hall behind
// the entrance, a spine corridor along the wall, four rooms behind it), the entrance door from the slot's deck, the zone generator in
// a seeded room, a dress hook adding one fixture per room in world metres (absolute y, level-tagged).
import type {ComplexCarve, ComplexCarver, ComplexRoom} from '../src/gen/reactor/complex/types';
import type {Rect} from '../src/gen/stationTypes';
import {CELL} from '../src/gen/grid';

const NAMES = {bunker: 'Sample bunker', mines: 'Sample mine', waste: 'Sample repository'} as const;

/** Six-area sample carver; `opts.small` carves a deliberately undersized program (the validation's "substantial" floor). */
export function sampleCarver(opts: {small?: boolean} = {}): ComplexCarver {
  return ({k, rng, slot, levelOpt}) => {
    const R = slot.region, E = slot.entrance, base = slot.baseY;
    const [ix, iy] = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]}[slot.inward];
    const alongY = ix !== 0;
    // wall-local frame: a = absolute canvas along coordinate, d = rows inside the pit wall (d = 0 the first row behind it)
    const wallX = slot.inward === 'W' ? R.x + R.w - 1 : R.x, wallY = slot.inward === 'N' ? R.y + R.h - 1 : R.y;
    const rectL = (a0: number, aw: number, d0: number, dd: number): Rect => alongY
      ? {x: ix < 0 ? wallX - d0 - dd : wallX + 1 + d0, y: a0, w: dd, h: aw}
      : {x: a0, y: iy > 0 ? wallY + 1 + d0 : wallY - d0 - dd, w: aw, h: dd};
    const ra0 = (alongY ? R.y : R.x) + 1, ra1 = (alongY ? R.y + R.h : R.x + R.w) - 1;
    const depth = (alongY ? R.w : R.h) - 2;
    const ea0 = alongY ? E.y : E.x, ew = alongY ? E.h : E.w;
    const deck = k.areas[slot.frontArea];
    const rooms: ComplexRoom[] = [];
    const add = (r: Rect, kind: 'room' | 'passage', type: 'utility' | 'service-corridor' | 'storage', ceil: number, parent: number, label: string, role: ComplexRoom['role'], key: string) => {
      const a = k.addArea(r, kind, type, ceil, parent, {...levelOpt, label, publicSpace: false});
      a.purpose = type === 'storage' ? 'storage' : type === 'utility' ? 'pump-room' : undefined;
      rooms.push({area: a.id, key, label, role});
      return a;
    };
    const entry = add(rectL(Math.max(ra0, ea0 - 2), Math.min(ra1, ea0 + ew + 2) - Math.max(ra0, ea0 - 2), 0, 8), 'room', 'utility', base + 3.4, slot.frontArea, 'Entry hall', 'entry', 'entry');
    k.carveDoor(E, deck, entry, 3.0, false);
    const spineD = opts.small ? 4 : 6;
    const spine = add(rectL(ra0, ra1 - ra0, 9, spineD), 'passage', 'service-corridor', base + 3.0, entry.id, 'Spine corridor', 'corridor', 'spine');
    k.carveDoor(rectL(ea0 + 1, 4, 8, 1), entry, spine, 2.4, false);
    const r0 = 9 + spineD + 1, rd = opts.small ? 6 : Math.min(30, depth - r0 - 1);
    const n = 4, wAll = ra1 - ra0, rw0 = Math.floor((wAll - (n - 1)) / n), rw = opts.small ? Math.min(rw0, 6) : rw0;
    const backs = [];
    for (let q = 0; q < n; q++) {
      const a0 = ra0 + q * (rw0 + 1);
      const r = add(rectL(a0, rw, r0, rd), 'room', q === 1 ? 'storage' : 'utility', Math.min(slot.ceilMax, base + 4.2), spine.id, `Room ${q + 1}`, q === 1 ? 'store' : 'room', `room${q}`);
      k.carveDoor(rectL(a0 + 2, 3, r0 - 1, 1), spine, r, 2.4, false);
      backs.push({a0, area: r});
    }
    // the generator in a seeded room: an 8 x 4 cell skid (long axis along the wall), the use point two rows nearer the spine
    const gq = rng.int(0, n - 1), G = backs[gq];
    rooms[2 + gq].role = 'generator';
    rooms[2 + gq].label = 'Generator room';
    const fl = opts.small ? 4 : 8, fw = opts.small ? 2 : 4;
    const fa0 = G.a0 + Math.floor(rw / 2) - fl / 2, fd0 = opts.small ? r0 + 2 : r0 + Math.floor(rd / 2) - 1;
    const foot = rectL(fa0, fl, fd0, fw);
    const ua = fa0 + fl / 2, ud = fd0 - 2;
    const [ux, uy] = alongY ? [ix < 0 ? wallX - 1 - ud : wallX + 1 + ud, ua] : [ua, iy > 0 ? wallY + 1 + ud : wallY - 1 - ud];
    const out: ComplexCarve = {
      id: slot.id, slot, areas: rooms.map(r => r.area), entryArea: entry.id, rooms,
      generator: {area: G.area.id, foot, yaw: alongY ? Math.PI / 2 : 0, use: {x: ux, y: uy, yaw: Math.atan2(-ix, -iy)}},
      name: NAMES[slot.id],
      dress(layout, _rng, crop) {
        for (const rm of rooms) {
          const a = layout.areas[rm.area];
          layout.lights.push({x: (a.x + a.w / 2) * CELL, y: base + 2.9, z: (a.y + 1.5) * CELL, rot: 0, area: a.id, broken: false, flicker: false, warm: true, power: 0.9, dying: false, level: slot.level});
        }
        void crop;
      },
    };
    return out;
  };
}
