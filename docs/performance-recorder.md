# Performance recorder

Task studio-performance-recorder-20261103-043629 (lane RECORDER). An in-game recorder that the player starts, plays through and
stops. It produces one private JSON file that the player can send to us. Code: `game/src/debug/perfRecorder.ts` (capture core,
summaries, JSON), `perfRecorderHooks.ts` (what it reads from the game and the browser) and `perfRecorderUi.ts` (the menu
section, badge and keys). Tests: `game/tests/perf-recorder.test.ts`.

## For the player

1. Press **Esc** to pause. Under **Performance**, choose **Start recording**. The section is also in the main menu's
   **Settings**. You can also press **F8** at any time.
2. Choose **Resume** and play the part that stutters. For example, turn the camera around in the Mall, walk into new shops or
   ride the train. A small **REC m:ss** badge at the top of the screen shows that recording is on.
3. When you feel a stutter, you can press **F9** to add a numbered mark. The report then names the worst frame in the 2 s before
   each mark.
4. To stop, press **Esc** and choose **Stop & Download report**. You can also press **F8**: the report is prepared, and
   **Esc → Performance → Download last report** saves it. Recording stops by itself after **2 minutes** or **20,000 frames**,
   and the badge then says that the report is ready.
5. Send us the downloaded `terminal-state-perf-<build>-<date>.json`. **Discard** throws a recording or report away.

The recorder records only game performance and event data. It does not record your saves, inventory or account, and nothing is
uploaded. The report stays in this tab's memory until you download it or reload the page. Nothing goes to localStorage, so the
three save slots are untouched. Starting a new recording replaces the previous report.

Keys: before F8 / F9 were chosen, every existing binding was checked: game input, the 1337 Lockbox code, the paper map, the
inventory, Lockbox and bag views, the main menu and Ctrl+Shift+P. None of them uses a function key, and the paper map passes
function keys through. Ctrl, Alt and Meta combinations and typing in a field are never taken. Shift is allowed, so a sprinting
player can still stop.

## What is recorded

* **Every frame** (each rAF callback, never every n-th frame), with the same boundaries as the Ctrl+Shift+P overlay:
  * the interval to the next rAF, the game callback's main-thread CPU, the world update, the render submission (CPU encoding,
    not GPU work) and the deferred chunks;
  * the game state and its tags: rendered, gap, hidden, unfocused, warming, transition, riding, spans, mark, state change,
    and compiling (the train journey's background compile is still running, including after the arrival);
  * draw calls, triangles and passes;
  * the per-frame net change of `renderer.info.memory` textures / geometries / programs, and of two three-internal cache sizes:
    TSL node builds and pipelines;
  * the level culler's hidden-mesh count, the enemy count, and the player's look (yaw and pitch);
  * the UpdateProfiler's top-level spans, which are switched on while recording;
  * **first-use preparation** from three r186 internals that are hooked only while recording:
    * `nodeBuilds` / `nodeBuildMs`: TSL node builds completed inside a synchronous `renderer.render()`, with their CPU ms;
    * `asyncBuilds`: node builds completed outside a render (compileAsync / warm-up);
    * `pipelinesCreated` / `pipelineMs`: render pipeline requests;
    * `programsCreated` / `programMs`: shader programs created.
* **Spike frames** keep every nested span (ai.brain / path / motor / anim, hooks, …) with call counts. A spike frame has an
  interval over 50 ms or a game CPU over 33.3 ms; the worst 160 are kept.
* **Load route**: every level build, warm-up and event is labelled with the lifecycle path that ran it:
  `travel-arrival` (train transit), `new-game`, `new-campaign`, `continue`, `retry`, `menu-travel`, `settings-rewarm`,
  `recording-start` or `other`. Each level gets a `world.segments[]` entry with its route, its warm-ups (status, mode, ms and
  per-stage done / total / ms, or the journey's background compile) and `controlT`. `controlT` is the first frame in state
  playing with no warm-up and no lifecycle operation in flight; for a journey, that is after the arrival and its save.
* **Events** carry a timestamp and a duration where known:
  * asset request → parsed or decoded (three's loading manager), and Resource Timing fetches with their size and cache hit;
  * level generate / prepare / build (with the enemy spawns and their total instantiation ms) / leave;
  * the warm-up (status, mode, stages) and the Mall's texture staging. Each stage (materials, passes, shadows, view) is also a
    `warmup.stage` span. The stages run in that order, and their start times are derived from the stage durations;
  * the journey's background compile. The `compile.background` span is the arrival's wait (at most 8 s). The job itself
    has `compile.journey.start` / `.phase` (scene → shadow) / `.end` events, plus `compile.journey.active` when a recording
    starts while it is running. They carry its counts: items done, calls, slices, the most calls in a slice, the longest
    slice, and whether calls were launched from a background-priority task. They are seen at the next frame sample. The
    GPU / driver compile is **not observable**;
  * travel and journey, new game / load / retry, save writes (reason and ok only), and the train depart / arrive;
  * state changes, visibility and focus changes, display / settings changes, `control.returned` (route, ms since the build),
    and user marks.
* **Other**:
  * long animation frames, or long tasks, with their top scripts (file basenames only), where the browser has them;
  * the player position at 10 Hz;
  * the JS heap at 1 Hz (`performance.memory`, Chromium only, approximate);
  * GPU pass time from the existing timestamp-query timer when the backend supports it. It is `null` otherwise, never 0.
* **Environment**:
  * the browser UA, the reported cores and device memory (nullable);
  * the canvas size, DPR, render pixel ratio, quality, render scale and FOV;
  * the backend and its cached adapter info, the software-rasterizer flag and the warm-up mode;
  * the build: the bundle chunk's content hash. The bundle has no GAME number or source commit, so those fields are `null`.
    The hash maps to a CI artifact through its `manifest.json`.

The report holds asset basenames only: no URLs, query strings, other-origin entries or typed text.

## Report format (`schema: "terminal-state-perf"`, `schemaVersion: 1`)

| key | content |
|---|---|
| `build`, `environment`, `capabilities` | the identity; the device and display; per metric: available, its source and why it is null |
| `capture` | `capturedAtUTC`, `endedAtUTC`, `durationMs`, `frames`, `termination` (`manual` / `auto-cap-frames` / `auto-cap-duration` / `hidden` / `device-lost` / `recorder-error`), `stoppedBy`, `caps`, `drops`, `overhead` |
| `world.segments` | level / section / station / seed / seed code / name from the start and from each level build |
| `summary.gameplay` | min / median / p95 / p99 / max / mean and counts over 16.7 / 33.3 / 50 / 100 ms for the interval, cpu, update, render submit, deferred and gpu (**gameplay frames only**) |
| `summary.byCategory`, `framesByState`, `gaps` | the same split by category: gameplay, transition, menu, loading, warmup, hidden, unfocused |
| `summary.spans` | the mean / p95 / p99 / max of each span, calls per frame, and the mean over spike frames |
| `summary.firstUse` | per level segment: the first-use preparation before control returned (loading / warm-up) and after it (gameplay and transition frames). Covers node builds and their ms, async builds, pipelines, programs, net cache growth, new textures, frames and spikes with first use, and the 5 worst frames. Work after control is preparation the warm-up did not cover |
| `summary.correlation` | gameplay frames and spikes (> 33.3 ms) that coincide with turning (> 90°/s), new node builds, pipelines, programs, textures or geometries, culling changes, path searches, riding, or main-thread time outside the game |
| `worst` | the worst gameplay frames by interval and by CPU, and the worst non-gameplay frames. Each has its spans, counter changes, camera, nearby events and long frames, and a timeline of the frames around it |
| `marks` | each mark and the worst frame in the 2 s before it |
| `frames.columns` | the per-frame columns (units in `frames.units`; times in 0.01 ms integers; `null` = not measured) |
| `spans` | span names / parents and the per-frame top-level laps |
| `spikeDetail` | every nested span of the kept spike frames |
| `events`, `longFrames`, `resources`, `camera`, `heap` | bounded lists with `dropped` counts |

Gameplay summaries leave out these frames: menus, pause, title, loading, warm-up, frames during a lifecycle transition
(travel, journey build, new game, load) or a state change, focus loss, and hidden-tab or suspension gaps. The gap rule is the
overlay's: the page went hidden, or the interval is more than 3 s longer than the game's work. All of these frames stay in the
columns with their category.

## Bounds and cost

* The caps are 20,000 frames and 120 s. Frames are **never dropped**: the capture stops at the cap. The other buffers have caps
  too (events 6,000, resources 1,500, long frames 400, camera 1,300, heap 150). When one is full it drops its **oldest**
  entries; long frames drop the **shortest**, so the worst are kept. Each drop is counted in `capture.drops`.
* The capture arrays take about 5.8 MB. They are allocated at the first start and reused, so a restart clears them and nothing
  grows. A full 20,000-frame report is about 2.7 MB of JSON. No gzip and no new dependency.
* **Off:** the per-frame hook is one boolean check. No wrappers, observers or profiler are installed, and nothing is allocated.
  The keys are one window keydown listener.
* **On** (Node measurement, `perf-recorder.test.ts`): the recorder's own per-frame work is about 3 µs on average. It is
  reported in `capture.overhead` and is not counted in `frames.cpu`. The UpdateProfiler's span clock reads are inside the game
  CPU. GPU timing, when supported, uses the existing asynchronous timestamp queries.
* The report is serialized **after stop**, in steps of about 4 ms that yield to the frame loop. A full capture takes about
  0.15 s in Node, with a longest step of about 6 ms.

## QA (`?qa=1`)

`__LL.perfRecorder()` returns `{status(), start(), stop(), mark(), report(), clear(), download()}`:

* `stop()` prepares the report without downloading it.
* `report()` is the same JSON object the file carries.

Browser checks are the lead's. Keep them serial and short.

## Limits

* Software or WebGL2-fallback captures are a trend, not native proof. The capability list says what this browser exposed.
* The first-use hooks wrap three r186 internals only while recording: `renderer.render`, `NodeManager._createNodeBuilder` /
  `_createNodeBuilderState`, `Pipelines._getRenderPipeline` and `backend.createProgram`. All of these except render run only on
  a cache miss. If one is missing, the columns are `null` and the capability lists it. Only CPU-side spans are measured; the
  GPU / driver pipeline compile time is **not observable**.
* `newPipelines` / `newNodeBuilds` read three r186 internals (`renderer._pipelines.caches`, `renderer._nodes.nodeBuilderCache`).
  They are net changes per frame, and `null` if three renames them.
* The culler count is net hidden meshes. Per-update show / hide counts are not instrumented.
* Lifecycle events come from Game methods that are wrapped only while recording. A renamed method appears as
  `capabilities.lifecycleEvents.note: missing …`, and a source test pins the names.
