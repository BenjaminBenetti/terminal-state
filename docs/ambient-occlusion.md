# Ambient occlusion

Screen-space ambient occlusion (AO) darkens the scene where surfaces are close together: wall / floor joins, under and
around furniture, corners, the foot of a post. It is computed every frame from the scene's depth alone, inside the
game's existing atmosphere render pipeline. It was added for the request "add AO" (task
studio-perf-ao-train-continuity-20261110-022206-01, lane AO).

Code:
- `game/src/render/ambientOcclusion.ts`: the TSL passes, the pass node, `AmbientOcclusionPass` (targets, programs,
  failure flag, debug readout).
- `game/src/render/ambientOcclusionMath.ts`: the presets (`AO_QUALITY`), the look (`AO_LOOK`), and a pure TypeScript
  **CPU mirror** of every formula. The unit tests and the CPU pictures run this mirror.
- `game/src/render/volumetric.ts`: the wiring (`VolumetricAtmosphere.occlusion`, `setAmbientOcclusion`, `aoActive`,
  `aoUnavailable`, `debug().ao`).
- `game/src/render/volumetricShaders.ts` `createCompositeNode`: the apply step, an optional `ao` argument.
- The setting: `ui/settingsStore.ts` (`ambientOcclusion`), `ui/mainMenu.ts` (the choice), `main.ts` and
  `Game.applySettings`.

## Where it runs

The atmosphere draws a frame as one three `RenderPipeline` (`render/volumetric.ts`). AO adds one pass and one step:

1. **Scene pass** (unchanged): HDR, linear, MSAA 4 on quality High, with a depth texture. AO adds no MRT, no normal
   attachment and no change to this pass. Its render context, and every pipeline the warm-up prepared for the
   station, stay exactly as before.
2. **Fog pass** (unchanged).
3. **AO pass** (`AoPassNode`, run once per frame after the scene pass, before the composite). It has three draws into
   two small RG16F targets:
   - *raw* (target A): per AO pixel, the view position and a normal rebuilt from neighbouring depths, then GTAO
     horizon search. It stores the visible fraction `ao` and `1 / view depth` (0 = sky).
   - *blur x* (A to B) and *blur y* (B to A): a 7-tap triangle per axis. Each tap is weighted by how well its depth
     matches the pixel's depth plane. A floor at a grazing angle blurs fully, but nothing bleeds across a silhouette.
4. **Composite** (the pipeline's output node). A depth-aware 2 x 2 upsample of target A, then:
   `scene.rgb x mix(1, ao ^ power, strength x brightGuard)`. After that come the fog's `x transmittance + in-scatter`
   as before, and the output transform (ACES + sRGB, once). AO darkens the **scene colour before the fog**: fog
   in-scatter and the green gas glow are never darkened.

The first-person viewmodel overlay (`render/overlay.ts`) is drawn afterwards and gets no AO. The HUD is DOM.

**There is no temporal accumulation.** AO keeps no history, so it leaves no ghost trails, and nothing needs resetting
on camera cuts, section changes or train journeys. The 4 x 4 interleaved sample pattern is removed by the blur alone,
inside one frame.

## The algorithm

GTAO: Jimenez et al., *Practical Real-Time Strategies for Accurate Indirect Occlusion* (Activision 2016), the same maths
as three's `examples/jsm/tsl/display/GTAONode.js`, ported with our own texture access:

- **Slices.** Each pixel uses SLICES planes through the view vector, spaced evenly around it and rotated per pixel by a
  4 x 4 pattern. Each slice takes STEPS depth samples per side, at quadratically growing distances up to a world radius.
  The radius is clamped on screen, so near surfaces do not reach across the whole frame.
- **Horizon angles.** The samples give two horizon angles per slice. The visible fraction is the cosine-weighted
  closed form, divided by the same arc with nothing above the surface. An open surface therefore reads exactly 1 at
  any tilt.
- **Sample weighting.** A sample raises the horizon only while it is within the radius (smooth falloff), and only if it
  is not more than `thickness` in front of the pixel. Because of that thickness rule, a thin post does not shade the
  wall far behind it.
- **Pixel snapping.** Samples are whole pixels. Each is placed in its slice by its height over the pixel's tangent plane
  and its distance along that plane. This stops the snapping from darkening open floors. Near the horizon of a grazing
  floor, a pixel beside the slice's line on screen can lie almost straight across the slice in the world. That offset
  also counts as distance along the surface. (The first version of the mirror darkened open floors there by up to
  7 %; the unit tests now require at least 0.98 in every pixel of an open floor, wall or ceiling, at every angle tested.)
- **Normals from depth.** For each axis, the neighbour whose 1 / depth is closer to the pixel's is used, so silhouettes
  do not smear. A sky neighbour is never picked while the other side is a surface. On a convex edge, where both
  neighbours sit at the same depth, the normal can blend the two faces. That is harmless: it only lowers the
  occlusion there.

Why not three's `GTAONode` as it is: it samples the depth with filtering samplers and `textureGather`, but on quality
High our scene depth is multisampled. The AO shaders therefore use only constructs that the fog shaders already run on
players' WebGPU:
- depth is read with `textureLoad` only (`.load(ivec2)`);
- `getViewPosition` with the projection inverse;
- loop counts fixed at compile time;
- plain `uniform()` nodes, never `uniformArray`;
- `If` / `select`;
- no derivatives.

## Presets and look

AO follows the atmosphere quality (`AO_QUALITY` in `ambientOcclusionMath.ts`):

| Quality | AO resolution | Pixel cap | Slices x steps per side | Depth loads per AO pixel |
|---|---|---|---|---|
| High | 1/2 of the drawing buffer | 1280 x 720 | 3 x 4 | 29 |
| Low | 1/2 of the drawing buffer | 640 x 360 | 2 x 3 | 17 |

The look (`AO_LOOK`; live-editable on `atmosphere.occlusion.look` for QA):

| Setting | Value |
|---|---|
| World radius | 0.6 m, clamped to 10 % of the screen height |
| Thickness | 0.5 m: geometry more than this in front of the pixel does not occlude it; fades in from 0.25 m |
| Applied as | `ao ^ 1.8` at strength 0.8, so never more than 80 % darker |
| Distance fade | to none between 16 m and 28 m view distance, before the fog takes the surface |
| Bright guard | none on pixels whose linear HDR luminance passes 0.7 → 1.6: emissive fixtures, glow cards, muzzle flashes, lit screens |
| Sky | no AO (depth 1) |

## The setting, the URL override, and when AO is not available

- **Settings → Ambient occlusion: On / Off**, default **On**. It sits in the graphics part of both the main-menu and
  the pause-menu settings, after Quality and Render resolution. It is stored in the browser settings record
  (`ambientOcclusion`). A record from before the setting existed reads it as On. It is not saved in save slots.
- Switching it only changes the composite's `aoOn` uniform and the size of the AO targets (1 x 1 while off). **No
  existing program is rebuilt, and there is nothing to re-warm.**
  - With AO off, the pass draws nothing and no AO program is ever built.
  - Turning AO on builds only the pass's own three small programs (raw, blur x, blur y). When AO is on at load, the
    loading screen's warm-up frames build them.
- **`?ao=off` / `?ao=on`** overrides the setting for the session (QA), like `?fog=`.
- **AO exists only where the atmosphere pipeline runs.** In these cases the station is drawn directly, without a
  pipeline, so there is no AO:
  - `?fog=off`;
  - a backend without float colour targets;
  - a failed fog pass;
  - the game's bypass.

  The settings help line then says "Unavailable here: …" (`VolumetricAtmosphere.aoUnavailable()`). A second pipeline
  just for AO was deliberately not built.

## Failure isolation

AO has its own failure flag, `atmosphere.occlusion.failed`. It never sets `VolumetricAtmosphere.failed`.
- **WebGPU:** the AO draws of the first frames after a program (re)build run inside a `pushErrorScope('validation')`,
  the same pattern as the fog pass.
- **WebGL 2:** the shader-error hook recognises the AO programs by their marker variables (`AO_MARK`). The composite
  carries none of them, so a composite error still counts as a fog error.
- **Anything thrown** while building or drawing the AO programs is caught too.

In every case: AO is turned off (the gate closes at once), one console error is logged, and
`debug().ao.failed` / `.reason` say why. The fog, the gas visibility and the frame continue.

If a blur program fails, the composite falls back gracefully. Its target either still holds the raw AO, or holds texels
without data, which read as open (1), so a failed frame is never darkened.

## NaN safety and texels without data

A browser check (WebGL 2 on llvmpipe, quality High, the real Subway seed 4242) once drew the **whole frame black** with AO
on. The camera was 1–2 m from a flat wall; there was no error, and AO reported itself active.

In Node, neither the CPU mirror nor the generated GLSL produced a NaN or a dark value on that wall. Both were run on the
real pose's depth (CPU rasteriser, 24-bit depth) and on synthetic walls at 0.3–2 m, and they agree to within 1e-3.

What could turn a bad AO target into a black frame was the composite's fallback:
- When none of the four upsample taps matched the pixel's depth, the composite took the "nearest-depth" texel's ao.
- It did that even when the texel had **no data**: a cleared or never-written texel (0, 0), or NaN.
- An ao of 0 multiplied every pixel by 1 − strength (0.2), which is black after ACES. A NaN, or an llvmpipe
  `clamp(NaN)` → 0, did the same.

Every stage is now bounded, and it treats anything that is not a valid value as no data, never as darkness:
- **raw**:
  - every division and normalisation has a floor;
  - a horizon sample counts only when it is a finite cosine (`within(h, -1.001, 1.001)`);
  - the output is a finite ao in [0, 1] (else 1) and a finite g in (0, `AO_G_MAX`] (else 0, meaning no surface).
- **blur**: a tap counts only with a valid (ao, g). No valid tap, or a centre without a surface, gives open (1).
- **composite**:
  - a texel counts only with a valid (ao, g), both in the weights and as the fallback;
  - if no texel is valid, AO is 1;
  - the factor is clamped to [1 − strength, 1], with strength ≤ 1, behind a NaN guard.
- **Look values** edited live are clamped to safe ranges in `sync`.

Validity tests are comparisons (`x >= lo && x <= hi`), which are false for NaN on IEEE hardware.
`tests/ambient-occlusion-nan.test.ts` pins this by running the generated GLSL itself on the CPU.

For QA, `await __game.atmosphere.aoProbe()` reads both AO targets back. It reports texels, NaN, texels without data,
no-surface texels, and the min / mean of the valid ao, for checking a suspicious view in the browser.

## Cost (arithmetic, not a GPU time)

No GPU time can be measured here. These are texture loads per frame (`aoCost` in `ambientOcclusionMath.ts`):
- raw: 1 + 4 + slices x steps x 2 per AO pixel;
- blur: (1 + 2 + 7) x 2 per AO pixel;
- apply: 4 per full-resolution pixel.

| Drawing buffer | Quality | AO size | raw | blur | apply | total |
|---|---|---|---|---|---|---|
| 1920 x 1080 | High | 960 x 540 | 15.0 M | 10.4 M | 8.3 M | 33.7 M |
| 1920 x 1080 | Low | 640 x 360 | 3.9 M | 4.6 M | 8.3 M | 16.8 M |
| 3456 x 1944 | High | 1280 x 720 | 26.7 M | 18.4 M | 26.9 M | 72.0 M |
| 3456 x 1944 | Low | 640 x 360 | 3.9 M | 4.6 M | 26.9 M | 35.4 M |

For comparison, the fog march takes 8 lookups per march pixel, plus 15 per step (more with each active scatter light):
- High: 960 x 540 (its pixel cap) x (8 + 24 x 15), about 191 M per frame at either size;
- Low: 480 x 270 x (8 + 14 x 15), about 28 M.

Its lookups are mostly filtered 3D-noise and map samples, so the counts are a scale, not a time ratio: AO adds about
18 % (1080p High) to 38 % (3456 x 1944 High) of the march's lookup count. The AO raw pass is also ALU-heavy: per sample, a 4 x 4 matrix
product (`getViewPosition`), a few dot products, and one `acos` / `cos` set per slice.

CPU side: three extra full-screen quad draws per frame (no scene geometry is drawn again), plus a few uniform writes.
With AO off: no draws, and only the `aoOn` uniform branch in the composite.

**Not measured:** native GPU time, frame time and hitches. Those need a real GPU (see the lead's browser checks).

## Tests

| Test | What it covers |
|---|---|
| `ambient-occlusion-math.test.ts` | The CPU mirror on analytic ray-cast scenes: open floors, walls and a ceiling at every angle read ≥ 0.98; a crease darkens toward it and is bounded; no halo behind a thin post; sky = 1; the filter cancels the pattern; the apply's guards; sizes; cost |
| `ambient-occlusion-tsl.test.ts` | The raw / blur / composite graphs compile to WGSL and GLSL with no three warning. Depth is read by `textureLoad` only, no gather / derivatives, loop bounds are literal. The binding budget for every variant (msaa 0 / 4, both presets): the composite gains one sampled texture and no uniform buffer |
| `ambient-occlusion-pipeline.test.ts` | three's real `WebGPURenderer` on a no-op device, both backends: target sizes, draw order, resize / pixel ratio / quality / FOV, AO off builds nothing, toggling rebuilds nothing, no builds after the warm-up frames, failure isolation |
| `ambient-occlusion-settings.test.ts` | The setting, its menu choice and help line, the plumbing, `?ao=`, availability |
| `ambient-occlusion-nan.test.ts` | Near walls (0.3–2 m) stay finite and bounded in the mirror. Garbage AO targets read open. The **generated GLSL** run on the CPU: the raw pass equals the mirror; the composite on garbage texels returns exactly the AO-off colour and is never NaN or below 1 − strength |

## Limits

- **Screen space.** Only what the depth buffer shows can occlude. Off-screen and hidden geometry does not count, and
  the screen edges see less.
- **Pictures are from the CPU mirror.** The CPU pictures used to tune the look are the mirror run on a CPU
  rasteriser's depth over flat colours. They are not the game's frame: no textures, game lighting, fog or MSAA.
- **Not yet confirmed on a real GPU** (the lead's browser checks):
  - WGSL validation on a real WebGPU device;
  - the look in the lit, fogged game;
  - GPU time at 1080p / 4K.
