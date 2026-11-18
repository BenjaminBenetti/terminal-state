import {CAN_IDS} from '../items/sprayPaint';

export const PAINT_PARTICIPANT = 'spray-paint';
export const BRUSH = {range: 2.25, interval: 0.10, radius: 0.048, sides: 8, marks: 1536, targets: 96} as const;
// Palette index, target-local centre in millimetres, eight three-dimensional rim offsets in mm.
export type Dab = number[];
export type Painted = [string, Dab[]][];

export function validPaint(value: unknown): value is Painted {
  if (!Array.isArray(value) || value.length > BRUSH.targets) return false;
  const ids = new Set<string>();
  let total = 0;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [id, dabs] = entry;
    if (typeof id !== 'string' || !/^(train|door\/[0-9]+\/[01]|(station|prop|cart)\/[\w:#.-]{1,100})$/.test(id) || ids.has(id)) return false;
    ids.add(id);
    if (!Array.isArray(dabs) || !dabs.length) return false;
    total += dabs.length;
    if (total > BRUSH.marks) return false;
    for (const d of dabs) {
      if (!Array.isArray(d) || d.length !== 4 + BRUSH.sides * 3 || !d.every(Number.isSafeInteger)
        || d[0] < 0 || d[0] >= CAN_IDS.length || d.slice(1, 4).some(n => Math.abs(n) > 4000000)
        || d.slice(4).some(n => Math.abs(n) > 90)) return false;
    }
  }
  return true;
}

export class PaintRecord {
  readonly targets = new Map<string, Dab[]>();
  count = 0;

  reset(): void {
    this.targets.clear();
    this.count = 0;
  }

  save(): Painted {
    return Array.from(this.targets, ([id, dabs]) => [id, dabs.map(d => [...d])]);
  }

  load(value: unknown): void {
    this.reset();
    if (!validPaint(value)) return;
    for (const [id, dabs] of value) {
      this.targets.set(id, dabs.map(d => [...d]));
      this.count += dabs.length;
    }
  }

  add(id: string, dab: Dab): 'full' | 'wet' | 'added' {
    const list = this.targets.get(id), last = list?.at(-1);
    if (last && last[0] === dab[0] && Math.hypot(last[1] - dab[1], last[2] - dab[2], last[3] - dab[3]) < 9) return 'wet';
    if (this.count >= BRUSH.marks || (!list && this.targets.size >= BRUSH.targets)) return 'full';
    if (list) list.push(dab);
    else this.targets.set(id, [dab]);
    this.count++;
    return 'added';
  }
}
