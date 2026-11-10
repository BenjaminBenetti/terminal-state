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
| A **play-only variant** of station content (a holder's own meshes, a damaged part, a torn chunk) | add a pure prototype method to the subsystem (its real factory, materials, geometry layout and shadow flags) and offer its meshes in `Game.refreshRuntimeVariants` | the `'runtime-variants'` pool (below) |
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
  (`shelfStock.ts` creates their InstancedMesh then) and a dropped item's pickup (its own material clones). Loot
  highlight copies are prepared since task runtime-variant-warmup-20261105 (below); the shelf-stock moving sets and the
  pickups since task studio-perf-ao-train-continuity-20261110-022206-01 ("Stutter during ordinary play", below).
- Harnesses: `rendercpu-submit-investigate.test.ts` (`LL_RCPU_SUBMIT_OUT=…`, `LL_RCPU_LEVEL=reactor`,
  `LL_RCPU_ROUTE=journey-old|journey-new|journey-sliced`, `LL_RCPU_RIDE_FRAMES`, `LL_RCPU_IDLE_MS`, `LL_RCPU_SHADOW_FIX=1`, `LL_RCPU_NO_DEPTH=1`) and
  `rendercpu-cullprof-investigate.test.ts` (`LL_RCPU_PROF_OUT=…`). Both are env-gated and skipped in CI.

## Play-only variants: the runtime-variant pool (task runtime-variant-warmup-20261105)

A native recording (Office, GAME69) showed most felt stalls were **first uses of non-instanced variants** that do not
exist at warm-up time. Firing a gun makes several at once: a holder's own meshes after an aim or an open, the damaged
copy of a prop, a torn flesh chunk. `render/runtimeVariants.ts` keeps one hidden **prototype** per variant under the
station scene (`RuntimeVariantPool`, registered as the `'runtime-variants'` pool). `Game.refreshRuntimeVariants`
rebuilds it just before each warm-up and before the journey's preparation, so both plan and compile it.

| Family | Built by | What it is |
|---|---|---|
| `takeover` | `OpenableSet.takeoverPrototypes()` (`world/openables.ts`) | Every attached kind's own meshes (moving parts, plates, trays, interiors), with the accent material **of each attached accent colour** and the own-mesh shadow flags rule (`ownMeshShadowFlags`, shared with `takeover()`) |
| `highlight` | `ContainerManager.runtimeVariantPrototypes()` (`world/containers.ts`) | The aim highlight: the same cached clone gameplay uses (`highlightOf`), on the aimable meshes and on one legacy container per kind |
| `damaged` | `PropDamage.variantPrototypes()` (`damage/propDamage.ts`) | Detached shared instances (non-instanced), merged-chunk extracts (non-indexed) and holders' own meshes, each with **the damage material the first hit will use** |
| `flesh` | `PhysChunks.fleshPrototypes()` (`physics/chunks.ts`) | `chunkMaterial` per distinct enemy layer-material signature, on the patch / flap layout (position, normal, uv, colour; non-indexed) |
| `pickup` | `PickupManager.pickupPrototypes()` (`world/pickups.ts`) | A pickup of every item of the registry except the twelve variety weapons (their own `'weapon-variety'` pool), built as `add()` builds it: the item's mesh and its own material copies (task studio-perf-ao-train-continuity-20261110-022206-01) |

Rules the pool follows, each found by the real-Mall A/B test below:
- **Real factories only.** No stand-in boxes: the same geometry, material instance and shadow flags the play code
  creates. Building the prototypes is pure: no holder, slot, PropState, cut, PartData, loot, RNG or physics change.
- **One prototype per variant** (`variantKey`, a structural mirror of three's key, used only to de-duplicate).
- **Shadow variants are per material instance.** three r186 builds a caster's shadow-pass variant per material
  INSTANCE when the material has a map, colour node, mask or cast node (`Renderer._getShadowNodes` reads them from
  the material). Two value-equal copies therefore share the scene build but not the shadow build. So:
  - `variantKey` keeps such a caster's material instance (`ownShadowNodes`);
  - every accent colour is prototyped;
  - `detach()` now draws every part with one shared damage material per (source, instance tint) for the station,
    instead of a clone per part (`PropDamage.damageMat`). The look is unchanged: the damage state is per-object data
    on the part's mesh, and nothing per part lives on the material. `PropDamage.clear(retire)` releases them after
    the next warm-up.
- **Transparent DoubleSide materials draw in two passes.** three draws each side with `side` set to BackSide, then
  FrontSide. `compileAsync` only queues the work and builds it after the side was restored, so it builds a DoubleSide
  variant those draws never use. The pool adds a BackSide and a FrontSide copy of each such prototype (node hooks and
  alphaTest kept; dropped unless its key equals the real draw's: `sideMismatch`).
- **Hidden for the world's lifetime.** three's caches are reference-counted, so a prototype removed before first use
  could free its build. The pool is cleared with the world (`leaveSection`), and its own geometries and side copies go
  through the retire queue.
- **Bounded.** The pool is one station's kinds, never other stations. It is used in `full` mode only; `view`
  (software GL) clears it.
- It supersedes the old flag-less damage pre-warm meshes (`dropWarmup`).
- **Journey order** (task mall-horde-performance-20261105): the pool's prototypes and the loot highlight copies are marked
  `userData.runtimeVariant` (`isRuntimeVariant`). `Game.backgroundCompile` puts their shadow variants first in the shadow lane
  (`runtimeVariantsFirst`). They sit at the world origin, so "nearest the arrival first" used to rank them last. After arrival, busy
  frames leave no spare time, so they were built one per overdue step, every 2 s, at 5–22 ms each. That was all 16 in-play builds
  of the GAME71 Mall capture. The scene lane keeps its order.

**Measured** (`game/tests/runtime-variant-warmup.test.ts`, the real Mall t3a in Node on three's WebGPU code path with
a no-op device; Node build speed, not native timings):

| Measure | Result |
|---|---|
| Game pool | 220 prototypes: takeover 24, highlight 7, damaged 181, flesh 2. 208 are casters; 6 side copies |
| Built in | about 29 ms |
| `full` plan items | 1526 → 1788 (+262: 215 pool prototypes and 47 loot highlight copy meshes); casters 1258 → 1461 |
| Warm-up time (Node build speed, no-op GPU) | 19.1 s → 24.1 s (+5.0 s, +26 %); hidden shadow frames 21 → 25. Native timing is not measured here: GPU pipeline creation is asynchronous there and Node's per-build cost is not the browser's |
| Memory | 178 station damage materials made at warm-up instead of at the first hit (one per source and tint, shared with `detach()`); 15 one-triangle extracts (1.5 kB) plus 2 flesh flaps; the rest references live geometry and materials. GPU-side: the extra programs and pipelines, which is the point |
| A/B, half the kinds with no prototypes | 345 new meshes → **69** node builds on first aim, open or detach |
| A/B, the other half prototyped | 343 new meshes → **0** builds |
| A real torn flesh chunk | **0** builds |

Before the per-instance shadow fixes, the prepared half still built 96 variants, almost all shadow variants of
per-part damage clones.

**Loot highlight copies.** `LotDisplay.prepareHighlights()`, called from `runtimeVariantPrototypes`, makes the real
cached highlight copy of every item type allocated in the station. They sit hidden in the containers group (the
`'holders'` pool), so the warm-up and journey compile prepare them. This runs after the station's culler registration
(the #12 rule in `lootDisplay.ts`). In the test, the first aim at a lot builds 0 variants.

Not covered (still cold on first use): shelf-stock pieces knocked loose, a dropped item's pickup (its own material
clones), and anything a subsystem creates without a prototype method. (The first two are covered since task
studio-perf-ao-train-continuity-20261110-022206-01: see "Stutter during ordinary play" below.) Driver-side work, GC and the unexplained 367 ms freeze in the GAME69
recording are outside this pool.

## Horde views: per-frame uniform uploads (task mall-horde-performance-20261105)

**The trace.** The user's GAME71 Mall trace (Chrome / WebGPU / AMD, quality high) dropped to about 30 fps whenever the horde was in
view.

| Metric | Value |
|---|---|
| Render submission (main thread) | 20–27 ms |
| GPU render passes | 7–8 ms |
| AI | ≤ 1.5 ms |
| Culling | ≤ 2 ms |

At the same view and the same draw count (979), submission fell to 7 ms in the frame the horde calmed down. Lured enemies
(`ai/lightLure.ts`) move and animate every frame; across the horde-facing frames, submission tracks the AI span (r 0.88) far more
than the draw count (r 0.31).

**Not three's JS.** Three's own JavaScript does not explain it. In `tests/rendercpu-horde-investigate.test.ts` (env-gated:
`LL_RCPU_HORDE_OUT=…`, the real Mall with the game's enemies and wounds), standing, animated and moving enemies differ by
≤ 1 ms. What changes is the number of `device.queue.writeBuffer` calls per frame:

| Enemies | Writes per frame |
|---|---|
| Hidden | 41 |
| Standing | 242 |
| Moving | 441 |

Three r186 writes every buffer binding in full every frame, per render object and per pass, whether it changed or not. That
covers a skinned draw's bone matrices and the per-object wound data. It also writes changed uniforms as separate ranges (a
moving mesh's model and normal matrices).

**The rule.** `render/uploadDedupe.ts`, installed after `renderer.init()` on the WebGPU backend only, makes two changes. Both are
data-identical, because the CPU array mirrors the GPU buffer.

| Write type | Change |
|---|---|
| Full write | Skipped when its bytes equal the last bytes written to the same GPU buffer |
| A group's changed ranges | One write of their span (≤ 4 KiB) |

Same harness, same views, with the dedupe:

| Enemies | Writes per frame |
|---|---|
| Standing | 242 → 2 |
| Animated in place | 242 → 74 |
| Moving | 441 → 140 (227 → 133 KiB) |

Three's JS time is unchanged. `tests/upload-dedupe.test.ts` renders the same frames on two renderers, one plain and one with the
dedupe, and compares every GPU buffer's bytes after every frame.

**Memory and recorder.**
- The last-write copies are about the size of the buffers they mirror (`uploadStats.snapshotBytes`). They are weakly held per
  binding.
- The recorder's schemaMinor 4 columns `uniformWrites` / `uniformWritesSkipped` show the effect in a native capture.

**Limits.**
- The native cost of an upload is not measurable here, so no FPS gain is claimed. The user's recapture tells.
- Each skinned draw still uploads its own copy of its skeleton's bones in every pass when the pose changed. Sharing one bone
  buffer per skeleton would need a custom skinning node; that was not done.

## Static cohorts and a 120 s budget (task static-batching-warmup-20261105)

**The trace that prompted it.** A GAME72 laptop recording: Intel integrated GPU, Chrome / WebGPU, Subway, render scale 0.4. Its
cost was CPU draw submission, about 2 ms plus 27 µs per draw. 81 % of its missed refreshes came at 450 or more draws. Its warm-up
ended `partial` at 60 s, leaving 37 builds for play.

**Census (`tests/rendercpu-batch-census.test.ts`, env-gated).** The architecture is already one mesh per material per 48 m chunk;
merging plain meshes further within a chunk saves 1–2 draws on three of four levels. What multiplies the draws is the instancing of
repeated static models: every model prop and holder kind was one InstancedMesh per model part per 12–18 m chunk. In the Subway's
busiest view, the ceiling fixture alone was 29 draws.

**The shared rule** (`world/staticCohorts.ts` `planCohorts`). Every builder of repeated static geometry uses it: `chunkInstances`
(model props, p7 props, Office furniture, storefront fittings), the openables and container bodies, and the merged purpose-prop
parts.
- **Cohorts are per level, always.** Before, the Subway and Office holder and purpose batches spanned storeys.
- **Cheap models get 48 m cohorts where the culler doesn't occlusion-cull.** A model is cheap when its instances on a level total at
  most `STATIC_COHORTS.levelTriangles` (20k). The 48 m cohort matches the architecture chunk. This applies on levels without atrium
  or slab occlusion (Subway, Office).
- **Occlusion-culled levels keep their chunks.** On the Mall and Reactor, fine boxes are what that occlusion removes draws with;
  coarser cohorts measured +6 % draws there.
- **Heavy models keep their builder chunks** everywhere.
- **Identity and culling.** Cohorts keep the same instances, matrices, colours, materials, holder slots and damage-index entries, and
  each one carries `userData.level`, so the culler never derives its level from a wide box.

**Measured** (the same harness, worlds and views; Node, no renderer). 48 views per level: the start pose plus 5 enemy spawns, 8 yaws
each. Scene plus torch-shadow draws after the culler, as mean / p90 / max:

| Level | Before | After | Notes |
|---|---|---|---|
| Subway | 304 / 497 / 539 | **292 / 452 / 492** | triangles +7 % |
| Office | 195 / 319 / 366 | **147 / 229 / 278** | triangles −19 %, from the storey split |
| Mall, Reactor | unchanged | unchanged | by the occlusion rule |

Warm-up representatives drop with the batch count: Subway 777 → 696, Office 945 → 912.

**Budget and order** (`render/warmup.ts`).
- **The budget is a 120 s maximum, not a wait.** `WARMUP_DEFAULTS.budgetMs` is the ceiling; the warm-up ends as soon as its work is
  done.
- **Likely first uses go first.** Representatives: the hidden pooled ones (effects, the runtime-variant pool, unshown loot batches),
  then nearest the camera. Shadow frames: casters within torch reach (30 m), then pooled casters, then the rest by distance.
- **The held-item pass always runs.** It still compiles after a budget cut in the materials stage, unless the warm-up was cancelled.
- **The cut is reported.** `WarmupResult.budgetMs` and `cutStage` record it. The performance recorder (schemaMinor 5) puts the full
  recent result on the `recording-start` world segment (`lastWarmup`) and in `environment.warmup`, so a capture started after the load
  can still explain a `partial`.

**Limits.**
- On occlusion-culled levels, repeated models are not batched further.
- Coarse cohorts draw slightly more triangles: Subway +7 %, against GPU headroom in that trace.
- If 120 s still does not cover a slow CPU, the long tail builds on first use as before. The cut is now visible in captures.
- No post-load continuation job: its overdue rule would bring back the periodic forced-step hitches.

## Stutter during ordinary play (task studio-perf-ao-train-continuity-20261110-022206-01, lane PLAY)

The user asked for less stutter. There is no native trace of the current build, so this pass measured the current source in
Node and fixed only what those measurements could attribute. Every number here is a Node figure: three r186's real
`WebGPURenderer` on the no-op device (`tests/helpers/fakeWebgpu.ts`), V8 in Node, a shared pod. None of it is a native frame
time.

**The first-use census.** Every level kind was built the way `Game.buildSection` builds it (Subway 7, Office 4242, Mall t3a,
Market 42, Bunker 9001 on layout v2, Skyways 80, Reactor 9100), with its holders, shelf stock, floor pickups and enemies. The
game's complete `full` warm-up ran first. Then the census counted the node builds, render pipelines and new render objects
that three still created for:
- 16 yaws at the start pose and six enemy spawns spread over the storeys, and a walk between those poses;
- one holder of each openable kind aimed at, opened and shot loose, and one of each other prop kind detached;
- every effect, crater and debris class, and both casing kinds;
- a drop of every item;
- one shelf-filler piece of every moving set knocked loose;
- a flare thrown;
- each enemy type shot, a flesh chunk torn and the body ragdolled;
- a last sweep at the start.

Builds / pipelines that three still made after the warm-up (only rows that were not 0 / 0 everywhere):

| Event | Subway | Office | Mall | Market | Bunker | Skyways | Reactor |
|---|---|---|---|---|---|---|---|
| Turning at 7 poses, before | 0 / 18 | 0 / 14 | 0 / 4 | 0 / 0 | 0 / 14 | 0 / 54 | 0 / 2 |
| Walking between them, before | 0 / 0 | 0 / 6 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 72 | 0 / 0 |
| A drop of every item, before | 20 / 16 | 16 / 3 | 14 / 10 | 45 / 30 | 14 / 10 | 6 / 3 | 29 / 18 |
| Shelf filler knocked loose, before | 67 / 67 | 7 / 7 | 81 / 1 | 13 / 13 | 10 / 10 | 123 / 123 | 19 / 1 |
| Enemy shot / torn / ragdolled, before | 1 / 1 | 0 / 0 | 0 / 0 | – | 0 / 0 | 0 / 0 | 0 / 0 |
| **Every row, after** | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** | **0 / 0** |

The enemy row's one build on the Subway was a shelf-filler set outgrowing its capacity (see 3 below).

**What was cold, and the fixes:**
1. **Glass drawn in two passes.** A transparent DoubleSide material is drawn twice, back faces then front faces. `compileAsync`
   only prepares its DoubleSide state, so the first real view of every glass batch asked for two more pipelines.
   - The loading warm-up now gives such non-caster representatives a hidden frame.
   - The journey preparation draws each one off-screen after its compile, one per step, into the scene pass's own target.
   - Test: `play-stutter-warmup-two-pass.test.ts`.
2. **Pickups that appear in play.** A dropped item, a lot shot off its holder and a stolen ware are each a new object with its own
   material copies (`PickupManager.add`). Unless a pickup with the same material values and geometry layout lay in the station at
   warm-up, its first frame built a node variant.
   - `PickupManager.pickupPrototypes` now offers a pickup of every item to the runtime-variant pool (family `pickup`), built exactly
     as `add()` builds it. The twelve variety weapons stay in their own pool.
   - Per level: 114 meshes are offered and 19 kept after de-duplication.
3. **Shelf filler knocked loose.** A moving piece is drawn by an InstancedMesh per (family, archetype, label). The authored
   filler's sets were made by the first piece of each that moved, and a set that was too small was replaced by a bigger one.
   three gives every InstancedMesh its own node build.
   - `world/shelfStockWarm.ts` `prepareStockMovingSets` now makes every set hidden and empty before the warm-up, through the
     stock's own `frame` (the real factory, material, colours and flags). The sets are the `'shelf-stock-moving'` pool.
   - Each set has room for up to `FILLER_TUNING.maxActive` (64) pieces, the rule the modelled props' sets already follow. A
     set's whole instance buffer is written on every frame it draws, so sets sized for every piece of a big archetype would cost
     a bigger upload while anything of them moves. More than 64 moving or frozen pieces of one set still replace it, as before.
   - Test: `play-stutter-first-use-prototypes.test.ts` (A/B: the prepared half builds 0, the control builds).

**Warm-up cost** (Node build speed, no-op GPU, single runs on a shared pod; "before" is before all three fixes):

| Level | Plan items | Warm-up |
|---|---|---|
| Subway | 1,082 → 1,165 | 18.9 → 20.2 s |
| Office | 1,355 → 1,381 | 22.2 → 23.1 s |
| Mall | 1,660 → 1,767 | 26.4 → 29.6 s |
| Market | 373 → 402 | 6.9 → 7.1 s |
| Bunker | 1,310 → 1,337 | 20.8 → 22.1 s |
| Skyways | 2,170 → 2,334 | 35.6 → 41.4 s |
| Reactor | 1,462 → 1,497 | 23.3 → 23.2 s |

Building the pickup prototypes takes about 50 ms of main thread and preparing the moving sets about 5 ms, once per warm-up.
Both run in `full` mode only.

**Still created on first use** (no node build, no pipeline: the render objects only):
- the meshes a holder takes over when aimed at, opened or shot, and detached prop parts: new render objects per event
  class and level (31 on the Market to 335 on the Mall; one holder or prop of each kind);
- a thrown flare: 6;
- a ragdolled enemy: 2.

A render object exists per object, so a new object needs its own. Not covered by the census rig: Market people and wares
being handled, the fuel cart and its hose, the Bunker's objective objects, the Siren, Strainer and Blightbelly.

**The reverb kernels** (`audio/reverb.ts`, `audio/sfx.ts`). Each room kind's stereo impulse response was built in one go:
- the current room at audio start;
- three others in later timer tasks, one whole kernel each;
- `medium` only when first needed.

Node V8 at 48 kHz, from a cold process: tunnel 45 ms in one task, large 9 ms, small 1.8 ms; warm, tunnel ≈ 10 ms. When the
first gesture entered play, those tasks fell in the first play frames.
- Now `startIR` generates a kernel in slices of at most `IR_SLICE_SAMPLES` (16,384) noise samples: the same loops on the same
  random stream, bit for bit `makeIR`'s buffer (tested on every kind at 44.1 and 48 kHz with any slice sizes).
- From audio start, every kind is pre-generated, the current room first, one slice per timer task (30 ms, then every 16 ms).
- A kind needed before its slices are done is finished at once, as before, and counted (`debugState().ir.sync`). Once every kind
  is ready, a room change only swaps buffers.
- Slices measured PENDING_IR.
- Not measurable here: what the browser does when a buffer is assigned to a `ConvolverNode`.
- Test: `play-stutter-reverb-ir.test.ts`.

**Per-frame allocations** (they feed the periodic collections). The whole `Game` cannot run in Node, so the systems that can were
run on the real Subway, each on its own. V8's sampling heap profiler (collected objects included) measured the bytes per frame:

| System | Bytes / frame | Main sites |
|---|---|---|
| Level culler, turning 3° a frame (a full update every frame) | ~132,000 | ~120,000 in `LevelCuller.update`'s own loop over 1,065 entries; not changed (below) |
| AI step, 23 enemies (`tests/helpers/aiCpuSim.ts`, its own per-frame record included) | ~186,000 | hit volumes rebuilt per enemy (`updateVolumes` / `bonePos` ~32,000), three's animation mixer ~25,000, `Math.hypot` ~24,000, brain / motor / support ~20,000 |
| `ContainerManager.target` + `update` | ~29,000 | `world/containers.ts` `update` / `target` (lane BUILD's file) |
| `PhysicsSystem.update`, idle | ~4,100 | the filler's per-frame entry (`shelfStock.ts` `frame`) |
| `PickupManager.target` ×2 + `update` | PENDING_PICKUP | |
| Effects / Survival / `combineModifiers` | ~110 / ~280 / ~440 | small |
| three's scene + shadow frame | ~2,470,000 with the fake device, of which ~1,960,000 is the fake device itself | three's own: cache keys, bindings, projection, sort |

`Game.update` itself was fixed by reading:
- the frame's eye and look vectors and the unreachable eye are scratch fields;
- the live-enemy count is a loop, not a filtered array twice a frame;
- the enemy cue distance is computed inline instead of a tuple per enemy;
- `PickupManager.target` uses one scratch vector.

Not changed, with the reason:
- **The culler's loop.** The function is TurboFan-optimised and still allocates about 100 bytes per entry per full update, with or
  without inlining. The likely cause is the double-valued `level` field (NaN for multi-level entries) passed to `Set` / `Map` look-ups,
  which boxes it. That is unconfirmed, and the fix would change the entry layout of a much-tested decision path that another lane
  changed in this task.
- **Hit volumes.** Six actor classes rebuild arrays and points every frame. Reusing them needs an audit of every reader that might
  keep a volume across frames.
- **Lane BUILD's files.** `containers.ts` and `shelfStock.ts` belong to lane BUILD.
- **three's own allocations.** Not ours to change without patching three.

**three's submission in our scenes** (Subway sweep, scene pass + torch shadow pass):
- Per frame: about 10.6 ms of three's JavaScript in Node, 452 draws on both passes, 1,216 objects visited per pass.
- World matrices are 7.3 % of the frame. three calls `scene.updateMatrixWorld()` once per pass. The holders root is 539 of the 545
  matrices composed each time; the world root is already static.
- Mitigations tried (interleaved A / B, medians): PENDING_C.

**Limits.**
- Node only, and no native GPU. GPU-side pipeline creation, driver work and GC pause lengths need a native capture.
- The census covers the rig's events, not every play path (see the list above).

## Lifecycle and guarantees

- `Game.prepareGraphics()` is single-flight. It resolves (never rejects) with a `WarmupResult` whose status is one of:
  - `complete`;
  - `partial` (the time budget — a 120 s maximum since task static-batching-warmup-20261105, was 60 s; checked between chunks, a
    running chunk always finishes; `cutStage` says which stage it cut, `reason` repeats it);
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
