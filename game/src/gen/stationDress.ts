// Station dressing: props, fixtures, signage, spawns and the deliberate lighting profiles.
// Pure data (no three.js). Called by station.ts after the structural layout is carved.
// Iteration 04: orientation-aware (halls and passages run along X or Z), island / express
// platforms, storefront units (storefronts.ts), food-court seating "rug" inside a circulation ring.

import {Rng} from '../core/rng';
import {CELL, FLOOR, type Grid} from './grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from './props';
import {ROOM_PURPOSES, assignRoomPurposes, purposeById, type PropRule, type RoomPurpose, type RoomSlot} from './purposes';
import {stockVariant} from './purposeShapes';
import {BATTERY_ID, FLARE_ID, FLOOR_ECONOMY, lootTheme} from '../items/lootEconomy';
import {PUBLIC_FLOOR_WEIGHTS, econCat, floorChance, floorCount, lootProfile, type LootProfile} from '../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)
import {ITEMS} from '../items/items';
import type {Wing} from './stationKit';
import {dressStorefront, rugBoxes, type ShopDressApi} from './storefronts';
import {dressP7} from './props07Dress';
import {p7Palette} from './props07';
import {COMPOSED_ZONES, compose, zoneOf} from './compose';
import {passageWallsAlongX, signDims, wallSignSpot} from './doorways';
import {
  OPPOSITE, areaBase, areaLevel, cellsOfBox, doorSide, forceProp, levelGrid, levelsOf, mainDoor, makePlaceCtx, placeAgainstWall,
  rowAlongWall, tryPlaceProp, wallRange, wallSpot, backed, type PlaceCtx,
} from './placeKit';
// Task enemy-spawn-tables-20261030 (lane SPAWN): the enemy spawn controls are the level's spawn profile (was ENEMY_SPAWNS + literals).
import {
  areaCap, areaSpawnWeight, reportSpawnCandidates, rollZombieTypes, spawnContext, spawnProfile, type SpawnProfile,
} from '../ai/spawnTables';
import {
  PENDANT_Y, SPAWN_LIT_RADIUS,
  type Area, type Door, type LightPlacement, type RoomType, type Side, type SignPlacement, type StationLayout,
} from './stationTypes';

/**
 * Iteration 08 (Lane P): the dresser's placement context is gen/placeKit.ts PlaceCtx — bound to ONE level of the station (its
 * grid, doors and masks). dress() makes one per level and dresses every area on its own level's context.
 */
type Ctx = PlaceCtx;

const EXIT_STREETS = ['Hollis St', 'Wexford Ave', 'Garnet St', 'Linden Ave', 'Carver St', 'Dorset Rd', 'Marlowe St', 'Ashby Ave', 'Fulton St', 'Bramley Rd', 'Pruitt Ave', 'Calder St', '4th Ave', 'King St', 'Queen St', 'Front St'];

// ---------------------------------------------------------------------------------------
// Placement helpers (primitives: gen/placeKit.ts)

function fixtureY(area: Area): number {
  return area.ceil > PENDANT_Y + 0.15 ? PENDANT_Y : area.ceil - 0.02;
}
/** Absolute fixture height of an area outside dressing (areas off the main level: their floor + the relative rule). */
function fixtureYAbs(layout: StationLayout, a: Area): number {
  if (!areaLevel(a)) return fixtureY(a);
  const base = areaBase(layout, a), rel = a.ceil - base;
  return base + (rel > PENDANT_Y + 0.15 ? PENDANT_Y : rel - 0.02);
}

function addLight(ctx: Ctx, area: Area, x: number, z: number, rot: number, breakChance: number) {
  // broken/flicker here are provisional (draws kept so the dressing RNG sequence is stable);
  // applyLighting() sets the final state from the area's lighting profile.
  const rng = ctx.rng;
  const broken = rng.chance(breakChance);
  ctx.layout.lights.push({x, y: fixtureY(area), z, rot, area: area.id, broken, flicker: !broken && rng.chance(0.14), warm: rng.chance(0.25), power: 1, dying: false});
}

function gridLights(ctx: Ctx, area: Area, stepX: number, stepZ: number, breakChance: number, inset = 2) {
  const ax0 = area.x * CELL, az0 = area.y * CELL, aw = area.w * CELL, ah = area.h * CELL;
  const nx = Math.max(1, Math.round((aw - inset * 2) / stepX) + 1), nz = Math.max(1, Math.round((ah - inset * 2) / stepZ) + 1);
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = nx === 1 ? ax0 + aw / 2 : ax0 + inset + (aw - inset * 2) * i / (nx - 1);
    const z = nz === 1 ? az0 + ah / 2 : az0 + inset + (ah - inset * 2) * k / (nz - 1);
    addLight(ctx, area, x, z, aw >= ah ? 0 : Math.PI / 2, breakChance);
  }
}

function lineLights(ctx: Ctx, area: Area, step: number, breakChance: number) {
  const ax0 = area.x * CELL, az0 = area.y * CELL, aw = area.w * CELL, ah = area.h * CELL;
  const alongX = aw >= ah;
  const len = alongX ? aw : ah;
  const n = Math.max(1, Math.round(len / step));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    addLight(ctx, area, alongX ? ax0 + aw * t : ax0 + aw / 2, alongX ? az0 + ah / 2 : az0 + ah * t, alongX ? 0 : Math.PI / 2, breakChance);
  }
}

function roomLights(ctx: Ctx, area: Area): void {
  const aw = area.w * CELL, ah = area.h * CELL;
  const n = Math.max(aw, ah) > 9 ? 3 : Math.max(aw, ah) > 5.5 ? 2 : 1;
  const ax0 = area.x * CELL, az0 = area.y * CELL;
  const alongX = aw >= ah;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    addLight(ctx, area, alongX ? ax0 + aw * t : ax0 + aw / 2, alongX ? az0 + ah / 2 : az0 + ah * t, alongX ? 0 : Math.PI / 2, i === 0 ? 0 : 0.35);
  }
}

function wallSign(ctx: Ctx, area: Area, side: Side, t: number, y: number, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>, base?: number) {
  // Iteration 07 (Lane DW): a plate never floats across an opening (or past a corner) — it slides
  // along the wall to the nearest wall-backed spot (deterministic, no RNG); where the wall left
  // beside openings is too short it gets a narrower plate (down to 1 m), else it is left out.
  // Iteration 08: plates on another level are authored in its local height frame; wall backing tests absolute heights.
  // Track 2 (lane CONTENT): `base` = the local frame's floor of a main-level area off floor 0 (a service annex on the trackbed).
  const yb = y + (base ?? (areaLevel(area) ? areaBase(ctx.layout, area) : 0));
  let spot = wallSignSpot(ctx.g, area, side, t, yb, signDims(s));
  for (const f of [0.8, 0.6, 0.45]) {
    if (spot !== null) break;
    const narrow = {...s, w: Math.round(Math.max(1.0, signDims(s).w * f) * 100) / 100};
    spot = wallSignSpot(ctx.g, area, side, t, yb, signDims(narrow));
    if (spot !== null) s = narrow;
  }
  if (spot === null) return;
  // Iteration 08: never a plate over a light well / stairwell edge (closed cells of an upper level are not wall there).
  if (!backed(ctx, area, side, spot - signDims(s).w / 2, spot + signDims(s).w / 2, yb - signDims(s).h / 2)) return;
  t = spot;
  const ax0 = area.x * CELL, az0 = area.y * CELL, ax1 = (area.x + area.w) * CELL, az1 = (area.y + area.h) * CELL;
  const pos = side === 'N' ? {x: t, z: az0 + 0.02, rot: 0} : side === 'S' ? {x: t, z: az1 - 0.02, rot: Math.PI}
    : side === 'W' ? {x: ax0 + 0.02, z: t, rot: Math.PI / 2} : {x: ax1 - 0.02, z: t, rot: -Math.PI / 2};
  ctx.layout.signs.push({...s, ...pos, y, area: area.id});
}

/** Sign on `area`'s side of a door: above the opening when there is a soffit, else beside it. */
function signAtDoor(ctx: Ctx, d: Door, area: Area, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>, base?: number) {
  const side = doorSide(d, area);
  const mid = d.h === 1 ? (d.x + d.w / 2) * CELL : (d.y + d.h / 2) * CELL;
  const room = area.ceil - d.height;
  if (room >= 0.5) wallSign(ctx, area, side, mid, Math.min(d.height + 0.32, area.ceil - 0.24), s, base);
  // Beside it: 0.2 m clear of the opening edge whatever the plate's width (was a fixed 0.75 m from
  // the edge to the centre, so wide plates reached back into the opening).
  else { const w = s.w ?? 1.1; wallSign(ctx, area, side, mid + ((d.h === 1 ? d.w : d.h) * CELL / 2 + 0.2 + w / 2), 1.9, {...s, w}, base); }
}

const other = (ctx: Ctx, d: Door, a: Area) => ctx.layout.areas[d.a === a.id ? d.b : d.a];

// ---------------------------------------------------------------------------------------
// Dressing

export function dress(layout: StationLayout, rng: Rng): void {
  // Iteration 08 (Lane P): one placement context per level (its grid, doors, masks); every area is dressed on its own level.
  const ctxs = levelsOf(layout).map(L => makePlaceCtx(layout, rng, L.id));
  const ctx = ctxs[0];
  const ctxOf = (a: Area): Ctx => ctxs[areaLevel(a)] ?? ctx;
  const marks = {lights: layout.lights.length, signs: layout.signs.length};
  // Iteration 05: every back-of-house room / closet / corridor gets a purpose (gen/purposes.ts).
  assignPurposes(layout, rng.fork('purposes'));
  // Fare gates first: they sit in the fare-line openings, straddling the paid/unpaid wall.
  for (const d of layout.doors) if (d.fare) placeFareGates(ctxOf(layout.areas[d.b]), d);
  placeTrackColumns(ctx);
  const api: ShopDressApi = {
    rng,
    place: (area, kind, x, z, rot, o = {}) => tryPlaceProp(ctxOf(area), area, kind, x, z, rot, {checkZone: false, variant: o.variant, front: o.front, ring: o.ring}),
    force: (area, kind, x, z, hx, hz, h, blocksSight) => forceProp(ctxOf(area), area, kind, x, z, hx, hz, h, blocksSight),
    light: (area, x, z, rot, breakChance) => addLight(ctxOf(area), area, x, z, rot, breakChance),
  };
  let kiosk = rng.chance(0.35);
  for (const area of layout.areas) {
    const c = ctxOf(area);
    inLocalFrame(layout, area, () => {
      switch (area.type) {
        case 'platform': dressPlatform(c, area); break;
        case 'passage': dressPassage(c, area); break;
        case 'underpass': lineLights(c, area, 4.5, 0.12); break;
        case 'concourse': area.paid ? dressPaidConcourse(c, area) : dressExitHall(c, area); break;
        case 'fare-hall': if (dressTicketHall(c, area, kiosk)) kiosk = false; break;
        case 'food-court': dressFoodCourt(c, area); break;
        case 'retail-arcade': if (dressArcade(c, area, kiosk)) kiosk = false; break;
        case 'exit-stair': dressExitStair(c, area); break;
        // Iteration 08 (Lane A): public stair cores between levels — lights only (Lane A adds their wayfinding after dress()).
        case 'stair-core': lineLights(c, area, 4, 0.06); break;
        case 'washroom': dressWashroom(c, area); break;
        case 'eatery': case 'shop': if (area.storefront !== undefined) dressStorefront(api, layout, layout.storefronts[area.storefront]); break;
        default: dressBackOfHouse(c, area); break;
      }
    });
  }
  // Iteration 07 (Lane P2): the seeded per-station palette of generated kinds (same fork as dressP7 draws it from).
  const prng = rng.fork('p7');
  const palRng = prng.fork('palette');
  const palette = p7Palette(p => palRng.chance(p));
  // Iteration 08 (Lane P): COMPOSITION — circulation lanes + plazas, landmarks on sightlines, zone activity clusters, cover and
  // caches for halls, service corridors and the upper / lower levels (gen/compose.ts). Own RNG fork: the rest is unchanged.
  compose(layout, {rng: rng.fork('compose'), palette, ctxOf});
  // Iteration 07 (Lane P2): NEW generated props by room/store purpose (rooms keep their purpose scatter, now with affinities;
  // composed areas only get spaced wall / ceiling infrastructure), then host decor / chairs (gen/props07Dress.ts).
  {
    const pctxs = ctxs.map(c => ({...c, rng: prng}));
    const pctxOf = (a: Area): Ctx => pctxs[areaLevel(a)] ?? pctxs[0];
    dressP7(layout, {
      rng: prng,
      place: (a, kind, x, z, rot, o = {}) => tryPlaceProp(pctxOf(a), a, kind, x, z, rot, o),
      cellsFree: (a, x, z, hx, hz) => {
        const c = pctxOf(a), g = c.g;
        const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          if (!g.inBounds(cx, cy)) return false;
          const i = g.idx(cx, cy);
          if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || c.zone[i] || c.doorCell[i] || c.edge[i] || c.lane[i] || c.plaza[i]) return false;
        }
        return true;
      },
      doorSide: a => { const d = mainDoor(pctxOf(a), a); return d ? doorSide(d, a) : null; },
      grid: a => pctxOf(a).g,
      base: a => areaBase(layout, a),
      composed: a => COMPOSED_ZONES.has(zoneOf(layout, a)),
      doors: a => pctxOf(a).doorsOf.get(a.id) ?? [],
      backed: (a, side, t0, t1, yb) => backed(pctxOf(a), a, side, t0, t1, yb),
    });
  }
  // Staff-only plates on the public side of back-of-house doors; purpose plates (SECURITY,
  // ELECTRICAL, JANITOR …) on the corridor side of a purpose room's main door.
  for (const d of layout.doors) {
    if (!d.staff) continue;
    const pub = layout.areas[d.a].publicSpace ? layout.areas[d.a] : layout.areas[d.b];
    const priv = pub.id === d.a ? layout.areas[d.b] : layout.areas[d.a];
    const plate = PLATES[priv.purpose ?? ''];
    inLocalFrame(layout, pub, () => signAtDoor(ctxOf(pub), d, pub, {kind: 'service', text: plate ? `${plate} · STAFF ONLY` : 'STAFF ONLY', w: plate ? 1.6 : 1.0}));
  }
  for (const a of layout.areas) {
    const plate = PLATES[a.purpose ?? ''];
    if (!plate || a.publicSpace) continue;
    const d = (ctxOf(a).doorsOf.get(a.id) ?? []).find(q => !q.staff && (q.a === a.parent || q.b === a.parent));
    if (d) { const o = other(ctx, d, a); inLocalFrame(layout, o, () => signAtDoor(ctxOf(o), d, o, {kind: 'service', text: plate, w: 1.3})); }
  }
  liftLevels(layout, marks);
}

/**
 * Iteration 08: areas on a level other than the main one are dressed in that level's LOCAL height frame — the area ceiling is
 * made relative to its floor while the (height-relative) dressing rules run — and liftLevels() then moves what they placed to
 * absolute heights. Main-level areas are dressed exactly as before (finishTraversal lifts them onto local floors).
 */
function inLocalFrame(layout: StationLayout, a: Area, fn: () => void): void {
  if (areaLevel(a) === 0) { fn(); return; }
  const ceil = a.ceil, base = areaBase(layout, a);
  a.ceil = ceil - base;
  try { fn(); } finally { a.ceil = ceil; }
}

/**
 * Moves the dressing of non-main levels to absolute heights and tags it with its level: props (tagged at placement) stand on
 * their level's local floor (flat cells; stairs / unknown cells: the area floor), lights and signs of such areas are lifted by
 * the area floor. Runs once at the end of dress(); finishTraversal leaves level-tagged entries alone.
 */
export function liftLevels(layout: StationLayout, marks: {lights: number; signs: number}): void {
  if (levelsOf(layout).length < 2) return;
  for (const p of layout.props) {
    if (!p.level) continue;
    const g = levelGrid(layout, p.level), a = layout.areas[p.area];
    const [cx, cy] = g.cellOf(p.x, p.z);
    const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    const f = i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : a ? areaBase(layout, a) : 0;
    // On-top decor and chairs follow their host (lifted with it below).
    if (p.host === undefined) p.y += f;
  }
  for (const p of layout.props) if (p.level && p.host !== undefined) {
    const h = layout.props[p.host];
    const g = levelGrid(layout, p.level);
    const [cx, cy] = g.cellOf(h.x, h.z);
    const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    p.y += i >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0 ? g.floorOf(i) : areaBase(layout, layout.areas[h.area]);
  }
  const lift = (o: {area: number; y: number; level?: number}) => {
    const a = layout.areas[o.area];
    if (!a || !areaLevel(a) || o.level) return;
    o.y += areaBase(layout, a);
    o.level = areaLevel(a);
  };
  for (let i = marks.lights; i < layout.lights.length; i++) lift(layout.lights[i] as LightPlacement & {level?: number});
  for (let i = marks.signs; i < layout.signs.length; i++) lift(layout.signs[i] as SignPlacement & {level?: number});
}

/**
 * Track 2 (lane CONTENT): the iteration-07 palette a station's dress() drew (gen/props07.ts p7Palette on the `p7` → `palette` fork of
 * its dress rng): forks are position-independent, so the appended extension dressing re-derives the SAME palette (no extra model
 * kinds / downloads for the annexes).
 */
export function stationP7Palette(dressRng: Rng): ReadonlySet<string> {
  const palRng = dressRng.fork('p7').fork('palette');
  return p7Palette(p => palRng.chance(p));
}

/**
 * Track 2 (lane CONTENT): dresses EXTENSION areas (the service annexes, gen/annexContent.ts) of a FINISHED layout with this dresser's
 * own machinery, every placement APPENDED after the core's (core records / indices / grid masks untouched; cells of other areas are
 * never touched: every primitive checks the area id), on forks of `rng`:
 *  - `pre(ctxOf)` first (the caller's own placements through the same contexts, e.g. the annex stash holders);
 *  - the purpose rules (dressByRules) for rooms / closets;
 *  - the composer (gen/compose.ts) for the annex corridors (zone 'lower') on its own generated-model budget `p7Budget`, its
 *    clusters appended to the layout's composition record;
 *  - the iteration-07 dresser (gen/props07Dress.ts) for their generated props and on-top decor / chairs (hosts: the new props only);
 *  - purpose door plates (PUMP ROOM, ELECTRICAL · DANGER, JANITOR …) on the outer side of each purpose room's main door.
 * The areas lie on the main level at their own floor (the trackbed, floorY -1.15): everything is authored relative to it (area
 * ceilings made relative where the rules read them) and lifted onto it at the end — what finishTraversal does for the core's props.
 * No fixtures (the caller lights the extensions).
 */
export function dressExtensionAreas(layout: StationLayout, areas: readonly Area[], rng: Rng, o: {palette: ReadonlySet<string>; p7Budget: number; maxProps?: number; p7Scale?: number; pre?: (ctxOf: (a: Area) => PlaceCtx) => number | void; phase?: (k: string) => void;
  /** (task track2-playtest-revision, lane ROOMS) per-area furniture rules replacing the purpose's own (lean annex rule sets); undefined = the purpose's. */
  rules?: (a: Area) => readonly PropRule[] | undefined}): {props: number; signs: number} {
  const ids = new Set(areas.map(a => a.id));
  const inSet = (a: Area) => ids.has(a.id);
  // contexts only for the levels the areas lie on, their masks built over the areas' bounding window (+ 4 cells)
  const win = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  for (const a of areas) { win.x0 = Math.min(win.x0, a.x - 4); win.y0 = Math.min(win.y0, a.y - 4); win.x1 = Math.max(win.x1, a.x + a.w + 3); win.y1 = Math.max(win.y1, a.y + a.h + 3); }
  const ctxs = new Map<number, Ctx>();
  const ctxOf = (a: Area): Ctx => { const L = areaLevel(a); let c = ctxs.get(L); if (!c) ctxs.set(L, (c = makePlaceCtx(layout, rng, L, win))); return c; };
  for (const a of areas) ctxOf(a);
  const p0 = layout.props.length, s0 = layout.signs.length;
  o.phase?.('dress.ctx');
  // `maxProps`: the pass's prop budget — rooms are dressed in the given (priority) order until it is spent; the iteration-07
  // dresser stops placing at it too (its per-area budgets scaled by `p7Scale`)
  // (lane ROOMS: `pre` may return how many of its placements are budget-exempt — the annexes' collision-only machinery boxes)
  const cap = o.maxProps ?? Infinity;
  const exempt = o.pre?.(ctxOf) ?? 0;
  const spent = () => layout.props.length - p0 - exempt >= cap;
  // rooms / closets: their purpose's rules (corridors are composed below)
  for (const a of areas) {
    if (spent()) break;
    if (COMPOSED_ZONES.has(zoneOf(layout, a))) continue;
    const P = ROOM_PURPOSES[a.purpose ?? ''] ?? ROOM_PURPOSES.storage, own = o.rules?.(a);
    dressByRules(ctxOf(a), a, own ? {...P, props: own} : P);
  }
  o.phase?.('dress.rules');
  compose(layout, {rng: rng.fork('compose'), palette: o.palette, ctxOf, areas: inSet, p7Budget: o.p7Budget, append: true});
  o.phase?.('dress.compose');
  {
    const prng = rng.fork('p7');
    const pctxs = new Map([...ctxs].map(([L, c]) => [L, {...c, rng: prng}]));
    const pctxOf = (a: Area): Ctx => pctxs.get(areaLevel(a)) ?? {...ctxOf(a), rng: prng};
    dressP7(layout, {
      rng: prng, areas: inSet, hostsFrom: p0, budgetScale: o.p7Scale,
      place: (a, kind, x, z, rot, q = {}) => (spent() ? null : tryPlaceProp(pctxOf(a), a, kind, x, z, rot, q)),
      cellsFree: (a, x, z, hx, hz) => {
        const c = pctxOf(a), g = c.g;
        const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          if (!g.inBounds(cx, cy)) return false;
          const i = g.idx(cx, cy);
          if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || c.zone[i] || c.doorCell[i] || c.edge[i] || c.lane[i] || c.plaza[i]) return false;
        }
        return true;
      },
      doorSide: a => { const d = mainDoor(pctxOf(a), a); return d ? doorSide(d, a) : null; },
      grid: a => pctxOf(a).g,
      base: a => areaBase(layout, a),
      composed: a => COMPOSED_ZONES.has(zoneOf(layout, a)),
      doors: a => pctxOf(a).doorsOf.get(a.id) ?? [],
      backed: (a, side, t0, t1, yb) => backed(pctxOf(a), a, side, t0, t1, yb),
    });
  }
  o.phase?.('dress.p7');
  // purpose plates on the outer side of each purpose room's main door (authored in the outer area's local frame)
  for (const a of areas) {
    const plate = PLATES[a.purpose ?? ''];
    if (!plate) continue;
    const d = (ctxOf(a).doorsOf.get(a.id) ?? []).find(q => q.a === a.parent || q.b === a.parent);
    if (!d) continue;
    const out = other(ctxOf(a), d, a), base = areaBase(layout, out);
    if (!inSet(out)) continue;
    const ceil = out.ceil;
    out.ceil = ceil - base;
    try { signAtDoor(ctxOf(out), d, out, {kind: 'service', text: plate, w: 1.3}, base); } finally { out.ceil = ceil; }
  }
  // lift onto the areas' own floor (props: the floor of their cell; plates: their area's floor)
  for (let i = p0; i < layout.props.length; i++) {
    const p = layout.props[i];
    if (p.level) continue;
    const g = layout.grid, [cx, cy] = g.cellOf(p.x, p.z), k = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    p.y += k >= 0 && g.cells[k] === FLOOR && g.rampIdx[k] < 0 ? g.floorOf(k) : areaBase(layout, layout.areas[p.area]);
  }
  for (let i = s0; i < layout.signs.length; i++) { const sg = layout.signs[i]; if (!sg.level) sg.y += areaBase(layout, layout.areas[sg.area]); }
  return {props: layout.props.length - p0, signs: layout.signs.length - s0};
}

/** Door plates per room purpose (kept short: they render on 1.0–1.6 m plates). */
const PLATES: Record<string, string> = {
  'staff-room': 'STAFF ROOM', 'locker-room': 'CREW LOCKERS', 'first-aid-room': 'FIRST AID', 'security-office': 'TRANSIT SECURITY',
  'electrical-room': 'ELECTRICAL · DANGER', 'electrical-closet': 'ELECTRICAL', 'signal-room': 'SIGNAL RELAY ROOM', 'storage': 'MAINTENANCE STORES',
  'stock-room': 'STOCK ROOM', 'janitor-closet': 'JANITOR', 'supply-closet': 'SUPPLIES',
  // Iteration 07 (Lane P2): rooms built around the new generated props.
  'workshop': 'WORKSHOP', 'pump-room': 'PUMP ROOM', 'lost-property': 'LOST PROPERTY', 'revenue-room': 'REVENUE ROOM', 'custodial-room': 'CUSTODIAL',
  // Task track2-playtest-revision (lane ROOMS): the service annexes' signature rooms (gen/annexRooms.ts; never core purposes).
  'boiler-room': 'BOILER ROOM', 'generator-room': 'GENERATORS · DANGER', 'sewage-room': 'SEWAGE', 'overflow-chamber': 'OVERFLOW',
  'spillway': 'SPILLWAY', 'turbine-hall': 'TURBINE HALL', 'ventilation-plant': 'VENTILATION',
};

/** Back-of-house wing of an area from its ancestry (food court / agent office / platform staff side). */
function wingOf(layout: StationLayout, a: Area): Wing {
  for (let q: Area | undefined = a, guard = 0; q && guard < 64; q = q.parent >= 0 ? layout.areas[q.parent] : undefined, guard++) {
    if (q.type === 'eatery' || q.type === 'food-court') return 'food';
    if (q.type === 'agent-office' || q.type === 'fare-hall') return 'agent';
    if (q.kind === 'platform') return 'north';
  }
  return 'misc';
}

/** Purpose per back-of-house area (rooms, closets, corridors, washrooms); labels follow the purpose. */
export function assignPurposes(layout: StationLayout, rng: Rng): void {
  const slots: RoomSlot[] = [];
  // Iteration 08: purposes preset by the generator (level rooms: pump room, cable vault, security control …) are kept and count
  // toward the per-station caps / required purposes.
  const preset = new Map<string, number>();
  for (const a of layout.areas) {
    if (a.storefront !== undefined) continue;
    if (a.publicSpace && a.type !== 'washroom') continue;
    if (a.purpose && ROOM_PURPOSES[a.purpose]) { preset.set(a.purpose, (preset.get(a.purpose) ?? 0) + 1); continue; }
    slots.push({id: a.id, type: a.type, kind: a.kind, wing: wingOf(layout, a), wM: a.w * CELL, hM: a.h * CELL});
  }
  for (const [id, pid] of assignRoomPurposes(slots, () => rng.next(), preset)) {
    const a = layout.areas[id];
    a.purpose = pid;
    if (pid !== 'washroom' && pid !== 'service-corridor') a.label = ROOM_PURPOSES[pid].label;
  }
}

function placeFareGates(ctx: Ctx, d: Door): void {
  const {g, layout} = ctx;
  const def = PROP_DEFS.fareGate;
  // Gates at every third cell; door width is 3k+2 so every gap (and both ends) is 2 cells = 1 m.
  // Vertical lines turn the cabinets so the arms still reach into the following gap.
  const vertical = d.w === 1 && d.h > 1;
  const rot = vertical ? -Math.PI / 2 : 0;
  const {hx, hz} = footprint('fareGate', rot);
  const len = vertical ? d.h : d.w;
  for (let k = 2; k <= len - 3; k += 3) {
    const x = vertical ? (d.x + 0.5) * CELL : (d.x + k + 0.5) * CELL;
    const z = vertical ? (d.y + k + 0.5) * CELL : (d.y + 0.5) * CELL;
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) g.blocked[g.idx(cx, cy)] = 1;
    layout.props.push({kind: 'fareGate', x, z, y: 0, rot, area: d.b, hx, hz, h: def.h, blocksSight: false, variant: 0});
  }
}

/** Steel I-beam columns down the centre of every two-track bed (between the tracks). */
function placeTrackColumns(ctx: Ctx): void {
  const {g, layout} = ctx;
  for (const t of layout.trenches) {
    if (!t.columns) continue;
    const z = (t.z0 + t.z1) / 2;
    const {hx, hz} = footprint('column', 0);
    for (let x = t.platformX0 + 2.75; x < t.platformX1 - 2; x += 5) {
      const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); g.blocked[i] = 1; g.sightBlocked[i] = 1; }
      layout.props.push({kind: 'column', x, z, y: t.floorY, rot: 0, area: layout.platform, hx, hz, h: t.ceil - t.floorY, blocksSight: true, variant: 1});
    }
  }
}

function dressPlatform(ctx: Ctx, a: Area): void {
  const {rng, layout, g} = ctx;
  const edges: ('N' | 'S')[] = a.edge === 'NS' ? ['N', 'S'] : [a.edge ?? 'N'];
  const island = edges.length === 2;
  const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL, az1 = az0 + ah;
  // Keep a 2 m safety band clear along every track edge.
  for (const e of edges) for (let y = e === 'N' ? a.y : a.y + a.h - 4; y < (e === 'N' ? a.y + 4 : a.y + a.h); y++) for (let x = a.x; x < a.x + a.w; x++) ctx.edge[g.idx(x, y)] = 1;
  // Column rows: side platforms one row 58% from the edge; islands one central row or two rows.
  const rows: number[] = [];
  if (!island) {
    const fromEdge = Math.round(a.h * 0.58);
    rows.push(edges[0] === 'N' ? a.y + fromEdge : a.y + a.h - 1 - fromEdge);
  } else if (a.h >= 24 && rng.chance(0.6)) rows.push(a.y + Math.round(a.h * 0.33), a.y + a.h - 1 - Math.round(a.h * 0.33));
  else rows.push(a.y + Math.floor(a.h / 2));
  const spacing = rng.pick([6, 6.5, 7.5]);
  const benchSlots: {x: number; z: number; rot: number}[] = [];
  for (const row of rows) {
    const colZ = (row + 0.5) * CELL;
    const cols: number[] = [];
    for (let x = ax0 + 4.25; x < ax0 + aw - 3; x += spacing) if (tryPlaceProp(ctx, a, 'column', x, colZ, 0, {checkZone: false, h: a.ceil})) cols.push(x);
    const benchRot = !island ? (edges[0] === 'N' ? Math.PI : 0) : row < a.y + a.h / 2 ? Math.PI : 0;
    for (let i = 0; i + 1 < cols.length; i++) if (cols[i + 1] - cols[i] < spacing + 0.1) benchSlots.push({x: (cols[i] + cols[i + 1]) / 2, z: colZ, rot: island && rows.length === 1 && i % 2 ? Math.PI - benchRot : benchRot});
    // Iteration 08 (Lane P): bins / newspaper boxes at the bench bays and barricades in empty bays come from the composer.
  }
  rng.shuffle(benchSlots);
  const benches = Math.min(benchSlots.length, rng.int(6, 11));
  for (let i = 0; i < benches; i++) tryPlaceProp(ctx, a, 'bench', benchSlots[i].x, benchSlots[i].z, benchSlots[i].rot, {checkZone: false, variant: i});
  if (!island) {
    const back: Side = edges[0] === 'N' ? 'S' : 'N';
    for (let i = 0, n = rng.int(2, 3); i < n; i++) {
      // Vending against the back wall: a single machine or a pair.
      const pair = rng.chance(0.45);
      const [lo, hi] = wallRange(a, back);
      const t0 = rng.range(lo + 3, hi - 5);
      rowAlongWall(ctx, a, back, 'vending', {from: t0, to: t0 + (pair ? 2.2 : 1.2), max: pair ? 2 : 1, front: 1.0, variant: () => rng.int(0, 2)});
    }
    if (rng.chance(0.4)) placeAgainstWall(ctx, a, 'cabinetLow', {sides: [back]});
  } else {
    // Island: vending machines back to back on the column line, facing each track.
    for (let i = 0, n = rng.int(2, 3); i < n; i++) {
      const x = Math.round(rng.range(ax0 + 8, ax0 + aw - 8) * 4) / 4;
      const z = (rows[0] + 0.5) * CELL;
      const d = PROP_DEFS.vending.d / 2 + 0.01;
      tryPlaceProp(ctx, a, 'vending', x, z - d, Math.PI, {checkZone: false, front: 1.0, variant: rng.int(0, 2)});
      tryPlaceProp(ctx, a, 'vending', x, z + d, 0, {checkZone: false, front: 1.0, variant: rng.int(0, 2)});
    }
  }
  const lightRows = island ? [0.25, 0.75] : [0.3, 0.76];
  for (const f of lightRows) {
    const lz = island || edges[0] === 'N' ? az0 + ah * f : az1 - ah * f;
    for (let x = ax0 + 2.5; x < ax0 + aw - 1.5; x += 5) addLight(ctx, a, x, lz, 0, 0.1);
  }
  // Station-name signs: side platforms on the back wall (skipping openings); islands on the
  // tunnel walls across the tracks, facing the platform.
  if (!island) {
    const back: Side = edges[0] === 'N' ? 'S' : 'N';
    const backRow = edges[0] === 'N' ? a.y + a.h : a.y - 1;
    const clearOfDoors = (x: number) => {
      for (let cx = Math.floor((x - 1.1) / CELL); cx <= Math.floor((x + 1.1) / CELL); cx++) if (g.get(cx, backRow) !== 0) return false;
      return true;
    };
    for (let x = ax0 + 7; x < ax0 + aw - 4; x += rng.range(11, 14)) {
      let sx = x;
      for (let k = 0; k < 10 && !clearOfDoors(sx); k++) sx += 1;
      if (clearOfDoors(sx) && sx < ax0 + aw - 1.2) wallSign(ctx, a, back, sx, 2.75, {kind: 'station', text: layout.name});
    }
  } else {
    for (const t of layout.trenches) {
      const north = Math.abs(t.z1 - az0) < 0.01, south = Math.abs(t.z0 - az1) < 0.01;
      if (!north && !south || t.columns) continue;
      const z = north ? t.z0 + 0.02 : t.z1 - 0.02;
      for (let x = ax0 + 7; x < ax0 + aw - 4; x += rng.range(11, 14)) layout.signs.push({x, y: 2.75, z, rot: north ? 0 : Math.PI, kind: 'station', text: layout.name, area: a.id});
    }
  }
  // Platform number plates (hanging, double-sided), one per track edge.
  const n = a.platformNo ?? 1;
  for (const [i, e] of edges.entries()) {
    const toward = (e === 'N' ? a.towardsN : a.towardsS) ?? layout.towards[i];
    const plateZ = e === 'N' ? az0 + 2.6 : az1 - 2.6;
    for (let x = ax0 + 12 + i * 6; x < ax0 + aw - 8; x += 24) {
      layout.signs.push({x, y: 3.05, z: plateZ, rot: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, kind: 'platform', text: `${n + i}  ·  TO ${toward.toUpperCase()}`, area: a.id, hang: true, w: 2.4});
    }
  }
  // Wayfinding over openings.
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    const o = other(ctx, d, a);
    if (o.type === 'passage') signAtDoor(ctx, d, a, {kind: 'info', text: o.role === 'end-stair' ? 'EXIT · CONCOURSE · TRANSFER' : 'EXIT · FARE CONCOURSE', arrow: 'up'});
    else if (o.type === 'underpass') signAtDoor(ctx, d, a, {kind: 'info', text: n === 1 ? 'UNDERPASS · TO PLATFORM 2' : 'UNDERPASS · TO PLATFORM 1 & EXITS', arrow: 'up'});
  }
}

function dressPassage(ctx: Ctx, a: Area): void {
  const {rng, layout} = ctx;
  const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL;
  const alongX = aw > ah;
  const len = alongX ? aw : ah;
  const step = a.role === 'escalator' ? 4.5 : 3.5;
  for (let t = 1.5; t < len; t += step) addLight(ctx, a, alongX ? ax0 + t : ax0 + aw / 2, alongX ? az0 + ah / 2 : az0 + t, alongX ? 0 : Math.PI / 2, 0.08);
  let sideA: Side = alongX ? (rng.chance(0.5) ? 'N' : 'S') : (rng.chance(0.5) ? 'W' : 'E');
  let mid = alongX ? ax0 + aw / 2 : az0 + ah / 2;
  // Iteration 07 (Lane DW): a passage wider than long has its mouths in the "long" walls — the
  // sign goes on a side wall (the wall pair the handrails use), not across a mouth.
  const sideX = passageWallsAlongX(ctx.g, a);
  if (sideX !== alongX) { sideA = ({N: 'W', S: 'E', W: 'N', E: 'S'} as const)[sideA]; mid = sideX ? ax0 + aw / 2 : az0 + ah / 2; }
  const text = a.role === 'transfer' ? 'TRANSFER · LINE 1 / LINE 2' : a.role === 'escalator' ? 'TO STREET · TICKET HALL' : 'TO STREET';
  wallSign(ctx, a, sideA, mid, 2.2, {kind: a.role === 'transfer' ? 'info' : 'exit', text, w: a.role === 'transfer' ? 2.4 : undefined});
  if (a.role === 'transfer' || a.role === 'escalator') {
    // Long passages: hanging wayfinding every ~12 m, benches and bins along the walls.
    for (let t = 6; t < len - 4; t += 12) {
      layout.signs.push({x: alongX ? ax0 + t : ax0 + aw / 2, y: Math.min(a.ceil - 0.5, 2.9), z: alongX ? az0 + ah / 2 : az0 + t, rot: alongX ? Math.PI / 2 : 0, kind: 'info', text, area: a.id, hang: true, w: 2.4});
    }
    // Iteration 08 (Lane P): benches + bins are composed waiting nooks (gen/compose.ts), not random wall spots.
  }
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    const o = other(ctx, d, a);
    if (o.paid && o.kind === 'concourse') signAtDoor(ctx, d, o, {kind: 'info', text: `TRAINS · TO ${layout.towards[0].toUpperCase()} / ${layout.towards[1].toUpperCase()}`, arrow: 'up', w: 2.4});
  }
}

/** Columns down the middle (or at `frac` across) of the area's long axis. */
function columnRow(ctx: Ctx, a: Area, frac: number, spacing: number, h: number) {
  const alongX = a.w >= a.h;
  const len = (alongX ? a.w : a.h) * CELL;
  const n = Math.max(1, Math.floor((len - 6) / spacing));
  const start = (alongX ? a.x : a.y) * CELL + (len - (n - 1) * spacing) / 2;
  const across = ((alongX ? a.y + Math.floor(a.h * frac) : a.x + Math.floor(a.w * frac)) + 0.5) * CELL;
  for (let i = 0; i < n; i++) {
    const t = (Math.round((start + i * spacing) / CELL - 0.5) + 0.5) * CELL;
    tryPlaceProp(ctx, a, 'column', alongX ? t : across, alongX ? across : t, 0, {h});
  }
}

const longSides = (a: Area): Side[] => (a.w >= a.h ? ['N', 'S'] : ['W', 'E']);

function dressPaidConcourse(ctx: Ctx, a: Area): void {
  const {rng} = ctx;
  if (Math.min(a.w, a.h) >= 16) columnRow(ctx, a, 0.5, 8, a.ceil);
  const sides = longSides(a);
  const side = rng.pick(sides);
  const [lo, hi] = wallRange(a, side);
  for (let k = 0; k < 3; k++) {
    const t0 = rng.range(lo + 2, Math.max(lo + 2.1, hi - 5));
    if (rowAlongWall(ctx, a, side, 'vending', {from: t0, to: t0 + 3.3, max: rng.int(2, 3), front: 1.0, variant: () => rng.int(0, 2)}).length) break;
  }
  // Iteration 08 (Lane P): benches / bins are composed waiting clusters (gen/compose.ts).
  gridLights(ctx, a, 5, 4.5, 0.1);
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    if (d.fare) signAtDoor(ctx, d, a, {kind: 'info', text: 'EXIT · TICKET HALL · FOOD COURT', arrow: 'down', w: 2.6});
    else if (other(ctx, d, a).role === 'transfer') signAtDoor(ctx, d, a, {kind: 'info', text: 'TRANSFER · OTHER LINE', w: 2.2});
  }
}

function dressTicketHall(ctx: Ctx, a: Area, kioskAllowed: boolean): boolean {
  const {rng, layout} = ctx;
  const fare = (ctx.doorsOf.get(a.id) ?? []).find(d => d.fare);
  if (fare) {
    // Agent booth beside the gate array (unpaid side), ticket machines on the other side.
    const side = doorSide(fare, a);
    const alongX = side === 'N' || side === 'S';
    const s0 = (alongX ? fare.x : fare.y) * CELL, s1 = s0 + (alongX ? fare.w : fare.h) * CELL;
    const bw = PROP_DEFS.booth.w;
    const spots = rng.chance(0.5) ? [s0 - 1.2 - bw / 2, s1 + 1.2 + bw / 2] : [s1 + 1.2 + bw / 2, s0 - 1.2 - bw / 2];
    let boothAt: number | null = null;
    for (const t of spots) {
      const s = wallSpot(a, side, Math.round(t * 4) / 4, 'booth');
      if (tryPlaceProp(ctx, a, 'booth', s.x, s.z, s.rot, {front: 1.2})) { boothAt = t; break; }
    }
    const machinesBefore = boothAt !== null ? boothAt > s1 : rng.chance(0.5);
    const t0 = machinesBefore ? s0 - 1.4 - 4 : s1 + 1.4;
    rowAlongWall(ctx, a, side, 'ticketMachine', {from: t0, to: t0 + 4, max: rng.int(3, 4), front: 1.0});
    signAtDoor(ctx, fare, a, {kind: 'info', text: 'TO TRAINS · ALL PLATFORMS', arrow: 'up', w: 2.4});
  }
  if (Math.min(a.w, a.h) >= 34) { columnRow(ctx, a, 0.38, 9, a.ceil); columnRow(ctx, a, 0.72, 9, a.ceil); }
  else columnRow(ctx, a, 0.55, 9, a.ceil);
  // Iteration 08 (Lane P): benches, bins and the odd vending machine are composed (waiting clusters, landmarks; gen/compose.ts).
  let kiosk = false;
  if (kioskAllowed && Math.min(a.w, a.h) >= 40) {
    // Occasional freestanding newsstand island in a big hall.
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    kiosk = !!islandKiosk(ctx, a, Math.round((cx + rng.range(-3, 3)) * 2) / 2, Math.round((cz + rng.range(-2, 2)) * 2) / 2, rng.pick([0, Math.PI]), 1.4);
  }
  gridLights(ctx, a, 6, 5.5, 0.12, 3);
  // Wayfinding: plates over the openings and double-sided hanging signs across the hall.
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    const o = other(ctx, d, a);
    if (o.type === 'food-court') signAtDoor(ctx, d, a, {kind: 'info', text: 'FOOD COURT', w: 1.8});
    else if (o.type === 'retail-arcade') signAtDoor(ctx, d, a, {kind: 'info', text: o.label.toUpperCase().includes('UNDERGROUND') ? 'UNDERGROUND CONCOURSE · SHOPS' : 'SHOPS · WASHROOMS · EXITS', w: 2.6});
    else if (o.role === 'exit-hall') signAtDoor(ctx, d, a, {kind: 'info', text: 'EXITS', w: 1.4});
  }
  const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL;
  const cx = ax0 + aw / 2;
  const toFood = layout.areas.find(o => o.type === 'food-court');
  if (toFood) {
    const right = toFood.x + toFood.w / 2 > a.x + a.w / 2;
    layout.signs.push({x: cx, y: Math.min(a.ceil - 0.6, 3.4), z: az0 + ah * 0.42, rot: 0, kind: 'info', text: 'FOOD COURT', arrow: right ? 'right' : 'left', area: a.id, hang: true, w: 2.0});
    layout.signs.push({x: cx, y: Math.min(a.ceil - 0.6, 3.4), z: az0 + ah * 0.68, rot: 0, kind: 'info', text: 'SHOPS · WASHROOMS · EXITS', arrow: right ? 'left' : 'right', area: a.id, hang: true, w: 2.6});
  }
  return kiosk;
}

/**
 * Food court (research R13/R15/R21/R23): counters on the perimeter (storefront units), a 3–4 m
 * queue + circulation ring in front of them, then a seating "rug" of tables in the middle with
 * trash/tray stations at its corners, columns on a grid in big halls, vending by the entrance.
 */
function dressFoodCourt(ctx: Ctx, a: Area): void {
  const {rng, layout} = ctx;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const unitsOn = (s: Side) => layout.storefronts.some(f => f.hall === a.id && f.side === s);
  const ring = (s: Side) => (unitsOn(s) ? rng.range(3.4, 4.2) : rng.range(2.0, 2.6));
  let x0 = ax0 + ring('W'), x1 = ax1 - ring('E'), z0 = az0 + ring('N'), z1 = az1 - ring('S');
  if (x1 - x0 < 6) { const c = (ax0 + ax1) / 2; x0 = c - 3; x1 = c + 3; }
  if (z1 - z0 < 5) { const c = (az0 + az1) / 2; z0 = c - 2.5; z1 = c + 2.5; }
  // Columns on an 8–10 m grid inside big halls (placed first; tables flow around them).
  if (x1 - x0 > 16 && z1 - z0 > 8 && rng.chance(0.7)) {
    const sp = rng.range(8, 10);
    for (let x = x0 + (x1 - x0) % sp / 2 + sp / 2; x < x1 - 2; x += sp) for (const z of z1 - z0 > 14 ? [z0 + (z1 - z0) / 3, z0 + (z1 - z0) * 2 / 3] : [(z0 + z1) / 2]) {
      tryPlaceProp(ctx, a, 'column', (Math.floor(x / CELL) + 0.5) * CELL, (Math.floor(z / CELL) + 0.5) * CELL, 0, {h: a.ceil});
    }
  }
  // Seating: a grid of 4-tops or communal rows (tables pushed together along their length).
  const rows = rng.chance(0.5);
  const alongX = x1 - x0 >= z1 - z0;
  const rot = rows ? (alongX ? Math.PI / 2 : 0) : rng.pick([0, Math.PI / 2]);
  const {hx, hz} = footprint('table', rot);
  const stepX = rows && alongX ? hx * 2 + 0.02 : hx * 2 + rng.range(1.3, 1.7);
  const stepZ = rows && !alongX ? hz * 2 + 0.02 : hz * 2 + rng.range(1.3, 1.7);
  const group = rng.int(3, 4);
  let tables = 0;
  const pts: number[] = [];
  for (let x = x0 + hx, i = 0; x + hx <= x1; i++) {
    pts.push(x);
    x += stepX + (rows && alongX && (i + 1) % group === 0 ? 1.4 : 0);
  }
  const zs: number[] = [];
  for (let z = z0 + hz, i = 0; z + hz <= z1; i++) {
    zs.push(z);
    z += stepZ + (rows && !alongX && (i + 1) % group === 0 ? 1.4 : 0);
  }
  const offX = (x1 - (pts.length ? pts[pts.length - 1] + hx : x1)) / 2, offZ = (z1 - (zs.length ? zs[zs.length - 1] + hz : z1)) / 2;
  for (const x of pts) for (const z of zs) {
    if (tables >= 36 || rng.chance(0.08)) continue;
    if (tryPlaceProp(ctx, a, 'table', Math.round((x + offX) * 4) / 4, Math.round((z + offZ) * 4) / 4, rot, {variant: rng.int(0, 1)})) tables++;
  }
  // Trash / tray-return stations at the rug corners and one mid-side.
  for (const [x, z] of [[x0 - 0.5, z0 - 0.5], [x1 + 0.5, z0 - 0.5], [x0 - 0.5, z1 + 0.5], [x1 + 0.5, z1 + 0.5], [(x0 + x1) / 2, z0 - 0.5]]) {
    if (rng.chance(0.8)) tryPlaceProp(ctx, a, 'bin', Math.round(x * 4) / 4, Math.round(z * 4) / 4, 0, {checkZone: false});
  }
  layout.decor.push(...rugBoxes(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3));
  // Vending bank by the main entrance.
  const entry = (ctx.doorsOf.get(a.id) ?? []).find(d => !d.shopfront && !d.staff && other(ctx, d, a).publicSpace && other(ctx, d, a).type !== 'exit-stair');
  if (entry) {
    const side = doorSide(entry, a);
    const alongE = side === 'N' || side === 'S';
    const s0 = (alongE ? entry.x : entry.y) * CELL, s1 = s0 + (alongE ? entry.w : entry.h) * CELL;
    const before = rng.chance(0.5);
    rowAlongWall(ctx, a, side, 'vending', {from: before ? s0 - 5.4 : s1 + 1.4, to: before ? s0 - 1.4 : s1 + 5.4, max: 3, front: 1.0, variant: () => rng.int(0, 2)});
    const ex = (entry.x + entry.w / 2) * CELL, ez = (entry.y + entry.h / 2) * CELL;
    const inward = side === 'N' ? [0, 3.2] : side === 'S' ? [0, -3.2] : side === 'W' ? [3.2, 0] : [-3.2, 0];
    layout.signs.push({x: ex + inward[0], y: Math.min(a.ceil - 0.6, 3.5), z: ez + inward[1], rot: alongE ? 0 : Math.PI / 2, kind: 'info', text: 'FOOD COURT', area: a.id, hang: true, w: 2.4});
  }
  gridLights(ctx, a, 5.5, 5, 0.1, 2.5);
}

/**
 * Freestanding hall kiosk (iteration 05): a newsstand stall or a hot-dog cart, each carrying its
 * purpose for loot (gen/purposes.ts) so the stock matches what it is.
 */
function islandKiosk(ctx: Ctx, a: Area, x: number, z: number, rot: number, front: number): PropPlacement | null {
  const cart = ctx.rng.chance(0.4);
  const variant = ctx.rng.int(0, 3);
  const p = tryPlaceProp(ctx, a, cart ? 'hotdogCart' : 'stall', x, z, rot, {front, variant});
  if (p) p.purpose = cart ? 'hotdog' : 'newsstand';
  return p;
}

function dressArcade(ctx: Ctx, a: Area, kioskAllowed: boolean): boolean {
  const {rng, layout} = ctx;
  const sides = longSides(a);
  // Walls between storefronts: the odd vending machine / bench / bin.
  for (let i = 0, n = rng.int(1, 2); i < n; i++) placeAgainstWall(ctx, a, 'vending', {sides, front: 1.0, variant: rng.int(0, 2)});
  // Iteration 08 (Lane P): the bench / bins are a composed waiting cluster (gen/compose.ts).
  let kiosk = false;
  const alongX = a.w >= a.h;
  const wide = (alongX ? a.h : a.w) * CELL;
  if (kioskAllowed && wide >= 7 && rng.chance(0.6)) {
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    const t = rng.range(-0.25, 0.25) * (alongX ? a.w : a.h) * CELL;
    kiosk = !!islandKiosk(ctx, a, Math.round((alongX ? cx + t : cx) * 2) / 2, Math.round((alongX ? cz : cz + t) * 2) / 2, alongX ? rng.pick([0, Math.PI]) : rng.pick([Math.PI / 2, -Math.PI / 2]), 1.2);
  }
  lineLights(ctx, a, 4.5, 0.12);
  // Hanging wayfinding down the concourse.
  const len = (alongX ? a.w : a.h) * CELL;
  for (let t = 8; t < len - 6; t += 16) {
    layout.signs.push({x: alongX ? a.x * CELL + t : (a.x + a.w / 2) * CELL, y: Math.min(a.ceil - 0.45, 2.85), z: alongX ? (a.y + a.h / 2) * CELL : a.y * CELL + t, rot: alongX ? Math.PI / 2 : 0, kind: 'info', text: 'TO TRAINS · EXITS · FOOD COURT', area: a.id, hang: true, w: 2.8});
  }
  return kiosk;
}

function dressExitHall(ctx: Ctx, a: Area): void {
  const {rng, layout} = ctx;
  if (Math.min(a.w, a.h) >= 28) columnRow(ctx, a, 0.5, 8, a.ceil);
  const doorsHere = ctx.doorsOf.get(a.id) ?? [];
  const fare = doorsHere.find(d => d.fare);
  if (fare) {
    signAtDoor(ctx, fare, a, {kind: 'info', text: 'TO TRAINS', arrow: 'up', w: 1.6});
    placeAgainstWall(ctx, a, 'ticketMachine', {sides: [doorSide(fare, a)], front: 1.0});
    placeAgainstWall(ctx, a, 'ticketMachine', {sides: [doorSide(fare, a)], front: 1.0});
  }
  for (let i = 0, n = rng.int(1, 2); i < n; i++) placeAgainstWall(ctx, a, 'vending', {front: 1.0, variant: rng.int(0, 2)});
  // Iteration 08 (Lane P): benches / bins are composed waiting clusters (gen/compose.ts).
  gridLights(ctx, a, 5, 4.5, 0.12);
  for (const d of doorsHere) {
    const o = other(ctx, d, a);
    if (o.type === 'washroom') signAtDoor(ctx, d, a, {kind: 'info', text: o.label.toUpperCase(), w: 1.6});
    else if (o.type === 'retail-arcade' && a.role === 'crossunder') signAtDoor(ctx, d, a, {kind: 'info', text: 'TO PLATFORM ENTRANCES', w: 2.2});
  }
  if (layout.areas.some(o => o.type === 'exit-stair' && o.parent === a.id)) wallSign(ctx, a, longSides(a)[0], (a.w >= a.h ? a.x + a.w / 2 : a.y + a.h / 2) * CELL, 2.3, {kind: 'exit', text: 'STREET EXITS'});
}

function dressExitStair(ctx: Ctx, a: Area): void {
  const {rng, layout} = ctx;
  const d = (ctx.doorsOf.get(a.id) ?? [])[0];
  if (!d) return;
  const parent = other(ctx, d, a);
  const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL;
  const sd = PROP_DEFS.exitStair.d;
  // The stair climbs away from the door; its locked grille faces the landing.
  let x: number, z: number, rot: number, side: Side;
  if (d.h === 1 && d.y < a.y) { x = ax0 + aw / 2; z = az0 + ah - sd / 2; rot = Math.PI; side = 'S'; }
  else if (d.h === 1) { x = ax0 + aw / 2; z = az0 + sd / 2; rot = 0; side = 'N'; }
  else if (d.x < a.x) { x = ax0 + aw - sd / 2; z = az0 + ah / 2; rot = -Math.PI / 2; side = 'E'; }
  else { x = ax0 + sd / 2; z = az0 + ah / 2; rot = Math.PI / 2; side = 'W'; }
  tryPlaceProp(ctx, a, 'exitStair', x, z, rot);
  const street = rng.pick(EXIT_STREETS);
  signAtDoor(ctx, d, parent, {kind: 'exit', text: `${street.toUpperCase()} · EXIT CLOSED`, w: 2.4});
  // Notice on the grille, facing the landing.
  const fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
  layout.signs.push({x: x + fx * (sd / 2 + 0.06), y: 1.55, z: z + fz * (sd / 2 + 0.06), rot, kind: 'service', text: 'STREET ENTRANCE SEALED', area: a.id, w: 1.6});
  const lx = x + fx * (sd / 2 + 1.6), lz = z + fz * (sd / 2 + 1.6);
  addLight(ctx, a, lx, lz, side === 'N' || side === 'S' ? 0 : Math.PI / 2, 0);
  // Iteration 08 (Lane P): abandoned luggage piles up in front of the grille (gen/compose.ts evacuation traces).
}

function dressWashroom(ctx: Ctx, a: Area): void {
  const {rng} = ctx;
  const d = (ctx.doorsOf.get(a.id) ?? [])[0];
  // Cubicles along the wall opposite the door (fronts facing it), counter on a side wall.
  const ds: Side = d ? doorSide(d, a) : 'N';
  const far: Side = ds === 'N' ? 'S' : ds === 'S' ? 'N' : ds === 'W' ? 'E' : 'W';
  const sideWalls: Side[] = ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S'];
  rowAlongWall(ctx, a, far, 'toiletStall', {max: rng.int(3, 4), front: 0.8});
  placeAgainstWall(ctx, a, 'washCounter', {sides: sideWalls, front: 0.6});
  placeAgainstWall(ctx, a, 'bin');
  roomLights(ctx, a);
}

/**
 * Back-of-house dressing by PURPOSE (gen/purposes.ts ROOM_PURPOSES): fixtures, lights and plates
 * follow what the room is (staff room, janitor closet, security office …). Rules are relative to
 * the room's main door: far wall, side walls, door wall; rows along one wall; centre islands with
 * a walkway ring; back-to-back aisles. Door zones, access strips and room connectivity are
 * enforced by tryPlaceProp, so a rule that cannot fit is simply skipped.
 */
function dressBackOfHouse(ctx: Ctx, a: Area): void {
  const {rng, layout} = ctx;
  const P = ROOM_PURPOSES[a.purpose ?? ''] ?? ROOM_PURPOSES.storage;
  if (a.kind === 'service') {
    lineLights(ctx, a, 5, 0.25);
    wallSign(ctx, a, a.w >= a.h ? 'N' : 'W', a.w >= a.h ? (a.x + a.w / 2) * CELL : (a.y + a.h / 2) * CELL, 2.0, {kind: 'service', text: 'AUTHORIZED PERSONNEL ONLY'});
  }
  // Iteration 08 (Lane P): service corridors (and the lower service level) are composed (gen/compose.ts: maintenance bays, supply
  // shelving, carts by doors, caches) instead of the purpose rules' random wall spots; rooms keep their purpose rules.
  if (!COMPOSED_ZONES.has(zoneOf(layout, a))) dressByRules(ctx, a, P);
  if (a.kind === 'closet') {
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    layout.lights.push({x: cx, y: a.ceil - 0.02, z: cz, rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: rng.chance(0.3), warm: true, power: 1, dying: false});
  } else if (a.kind !== 'service') roomLights(ctx, a);
}

/** Runs a purpose's placement rules in a room. */
function dressByRules(ctx: Ctx, a: Area, P: RoomPurpose): void {
  const {rng} = ctx;
  const door = mainDoor(ctx, a);
  const ds: Side = door ? doorSide(door, a) : (a.w >= a.h ? 'S' : 'E');
  const sideWalls: Side[] = ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S'];
  const wallsFor = (sel: string | undefined): Side[] => sel === 'far' ? [OPPOSITE[ds]] : sel === 'side' ? rng.shuffle(sideWalls.slice()) : sel === 'near' ? [ds] : rng.shuffle(['N', 'S', 'E', 'W'] as Side[]);
  const themeV = P.stock ? stockVariant(P.stock) : 0;
  for (const r of P.props) {
    if (r.chance !== undefined && !rng.chance(r.chance)) continue;
    const n = rng.int(r.n[0], r.n[1]);
    if (n <= 0) continue;
    const variant = r.variant === 'stock' ? themeV : r.variant ?? 0;
    const sides = wallsFor(r.wall);
    switch (r.at) {
      case 'wall':
        for (let i = 0; i < n; i++) {
          const o = {sides, front: r.front, variant, y: r.y, tries: 16};
          // Preferred wall first, then any wall (a rule never silently drops a required fixture).
          if (!placeAgainstWall(ctx, a, r.kind, o) && r.wall && r.wall !== 'any') placeAgainstWall(ctx, a, r.kind, {...o, sides: ['N', 'S', 'E', 'W']});
        }
        break;
      case 'row': {
        let left = n;
        for (const side of [...sides, ...(['N', 'S', 'E', 'W'] as Side[]).filter(q => !sides.includes(q) && r.wall !== 'far')]) {
          if (left <= 0) break;
          const [lo, hi] = wallRange(a, side);
          left -= rowAlongWall(ctx, a, side, r.kind, {from: lo + 0.45, to: hi - 0.45, max: left, front: r.front, variant: () => variant}).length;
          if (left < n) break; // one wall per rule
        }
        break;
      }
      case 'center':
        for (let i = 0; i < n; i++) placeCenter(ctx, a, r.kind, variant, r.ring ?? 0.9);
        break;
      case 'aisle': {
        // Back-to-back pair of units down the middle of bigger rooms (stock-room gondola).
        if (a.h * CELL < 6.5 || a.w * CELL < 7.5) break;
        const def = PROP_DEFS[r.kind];
        const alongX = a.w >= a.h;
        const zc = (a.y + a.h / 2) * CELL, xc = (a.x + a.w / 2) * CELL;
        for (const off of [-(def.w / 2 + 0.05), def.w / 2 + 0.05]) {
          for (const dz of [-(def.d / 2 + 0.01), def.d / 2 + 0.01]) {
            const rot = alongX ? (dz < 0 ? Math.PI : 0) : (dz < 0 ? -Math.PI / 2 : Math.PI / 2);
            tryPlaceProp(ctx, a, r.kind, alongX ? xc + off : xc + dz, alongX ? zc + dz : zc + off, rot, {variant});
          }
        }
        break;
      }
    }
  }
}

/** Island near the room centre with a walkway ring; long side along the room's long axis. */
function placeCenter(ctx: Ctx, a: Area, kind: PropKind, variant: number, ring: number): PropPlacement | null {
  const def = PROP_DEFS[kind];
  const alongX = a.w >= a.h;
  const rot = (def.w >= def.d) === alongX ? 0 : Math.PI / 2;
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const offs = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2];
  for (const oa of offs) for (const ob of [0, 0.5, -0.5, 1, -1]) {
    const x = Math.round((cx + (alongX ? oa : ob)) * 4) / 4, z = Math.round((cz + (alongX ? ob : oa)) * 4) / 4;
    const p = tryPlaceProp(ctx, a, kind, x, z, rot, {variant, ring});
    if (p) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Lighting profiles

/** Seeded odds [lit, dim, dark] per room type. Main public circulation is always lit. */
export const LIGHT_ODDS: Record<RoomType, readonly [number, number, number]> = {
  'platform': [1, 0, 0], 'passage': [1, 0, 0], 'concourse': [1, 0, 0], 'fare-hall': [1, 0, 0],
  'food-court': [1, 0, 0], 'retail-arcade': [1, 0, 0],
  'underpass': [0.75, 0.25, 0], 'exit-stair': [0.5, 0.5, 0], 'washroom': [0.45, 0.45, 0.1],
  'service-corridor': [0, 0.45, 0.55],
  'agent-office': [0.45, 0.4, 0.15], 'crew-room': [0.35, 0.45, 0.2],
  'storage': [0.12, 0.45, 0.43], 'stock-room': [0.15, 0.45, 0.4], 'utility': [0.08, 0.4, 0.52],
  'supply-closet': [0, 0.35, 0.65], 'janitor-closet': [0, 0.3, 0.7],
  'eatery': [0.55, 0.35, 0.1], 'shop': [0.45, 0.4, 0.15],
  // Iteration 08 (Lane A): public stair cores between levels.
  'stair-core': [1, 0, 0],
  // Iteration 16 (WORLD-GEN): office tower — decades without upkeep: most of the floor runs dim or dead (purposes refine it).
  'office-lobby': [0.35, 0.5, 0.15], 'office-corridor': [0.3, 0.45, 0.25], 'office-open': [0.3, 0.45, 0.25], 'office-room': [0.2, 0.45, 0.35],
  'office-elevator': [1, 0, 0], 'office-stair': [0.5, 0.4, 0.1],
  // Task office-overhaul-20261030 (lane STRUCT): the open-sky roof has no fixtures (fixture-less daylight, gen/office/roof.ts).
  'office-roof': [0, 0, 1],
};

/**
 * Deliberate mixed lighting. Assigns each area a profile and sets fixture state from it:
 * lit = mostly working (+ occasional dead runs/flicker), dim = aged low-output tubes with about
 * half dead, dark = no working ceiling light (sometimes one dying tube that sputters).
 * Storefront units behind a shutter are mostly dark (part-shuttered ones mostly dim).
 */
export function applyLighting(layout: StationLayout, rng: Rng): void {
  const {areas} = layout;
  for (const a of areas) {
    // Iteration 05: the room's purpose may carry a lighting hint (gen/purposes.ts).
    let [lit, dim, dark] = purposeById(a.purpose)?.light ?? LIGHT_ODDS[a.type];
    const sf = a.storefront !== undefined ? layout.storefronts[a.storefront] : null;
    if (sf?.shutter === 'closed') [lit, dim, dark] = [0, 0.3, 0.7];
    else if (sf?.shutter === 'partial') [lit, dim, dark] = [0.15, 0.6, 0.25];
    a.lighting = rng.weighted([['lit', lit], ['dim', dim], ['dark', dark]] as const);
  }
  // Every station has at least one fully dark back-of-house space, and not all of them are dark.
  const back = areas.filter(a => !a.publicSpace);
  if (back.length && !back.some(a => a.lighting === 'dark')) {
    back.reduce((m, a) => (a.depth > m.depth || (a.depth === m.depth && a.id > m.id) ? a : m)).lighting = 'dark';
  }
  if (back.length > 1 && back.every(a => a.lighting === 'dark')) {
    const rooms = back.filter(a => a.kind === 'room');
    (rooms.length ? rooms : back).reduce((m, a) => (a.depth < m.depth ? a : m)).lighting = 'dim';
  }
  const sp = layout.playerSpawn;
  const byArea = new Map<number, LightPlacement[]>();
  for (const l of layout.lights) { let list = byArea.get(l.area); if (!list) byArea.set(l.area, (list = [])); list.push(l); }
  for (const a of areas) {
    const own = byArea.get(a.id) ?? [];
    if (!own.length && a.lighting !== 'dark') {
      const l: LightPlacement = {x: (a.x + a.w / 2) * CELL, y: fixtureYAbs(layout, a), z: (a.y + a.h / 2) * CELL, rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 1, dying: false};
      if (areaLevel(a)) l.level = areaLevel(a);
      layout.lights.push(l);
      own.push(l);
    }
    for (const l of own) { l.broken = false; l.flicker = false; l.dying = false; l.power = 1; }
    if (purposeById(a.purpose)?.warm) for (const l of own) l.warm = true;
    if (a.lighting === 'lit') {
      for (const l of own) { l.power = rng.range(0.9, 1); l.broken = rng.chance(0.07); l.flicker = !l.broken && rng.chance(0.1); }
      // Partial failure: a dead run of neighbouring fixtures, well away from the spawn.
      if ((a.kind === 'platform' || a.kind === 'concourse') && own.length >= 6) {
        for (let runs = 0, n = own.length >= 30 ? 2 : 1; runs < n; runs++) {
          if (!rng.chance(0.6)) continue;
          const far = own.filter(l => Math.hypot(l.x - sp.x, l.z - sp.z) > SPAWN_LIT_RADIUS + 7);
          if (!far.length) continue;
          const c = rng.pick(far);
          const byDist = own.slice().sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z));
          const run = byDist.slice(0, rng.int(2, 4)).filter(l => Math.hypot(l.x - c.x, l.z - c.z) < 7);
          for (const l of run) { l.broken = true; l.flicker = false; }
          const edge = byDist.find(l => !l.broken);
          if (edge) edge.flicker = true;
        }
      }
      // Lit means lit: at least 60% of the fixtures work.
      const need = Math.max(1, Math.ceil(own.length * 0.6));
      let working = own.filter(x => !x.broken).length;
      for (const l of own) {
        if (working >= need) break;
        if (l.broken) { l.broken = false; working++; }
      }
    } else if (a.lighting === 'dim') {
      for (const l of own) { l.power = rng.range(0.42, 0.62); l.broken = rng.chance(0.45); l.flicker = !l.broken && rng.chance(0.35); }
      if (!own.some(l => !l.broken)) { const l = rng.pick(own); l.broken = false; l.flicker = rng.chance(0.5); }
    } else {
      for (const l of own) l.broken = true;
      // Sometimes one tube is dying: the room stays dark apart from brief sputters.
      if (own.length && rng.chance(0.35)) { const l = rng.pick(own); l.broken = false; l.dying = true; l.flicker = true; l.power = 0.5; }
    }
  }
  // Readable start: lit fixtures around the spawn always work steadily.
  for (const l of layout.lights) {
    if (areas[l.area]?.lighting === 'lit' && Math.hypot(l.x - sp.x, l.z - sp.z) < SPAWN_LIT_RADIUS) { l.broken = false; l.flicker = false; l.dying = false; l.power = 1; }
  }
}

// ---------------------------------------------------------------------------------------
// Player, zombies and pickups

export function clearAround(g: Grid, x: number, y: number, r: number): boolean {
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (!g.walkable(x + ox, y + oy)) return false;
  return true;
}

/** Task loot-tables-20261030 (lane LOOT): the loose floor finds follow `loot`'s Subway floor program (lootTables SUBWAY_FLOOR). */
export function placeSpawns(layout: StationLayout, rng: Rng, loot: LootProfile = lootProfile('subway'), spawns: SpawnProfile = spawnProfile('subway')): void {
  const g = layout.grid;
  const plat = layout.areas[layout.platform];
  // Platform 1, a fifth of the way along, looking down the platform with the tracks in view.
  // Iteration 08 (Lane A): the generator may hint the end (its level program sits at the other end); the draw is kept for stability.
  const coin = rng.chance(0.5);
  const west = layout.spawnEnd ? layout.spawnEnd === 'W' : coin;
  const sx = west ? plat.x + Math.round(plat.w * 0.2) : plat.x + plat.w - 1 - Math.round(plat.w * 0.2);
  const sy = plat.y + Math.floor(plat.h * 0.42);
  let spawn: [number, number] | null = null;
  for (let r = 0; r < 10 && !spawn; r++) {
    for (let oy = -r; oy <= r && !spawn; oy++) for (let ox = -r; ox <= r; ox++) {
      const x = sx + ox, y = sy + oy;
      if (g.area[g.idx(x, y)] === plat.id && clearAround(g, x, y, 2)) { spawn = [x, y]; break; }
    }
  }
  if (!spawn) spawn = [sx, sy];
  const [wx, wz] = g.center(spawn[0], spawn[1]);
  layout.playerSpawn = {x: wx, z: wz, yaw: west ? -Math.PI / 2 + 0.32 : Math.PI / 2 - 0.32};
  const dist = g.distanceField(spawn[0], spawn[1]);

  // --- Pickups ---
  const zone = new Uint8Array(g.w * g.h);
  for (const d of layout.doors) for (let y = d.y - 2; y < d.y + d.h + 2; y++) for (let x = d.x - 2; x < d.x + d.w + 2; x++) if (g.inBounds(x, y)) zone[g.idx(x, y)] = 1;
  const used = new Set<number>();
  const pickCell = (area: Area, minSpawnDist: number): [number, number] | null => {
    const cands: [number, number][] = [];
    for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) {
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || zone[i] || used.has(i) || g.area[i] !== area.id) continue;
      if (dist[i] < minSpawnDist) continue;
      // Prefer spots next to walls or props, like dropped supplies.
      let near = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!g.walkable(x + ox, y + oy)) near++;
      cands.push([x, y]);
      if (near) cands.push([x, y], [x, y]);
    }
    if (!cands.length) return null;
    const c = rng.pick(cands);
    used.add(g.idx(c[0], c[1]));
    return c;
  };
  const place = (itemId: string, count: number, area: Area, minSpawnDist = 12): boolean => {
    // Sometimes on top of a low cabinet in the area.
    const tops = layout.props.filter(p => p.area === area.id && p.kind === 'cabinetLow' && p.y === 0);
    if (tops.length && rng.chance(0.45)) {
      const t = rng.pick(tops);
      const [x0, y0] = g.cellOf(t.x - t.hx - 0.3, t.z - t.hz - 0.3);
      const [x1, y1] = g.cellOf(t.x + t.hx + 0.3, t.z + t.hz + 0.3);
      let ok = false;
      for (let y = y0; y <= y1 && !ok; y++) for (let x = x0; x <= x1; x++) if (g.walkable(x, y) && dist[g.idx(x, y)] >= minSpawnDist) { ok = true; break; }
      if (ok) {
        layout.pickups.push({itemId, count, x: t.x + rng.range(-t.hx * 0.5, t.hx * 0.5), y: t.h + 0.01, z: t.z + rng.range(-t.hz * 0.3, t.hz * 0.3), area: area.id});
        return true;
      }
    }
    const c = pickCell(area, minSpawnDist);
    if (!c) return false;
    const [x, z] = g.center(c[0], c[1]);
    layout.pickups.push({itemId, count, x: x + rng.range(-0.1, 0.1), y: 0, z: z + rng.range(-0.1, 0.1), area: area.id});
    return true;
  };

  // Pistol lane (2026-10-28): no guaranteed spawn-side shotgun any more — the non-starting weapons are seeded
  // map finds placed after the level spawns (gen/weaponFinds.ts placeWeaponFinds).
  // Loose floor supplies (shelves/counters/vending/containers hold the rest; rolled by items/containers).
  // Iteration 05: where they turn up follows the room PURPOSE (gen/purposes.ts `floor`): ammo in
  // the security office, stores and electrical rooms, dressings in first-aid rooms and pharmacies,
  // nothing in florists or food counters; public halls keep a small share (dropped supplies).
  const PUBLIC_FLOOR = PUBLIC_FLOOR_WEIGHTS.station;
  const floorWeight = (a: Area, cat: 'ammo' | 'med'): number => {
    const p = purposeById(a.purpose);
    if (p) return p.floor?.[cat] ?? 0;
    return PUBLIC_FLOOR[a.type] ?? 0;
  };
  const lootAreas = (cat: 'ammo' | 'med'): [Area, number][] => layout.areas.map(a => [a, floorWeight(a, cat)] as [Area, number]).filter(e => e[1] > 0);
  // Task loot-tables-20261030 (lane LOOT): the station's floor program as data (lootTables SUBWAY_FLOOR), interpreted in exactly the
  // historical draw order: the ammo boxes' counts on the spawn stream; iteration 12 (LOOT lane) scarce resources — each old loose
  // dressing / first-aid kit survives ~1 in 5 (counts on the spawn stream, keep draws on their own fork: the draws above stay as
  // they were), plus sometimes a torch battery and a flare (scarce fork), dropped in service / security rooms first.
  const prog = loot.tables.floor.subway;
  const found: [string, number][] = [];
  for (const b of prog.boxes) {
    const [lo, hi] = floorCount(loot, econCat(b.itemId), b.n);
    for (let i = 0, n = rng.int(lo, hi); i < n; i++) found.push([b.itemId, b.count]);
  }
  const scarceFloor = rng.fork('scarce-floor');
  for (const k of prog.kept) {
    const [lo, hi] = floorCount(loot, econCat(k.itemId), k.n), keep = floorChance(loot, econCat(k.itemId), k.keep);
    for (let i = 0, n = rng.int(lo, hi); i < n; i++) if (scarceFloor.chance(keep)) found.push([k.itemId, k.count]);
  }
  for (const c of prog.light) if (scarceFloor.chance(floorChance(loot, econCat(c.itemId), c.chance))) found.push([c.itemId, c.count]);
  const lightPool = layout.areas.filter(a => a.storefront === undefined && a.type !== 'stair-core')
    .map(a => [a, FLOOR_ECONOMY.themeWeight[lootTheme(a.purpose ?? a.type)]] as [Area, number]).filter(e => e[1] > 0);
  const pools = {ammo: lootAreas('ammo'), med: lootAreas('med'), light: lightPool};
  for (const [id, count] of found) {
    const pool = pools[id.startsWith('ammo') ? 'ammo' : id === BATTERY_ID || id === FLARE_ID ? 'light' : 'med'];
    if (!pool.length || !(id in ITEMS)) continue;
    for (let t = 0; t < 10; t++) if (place(id, count, rng.weighted(pool))) break;
  }

  // --- Zombies: spread across public halls and back-of-house, never near the spawn ---
  // Iteration 12 (AI, mandate F "double the number of enemies"): 22-32 spawn points (was 11-16; ai/creatureSpawn.ts ENEMY_SPAWNS).
  // Task enemy-spawn-tables-20261030 (lane SPAWN): every control is the level's spawn profile (ai/spawnTables.ts, context 'station':
  // count, type roll, keep-away / clearance, area weights × room intensity, caps, tries, spacing) — same values, same draws.
  const ctx = spawnContext(spawns, 'station'), pl = ctx.placement;
  const count = rng.int(ctx.count[0], ctx.count[1]);
  const types = rollZombieTypes(rng, count, spawns.zombieTypes);
  const areaW = new Map<number, number>();
  const weightOf = (id: number): number => {
    let w = areaW.get(id);
    if (w === undefined) areaW.set(id, (w = areaSpawnWeight(pl.areaWeights, spawns, layout.areas[id])));
    return w;
  };
  const byArea = new Map<number, [number, number][]>();
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR || dist[i] < pl.startCells || !clearAround(g, x, y, pl.clearCells)) continue;
    const a = g.area[i];
    // Lane SPAWN: an area whose effective weight is 0 (a room modifier density 0) is never a candidate. Every shipped baseline
    // weight is > 0, so this never skips an area of a shipped profile.
    if (layout.areas[a] && !(weightOf(a) > 0)) continue;
    let l = byArea.get(a);
    if (!l) byArea.set(a, (l = []));
    l.push([x, y]);
  }
  reportSpawnCandidates(layout, 'station', byArea);
  // Weighted shuffle of the candidate areas (Efraimidis-Spirakis keys).
  const order = [...byArea.keys()].map(id => ({id, k: Math.pow(rng.next(), 1 / weightOf(id))})).sort((p, q) => q.k - p.k).map(o => o.id);
  const perArea = new Map<number, number>();
  for (const cap of pl.caps.passes) {
    for (const id of order) {
      if (layout.zombies.length >= count) break;
      const a = layout.areas[id];
      const limit = areaCap(pl.caps, a, cap);
      if ((perArea.get(id) ?? 0) >= limit) continue;
      const cells = byArea.get(id)!;
      for (let t = 0; t < pl.tries; t++) {
        const [x, y] = rng.pick(cells);
        const [zx, zz] = g.center(x, y);
        if (layout.zombies.some(z => Math.hypot(z.x - zx, z.z - zz) < pl.spacingM)) continue;
        perArea.set(id, (perArea.get(id) ?? 0) + 1);
        layout.zombies.push({x: zx, z: zz, yaw: rng.range(-Math.PI, Math.PI), type: types[layout.zombies.length], area: id});
        break;
      }
    }
  }
}
