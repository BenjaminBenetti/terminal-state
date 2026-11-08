// Task studio-alpha-survival-controls-20261107-060450-01 (user: "I meant the enemies should do double the damage to the PLAYER only! The
// player damage is UNCHANGED"): every ENEMY attack that reaches the player lands at 2x its raw amount — the melee of every family (claw /
// bite / fist: Game.hurtPlayer, enemy: true) and the Blightbelly's death blast (ai/blightBurst.ts, enemy: true) — through the ONE hit
// pipeline (Game.applyPlayerHit -> player/hits.ts incomingHit, before armour). Not scaled: falls / 'other' hits, the toxic gas field (a
// direct takeDamage per second in world/gas/system.ts, Blightbelly puffs included: part of the same field), the empty-vitals drain, and
// everything the player deals (weapons / enemy health live elsewhere and are untouched by this task).
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {ENEMY_DAMAGE_TO_PLAYER, armorFor, incomingHit, isEnemyHit, type PlayerHit} from '../src/player/hits';
import {ZOMBIE_STATS} from '../src/ai/brain';
import {RATDOG_STATS} from '../src/ai/creatureActor';
import {SIREN_STATS} from '../src/ai/siren';
import {STRAINER_STATS} from '../src/ai/strainer';
import {BLIGHTBELLY_BURST, BLIGHTBELLY_STATS} from '../src/ai/blightbelly';

const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

describe('enemy damage to the player: x2, the player only', () => {
  it('every enemy attack is scaled by 2 before armour; falls / other hits are not', () => {
    expect(ENEMY_DAMAGE_TO_PLAYER).toBe(2);
    const h = (o: Partial<PlayerHit>): PlayerHit => ({amount: 10, source: 'zombie', location: 'torso', ...o});
    expect(incomingHit(h({source: 'zombie'})).amount).toBe(20);
    expect(incomingHit(h({source: 'creature'})).amount).toBe(20);
    expect(incomingHit(h({source: 'blast', enemy: true})).amount).toBe(20);
    expect(incomingHit(h({source: 'blast'})).amount).toBe(10); // an unattributed blast is not an enemy's
    expect(incomingHit(h({source: 'fall'})).amount).toBe(10);
    expect(incomingHit(h({source: 'other'})).amount).toBe(10);
    expect(incomingHit(h({source: 'zombie', enemy: false})).amount).toBe(10); // explicit attribution wins
    expect(isEnemyHit(h({source: 'creature'}))).toBe(true);
    // the rest of the hit is kept (location, attacker, source); the input is not mutated
    const raw = h({source: 'zombie', location: 'head', attacker: 'strainer', enemy: true});
    expect(incomingHit(raw)).toEqual({...raw, amount: 20});
    expect(raw.amount).toBe(10);
  });

  it('armour keeps its fraction of the doubled hit (mitigation semantics unchanged)', () => {
    const hit = incomingHit<PlayerHit>({amount: 12, source: 'zombie', location: 'torso', enemy: true});
    const {applied, absorbed} = armorFor(hit, 0.3);
    expect(applied).toBeCloseTo(24 * 0.7, 9);
    expect(absorbed).toBeCloseTo(24 * 0.3, 9);
    expect(armorFor(hit, 0).applied).toBe(24); // unarmoured: the full 2x
  });

  it('per family: the raw attack before -> after (melee of every family, the Blightbelly blast at point blank)', () => {
    const rows: [string, number][] = [
      ['shambler claw', ZOMBIE_STATS.shambler.attackDamage], ['coated claw', ZOMBIE_STATS.coated.attackDamage],
      ['rat-dog bite', RATDOG_STATS.attackDamage], ['Siren claw', SIREN_STATS.attackDamage],
      ['Blightbelly fist', BLIGHTBELLY_STATS.attackDamage], ['Strainer claw', STRAINER_STATS.attackDamage],
      ['Blightbelly blast (max)', BLIGHTBELLY_BURST.blastMax],
    ];
    const after = rows.map(([name, a]) => [name, a, incomingHit<PlayerHit>({amount: a, source: name.includes('blast') ? 'blast' : 'zombie', location: 'torso', enemy: true}).amount]);
    expect(after).toEqual([
      ['shambler claw', 10, 20], ['coated claw', 15, 30], ['rat-dog bite', 7, 14], ['Siren claw', 14, 28],
      ['Blightbelly fist', 10, 20], ['Strainer claw', 24, 48], ['Blightbelly blast (max)', 22, 44],
    ]);
  });

  it('the paths: hurtPlayer + the blast are attributed enemy hits through applyPlayerHit -> incomingHit; gas / survival are not', () => {
    const game = src('game.ts');
    // the one pipeline scales first, then armour, then HP and the injury listeners (they see the doubled hit)
    // (task studio-general-armor-20261107-231448-01: the worn pool, player/armor.ts armorHit -> armorFor)
    expect(game).toMatch(/applyPlayerHit\(raw: PlayerHit\): ResolvedHit \{\s*const hit = incomingHit\(raw\);\s*const \{resolved\} = armorHit\(hit, this\.inv\.gear, this\.wearRand\);/);
    expect(game).toMatch(/source: creature \? 'creature' : 'zombie', enemy: true,/);
    expect(src('ai/blightBurst.ts')).toMatch(/source: 'blast', location, attacker: 'blightbelly', enemy: true\}/);
    // the gas field (incl. a Blightbelly's puff) and the empty-vitals drain damage the player directly, unscaled
    expect(src('world/gas/system.ts')).toMatch(/pl\.takeDamage\(dps \* dt\)/);
    expect(src('world/gas/system.ts')).not.toMatch(/incomingHit|ENEMY_DAMAGE_TO_PLAYER/);
    expect(game).toMatch(/if \(surv\.hpLoss > 0\) p\.takeDamage\(surv\.hpLoss\);/);
    // nothing else in the source uses the multiplier (weapons / enemy health / props / the car are not touched by it)
    const users: string[] = [];
    const walk = (d: URL) => {
      for (const f of fs.readdirSync(d, {withFileTypes: true})) {
        const u = new URL(f.name + (f.isDirectory() ? '/' : ''), d);
        if (f.isDirectory()) walk(u);
        else if (f.name.endsWith('.ts') && /incomingHit|ENEMY_DAMAGE_TO_PLAYER/.test(fs.readFileSync(u, 'utf8'))) users.push(u.pathname.split('/src/')[1]);
      }
    };
    walk(new URL('../src/', import.meta.url));
    expect(users.sort()).toEqual(['game.ts', 'player/hits.ts']);
  });
});
