// Pistol lane (targeted pass 2026-10-28): the pistol weapon, its staging gate, the seeded weapon finds
// that replaced the guaranteed spawn-side shotgun, and the reused (pitched) Sound Lab shot cue.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {Inventory} from '../src/items/inventory';
import {ITEMS, itemDef} from '../src/items/items';
import {WEAPONS, WeaponController, type TriggerInput} from '../src/weapons/weapons';
import {PISTOL_ART_READY, devPistolRequested, makePistolDevPlaceholder, startWeaponFor} from '../src/weapons/pistol';
import {generateStation, validateLayout} from '../src/gen/station';
import {ARCHETYPES, type StationLayout} from '../src/gen/stationTypes';
import {FIND_MAX_PER_WEAPON, FIND_MIN_SPAWN_M, findWeaponsFor} from '../src/gen/weaponFinds';
import {PathFinder, type Waypoint} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {WEAPON_SHOT_CUES} from '../src/audio/sfx';
import {EJECTION_PORTS} from '../src/physics/world';
import {ICONS} from '../src/ui/icons';
import {MODEL_FILES} from '../src/assets/manifest';

const idle: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const step = (wc: WeaponController, inv: Inventory, dt: number, input: Partial<TriggerInput> = {}) => wc.update(dt, {...idle, ...input}, inv);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('pistol weapon', () => {
  it('is a semi-auto 15-round sidearm below the rifle per shot, with its own 9 mm ammo', () => {
    const p = WEAPONS.pistol, r = WEAPONS.rifle, s = WEAPONS.shotgun;
    expect(p).toMatchObject({itemId: 'pistol', ammoItem: 'ammo_pistol', magazine: 15, auto: false, pellets: 1, equipTime: 0.35, aimFov: 58, moveMult: 1, sound: 'pistol'});
    expect(p.interval).toBeCloseTo(0.16);
    expect(p.reload).toMatchObject({kind: 'magazine', time: 1.4});
    expect(p.damage).toBeLessThan(r.damage);
    expect(p.recoil.pitch).toBeLessThan(s.recoil.pitch);
    expect(p.spreadHip).toBeLessThan(s.spreadHip);
    expect(p.noise).toBeLessThan(r.noise);
    expect(itemDef('pistol')).toMatchObject({kind: 'weapon', short: 'Pistol', weaponId: 'pistol', stackMax: 1});
    expect(itemDef('ammo_pistol')).toMatchObject({kind: 'ammo', stackMax: ITEMS.ammo_rifle.stackMax});
    expect(ICONS[itemDef('pistol').icon]).toContain('<svg'); // HUD silhouette (and inventory fallback if the model fails)
    expect(EJECTION_PORTS.pistol.kind).toBe('rifle'); // reuses the brass casing kind
    // rifle and shotgun unchanged
    expect(WEAPONS.rifle).toMatchObject({magazine: 30, auto: true, damage: 24, ammoItem: 'ammo_rifle'});
    expect(WEAPONS.shotgun).toMatchObject({magazine: 6, pellets: 9, damage: 15, ammoItem: 'ammo_shells'});
  });

  it('fires semi-auto, runs dry, dry-fires, reloads from finite ammo and stops when ammo is gone', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('pistol', 1, 15));
    inv.add(inv.makeStack('ammo_pistol', 20));
    const wc = new WeaponController();
    wc.equip(inv.hotbar[0]);
    step(wc, inv, 0.4);
    expect(wc.phase).toBe('idle');
    // holding the trigger fires once (semi-auto)
    let shots = 0;
    for (let f = 0; f < 30; f++) shots += step(wc, inv, 1 / 60, {held: true, pressed: f === 0}).filter(e => e.type === 'fire').length;
    expect(shots).toBe(1);
    // empty the magazine with separate presses
    for (let i = 0; i < 40 && (inv.hotbar[0]!.mag ?? 0) > 0; i++) { step(wc, inv, 0.2, {held: true, pressed: true}); step(wc, inv, 0.01); }
    expect(inv.hotbar[0]!.mag).toBe(0);
    const dry = step(wc, inv, 0.3, {held: true, pressed: true});
    expect(dry.map(e => e.type)).toEqual(['dry', 'reloadStart']);
    for (let t = 0; t < 1.7; t += 0.05) step(wc, inv, 0.05);
    expect(inv.hotbar[0]!.mag).toBe(15);
    expect(inv.count('ammo_pistol')).toBe(5);
    for (let i = 0; i < 40 && (inv.hotbar[0]!.mag ?? 0) > 0; i++) { step(wc, inv, 0.2, {pressed: true}); step(wc, inv, 0.01); }
    step(wc, inv, 0.01, {reload: true});
    for (let t = 0; t < 1.7; t += 0.05) step(wc, inv, 0.05);
    expect(inv.hotbar[0]!.mag).toBe(5);
    expect(inv.count('ammo_pistol')).toBe(0);
    for (let i = 0; i < 10; i++) { step(wc, inv, 0.2, {pressed: true}); step(wc, inv, 0.01); }
    expect(inv.hotbar[0]!.mag).toBe(0);
    expect(wc.canReload(inv)).toBe(false);
    expect(step(wc, inv, 0.3, {pressed: true}).map(e => e.type)).toEqual(['dry']);
  });

  it('slots, drops (detach the whole stack) and picks up like the other weapons, keeping its magazine', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('rifle', 1, 30));
    inv.add(inv.makeStack('pistol', 1, 9));
    inv.add(inv.makeStack('shotgun', 1, 6));
    expect(inv.hotbar.slice(0, 3).map(s => s?.itemId)).toEqual(['rifle', 'pistol', 'shotgun']);
    inv.select(1);
    const wc = new WeaponController();
    wc.equip(inv.selectedStack());
    expect(wc.def?.id).toBe('pistol');
    const dropped = inv.detach({bar: 'hotbar', index: 1})!; // what G (dropRef) does with a held weapon
    expect(dropped).toMatchObject({itemId: 'pistol', mag: 9});
    expect(inv.hotbar[1]).toBeNull();
    expect(inv.add(dropped)).toBe(0);
    expect(inv.hotbar[1]).toMatchObject({itemId: 'pistol', mag: 9});
    expect(inv.invariants()).toEqual([]);
  });

  it('maps its sound onto the reused, pitched Sound Lab rifle-shot cue (no dedicated recording)', () => {
    expect(WEAPON_SHOT_CUES.pistol.cue).toBe('rifleShot');
    expect(WEAPON_SHOT_CUES.pistol.rate).toBeGreaterThan(1);
    expect(WEAPON_SHOT_CUES.pistol.gain).toBeLessThan(1);
    expect(WEAPON_SHOT_CUES.pistol.reused).toMatch(/Sound Lab rifle-shot/);
    expect(WEAPON_SHOT_CUES.rifle).toMatchObject({cue: 'rifleShot', rate: 1, gain: 1});
    expect(WEAPON_SHOT_CUES.shotgun).toMatchObject({cue: 'shotgunShot', rate: 1, gain: 1});
  });
});

describe('pistol staging gate', () => {
  it('ships with the gate on and the real pistol model; pistol start without any URL flag', () => {
    expect(PISTOL_ART_READY).toBe(true);
    expect(MODEL_FILES.pistol.url).toBe('assets/models/pistol.glb');
    expect(fs.existsSync(path.join(ROOT, 'game/public', MODEL_FILES.pistol.url))).toBe(true);
    expect(Math.abs(fs.statSync(path.join(ROOT, 'game/public', MODEL_FILES.pistol.url)).size - MODEL_FILES.pistol.bytes)).toBeLessThan(20_000);
    expect(startWeaponFor(false)).toBe('pistol'); // normal play: no ?devpistol=1 needed
    expect(startWeaponFor(true)).toBe('pistol');
    expect(startWeaponFor(false, false)).toBe('rifle'); // gate-off fallback only
    expect(devPistolRequested('?qa=1&devpistol=1')).toBe(true);
    expect(devPistolRequested('?qa=1')).toBe(false);
    const ph = makePistolDevPlaceholder();
    expect(ph.name).toBe('pistol-dev-placeholder');
    expect(ph.getObjectByName('Grip')).toBeTruthy();
    expect(ph.getObjectByName('Muzzle')).toBeTruthy();
  });

  it('rifle start (generator default / gate-off fallback): shotgun is a find, no rifle/pistol in the layout; pistol start (normal play) → rifle + shotgun finds', () => {
    const seed = 424242;
    const rifleL = generateStation(seed, {startWeapon: startWeaponFor(false, false)});
    expect(rifleL.startWeapon).toBe('rifle');
    expect(rifleL.pickups.some(p => p.itemId === 'pistol' || p.itemId === 'ammo_pistol')).toBe(false);
    expect(rifleL.pickups.some(p => p.itemId === 'rifle')).toBe(false);
    expect(validateLayout(rifleL)).toEqual([]);
    const pistolL = generateStation(seed, {startWeapon: startWeaponFor(false)}); // what game.ts passes in normal play
    expect(pistolL.startWeapon).toBe('pistol');
    expect(pistolL.pickups.some(p => p.itemId === 'rifle') || pistolL.pickups.some(p => p.itemId === 'shotgun')).toBe(true);
    expect(validateLayout(pistolL)).toEqual([]);
    expect(pistolL.pickups.some(p => p.itemId === 'pistol')).toBe(false);
    expect(pistolL.pickups.some(p => p.itemId === 'ammo_pistol')).toBe(true);
    expect(findWeaponsFor('pistol')).toEqual(['shotgun', 'rifle']);
    expect(findWeaponsFor('rifle')).toEqual(['shotgun']);
    // deterministic per seed for a given option (no reroll on reload)
    const again = generateStation(seed, {startWeapon: 'pistol'});
    expect(again.pickups).toEqual(pistolL.pickups);
  });
});

const pathLen = (w: Waypoint[], x0: number, z0: number) => { let d = 0, px = x0, pz = z0; for (const p of w) { d += Math.hypot(p[0] - px, p[1] - pz); px = p[0]; pz = p[1]; } return d; };

describe('seeded weapon finds across seeds and families', () => {
  it('places 0-2 finds per non-start weapon, reachable, >= 25 m from spawn, on the right storey; stats → finds.json', () => {
    const SEEDS_PER_FAMILY = 7;
    const report: Record<string, unknown>[] = [];
    const per: Record<string, {stations: number; withOne: number; copies: number[]; minSpawn: number; minPath: number; levels: Record<string, number>; purposes: Record<string, number>}> = {};
    for (const start of ['rifle', 'pistol'] as const) {
      const n = start === 'rifle' ? SEEDS_PER_FAMILY : 4;
      for (const arch of ARCHETYPES) for (let i = 0; i < n; i++) {
        const seed = 1000 + ARCHETYPES.indexOf(arch) * 7919 + i * 104729;
        const l: StationLayout = generateStation(seed, {archetype: arch, startWeapon: start});
        expect(validateLayout(l), `seed ${seed}`).toEqual([]);
        const uids = new Set<string>();
        for (const p of l.pickups) { const k = `${p.itemId}@${p.level ?? 0}:${p.x.toFixed(3)},${p.z.toFixed(3)}`; expect(uids.has(k), `dup ${k}`).toBe(false); uids.add(k); }
        const pf = new PathFinder(levelsOf(l));
        const sp = l.playerSpawn;
        expect(l.pickups.some(p => p.itemId === start)).toBe(false);
        for (const w of findWeaponsFor(start)) {
          const key = `${start}-start:${w}`;
          const st = (per[key] ??= {stations: 0, withOne: 0, copies: [0, 0, 0], minSpawn: Infinity, minPath: Infinity, levels: {}, purposes: {}});
          const ws = l.pickups.filter(p => p.itemId === w);
          expect(ws.length).toBeLessThanOrEqual(FIND_MAX_PER_WEAPON);
          st.stations++; st.copies[ws.length]++; if (ws.length) st.withOne++;
          for (const p of ws) {
            const lg = l.levels[p.level ?? 0].grid, [cx, cy] = lg.cellOf(p.x, p.z), ci = lg.idx(cx, cy);
            expect(lg.walkable(cx, cy), `seed ${seed} ${w} on floor`).toBe(true);
            expect(lg.rampIdx[ci]).toBe(-1);
            expect(l.areas[p.area].level ?? 0).toBe(p.level ?? 0);
            if (p.level) expect(p.y).toBeCloseTo(lg.floorOf(ci), 5);
            const straight = Math.hypot(p.x - sp.x, p.z - sp.z);
            expect(straight).toBeGreaterThanOrEqual(FIND_MIN_SPAWN_M);
            const route = pf.find(sp.x, sp.z, p.x, p.z, 0.3, 200000, {ay: 0, by: p.y});
            expect(route, `seed ${seed} ${w} reachable`).not.toBeNull();
            const pl = pathLen(route!, sp.x, sp.z);
            expect(pl).toBeGreaterThanOrEqual(FIND_MIN_SPAWN_M);
            st.minSpawn = Math.min(st.minSpawn, straight); st.minPath = Math.min(st.minPath, pl);
            st.levels[p.level ?? 0] = (st.levels[p.level ?? 0] ?? 0) + 1;
            const a = l.areas[p.area], purpose = a.purpose ?? a.type;
            st.purposes[purpose] = (st.purposes[purpose] ?? 0) + 1;
            expect(l.pickups.some(q => q.itemId.startsWith('ammo') && (q.level ?? 0) === (p.level ?? 0) && q.area === p.area && Math.hypot(q.x - p.x, q.z - p.z) < 4.5), `ammo beside ${w}`).toBe(true);
            report.push({start, seed, archetype: arch, weapon: w, level: p.level ?? 0, purpose, spawnDist: +straight.toFixed(1), pathDist: +pl.toFixed(1)});
          }
        }
      }
    }
    for (const st of Object.values(per)) {
      expect(st.withOne / st.stations, 'not overly rare across seeds').toBeGreaterThanOrEqual(0.85);
      expect(st.minSpawn).toBeGreaterThanOrEqual(FIND_MIN_SPAWN_M);
    }
    const out = path.join(ROOT, 'reference/tasks/targeted-performance-pistol-20261028/pistol/finds.json');
    try {
      fs.mkdirSync(path.dirname(out), {recursive: true});
      fs.writeFileSync(out, JSON.stringify({generatedBy: 'game/tests/pistol.test.ts', rules: {minSpawnM: FIND_MIN_SPAWN_M, maxPerWeapon: FIND_MAX_PER_WEAPON, copiesDraw: '0: 6%, 1: 80%, 2: 14%'},
        summary: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, {...v, rateWithOne: +(v.withOne / v.stations).toFixed(3), minSpawn: +v.minSpawn.toFixed(1), minPath: +v.minPath.toFixed(1)}])), finds: report}, null, 1));
    } catch { /* reference/ is an external, optional mount */ }
  }, 240_000);
});
