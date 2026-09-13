import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForestStore } from '../src/forest/store.js';
import { checkForestCrossings } from '../src/forest/check.js';

test('quick Forest crossing check reports a clean bounded frontier without claiming forensic proof', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-forest-check-')); const path = join(dir, 'forest.sqlite');
  const forest = new ForestStore(path); forest.close();
  const result = checkForestCrossings({ forestPath: path });
  assert.equal(result.status, 'clean');
  assert.equal(result.forensicProof, false);
  assert.equal(result.frontier.counts.intakeOffers, 0);
  assert.match(result.frontier.hash, /^[a-f0-9]{64}$/);
  assert.match(result.meaning, /does not certify factual truth/);
});

test('quick Forest crossing check exposes held intake instead of blessing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-forest-check-held-')); const path = join(dir, 'forest.sqlite');
  const forest = new ForestStore(path);
  forest.sqlite.prepare('INSERT INTO forest_intake_offers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('offer-held','source_event','source-x','{}','a'.repeat(64),'home','utterance',null,null,'utterance_identity','v1',new Date().toISOString());
  forest.sqlite.prepare('INSERT INTO forest_intake_decisions VALUES(?,?,?,?,?,?,?,?,?)').run('decision-held','offer-held',1,'held','test_hold','bounded test',null,null,new Date().toISOString());
  forest.close();
  const result = checkForestCrossings({ forestPath: path });
  assert.equal(result.status, 'attention_required');
  assert.equal(result.counts.heldOrUndecided, 1);
  assert.ok(result.findings.some(item => item.code === 'unresolved_intake'));
});
