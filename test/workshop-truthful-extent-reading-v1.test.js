import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkshopAdapter } from '../src/places/hub/workshop/adapter.js';
import { createLineExtent, verifyTruthfulExtent } from '../src/core/truthful-extent.js';
import { ResultRackStore } from '../src/result-rack/store.js';
import { WorldGraphStore } from '../src/world/graph.js';
import { WorldActionGateway } from '../src/world/gateway.js';

function fixture(text) {
  const root = mkdtempSync(join(tmpdir(), 'hub-reading-'));
  writeFileSync(join(root, 'manual.md'), text, 'utf8');
  return new WorkshopAdapter(root);
}

test('document outline reports exact headings and honest non-heading omission', () => {
  const workshop = fixture('# One\nalpha\n## Two\nbeta\n');
  const result = workshop.documentOutline('manual.md');
  assert.deepEqual(result.headings.map(({ level, line, text }) => ({ level, line, text })), [
    { level: 1, line: 1, text: 'One' }, { level: 2, line: 3, text: 'Two' },
  ]);
  assert.deepEqual(result.documentExtent.presented, [[1, 1], [3, 3]]);
  assert.deepEqual(result.documentExtent.missing, [[2, 2], [4, 4]]);
  assert.equal(result.documentExtent.standing, 'partial');
});

test('whole modest document crosses in one exact result with complete extent', () => {
  const text = '# One\nalpha\n## Two\nbeta\n';
  const result = fixture(text).documentRead('manual.md');
  assert.equal(result.source.text, text);
  assert.deepEqual(result.documentExtent.requested, [[1, 4]]);
  assert.deepEqual(result.documentExtent.missing, []);
  assert.equal(result.documentExtent.standing, 'complete');
  assert.equal(result.documentExtent.continuation, null);
});

test('heading and explicit range reads disclose both document gaps and continuation', () => {
  const workshop = fixture('# One\na\nb\n## Two\nc\nd\n# Three\ne\n');
  const section = workshop.documentRead('manual.md', { heading: 'Two' });
  assert.deepEqual([section.source.startLine, section.source.endLine], [4, 6]);
  assert.deepEqual(section.documentExtent.missing, [[1, 3], [7, 8]]);
  assert.equal(section.documentExtent.continuation.arguments.start_line, 7);
  const range = workshop.documentRead('manual.md', { startLine: 2, endLine: 3 });
  assert.deepEqual(range.documentExtent.missing, [[1, 1], [4, 8]]);
  assert.throws(() => workshop.documentRead('manual.md', { heading: 'Missing' }), { code: 'workshop_document_heading_missing' });
});

test('larger documents return deterministic heading-aware batches with an exact continuation', () => {
  const workshop = fixture(`# First\n${'alpha\n'.repeat(8)}# Second\n${'beta\n'.repeat(8)}# Third\n${'gamma\n'.repeat(8)}`);
  workshop.limits.maxDocumentBytes = 75;
  const first = workshop.documentRead('manual.md');
  assert.equal(first.source.endLine, 9);
  assert.match(first.source.text, /^# First/);
  assert.doesNotMatch(first.source.text, /# Second/);
  assert.deepEqual(first.documentExtent.requested, [[1, 27]]);
  assert.deepEqual(first.documentExtent.examined, [[1, 9]]);
  assert.deepEqual(first.documentExtent.continuation.arguments, { path: 'manual.md', start_line: 10, end_line: 27 });
  const second = workshop.documentRead('manual.md', { startLine: 10, endLine: 27 });
  assert.equal(second.source.startLine, 10);
  assert.ok(second.source.byteLength <= 75);
});

test('extent receipts reject tampering', () => {
  const read = fixture('# One\n').documentRead('manual.md');
  const extent = createLineExtent({ locator: read.source.path, revision: read.documentRevision, ...read.documentExtent });
  assert.throws(() => verifyTruthfulExtent({ ...extent, standing: 'partial' }), { code: 'truthful_extent_invalid' });
});

test('document Result Rack policy presents a modest manual whole without widening generic output', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-reading-rack-'));
  const store = new ResultRackStore(join(root, 'results.sqlite'), { projectionMaxBytes: 12000, projectionMaxLines: 120, documentProjectionMaxBytes: 65536, documentProjectionMaxLines: 2000 });
  try {
    const body = JSON.stringify({ kind: 'workshop_document_read', source: { text: 'formula line\n'.repeat(1800) } });
    const documentJob = store.createJob({ toolName: 'workshop_document_read' });
    store.appendOutputChunk(documentJob.jobId, 'output', body);
    store.appendJobStatus(documentJob.jobId, 'settled');
    const documentProjection = store.createProjection(documentJob.jobId);
    assert.equal(documentProjection.policy, 'document_read');
    assert.equal(documentProjection.truncated, false);
    const genericJob = store.createJob({ toolName: 'workshop_read' });
    store.appendOutputChunk(genericJob.jobId, 'output', body);
    store.appendJobStatus(genericJob.jobId, 'settled');
    const genericProjection = store.createProjection(genericJob.jobId);
    assert.equal(genericProjection.policy, 'generic');
    assert.equal(genericProjection.truncated, true);
  } finally { store.close(); }
});

test('gateway carries cumulative document coverage across wakes without rereading prior spans', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-reading-wakes-'));
  writeFileSync(join(root, 'manual.md'), '# One\na\nb\n# Two\nc\nd\n', 'utf8');
  const world = new WorldGraphStore(join(root, 'world.sqlite'), { topologyVersion: 'b1' });
  const sessionId = 'session-reading-wakes';
  try {
    world.ensureLifespan(sessionId);
    world.move({ sessionId, wakeId: 'wake-enter', doorId: 'door.workshop' });
    const gateway = new WorldActionGateway({ world, workshop: new WorkshopAdapter(root) });
    const execute = (wakeId, id, startLine, endLine) => gateway.execute({
      sessionId, wakeId, intent: { id, type: 'function', function: { name: 'workshop_document_read', arguments: JSON.stringify({ path: 'manual.md', start_line: startLine, end_line: endLine }) } },
    });
    const first = await execute('wake-one', 'read-one', 1, 3);
    assert.deepEqual(first.result.extent.coverage.covered, [[1, 3]]);
    assert.deepEqual(first.result.extent.coverage.unread, [[4, 6]]);
    const second = await execute('wake-two', 'read-two', 4, 6);
    assert.deepEqual(second.result.extent.coverage.covered, [[1, 6]]);
    assert.deepEqual(second.result.extent.coverage.unread, []);
    assert.equal(second.result.extent.continuation, null);
    assert.equal(verifyTruthfulExtent(second.result.extent), true);
    assert.equal(world.sqlite.prepare("SELECT COUNT(*) AS count FROM world_action_receipts WHERE session_id=? AND tool_name='workshop_document_read' AND outcome='committed'").get(sessionId).count, 2);
  } finally { world.close(); }
});
