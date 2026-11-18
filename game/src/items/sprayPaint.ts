import type {ItemDef, ItemDims} from './items';

export const INK = {
  spray_black: 0x15151a, spray_white: 0xf7f5ed, spray_red: 0xeb3038,
  spray_blue: 0x2476ec, spray_green: 0x23bb69, spray_yellow: 0xffdc25, spray_orange: 0xff8129,
} as const;
export type CanId = keyof typeof INK;
export const CAN_IDS = Object.keys(INK) as CanId[];
export const isSprayCan = (id: string): id is CanId => Object.prototype.hasOwnProperty.call(INK, id);
export const CAN_FILL = 120;
export const paintLeft = (n?: number) => Number.isFinite(n) ? Math.min(CAN_FILL, Math.max(0, Math.floor(n!))) : 0;
export const fillText = (n?: number) => paintLeft(n) ? `${Math.ceil(100 * paintLeft(n) / CAN_FILL)}% full` : 'Empty can';
export const CAN_ITEMS: Record<string, ItemDef> = Object.fromEntries(CAN_IDS.map(id => {
  const colour = id.slice(6), name = colour[0].toUpperCase() + colour.slice(1);
  return [id, {id, name: name + ' spray paint', short: name + ' paint', kind: 'supply', stackMax: 1, icon: 'sprayCan',
    description: 'Equip in a quick slot. Hold left click to spray a nearby surface.'}];
}));
export const CAN_DIMS: Record<string, ItemDims> = Object.fromEntries(CAN_IDS.map(id => [id, {w: .084, d: .084, h: .219, shape: 'cylinder'}]));
