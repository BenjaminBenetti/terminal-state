// Task reactor-expansion-20261101 (lane PATHS): the cooked models' real triangles for the pathway audit in Node (not a test file):
// pathsAudit.ts glbTriangles over game/public/<url>, cached per url. Pass as auditReactorPaths(layout, {meshOf: testMeshOf}).
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {glbTriangles} from '../src/world/reactor/pathsAudit';

const cache = new Map<string, Float32Array | null>();

export function testMeshOf(url: string): Float32Array | null {
  if (!cache.has(url)) {
    const f = fileURLToPath(new URL(`../public/${url}`, import.meta.url));
    cache.set(url, existsSync(f) ? glbTriangles(readFileSync(f)) : null);
  }
  return cache.get(url)!;
}
