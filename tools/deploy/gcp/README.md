# Google Cloud VM deployment

Push a SemVer tag such as `v1.2.3` pointing to a commit on main. The separate
[`deploy-prod.yml`](../../../.github/workflows/deploy-prod.yml) workflow waits up
to 25 minutes for **the whole game-build workflow** to succeed on main at that
exact commit, then downloads `terminal-state-web-<sha>`. It never publishes a
local build, a PR artifact, a failed build or a different commit. Re-run a failed
deployment after CI succeeds; artifacts expire after 30 days.

This targets the dedicated **Rocky Linux 10 Compute Engine VM** at
`bbenetti@terminal-state.bbenetti.ca`. It installs distro nginx + the EPEL Brotli
module, configures automatic Let's Encrypt HTTPS, and deploys static files through
an atomic symlink. It replaces `/etc/nginx/nginx.conf`, preserving the initial
file as `nginx.conf.before-terminal-state`. It does not configure Google Cloud
firewall rules, DNS or a load balancer. No Docker, Node, build or compression runs
on the VM. The existing Everything deployment and reference Pages site are separate.

## One-time setup

The GitHub environment is **`prod`**. Its deployment branch/tag rules must allow
`v*` tags. Keep **`DEPLOY_KEY`** as its secret (an unencrypted deployment SSH
private key). Its public half must be authorized for `bbenetti` on the VM, and
`sudo -n true` must work for that user. Bootstrap installs packages, writes nginx
and systemd configuration, and needs root privileges.

Environment **variables**, not additional secrets:

| Variable | Value |
| --- | --- |
| `AUTO_CUTOFF_GB` | **Required**, positive decimal GB (`1 GB = 1,000,000,000 bytes`), e.g. `180`. Missing/zero/invalid values abort deployment. |
| `DEPLOY_KNOWN_HOSTS` | **Required**, pinned SSH host public key entry from the trusted VM console. See below. |
| `DEPLOY_HOST` | Optional, defaults to `terminal-state.bbenetti.ca`. |
| `DEPLOY_USER` | Optional, defaults to `bbenetti`. |
| `DEPLOY_PORT` | Optional, defaults to `22`. |
| `PUBLIC_DOMAIN` | Optional, defaults to `terminal-state.bbenetti.ca`. |
| `ACME_EMAIL` | Optional, certificate renewal notices. If omitted, Let's Encrypt registration has no email address. |

In your **existing trusted VM console/SSH session**, obtain the host public key:

```sh
printf '%s ' 'terminal-state.bbenetti.ca'
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

Copy the resulting single line (`terminal-state.bbenetti.ca ssh-ed25519 AAAA…`)
into `DEPLOY_KNOWN_HOSTS`. This is the **server's host key**, separate from your
deployment login key. For a custom port, start the entry with `[hostname]:port`.
The workflow always verifies this pin; it never trusts an SSH scan from the runner.

Point the domain's A record at the VM's external IP. Any AAAA record must reach
this same VM. Allow inbound TCP **22, 80 and 443** in Google Cloud; HTTP must remain
reachable for certificate renewal. Bootstrap adds HTTP/HTTPS rules to an existing
active local firewalld without disabling SELinux. Package installation on a micro
VM may take several minutes, especially the first time. No full OS upgrade runs.

## Release

After the intended commit's main CI is green, use a new version tag:

```sh
git switch main
git pull --ff-only
git tag -a v1.0.0 -m 'Terminal State 1.0.0'
git push origin v1.0.0
```

`vMAJOR.MINOR.PATCH` is required (no leading zeros); valid SemVer prerelease and
build suffixes are supported. Invalid `v*` tags fail validation without connecting
to the VM. Production deployments are serialized. A delayed tag cannot overwrite
a newer/divergent source commit. For an intentional rollback, revert on main,
let CI pass, and release that new commit under a new tag.

Original CI files remain byte-identical. CI makes Brotli quality 11 and gzip level
9 sidecars for compressible files, including GLBs, only when they are smaller.
It verifies decompression and records every representation's SHA-256. The VM
checks both manifests, every original hash and every representation hash before
switching releases. nginx negotiates Brotli/gzip at the original asset URL;
browsers decompress automatically. It does no runtime compression on the micro VM.
The workflow logs actual total transfer sizes; already-compressed JPEG/MP3 files
generally will not shrink.

`index.html` and stable-name assets have `no-cache` and nginx ETags: repeat visits
revalidate and can get **304**, retaining cached bytes. Hashed `assets/index-*.js`
and CSS have one-year immutable caching. The cutoff page has `no-store`. Browser
cache eviction/disabled caches can still cause downloads. Deployment retains the
last three releases plus the immediately previous target, and rolls the site and
nginx config back on a failed post-switch health check. TLS/bootstrap and package
installation are idempotent, not a transactional OS rollback.

## Monthly cutoff

The VM tracks its outbound NIC TX counter locally. **No Google API access scope,
service-account role, vnStat account or Cloud billing credential is required.**
`AUTO_CUTOFF_GB` counts all outbound bytes on the default NIC, including SSH and
updates, conservatively. It is **not** a Google billing meter: free allowances can
be shared by other resources and depend on destination/tier; disks, IPv4 and VM
charges remain separate. Pick a value with headroom below your desired allowance.

At the threshold, nginx serves HTTP **503** with the small page:

> Terminal State is to popular! The money has run out! The server needs more juice!

All game paths, including direct asset URLs, show that page. The monitor fast
restarts nginx once to end transfers already in flight. **SSH stays available**.
The game reopens automatically at midnight on the first of the next month in
`America/Los_Angeles` (including daylight saving). Redeploying cannot zero the
counter. Changing the environment variable and rerunning a deployment updates
the threshold while preserving usage.

The monitor samples once a second and persists state atomically under
`/var/lib/terminal-state-bandwidth/`. Normal service restarts and clean reboots
retain usage, including bytes between samples. An unclean reboot, corrupt/missing
established state or reset NIC counter conservatively consumes the month's
remaining budget. The next month reopens it. An unhealthy/stalled monitor stops
nginx via systemd dependency/watchdog rather than exposing uncapped assets.

**This is a download cutoff, not a hard spending cap.** Downloads can overshoot
during the one-second sample and brief restart; the fallback page, TLS, SSH and
package updates still transfer bytes after cutoff. Leave substantial headroom.
First installation includes all TX since the current boot; traffic from earlier
boots this month cannot be reconstructed. Adjust the initial limit accordingly.
The monitor assumes one default outbound NIC; changing/replacing the VM or deleting
its state requires deliberate accounting, not a fresh allowance.

Inspect usage and services on the VM:

```sh
sudo python3 /usr/local/libexec/terminal-state/bandwidth.py --status
sudo systemctl status terminal-state-bandwidth nginx certbot-renew.timer
sudo journalctl -u terminal-state-bandwidth -n 30
```

To try the fallback, temporarily set a very small `AUTO_CUTOFF_GB` (e.g. `0.001`)
and re-run deployment. Confirm `/` and an asset URL show the message, then restore
the intended value and re-run. **Do not delete usage state to test it.**

## Verification

`npm run ci:test` covers SemVer/settings, artifact selection, original and sidecar
integrity, bad paths/hashes/symlinks, monthly rollover, Pacific boundaries, crash
recovery, counter resets and the cutoff flag. Shell scripts get syntax checks.
The main build's `checks` job runs these before any artifact is releasable.

Optional real nginx integration test (Rocky Linux 10 + EPEL):

```sh
docker build -f tools/deploy/gcp/test-nginx.Dockerfile -t terminal-state-nginx-test tools/deploy/gcp
docker run --rm terminal-state-nginx-test
```

This verifies nginx syntax, TLS, Brotli/gzip negotiation and decompression, caching,
ETag/304, inaccessible sidecars/manifests, the 503 fallback at game/asset URLs, and
reopening. It creates only a local container with a temporary self-signed test
certificate; it does not contact the production VM or issue a real certificate.
