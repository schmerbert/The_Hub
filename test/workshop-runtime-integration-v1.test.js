import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHub } from '../src/server/app.js';
import { ResultRackStore } from '../src/world/results.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorkshopAdapter } from '../src/places/hub/workshop/index.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { placeInWorkshopFromHouse } from './support/house-navigation.js';

async function rootFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-runtime-integration-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  await writeFile(join(repo, 'large.txt'), `${'line content '.repeat(40)}\n`.repeat(80), 'utf8');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', private: true }), 'utf8');
  return { dir, repo };
}

test('ordinary Workshop returns use fitted Result Rack content with resolvable exact custody', async () => {
  const f = await rootFixture();
  const world = new WorldGraphStore(join(f.dir, 'world.sqlite'), { topologyVersion: 'b1' });
  const results = new ResultRackStore(join(f.dir, 'results.sqlite'), { projectionMaxBytes: 700, projectionMaxLines: 12 });
  const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(f.repo, { maxBytes: 100000, maxLines: 200 }), resultRack: results, approvalMode: 'auto' });
  try {
    world.ensureLifespan('life');
    world.move({ sessionId: 'life', wakeId: 'wake', doorId: 'door.workshop' });
    const action = await gateway.execute({ sessionId: 'life', wakeId: 'wake', intent: { id: 'read', type: 'function', function: { name: 'workshop_read', arguments: JSON.stringify({ path: 'large.txt', start_line: 1, line_count: 80 }) } } });
    assert.equal(action.scrub.receipt.policy, 'result_rack_projection_v1');
    assert.equal(action.scrub.receipt.exact, false);
    assert.equal(action.resultRack.projection.truncated, true);
    assert.match(action.scrub.message.content, /exact custody: result-rack:\/\//i);
    const exact = results.readExact(action.resultRack.projection.exactPointer);
    assert.equal(exact.sourceHash, action.resultRack.projection.sourceHash);
    const artifact = results.getArtifact(action.resultRack.artifactId);
    assert.deepEqual(JSON.parse(artifact.body.toString('utf8')), action.result);
  } finally { gateway.close(); results.close(); world.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('provider dispatch persists attention measurement and presents only the fitted fixture schema profile', async () => {
  const f = await rootFixture();
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(f.dir, 'hub.sqlite'), HUB_WORKSHOP_ROOT: f.repo } });
  try {
    await placeInWorkshopFromHouse(hub.world, hub.gateway, hub.db.session.id, 'host-setup');
    const wake = await hub.wake('Show me the Workshop.');
    assert.equal(wake.status, 'committed');
    const responsePhase = wake.phases.find(phase => phase.phase === 'response');
    assert.equal(responsePhase.attention.phase, 'response');
    assert.equal(responsePhase.attention.dispatchAllowed, true);
    assert.equal(responsePhase.attention.toolProfile.omittedCount > 20, true);
    const body = JSON.parse(responsePhase.requestBody);
    assert.deepEqual(body.tools.map(tool => tool.function.name), responsePhase.attention.toolProfile.names);
    assert.equal(body.tools.some(tool => tool.function.name === 'workshop_apply_patch'), false);
    assert.equal(body.tools.some(tool => tool.function.name === 'workshop_tool_catalog'), true);
  } finally { hub.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('attention refusal is append-only custody even when no provider request is prepared', async () => {
  const f = await rootFixture();
  const hub = createHub({ env: {
    HUB_RESIDENT_MODE: 'fake',
    HUB_DB_PATH: join(f.dir, 'hub.sqlite'),
    HUB_WORKSHOP_ROOT: f.repo,
    HUB_ATTENTION_WARN_BYTES: '1',
    HUB_ATTENTION_REFUSE_BYTES: '2',
  } });
  try {
    const wake = await hub.wake('This crossing must refuse before dispatch.');
    assert.equal(wake.status, 'failed');
    assert.equal(wake.failureCode, 'attention_ceiling_exceeded');
    assert.equal(wake.phases.length, 0);
    assert.equal(wake.attentionReceipts.length, 1);
    assert.equal(wake.attentionReceipts[0].status, 'refuse');
    assert.equal(hub.provider.calls.length, 0);
    assert.throws(() => hub.db.sqlite.prepare("UPDATE attention_receipts SET status='ok'").run(), /append-only/);
  } finally { hub.close(); await rm(f.dir, { recursive: true, force: true }); }
});
