// Task studio-beta-mouse-axis-invert-20261105-005156-01 (user: "They want invert option on the X / Y axis of the mouse!"): the ONE
// mouse-look step every look path uses (game.ts: play and the transit gap), so both axes invert the same way everywhere.
//
// Order (unchanged from the former inline code): the raw pointer-lock delta (Input.dx / dy, counts since the last frame) x the
// sensitivity scaling (settings.sens x LOOK_RAD_PER_COUNT x the caller's factor, e.g. 0.65 while aiming) x the axis sign (-1 when
// that axis is inverted); yaw -= x (mouse right turns right), pitch -= y (mouse up looks up), pitch clamped to +-PITCH_LIMIT. With
// both inverts OFF the result is bit-identical to the former code (x 1 is exact). Only player LOOK goes through here: menus, the map,
// scrolling, drags, the keyboard and the pointer itself never read these settings.

/** Radians of look per mouse count at sensitivity 1 (the game's historical constant). */
export const LOOK_RAD_PER_COUNT = 0.0022;
/** Pitch limit (rad), unchanged. */
export const PITCH_LIMIT = 1.45;

export interface LookSettings { sens: number; invertX: boolean; invertY: boolean }

/** The axis signs of the look (1 = normal, -1 = inverted); the viewmodel's sway follows the same, effective, turn. */
export function lookSigns(s: Pick<LookSettings, 'invertX' | 'invertY'>): {x: 1 | -1; y: 1 | -1} {
  return {x: s.invertX ? -1 : 1, y: s.invertY ? -1 : 1};
}

/** Turn `p` by one frame's mouse delta (dx, dy) under `s`; `scale` = the caller's extra sensitivity factor (aiming: 0.65). */
export function applyMouseLook(p: {yaw: number; pitch: number}, dx: number, dy: number, s: LookSettings, scale = 1): void {
  const k = s.sens * LOOK_RAD_PER_COUNT * scale, sg = lookSigns(s);
  p.yaw -= dx * k * sg.x;
  p.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p.pitch - dy * k * sg.y));
}
