// Apply only the documented read-only UI changes after Main supplies the package.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../public/vision-board');
const jsPath=path.join(root,'core-assets.js'), htmlPath=path.join(root,'index.html');
let js=fs.readFileSync(jsPath,'utf8');
if (!js.includes('const STUDIO_READ_ONLY = true;')) {
  const edits=[
    ["  const API =", "  const STUDIO_READ_ONLY = true;\n  const API ="],
    ['= !apiReady || card.busy;', '= STUDIO_READ_ONLY || !apiReady || card.busy;'],
    ["card.busy ? 'Saving…' : 'Save review'", "STUDIO_READ_ONLY ? 'Read-only snapshot' : card.busy ? 'Saving…' : 'Save review'"],
    ["card.draft.textContent = card.dirty ?", "card.draft.textContent = STUDIO_READ_ONLY ? 'Frozen review snapshot — no shared connection' : card.dirty ?"],
    ["notice.textContent = !manifestReady ?", "notice.textContent = STUDIO_READ_ONLY ? 'Read-only Studio snapshot. Frozen reviews; no live/shared connection. Review editing and saving are disabled.' : !manifestReady ?"],
    ['  async function saveReview(card) {', "  async function saveReview(card) {\n    if (STUDIO_READ_ONLY) { card.message.textContent = 'Read-only Studio snapshot: no review was saved.'; return; }"]
  ];
  for (const [from,to] of edits) { if (!js.includes(from)) throw Error(`UI source changed: missing ${from}`); js=js.replace(from,to); }
  fs.writeFileSync(jsPath,js);
}
let html=fs.readFileSync(htmlPath,'utf8');
if (!html.includes('id="studio-snapshot-notice"')) {
  html=html.replace(/<body([^>]*)>/, '<body$1><aside id="studio-snapshot-notice" role="note" style="padding:16px;background:#efd36c;color:#171717;font: bold 16px sans-serif">Read-only Studio snapshot · board38 · Not live or shared-connected. Reviews are frozen; editing and saving are disabled. Scratchpad notes stay only in this browser.</aside>');
  fs.writeFileSync(htmlPath,html);
}
console.log('Packaged UI modified only: index.html notice; core-assets.js read-only labels, disabled inputs and save-handler guard. Catalog/viewer/assets untouched.');
