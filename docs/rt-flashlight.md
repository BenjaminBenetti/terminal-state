# RT Flashlight

**RT Flashlight** (Graphics, **On** / Off, default **On**) selects how the flashlight's bounce is made. The bounce is
the light the beam's lit surfaces send on to their surroundings. With it On, on a renderer that can run it, the
bounce is **traced on the GPU by compute shaders** through the station's real geometry, **instead of** the fourteen
virtual lights of `world/flashBounce.ts` (enhanced-lighting.md, section 2). With it Off, or where it cannot run, the
bounce is that virtual-light bounce, unchanged.

It is one choice of Enhanced lighting's **full shading**, the only shading that has a flashlight bounce. It changes
nothing else: not the direct flashlight or its shadow, the baked bounce, the reflections and the mirror, the other
lights, the fog or the AO.

## The choice

| RT Flashlight | Renderer | The flashlight's bounce |
|---|---|---|
| **On** (default) | WebGPU, and the compute probe passed (below) | **traced**: the RT variant of the full field light; the virtual lights are not bound (zero, and not in any drawn program) |
| **On** | the WebGL 2 fallback, a WebGPU device without the limits, a kernel that does not compile | the virtual-light bounce, with the reason in the status |
| **Off** | any | the virtual-light bounce, exactly as before: the same light variants, programs and bindings |
| either | Enhanced lighting Off, plain shading (Auto on a software renderer), the Reactor | none (as before) |

- **One setting.** It is shared by the title and pause Settings and saved with the preferences
  (`settingsStore.rtFlashlight`). An explicit Off stays Off. `?rt=on|off` overrides it for one session.
- **Capability is measured, never guessed.** `render/rt/rtGpu.ts` `probeRtCompute` runs once per session on the
  renderer that actually started. It needs the WebGPU backend and the device's real limits (`RT_REQUIRED_LIMITS`:
  storage buffers and storage textures per stage, workgroup storage, workgroup size, the uniform binding size, the
  dispatch size). It then compiles all six kernels (shader module, compilation info, compute pipeline) inside a
  validation scope, with a bound of 15 s. It never reads a GPU's name, its vendor or an amount of memory.
- **Software adapters.** Auto keeps the baseline shader on a software renderer (`SOFTWARE_SHADING_REASON`), so no
  bounce exists there to trace. With Enhanced lighting **On**, a software WebGPU device (lavapipe, SwiftShader) runs
  the traced bounce if its probe passes. It is correct there, and very slow (see Costs).
- **The status tells the truth** about the live station. The help line under the choice, the perf overlay's Lighting
  row, the recorder's environment and `__LL.lighting()` say "bounce traced" with the traced scene's size, or "bounce
  standard" with the reason: unsupported, not ready, needs Enhanced lighting, or this station's scene could not be
  prepared (`world/rtFlashlight.ts`).
- **Changing it during play** works like the other lighting choices (enhanced-lighting.md, *Changing the settings
  during play*). The pause menu rebuilds only the lighting: the light variant changes, the same blocking warm-up runs
  and Resume is held. The world, its seed, enemies, loot, identities, the player and the save are untouched.

## What is traced

`render/rt/rtScene.ts` keeps a **two-level BVH** of the live station: one bottom-level tree per geometry (SAH built,
`render/rt/bvh.ts`, cached for the session) and two top-level trees of instances, one static and one dynamic. The
scene is the whole `THREE.Scene` under one contract; there is **no per-item list**.

- **Traced:** every `Mesh` and `InstancedMesh` whose materials are all lit and opaque. That is the flashlight's own
  shadow-caster rule (`render/volumetric.ts` `litOpaque`): architecture, props, the train, doors and pickups alike.
  It must be visible together with every ancestor, and an `InstancedMesh` counts each instance it draws.
- **Each surface's colour** is its material's diffuse albedo (`render/rt/rtMaterials.ts`). It is the material's
  colour times its map's mean, lowered by metalness the way three's diffuse term is, times the vertex colour and the
  instance colour when the mesh has them.
- **Glass passes.** Transparent materials are not opaque, so shopfronts, the train's windows and glazed cubicles let
  the light through, as the virtual-light bounce's rule does.
- **Moving things are traced where they are this frame.** Each frame a cheap check reads every traced object's
  `matrixWorld`, its instance matrices' version, its geometry, material and draw-range versions and its ancestors'
  visibility. An entry that moved or changed is switched off in the static tree and traced from the dynamic tree,
  which is rebuilt every frame from its current transforms. That covers a door leaf, a prop knocked over, a body
  under physics and the moving train. An entry at rest for 1 s goes back into the static tree, rebuilt at most twice
  a second.
- **New and removed things.** A full re-inventory runs every 0.5 s. A mesh that appeared, such as a pickup or a
  carried prop, gets its tree built inside the frame's 2 ms budget and never blocks a frame. A mesh that was removed
  is switched off at once and leaves at the next static rebuild.
- **Characters are proxies, and are documented as such.** Skinned characters are not traced as meshes: their
  bone-driven poses are not on the CPU. Each frame's living, standing characters within the beam's reach are traced
  as **upright capsules**. These are the same bodies as the virtual-light bounce's cylinders
  (`world/flashOccluders.ts` `setBodies`: the nearest 32 within 30 m). A capsule casts shadows and bounces light at
  a body's colour. A dead or ragdolled body is neither traced nor a capsule.
- **Bounded, never silent.** There are caps on BLAS triangles (2.5 M), on each BLAS stream (the device's storage
  binding limit, at most 128 MiB) and on dynamic instances (1024 a frame). Whatever does not fit is left out and
  **counted** (`stats().omitted`), and the status says how much. A station with nothing traceable keeps the
  virtual-light bounce and says why.

The camera's rig (the viewmodel) and the effects group are not station geometry and are not traced.

## One frame

All of the following is raw WebGPU on three's own device, in one compute pass of six dispatches
(`render/rt/rtKernels.ts`, `render/rt/rtGpu.ts`). It is encoded inside the frame's scene-matrix scope, before the
glass mirror and the scene pass, so every pass that reads the result reads this frame's. It is skipped (nothing
dispatched, the materials' gate shut, exactly zero) while the flashlight is off, in the transit gap, and in any frame
that is not drawn. The warm-up's hidden frames are not traced.

1. **LIGHT: 1024 light rays of equal flux.** The cone is cut into 32 x 32 cells of equal flux by a concentric map,
   with the same falloff math as the virtual-light bounce (`render/rt/rtCone.ts`). Each ray is traced through the
   BVH, closest hit, from the flashlight's shadow near plane. Where it lands, it makes one **small area light**
   (a VPL) on that surface. Each VPL has its own surface normal and colour, the radiant flux the spot really puts
   there, and the size of the ray's footprint. A prop, a pole or a character in the beam takes the rays it really
   intercepts.
2. **RECEIVERS: the camera's rays.** A low-resolution grid, about half the drawing buffer and at most 640 x 360, is
   traced through the same BVH. Each cell gets the surface it sees: its point, normal and class (mesh, proxy or
   nothing).
3. **GATHER.** Each receiver gets the **exact unshadowed irradiance U** from **all 1024 VPLs**, with the
   virtual-light bounce's area-regularized kernel, range window and gain (2), read live from `FB.params`. The VPLs
   are streamed through workgroup memory. On the way, weighted reservoir sampling picks one VPL from each half of the
   beam (the split alternates between frames), with probability by contribution, and casts **one shadow ray to each**
   (any hit). The result is **v**, the contribution-weighted share of the bounce that is really seen.
4. **TEMPORAL.** Only v is accumulated: the shape of the bounce (U) is this frame's own and follows the beam
   instantly. Each receiver is reprojected into the previous frame's grid with the previous view-projection. A
   history tap counts only on the same plane, facing the same way and of the same class, so disocclusions,
   silhouettes and a moved prop's old place are rejected. The history is clamped to this frame's 3 x 3 range. The
   blend never falls below a floor of 0.12, raised by 8 per radian the beam turned and 1.5 per metre the light moved
   in that frame, so a fast aim sweep follows within a frame or two. The history restarts after a frame without a
   dispatch, a new station, a resize and a camera jump of more than 2.5 m.
5. **SPATIAL.** Two edge-stopped a-trous passes (5 x 5 B3 weights at steps 1 and 2; plane distance, normal and
   class stop them) filter v. The second pass writes the two result textures: **E** (rgba16float: U x v x gain, plus
   the receiver's plane offset) and **N** (rgba8unorm: normal, class).

**The materials** (`world/rtBounceNode.ts`, only in the RT light variants `light-field-full-rt`,
`light-field-reflect-full[-mirror]-rt`) project a fragment's world point with that frame's main-camera
view-projection. They take the 2 x 2 receivers round it and keep a receiver only when the fragment lies on its
plane and faces its way. The kept ones are blended by their bilinear weights. This is two sampled textures (texel
loads, no sampler) and three render-group uniforms, with no uniform buffer of its own. The RT programs leave the
virtual lights' 43 uniforms out entirely.

Why this is not the old method on the GPU: the virtual-light bounce takes 30 CPU rays and lets fourteen *unshadowed*
lights stand for the whole lit patch. Here 1024 rays land where the beam really goes, every receiver sums every VPL
exactly, and **visibility between the lit surfaces and the receiving surface is ray traced**. A pillar, a counter or a
character between a lit wall and the floor shades the floor. The bounce does not leak through walls, slabs or props.
No VPL is visible as a circle: each is an area light as large as its footprint, and the 1024 of them overlap. It is
not screen-space gathering either: both the light rays and the shadow rays run through the scene's own geometry,
including what the camera does not see.

## Limits

1. **Receivers are where the camera looks.** The traced result exists at the surfaces the main camera's grid sees.
   A surface no grid cell sees gets no traced bounce in that frame. That includes a sliver thinner than a cell
   (about 2 pixels), a surface behind another one, anything off screen, and a surface seen only in the glass mirror:
   the mirror's fragments look up the main view's result. Light still *comes from* surfaces the camera does not see.
2. **Characters are capsules,** as above, not their animated meshes.
3. **The sheen is approximate.** On metal, glass and glazed tile the virtual-light bounce's sheen weighs the patch
   in the mirror direction. Here it is the traced irradiance at the surface's own normal times the same Fresnel and
   roughness response: a soft glow that follows the bounce, not a reflection of the lit patch.
4. **A ratio is filtered, not the light.** With two shadow rays per receiver per frame, v is noisy before the
   filters. Under a fast change, the edge of a moving shadow can lag by up to about the blend's time constant (8
   frames at the floor, far fewer while the beam turns) where the 3 x 3 clamp cannot bound it. Where only part of
   the bounce is blocked, the a-trous passes soften the shadow's edge.
5. **Same strength as the bounce it replaces.** The gain, range and patch size are the virtual-light bounce's, and
   the flux is the same to 0.05 % at every distance. On flat open surfaces the traced bounce matches it from about
   1.5 m on. Near a lit wall's foot it is brighter (up to about 1.8 times at 0.4 m), where the fourteen lights were
   documented to fall short. Where something blocks it, it is darker, which is the point.
6. **Flashlight only.** No other light is traced, and the baked bounce of the fixtures is unchanged.

## Costs

Per drawn frame with the flashlight on (grid W x H, at most 640 x 360):

- **Rays:** 1024 light rays, W x H camera rays (230,400 at the cap) and at most 2 x W x H shadow rays (460,800).
- **The gather:** W x H x 1024 kernel evaluations (about 236 M at the cap), plus the reservoir picks. This is the
  pass's main arithmetic.
- **Passes:** one compute pass of six dispatches. No extra draw of the scene and no new render pass.
- **Device memory:** about 33 MB fixed while a station is traced. That is two 640 x 360 result textures (2.8 MB),
  the receivers' two history buffers (29.5 MB), the filter's scratch (0.9 MB), the VPLs (48 KB) and the cone
  (16 KB). The scene's trees come on top (*station table below*). All of it is released with the station, when RT
  Flashlight or Enhanced lighting is turned off, and on a device error.
- **CPU, per frame:** the scene's change check, the dynamic tree and the frame's upload (*measured below*). The
  encode itself is under 0.1 ms in Node.
- **Station load:** building the station's trees in paced steps behind the loading screen (*measured below*).

These numbers come from Node (the real Game on a validating no-op device) and from a software WebGPU device
(lavapipe). **No frame rate on any real GPU is claimed or known.**

## Failure and cleanup

- A device error in the traced work (checked in error scopes on a new scene's first frames) stops RT for the session.
  So does a frame that throws. The gate shuts at once, so that station has no flashlight bounce, never a wrong one,
  and its device resources are freed. The status says why. The next pause rebuilds the lighting with the
  virtual-light bounce, as for any pending change, and every later station has it. The player's choice stays On.
- A new station, a death and reload, Continue and a lighting change each release the previous traced scene and its
  buffers before the next is made. The result textures go back to 1 x 1 zero placeholders, and every render object
  that outlives the swap re-reads its bindings. The menu keeps the station, and its traced scene, behind the frozen
  frame it redraws at a low rate.

## Why compute shaders, not hardware ray tracing

Browsers expose no ray-tracing API. The WebGPU specification's feature list (`GPUFeatureName`) and WGSL have no
ray-query or acceleration-structure feature. Chromium's and Dawn's feature lists, including their non-standard
experiments, have none either, and an adapter's `features` only list what the API exposes, not what the hardware
has. A browser that runs WebGPU on Vulkan does not give the page Vulkan's ray-query extension. So RT Flashlight is
ordinary WebGPU compute with its own acceleration structure and traversal. It runs on any WebGPU device whose limits
fit, and does not use RT cores.

Sources (retrieved 2026-11-15):

- https://gpuweb.github.io/gpuweb/#enumdef-gpufeaturename
- https://gpuweb.github.io/gpuweb/wgsl/
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webgpu/gpu_supported_features.idl
- https://raw.githubusercontent.com/google/dawn/main/src/dawn/dawn.json
- https://gpuweb.github.io/gpuweb/#gpuadapterinfo: adapter information is not guaranteed and is not a capability.

## Tests

- `game/tests/rt-flashlight.test.ts`: the cone's equal flux, the grid size, the required limits against WebGPU's
  defaults, the kernels' bindings and WGSL (no reserved words), the probe on a validating device (WebGL 2, limits, a
  compile error), the device resources' lifecycle and placeholders, the frame block's camera, light, grid and
  history rules, a device error, the RT light variants' programs (no virtual-light uniform, two textures more, the
  same uniform buffers).
- `game/tests/rt-flashlight-estimator.test.ts`: the estimator's CPU mirror on a traced hall against the virtual-light
  bounce (flux parity, irradiance by distance, smoothness, a wall stub's shadow, an aim sweep past a door jamb).
- `game/tests/rt-bvh.test.ts`, `game/tests/rt-scene.test.ts`: the trees, the packing and the traversal; the
  inventory contract, moving and new and removed entries, the caps, the capsules, the upload protocol.
- `game/tests/rt-flashlight-settings.test.ts`: the setting, its form row, the plan, the status lines.
- `game/tests/rt-flashlight-game.test.ts`: the real Game on a validating WebGPU device. Under the defaults the
  traced bounce replaces the virtual lights (none bound, none in a drawn program) and every drawn frame dispatches
  the kernels. Nothing is dropped or compiled while playing, and every module stays inside the binding limits. It
  then covers the flashlight off, pause Off and On, death and reload, Continue, a device error and its fallback,
  and every allocation freed.
- The other real-Game lighting tests (`enhanced-lighting-game`, `lighting-live-apply`, `glass-mirror-game`) run with
  RT Flashlight Off. Their pins are the virtual-light bounce, which Off keeps unchanged.
