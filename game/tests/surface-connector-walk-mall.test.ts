// Task studio-surface-host-ground-connectors-20261118-053602-01: the walked connector of a MALL, both ways, on the real Game in Node
// (tests/helpers/surfaceConnectorWalk.ts). One host per file (CI runtime: several minutes on one worker).
import {it} from 'vitest';
import {connectorHostWalk} from './helpers/surfaceConnectorWalk';

it('mall: through the tube to the command tent and back on foot, no loading screen, no cut, the host exactly as left', async () => {
  await connectorHostWalk('mall');
}, 900_000);
