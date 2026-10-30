// Task office-props-physics-scale-20261030 (lane RACK): LOCAL PROCEDURAL rebuild of the office server rack (kind `serverRack`).
//
// User (2026-10-30 play test, #5): "Server rack model is messed up, the servers are missing or like its kinda just broken glass? ...
// it does kinda look like triangles going all wonk. There should be a mesh door you can look through, you should see distinct
// hardware in the rack, and some empty spots where loot might spawn."
//
// Why a rebuild (evidence: reference/tasks/office-props-physics-scale-20261030/evidence/RACK/before-*): the Meshy T2.5 B10 derivative
// (office-server-rack.glb, 1157 tris, one opaque material) is an EMPTY 1.23 x 2.0 x 1.48 m cabinet whose "door" is a PAINTED
// shattered-glass texture on a slab of overlapping, huge sliver triangles (z-fighting; opaque "glass"). There is no hardware to keep.
// Nothing is generated here: this script builds a real 42U 19-inch rack from hand-dimensioned boxes / tubes and paints its
// textures in code (no image / 3D generation service, no raw master read or modified). The B10 raw masters and the old derivative
// stay where they are (provenance in the sidecar).
//
// Output (plain glTF 2.0 binary, office conventions: metres, +Y up, grounded, centred, FRONT -Z like every office file;
// world/openables.ts turns it): game/public/assets/models/office-server-rack-r2.glb + sidecar
// game/public/assets/derivatives/office-server-rack-r2-20261030.json. Materials:
//   rack-body        opaque powder-coated steel (tiling 256 px texture): frame, side / top panels, plinth, door frame, shelves, chassis
//   rack-faceplates  opaque equipment fronts atlas (512 x 1024 JPEG) + LED emissive atlas (512 x 1024 PNG, ALPHA = blink class:
//                    255 steady, 170 activity, 85 heartbeat). world/rackLeds.ts swaps it for a TSL node material that blinks the LEDs.
//   rack-door-mesh   BLEND, double-sided perforated steel insert (64 px RGBA tile, ~64 % open): the see-through front door
//   rack-back-mesh   opaque rear door sharing the same tile (holes read dark)
// Layout (prop frame: front +Z): see LAYOUT (printed + written to the sidecar; world/openablesSpec.ts serverRack uses it).
//
// usage: node tools/asset-pipeline/props/build-server-rack-r2.mjs [--check]   (--check: build in memory, print, write nothing)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_GLB = 'assets/models/office-server-rack-r2.glb';
const OUT_JSON = 'assets/derivatives/office-server-rack-r2-20261030.json';
const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------------------------------------------------------------------
// Deterministic RNG + raster helpers (RGBA8 buffers)

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

class Img {
  constructor(w, h, fill = [0, 0, 0, 255]) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) this.d.set(fill, i * 4); }
  set(x, y, c, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    if (a >= 1) { this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; this.d[o + 3] = c[3] ?? 255; return; }
    for (let k = 0; k < 3; k++) this.d[o + k] = Math.round(this.d[o + k] * (1 - a) + c[k] * a);
    if (c[3] !== undefined) this.d[o + 3] = Math.max(this.d[o + 3], c[3]); // (the LED atlas: an antialiased rim keeps its blink class)
  }
  rect(x, y, w, h, c, a = 1) { for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.h, Math.ceil(y + h)); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.w, Math.ceil(x + w)); i++) this.set(i, j, c, a); }
  frame(x, y, w, h, c, a = 1) { this.rect(x, y, w, 1, c, a); this.rect(x, y + h - 1, w, 1, c, a); this.rect(x, y, 1, h, c, a); this.rect(x + w - 1, y, 1, h, c, a); }
  disc(cx, cy, r, c, a = 1) { for (let j = Math.floor(cy - r - 1); j <= Math.ceil(cy + r + 1); j++) for (let i = Math.floor(cx - r - 1); i <= Math.ceil(cx + r + 1); i++) { const dd = Math.hypot(i + 0.5 - cx, j + 0.5 - cy); if (dd <= r) this.set(i, j, c, a); else if (dd <= r + 0.8) this.set(i, j, c, a * (r + 0.8 - dd) / 0.8); } }
  noise(x, y, w, h, amt, rnd) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const o = (j * this.w + i) * 4, n = (rnd() - 0.5) * amt; for (let k = 0; k < 3; k++) this.d[o + k] = Math.max(0, Math.min(255, this.d[o + k] + n)); } }
  vgrad(x, y, w, h, c0, c1) { for (let j = 0; j < h; j++) { const t = h > 1 ? j / (h - 1) : 0; this.rect(x, y + j, w, 1, [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * t)).concat(255)); } }
  rgb() { const o = new Uint8Array(this.w * this.h * 3); for (let i = 0; i < this.w * this.h; i++) { o[i * 3] = this.d[i * 4]; o[i * 3 + 1] = this.d[i * 4 + 1]; o[i * 3 + 2] = this.d[i * 4 + 2]; } return o; }
}

// 3 x 5 pixel font (labels / port numbers; generic, no brands)
const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111', 'A': '010101111101101', 'B': '110101110101110',
  'C': '011100100100011', 'D': '110101101101110', 'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011', 'H': '101101111101101',
  'I': '111010010010111', 'K': '101101110101101', 'L': '100100100100111', 'M': '101111111101101', 'N': '110101101101101', 'O': '010101101101010',
  'P': '110101110100100', 'R': '110101110101101', 'S': '011100010001110', 'T': '111010010010010', 'U': '101101101101111', 'V': '101101101101010',
  'W': '101101111111101', 'X': '101101010101101', 'Y': '101101010010010', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100', ' ': '000000000000000',
};
function text(img, s, x, y, c, scale = 1, a = 1) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') img.rect(cx + i * scale, y + j * scale, scale, scale, c, a);
    cx += 4 * scale;
  }
  return cx - x;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Rack layout (prop frame: origin bottom-centre, front +Z, metres)

const U = 0.04445;                  // EIA-310 rack unit
const W = 0.6, D = 1.0, H = 2.0;    // a 42U, 600 x 1000 mm rack (2.0 m incl. plinth / top cover)
const Y0 = 0.09;                    // bottom of U0 (on the base frame)
const uy = k => Y0 + k * U;         // bottom of unit k
const RAIL = {front: 0.4, rear: -0.36, x0: 0.2255, x1: 0.2465};
const FACE = {z0: 0.400, z1: 0.412, half: 0.2413}; // 19-inch faceplates (482.6 mm), proud of the front rails
const CHASSIS = {half: 0.2215, z0: -0.33};
const DOOR = {z0: 0.468, z1: 0.485, mesh: 0.4765, x0: -0.298, x1: 0.298, y0: 0.075, y1: 1.992, stile: 0.032, rail: 0.045};
const PIVOT = [0.291, 0, 0.4765];
// The equipment stack, bottom up: [kind, units] — `bay` = an EMPTY bay with a cantilever shelf at its bottom (loot surface).
const STACK = [
  ['ups2u', 2], ['bay', 5], ['stor4u', 4], ['blank1u', 1], ['srv2uA', 2], ['srv1uA', 1], ['srv1uB', 1], ['bay', 4],
  ['patch1u', 1], ['cable1u', 1], ['switch1u', 1], ['blank1u', 1], ['srv2uB', 2], ['srv2uA', 2], ['kvm1u', 1], ['bay', 5],
  ['srv2uB', 2], ['srv1uA', 1], ['blank1u', 1], ['blank1u', 1], ['switch1u', 1], ['patch1u', 1], ['blank1u', 1],
];
const TOTAL_U = STACK.reduce((s, e) => s + e[1], 0);
if (TOTAL_U !== 42) throw new Error(`stack is ${TOTAL_U}U, want 42`);
const TRAY = {t: 0.003, z0: -0.16, z1: FACE.z0, half: CHASSIS.half};
const SHELF_SURF = {x: 0.195, z0: -0.135, z1: 0.37};

// ---------------------------------------------------------------------------------------------------------------------------
// Textures

const ATLAS_W = 512, ATLAS_H = 1024, PX_U = 48; // one U row = 48 px (the 19-inch face is 512 px wide)
// atlas rows (top-down, px): faceplate kinds + rail cell + swatches
const ATLAS = {};
{
  let y = 0;
  for (const [k, n] of [['ups2u', 2], ['stor4u', 4], ['srv2uA', 2], ['srv2uB', 2], ['srv1uA', 1], ['srv1uB', 1], ['switch1u', 1], ['patch1u', 1], ['cable1u', 1], ['kvm1u', 1], ['blank1u', 1], ['shelf', 1]]) {
    ATLAS[k] = {x: 0, y, w: ATLAS_W, h: n * PX_U};
    y += n * PX_U;
  }
  ATLAS.swatchY = y; // 912: swatches row (32 px cells)
}
// solid swatches (atlas x cells of 32 px in the swatch row): chassis edge, silver handle, cable blue / yellow / grey / red / black
const SW = {edge: 0, silver: 1, blue: 2, yellow: 3, grey: 4, red: 5, black: 6, rail: 7, pdu: 8};
const swatchRect = k => ({x: 4 + k * 32, y: ATLAS.swatchY + 4, w: 24, h: 24});
const RAIL_CELL = {x: 320, y: ATLAS.swatchY, w: 16, h: PX_U}; // one U of rail with its 3 square holes

const C = {
  black: hex('#17191c'), dark: hex('#22252a'), grey: hex('#3a3e44'), mid: hex('#5d636b'), silver: hex('#9aa0a6'), light: hex('#c9cdd1'),
  port: hex('#0b0c0d'), white: hex('#e6e6e0'), blue: hex('#2d63b8'), yellow: hex('#d9b21c'), red: hex('#a3261d'), green: hex('#2f7a3b'),
  lcd: hex('#1f3a3a'), label: hex('#e8e4d6'),
};
const LED = {green: [60, 255, 110], amber: [255, 170, 30], blue: [70, 150, 255], red: [255, 50, 35], white: [220, 235, 255]};
const CLS = {steady: 255, activity: 170, heartbeat: 85};

function paintAtlas() {
  const rnd = mulberry32(20261030);
  const a = new Img(ATLAS_W, ATLAS_H, C.dark);
  const e = new Img(ATLAS_W, ATLAS_H, [0, 0, 0, 0]);
  // an LED: an 8 x 8 px cell (aligned to the 8 px grid world/rackLeds.ts hashes), dot r ~2.3 px; base colour shows the lens
  const led = (cx, cy, col, cls = CLS.steady, on = true) => {
    const gx = Math.floor(cx / 8) * 8 + 4, gy = Math.floor(cy / 8) * 8 + 4;
    a.disc(gx, gy, 2.4, [Math.round(col[0] * 0.35 + 30), Math.round(col[1] * 0.35 + 30), Math.round(col[2] * 0.35 + 30), 255]);
    if (on) { e.disc(gx, gy, 2.3, [...col, cls]); e.disc(gx, gy, 3.4, [Math.round(col[0] * 0.25), Math.round(col[1] * 0.25), Math.round(col[2] * 0.25), cls], 0.6); }
  };
  const ears = (r, col = C.black) => {
    for (const x of [0, ATLAS_W - 16]) {
      a.rect(x, r.y, 16, r.h, col);
      a.rect(x + (x ? 0 : 15), r.y, 1, r.h, C.port, 0.6);
      for (let u = 0; u < r.h / PX_U; u++) for (const yy of [10, 38]) { a.disc(x + 8, r.y + u * PX_U + yy, 3.2, C.silver); a.rect(x + 6, r.y + u * PX_U + yy - 0.5, 5, 1, C.port); }
    }
  };
  const vents = (x, y, w, h, col = C.port, pitch = 6, rr = 1.6) => { for (let j = y + pitch / 2, row = 0; j < y + h; j += pitch * 0.87, row++) for (let i = x + (row % 2 ? pitch / 2 : 0) + pitch / 2; i < x + w; i += pitch) a.disc(i, j, rr, col); };
  const slots = (x, y, w, h, n, col = C.port) => { const p = h / n; for (let k = 0; k < n; k++) a.rect(x, y + k * p + p * 0.3, w, p * 0.4, col); };
  const bezel = (r, col) => { a.rect(r.x + 16, r.y, r.w - 32, r.h, col); a.noise(r.x + 16, r.y, r.w - 32, r.h, 10, rnd); a.rect(r.x + 16, r.y, r.w - 32, 1, C.light, 0.18); a.rect(r.x + 16, r.y + r.h - 1, r.w - 32, 1, C.port, 0.5); };
  const sticker = (x, y, s) => { a.rect(x, y, s.length * 4 + 3, 8, C.label); text(a, s, x + 2, y + 2, C.port); };
  const sled = (x, y, w, h, leds = 2) => {
    a.rect(x, y, w, h, C.grey); a.frame(x, y, w, h, C.port);
    a.rect(x + 2, y + 2, w - 4, Math.min(8, h * 0.18), C.mid);              // latch
    vents(x + 2, y + 12, w - 4, h - 16, C.port, 4, 1);
    if (leds) { led(x + 4, y + h - 6, LED.green, CLS.activity); if (leds > 1) led(x + w - 6, y + h - 6, LED.blue, CLS.steady, rnd() < 0.85); }
  };
  // --- UPS 2U: grille, LCD, buttons, ONLINE + load LEDs
  { const r = ATLAS.ups2u; bezel(r, C.black); ears(r);
    vents(r.x + 24, r.y + 8, 300, r.h - 16, C.port, 7, 2.2);
    a.rect(340, r.y + 18, 70, 30, C.lcd); a.frame(340, r.y + 18, 70, 30, C.grey); text(a, '230V', 346, r.y + 24, [110, 200, 170, 255]); text(a, 'LOAD 34', 346, r.y + 34, [110, 200, 170, 255]);
    e.rect(341, r.y + 19, 68, 28, [16, 40, 34, CLS.steady]);
    for (const [k, col] of [[0, C.grey], [1, C.grey], [2, C.red]]) a.disc(430 + k * 18, r.y + 34, 6, col);
    led(430, r.y + 14, LED.green); led(446, r.y + 14, LED.green); led(462, r.y + 14, LED.amber, CLS.heartbeat);
    sticker(26, r.y + r.h - 14, 'UPS 3000'); }
  // --- storage 4U: 12 x 3.5-inch bays (3 rows x 4), control strip at the left
  { const r = ATLAS.stor4u; bezel(r, C.black); ears(r);
    a.rect(20, r.y + 6, 40, r.h - 12, C.grey); led(28, r.y + 14, LED.green); led(44, r.y + 14, LED.blue, CLS.heartbeat); a.disc(36, r.y + 40, 6, C.silver); sticker(22, r.y + r.h - 16, 'NAS');
    const bw = 104, bh = 58;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      const x = 66 + col * (bw + 4), y = r.y + 8 + row * (bh + 4);
      const empty = row === 2 && col === 3;
      if (empty) { a.rect(x, y, bw, bh, C.port); a.frame(x, y, bw, bh, C.grey); continue; }
      a.rect(x, y, bw, bh, C.grey); a.frame(x, y, bw, bh, C.port); vents(x + 30, y + 6, bw - 36, bh - 12, C.port, 5, 1.3);
      a.rect(x + 4, y + 4, 22, bh - 8, C.mid); a.rect(x + 8, y + bh / 2 - 2, 14, 4, C.port);
      led(x + 6, y + 6, LED.green, CLS.activity); led(x + 14, y + 6, LED.blue, CLS.steady, rnd() < 0.8);
    } }
  // --- 2U server A: 24 vertical 2.5-inch sleds, control panel left, vent right
  { const r = ATLAS.srv2uA; bezel(r, C.dark); ears(r);
    a.rect(20, r.y + 6, 34, r.h - 12, C.grey); led(28, r.y + 12, LED.green); led(28, r.y + 28, LED.blue, CLS.heartbeat); a.rect(24, r.y + 60, 10, 6, C.port); sticker(22, r.y + r.h - 14, '2U');
    for (let k = 0; k < 24; k++) sled(58 + k * 15.5, r.y + 6, 14, r.h - 12, 1);
    vents(434, r.y + 8, 60, r.h - 16, C.port, 6, 1.8); }
  // --- 2U server B: 2 x 4 3.5-inch bays left, grille + status LCD right
  { const r = ATLAS.srv2uB; bezel(r, C.grey); ears(r, C.grey);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) sled(22 + col * 62, r.y + 6 + row * 42, 60, 40, 2);
    a.rect(276, r.y + 6, 212, r.h - 12, C.dark); vents(280, r.y + 10, 150, r.h - 20, C.port, 6, 2);
    a.rect(440, r.y + 16, 44, 18, C.lcd); e.rect(441, r.y + 17, 42, 16, [20, 60, 70, CLS.steady]); text(a, 'OK', 446, r.y + 22, [120, 220, 230, 255]);
    led(444, r.y + 50, LED.green); led(460, r.y + 50, LED.amber, CLS.heartbeat, rnd() < 0.5); a.disc(476, r.y + 70, 6, C.silver); }
  // --- 1U server A: 8 2.5-inch bays, vent, power
  { const r = ATLAS.srv1uA; bezel(r, C.dark); ears(r);
    for (let k = 0; k < 8; k++) { const x = 22 + k * 40; a.rect(x, r.y + 6, 38, 36, C.grey); a.frame(x, r.y + 6, 38, 36, C.port); vents(x + 12, r.y + 10, 24, 28, C.port, 4, 1); a.rect(x + 3, r.y + 9, 7, 30, C.mid); led(x + 3, r.y + 6, LED.green, CLS.activity); }
    vents(350, r.y + 8, 100, 32, C.port, 5, 1.5); a.disc(470, r.y + 24, 6, C.silver); led(482, r.y + 10, LED.green); led(482, r.y + 26, LED.blue, CLS.heartbeat); }
  // --- 1U server B: silver front, 4 3.5-inch bays, slots
  { const r = ATLAS.srv1uB; bezel(r, C.silver); ears(r, C.mid);
    for (let k = 0; k < 4; k++) { const x = 22 + k * 76; a.rect(x, r.y + 6, 74, 36, C.dark); a.frame(x, r.y + 6, 74, 36, C.port); slots(x + 26, r.y + 10, 44, 28, 5); a.rect(x + 4, r.y + 10, 18, 28, C.grey); led(x + 6, r.y + 8, LED.green, CLS.activity); }
    slots(330, r.y + 8, 120, 32, 6, C.dark); a.disc(470, r.y + 24, 6, C.dark); led(482, r.y + 10, LED.green); led(482, r.y + 26, LED.amber, CLS.heartbeat, rnd() < 0.4); }
  // --- 1U switch: 48 RJ45 (2 x 24, groups of 12) with link / activity LEDs, 4 SFP cages, console, status
  { const r = ATLAS.switch1u; bezel(r, C.dark); ears(r);
    led(24, r.y + 8, LED.green); led(24, r.y + 24, LED.green, CLS.heartbeat); led(24, r.y + 40, LED.amber, CLS.steady, rnd() < 0.3);
    a.rect(36, r.y + 14, 14, 10, C.port); text(a, 'CON', 36, r.y + 28, C.light);
    for (let row = 0; row < 2; row++) for (let k = 0; k < 24; k++) {
      const x = 58 + k * 14.4 + Math.floor(k / 12) * 6, y = r.y + 8 + row * 20;
      a.rect(x, y + 3, 12, 10, C.port); a.rect(x + 3, y + (row ? 12 : 3), 6, 2, C.grey);
      const linked = rnd() < 0.62;
      led(x + 6, row ? y + 16 : y - 2, linked ? (rnd() < 0.85 ? LED.green : LED.amber) : LED.green, CLS.activity, linked);
    }
    for (let k = 0; k < 4; k++) { const x = 418 + k * 20; a.rect(x, r.y + 12, 16, 22, C.grey); a.rect(x + 2, r.y + 15, 12, 16, C.port); led(x + 4, r.y + 36, LED.green, CLS.activity, k < 2); } }
  // --- 1U patch panel: 24 keystones with numbers and colour clips
  { const r = ATLAS.patch1u; bezel(r, C.black); ears(r);
    for (let k = 0; k < 24; k++) {
      const x = 30 + k * 19 + Math.floor(k / 6) * 4;
      a.rect(x, r.y + 18, 14, 14, C.port); a.frame(x, r.y + 18, 14, 14, C.grey); a.rect(x + 3, r.y + 34, 8, 3, [C.blue, C.yellow, C.white, C.red][k % 4]);
      text(a, String(k + 1), x + (k + 1 < 10 ? 5 : 1), r.y + 8, C.light);
    } }
  // --- 1U cable manager: brush strip over a dark slot with cable colours behind
  { const r = ATLAS.cable1u; bezel(r, C.black); ears(r);
    a.rect(24, r.y + 14, 464, 20, C.port);
    for (let i = 24; i < 488; i += 3) a.rect(i, r.y + 14 + (rnd() * 4 | 0), 2, 16, [C.blue, C.yellow, C.grey, C.blue][(i / 9 | 0) % 4], 0.65);
    for (let i = 24; i < 488; i += 2) { a.rect(i, r.y + 12, 1, 11, C.dark); a.rect(i + 1, r.y + 26, 1, 10, C.dark); } }
  // --- 1U KVM drawer (folded): handle bar, LED, label
  { const r = ATLAS.kvm1u; bezel(r, C.grey); ears(r, C.grey);
    a.rect(60, r.y + 18, 392, 12, C.dark); a.rect(64, r.y + 20, 384, 3, C.light, 0.35); sticker(470 - 30, r.y + 6, 'KVM'); led(470, r.y + 32, LED.green, CLS.heartbeat); }
  // --- 1U blanking panel
  { const r = ATLAS.blank1u; bezel(r, C.black); ears(r); for (let i = 40; i < 470; i += 40) a.rect(i, r.y + 22, 24, 4, C.port, 0.5); }
  // --- shelf lip (cantilever shelf front): vented strip
  { const r = ATLAS.shelf; bezel(r, C.black); ears(r); slots(40, r.y + 10, 430, 28, 4, C.port); }
  // --- swatches (cable colours, edges, handle steel, rail) + one U of rail with its three square cage-nut holes
  for (const [k, col] of [[SW.edge, C.grey], [SW.silver, C.silver], [SW.blue, C.blue], [SW.yellow, C.yellow], [SW.grey, C.mid], [SW.red, C.red], [SW.black, C.black], [SW.rail, C.dark], [SW.pdu, C.black]]) { const s = swatchRect(k); a.rect(s.x - 4, s.y - 4, s.w + 8, s.h + 8, col); }
  { const s = swatchRect(SW.pdu); for (let k = 0; k < 3; k++) { led(s.x + 4 + k * 8, s.y + 4, LED.amber, CLS.steady); } }
  { const r = RAIL_CELL; a.rect(r.x, r.y, r.w, r.h, C.dark); a.noise(r.x, r.y, r.w, r.h, 8, rnd); for (const yy of [8, 24, 40]) { a.rect(r.x + 4, r.y + yy - 4, 8, 8, C.port); a.frame(r.x + 4, r.y + yy - 4, 8, 8, C.mid); } a.rect(r.x + 13, r.y, 1, r.h, C.light, 0.3); }
  a.noise(0, 0, ATLAS_W, ATLAS.swatchY, 6, rnd);
  return {albedo: a, emissive: e};
}

/** 256 px tiling powder-coat (black-grey, fine orange peel, light scuffs). */
function paintBody() {
  const rnd = mulberry32(7331);
  const t = new Img(256, 256, hex('#2a2d31'));
  t.noise(0, 0, 256, 256, 14, rnd);
  for (let i = 0; i < 70; i++) { const x = rnd() * 256, y = rnd() * 256, len = 6 + rnd() * 30, ang = (rnd() - 0.5) * 0.8; for (let s = 0; s < len; s++) t.set(Math.round(x + Math.cos(ang) * s) & 255, Math.round(y + Math.sin(ang) * s) & 255, [110, 112, 116, 255], 0.22); }
  for (let i = 0; i < 6; i++) { const cx = rnd() * 256, cy = rnd() * 256, r = 10 + rnd() * 26; for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const d = Math.hypot(j, k) / r; if (d < 1) t.set((cx + k) & 255, (cy + j) & 255, [16, 17, 18, 255], 0.18 * (1 - d)); } }
  return t;
}

/** Perforated steel tile (round holes on a 10 mm hexagonal pitch, r 4.2 mm: ~64 % open): RGBA, holes alpha 0. One tile = 2 x 2 rows. */
const PERF = {px: 64, pitch: 0.01, tileW: 0.02, tileH: 0.01 * Math.sqrt(3)};
function paintPerforated() {
  const rnd = mulberry32(4242);
  const n = PERF.px, t = new Img(n, n, [40, 43, 47, 255]);
  t.noise(0, 0, n, n, 10, rnd);
  const sx = PERF.tileW / n, sy = PERF.tileH / n, r = 0.42 * PERF.pitch, edge = 0.0004;
  // hole centres (metres, tile frame): rows at 0 / tileH (x 0, p, 2p) and tileH / 2 (x p/2, 3p/2)
  const p = PERF.pitch, holes = [[0, 0], [p, 0], [2 * p, 0], [0, PERF.tileH], [p, PERF.tileH], [2 * p, PERF.tileH], [p / 2, PERF.tileH / 2], [1.5 * p, PERF.tileH / 2]];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let dmin = Infinity;
    for (const [hx, hy] of holes) dmin = Math.min(dmin, Math.hypot((i + 0.5) * sx - hx, (j + 0.5) * sy - hy));
    const o = (j * n + i) * 4;
    if (dmin < r) { t.d[o] = 6; t.d[o + 1] = 6; t.d[o + 2] = 7; t.d[o + 3] = 0; }
    else if (dmin < r + edge) { const k = 0.55; t.d[o] = Math.round(t.d[o] * k + 150 * (1 - k)); t.d[o + 1] = Math.round(t.d[o + 1] * k + 152 * (1 - k)); t.d[o + 2] = Math.round(t.d[o + 2] * k + 156 * (1 - k)); }
  }
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry (prop frame), per material

const meshes = {body: newMesh(), face: newMesh(), door: newMesh(), back: newMesh()};
function newMesh() { return {pos: [], nrm: [], uv: [], idx: []}; }
/** A quad (4 corners CCW seen from the normal side) with uvs. */
function quad(m, p, n, uv) { const b = m.pos.length / 3; for (let k = 0; k < 4; k++) { m.pos.push(...p[k]); m.nrm.push(...n); m.uv.push(...uv[k]); } m.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
/** Atlas rect (px) -> uv corners [bl, br, tr, tl] (glTF uv: v down from the image top). */
const auv = r => [[r.x / ATLAS_W, (r.y + r.h) / ATLAS_H], [(r.x + r.w) / ATLAS_W, (r.y + r.h) / ATLAS_H], [(r.x + r.w) / ATLAS_W, r.y / ATLAS_H], [r.x / ATLAS_W, r.y / ATLAS_H]];
/** Axis box with per-face uv policy: uv(faceName, [u-extent, v-extent], corners) -> 4 uvs. Faces: px nx py ny pz nz. */
function box(m, x0, y0, z0, x1, y1, z1, uvFor, skip = '') {
  const F = {
    px: {n: [1, 0, 0], p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], s: [z1 - z0, y1 - y0], o: [-z1, y0]},
    nx: {n: [-1, 0, 0], p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], s: [z1 - z0, y1 - y0], o: [z0, y0]},
    py: {n: [0, 1, 0], p: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], s: [x1 - x0, z1 - z0], o: [x0, -z1]},
    ny: {n: [0, -1, 0], p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], s: [x1 - x0, z1 - z0], o: [x0, z0]},
    pz: {n: [0, 0, 1], p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], s: [x1 - x0, y1 - y0], o: [x0, y0]},
    nz: {n: [0, 0, -1], p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], s: [x1 - x0, y1 - y0], o: [-x1, y0]},
  };
  for (const [name, f] of Object.entries(F)) { if (skip.includes(name)) continue; quad(m, f.p, f.n, uvFor(name, f)); }
}
/** World-scale tiling uvs (1 texture repeat per `rep` metres). */
const tile = (rep = 0.5) => (_n, f) => { const [u0, v0] = f.o, [su, sv] = f.s; return [[u0 / rep, -v0 / rep], [(u0 + su) / rep, -v0 / rep], [(u0 + su) / rep, -(v0 + sv) / rep], [u0 / rep, -(v0 + sv) / rep]]; };
/** Front face from an atlas rect, every other face a swatch. */
const atlasFront = (r, sw = SW.edge) => n => (n === 'pz' ? auv(r) : auv(swatchRect(sw)));
const swatch = sw => () => auv(swatchRect(sw));

// --- carcass (rack-body)
const body = meshes.body, B = tile(0.5);
box(body, -0.29, 0, -0.48, 0.29, 0.07, 0.455, B);                         // plinth
box(body, -0.3, 0.07, -0.49, 0.3, 0.085, 0.465, B);                       // base frame
box(body, -0.3, 1.985, -0.49, 0.3, 2.0, 0.465, B);                        // top cover
box(body, -0.29, 1.96, -0.47, 0.29, 1.985, 0.455, B, 'py');               // top frame
for (const s of [-1, 1]) {
  box(body, s > 0 ? 0.285 : -0.3, 0.085, -0.49, s > 0 ? 0.3 : -0.285, 1.985, 0.465, B);   // side panels
  box(body, s > 0 ? 0.255 : -0.285, 0.085, 0.43, s > 0 ? 0.285 : -0.255, 1.96, 0.465, B); // front corner posts (door frame)
  box(body, s > 0 ? 0.255 : -0.285, 0.085, -0.48, s > 0 ? 0.285 : -0.255, 1.96, -0.45, B); // rear posts
}
box(body, -0.255, 0.085, 0.43, 0.255, 0.105, 0.465, B);                   // front bottom rail of the frame
box(body, -0.255, 1.94, 0.43, 0.255, 1.96, 0.465, B);                     // front top rail
// rear door: opaque perforated (shares the door tile) + its frame
{
  const m = meshes.back, x0 = -0.3, x1 = 0.3, y0 = 0.075, y1 = 1.99, z = -0.4855;
  const uv = (x, y) => [x / PERF.tileW, -y / PERF.tileH];
  quad(m, [[x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]], [0, 0, -1], [uv(-x1, y0), uv(-x0, y0), uv(-x0, y1), uv(-x1, y1)]); // outside (faces -Z)
  quad(m, [[x0, y0, z + 0.002], [x1, y0, z + 0.002], [x1, y1, z + 0.002], [x0, y1, z + 0.002]], [0, 0, 1], [uv(x0, y0), uv(x1, y0), uv(x1, y1), uv(x0, y1)]); // inside
  box(body, -0.3, 0.075, -0.5, 0.3, 0.11, -0.484, B); box(body, -0.3, 1.955, -0.5, 0.3, 1.99, -0.484, B);
  box(body, -0.3, 0.11, -0.5, -0.268, 1.955, -0.484, B); box(body, 0.268, 0.11, -0.5, 0.3, 1.955, -0.484, B);
}

// --- 19-inch rails (front pair + rear pair): flange faces carry one atlas rail cell PER U (square holes), webs are body steel
for (const z of [RAIL.front, RAIL.rear]) for (const s of [-1, 1]) {
  const x0 = s > 0 ? RAIL.x0 : -RAIL.x1, x1 = s > 0 ? RAIL.x1 : -RAIL.x0, zf = z, zb = z - 0.012;
  for (let k = 0; k < 42; k++) quad(meshes.face, [[x0, uy(k), zf], [x1, uy(k), zf], [x1, uy(k + 1), zf], [x0, uy(k + 1), zf]], [0, 0, 1], auv(RAIL_CELL));
  box(body, x0, uy(0), zb, x1, uy(42), zf - 0.0005, B, 'pz');
  box(body, s > 0 ? RAIL.x1 - 0.002 : -RAIL.x1, uy(0), zb - 0.05, s > 0 ? RAIL.x1 : -RAIL.x1 + 0.002, uy(42), zb, B); // web toward the side
}

// --- equipment + empty bays
const LAYOUT = {units: [], bays: []};
{
  let k = 0;
  for (const [kind, n] of STACK) {
    const y0 = uy(k), y1 = uy(k + n);
    if (kind === 'bay') {
      // cantilever shelf at the bay bottom: tray (body) + a low vented lip (faceplate atlas), side flanges
      const ty = y0 + TRAY.t;
      box(body, -TRAY.half, y0, TRAY.z0, TRAY.half, ty, TRAY.z1, B);
      box(body, -TRAY.half, y0, TRAY.z0, -TRAY.half + 0.003, y0 + 0.03, TRAY.z1, B); box(body, TRAY.half - 0.003, y0, TRAY.z0, TRAY.half, y0 + 0.03, TRAY.z1, B);
      const lip = {...ATLAS.shelf, h: ATLAS.shelf.h * 0.5, y: ATLAS.shelf.y + ATLAS.shelf.h * 0.25};
      box(meshes.face, -FACE.half, y0, FACE.z0, FACE.half, y0 + 0.022, FACE.z1, atlasFront(lip));
      LAYOUT.bays.push({u: k, units: n, y: +ty.toFixed(4), top: +y1.toFixed(4), clear: +(y1 - ty - 0.006).toFixed(3)});
    } else {
      const r = ATLAS[kind];
      box(meshes.face, -FACE.half, y0 + 0.0004, FACE.z0, FACE.half, y1 - 0.0004, FACE.z1, atlasFront(r));   // faceplate
      box(body, -CHASSIS.half, y0 + 0.0006, CHASSIS.z0, CHASSIS.half, y1 - 0.0006, FACE.z0, B, 'pz');      // chassis behind it
      if (n >= 2 && kind !== 'ups2u') for (const s of [-1, 1]) box(meshes.face, s * 0.2335 - 0.005, (y0 + y1) / 2 - 0.02, FACE.z1, s * 0.2335 + 0.005, (y0 + y1) / 2 + 0.02, FACE.z1 + 0.018, swatch(SW.silver)); // pull handles
      LAYOUT.units.push({kind, u: k, units: n});
    }
    k += n;
  }
}

// --- cables: patch leads switch -> patch panel (front), bundles at the rear, a 0U PDU in the rear right channel
function tube(m, pts, r, sw, sides = 6) {
  const uvs = auv(swatchRect(sw)), uvc = [(uvs[0][0] + uvs[2][0]) / 2, (uvs[0][1] + uvs[2][1]) / 2];
  const ring = [];
  let prevA = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]], tl = Math.hypot(...t) || 1; t[0] /= tl; t[1] /= tl; t[2] /= tl;
    // parallel transport: the first ring from a reference axis, every next one from the previous ring's axis (no twisted segments)
    let a;
    if (prevA) { const k = prevA[0] * t[0] + prevA[1] * t[1] + prevA[2] * t[2]; a = [prevA[0] - t[0] * k, prevA[1] - t[1] * k, prevA[2] - t[2] * k]; }
    else { const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; a = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]; }
    const al = Math.hypot(...a); a = a.map(v => v / al); prevA = a;
    const b = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]];
    const rr = [];
    for (let s = 0; s < sides; s++) { const ang = s / sides * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang); const n = [a[0] * c + b[0] * sn, a[1] * c + b[1] * sn, a[2] * c + b[2] * sn]; rr.push({p: [p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n}); }
    ring.push(rr);
  }
  for (let i = 0; i + 1 < ring.length; i++) for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides, base = m.pos.length / 3;
    for (const v of [ring[i][s], ring[i][s2], ring[i + 1][s2], ring[i + 1][s]]) { m.pos.push(...v.p); m.nrm.push(...v.n); m.uv.push(...uvc); }
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
const bez = (a, b, c, n = 7) => Array.from({length: n}, (_, i) => { const t = i / (n - 1), u = 1 - t; return [0, 1, 2].map(k => u * u * a[k] + 2 * u * t * b[k] + t * t * c[k]); });
{
  const rnd = mulberry32(99);
  for (const [swU, ppU, n] of [[STACK.slice(0, 10).reduce((s, e) => s + e[1], 0), STACK.slice(0, 8).reduce((s, e) => s + e[1], 0), 8], [39, 40, 6]]) {
    // switch row `swU` -> patch panel row `ppU` (one U apart): short loops proud of the faces (they stay behind the door)
    for (let i = 0; i < n; i++) {
      const x = -0.17 + i * (0.34 / (n - 1)) + (rnd() - 0.5) * 0.01;
      const a0 = [x, uy(swU) + U * (rnd() < 0.5 ? 0.3 : 0.7), FACE.z1 + 0.004], c0 = [x + (rnd() - 0.5) * 0.04, uy(ppU) + U * 0.5, FACE.z1 + 0.004];
      const mid = [(a0[0] + c0[0]) / 2, (a0[1] + c0[1]) / 2, FACE.z1 + 0.04 + rnd() * 0.01];
      tube(meshes.face, bez(a0, mid, c0), 0.0028, [SW.blue, SW.yellow, SW.grey, SW.blue, SW.red][i % 5]);
    }
  }
  // rear bundles (seen through the empty bays): two looms down the rear rails
  for (const [x, sw] of [[-0.19, SW.blue], [-0.17, SW.grey], [0.18, SW.yellow], [0.2, SW.black]]) tube(meshes.face, [[x, uy(1), -0.39], [x + 0.005, uy(14), -0.395], [x - 0.004, uy(28), -0.392], [x, uy(41), -0.39]], 0.009, sw, 8);
  // 0U PDU in the rear right channel (outlets face inward)
  box(meshes.face, 0.247, uy(3), -0.45, 0.283, uy(38), -0.4, swatch(SW.black));
  // its amber load display (3 LEDs) near the top, facing into the rack (-X)
  { const x = 0.2468, y0 = uy(36), y1 = y0 + 0.03, z0 = -0.445, z1 = -0.405; quad(meshes.face, [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], [-1, 0, 0], auv(swatchRect(SW.pdu))); }
}

// --- front door: frame (body), perforated insert (door-mesh, both sides), swing handle + lock (left), three hinges (right)
{
  const d = DOOR, m = meshes.door;
  box(body, d.x0, d.y0, d.z0, d.x0 + d.stile, d.y1, d.z1, B); box(body, d.x1 - d.stile, d.y0, d.z0, d.x1, d.y1, d.z1, B);
  box(body, d.x0 + d.stile, d.y0, d.z0, d.x1 - d.stile, d.y0 + d.rail, d.z1, B); box(body, d.x0 + d.stile, d.y1 - d.rail, d.z0, d.x1 - d.stile, d.y1, d.z1, B);
  const x0 = d.x0 + d.stile - 0.002, x1 = d.x1 - d.stile + 0.002, y0 = d.y0 + d.rail - 0.002, y1 = d.y1 - d.rail + 0.002, z = d.mesh;
  const uv = (x, y) => [x / PERF.tileW, -y / PERF.tileH];
  quad(m, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], [uv(x0, y0), uv(x1, y0), uv(x1, y1), uv(x0, y1)]);
  // handle (swing lever in a recessed housing) + lock barrel on the left stile; hinge knuckles on the right
  box(meshes.face, d.x0 + 0.006, 0.93, d.z1, d.x0 + 0.026, 1.17, d.z1 + 0.006, swatch(SW.black));
  box(meshes.face, d.x0 + 0.01, 0.98, d.z1 + 0.006, d.x0 + 0.022, 1.12, d.z1 + 0.015, swatch(SW.silver)); // lever: the front-most point (z 0.5)
  box(meshes.face, d.x0 + 0.009, 1.135, d.z1 + 0.006, d.x0 + 0.023, 1.15, d.z1 + 0.012, swatch(SW.silver));
  for (const y of [0.25, 1.03, 1.8]) box(body, d.x1 - 0.006, y, d.z0 + 0.002, d.x1 + 0.0015, y + 0.07, d.z1 - 0.002, B);
}

// ---------------------------------------------------------------------------------------------------------------------------
// File frame (office convention: front -Z): half turn about +Y (x -> -x, z -> -z; winding kept)

function toFile(m) {
  const pos = new Float32Array(m.pos.length), nrm = new Float32Array(m.nrm.length);
  for (let i = 0; i < m.pos.length; i += 3) { pos[i] = -m.pos[i]; pos[i + 1] = m.pos[i + 1]; pos[i + 2] = -m.pos[i + 2]; nrm[i] = -m.nrm[i]; nrm[i + 1] = m.nrm[i + 1]; nrm[i + 2] = -m.nrm[i + 2]; }
  return {pos, nrm, uv: new Float32Array(m.uv), idx: m.pos.length / 3 <= 65535 ? new Uint16Array(m.idx) : new Uint32Array(m.idx)};
}

async function main() {
  const atlas = paintAtlas(), bodyTex = paintBody(), perf = paintPerforated();
  const jpg = async (img, q = 88) => sharp(Buffer.from(img.rgb()), {raw: {width: img.w, height: img.h, channels: 3}}).jpeg({quality: q, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();
  const png = async img => sharp(Buffer.from(img.d), {raw: {width: img.w, height: img.h, channels: 4}}).png({compressionLevel: 9, adaptiveFiltering: true, palette: false}).toBuffer();
  const images = {
    'rack-faceplates-color': {bytes: await jpg(atlas.albedo, 90), mime: 'image/jpeg', size: [ATLAS_W, ATLAS_H]},
    'rack-faceplates-leds': {bytes: await png(atlas.emissive), mime: 'image/png', size: [ATLAS_W, ATLAS_H]},
    'rack-body-color': {bytes: await jpg(bodyTex, 86), mime: 'image/jpeg', size: [256, 256]},
    'rack-perforated': {bytes: await png(perf), mime: 'image/png', size: [PERF.px, PERF.px]},
  };
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = {};
  for (const [name, im] of Object.entries(images)) tex[name] = doc.createTexture(name).setImage(new Uint8Array(im.bytes)).setMimeType(im.mime);
  const mats = {
    body: doc.createMaterial('rack-body').setBaseColorTexture(tex['rack-body-color']).setMetallicFactor(0.35).setRoughnessFactor(0.62),
    face: doc.createMaterial('rack-faceplates').setBaseColorTexture(tex['rack-faceplates-color']).setEmissiveTexture(tex['rack-faceplates-leds']).setEmissiveFactor([1, 1, 1])
      .setMetallicFactor(0.25).setRoughnessFactor(0.55),
    door: doc.createMaterial('rack-door-mesh').setBaseColorTexture(tex['rack-perforated']).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(0.4).setRoughnessFactor(0.5),
    back: doc.createMaterial('rack-back-mesh').setBaseColorTexture(tex['rack-perforated']).setMetallicFactor(0.4).setRoughnessFactor(0.55),
  };
  const mesh = doc.createMesh('server-rack-r2');
  let tris = 0;
  for (const [k, m] of Object.entries(meshes)) {
    const f = toFile(m);
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', acc('VEC3', f.pos)).setAttribute('NORMAL', acc('VEC3', f.nrm)).setAttribute('TEXCOORD_0', acc('VEC2', f.uv))
      .setIndices(acc('SCALAR', f.idx)).setMaterial(mats[k]));
    tris += f.idx.length / 3;
  }
  const node = doc.createNode('server-rack-r2').setMesh(mesh);
  node.setExtras({task: 'office-props-physics-scale-20261030', lane: 'RACK', method: 'local procedural geometry (no generation)', front: '-Z'});
  doc.getRoot().setDefaultScene(doc.createScene('Scene').addChild(node));
  const glb = Buffer.from(await new NodeIO().writeBinary(doc));
  // bounds (file frame)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of Object.values(meshes)) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = (k === 1 ? 1 : -1) * m.pos[i + k]; min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
  const dims = [0, 1, 2].map(k => +(max[k] - min[k]).toFixed(4));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const surfaces = LAYOUT.bays.map(b => ({y: b.y, x0: -SHELF_SURF.x, x1: SHELF_SURF.x, z0: SHELF_SURF.z0, z1: SHELF_SURF.z1, clear: b.clear}));
  const layout = {
    frame: 'prop frame (origin bottom-centre, front +Z) = the file half-turned (world/openables.ts turn)',
    rackUnit: U, firstUnitY: Y0, units: 42, rails: RAIL, faceplates: FACE, door: DOOR, pivot: PIVOT,
    doorRegion: [-0.305, 0.07, 0.466, 0.305, 1.995, 0.51], cavity: [-0.284, 0.085, -0.48, 0.284, 1.96, 0.465],
    equipment: LAYOUT.units, emptyBays: LAYOUT.bays, surfaces,
  };
  console.log(`server rack r2: ${tris} tris, dims ${dims.join(' x ')} (file), glb ${glb.length} bytes`);
  console.log(`  textures: ${Object.entries(images).map(([k, v]) => `${k} ${v.size.join('x')} ${v.bytes.length} B`).join(', ')}`);
  console.log(`  equipment: ${LAYOUT.units.map(u => `${u.kind}@U${u.u}`).join(' ')}`);
  console.log(`  empty bays (loot surfaces): ${JSON.stringify(surfaces)}`);
  console.log(`  door pivot ${JSON.stringify(PIVOT)} region ${JSON.stringify(layout.doorRegion)} cavity ${JSON.stringify(layout.cavity)}`);
  if (CHECK) return;
  fs.writeFileSync(path.join(ROOT, 'game/public', OUT_GLB), glb);
  const rawB10 = 'reference/tasks/office-space-survival-20261029/assets/raw/server-rack/refine/server-rack-refine.glb';
  const oldGlb = 'game/public/assets/models/office-server-rack.glb';
  const hashOf = p => (fs.existsSync(path.join(ROOT, p)) ? sha(fs.readFileSync(path.join(ROOT, p))) : null);
  const sidecar = {
    schema: 'terminal-state-local-derivative-v1',
    task: 'office-props-physics-scale-20261030', lane: 'RACK',
    status: 'Local procedural rebuild of the office server rack (kind serverRack). Prototype art; no commercial / model licence clearance asserted.',
    generation: {provider: null, model: null, credits: 0, note: 'No image / 3D / audio generation service was used: hand-dimensioned boxes / tubes and code-painted textures.'},
    rebuild: 'node tools/asset-pipeline/props/build-server-rack-r2.mjs',
    replaces: {
      kind: 'serverRack', asset: 'B10 server-rack (assets/assets/officeAssets.ts OFFICE_ASSETS[server-rack], Meshy T2.5)',
      reason: 'empty 1.23 x 2.0 x 1.48 m cabinet; the door was a painted shattered-glass texture on overlapping huge sliver triangles (z-fighting, opaque "glass"); no rack hardware (evidence: reference/tasks/office-props-physics-scale-20261030/evidence/RACK/)',
      oldDerivative: {path: oldGlb, sha256: hashOf(oldGlb), kept: 'unchanged in Git (still registered as OFFICE_ASSETS[server-rack]; no kind renders it)'},
      rawMaster: {path: rawB10, sha256: hashOf(rawB10), kept: 'outside Git, read-only; not used as geometry'},
    },
    conventions: {units: 'meters', up: '+Y', front: '-Z (office files; the runtime half-turns it to the prop frame +Z)', origin: 'bottom-centre', files: 'plain glTF 2.0 binary (no Draco / meshopt / KTX2)'},
    runtime: 'game/src/assets/officeAssets.ts OFFICE_LOCAL_MODELS[server-rack-r2] -> library key office-server-rack-r2 (gen/office/kinds.ts OFFICE_KIND_ASSET.serverRack; world/openablesSpec.ts serverRack model); world/rackLeds.ts blinks the LED emissive of material rack-faceplates',
    output: {url: OUT_GLB, sha256: sha(glb), bytes: glb.length, triangles: tris, dims,
      materials: Object.values(mats).map(m => ({name: m.getName(), alpha: m.getAlphaMode(), doubleSided: m.getDoubleSided(), emissive: !!m.getEmissiveTexture()})),
      textures: Object.entries(images).map(([name, v]) => ({name, mime: v.mime, size: v.size, bytes: v.bytes.length, sha256: sha(v.bytes)}))},
    layout,
  };
  fs.writeFileSync(path.join(ROOT, 'game/public', OUT_JSON), JSON.stringify(sidecar, null, 1) + '\n');
  console.log(`wrote game/public/${OUT_GLB} and game/public/${OUT_JSON}`);
}
await main();
