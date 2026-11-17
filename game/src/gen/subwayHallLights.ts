// Task studio-subway-architecture-materials-rework-20261117-072826-01: the HALL LIGHT PLAN of a Subway plan-family station (pure data, no
// three.js, no RNG).
//
// User: the version-2 grand hall is "a huge empty room with about 50 hanging lights, unrealistic and bad" — one gridLights call hung 65-95
// identical fluorescent pendants at 4.5 m on 2.7-4.1 m rods. A real hall is lit in its ARCHITECTURAL RHYTHM: the structural bays
// (gen/subwayBays.ts hallBays: the hall's own column rows, else an even ~7.5 m split) carry the light, and more identical pendants cannot
// stand in for design. For each big hall of a plan-family station (grand ticket hall, waiting hall, interchange hall, cavern end hall,
// any other ticket hall >= 600 m2; never a track-extension area) this pass REMOVES the dresser's fixtures and APPENDS a set in the bay
// rhythm, each hung from the VISIBLE soffit of the hall's ceiling form (gen/subwayCeilings.ts — what the renderer draws):
//  - 'drum' pendants, one per bay at the bay CENTRE on the nave's centre line (the band between two column rows / the version-3 nave; a
//    vault's or rock vault's crown line), their underside dropped min(2.6, (H - 4.2) * 0.6) below the soffit, never lower than 4.6 m
//    over the floor nor closer than DRUM_CLEAR under the soffit; warm;
//  - concealed 'cove' uplights on the bay-line LEDGES: one row BESIDE each transverse beam (beamW / 2 + COVE_BESIDE off the line, at
//    coveY; alternating sides line to line; flat: COVE_OFFSET off the line, just under the ceiling), evenly over the nave span less
//    COVE_INSET at each end, about one per COVE_STEP, every source of a row on the same along position (the kit draws one strip + ledge
//    per source, as long as the spacing to its row neighbour); along a vault's two springing ledges, about one per COVE_STEP
//    along each bay; warm, power ~0.7 (a wide nave thins its ledges so the hall keeps <= MAX_HALL_SOURCES, never below two a ledge);
//  - recessed 'downlight's in the side bands (outside the column rows, or the version-3 aisles), one per bay per band at the bay centre,
//    just under the local soffit (an aisle's own lower ceiling); never in a vault / rock form; neutral, power ~0.8;
//  - a hall lower than LOW_HALL gets no drums: two downlights per bay across (+ coves only where its bays come from columns).
// States are RNG-free (a hash of the seed, the area and the fixture index): ~5 % broken, ~8 % flickering, rarely dying, power +-0.1; the
// area keeps its lighting profile; fixtures near the player spawn stay steady; a lit hall keeps >= 60 % working. Lights are never saved:
// a recorded version-2 station regenerates every other record byte for byte (tests/subway-hall-v3.test.ts pins it).

import {CELL, FLOOR, type Grid} from './grid';
import {bayBounds, type HallBays} from './subwayBays';
import {ceilingFormOf, coveY, soffitAt, springCoves, type CeilingForm} from './subwayCeilings';
import {hallSectionWorld} from './hallSection';
import {CLOCK_LIGHT_OFFSET, frontAcross, frontClockSpot} from './hallFrontGeometry';
import {PROP_DEFS} from './props';
import {SPAWN_LIT_RADIUS, type Area, type HallFront, type HallSection, type LightPlacement, type SignPlacement, type StationLayout, type SubwayLightStyle} from './stationTypes';

/** Hall roles relit by the plan (any hall of type 'fare-hall' >= RELIT_FARE_M2 too). */
export const RELIT_ROLES: ReadonlySet<string> = new Set(['grand-ticket-hall', 'waiting-hall', 'interchange-hall', 'end-hall']);
export const RELIT_FARE_M2 = 600;
/** Floor-to-soffit height (m) below which a hall gets no drum pendants. */
export const LOW_HALL = 5.2;
/** Drum underside: never lower than this over the floor (m) ... */
export const DRUM_MIN_Y = 4.6;
/** ... nor closer than this under the visible soffit (the kit's lantern body + its stem, m). */
export const DRUM_CLEAR = 0.6;
/** Target spacing of cove sources along a ledge (m; the kit draws each cove strip out to its neighbours on the same ledge). */
export const COVE_STEP = 5.5;
/** A hall's fixture budget the ledges thin to (coves: never below two per ledge). */
export const MAX_HALL_SOURCES = 60;
/** Cove sources sit this far beside a beam's centre line on a beamless (flat) ceiling, alternating sides from line to line (m) ... */
export const COVE_OFFSET = 0.4;
/** ... and this far clear of a beam's side face (the kit draws the strip + ledge centred on the source: never inside the beam, m). */
export const COVE_BESIDE = 0.12;
/** A cove row's ledge stays this far inside its nave span (clear of the arcade / column line, m). */
export const COVE_INSET = 0.5;
/** Across-line offset of a bay line's cove row from the line (m): beside the beam where the form draws one. */
export const coveOffset = (form: Pick<CeilingForm, 'beamW'>): number => (form.beamW > 0 ? form.beamW / 2 + COVE_BESIDE : COVE_OFFSET);
/** Downlight lens below the local soffit (m). */
export const DOWNLIGHT_DROP = 0.05;
/** Flat ceilings: cove strip below the ceiling (m). */
const FLAT_COVE_DROP = 0.9;
/** Bands narrower than this get no fixture line (m). */
const MIN_BAND = 2;

/** Base power of each style (a lit hall jitters it by +-POWER_JITTER). */
const BASE_POWER: Readonly<Record<SubwayLightStyle, number>> = {drum: 0.92, cove: 0.7, downlight: 0.8};
const POWER_JITTER = 0.1;
const WARM: Readonly<Record<SubwayLightStyle, boolean>> = {drum: true, cove: true, downlight: false};
/**
 * Task studio-subway-rework-m2-finishing-20261117-111246-01 (lane FRONTS): the styled fixtures' COLOUR TEMPERATURE per station scheme
 * (LightPlacement.tint: linear RGB, ~unit luminance — world/lightFieldLayout.ts fixtureTint gives it to the baked field, the probes and the
 * runtime tubes / glow, and the enhanced-lighting digest reads it). The review: one warm tint on every lantern / cove turned civic and
 * brutalist halls "the same warm brown" as heritage. Heritage / terracotta / municipal and the caverns keep the warm lanterns and neutral
 * downlights (no tint: fixtureTint's defaults); civic takes a neutral white, moderne a clean neutral, brutalist a cool white — every styled
 * fixture of the hall alike. Render-only: lights are never saved, positions / states / counts are unchanged.
 */
export const SCHEME_TINT: Readonly<Record<string, readonly [number, number, number]>> = {
  civic: [1.06, 1.0, 0.88],
  moderne: [1.02, 1.0, 0.96],
  brutalist: [0.94, 1.0, 1.1],
};
/** The styled hall fixtures' tint of a station (undefined: the warm / neutral defaults). */
export const hallFixtureTint = (layout: Pick<StationLayout, 'identity'>): readonly [number, number, number] | undefined => SCHEME_TINT[layout.identity?.theme ?? ''];
/** An office front's fixtures: one per booth window (the dresser's booth pitch), at most this many. */
const OFFICE_PITCH = 3.0, OFFICE_MAX = 4;
/** A wall front's own fixtures replace the side band's generic downlight of every bay it covers by at least this share. */
const FRONT_BAY_SHARE = 0.35;
/** A nave island's lantern hangs this far across from a waiting island's centre (clear of its hung clock). */
export const NAVE_CLOCK_CLEAR = 1.5;
/** A nave island is already under its bay's lantern when that hangs within this far across of its centre (m). */
export const NAVE_LANTERN_REACH = 3.5;
/** A front's own fixture keeps this far (plan, m) from every hung plate of the hall (its drop rods, its edge). */
export const SIGN_CLEAR = 0.5;
const BROKEN = 0.05, FLICKER = 0.08, DYING = 0.012;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Is `a` a hall the plan relights? */
export function relitHall(a: Area): boolean {
  if (a.ext) return false;
  return RELIT_ROLES.has(a.role ?? '') || (a.type === 'fare-hall' && a.w * a.h * CELL * CELL >= RELIT_FARE_M2);
}

/** Per-hall result of the pass (tests / QA). */
export interface HallLightReport { area: number; role: string; before: number; after: number; styles: Record<SubwayLightStyle, number>; form: string; fromColumns: boolean }

/** A fixture of the plan before its state: where it hangs and what it is (`rank`: a front's k-th own fixture, trimmed last-first). */
interface Spot { x: number; y: number; z: number; rot: number; style: SubwayLightStyle; rank?: number }

/** Relights every relit hall of a plan-family layout (in place). Returns the per-hall report. */
export function planHallLights(layout: StationLayout): HallLightReport[] {
  const halls = layout.areas.filter(relitHall);
  if (!halls.length) return [];
  const ids = new Set(halls.map(a => a.id));
  const before = new Map<number, number>();
  for (const l of layout.lights) if (ids.has(l.area)) before.set(l.area, (before.get(l.area) ?? 0) + 1);
  const kept = layout.lights.filter(l => !ids.has(l.area));
  const out: HallLightReport[] = [];
  const added: LightPlacement[] = [];
  for (const a of halls) {
    const g = gridOf(layout, a);
    const form = ceilingFormOf(layout, a);
    const spots = hallSpots(a, form, g, layout.signs.filter(s => s.area === a.id && s.hang));
    const lights = spots.map((s, i) => stateOf(layout, a, s, i));
    settle(layout, a, lights);
    added.push(...lights);
    const styles = {drum: 0, cove: 0, downlight: 0};
    for (const l of lights) styles[l.style!]++;
    out.push({area: a.id, role: a.role ?? a.type, before: before.get(a.id) ?? 0, after: lights.length, styles, form: form.kind, fromColumns: form.bays.fromColumns});
  }
  layout.lights = [...kept, ...added];
  return out;
}

function gridOf(layout: StationLayout, a: Area): Grid {
  return layout.levels?.[a.level ?? 0]?.grid ?? layout.grid;
}

// ---------------------------------------------------------------------------------------------
// Where the fixtures hang

/** The across bands of a hall: the nave (drums) and the side bands (downlights). */
function bandsOf(a: Area, b: HallBays, form: CeilingForm): {nave: [number, number] | null; sides: [number, number][]} {
  const S = hallSectionWorld(a);
  if (S) return {nave: S.nave, sides: S.aisles.filter(([p, q]) => q - p >= MIN_BAND)};
  const rows = b.rows.filter(r => r > b.c0 + 1 && r < b.c1 - 1);
  const width = b.c1 - b.c0, mid = (b.c0 + b.c1) / 2;
  if (form.kind === 'vault' || form.kind === 'rock') return {nave: [b.c0, b.c1], sides: []}; // (the crown line: drums; the springs: coves)
  if (rows.length >= 2) {
    const sides: [number, number][] = [[b.c0, rows[0]], [rows[rows.length - 1], b.c1]];
    return {nave: [rows[0], rows[rows.length - 1]], sides: sides.filter(([p, q]) => q - p >= MIN_BAND)};
  }
  if (rows.length === 1) {
    // one row (near the centre): the wider band is the nave, the other a side band
    const lo: [number, number] = [b.c0, rows[0]], hi: [number, number] = [rows[0], b.c1];
    const [n, s] = rows[0] >= mid ? [lo, hi] : [hi, lo];
    return {nave: n, sides: s[1] - s[0] >= MIN_BAND ? [s] : []};
  }
  if (width > 14) return {nave: [b.c0 + width / 4, b.c1 - width / 4], sides: [[b.c0, b.c0 + width / 4], [b.c1 - width / 4, b.c1]]};
  return {nave: [b.c0, b.c1], sides: []};
}

/** The fixtures of one hall in the bay rhythm (drums, then coves, then downlights; each along the hall; then the fronts' own). */
export function hallSpots(a: Area, form: CeilingForm, g: Grid, signs: readonly SignPlacement[] = []): Spot[] {
  const b = form.bays;
  const bays = bayBounds(b);
  const at = (along: number, across: number): [number, number] => (b.alongX ? [along, across] : [across, along]);
  const rotAlong = b.alongX ? 0 : Math.PI / 2, rotAcross = b.alongX ? Math.PI / 2 : 0;
  const vaulted = form.kind === 'vault' || form.kind === 'rock';
  const {nave, sides} = bandsOf(a, b, form);
  const crown = (b.c0 + b.c1) / 2;
  const height = (along: number, across: number) => { const [x, z] = at(along, across); return soffitAt(form, x, z, g) - form.floor; };
  const low = height((b.a0 + b.a1) / 2, nave ? (nave[0] + nave[1]) / 2 : crown) < LOW_HALL;
  const spots: Spot[] = [];
  const push = (along: number, across: number, y: number, rot: number, style: SubwayLightStyle, rank?: number) => {
    const [x, z] = at(along, across);
    spots.push({x: r3(x), y: r2(y), z: r3(z), rot, style, ...(rank !== undefined ? {rank} : {})});
  };
  // drums: one per bay at its centre on the nave's centre line (a vault's crown)
  const drumLine = vaulted ? crown : nave ? (nave[0] + nave[1]) / 2 : null;
  const drumY = (along: number, across: number): number | null => {
    const [x, z] = at(along, across);
    const s = soffitAt(form, x, z, g), H = s - form.floor;
    const y = Math.min(s - Math.min(2.6, Math.max(0, (H - 4.2) * 0.6)), s - DRUM_CLEAR);
    return y >= form.floor + DRUM_MIN_Y ? y : null;
  };
  // (lane FRONTS) a version-3 hall's fronts: the side-band bays their own fixtures replace, the nave islands' lanterns
  const S = hallSectionWorld(a);
  const fp = S && !low && !vaulted ? frontPlan(a, S, bays, sides, drumLine, signs) : null;
  if (drumLine !== null && (!low || vaulted)) {
    bays.forEach(([p, q], bi) => {
      const line = fp?.drumAcross.get(bi) ?? drumLine;
      const y = drumY((p + q) / 2, line);
      if (y !== null) push((p + q) / 2, line, y, rotAlong, 'drum');
    });
  }
  // coves: on the ledges (bay lines: beside each beam over the nave span; vaults: along both springs)
  if (!low || b.fromColumns) {
    if (vaulted) {
      for (const across of springCoves(form)) for (const [p, q] of bays) {
        const n = Math.max(1, Math.round((q - p) / COVE_STEP));
        for (let i = 0; i < n; i++) push(p + (q - p) * (i + 0.5) / n, across, form.spring + 0.15, rotAlong, 'cove');
      }
    } else {
      // (the row's ledge — strips as long as the spacing, centred on each source — keeps COVE_INSET inside the nave span)
      const band = nave ?? [b.c0, b.c1];
      const span: [number, number] = band[1] - band[0] > 4 * COVE_INSET ? [band[0] + COVE_INSET, band[1] - COVE_INSET] : band;
      // (a wide nave — the version-3 gate-aisle hall's — thins its ledges so the hall keeps <= MAX_HALL_SOURCES; each front's FIRST own
      // fixture less the generic downlights the fronts replace counts too: a front's extras are trimmed at the end, never a ledge for them)
      const others = spots.length + (vaulted ? 0 : (low ? 2 : sides.length) * bays.length) + (fp ? Math.max(0, fp.spots.filter(f => f.rank === 0).length - fp.replaced.size) : 0);
      const n = Math.max(2, Math.min(Math.round((span[1] - span[0]) / COVE_STEP), Math.floor((MAX_HALL_SOURCES - others) / Math.max(1, b.lines.length))));
      const y = form.kind === 'flat' ? form.ceil - FLAT_COVE_DROP : coveY(form);
      b.lines.forEach((line, li) => {
        // beside the beam (alternating sides line to line), every source of the row on exactly the same along position
        const along = r3(line + (li % 2 ? 1 : -1) * coveOffset(form));
        if (along < b.a0 + 0.3 || along > b.a1 - 0.3) return;
        for (let i = 0; i < n; i++) push(along, span[0] + (span[1] - span[0]) * (i + 0.5) / n, y, rotAcross, 'cove');
      });
    }
  }
  // downlights: the side bands (low halls: two per bay across), never under a vault
  if (!vaulted) {
    const lines = low ? lowDownlightLines(b, nave, sides) : sides.map(([p, q]) => (p + q) / 2);
    lines.forEach((across, li) => bays.forEach(([p, q], bi) => {
      if (fp?.replaced.has(`${li}:${bi}`)) return;
      const along = (p + q) / 2, [x, z] = at(along, across), s = soffitAt(form, x, z, g);
      // (lane FRONTS) a 'transept' hall's crossing: its aisle cells keep the nave ceiling (gen/stationHallV3.ts), so the side band's
      // "recessed downlight just under the local soffit" sat in the coffers ~8.9 m up (soffit - DOWNLIGHT_DROP: 8.87 m at the transept
      // seed 3, over a 4.5 m aisle elsewhere), a weak dot over the ~16 m crossing aisle. There the band hangs a lantern at the nave's drum
      // height instead (drumY: 6.32 m there) — the crossing reads as the full-height space it is and its aisle floor is lit like the nave's.
      if (S?.transept && along > S.transept[0] && along < S.transept[1] && s > S.aisleCeil + 0.5) {
        const y = drumY(along, across);
        if (y !== null) { push(along, across, y, rotAlong, 'drum'); return; }
      }
      push(along, across, s - DOWNLIGHT_DROP, 0, 'downlight');
    }));
  }
  // (lane FRONTS) the fronts' own fixtures: a recessed downlight under the aisle soffit, a lantern where the front stands under a full
  // height (the transept's crossing, the gate-aisle hall's nave wall)
  if (fp) for (const f of fp.spots) {
    const [x, z] = at(f.along, f.across), s = soffitAt(form, x, z, g);
    const y = s > S!.aisleCeil + 0.5 ? drumY(f.along, f.across) : null;
    if (y !== null) push(f.along, f.across, y, rotAlong, 'drum', f.rank);
    else push(f.along, f.across, s - DOWNLIGHT_DROP, 0, 'downlight', f.rank);
  }
  const out = spots.filter(s => fits(a, g, s));
  // the hall budget: a front's extra fixtures go first (its first one last); the architectural rhythm is never trimmed for them
  while (out.length > MAX_HALL_SOURCES) {
    let k = -1;
    for (let i = 0; i < out.length; i++) if (out[i].rank !== undefined && (k < 0 || out[i].rank! >= out[k].rank!)) k = i;
    if (k < 0) break;
    out.splice(k, 1);
  }
  return out;
}

/**
 * (lane FRONTS) A hall's fronts in its light plan: each WALL front's own fixtures (an office: one over the counter apron per booth window;
 * a waiting group: one over its benches, clear of its hung clock; a kiosk / service point: one over its counter apron) REPLACE the side
 * band's generic downlight of every bay the front covers (the hall keeps its count and its >= 60 % working rule); a NAVE island takes its
 * bay's lantern across over it (a waiting island's beside its clock), so the drum count and the bay rhythm along the hall stay.
 */
function frontPlan(a: Area, S: HallSection, bays: [number, number][], sides: [number, number][], drumLine: number | null, signs: readonly SignPlacement[]):
  {spots: {along: number; across: number; rank: number}[]; replaced: Set<string>; drumAcross: Map<number, number>} {
  const spots: {along: number; across: number; rank: number}[] = [], replaced = new Set<string>(), drumAcross = new Map<number, number>();
  // a point in the hall frame (along, across) -> world (x, z); the hung plates' plan segments (a fixture keeps clear of their rods)
  const W = (along: number, across: number): [number, number] => (S.alongX ? [along, across] : [across, along]);
  const hung = signs.filter(s => s.hang).map(s => { const h = (s.w ?? 1.4) / 2, dx = Math.cos(s.rot) * h, dz = -Math.sin(s.rot) * h; return [s.x - dx, s.z - dz, s.x + dx, s.z + dz]; });
  const segDist = (x: number, z: number, [x0, z0, x1, z1]: number[]) => {
    const vx = x1 - x0, vz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / Math.max(1e-9, vx * vx + vz * vz)));
    return Math.hypot(x - x0 - vx * t, z - z0 - vz * t);
  };
  for (const f of S.fronts ?? []) {
    const lo = Math.min(f.along[0], f.along[1]), hi = Math.max(f.along[0], f.along[1]), mid = (lo + hi) / 2;
    const c = (f.across[0] + f.across[1]) / 2;
    const li = sides.findIndex(([p, q]) => c > p && c < q);
    if (f.wall === 'nave' && li < 0) {
      // a nave island: under its bay's lantern already when that hangs within NAVE_LANTERN_REACH across of it (kept on its line), else
      // the lantern hangs over it — a waiting island's NAVE_CLOCK_CLEAR beside its hung clock, never on it
      const bi = bays.findIndex(([p, q]) => mid >= p && mid < q);
      if (bi < 0 || drumLine === null || drumAcross.has(bi)) continue;
      const d = drumLine - c, side = d < 0 ? -1 : 1;
      if (f.kind === 'waiting') { if (Math.abs(d) < NAVE_CLOCK_CLEAR || Math.abs(d) > NAVE_LANTERN_REACH) drumAcross.set(bi, r3(c + side * NAVE_CLOCK_CLEAR)); }
      else if (Math.abs(d) > NAVE_LANTERN_REACH) drumAcross.set(bi, r3(c));
      continue;
    }
    // a wall front, or a group standing in an aisle beside its arcade: its own fixtures (clear of the hung plates and of its clock),
    // in place of the aisle's generic downlight of every bay it covers
    const clock = f.kind === 'waiting' ? frontClockSpot(a, S, f) : null;
    frontFixtures(a, S, f, lo, hi).forEach((o, k) => {
      const ok = (along: number) => {
        const [x, z] = W(along, o.across);
        if (clock && Math.hypot(along - clock.along, o.across - clock.across) < 1.0) return false;
        return hung.every(s => segDist(x, z, s) >= SIGN_CLEAR);
      };
      const along = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8].map(d => o.along + d).find(v => v >= lo - 0.3 && v <= hi + 0.3 && ok(v)) ?? o.along;
      spots.push({along: r3(along), across: o.across, rank: k});
    });
    if (li < 0) continue;
    bays.forEach(([p, q], bi) => { if (Math.min(hi, q) - Math.max(lo, p) >= FRONT_BAY_SHARE * (q - p)) replaced.add(`${li}:${bi}`); });
  }
  return {spots, replaced, drumAcross};
}

/** A wall front's own fixture points (along, across), its most important first. */
function frontFixtures(a: Area, S: HallSection, f: HallFront, lo: number, hi: number): {along: number; across: number}[] {
  if (f.kind === 'office') {
    const n = Math.max(1, Math.min(OFFICE_MAX, Math.round((hi - lo) / OFFICE_PITCH)));
    const across = frontAcross(a, S, f, PROP_DEFS.booth.d + 0.7);
    const out = Array.from({length: n}, (_, i) => ({along: r3(lo + (hi - lo) * (i + 0.5) / n), across: r3(across)}));
    // (the middle windows first: a trimmed office keeps its centre lit)
    return out.sort((p, q) => Math.abs(p.along - (lo + hi) / 2) - Math.abs(q.along - (lo + hi) / 2) || p.along - q.along);
  }
  if (f.kind === 'waiting') {
    const clock = frontClockSpot(a, S, f);
    const along = clock.along + CLOCK_LIGHT_OFFSET <= hi - 0.3 || clock.along - CLOCK_LIGHT_OFFSET < lo + 0.3 ? clock.along + CLOCK_LIGHT_OFFSET : clock.along - CLOCK_LIGHT_OFFSET;
    return [{along: r3(along), across: r3(frontAcross(a, S, f, 0.9))}];
  }
  return [{along: r3((lo + hi) / 2), across: r3(frontAcross(a, S, f, 1.2))}];
}

/** A low hall's two downlight lines across: the centres of its two widest bands, else its quarter points. */
function lowDownlightLines(b: HallBays, nave: [number, number] | null, sides: [number, number][]): number[] {
  const bands = [...(nave ? [nave] : []), ...sides].filter(([p, q]) => q - p >= MIN_BAND).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  if (bands.length >= 2 && b.rows.length) return bands.slice(0, 2).map(([p, q]) => (p + q) / 2).sort((p, q) => p - q);
  const w = b.c1 - b.c0;
  return [b.c0 + w / 4, b.c1 - w / 4];
}

/** A fixture stands over a floor cell of its hall, off any stair flight, under the cell's own ceiling. */
function fits(a: Area, g: Grid, s: Spot): boolean {
  const cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL);
  if (!g.inBounds(cx, cz)) return false;
  const i = g.idx(cx, cz);
  if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.rampIdx[i] >= 0) return false;
  if (g.hasCeil(i) && s.y > g.ceil[i] - 0.02) s.y = r2(g.ceil[i] - DOWNLIGHT_DROP);
  return true;
}

// ---------------------------------------------------------------------------------------------
// States (RNG-free)

/** Deterministic unit value of (seed, area, fixture index, channel). */
export function lightHash(seed: number, area: number, index: number, channel: number): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (const v of [area, index, channel, 0x5bd1e995]) {
    h = Math.imul(h ^ (v >>> 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return (h >>> 0) / 4294967296;
}

function stateOf(layout: StationLayout, a: Area, s: Spot, i: number): LightPlacement {
  const u = (c: number) => lightHash(layout.seed, a.id, i, c);
  const l: LightPlacement = {x: s.x, y: s.y, z: s.z, rot: s.rot, area: a.id, broken: false, flicker: false, warm: WARM[s.style], power: 1, dying: false, style: s.style};
  if (a.level) l.level = a.level;
  const tint = hallFixtureTint(layout); // (lane FRONTS) the scheme's colour temperature
  if (tint) l.tint = tint;
  const base = BASE_POWER[s.style];
  if (a.lighting === 'lit') {
    l.power = r2(Math.min(1, base + (u(0) * 2 - 1) * POWER_JITTER));
    l.broken = u(1) < BROKEN;
    l.flicker = !l.broken && u(2) < FLICKER;
    if (!l.broken && u(3) < DYING) { l.dying = true; l.flicker = true; l.power = 0.5; }
  } else if (a.lighting === 'dim') {
    l.power = r2(base * (0.55 + (u(0) * 2 - 1) * 0.1));
    l.broken = u(1) < 0.45;
    l.flicker = !l.broken && u(2) < 0.35;
  } else {
    l.broken = true;
    if (u(3) < 0.05) { l.broken = false; l.dying = true; l.flicker = true; l.power = 0.5; }
  }
  return l;
}

/** The hall-wide rules: a lit hall keeps >= 60 % steady fixtures, a dim one at least one, and lit fixtures near the spawn are steady. */
function settle(layout: StationLayout, a: Area, own: LightPlacement[]): void {
  if (!own.length) return;
  if (a.lighting === 'lit') {
    const need = Math.max(1, Math.ceil(own.length * 0.6));
    let steady = own.filter(l => !l.broken && !l.dying).length;
    for (const l of own) {
      if (steady >= need) break;
      if (l.broken || l.dying) { l.broken = false; l.dying = false; l.flicker = false; l.power = BASE_POWER[l.style!]; steady++; }
    }
    const sp = layout.playerSpawn;
    for (const l of own) if (Math.hypot(l.x - sp.x, l.z - sp.z) < SPAWN_LIT_RADIUS) { l.broken = false; l.flicker = false; l.dying = false; l.power = 1; }
  } else if (a.lighting === 'dim' && !own.some(l => !l.broken)) own[0].broken = false;
}
