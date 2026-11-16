// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the EVACUATION CENTRE's discoverable NOTES — short,
// readable handwritten / typed scraps that tell the outbreak story through the shelter's own people (environmental storytelling only:
// no quest, no unlock, no intel, no loot). Every note covers at least one of the three THEMES the user asked for:
//  - 'vent':  the ventilation has failed (air handlers down, filters choked, gas getting in);
//  - 'sick':  people are becoming zombies (fever, biting, the sick ward locked);
//  - 'plant': the main reactor is overrun (the plant crew stopped answering).
// A shelter shows 6-10 of them (gen/skyways/events/evacDress.ts: at least one per theme); the note prop (evacKinds.ts `evacNote`) shows
// its text on its paper (world/skywaysEvacDraw.ts: dynamic canvas text) and world/skywaysNotes.ts reads it up close (E). Pure data.

export type EvacNoteTheme = 'vent' | 'sick' | 'plant';
/** Where a note may lie: a desk / table top, pinned to a notice board, the medical bay, a bed / floor in the dormitory, the ration
 *  line, inside the barricaded quarantine, the family room, the shelter office. */
export type EvacNoteSlot = 'desk' | 'board' | 'medical' | 'bed' | 'rations' | 'quarantine' | 'family' | 'office';
/** Paper: a printed shelter notice, a lined pad page, a torn scrap. */
export type EvacNotePaper = 'notice' | 'lined' | 'scrap';

export interface EvacNote {
  id: string;
  themes: readonly EvacNoteTheme[];
  /** Who wrote it (QA / the evidence file). */
  voice: 'staff' | 'evacuee' | 'medic' | 'maintenance' | 'official';
  paper: EvacNotePaper;
  title?: string;
  body: string;
  sign?: string;
  at: readonly EvacNoteSlot[];
}

/** The authored pool (index = the note prop's text index: evacKinds.ts evacNoteVariant). Never reorder: append only. */
export const EVAC_NOTES: readonly EvacNote[] = [
  {id: 'notice-air-handlers', themes: ['vent'], voice: 'staff', paper: 'notice', title: 'SHELTER NOTICE',
    body: 'Air handlers 2 and 3 are down. Keep the fire doors to the bridges CLOSED. If you smell something sweet or your eyes sting, move to the dormitory hall and tell a staff member.',
    sign: 'Shelter management', at: ['board', 'desk']},
  {id: 'maint-filters', themes: ['vent'], voice: 'maintenance', paper: 'lined', title: 'Maint. log, Tuesday',
    body: 'Swapped the intake filters again. They come out grey-green and soft, like they were soaked. Third set since Sunday and we are out of spares. Air is getting in around the seals on the east side.',
    sign: 'R. Dhillon, building maintenance', at: ['office', 'desk', 'board']},
  {id: 'scrap-pennies', themes: ['vent'], voice: 'evacuee', paper: 'scrap',
    body: 'Mom, the air upstairs tastes like pennies. They moved everyone down to the big hall. Lots of people coughing. I am OK. Please come.',
    sign: 'J.', at: ['bed', 'family']},
  {id: 'notice-fans-off', themes: ['vent'], voice: 'staff', paper: 'notice', title: 'VENTILATION',
    body: 'Fans in this wing are OFF until further notice. Do not prop open vents or windows. Masks at the registration desk while supplies last.',
    at: ['board', 'desk', 'rations']},
  {id: 'medic-day4', themes: ['sick'], voice: 'medic', paper: 'lined', title: 'Medical log, day 4',
    body: 'Eleven with fever now. Two of them bit orderlies when we tried to take a temperature. Moved every fever case to isolation and locked the door. Need more hands.',
    sign: 'Dr. A. Okafor', at: ['medical', 'desk']},
  {id: 'nurse-day5', themes: ['sick'], voice: 'medic', paper: 'lined', title: 'Day 5',
    body: 'Whatever this is, it is not flu. First they stop answering, then they stop sleeping, then they come at the door. I have stopped going in.',
    sign: 'Nurse K.', at: ['quarantine', 'medical']},
  {id: 'notice-report-fever', themes: ['sick'], voice: 'staff', paper: 'notice', title: 'ALL EVACUEES',
    body: 'Report any fever, rash or bite wound to the medical bay IMMEDIATELY. Do not nurse sick family members yourselves. This is for everyone\'s safety.',
    at: ['board', 'desk', 'medical']},
  {id: 'scrap-dad', themes: ['sick'], voice: 'evacuee', paper: 'scrap',
    body: 'Dad is in the isolation room. They say I cannot see him. He was not even that sick, he just had a scratch on his arm. Nobody will tell me anything.',
    at: ['bed', 'family']},
  {id: 'scrap-do-not-open', themes: ['sick'], voice: 'evacuee', paper: 'scrap', title: 'DO NOT OPEN',
    body: 'They are NOT sleeping. Whoever they were, they are not your family any more. Keep this door shut.',
    at: ['quarantine']},
  {id: 'radio-desk', themes: ['plant'], voice: 'staff', paper: 'lined', title: 'Radio desk, 03:40',
    body: 'Still no answer from the reactor control room. Last call was the shift supervisor asking for police. Since then, nothing on any channel. Keep trying every thirty minutes.',
    at: ['desk', 'office', 'board']},
  {id: 'notice-plant-unsafe', themes: ['plant'], voice: 'official', paper: 'notice', title: 'CIVIL EMERGENCY UPDATE',
    body: 'The main reactor site is NOT safe. Plant staff have been withdrawn. Do not travel toward the plant or the south line. Stay in the shelter until told otherwise.',
    at: ['board', 'desk']},
  {id: 'scrap-rafe', themes: ['plant'], voice: 'evacuee', paper: 'scrap',
    body: 'Rafe drove the plant crew bus for six years. He went back Thursday to get his brother out. He said the reactor floor was full of them. He has not come back.',
    at: ['bed', 'family', 'rations']},
  {id: 'ops-liaison', themes: ['plant'], voice: 'staff', paper: 'lined', title: 'To the shelter manager',
    body: 'The plant liaison is gone. Their crew stopped answering Monday night. Last word was that the reactor building was overrun and the doors would not hold. We are on our own.',
    sign: 'Ops', at: ['office', 'desk']},
  {id: 'notice-rations', themes: ['plant'], voice: 'staff', paper: 'notice', title: 'RATIONS',
    body: 'One water and one meal per person per day. Children and the sick first. The supply convoy from the plant depot is not coming, so make it last.',
    at: ['rations', 'board', 'desk']},
  {id: 'medic-day6', themes: ['vent', 'sick'], voice: 'medic', paper: 'lined', title: 'Medical log, day 6',
    body: 'Gas exposure and the fever look the same at first. Coughing, then the eyes go cloudy. We cannot tell who is sick from the air and who is turning. The filters failed hours ago.',
    at: ['medical', 'quarantine']},
  {id: 'scrap-marta', themes: ['vent', 'sick'], voice: 'evacuee', paper: 'scrap', title: 'Mrs. Lau',
    body: 'We could not wait. Leo and I went for the trains. The air in here is going bad and the sick room door will not hold much longer. Go while you can.',
    sign: 'Marta, cot 41', at: ['bed', 'family', 'board']},
  {id: 'notice-roster', themes: ['plant'], voice: 'staff', paper: 'notice', title: 'SHIFT ROSTER CANCELLED',
    body: 'Plant volunteers: do NOT report to the reactor. Nobody from the night shift came back.',
    at: ['board', 'rations', 'desk']},
  {id: 'maint-extractor', themes: ['vent', 'sick'], voice: 'maintenance', paper: 'lined', title: 'Tech note',
    body: 'The isolation room has its own extractor fan. The extractor is dead. Whatever they breathe out stays in there. Keep the door shut and tape the gap.',
    sign: 'R.D.', at: ['quarantine', 'office', 'medical']},
];

export const EVAC_NOTE_THEMES: readonly EvacNoteTheme[] = ['vent', 'sick', 'plant'];
/** Notes per shelter (inclusive). */
export const EVAC_NOTE_COUNT = [6, 10] as const;
/** The full text of a note as read (title, body, signature). */
export function evacNoteText(n: EvacNote): string {
  return [n.title, n.body, n.sign ? `- ${n.sign}` : undefined].filter(Boolean).join('\n');
}
