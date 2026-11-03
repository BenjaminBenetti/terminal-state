// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane MENU): the main menu's flows against a FAKE MenuHost (ui/mainMenu.ts
// MainMenuController; the DOM view is a thin renderer of the same model) — Continue visibility (only a valid save; the last-used valid
// slot, else the newest), New Game into an empty slot vs an explicitly confirmed overwrite, Load, Export, Import into a CHOSEN slot
// (replace confirmation only over an occupied slot; errors shown, slot unchanged), Delete with confirmation, the dev picker, start
// actions waiting for the boot assets, keyboard (arrows, Esc = back, Enter), confirmations defaulting to Cancel.
import {describe, expect, it} from 'vitest';
import type {SaveMeta} from '../src/campaign/types';
import {MainMenuController, continueTarget, formatPlaytime, slotSummary, type DevStart, type ImportResult, type MenuHost, type SlotView} from '../src/ui/mainMenu';

const meta = (slot: number, o: Partial<SaveMeta> = {}): SaveMeta => ({
  slot, savedAt: '2026-11-02T20:00:00.000Z', revision: 3, playtime: 3725, station: 'Calder Park', archetype: 'subway', stationsVisited: 4,
  networkSeed: 123456, won: false, reason: 'arrival', build: 'test', ...o,
});

class FakeHost implements MenuHost {
  slots: SlotView[] = [0, 1, 2].map(slot => ({slot, empty: true, valid: false}));
  last: number | null = null;
  calls: string[] = [];
  importResult: ImportResult = {ok: true};
  failNext: string | null = null;
  listSlots(): SlotView[] { this.calls.push('list'); return this.slots.map(s => ({...s})); }
  lastSlot(): number | null { return this.last; }
  newGame(slot: number, dev?: DevStart): Promise<void> {
    this.calls.push(`new:${slot}${dev ? `:${dev.level}:${JSON.stringify(dev.seeds)}` : ''}`);
    if (this.failNext) { const m = this.failNext; this.failNext = null; return Promise.reject(new Error(m)); }
    this.slots[slot] = {slot, empty: false, valid: true, meta: meta(slot, {reason: 'new-game'})};
    return Promise.resolve();
  }
  continueGame(slot?: number): Promise<void> { this.calls.push(`continue:${slot}`); return Promise.resolve(); }
  exportSlot(slot: number): void { this.calls.push(`export:${slot}`); }
  importFile(slot: number, file: File): Promise<ImportResult> {
    this.calls.push(`import:${slot}:${file.name}`);
    if (this.importResult.ok) this.slots[slot] = {slot, empty: false, valid: true, meta: meta(slot, {reason: 'import', station: 'Imported Yard'})};
    return Promise.resolve(this.importResult);
  }
  deleteSlot(slot: number): void { this.calls.push(`delete:${slot}`); this.slots[slot] = {slot, empty: true, valid: false}; }
}

const ids = (c: MainMenuController) => MainMenuController.actions(c.model()).map(a => a.id);
const enabled = (c: MainMenuController) => MainMenuController.actions(c.model()).filter(a => !a.disabled).map(a => a.id);
const file = (name = 'run.json') => new File(['{}'], name, {type: 'application/json'});
const ready = (host: MenuHost, o = {}) => { const c = new MainMenuController(host, o); c.setBoot(true, 1); return c; };

describe('main menu: the main view and Continue', () => {
  it('no save: New game / Load / Settings, no Continue, no dev entry without dev params', () => {
    const c = ready(new FakeHost());
    expect(ids(c)).toEqual(['new-game', 'slots', 'settings']);
    expect(c.continueSlot()).toBeNull();
    expect(c.focus).toBe('new-game');
  });

  it('Continue appears only for a VALID save and loads the last-used valid slot', async () => {
    const h = new FakeHost();
    h.slots[1] = {slot: 1, empty: false, valid: false, error: 'checksum mismatch'};
    const c = ready(h);
    expect(ids(c)).not.toContain('continue'); // an invalid save alone: no Continue
    h.slots[2] = {slot: 2, empty: false, valid: true, meta: meta(2)};
    h.last = 1; // the last-used slot is the broken one: Continue falls back to the valid one
    c.refresh();
    expect(ids(c)[0]).toBe('continue');
    expect(c.continueSlot()).toBe(2);
    expect(c.focus).toBe('continue');
    await c.activate('continue');
    expect(h.calls).toContain('continue:2');
  });

  it('continueTarget: last-used when valid, else the newest valid by savedAt', () => {
    const s: SlotView[] = [
      {slot: 0, empty: false, valid: true, meta: meta(0, {savedAt: '2026-11-01T10:00:00Z'})},
      {slot: 1, empty: false, valid: true, meta: meta(1, {savedAt: '2026-11-02T09:00:00Z'})},
      {slot: 2, empty: true, valid: false},
    ];
    expect(continueTarget(s, 0)).toBe(0);
    expect(continueTarget(s, 2)).toBe(1);
    expect(continueTarget(s, null)).toBe(1);
    expect(continueTarget([{slot: 0, empty: true, valid: false}], 0)).toBeNull();
  });

  it('start actions wait for the boot assets (disabled with the progress), navigation does not', () => {
    const h = new FakeHost();
    h.slots[0] = {slot: 0, empty: false, valid: true, meta: meta(0)};
    const c = new MainMenuController(h);
    c.setBoot(false, 0.42);
    const m = c.model();
    const cont = MainMenuController.actions(m).find(a => a.id === 'continue')!;
    expect(cont.disabled).toBe(true);
    expect(cont.hint).toContain('42 %');
    expect(m.status?.text).toMatch(/Waiting for the game files/);
    expect(enabled(c)).toEqual(['new-game', 'slots', 'settings']);
    void c.activate('continue');
    expect(h.calls).not.toContain('continue:0');
    c.setBoot(true, 1);
    expect(enabled(c)).toContain('continue');
  });
});

describe('main menu: New game', () => {
  it('an empty slot starts at once', async () => {
    const h = new FakeHost();
    const c = ready(h);
    await c.activate('new-game');
    expect(c.view).toBe('new');
    expect(ids(c)).toEqual(['new:0', 'new:1', 'new:2', 'back']);
    await c.activate('new:1');
    expect(h.calls).toContain('new:1');
  });

  it('an occupied slot asks first (Cancel focused); Cancel keeps it, Overwrite starts there', async () => {
    const h = new FakeHost();
    h.slots[0] = {slot: 0, empty: false, valid: true, meta: meta(0)};
    const c = ready(h);
    await c.activate('new-game');
    const row = c.model().rows.find(r => r.slot === 0)!;
    expect(row.lines!.join(' ')).toContain('Calder Park');
    expect(row.actions[0]).toMatchObject({id: 'new:0', label: 'Overwrite…', tone: 'danger'});
    await c.activate('new:0');
    expect(c.view).toBe('confirm-overwrite');
    expect(c.focus).toBe('back');
    expect(c.model().text.join(' ')).toMatch(/cannot be recovered/);
    expect(h.calls.filter(x => x.startsWith('new:'))).toEqual([]);
    await c.activate('back');
    expect(c.view).toBe('new');
    await c.activate('new:0');
    await c.activate('overwrite-go');
    expect(h.calls).toContain('new:0');
  });

  it('an unreadable slot also needs the overwrite confirmation', async () => {
    const h = new FakeHost();
    h.slots[2] = {slot: 2, empty: false, valid: false, error: 'not a save file'};
    const c = ready(h);
    await c.activate('new-game');
    expect(c.model().rows.find(r => r.slot === 2)!.tone).toBe('invalid');
    await c.activate('new:2');
    expect(c.view).toBe('confirm-overwrite');
  });

  it('a host failure is shown and the menu stays usable', async () => {
    const h = new FakeHost();
    h.failNext = 'quota exceeded';
    const c = ready(h);
    await c.activate('new-game');
    await c.activate('new:0');
    const m = c.model();
    expect(m.status).toMatchObject({tone: 'error'});
    expect(m.status!.text).toContain('quota exceeded');
    expect(m.busy).toBe(false);
    expect(enabled(c)).toContain('new:0');
  });
});

describe('main menu: Load save / slots', () => {
  const filled = () => {
    const h = new FakeHost();
    h.slots[0] = {slot: 0, empty: false, valid: true, meta: meta(0, {won: true})};
    h.slots[1] = {slot: 1, empty: false, valid: false, error: 'checksum mismatch'};
    return h;
  };

  it('lists the three slots with their metadata and the right actions', async () => {
    const c = ready(filled());
    await c.activate('slots');
    const rows = c.model().rows.filter(r => r.slot !== undefined);
    expect(rows.map(r => r.actions.map(a => a.id))).toEqual([
      ['load:0', 'export:0', 'import:0', 'delete:0'],
      ['export:1', 'import:1', 'delete:1'], // an unreadable save cannot be loaded, but can be exported / replaced / deleted
      ['import:2'],
    ]);
    const l = rows[0].lines!.join(' ');
    expect(l).toContain('Calder Park');
    expect(l).toContain('1 h 02 min');
    expect(l).toContain('WON');
    expect(l).toMatch(/seed 0002N9C/);
    expect(rows[1].lines![0]).toContain('checksum mismatch');
  });

  it('Load starts the slot; Export calls the host and reports', async () => {
    const h = filled();
    const c = ready(h);
    await c.activate('slots');
    await c.activate('export:0');
    expect(h.calls).toContain('export:0');
    expect(c.model().status?.tone).toBe('ok');
    await c.activate('load:0');
    expect(h.calls).toContain('continue:0');
  });

  it('Import into an EMPTY slot needs no confirmation', async () => {
    const h = filled();
    const c = ready(h, {pickFile: () => Promise.resolve(file('a.json'))});
    await c.activate('slots');
    await c.activate('import:2');
    expect(h.calls).toContain('import:2:a.json');
    expect(c.model().status).toMatchObject({tone: 'ok'});
    expect(c.model().rows.find(r => r.slot === 2)!.lines!.join(' ')).toContain('Imported Yard'); // re-read after the import
  });

  it('Import over an occupied slot: explicit replace confirmation into THAT slot; Cancel imports nothing', async () => {
    const h = filled();
    const c = ready(h, {pickFile: () => Promise.resolve(file('b.json'))});
    await c.activate('slots');
    await c.activate('import:0');
    expect(c.view).toBe('confirm-import');
    expect(c.model().title).toBe('Replace slot 1?');
    expect(c.model().text[0]).toContain('b.json');
    expect(c.focus).toBe('back');
    await c.activate('back');
    expect(h.calls.some(x => x.startsWith('import:'))).toBe(false);
    await c.activate('import:0');
    await c.activate('import-go');
    expect(h.calls).toContain('import:0:b.json');
    expect(c.view).toBe('slots');
  });

  it('a rejected import file is reported and the slot stays as it was', async () => {
    const h = filled();
    h.importResult = {ok: false, error: 'not a Terminal State save (format)'};
    const c = ready(h, {pickFile: () => Promise.resolve(file('evil.json'))});
    await c.activate('slots');
    await c.activate('import:2');
    const st = c.model().status!;
    expect(st.tone).toBe('error');
    expect(st.text).toContain('slot 3 unchanged');
    expect(st.text).toContain('not a Terminal State save');
    expect(h.slots[2].empty).toBe(true);
  });

  it('a cancelled file chooser does nothing', async () => {
    const h = filled();
    const c = ready(h, {pickFile: () => Promise.resolve(null)});
    await c.activate('slots');
    await c.activate('import:0');
    expect(c.view).toBe('slots');
    expect(h.calls.some(x => x.startsWith('import:'))).toBe(false);
  });

  it('Delete asks first (Cancel focused) and only then deletes', async () => {
    const h = filled();
    const c = ready(h);
    await c.activate('slots');
    await c.activate('delete:0');
    expect(c.view).toBe('confirm-delete');
    expect(c.focus).toBe('back');
    expect(h.calls.some(x => x.startsWith('delete:'))).toBe(false);
    await c.activate('delete-go');
    expect(h.calls).toContain('delete:0');
    expect(c.view).toBe('slots');
    expect(c.model().rows.find(r => r.slot === 0)!.tone).toBe('empty');
    expect(c.model().status).toMatchObject({tone: 'ok'});
  });

  it('save metadata is plain text (never HTML): a hostile station name survives verbatim', () => {
    const s = slotSummary({slot: 0, empty: false, valid: true, meta: meta(0, {station: '<img src=x onerror=alert(1)>'})});
    expect(s.lines[0]).toContain('<img src=x onerror=alert(1)>'); // the DOM view sets it as textContent
  });
});

describe('main menu: dev start, QA start, settings', () => {
  const dev: DevStart = {level: 'reactor', seeds: {reactor: 4242}};

  it('the dev picker appears only with dev params and starts a NORMAL new game at the chosen level (slot choice next)', async () => {
    const h = new FakeHost();
    expect(ids(ready(h))).not.toContain('dev');
    const c = ready(h, {dev});
    expect(ids(c)).toContain('dev');
    await c.activate('dev');
    expect(c.model().rows[0].actions.map(a => [a.id, a.pressed])).toEqual([['dev-level:subway', false], ['dev-level:office', false], ['dev-level:mall', false], ['dev-level:reactor', true]]);
    await c.activate('dev-level:office');
    await c.activate('dev-go');
    expect(c.view).toBe('new');
    await c.activate('new:0');
    expect(h.calls).toContain('new:0:office:{"reactor":4242}');
  });

  it('?qa=1: the QA quick start is first, waits for its scratch level, and calls the QA start', async () => {
    let prepared = false, started = 0;
    const c = ready(new FakeHost(), {qa: {label: 'QA quick start', start: () => { started++; }, ready: () => prepared}});
    expect(ids(c)[0]).toBe('qa-start');
    expect(MainMenuController.actions(c.model())[0].disabled).toBe(true);
    prepared = true;
    c.refresh();
    await c.activate('qa-start');
    expect(started).toBe(1);
  });

  it('Settings is its own view; Esc goes back', async () => {
    const c = ready(new FakeHost());
    await c.activate('settings');
    expect(c.view).toBe('settings');
    expect(c.key('Escape')).toBe(true);
    expect(c.view).toBe('main');
    expect(c.key('Escape')).toBe(false); // nothing above the main view
  });
});

describe('main menu: keyboard', () => {
  it('arrows move focus over enabled actions (wrapping), Enter activates, Esc returns to the previous focus', () => {
    const h = new FakeHost();
    h.slots[0] = {slot: 0, empty: false, valid: true, meta: meta(0)};
    const c = ready(h);
    expect(c.focus).toBe('continue');
    c.key('ArrowDown');
    expect(c.focus).toBe('new-game');
    c.key('ArrowDown'); c.key('ArrowDown');
    expect(c.focus).toBe('settings');
    c.key('ArrowDown');
    expect(c.focus).toBe('continue'); // wraps
    c.key('ArrowUp');
    expect(c.focus).toBe('settings');
    c.key('Home');
    expect(c.focus).toBe('continue');
    c.key('End');
    expect(c.focus).toBe('settings');
    c.key('ArrowUp'); // slots
    c.key('Enter');
    expect(c.view).toBe('slots');
    expect(c.focus).toBe('load:0');
    c.key('Escape');
    expect(c.view).toBe('main');
    expect(c.focus).toBe('slots'); // back where it was
  });

  it('arrow navigation skips disabled actions', () => {
    const h = new FakeHost();
    h.slots[0] = {slot: 0, empty: false, valid: true, meta: meta(0)};
    const c = new MainMenuController(h);
    c.setBoot(false, 0);
    expect(c.focus).toBe('new-game'); // Continue is disabled while the game files load
    c.key('ArrowUp');
    expect(c.focus).toBe('settings');
  });
});

describe('formatting', () => {
  it('playtime', () => {
    expect(formatPlaytime(45)).toBe('45 s');
    expect(formatPlaytime(720)).toBe('12 min');
    expect(formatPlaytime(3725)).toBe('1 h 02 min');
    expect(formatPlaytime(Number.NaN)).toBe('0 s');
  });
});
