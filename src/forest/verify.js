import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../core/hash.js';
import { readSpineFrames } from '../spine/store.js';
import { metadataForEvent } from './admission.js';
import { APPEND_ONLY_TABLES } from './store.js';

export function verifyForest({ forestPath, operationalPath, spinePath, strictBijection = true } = {}) {
  if (!forestPath || !existsSync(forestPath)) throw new Error('Forest database is missing.');
  const forest = new DatabaseSync(forestPath, { readOnly: true });
  const op = new DatabaseSync(operationalPath, { readOnly: true });
  try {
    const required = APPEND_ONLY_TABLES;
    for (const table of required) if (!forest.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Forest schema is missing ${table}.`);
    for (const table of required) for (const action of ['update', 'delete']) if (!forest.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_append_only_${action}`)) throw new Error(`Forest append-only trigger is missing for ${table}.`);
    const metadata = forest.prepare('SELECT schema_name, schema_version FROM forest_metadata WHERE metadata_id=1').get();
    if (!metadata || metadata.schema_name !== 'forest' || metadata.schema_version !== 1) throw new Error('Forest schema version is not v1.');

    const allOperational = op.prepare(`SELECT e.id, e.thread_id AS threadId, e.wake_id AS wakeId,
      e.actor_kind AS actorKind, e.event_kind AS eventKind, e.content, e.authority, e.provider, e.model,
      e.created_at AS createdAt, COALESCE(w.provider, e.provider, '') AS effectiveProvider
      FROM events e LEFT JOIN wakes w ON w.id=e.wake_id
      WHERE e.event_kind='utterance' AND e.actor_kind IN ('user','resident')
      ORDER BY e.thread_id, e.created_at, e.id`).all();
    const eligible = allOperational.filter(event => event.effectiveProvider !== 'fake');
    const excludedFakeCount = allOperational.length - eligible.length;
    const events = new Map(eligible.map(event => [event.id, event]));
    const entries = forest.prepare('SELECT * FROM forest_entries ORDER BY thread_id, source_timestamp, source_event_id').all();
    const entryBySource = new Map(entries.map(entry => [entry.source_event_id, entry]));
    const entryIds = new Set(entries.map(entry => entry.entry_id));
    const eligibleIds = new Set(eligible.map(event => event.id));
    const missingSourceIds = eligible.filter(event => !entryBySource.has(event.id)).map(event => event.id);
    const extraSourceIds = entries.filter(entry => !eligibleIds.has(entry.source_event_id)).map(entry => entry.source_event_id);
    if (strictBijection && (missingSourceIds.length || extraSourceIds.length || entries.length !== eligible.length)) throw new Error(`Forest source bijection failed (${missingSourceIds.length} missing, ${extraSourceIds.length} extra).`);
    if (extraSourceIds.length) throw new Error(`Forest contains an ineligible or unknown source event ${extraSourceIds[0]}.`);

    const receipts = forest.prepare('SELECT * FROM scrub_receipts ORDER BY receipt_id').all();
    if (receipts.length !== entries.length) throw new Error('Forest scrub receipts are not one-to-one with entries.');
    const receiptsBySource = new Map(receipts.map(receipt => [receipt.source_event_id, receipt]));
    for (const entry of entries) {
      const event = events.get(entry.source_event_id);
      if (!event || entry.source_event_hash !== sha256(event.content) || entry.source_timestamp !== event.createdAt || entry.body !== event.content || entry.body_hash !== sha256(event.content) || entry.actor_kind !== event.actorKind || entry.signature !== `actor:${event.actorKind}` || entry.thread_id !== event.threadId || (entry.wake_id || null) !== (event.wakeId || null) || entry.source_authority !== event.authority || entry.jurisdiction !== 'home' || entry.bucket !== 'utterance' || entry.metadata_json !== metadataForEvent(event)) throw new Error(`Forest source custody mismatch for ${entry.source_event_id}.`);
      const receipt = receiptsBySource.get(entry.source_event_id);
      if (!receipt || receipt.receipt_id !== entry.scrub_receipt_id || receipt.policy_name !== 'utterance_identity' || receipt.policy_version !== 'v1' || receipt.input_hash !== receipt.output_hash || receipt.input_byte_length !== receipt.output_byte_length || receipt.operations_json !== '[]' || receipt.changed !== 0 || receipt.input_hash !== entry.body_hash) throw new Error(`Forest scrub receipt mismatch for ${entry.source_event_id}.`);
    }
    for (const receipt of receipts) if (!entryBySource.has(receipt.source_event_id)) throw new Error('Forest contains an orphan scrub receipt.');

    const edges = forest.prepare('SELECT * FROM forest_edges').all();
    for (const edge of edges) if (edge.edge_type !== 'responds_to' || !entryIds.has(edge.from_entry_id) || !entryIds.has(edge.to_entry_id)) throw new Error('Forest edge reference is invalid.');
    const edgeByFrom = new Map();
    for (const edge of edges) { if (edgeByFrom.has(edge.from_entry_id)) throw new Error('Forest has duplicate responds_to edges.'); edgeByFrom.set(edge.from_entry_id, edge); }
    const eventThreads = new Map();
    for (const event of eligible) { if (!eventThreads.has(event.threadId)) eventThreads.set(event.threadId, []); eventThreads.get(event.threadId).push(event); }
    for (const [threadId, threadEvents] of eventThreads) {
      const threadEntries = threadEvents.map(event => entryBySource.get(event.id)).filter(Boolean);
      for (let index = 0; index < threadEntries.length; index++) {
        const edge = edgeByFrom.get(threadEntries[index].entry_id);
        const expectedTarget = index === 0 ? null : threadEntries[index - 1].entry_id;
        if ((edge?.to_entry_id || null) !== expectedTarget) throw new Error(`Forest responds_to chain is invalid for ${threadId}.`);
      }
    }
    if (strictBijection && edges.length !== Math.max(0, eligible.length - eventThreads.size)) throw new Error('Forest responds_to edge count is invalid.');

    const spineFrames = spinePath && existsSync(spinePath) ? readSpineFrames(spinePath) : [];
    const preparedFrames = spineFrames.filter(frame => frame.frame_type === 'request_prepared');
    const preparedById = new Map(preparedFrames.map(frame => [frame.record_id, frame]));
    const lifecycleByRequest = new Map(preparedFrames.map(frame => [frame.record_id, { dispatched: false, outcome: null }]));
    for (const frame of spineFrames) {
      if (frame.frame_type === 'dispatch_attempted') lifecycleByRequest.get(frame.request_record_id).dispatched = true;
      if (frame.frame_type === 'provider_outcome') lifecycleByRequest.get(frame.request_record_id).outcome = frame.outcome;
    }
    const presentationRows = forest.prepare('SELECT * FROM presentation_links').all();
    const emissionRows = forest.prepare('SELECT * FROM emission_links').all();
    if ((presentationRows.length || emissionRows.length) && !preparedFrames.length) throw new Error('Forest links require a verified Spine.');
    const presentationsByRequest = new Map();
    for (const link of presentationRows) { if (!entryIds.has(link.entry_id) || !preparedById.has(link.request_record_id)) throw new Error('Presentation link reference is invalid.'); if (!presentationsByRequest.has(link.request_record_id)) presentationsByRequest.set(link.request_record_id, []); presentationsByRequest.get(link.request_record_id).push(link); }
    for (const frame of preparedFrames) {
      const wake = op.prepare('SELECT id, thread_id AS threadId, provider, requested_model AS requestedModel FROM wakes WHERE id=?').get(frame.wake_id);
      if (!wake) throw new Error('Spine request references an unknown wake.');
      const thread = op.prepare('SELECT id FROM threads WHERE id=?').get(frame.thread_id);
      if (!thread || frame.thread_id !== wake.threadId || frame.provider !== wake.provider || frame.model !== wake.requestedModel) throw new Error(`Spine request custody does not match wake ${frame.wake_id}.`);
      let request;
      try { request = JSON.parse(frame.request_body); } catch { throw new Error('Spine request body is not valid JSON.'); }
      if (request.model !== wake.requestedModel) throw new Error(`Spine request JSON model does not match wake ${frame.wake_id}.`);
      const context = op.prepare(`SELECT ordinal, item_kind AS itemKind, actor_role AS actorRole, content, source_event_id AS sourceEventId, included, content_hash AS contentHash FROM wake_context_items WHERE wake_id=? ORDER BY ordinal`).all(frame.wake_id).map(item => ({ ...item, included: Boolean(item.included) }));
      const included = context.filter(item => item.included);
      if (!Array.isArray(request.messages) || request.messages.length !== included.length) throw new Error(`Spine request messages do not match wake ${frame.wake_id}.`);
      for (let index = 0; index < included.length; index++) if (request.messages[index]?.role !== included[index].actorRole || request.messages[index]?.content !== included[index].content) throw new Error(`Spine request message mismatch for wake ${frame.wake_id}.`);
      const expected = included.map((item, index) => item.itemKind === 'utterance' && item.sourceEventId ? { item, ordinal: index + 1 } : null).filter(Boolean);
      const links = presentationsByRequest.get(frame.record_id) || [];
      const lifecycle = lifecycleByRequest.get(frame.record_id);
      if (!lifecycle.dispatched) {
        if (links.length) throw new Error(`Prepared-only request ${frame.record_id} cannot have presentation links.`);
        continue;
      }
      if (links.length !== expected.length) throw new Error(`Presentation link set is incomplete for request ${frame.record_id}.`);
      const linkByEntry = new Map(links.map(link => [link.entry_id, link]));
      for (const { item, ordinal } of expected) {
        const entry = entryBySource.get(item.sourceEventId); const link = entry && linkByEntry.get(entry.entry_id);
        if (!entry || !link || link.message_ordinal !== ordinal || link.provider_role !== request.messages[ordinal - 1].role || link.content_hash !== sha256(request.messages[ordinal - 1].content) || link.content_hash !== entry.body_hash) throw new Error(`Presentation truth failed for request ${frame.record_id}.`);
      }
      if (links.some(link => !expected.some(({ item }) => entryBySource.get(item.sourceEventId)?.entry_id === link.entry_id))) throw new Error(`Presentation link set has extras for request ${frame.record_id}.`);
    }

    const residentsByWake = new Map();
    for (const event of eligible.filter(event => event.actorKind === 'resident')) { if (!residentsByWake.has(event.wakeId)) residentsByWake.set(event.wakeId, []); residentsByWake.get(event.wakeId).push(event); }
    const emissionsByEntry = new Map();
    for (const link of emissionRows) {
      if (!entryIds.has(link.entry_id) || !preparedById.has(link.request_record_id)) throw new Error('Emission link reference is invalid.');
      const entry = entries.find(candidate => candidate.entry_id === link.entry_id); const event = entry && events.get(entry.source_event_id); const request = preparedById.get(link.request_record_id);
      const lifecycle = lifecycleByRequest.get(link.request_record_id);
      if (!event || event.actorKind !== 'resident' || event.wakeId !== request.wake_id || !lifecycle.dispatched || lifecycle.outcome?.kind !== 'success') throw new Error('Emission link wake custody is invalid.');
      emissionsByEntry.set(link.entry_id, (emissionsByEntry.get(link.entry_id) || 0) + 1);
    }
    for (const frame of preparedFrames) {
      const residents = residentsByWake.get(frame.wake_id) || [];
      if (residents.length > 1) throw new Error(`Wake ${frame.wake_id} has multiple resident emissions.`);
      const lifecycle = lifecycleByRequest.get(frame.record_id);
      if (lifecycle.outcome?.kind === 'success' && residents.length !== 1) throw new Error(`Successful provider outcome lacks exactly one resident emission for wake ${frame.wake_id}.`);
      if (residents.length && lifecycle.outcome?.kind !== 'success') throw new Error(`Resident emission lacks a successful provider outcome for wake ${frame.wake_id}.`);
      if (residents.length === 1 && emissionsByEntry.get(entryBySource.get(residents[0].id)?.entry_id) !== 1) throw new Error(`Resident emission link is missing for wake ${frame.wake_id}.`);
      if (lifecycle.outcome && lifecycle.outcome.kind !== 'success' && residents.length) throw new Error(`Failed provider outcome has a resident emission for wake ${frame.wake_id}.`);
    }
    return { ok: true, entryCount: entries.length, eligibleOperationalCount: eligible.length, excludedFakeCount, missingSourceCount: missingSourceIds.length, edgeCount: edges.length, presentationCount: presentationRows.length, emissionCount: emissionRows.length };
  } finally { forest.close(); op.close(); }
}
