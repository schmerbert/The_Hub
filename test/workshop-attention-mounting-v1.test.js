import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorldGraphStore } from '../src/world/graph.js';
import { residentToolProfile, schemasForResidentSession } from '../src/world/tools.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-attention-mount-'));
  const world = new WorldGraphStore(join(dir, 'world.sqlite'), { topologyVersion: 'b1' });
  world.ensureLifespan('life');
  return { world, close: async () => { world.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('resident schema fitting is an attention boundary, not a World authority boundary', async () => {
  const f = await fixture();
  try {
    f.world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
    const complete = f.world.availableTools('life');
    const initial = residentToolProfile(f.world, 'life');
    assert.equal(complete.includes('workshop_apply_patch'), true);
    assert.deepEqual(initial.names, [
      'move_through_door',
      'inspect_fixture',
      'engage_fixture',
      'disengage_fixture',
      'workshop_tool_catalog',
    ]);
    assert.equal(initial.completeCount, complete.length);
    assert.equal(initial.omittedCount, complete.length - initial.names.length);

    f.world.engageFixture({ sessionId: 'life', wakeId: 'wake', fixtureId: 'fixture.workshop_ledger' });
    const ledger = residentToolProfile(f.world, 'life');
    assert.equal(ledger.activeGroup, 'ledger');
    assert.equal(ledger.names.includes('workshop_git_status'), true);
    assert.equal(ledger.names.includes('workshop_apply_patch'), false);
    assert.equal(ledger.names.includes('workshop_run_recipe'), false);
    assert.deepEqual(schemasForResidentSession(f.world, 'life').map(tool => tool.function.name), ledger.names);

    f.world.engageFixture({ sessionId: 'life', wakeId: 'wake', fixtureId: 'fixture.workshop_kiln' });
    const kiln = residentToolProfile(f.world, 'life');
    assert.equal(kiln.activeGroup, 'kiln');
    assert.equal(kiln.names.includes('workshop_run_recipe'), true);
    assert.equal(kiln.names.includes('workshop_timer_set'), true);
    assert.equal(kiln.names.includes('workshop_git_status'), false);
  } finally { await f.close(); }
});
