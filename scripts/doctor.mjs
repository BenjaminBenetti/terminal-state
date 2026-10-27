import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const ref=path.join(root,'reference');
const required=['design/VISION.md','design/FIRST-ASSET-PASS.md','design/ASSET-PIPELINE.md','design/BOARD-WORKFLOW.md','vision-board/index.html','vision-board/concepts.js','vision-board/assets/photo-credits.json','vision-board/assets/american-photo-credits.json','manifest.json','assets/masters/zombie-pixal3d.glb','assets/masters/zombie-pixal3d.metadata.json','tools/pixal3d-asset-lab/README.md'];
for(const file of required){if(!fs.existsSync(path.join(ref,file)))throw Error(`Missing shared reference: ${file}. Check the Fleet reference mount.`);}
const manifest=JSON.parse(fs.readFileSync(path.join(ref,'manifest.json'),'utf8'));
const hash=crypto.createHash('sha256');
for await (const chunk of fs.createReadStream(path.join(ref,'assets/masters/zombie-pixal3d.glb')))hash.update(chunk);
const sha=hash.digest('hex');
if(sha!==manifest.assets.zombie_master.sha256)throw Error('Original zombie master hash mismatch—do not use a changed master.');
console.log('Reference files present; board release:',manifest.apps.vision_board.release);
console.log('Original zombie SHA-256 verified:',sha);
for(const [tool,args] of [['node',['--version']],['python3',['--version']],['git',['--version']],['claude',['--version']],['codex',['--version']]]){try{console.log(execFileSync(tool,args,{encoding:'utf8',timeout:20000}).trim());}catch{throw Error(`${tool} is missing or failed`);}}
console.log('Workspace doctor passed. Authentication status is checked separately. No inference/models downloaded.');
