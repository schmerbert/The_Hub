import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../src/core/hash.js';
import { createHub } from '../src/server/app.js';
import {
  CLINICAL_WAKE_ANCHOR,
  GLASS_BAND_ORDER,
  STABLE_GLASS_TEXT,
  assertGlassCast,
  buildGlassWakeInheritance,
  composeGlassCast,
  finalizeGlassCast,
  planPromotedHearthOmissions,
} from '../src/context/glass-cast.js';
import { scrubProviderHistory } from '../src/scrub/provider-presentation.js';
import { BLESSING_SOURCE_EVENT_ID } from '../src/resident/charter.js';

const atom = {
  sourceEventId: 'event-ancestry', actor: 'resident', authority: 'model_signed', excerpt: 'source-exact inheritance',
  originalHash: sha256('longer source-exact inheritance'), startOffsetUtf16: 7, endOffsetUtf16: 31,
};

test('Glass composer keeps invariant ground separate from direct continuity and living current ground', () => {
  const result = composeGlassCast({
    phase: 'ordinary',
    inheritance: { atoms: [atom] },
    priorHorizon: { candidateCount: 9, selectedCount: 1, omittedEarlierCount: 8, oldestSelectedSourceEventId: atom.sourceEventId },
    livingEdgeRefs: [
      { kind: 'current_ground', authority: 'host_receipt', message: { role: 'system', content: 'Provider: changing-provider. Current room: room.workshop.' } },
      { kind: 'current_turn', authority: 'ground', sourceEventId: 'event-current', message: { role: 'user', content: 'current words' } },
    ],
  });
  assert.deepEqual(result.cast.bandOrder, GLASS_BAND_ORDER);
  assert.equal(result.refs[0].message.content, STABLE_GLASS_TEXT);
  assert.equal(result.cast.bands[1].items[0].message.content, CLINICAL_WAKE_ANCHOR);
  assert.match(CLINICAL_WAKE_ANCHOR, /Prior-session record follows/);
  assert.match(CLINICAL_WAKE_ANCHOR, /not current recollection/);
  assert.match(CLINICAL_WAKE_ANCHOR, /does not verify its claims as true/);
  assert.match(result.cast.bands[1].items[1].message.content, /Prior-session Resident record — exact contiguous source excerpt/);
  assert.match(result.cast.bands[1].items[1].message.content, /not current recollection or verified truth/);
  assert.equal(result.cast.bands[1].items[1].message.role, 'system');
  assert.match(result.cast.bands[1].items[1].message.content, new RegExp(atom.excerpt));
  assert.equal(result.cast.bands[1].items[1].presentationTransform, 'attributable_exact_quote_v1');
  assert.equal(result.cast.bands[1].items[1].sourceEventId, atom.sourceEventId);
  assert.equal(result.cast.bands[3].state, 'deferred');
  assert.equal(result.cast.bands[3].itemCount, 0);
  assert.doesNotMatch(STABLE_GLASS_TEXT, /changing-provider|room\.workshop/);
  assert.equal(assertGlassCast(result.cast), result.cast);
});

test('causal first-response cast receipts Hearth inheritance in living edge without duplicate anchor messages', () => {
  const causal = composeGlassCast({
    phase: 'response', continuityMode: 'causal_hearth', inheritance: { atoms: [atom] },
    livingEdgeRefs: [
      { kind: 'current_turn', message: { role: 'user', content: 'waiting human words' } },
      { kind: 'hearth_action', message: { role: 'assistant', content: null, tool_calls: [{ id: 'hearth', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] } },
      { kind: 'hearth_return', message: { role: 'tool', tool_call_id: 'hearth', content: `# Wake inheritance\n\n${CLINICAL_WAKE_ANCHOR}\n\n${atom.excerpt}` } },
    ],
  });
  assert.equal(causal.cast.bands[1].state, 'empty');
  assert.equal(causal.cast.bands[1].itemCount, 0);
  assert.equal(causal.cast.bands[1].representedIn, 'living_edge_causal_hearth');
  assert.equal(causal.cast.bands[1].livingEdgeMessageSha256, causal.cast.bands[4].items[2].messageSha256);
  assert.equal(causal.cast.bands[4].causalHearthException, true);
  assert.equal(causal.refs.filter(ref => ref.message.content === CLINICAL_WAKE_ANCHOR).length, 0);
  assert.equal(causal.refs.some(ref => ref.message.tool_call_id === 'hearth'), true);
});

test('Glass shifts only living-edge omissions and finalizes exact Scrub/Spine UTF-8 bindings', () => {
  const composed = composeGlassCast({
    phase: 'ordinary', inheritance: { atoms: [atom] },
    livingEdgeRefs: [
      { message: { role: 'assistant', content: 'old tool', tool_calls: [] } },
      { message: { role: 'tool', content: 'old result', tool_call_id: 'old' } },
      { message: { role: 'user', content: 'Unicode 🙂' } },
    ],
    livingEdgeOmissions: [{ sourceIndex: 0, omitMessage: true, reason: 'declared fitting' }, { sourceIndex: 1, omitMessage: true, reason: 'declared fitting' }],
  });
  const sourceMessages = composed.refs.map(ref => ref.message);
  const presentation = scrubProviderHistory(sourceMessages, { omissions: composed.omissions });
  const requestBodyString = JSON.stringify({ model: 'dynamic-model', messages: presentation.messages });
  const requestBytes = Buffer.from(requestBodyString, 'utf8');
  const frame = {
    record_id: 'spine-1', record_hash: 'frame-hash', request_body: requestBodyString,
    body_byte_length: requestBytes.length, body_sha256: sha256(requestBodyString),
  };
  assert.deepEqual(composed.omissions.map(item => item.sourceIndex), [4, 5]);
  const crossing = { sessionId: 'session-1', wakeId: 'wake-1', provider: 'test-provider', requestedModel: 'dynamic-model' };
  const receipt = finalizeGlassCast({ cast: composed.cast, sourceMessages, presentation, requestBodyString, requestFrame: frame, crossing });
  assert.equal(receipt.requestBodyUtf8Bytes, requestBytes.length);
  assert.equal(receipt.requestBodySha256, sha256(requestBodyString));
  assert.equal(receipt.presentedMessagesSha256, sha256(JSON.stringify(presentation.messages)));
  assert.equal(receipt.spineRecordId, frame.record_id);
  assert.equal(receipt.presentationScrub.outputCount, presentation.messages.length);
  assert.equal(receipt.crossing.wakeId, crossing.wakeId);
  assert.throws(() => finalizeGlassCast({ cast: composed.cast, sourceMessages, presentation, requestBodyString, requestFrame: { ...frame, body_sha256: 'tampered' }, crossing }), /Spine frame/);
});

test('direct Glass promotion declares omission of only the completed causal Hearth pair', () => {
  const rows = [
    { ordinal: 1, wakeId: 'wake-first', messageKind: 'user', messageJson: JSON.stringify({ role: 'user', content: 'first user' }) },
    { ordinal: 2, wakeId: 'wake-first', messageKind: 'assistant_tool_call', messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'hearth-1', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }) },
    { ordinal: 3, wakeId: 'wake-first', messageKind: 'tool_result', messageJson: JSON.stringify({ role: 'tool', tool_call_id: 'hearth-1', content: '# Wake inheritance\nexact' }) },
    { ordinal: 4, wakeId: 'wake-first', messageKind: 'resident', messageJson: JSON.stringify({ role: 'assistant', content: 'first answer' }) },
  ];
  const plan = planPromotedHearthOmissions(rows);
  assert.deepEqual(plan.omissions.map(item => item.sourceIndex), [1, 2]);
  assert.match(plan.disclosure, /promoted|continuity anchors/i);
  assert.equal(plan.manifest.actionHistoryOrdinal, 2);
});

test('House Hearth is not promoted out of the living Scroll by a special immediate rule', () => {
  const plan = planPromotedHearthOmissions([
    { ordinal: 1, wakeId: 'wake-first', messageKind: 'assistant_tool_call', messageJson: JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id: 'hearth-1', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }] }) },
    { ordinal: 2, wakeId: 'wake-first', messageKind: 'tool_result', messageJson: JSON.stringify({ role: 'tool', tool_call_id: 'hearth-1', content: '# Hearth\n\nexact packet' }) },
  ]);
  assert.deepEqual(plan.omissions, []);
  assert.equal(plan.manifest, null);
  assert.equal(plan.disclosure, null);
});

test('wake inheritance excludes the retired Longshore blessing even when it is newest ancestry', () => {
  const inheritance = buildGlassWakeInheritance({
    prior: {
      sessionId: 'session-zero', label: 'Session Zero', total: 2, ceiling: 20,
      tail: [
        { id: 'event-allowed', actorKind: 'user', authority: 'ground', content: 'allowed exact ancestry', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: BLESSING_SOURCE_EVENT_ID, actorKind: 'resident', authority: 'model_signed', content: 'The Longshore Current is drawn to this shore.', createdAt: '2026-01-01T00:00:01.000Z' },
      ],
    },
  });
  assert.deepEqual(inheritance.atoms.map(item => item.sourceEventId), ['event-allowed']);
  assert.equal(inheritance.priorHorizon.excludedActiveBlessingCount, 1);
  assert.equal(inheritance.receipt.selection.exclusionReason, 'retired_longshore_wake_blessing');
  assert.doesNotMatch(inheritance.markdown, /Longshore Current|drawn to this shore/);
});

test('runtime persists exact casts, promotes Hearth inheritance once, and keeps canonical Source untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-glass-cast-'));
  const env = {
    HUB_RESIDENT_MODE: 'fake',
    HUB_DB_PATH: join(dir, 'hub.sqlite'),
    HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
    HUB_WORLD_PATH: join(dir, 'world.sqlite'),
    HUB_RESULT_PATH: join(dir, 'results.sqlite'),
    HUB_WORKSHOP_ROOT: process.cwd(),
  };
  let firstHub; let secondHub;
  try {
    firstHub = createHub({ env });
    const ancestryWake = await firstHub.wake('ancestral exact human words');
    assert.equal(ancestryWake.status, 'committed');
    await firstHub.close(); firstHub = null;

    secondHub = createHub({ env });
    const first = await secondHub.wake('first words in the new lifespan');
    assert.equal(first.status, 'committed');
    assert.deepEqual(first.phases.map(item => item.phase), ['orientation', 'response']);
    assert.equal(first.glassCasts.length, 2);
    const causal = first.phases[1].glassCast.receipt;
    assert.equal(causal.cast.bands[1].state, 'empty');
    assert.equal(causal.cast.bands[1].representedIn, 'living_edge_causal_hearth');
    const causalMessages = JSON.parse(first.phases[1].requestBody).messages;
    assert.equal(causalMessages.some(message => message.role === 'tool' && message.content.startsWith('# Hearth')), true);
    assert.doesNotMatch(JSON.stringify(causalMessages), /The Longshore Current|drawn to this shore/);
    const inheritanceHostReceipt = secondHub.db.sqlite.prepare("SELECT receipt_json AS receiptJson FROM host_return_scrub_receipts WHERE wake_id=? AND tool_name='tend_hearth'").get(first.id);
    assert.equal(JSON.parse(inheritanceHostReceipt.receiptJson).policy, 'house_hearth_packet_markdown_v1');

    const inheritedAtom = JSON.parse(first.hearth.returnJson).atoms.find(item => item.excerpt.includes('ancestral exact human words'));
    assert.ok(inheritedAtom);
    const sourceBefore = secondHub.db.getEvent(inheritedAtom.sourceEventId);
    assert.equal(sourceBefore.fullHash, inheritedAtom.originalHash);

    const later = await secondHub.wake('later living-edge words');
    assert.equal(later.status, 'committed');
    const ordinary = later.phases[0];
    const direct = ordinary.glassCast.receipt;
    assert.equal(direct.cast.bands[1].state, 'present');
    assert.equal(direct.cast.bands[1].mode, 'none');
    assert.equal(direct.cast.bands[1].itemCount, 1);
    assert.equal(direct.cast.bands[1].items[0].kind, 'silver_bullet_holster');
    const ordinaryMessages = JSON.parse(ordinary.requestBody).messages;
    assert.equal(ordinaryMessages.some(message => message.role === 'tool' && message.content.startsWith('# Hearth')), true);
    assert.equal(ordinaryMessages.some(message => message.tool_calls?.some(call => call.function?.name === 'tend_hearth')), true);
    assert.equal(ordinaryMessages.some(message => message.role === 'tool' && message.content.includes(inheritedAtom.excerpt)), true);
    assert.equal(ordinaryMessages.some(message => message.content === 'first words in the new lifespan'), true);
    assert.equal(ordinaryMessages.some(message => typeof message.content === 'string' && message.content.startsWith('FAKE MODE')), true);
    assert.equal(direct.presentationScrub.omissions.filter(item => /not reinjected/.test(item.reason)).length, 0);
    assert.equal(direct.requestBodySha256, sha256(ordinary.requestBody));
    assert.equal(direct.presentedMessagesSha256, sha256(JSON.stringify(ordinaryMessages)));
    assert.equal(direct.crossing.sessionId, later.sessionId);
    assert.equal(direct.crossing.wakeId, later.id);
    assert.doesNotMatch(JSON.stringify(direct.cast), /ancestral exact human words|later living-edge words/);
    assert.equal(direct.cast.bands.flatMap(band => band.items).some(item => Object.hasOwn(item, 'message')), false);
    assert.doesNotMatch(STABLE_GLASS_TEXT, /fake|deepseek-v4-flash|room\.center|session_|wake_/i);
    assert.equal(secondHub.db.getEvent(inheritedAtom.sourceEventId).fullHash, sourceBefore.fullHash);
    assert.throws(() => secondHub.db.sqlite.prepare("UPDATE glass_cast_receipts SET phase='ordinary' WHERE id=?").run(ordinary.glassCast.receiptId), /append-only table/);
    assert.throws(() => secondHub.db.sqlite.prepare('DELETE FROM glass_cast_receipts WHERE id=?').run(ordinary.glassCast.receiptId), /append-only table/);
  } finally {
    if (firstHub) await firstHub.close().catch(() => {});
    if (secondHub) await secondHub.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('ordinary wakes do not depend on persisted passive Glass inheritance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-glass-missing-inheritance-'));
  const env = {
    HUB_RESIDENT_MODE: 'fake',
    HUB_DB_PATH: join(dir, 'hub.sqlite'),
    HUB_SPINE_PATH: join(dir, 'spine.jsonl'),
    HUB_WORLD_PATH: join(dir, 'world.sqlite'),
    HUB_RESULT_PATH: join(dir, 'results.sqlite'),
    HUB_WORKSHOP_ROOT: process.cwd(),
  };
  let hub;
  try {
    hub = createHub({ env });
    const first = await hub.wake('establish the persisted Glass inheritance');
    assert.equal(first.status, 'committed');
    hub.db.getSessionGlassInheritance = () => null;

    const ordinary = await hub.wake('this crossing remains causal and ordinary');
    assert.equal(ordinary.status, 'committed');
    assert.deepEqual(ordinary.phases.map(item => item.phase), ['ordinary']);
    assert.equal(ordinary.phases[0].glassCast.receipt.cast.bands[1].mode, 'none');
  } finally {
    if (hub) await hub.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
