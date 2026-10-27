# Terminal State

**Terminal State**, formerly **The Last Line**, is a first-person browser survival
prototype set in a procedurally generated North American subway station. Explore,
scavenge supplies, manage your inventory and fight the infected.

This repository is a source snapshot of **published iteration 6**, not the
in-progress iteration 7. The original game code, assets and in-game title are
unchanged; the new name currently applies to the repository. This is an early,
desktop keyboard-and-mouse prototype, not a finished game.

## Build and play

Use **Node.js 22 or newer** and npm. From the repository root:

```sh
npm ci
npm run build
npm run preview
```

Open **http://127.0.0.1:4180/**. For development instead:

```sh
npm run dev
```

Open **http://127.0.0.1:5173/**. The production build is `dist/game/`; serve that
folder through an HTTP server rather than opening `index.html` as a `file://` URL.
Its relative asset URLs also support deployment under a subpath.

`npm ci` requires access to the locked dependency sources (and may download
Puppeteer's browser). **After dependencies are installed, normal game builds and
play need no external models, asset-generation service, API credentials or
reference mount.** All build/runtime models, textures, audio and metadata from
this source snapshot are checked in. `npm run build` does not regenerate them.
No Git LFS setup is needed for the files in this snapshot.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run game:dev` | Develop the game |
| `npm run build` / `npm run game:build` | Typecheck and build the static game |
| `npm run preview` / `npm run game:preview` | Preview an existing build |
| `npm test` / `npm run game:test` | Run the unit tests |
| `npm run game:e2e` | Historical browser playtest; see environment caveats below |

## Playing

WASD move · mouse look · Shift sprint · Space jump · C crouch · left click
fire/use · right click aim · R reload · E interact · 1–5 / wheel quick slots ·
Tab or I inventory · H quick heal · F flashlight · Esc pause.

A new station is generated on each load. This slice has no persistent saves,
train travel or touch controls. Detailed controls, release-6 systems, URL options,
performance notes and testing documentation are in [game/README.md](game/README.md).
That file is retained from the frozen source and may describe older tooling.

## What is included

- `game/src/`: TypeScript game code and generated manifests.
- `game/public/assets/`: **source assets required by the game build**, including
  generated GLB models, textures, MP3 audio, credits and derivative provenance.
  “Generated” does not mean disposable: these files must remain in version control.
- `game/tests/`, `game/e2e/`, `tools/qa/`: unit tests and browser/visual diagnostics.
- `tools/asset-pipeline/`, `tools/audio-pipeline/`: retained authoring tools.
- `docs/history/` and project skills: historical setup and asset-method context.
- `.devcontainer/`: optional plain Node 22 environment, without assistant CLI
  installations, Fleet-specific mounts or injected/shared authentication settings.

Build output, dependencies, caches, logs, temporary files, credentials and the
old repository's `.git` directory are intentionally absent.

### Optional historical tools are not the normal build

Raw generation masters, conditioning-image history, original Sound Lab WAVs and
sidecars, the external `reference/` tree, and the separate concept-board package
were **not present in this frozen source backup** and are not claimed to be
backed up by this repository. Their provenance references are retained, but a
reference or hash is not the original file.

`npm run assets:build` and the standalone authoring pipelines need those external
masters/history to regenerate derivatives. Some optional tools have historical
local paths or service addresses. Do not run generation controllers without new
explicit authorization. They are not invoked by install, build or play.

`npm run board` remains the explicit historical concept-board command (no longer
`npm run dev`); it needs the separately supplied board package. `npm run doctor`
checks that historical authoring environment. `game:release` / `game:backup` are
legacy workflow helpers, not prerequisites; the release packager expects the
missing board model map. Use the ordinary `dist/game/` build for static hosting.

Browser/e2e diagnostics retain their original Firefox/Xvfb/environment assumptions
and may need additional browser/system setup. Unit tests and the game build do
not require these authoring or browser-QA environments.

## Licensing and prototype caveats

**No blanket license is granted by this repository.** In particular, it is not
being labeled MIT. Availability of the source does not establish permission to
redistribute or commercially use every model, image, sound or generated output.
Third-party code and assets retain their respective terms; review them before
redistribution or production use.

See [asset credits](game/public/assets/CREDITS.md),
[audio notice](game/public/assets/audio/NOTICE.md), and
[derivative provenance](game/public/assets/derivatives/). Audio records conditional
prototype status under the Stability AI Community License and Gemma terms, not
production/commercial clearance. Historical “unapproved” or “not game-ready”
asset flags remain as recorded. This snapshot is not a licensing audit.
