import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForestStore } from '../src/forest/store.js';
import { SemanticIndexStore } from '../src/forest/semantic-index.js';
import { AmbientFeatherService, buildAmbientFeatherPreview } from '../src/forest/ambient-feathers.js';
import { renderAmbientFeatherPacket, runAmbientFeatherShadow } from '../src/context/semantic-exhale.js';
import { sha256 } from '../src/core/hash.js';

function event(id, content, ordinal) {
  const actorKind = ordinal % 2 ? 'resident' : 'user';
  return { id, content, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ordinal)).toISOString(), eventKind: 'utterance', actorKind, threadId: 'thread', wakeId: `wake_${ordinal}`, authority: actorKind === 'resident' ? 'model_signed' : 'human' };
}

class FakeEmbeddings {
  identity() { return { provider: 'fake', model: 'semantic-fixture/v1', dimensions: 4, normalization: 'l2' }; }
  async embed(texts) {
    return texts.map(text => {
      const value = text.toLowerCase();
      const vector = [value.includes('faun') || value.includes('treeline') ? 1 : 0, value.includes('market') || value.includes('stock') ? 1 : 0, value.includes('garden') ? 1 : 0, value.includes('kiln') ? 1 : 0];
      const length = Math.hypot(...vector) || 1;
      return vector.map(item => item / length);
    });
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-feathers-'));
  const forest = new ForestStore(join(dir, 'forest.sqlite'));
  let prior = null;
  const bodies = [
    'At the treeline, an unfamiliar path begins deeper in the Forest than the ordinary entrance.',
    'The faun keeps the inverse visible and does not decide which path the Resident walks.',
    'A garden opening carries the turn of the stone into visible state.',
    'The kiln holds the settled result of its last completed recipe.',
    'Market prices move while the portfolio window remains read only.',
  ];
  bodies.forEach((body, index) => {
    const item = event(`source_${index}`, body, index + 1);
    forest.ingestEvent(item, { predecessorSourceEventId: prior });
    prior = item.id;
  });
  const index = new SemanticIndexStore(join(dir, 'semantic.sqlite'));
  return { dir, forest, index, close() { index.close(); forest.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('ambient vector feathers are derived, bounded, exact previews with unread bearings', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: new FakeEmbeddings() });
    await service.warming;
    const result = await service.select({ utterance: 'What do you know about the faun?', activeSourceEventIds: [] });
    assert.equal(result.feathers.length > 0 && result.feathers.length <= 3, true);
    assert.equal(result.feathers.some(item => item.sourceEventId === 'source_1'), true);
    for (const feather of result.feathers) {
      assert.equal(sha256(feather.exactText), feather.bodyHash);
      assert.equal(feather.span.endByte, Buffer.byteLength(feather.exactText, 'utf8'));
    }
    assert.equal(fx.index.count(service.generationId), 5);
  } finally { fx.close(); }
});

test('in-Forest feathers exclude local terrain and declare one-turn walkable landings', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest:fx.forest,index:fx.index,embeddingProvider:new FakeEmbeddings() });
    await service.warming;
    const excludedEntry = fx.forest.listSemanticProjectionAtoms().find(item => item.sourceEventId === 'source_1');
    const shadow = await runAmbientFeatherShadow({
      service, utterance:'faun at the treeline', trigger:{ wakeId:'wake_current' }, excludeEntryIds:[excludedEntry.entryId],
      forestWalk:{ active:true,journeyId:'journey',junctionId:'junction' },
    });
    assert.ok(shadow.packet.atoms.every(atom => atom.entryId !== excludedEntry.entryId));
    assert.equal(shadow.packet.transientLanding,true);
    assert.ok(shadow.packet.atoms.every(atom => atom.bearing.kind === 'passing_feather' && atom.bearing.offerId.startsWith('forest_feather_')));
    const rendered = renderAmbientFeatherPacket(shadow.packet);
    assert.match(rendered,/selected for this human turn/);
    assert.match(rendered,/may change or depart on the next turn/);
    assert.match(rendered,/choosing one with walk_toward makes the path/);
  } finally { fx.close(); }
});

test('an unready embedding index produces witnessed shadow silence without waiting', async () => {
  const fx = fixture();
  try {
    let release;
    const embeddings = new FakeEmbeddings();
    embeddings.embed = () => new Promise(resolve => { release = () => resolve([[1, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]); });
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: embeddings });
    const shadow = await runAmbientFeatherShadow({ service, utterance: 'faun', trigger: {}, activeSourceEventIds: [] });
    assert.equal(shadow.packet.silence, true);
    assert.equal(shadow.packet.silenceReason, 'embedding_warming');
    assert.equal(shadow.decision.selectorVersion, 'ambient_vector_feathers/v2');
    assert.equal(shadow.decision.selectedAtoms.length, 0);
    release(); await service.warming;
  } finally { fx.close(); }
});

test('semantic generations are immutable and incremental sync adds exact new Forest terrain', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: new FakeEmbeddings() });
    await service.warming;
    const next = event('source_new', 'The faun releases one bird at the treeline.', 8);
    fx.forest.ingestEvent(next, { predecessorSourceEventId: 'source_4' });
    await service.sync();
    assert.equal(fx.index.count(service.generationId), 6);
    const same = fx.index.ensureGeneration({ embedding: new FakeEmbeddings().identity(), forest: fx.forest.semanticProjectionIdentity() });
    const unbound = fx.index.ensureGeneration(new FakeEmbeddings().identity());
    assert.equal(same, service.generationId);
    assert.notEqual(unbound, service.generationId);
  } finally { fx.close(); }
});

test('ambient feather previews preserve the ending and walk backward by complete sentences', () => {
  const source = '  The first sentence only establishes the clearing. The second sentence walks toward the treeline. The ending names the faun.  ';
  const preview = buildAmbientFeatherPreview(source, 72);
  assert.equal(preview.exactText, 'The ending names the faun.');
  assert.equal(source.slice(preview.span.startUtf16, preview.span.endUtf16), preview.exactText);
  assert.equal(preview.exactText.endsWith('.'), true);
  assert.equal(preview.span.endByte, Buffer.byteLength(source.slice(0, preview.span.endUtf16), 'utf8'));
});

test('graduated evidence permits a quiet one- or two-feather breath', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: new FakeEmbeddings() });
    await service.warming;
    const entries = fx.forest.listSemanticProjectionAtoms();
    fx.index.search = () => entries.slice(0, 4).map((entry, index) => ({
      entryId: entry.entryId, sourceEventId: entry.sourceEventId, bodyHash: entry.bodyHash,
      score: [0.81, 0.70, 0.69, 0.67][index],
    }));
    const result = await service.select({ utterance: 'faun at the treeline' });
    assert.equal(result.feathers.length, 2);
  } finally { fx.close(); }
});

test('the first turn is quiet before embedding or neighborhood search', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: new FakeEmbeddings() });
    const result = await service.select({ utterance: 'hello', firstTurn: true });
    assert.equal(result.silenceReason, 'first_turn_quiet');
    assert.deepEqual(result.feathers, []);
    assert.deepEqual(result.candidates, []);
    await service.warming;
  } finally { fx.close(); }
});

test('direct utterance echoes are excluded from ambient feathers', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: new FakeEmbeddings() });
    await service.warming;
    const body = 'The faun keeps the inverse visible and does not decide which path the Resident walks.';
    const result = await service.select({ utterance: body });
    assert.equal(result.feathers.some(item => item.exactText === body), false);
    assert.equal(result.exclusions.some(item => item.reason === 'direct_utterance_echo'), true);
  } finally { fx.close(); }
});

test('unread bearings ignore surrounding whitespace but retain meaningful omitted text', () => {
  const whitespaceBody = '  The ending names the faun.  ';
  const whitespacePreview = buildAmbientFeatherPreview(whitespaceBody);
  const whitespaceUnread = whitespaceBody.slice(0, whitespacePreview.span.startUtf16).trim().length > 0 || whitespaceBody.slice(whitespacePreview.span.endUtf16).trim().length > 0;
  assert.equal(whitespaceUnread, false);

  const longerBody = 'A prior sentence remains in the branch. The ending names the faun.';
  const boundedPreview = buildAmbientFeatherPreview(longerBody, 30);
  const meaningfulUnread = longerBody.slice(0, boundedPreview.span.startUtf16).trim().length > 0 || longerBody.slice(boundedPreview.span.endUtf16).trim().length > 0;
  assert.equal(meaningfulUnread, true);
});

test('the quiet prior refuses weak ordinary similarity while preserving a rare named anchor', async () => {
  const fx = fixture();
  try {
    const service = new AmbientFeatherService({ forest: fx.forest, index: fx.index, embeddingProvider: new FakeEmbeddings() });
    await service.warming;
    const entries = fx.forest.listSemanticProjectionAtoms();
    const faun = entries.find(entry => entry.body.includes('faun keeps'));
    service.index.search = () => [{ entryId: faun.entryId, sourceEventId: faun.sourceEventId, bodyHash: faun.bodyHash, score: 0.62 }];
    const quiet = await service.select({ utterance: 'Please discuss this possibility.' });
    assert.equal(quiet.silenceReason, 'quiet_prior');
    assert.deepEqual(quiet.feathers, []);
    const anchored = await service.select({ utterance: 'What about the faun?' });
    assert.equal(anchored.feathers.length, 1);
  } finally { fx.close(); }
});
