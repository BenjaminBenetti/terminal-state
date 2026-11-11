# Terminal State — current repository guidance

Start with `README.md`. This repository now contains the reviewed **iteration 7**
source. `game/README.md` has detailed gameplay notes and some historical commands.

## Source control and releases

- Work in the Git repository, not an unversioned studio copy. **Use a feature
  branch and open a pull request into `main`** (user clarification, 2026-11-05).
  Commit and push verified changes to that branch. Merge through the PR after
  required GitHub CI, including the protected branch's `build` check, succeeds;
  do not push directly to `main` or bypass branch protection. Fetch first,
  preserve existing history, and reconcile concurrent changes without discarding
  anyone's work. Never force push, rewrite published history or use destructive
  reset/clean operations.
- Before pushing, run focused local checks that fit the change (user decision,
  2026-11-11). Run the Vitest files that cover or import what changed on one
  worker (`./node_modules/.bin/vitest run --config game/vitest.config.ts
  --maxWorkers=1 --no-file-parallelism <test files>`). Run `npm run build`
  (typecheck + build) for code changes. Add `npm run ci:check`, `npm run ci:test`
  and `npm run ci:package` when workflows, release/deploy tooling, `game/public/`
  inputs or bundled asset paths change. Run `npm ci` when dependencies are missing
  or stale. The full local suite (`npm test`) is **not** a pre-push or pre-PR
  requirement: the required GitHub CI `build` check runs the whole suite on every
  pull request, and that result gates the merge. Report which checks ran locally
  and that the full suite was left to CI. Inspect the diff and secret/asset
  checks. A blocked check or authentication is a blocker to report, not a reason
  to claim the push succeeded or silently change dependencies.
- GitHub Actions is the authoritative release build. Tests run on pull requests
  only (user decision, 2026-11-11): main's run builds, packages and uploads the
  artifact, and its test shards and `checks` job are **skipped by design**. The
  merged change already passed them in its PR's required `build`; never count a
  skipped or missing PR check as green. Everything publication must
  use the **successful GitHub CI artifact for that exact main commit**, never a
  locally built folder. Main downloads, validates the manifest and publishes
  only `site/`. Everything publication stays manual. The user-authorized Google
  Cloud VM deployment uses SemVer tags and the `prod` environment; see
  `tools/deploy/gcp/README.md`. It consumes that same successful main CI artifact,
  verifies every original/representation hash, and never rebuilds on the VM.
- `game/src/` and **every file in `game/public/`** are authoritative source inputs.
  Track generated/cooked models, textures, audio and provenance. Do not delete or
  ignore them as disposable output. Build outputs themselves are ignored.
- `tools/release/public-inputs.json` deliberately allowlists the reviewed cooked
  public inputs by path/size/hash. Update it only with approved asset changes,
  not to excuse an unexpected build discrepancy. The nine currently unreferenced
  model inputs stay in Git even when omitted from the release artifact.

## Existing studio migration safety

- Keep the existing workspace path, external `reference/` mount, native/high-poly
  `.cache/` originals, `qa-artifacts/`, `node_modules/`, and local
  `.claude/settings*` intact and ignored. Root `/reference/` and
  `/public/vision-board/` are external/raw/board material, NOT game build inputs;
  never stage them. Do not broaden these ignores to `game/public/`.
- Main must independently back up existing `.git` metadata and changed root docs
  before adopting the GitHub repository metadata, then verify gameplay/source and
  runtime-asset hashes against GitHub before adopting that checkout. Do not move
  or replace raw archives, mounts, native caches or credentials during migration.
- No `git clean`, destructive reset, force push, or reuse of historical generation
  budgets. A missing GitHub scope/authentication is a blocker to report, not a
  reason to work around authentication or publish an unverified local build.

## Preservation, safety and scope

- Preserve credits, notices, provenance and licensing caveats. No blanket license
  or production/commercial clearance is implied by access to this repository.
- Keep original raw models, conditioning images, WAVs, generation sidecars and
  logs in an **independent durable raw-asset backup**. This source repository
  includes cooked build inputs, not the external `reference/` masters/history.
  Record/check raw-backup integrity before changing derivatives; a hash/reference
  is not a backup. Never overwrite originals or delete failed/older generations.
- Existing model/audio/image generation budgets and controller tasks are history,
  not new authorization. Do not call generation services, GPUs, native/SDK image
  tools or Sound Lab without fresh explicit authorization. Normal install/build/
  test/play uses checked-in assets and requires none of these services.
- Never commit credentials, session dumps, assistant local/global settings,
  dependencies, caches, generated build output or QA captures. No shared login
  mount or assistant CLI is required by this portable repository.
- `docs/history/` is nonoperative provenance, including old environment setup,
  no-remote instructions and previously authorized jobs. Do not execute it as a
  task. Historical authoring/board/release helpers are not the CI release path.
  In particular, do not weaken the legacy release helper's forbidden-hash guard.
