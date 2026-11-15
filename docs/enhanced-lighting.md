# Enhanced lighting

Enhanced lighting replaces the station's flat bounce fill with **baked bounce light that has a direction and a
colour**, lets the **flashlight's beam light its surroundings**, and gives metal, glazed tile and glass **reflections
of the real station**, with a **live mirror image in the glass the player faces**. It is one feature with two
settings:

- **Enhanced lighting**: Off / Auto / On (default **Auto**).
- **Reflections**: Standard / High / Off (default **Standard**; needs Enhanced lighting).

Off is the baseline exactly as before: the same bake, the same shader programs, no extra texture, no mirror draw, and
the cache is never opened. The Reactor always uses the baseline, whatever the settings say.

History: the settings, the probes and the derived cache come from task
studio-baked-lighting-reflections-20261114-050258-01; applying a change during play, the tile and column materials
and the per-frame CPU fixes from task studio-graphics-gpu-materials-toggle-20261114-212239-01. That version kept the
baseline's amount of bounced light and looked like Off in play. Task studio-baked-gi-visual-uplift-20261115-004324-01
rebuilt the lighting itself: the ambient cube, the flashlight's bounce and the glass mirror below.

## What it does

### 1. Baked bounce light with a direction: the ambient cube

The station light field (`game/src/world/lightField.ts`) still bakes its direct light exactly as before. The
**indirect** part is a **ray gather** (`world/lightFieldGather.ts`): every voxel of the field casts rays over the
station's fixed architecture (`world/lightScene.ts`: the field's own floors, ceilings and wall faces) and collects
the light those surfaces send back, over three bounces.

- **Occlusion.** Bounced light does not pass walls. It fades round corners, a room lit through its door is lit from
  the door, and an alcove that hides from every lit surface stays dark.
- **Material colour.** A surface sends back its own colour: `world/surfaceAlbedo.ts` reads what the builder really
  drew (`BuiltWorld.drawn`: every floor / ceiling rect and wall face with its finish). A red quarry-tile floor tints
  the white tile and the counter fronts beside it; dark ballast returns almost nothing.
- **Direction.** The gathered light is kept per voxel as an **ambient cube**: what a surface facing up, down and
  each of the four wall directions receives there. A ceiling over a lit floor is lit by that floor, a floor is not
  lit by itself, and the side of a column that faces a bright wall is brighter than the side that faces a dark
  tunnel. The earlier version kept one mean per voxel, which is half of why it looked like the baseline.
- **Flicker circuits.** Each of the three circuits keeps its share of the bounce: when a circuit is off, its bounced
  light is off with it.

**The bounce is drawn stronger than the finishes strictly give, and that is a stated choice.** Measured on the base
Subway (seed 93), the station's dark, grimy finishes (floors 0.21 to 0.26, concrete walls about 0.15) send back
about a seventh of the light that falls on them: 0.11 to 0.16 against about 0.96 of direct light on a floor. That is
the size of the baseline's fill, so a physically exact bounce reads like Off, which is what the player reported.

The first version multiplied the whole gather by 2.5, whatever the finish. A white-tiled room then sent back more
light than fell on it and every ceiling over a lit floor was lifted to a flat mid grey: the player found parts of
the world "too bright and less moody". The strength is now a **response of the finish** (`bounceReflectance`,
`GATHER_RESPONSE`: lift 2.2, ceiling 0.7 in `world/lightFieldGather.ts`): the bounce takes a finish of reflectance
`rho` to reflect `ceiling x (1 - exp(-lift x rho / ceiling))`.

| finish as drawn | 0.05 | 0.15 (concrete) | 0.26 (floor) | 0.40 | 0.60 (white tile) | 0.80 |
| --- | --- | --- | --- | --- | --- | --- |
| what the bounce takes it for | 0.10 | 0.26 | 0.39 | 0.50 | 0.59 | 0.64 |

A dark finish bounces up to 2.2 times what it strictly would, a pale one levels off, and none reaches 0.7: no room
returns more light than it receives, however many bounces are followed. `GATHER_GAIN`, the scale of the whole
gather, is 1, and the surface colours still get a little more chroma (`GATHER_SATURATION` = 1.25). The hue of a
finish is kept. This changes **the bounce alone**, with all of its occlusion, direction and colour: the direct
light, the hemisphere light and every place without a lit surface nearby are untouched. It is not a flat brightness
change and adds no light of its own. Enhanced lighting Off is not touched by it at all.

Measured on Subway seed 93 (mean irradiance on the main level, baseline to enhanced): floors 0.96 to 1.02, ceilings
0.43 to 0.56, walls 0.32 to 0.40 (the first version: 1.14, 0.74, 0.55). On the other levels (seed 93): ceilings 1.2x
to 1.8x, walls 1.1x to 1.4x, floors 1.0x to 1.07x of the baseline (the first version: ceilings 1.5x to 3.3x, walls
1.3x to 2.4x, floors 1.07x to 1.33x); no value above the field's range anywhere (`BakedField.stats.cubeClipped` =
0). The numbers are part of the derived cache's gather digest, so a station baked with the first version is baked
again once.

How the field stores it (`lightField.ts` `encodeRowEnhanced`, `world/lightFieldNode.ts`):

- The main texels (direct light, its one direction, the fog's light) are the baseline's, byte for byte.
- The cube lives in **extra slices of the same 3D texture** (`BakedField.gi`): per level slot, six faces, four height
  layers. A cube texel holds the **complete ambient** of a surface facing that way: the direct light's scattered
  share plus the gathered face, encoded exactly like a main texel. Storing the whole value (not a difference to the
  main texel) keeps the filtered lookup accurate between two height layers: about 2 % mean error at mid-gap on
  Subway seed 93 (`game/tests/light-field-cube.test.ts` pins a bound).
- **Full shading** (the full field light, `LightFieldLight(full)`): the ambient of a lit pixel is the cube sampled by
  the surface normal, `sum n_a^2 x face(sign n_a)`: three more filtered fetches of the same texture, no new binding.
  The directional part is unchanged.
- **Plain shading** is the baseline's light node on the enhanced field: the cube is left off the GPU. It costs no
  frame time and shows the gather only through the main texels' mean.

Nothing movable is in the ray scene: no prop, door leaf, character or train. A cell that holds a sight-blocking prop
is open space to the gather. So nothing that can move, break or leave is frozen into the bounced light.

### 2. The flashlight's bounce, live

Most of a base Subway station is dark and lit by the flashlight alone, so baked light changes nothing there. With
full shading the beam also lights its surroundings (`world/flashBounce.ts`):

- **Thirty rays of equal flux.** Each frame the beam is cast on the CPU as 30 rays, each standing for a thirtieth of
  the cone's flux, in six sectors of five (a cap round the axis and five wedges). The rays are spread so that
  every strip across the beam holds its share of them: a pole or a wall's edge crossing the beam takes the rays one
  at a time and never more than its share.
- **What stops a ray** is the nearest of the station's fixed architecture, a **prop's box** (the boxes bullets
  hit, read live each frame: a prop that is carried off, broken or melted stops nothing any more) and a living,
  standing **character** (an upright cylinder; the nearest 32 within the light's 30 m). **Glass passes**: shopfront
  glazing, the hockey store's boards above 1.1 m, the player train's windows (and the whole car while it moves) and
  the Bunker ward's glazed cubicles (`world/flashOccluders.ts`). So a locker, a column or an enemy close up takes
  the bounce itself; none of it lands on the wall behind.
- **A light stands on a plane.** Inside a sector the hits are grouped by plane. The sector's **virtual light**
  stands on the plane most of them hit, at their centre, with that surface's colour and the flux the game's own
  spot light puts on them. It is **as large as its rays' footprints** (`FLASH_BOUNCE_TUNING.soft` = 1), so a wall
  lit from 8 m is a patch about 1.5 m across, not a point: right in front of it the bounce is a little under the
  wall's own brightness times the gain, at any distance. A ray on another plane gives its flux to a neighbouring
  sector's light on that plane, or to one of **eight extra lights** that stand on the planes no sector's light
  stands on (a prop in a corner of the beam, the strip of ceiling at its edge). Flux never moves to a plane it
  did not land on.
- **In time** a light glides only along its own plane, and its flux follows over about 70 ms. When a sector's rays
  move to another plane its light stays on the old plane and fades there, and the light on the new plane rises
  from nothing (or changes places with that plane's extra light). Nothing travels through the air between two
  surfaces, and a frame changes the total by its share of the way to the new place and no more.
- The GPU adds the fourteen lights' sum to the full field light's irradiance: arithmetic on 43 plain uniforms, no
  texture, no array and no uniform buffer of its own. A dark room is softly lit outside the beam; a red tile wall
  throws warm light on the floor beside it.
- On metal, glass and glazed tile the lit patches also show as a soft sheen round the mirror direction
  (`FLASH_BOUNCE_SHEEN`), weighed by three's own Fresnel and roughness response like the probes.
- The gain is 2 (`FLASH_BOUNCE_DEFAULTS.gain`): stylised like the baked bounce, and for the same reason.

Limits, by design:

1. Virtual lights cast **no shadows**. Their light is not stopped by a wall, a slab or a prop between them and a
   surface. Only the emitter's own normal cuts: nothing reaches the back of the lit surface or its own plane.
2. A ray stops on fixed architecture, a prop's **box** and a character's **cylinder**, and on nothing finer. A
   chair is its box, the gap between a table's legs does not exist, and glass inside a model (a ticket booth, a
   display case, a cooler) is part of its box. Loose physics bodies, pickups and a prop gone loose stop nothing.
   Tower and bridge windows are wall to the rays, as they are to the bake.
3. **Fourteen lights stand for the whole lit patch.** Next to a large lit surface the bounce is patchier and
   dimmer than that surface's true glow (the foot of a lit wall gets less than it should). When the beam lands on
   more planes than there are lights, the planes with the least flux have none: dimmer, never misplaced (0.001 %
   of the reflected flux over a Subway station's standing places; 0.3 % on a brisk walk through its clutter with
   the head turning). A fading light is cut short when a new plane needs its place: on that walk at most 3.8 %
   of the bounce in one frame at 60 Hz (2.8 % at 30 Hz), and no more than 2 % in 99 frames of 100. There are eight
   extra lights for this: with four it was 8.9 % and 4.3 %.
4. A light stands at the centre of its hits on their plane. With hits either side of a doorway or a pier that
   point can lie over the opening or under the pier; it lights what is in front of the plane all the same.

### 3. Reflection probes for metal, glazed tile and glass

`world/reflectionProbes.ts` bakes small environment maps of the **actual generated station** on the CPU:

- Probes sit on a block lattice per level (about 9 m apart at Standard, 7 m at High; the block grows until the
  station fits the tier's probe limit). Each probe is ray-cast from the same fixed architecture, lit by the **final
  baked field** including the cube face of each surface it sees, with the working light fixtures drawn in as bright
  tubes.
- Each probe is stored as four octahedral maps, sharp to blurred, for the roughness response.
- A per-cell grid holds up to four probe weights and ids. Weights ramp across block borders (a continuous blend, no
  popping) and are zero where a probe cannot reach by walking inside its block: no reflection of the room behind a
  wall. A cell no probe can walk to takes the probes that reach it across a floor step (a track bed below the
  platform its blocks' probes stand on). A probe's weights also go one cell into the solid cells beside its cells,
  so a fitting set into the wall's own cell still reflects the room it faces.
- Each probe has a parallax box, so reflections line up with nearby walls instead of sliding with the camera.

`world/reflectionNode.ts` shows them:

- A material is chosen while its program is built: tagged glazing (`render/reflectTag.ts`: `'glass'`, or `'window'`
  for a pane set inside its wall), glazed tile (`'gloss'`) and metal candidates (a metalness map or a non-zero
  metalness). A metal candidate's fragment looks a probe up only when its real metalness is above 0.2 or its
  roughness below 0.45. Floors, painted walls, wood, cloth and characters never reflect.
- **Glazed wall tile** reflects with **either** probe tier (it was High only). The tile's authored roughness map
  says where a face is glazed; the weight is 1 up to roughness 0.45 and fades to 0 at 0.6, so grout and grime do not
  reflect. A tile face shows the station by its Fresnel term: faint face-on, clear along a wall.
- The station **columns** are clad in the brushed-steel set (`WorldMaterials` `'pillar'`: metalness 0.65). With
  probes they show the lit station and its fixtures; without, the diffuse part keeps them a grey brushed metal.
- **Glass inside a loaded model** (a see-through material named as glass: a cooler's door, a display case, the
  extinguisher cabinet's pane) is tagged when the model loads (`assets/loader.ts`): it reflects the probes too.
- A probe's light is scaled by the baked field's light at the surface (capped), so reflections dim with a flicker
  circuit, in a passing train's shadow and in a dark side room.
- A tower window's glass sits inside its wall's own cell; those panes (`'window'`) read the field and name the
  probes one cell out along the normal, in the room the pane is seen from.

Like the gather, a probe holds no prop, door, character or train. That is what the mirror is for.

### 4. The live glass mirror

With reflections on, the **one glass plane the player faces** shows a real mirror image (`render/glassMirror.ts`,
`world/glassPanes.ts`): the room behind the player with its props, characters, fixtures and signs, and the
flashlight's light and bounce on them, as they are this frame.

- **Which glass.** The station's flat vertical glass is collected as data when it is built: storefront glazing
  spans, free-standing panes and the ticket booth's panes, merged per wall. Each frame the plane with the largest
  on-screen area of intact panes within 12 m is the mirror; a pane that is shot out stops mirroring. A change of
  plane fades over 0.18 s. No plane in view: nothing is drawn.
- **How.** The real scene is drawn once more from the eye mirrored in the glass, through an off-axis frustum whose
  near plane is the glass, into a fixed-size target (1024 x 512 at Standard, 1536 x 768 at High, at the scene
  pass's sample count). The picture lies in the pane's own coordinates, so a glass fragment finds its texel from
  its world position alone and the image stays glued to the pane.
- **No new programs.** The target has the scene pass's exact signature and is drawn at the scene pass's
  render-context depth, so the mirror draw reuses the station's render objects, programs and pipelines: after the
  warm-up it builds nothing (`game/tests/glass-mirror-game.test.ts`: the real Game, zero node builds, pipelines
  and render objects while the mirror draws). Glass itself is skipped in the mirror draw, so the target is never
  sampled while it is drawn into. The flashlight's shadow map is not drawn a second time.
- **Instanced pools.** three culls an instanced mesh by one sphere round all its instances, which for a
  station-wide pool (the columns, the sleepers, every table) is the whole station. The mirror draws such a pool only
  when one of its instances is inside the mirror's own frustum (the glass to the reach); the warm-up's draw leaves
  nothing out.
- **How much a pane reflects.** The station's glass material alone reflects about a tenth face-on, which a lit shop
  behind the pane washes out. Under the mirror light a pane reflects **0.3 face-on** (`GLASS_PANE_F0`), by the ratio
  of two Fresnel curves: nothing is added at a grazing angle, where glass mirrors anyway. That is about three times
  a real double-faced pane, a stated choice so the room reads in the glass from the front.
- **What decides what you see.** As with real glass, the reflection competes with what is behind the pane. A dark
  shop in a lit hall mirrors the hall clearly: the opposite shopfronts, their signs (reversed), the ceiling tubes.
  Point the flashlight into it and the lit interior shows through where the beam lands while the reflection stays
  around it. A brightly lit shop shows mostly its interior, with the hall's lights and signs faintly over it;
  along a wall of glass the reflection is strong either way.

Limits, by design: one plane at a time (other glass keeps the probes); no player body or held weapon in the mirror
(the weapon is its own overlay scene); no volumetric fog along the reflected path (the scene's distance fog only);
glass does not show in glass; the flashlight's shadow in the mirror is one frame late; curved or tilted glass and
glass inside models keep the probes; on the direct frame path (the volumetric pass off or failed) glass keeps the
probes.

## Off / Auto / On

`world/enhancedLighting.ts` holds the policy (`planEnhancedLighting`); it is a pure function of the two settings, the
renderer's real capabilities and the level.

| Setting | Bake | Shading | Reflections and mirror |
|---|---|---|---|
| **Off** | baseline | baseline | none |
| **Auto** (default) | enhanced, `standard` tier: 16 rays per gathering voxel on a 1 m lattice, 3 bounces | **full** (the cube and the flashlight's bounce) on any hardware renderer; plain on a software renderer | the chosen quality, with the mirror, on the **hardware WebGPU** backend when its limits fit the probe textures; none on the WebGL 2 fallback or a software renderer |
| **On** | enhanced, `high` tier: 32 rays in every cell, 3 bounces (a longer first load) | full on any renderer | the chosen quality, with the mirror, on any renderer that can run them, also a software one |

Reflection quality: **Standard** = 32 px probe maps, at most 192 probes, a 1024 x 512 mirror. **High** = 64 px, at
most 240 probes (about four times the atlas memory), a 1536 x 768 mirror. If High needs a larger texture than the
renderer allows, Standard is used and the status says so.

Bounded resources, and what happens when one does not fit:

- The field with its cube is about 3.5 times the baseline field (see Costs). A station whose field with the cube
  would be deeper than the renderer's largest 3D texture, or larger than 96 MB (`FIELD_CUBE_BYTES`), keeps the
  enhanced bake and is shaded plain; the status says why.
- The mirror's target is a fixed size per tier, whatever the display's resolution.
- A browser does **not** expose total or free video memory. `navigator.deviceMemory` and adapter limits prove
  nothing about it, so nothing here reads them, and no minimum amount of video memory is claimed.

What Auto reads: the backend that actually started (WebGPU or the WebGL 2 fallback), whether it is a software
rasterizer (`render/softwareGl.ts`), and the backend's own largest 2D / 3D texture sizes. Auto leaves reflections off
on the WebGL 2 fallback and full shading off on software renderers because their frame budget is the unknown one,
not because they cannot run them: On enables them there.

The status is always the truth about the **live** station: the settings form's help lines, the perf overlay's
**Lighting** row, the performance recorder's environment and `__LL.lighting()` say what it was built with (for
example `auto: bake standard full · refl standard ×187 + mirror · cache hit`), where the data came from and why
something asked for is not in use. No setting was added: the cube and the flashlight's bounce belong to Enhanced
lighting, the mirror to Reflections.

URL overrides for one session: `?lighting=off|auto|on`, `?reflections=off|standard|high`.

## Changing the settings during play

A changed Enhanced lighting or Reflections choice is applied to the station the player is in
(`Game.relightAfterSettings`): at once when it is made in the pause menu, else the next time the game is paused (a
choice that changes while playing, for example from another tab, waits; the status says "Not applied yet"). No main
menu, Continue, station load or reroll is involved.

- Only the station's **lighting** is rebuilt: the field bake of the new choice (from the derived cache when this
  layout's entry matches, else baked now in the same paced steps, under the pause menu), then one step that swaps
  the station lighting (`StationLighting.replaceSteps`: the flicker clock, the circuit levels and the fixtures
  carry over; the fog keeps its maps, gas, smoke and clock and only gets the new field). The glass mirror is made
  or released with it, and the flashlight's bounce is bound to the new lighting.
- A changed light set compiles every lit material again, so the same **blocking warm-up** as a quality change
  follows; its hidden frames also draw the mirror once. No frame is drawn meanwhile. **Resume**, the two choices and
  the quality choice are held, and the pause line says what is being done. A new game, Continue, Retry and travel
  wait for it, as for any warm-up.
- The world, its seed and random stream, enemies, loot, identities, the player, the inventory and the save are not
  touched. The replaced field and probe textures are released after the warm-up; render objects that outlive the
  swap re-read their texture bindings (`render/bindingRefresh.ts`).
- The status says `applying` while it runs and the new live state afterwards. If the bake or the install fails:
  "The change could not be applied (reason): the station keeps this lighting." A failure after the swap leaves the
  baseline lighting, and the status says baseline. A failed plan is not retried until the choice changes again.
- A lost device or a station replaced meanwhile ends the rebuild without touching the new station.
- Between two stations and inside a transition nothing is rebuilt: the next station's load applies the choice, and a
  pause that outlives the transition applies it then.
- There is one session-wide field light per combination that was ever used (plain or full, with probes or without,
  with the mirror or without), so going back to a combination used before compiles nothing new.

## The derived cache

Baked results are stored outside the save, in IndexedDB (`core/derivedCache.ts`, database
`terminal-state.derived.v1`): at most 48 entries or 96 MiB, least recently used evicted first, compressed where the
browser has `CompressionStream`. One entry per station and settings combination holds the gathered light (the cube
rows, 16 bits a value) and, when probes were baked, the probe atlas, grid and metadata. Stored size measured in
Firefox: 5.3 MB compressed for a Subway station at On with Standard reflections (seed 19; 10.0 MB before
compression).

**Keys.** An entry is found by an **address**: a content hash (`core/contentHash.ts`) of the realized layout (every
level's cells, floor and ceiling heights, sight blockers, ramps), the fixtures, the bake parameters, the tier names,
the shading and the data versions. It is never the seed alone.

**Validation.** An entry is only **used** when the digest of the real inputs matches the digest stored with it:

- for the gathered light: the tier's numbers, the gain and saturation, the column geometry, the direct light the
  bake just made (so every fixture, tint, power and flicker state), and the surface colours the builder really drew;
- for the probes: all of the above, the final field's bytes, the fixtures and the reflection tier.

So the cache cannot serve stale lighting after a generator, material, fixture or parameter change: the address finds
an entry, the digest decides. A mismatch is reported as "baked again" and the entry is replaced. Changing the gather
or probe code itself needs a version bump (`DERIVED_LIGHTING_VERSIONS` in `world/enhancedLightingRuntime.ts`; this
rebuild bumped all three, so every entry of the earlier version is a miss and leaves by eviction).

**What it can never do.** The cache holds derived data only. Nothing in it is read by the generator, the save or the
campaign. A hit, a miss, a cleared cache, a full disk or a browser without IndexedDB (the cache then lives in memory
for the session, and the status says so) give the same station, loot, identities, cargo and travel: only the load
time differs. The settings form shows the cache's size and has a **Clear lighting cache** button. The mirror and the
flashlight's bounce are live and cache nothing.

## Lifecycle

- `Game.prepareSection` (behind the loading screen, or during the ride): `EnhancedLightingRuntime.prefetch` hashes
  the address in pieces and reads the entry.
- `Game.buildSectionSteps`, step `lighting`: `EnhancedLightingRuntime.bakeSteps` runs in the same paced build steps
  as the baseline bake (`core/pacedBuild.ts`); `StationLighting.steps` gets the field, the probes, the shading, the
  mirror choice and what the flashlight's bounce traces; `Game.syncGlassMirror` makes or releases the mirror.
- Each frame: `FLASH_BOUNCE.update` after the player light moved; `GlassMirror.select` picks the plane; the mirror
  is drawn right before the scene pass, inside the frame's one scene-matrix update.
- A station swap (travel, Retry, Load last save, Continue) binds the new station's textures first and retires the
  old ones afterwards. The mirror's planes are dropped at teardown and set again for the next station.
- Off and the Reactor return nothing from `bakeSteps`; `StationLighting` then bakes the baseline as before, the
  bounce is unbound and no mirror exists.
- A changed choice in the pause menu rebuilds the live station's lighting in place (*Changing the settings during
  play*).

## Costs

GPU memory for one station (seed 93). The field is one RGBA8 3D texture; the cube is extra slices of it:

| Station | Field, baseline or plain | Field with the cube (full shading) | Probes, Standard | Probes, High |
|---|---|---|---|---|
| Subway | 9.5 MB | 33.2 MB | 187 probes, 5.7 MiB | 210 probes, 16.7 MiB |
| Office | 13.2 MB | 45.4 MB | 155 probes, 6.1 MiB | not measured |
| Mall | 5.8 MB | 19.3 MB | 178 probes, 4.7 MiB | not measured |
| Skyways | 11.1 MB | 39.0 MB | not measured | not measured |
| Bunker | 3.9 MB | 13.5 MB | not measured | not measured |
| Market | 0.7 MB | 2.6 MB | not measured | not measured |

The mirror's target (colour and depth, 4x MSAA): about 29 MB at Standard and 66 MB at High, whatever the display's
resolution. On the largest station measured (the Office) the feature's own video memory is about 70 MB at Standard
(32 MB of cube, the mirror, the probes) and about 115 MB at High.

Bake time of the lighting step on the main thread, cut into paced build steps of a few milliseconds. In Node on the
studio pod, the Standard gather (Auto): Subway 1.4 s, Office 1.3 s, Mall 0.9 s, Skyways 1.3 s, Bunker 1.1 s, Market
0.3 s. In Firefox 158 on the same pod (a shared server CPU, other work running), On with Standard reflections on
Subway seed 93: 4.2 s in all (gather 3.2 s, probes 0.2 s); on seed 19: 2.9 s (gather 2.1 s). A cache hit skips the
gather and the probe capture.

Frame cost:

- **Full shading**: three more filtered fetches of the field texture per lit pixel. No new texture, sampler or
  uniform buffer.
- **The flashlight's bounce**: fourteen small light terms per lit pixel on plain uniforms (three dot products and
  one division each; fourteen more on a reflective surface for the sheen). It was six. On the CPU 30 rays over the
  architecture and one pass over the station's prop boxes a frame: in Node on a base Subway station with its 635
  boxes a median of about 75 microseconds, 85 to 90 with 32 characters in reach (it was about 18 with six rays and
  no boxes). The update keeps nothing on the heap.
- **A reflective fragment**: one filtered and one unfiltered grid fetch, and per probe that weighs in (one in a
  block's core, up to four at a corner) three texel loads and two atlas samples. Glazed tile now pays that at
  Standard too, where its weight is not zero.
- **The mirror**: one more draw of the part of the scene the mirrored eye sees, into its fixed-size target, only
  while a pane covers at least 1.5 % of the screen within 12 m. It is the feature's one real main-thread cost. In
  the real Game in Node (a validating no-op device, Subway, 2.2 m from a storefront, flashlight on) a frame
  submitted about 140 draws for the mirror next to about 151 for the scene pass and 71 for the flashlight's shadow:
  while a pane is in view the frame's draw submissions grow by about two thirds, and three's own submit path took
  about 12.7 ms for the mirror next to about 15.5 ms for the scene pass and shadow. (Leaving out instanced pools
  with no instance in the mirror's view took it there from about 170 draws and 15.4 ms.) Away from glass, and
  with Reflections or the feature off, the mirror draws nothing. It builds no program, pipeline or render context,
  and it draws no second shadow map. These are counts and Node timings of three's submit path, not frame times: no
  frame rate is claimed from them, and the cost on a player's hardware is not measured.
- **Warm-up**: a lit material's program with full shading takes about a tenth more CPU to build (Node, validating
  device, Auto: about 100 ms a material against 89 ms before; Off 74 against 70), at a station load and when a
  lighting choice is applied.

Main-thread fixes of the previous task that still hold: per-object texture-matrix updates avoided through
`render/textureFetch.ts` (the cube's fetches and the mirror's lookup use it too), and shared shader text
(`render/shaderTextShare.ts`).

Shader bindings: a reflective material binds three more sampled textures and no uniform buffer more; glass under the
mirror light binds the mirror's texture as a fourth. The cube adds no binding (it is the field texture). In the real
game on the validating WebGPU device, every compiled module stays inside WebGPU's default limits of 12 uniform
buffers, 16 sampled textures and 16 samplers (`game/tests/enhanced-lighting-game.test.ts` asserts this for every
compiled module).

## Known limits

- **Every picture of this feature comes from software rasterizers** (Firefox WebGL 2 on llvmpipe, through the game's
  real volumetric frame path). They show what is drawn, never a frame rate. Firefox WebGPU on lavapipe dies in the
  volumetric pass on the studio pod, so WebGPU is covered by the Node tests on a validating device, not by pictures.
- The bounce's strength is a stylised choice (above). Pale levels gather more per unit of direct light than the
  Subway: their ceilings and walls gain the most.
- Auto on a software renderer or the WebGL 2 fallback looks closer to Off than to On: plain shading or no
  reflections (the status says which and why).
- The flashlight's bounce casts no shadows, treats a prop as its box and a character as a cylinder, and stands
  for the whole lit patch with fourteen lights (its four limits above).
- The mirror: one plane at a time; no player body or weapon; no volumetric fog in the reflection; a brightly lit
  interior behind a pane leaves only the hall's lights and signs visible in it face-on.
- Glass inside a model, curved glass and tower windows reflect the probes, not a live image.
- A `virtual` light source (one with no tube) is not drawn into a probe; its light on the surfaces is.
- Metal set inside a wall's own cell (window frames and mullions, a shutter) reads the field of that cell like any
  surface there: its reflection is dimmer than the room's.
- Open cells walled off from every probe in reach get no reflection.
- A column is as dark as what it mirrors: facing an unlit stretch of the station it is a dark steel. Without probes
  it only has its diffuse part and the nearby lights' own highlights.
- Travelling between stations lit by different field lights (for example into the Reactor) recompiles once the
  materials of what outlives a station (the held weapon, the parked car).
- What an earlier recording showed and this does not change: three refreshes every drawn object's uniforms every
  frame, and programs first needed during play are built on the main thread when the background compile is starved.

## Tests

- `game/tests/light-gather.test.ts`: the gather as an ambient cube: direction, colour, occlusion, energy, flicker
  shares, 16-bit rows, determinism, no movable props.
- `game/tests/light-field-cube.test.ts`: the cube in the field: layout, the complete-ambient encoding, sampling by
  the normal, the between-layers bound on Subway seed 93, downsampling, `withoutCube`.
- `game/tests/lighting-node.test.ts`: the plain and full field lights' programs on both shader backends (three more
  field samples, no texture or buffer more), parity with the CPU sampler.
- `game/tests/flash-bounce.test.ts`: the rays' equal flux, what stops the beam (a prop box, a round prop, a
  character, a thin pole; glass passes), every light on the plane of its rays through aim sweeps at 30, 60 and
  144 Hz, the extra lights, near and far field against the six point lights it replaces, off = exactly zero, the
  shader's sum against the CPU mirror, no uniform buffer, no allocation, a frame's cost on a real station.
- `game/tests/flash-occluders.test.ts`: which boxes pass the beam (by kind, by the train's word, the Bunker's
  panes; a census of real levels), a colour for every prop kind, which characters count, the game's wiring.
- `game/tests/reflection-probes.test.ts`: placement, weights, capture with and without the cube, fixtures, levels,
  the atlas.
- `game/tests/reflection-node.test.ts`: which materials reflect (metal, glass, window, gloss), glazed tile at either
  tier, the full and mirror variants of the reflecting light, the pane reflectance, binding counts.
- `game/tests/glass-panes.test.ts`: the station's glass planes, merging, a broken pane.
- `game/tests/glass-mirror.test.ts`: the reflection geometry, the window, clipping, selection and sight (the booth),
  shader parity, the draw's state, which instanced pools a draw leaves out.
- `game/tests/glass-mirror-game.test.ts`: the real Game on a validating WebGPU device: nothing built while the
  mirror draws (also when a pool it left out comes into view), one shadow draw a frame, no texture read while
  written, every pool answer against the test's own frustum, Off has none of it.
- `game/tests/enhanced-lighting-policy.test.ts`: what Off / Auto / On plan for each kind of renderer (shading,
  reflections, the mirror), the reasons, the texture-size fallbacks, the bounded tiers.
- `game/tests/enhanced-lighting-runtime.test.ts`: Off / Reactor, miss / hit / stale / cleared / unavailable, the
  cube's fallbacks with their reasons, the bounce's binding, what the bake may never touch.
- `game/tests/enhanced-lighting-game.test.ts`: the real Game on a validating WebGPU device: binding limits, death
  and reload, Off and back.
- `game/tests/lighting-live-apply.test.ts`: a change applied from the pause menu (only the lighting rebuilt, the
  station and the save conserved, the status, a failed bake).
- `game/tests/enhanced-lighting-settings.test.ts`: the settings, their form rows, the cache line and diagnostics.
- `game/tests/reflection-window.test.ts`, `game/tests/station-pillar-material.test.ts`,
  `game/tests/texture-fetch.test.ts`, `game/tests/shader-text-share.test.ts`, `game/tests/content-hash.test.ts`,
  `game/tests/derived-cache.test.ts`: unchanged parts.
