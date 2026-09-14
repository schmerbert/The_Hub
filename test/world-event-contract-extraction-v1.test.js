import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../src/core/hash.js';
import * as facade from '../src/world/events.js';
import * as contract from '../src/world/event-contract.js';
import * as journal from '../src/world/event-journal.js';
import * as reducer from '../src/world/event-reducer.js';
import * as verifier from '../src/world/event-verifier.js';

const MOVED_EXPORTS = [
  'WORLD_PROJECTOR_VERSION', 'WORLD_EVENT_GENESIS_HASH', 'WORLD_EVENT_KINDS',
  'WORLD_INTEGRITY_TRIGGER_SQL', 'WORLD_A2_PROJECTION_TABLE_SQL', 'WORLD_PROJECTION_TABLE_SQL',
  'WORLD_CUSTODY_TABLE_SQL', 'WORLD_EVENT_JOURNAL_TABLE_SQL', 'WORLD_EVENT_SCHEMA',
  'NODE_COLUMNS', 'EDGE_COLUMNS', 'LOCATION_COLUMNS', 'FIXTURE_RUNTIME_COLUMNS', 'TIMER_COLUMNS',
  'BRIEF_COLUMNS', 'APPROVAL_COLUMNS', 'ACTION_RECEIPT_COLUMNS', 'APPROVAL_RECEIPT_COLUMNS',
  'PASSAGE_COLUMNS', 'OBJECT_STATE_COLUMNS', 'installWorldEventSchema',
];

const PUBLIC_EXPORTS = [
  ...MOVED_EXPORTS,
  'emptyWorldState', 'reduceWorldEvent', 'eventHashInput', 'computeWorldEventHash', 'createWorldEvent',
  'insertWorldEvent', 'readWorldPhysicalProjection', 'readWorldA2Projection', 'readWorldProjection',
  'custodyRowHash', 'verifyWorldSqlite', 'verifyWorldA1Sqlite', 'verifyWorldA2Sqlite', 'replayWorldEvents',
  'verifyWorldDatabase', 'inspectWorldA2UpgradeDatabase', 'inspectWorldB1UpgradeDatabase', 'assertWorldVerified',
];

const SQL_HASHES = {
  WORLD_EVENT_SCHEMA: '50dfa3e0ebca9a85d8dd85d63354674bb28111ecf221eaf03fb2be8cd1926ddb',
  WORLD_EVENT_JOURNAL_TABLE_SQL: '9c35fc59c53620b467b0c724c57e365c4442cc52fc5253375ec172081d475f0d',
  WORLD_INTEGRITY_TRIGGER_SQL: {
    world_event_journal_contiguous_insert: '5b3caffd0ccb42075c3ea5e3dc1508bbd8ff84d74f7af70e0b355c11245b7a9a',
    world_event_journal_append_only_update: 'a777d673905a210a4af3a06e2464b5c39dc608d1a89d6a7a9097b18baec95a50',
    world_event_journal_append_only_delete: '554d146ef1c5377437b890ab88a10f93e752b8ac8b2d9be596a4ee47342787e7',
    world_nodes_append_only_update: 'd4d69656e91351f9fe7fbaf2a77c87392bb7926dd72cbbeea7e6a6ca220d1891',
    world_nodes_append_only_delete: '460197f03aecf6ee772c501ed1dcfdf50c134ce21b0256286ef39ab9db92e122',
    world_edges_append_only_update: '43fdc7646ad95bdcbe57fe9278770441efcea55d73be2ed78d112084356837c3',
    world_edges_append_only_delete: 'a024455b67784b3a50cc13846bc65f915f3c77c238a1172f877e0c949506149c',
    world_passages_append_only_update: '66e71ef5b8f561be93a3d55e99d6492bf7d4a83372da8a3a38a393b440d076f8',
    world_passages_append_only_delete: '11c1aedda879a5c11e29afa11ddbd77b67bda40356eb561ebf0c7e9f3020b638',
    world_action_receipts_append_only_update: '6bcdede26cee3d732a231c8a0d8a14a6f0a4d9916e6aa6e78c909c8d997e6de5',
    world_action_receipts_append_only_delete: 'd8d5dd2c782f4b1d1f9565d34458fc92168fa77bd0943088a62187aa6b04aa07',
    world_approval_receipts_append_only_update: '9df209379d53c3ce4ea4a5213536452db60ad06db989172a9a5b845d1b826f01',
    world_approval_receipts_append_only_delete: 'cd31f9271f36961221e24eaeaac14ee7947585fb494d78ebef67947b6bc60b68',
  },
  WORLD_A2_PROJECTION_TABLE_SQL: {
    world_nodes: 'f50b46e1fbd0c6e0e6d117fcdb56d493b8aca43aa3db49228dd878e4f3fc8af3',
    world_edges: '013cea7f26ad5358dbaa86a2ffaab0e01a125dd5f68ff585fad0a602b69cfb74',
    world_locations: '96493e11d6fd2f62a5836cde39907d3136c6677701166afbc66c0d609b5d2221',
    world_fixture_runtime: 'c95d225e608c351c4c08fc1d9cd1052c4b575d20cf0a32b4c108d5af1a3da01b',
    world_timers: '5cbb6e9ddb715f856038ba837305616ed335f777961f8a0c9a8b885347cefeae',
    world_work_briefs: '1252800d1e0a5bbd9affe7c0ff9dfc00eede57640f5e1e705561e8517cc51a61',
    world_approvals: '3721f159bec3a2715981b4cd9959da9cd668514296c9b32ff2b63bf151942851',
  },
  WORLD_PROJECTION_TABLE_SQL: {
    world_nodes: '944ff81f26369bce424363e3e77a59dfd22a598b1a432dfabd3366a5561beccf',
    world_edges: 'd1ac8031708d571ee9fa3dcac5f0eff1bf124c874fb2ddcf2aa2bccd086d5571',
    world_locations: '96493e11d6fd2f62a5836cde39907d3136c6677701166afbc66c0d609b5d2221',
    world_fixture_runtime: 'c95d225e608c351c4c08fc1d9cd1052c4b575d20cf0a32b4c108d5af1a3da01b',
    world_timers: '5cbb6e9ddb715f856038ba837305616ed335f777961f8a0c9a8b885347cefeae',
    world_work_briefs: '1252800d1e0a5bbd9affe7c0ff9dfc00eede57640f5e1e705561e8517cc51a61',
    world_approvals: '3721f159bec3a2715981b4cd9959da9cd668514296c9b32ff2b63bf151942851',
    world_passages: '3763b5d0ed16d3daafa3ac3f0f52cd5ce11e3e00b5b7ffa45210b779da4dbaea',
    world_object_states: '46ee6c123e5726d3d9a46e45538e48c86c07f739766fde6a83913366b663c5e2',
  },
  WORLD_CUSTODY_TABLE_SQL: {
    world_action_receipts: 'fdcbb2b8e204f0d31ddd25caebc05cf97ff68cc0648e9ebb51349f721e0b8c89',
    world_approval_receipts: '8a1c76835392bf179bad797c113e8cdb87d5139a06d54d4b8e029d6a96eda4e3',
  },
};

function assertDeepFrozen(value, label) {
  assert.equal(Object.isFrozen(value), true, `${label} is not frozen`);
  if (value && typeof value === 'object') for (const [key, nested] of Object.entries(value)) assertDeepFrozen(nested, `${label}.${key}`);
}

test('World event facade preserves its public export set and contract identities', () => {
  assert.deepEqual(Object.keys(contract).sort(), [...MOVED_EXPORTS].sort());
  assert.deepEqual(Object.keys(facade).sort(), [...PUBLIC_EXPORTS].sort());
  for (const name of MOVED_EXPORTS) assert.strictEqual(facade[name], contract[name], `${name} must remain the facade binding`);
  for (const name of ['WORLD_EVENT_KINDS', 'WORLD_INTEGRITY_TRIGGER_SQL', 'WORLD_A2_PROJECTION_TABLE_SQL', 'WORLD_PROJECTION_TABLE_SQL', 'WORLD_CUSTODY_TABLE_SQL', 'NODE_COLUMNS', 'EDGE_COLUMNS', 'LOCATION_COLUMNS', 'FIXTURE_RUNTIME_COLUMNS', 'TIMER_COLUMNS', 'BRIEF_COLUMNS', 'APPROVAL_COLUMNS', 'ACTION_RECEIPT_COLUMNS', 'APPROVAL_RECEIPT_COLUMNS', 'PASSAGE_COLUMNS', 'OBJECT_STATE_COLUMNS']) assertDeepFrozen(contract[name], name);
});

test('World event facade preserves journal and projection operation identities', () => {
  for (const name of Object.keys(journal)) assert.strictEqual(facade[name], journal[name], `${name} must remain the facade binding`);
});

test('World event facade preserves reducer and verifier operation identities', async () => {
  for (const name of Object.keys(reducer)) assert.strictEqual(facade[name], reducer[name], `${name} must remain the facade binding`);
  for (const name of Object.keys(verifier)) assert.strictEqual(facade[name], verifier[name], `${name} must remain the facade binding`);

  const reducerSource = await readFile(new URL('../src/world/event-reducer.js', import.meta.url), 'utf8');
  const verifierSource = await readFile(new URL('../src/world/event-verifier.js', import.meta.url), 'utf8');
  assert.doesNotMatch(reducerSource, /\b(?:DatabaseSync|verifyWorldSqlite|readWorldProjection)\b/);
  assert.match(verifierSource, /from ['"]\.\/event-reducer\.js['"]/);
});

test('World event contract retains exact installed SQL bytes', () => {
  assert.equal(sha256(contract.WORLD_EVENT_SCHEMA), SQL_HASHES.WORLD_EVENT_SCHEMA);
  assert.equal(sha256(contract.WORLD_EVENT_JOURNAL_TABLE_SQL), SQL_HASHES.WORLD_EVENT_JOURNAL_TABLE_SQL);
  for (const [name, expected] of Object.entries(SQL_HASHES)) {
    if (typeof expected === 'string' || name === 'WORLD_EVENT_SCHEMA' || name === 'WORLD_EVENT_JOURNAL_TABLE_SQL') continue;
    for (const [key, hash] of Object.entries(expected)) assert.equal(sha256(contract[name][key]), hash, `${name}.${key}`);
  }
});

test('World event contract is dependency-inward and installer remains directly usable', async () => {
  const contractSource = await readFile(new URL('../src/world/event-contract.js', import.meta.url), 'utf8');
  const facadeSource = await readFile(new URL('../src/world/events.js', import.meta.url), 'utf8');
  assert.doesNotMatch(contractSource, /\b(?:import|export).*from\s+['"][^'"]*events\.js['"]/);
  assert.doesNotMatch(contractSource, /\b(?:DatabaseSync|reduceWorldEvent|verifyWorldSqlite)\b/);
  assert.match(facadeSource, /from ['"]\.\/event-contract\.js['"]/);

  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`${contract.WORLD_PROJECTION_TABLE_SQL.world_nodes}${contract.WORLD_PROJECTION_TABLE_SQL.world_edges}${contract.WORLD_PROJECTION_TABLE_SQL.world_locations}`);
    contract.installWorldEventSchema(sqlite);
    assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='world_event_journal'").get());
    assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='world_event_journal_contiguous_insert'").get());
  } finally { sqlite.close(); }
});
