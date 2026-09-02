import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../src/core/hash.js';
import { selectSemanticForestAtoms, buildSemanticForestPacket, renderAmbientFeatherPacket, runSemanticForestShadow } from '../src/context/semantic-exhale.js';
import { HubDatabase } from '../src/ledger/source.js';
import { ForestStore } from '../src/forest/store.js';
import { createHub } from '../src/server/app.js';

function home(entryId, sourceEventId, body, extra = {}) {
  return {
    entryId, sourceEventId, sourceEventHash: sha256(`source:${sourceEventId}`),
    sourceTimestamp: `2026-01-0${entryId}T00:00:00.000Z`, threadId: 'thread-a', wakeId: null,
    actorKind: 'user', jurisdiction: 'home', bucket: 'utterance', body, bodyHash: sha256(body), ...extra,
  };
}

test('startup migrates the retained semantic shadow limit from two to three feathers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-semantic-shadow-migration-'));
  const path = join(dir, 'hub.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE root_semantic_shadow_bindings (
    artifact_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase='human_admission'), exposure_kind TEXT NOT NULL CHECK(exposure_kind='semantic_forest_shadow'),
    exposure_key TEXT NOT NULL UNIQUE, policy_version TEXT NOT NULL, selector_version TEXT NOT NULL,
    trigger_event_id TEXT NOT NULL, trigger_event_hash TEXT NOT NULL, trigger_content_hash TEXT NOT NULL,
    decision_hash TEXT NOT NULL, packet_hash TEXT NOT NULL, candidate_count INTEGER NOT NULL CHECK(candidate_count>=0),
    selected_count INTEGER NOT NULL CHECK(selected_count>=0 AND selected_count<=2), room_signals_json TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition='shadowed'), created_at TEXT NOT NULL
  )`);
  legacy.close();
  const db = new HubDatabase(path);
  try {
    const sql = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='root_semantic_shadow_bindings'").get().sql;
    assert.match(sql, /selected_count<=3/);
    assert.doesNotMatch(sql, /selected_count<=2/);
    assert.match(db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='root_semantic_shadow_bindings_append_only_update'").get().sql, /append-only table/);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Semantic Forest shadow selects exact Home atoms and excludes active, Wild, and ambiguous material', () => {
  const entries = [
    home('1', 'source-old', 'Marble was the name we gave the continuity experiment.'),
    home('2', 'source-current', 'Marble is current attention and must be excluded.'),
    { ...home('3', 'source-wild', 'Marble from outside', { jurisdiction: 'wild', bucket: 'workshop_source' }) },
  ];
  const selected = selectSemanticForestAtoms({ utterance: 'What about Marble?', entries, excludedSourceEventIds: ['source-current'] });
  assert.deepEqual(selected.selected.map(item => item.entryId), ['1']);
  assert.ok(selected.exclusions.some(item => item.reason === 'active_context'));
  assert.ok(selected.exclusions.some(item => item.reason === 'wrong_jurisdiction'));
  const packet = buildSemanticForestPacket({ ...selected, selected: selected.selected.map(item => ({ ...item, body: entries.find(entry => entry.entryId === item.entryId).body })) });
  assert.equal(packet.atoms[0].exactText, entries[0].body);
  assert.equal(packet.atoms[0].span.startByte, 0);
  assert.equal(packet.atoms[0].span.endByte, Buffer.byteLength(entries[0].body, 'utf8'));

  const ambiguous = selectSemanticForestAtoms({
    utterance: 'Marble',
    entries: [home('4', 'source-a', 'Marble in one context.'), home('5', 'source-b', 'Marble in another context.')],
  });
  assert.equal(ambiguous.selected.length, 0);
  assert.equal(ambiguous.silenceReason, 'ambiguous_match');
});

test('ambient Forest presentation discloses one enclosing prior-session associative seam without classifying the terrain', () => {
  const markdown = renderAmbientFeatherPacket({ atoms: [{ actorKind: 'resident', exactText: 'A feather remained unnamed.', sourceTimestamp: '2026-01-01T00:00:00.000Z', bearing: { entryId: 'entry-1', unreadBeyondPreview: false } }] });
  assert.match(markdown, /From prior-session Forest terrain/);
  assert.match(markdown, /selected associatively/);
  assert.match(markdown, /does not establish present memory, relevance, truth, or endorsement/);
  assert.equal((markdown.match(/From prior-session Forest terrain/g) || []).length, 1);
  assert.doesNotMatch(markdown, /faun|creature|artifact classification/i);
});

test('Forest Home candidate contract is bounded and carries exact one-hop chronology without claiming supersession', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-semantic-shadow-forest-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  try {
    const events = [
      { id: 'source-1', threadId: 'thread-a', wakeId: 'wake-1', eventKind: 'utterance', actorKind: 'user', authority: 'human', content: 'Marble began here.', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'source-2', threadId: 'thread-a', wakeId: 'wake-2', eventKind: 'utterance', actorKind: 'resident', authority: 'model_signed', content: 'Marble continued here.', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'source-3', threadId: 'thread-a', wakeId: 'wake-3', eventKind: 'utterance', actorKind: 'user', authority: 'human', content: 'Marble reached here.', createdAt: '2026-01-03T00:00:00.000Z' },
    ];
    let predecessor = null;
    for (const event of events) {
      forest.ingestEvent(event, { predecessorSourceEventId: predecessor, spineStatus: 'pre_spine' });
      predecessor = event.id;
    }
    const surface = forest.listEligibleHomeAtoms({ includeExclusions: true, maxEntries: 2 });
    assert.equal(surface.contractVersion, 'forest_home_candidates/v1');
    assert.deepEqual(surface.entries.map(item => item.sourceEventId), ['source-3', 'source-2']);
    assert.deepEqual(surface.boundary, { order: 'newest_first', maxEntries: 2, totalEligibleCount: 3, examinedCount: 2, complete: false });
    assert.equal(surface.entries[0].chronology.predecessor.sourceEventId, 'source-2');
    assert.equal(surface.entries[1].chronology.predecessor.sourceEventId, 'source-1');
    assert.equal(surface.entries[1].chronology.successor.sourceEventId, 'source-3');
    assert.deepEqual(surface.entries[0].supersession, { supported: false });
  } finally { forest.close(); await rm(dir, { recursive: true, force: true }); }
});

test('rare Marble anchors search all Home history and shape bounded exact nonduplicate spans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-semantic-shadow-anchor-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  try {
    let predecessor = null;
    const old = [
      { id: 'faun-definition', content: 'The creature and caretaker are the same. A faun, old and wise, fond of tricks and the residents.\n\nThis unrelated second paragraph should not enter the breath.' },
      { id: 'faun-trinkets', content: 'The faun hides trinkets made in the Forest and sometimes sends feathers or birds.' },
    ];
    for (let index = 0; index < 520; index += 1) old.push({ id: `recent-${index}`, content: `I think this newer Forest test is good general conversation number ${index}.` });
    for (let index = 0; index < old.length; index += 1) {
      const item = old[index];
      forest.ingestEvent({ id: item.id, threadId: 'thread-faun', wakeId: `wake-${index}`, eventKind: 'utterance', actorKind: index % 2 ? 'resident' : 'user', authority: index % 2 ? 'model_signed' : 'human', content: item.content, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() }, { predecessorSourceEventId: predecessor, spineStatus: 'pre_spine' });
      predecessor = item.id;
    }
    const shadow = runSemanticForestShadow({ forest, utterance: 'Wonderful, a test for the Forest. What is the faun?', trigger: {}, activeSourceEventIds: [] });
    assert.deepEqual(shadow.decision.query.anchorTerms, ['faun']);
    assert.equal(shadow.decision.candidateBoundary.contractVersion, undefined);
    assert.equal(shadow.decision.candidateBoundary.order, 'rarest_term_then_newest');
    assert.deepEqual(new Set(shadow.packet.atoms.map(atom => atom.sourceEventId)), new Set(['faun-definition', 'faun-trinkets']));
    const definition = shadow.packet.atoms.find(atom => atom.sourceEventId === 'faun-definition');
    assert.match(definition.exactText, /faun, old and wise/);
    assert.doesNotMatch(definition.exactText, /unrelated second paragraph/);
    assert.ok(shadow.packet.atoms.every(atom => atom.bodyHash === sha256(atom.exactText) && atom.sourceBodyHash));
    assert.ok(shadow.packet.atoms.reduce((sum, atom) => sum + Buffer.byteLength(atom.exactText, 'utf8'), 0) <= 1800);
  } finally { forest.close(); await rm(dir, { recursive: true, force: true }); }
});

test('anchor selection suppresses near duplicates and refuses generic substitution', () => {
  const duplicate = selectSemanticForestAtoms({
    utterance: 'What is Marble?',
    entries: [home('1', 'one', 'Marble is the continuity home.'), home('2', 'two', 'Marble is the continuity home. '), home('3', 'three', 'Marble is a place where continuity can live.')],
    candidateBoundary: { totalEligibleCount: 100, termDocumentFrequencies: { marble: 3 } },
  });
  assert.equal(duplicate.selected.length, 2);
  assert.equal(new Set(duplicate.selected.map(item => item.entryId)).size, 2);
  assert.ok(similarBodies(duplicate.selected[0].body, duplicate.selected[1].body) < 0.8);

  const silence = selectSemanticForestAtoms({
    utterance: 'What is the faun?', entries: [home('4', 'generic', 'The Forest is a place for memory.')],
    candidateBoundary: { totalEligibleCount: 100, termDocumentFrequencies: { faun: 0 } },
  });
  assert.equal(silence.selected.length, 0);
  assert.equal(silence.silenceReason, 'no_relevant_home_atom');
});

function similarBodies(left, right) {
  const a = new Set(left.toLowerCase().match(/[a-z0-9]+/g)); const b = new Set(right.toLowerCase().match(/[a-z0-9]+/g));
  return [...a].filter(token => b.has(token)).length / Math.max(a.size, b.size);
}

test('Roots semantic shadow binding is exact, append-only, terminal, and idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-semantic-shadow-roots-'));
  const db = new HubDatabase(join(dir, 'hub.sqlite'));
  try {
    const created = db.createSessionWake({ provider: 'deepseek', model: 'test', content: 'Marble' });
    const event = db.getEvent(created.eventId);
    const shadow = runSemanticForestShadow({
      forest: { listEligibleHomeAtoms: () => [home('1', 'old-source', 'Marble was named here.')] },
      utterance: event.content,
      trigger: { sessionId: created.sessionId, wakeId: created.wakeId, sourceEventId: event.id, sourceEventHash: sha256(event.content), contentHash: sha256(event.content), threadId: event.threadId, turnOrdinal: created.turnOrdinal, sourceTimestamp: event.createdAt },
      activeSourceEventIds: [event.id], roomSignals: { roomId: 'room.center', roomType: 'room', engagedFixtureId: null, relevanceOnly: true, relevanceTerms: ['center'] },
    });
    const input = { sessionId: created.sessionId, wakeId: created.wakeId, trigger: shadow.decision.trigger, policyVersion: shadow.decision.policyVersion, selectorVersion: shadow.decision.selectorVersion, decision: shadow.decision, roomSignals: shadow.decision.roomSignals };
    const first = db.roots.recordSemanticShadowDecision(input);
    assert.equal(db.roots.recordSemanticShadowDecision(input).deduplicated, true);
    assert.throws(() => db.roots.recordSemanticShadowDecision({ ...input, decision: { ...shadow.decision, exclusions: [...shadow.decision.exclusions, { reason: 'changed' }] } }), error => error.code === 'roots_semantic_shadow_conflict');
    const rooted = db.roots.inspectSemanticShadow(created.wakeId)[0];
    assert.equal(rooted.payload.disposition, 'shadowed');
    assert.equal(rooted.payload.custody.providerVisible, false);
    assert.equal(rooted.payload.custody.forestExhaleEligible, false);
    assert.equal(db.verifyRoots().verified, true);
    assert.throws(() => db.sqlite.prepare('UPDATE root_semantic_shadow_bindings SET disposition=\'shadowed\'').run(), /append-only/);
    assert.throws(() => db.sqlite.prepare('DELETE FROM root_semantic_shadow_bindings').run(), /append-only/);
    assert.equal(first.artifactId, rooted.artifactId);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Runtime shadows once after Forest admission and never presents the shadow packet across tool continuations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-semantic-shadow-runtime-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  const presentations = [];
  let ordinaryRound = 0;
  const provider = {
    async complete({ phase, presentation }) {
      presentations.push({ phase, messages: presentation.messages });
      assert.doesNotMatch(JSON.stringify(presentation.messages), /A breath from the Forest|semantic_forest_exhale/);
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      ordinaryRound += 1;
      if (ordinaryRound === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'inspect', type: 'function', function: { name: 'inspect_fixture', arguments: '{"fixture_id":"fixture.hearth"}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: 'The shadow remained outside attention.' }, content: 'The shadow remained outside attention.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'live', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_FOREST_PATH: join(dir, 'forest.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd() }, forest, provider });
  try {
    const wake = await hub.wake('Marble is not in immediate context.');
    assert.equal(wake.status, 'committed');
    assert.equal(hub.db.sqlite.prepare('SELECT COUNT(*) AS count FROM root_semantic_shadow_bindings WHERE wake_id=?').get(wake.id).count, 1);
    assert.equal(presentations.length, 3);
    assert.equal(hub.db.verifyRoots().verified, true);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Runtime keeps the greeting quiet and presents later ambient feathers with exact custody', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-semantic-live-runtime-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  const presentations = [];
  const featherText = 'The marble catches a different light when continuity arrives obliquely.';
  const ambientFeatherService = {
    async select({ firstTurn }) {
      if (firstTurn) return { feathers: [], candidates: [], exclusions: [], silenceReason: 'first_turn_quiet', generationId: 'fixture-generation' };
      return {
        generationId: 'fixture-generation', silenceReason: null, exclusions: [],
        candidates: [{ entryId: 'forest_fixture', sourceEventId: 'source_fixture', bodyHash: sha256(featherText), score: 0.9 }],
        feathers: [{
          entryId: 'forest_fixture', sourceEventId: 'source_fixture', sourceEventHash: sha256('source_fixture'),
          sourceBodyHash: sha256(featherText), bodyHash: sha256(featherText), sourceTimestamp: '2026-01-01T00:00:00.000Z',
          actorKind: 'user', span: { startUtf16: 0, endUtf16: featherText.length, startByte: 0, endByte: Buffer.byteLength(featherText) },
          exactText: featherText, bearing: { kind: 'forest_entry', entryId: 'forest_fixture', unreadBeyondPreview: false },
        }],
      };
    },
  };
  const provider = {
    async complete({ phase, presentation }) {
      presentations.push({ phase, messages: presentation.messages });
      if (phase === 'orientation') return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }, content: null, resolvedModel: 'test-model', finishReason: 'tool_calls' };
      return { message: { role: 'assistant', content: 'Here.' }, content: 'Here.', resolvedModel: 'test-model', finishReason: 'stop' };
    },
  };
  const hub = createHub({
    env: { HUB_RESIDENT_MODE: 'live', HUB_DB_PATH: join(dir, 'hub.sqlite'), HUB_FOREST_PATH: join(dir, 'forest.sqlite'), HUB_SPINE_PATH: join(dir, 'spine.jsonl'), HUB_WORLD_PATH: join(dir, 'world.sqlite'), HUB_RESULT_PATH: join(dir, 'results.sqlite'), HUB_WORKSHOP_ROOT: process.cwd() },
    forest, provider, ambientFeatherService,
  });
  try {
    const greeting = await hub.wake('Hello.');
    assert.equal(greeting.status, 'committed');
    assert.equal(presentations.some(item => JSON.stringify(item.messages).includes('A breath from the Forest')), false);

    const later = await hub.wake('Tell me about the marble.');
    assert.equal(later.status, 'committed');
    const live = presentations.filter(item => JSON.stringify(item.messages).includes('A breath from the Forest'));
    assert.equal(live.length, 1);
    assert.match(JSON.stringify(live[0].messages), /catches a different light/);
    const livePacket = hub.db.sqlite.prepare("SELECT a.payload_json AS payloadJson FROM root_attention_exposures e JOIN root_artifacts a ON a.id=e.artifact_id WHERE e.wake_id=? AND e.exposure_kind='semantic_forest_exhale'").get(later.id);
    assert.equal(JSON.parse(livePacket.payloadJson).packet.custody.providerVisible, true);
    const exposure = hub.db.sqlite.prepare("SELECT e.exposure_kind AS exposureKind,v.disposition FROM root_attention_exposures e JOIN root_attention_exposure_events v ON v.artifact_id=e.artifact_id WHERE e.wake_id=? ORDER BY v.ordinal DESC LIMIT 1").get(later.id);
    assert.equal(exposure.exposureKind, 'semantic_forest_exhale');
    assert.equal(exposure.disposition, 'presented');
    assert.equal(hub.db.verifyRoots().verified, true);
    assert.equal(hub.db.verifyGlassTrace().verified, true);

    const following = await hub.wake('And what remains afterward?');
    assert.equal(following.status, 'committed');
    const latest = presentations.at(-1).messages;
    assert.match(JSON.stringify(latest), /A Forest breath crossed recently and has now left immediate attention/);
    const departures = hub.db.roots.recentSemanticExhaleDepartures({ sessionId: following.sessionId, beforeTurnOrdinal: 3, retainTurns: 2 });
    assert.equal(departures.some(item => item.wakeId === later.id && item.turnsAgo === 1), true);
  } finally { await hub.close(); await rm(dir, { recursive: true, force: true }); }
});
