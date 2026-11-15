// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): the script of a BAKE WORKER (world/lightBakeTasks.ts is what
// it does; world/lightBakePool.ts starts it and talks to it).
//
// main.ts imports this file as an INLINE worker (`?worker&inline`): the build compiles it — with everything it imports — into one
// classic script and puts that script, as text, into the game's bundle; a worker is then started from a Blob of that text. So there
// is no second script file to deploy or to resolve at run time, and the worker runs exactly the bake code the page runs. What that
// asks of this module's imports (tests/light-bake-workers.test.ts holds them to it):
//  - no renderer library (world/lightFieldLayout.ts has the why): the worker's text is a few thousand lines, not a megabyte;
//  - no URL and no root path in any string (the release check reads the inlined text as one string of the bundle).
import {installBakeTasks, type BakePort} from './lightBakeTasks';

installBakeTasks(self as unknown as BakePort);
