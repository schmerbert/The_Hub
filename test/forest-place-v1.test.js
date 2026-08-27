import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldGraphStore } from '../src/world/graph.js';
import { forestTopologyEventPayload } from '../src/world/topology-forest.js';

function fixture(version = 'forest') {
  const dir = mkdtempSync(join(tmpdir(), 'hub-forest-place-'));
  const path = join(dir, 'world.sqlite');
  const world = new WorldGraphStore(path, { topologyVersion: version });
  return { dir, path, world, close() { world.close(); rmSync(dir, { recursive:true, force:true }); } };
}
function execute(world, sessionId, name, args, produce) {
  return world.transaction(() => {
    const result = produce();
    world.actionReceipt({ sessionId,wakeId:'wake',roomNodeId:world.current(sessionId).room_node_id,toolName:name,arguments:args,result,outcome:'committed',worldEventSequence:result.worldEventSequence,worldEventHash:result.worldEventHash });
    return result;
  }, { verify:true });
}

test('place.forest projects forest.resident and the Garden path crosses both directions', () => {
  const fx = fixture();
  try {
    const events = fx.world.sqlite.prepare('SELECT event_kind,payload_json FROM world_event_journal ORDER BY sequence').all();
    assert.equal(events.at(-1).event_kind, 'topology.forest_installed/v1');
    assert.deepEqual(JSON.parse(events.at(-1).payload_json), forestTopologyEventPayload());
    fx.world.ensureLifespan('life');
    execute(fx.world,'life','operate_passage',{passage_id:'passage.garden_house',action:'open'},() => fx.world.operatePassage({ sessionId:'life',wakeId:'wake',commandId:'open-door',passageId:'passage.garden_house',action:'open' }));
    execute(fx.world,'life','move_through_passage',{passage_id:'passage.garden_house'},() => fx.world.moveThroughPassage({ sessionId:'life',wakeId:'wake',commandId:'to-garden',passageId:'passage.garden_house' }));
    assert.equal(fx.world.current('life').room_node_id, 'place.garden');
    execute(fx.world,'life','move_through_passage',{passage_id:'passage.garden_forest'},() => fx.world.moveThroughPassage({ sessionId:'life',wakeId:'wake',commandId:'to-forest',passageId:'passage.garden_forest' }));
    assert.equal(fx.world.current('life').room_node_id, 'place.forest');
    assert.equal(JSON.parse(fx.world.node('place.forest').state_json).projects, 'forest.resident');
    const homeward = execute(fx.world,'life','move_through_passage',{passage_id:'passage.garden_forest'},() => fx.world.moveThroughPassage({ sessionId:'life',wakeId:'wake',commandId:'homeward',passageId:'passage.garden_forest' }));
    assert.deepEqual(homeward.crossingCheck, { kind:'forest_homeward_check',status:'clear',policyVersion:'forest_homeward/v1' });
    assert.equal(fx.world.current('life').room_node_id, 'place.garden');
    assert.ok(!fx.world.projection('life').boundaries.some(boundary => boundary.to === 'boundary.forest'));
    assert.equal(fx.world.verification().verified, true);
  } finally { fx.close(); }
});

test('Forest-place migration is backup-gated, append-only, and preserves current location', () => {
  const fx = fixture('hearth');
  try {
    fx.world.ensureLifespan('life');
    assert.equal(fx.world.inspectForestUpgrade().status, 'upgrade_required');
    assert.throws(() => fx.world.migrateForest(), error => error.code === 'world_forest_backup_required');
    const before = fx.world.current('life').room_node_id;
    const migrated = fx.world.migrateForest({ backupConfirmed:true });
    assert.equal(migrated.status, 'migrated');
    assert.equal(fx.world.current('life').room_node_id, before);
    assert.equal(fx.world.verification().verified, true);
    assert.throws(() => fx.world.sqlite.prepare("DELETE FROM world_event_journal WHERE event_kind='topology.forest_installed/v1'").run(), /append-only/);
  } finally { fx.close(); }
});
