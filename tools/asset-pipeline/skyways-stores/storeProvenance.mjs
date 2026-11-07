// Task studio-alpha-skyways-shops-20261107-054512-01 (primary, integration): ONE provenance record for the Skyways major stores' Codex art
// (game/public/assets/derivatives/skyways-store-art-20261107.json, a section per store: `stores.<family>` = that store's full record, as
// its build script writes it). One file instead of one per store keeps the release build under package-ci's 1000-file cap.
// Each store's build script replaces only its own section (read, replace, write; the other sections byte-for-byte as they were).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const STORE_ART_PROV_REL = 'assets/derivatives/skyways-store-art-20261107.json';
const FILE = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), 'game/public', STORE_ART_PROV_REL);

/** The combined record with `family`'s section set to `prov` (sections sorted by family), as the bytes to write / check. */
export function storeProvenanceBuffer(family, prov) {
  const cur = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  const stores = {...(cur?.stores ?? {}), [family]: prov};
  const out = {
    schema: 'last-line-derivative-set/1',
    asset: 'skyways-store-art-20261107',
    task: 'studio-alpha-skyways-shops-20261107-054512-01',
    note: "the Skyways major stores' Codex art provenance, one section per store (each written by that store's build script under tools/asset-pipeline/skyways-stores/<family>/); unapproved prototypes, provider terms apply, no licence or commercial clearance implied",
    stores: Object.fromEntries(Object.keys(stores).sort().map(k => [k, stores[k]])),
  };
  return Buffer.from(JSON.stringify(out, null, 1) + '\n');
}

/** A store's section of the combined record (tests). */
export function storeProvenance(family) {
  return JSON.parse(fs.readFileSync(FILE, 'utf8')).stores[family];
}
