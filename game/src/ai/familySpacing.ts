// Lane INTEG (task track3-eaton-centre-20261031, Track1 integration): WHOLE-LEVEL FAMILY SPACING — the small post-pass that keeps
// the mall's 30 m Siren spacing (the interim MALL_RARE_RULES), because Track1's eligibility rule (spawnTables FamilyEligibility) has
// no spacing field. Run ONCE, right after assignEnemyArchetypes (the single ambient family roll), before any horde is appended.
//
// Semantics (spawnTables FamilySpacing): for each family f of `profile.spacing`, in spawn-index order, a spawn whose roll DREW f and
// that passes f's eligibility rule (Track1's criteria, the per-level cap aside) is placed only while fewer than the rule's
// maxPerLevel are kept AND it is at least spacingM (straight 3D line) from every kept f; otherwise it becomes the rule's fallback.
// The cap and the spacing are applied JOINTLY, so the cap counts only kept spawns (a draw the cap turned away in
// assignEnemyArchetypes is placed when an earlier draw was spaced out). Same roll, no RNG, no layout data beyond `archetype`
// changes; other families, ineligible draws and horde members are never touched. A profile without `spacing` is a no-op.

import {pickEnemyArchetype} from './creatureSpawn';
import {
  eligibilityFailure, roomFamilyPool, spawnContextOf, type EligibilityLayout, type EligibilitySpawn, type EnemyFamilyId, type SpawnProfile,
} from './spawnTables';
import type {Area} from '../gen/stationTypes';

type SpacedLayout = {
  seed: number;
  zombies: ({archetype?: EnemyFamilyId; area?: number; horde?: number; x: number; z: number; y?: number} & EligibilitySpawn)[];
  areas?: readonly (Pick<Area, 'purpose' | 'type'> & Partial<Pick<Area, 'kind' | 'w' | 'h'>>)[];
} & EligibilityLayout;

export interface FamilySpacingReport {
  family: EnemyFamilyId;
  /** Eligible draws (cap aside) in spawn order. */
  eligible: number;
  kept: number;
  /** Eligible draws turned to the fallback by the spacing / the cap. */
  spaced: number;
  capped: number;
}

/** Applies `profile.spacing` to a generated layout (see the file comment). Returns one report per spaced family. */
export function applyFamilySpacing(layout: SpacedLayout, profile: SpawnProfile): FamilySpacingReport[] {
  const out: FamilySpacingReport[] = [];
  for (const [f, sp] of Object.entries(profile.spacing ?? {}) as [EnemyFamilyId, NonNullable<SpawnProfile['spacing']>[EnemyFamilyId]][]) {
    const rule = profile.eligibility?.[f];
    if (!rule || !sp) continue; // validation requires the rule; nothing to space without it
    const rep: FamilySpacingReport = {family: f, eligible: 0, kept: 0, spaced: 0, capped: 0};
    const kept: {x: number; y: number; z: number}[] = [];
    layout.zombies.forEach((s, i) => {
      if (s.horde !== undefined) return;
      const area = s.area !== undefined ? layout.areas?.[s.area] : undefined;
      if (pickEnemyArchetype(layout.seed, i, roomFamilyPool(profile, area)) !== f) return;
      if (eligibilityFailure(rule, layout, s, spawnContextOf(layout, profile, i)) !== null) return; // already the fallback
      rep.eligible++;
      const y = s.y ?? 0;
      if (rule.maxPerLevel !== undefined && kept.length >= rule.maxPerLevel) { s.archetype = rule.fallback; rep.capped++; return; }
      if (kept.some(k => Math.hypot(k.x - s.x, k.y - y, k.z - s.z) < sp.spacingM)) { s.archetype = rule.fallback; rep.spaced++; return; }
      s.archetype = f;
      kept.push({x: s.x, y, z: s.z});
      rep.kept++;
    });
    out.push(rep);
  }
  return out;
}
