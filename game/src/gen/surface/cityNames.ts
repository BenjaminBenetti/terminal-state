// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's seeded names — the district, its streets and its
// destinations (fictional brands only). Pure data + a name picker over a forked Rng (no other stream moves).

import type {Rng} from '../../core/rng';

const DISTRICT_ROOTS = ['Calder', 'Halsey', 'Wexford', 'Marlowe', 'Ashby', 'Kessler', 'Bramley', 'Tilden', 'Rowan', 'Garnet', 'Linden', 'Ostend',
  'Pruitt', 'Dorset', 'Fulton', 'Carver', 'Juniper', 'Hollis', 'Easton', 'Mercer', 'Prescott', 'Whitlow', 'Ardmore', 'Belden'] as const;
const DISTRICT_SUFFIX = ['Heights', 'Junction', 'Commons', 'Flats', 'Mills', 'Crossing', 'Square', 'Park', 'Yards', 'Village'] as const;

/** Street names (east-west streets and avenues); north-south streets are numbered. */
const STREET_ROOTS = ['Calder', 'Halsey', 'Wexford', 'Garnet', 'Linden', 'Carver', 'Dorset', 'Marlowe', 'Ashby', 'Kessler', 'Fulton', 'Bramley',
  'Ostend', 'Pruitt', 'Juniper', 'Rowan', 'Tilden', 'Hollis', 'Mercer', 'Easton', 'Belden', 'Ardmore', 'Prescott', 'Whitlow', 'Grange', 'Sutter',
  'Delancey', 'Harlan', 'Quincy', 'Vesey', 'Laurel', 'Orchard', 'Spruce', 'Chestnut', 'Hawthorn', 'Alder'] as const;
const AVENUE_ROOTS = ['Union', 'Kingsway', 'Lakeshore', 'Commerce', 'Central', 'Grand', 'Harbour', 'Victoria', 'Dominion', 'Federal'] as const;
const PERIMETER_SUFFIX = ['Road', 'Street', 'Boulevard', 'Parkway'] as const;

const SURNAMES = ['Halsey', 'Okafor', 'Brandt', 'Moreau', 'Kowalski', 'Nakamura', 'Ferreira', 'Lindqvist', 'Dunmore', 'Petrov', 'Castellano',
  'MacAllister', 'Varga', 'Osei', 'Delgado', 'Whitaker', 'Ibsen', 'Ruiz', 'Talbot', 'Haddad', 'Novak', 'Quinlan', 'Sorensen', 'Abernathy'] as const;

/** Fictional brand / name templates per programme ({S} = a surname, {T} = a street, {D} = the district root, {N} = a number). */
const PROGRAMME_NAMES: Record<string, readonly string[]> = {
  grocery: ['{S} Grocers', 'Fresh Basket Market', 'Corner Harvest Foods', 'Greenway Grocery', '{T} Food Market', 'Daily Pantry'],
  pharmacy: ['{S} Pharmacy', 'MedPlus Drugs', 'Corner Chemist', '{T} Apothecary', 'CareRite Pharmacy'],
  hardware: ['{S} Hardware', 'Anvil & Sons Hardware', 'Bolt & Beam Supply', '{T} Hardware & Paint', 'Ironside Tools'],
  clothing: ['Threadline', '{S} Outfitters', 'Stitch & Seam', 'Northside Apparel', 'Workwear Depot'],
  electronics: ['Volt Electronics', 'Circuit Shack', 'Signal Audio & Video', '{S} Electronics', 'PixelPoint'],
  convenience: ['Quik Stop', '24/7 Mart', 'Corner Convenience', 'Kwik-E Corner', 'Late Night Market'],
  liquor: ['{S} Wine & Spirits', 'Bottle Shop', '{T} Liquor', 'Cask & Cork'],
  'sporting-goods': ['{S} Sporting Goods', 'Trailhead Outdoor & Firearms', 'Rifle & Reel', 'Summit Sports', 'Ranger Outfitters'],
  bookstore: ['Dog-Ear Books', '{S} Books & Coffee', 'Paper Lantern Books', 'The Reading Room'],
  cafe: ['Daily Grind Café', '{S} Coffee House', 'Bean There Café', 'The Steam Room'],
  diner: ["{S}'s Diner", 'Starlite Diner', '{T} Grill', 'Blue Plate Diner', 'Night Owl Diner'],
  'strip-centre': ['{T} Plaza', '{S} Square Shopping Centre', '{D} Centre', '{T} Shopping Plaza'],
  arcade: ['{T} Arcade', '{D} Galleria', 'The {S} Arcade', '{T} Market Hall'],
  'office-block': ['{N} {T}', '{S} Building', 'Meridian House', 'Atlas Tower', '{T} Exchange', 'Commerce Court', 'Beacon House', '{S} & {S} Offices'],
  'rail-depot': ['{T} Rail Depot', '{D} Rail Maintenance Depot', '{T} Car Shops'],
  police: ['{D} Police Precinct {N}', 'Precinct {N} Station House'],
  'fire-station': ['Fire Station {N}', '{D} Fire Hall'],
  clinic: ['{T} Medical Clinic', '{D} Community Health Centre', '{S} Walk-In Clinic'],
};

export function districtName(rng: Rng): {name: string; root: string} {
  const root = rng.pick(DISTRICT_ROOTS);
  return {name: `${root} ${rng.pick(DISTRICT_SUFFIX)}`, root};
}

const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
};

/**
 * Names of the 9 x-lines (north-south streets) and 9 z-lines (east-west streets): numbered north-south streets (from a seeded first
 * number), named east-west streets, one named avenue per axis, and named perimeter roads.
 */
export function streetNames(rng: Rng, avX: number, avZ: number): {x: string[]; z: string[]} {
  const roots = rng.shuffle([...STREET_ROOTS]);
  const avenues = rng.shuffle([...AVENUE_ROOTS]);
  let r = 0;
  const first = rng.int(1, 9);
  const x: string[] = [], z: string[] = [];
  let num = first;
  for (let i = 0; i <= 8; i++) {
    if (i === avX) x.push(`${avenues[0]} Avenue`);
    else if (i === 0 || i === 8) x.push(`${roots[r++]} ${rng.pick(PERIMETER_SUFFIX)}`);
    else x.push(`${ordinal(num++)} Street`);
  }
  for (let i = 0; i <= 8; i++) {
    if (i === avZ) z.push(`${avenues[1]} Avenue`);
    else if (i === 0 || i === 8) z.push(`${roots[r++]} ${rng.pick(PERIMETER_SUFFIX)}`);
    else z.push(`${roots[r++]} Street`);
  }
  return {x, z};
}

/** A destination's sign name for its programme (unique within the district: `used` collects the names given). */
export function programmeName(rng: Rng, programme: string, street: string, districtRoot: string, used: Set<string>): string {
  const list = PROGRAMME_NAMES[programme];
  if (!list) return '';
  const streetRoot = street.replace(/ (Street|Avenue|Road|Boulevard|Parkway)$/, '').replace(/^\d+(st|nd|rd|th)$/, m => m);
  for (let k = 0; k < 12; k++) {
    const t = rng.pick(list);
    const s1 = rng.pick(SURNAMES), s2 = rng.pick(SURNAMES);
    let n = t.replace('{S}', s1).replace('{S}', s2 === s1 ? rng.pick(SURNAMES) : s2).replace('{T}', streetRoot).replace('{D}', districtRoot)
      .replace('{N}', String(rng.int(2, 480)));
    n = n.replace(/\s+/g, ' ').trim();
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = `${rng.pick(SURNAMES)} ${programme.replace(/-/g, ' ')} ${used.size + 1}`;
  used.add(n);
  return n;
}
