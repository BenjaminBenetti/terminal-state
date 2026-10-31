// Task track3-eaton-centre-20261031 (lane ARCH): daylight through The Eaton's Center's glass roof, baked into the station light
// field (world/lightField.ts) — PURE (no three.js / DOM). The atrium is 35-45 m tall: fixture sources (range <= ~11 m) cannot
// carry daylight from the vault to the plaza, so the bake gets an extra direct term (FieldSource.extraDirect) for the mall only.
//
// Model: an overcast sky of radiance SKY.radiance (x the dirty / broken glazing's transmittance) seen through the roof glazing.
// For every voxel of every level slot within SKY.reach of the void, NA azimuths are marched through the union of free bands (the
// same union-of-open-columns geometry as every other light ray): along an azimuth the set of ray slopes t = tan(elevation) that
// stay inside free space is an interval, narrowed by every column's band floor (entry) and ceiling (exit); in a SKY column (a
// band rising to the springing line, under the glazing) every slope that reaches the springing line before leaving the column
// escapes to the sky. The escaped slope intervals integrate analytically:
//   fluence  += L * dphi * (sin(tb) - sin(ta))                         (solid angle of the elevation band)
//   direction+= L * dphi * [ (th/2 + sin(2 th)/4) (cos phi, sin phi),  (sin^2 tb - sin^2 ta) / 2 ]   (toward the sky)
// so a plaza point under a narrow, deep void gets near-vertical, mostly directional daylight, a gallery a few metres from the
// edge a slanted shaft of light from the void side, a shop 10 m deep almost nothing, and the top rings more than the bottom. Light
// never passes a slab or a wall (the bands); the glazing is transmissive (never an opaque blocker). Bounce fill follows from the
// bake's own bounce pass. Bounded: receivers within SKY.reach of a sky column only, NA azimuths, marches stop when the slope
// interval closes or after SKY.march metres.

/** Skylight tunables (field units: FIELD_EMAX 12 = the encode ceiling; a fixture pool is ~2-4). */
export const SKY = {
  /** Sky radiance per steradian (field units) before the glazing. */
  radiance: 3.4,
  /** Transmittance of 30-year-old dirty glazing with some panes broken out. */
  glazing: 0.62,
  /** Overcast daylight through the green murk (linear RGB, ~unit luminance; cf. gen/office DAYLIGHT_TINT). */
  tint: [0.84, 1.0, 0.9] as readonly [number, number, number],
  /** Receivers lie within this horizontal distance of a sky column (m). */
  reach: 12,
  /** Azimuth samples per voxel. */
  azimuths: 8,
  /** Longest horizontal march (m). */
  march: 50,
  /** Steepest slope considered (tan of ~88.5 deg); the zenith cap above it is added for sky columns. */
  tMax: 38,
  /** Shallowest slope considered (tan ~7 deg): grazing sky contributes little (sin-weighted) and costs the longest marches. */
  tMin: 0.12,
  /** Receivers are evaluated once per BLOCK x BLOCK cells (same slot and band) and shared: daylight is smooth (linear filter). */
  block: 2,
};

/** Union of free bands per column (start/f/c as world/lightField.ts unionBands). */
export interface SkyBands { start: Int32Array; f: Float32Array; c: Float32Array }

/** One level slot's column geometry (world/lightField.ts ColumnGeometry subset). */
export interface SkySlot { open: Uint8Array; floorH: Float32Array; ceilH: Float32Array; layerY: Float32Array }

export interface SkySpec {
  /** Springing line of the glazing (absolute y): rays reaching it inside a sky column escape. */
  roofY: number;
  /** Per cell: 1 = under the glazing (the roof outline). */
  glazed: Uint8Array;
  radiance?: number; glazing?: number; tint?: readonly [number, number, number]; reach?: number; azimuths?: number; march?: number;
}

export interface SkyTarget {
  W: number; H: number; cell: number;
  slots: readonly SkySlot[];
  /** Layers per slot. */
  layers: readonly number[];
  /** Per slot: tinted fluence (rgb), luminance-weighted direction (xyz), luminance — the bake's E / D / EL arrays. */
  E: Float32Array[]; D: Float32Array[]; EL: Float32Array[];
  bands: SkyBands;
}

export interface SkyStats { ms: number; skyCols: number; receivers: number; voxels: number; marches: number; steps: number; maxE: number }

/** Union bands from slot geometry (when the bake has none). */
export function skyBandsOf(slots: readonly SkySlot[], n: number): SkyBands {
  const start = new Int32Array(n + 1), f: number[] = [], c: number[] = [];
  for (let i = 0; i < n; i++) {
    start[i] = f.length;
    const s0 = f.length;
    for (const g of slots) {
      if (!g.open[i]) continue;
      let dup = false;
      for (let b = s0; b < f.length; b++) if (Math.abs(f[b] - g.floorH[i]) < 1e-3 && Math.abs(c[b] - g.ceilH[i]) < 1e-3) { dup = true; break; }
      if (!dup) { f.push(g.floorH[i]); c.push(g.ceilH[i]); }
    }
  }
  start[n] = f.length;
  return {start, f: Float32Array.from(f), c: Float32Array.from(c)};
}

/**
 * Adds the skylight into the bake's direct-light arrays. Returns stats. Deterministic (no randomness): the same layout bakes the
 * same bytes.
 */
export function bakeSkylight(t: SkyTarget, spec: SkySpec): SkyStats {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const {W, H, cell, bands} = t;
  const n = W * H;
  const L = (spec.radiance ?? SKY.radiance) * (spec.glazing ?? SKY.glazing);
  const [tr, tg, tb] = spec.tint ?? SKY.tint;
  const tl = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
  const reach = spec.reach ?? SKY.reach, NA = Math.max(4, spec.azimuths ?? SKY.azimuths), maxS = spec.march ?? SKY.march;
  const roofY = spec.roofY;
  // sky columns: under the glazing with a band rising to the springing line; skyBand = that band's index
  const skyBand = new Int32Array(n).fill(-1);
  let skyCols = 0;
  for (let i = 0; i < n; i++) {
    if (!spec.glazed[i]) continue;
    for (let b = bands.start[i]; b < bands.start[i + 1]; b++) if (bands.c[b] >= roofY - 0.5) { skyBand[i] = b; skyCols++; break; }
  }
  const stats: SkyStats = {ms: 0, skyCols, receivers: 0, voxels: 0, marches: 0, steps: 0, maxE: 0};
  if (!skyCols) return stats;
  // horizontal distance (cells) to the nearest sky column: two-pass chamfer transform
  const BIG = 1e9, dist = new Float32Array(n).fill(BIG);
  for (let i = 0; i < n; i++) if (skyBand[i] >= 0) dist[i] = 0;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + D1);
    if (y > 0) { d = Math.min(d, dist[i - W] + D1); if (x > 0) d = Math.min(d, dist[i - W - 1] + D2); if (x < W - 1) d = Math.min(d, dist[i - W + 1] + D2); }
    dist[i] = d;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let d = dist[i];
    if (x < W - 1) d = Math.min(d, dist[i + 1] + D1);
    if (y < H - 1) { d = Math.min(d, dist[i + W] + D1); if (x < W - 1) d = Math.min(d, dist[i + W + 1] + D2); if (x > 0) d = Math.min(d, dist[i + W - 1] + D2); }
    dist[i] = d;
  }
  const reachC = reach / cell;
  const cosA = new Float64Array(NA), sinA = new Float64Array(NA), dphi = (Math.PI * 2) / NA;
  for (let j = 0; j < NA; j++) { const a = (j + 0.5) * dphi; cosA[j] = Math.cos(a); sinA[j] = Math.sin(a); }
  const capSin = Math.sin(Math.atan(SKY.tMax)); // zenith cap above tMax (sky columns only)
  const capOmega = 2 * Math.PI * (1 - capSin);

  const B = Math.max(1, SKY.block);
  const res = new Float64Array(4); // e, dx, dy, dz of one voxel
  /** Sky seen from (px, py, pz) whose own column is ci: integrates every azimuth into res. */
  const voxel = (ci: number, px: number, py: number, pz: number): void => {
    let e = 0, dx = 0, dy = 0, dz = 0;
    const cx = ci % W, cy = (ci - cx) / W;
    // zenith cap: straight up out of a sky column whose roof band holds the point
    const sb = skyBand[ci];
    if (sb >= 0 && py >= bands.f[sb] - 0.1 && py <= bands.c[sb] + 0.1) { e += L * capOmega; dy += L * capOmega; }
    const rise = roofY - py;
    for (let j = 0; j < NA; j++) {
      stats.marches++;
      const ux = cosA[j], uz = sinA[j];
      let tlo = SKY.tMin, thi = SKY.tMax;
      let x = cx, y = cy;
      const stepX = ux > 0 ? 1 : -1, stepY = uz > 0 ? 1 : -1;
      const tDX = Math.abs(ux) > 1e-9 ? cell / Math.abs(ux) : Infinity, tDY = Math.abs(uz) > 1e-9 ? cell / Math.abs(uz) : Infinity;
      let tMaxX = Math.abs(ux) > 1e-9 ? (ux > 0 ? (x + 1) * cell - px : px - x * cell) / Math.abs(ux) : Infinity;
      let tMaxY = Math.abs(uz) > 1e-9 ? (uz > 0 ? (y + 1) * cell - pz : pz - y * cell) / Math.abs(uz) : Infinity;
      let sIn = 0;
      for (let guard = 0; guard < 4096; guard++) {
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        stats.steps++;
        const c2 = y * W + x;
        const sOut = Math.min(tMaxX, tMaxY);
        const b0 = bands.start[c2], b1 = bands.start[c2 + 1];
        if (b0 === b1) break;
        // the band holding the ray at entry (mid slope), else the one overlapping the entry heights most
        const hm = py + sIn * (tlo + thi) / 2;
        let best = -1;
        for (let b = b0; b < b1; b++) if (hm >= bands.f[b] - 0.08 && hm <= bands.c[b] + 0.08) { best = b; break; }
        if (best < 0) {
          const ha = py + sIn * tlo, hb = py + sIn * thi;
          let ov = 0;
          for (let b = b0; b < b1; b++) { const o = Math.min(hb, bands.c[b]) - Math.max(ha, bands.f[b]); if (o > ov) { ov = o; best = b; } }
          if (best < 0) break;
        }
        if (sIn > 1e-6) tlo = Math.max(tlo, (bands.f[best] - 0.08 - py) / sIn);
        if (skyBand[c2] === best && sOut > 1e-6) {
          // escape: slopes reaching the springing line before leaving this column
          const tEsc = Math.max(tlo, rise / sOut);
          if (tEsc < thi) {
            const thA = Math.atan(tEsc), thB = Math.atan(thi);
            const sa = Math.sin(thA), sb2 = Math.sin(thB);
            const om = dphi * (sb2 - sa);
            const hor = dphi * ((thB / 2 + Math.sin(2 * thB) / 4) - (thA / 2 + Math.sin(2 * thA) / 4));
            e += L * om; dx += L * hor * ux; dz += L * hor * uz; dy += L * dphi * (sb2 * sb2 - sa * sa) / 2;
            thi = tEsc;
          }
        } else if (sOut > 1e-6) {
          thi = Math.min(thi, (bands.c[best] + 0.08 - py) / sOut);
        }
        if (tlo >= thi || sOut > maxS) break;
        // the slopes left can only reach the springing line beyond the march range: done
        if (rise > 0 && rise > thi * maxS) break;
        sIn = sOut;
        if (tMaxX < tMaxY) { tMaxX += tDX; x += stepX; } else { tMaxY += tDY; y += stepY; }
      }
    }
    res[0] = e; res[1] = dx; res[2] = dy; res[3] = dz;
  };
  const group: number[] = [];
  for (let s = 0; s < t.slots.length; s++) {
    const g = t.slots[s], Ls = t.layers[s], E = t.E[s], Dv = t.D[s], EL = t.EL[s];
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      // the block's receiving cells of this slot, grouped by band (floor / ceiling): one evaluation per group
      const cells: number[] = [];
      for (let yy = by; yy < Math.min(H, by + B); yy++) for (let xx = bx; xx < Math.min(W, bx + B); xx++) {
        const i = yy * W + xx;
        if (g.open[i] && dist[i] <= reachC) cells.push(i);
      }
      while (cells.length) {
        const r0 = cells[0];
        group.length = 0;
        for (let q = cells.length - 1; q >= 0; q--) {
          const i = cells[q];
          if (Math.abs(g.floorH[i] - g.floorH[r0]) < 0.05 && Math.abs(g.ceilH[i] - g.ceilH[r0]) < 0.05 && (skyBand[i] >= 0) === (skyBand[r0] >= 0)) { group.push(i); cells.splice(q, 1); }
        }
        stats.receivers += group.length;
        // representative: the group's cell nearest the block centre
        let rep = group[0], bd = Infinity;
        for (const i of group) { const ix = i % W, iy = (i - ix) / W, d = (ix - bx - (B - 1) / 2) ** 2 + (iy - by - (B - 1) / 2) ** 2; if (d < bd) { bd = d; rep = i; } }
        const rx = rep % W, ry = (rep - rx) / W;
        for (let k = 0; k < Ls; k++) {
          stats.voxels++;
          voxel(rep, (rx + 0.5) * cell, g.layerY[rep * Ls + k], (ry + 0.5) * cell);
          const e = res[0];
          if (e <= 0) continue;
          for (const i of group) {
            const vi = (i * Ls + k) * 3;
            E[vi] += e * tr; E[vi + 1] += e * tg; E[vi + 2] += e * tb;
            Dv[vi] += res[1] * tl; Dv[vi + 1] += res[2] * tl; Dv[vi + 2] += res[3] * tl;
            EL[i * Ls + k] += e * tl;
          }
          if (e * tl > stats.maxE) stats.maxE = e * tl;
        }
      }
    }
  }
  stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  return stats;
}

/**
 * The glazed cells of a grid W x H with cell size `cell`: inside the roof outline (bounds) and, when given (task
 * mall-playtest-revision, MallRoof.polygon = the top atrium opening), inside that polygon — glass only over the atrium.
 */
export function glazedMask(W: number, H: number, cell: number, outline: {x0: number; z0: number; x1: number; z1: number}, polygon?: readonly {x: number; z: number}[]): Uint8Array {
  const m = new Uint8Array(W * H);
  const poly = polygon && polygon.length >= 3 ? polygon : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = (x + 0.5) * cell, pz = (y + 0.5) * cell;
    if (px >= outline.x0 && px <= outline.x1 && pz >= outline.z0 && pz <= outline.z1 && (!poly || insidePoly(poly, px, pz))) m[y * W + x] = 1;
  }
  return m;
}

/** Even-odd point-in-polygon (x / z). */
function insidePoly(poly: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/**
 * The FieldSource hook of a mall layout (spread into bakeLightField's source: world/lights.ts); {} for any other layout, so the
 * Subway and the Office bake exactly as before.
 */
export function mallSkyField(layout: {mall?: {roof: {springY: number; outline: {x0: number; z0: number; x1: number; z1: number}; polygon?: readonly {x: number; z: number}[]}}}, cell: number):
  {extraDirect?: (ctx: {W: number; H: number; geos: readonly SkySlot[]; layers: readonly number[]; E: Float32Array[]; D: Float32Array[]; EL: Float32Array[];
    bands: SkyBands | null}) => Record<string, number>} {
  const roof = layout.mall?.roof;
  if (!roof) return {};
  return {
    extraDirect: ctx => {
      const glazed = glazedMask(ctx.W, ctx.H, cell, roof.outline, roof.polygon);
      const bands = ctx.bands ?? skyBandsOf(ctx.geos, ctx.W * ctx.H);
      const st = bakeSkylight({W: ctx.W, H: ctx.H, cell, slots: ctx.geos, layers: ctx.layers, E: ctx.E, D: ctx.D, EL: ctx.EL, bands}, {roofY: roof.springY, glazed});
      lastSkyStats = st;
      return {...st};
    },
  };
}

let lastSkyStats: SkyStats | null = null;
/** The last skylight bake's stats (QA / render-cost report). */
export const skylightStats = (): SkyStats | null => lastSkyStats;
