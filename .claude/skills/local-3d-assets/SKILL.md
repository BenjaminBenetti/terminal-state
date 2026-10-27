---
name: local-3d-assets
description: Preserve and inspect local subway asset provenance, and operate desktop generation only after fresh specific authorization.
---

Reuse current assets first. Simple panels, walls, slabs and signs use controlled manual/procedural geometry by default; complex bench/light may suit AI or hybrid methods. Coordinates, scale and engine preparation are unapproved. Never modify original masters or delete failed logs/old models/PNG bytes. Preserve licenses and source bindings.

The user's existing desktop generator is http://10.0.0.59:7861, experimental F16 SV+MV 0.4.0. Local inference only. Baseline fixed resolution 1024, default 24 steps per flow ×4, seed42, GSS10, assumed FoV20; these are not calibrated cameras or a quality guarantee. Sealed weights already live on the desktop. Do not download weights, rebuild Docker, change GPU/drivers/host or start calls on startup. Reference implementation: `reference/tools/pixal3d-asset-lab-f16-combined-kit`. Do not execute historical controller.py, old launchers or budgets.

Before future generation:
1. Obtain fresh explicit permission naming the specific asset and number of jobs. All old tasks are consumed. Pin exact PNG bytes and hashes; MV front/right/back/left must be equal RGBA canvases with current front as first view and the true original sheet parent.
2. Inspect current GET/config and discover function/layout. Current Generate function1/readiness3 is a hint, not a permanent ID; old Q8 differed. Process one job at a time.
3. Persist durable intent BEFORE Generate. Record ACK and keep SSE alive in a detached worker through the actual terminal event. Lost ACK/terminal means reconcile, never resubmit automatically. No automatic retry, provider fallback or cancellation of a user job.
4. Transfer main GLB, metadata and log from the actual terminal. Supporting input/camera paths come from the actual metadata command `--views /outputs/<job>/input-views`, not the Gradio cache metadata parent (prior403 retained).
5. Verify complete GLB bytes/hash and exact source bindings. Do one basic load only; user judges visuals. Keep failed logs and native originals. No automatic engine prep, model approval or publication; Patch/Main owns publication.

## Forward rule — conditioning-image view (user feedback, iteration 04, 2026-10-26)
User: "make sure you always get straight on shots for images intended for 3d asset generation or else the result will end up as a skewed model". Every NEW single-view conditioning image is a STRAIGHT-ON / front-on elevation: camera level with the object's vertical centre, looking perpendicularly at the front face, front face parallel to the image plane, orthographic-like with minimal perspective; single complete object, centred, square transparent canvas, no shadow/props/text overlays; no three-quarter, elevated or low views. State this explicitly in every prompt. Composite subjects (e.g. shops) are generated as separate building-block components and assembled, never one whole shop/food court. Forward-only: earlier three-quarter inputs and their models stay recorded as they were. Derivative note: a straight-on single view carries no depth cue and glass reconstructs opaque — plan a depth fit and pane projection in the runtime derivative.
