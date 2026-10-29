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

## What needs registration (`game.warmRegistry`, a `WarmupRegistry`)

| You add… | Do this | Example in the code |
|---|---|---|
| A **new render pass** that draws objects with its own scene / camera / render target | `warmRegistry.addPass({name, scene, camera, target: () => rt, hidden?: () => roots})` | the viewmodel overlay (`'weapons and held items'`) |
| **Effects hidden until first use** (pools with `visible = false`) | keep them under a registered pool root: `warmRegistry.addPool(name, () => [root])`. The default `'effects'` pool is `fx.group`, so new effects added there are covered | sparks, smoke, blood, tracers, decals |
| Something **created on use** (thrown, spawned, attached later) | build a hidden **prototype** with the same factory, keep it in the scene (meshes hidden, `raycast` disabled, far away), and register it as a pool | `FlareSystem.warmPrototypes()` (`'flares'`) |
| Content **added mid-play** that no pool or prototype covers | add it hidden, `await game.prepareBeforeShow(root)`, then show it | (contract only; nothing does this yet) |
| A **shader-affecting configuration change** (quality, MSAA, render targets, light set) | call the warm-up again before control returns (`game.rewarmAfterSettings()` / `prepareGraphics()`) | the pause menu's Quality setting |

### Rules

- **Never** compile into a different render target, camera or scene than the one that will draw the object. three
  keys node builds and pipelines by the render context, so a "warm" pipeline in the wrong context is a second cold one.
- Pool roots must be **in the station scene**. A pool's hidden objects are made visible only for the duration of a
  `compileAsync` call, which draws nothing.
- Lights: change only `intensity`. Adding or removing lights, or toggling `light.visible`, changes three's light set,
  and then every lit material rebuilds.
- The warm-up must not touch gameplay: no update tick, no timers, no sounds, no simulated firing or throwing.

## Lifecycle and guarantees

- `Game.prepareGraphics()` is single-flight. It resolves (never rejects) with a `WarmupResult` whose status is one of:
  - `complete`;
  - `partial` (60 s budget; checked between chunks, and a running chunk always finishes);
  - `cancelled` (station replaced or device lost);
  - `failed`;
  - `skipped` (`?warmup=off`).
- "Enter station" is enabled and the loading text says *Ready* only after it resolves. A partial or failed result says
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
