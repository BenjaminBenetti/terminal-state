#!/usr/bin/env python3
"""Detached, one-job-at-a-time Sound Lab queue runner (Lane S, iteration 05).

Contract (read from the kit's app/server.py 0.1.0 and the page it serves; never probed):
  GET  /api/status   -> {ready, busy, profile, limits, terms, model, kit, ...}
  POST /api/generate -> 202 {"job": {...}} | 400 validation | 409 busy / not prepared
       JSON body {prompt, negative_prompt, seconds, steps, cfg, seed}; same-origin rule only
       applies when an Origin header is sent (we send none). Host is the normal URL host.
  GET  /api/job      -> {"job": current-or-last job}  (job id "<YYYYmmddTHHMMSS>-<seed>")
  GET  /api/outputs  -> {"outputs": [{file, wav, json, prompt, seed, seconds, ...}]} (latest 40)
  GET  /outputs/<day>/<file>.wav|.json -> raw WAV / lab sidecar bytes

Rules honoured:
  * one job at a time; never starts while /api/status says busy (user jobs are waited for,
    never cancelled); a courtesy gap between our jobs lets the user's page get a turn;
  * before every POST a durable, fsynced, exclusive-create (no-overwrite) intent file;
  * the ACK (job id) and the terminal state are recorded; a lost/ambiguous ACK or terminal is
    reconciled with GETs on /api/job and /api/outputs only, never by resubmitting;
  * a definitive "no job created" answer (HTTP 409 busy) may be re-attempted later under a
    NEW intent file (attempt-N), capped; a failed generation is recorded and the runner moves on;
  * raw WAV + lab sidecar are stored byte-exact and verified against the lab's SHA-256.

Python 3 standard library only. Run detached:
  setsid nohup python3 -I tools/audio-pipeline/soundlab_runner.py >/dev/null 2>&1 &
"""
from __future__ import annotations

import datetime as dt
import hashlib
import http.client
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO = Path(os.environ.get("SOUND_LAB_AUDIO_DIR") or ROOT / "reference/tasks/vertical-slice-iteration05-20261026/audio")  # override = local harness only
QUEUE = AUDIO / "queue.json"
LEDGER = AUDIO / "ledger"
RAW = AUDIO / "raw"
LOG = AUDIO / "runner.log"
STATUS = AUDIO / "runner-status.json"
PIDFILE = AUDIO / "runner.pid"
BASE = os.environ.get("SOUND_LAB_URL", "http://10.0.0.59:7871")
GAP_S = 2.5            # courtesy gap between our jobs
BUSY_POLL_S = 5.0      # while a (user) job is running
MAX_BUSY_ATTEMPTS = 4  # definitive 409-busy rejections per clip
DOWN_LIMIT_S = 20 * 60 # lab unreachable this long -> stop (blocker)
JOB_LIMIT_S = 1900     # lab's own timeout is 1800 s
# Optional finite allowance (e.g. a task authorizing "at most N generation calls"): the total number of POSTs this queue may
# ever make, counted from the durable attempt intent files in the ledger (every POST has one, written before it is sent), so the
# cap holds across busy re-attempts, restarts and reconciliation. Unset = unlimited (previous behaviour).
MAX_POSTS = int(os.environ["SOUND_LAB_MAX_POSTS"]) if os.environ.get("SOUND_LAB_MAX_POSTS") else None


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(msg: str) -> None:
    line = f"{now()} {msg}\n"
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())


def fsync_dir(d: Path) -> None:
    fd = os.open(str(d), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_exclusive(path: Path, data: bytes) -> None:
    """Create-only (O_EXCL), fsync file + directory. Raises FileExistsError, never overwrites."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_dir(path.parent)


def write_json_exclusive(path: Path, obj) -> None:
    write_exclusive(path, (json.dumps(obj, indent=1) + "\n").encode())


def write_json_atomic(path: Path, obj) -> None:
    tmp = path.with_name("." + path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class Unreachable(Exception):
    pass


def get(path: str, timeout: float = 20.0) -> tuple[int, bytes]:
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, socket.timeout, ConnectionError, http.client.HTTPException, OSError) as e:
        raise Unreachable(str(e)) from None


def get_json(path: str):
    code, body = get(path)
    if code != 200:
        raise Unreachable(f"GET {path} -> HTTP {code}: {body[:200]!r}")
    return json.loads(body)


def post_generate(params: dict) -> tuple[str, int | None, object]:
    """Returns (kind, http_code, payload). kind: 'ack' | 'rejected' | 'refused' | 'ambiguous'."""
    body = json.dumps(params).encode()
    req = urllib.request.Request(BASE + "/api/generate", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            try:
                return ("ack" if r.status == 202 else "ambiguous"), r.status, json.loads(raw)
            except ValueError:
                return "ambiguous", r.status, raw.decode("utf-8", "replace")[:500]
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = raw.decode("utf-8", "replace")[:500]
        return "rejected", e.code, payload
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, ConnectionRefusedError):
            return "refused", None, str(reason)  # nothing was sent: definitively no job
        return "ambiguous", None, str(reason)
    except (socket.timeout, ConnectionError, http.client.HTTPException, OSError) as e:
        return "ambiguous", None, f"{type(e).__name__}: {e}"


def params_of(clip: dict) -> dict:
    return {k: clip[k] for k in ("prompt", "negative_prompt", "seconds", "steps", "cfg", "seed")}


def same_params(job_params: dict, clip: dict) -> bool:
    try:
        return (job_params.get("prompt") == clip["prompt"] and int(job_params.get("seed")) == int(clip["seed"])
                and float(job_params.get("seconds")) == float(clip["seconds"])
                and int(job_params.get("steps")) == int(clip["steps"]) and float(job_params.get("cfg")) == float(clip["cfg"]))
    except (TypeError, ValueError):
        return False


class Runner:
    def __init__(self) -> None:
        self.status_snapshot: dict | None = None
        self.down_since: float | None = None
        self.counts = {"done": 0, "failed": 0, "lost": 0, "skipped": 0}
        self.current: str | None = None
        self.superseded: dict = {}

    # ---------------- status ----------------
    def write_status(self, state: str, extra: dict | None = None) -> None:
        write_json_atomic(STATUS, {"state": state, "at": now(), "pid": os.getpid(), "current": self.current,
                                   "counts": self.counts, **(extra or {})})

    def lab_status(self) -> dict | None:
        try:
            s = get_json("/api/status")
            self.down_since = None
            return s
        except (Unreachable, ValueError) as e:
            if self.down_since is None:
                self.down_since = time.monotonic()
                log(f"lab unreachable: {e}")
            if time.monotonic() - self.down_since > DOWN_LIMIT_S:
                raise SystemExit(self.stop("blocked", f"Sound Lab unreachable for >{DOWN_LIMIT_S}s: {e}"))
            return None

    def stop(self, state: str, why: str) -> int:
        log(f"STOP {state}: {why}")
        self.write_status(state, {"reason": why})
        return 3 if state == "blocked" else 0

    def wait_idle(self) -> dict:
        announced = False
        while True:
            s = self.lab_status()
            if s is None:
                time.sleep(15)
                continue
            if not s.get("ready"):
                raise SystemExit(self.stop("blocked", f"Sound Lab not ready: {s.get('problems')}"))
            if not s.get("busy"):
                return s
            if not announced:
                log("lab busy (another job is running); waiting, not interfering")
                announced = True
            self.write_status("waiting-busy")
            time.sleep(BUSY_POLL_S)

    # ---------------- ledger ----------------
    def cdir(self, cid: str) -> Path:
        return LEDGER / cid

    def attempts(self, cid: str) -> list[int]:
        d = self.cdir(cid)
        if not d.is_dir():
            return []
        return sorted(int(p.name.split(".")[0].split("-")[1]) for p in d.glob("attempt-*.intent.json"))

    def terminal(self, cid: str) -> dict | None:
        p = self.cdir(cid) / "terminal.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def record_terminal(self, cid: str, obj: dict) -> None:
        write_json_exclusive(self.cdir(cid) / "terminal.json", {"clip": cid, "at": now(), **obj})

    # ---------------- job following ----------------
    def follow(self, clip: dict, job_id: str | None) -> dict | None:
        """Poll GET /api/job until our job (matched by id, else params) leaves 'running'.
        Returns the final job dict, or None if it can no longer be seen there."""
        t0 = time.monotonic()
        while time.monotonic() - t0 < JOB_LIMIT_S:
            try:
                job = get_json("/api/job").get("job")
            except (Unreachable, ValueError) as e:
                log(f"{clip['id']}: GET /api/job failed ({e}); retrying")
                time.sleep(3)
                continue
            if not job:
                return None
            ours = (job_id and job.get("id") == job_id) or (not job_id and same_params(job.get("params") or {}, clip))
            if not ours:
                return None  # replaced by a later (user) job: reconcile through /api/outputs
            if job.get("state") != "running":
                return job
            time.sleep(1.0)
        return None

    def find_output(self, clip: dict) -> dict | None:
        try:
            outs = get_json("/api/outputs").get("outputs") or []
        except (Unreachable, ValueError):
            return None
        for o in outs:
            try:
                if (o.get("prompt") == clip["prompt"] and int(o.get("seed")) == int(clip["seed"])
                        and float(o.get("seconds")) == float(clip["seconds"]) and int(o.get("steps")) == int(clip["steps"])
                        and float(o.get("cfg")) == float(clip["cfg"])):
                    return o
            except (TypeError, ValueError):
                continue
        return None

    def download(self, clip: dict, wav_rel: str, json_rel: str, job: dict | None, how: str) -> None:
        cid = clip["id"]
        code, wav = get("/" + wav_rel.lstrip("/"), timeout=120)
        code2, side = get("/" + json_rel.lstrip("/"), timeout=60)
        if code != 200 or code2 != 200:
            raise Unreachable(f"download HTTP {code}/{code2}")
        lab = json.loads(side)
        digest = sha256(wav)
        if lab.get("wav_sha256") != digest or int(lab.get("wav_bytes", -1)) != len(wav):
            raise ValueError(f"hash/size mismatch vs lab sidecar ({digest} / {len(wav)})")
        if not same_params(lab.get("request") or {}, clip):
            raise ValueError("lab sidecar request does not match the planned clip")
        lab_file = lab.get("file") or wav_rel.rsplit("/", 1)[-1]
        wav_path, labjson_path = RAW / f"{cid}.wav", RAW / f"{cid}.lab.json"
        if wav_path.exists():
            if sha256(wav_path.read_bytes()) != digest:
                raise ValueError(f"{wav_path} exists with different bytes; refusing to overwrite")
        else:
            write_exclusive(wav_path, wav)
        if not labjson_path.exists():
            write_exclusive(labjson_path, side)
        s = self.status_snapshot or {}
        sidecar = {
            "clip": cid, "cue": clip["cue"], "rawFile": wav_path.name, "rawBytes": len(wav), "rawSha256": digest,
            "labSidecarFile": labjson_path.name, "labSidecarSha256": sha256(side), "labFile": lab_file,
            "labUrl": f"{BASE}/{wav_rel.lstrip('/')}",
            "request": lab.get("request"), "planned": params_of(clip),
            "prompt": clip["prompt"], "seed": clip["seed"], "steps": clip["steps"], "cfg": clip["cfg"], "seconds": clip["seconds"],
            "audio": lab.get("audio"),
            "model": {"modelCard": (lab.get("model") or {}).get("model_card"), "weightsRepo": (lab.get("model") or {}).get("weights_repo"),
                      "revision": (lab.get("model") or {}).get("revision"), "profile": (lab.get("model") or {}).get("profile"),
                      "profileLabel": (lab.get("model") or {}).get("profile_label")},
            "kit": s.get("kit"), "upstreamCode": (lab.get("runtime") or {}).get("upstream_code"),
            "license": {**(lab.get("license") or {}), "statusFromApiStatusTerms": (s.get("terms") or {}).get("status"),
                        "projectStatus": "Conditional prototype status (Stability AI Community License + Gemma terms). Not production or commercial clearance."},
            "job": {"id": (job or {}).get("id"), "state": (job or {}).get("state"), "startedAt": (job or {}).get("started_at"),
                    "finishedAt": (job or {}).get("finished_at"), "elapsedS": ((job or {}).get("result") or {}).get("elapsed_s")},
            "labTiming": lab.get("timing"), "obtainedVia": how, "downloadedAt": now(),
            "review": "Unreviewed raw Sound Lab generation; not auditioned by Lane S (no listening on this worker).",
            "derivatives": [],
        }
        p = RAW / f"{cid}.sidecar.json"
        if not p.exists():
            write_json_exclusive(p, sidecar)
        self.record_terminal(cid, {"state": "done", "jobId": (job or {}).get("id"), "rawSha256": digest, "labFile": lab_file, "via": how})
        self.counts["done"] += 1
        log(f"{cid}: done ({how}) {lab_file} sha256={digest[:12]} elapsed={((job or {}).get('result') or {}).get('elapsed_s')}")

    def fetch(self, clip: dict, wav_rel: str, json_rel: str, job: dict | None, how: str) -> None:
        for k in range(6):
            try:
                self.download(clip, wav_rel, json_rel, job, how)
                return
            except Unreachable as e:
                log(f"{clip['id']}: download failed ({e}); retry {k + 1}")
                time.sleep(5 * (k + 1))
            except ValueError as e:
                self.record_terminal(clip["id"], {"state": "failed", "jobId": (job or {}).get("id"), "error": f"download verification: {e}"})
                self.counts["failed"] += 1
                log(f"{clip['id']}: download verification FAILED: {e}")
                return
        self.record_terminal(clip["id"], {"state": "lost", "jobId": (job or {}).get("id"), "note": f"output {wav_rel} not downloadable after retries; not resubmitted"})
        self.counts["lost"] += 1

    def settle(self, clip: dict, job_id: str | None, how: str) -> None:
        """Follow a submitted/ambiguous job to a terminal record (GET-only)."""
        cid = clip["id"]
        job = self.follow(clip, job_id)
        if job and job.get("state") == "done" and job.get("result"):
            self.fetch(clip, job["result"]["wav"], job["result"]["json"], job, how)
            return
        if job and job.get("state") == "failed":
            self.record_terminal(cid, {"state": "failed", "jobId": job.get("id"), "error": job.get("error")})
            self.counts["failed"] += 1
            log(f"{cid}: FAILED job {job.get('id')}: {str(job.get('error'))[:300]}")
            return
        o = self.find_output(clip)
        if o and o.get("json"):
            self.fetch(clip, o["wav"], o["json"], job, how + "+outputs-reconcile")
            return
        self.record_terminal(cid, {"state": "lost", "jobId": job_id, "note": "No matching job or output found by GET; not resubmitted."})
        self.counts["lost"] += 1
        log(f"{cid}: LOST (job {job_id}); recorded, not resubmitted")

    # ---------------- main loop ----------------
    def reconcile_pending(self, clip: dict) -> bool:
        """Clip has intents but no terminal. Returns True if resolved (terminal written)."""
        cid = clip["id"]
        n = self.attempts(cid)[-1]
        d = self.cdir(cid)
        ack = d / f"attempt-{n}.ack.json"
        rej = d / f"attempt-{n}.rejected.json"
        if rej.exists():
            return False  # definitive non-creation; caller may re-attempt (capped)
        job_id = json.loads(ack.read_text(encoding="utf-8")).get("jobId") if ack.exists() else None
        log(f"{cid}: reconciling attempt-{n} (job {job_id}) by GET only")
        self.settle(clip, job_id, "reconcile")
        return True

    def run_clip(self, clip: dict) -> None:
        cid = clip["id"]
        self.current = cid
        if self.terminal(cid):
            self.counts["skipped"] += 1
            return
        if self.attempts(cid) and self.reconcile_pending(clip):
            return
        sup = self.superseded.get(cid)
        if sup and not self.attempts(cid):
            self.record_terminal(cid, {"state": "superseded-not-submitted", **sup})
            self.counts["skipped"] += 1
            log(f"{cid}: superseded before submission ({sup.get('replacement')})")
            return
        while True:
            prior = self.attempts(cid)
            if MAX_POSTS is not None and len(list(LEDGER.glob("*/attempt-*.intent.json"))) >= MAX_POSTS:
                raise SystemExit(self.stop("blocked", f"generation allowance exhausted: {MAX_POSTS} POSTs already intended; not submitting {cid}"))
            if len(prior) >= MAX_BUSY_ATTEMPTS:
                self.record_terminal(cid, {"state": "failed", "error": f"{len(prior)} definitive busy rejections; giving up on this clip"})
                self.counts["failed"] += 1
                return
            self.status_snapshot = self.wait_idle()
            n = (prior[-1] if prior else 0) + 1
            d = self.cdir(cid)
            s = self.status_snapshot
            intent = {"clip": cid, "attempt": n, "cue": clip["cue"], "request": params_of(clip),
                      "profile": s.get("profile"), "kit": s.get("kit"), "modelRevision": (s.get("model") or {}).get("revision"),
                      "endpoint": BASE + "/api/generate", "intentAt": now(), "statusAtIntent": {"ready": s.get("ready"), "busy": s.get("busy")}}
            write_json_exclusive(d / f"attempt-{n}.intent.json", intent)
            self.write_status("submitting")
            kind, code, payload = post_generate(params_of(clip))
            if kind == "ack":
                job = (payload or {}).get("job") or {}
                write_json_exclusive(d / f"attempt-{n}.ack.json", {"at": now(), "http": code, "jobId": job.get("id"), "job": job})
                log(f"{cid}: ACK job {job.get('id')} seed={clip['seed']} {clip['seconds']}s")
                self.write_status("running")
                self.settle(clip, job.get("id"), "ack")
                return
            if kind in ("rejected", "refused"):
                err = payload.get("error") if isinstance(payload, dict) else payload
                write_json_exclusive(d / f"attempt-{n}.rejected.json", {"at": now(), "http": code, "kind": kind, "error": err})
                log(f"{cid}: attempt-{n} rejected ({code} {kind}): {str(err)[:200]}")
                if code == 409 and "already running" in str(err).lower():
                    time.sleep(BUSY_POLL_S)
                    continue  # definitive: no job created; re-attempt under a new intent
                if kind == "refused":
                    time.sleep(30)
                    continue
                if code == 400:  # validation error for this clip only
                    self.record_terminal(cid, {"state": "failed", "http": code, "error": err})
                    self.counts["failed"] += 1
                    return
                # 403 Host/Origin, 409 not prepared, 413/415/404: a real blocker, not a per-clip failure
                raise SystemExit(self.stop("blocked", f"Sound Lab refused ({code}): {err}"))
            # ambiguous: request may or may not have been processed -> GET-only reconciliation
            write_json_exclusive(d / f"attempt-{n}.ambiguous.json", {"at": now(), "http": code, "detail": payload})
            log(f"{cid}: attempt-{n} ambiguous ({payload}); reconciling by GET")
            time.sleep(3)
            self.settle(clip, None, "ambiguous")
            return

    def main(self, only: set[str] | None) -> int:
        AUDIO.mkdir(parents=True, exist_ok=True)
        try:
            write_exclusive(PIDFILE, f"{os.getpid()}\n".encode())
        except FileExistsError:
            other = PIDFILE.read_text().strip()
            if other and Path(f"/proc/{other}").exists():
                print(f"another runner is active (pid {other})", file=sys.stderr)
                return 1
            PIDFILE.unlink()
            write_exclusive(PIDFILE, f"{os.getpid()}\n".encode())
        try:
            clips = json.loads(QUEUE.read_text(encoding="utf-8"))["clips"]
            sp = AUDIO / "superseded.json"
            self.superseded = json.loads(sp.read_text(encoding="utf-8"))["clips"] if sp.exists() else {}
            if only:
                clips = [c for c in clips if c["id"] in only]
            log(f"runner start pid={os.getpid()} clips={len(clips)}")
            for i, clip in enumerate(clips):
                had = self.terminal(clip["id"]) is not None
                self.run_clip(clip)
                self.write_status("running-queue", {"index": i + 1, "total": len(clips)})
                if not had:
                    time.sleep(GAP_S)
            self.current = None
            self.write_status("finished")
            log(f"runner finished {self.counts}")
            return 0
        finally:
            try:
                if PIDFILE.read_text().strip() == str(os.getpid()):
                    PIDFILE.unlink()
            except OSError:
                pass


if __name__ == "__main__":
    only = set(a for a in sys.argv[1:] if not a.startswith("-")) or None
    sys.exit(Runner().main(only))
