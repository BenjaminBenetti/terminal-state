// Task studio-skywalk-variety-20261107-231448-01 (lane MERCH): Skyways layout version 4 splits the merchandise still drawn as part of a
// shop fixture into separate, ordinary movable stock props (gen/skyways/stores/kinds/merch.ts has the kinds and the measured data):
//  - every techDisplay (demo table) -> the bare table (variant MERCH_BARE_VARIANT, its box down to the 0.76 m top) + its six demo devices;
//  - every deviceWall -> the bare wall unit (variant MERCH_BARE_VARIANT; world/skywaysMerch.ts cuts the model) + its four display devices
//    on the cabinet deck, where the model had them;
//  - every faced-out LP row (skyMuFacedRecords) -> its five sleeves (the row placement becomes the first sleeve; four are appended).
// Run once at the very end of version-4 generation (gen/skyways/index.ts), so every fixture of the level is covered (base shop pool,
// anchor stores, annex rooms) and nothing generated before moves: new props are APPENDED (no index shifts), no rng draws (the layout
// is fully determined by the fixtures' own placements). Versions 1-3 never come here (skywaysGenVersion < 4: the frozen generators'
// layouts stay exactly as pinned); other levels never come here (their fixtures stay whole).

import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import type {StationLayout} from '../stationTypes';
import {skywaysGenVersion} from './layoutVersion';
import {DEMO_TABLE, FACED_LP, MERCH_BARE_VARIANT, WALL_DEVICES, WALL_DEVICE_CUT} from './stores/kinds/merch';
import {facedRow} from './stores/musicStock';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface MerchSplit { tables: number; walls: number; rows: number; props: PropPlacement[] }

/** A placement of `kind` at host-local (lx, lz), `y` m above the host's base, turned `turn` from the host, hosted on `hi`. */
function hosted(layout: StationLayout, hi: number, kind: PropKind, lx: number, lz: number, y: number, turn: number, box: {w: number; d: number; h: number}, variant: number): PropPlacement {
  const q = layout.props[hi], c = Math.cos(q.rot), s = Math.sin(q.rot), rot = q.rot + turn;
  const ac = Math.abs(Math.cos(rot)), as = Math.abs(Math.sin(rot));
  return {kind, x: r3(q.x + lx * c + lz * s), z: r3(q.z - lx * s + lz * c), y: r3(q.y + y), rot: r3(rot), area: q.area,
    hx: r3(ac * box.w / 2 + as * box.d / 2), hz: r3(as * box.w / 2 + ac * box.d / 2), h: r3(box.h), blocksSight: false, variant, host: hi,
    ...(q.level ? {level: q.level} : {})};
}

/** Splits the level's fixture-drawn merchandise into stock props (version 4 only; otherwise nothing). Returns what it did. */
export function splitSkywaysMerch(layout: StationLayout): MerchSplit {
  const out: MerchSplit = {tables: 0, walls: 0, rows: 0, props: []};
  if (skywaysGenVersion(layout) < 4) return out;
  const add = (p: PropPlacement) => { layout.props.push(p); out.props.push(p); };
  const n0 = layout.props.length;
  for (let i = 0; i < n0; i++) {
    const p = layout.props[i];
    if (p.cargo) continue;
    if (p.kind === 'techDisplay' && p.variant === 0) {
      p.variant = MERCH_BARE_VARIANT;
      p.h = DEMO_TABLE.top; // the bare table's box: its top (the devices stand ON it now)
      for (const d of DEMO_TABLE.devices) {
        const kind: PropKind = d.phone ? 'skyMerchDemoPhone' : 'skyMerchDemoTablet';
        add(hosted(layout, i, kind, d.x, d.z, DEMO_TABLE.top, d.turn ? Math.PI : 0, PROP_DEFS[kind], 0));
      }
      out.tables++;
    } else if (p.kind === 'deviceWall' && p.variant === 0) {
      p.variant = MERCH_BARE_VARIANT;
      for (const d of WALL_DEVICES) {
        const box = {w: d.x1 - d.x0, d: d.z1 - d.z0, h: d.y1 - WALL_DEVICE_CUT.y0};
        add(hosted(layout, i, d.kind, (d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2, WALL_DEVICE_CUT.y0, 0, box, d.variant));
      }
      out.walls++;
    } else if (p.kind === 'skyMuFacedRecords' && p.host !== undefined) {
      // the row's five sleeves along its ledge (row frame x), on the cover wall that hosts the row
      const hi = p.host, sleeves = facedRow(p.variant), c = Math.cos(p.rot), s = Math.sin(p.rot);
      const x0 = p.x, z0 = p.z, at = (x: number) => ({x: r3(x0 + x * c), z: r3(z0 - x * s)}); // (from the row's own place: p becomes sleeve 0)
      const ac = Math.abs(Math.cos(p.rot)), as = Math.abs(Math.sin(p.rot));
      const hx = r3(ac * FACED_LP.w / 2 + as * FACED_LP.d / 2), hz = r3(as * FACED_LP.w / 2 + ac * FACED_LP.d / 2);
      const base = {...p};
      sleeves.forEach((sl, k) => {
        const lp: PropPlacement = {...base, kind: 'skyMerchFacedLp', ...at(sl.x), hx, hz, h: FACED_LP.h, variant: sl.cover, host: hi};
        if (k === 0) Object.assign(p, lp); else add(lp);
      });
      out.rows++;
    }
  }
  return out;
}
