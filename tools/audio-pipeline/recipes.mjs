// Per-cue derivative recipes for the iteration-05 Sound Lab raws (Lane S).
//
// mode:  oneshot  first event of each raw, trimmed at its tail (split=true also stops before a 2nd event)
//        slices   every strong onset of a multi-event raw becomes a variant (footsteps, casings, drips...)
//        windows  N loudest fixed windows of a continuous texture (rummaging)
//        loop     seamless crossfaded loop for an ambience bed (periodic margins for MP3 priming)
// requireDecay: QC rejects a raw whose envelope never decays (the 1.5/2.5 s drone failure mode).
// stereo: keep the raw's stereo image (listener-local shots, wide beds); everything positional is mono.

const ONE = {mode: 'oneshot', tailDb: -45, split: false, fadeIn: 0.002, fadeOut: 0.06, requireDecay: true};
const one = o => ({...ONE, ...o});
const sl = o => ({mode: 'slices', tailDb: -40, riseDb: 9, floorDb: -24, fadeIn: 0.002, fadeOut: 0.04, ...o});

export const RECIPES = {
  // weapons (player-local)
  rifleShot: one({stereo: true, kbps: 160, maxS: 1.6, tailDb: -55, fadeOut: 0.3}),
  shotgunShot: one({stereo: true, kbps: 160, maxS: 1.9, tailDb: -55, fadeOut: 0.35}),
  shotgunPump: one({holdMs: 150, maxS: 1.0, fadeOut: 0.05}),
  shellInsert: sl({n: 4, minGapS: 0.35, maxS: 0.5}),
  rifleMagOut: one({holdMs: 150, maxS: 1.2}),
  rifleMagIn: one({holdMs: 150, maxS: 1.2}),
  rifleCharge: one({holdMs: 150, maxS: 1.2}),
  rifleMagDrop: one({holdMs: 150, maxS: 1.0}),
  dryFire: one({maxS: 0.35, split: true, fadeOut: 0.03}),
  equip: one({holdMs: 150, maxS: 1.0}),
  hitTick: one({maxS: 0.25, split: true, fadeOut: 0.03}),
  hitKill: one({maxS: 0.5, holdMs: 80}),
  // impacts (positional)
  impactConcrete: one({maxS: 0.9, fadeOut: 0.1}),
  impactTile: one({maxS: 0.9, fadeOut: 0.1}),
  impactMetal: one({maxS: 1.0, tailDb: -48, fadeOut: 0.15}),
  impactWood: one({maxS: 0.8, fadeOut: 0.08}),
  impactFlesh: one({maxS: 0.5, split: true}),
  // casings + bodies
  casingBrass: sl({n: 6, minGapS: 0.3, maxS: 0.5, tailDb: -42}),
  casingHull: sl({n: 6, minGapS: 0.3, maxS: 0.45, tailDb: -42}),
  bodyFall: one({maxS: 1.4, holdMs: 100, fadeOut: 0.1}),
  // player movement
  stepConcrete: sl({n: 8, minGapS: 0.3, maxS: 0.45}),
  stepTile: sl({n: 8, minGapS: 0.3, maxS: 0.45}),
  stepConcreteRun: sl({n: 8, minGapS: 0.2, maxS: 0.32}),
  stepTileRun: sl({n: 8, minGapS: 0.2, maxS: 0.32}),
  stepConcreteSneak: sl({n: 6, minGapS: 0.35, maxS: 0.5}),
  stepTileSneak: sl({n: 6, minGapS: 0.35, maxS: 0.5}),
  jump: one({maxS: 0.6, split: true}),
  land: one({maxS: 0.8, split: true}),
  crouch: one({maxS: 0.9, fadeOut: 0.08}),
  ladder: sl({n: 6, minGapS: 0.3, maxS: 0.55}),
  // zombies (positional)
  zombieGroan: one({maxS: 3.0, tailDb: -40, holdMs: 200, fadeOut: 0.25}),
  zombieGroanDeep: one({maxS: 3.0, tailDb: -40, holdMs: 200, fadeOut: 0.25}),
  zombieAttack: one({maxS: 1.6, holdMs: 120, fadeOut: 0.15}),
  zombieDeath: one({maxS: 3.0, tailDb: -42, holdMs: 200, fadeOut: 0.3}),
  zombieStep: sl({n: 6, minGapS: 0.35, maxS: 0.6}),
  zombieStepHeavy: sl({n: 6, minGapS: 0.35, maxS: 0.6}),
  // player body / vitals
  hurt: one({maxS: 0.8, split: true, fadeOut: 0.08}),
  death: one({maxS: 3.0, tailDb: -42, holdMs: 250, fadeOut: 0.4}),
  heartbeat: sl({n: 4, minGapS: 0.55, maxS: 0.75, riseDb: 8, split: false, holdMs: 250}),
  breath: sl({n: 4, minGapS: 0.8, maxS: 1.6, riseDb: 6, floorDb: -22, split: false, holdMs: 150, fadeIn: 0.03, fadeOut: 0.15}),
  // ambience beds (loops)
  bedWind: {mode: 'loop', stereo: true, kbps: 128, startS: 2.5, lenS: 12, xfS: 2.0},
  bedRumble: {mode: 'loop', stereo: true, kbps: 128, startS: 2.5, lenS: 12, xfS: 2.0},
  bedHvac: {mode: 'loop', stereo: true, kbps: 128, startS: 2.5, lenS: 12, xfS: 2.0},
  bedFridge: {mode: 'loop', stereo: false, kbps: 96, startS: 2.0, lenS: 9, xfS: 1.5},
  bedBuzz: {mode: 'loop', stereo: false, kbps: 96, startS: 2.0, lenS: 9, xfS: 1.5},
  // ambience one-shots
  drip: sl({n: 6, minGapS: 0.3, maxS: 0.6, tailDb: -42}),
  creak: one({maxS: 3.0, tailDb: -42, holdMs: 200, fadeOut: 0.3, requireDecay: false}),
  clank: one({maxS: 1.6, tailDb: -48, fadeOut: 0.15}),
  trainDistant: one({maxS: 10, tailDb: -50, fadeIn: 0.6, fadeOut: 1.5, requireDecay: false}),
  flicker: one({maxS: 3.0, tailDb: -42, holdMs: 300, fadeOut: 0.2, requireDecay: false}),
  // containers
  cabinetOpen: one({holdMs: 150, maxS: 1.8, fadeOut: 0.12}),
  cabinetClose: one({holdMs: 150, maxS: 1.5, fadeOut: 0.1}),
  crateOpen: one({holdMs: 150, maxS: 1.8, fadeOut: 0.12}),
  crateClose: one({holdMs: 150, maxS: 1.2, fadeOut: 0.1}),
  vendingPry: one({holdMs: 150, maxS: 2.0, fadeOut: 0.15, requireDecay: false}),
  vendingClose: one({holdMs: 150, maxS: 1.4, fadeOut: 0.1}),
  coolerOpen: one({holdMs: 150, maxS: 1.8, fadeOut: 0.12}),
  coolerClose: one({holdMs: 150, maxS: 1.4, fadeOut: 0.1}),
  drawerOpen: one({holdMs: 150, maxS: 1.4, fadeOut: 0.1}),
  search: {mode: 'windows', n: 3, winS: 0.9, fadeIn: 0.04, fadeOut: 0.12},
  // items / UI
  pickup: one({holdMs: 150, maxS: 0.9, fadeOut: 0.08}),
  heal: one({holdMs: 150, maxS: 2.0, fadeOut: 0.15, requireDecay: false}),
  eatChips: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  eatChocolate: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  eatBeans: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  eatNoodles: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  eat: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  drinkCola: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  drinkWater: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  drinkJuice: one({holdMs: 150, maxS: 3.0, fadeOut: 0.2, requireDecay: false}),
  denied: one({maxS: 0.7, split: true}),
  click: one({maxS: 0.25, split: true, fadeOut: 0.03}),
  win: one({holdMs: 150, maxS: 4.0, tailDb: -50, fadeOut: 0.5, requireDecay: false}),
};
