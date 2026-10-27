// Worker for fit-pool.mjs: runs fit.mjs fitVariant for one (outfit, body) pair.
import {parentPort} from 'node:worker_threads';
import {fitVariant} from './fit.mjs';

parentPort.on('message', ({id, gC, cfg, C, B}) => {
  try {
    const v = fitVariant(gC, cfg, C, B);
    parentPort.postMessage({id, v});
  } catch (e) {
    parentPort.postMessage({id, error: String(e && e.stack || e)});
  }
});
