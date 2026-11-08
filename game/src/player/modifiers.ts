// Iteration 16 (primary, shared contract): per-frame player modifiers from worn GEAR (lane GEAR) and limb INJURIES (lane
// INJURY). Both lanes contribute a ModifierSource; Game combines them every frame from the BASE values (never
// accumulating into the player's stored stats), so equipping / unequipping / travelling can never stack a bonus.
//
// Combination rules: multipliers multiply, additive terms add. (task studio-general-armor-20261107-231448-01: armour left the modifiers — it is the worn pool of
// player/armor.ts, read at the moment of each hit; ARMOR_CAP stays its cap.)

export interface PlayerModifiers {
  /** Walk / sprint / crouch speed multiplier (1 = base). */
  speedMult: number;
  /** Weapon spread multiplier (hip and ADS; 1 = base). */
  spreadMult: number;
  /** Extra aim sway amplitude (radians, side-to-side; 0 = none). Applied to the camera aim, honestly (the crosshair / optic dot follows). */
  swayAmp: number;
  /** Sway frequency (Hz) when swayAmp > 0. */
  swayHz: number;
  /** Extra pocket (body inventory) slots from load-bearing gear. */
  extraPockets: number;
  /** Reload / item-use time multiplier (gloves; 1 = base). */
  handlingMult: number;
}

export const BASE_MODIFIERS: Readonly<PlayerModifiers> = Object.freeze({
  speedMult: 1, spreadMult: 1, swayAmp: 0, swayHz: 0.35, extraPockets: 0, handlingMult: 1,
});

/** A contributor (gear, injuries): returns a partial modifier set computed from its own current state. */
export type ModifierSource = () => Partial<PlayerModifiers>;

export const ARMOR_CAP = 0.8;

export function combineModifiers(sources: readonly ModifierSource[]): PlayerModifiers {
  const m: PlayerModifiers = {...BASE_MODIFIERS};
  for (const src of sources) {
    const p = src();
    if (p.speedMult !== undefined) m.speedMult *= p.speedMult;
    if (p.spreadMult !== undefined) m.spreadMult *= p.spreadMult;
    if (p.handlingMult !== undefined) m.handlingMult *= p.handlingMult;
    if (p.swayAmp !== undefined && p.swayAmp > m.swayAmp) { m.swayAmp = p.swayAmp; if (p.swayHz !== undefined) m.swayHz = p.swayHz; }
    else if (p.swayAmp !== undefined) m.swayAmp += p.swayAmp * 0.25; // a second source adds a little, never doubles
    if (p.extraPockets !== undefined) m.extraPockets += Math.max(0, Math.floor(p.extraPockets));
  }
  return m;
}
