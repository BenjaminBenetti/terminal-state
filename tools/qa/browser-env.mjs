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

export async function launchBrowser({dumpio = false} = {}) {
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
  return puppeteer.launch({
    browser: 'firefox', executablePath: exe, headless: false, env, dumpio,
    // webgl.force-enabled only lifts Firefox's GPU blocklist for the CPU Mesa renderer;
    // no sandbox, origin or security preference is changed.
    extraPrefsFirefox: {'webgl.force-enabled': true, 'media.autoplay.default': 0},
  });
}

// Serialize browser use between concurrent QA scripts in this worker. The task's
// /workspace/shared/browser-qa.lock path does not exist here, so a worker-local lock is used.
export async function withBrowserLock(fn) {
  const lock = '/tmp/ll-browser-qa.lock';
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; } catch {
      if (i > 1200) throw new Error('browser lock timeout');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, {recursive: true, force: true}); }
}
