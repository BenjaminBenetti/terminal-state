// Task studio-subway-rework-m2-finishing-20261117-111246-01: THE CAVERN'S NEUTRAL RELIEF — the part of the Subway kit (world/subwayKit.ts)
// a rock-cut station (the cavern family: scheme.rock, world/subwayFinish.ts) draws on its public walls. Render-only boxes through the kit's
// trim sink (no collision, nav, layout or light changes); deterministic from the layout alone.
//
// User (main visual review M2): the cavern "has real curved architecture but remains almost entirely the same red-orange rough surface.
// Keep its strong identity hue, but use believable neutral stone / plinth / door / service / waiting accents and hierarchy so it reads as a
// functioning rock-cut station, not a single-material orange tunnel." The painted rock keeps the walls above head height and the vault; the
// scheme's dado zone is now a honed grey granite WAINSCOT (world/subwayArch.ts zoneFinish), and this file adds, all in neutral finishes:
//  - the wainscot's CAP (light precast, the scheme's trim) at the dado height;
//  - PORTAL FRAMES (precast jambs + lintel, the scheme's accent) around every public door / arch in a rock wall — beside and above the
//    opening, never across it;
//  - a spring-line LEDGE (a two-step precast string course) along a rock vault's long walls where the vault springs, and the same line as a
//    cornice where a tall rock wall meets its ceiling;
//  - BACKING PANELS (vitreous enamel, the scheme's panel, under a precast cap) on the wall behind benches and the service / waiting
//    equipment that stands against it (help points, phones, fire / first-aid cabinets, machines, kiosks), above the wainscot.

import type {Area, StationLayout} from '../gen/stationTypes';
import type {PropKind} from '../gen/props';
import {VAULT_GAP, type CeilingForm} from '../gen/subwayCeilings';
import type {TreatFace} from './wallDetailFaces';
import {ZONES} from './subwayFinish';
import type {SubwayArch} from './subwayArch';

export interface CavernKitStats { caps: number; portals: number; jambs: number; ledges: number; backings: number }

/** What the kit hands the cavern relief. */
export interface CavernKitApi {
  layout: StationLayout;
  sub: SubwayArch;
  /** The kit's (merged, non-sloped) Subway wall faces. */
  faces: readonly TreatFace[];
  box(mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void;
  /** [0, len] minus the blocked spans (pieces shorter than `min` dropped). */
  freeSpans(len: number, blocked: [number, number][], min?: number): [number, number][];
  /** Spans along a face kept clear of relief (props standing against it, wall-mounted signs). */
  nearWall(f: TreatFace): [number, number][];
  /** The kit's ceiling form of an area (null: flat). */
  formOf(a: Area): CeilingForm | null;
}

/** Wainscot cap (height, proud). */
export const WAINSCOT_CAP = {h: 0.06, proud: 0.045} as const;
/**
 * Portal frames: jamb width / proud, lintel height (+ the lintel's extra proud), the openings framed (width range, head at least minTop
 * above the floor) and the clearance kept from the face's ends.
 */
export const PORTAL = {jamb: 0.4, proud: 0.16, lintel: 0.36, lintelProud: 0.02, minW: 0.8, maxW: 9, minTop: 1.9, end: 0.15} as const;
/** The spring-line ledge: a fillet under a deeper ledge (heights, proud). */
export const LEDGE = {fillet: 0.08, filletProud: 0.07, h: 0.18, proud: 0.17} as const;
/** Backing panels above the wainscot (heights above the floor, proud, margin beyond the prop, its cap). */
export const BACKING = {y0: ZONES.dado + WAINSCOT_CAP.h / 2, y1: 2.35, proud: 0.03, pad: 0.25, cap: 0.05, capProud: 0.05, min: 0.5} as const;
/** The kinds that get a backing panel on the rock wall behind them (waiting and service equipment standing against it). */
export const BACKED_KINDS: ReadonlySet<PropKind> = new Set<PropKind>([
  'bench', 'payphone', 'ticketMachine', 'vending', 'infoTouchKiosk', 'subwayMapKiosk', 'fieldPhoneBox', 'emergencyCallPoint',
  'fireExtinguisherCabinet', 'aedWallCabinet', 'fireHoseReelCabinet', 'electricalPanel', 'disconnectSwitch', 'wallDataCabinet', 'waterCooler',
] as PropKind[]);

/** Do two spans overlap (by more than eps)? */
const overlaps = (a: readonly [number, number], b: readonly [number, number], eps = 1e-3) => a[1] > b[0] + eps && a[0] < b[1] - eps;

export function buildCavernKit(api: CavernKitApi): CavernKitStats {
  const {layout, sub} = api;
  const st: CavernKitStats = {caps: 0, portals: 0, jambs: 0, ledges: 0, backings: 0};
  if (!sub.scheme.rock) return st;
  const trim = sub.trimKey(), accent = sub.accentKey(), panel = sub.panelKey();

  for (const f of api.faces) {
    const a = f.area >= 0 ? layout.areas[f.area] : undefined;
    if (!sub.publicArea(a) || f.zone === 'trackbed' || f.slope) continue;
    const alongX = Math.abs(f.z1 - f.z0) < 1e-6;
    const len = alongX ? Math.abs(f.x1 - f.x0) : Math.abs(f.z1 - f.z0);
    if (len < 0.4) continue;
    const dir = Math.sign(alongX ? f.x1 - f.x0 : f.z1 - f.z0) || 1, s0w = alongX ? f.x0 : f.z0;
    const plane = alongX ? f.z0 : f.x0, n = alongX ? f.nz : f.nx;
    const floor = f.base;
    /** A run along the face at [sa, sb], [y0, y1], `proud` out of the wall. */
    const run = (mat: string, sa: number, sb: number, y0: number, y1: number, proud: number) => {
      const w0 = s0w + dir * sa, w1 = s0w + dir * sb, mid = (w0 + w1) / 2, L = Math.abs(w1 - w0), q = plane + (n * proud) / 2;
      if (alongX) api.box(mat, mid, (y0 + y1) / 2, q, L, y1 - y0, proud); else api.box(mat, q, (y0 + y1) / 2, mid, proud, y1 - y0, L);
    };
    const covers = (y0: number, y1: number) => f.y0 <= y0 + 1e-3 && f.y1 >= y1 - 1e-3;
    const openAt = (y: number, pad = 0.02): [number, number][] => f.openings.filter(o => o.top > y).map(o => [o.s0 - pad, o.s1 + pad]);
    const keep = api.nearWall(f);

    // the wainscot's cap
    const capY = floor + ZONES.dado;
    if (covers(capY - WAINSCOT_CAP.h, capY + WAINSCOT_CAP.h)) {
      for (const [sa, sb] of api.freeSpans(len, [...openAt(capY), ...keep], 0.25)) {
        run(trim, sa, sb, capY - WAINSCOT_CAP.h / 2, capY + WAINSCOT_CAP.h / 2, WAINSCOT_CAP.proud);
        st.caps++;
      }
    }

    // portal frames around the public openings
    for (const o of f.openings) {
      const w = o.s1 - o.s0;
      if (w < PORTAL.minW || w > PORTAL.maxW || o.top - floor < PORTAL.minTop || !covers(floor, o.top + 0.15)) continue;
      const others = f.openings.filter(p => p !== o).map(p => [p.s0 - 0.05, p.s1 + 0.05] as [number, number]);
      const lintelTop = Math.min(o.top + PORTAL.lintel, f.y1 - 0.02);
      const lintel = lintelTop - o.top >= 0.15;
      const top = lintel ? lintelTop : o.top;
      let drawn = 0, lo = o.s0, hi = o.s1;
      for (const span of [[o.s0 - PORTAL.jamb, o.s0], [o.s1, o.s1 + PORTAL.jamb]] as [number, number][]) {
        const j: [number, number] = [Math.max(PORTAL.end, span[0]), Math.min(len - PORTAL.end, span[1])];
        if (j[1] - j[0] < 0.2 || others.some(p => overlaps(j, p)) || keep.some(p => overlaps(j, p))) continue;
        run(accent, j[0], j[1], floor, top, PORTAL.proud);
        lo = Math.min(lo, j[0]); hi = Math.max(hi, j[1]);
        drawn++; st.jambs++;
      }
      if (lintel) {
        // over the opening and its jambs; never across a neighbouring opening that rises past this one's head
        const blocked = f.openings.filter(p => p !== o && p.top > o.top).map(p => [p.s0 - 0.05 - lo, p.s1 + 0.05 - lo] as [number, number]);
        for (const [sa, sb] of api.freeSpans(hi - lo, blocked, 0.3)) { run(accent, lo + sa, lo + sb, o.top, lintelTop, PORTAL.proud + PORTAL.lintelProud); drawn++; }
      }
      if (drawn) st.portals++;
    }

    // the spring-line ledge along a rock vault's long walls; a cornice where a tall rock wall meets its ceiling
    const form = a ? api.formOf(a) : null;
    const longWall = !!form && form.bays.alongX === alongX;
    let ledgeTop = NaN;
    if (form && (form.kind === 'rock' || form.kind === 'vault')) { if (longWall) ledgeTop = form.spring - VAULT_GAP; }
    else if (a && f.y1 >= a.ceil - 0.05 && f.y1 - floor >= 3.6) ledgeTop = f.y1;
    if (Number.isFinite(ledgeTop) && covers(ledgeTop - LEDGE.h - LEDGE.fillet, ledgeTop)) {
      const y1 = ledgeTop, ym = y1 - LEDGE.h, y0 = ym - LEDGE.fillet;
      for (const [sa, sb] of api.freeSpans(len, openAt(y0 - 0.3, 0.05), 0.3)) {
        run(trim, sa, sb, y0, ym, LEDGE.filletProud);
        run(trim, sa, sb, ym, y1 - 0.005, LEDGE.proud);
        st.ledges++;
      }
    }

    // backing panels behind the benches and the service / waiting equipment against the wall
    if (panel && covers(floor + BACKING.y0, floor + BACKING.y1 + BACKING.cap)) {
      const sOf = (wpos: number) => (wpos - s0w) * dir;
      const want: [number, number][] = [];
      for (const p of layout.props) {
        if (!BACKED_KINDS.has(p.kind) || Math.abs(p.y - floor) > 0.6) continue;
        const off = ((alongX ? p.z : p.x) - plane) * n, half = alongX ? p.hz : p.hx;
        if (off - half > 0.35 || off + half < -0.05) continue;
        const c = alongX ? p.x : p.z, e = alongX ? p.hx : p.hz, s1 = sOf(c - e), s2 = sOf(c + e);
        want.push([Math.min(s1, s2) - BACKING.pad, Math.max(s1, s2) + BACKING.pad]);
      }
      if (want.length) {
        // never over an opening or a wall-mounted sign plate
        const blocked: [number, number][] = openAt(floor + BACKING.y0, 0.1);
        for (const s of layout.signs) {
          if (s.hang) continue;
          const off = ((alongX ? s.z : s.x) - plane) * n;
          if (off < -0.05 || off > 0.3 || s.y < floor + BACKING.y0 - 0.5 || s.y > floor + BACKING.y1 + 0.5) continue;
          const c = sOf(alongX ? s.x : s.z), hw = (s.w ?? 1.4) / 2 + 0.1;
          blocked.push([c - hw, c + hw]);
        }
        const free = api.freeSpans(len, [[-1, 0.1], [len - 0.1, len + 1], ...blocked], 0.01);
        for (const [wa, wb] of joinWanted(want)) {
          for (const [fa, fb] of free) {
            const sa = Math.max(wa, fa), sb = Math.min(wb, fb);
            if (sb - sa < BACKING.min) continue;
            run(panel, sa, sb, floor + BACKING.y0, floor + BACKING.y1, BACKING.proud);
            run(trim, sa, sb, floor + BACKING.y1, floor + BACKING.y1 + BACKING.cap, BACKING.capProud);
            st.backings++;
          }
        }
      }
    }
  }
  return st;
}

/** The wanted backing spans, overlaps joined. */
function joinWanted(list: [number, number][]): [number, number][] {
  const s = [...list].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1] + 0.1) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
