import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldGraphStore } from '../src/world/graph.js';
import { spatialHorizon } from '../src/world/spatial-horizon.js';

test('verified World presence distinguishes known containment, routes, and withheld access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-spatial-horizon-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'spotlight' });
  try {
    world.ensureLifespan('life');
    const house = world.presenceMessage('life');
    assert.match(house, /Garden is the exterior junction beside the Hub\./);
    assert.match(house, /Verified Hub rooms: Center \(room\.center\), Spotlight Observatory \(room\.spotlight\), Workshop \(room\.workshop\)\./);
    assert.match(house, /Known route to the Workshop: House -> Garden -> Center -> Workshop\./);
    assert.match(house, /Spotlight Observatory exists within the Hub, but no traversable route to it is installed\./);

    const nodes = world.sqlite.prepare("SELECT id,node_type AS nodeType FROM world_nodes WHERE lifecycle='standing' ORDER BY id").all();
    const edges = world.sqlite.prepare("SELECT edge_type AS edgeType,from_node_id AS fromNodeId,to_node_id AS toNodeId FROM world_edges ORDER BY id").all();
    const garden = spatialHorizon({ currentRoomId:'place.garden', nodes, edges });
    assert.match(garden, /^South is the Hub\./);
    assert.match(garden, /Known route to the Workshop: Garden -> Center -> Workshop\./);

    const center = spatialHorizon({ currentRoomId:'room.center', nodes, edges });
    assert.match(center, /You are within the Hub in the Center\./);
    assert.match(center, /Known route to the Workshop: Center -> Workshop\./);
  } finally { world.close(); await rm(dir, { recursive:true, force:true }); }
});
