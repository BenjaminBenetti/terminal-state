// Task studio-surface-run-field-followup-20261116-211729-01 (primary, contract): VERSION-1 SURFACE RUN WORLDS STAY EXACT. Every structural
// / access / interior change of the follow-up is gated on the station's recorded Surface Run version (gen/surface/surfaceRun.ts
// SURFACE_VERSION 2): a host station first generated under version 1 (and its district, which follows the host's record) must
// regenerate byte-for-byte as main built it before the follow-up, so a saved v1 world's layout, loot, kills and resources are untouched.
// The digests below were taken on main aeec54a4 (the version-1 release) and are pinned here: a change that moves one is a v1 break.
// Re-pinned for main's own Mall changes (PR #139, the open stair / escalator wells capped at the upper storey's ceiling; PR #142, the
// Mall plan families / layout version 2 for new Malls): the Mall host digests were taken on pure main 669ad9c8 and this branch
// reproduces them exactly for every host (subway / office / mall, main and district) — main moved them, not the follow-up.
import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import type {StationLayout} from '../src/gen/stationTypes';

const bytes = (L: StationLayout) => JSON.stringify(L, (_k, v) => (ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') : v));
const digest = (L: StationLayout) => createHash('sha256').update(bytes(L)).digest('hex').slice(0, 16);
const present = (host: SurfaceHost, n: number): number[] => { const out: number[] = []; for (let s = 1; out.length < n; s++) if (surfacePresent(host, s, 1)) out.push(s); return out; };

/** Pinned on main aeec54a4 (Mall hosts: main 669ad9c8), the first two present seeds per host: the host 'main' at surfaceVersion 1 and its district (version 1). */
const PINS: Record<SurfaceHost, {main: string; surface: string}[]> = {
  subway: [{main: '649a6236699b0eee', surface: 'deb1e91b47f659ee'}, {main: '0a1b76df352d9854', surface: '413b7a80f900200a'}],
  office: [{main: '8d968f4f9e374988', surface: 'c932b6bcce729720'}, {main: 'f402a3b917e5ec1c', surface: 'd9edb2e2f2291379'}],
  mall: [{main: '3a92c85f4fa0044d', surface: 'faf3705ba5203d93'}, {main: '1c28c75203950acc', surface: '56c803942baa6f4f'}], // (main 669ad9c8)
};

describe('Surface Run version 1: host stations and districts regenerate exactly as the v1 release built them', () => {
  for (const host of ['subway', 'office', 'mall'] as const) {
    it(`${host}: the v1 host station and its v1 district`, () => {
      const got = present(host, 2).map(s => {
        const main = LEVELS[host].generate('main', {levelSeed: s, surfaceVersion: 1});
        expect(main.surfaceAccess, `${host} ${s}`).toBeTruthy();
        const district = LEVELS[host].generate('surface', {levelSeed: s, surfaceVersion: 1});
        return {main: digest(main), surface: digest(district)};
      });
      expect(got, `${host} seeds ${present(host, 2).join(', ')}`).toEqual(PINS[host]);
    }, 180_000);
  }
});
