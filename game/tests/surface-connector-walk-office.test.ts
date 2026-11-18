// Task studio-surface-host-ground-connectors-20261118-053602-01: the walked connector of an OFFICE tower, both ways, on the real Game in Node
// (tests/helpers/surfaceConnectorWalk.ts), then a refusal at the seam and a failed crossing's recovery. One host per file (CI runtime:
// several minutes on one worker).
import {it} from 'vitest';
import {connectorHostWalk} from './helpers/surfaceConnectorWalk';

it('office: through the tube to the command tent and back on foot, no loading screen, no cut, the host exactly as left; refusal; recovery', async () => {
  await connectorHostWalk('office', {extras: true});
}, 900_000);
