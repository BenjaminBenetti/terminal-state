# Rendering warm-up — the loading pipeline's graphics step (iteration 14)

The game renders with three r186's `WebGPURenderer`. A material, geometry layout or render pass that is drawn for the
first time has to build its TSL node graph in JavaScript and create a GPU pipeline before it can draw. On the first
frames that use it, that shows up as a hitch. The warm-up does this work on the loading screen instead: before the
first station, after **New station** / **Retry**, and after a quality change in the pause menu. The work runs in
`game/src/render/warmup.ts`, driven by `Game.prepareGraphics()`.

## What is covered automatically (no code change needed)

The warm-up **discovers** what to prepare by walking the live station scene after it is built (`planWarmup`):
- every renderable the loaders and builders put there: meshes, skinned meshes, instanced meshes, sprites, points and
  lines, including ones the level/fog culler currently hides, or ones outside the camera view;
- their *runtime* materials (whatever the object carries after decay, damage clones, wardrobe and so on, not the raw
  GLB material).

It keeps one representative per three cache-key group: material, geometry attribute layout, instancing (every
InstancedMesh is its own group in three r186), skeleton, and shadow flags. Representatives are compiled with the
real camera into the real render target the station is drawn into. Then the torch-lit shadow pass, the fog passes,
the output pass and the overlay composite run through a few hidden real frames.

**So a new model, texture or material added through the normal asset workflow (manifest + loader + builder/placement
code that adds it to the scene) is prepared with no warm-up change**, as long as it is in the scene when the station
finishes building. `game/tests/warmup.test.ts` covers this by injecting an unfamiliar asset.

**Level-scoped assets** (task track3-eaton-centre-20261031): a level's own art loads behind **that level's** loading
screen, before its build and this warm-up. Release and limits are covered in `game/src/assets/levelAssets.ts`.
- Lazy models come through the prop library: the layout's keys, filtered by `levelAssets.ts` `selectLevelKeys`.
- Textures and level-only GPU resources go through `game.levelResources` (`assets/levelResources.ts`): `load` from a
  section preload, `get` while building, `own` for anything made for one level.
- Files under `assets/models/mall-*.glb` and `assets/textures/mall/` are loaded only for the mall. They are released on
  travel to another level.
- A fetch after the level is built counts as `late` (`__LL.levelAssets()`), because nothing of the level's world should
  load mid-play.

## What needs registration (`game.warmRegistry`, a `WarmupRegistry`)

| You add… | Do this | Example in the code |
|---|---|---|
| Parts **added to a held item** at runtime (e.g. the rifle's optic lens + depth mask, iteration 15) | nothing — they live under the viewmodel's held-item roots, which the viewmodel pass compiles (hidden roots made visible for the call) | `RifleOptic` runtime aperture |
| A viewmodel object **fixed to the face** rather than held (hidden until used) | `viewmodel.addFaceRoot(root)` before the warm-up: the root hangs off the viewmodel camera and is one of `warmRoots()`; materials are made once, use only changes visibility / uniforms | the first-person gas-mask view (`gear/maskView.ts`, task gas-mask-roof-feedback-20261030) |
| A **new light type** with its own lighting node | register the node in `Game.initRenderer` before the first compile, keep the light in the scene from the start (change intensity, never the light set) | `FlareLight` / `FlareLightNode` (iteration 15) |
| A **new render pass** that draws objects with its own scene / camera / render target | `warmRegistry.addPass({name, scene, camera, target: () => rt, hidden?: () => roots})` | the viewmodel overlay (`'weapons and held items'`) |
| **Effects hidden until first use** (pools with `visible = false`) | keep them under a registered pool root: `warmRegistry.addPool(name, () => [root])`. The default `'effects'` pool is `fx.group`, so new effects added there are covered | sparks, smoke, blood, tracers, decals |
| Something **created on use** (thrown, spawned, attached later) | build a hidden **prototype** with the same factory, keep it in the scene (meshes hidden, `raycast` disabled, far away), and register it as a pool | `FlareSystem.warmPrototypes()` (`'flares'`) |
| Content **added mid-play** that no pool or prototype covers | add it hidden, `await game.prepareBeforeShow(root)`, then show it | the office exterior swapping in late-arriving Meshy models (`world/towerRuntime.ts`, iteration 16) |
| Section content that may be **hidden at warm-up time** (e.g. scenery shown only while a window is in view) | keep it under a registered pool root | the `'tower'` pool: the moving elevator cab, landing doors, windows, exterior city (iteration 16; iteration 17: one continuous tower, all storeys warmed up front) |
| A **shader-affecting configuration change** (quality, MSAA, render targets, light set) | call the warm-up again before control returns (`game.rewarmAfterSettings()` / `prepareGraphics()`) | the pause menu's Quality setting |

### Rules

- **Never** compile into a different render target, camera or scene than the one that will draw the object. three
  keys node builds and pipelines by the render context, so a "warm" pipeline in the wrong context is a second cold one.
  The context also includes the **call depth**: the atmosphere draws the station inside its RenderPipeline (depth 1),
  while `compileAsync` asks for depth 0. Compile station content through `runWarmup` (host `sceneDepth`),
  `prepareObjects(..., depth)` or `compileItemsLive`, never with a bare `renderer.compileAsync` (see below).
- Pool roots must be **in the station scene**. A pool's hidden objects are made visible only for the duration of a
  `compileAsync` call, which draws nothing.
- Lights: change only `intensity`. Adding or removing lights, or toggling `light.visible`, changes three's light set,
  and then every lit material rebuilds.
- The warm-up must not touch gameplay: no update tick, no timers, no sounds, no simulated firing or throwing.

## Camera-turn CPU in the mall and after the train (task studio-performance-recorder-20261103, lane RENDER-CPU)

The user reported stutter on newly seen content when turning in the mall, on hardware WebGPU with the `full`
warm-up, and also in the Reactor after train journeys.

The measurements below ran in Node. They use three r186's real `WebGPURenderer` (WebGPU backend, and also WebGL 2)
on a no-op GPU device (`tests/helpers/fakeWebgpu.ts`). Node builds, render objects and material cache-key rebuilds
are counted inside three. The scenes are the real mall (t3a) and Reactor (9100) on the game's build path. They are
drawn through a PassNode inside a RenderPipeline, as `render/volumetric.ts` does. These counts are
backend-independent JavaScript work. The milliseconds are Node figures on a shared pod, a trend only and not native.

Root causes, and their fixes:

1. **Wrong render context.** three r186 keys `RenderContexts` by target, MRT **and call depth**. The material cache
   key, and with it the node build and the render object, includes the context id. `compileAsync` always uses
   depth 0, but the station draws at depth 1. So the materials stage compiled every representative into a context
   that no real frame ever looks up. Only the casters, which the shadow stage draws in real hidden frames, and the
   final view frame were warm. Every non-caster group (glass, unlit glows, emissive cards) and every pooled object
   was built on first sight.
   - A three-only probe shows it: 4 builds during `compileAsync`, then 5 more on the first pipeline frame.
   - Fix: `render/renderContextDepth.ts`. One hidden frame with the camera layers empty measures the depth at which
     the scene-pass target is drawn (`Game.sceneDepth`). `compileAtDepth` then runs the station compile at that
     depth.
2. **Holder contents hidden at warm-up.** The loot display has one batch per item and storey: about 180
   InstancedMeshes, each with its own node build. These batches, and the holders' interiors, stay invisible until
   used, and they were not in a pool. They are now covered by the `'holders'` pool (`containers.group`).
3. **Gaps in the hidden frames:**
   - pooled casters got no shadow frame, and an InstancedMesh's shadow variant is its own node build;
   - three draws a shadow map only when a *receiver* draws, so a chunk of enemies or loot batches never drew its
     shadow variants;
   - every object that a representative covers still creates its own render objects (bindings, uniform buffers,
     geometry buffers) on first view, in each pass.

   Now pooled casters get frames, every chunk holds a receiver, and in `full` mode every renderable is drawn once
   (`plan.others`).
4. **Per-frame shadow re-keying (ongoing, not first-use).** The shadow pass shares one override material per light,
   and three copies each caster's `alphaTest` onto it. A value crossing 0 bumps `version`. In the mall, alpha-tested
   wall-detail decals, banners and ad cut-outs sit between opaque casters, so every caster re-keyed and fully
   refreshed every frame: 70–260 key rebuilds per frame.
   - Fix: `render/shadowOverride.ts` draws alpha-tested casters with a twin of the shadow material, so neither
     material ever crosses 0.
   - The shadow shaders per caster are identical and the caster set is the same (`rendercpu-warmup-context.test.ts`,
     on both backends).
5. **The campaign journey had no warm-up.** `Game.travelToStation` never runs the loading-screen warm-up. Its
   background compile drew `world.group` alone into the canvas context at depth 0, skipping culled meshes, holders,
   stock, enemies and pickups, and it stopped after 8 s.
   - Now `render/journeyCompile.ts` prepares the next station for the whole ride, and after it until done. It is
     time-sliced through the frame-budget scheduler (`core/frameBudget.ts`), never holds a frame and never touches the
     canvas. The arrival still waits at most 8 s.
   - The warm-up planner picks the items, nearest the arrival first: representatives, then (`full`) every other
     renderable.
   - **Scene pass:** one asynchronous `compileAsync` chunk in flight, into the scene pass's context. The chunk is
     isolated on a spare layer (30) for the synchronous call and restored at once.
   - **Flashlight shadow variants:** `compileAsync` cannot build these. It records the shared shadow override by
     reference and builds after the per-caster nodes are restored. Instead, each step draws a few casters off-screen:
     `renderer.render(scene, twin camera)` into the scene pass's own target, nested at the real frame's depth. One
     receiver sits on the twin's layer, which triggers the shadow node. The casters sit on layer 29, which only the
     light's shadow camera renders for that call. The next frame re-renders the target and the shadow map before
     anything composites. No hidden frame and no arrival pause are needed.
   - New game, Continue, Continue with a journey in progress, and menu travel all run `prepareGraphics` after the
     build, so they get all of the above.
6. **The journey compile starved Chrome's rendering** (task journey-compile-pacing-20261104, from the user's native
   Mall recording). In a 30 s capture just after leaving the train, 21 of 31 hitches and every frame of 100 ms or more
   fell in a 3.85 s window while the journey job was still running. In those frames game CPU was 8–11 ms and the GPU
   at most 7 ms, and the browser's long-animation-frame entries showed rendering held back about 100 ms behind
   `Scheduler.yield` continuations.
   - **Cause:** three r186's `compileAsync` awaits `yieldToMain()` after every object, and `NodeBuilder.buildAsync`
     after every stage (about 6 per new build). In Chrome that is `scheduler.yield()`, whose continuations run ahead
     of rendering. So one 16-item chunk's whole chain ran before the next frame, until Chrome's ~100 ms
     render-starvation guard. The studio's Firefox 158 has `scheduler.yield` and `postTask` too, but it keeps
     rendering between yield continuations. In a probe page under a continuous 3 ms-per-link yield chain, it drew
     a frame every ~17 ms, with at most a 34 ms gap, whether the chain was started directly or from a background
     task. That is why Firefox / llvmpipe QA never showed the starvation, and why it cannot confirm Chrome's
     inheritance.
   - **Fix (scene lane only; the shadow lane is unchanged):**
     - one item per `compileAsync` call and one call in flight;
     - a slice starts in the scheduler's step, after the frame's render. A cheap item that settles in the same frame
       (`FrameBudget.frame`) under 2 ms of real time since the step starts the next item at once, at most 48 a
       slice. Anything else waits for the next frame's step;
     - where `scheduler.postTask` exists, each call is launched from a `'background'` priority task, so the yields
       three makes inside it inherit background priority (the platform's documented yield inheritance) instead of
       running ahead of rendering;
     - a launch whose background task has not run after 20 frames is run by the next step directly.
   - **Hidden tab / pause:** steps run only in playing frames and at most one call is in flight, so nothing bursts
     on resume.
   - **Cancelled** on a new journey, the main menu, death, a loading screen, the error screen, device loss and a
     world change (checked when a call starts and when it settles).
   - **Recorder:** frame flag `compiling` (1024) while the job runs; events `compile.journey.active` (already running
     at recording start), `.start`, `.phase` and `.end` with the paced counts; capability `journeyCompile`.
   - **Coverage cost** (Node, Mall t3a, the `journey-sliced` harness below, old and new job on the same pod):

     | | Old (16-item chunks) | Paced |
     |---|---|---|
     | Done at a 720-frame ride: scene / shadow items | 912 / 780 | 798 / 1,699 |
     | First sweep after the ride: builds / new ROs | 178 / 541 | 143 / 392 |
     | Job finished after | 1,164 frames | 1,485 frames (+28 %) |
     | Sweep after it finished | 0 / 0 / 0 | 0 / 0 / 0 |
     | Largest synchronous scheduler step | 22.1 ms | 13.2 ms |
     | Scheduler run per frame, mean | 3.2 ms | 6.7 ms (shadow lane gets the budget the chunks used) |

     The shadow lane now gets the frame budget the 16-item chunks used to take. Node has no `scheduler.postTask`, so
     these runs launch directly; native Chrome throughput is not measured here.
   - **Tests:** `journey-compile-pacing.test.ts` (fake renderer and clock: per-frame bound, batching bounds, frame
     awareness, hidden / pause, exactly-once completion, cancel / world change / failure, the background launcher, the
     watchdog) and `rendercpu-journey-compile.test.ts` (real renderer: one item per call, coverage, 0 builds after).

Node builds / new render objects / key rebuilds after the warm-up, summed over yaw sweeps (16 steps a pose):

| Station / route | Before | After |
|---|---|---|
| Mall t3a, 6 poses, `full` warm-up (fix 1 alone: 26 / ~520 / –) | 67 builds / ~640 ROs / ~3,800–4,400 keys per sweep | **0 / 0 / 0** |
| Reactor 9100, rim platform / rim gallery / tier-2 deck (without fix 1, others on) | 20 / 92 / ~1,300–2,000 keys per sweep | **0 / 0 / 0** |
| Reactor 9100, journey route, 12 s ride (720 frames), 8 steps a pose | 360 builds / 882 ROs | 80 / 374 (scene 704 / 1,960 and shadows 1,012 / 1,808 done at arrival) |
| Reactor 9100, journey route, the job left to finish | 360 / 882 | **0 / 0 / 0** (finished after 1,157 frames, about 19 s) |
| Mall t3a, journey route, 12 s ride (720 frames), 6 poses | 700 builds / 1,385 ROs | 112 / 364 (scene 928 / 2,114 and shadows 1,396 / 1,961 done at arrival) |
| Mall t3a, journey route, the job left to finish | 700 / 1,385 | **0 / 0 / 0** (finished after about 1,190 frames, about 20 s) |

In the journey rows, the ride is simulated in Node. Each frame is the real frame, then the scheduler's `run()`
inside the native 60 Hz budget (11.67 ms), then 10 ms of idle time in which three's yielded compile slices run.
Builds cost Node-speed CPU, so a native ride covers about the same or more. Added CPU per ride frame:
at most one scene chunk start and one shadow draw of at most 8 casters per frame, with
  the scheduler's steps averaging 3.1–3.6 ms a frame (Node). A single step with a fresh build reached 13–19 ms, over
  the 11.67 ms budget, so the bound is the budget plus one step; at most one overdue step per 2 s runs regardless.

- **Warm-up time** (Node, mall): 26.3 s → 18.5 s. Nothing is built twice any more, and the shadow stage's real
  frames no longer compile scene-pass builds. Reactor: 28.5 s → 15.1 s.
- **Steady-state frame** (Node, second sweep, the scene + shadow passes' three JS): about 30–40 % less with the
  shadow twin. Examples: mall start view 29 → 17 ms, ring edge 33 → 20 ms; Reactor start 14.6 → 10.8 ms.
- **The culler** (`world/levelCulling.ts`) runs a full update on every turning frame.
  - Its position-only results are now cached per eye position: slab tests, atrium / portal sight tests, exit-opening
    rays. The hot loop no longer allocates per entry.
  - Mall t3a, turning in place at 3° a frame, 2,160 frames: median 2.10 → 1.39 ms, p95 3.41 → 2.04 ms.
  - Decisions are identical to fresh computation on 240 sweep and walk cameras (`rendercpu-culler.test.ts`).
  - PR 42's lingerie store added 14 culler entries (1,897 → 1,911) and no measurable culler cost.

Limits:
- These are Node counts of three's JavaScript. GPU driver work behind the API calls (WGSL → native, pipeline
  creation, uploads) is counted but not timed, and no native frame time is claimed.
- **Journey timing.** On a large station, a 12 s ride does not cover everything at Node build speed. The rest
  continues after arrival in spare frame time, nearest first.
- **Journey slicing granularity.** three's asynchronous build slices run between frames and are not budgeted by
  the scheduler. Each slice is one build stage; the largest seen in Node was 22 ms. Since fix 6 the most one frame
  can be held is one item's chain, and only where Chrome's yield inheritance does not apply. That inheritance and
  the native frame times are not verifiable on this pod (no Chromium); they need a native recording after a train
  arrival.
- Things created on use after the warm-up, outside pools, still build cold: shelf-stock pieces knocked loose
  (`shelfStock.ts` creates their InstancedMesh then) and loot highlight copies (first hover per item type).
- Harnesses: `rendercpu-submit-investigate.test.ts` (`LL_RCPU_SUBMIT_OUT=…`, `LL_RCPU_LEVEL=reactor`,
  `LL_RCPU_ROUTE=journey-old|journey-new|journey-sliced`, `LL_RCPU_RIDE_FRAMES`, `LL_RCPU_IDLE_MS`, `LL_RCPU_SHADOW_FIX=1`, `LL_RCPU_NO_DEPTH=1`) and
  `rendercpu-cullprof-investigate.test.ts` (`LL_RCPU_PROF_OUT=…`). Both are env-gated and skipped in CI.

## Lifecycle and guarantees

- `Game.prepareGraphics()` is single-flight. It resolves (never rejects) with a `WarmupResult` whose status is one of:
  - `complete`;
  - `partial` (60 s budget; checked between chunks, and a running chunk always finishes);
  - `cancelled` (station replaced or device lost);
  - `failed`;
  - `skipped` (`?warmup=off`).
- "Start run" (title) is enabled, a level travel (menu) resumes, and the loading text says *Ready* only after it resolves. A partial or failed result says
  so on the loading line.
- The game loop neither updates nor renders while it runs (`Game.warming`). The canvas is hidden during the hidden
  frames.
- Everything it changes is restored: layers, visibility, frustum flags, render target and MRT, the torch, and the
  culler state. Fog temporal history is dropped.
- **Station transitions:** three frees a node build, pipeline or program when its last user is disposed.
  `Game.newStation` removes the old station from the scene immediately, but queues its GPU releases until after the
  new station's warm-up. Those releases are zombie, wound and wardrobe materials, the fixture glow, world instanced
  meshes and the light-field volume. Programs both stations share are therefore reused, not rebuilt. New per-object
  work, such as each new InstancedMesh's own node build, is prepared on the loading screen.
- Progress reports done/total over real units:
  - representatives compiled;
  - passes;
  - hidden shadow frames;
  - the final view frame.

  It never shows 100 % before the work has finished.
- Mode: `full` on hardware GPUs. On a software rasterizer (llvmpipe, SwiftShader…) it is `view`: only the camera's
  neighbourhood plus pools and passes, because software GL keeps every compiled program in system RAM. Use
  `?warmup=full|view|off` to override.

## Limits

- It prepares the **current** station on the **current** backend and quality. It does not prepare every quality
  setting, every station or every possible effect.
- The browser and driver may still do some first-use work (driver-side pipeline specialisation, a first texture
  residency). A first view can still hitch slightly; the warm-up removes the big first-minute compile cost.
- Hitches unrelated to compilation (garbage collection, physics spikes, audio decode) are out of its scope.
