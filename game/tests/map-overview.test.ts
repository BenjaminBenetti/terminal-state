// Task studio-ui-subway-maps-20261108-074144-01 (user: "when initially opening the subway map from the train console, it is quite zoomed
// in. This is ofc because you have only discovered 2 stops. But, I think it should start zoomed out! So that you can see the legend at the
// top and get a sense of the scale"): the paper map opens on the WHOLE sheet (PaperMap.fitOverview), whatever is known. The sheet is printed
// from the whole network, so the overview never prints an unknown station, name, kind or track. It is fitted once per open: panning,
// zooming, selecting, a re-print and a resize never snap back. F still frames the known stations; Home / "Whole map" returns to the overview.
// Node only (helpers/paperMapDom.ts).

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {generateNetwork} from '../src/campaign/network';
import {destinations, newCampaign, revealAround, visibleNodes} from '../src/campaign/discovery';
import type {CampaignState} from '../src/campaign/types';
import {PAPER, PaperMap} from '../src/ui/paperMap';
import {installCanvasShim} from './helpers/canvas2d';
import {MiniEvent, installMiniDom, type MiniDom} from './helpers/paperMapDom';

installCanvasShim(false);

const BAR_H = 46; // the map's fixed header (ui/paperMap.ts)
const net = generateNetwork(424242);
const start = () => revealAround(newCampaign(net), net.start);

let dom: MiniDom;
let map: PaperMap;
beforeEach(() => { dom = installMiniDom(1280, 720); map = new PaperMap(); });
afterEach(() => { map.close(); dom.uninstall(); });
const open = (s: CampaignState) => map.open({state: s, mode: 'travel', onConfirm: () => {}, onClose: () => {}, onCheat: () => s});

describe('the train console map opens zoomed out', () => {
  it('with only the first stops known it opens on the whole sheet: the title band / legend is on screen, below the header', () => {
    const s = start();
    expect(visibleNodes(s).length).toBeLessThanOrEqual(4); // the start and its neighbours: the case the user saw
    for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [1024, 768], [800, 1280], [360, 640]]) {
      dom.win.innerWidth = w; dom.win.innerHeight = h;
      open(s);
      const v = map.viewState;
      expect(v.s).toBeCloseTo(map.sheetScale(), 9); // the whole-sheet scale, not a zoom on the known stops
      // the whole sheet, so the band (title, line legend, symbol key) is on screen and clear of the header bar
      expect(v.tx).toBeGreaterThanOrEqual(-0.5); expect(v.tx + PAPER.w * v.s).toBeLessThanOrEqual(w + 0.5);
      expect(v.ty).toBeGreaterThanOrEqual(BAR_H - 0.5); expect(v.ty + PAPER.h * v.s).toBeLessThanOrEqual(h + 0.5);
      expect(PAPER.band.x0 * v.s + v.tx).toBeGreaterThanOrEqual(0);
      expect(PAPER.band.x1 * v.s + v.tx).toBeLessThanOrEqual(w);
      expect(PAPER.band.y0 * v.s + v.ty).toBeGreaterThanOrEqual(BAR_H);
      map.close();
    }
  });

  it('on a desktop screen it is clearly further out than the old known-stations framing, and the legend prints at a readable size', () => {
    open(start());
    const overview = map.viewState.s;
    map.fitKnown(); // the old opening view (still the F key / Fit button)
    expect(map.viewState.s).toBeGreaterThan(overview * 1.3);
    expect(overview * 12).toBeGreaterThan(9.5); // the band's 12 px paper text is ~10 px on a 1280 x 720 screen
  });

  it('the overview prints nothing that is not known: only known stations have a mark, a hit area or a label', () => {
    const s = start();
    open(s);
    const known = new Set(visibleNodes(s).map(n => n.id));
    const ids = dom.doc.querySelectorAll('[data-id]').map(e => e.getAttribute('data-id')!);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(known.has(id)).toBe(true);
    const html = dom.doc.querySelector('.pm-sheet')!.innerHTML;
    for (const n of net.nodes) if (!known.has(n.id)) expect(html).not.toContain(`>${n.name}<`);
  });

  it('fitted once per open: a pan, a zoom, a selection, a resize keep the view; Home and the button return to the overview; a reopen starts at it again', () => {
    const s = start();
    open(s);
    const v0 = map.viewState;
    map.zoomBy(1.6);
    map.panBy(-120, 40);
    const moved = map.viewState;
    expect(moved.s).toBeGreaterThan(v0.s);
    map.select(destinations(s)[0]); // re-prints the card / ink
    expect(map.viewState).toEqual(moved);
    dom.win.dispatchEvent(new MiniEvent('resize', {}));
    expect(map.viewState.s).toBeCloseTo(moved.s, 9); // only clamped, never re-fitted
    dom.key('Home');
    expect(map.viewState).toEqual(v0);
    map.zoomBy(2);
    dom.click(dom.doc.querySelector('.pm-whole'));
    expect(map.viewState).toEqual(v0);
    map.zoomBy(2);
    map.close();
    open(s);
    expect(map.viewState).toEqual(v0);
  });
});
