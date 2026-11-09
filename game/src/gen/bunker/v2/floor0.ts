// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 0, THE STATION (contract: gen/bunker/v2/floorApi.ts; frame:
// gen/bunker/v2/spine.ts). The shelter's public face: where a civil-defence shelter took in the people its trains brought down.
//
// The ADMISSION SEQUENCE, from the train to the vault door (rows 25-50, between the platform wall and the bulkhead):
//  - the PLATFORM (spine) keeps its station dressing; latecomers who never got in slept on it (overflow berths on its back wall), and
//    the bay in front of the central portal is framed by two columns instead of blocked by one;
//  - three portals in the platform wall: the central one ON THE VAULT AXIS (the player's start faces it: the blast door is the first
//    thing seen, ~18 m away at the end of the aisle), one into each low side hall;
//  - the VAULT HALL (centre, 6.4 m: the storey's one tall room) — a nave: two colonnades of full-height columns under transverse beams,
//    queue barriers strung between them, the painted aisle from the portal to the threshold, the marshals' booths flanking the door;
//  - the REGISTRATION HALL (west, low 3.6 m) — the queue line, the registration counter (admission kits handed over it), the cleared
//    side behind it with the records; two narrow INSPECTION GATES lead from there into the vault hall; the MARSHALS' POST behind it
//    has its own side door onto the apron before the blast door;
//  - the WAITING HALL (east, low 3.6 m) — the vault hall's side aisle behind an arcade of piers: benches in rows facing the door,
//    luggage, bedrolls of families who waited days for their group to be called; off it the MEDICAL INSPECTION post and, behind that,
//    the OBSERVATION WARD (a dead end with failing lights: arrivals held there for a fever or a wound);
//  - SURRENDERED PROPERTY at the far end of the registration side (baggage over the allowance, receipts at the counter).
// The VAULT SIDE (behind the bulkhead, off the spine's vestibule only): RECEIVING (goods in, beside the cargo lift's landing) and the
// BILLETING OFFICE (where the admitted were given their level and dormitory before going down the main stair).
//
// Scale rhythm: platform 5.2 m → portal 3.2 m (compression) → vault hall 6.4 m (release) ↔ side halls 3.6 m → rooms 3.2-3.4 m; the
// inspection gates (1.5 m) and the marshals' door are the constrained links, the arcade and the portals the open ones.
// Loot by purpose (the station reads as admission): admission kits on the registration counter (the shelter lock's supply table),
// personal belongings in the waiting hall (dormitory rows), surrendered baggage (lost property), the marshals' security office, the
// medical inspection's first-aid stock and the observation ward's medicines, receiving's supplies. No gas, generator or core here.

import type {Area, Rect} from '../../stationTypes';
import {BUNKER_PURPOSE} from '../../reactor/complex/bunkerPurposes';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult} from './floorApi';
import {dressStation} from './floor0Dress';
import {F0_CLEAR, F0_LABELS, F0_PORTAL, type F0Key} from './floor0Spec';
import {V2} from './spine';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

function carve(ctx: FloorCarveCtx): FloorCarveResult | null {
  const S = V2.station, rng = ctx.rng;
  const platform = ctx.k.areas.find(a => a.type === 'platform');
  const vest = ctx.k.areas.find(a => a.label === 'Vault vestibule');
  if (!platform || !vest) return null;
  const y0 = S.arrivalY0, H = S.bulkheadY - y0; // rows 25..50
  const wallY = platform.y + platform.h; // the platform's south wall row (24)
  const areas: Record<string, number> = {};
  const add = (key: F0Key, r: Rect, kind: Area['kind'], type: Area['type'], clear: number, parent: number, purpose?: string, publicSpace = false): Area | null => {
    const a = ctx.room(r, kind, type, clear, parent, {label: F0_LABELS[key], publicSpace, ...(purpose ? {purpose} : {})});
    if (a) areas[key] = a.id;
    return a;
  };
  // --- the vault hall: symmetric about the lane's centre (x0 + x1 = 2 * 55.5) --------------------------------------------------------
  const lane2 = S.laneX * 2 + S.laneW; // 111
  const fx0 = rng.chance(0.5) ? 41 : 42, fw = lane2 - 2 * fx0; // 29 / 27 cells (14.5 / 13.5 m)
  const hall = add('vaultHall', R(fx0, y0, fw, H), 'concourse', 'concourse', F0_CLEAR.vaultHall, platform.id, undefined, true);
  if (!hall) return null;
  const wW = fx0 - 1, wE = fx0 + fw; // the hall's side wall columns
  // --- the registration side (west) and the waiting side (east) -------------------------------------------------------------------
  const sx0 = 22, regH = rng.pick([16, 17, 18]); // registration hall rows y0 .. y0 + regH - 1, the marshals' post behind it
  const reg = add('registration', R(sx0, y0, wW - sx0, regH), 'room', 'crew-room', F0_CLEAR.sideHall, platform.id, BUNKER_PURPOSE.lock, true);
  const mar = add('marshals', R(sx0, y0 + regH + 1, wW - sx0, H - regH - 1), 'room', 'agent-office', F0_CLEAR.room, reg?.id ?? -1, 'security-office');
  const ex1 = 90; // the waiting hall's east wall column
  const wait = add('waiting', R(wE + 1, y0, ex1 - wE - 1, H), 'room', 'crew-room', F0_CLEAR.sideHall, platform.id, BUNKER_PURPOSE.dorm, true);
  if (!reg || !mar || !wait) return null;
  const prop = add('property', R(7, y0, sx0 - 1 - 7, H), 'room', 'storage', F0_CLEAR.room, reg.id, 'lost-property');
  const medW = rng.pick([14, 15, 16]);
  const med = add('medical', R(ex1 + 1, y0, medW, H), 'room', 'crew-room', F0_CLEAR.ward, wait.id, 'first-aid-room');
  if (!prop || !med) return null;
  const ox0 = ex1 + 1 + medW + 1, oy0 = y0 + rng.int(4, 7);
  const obs = add('observation', R(ox0, oy0, rng.pick([15, 16, 18]), S.bulkheadY - oy0), 'room', 'crew-room', F0_CLEAR.room, med.id, BUNKER_PURPOSE.decon);
  if (!obs) return null;
  // --- openings ---------------------------------------------------------------------------------------------------------------------
  const openings: Rect[] = [];
  const portal = (a: Area, x: number, w: number) => { const gap = R(x, wallY, w, 1); ctx.door(gap, platform, a, 3.2); openings.push(gap); };
  portal(hall, F0_PORTAL.x, F0_PORTAL.w); // the central portal on the vault axis (50..60: centre 55.5)
  const pw = 8;
  portal(reg, sx0 + Math.floor((reg.w - pw) / 2) + rng.int(-1, 1), pw);
  portal(wait, wait.x + Math.floor((wait.w - pw) / 2) + rng.int(-1, 1), pw);
  // registration -> vault hall: two narrow INSPECTION GATES from the cleared side behind the counter
  const yr1 = y0 + regH; // the registration hall's south wall row
  for (const gy of [yr1 - 7, yr1 - 3]) ctx.door(R(wW, gy, 1, 3), reg, hall, 2.6);
  // the marshals' post: off the registration hall's cleared side, and a side door onto the vault hall's apron
  ctx.door(R(sx0 + 2 + rng.int(0, 3), yr1, 3, 1), reg, mar, 2.6);
  ctx.door(R(wW, S.bulkheadY - 5, 1, 3), mar, hall, 2.6);
  // surrendered property: the hand-in door off the registration hall's public side
  ctx.door(R(sx0 - 1, y0 + 3 + rng.int(0, 3), 1, 4), reg, prop, 2.6);
  // waiting hall -> vault hall: an ARCADE — three 3 m openings on 1 m piers down the shared wall (the vault hall's low side aisle)
  for (const ay of [y0 + 1, y0 + 9, y0 + 17]) ctx.door(R(wE, ay, 1, 6), wait, hall, 3.0);
  // waiting hall -> medical inspection -> observation ward (the dead end)
  ctx.door(R(ex1, y0 + 10 + rng.int(0, 4), 1, 4), wait, med, 2.6);
  ctx.door(R(ex1 + 1 + medW, S.bulkheadY - 6 - rng.int(0, 4), 1, 3), med, obs, 2.6);
  // --- the vault side (off the vestibule only) --------------------------------------------------------------------------------------
  const vx1 = vest.x + vest.w; // the vestibule's east wall column (73)
  // (holders carry the floor's programme by PURPOSE: receiving's stores, the billeting officer's office)
  const recv = add('receiving', R(vx1 + 1, vest.y, rng.pick([16, 18, 20]), rng.pick([14, 16])), 'room', 'storage', F0_CLEAR.receiving, vest.id, 'storage');
  const bil = add('billeting', R(vest.x - 1 - 12, vest.y + 2, 12, rng.pick([9, 10, 11])), 'room', 'agent-office', F0_CLEAR.room, vest.id, 'agent-office');
  if (!recv || !bil) return null;
  ctx.door(R(vx1, vest.y + vest.h - 7, 1, 6), vest, recv, 3.0); // the goods door beside the lift's landing
  ctx.door(R(vest.x - 1, bil.y + 3 + rng.int(0, 2), 1, 3), vest, bil, 2.6);
  return {areas, openings, gas: [], damp: [], aged: [obs.id]};
}

export const FLOOR_0: BunkerFloorModule = {
  level: 0,
  title: 'Station — the admission concourse: the colonnaded vault hall on the door axis, registration and waiting halls, medical inspection',
  carve,
  dress: dressStation,
};
