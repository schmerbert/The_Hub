import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForestStore, JOURNAL_MAX_CHARS } from '../src/forest/store.js';

function source(overrides = {}) {
  const content = JSON.stringify({ role:'assistant', content:null, tool_calls:[{ id:'call_journal', type:'function', function:{ name:'write_journal', arguments:'{"entry":"A deliberate tree."}' } }] });
  return { id:'event_tool',threadId:'thread_1',sessionId:'session_1',wakeId:'wake_1',actorKind:'resident',eventKind:'state',content,authority:'model_signed',provider:'deepseek',model:'test',createdAt:'2026-08-28T00:00:00.000Z',...overrides };
}

test('Journal plants exact append-only walkable Home terrain outside conversation chronology', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-journal-'));
  const forest = new ForestStore(join(root, 'forest.sqlite'), { mode:'createNew' });
  try {
    const args = { sourceEvent:source(),toolCallId:'call_journal',argumentsJson:'{"entry":"A deliberate tree."}',body:'A deliberate tree.',requestRecordId:'spine_request_1',spineRecordId:'spine_request_1',hostReturnReceiptId:'scrub_host_1' };
    const planted = forest.writeJournal(args);
    assert.equal(planted.existing, false);
    const atom = forest.homeAtom(planted.entryId);
    assert.equal(atom.body, 'A deliberate tree.');
    assert.equal(atom.bucket, 'journal');
    assert.deepEqual(forest.homeAtomWithChronology(planted.entryId).chronology, { predecessor:null, successor:null });
    assert.ok(forest.listSemanticProjectionAtoms().some(item => item.entryId === planted.entryId));
    assert.ok(forest.listEligibleHomeAtoms().some(item => item.entryId === planted.entryId && item.bucket === 'journal'));
    assert.equal(forest.writeJournal(args).existing, true);
    assert.equal(forest.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_journal_entries').get().count, 1);
    assert.throws(() => forest.sqlite.prepare('DELETE FROM forest_journal_entries').run(), /append-only table/);
  } finally { forest.close(); rmSync(root, { recursive:true, force:true }); }
});

test('Journal refuses transformed, oversized, and non-Resident planting', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-journal-refusal-'));
  const forest = new ForestStore(join(root, 'forest.sqlite'), { mode:'createNew' });
  const base = { sourceEvent:source(),toolCallId:'call_journal',argumentsJson:'{"entry":"Exact."}',body:'Exact.',requestRecordId:'spine_request_1',spineRecordId:'spine_request_1',hostReturnReceiptId:'scrub_host_1' };
  try {
    assert.throws(() => forest.writeJournal({ ...base, body:'Changed.' }), /does not match/);
    const oversized = 'x'.repeat(JOURNAL_MAX_CHARS + 1);
    assert.throws(() => forest.writeJournal({ ...base, body:oversized, argumentsJson:JSON.stringify({ entry:oversized }) }), /nonempty and bounded/);
    assert.throws(() => forest.writeJournal({ ...base, sourceEvent:source({ actorKind:'host', authority:'host_receipt' }) }), /model-signed Resident/);
    assert.equal(forest.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_journal_entries').get().count, 0);
  } finally { forest.close(); rmSync(root, { recursive:true, force:true }); }
});

test('existing Forest installs the empty Journal companion before strict verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-journal-upgrade-'));
  const path = join(root, 'forest.sqlite');
  const original = new ForestStore(path, { mode:'createNew' });
  try {
    original.sqlite.exec(`
      DROP TRIGGER forest_journal_custody_append_only_delete;
      DROP TRIGGER forest_journal_custody_append_only_update;
      DROP TRIGGER forest_journal_entries_append_only_delete;
      DROP TRIGGER forest_journal_entries_append_only_update;
      DROP TABLE forest_journal_custody;
      DROP TABLE forest_journal_entries;
    `);
  } finally { original.close(); }

  const reopened = new ForestStore(path, { mode:'requireExisting' });
  try {
    assert.equal(reopened.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_journal_entries').get().count, 0);
    assert.equal(reopened.sqlite.prepare('SELECT COUNT(*) AS count FROM forest_journal_custody').get().count, 0);
    reopened.verifySchema();
  } finally { reopened.close(); rmSync(root, { recursive:true, force:true }); }
});
