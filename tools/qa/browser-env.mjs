// Shared browser launcher for QA scripts (worker-only tooling, never shipped).
// Chromium cannot start in this worker: Docker seccomp blocks unprivileged user namespaces
// ("No usable sandbox!") and the task forbids --no-sandbox. Firefox runs with its own default
// sandbox (seccomp-bpf; it logs that the optional user-namespace layer is unavailable).
// Firefox headless has no native GL, so it runs headful on a user-space Xvfb display.
// GTK/Mesa/Xvfb shared libraries were extracted in user space (apt-get download + dpkg -x into
// ~/.local/ll-ff-libs), never installed system-wide. Xvfb-ll is a byte-patched copy whose only
// change is the xkbcomp directory (/usr/bin -> /tmp/llx), because xkbcomp is not at /usr/bin.
// Mesa llvmpipe provides CPU-only WebGL: functional proof, not a GPU performance benchmark.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer';

const libRoot = path.join(os.homedir(), '.local/ll-ff-libs/root');
const libDir = path.join(libRoot, 'usr/lib/x86_64-linux-gnu');
export const DISPLAY = ':97';

export function firefoxPath() {
  const base = path.join(os.homedir(), '.cache/puppeteer/firefox');
  const dir = fs.readdirSync(base).sort().reverse().find(d => fs.existsSync(path.join(base, d, 'firefox/firefox')));
  if (!dir) throw new Error('Firefox not installed: run npx puppeteer browsers install firefox');
  return path.join(base, dir, 'firefox/firefox');
}

function displayUp() {
  return new Promise(resolve => {
    const s = net.connect('/tmp/.X11-unix/X' + DISPLAY.slice(1));
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

export async function ensureDisplay() {
  if (await displayUp()) return;
  fs.mkdirSync('/tmp/llx', {recursive: true});
  fs.writeFileSync('/tmp/llx/xkbcomp', `#!/bin/sh\nLD_LIBRARY_PATH=${libDir} exec ${libRoot}/usr/bin/xkbcomp "$@"\n`, {mode: 0o755});
  const log = fs.openSync('/tmp/ll-xvfb.log', 'a');
  const x = spawn(path.join(libRoot, 'usr/bin/Xvfb-ll'), [DISPLAY, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp', '-xkbdir', path.join(libRoot, 'usr/share/X11/xkb')], {
    env: {...process.env, LD_LIBRARY_PATH: libDir, LIBGL_DRIVERS_PATH: path.join(libDir, 'dri')}, detached: true, stdio: ['ignore', log, log],
  });
  x.unref();
  for (let i = 0; i < 50; i++) { if (await displayUp()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Xvfb did not start; see /tmp/ll-xvfb.log');
}

export async function launchBrowser({dumpio = false, protocolTimeout} = {}) {
  // Iteration 13 (primary): root CLAUDE.md "Browser QA — serial spot checks only". A browser may only be launched by the
  // process holding the workspace-wide lock, and it is closed when that lock is released.
  if (!lockHeld) throw new Error('launchBrowser: call inside withBrowserLock() (one browser QA session at a time, workspace-wide)');
  await ensureDisplay();
  const exe = firefoxPath();
  const env = {
    ...process.env,
    DISPLAY,
    LD_LIBRARY_PATH: [path.dirname(exe), libDir].join(':'),
    LIBGL_DRIVERS_PATH: path.join(libDir, 'dri'),
    __EGL_VENDOR_LIBRARY_DIRS: path.join(libRoot, 'usr/share/glvnd/egl_vendor.d'),
    XKB_CONFIG_ROOT: path.join(libRoot, 'usr/share/X11/xkb'),
  };
  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: exe, headless: false, env, dumpio,
    // llvmpipe compiles every node program synchronously on the first frames: page.evaluate may block for minutes
    ...(protocolTimeout ? {protocolTimeout} : {}),
    // webgl.force-enabled only lifts Firefox's GPU blocklist for the CPU Mesa renderer;
    // no sandbox, origin or security preference is changed.
    extraPrefsFirefox: {'webgl.force-enabled': true, 'media.autoplay.default': 0},
  });
  ownedBrowsers.add(browser);
  browser.once('disconnected', () => ownedBrowsers.delete(browser));
  return browser;
}

// Iteration 13 (primary): the workspace-wide serial browser gate (root CLAUDE.md; USER-UPDATE-04 / 05). One mkdir lock
// for every QA script / agent in this worker. The task's /workspace/shared/browser-qa.lock path does not exist here.
// - The owner (pid, command, start time) is recorded in the lock; a waiter breaks it ONLY when that pid is no longer
//   alive (stale after a crash / quota stop). A live owner is never touched, however long it runs.
// - Every browser launched inside the lock is closed in `finally` (graceful close, then SIGTERM to that OWN browser
//   process only if close hangs), including on failure and on the watchdog, before the lock is released.
// - Watchdog: a session longer than `maxMinutes` (default 15) is stopped the same way and reported as a failure.
export const LOCK_DIR = '/tmp/ll-browser-qa.lock';
const OWNER = path.join(LOCK_DIR, 'owner.json');
let lockHeld = false;
const ownedBrowsers = new Set();

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readOwner() { try { return JSON.parse(fs.readFileSync(OWNER, 'utf8')); } catch { return null; } }

async function closeOwnedBrowsers() {
  for (const b of [...ownedBrowsers]) {
    const proc = b.process?.();
    const closed = await Promise.race([b.close().then(() => true, () => false), sleep(15000).then(() => false)]);
    if (!closed && proc && proc.exitCode === null) { try { proc.kill('SIGTERM'); } catch {} }
    ownedBrowsers.delete(b);
  }
}

export async function withBrowserLock(fn, {maxMinutes = 15, waitMinutes = 20, label = path.basename(process.argv[1] ?? 'qa')} = {}) {
  if (lockHeld) throw new Error('withBrowserLock: already held by this process (no nested / parallel browser sessions)');
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(LOCK_DIR); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = readOwner();
      // owner.json is written right after mkdir: give a fresh lock a moment before judging it ownerless
      const age = (() => { try { return Date.now() - fs.statSync(LOCK_DIR).mtimeMs; } catch { return 0; } })();
      if ((owner && !pidAlive(owner.pid)) || (!owner && age > 60000)) {
        console.warn(`browser lock: breaking stale lock (owner ${owner ? `pid ${owner.pid} "${owner.label}" since ${owner.started}` : 'unrecorded'} is gone)`);
        fs.rmSync(LOCK_DIR, {recursive: true, force: true});
        continue;
      }
      if (Date.now() - t0 > waitMinutes * 60000) throw new Error(`browser lock timeout: held by ${owner ? `pid ${owner.pid} "${owner.label}"` : 'unknown'}`);
      if (i % 60 === 0) console.log(`waiting for the browser lock (held by ${owner ? `pid ${owner.pid} "${owner.label}"` : '?'})`);
      await sleep(1000);
    }
  }
  fs.writeFileSync(OWNER, JSON.stringify({pid: process.pid, label, argv: process.argv.slice(1), started: new Date().toISOString(), maxMinutes}));
  lockHeld = true;
  let timer;
  try {
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`browser QA watchdog: session exceeded ${maxMinutes} min; owned browser closed`)), maxMinutes * 60000);
      timer.unref?.();
    });
    return await Promise.race([fn(), watchdog]);
  } finally {
    clearTimeout(timer);
    await closeOwnedBrowsers();
    lockHeld = false;
    if (readOwner()?.pid === process.pid) fs.rmSync(LOCK_DIR, {recursive: true, force: true});
  }
}
