# Enhanced lighting

Enhanced lighting improves the **existing** load-time station light field and adds **cached local reflections** for
metal and glass. It is one feature with two settings (task studio-baked-lighting-reflections-20261114-050258-01):

- **Enhanced lighting**: Off / Auto / On (default **Auto**).
- **Reflections**: Standard / High / Off (default **Standard**; needs Enhanced lighting).

Off is the baseline exactly as before: the same bake, the same shader programs, no extra texture, and the cache is
never opened. The Reactor always uses the baseline, whatever the settings say.

Out of scope, on purpose: live mirrors, screen-space reflections, reflections of characters or other moving things,
mirror floors, and any change to the Reactor.

## What it does

### 1. The same light field, baked better

The station light field (`game/src/world/lightField.ts`) is unchanged in format, shader, fog path and GPU memory. Its
direct light is baked exactly as before. Only the **indirect** part differs:

- Baseline: a heuristic fill (`bounce` x a mix of one area's mean light and a local blur).
- Enhanced: a **ray gather** (`world/lightFieldGather.ts`). Every voxel of the field casts rays over the station's
  fixed architecture (`world/lightScene.ts`: the field's own floors, ceilings and wall faces) and collects the light
  those surfaces send back, over several bounces.

What that changes in the picture:

- **Architectural occlusion.** Bounced light does not pass walls. It fades round corners, and an alcove that hides
  from every lit surface stays dark. The baseline fill gave one area the same fill everywhere.
- **Material colour.** A surface sends back its own colour: `world/surfaceAlbedo.ts` reads what the builder really
  drew (`BuiltWorld.drawn`: every floor / ceiling rect and wall face with its finish), so a red quarry-tile floor
  warms the wall above it and a dark tunnel returns little.
- **No extra flat ambient.** The gather returns only what the surfaces send back (gain 1). A generated Subway
  station's mean light stays within a few percent of the baseline; the light is redistributed, not added.
- **Flicker circuits.** Each of the three circuits keeps its share of the bounce: when a circuit is off, its
  bounced light is off with it.

Nothing movable is in the ray scene: no prop, door leaf, character or train. A cell that holds a sight-blocking prop
is open space to the gather. So nothing that can move, break or leave is frozen into the bounced light.

The enhanced bake costs **load time only**. It adds no frame time and no GPU memory.

### 2. Reflection probes for metal and glass

`world/reflectionProbes.ts` bakes small environment maps of the **actual generated station** on the CPU:

- Probes sit on a block lattice per level (about 9 m apart at Standard, 7 m at High; the block grows until the
  station fits the tier's probe limit). Each probe is ray-cast from the same fixed architecture, lit by the
  **final baked field** (what you see is what reflects), with the working light fixtures drawn in as bright tubes.
- Each probe is stored as four octahedral maps, sharp to blurred, for the roughness response.
- A per-cell grid holds up to four probe weights and ids. Weights ramp across block borders (a continuous blend, no
  popping) and are zero where a probe cannot reach by walking inside its block: no reflection of the room behind a
  wall.
- Each probe has a parallax box, so reflections line up with nearby walls instead of sliding with the camera.

`world/reflectionNode.ts` shows them:

- Only **metal and glass** sample the probes. A material is chosen while its program is built: tagged glazing
  (`render/reflectTag.ts` `tagReflect(material, 'glass')`), and metal candidates (a metalness map or a non-zero
  metalness). A metal candidate's fragment looks a probe up only when its real metalness is above 0.2 or its
  roughness below 0.45. The station's tile, slab and ceiling sets are tagged `none`. Floors, walls, wood, cloth and
  characters (skinned meshes) never reflect.
- three's physical lighting model does the rest: Fresnel, the roughness and metalness response, a metal's base colour.
- A probe's light is scaled by the baked field's light at the surface (capped). Reflections dim with a flicker
  circuit, in a passing train's shadow and in a dark side room.
- A station with probes uses a second, session-wide field light (`LightFieldReflectLight`). A station without
  probes keeps the plain one, so with reflections off every material compiles to exactly the program it always had.

Like the gather, a probe holds no prop, door, character or train.

## Off / Auto / On

`world/enhancedLighting.ts` holds the policy (`planEnhancedLighting`); it is a pure function of the two settings, the
renderer's real capabilities and the level.

| Setting | Field bake | Reflections |
|---|---|---|
| **Off** | baseline | none |
| **Auto** (default) | enhanced, `standard` tier: 16 rays per gathering voxel on a 1 m lattice, 3 bounces | the chosen quality on the **hardware WebGPU** backend when its limits fit the probe textures; none on the WebGL 2 fallback or a software renderer |
| **On** | enhanced, `high` tier: 32 rays in every cell, 3 bounces (a longer first load) | the chosen quality on any renderer that can run them, also a software one |

Reflection quality: **Standard** = 32 px probe maps, at most 192 probes. **High** = 64 px, at most 240 probes (about
four times the atlas memory). If High needs a larger texture than the renderer allows, Standard is used and the
status says so.

What Auto reads, and what it never reads:

- It reads the backend that actually started (WebGPU or the WebGL 2 fallback), whether it is a software rasterizer
  (`render/softwareGl.ts`), and the backend's own largest 2D / 3D texture sizes.
- Auto leaves reflections off on the WebGL 2 fallback and on software renderers because their frame budget is the
  unknown one, not because they cannot run them: On enables them there. Auto's bake is on everywhere (it costs load
  time only).
- A browser does **not** expose total or free video memory. `navigator.deviceMemory` and adapter limits prove
  nothing about it, so nothing here reads them, and no minimum amount of video memory is claimed. The feature's own
  GPU memory is small and bounded instead: the reflection textures of one station (see Costs).

The status is always the truth about the **live** station: the settings form's help lines, the perf overlay's
**Lighting** row, the performance recorder's environment and `__LL.lighting()` say what it was built with, where the
data came from (cache hit / baked now / baked again) and why something asked for is not in use (for example "Auto
skips reflections on a software renderer (On forces them)", or the Reactor). A changed setting applies when a
station next loads; until then the status says a change is pending.

URL overrides for one session: `?lighting=off|auto|on`, `?reflections=off|standard|high`.

## The derived cache

Baked results are stored outside the save, in IndexedDB (`core/derivedCache.ts`, database
`terminal-state.derived.v1`): at most 48 entries or 96 MiB, least recently used evicted first, compressed where the
browser has `CompressionStream`. One entry per station and settings combination holds the gathered light and, when
probes were baked, the probe atlas, grid and metadata.

**Keys.** An entry is found by an **address**: a content hash (`core/contentHash.ts`) of the realized layout (every
level's cells, floor and ceiling heights, sight blockers, ramps), the fixtures, the bake parameters, the tier names
and the data versions. It is never the seed alone.

**Validation.** An entry is only **used** when the digest of the real inputs matches the digest stored with it:

- for the gathered light: the tier's numbers, the column geometry, the direct light the bake just made (so every
  fixture, tint, power and flicker state), and the surface colours the builder really drew;
- for the probes: all of the above, the final field's bytes, the fixtures and the reflection tier.

So the cache cannot serve stale lighting after a generator, material, fixture or parameter change: the address finds
an entry, the digest decides. A mismatch is reported as "baked again" and the entry is replaced. Changing the gather
or probe code itself needs a version bump (`DERIVED_LIGHTING_VERSIONS` in `world/enhancedLightingRuntime.ts`).

**What it can never do.** The cache holds derived data only. Nothing in it is read by the generator, the save or the
campaign. A hit, a miss, a cleared cache, a full disk or a browser without IndexedDB (the cache then lives in memory
for the session, and the status says so) give the same station, loot, identities, cargo and travel: only the load
time differs. The settings form shows the cache's size and has a **Clear lighting cache** button.

## Lifecycle

- `Game.prepareSection` (behind the loading screen, or during the ride): `EnhancedLightingRuntime.prefetch` hashes
  the address in pieces and reads the entry.
- `Game.buildSectionSteps`, step `lighting`: `EnhancedLightingRuntime.bakeSteps` runs in the same paced build steps
  as the baseline bake (`core/pacedBuild.ts`), then `StationLighting.steps` gets the field and the probes.
- A station swap (travel, Retry, Load last save, Continue) binds the new station's textures first and retires the
  old ones afterwards, like the light field. A changed probe texture makes every render object re-read its texture
  bindings (`render/bindingRefresh.ts`), so parts that outlive the station (the parked car, the held weapon) follow.
- Off and the Reactor return nothing from `bakeSteps`; `StationLighting` then bakes the baseline as before.

## Costs

GPU memory of the reflections for one station (atlas RGBA16F + grid RGBA8 + a small float metadata texture); the
enhanced field itself adds none:

| Station (seed 4242, Node bake) | Standard | High |
|---|---|---|
| Subway | 168 probes, 5.1 MiB | 228 probes, 17.4 MiB |
| Office | 155 probes, 6.7 MiB | — |
| Mall | 184 probes, 4.7 MiB | — |

Main-thread bake time measured in **Node on the studio pod** (one core, not a browser, not a player's machine;
the whole lighting step including the unchanged direct bake):

| Station | Off (baseline) | Auto / Standard, first load | On + High reflections, first load | cache hit |
|---|---|---|---|---|
| Subway 4242 | about 0.6 s | about 1.4-1.7 s (gather 0.65 s, probes 0.2-0.3 s) | about 4.7 s (gather 3.2 s, probes 1.0 s) | baseline + about 0.1 s of hashing |
| Office 4242 | about 0.7 s | about 1.8 s | — | — |
| Mall 4242 | about 0.7 s | about 1.5 s | — | — |

Frame cost: the enhanced field has none (same texture, same shader). A reflective fragment adds one filtered and
one unfiltered grid fetch, and per probe that weighs in (one in a block's core, up to four at a corner) three
texel loads and two atlas samples. Its frame-time cost on a real GPU has **not** been measured: the studio pod only
has software rasterizers. `docs/performance-recorder.md` explains how to record it on a real machine; the recorder's
environment block includes the lighting status.

Shader bindings: a reflective material binds three more sampled textures and no uniform buffer more. In the real
game on the validating WebGPU device, the worst shader stage of a Market station with reflections had 12 uniform
buffers (the fog march, unchanged), 10 sampled textures and 9 samplers; WebGPU's default limits are 12 / 16 / 16
(`game/tests/enhanced-lighting-game.test.ts` asserts this for every compiled module).

## Tests

- `game/tests/light-gather.test.ts`: occlusion, colour, energy, flicker shares, determinism, no movable props.
- `game/tests/reflection-probes.test.ts`: placement, weights, capture, fixtures, levels, the atlas.
- `game/tests/reflection-node.test.ts`: which materials reflect, both shader backends, binding counts, the lookup.
- `game/tests/enhanced-lighting-policy.test.ts`: what Off / Auto / On plan for each kind of renderer, the reasons,
  the texture-size fallbacks, the bounded tiers.
- `game/tests/enhanced-lighting-runtime.test.ts`: Off / Reactor, miss / hit / stale / cleared / unavailable, what
  the bake may never touch, capabilities and reasons, the station lighting with and without probes.
- `game/tests/enhanced-lighting-game.test.ts`: the real Game on a validating WebGPU device: binding limits, death
  and reload, Off and back.
- `game/tests/enhanced-lighting-settings.test.ts`: the settings, their form rows, the cache line and diagnostics.
- `game/tests/content-hash.test.ts`, `game/tests/derived-cache.test.ts`: the hash and the cache.
