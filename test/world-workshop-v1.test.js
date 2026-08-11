import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/server/app.js';
import { HubDatabase } from '../src/ledger/source.js';
import { ForestStore } from '../src/forest/store.js';
import { verifyForest } from '../src/forest/verify.js';
import { sha256 } from '../src/core/hash.js';
import { SpineStore, verifySpine } from '../src/spine/store.js';
import { WorkshopAdapter } from '../src/world/workshop.js';
import { WorldActionGateway } from '../src/world/gateway.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { scrubHostReturn, assertScrubbedHostReturn } from '../src/scrub/host-return.js';

async function fixture(provider, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-v1-'));
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_WORKSHOP_ROOT: process.cwd(), ...extra }, provider });
  await new Promise(resolve => hub.server.listen(0, resolve));
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  return { dir, hub, base, close: async () => { await new Promise(resolve => hub.server.close(resolve)); hub.close(); await rm(dir, { recursive: true, force: true }); } };
}
async function post(base, content) { const response = await fetch(`${base}/api/wakes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }); return { response, body: await response.json() }; }

test('World Graph seed is exact and idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-seed-')); const path = join(dir, 'world.sqlite');
  try {
    const first = new WorldGraphStore(path);     assert.equal(first.sqlite.prepare('SELECT COUNT(*) AS count FROM world_nodes').get().count, 22); assert.equal(first.sqlite.prepare('SELECT COUNT(*) AS count FROM world_edges').get().count, 25); assert.ok(first.sqlite.prepare('SELECT id FROM world_nodes ORDER BY id').all().map(row => row.id).includes('place.garden')); assert.equal(first.node('object.tin_cup').state_json.includes('unknown_empty'), false); assert.equal(JSON.parse(first.node('object.tin_cup').state_json).contents, 'unspecified'); assert.equal(first.node('station.spec_table').lifecycle, 'retired');
    assert.throws(() => first.sqlite.prepare("UPDATE world_nodes SET resident_text='drift' WHERE id='room.center'").run(), /standing world nodes are append-only/); assert.throws(() => first.sqlite.prepare("DELETE FROM world_nodes WHERE id='room.center'").run(), /standing world nodes are append-only/); assert.throws(() => first.sqlite.prepare("UPDATE world_edges SET label='drift' WHERE id='edge.door.workshop.center_to_workshop'").run(), /standing world edges are append-only/); assert.throws(() => first.sqlite.prepare("DELETE FROM world_edges WHERE id='edge.door.workshop.center_to_workshop'").run(), /standing world edges are append-only/); first.close();
    const second = new WorldGraphStore(path); assert.deepEqual(second.availableTools('session-missing'), ['move_through_door', 'move_through_passage', 'inspect_fixture']); assert.equal(second.current('session-a').room_node_id, 'room.center'); second.close();
    const third = new WorldGraphStore(path); assert.equal(third.sqlite.prepare('SELECT COUNT(*) AS count FROM world_nodes').get().count, 22); assert.equal(third.sqlite.prepare('SELECT COUNT(*) AS count FROM world_edges').get().count, 25); third.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('World Graph schema rejects invalid and orphan graph rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-schema-')); const path = join(dir, 'world.sqlite');
  try {
    const world = new WorldGraphStore(path); const now = new Date().toISOString();
    assert.ok(world.sqlite.prepare('PRAGMA foreign_key_list(world_edges)').all().some(row => row.table === 'world_nodes'));
    assert.ok(world.sqlite.prepare('PRAGMA foreign_key_list(world_location_events)').all().some(row => row.table === 'world_edges'));
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_nodes(id,node_type,resident_text,state_json,lifecycle,revision,created_at) VALUES(?,?,?,?,?,?,?)').run('bad.node.type', 'unknown', 'bad', '{}', 'standing', 1, now), /CHECK constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_nodes(id,node_type,resident_text,state_json,lifecycle,revision,created_at) VALUES(?,?,?,?,?,?,?)').run('bad.lifecycle', 'room', 'bad', '{}', 'unknown', 1, now), /CHECK constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_nodes(id,node_type,resident_text,state_json,lifecycle,revision,created_at) VALUES(?,?,?,?,?,?,?)').run('bad.revision', 'room', 'bad', '{}', 'standing', 0, now), /CHECK constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_edges(id,edge_type,from_node_id,to_node_id,door_identity,label,created_at) VALUES(?,?,?,?,?,?,?)').run('bad.edge.type', 'unknown', 'room.center', 'room.workshop', null, null, now), /CHECK constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_edges(id,edge_type,from_node_id,to_node_id,door_identity,label,created_at) VALUES(?,?,?,?,?,?,?)').run('bad.edge.endpoint', 'door', 'room.missing', 'room.workshop', 'bad', 'Bad', now), /FOREIGN KEY constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_locations(session_id,room_node_id,inspected_source,engaged_fixture_id,revision,started_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('bad.location.room', 'room.missing', null, null, 1, now, now), /FOREIGN KEY constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_locations(session_id,room_node_id,inspected_source,engaged_fixture_id,revision,started_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('bad.location.revision', 'room.center', null, null, 0, now, now), /CHECK constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run('bad.event.from', 'session-test', null, 'resident_tool', 'room.missing', 'room.center', null, null, now, '{}'), /FOREIGN KEY constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run('bad.event.edge', 'session-test', null, 'resident_tool', 'room.center', 'room.workshop', 'edge.missing', 'bad', now, '{}'), /FOREIGN KEY constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_action_receipts(receipt_id,session_id,wake_id,room_node_id,tool_name,arguments_json,result_json,outcome,request_record_id,spine_record_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('bad.action.room', 'session-test', null, 'room.missing', 'move_through_door', '{}', '{}', 'committed', null, null, now), /FOREIGN KEY constraint failed/);
    assert.throws(() => world.sqlite.prepare('INSERT INTO world_action_receipts(receipt_id,session_id,wake_id,room_node_id,tool_name,arguments_json,result_json,outcome,request_record_id,spine_record_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('bad.action.outcome', 'session-test', null, 'room.center', 'move_through_door', '{}', '{}', 'unknown', null, null, now), /CHECK constraint failed/);
    world.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('location is per lifespan and prior movement ancestry is retained', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-location-')); const path = join(dir, 'world.sqlite');
  try {
    const world = new WorldGraphStore(path); world.ensureLifespan('lifespan-old'); const moved = world.move({ sessionId: 'lifespan-old', wakeId: 'wake-old', doorId: 'door.workshop' }); assert.equal(moved.toRoom, 'room.workshop'); assert.equal(world.current('lifespan-old').room_node_id, 'room.workshop'); world.ensureLifespan('lifespan-new'); assert.equal(world.current('lifespan-new').room_node_id, 'room.center'); assert.equal(world.listLocationEvents('lifespan-old').length, 1); assert.equal(world.listLocationEvents('lifespan-new').length, 0); world.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Workshop exact reads/searches reject hostile repository targets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-workshop-')); await mkdir(join(dir, 'safe')); await writeFile(join(dir, 'safe', 'one.txt'), 'alpha\nbeta\ngamma\n', 'utf8'); await writeFile(join(dir, 'safe', 'many.txt'), 'needle\nneedle\n', 'utf8'); await writeFile(join(dir, 'safe', 'crlf.txt'), 'one\r\ntwo\r\nthree', 'utf8'); await writeFile(join(dir, '.env'), 'SECRET=no', 'utf8'); let hasSymlink = true; try { await symlink(join(dir, 'safe'), join(dir, 'link')); } catch { hasSymlink = false; }
  try {
    const workshop = new WorkshopAdapter(dir, { maxFiles: 20, maxBytes: 1000, maxLines: 10, maxResults: 10 });
    const lfRead = workshop.read('safe/one.txt', 2, 1); assert.equal(lfRead.source.text, 'beta\n'); assert.equal(lfRead.source.endLine, 2); assert.equal(workshop.search('beta', 'safe').matches[0].text, 'beta\n');
    const crlfRead = workshop.read('safe/crlf.txt', 2, 2); assert.equal(crlfRead.source.text, 'two\r\nthree'); assert.equal(crlfRead.source.endLine, 3); assert.equal(crlfRead.source.byteLength, Buffer.byteLength('two\r\nthree', 'utf8')); assert.equal(crlfRead.source.hash, sha256('two\r\nthree'));
    assert.equal(workshop.search('needle', 'safe', 2).truncated, false); assert.equal(workshop.search('needle', 'safe', 1).truncated, true); assert.equal(workshop.list('.').entries.some(entry => entry.name === '.env' || entry.name === 'link'), false);
    assert.throws(() => workshop.read('../safe/one.txt'), error => error.code === 'workshop_path_invalid'); assert.throws(() => workshop.read('.env'), error => error.code === 'workshop_path_forbidden'); if (hasSymlink) assert.throws(() => workshop.read('link/one.txt'), error => error.code === 'workshop_path_forbidden');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('host-return Scrub is exact and identity-labelled', () => {
  const scrubbed = scrubHostReturn({ toolName: 'workshop_read', arguments: { path: 'src/world/graph.js' }, result: { kind: 'workshop_read', exact: true } });
  assertScrubbedHostReturn(scrubbed); assert.match(scrubbed.receipt.receiptId, /^host_return_scrub_/); assert.equal(JSON.parse(scrubbed.message.content).kind, 'workshop_read'); assert.equal(scrubbed.receipt.changed, false);
  assert.equal(scrubbed.receipt.receiptId, scrubHostReturn({ toolName: 'workshop_read', arguments: { path: 'src/world/graph.js' }, result: { kind: 'workshop_read', exact: true } }).receipt.receiptId);
  const projected = scrubHostReturn({ toolName: 'tend_hearth', arguments: {}, result: { markdown: '# Hearth Scroll', room: { roomId: 'room.center' } }, content: '# Hearth Scroll', renderPolicy: 'hearth_scroll_markdown_v1' });
  assertScrubbedHostReturn(projected); assert.equal(projected.receipt.policy, 'hearth_scroll_markdown_v1'); assert.equal(projected.receipt.changed, true); assert.equal(projected.receipt.exact, false); assert.throws(() => scrubHostReturn({ toolName: 'tend_hearth', arguments: {}, result: { markdown: '# Hearth Scroll' }, content: '# Hearth Scroll' }), /deterministic render policy/);
});

test('Workshop source admission is additive Wild custody and Home remains empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-wild-')); const operationalPath = join(dir, 'hub.sqlite'); const forestPath = join(dir, 'forest.sqlite'); const spinePath = join(dir, 'spine.jsonl'); const worldPath = join(dir, 'world.sqlite');
  const db = new HubDatabase(operationalPath); const forest = new ForestStore(forestPath); const spine = new SpineStore(spinePath); const world = new WorldGraphStore(worldPath); let wake;
  try {
    wake = db.createSessionWake({ provider: 'deepseek', model: 'test-model', content: 'wild test' }); db.markCalling(wake.wakeId); const requestBody = JSON.stringify({ model: 'test-model', messages: [] }); const frame = spine.prepareRequest({ requestBody, threadId: db.threadId, wakeId: wake.wakeId, provider: 'deepseek', model: 'test-model', authorizationPresent: false, requestPhase: 'ordinary' }); const providerRequestId = db.recordProviderRequest({ sessionId: wake.sessionId, wakeId: wake.wakeId, phase: 'ordinary', requestBody, messageSources: [], spineRecordId: frame.record_id }); spine.dispatchAttempted(frame.record_id); spine.providerRawReturn(frame.record_id, { body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'workshop_read', arguments: '{}' } }] } }] }), httpStatus: 200 }); spine.providerOutcome(frame.record_id, { kind: 'success', http_status: 200, response_id: 'test-response' }); db.completeProviderRequest(providerRequestId, { message: { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'workshop_read', arguments: '{}' } }] }, responseId: 'test-response', finishReason: 'tool_calls' }, { kind: 'success', http_status: 200 }); world.ensureLifespan(wake.sessionId);
    const exactText = 'one\ntwo'; const source = { path: 'src/example.js', startLine: 4, endLine: 5, text: exactText, hash: sha256(exactText), byteLength: 7 }; const action = world.actionReceipt({ sessionId: wake.sessionId, wakeId: wake.wakeId, roomNodeId: 'room.workshop', toolName: 'workshop_read', arguments: { path: source.path, start_line: source.startLine, line_count: 2 }, result: { kind: 'workshop_read', source, lineCount: 2, exact: true }, outcome: 'committed', requestRecordId: providerRequestId, spineRecordId: frame.record_id });
    const rows = forest.ingestWorkshopSource({ sourceKind: 'workshop_read', source, actionReceiptId: action.receiptId, spineRecordId: frame.record_id, requestRecordId: providerRequestId });
    assert.equal(rows.length, 1); assert.equal(forest.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_entries').get().count, 0); assert.equal(forest.listWildEntries()[0].bucket, 'workshop_source'); assert.equal(forest.sqlite.prepare('SELECT schema_version FROM forest_metadata WHERE metadata_id=1').get().schema_version, 1); assert.equal(forest.sqlite.prepare('SELECT schema_name, schema_version FROM wild_metadata WHERE metadata_id=1').get().schema_name, 'forest_wild');
    assert.throws(() => verifyForest({ forestPath, operationalPath, spinePath, strictBijection: false }), /World Graph path/); assert.equal(verifyForest({ forestPath, operationalPath, spinePath, worldPath, strictBijection: false }).wildCount, 1);
  } finally { spine.close(); world.close(); forest.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('active Workshop read admits its exact span to Wild with action ancestry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-world-active-wild-')); const operationalPath = join(dir, 'hub.sqlite'); const forestPath = join(dir, 'forest.sqlite'); const worldPath = join(dir, 'world.sqlite');
  const db = new HubDatabase(operationalPath); const forest = new ForestStore(forestPath); const world = new WorldGraphStore(worldPath); world.ensureLifespan('lifespan-test'); world.move({ sessionId: 'lifespan-test', wakeId: 'wake-test', doorId: 'door.workshop' });
  try {
    const gateway = new WorldActionGateway({ world, forest, workshop: new WorkshopAdapter(process.cwd(), { maxLines: 8, maxBytes: 100000, maxFiles: 30, maxResults: 10 }) });
    const action = await gateway.execute({ sessionId: 'lifespan-test', wakeId: 'wake-test', requestRecordId: 'provider-request-test', spineRecordId: 'spine-record-test', intent: { id: 'read-test', type: 'function', function: { name: 'workshop_read', arguments: '{"path":"src/world/graph.js","start_line":1,"line_count":2}' } } });
    assert.equal(forest.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_entries').get().count, 0); const wild = forest.listWildEntries(); assert.equal(wild.length, 1); assert.equal(wild[0].repository_path, 'src/world/graph.js'); assert.equal(wild[0].request_record_id, 'provider-request-test'); assert.equal(wild[0].spine_record_id, 'spine-record-test'); assert.equal(wild[0].body_hash, action.result.source.hash); assert.equal(action.scrub.receipt.actionReceiptId, action.actionReceipt.receiptId); assert.equal(action.scrub.receipt.requestRecordId, 'provider-request-test'); assert.equal(action.scrub.receipt.spineRecordId, 'spine-record-test'); assert.equal(action.scrub.receipt.outputHash, (await import('../src/core/hash.js')).sha256(action.scrub.message.content));
  } finally { world.close(); forest.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('room-gated bounded native loop moves, reads, and keeps Home separate', async () => {
  let responseRound = 0;
  const provider = {
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      responseRound += 1;
      if (responseRound === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'move', type: 'function', function: { name: 'move_through_door', arguments: '{"door_id":"door.workshop"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      if (responseRound === 2) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'workshop_read', arguments: '{"path":"src/world/graph.js","start_line":1,"line_count":2}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: 'The Workshop return was exact.' }, content: 'The Workshop return was exact.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider);
  try {
    const result = await post(f.base, 'Open the Workshop and inspect the graph.'); assert.equal(result.response.status, 200); assert.equal(result.body.status, 'committed'); assert.equal(result.body.events.filter(event => event.eventKind === 'state').length, 6); assert.equal(f.hub.world.current(result.body.sessionId).room_node_id, 'room.workshop'); assert.equal(verifySpine(f.hub.config.spinePath).ok, true);
    assert.equal(f.hub.world.listLocationEvents(result.body.sessionId).length, 1); assert.equal(f.hub.forest, null); assert.equal(f.hub.db.getSessionHistory(result.body.sessionId).filter(item => item.messageKind === 'tool_result').length, 3);
    const history = f.hub.db.getSessionHistory(result.body.sessionId).filter(item => item.messageKind === 'tool_result');
    const receipts = f.hub.db.sqlite.prepare('SELECT * FROM host_return_scrub_receipts WHERE session_id=? ORDER BY created_at, id').all(result.body.sessionId);
    assert.equal(receipts.length, history.length); assert.equal(new Set(receipts.map(row => row.id)).size, receipts.length);
    for (const row of history) { assert.ok(row.scrubReceiptId); const receipt = receipts.find(candidate => candidate.id === row.scrubReceiptId); assert.ok(receipt); assert.equal(JSON.parse(receipt.receipt_json).receiptId, row.scrubReceiptId); assert.equal(JSON.parse(receipt.receipt_json).outputHash, (await import('../src/core/hash.js')).sha256(JSON.parse(row.messageJson).content)); }
    assert.equal(f.hub.db.sqlite.prepare('SELECT COUNT(*) AS count FROM host_return_scrub_receipts h LEFT JOIN session_history s ON s.scrub_receipt_id=h.id WHERE h.session_id=? AND s.id IS NULL').get(result.body.sessionId).count, 0);
    const world = await (await fetch(`${f.base}/api/world`)).json(); assert.ok(world.tools.map(tool => tool.function.name).includes('move_through_door')); assert.ok(world.tools.map(tool => tool.function.name).includes('workshop_apply_patch')); assert.ok(world.tools.map(tool => tool.function.name).includes('workshop_tool_catalog'));
  } finally { await f.close(); }
});

test('tool round boundary allows N actions followed by one final resident response', async () => {
  let responseRound = 0;
  const provider = {
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      responseRound += 1;
      if (responseRound === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'move', type: 'function', function: { name: 'move_through_door', arguments: '{"door_id":"door.workshop"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: 'A final response after one action.' }, content: 'A final response after one action.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const f = await fixture(provider, { HUB_MAX_TOOL_ROUNDS: '1' });
  try { const result = await post(f.base, 'Use one action, then answer.'); assert.equal(result.response.status, 200); assert.equal(result.body.status, 'committed'); assert.equal(responseRound, 2); } finally { await f.close(); }
});

test('tool call beyond the configured round boundary is refused and fails honestly', async () => {
  let responseRound = 0;
  const provider = {
    async complete({ phase }) {
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      responseRound += 1;
      if (responseRound === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'move', type: 'function', function: { name: 'move_through_door', arguments: '{"door_id":"door.workshop"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'late', type: 'function', function: { name: 'workshop_list', arguments: '{"path":"."}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
    },
  };
  const f = await fixture(provider, { HUB_MAX_TOOL_ROUNDS: '1' });
  try {
    const result = await post(f.base, 'Try one action too many.'); assert.equal(result.body.status, 'failed'); assert.equal(result.body.failureCode, 'world_tool_round_limit'); assert.equal(responseRound, 2); assert.equal(f.hub.world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE outcome='refused'").get().count, 1); assert.equal(f.hub.db.getSessionHistory(result.body.sessionId).filter(item => item.messageKind === 'tool_result').length, 3);
  } finally { await f.close(); }
});
