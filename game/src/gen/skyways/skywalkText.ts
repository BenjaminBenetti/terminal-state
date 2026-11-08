// Task studio-skywalk-variety-20261107-231448-01 (user: the map board "references '+15' which ties it directly to the inspiration art
// ... just say 'skywalk' or something"): the PLAYER-FACING wording of the Skyways' upper level and its bridges is the generic
// "Skywalk". Layout data of stations generated before (versions 1–3: '+15 Skyway' storey labels, "<name> +15" complex names, stair
// labels "Street level – +15", "Skyway bridge · …") is never rewritten (fingerprints / memory refer to it): every display point
// passes its text through skywalkText instead. Idempotent.

/** A Skyways label as the player reads it: '+15' / 'Skyway' wording -> 'Skywalk'. */
export function skywalkText(s: string): string {
  return s.replace(/\+15 Skyway\b/g, 'Skywalk').replace(/\+15\b/g, 'Skywalk').replace(/\bSKYWAY\b/g, 'SKYWALK').replace(/\bSkyway\b/g, 'Skywalk');
}
