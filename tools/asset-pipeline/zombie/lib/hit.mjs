// Runtime hit-volume radii per body (metres, actor scale 1), measured from the body profile:
//   torso = median over the Spine..Chest+5 cm band of a quarter of (width + depth) of the
//           skinning torso-region rows (robust to single noisy rows, tatters, arms near the body);
//   head  = mean of the half-width and half-depth above the neck;
//   arm/leg = mean of the measured upper/lower limb radii x 1.35 / 1.4 (capsule covers clothing folds).
// The game multiplies these by HIT_CALIBRATION (ai/outfits.ts), calibrated so the Last-shift body
// reproduces the iteration-01..04 tuned volumes.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = v => +(+v).toFixed(4);

export function hitRadii(profile, skel) {
  const T = profile.torsoRows, J = skel.joints;
  const vals = [];
  for (let y = J.Spine[1]; y <= J.Chest[1] + 0.05; y += T.step) {
    const row = T.rows[Math.round((y - T.y0) / T.step)];
    if (row) vals.push(0.25 * (row[0] + row[1]));
  }
  vals.sort((a, b) => a - b);
  const torso = vals.length ? vals[vals.length >> 1] : 0.15;
  const L = profile.limb;
  return {
    head: r4(clamp(0.5 * (profile.head.halfWidth + profile.head.depth / 2), 0.1, 0.17)),
    torso: r4(clamp(torso, 0.1, 0.3)),
    arm: r4(clamp(((L.L_UpperArm.radius ?? 0.05) + (L.L_Forearm.radius ?? 0.045)) / 2 * 1.35, 0.05, 0.12)),
    leg: r4(clamp(((L.L_Thigh.radius ?? 0.075) + (L.L_Shin.radius ?? 0.055)) / 2 * 1.4, 0.07, 0.15)),
    method: 'torso: median quarter (width+depth) of skin torso-region rows over Spine..Chest+5cm; head: mean half extents above the neck; limbs: mean measured radii x1.35 (arm) / x1.4 (leg)',
  };
}
