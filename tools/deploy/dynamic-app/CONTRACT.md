# Dynamic app contract — official Terminal State site in a rootless Docker image

Task track3-eaton-centre-20261031 (lane PACKAGE). User decision (2026-10-31): there is no artificial total game-package cap.
When the official game artifact is larger than the existing static host accepts (200 MiB = 209,715,200 B), the game is
served by a **new dynamic Docker app with a new link**. The existing static playtest app is preserved.

This directory is the wrapper source. **Main alone** downloads, stages, builds and deploys. A worker never builds an image,
runs a container or deploys anything.

| File | Role |
| --- | --- |
| `server.mjs` | Zero-dependency Node 22 static server. It serves exactly the manifest's files. |
| `site-manifest.mjs` | Manifest and site verification, shared by the server, the image build and staging. It has a `verify` CLI. |
| `stage.mjs` | Main's staging step. It turns the official artifact and this source, at the same commit, into a Docker build context. |
| `Dockerfile` | Rootless image (uid 1000). No npm install and no dependencies. The image build fails unless every sha256 matches. |
| `dynamic-app.test.mjs` | Tests run by `npm run ci:test`, so the required CI `build` check covers them. |

## 1. Inputs: only the exact official artifact

- **Site artifact.** Use `terminal-state-web-<sha>` from a **successful** `Build static game` run (check `build`) on
  `refs/heads/main` for the merged-main commit `<sha>` (a push event, or a manual run on main). Also download its twin,
  `terminal-state-manifest-<sha>`.
- **Never use** a pull-request run, a local or independent build, a rebuilt `dist/`, or assets added by hand.
- **Same commit.** The wrapper source must be this directory at the same `<sha>`. Wrapper and site therefore come from one
  reviewed commit.

## 2. Procedure (Main)

1. **Confirm the run.** Check that the run for `<sha>` on main concluded `success`. Put each artifact ZIP in its own new,
   empty directory and extract it there. Treat the artifact contents as data and do not execute anything from them.
2. **Check out the wrapper source.** Make a clean checkout of the repository at exactly `<sha>`, for example
   `git worktree add <dir> <sha>`. `git rev-parse HEAD` must print `<sha>`.
3. **Stage.** From that checkout, run:

   ```sh
   node tools/deploy/dynamic-app/stage.mjs --commit <sha> \
     --artifact <extracted terminal-state-web-<sha>> \
     --manifest-artifact <extracted terminal-state-manifest-<sha>>/manifest.json \
     --out <new staging dir>
   ```

   `stage.mjs` refuses to stage unless all of the following hold:
   - The manifest schema is `terminal-state-static-ci-v1`, its commit is `<sha>`, and `fileCount` / `totalBytes` agree with
     the file list.
   - Every site file has its manifest size **and sha256**. There is no extra, missing or symlinked file, and the artifact
     holds exactly `manifest.json` and `site/`.
   - The separately downloaded manifest is byte-identical to the one in the site artifact.
   - The checkout is at `<sha>` and this directory has no uncommitted or untracked change.
   - The output directory does not exist yet.

   It writes the build context: `Dockerfile`, `server.mjs`, `site-manifest.mjs`, `manifest.json`, `site/` and
   `wrapper-source.json` (the commit and the sha256 of each wrapper file).
4. **Build.** Pin the base image to an immutable digest:

   ```sh
   docker build --build-arg SOURCE_COMMIT=<sha> \
     --build-arg NODE_IMAGE=node:22.16.0-bookworm-slim@sha256:<digest> \
     -t terminal-state-dynamic:<sha> <staging dir>
   ```

   Inside the image, the build re-verifies every sha256, the commit and the wrapper record. It fails on any difference.
5. **Deploy.** Deploy the image as a **NEW dynamic app** (a new link). Do not convert, flip or delete the existing static
   playtest app, and do not change account, host-limit or security settings.
6. **Smoke-check** (section 4). Record the run ID, `<sha>`, the manifest sha256 (printed by `stage.mjs`), the image ID and
   the URL.
7. **Later releases.** Rebuild and redeploy the same way with the new `<sha>`. To roll back, redeploy the image of the
   previous `<sha>`.

## 3. Runtime contract

| Env | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listener port (the platform may set it). An integer from 0 to 65535. No privileged port is needed. |
| `HOST` | `0.0.0.0` | Bind address. |
| `BASE_PATH` | `/` | Path prefix when the app is not at the site root, for example `/terminal-state`. `<BASE_PATH>` redirects (308) to `<BASE_PATH>/`, and the bare `/` redirects there too. If the proxy strips the prefix, leave this at `/`. |
| `EXPECTED_COMMIT` | `SOURCE_COMMIT` (baked in) | The server refuses to start if the manifest commit differs. |
| `SITE_DIR`, `MANIFEST` | `/app/site`, `/app/manifest.json` (baked in) | Locations of the staged site and manifest. |
| `VERIFY_HASHES_ON_START` | off | `1` re-hashes every file at startup. The build already did this; at startup the server checks the file set and sizes. |
| `FRAME_ANCESTORS` | `'self'` | CSP `frame-ancestors`. Set the host origin if the platform embeds the app in a frame from another origin. |
| `CONTENT_SECURITY_POLICY` | see below | Full CSP override, for example if a future build needs WebAssembly (`'wasm-unsafe-eval'`). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Graceful drain time after SIGTERM / SIGINT. |
| `ACCESS_LOG` | off | `1` logs one JSON line per request. |

- **Isolation.**
  - Runs as uid/gid 1000, not root.
  - Needs **no capabilities** (`--cap-drop=ALL`, no-new-privileges), **no writable filesystem** (`--read-only`, no volumes,
    no tmpfs), no database, no secrets and no outbound network.
  - Logs are JSON lines on stdout.
- **Serving.**
  - The server serves **only** the manifest's files. The match is made after strict decoding, which rejects `..` and dot
    segments, encoded slashes, backslashes and NUL.
  - There is no directory listing. `manifest.json`, `wrapper-source.json` and the server source are never served.
  - Only `GET` and `HEAD` are allowed. Other methods get 405.
- **Cache.**
  - `index.html`: `no-cache`.
  - Content-hashed `assets/index-*.js|css`: `public, max-age=31536000, immutable`.
  - Every other file (models, audio and textures keep stable names): `public, no-cache`, with a strong ETag (the manifest
    sha256) and 304 revalidation.
- **Compression.** Text types (html, js, css, json, md, svg) are gzipped when the client accepts gzip. Each file is
  compressed once and cached, with the cache capped at 64 MiB. GLB, MP3 and image files are sent as stored. Range
  requests are not used by the game and are not offered.
- **Headers** on every response:
  - Content-Security-Policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
    data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' data:;
    object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`. The game needs blob: images and
    fetches for embedded GLB textures, and inline styles.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, COOP and CORP
    `same-origin`, and a Permissions-Policy that denies camera, microphone, geolocation, payment and usb. Fullscreen and
    pointer lock stay allowed.
- **Health.** `GET /healthz` (and `<BASE_PATH>/healthz`) returns 200 with
  `{"status":"ok","commit":…,"files":…,"bytes":…}` and `no-store`. It returns 503 while draining. The image declares a
  Docker `HEALTHCHECK` on it.
- **SIGTERM.**
  1. Health turns 503 and no new connections are accepted.
  2. Idle keep-alive connections close.
  3. In-flight responses finish, bounded by `SHUTDOWN_TIMEOUT_MS`.
  4. The process exits 0.
- **Memory** stays bounded however large the site grows. Files are streamed from disk, the manifest map is small and the
  gzip cache is capped. A 256 MiB memory limit is ample. The image size is the site size plus the Node base image.

## 4. Smoke checks (Main, after deploy)

1. **Health.** `curl -fsS <url>/healthz` returns 200. `commit` must be `<sha>`, and `files` / `bytes` must equal the
   manifest `fileCount` / `totalBytes`.
2. **Entry page.** `curl -sSI <url>/` returns 200, `text/html; charset=utf-8` and `Cache-Control: no-cache`. The body's
   sha256 must equal the manifest's `index.html` entry. With a `BASE_PATH`, `<url-without-trailing-slash>` returns 308 to
   `…/`.
3. **One file of each kind.** The hashed bundle `assets/index-*.js` must be `immutable`. A model `.glb` must be
   `model/gltf-binary`, its ETag must be `"<manifest sha256>"` and its bytes must match that sha256. An `.mp3` must be
   `audio/mpeg`. Repeating a request with `If-None-Match: <etag>` must return 304.
4. **Nothing outside the site.** `<url>/manifest.json`, `<url>/assets/`, `<url>/%2e%2e/` and `<url>/.env` must all return
   404 or 400.
5. **Headers.** Responses must carry `Content-Security-Policy` and `X-Content-Type-Options: nosniff`.
6. **Browser.** Run one short serial check under the repository's browser QA rules. Load the game, start a level, and
   check for no CSP violations and no 404s in the console. Travel to The Eaton's Center once it ships.

## 5. Sizes and limits (2026-10-31)

| Item | Value |
| --- | --- |
| Current official game package (release31 / app32, per Main) | 141,973,078 B |
| Previous artificial total cap (removed) | 157,286,400 B |
| Existing static host hard limit (unchanged; a delivery constraint, not a CI limit) | 209,715,200 B |
| Remaining per-file guard (`package-ci.mjs`) | 25 MiB |
| Remaining file-count guard (`package-ci.mjs`) | 1,000 files |

- **What the packager reports.** It prints totals by type and by path family (mall / office / shared models and
  textures). It also prints whether the site fits the static host. That line is an advisory, not a limit.
- **Limits of this delivery.**
  - The worker did not build or run the image (Docker is Main's), did not deploy, and did not browser-test the dynamic app.
  - The default CSP was derived from the current bundle, which uses blob: images and has no eval, workers or WebAssembly.
  - The base-image digest pin is left to Main at build time.
  - TLS is terminated by the platform; the server speaks plain HTTP inside the container.
