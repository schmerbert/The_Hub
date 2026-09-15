import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubDatabase } from '../src/ledger/source.js';
import { applyBackfillAtomically } from '../src/forest/backfill.js';
import { verifyForestWithCheckpoint } from '../src/integrity/forest-checkpoint.js';
import { VerifiedAncestryStore } from '../src/integrity/checkpoint-store.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-forest-checkpoint-'));
  const operationalPath = join(dir, 'hub.sqlite');
  const forestPath = join(dir, 'forest.sqlite');
  const spinePath = join(dir, 'spine.jsonl');
  const checkpointPath = join(dir, 'verified-ancestry.sqlite');
  const source = new HubDatabase(operationalPath);
  source.close();
  applyBackfillAtomically({ operationalPath, forestPath, confirmCreate: true });
  await writeFile(spinePath, '');
  return { dir, operationalPath, forestPath, spinePath, checkpointPath };
}

test('Forest establishes and reuses one shared verified ancestry checkpoint', async () => {
  const paths = await fixture();
  const options = { ...paths, strictWildBijection: true };
  try {
    const first = verifyForestWithCheckpoint(options);
    assert.equal(first.ok, true);
    assert.equal(first.checkpoint.mode, 'full');
    const second = verifyForestWithCheckpoint(options);
    assert.equal(second.ok, true);
    assert.equal(second.checkpoint.mode, 'checkpoint_unchanged');
    const store = new VerifiedAncestryStore(paths.checkpointPath);
    assert.equal(store.listGenerations({ domain: 'spine' }).length, 1);
    store.close();
  } finally { await rm(paths.dir, { recursive: true, force: true }); }
});

test('an unreadable checkpoint falls back to authoritative full verification', async () => {
  const paths = await fixture();
  const options = { ...paths, strictWildBijection: true };
  try {
    assert.equal(verifyForestWithCheckpoint(options).ok, true);
    await writeFile(paths.checkpointPath, 'not a sqlite checkpoint');
    const verified = verifyForestWithCheckpoint(options);
    assert.equal(verified.ok, true);
    assert.equal(verified.checkpoint.mode, 'full');
    assert.match(verified.checkpoint.code, /verified_ancestry/);
  } finally { await rm(paths.dir, { recursive: true, force: true }); }
});
