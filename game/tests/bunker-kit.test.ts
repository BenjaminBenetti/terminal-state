// Task studio-bunker-level-20261109-072224-01 (follow-up): THE BUNKER's model-backed flavour kinds — the cooked mainframe tape cabinet
// (assets/bunkerKit.generated.ts; tools/asset-pipeline/props/build-bunker-kit.mjs) and the reused Reactor models (the decontamination
// shower, the control console, the coolant pump, the pipe bank):
//  - every kind registered (PROP_DEFS at the model's real size, damage class, physics class, openables audit with an honest reason) and
//    drawn through the builder's generic instanced model path (MODEL_FOR -> the lazy library key);
//  - the cooked file: on disk at the registry's bytes, allowlisted (tools/release/public-inputs.json path / bytes / sha256), credited,
//    its provenance (no URL / token / local path), grounded at its real size (0.90 x 1.90 x 0.52 m), loaded on the Bunker only;
//  - placement on generated Bunkers: mainframe banks in the processing hall's rows (the cluster's 3 m front clear), the control room's
//    console / CRT terminal / data cabinets / mainframes, the decontamination showers, the maintenance storey's water plant.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PROP_DEFS} from '../src/gen/props';
import {PROP_DAMAGE} from '../src/damage/materials';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT, unclassifiedPhysicsKinds} from '../src/damage/physicsAudit';
import {BUNKER_KIT} from '../src/assets/bunkerKit.generated';
import {BUNKER_KIT_MODEL_FILES, BUNKER_MODEL_FOR, BUNKER_MODEL_KINDS, BUNKER_MODEL_OF, bunkerModelKindKeysFor} from '../src/gen/bunker/bunkerKinds';
import {assetAllowedIn} from '../src/assets/levelAssets';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {frontCells} from '../src/gen/bunker/validate';
import {CELL} from '../src/gen/grid';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(GAME, 'public');
const REPO = path.resolve(GAME, '..');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

describe('bunker kit: the model-backed flavour kinds', () => {
  it('every kind is registered at its model\'s real size, classified and drawn through MODEL_FOR', () => {
    const builder = fs.readFileSync(path.join(GAME, 'src/world/builder.ts'), 'utf8');
    expect(builder).toMatch(/const MODEL_FOR: [^\n]*\.\.\.BUNKER_MODEL_FOR/);
    for (const k of BUNKER_MODEL_KINDS) {
      const d = PROP_DEFS[k], [w, h, dd] = BUNKER_MODEL_OF[k].dims;
      expect(d, k).toBeDefined();
      expect(d.w).toBeCloseTo(w, 2); expect(d.h).toBeCloseTo(h, 2); expect(d.d).toBeCloseTo(dd, 2);
      expect(PROP_DAMAGE[k], k).toBeDefined();
      expect(OPENABLE_AUDIT.find(r => r.kind === k)?.how.length ?? 0, k).toBeGreaterThan(20);
      expect(PROP_PHYSICS_AUDIT[k], k).toBeDefined();
      expect(unclassifiedPhysicsKinds()).not.toContain(k);
      expect(BUNKER_MODEL_FOR[k]).toBe(BUNKER_MODEL_OF[k].key);
    }
    expect(OPENABLE_AUDIT.find(r => r.kind === 'bunkerMainframe')?.how).toMatch(/service panels.*not storage/);
  });

  it('the cooked mainframe: on disk, allowlisted, credited, provenance clean, grounded at its real size, Bunker-only', () => {
    const m = BUNKER_KIT.mainframe;
    const file = fs.readFileSync(path.join(PUB, m.url));
    expect(file.length).toBe(m.bytes);
    expect(m.dims[0]).toBeCloseTo(0.9, 1); expect(m.dims[1]).toBeCloseTo(1.9, 3); expect(m.dims[2]).toBeGreaterThan(0.45); expect(m.dims[2]).toBeLessThan(0.75);
    const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    const row = allow.files.find(f => f.path === m.url);
    expect(row).toEqual({path: m.url, bytes: file.length, sha256: sha(file)});
    const provRel = 'assets/derivatives/bunker-kit-20261109.json';
    const prov = fs.readFileSync(path.join(PUB, provRel), 'utf8');
    expect(allow.files.find(f => f.path === provRel)?.sha256).toBe(sha(Buffer.from(prov)));
    expect(prov).not.toMatch(/https?:|token=|Signature=|\/workspaces\//i);
    const rec = JSON.parse(prov) as {models: {url: string; sha256: string; source: {sha256: string}; task: string}[]};
    expect(rec.models[0].url).toBe(m.url);
    expect(rec.models[0].sha256).toBe(sha(file));
    expect(rec.models[0].task).toBe('01a1bfc1-3a2f-773a-a458-f2cdadf1b1fc');
    const credits = fs.readFileSync(path.join(PUB, 'assets/CREDITS.md'), 'utf8');
    expect(credits).toContain('<!-- BEGIN bunker-kit-20261109');
    expect(credits).toContain(m.url);
    expect(BUNKER_KIT_MODEL_FILES[m.key]).toEqual({url: m.url, bytes: m.bytes});
    expect(assetAllowedIn('bunker', m.url)).toBe(true);
    for (const lv of ['subway', 'office', 'mall', 'market', 'skyways', 'reactor']) expect(assetAllowedIn(lv, m.url), lv).toBe(false);
    // the reused Reactor models load on the Bunker too (the reactor-* rule's also: ['bunker'])
    for (const k of BUNKER_MODEL_KINDS) expect(assetAllowedIn('bunker', BUNKER_MODEL_OF[k].url), k).toBe(true);
    const game = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(game).toMatch(/\.\.\.BUNKER_KIT_MODEL_FILES\}/);
    expect(game).toMatch(/sectionModelKeys[^\n]*bunkerModelKindKeysFor/);
  });

  it('placement on generated Bunkers: mainframe banks, the control room, decon showers, the water plant', () => {
    const seeds = [9001, 24839, 56515, 72353];
    let shower = 0, consoles = 0, crts = 0, pumps = 0, plant = 0;
    for (const s of seeds) {
      const L = generateBunkerLevel({levelSeed: s}), b = L.bunker!;
      expect(bunkerModelKindKeysFor(L)).toContain(BUNKER_KIT.mainframe.key);
      const hall = L.areas[b.core.area];
      const inHall = L.props.filter(p => p.area === hall.id);
      expect(inHall.filter(p => p.kind === 'bunkerMainframe').length, `${s} hall mainframes`).toBeGreaterThanOrEqual(4);
      expect(inHall.filter(p => p.kind === 'serverRack').length, `${s} hall racks`).toBeGreaterThanOrEqual(4);
      // the cluster's 3 m front strip stays clear of every placement
      const g = L.levels[b.core.level].grid, front = new Set(frontCells(g, L.props[b.core.prop], 6));
      for (const p of inHall) {
        if (p === L.props[b.core.prop]) continue;
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(front.has(g.idx(cx, cy)), `${s} ${p.kind} in the cluster's front`).toBe(false);
      }
      const ctrl = L.areas.find(a => a.label === 'Core control room')!;
      const inCtrl = L.props.filter(p => p.area === ctrl.id);
      consoles += inCtrl.some(p => p.kind === 'bunkerControlConsole') ? 1 : 0;
      for (const c of inCtrl.filter(p => p.kind === 'crtTerminal')) {
        crts++;
        const host = L.props[c.host!];
        expect(host.kind).toBe('desk');
        expect(c.y).toBeCloseTo(host.y + PROP_DEFS.desk.h, 3);
      }
      const decon = L.areas.filter(a => a.label === 'Decontamination');
      shower += L.props.filter(p => p.kind === 'bunkerDeconShower' && decon.some(a => a.id === p.area)).length ? 1 : 0;
      const l4 = L.areas.filter(a => a.level === 4 && (a.label === 'Pump hall' || a.label === 'Water treatment')).map(a => a.id);
      pumps += L.props.filter(p => p.kind === 'bunkerCoolantPump' && l4.includes(p.area)).length;
      plant += L.props.filter(p => ['waterPumpSkid', 'waterHeaterTank', 'pipeValveManifold', 'bunkerPipeBank', 'airFilterUnit'].includes(p.kind) && l4.includes(p.area)).length;
      // every model-backed placement stands on its storey's floor, inside its room's band
      for (const p of L.props.filter(q => BUNKER_MODEL_KINDS.includes(q.kind as never))) {
        const lg = L.levels[p.level ?? 0].grid, [cx, cy] = lg.cellOf(p.x, p.z), i = lg.idx(cx, cy);
        expect(Math.abs(p.y - lg.floorOf(i)), `${s} ${p.kind} grounded`).toBeLessThan(0.02);
        expect(p.y + p.h, `${s} ${p.kind} under its ceiling`).toBeLessThanOrEqual(lg.ceil[i] + 0.05);
        void CELL;
      }
    }
    expect(shower).toBeGreaterThanOrEqual(seeds.length - 1);
    expect(consoles).toBeGreaterThanOrEqual(seeds.length - 1);
    expect(crts).toBeGreaterThanOrEqual(seeds.length - 1);
    expect(pumps).toBeGreaterThanOrEqual(seeds.length);
    expect(plant).toBeGreaterThanOrEqual(seeds.length * 3);
  });
});
