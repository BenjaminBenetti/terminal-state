// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-COURSE): the MINI-GOLF event's course and venue
// (gen/skyways/events/golfDress.ts + golfCourse.ts, kinds golfKinds.ts, drawing world/skywaysGolfDraw.ts) on several mini-golf seeds:
// a real multi-hole course (6-9 holes of varied designs, one real cup per hole inside its rails, a ball on every tee standing on the
// turf), the cup a true gap in the course's collision (a ray at its centre reaches the floor), the ball's line continuous turf and clear
// of rails / blocks / arch posts, the piece-size rule, no overlaps / walls / door strips, aisles reaching every tee and door without
// crossing the course, a real Player walking onto every tee (the walk-over pieces), exactly one putter on the front desk's top,
// determinism, every new kind classified / scale-recorded / drawn, and version 6 untouched.

import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {skywaysAddonFor} from '../src/gen/skyways/frame';
import {skywaysGolfDressOf, type GolfHoleDress} from '../src/gen/skyways/events/golfDress';
import {GOLF_BALL_ITEM, GOLF_BALL_R, GOLF_CUP_HALF, GOLF_DECK_KINDS, GOLF_GREEN_H, GOLF_PIECE_MAX_R, GOLF_WALK_OVER_KINDS, PUTTER_ITEM, golfColliderBoxes, golfDeckTop, type GolfBox}
  from '../src/gen/skyways/events/golfContract';
import {GOLF_KINDS, GOLF_SCALE, GOLF_SPECS} from '../src/gen/skyways/events/golfKinds';
import {doorPoint} from '../src/gen/skyways/addonFrame';
import {VENUE_DOOR_CLEAR} from '../src/gen/skyways/venueDress';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../src/gen/props';
import {cellsOfBox} from '../src/gen/placeKit';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player} from '../src/player/player';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {PROP_DAMAGE} from '../src/damage/materials';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {SKYWAYS_EVENT_PAINTER_IDS, buildSkywaysEventProp} from '../src/world/skywaysEventDraw';
import {WorldMaterials} from '../src/world/materials';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import type {SkywaysEventKind} from '../src/gen/skyways/events/kinds';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
const V = 7;
const SEEDS: number[] = [];
for (let s = 1; s <= 200 && SEEDS.length < 3; s++) if (skywaysAddonFor(s, V) === 'mini-golf') SEEDS.push(s);
const cache = new Map<number, StationLayout>();
const fresh = (s: number, v = V): StationLayout => LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol', layoutVersion: v} as never);
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = fresh(s))); return l; };
const holesOf = (l: StationLayout): GolfHoleDress[] => skywaysGolfDressOf(l)?.holes ?? [];
const GOLF: ReadonlySet<string> = new Set(GOLF_KINDS);
const golfProps = (l: StationLayout) => l.props.filter(p => GOLF.has(p.kind));
const boxOf = (p: PropPlacement): GolfBox => ({x0: p.x - p.hx, y0: p.y, z0: p.z - p.hz, x1: p.x + p.hx, y1: p.y + p.h, z1: p.z + p.hz});
const collidersOf = (p: PropPlacement): GolfBox[] => (p.h <= 0.02 ? [] : golfColliderBoxes(p) ?? [boxOf(p)]);
const overlapXZ = (a: {x0: number; z0: number; x1: number; z1: number}, b: {x0: number; z0: number; x1: number; z1: number}, eps = 1e-3) =>
  a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps;
const rectOf = (p: PropPlacement) => ({x0: p.x - p.hx, z0: p.z - p.hz, x1: p.x + p.hx, z1: p.z + p.hz});
const hallOf = (l: StationLayout) => l.areas[l.skyways!.addon.venue!.find(q => q.role === 'main-hall')!.area];
const baseOf = (l: StationLayout) => l.skyways!.storeys[l.skyways!.addon.level].baseY;
const coursePieces = (h: GolfHoleDress) => [...h.deck, h.cup, ...h.rails, ...h.blocks, ...h.arches];

describe('the mini-golf course (layout version 7)', () => {
  it(`seeds ${SEEDS.join(', ')} are mini-golf; a real multi-hole course: 6-9 holes numbered from 1, varied designs, neighbouring tints differ`, () => {
    expect(SEEDS.length).toBe(3);
    for (const s of SEEDS) {
      const l = gen(s), g = l.skyways!.addon.golf!, hs = holesOf(l);
      expect(l.skyways!.addon.id).toBe('mini-golf');
      expect(g.holes.length, `seed ${s}`).toBeGreaterThanOrEqual(6);
      expect(g.holes.length, `seed ${s}`).toBeLessThanOrEqual(9);
      expect(g.holes.map(h => h.n)).toEqual(g.holes.map((_, k) => k + 1));
      expect(hs.length).toBe(g.holes.length);
      expect(new Set(g.holes.map(h => h.design)).size, `seed ${s} designs`).toBeGreaterThanOrEqual(Math.min(g.holes.length, 6));
      for (const h of g.holes) expect([2, 3]).toContain(h.par);
      for (let k = 1; k < g.holes.length; k++) expect(g.holes[k].tint, `seed ${s} hole ${k + 1} tint`).not.toBe(g.holes[k - 1].tint);
      expect(g.name.length).toBeGreaterThan(3);
      // the turf deck of each hole is in its own tint
      for (const h of hs) for (const p of [...h.deck, h.cup]) expect(p.variant).toBe(h.tint);
    }
  });

  it('each hole: exactly one cup piece, inside its playing area and enclosed by its own rails; a tee mat with a ball standing on the turf top', () => {
    for (const s of SEEDS) {
      const l = gen(s), g = l.skyways!.addon.golf!, base = baseOf(l), cups = golfProps(l).filter(p => p.kind === 'golfCup');
      expect(cups.length).toBe(g.holes.length);
      holesOf(l).forEach((h, k) => {
        const rec = g.holes[k];
        // one cup in the hole's bay, at the record's cup
        expect(cups.filter(c => c.x >= h.bay.rect.x0 && c.x <= h.bay.rect.x1 && c.z >= h.bay.rect.z0 && c.z <= h.bay.rect.z1).length, `seed ${s} hole ${h.n}`).toBe(1);
        expect([h.cup.x, h.cup.z]).toEqual([rec.cup.x, rec.cup.z]);
        expect(rec.cup.y).toBeCloseTo(base + GOLF_GREEN_H, 6);
        // enclosed: rays from the cup along +-x / +-z meet one of the hole's rails before leaving its bay
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let hit = false;
          for (let d = 0.05; d < 12 && !hit; d += 0.02) {
            const x = h.cup.x + dx * d, z = h.cup.z + dz * d;
            if (x < h.bay.rect.x0 || x > h.bay.rect.x1 || z < h.bay.rect.z0 || z > h.bay.rect.z1) break;
            hit = h.rails.some(r => Math.abs(x - r.x) <= r.hx && Math.abs(z - r.z) <= r.hz);
          }
          expect(hit, `seed ${s} hole ${h.n} rail toward ${dx},${dz}`).toBe(true);
        }
        // the tee: its mat on the turf, the ball (origin = its bottom) standing on the turf top under it
        const ball = l.pickups[rec.ball!];
        expect(ball.itemId).toBe(GOLF_BALL_ITEM);
        expect([ball.x, ball.z]).toEqual([rec.tee.x, rec.tee.z]);
        const under = [...h.deck, h.cup].filter(p => Math.abs(ball.x - p.x) <= p.hx && Math.abs(ball.z - p.z) <= p.hz);
        expect(under.length, `seed ${s} hole ${h.n} deck under the tee`).toBeGreaterThan(0);
        for (const p of under) expect(ball.y, `seed ${s} hole ${h.n} ball on the turf`).toBeCloseTo(golfDeckTop(p)!, 6);
        expect(h.mat.y).toBeCloseTo(ball.y, 6);
        expect(Math.abs(ball.x - h.mat.x) <= h.mat.hx && Math.abs(ball.z - h.mat.z) <= h.mat.hz).toBe(true);
        // the sign and the flag of the hole
        expect(l.props[rec.sign!].kind).toBe('golfTeeSign');
        expect(l.props[rec.flag!].kind).toBe('golfFlag');
        const fl = l.props[rec.flag!];
        expect(Math.hypot(fl.x - h.cup.x, fl.z - h.cup.z), 'flag beside the cup').toBeLessThan(1.6);
        expect(h.rails.some(r => Math.abs(fl.x - r.x) <= r.hx + fl.hx + 0.06 && Math.abs(fl.z - r.z) <= r.hz + fl.hz + 0.06), 'flag at the cup\'s rail').toBe(true);
        expect(Math.hypot(l.props[rec.flag!].x - h.cup.x, l.props[rec.flag!].z - h.cup.z), 'flag not in the cup').toBeGreaterThan(0.1);
      });
    }
  });

  it('the cup is a real opening: a ray down its centre meets no course collider above the floor; the turf round it and along the ball\'s line is continuous; the line clears rails / blocks / arch posts', () => {
    for (const s of SEEDS) {
      const l = gen(s), base = baseOf(l);
      const all = golfProps(l), boxes = all.flatMap(p => collidersOf(p).map(b => ({p, b})));
      for (const h of holesOf(l)) {
        const at = (x: number, z: number, e = 0) => boxes.filter(({b}) => x > b.x0 - e && x < b.x1 + e && z > b.z0 - e && z < b.z1 + e);
        expect(at(h.cup.x, h.cup.z).filter(({b}) => b.y1 > base + 1e-3).map(({p}) => p.kind), `seed ${s} hole ${h.n} cup gap`).toEqual([]);
        // the deck surrounds the gap: just beyond it, the turf top
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const top = Math.max(...at(h.cup.x + dx * (GOLF_CUP_HALF + 0.01), h.cup.z + dz * (GOLF_CUP_HALF + 0.01)).filter(({p}) => GOLF_DECK_KINDS.has(p.kind)).map(({b}) => b.y1));
          expect(top, `seed ${s} hole ${h.n} turf round the cup`).toBeCloseTo(base + GOLF_GREEN_H, 6);
        }
        // the ball's line (bonus geometry check): turf under every point; at ball height no rail / block / arch post within a ball radius
        const obstacles = boxes.filter(({p}) => !GOLF_DECK_KINDS.has(p.kind) && p.kind !== 'golfFlag' && p.kind !== 'golfTeeSign');
        for (let k = 0; k + 1 < h.path.length; k++) {
          const a = h.path[k], b = h.path[k + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.02);
          for (let j = 0; j <= n; j++) {
            const x = a.x + ((b.x - a.x) * j) / n, z = a.z + ((b.z - a.z) * j) / n;
            if (Math.hypot(x - h.cup.x, z - h.cup.z) < GOLF_CUP_HALF * Math.SQRT2 + GOLF_BALL_R) continue;
            const deck = at(x, z, 1e-6).filter(({p}) => GOLF_DECK_KINDS.has(p.kind));
            expect(deck.length, `seed ${s} hole ${h.n} turf under the line at ${x.toFixed(2)},${z.toFixed(2)}`).toBeGreaterThan(0);
            const top = Math.max(...deck.map(({b: q}) => q.y1)), y0 = top, y1 = top + 2 * GOLF_BALL_R;
            const hit = obstacles.filter(({b: q}) => x > q.x0 - GOLF_BALL_R && x < q.x1 + GOLF_BALL_R && z > q.z0 - GOLF_BALL_R && z < q.z1 + GOLF_BALL_R && q.y0 < y1 && q.y1 > y0 + 1e-4);
            expect(hit.map(({p}) => p.kind), `seed ${s} hole ${h.n} line at ${x.toFixed(2)},${z.toFixed(2)}`).toEqual([]);
          }
        }
      }
    }
  });

  it('every collider piece obeys GOLF_PIECE_MAX_R; the walk-over flag is on exactly the walk-over kinds; deck pieces stand on the floor, rails / blocks / arches / mats on the deck top', () => {
    for (const s of SEEDS) {
      const l = gen(s), base = baseOf(l);
      for (const p of golfProps(l)) {
        if (!p.mounted && p.host === undefined && p.h > 0.02 && p.kind !== 'golfTeeSign') expect(Math.hypot(p.hx, p.hz), `${p.kind} ${p.x},${p.z}`).toBeLessThanOrEqual(GOLF_PIECE_MAX_R);
        expect(!!p.walkOver, p.kind).toBe(GOLF_WALK_OVER_KINDS.has(p.kind));
        if (GOLF_DECK_KINDS.has(p.kind)) expect(p.y).toBeCloseTo(base, 6);
      }
      for (const h of holesOf(l)) {
        const deck = [...h.deck, h.cup];
        for (const q of [...h.rails, ...h.blocks, ...h.arches, h.mat]) {
          const under = deck.filter(d => Math.abs(q.x - d.x) <= d.hx + 1e-6 && Math.abs(q.z - d.z) <= d.hz + 1e-6);
          expect(under.length, `seed ${s} hole ${h.n} ${q.kind} on the deck`).toBeGreaterThan(0);
          expect(under.some(d => Math.abs(golfDeckTop(d)! - q.y) < 1e-6), `seed ${s} hole ${h.n} ${q.kind} at the deck top`).toBe(true);
        }
      }
    }
  });

  it('the course never overlaps itself, a wall, a door strip or another hole', () => {
    for (const s of SEEDS) {
      const l = gen(s), hall = hallOf(l), g = l.levels[l.skyways!.addon.level].grid, hs = holesOf(l);
      const deck = golfProps(l).filter(p => GOLF_DECK_KINDS.has(p.kind));
      for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) expect(overlapXZ(rectOf(deck[i]), rectOf(deck[j])), `seed ${s} deck ${i} / ${j}`).toBe(false);
      const strips = l.doors.filter(d => d.a === hall.id || d.b === hall.id).map(d => {
        const p = doorPoint(d, hall), along = p.side === 'N' || p.side === 'S', inX = p.x + p.nx * VENUE_DOOR_CLEAR, inZ = p.z + p.nz * VENUE_DOOR_CLEAR;
        return along ? {x0: p.x - p.half - 0.3, x1: p.x + p.half + 0.3, z0: Math.min(p.z, inZ), z1: Math.max(p.z, inZ)} : {x0: Math.min(p.x, inX), x1: Math.max(p.x, inX), z0: p.z - p.half - 0.3, z1: p.z + p.half + 0.3};
      });
      for (const h of hs) for (const p of [...coursePieces(h), h.mat]) {
        const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          const i = g.idx(cx, cy);
          expect(g.cells[i] === FLOOR && g.area[i] === hall.id, `seed ${s} hole ${h.n} ${p.kind} on the hall floor`).toBe(true);
        }
        for (const st of strips) expect(overlapXZ(rectOf(p), st, 0), `seed ${s} hole ${h.n} ${p.kind} in a door strip`).toBe(false);
        // inside its own bay (never another hole's)
        expect(p.x - p.hx >= h.bay.rect.x0 - 1e-6 && p.x + p.hx <= h.bay.rect.x1 + 1e-6 && p.z - p.hz >= h.bay.rect.z0 - 1e-6 && p.z + p.hz <= h.bay.rect.z1 + 1e-6, `seed ${s} hole ${h.n} ${p.kind} in its bay`).toBe(true);
      }
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) expect(overlapXZ(hs[i].bay.rect, hs[j].bay.rect), `seed ${s} bays ${i} / ${j}`).toBe(false);
    }
  });

  it('circulation: from the course entry, a 0.7 m wide walk round the course (never over it) reaches every door of the hall and every tee\'s approach', () => {
    for (const s of SEEDS) {
      const l = gen(s), hall = hallOf(l), g = l.levels[l.skyways!.addon.level].grid, hs = holesOf(l);
      const course = hs.flatMap(h => [...coursePieces(h), ...(h.sign ? [h.sign] : [])]).map(rectOf);
      const r = 0.35;
      const ok = (cx: number, cy: number) => {
        if (!g.inBounds(cx, cy)) return false;
        const i = g.idx(cx, cy), x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
        return g.cells[i] === FLOOR && g.area[i] === hall.id && !g.blocked[i] && g.circleClear(x, z, r)
          && !course.some(q => x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r);
      };
      const doors = l.doors.filter(d => d.a === hall.id || d.b === hall.id).map(d => doorPoint(d, hall));
      const entry = doors.slice().sort((p, q) => q.half - p.half)[0];
      const seen = new Uint8Array(g.w * g.h), q: number[] = [];
      const [ex, ey] = g.cellOf(entry.x + entry.nx * 0.75, entry.z + entry.nz * 0.75);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) if (ok(ex + dx, ey + dy)) { const i = g.idx(ex + dx, ey + dy); if (!seen[i]) { seen[i] = 1; q.push(i); } }
      expect(q.length, `seed ${s} entry`).toBeGreaterThan(0);
      for (let k = 0; k < q.length; k++) {
        const cx = q[k] % g.w, cy = Math.floor(q[k] / g.w);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) if (ok(nx, ny) && !seen[g.idx(nx, ny)]) { seen[g.idx(nx, ny)] = 1; q.push(g.idx(nx, ny)); }
      }
      const near = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.inBounds(cx + dx, cy + dy) && seen[g.idx(cx + dx, cy + dy)]) return true; return false; };
      for (const d of doors) expect(near(d.x + d.nx * 0.75, d.z + d.nz * 0.75), `seed ${s} door ${d.x},${d.z}`).toBe(true);
      for (const h of hs) {
        const a = h.frame.toWorld({x: h.built.plan.tee.x, z: -0.6});
        expect(near(a.x, a.z), `seed ${s} hole ${h.n} tee approach`).toBe(true);
      }
    }
  });

  it('holes reachable on foot: a real Player walks from each tee\'s approach over its rail onto the tee (the course pieces are walk-over)', () => {
    const s = SEEDS[0], l = gen(s), lv = levelsOf(l), idx = new PropIndex(lv, l.props), base = baseOf(l);
    class Keys { held = new Set<string>(['KeyW']); down(c: string) { return this.held.has(c); } hit() { return false; } }
    const keys = new Keys();
    for (const h of holesOf(l)) {
      const a = h.frame.toWorld({x: h.built.plan.tee.x, z: -0.6}), t = h.tee;
      const p = new Player();
      p.spawn(a.x, a.z, 0, 0);
      p.y = lv.floorAt(a.x, a.z, base + 0.3);
      expect(p.y).toBeCloseTo(base, 4);
      for (let k = 0; k < 60 * 6 && Math.hypot(t.x - p.x, t.z - p.z) > 0.15; k++) {
        p.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
        p.update(1 / 60, keys as never, lv, idx, {aiming: false, speedMult: 1, canSprint: false});
      }
      expect(Math.hypot(t.x - p.x, t.z - p.z), `seed ${s} hole ${h.n}: the player reached the tee`).toBeLessThanOrEqual(0.15);
    }
  }, 60000);

  it('the front desk: exactly one putter, lying on a counter top (its span cut from the loot surface), spare balls and the scorecard beside it', () => {
    for (const s of SEEDS) {
      const l = gen(s), g = l.skyways!.addon.golf!, info = skywaysGolfDressOf(l)!;
      const putters = l.pickups.filter(p => p.itemId === PUTTER_ITEM);
      expect(putters.length, `seed ${s}`).toBe(1);
      expect(l.pickups[g.desk!.putter!]).toBe(putters[0]);
      const onTop = (pk: {x: number; y: number; z: number}) => info.desk!.counters.find(c => {
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot), dx = pk.x - c.x, dz = pk.z - c.z, lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
        return Math.abs(lx) <= PROP_DEFS.shopCounter.w / 2 && Math.abs(lz) <= PROP_DEFS.shopCounter.d / 2 && Math.abs(pk.y - (c.y + SHOP_COUNTER_TOP_Y)) < 1e-6
          && (c.cut ?? []).some(q => q.x0 <= lx && lx <= q.x1);
      });
      expect(onTop(putters[0]), `seed ${s} putter on the desk`).toBeTruthy();
      expect(g.desk!.balls!.length).toBeGreaterThanOrEqual(2);
      expect(g.desk!.balls!.length).toBeLessThanOrEqual(4);
      for (const i of g.desk!.balls!) { expect(l.pickups[i].itemId).toBe(GOLF_BALL_ITEM); expect(onTop(l.pickups[i]), `seed ${s} spare ball on the desk`).toBeTruthy(); }
      expect(info.desk!.card?.kind).toBe('golfScorecardStand');
      expect(l.props[info.desk!.card!.host!].kind).toBe('shopCounter');
      // every golf ball is a tee ball or a desk ball
      expect(l.pickups.filter(p => p.itemId === GOLF_BALL_ITEM).length).toBe(g.holes.length + g.desk!.balls!.length);
      // the course hall takes no floor finds (a find would lie under the turf)
      expect(hallOf(l).noFloorLoot).toBe(true);
      expect(l.pickups.filter(p => p.area === hallOf(l).id && p.itemId !== GOLF_BALL_ITEM)).toEqual([]);
    }
  });

  it('the rooms: party tables with chairs and a banner, the clubhouse benches and the putter rack (nothing hung on it)', () => {
    for (const s of SEEDS) {
      const l = gen(s), info = skywaysGolfDressOf(l)!, kinds = info.rooms.flatMap(r => r.props.map(p => p.kind));
      expect(kinds).toContain('golfPartyBanner');
      expect(kinds).toContain('golfPutterRack');
      expect(kinds.filter(k => k === 'foldingChair').length).toBeGreaterThanOrEqual(2);
      expect(kinds).toContain('bench');
      const rack = l.props.find(p => p.kind === 'golfPutterRack')!;
      expect(rack.mounted).toBe(true);
      expect(l.props.filter(p => p.host === l.props.indexOf(rack))).toEqual([]);
      expect(l.pickups.filter(p => p.itemId === PUTTER_ITEM && Math.hypot(p.x - rack.x, p.z - rack.z) < 1.0)).toEqual([]);
    }
  });

  it('deterministic: the same seed builds the same course, desk and record', () => {
    const s = SEEDS[0], a = gen(s), b = fresh(s);
    expect(JSON.stringify(b.skyways!.addon.golf)).toBe(JSON.stringify(a.skyways!.addon.golf));
    expect(JSON.stringify(golfProps(b))).toBe(JSON.stringify(golfProps(a)));
    expect(JSON.stringify(b.pickups)).toBe(JSON.stringify(a.pickups));
  });

  it('version 6 untouched: the same seeds draw no course (no golf kinds, no golf record, no golf pickups)', () => {
    const l = fresh(SEEDS[0], 6);
    expect(l.skyways!.addon.id).not.toBe('mini-golf');
    expect(l.skyways!.addon.golf).toBeUndefined();
    expect(golfProps(l)).toEqual([]);
    expect(l.pickups.filter(p => p.itemId === GOLF_BALL_ITEM || p.itemId === PUTTER_ITEM)).toEqual([]);
  });

  it('every golf kind: classified (physics / openables / damage), scale-recorded, placed on some seed, and drawn as prop-<kind>[-...] meshes; every face names a painter', () => {
    const seen = new Set(SEEDS.flatMap(s => golfProps(gen(s)).map(p => p.kind)));
    const wm = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const l = gen(SEEDS[0]);
    for (const k of GOLF_KINDS) {
      expect(PROP_DEFS[k as PropKind], k).toBeTruthy();
      expect(PROP_PHYSICS_AUDIT[k], k).toBeTruthy();
      expect(OPENABLE_AUDIT.some(e => e.kind === k), k).toBe(true);
      expect(PROP_DAMAGE[k as PropKind], k).toBeTruthy();
      expect(GOLF_SCALE[k], k).toBeTruthy();
      expect(seen.has(k), `${k} placed`).toBe(true);
      for (let v = 0; v < 3; v++) for (const f of GOLF_SPECS[k].faces?.(v) ?? []) expect(SKYWAYS_EVENT_PAINTER_IDS, `${k} face`).toContain(f.paint);
      const list = SEEDS.map(gen).flatMap(golfProps).filter(p => p.kind === k);
      const group = new THREE.Group();
      expect(buildSkywaysEventProp(group, k as SkywaysEventKind, list, wm, l), k).toBe(list.length);
      const meshes: THREE.InstancedMesh[] = [];
      group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.InstancedMesh); });
      expect(meshes.length, k).toBeGreaterThan(0);
      for (const m of meshes) expect(m.name === `prop-${k}` || m.name.startsWith(`prop-${k}-`), m.name).toBe(true);
    }
    // the deck draws exactly one instance per piece (sized per placement)
    const greens = golfProps(l).filter(p => p.kind === 'golfGreen'), group = new THREE.Group();
    buildSkywaysEventProp(group, 'golfGreen' as SkywaysEventKind, greens, wm, l);
    let n = 0;
    group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) n += (o as THREE.InstancedMesh).count; });
    expect(n).toBe(greens.length);
  });
});
