import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, sha256 } from '../core/hash.js';
import { readSpineLedgerFrames, spineLedgerExists } from '../spine/store.js';
import { metadataForEvent } from './admission.js';
import { APPEND_ONLY_TABLES } from './store.js';

export function wildSourceKindForTool(toolName) {
  if (['workshop_read', 'workshop_document_read'].includes(toolName)) return 'workshop_read';
  if (['workshop_search', 'workshop_search_regex'].includes(toolName)) return 'workshop_search';
  return null;
}

export function verifyForest({ forestPath, operationalPath, spinePath, worldPath, strictBijection = true, strictWildBijection = true } = {}) {
  if (!forestPath || !existsSync(forestPath)) throw new Error('Forest database is missing.');
  const forest = new DatabaseSync(forestPath, { readOnly: true });
  const op = new DatabaseSync(operationalPath, { readOnly: true });
  let world = null;
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

    const spineFrames = spinePath && spineLedgerExists(spinePath) ? readSpineLedgerFrames(spinePath) : [];
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
      if (frame.request_phase) {
        const providerRequest = op.prepare('SELECT phase, message_sources_json AS messageSources FROM provider_requests WHERE spine_record_id=?').get(frame.record_id);
        if (!providerRequest || providerRequest.phase !== frame.request_phase) throw new Error(`Spine phase custody is missing for request ${frame.record_id}.`);
        const refs = JSON.parse(providerRequest.messageSources);
        if (!Array.isArray(request.messages) || request.messages.length !== refs.length) throw new Error(`Spine request messages do not match provider phase ${frame.request_phase}.`);
        for (let index = 0; index < refs.length; index++) if (JSON.stringify(request.messages[index]) !== JSON.stringify(refs[index].message)) throw new Error(`Spine structured message mismatch for request ${frame.record_id}.`);
        if (frame.request_phase === 'orientation') {
          if (!Array.isArray(request.tools) || request.tools.length !== 1 || request.tools[0]?.function?.name !== 'tend_hearth' || JSON.stringify(request.tool_choice) !== JSON.stringify({ type: 'function', function: { name: 'tend_hearth' } })) throw new Error(`Orientation tool contract is invalid for request ${frame.record_id}.`);
        } else if (request.tool_choice) throw new Error(`Non-orientation request has a forced tool choice ${frame.record_id}.`);
        const expected = refs.map((ref, index) => ref.sourceEventId ? { sourceEventId: ref.sourceEventId, ordinal: index + 1 } : null).filter(Boolean);
        const links = presentationsByRequest.get(frame.record_id) || [];
        const lifecycle = lifecycleByRequest.get(frame.record_id);
        if (!lifecycle.dispatched) { if (links.length) throw new Error(`Prepared-only request ${frame.record_id} cannot have presentation links.`); continue; }
        const required = expected.filter(item => entryBySource.get(item.sourceEventId)?.spine_status === 'live');
        if (links.length < required.length || links.length > expected.length) throw new Error(`Presentation link set is incomplete for request ${frame.record_id}.`);
        const linkByEntry = new Map(links.map(link => [link.entry_id, link]));
        for (const item of expected) {
          const entry = entryBySource.get(item.sourceEventId); const link = entry && linkByEntry.get(entry.entry_id);
          if (!entry) { if (strictBijection) throw new Error(`Presentation truth failed for request ${frame.record_id}.`); continue; }
          if ((entry.spine_status === 'live' && !link) || (link && (link.message_ordinal !== item.ordinal || link.provider_role !== request.messages[item.ordinal - 1].role || link.content_hash !== sha256(request.messages[item.ordinal - 1].content) || link.content_hash !== entry.body_hash))) throw new Error(`Presentation truth failed for request ${frame.record_id}.`);
        }
        if (links.some(link => !expected.some(item => entryBySource.get(item.sourceEventId)?.entry_id === link.entry_id))) throw new Error(`Presentation link set has extras for request ${frame.record_id}.`);
        continue;
      }
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
      const required = expected.filter(({ item }) => entryBySource.get(item.sourceEventId)?.spine_status === 'live');
      if (links.length < required.length || links.length > expected.length) throw new Error(`Presentation link set is incomplete for request ${frame.record_id}.`);
      const linkByEntry = new Map(links.map(link => [link.entry_id, link]));
      for (const { item, ordinal } of expected) {
        const entry = entryBySource.get(item.sourceEventId); const link = entry && linkByEntry.get(entry.entry_id);
        if (!entry) { if (strictBijection) throw new Error(`Presentation truth failed for request ${frame.record_id}.`); continue; }
        if ((entry.spine_status === 'live' && !link) || (link && (link.message_ordinal !== ordinal || link.provider_role !== request.messages[ordinal - 1].role || link.content_hash !== sha256(request.messages[ordinal - 1].content) || link.content_hash !== entry.body_hash))) throw new Error(`Presentation truth failed for request ${frame.record_id}.`);
      }
      if (links.some(link => !expected.some(({ item }) => entryBySource.get(item.sourceEventId)?.entry_id === link.entry_id))) throw new Error(`Presentation link set has extras for request ${frame.record_id}.`);
    }

    const responseToolRoundByRequest = new Map();
    for (const frame of preparedFrames) {
      const requestRow = op.prepare('SELECT response_message_json AS responseMessage FROM provider_requests WHERE spine_record_id=?').get(frame.record_id);
      let responseMessage = null; try { responseMessage = requestRow?.responseMessage ? JSON.parse(requestRow.responseMessage) : null; } catch { throw new Error(`Provider response message is not valid JSON for request ${frame.record_id}.`); }
      responseToolRoundByRequest.set(frame.record_id, Array.isArray(responseMessage?.tool_calls) && responseMessage.tool_calls.length > 0);
    }
    const residentsByWake = new Map();
    for (const event of eligible.filter(event => event.actorKind === 'resident')) { if (!residentsByWake.has(event.wakeId)) residentsByWake.set(event.wakeId, []); residentsByWake.get(event.wakeId).push(event); }
    const requestFramesByWake = new Map();
    for (const frame of preparedFrames) {
      if (frame.request_phase === 'orientation') continue;
      if (!requestFramesByWake.has(frame.wake_id)) requestFramesByWake.set(frame.wake_id, []);
      requestFramesByWake.get(frame.wake_id).push(frame);
    }
    const emissionOwnerByWake = new Map();
    for (const [wakeId, frames] of requestFramesByWake) {
      const finalFrame = frames.at(-1);
      const lifecycle = finalFrame && lifecycleByRequest.get(finalFrame.record_id);
      if (finalFrame && !responseToolRoundByRequest.get(finalFrame.record_id) && lifecycle?.dispatched && lifecycle.outcome?.kind === 'success') emissionOwnerByWake.set(wakeId, finalFrame.record_id);
    }
    const emissionsByEntry = new Map();
    const emissionsByRequest = new Set();
    const emissionLinksByRequest = new Map();
    for (const link of emissionRows) {
      if (!entryIds.has(link.entry_id) || !preparedById.has(link.request_record_id)) throw new Error('Emission link reference is invalid.');
      const entry = entries.find(candidate => candidate.entry_id === link.entry_id); const event = entry && events.get(entry.source_event_id); const request = preparedById.get(link.request_record_id);
      const lifecycle = lifecycleByRequest.get(link.request_record_id);
      if (!event || event.actorKind !== 'resident' || event.wakeId !== request.wake_id || request.request_phase === 'orientation' || emissionOwnerByWake.get(request.wake_id) !== link.request_record_id || !lifecycle.dispatched || lifecycle.outcome?.kind !== 'success') throw new Error('Emission link wake custody is invalid.');
      emissionsByEntry.set(link.entry_id, (emissionsByEntry.get(link.entry_id) || 0) + 1);
      emissionsByRequest.add(link.request_record_id);
      if (!emissionLinksByRequest.has(link.request_record_id)) emissionLinksByRequest.set(link.request_record_id, []);
      emissionLinksByRequest.get(link.request_record_id).push(link);
    }
    for (const frame of preparedFrames) {
      const residents = residentsByWake.get(frame.wake_id) || [];
      const lifecycle = lifecycleByRequest.get(frame.record_id);
      if (frame.request_phase === 'orientation') {
        if (emissionsByRequest.has(frame.record_id)) throw new Error(`Orientation request ${frame.record_id} has a Forest resident emission.`);
        continue;
      }
      const ownsEmission = emissionOwnerByWake.get(frame.wake_id) === frame.record_id;
      if (!ownsEmission) { if (emissionsByRequest.has(frame.record_id)) throw new Error(`Non-final provider request ${frame.record_id} has a resident emission.`); continue; }
      if (residents.length > 1) throw new Error(`Wake ${frame.wake_id} has multiple resident emissions.`);
      if (lifecycle.outcome?.kind === 'success' && residents.length !== 1) throw new Error(`Successful provider outcome lacks exactly one resident emission for wake ${frame.wake_id}.`);
      if (residents.length && lifecycle.outcome?.kind !== 'success') throw new Error(`Resident emission lacks a successful provider outcome for wake ${frame.wake_id}.`);
      if (residents.length === 1) {
        const residentEntry = entryBySource.get(residents[0].id);
        const emissionCount = emissionsByEntry.get(residentEntry?.entry_id) || 0;
        const requestEmissionCount = emissionLinksByRequest.get(frame.record_id)?.length || 0;
        if ((!residentEntry && strictBijection) || (residentEntry?.spine_status === 'live' && (emissionCount !== 1 || requestEmissionCount !== 1)) || emissionCount > 1 || requestEmissionCount > 1) throw new Error(`Resident emission link is missing for wake ${frame.wake_id}.`);
      }
      if (lifecycle.outcome && lifecycle.outcome.kind !== 'success' && residents.length) throw new Error(`Failed provider outcome has a resident emission for wake ${frame.wake_id}.`);
    }
    const wildTable = forest.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wild_entries'").get();
    let wildCount = 0;
    let eligibleWildCount = null;
    let wildEntries = [];
    if (wildTable) {
      const wild = forest.prepare('SELECT * FROM wild_entries ORDER BY created_at,entry_id').all();
      wildEntries = wild;
      if (wild.length) {
        if (!worldPath || !existsSync(worldPath)) throw new Error('Wild workshop custody exists but its World Graph path was not provided.');
        world = new DatabaseSync(worldPath, { readOnly: true });
        const worldMetadata = world.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_action_receipts'").get();
        if (!worldMetadata) throw new Error('Wild workshop custody cannot be checked because World action receipts are missing.');
      }
      const wildByAction = new Map();
      for (const entry of wild) {
        if (entry.jurisdiction !== 'wild' || entry.bucket !== 'workshop_source' || !['workshop_read','workshop_search'].includes(entry.source_kind) || entry.body_hash !== sha256(entry.body) || !entry.action_receipt_id || !entry.request_record_id || !entry.spine_record_id) throw new Error(`Wild workshop source custody mismatch for ${entry.entry_id}.`);
        if (!wildByAction.has(entry.action_receipt_id)) wildByAction.set(entry.action_receipt_id, []);
        wildByAction.get(entry.action_receipt_id).push(entry);
      }
      for (const [actionReceiptId, entriesForAction] of wildByAction) {
        const action = world.prepare('SELECT * FROM world_action_receipts WHERE receipt_id=?').get(actionReceiptId);
        const expectedSourceKind = wildSourceKindForTool(action?.tool_name);
        if (!action || action.outcome !== 'committed' || expectedSourceKind !== entriesForAction[0].source_kind || action.request_record_id !== entriesForAction[0].request_record_id || action.spine_record_id !== entriesForAction[0].spine_record_id || !action.request_record_id || !action.spine_record_id) throw new Error(`Wild workshop action custody mismatch for ${actionReceiptId}.`);
        const providerRequest = op.prepare('SELECT id, session_id AS sessionId, wake_id AS wakeId, spine_record_id AS spineRecordId FROM provider_requests WHERE id=?').get(action.request_record_id);
        if (!providerRequest || providerRequest.sessionId !== action.session_id || providerRequest.wakeId !== action.wake_id || providerRequest.spineRecordId !== action.spine_record_id) throw new Error(`Wild workshop request ancestry mismatch for ${actionReceiptId}.`);
        const requestFrame = preparedById.get(action.spine_record_id);
        const lifecycle = lifecycleByRequest.get(action.spine_record_id);
        if (!requestFrame || requestFrame.wake_id !== action.wake_id || !lifecycle?.dispatched || lifecycle.outcome?.kind !== 'success') throw new Error(`Wild workshop Spine ancestry mismatch for ${actionReceiptId}.`);
        let result;
        try { result = JSON.parse(action.result_json); } catch { throw new Error(`World action result is not valid JSON for ${actionReceiptId}.`); }
        const expected = ['workshop_read', 'workshop_document_read'].includes(action.tool_name)
          ? [{ path: result.source?.path, startLine: result.source?.startLine, endLine: result.source?.endLine, text: result.source?.text, hash: result.source?.hash }]
          : (Array.isArray(result.matches) ? result.matches.map(match => ({ path: match.path, startLine: match.line, endLine: match.line, text: match.text, hash: match.hash })) : null);
        if (!expected || result.kind !== action.tool_name || expected.some(item => !item.path || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || typeof item.text !== 'string' || item.hash !== sha256(item.text))) throw new Error(`World action source result is not exact for ${actionReceiptId}.`);
        if (expected.length !== entriesForAction.length) throw new Error(`Wild workshop source count mismatch for ${actionReceiptId}.`);
        const unmatched = expected.slice();
        for (const entry of entriesForAction) {
          const index = unmatched.findIndex(item => item.path === entry.repository_path && item.startLine === entry.start_line && item.endLine === entry.end_line && item.text === entry.body && item.hash === entry.body_hash);
          if (index < 0) throw new Error(`Wild workshop source span mismatch for ${entry.entry_id}.`);
          unmatched.splice(index, 1);
        }
      }
      if (strictWildBijection && worldPath && existsSync(worldPath)) {
        if (!world) world = new DatabaseSync(worldPath, { readOnly: true });
        const actions = world.prepare("SELECT * FROM world_action_receipts WHERE outcome='committed' AND tool_name IN ('workshop_read','workshop_document_read','workshop_search','workshop_search_regex') AND request_record_id IS NOT NULL AND spine_record_id IS NOT NULL ORDER BY created_at,receipt_id").all();
        const expectedKeys = new Set();
        for (const action of actions) {
          let result;
          try { result = JSON.parse(action.result_json); } catch { throw new Error(`World action result is not valid JSON for ${action.receipt_id}.`); }
          const expected = ['workshop_read', 'workshop_document_read'].includes(action.tool_name)
            ? [{ path: result.source?.path, startLine: result.source?.startLine, endLine: result.source?.endLine, text: result.source?.text, hash: result.source?.hash }]
            : (Array.isArray(result.matches) ? result.matches.map(match => ({ path: match.path, startLine: match.line, endLine: match.line, text: match.text, hash: match.hash })) : null);
          if (!expected || result.kind !== action.tool_name || expected.some(item => !item.path || !Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || typeof item.text !== 'string' || item.hash !== sha256(item.text))) throw new Error(`World action source result is not exact for ${action.receipt_id}.`);
          for (const item of expected) expectedKeys.add(`${action.receipt_id}\0${item.path}\0${item.startLine}\0${item.endLine}\0${item.hash}`);
        }
        const actualKeys = new Set(wild.map(entry => `${entry.action_receipt_id}\0${entry.repository_path}\0${entry.start_line}\0${entry.end_line}\0${entry.body_hash}`));
        eligibleWildCount = expectedKeys.size;
        const missing = [...expectedKeys].filter(key => !actualKeys.has(key));
        const extra = [...actualKeys].filter(key => !expectedKeys.has(key));
        if (missing.length || extra.length || actualKeys.size !== expectedKeys.size) throw new Error(`Forest Wild source bijection failed (${missing.length} missing, ${extra.length} extra).`);
      }
      wildCount = wild.length;
    }
    const offers = forest.prepare('SELECT * FROM forest_intake_offers ORDER BY offer_id').all();
    const decisions = forest.prepare('SELECT * FROM forest_intake_decisions ORDER BY offer_id,revision').all();
    const offersById = new Map(offers.map(offer => [offer.offer_id, offer]));
    const decisionsByOffer = new Map();
    for (const decision of decisions) {
      if (!offersById.has(decision.offer_id)) throw new Error('Forest Intake Ledger contains an orphan decision.');
      if (!decisionsByOffer.has(decision.offer_id)) decisionsByOffer.set(decision.offer_id, []);
      decisionsByOffer.get(decision.offer_id).push(decision);
    }
    const latestByOffer = new Map();
    for (const [offerId, history] of decisionsByOffer) {
      for (let index = 0; index < history.length; index++) {
        const decision = history[index];
        if (decision.revision !== index + 1) throw new Error(`Forest Intake Ledger revision chain is invalid for ${offerId}.`);
        if (decision.state === 'admitted' && (!decision.destination_entry_id || decision.reason_code || decision.reason_detail)) throw new Error(`Forest admitted decision is malformed for ${offerId}.`);
        if (decision.state !== 'admitted' && decision.destination_entry_id) throw new Error(`Forest non-admitted decision claims a destination for ${offerId}.`);
        if (index < history.length - 1 && ['admitted','routed','superseded','permanently_refused'].includes(decision.state)) throw new Error(`Forest Intake Ledger continues after a terminal decision for ${offerId}.`);
      }
      latestByOffer.set(offerId, history.at(-1));
    }
    const expectedOfferIds = new Set();
    for (const entry of entries) {
      const edge = edgeByFrom.get(entry.entry_id);
      const predecessorSourceId = edge ? entries.find(candidate => candidate.entry_id === edge.to_entry_id)?.source_event_id || null : null;
      const locator = { threadId: entry.thread_id, wakeId: entry.wake_id || null, actorKind: entry.actor_kind };
      const offerId = `intake_${sha256(canonicalize({ sourceKind: 'source_event', sourceId: entry.source_event_id, sourceLocator: locator }))}`;
      expectedOfferIds.add(offerId);
      const offer = offersById.get(offerId); const latest = latestByOffer.get(offerId);
      if (!offer || offer.source_kind !== 'source_event' || offer.source_id !== entry.source_event_id || offer.source_locator_json !== canonicalize(locator) || offer.source_hash !== entry.source_event_hash || offer.intended_jurisdiction !== 'home' || offer.intended_bucket !== 'utterance' || offer.predecessor_source_id || offer.source_timestamp !== entry.source_timestamp || offer.scrub_policy !== entry.scrub_policy || offer.scrub_version !== entry.scrub_version || latest?.state !== 'admitted' || (latest.predecessor_source_id || null) !== predecessorSourceId || latest.destination_entry_id !== entry.entry_id) throw new Error(`Forest Home intake custody mismatch for ${entry.entry_id}.`);
    }
    for (const entry of wildEntries) {
      const locator = { path: entry.repository_path, startLine: entry.start_line, endLine: entry.end_line };
      const offerId = `intake_${sha256(canonicalize({ sourceKind: 'world_action_span', sourceId: entry.action_receipt_id, sourceLocator: locator }))}`;
      expectedOfferIds.add(offerId);
      const offer = offersById.get(offerId); const latest = latestByOffer.get(offerId);
      if (!offer || offer.source_kind !== 'world_action_span' || offer.source_id !== entry.action_receipt_id || offer.source_locator_json !== canonicalize(locator) || offer.source_hash !== entry.body_hash || offer.intended_jurisdiction !== 'wild' || offer.intended_bucket !== 'workshop_source' || offer.predecessor_source_id || offer.source_timestamp || offer.scrub_policy !== 'workshop_exact_source' || offer.scrub_version !== 'v1' || latest?.state !== 'admitted' || latest.predecessor_source_id || latest.destination_entry_id !== entry.entry_id) throw new Error(`Forest Wild intake custody mismatch for ${entry.entry_id}.`);
    }
    const journalEntries = forest.prepare('SELECT * FROM forest_journal_entries ORDER BY source_timestamp,entry_id').all();
    const journalCustody = forest.prepare('SELECT * FROM forest_journal_custody ORDER BY entry_id,revision').all();
    const custodyByEntry = new Map();
    for (const row of journalCustody) {
      if (!custodyByEntry.has(row.entry_id)) custodyByEntry.set(row.entry_id, []);
      custodyByEntry.get(row.entry_id).push(row);
    }
    for (const entry of journalEntries) {
      if (entry.jurisdiction !== 'home' || entry.bucket !== 'journal' || entry.actor_kind !== 'resident' || entry.signature !== 'actor:resident' || entry.source_authority !== 'model_signed' || entry.tool_name !== 'write_journal' || entry.scrub_policy !== 'journal_identity' || entry.scrub_version !== 'v1' || entry.body_hash !== sha256(entry.body) || entry.body_byte_length !== Buffer.byteLength(entry.body, 'utf8')) throw new Error(`Forest Journal entry custody mismatch for ${entry.entry_id}.`);
      const event = op.prepare(`SELECT id,thread_id AS threadId,session_id AS sessionId,wake_id AS wakeId,actor_kind AS actorKind,event_kind AS eventKind,content,authority,created_at AS createdAt FROM events WHERE id=?`).get(entry.source_event_id);
      if (!event || event.threadId !== entry.thread_id || event.sessionId !== entry.session_id || event.wakeId !== entry.wake_id || event.actorKind !== 'resident' || event.eventKind !== 'state' || event.authority !== 'model_signed' || event.createdAt !== entry.source_timestamp || sha256(event.content) !== entry.source_event_hash) throw new Error(`Forest Journal Source ancestry mismatch for ${entry.entry_id}.`);
      let message; let args;
      try { message = JSON.parse(event.content); args = JSON.parse(entry.arguments_json); } catch { throw new Error(`Forest Journal exact arguments are malformed for ${entry.entry_id}.`); }
      const call = message?.tool_calls?.find(candidate => candidate?.id === entry.tool_call_id && candidate?.function?.name === 'write_journal');
      if (!call || call.function.arguments !== entry.arguments_json || args?.entry !== entry.body || Object.keys(args).some(key => key !== 'entry')) throw new Error(`Forest Journal tool intent mismatch for ${entry.entry_id}.`);
      const request = op.prepare('SELECT id,session_id AS sessionId,wake_id AS wakeId,spine_record_id AS spineRecordId FROM provider_requests WHERE id=?').get(entry.request_record_id);
      const frame = preparedById.get(entry.spine_record_id);
      if (!request || request.sessionId !== entry.session_id || request.wakeId !== entry.wake_id || request.spineRecordId !== entry.spine_record_id || !frame || frame.wake_id !== entry.wake_id) throw new Error(`Forest Journal request/Spine ancestry mismatch for ${entry.entry_id}.`);
      const hostReceipt = op.prepare('SELECT id,session_id AS sessionId,wake_id AS wakeId,tool_name AS toolName FROM host_return_scrub_receipts WHERE id=?').get(entry.host_return_receipt_id);
      if (!hostReceipt || hostReceipt.sessionId !== entry.session_id || hostReceipt.wakeId !== entry.wake_id || hostReceipt.toolName !== 'write_journal') throw new Error(`Forest Journal host-return ancestry mismatch for ${entry.entry_id}.`);
      const history = custodyByEntry.get(entry.entry_id) || [];
      if (!history.length || history.some((row, index) => row.revision !== index + 1 || row.action_receipt_id !== entry.action_receipt_id || row.host_return_receipt_id !== entry.host_return_receipt_id)) throw new Error(`Forest Journal custody chain mismatch for ${entry.entry_id}.`);
      const locator = { threadId:entry.thread_id,sessionId:entry.session_id,wakeId:entry.wake_id,actorKind:'resident',toolCallId:entry.tool_call_id,toolName:'write_journal' };
      const offerId = `intake_${sha256(canonicalize({ sourceKind:'source_event',sourceId:entry.source_event_id,sourceLocator:locator }))}`;
      expectedOfferIds.add(offerId);
      const offer = offersById.get(offerId); const latest = latestByOffer.get(offerId);
      if (!offer || offer.source_kind !== 'source_event' || offer.source_id !== entry.source_event_id || offer.source_locator_json !== canonicalize(locator) || offer.source_hash !== entry.source_event_hash || offer.intended_jurisdiction !== 'home' || offer.intended_bucket !== 'journal' || offer.source_timestamp !== entry.source_timestamp || offer.scrub_policy !== 'journal_identity' || offer.scrub_version !== 'v1' || latest?.state !== 'admitted' || latest.destination_entry_id !== entry.entry_id) throw new Error(`Forest Journal intake custody mismatch for ${entry.entry_id}.`);
    }
    for (const row of journalCustody) if (!journalEntries.some(entry => entry.entry_id === row.entry_id)) throw new Error('Forest Journal contains orphan custody.');
    for (const offer of offers) {
      const latest = latestByOffer.get(offer.offer_id);
      if (!latest) continue;
      if (latest.state === 'admitted' && !expectedOfferIds.has(offer.offer_id)) throw new Error(`Forest Intake Ledger admits an unknown destination for ${offer.offer_id}.`);
    }
    const intakeHeldCount = [...latestByOffer.values()].filter(decision => decision.state === 'held').length;
    const intakeUnresolvedCount = offers.filter(offer => !latestByOffer.has(offer.offer_id)).length;
    return { ok: true, entryCount: entries.length, journalCount: journalEntries.length, eligibleOperationalCount: eligible.length, excludedFakeCount, missingSourceCount: missingSourceIds.length, edgeCount: edges.length, presentationCount: presentationRows.length, emissionCount: emissionRows.length, wildCount, eligibleWildCount, intakeOfferCount: offers.length, intakeHeldCount, intakeUnresolvedCount };
  } finally { world?.close(); forest.close(); op.close(); }
}
