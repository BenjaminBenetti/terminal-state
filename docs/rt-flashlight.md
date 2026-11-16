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
- **At a station's load.** The scene is prepared when the station's lighting is made. What the station adds after
  that is taken in by the last steps of the build, behind the loading screen: the arrival, the enemies, pickups,
  the player train and the lanes' content. A last settle after the warm-up then sends the whole scene to the device.
  The first frames of play have nothing to catch up on.
- **New and removed things in play.** A full re-inventory runs every 0.5 s. A mesh that appeared, such as a dropped
  pickup or a carried prop, gets its tree built in small chunks within the frame's 2 ms budget, and never blocks a
  frame. A mesh that was removed is switched off at once and leaves at the next static rebuild. The device buffers
  keep an eighth to spare (at least 16384 nodes and triangles), so what play adds is uploaded as its own span, not
  the whole scene again.
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
dispatched, the materials' gate shut, exactly zero) in the transit gap and in any frame that is not drawn. The
warm-up's hidden frames are not traced. While the flashlight is off in play, the frame is traced in **standby**
with the gate shut (next section); in the menus, or with the battery flat, it is skipped.

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

## Switching the flashlight on: standby

**What a player's recording showed** (the perf recorder on real hardware, WebGPU at 60 Hz, a drawing buffer large
enough for the 640 x 360 grid; standing still, the flashlight switched on and off four times each in 10.7 s, 625
frames; the bundle of PR #131):

- All 16 missed refreshes (33.3 ms intervals) came 6 to 19 frames after an On, four per On. There were none after
  an Off and none elsewhere.
- **Nothing was built or allocated.** The recorder counted no pipeline, program, node build or new texture in play.
  The runtime keeps its pipelines, device buffers and bind groups across a switch.
- **CPU was not the cause.** The On frame took 10.5 to 11.1 ms of main-thread time (about 7 ms otherwise) and the
  frames after it 7 to 10 ms, all inside the refresh. The On frame's extra time is in the render submission and the
  culler (the recorder's spans). In the code, that frame is also where the scene's sync catches up with a full
  inventory, because sync did not run while the torch was off.
- **GPU execution was.** After each On the queue probe climbed from about 15 ms to 35 to 51 ms within 10 frames and
  stayed there until about frame 19. The off baseline is about 9 ms. The render passes' own GPU time (timestamp queries;
  the compute pass is not in it) stayed at the torch-off level, 7.5 to 8.2 ms, for about 17 frames after each On. Then
  it fell to 5.3 to 5.6 ms, though a lit frame draws more (10 passes and about 460 draws against 9 and 300). After
  each Off it rose back to 7.1 to 7.4 ms within about 6 frames. That is the GPU's clock. The trace's load arrived at
  the clock the lighter torch-off load had settled to, the frames' GPU work outran the refresh, and the queue backed up
  until the clock rose, about 0.3 s later.

**Standby.** In play, with the flashlight off but able to light (its battery not flat), every drawn frame is traced
exactly as a lit one: the same six dispatches, the same grid and rays, at the spot's last lit intensity. The
intensity matters because the gather skips a light ray of zero flux, so an unlit trace would be a lighter load. The
gate stays shut. The materials add exactly zero, so the picture with the torch off is unchanged, and the torch's direct
light and shadow are not drawn. The GPU's load does not change when the flashlight is switched, so there is no step for
the clock to catch up with. The scene's sync and the history go on too, so the first lit frame is a steady one: no
catch-up inventory and no restarted history. A low battery's flicker no longer restarts the history either.

- **Not in standby:** the menus and the pause (their frozen frame traces only a lit torch, as before), a flat
  battery, the transit gap, the warm-up's hidden frames, and every case without a traced station: RT Flashlight Off,
  a renderer that cannot run it, after a device error, and Enhanced lighting Off or plain shading. These dispatch
  nothing with the torch off.
- **Cost:** with RT Flashlight On, a torch-off frame in play costs the GPU what a torch-on frame's trace costs, so the
  GPU usage with the torch off is the torch-on usage. On the CPU it costs the scene's sync and the encode (Node, the
  real Game: see *Measured in Node*). With RT Flashlight Off nothing changes.
- `?rtstandby=off` (session only) turns standby off for an A/B comparison: torch-off frames trace nothing, as before.

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

Per drawn frame with the flashlight on, and in play with it off (standby, above) (grid W x H, at most 640 x 360):

- **Rays:** 1024 light rays, W x H camera rays (230,400 at the cap) and at most 2 x W x H shadow rays (460,800).
- **The gather:** W x H x 1024 kernel evaluations (about 236 M at the cap), plus the reservoir picks. This is the
  pass's main arithmetic.
- **Passes:** one compute pass of six dispatches. No extra draw of the scene and no new render pass.
- **Device memory:** about 33 MB fixed while a station is traced, plus the scene's trees with an eighth to spare. That is two 640 x 360 result textures (2.8 MB),
  the receivers' two history buffers (29.5 MB), the filter's scratch (0.9 MB), the VPLs (48 KB) and the cone
  (16 KB). The scene's trees come on top (table below). All of it is released with the station, when RT
  Flashlight or Enhanced lighting is turned off, and on a device error.

The traced scene per station, measured on real campaign stations in Node:

| Station | Triangles (unique / drawn) | Traced objects | Tree bytes (nodes / triangles / instances) | Prepare (first / again) |
|---|---|---|---|---|
| Subway | 663 k / 2.79 M | 3267 | 21.4 / 31.8 / 0.8 MB | 2.1 s / 0.34 s |
| Mall | 893 k / 3.24 M | 3265 | 28.7 / 42.9 / 0.8 MB | 2.4 s / 0.55 s |
| Office | 1.06 M / 7.02 M | 5375 | 34.5 / 50.9 / 1.3 MB | 3.3 s / 0.58 s |
| Market | about 280 k | about 790 | 11 / 17 / 0.3 MB | not measured |

Stations are seeded at random, so a given station varies. The prepare runs in paced steps behind the loading screen
(its longest step is 60 to 75 ms) or under the pause menu. "Again" is a station whose geometries' trees the session
already holds, for example after a relight or a reload.

- **CPU per frame** is the scene's change check, the dynamic tree, the paced static rebuild and the upload. The
  encode itself is about 0.1 ms in Node. The full figures are in *Measured in Node* below.
- **Load time:** the settle takes about 0.5 s on a new game and 0.16 to 0.19 s on a reload or Continue, in paced
  steps (Node, Market).

**Measured in Node** (the real Game on a validating WebGPU device, a Market station, every traced frame of
`game/tests/rt-flashlight-game.test.ts`; Node's timings of this code, not a browser's):

| Frames | Scene sync, median / p90 / max | Encode + upload, median | Uploaded per frame, median |
|---|---|---|---|
| all play phases (new game, torch on, RT Off then On, after a death, after Continue) | 0.36 to 0.55 / 0.5 to 1.1 / 2.5 to 3.2 ms | 0.1 ms | about 1 KB (the dynamic tree and the capsules) |

The whole scene goes to the device once a load: 44 MB on this station, at the end of the warm-up behind the loading
screen. That cost is load time, not a play frame. Before the load-time settle, the first frames after a load ran
sync at a 2.4 to 3.8 ms median with single frames of 47 to 96 ms.

**On a software WebGPU device** (Firefox 158 on lavapipe, Subway seed 93, a 640 x 360 canvas and a 320 x 180
grid): the six kernels compiled in 211 ms, and the first prepare took 1.09 s. A frame took 589 ms with the bounce
traced against 395 ms with the gate shut. That is lavapipe's CPU emulation of a GPU and says nothing about a real
GPU; its timestamp queries did not give usable per-kernel times.

These numbers come from Node (the real Game on a validating no-op device) and from a software WebGPU device
(lavapipe). **No frame rate on any real GPU is claimed or known.**

## What the browser check showed

These are serial spot checks on Firefox 158 WebGPU over lavapipe, on the direct path. The volumetric pass crashes on
that driver, so it was not used. The view is a torch-only room on Subway seed 93 with a shelf, a locker, a fan and a
tool chest. RT On and Off were drawn at the same pose and time.

- **Replace, not stack.** The status read "bounce traced", the virtual lights were not bound, and pictures with the
  torch off or with no bounce were pixel-identical On and Off.
- **The same mood.** The traced bounce added a mean of 4.9 display levels against 5.5 for the virtual lights. No
  point-emitter patches appeared.
- **Rapid aim.** On a 12-degree-per-frame turn the traced bounce trailed a converged still by 2.7 to 4.7 % of the
  bounce; the virtual lights trailed by 25 to 120 %. With every VPL visible, the traced bounce has no lag at all
  (its shape U is each frame's own).
- **A moving occluder.** A box added after the load was found by the re-inventory and slid 1.6 m across the beam.
  One frame after it stopped, 1.3 to 2.6 % of the bounce was left over. After it was removed the room matched the
  original to noise. The virtual lights never saw it.
- **Noise at rest:** a mean of 0.03 display levels (p99 0.7).
- **Unsupported:** on WebGL 2 the status named the reason, the virtual-light bounce was bound and nothing was
  allocated. Turning RT Off in the page released everything, and the picture equalled the no-bounce one exactly.
- **Off, then On again:** the bounce came back equal to the first allocation, to noise.
- **Grazing props.** A fan and a tool chest across the beam get less bounce than under the virtual lights. They are
  traced, their receivers match and visibility is about 0.97. Their faces point across the beam, so the lit floor and
  the far wall reach them at grazing angles. The virtual lights, unshadowed and gathered at a few centres, lit them
  more.

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
  history rules, standby (the lit frame's block with the gate shut, the history going on, nothing without standby or
  a scene), a device error, the RT light variants' programs (no virtual-light uniform, two textures more, the same
  uniform buffers).
- `game/tests/rt-flashlight-estimator.test.ts`: the estimator's CPU mirror on a traced hall against the virtual-light
  bounce (flux parity, irradiance by distance, smoothness, a wall stub's shadow, an aim sweep past a door jamb).
- `game/tests/rt-bvh.test.ts`, `game/tests/rt-scene.test.ts`: the trees, the packing and the traversal; the
  inventory contract, moving and new and removed entries, the caps, the capsules, the upload protocol.
- `game/tests/rt-flashlight-settings.test.ts`: the setting, its form row, the plan, the status lines.
- `game/tests/rt-flashlight-game.test.ts`: the real Game on a validating WebGPU device. Under the defaults the
  traced bounce replaces the virtual lights (none bound, none in a drawn program) and every drawn frame dispatches
  the kernels. Nothing is dropped or compiled while playing, and every module stays inside the binding limits. It
  then covers the flashlight off (standby in play, nothing with `?rtstandby=off` or in the pause menu), pause Off
  and On, death and reload, Continue, a device error and its fallback (with the torch off too: nothing dispatched),
  and every allocation freed.
- The other real-Game lighting tests (`enhanced-lighting-game`, `lighting-live-apply`, `glass-mirror-game`) run with
  RT Flashlight Off. Their pins are the virtual-light bounce, which Off keeps unchanged.
