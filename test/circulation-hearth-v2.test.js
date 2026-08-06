import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpineStore, verifySpine } from '../src/spine/store.js';
import { scrubProviderReturn } from '../src/scrub/provider-return.js';
import { buildHearthScroll } from '../src/hearth/scroll.js';
import { BLESSING_V1, ACTIVE_CHAMBER, CONTINUITY_NAME } from '../src/resident/charter.js';

async function temporary() { return mkdtemp(join(tmpdir(), 'hub-circulation-v2-')); }

test('Spine retains exact invalid raw returns and refuses raw custody after outcome', async () => {
  const dir = await temporary(); const spine = new SpineStore(join(dir, 'spine.jsonl'));
  try {
    const prepared = spine.prepareRequest({ requestBody: '{}', threadId: 'thread', wakeId: 'wake', provider: 'fake', model: 'm', authorizationPresent: false, requestPhase: 'ordinary' });
    spine.dispatchAttempted(prepared.record_id);
    const raw = Buffer.from('{"not valid":', 'utf8');
    const returned = spine.providerRawReturn(prepared.record_id, { body: raw, httpStatus: 200, contentType: 'application/json', phase: 'ordinary' });
    spine.providerOutcome(prepared.record_id, { kind: 'invalid_response', http_status: 200 });
    assert.equal(returned.body_byte_length, raw.length);
    assert.equal(Buffer.from(returned.raw_body_base64, 'base64').equals(raw), true);
    assert.throws(() => spine.providerRawReturn(prepared.record_id, { body: 'later', httpStatus: 200 }), /follow provider outcome/);
    assert.equal(verifySpine(join(dir, 'spine.jsonl')).frameCount, 4);
  } finally { spine.close(); await rm(dir, { recursive: true, force: true }); }
});

test('return Scrub selects exact assistant fields including tool calls and reasoning', async () => {
  const dir = await temporary(); const spine = new SpineStore(join(dir, 'spine.jsonl'));
  try {
    const prepared = spine.prepareRequest({ requestBody: '{}', threadId: 'thread', wakeId: 'wake', provider: 'fake', model: 'm', authorizationPresent: false, requestPhase: 'orientation' });
    spine.dispatchAttempted(prepared.record_id);
    const body = JSON.stringify({ id: 'r', choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tool', type: 'function', function: { name: 'tend_hearth', arguments: '{}' } }], reasoning_content: 'exact reasoning' } }] });
    const raw = spine.providerRawReturn(prepared.record_id, { body, httpStatus: 200 });
    spine.providerOutcome(prepared.record_id, { kind: 'success', http_status: 200, response_id: 'r' });
    const scrubbed = scrubProviderReturn(raw);
    assert.equal(scrubbed.message.tool_calls[0].function.arguments, '{}');
    assert.equal(scrubbed.message.reasoning_content, 'exact reasoning');
    assert.equal(scrubbed.receipt.selectionPath.join('.'), 'choices.0.message');
  } finally { spine.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Hearth Scroll uses exact Unicode-safe suffixes and keeps machine receipt separate', () => {
  const source = 'prefix '.repeat(20) + 'tail 🙂 exact';
  const hearth = {
    continuity: CONTINUITY_NAME, chamber: ACTIVE_CHAMBER,
    environment: { implemented: false, spatial_room_implemented: false, movement_implemented: false, perception_implemented: false },
    limitations: ['No room or movement machinery is implemented.'],
  };
  const result = buildHearthScroll({ hearth, prior: { tail: [{ id: 'event-1', actorKind: 'user', content: source, createdAt: '2026-01-01T00:00:00.000Z' }] }, budget: 3000, excerptLimit: 24 });
  const atom = result.receipt.scroll.sourceEvents[0];
  assert.equal(result.markdown.length <= 3000, true);
  assert.equal(atom.excerpt, source.slice(atom.excerptStartUtf16));
  assert.equal(atom.excerpt.endsWith('🙂 exact'), true);
  assert.equal(result.markdown.includes('…'), false);
  assert.equal(result.markdown.includes(BLESSING_V1), true);
  assert.equal(result.receipt.scroll.renderedScrollHash, result.markdownHash);
  assert.equal(result.markdown.includes('"schema_version"'), false);
});

test('inspection keeps operational wiring behind an explicit affordance and filters conversation', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /Expose wiring/);
  assert.match(app, /eventKind === 'utterance'/);
  assert.match(app, /currentInspectionTab = 'wiring'/);
  assert.match(app, /returnScrubReceiptId/);
});

test('a temp DB fixture never appends to the configured default/runtime Spine', async () => {
  const dbRoot = await temporary(); const defaultRoot = await temporary();
  const defaultSpine = join(defaultRoot, 'spine', 'resident-seat-1.jsonl');
  await mkdir(join(defaultRoot, 'spine'), { recursive: true }); await writeFile(defaultSpine, '', 'utf8');
  const before = await readFile(defaultSpine, 'utf8');
  const { createHub } = await import('../src/server/app.js');
  const hub = createHub({ env: { HUB_RESIDENT_MODE: 'fake', HUB_RUNTIME_ROOT: defaultRoot, HUB_DB_PATH: join(dbRoot, 'hub.sqlite') } });
  try {
    const wake = await hub.wake('isolated fixture');
    assert.equal(wake.status, 'committed');
    assert.equal(await readFile(defaultSpine, 'utf8'), before);
    assert.notEqual(hub.config.spinePath, defaultSpine);
    assert.equal(hub.config.spinePath.startsWith(dbRoot), true);
  } finally { hub.close(); await rm(dbRoot, { recursive: true, force: true }); await rm(defaultRoot, { recursive: true, force: true }); }
});
