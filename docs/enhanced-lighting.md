# Enhanced lighting

Enhanced lighting improves the **existing** load-time station light field and adds **cached local reflections** for
metal and glass (and, at High, a sheen on glazed wall tile). It is one feature with two settings (task
studio-baked-lighting-reflections-20261114-050258-01; applied during play, the tile and column materials and the
per-frame CPU work: task studio-graphics-gpu-materials-toggle-20261114-212239-01):

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
- **No extra flat ambient: the amount of bounced light is the baseline's.** The gather itself is physical, and a pale
  Office floor sends back several times what a dark tunnel does; stored as it is, it simply brightened every pale
  level (measured: +49 % on an Office floor's ceilings). So each level's gathered light is scaled by one factor to
  total what the baseline's fill totals there: `FieldParams.bounce` x the level's direct light. The gather decides
  where that light goes and what colour it is, never how much there is. Measured with the finishes the builder drew
  (seed 93, directly lit surfaces of the main level, against the baseline): Subway floors 0.97x, ceilings 1.04x,
  walls 0.93x to 1.01x; Office floors 0.97x, ceilings 1.06x, walls 1.03x to 1.09x; Mall floors 0.97x, ceilings
  1.10x, walls 1.10x, and its dim areas 0.65x to 0.93x.
- **Flicker circuits.** Each of the three circuits keeps its share of the bounce: when a circuit is off, its
  bounced light is off with it.

How the field stores it (`lightField.ts` `encodeRowEnhanced`):

- The direct light is the baseline's, byte for byte in the direction slices: the gathered light never steers the
  field's one direction. (A first version did, and drew thin bright lines on ceilings wherever the fixtures' own
  directions cancel.)
- The gather keeps a mean and a first moment per voxel. The field's bottom layer is what floors read and its top
  layer what ceilings read, so each stores what that surface receives: the mean plus (minus) twice the moment's
  height part. A floor is not lit by its own bounce; the ceiling above a lit floor gets that floor's bounce and its
  colour. The layers between store the mean.
- The level's scale (above) multiplies all of it; `BakedField.stats.indirectScale` reports it per level.

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
- A cell no probe can walk to takes the probes that reach it across a floor step instead (a track bed below the
  platform its blocks' probes stand on: the same air). Without this the bed and its rails went without a probe
  wherever the block lattice happened to fall that way: 4,953 open cells of Subway seed 93 at High, 16 at Standard;
  now 32 and 0. What is left is walled off from every probe in reach (Mall seed 93: 124 cells at Standard, Office:
  9; at High 0 and 110).
- A probe's weights also go one cell into the solid cells beside its cells, so a fitting set into the wall's own
  cell still reflects the room it faces.
- Each probe has a parallax box, so reflections line up with nearby walls instead of sliding with the camera.

`world/reflectionNode.ts` shows them:

- Only **metal and glass** sample the probes. A material is chosen while its program is built: tagged glazing
  (`render/reflectTag.ts` `tagReflect(material, 'glass')`, or `'window'` for a pane set inside its wall, below), and
  metal candidates (a metalness map or a non-zero metalness). A metal candidate's fragment looks a probe up only when its real metalness is above 0.2 or its
  roughness below 0.45. The station's slab, ceiling and tunnel sets are tagged `none`. Floors, painted walls, wood,
  cloth and characters (skinned meshes) never reflect.
- **Glazed wall tile** is tagged `gloss` and reflects with the **High** probes only. The tile's authored roughness
  map already says a tile face is glazed (0.38 to 0.42); the material scales it by 0.7 (`TILE_GLAZE_ROUGHNESS`, in
  every lighting mode, so the lights' own highlights are tighter too). With High a tile face shows the station by
  its Fresnel term: faint face-on, clear at a grazing angle. The weight is 1 up to roughness 0.45 and fades to 0 at
  0.6, so grout and grime do not reflect, and no probe is looked up where the weight is nothing. At Standard the
  weight is 0 everywhere: a wall costs no probe lookup. Both tiers use the same program (the tier is a uniform), so
  changing between them compiles nothing.
- The station **columns** are clad in the existing brushed-steel set (`WorldMaterials` `'pillar'`:
  metalness 0.65, roughness 0.7 x the set's map, normal strength 1.3) instead of the charcoal trim paint, which read
  as a black slab. They are metal candidates: with probes they show the lit station and its fixtures. The
  station's baked light is diffuse only, so a pure metal would be black wherever no probe is in use; the diffuse
  part that is left keeps the cladding a grey brushed metal there (Enhanced lighting Off, Reflections Off, the
  renderers Auto leaves reflections off on).
- three's physical lighting model does the rest: Fresnel, the roughness and metalness response, a metal's base colour.
- A probe's light is scaled by the baked field's light at the surface (capped). Reflections dim with a flicker
  circuit, in a passing train's shadow and in a dark side room.
- A tower window's glass sits 0.28 m **inside** its wall's own cell. The field there is the wall's: no light in its
  texel, and a column that belongs to whichever storey is open at that cell (the lobby level, under an upper
  storey's outer wall). Read at its own place, a pane got a fifth of the room's light (median 0.20x over the 252
  window spans of Office seed 93), and at 40 of 756 sampled points another storey's probes. So those panes carry
  their own tag, `window`: the reflection reads the field and names the probes **one cell out along the normal**,
  in the room the pane is seen from (0.90x the room's light, the right storey at every point). It costs one more
  field sample on those panes only; the pane's own diffuse shading is untouched.
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
skips reflections on a software renderer (On forces them)", or the Reactor). A changed setting is applied to the
live station from the pause menu (below); until it is, the status says the change is pending.

URL overrides for one session: `?lighting=off|auto|on`, `?reflections=off|standard|high`.

## Changing the settings during play

A changed Enhanced lighting or Reflections choice is applied to the station the player is in
(`Game.relightAfterSettings`): at once when it is made in the pause menu, else the next time the game is paused (a
choice that changes while playing, for example from another tab, waits; the status says "Not applied yet"). No main
menu, Continue, station load or reroll is involved.

- Only the station's **lighting** is rebuilt: the field bake of the new choice (from the derived cache when this
  layout's entry matches, else baked now in the same paced steps, under the pause menu), then one step that swaps
  the station lighting (`StationLighting.replaceSteps`: the flicker clock, the circuit levels and the fixtures
  carry over; the fog keeps its maps, gas, smoke and clock and only gets the new field).
- A changed light set compiles every lit material again, so the same **blocking warm-up** as a quality change
  follows. No frame is drawn meanwhile. **Resume**, the two choices and the quality choice are held, and the pause
  line says what is being done ("Rebuilding this station's lighting: bounced light…", "…: reflections…", then the
  warm-up's own progress). A new game, Continue, Retry and travel wait for it, as for any warm-up.
- The world, its seed and random stream, enemies, loot, identities, the player, the inventory and the save are not
  touched. The replaced field and probe textures are released after the warm-up; render objects that outlive the
  swap re-read their texture bindings (`render/bindingRefresh.ts`).
- The status says `applying` while it runs and the new live state afterwards. If the bake or the install fails:
  "The change could not be applied (reason): the station keeps this lighting." A failure after the swap leaves the
  baseline lighting, and the status says baseline. A failed plan is not retried until the choice changes again.
- A lost device or a station replaced meanwhile ends the rebuild without touching the new station.
- Switching Reflections between Standard and High with a cached bake is the cheapest change (the probes only); Off
  to On is the most expensive (the high bake, the probes and every lit program).

## The derived cache

Baked results are stored outside the save, in IndexedDB (`core/derivedCache.ts`, database
`terminal-state.derived.v1`): at most 48 entries or 96 MiB, least recently used evicted first, compressed where the
browser has `CompressionStream`. One entry per station and settings combination holds the gathered light and, when
probes were baked, the probe atlas, grid and metadata. Stored sizes measured in Firefox (seed 93, compressed):
Subway 5.2 MB without reflections, 6.4 MB with Standard, 9.1 MB with High; Office 4.3 / 5.2 MB; Mall 3.9 / 4.9 MB.

**Keys.** An entry is found by an **address**: a content hash (`core/contentHash.ts`) of the realized layout (every
level's cells, floor and ceiling heights, sight blockers, ramps), the fixtures, the bake parameters, the tier names
and the data versions. It is never the seed alone.

**Validation.** An entry is only **used** when the digest of the real inputs matches the digest stored with it:

- for the gathered light: the tier's numbers, the column geometry, the direct light the bake just made (so every
  fixture, tint, power and flicker state), and the surface colours the builder really drew;
- for the probes: all of the above, the final field's bytes, the fixtures and the reflection tier.

So the cache cannot serve stale lighting after a generator, material, fixture or parameter change: the address finds
an entry, the digest decides. A mismatch is reported as "baked again" and the entry is replaced. Changing the gather
or probe code itself needs a version bump (`DERIVED_LIGHTING_VERSIONS` in `world/enhancedLightingRuntime.ts`). The
versions are part of the address, so a bump is a full miss for every station: both parts are baked again, and the
old entries are never read again and leave by eviction.

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
- A changed choice in the pause menu rebuilds the live station's lighting in place (*Changing the settings during
  play*).

## Costs

GPU memory of the reflections for one station (atlas RGBA16F + grid RGBA8 + a small float metadata texture); the
enhanced field itself adds none:

| Station (seed 93) | Standard | High |
|---|---|---|
| Subway | 187 probes, 5.7 MiB | 210 probes, 16.7 MiB |
| Office | 155 probes, 6.1 MiB | not measured |
| Mall | 178 probes, 4.7 MiB | not measured |

Main-thread bake time of the lighting step, measured in **Firefox 158 on the studio pod** (one run each, in a
private harness page of the game's own modules; a shared server CPU, not a player's machine). The bake is CPU work,
so the software renderer of that pod does not change it:

| Station (seed 93) | Auto (Standard bake, no reflections) | On + Standard reflections | On + High reflections | cache hit |
|---|---|---|---|---|
| Subway | 1.0 s (gather 0.5 s) | 2.9 s (gather 2.2 s, probes 0.2 s) | 3.6 s (probes 0.7 s) | 0.5 s |
| Office | not measured | 2.8 s (gather 1.8 s, probes 0.2 s) | not measured | 0.8 s |
| Mall | not measured | 2.3 s (gather 1.5 s, probes 0.2 s) | not measured | 0.7 s |

A cache hit is the unchanged direct bake plus about 0.1 s of hashing: what Off costs, nearly. In Node on the same pod
the same bakes took: Subway seed 4242 Off about 0.6 s, Auto 1.4 to 1.7 s, On + High reflections about 4.7 s. The
work is cut into paced build steps of a few milliseconds (the longest enhanced step measured in Node was about
35 ms; the unchanged direct bake has steps of 35 to 60 ms).

Frame cost: the enhanced field has none (same texture, same shader). A reflective fragment adds one filtered and
one unfiltered grid fetch, and per probe that weighs in (one in a block's core, up to four at a corner) three
texel loads and two atlas samples; a tower window pane also samples the field a second time. A glazed tile
fragment pays the same per probe, at High only.

Main-thread cost per frame. One real-player recording exists (Chrome 157, WebGPU on an AMD RDNA4 card, 3456 x 1944,
Skyways, On + High, 120 s): the main thread was the limit, not the GPU: about 16 ms of CPU a frame, 14 ms of it in
the draw submit, against about 7 ms of GPU time. The bake was not part of it (3.3 s, once, at the load). Two causes
found from it were this feature's and are fixed:

- three r186 gives every `.load()` / `.sample()` of a uv-less texture node its own uv-transform matrix: a mat3
  uniform, a multiply in the shader and an update per object, per pass, per frame. The probe table is fetched 48
  times in a reflecting material; with the decay and light-occlusion lookups that was about 27 such updates per drawn
  object on average. `render/textureFetch.ts` makes those lookups without the matrix (these textures are never
  transformed). In the real Game in Node (Skyways, On + High, the same resolution, a no-op device; the same script
  on the code before and after) the per-object texture updates fell from about 28 to about 3 per drawn object, and
  in a CPU profile of 240 frames three's per-object node updates from 3.0 to 2.2 ms a frame (the texture updates
  in it from 0.74 to 0.16 ms), which is what Off spends there (2.0 to 2.2 ms). Off itself is unchanged within the
  spread between two runs. On WebGL2 a lookup keeps its per-object update (three's flip-Y uniform there); the mat3
  and its multiply go on both.
- three keeps a flat copy of the shader text on every node-builder state. After a load that was 134 M characters
  for 23 M distinct ones, about 118 MB of duplicate strings in the JS heap that every full garbage collection had
  to walk. `render/shaderTextShare.ts` points the states at the program maps' own strings. With both changes the
  live JS heap in the same runs fell from about 540 to about 320 MB (On + High) and from about 420 to about 270 MB
  (Off).

Node numbers are relative (a no-op device has no driver or GPU-process cost): they say the work is gone, not what
frame rate a player's machine reaches. The whole frame's time in those runs moved less than it differs between two
runs of the same code (what is in view differs), so no frame-time gain is claimed from them. What is left of the
submit is three's per-object refresh, spread about evenly over its change checks, its uniform groups, its bindings
and the node updates (most of those are the uniforms of the pooled lights), with no single cost standing out.
`docs/performance-recorder.md` explains how to record the frame rate on a real machine; the recorder's environment
block includes the lighting status.

Shader bindings: a reflective material binds three more sampled textures and no uniform buffer more. In the real
game on the validating WebGPU device, the worst shader stage of a Market station with reflections had 12 uniform
buffers (the fog march, unchanged), 12 sampled textures and 11 samplers (a glazed tile or a column: its own maps
plus the three); WebGPU's default limits are 12 / 16 / 16 (`game/tests/enhanced-lighting-game.test.ts` asserts
this for every compiled module).

## Known limits

- Glass inside a prop's model is not tagged: a see-through pane there does not reflect (a part with metalness
  does, as metal).
- A `virtual` light source (one with no tube) is not drawn into a probe; its light on the surfaces is.
- Metal set inside a wall's own cell (window frames and mullions, a shutter) reads the field of that cell like any
  surface there: its reflection is dimmer than the room's, and under an upper storey's outer wall it can be the
  storey below's. Only the panes read a cell out.
- Open cells walled off from every probe in reach get no reflection (the counts above).
- A cell that takes a probe across a floor step is scaled by its own light against the probe's place, like every
  reflection. A dark track bed under a platform probe therefore reflects little: in Subway seed 93 the rails in
  view gain less at High (their probes stand on the platform) than at Standard (their probes stand in the bed),
  and next to nothing at either. More probes at High do not make every surface reflect more.
- Travelling between a station with probes and one without (the Reactor, or reflections unavailable) recompiles
  once the materials of what outlives a station (the held weapon, the parked car): the scene's field light is
  the other one.
- Glazed tile reflects at High only, and a dielectric's reflection is faint face-on by its physics: the sheen
  shows along a wall, not on the tile in front of the player.
- A column is as dark as what it mirrors: facing an unlit stretch of the station it is a dark steel, not a bright
  one. Without probes it only has its diffuse part and the nearby lights' own highlights.
- The frame-cost fixes are measured in Node and not yet on a real GPU (see Costs). Every picture of this feature
  comes from software rasterizers.
- What the recording showed and this does not change: three refreshes every drawn object's uniforms every frame
  (about 90 update nodes per object after the fix, most of them the pooled lights'), and programs first needed
  during play are built on the main thread when the background compile is starved by frames that are already over
  budget.

## Tests

- `game/tests/light-gather.test.ts`: occlusion, colour, energy, flicker shares, determinism, no movable props.
- `game/tests/reflection-probes.test.ts`: placement, weights (walked, across a floor step, into the wall's cell),
  capture, fixtures, levels, the atlas.
- `game/tests/reflection-node.test.ts`: which materials reflect (metal, glass, window, gloss), both shader backends,
  binding counts, the High-tier tile weight, the lookup.
- `game/tests/texture-fetch.test.ts`, `game/tests/shader-text-share.test.ts`: the two per-frame / heap fixes.
- `game/tests/station-pillar-material.test.ts`: the columns' material on a Subway station and the Office's station
  storey.
- `game/tests/lighting-live-apply.test.ts`: the real Game on a validating WebGPU device: a change applied from the
  pause menu (only the lighting rebuilt, the station and the save conserved, the status, a failed bake).
- `game/tests/reflection-window.test.ts`: every window span of a generated Office: the slot, light and probes a
  pane reads, against the plain glass rule.
- `game/tests/enhanced-lighting-policy.test.ts`: what Off / Auto / On plan for each kind of renderer, the reasons,
  the texture-size fallbacks, the bounded tiers.
- `game/tests/enhanced-lighting-runtime.test.ts`: Off / Reactor, miss / hit / stale / cleared / unavailable, what
  the bake may never touch, capabilities and reasons, the station lighting with and without probes.
- `game/tests/enhanced-lighting-game.test.ts`: the real Game on a validating WebGPU device: binding limits, death
  and reload, Off and back.
- `game/tests/enhanced-lighting-settings.test.ts`: the settings, their form rows (applying / failed / pending), the
  cache line and diagnostics.
- `game/tests/content-hash.test.ts`, `game/tests/derived-cache.test.ts`: the hash and the cache.
