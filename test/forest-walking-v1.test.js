import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForestStore } from '../src/forest/store.js';
import { SemanticIndexStore } from '../src/forest/semantic-index.js';
import { AmbientFeatherService } from '../src/forest/ambient-feathers.js';
import { ForestTraversalStore } from '../src/forest/traversal-store.js';
import { ForestTraversalService } from '../src/forest/traversal.js';
import { createHub } from '../src/server/app.js';

class Embeddings {
  identity() { return { provider: 'test', model: 'walk/v1', dimensions: 4, normalization: 'l2' }; }
  async embed(texts) {
    return texts.map(text => {
      const bytes = [...Buffer.from(text)];
      const vector = [1, 2, 3, 4].map((seed, index) => bytes.reduce((sum, byte, offset) => sum + (offset % 4 === index ? byte * seed : 0), 1));
      const length = Math.hypot(...vector);
      return vector.map(value => value / length);
    });
  }
}

function call(name, args = {}, id = `call_${name}`) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-forest-walk-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  let predecessor = null;
  for (let index = 0; index < 10; index += 1) {
    const source = {
      id: `source_${index}`, threadId: 'thread_walk', wakeId: `wake_source_${index}`,
      eventKind: 'utterance', actorKind: index % 2 ? 'resident' : 'user', authority: index % 2 ? 'model_signed' : 'human',
      content: `Forest memory ${index}: a distinct path carries ${['marble','faun','garden','hearth','market'][index % 5]} and detail ${index}.`,
      createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
    };
    forest.ingestEvent(source, { predecessorSourceEventId: predecessor });
    predecessor = source.id;
  }
  const index = new SemanticIndexStore(join(dir, 'semantic.sqlite'));
  const ambient = new AmbientFeatherService({ forest, index, embeddingProvider: new Embeddings() });
  await ambient.warming;
  const path = join(dir, 'paths.sqlite');
  const store = new ForestTraversalStore(path);
  const service = new ForestTraversalService({ store, forest, ambientFeatherService: ambient });
  return { dir, path, forest, index, store, service, close() { store.close(); index.close(); forest.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function context(intent, wakeId = 'wake_walk', overrides = {}) {
  return { sessionId: 'session_walk', wakeId, roomId: 'place.garden', departureFocusId: 'fixture.garden.bench', tetherSourceEventId: 'source_trigger', queryFallback: 'the faun at the treeline', intent, ...overrides };
}
function bearings(result) { return [...result.conversationExits, ...result.semanticBearings]; }

test('Forest walking freezes truthful bearings, retains the present, and turns back by tether', async () => {
  const fx = await fixture();
  try {
    assert.deepEqual(fx.service.tools('session_walk', 'place.house').map(tool => tool.function.name), ['enter_forest', 'turn_around']);
    assert.deepEqual(fx.service.tools('session_walk', 'place.garden').map(tool => tool.function.name), ['enter_forest', 'turn_around']);
    assert.match(fx.service.thresholdMessage('session_walk', 'place.house'), /without walking to the Garden/);
    assert.match(fx.service.thresholdMessage('session_walk', 'place.garden'), /enter_forest/);

    const entered = await fx.service.execute(context(call('enter_forest', { seeking: 'faun path' })));
    assert.equal(entered.result.ok, true);
    assert.ok(entered.result.semanticBearings.length >= 1 && entered.result.semanticBearings.length <= 3);
    assert.deepEqual(entered.result.conversationExits, []);
    assert.equal(entered.result.returnAnchor.returnFocusId, 'fixture.garden.bench');
    assert.equal(new Set(bearings(entered.result).map(offer => offer.entryId)).size, bearings(entered.result).length);
    assert.match(fx.service.presenceMessage('session_walk'), /Current place: place\.forest, projecting forest\.resident/);
    assert.match(fx.service.presenceMessage('session_walk'), /Post-action Forest footing/);
    assert.match(fx.service.presenceMessage('session_walk'), /not an independent prediction or convergence/);
    assert.match(fx.service.presenceMessage('session_walk'), /retained place\.garden/);
    assert.equal(fx.service.thresholdMessage('session_walk', 'place.garden'), null);
    const frozen = structuredClone(entered.result.semanticBearings);

    const first = await fx.service.execute(context(call('walk_toward', { offer_id: frozen[0].offerId }, 'call_step_1')));
    assert.equal(first.result.stepsFromEntrance, 1);
    assert.ok(bearings(first.result).length >= 1 && bearings(first.result).length <= 5);
    assert.ok(first.result.conversationExits.every(offer => offer.direction.startsWith('conversation_')));
    assert.ok(first.result.semanticBearings.every(offer => offer.direction.startsWith('semantic_')));
    const read = await fx.service.execute(context(call('read_forest_leaf', {}, 'call_read')));
    assert.equal(read.result.exact, true);
    assert.equal(read.result.body, fx.forest.homeAtom(read.result.entryId).body);

    const back = await fx.service.execute(context(call('backtrack_forest', {}, 'call_back')));
    assert.equal(back.result.stepsFromEntrance, 0);
    assert.deepEqual(back.result.semanticBearings, frozen);
    if (frozen[1]) {
      const alternate = await fx.service.execute(context(call('walk_toward', { offer_id: frozen[1].offerId }, 'call_step_2')));
      assert.equal(alternate.result.stepsFromEntrance, 1);
      assert.notEqual(alternate.result.currentEntryId, first.result.currentEntryId);
    }

    const returned = await fx.service.execute(context(call('turn_around', {}, 'call_return')));
    assert.equal(returned.result.returnPlaceId, 'place.garden');
    assert.equal(fx.service.projection('session_walk').active, false);
    assert.deepEqual(fx.service.tools('session_walk', 'place.garden').map(tool => tool.function.name), ['enter_forest', 'turn_around']);

    const recovered = await fx.service.execute(context(call('turn_around', { entry_id: frozen[0].entryId }, 'call_recover'), 'wake_recover', { sessionId:'session_recover' }));
    assert.equal(recovered.result.ok, true);
    assert.deepEqual(fx.service.projection('session_recover').returnPointer, {
      kind:'forest_entry', entryId:frozen[0].entryId, sourceEventId:fx.forest.homeAtom(frozen[0].entryId).sourceEventId, bodyHash:fx.forest.homeAtom(frozen[0].entryId).bodyHash,
    });
    assert.equal(fx.store.verify().verified, true);
  } finally { fx.close(); }
});

test('Forest entry excludes the utterance that asked the question', async () => {
  const fx = await fixture();
  try {
    const tether = fx.forest.homeAtomForSourceEvent('source_9');
    const entered = await fx.service.execute(context(call('enter_forest'), 'wake_self_exclusion', {
      sessionId: 'session_self_exclusion', tetherSourceEventId: 'source_9', queryFallback: tether.body,
    }));
    assert.equal(entered.result.ok, true);
    assert.equal(entered.result.semanticBearings.some(offer => offer.entryId === tether.entryId), false);
  } finally { fx.close(); }
});

test('Forest walking refuses stale bearings and survives store reopen', async () => {
  const fx = await fixture();
  try {
    const entered = await fx.service.execute(context(call('enter_forest')));
    await fx.service.execute(context(call('walk_toward', { offer_id: entered.result.semanticBearings[0].offerId }, 'call_step')));
    const stale = await fx.service.execute(context(call('walk_toward', { offer_id: entered.result.semanticBearings[0].offerId }, 'call_stale')));
    assert.equal(stale.result.ok, false);
    assert.equal(stale.result.error, 'forest_walk_offer_stale');
    const before = fx.service.projection('session_walk');
    fx.store.close();
    const reopened = new ForestTraversalStore(fx.path);
    fx.store = reopened;
    fx.service.store = fx.store;
    fx.close = () => { reopened.close(); fx.index.close(); fx.forest.close(); rmSync(fx.dir, { recursive: true, force: true }); };
    assert.deepEqual(fx.service.projection('session_walk'), before);
    assert.throws(() => fx.store.sqlite.prepare('DELETE FROM forest_walk_events').run(), /append-only table/);
  } finally { fx.close(); }
});

test('Wake traversal enters place.forest from the House and turns back without World travel', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-forest-wake-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  const index = new SemanticIndexStore(join(dir, 'semantic.sqlite'));
  const ambient = new AmbientFeatherService({ forest, index, embeddingProvider:new Embeddings() });
  await ambient.warming;
  let ordinary = 0; let beganForestVisit = false; const calls = [];
  const provider = { async complete({ phase, presentation, requestBodyString }) {
    const tools = JSON.parse(requestBodyString).tools || [];
    calls.push({ phase, messages:presentation.messages, tools:tools.map(tool => tool.function.name) });
    if (phase === 'orientation') return { message:{ role:'assistant',content:null,tool_calls:[call('tend_hearth',{},'hearth')] },content:null,resolvedModel:'test',finishReason:'tool_calls' };
    ordinary += 1;
    if (!beganForestVisit && tools.some(tool => tool.function.name === 'enter_forest') && JSON.stringify(presentation.messages).includes('Let us see what the Forest has')) {
      beganForestVisit = true;
      return { message:{ role:'assistant',content:null,tool_calls:[call('enter_forest',{ seeking:'marble path' },'enter')] },content:null,resolvedModel:'test',finishReason:'tool_calls' };
    }
    if (beganForestVisit && tools.some(tool => tool.function.name === 'walk_toward')) return { message:{ role:'assistant',content:null,tool_calls:[call('turn_around',{},'return')] },content:null,resolvedModel:'test',finishReason:'tool_calls' };
    return { message:{ role:'assistant',content:`Answer ${ordinary}.` },content:`Answer ${ordinary}.`,resolvedModel:'test',finishReason:'stop' };
  } };
  const hub = createHub({ env:{ HUB_RESIDENT_MODE:'live',HUB_DB_PATH:join(dir,'hub.sqlite'),HUB_FOREST_PATH:join(dir,'forest.sqlite'),HUB_FOREST_TRAVERSAL_PATH:join(dir,'paths.sqlite'),HUB_SPINE_PATH:join(dir,'spine.jsonl'),HUB_WORLD_PATH:join(dir,'world.sqlite'),HUB_RESULT_PATH:join(dir,'results.sqlite'),HUB_WORKSHOP_ROOT:process.cwd() },forest,provider,ambientFeatherService:ambient });
  try {
    await hub.wake('Hello.'); await hub.wake('Tell me one thing.'); await hub.wake('Tell me another thing.');
    const visit = await hub.wake('Let us see what the Forest has about the marble.');
    assert.equal(visit.status,'committed');
    assert.equal(hub.world.current(visit.sessionId).room_node_id,'place.house');
    assert.equal(hub.forestTraversal.projection(visit.sessionId).active,false);
    const inside = calls.find(item => item.tools.includes('walk_toward'));
    assert.ok(inside, JSON.stringify(calls.map(item => ({ phase:item.phase, tools:item.tools }))));
    assert.match(JSON.stringify(inside.messages), /Current place: place\.forest, projecting forest\.resident/);
    assert.doesNotMatch(JSON.stringify(inside.messages), /Current location: place\.house/);
    assert.ok(inside.tools.includes('turn_around'));
    assert.ok(hub.results.sqlite.prepare("SELECT 1 AS ok FROM result_jobs WHERE tool_name IN ('enter_forest','turn_around') LIMIT 1").get());
  } finally { await hub.close(); index.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('a physical visit can leave from deep footing without backtracking', async () => {
  const fx = await fixture();
  try {
    const physical = { ...context(call('enter_forest', { seeking:'marble path' })), roomId:'place.forest' };
    const entered = await fx.service.execute(physical);
    const stepped = await fx.service.execute({ ...physical, intent:call('walk_toward',{ offer_id:entered.result.semanticBearings[0].offerId },'physical_step') });
    assert.equal(stepped.result.stepsFromEntrance, 1);
    assert.ok(fx.service.tools('session_walk','place.forest').some(tool => tool.function.name === 'leave_forest'));
    const left = await fx.service.execute({ ...physical, intent:call('leave_forest',{},'physical_leave') });
    assert.equal(left.result.returnPlaceId,'place.forest');
    assert.equal(left.result.walkedSteps,1);
    assert.equal(fx.service.projection('session_walk').active,false);
  } finally { fx.close(); }
});

test('a passing feather expires by wake and becomes an ordinary walked edge when chosen', async () => {
  const fx = await fixture();
  try {
    const entered = await fx.service.execute(context(call('enter_forest',{ seeking:'faun path' })));
    const first = await fx.service.execute(context(call('walk_toward',{ offer_id:entered.result.semanticBearings[0].offerId },'first_step')));
    const state = fx.service.projection('session_walk');
    const excluded = new Set(fx.service.featherExclusions('session_walk'));
    const entry = fx.forest.listSemanticProjectionAtoms().find(item => !excluded.has(item.entryId));
    const atom = { entryId:entry.entryId,sourceEventId:entry.sourceEventId,sourceBodyHash:entry.bodyHash,exactText:entry.body.slice(-120),actorKind:entry.actorKind,sourceTimestamp:entry.sourceTimestamp,bearing:{ kind:'passing_feather',offerId:'forest_feather_test',entryId:entry.entryId } };
    fx.service.landFeathers({ sessionId:'session_walk',wakeId:'wake_feather',generationId:fx.service.ambient.generationId,rootsArtifactId:'root_test',packet:{ atoms:[atom] } });

    const expired = await fx.service.execute(context(call('walk_toward',{ offer_id:'forest_feather_test' },'expired_step'),'wake_later'));
    assert.equal(expired.result.ok,false);
    assert.equal(expired.result.error,'forest_walk_offer_stale');

    const walked = await fx.service.execute(context(call('walk_toward',{ offer_id:'forest_feather_test' },'feather_step'),'wake_feather'));
    assert.equal(walked.result.ok,true);
    assert.equal(walked.result.currentEntryId,entry.entryId);
    const event = fx.store.sqlite.prepare("SELECT payload_json FROM forest_walk_events WHERE tool_call_id='feather_step'").get();
    assert.equal(JSON.parse(event.payload_json).provenance,'ambient_feather');
    assert.equal(fx.store.sqlite.prepare('SELECT COUNT(1) count FROM forest_walked_edges WHERE from_entry_id=? AND to_entry_id=?').get(first.result.currentEntryId,entry.entryId).count,1);
    const back = await fx.service.execute(context(call('backtrack_forest',{},'feather_back'),'wake_feather'));
    assert.equal(back.result.currentEntryId,first.result.currentEntryId);
    assert.equal(state.junctionId,first.result.junctionId);
    assert.equal(fx.store.verify().verified,true);
  } finally { fx.close(); }
});
