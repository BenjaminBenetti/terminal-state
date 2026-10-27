// Worker for fit-pool.mjs: runs fit.mjs fitVariant for one (outfit, body) pair, then (iteration 07)
// the pose-aware refit lib/fit07.mjs for upper garments and pants when validation poses are supplied.
import {parentPort} from 'node:worker_threads';
import {fitVariant} from './fit.mjs';
import {refineFit} from './fit07.mjs';

parentPort.on('message', ({id, gC, cfg, C, B}) => {
  try {
    let v = fitVariant(gC, cfg, C, B);
    if ((cfg.kind === 'garment' || cfg.kind === 'pants') && cfg.fit07 !== false && B.poses?.length) v = refineFit(v, gC, cfg, B);
    parentPort.postMessage({id, v});
  } catch (e) {
    parentPort.postMessage({id, error: String(e && e.stack || e)});
  }
});
