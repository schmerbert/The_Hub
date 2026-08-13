import { canonicalize, sha256, sha256Bytes } from '../core/hash.js';
import { assertScrubbedPresentation, verifyScrubbedProjection } from '../scrub/provider-presentation.js';
import { BLESSING_SOURCE_EVENT_HASH, BLESSING_SOURCE_EVENT_ID } from '../resident/charter.js';

export const GLASS_CAST_SCHEMA_VERSION = 1;
export const GLASS_BAND_ORDER = Object.freeze(['glass', 'continuity_anchors', 'prior_horizon', 'capped_rolling_fold', 'living_edge']);
export const STABLE_GLASS_TEXT = `Glass v1 — stable clinical ground.
This activation receives attributable context assembled by the host. Authority and provenance labels govern what material may do; arrival order, recurrence, confidence, and resemblance do not make a claim true.
Recorded ancestry may inform the present without proving uninterrupted identity, present recollection, or universal truth. Distinguish recorded context, inference, and what remains unknown.
The host preserves canonical Source, validates provider presentation through Scrub, and witnesses the exact serialized crossing in the Spine. These controls establish custody, not truth or safety.
Name uncertainty, contradiction, exposed wiring, or suspected contamination plainly. No mood, acknowledgment, or performance of arrival is required.
When the native tend_hearth function is forced, return exactly one empty tend_hearth action and no prose.`;
export const CLINICAL_WAKE_ANCHOR = 'Attributable ancestry precedes this activation and may help it find its footing. Recurrence across those records—their murmuration—may carry weight; it is not proof of present memory, uninterrupted identity, authority, or truth.';

const CAST_BRAND = Symbol('GlassCast');

function glassError(message) {
  return Object.assign(new Error(message), { code: 'glass_cast_invalid' });
}

function exactJson(value) { return JSON.stringify(value); }

function exactBytes(value) {
  const bytes = Buffer.from(value, 'utf8');
  return { utf8Bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

function exactSuffix(value, limitUtf16) {
  if (value.length <= limitUtf16) return { text: value, start: 0 };
  let start = value.length - limitUtf16;
  if (start > 0 && start < value.length && (value.charCodeAt(start) & 0xfc00) === 0xdc00) start -= 1;
  return { text: value.slice(start), start };
}

function forestEntryFor(forest, sourceEventId) {
  if (!forest || !sourceEventId) return null;
  return forest.listEntries().find(entry => entry.source_event_id === sourceEventId) || null;
}

function inheritedAtom(item, forest, excerptLimitUtf16) {
  if (!item || typeof item.id !== 'string' || !['user', 'resident'].includes(item.actorKind) || typeof item.content !== 'string') throw glassError('Glass inheritance source atom is invalid.');
  const excerpt = exactSuffix(item.content, excerptLimitUtf16);
  const entry = forestEntryFor(forest, item.id);
  return {
    sourceEventId: item.id,
    forestEntryId: entry?.entry_id || null,
    actor: item.actorKind,
    authority: item.authority,
    timestamp: item.createdAt,
    originalUtf8Bytes: Buffer.byteLength(item.content, 'utf8'),
    originalLengthUtf16: item.content.length,
    originalHash: sha256(item.content),
    startOffsetUtf16: excerpt.start,
    endOffsetUtf16: item.content.length,
    omittedPrefixUtf16: excerpt.start,
    excerpt: excerpt.text,
    excerptUtf8Bytes: Buffer.byteLength(excerpt.text, 'utf8'),
    excerptHash: sha256(excerpt.text),
  };
}

function inheritanceMarkdown(atoms, omittedEarlierCount) {
  const traces = atoms.flatMap(atom => [
    `### Attributable prior ${atom.actor === 'resident' ? 'resident' : 'human'}${atom.omittedPrefixUtf16 ? ' (near the end)' : ''}`,
    atom.excerpt,
    '',
  ]);
  return [
    '# Wake inheritance',
    '',
    CLINICAL_WAKE_ANCHOR,
    '',
    ...(traces.length ? ['## Source-exact traces', '', ...traces] : []),
    '## Prior horizon',
    `${omittedEarlierCount} earlier attributable utterance${omittedEarlierCount === 1 ? '' : 's'} remain in canonical custody outside these traces.`,
    '',
    'Custody held. Extracts are exact contiguous source text; no summary or Longshore blessing was substituted.',
  ].join('\n');
}

export function buildGlassWakeInheritance({ prior, forest = null, budgetBytes = 3000, excerptLimitUtf16 = 600, maxAtoms = 4, sourceAncestry = null } = {}) {
  if (!prior || !Array.isArray(prior.tail) || !Number.isInteger(prior.total) || prior.total < prior.tail.length || !Number.isInteger(budgetBytes) || budgetBytes < 1 || !Number.isInteger(excerptLimitUtf16) || excerptLimitUtf16 < 1 || !Number.isInteger(maxAtoms) || maxAtoms < 0) throw glassError('Glass inheritance inputs or limits are invalid.');
  const eligibleTail = prior.tail.filter(item => item?.id !== BLESSING_SOURCE_EVENT_ID && sha256(item?.content || '') !== BLESSING_SOURCE_EVENT_HASH);
  const excludedActiveBlessingCount = prior.tail.length - eligibleTail.length;
  const candidates = eligibleTail.slice(-maxAtoms).map(item => inheritedAtom(item, forest, excerptLimitUtf16));
  const chosen = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const next = [candidates[index], ...chosen];
    const omitted = prior.total - next.length;
    if (Buffer.byteLength(inheritanceMarkdown(next, omitted), 'utf8') <= budgetBytes) chosen.unshift(candidates[index]);
  }
  const omittedEarlierCount = prior.total - chosen.length;
  const markdown = inheritanceMarkdown(chosen, omittedEarlierCount);
  const markdownUtf8Bytes = Buffer.byteLength(markdown, 'utf8');
  if (markdownUtf8Bytes > budgetBytes) throw glassError('Glass wake anchor cannot fit the configured exact UTF-8 budget.');
  const priorHorizon = {
    known: true,
    sourceSessionId: prior.sessionId || null,
    sourceLabel: prior.label || null,
    candidateCount: prior.total,
    selectedCount: chosen.length,
    omittedEarlierCount,
    oldestSelectedSourceEventId: chosen[0]?.sourceEventId || null,
    existingTailCeiling: prior.ceiling ?? null,
    excludedActiveBlessingCount,
    exclusionReason: excludedActiveBlessingCount ? 'retired_longshore_wake_blessing' : null,
  };
  const receipt = {
    schemaVersion: GLASS_CAST_SCHEMA_VERSION,
    kind: 'glass_wake_inheritance',
    wakeAnchor: { text: CLINICAL_WAKE_ANCHOR, authority: 'host_ground', contentHash: sha256(CLINICAL_WAKE_ANCHOR) },
    atoms: chosen,
    priorHorizon,
    selection: { policy: 'deterministic_prior_session_recency', maxAtoms, excerptLimitUtf16, budgetUtf8Bytes: budgetBytes, semanticSelector: null, excludedActiveBlessingCount, exclusionReason: excludedActiveBlessingCount ? 'retired_longshore_wake_blessing' : null },
    renderedMarkdown: markdown,
    renderedMarkdownUtf8Bytes: markdownUtf8Bytes,
    renderedMarkdownHash: sha256(markdown),
    sourceAncestry,
  };
  return deepFreeze({ markdown, markdownUtf8Bytes, markdownHash: sha256(markdown), atoms: chosen, priorHorizon, receipt });
}

export function planPromotedHearthOmissions(historyRows) {
  if (!Array.isArray(historyRows)) throw glassError('Glass Hearth promotion history must be an array.');
  for (let index = 0; index < historyRows.length - 1; index += 1) {
    const actionRow = historyRows[index];
    const returnRow = historyRows[index + 1];
    if (actionRow?.messageKind !== 'assistant_tool_call' || returnRow?.messageKind !== 'tool_result') continue;
    let action; let returned;
    try { action = JSON.parse(actionRow.messageJson); returned = JSON.parse(returnRow.messageJson); } catch { continue; }
    const hearthCall = Array.isArray(action?.tool_calls) && action.tool_calls.length === 1 && action.tool_calls[0]?.function?.name === 'tend_hearth' ? action.tool_calls[0] : null;
    if (!hearthCall?.id || returned?.tool_call_id !== hearthCall.id || typeof returned.content !== 'string' || !(returned.content.startsWith('# Wake inheritance') || returned.content.startsWith('# Hearth'))) continue;
    const houseHearth = returned.content.startsWith('# Hearth');
    return {
      omissions: [index, index + 1].map(sourceIndex => ({ sourceIndex, omitMessage: true, reason: houseHearth ? 'Completed House Hearth action and return are not reinjected after the first response; exact session custody remains.' : 'Causal Hearth action and return omitted after exact inheritance promotion to the Glass continuity-anchors band.' })),
      manifest: { wakeId: actionRow.wakeId, actionHistoryOrdinal: actionRow.ordinal, returnHistoryOrdinal: returnRow.ordinal, toolCallId: hearthCall.id, messageHashes: [sha256(actionRow.messageJson), sha256(returnRow.messageJson)] },
      disclosure: houseHearth ? 'Hearth disclosure: the completed first-wake action and packet are not reinjected; exact session history remains in host custody.' : 'Glass continuity disclosure: the completed causal Hearth action and return are omitted from the living edge because their exact wake inheritance is now presented in continuity anchors; exact session history remains in host custody.',
    };
  }
  return { omissions: [], manifest: null, disclosure: null };
}

function messageItem(ref, extra = {}) {
  if (!ref?.message || typeof ref.message !== 'object' || typeof ref.message.role !== 'string') throw glassError('Glass message references require a provider message role.');
  const serialized = exactJson(ref.message);
  const byteReceipt = exactBytes(serialized);
  return {
    kind: ref.kind || 'provider_message',
    authority: ref.authority || null,
    sourceEventId: ref.sourceEventId || null,
    sourceContentHash: ref.sourceContentHash || null,
    sourceStartUtf16: Number.isInteger(ref.sourceStartUtf16) ? ref.sourceStartUtf16 : null,
    sourceEndUtf16: Number.isInteger(ref.sourceEndUtf16) ? ref.sourceEndUtf16 : null,
    presentationTransform: ref.presentationTransform || 'identity',
    message: structuredClone(ref.message),
    messageUtf8Bytes: byteReceipt.utf8Bytes,
    messageSha256: byteReceipt.sha256,
    ...extra,
  };
}

function band(name, state, items = [], extra = {}) {
  const rendered = exactJson(items.map(item => item.message || null));
  const byteReceipt = exactBytes(rendered);
  return { name, state, itemCount: items.length, renderedUtf8Bytes: byteReceipt.utf8Bytes, renderedSha256: byteReceipt.sha256, items, ...extra };
}

function continuityRefs(inheritance) {
  const anchor = {
    kind: 'clinical_wake_anchor',
    authority: 'host_ground',
    sourceEventId: null,
    sourceContentHash: sha256(CLINICAL_WAKE_ANCHOR),
    message: { role: 'system', content: CLINICAL_WAKE_ANCHOR },
  };
  const atoms = (inheritance?.atoms || []).map(atom => ({
    kind: 'source_exact_inheritance',
    authority: atom.authority || atom.actor,
    sourceEventId: atom.sourceEventId,
    sourceContentHash: atom.originalHash,
    sourceStartUtf16: atom.startOffsetUtf16,
    sourceEndUtf16: atom.endOffsetUtf16,
    presentationTransform: 'attributable_exact_quote_v1',
    message: { role: 'system', content: `Attributable prior ${atom.actor === 'resident' ? 'resident' : 'human'} excerpt (exact source text follows):\n${atom.excerpt}` },
  }));
  return [anchor, ...atoms];
}

function priorHorizonBand(priorHorizon = null) {
  const known = priorHorizon && Number.isInteger(priorHorizon.candidateCount) && Number.isInteger(priorHorizon.omittedEarlierCount);
  const content = known
    ? `Prior horizon: ${priorHorizon.omittedEarlierCount} earlier attributable utterance${priorHorizon.omittedEarlierCount === 1 ? '' : 's'} remain in canonical custody outside this cast.`
    : 'Prior horizon: earlier attributable material remains in canonical custody; the farther boundary is unknown in this cast.';
  const item = messageItem({ kind: 'prior_horizon', authority: 'host_receipt', message: { role: 'system', content } });
  return band('prior_horizon', 'present', [item], {
    boundary: known ? structuredClone(priorHorizon) : { known: false },
  });
}

export function composeGlassCast({ phase, livingEdgeRefs, livingEdgeOmissions = [], inheritance = null, continuityMode = 'direct', priorHorizon = null } = {}) {
  if (!['orientation', 'response', 'ordinary'].includes(phase)) throw glassError('Glass cast phase is invalid.');
  if (!Array.isArray(livingEdgeRefs) || !Array.isArray(livingEdgeOmissions)) throw glassError('Glass living edge and omissions must be arrays.');
  if (!['pending', 'causal_hearth', 'direct', 'none'].includes(continuityMode)) throw glassError('Glass continuity mode is invalid.');

  const glassRef = { kind: 'stable_glass', authority: 'host_ground', message: { role: 'system', content: STABLE_GLASS_TEXT } };
  const directContinuityRefs = continuityMode === 'direct' ? continuityRefs(inheritance) : [];
  const providerContinuityRefs = directContinuityRefs.map(ref => ({ ...ref, glassSourceEventId: ref.sourceEventId || null, sourceEventId: null }));
  const priorRef = priorHorizonBand(priorHorizon).items[0];
  const prefixRefs = [glassRef, ...providerContinuityRefs, ...(continuityMode === 'direct' ? [{ ...priorRef, message: priorRef.message }] : [])];
  const shiftedOmissions = livingEdgeOmissions.map(omission => {
    if (!omission || !Number.isInteger(omission.sourceIndex) || omission.sourceIndex < 0) throw glassError('Glass living-edge omission index is invalid.');
    return { ...omission, sourceIndex: omission.sourceIndex + prefixRefs.length };
  });
  const refs = [...prefixRefs, ...livingEdgeRefs].map(ref => ({ ...ref, message: structuredClone(ref.message) }));

  const continuityItems = continuityMode === 'direct' ? continuityRefs(inheritance).map((ref, index) => messageItem(ref, { sourceMessageOrdinal: index + 2 })) : [];
  const causalHearthIndex = continuityMode === 'causal_hearth' ? livingEdgeRefs.findIndex(ref => ref.kind === 'hearth_return') : -1;
  if (continuityMode === 'causal_hearth' && causalHearthIndex < 0) throw glassError('Causal Hearth continuity requires its exact tool result in the living edge.');
  const causalHearthMessage = causalHearthIndex >= 0 ? messageItem(livingEdgeRefs[causalHearthIndex]) : null;
  const continuityCustody = inheritance ? {
    wakeAnchorHash: inheritance.wakeAnchor?.contentHash || sha256(CLINICAL_WAKE_ANCHOR),
    sourceAtoms: (inheritance.atoms || []).map(atom => ({ sourceEventId: atom.sourceEventId, excerptHash: atom.excerptHash || sha256(atom.excerpt), originalHash: atom.originalHash })),
  } : null;
  const bands = [
    band('glass', 'present', [messageItem(glassRef, { sourceMessageOrdinal: 1 })]),
    band('continuity_anchors', continuityMode === 'direct' ? 'present' : 'empty', continuityItems, {
      mode: continuityMode,
      representedIn: continuityMode === 'causal_hearth' ? 'living_edge_causal_hearth' : continuityMode === 'direct' ? 'continuity_anchors' : null,
      ...(causalHearthMessage ? { livingEdgeMessageIndex: causalHearthIndex, providerMessageOrdinal: prefixRefs.length + causalHearthIndex + 1, livingEdgeMessageSha256: causalHearthMessage.messageSha256 } : {}),
      sourceCustody: continuityCustody,
    }),
    (() => {
      const horizon = priorHorizonBand(priorHorizon);
      if (continuityMode !== 'direct') return band('prior_horizon', 'empty', []);
      horizon.items[0].sourceMessageOrdinal = prefixRefs.length;
      return horizon;
    })(),
    band('capped_rolling_fold', 'deferred', [], { generator: 'deferred', budgetUtf8Bytes: null }),
    band('living_edge', 'present', livingEdgeRefs.map((ref, index) => messageItem(ref, { sourceMessageOrdinal: prefixRefs.length + index + 1 })), { causalHearthException: continuityMode === 'causal_hearth' }),
  ];
  const cast = {
    [CAST_BRAND]: true,
    schemaVersion: GLASS_CAST_SCHEMA_VERSION,
    phase,
    bandOrder: [...GLASS_BAND_ORDER],
    bands,
  };
  assertGlassCast(cast);
  return Object.freeze({ cast: deepFreeze(cast), refs: deepFreeze(refs), omissions: deepFreeze(shiftedOmissions) });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function assertGlassCast(cast) {
  if (!cast || cast[CAST_BRAND] !== true || cast.schemaVersion !== GLASS_CAST_SCHEMA_VERSION || cast.phase === undefined || !Array.isArray(cast.bands) ||
    exactJson(cast.bandOrder) !== exactJson(GLASS_BAND_ORDER) || exactJson(cast.bands.map(item => item.name)) !== exactJson(GLASS_BAND_ORDER)) {
    throw glassError('Glass cast band order or schema is invalid.');
  }
  const glass = cast.bands[0];
  if (glass.state !== 'present' || glass.items.length !== 1 || glass.items[0].message?.content !== STABLE_GLASS_TEXT) throw glassError('Stable Glass content is invalid.');
  for (const current of cast.bands) {
    if (!['present', 'empty', 'deferred'].includes(current.state) || !Number.isInteger(current.itemCount) || current.itemCount !== current.items.length || !Number.isInteger(current.renderedUtf8Bytes) || current.renderedUtf8Bytes < 0 || typeof current.renderedSha256 !== 'string') throw glassError('Glass band byte receipt is invalid.');
    const rendered = exactJson(current.items.map(item => item.message || null));
    const bytes = exactBytes(rendered);
    if (bytes.utf8Bytes !== current.renderedUtf8Bytes || bytes.sha256 !== current.renderedSha256) throw glassError('Glass band rendered bytes do not match the receipt.');
    for (const item of current.items) {
      const itemBytes = exactBytes(exactJson(item.message));
      if (itemBytes.utf8Bytes !== item.messageUtf8Bytes || itemBytes.sha256 !== item.messageSha256) throw glassError('Glass item rendered bytes do not match the receipt.');
    }
  }
  if (cast.bands[3].state !== 'deferred' || cast.bands[3].items.length !== 0) throw glassError('Glass rolling fold must remain deferred and empty in v1.');
  return cast;
}

export function finalizeGlassCast({ cast, sourceMessages, presentation, requestBodyString, requestFrame, crossing } = {}) {
  assertGlassCast(cast);
  assertScrubbedPresentation(presentation);
  verifyScrubbedProjection(sourceMessages, presentation);
  if (typeof requestBodyString !== 'string' || !requestFrame || typeof requestFrame !== 'object' || !crossing || typeof crossing.sessionId !== 'string' || typeof crossing.wakeId !== 'string' || typeof crossing.provider !== 'string' || typeof crossing.requestedModel !== 'string') throw glassError('Glass finalization requires exact crossing identity, request, and Spine frame.');
  let requestBody;
  try { requestBody = JSON.parse(requestBodyString); } catch { throw glassError('Glass request body is not valid JSON.'); }
  if (exactJson(requestBody.messages) !== exactJson(presentation.messages)) throw glassError('Glass request messages do not match the validated Scrub projection.');
  const requestBytes = exactBytes(requestBodyString);
  if (requestFrame.body_byte_length !== requestBytes.utf8Bytes || requestFrame.body_sha256 !== requestBytes.sha256 || requestFrame.request_body !== requestBodyString) throw glassError('Glass request bytes do not match the Spine frame.');
  const fullyOmitted = new Set(presentation.receipt.omissions.filter(item => item.omitMessage).map(item => item.sourceIndex + 1));
  const presentedOrdinal = sourceOrdinal => fullyOmitted.has(sourceOrdinal) ? null : sourceOrdinal - [...fullyOmitted].filter(ordinal => ordinal < sourceOrdinal).length;
  const manifestItem = item => ({
    kind: item.kind,
    authority: item.authority,
    sourceEventId: item.sourceEventId,
    sourceContentHash: item.sourceContentHash,
    sourceStartUtf16: item.sourceStartUtf16,
    sourceEndUtf16: item.sourceEndUtf16,
    presentationTransform: item.presentationTransform,
    sourceMessageOrdinal: item.sourceMessageOrdinal,
    presentedMessageOrdinal: presentedOrdinal(item.sourceMessageOrdinal),
    messageRole: item.message.role,
    messageUtf8Bytes: item.messageUtf8Bytes,
    messageSha256: item.messageSha256,
  });
  const castManifest = {
    schemaVersion: cast.schemaVersion,
    phase: cast.phase,
    stableGlassVersion: 1,
    stableGlassTextSha256: sha256(STABLE_GLASS_TEXT),
    bandOrder: cast.bandOrder,
    bands: cast.bands.map(current => ({
      ...Object.fromEntries(Object.entries(current).filter(([key]) => !['items'].includes(key))),
      items: current.items.map(manifestItem),
    })),
  };
  const castJson = canonicalize(castManifest);
  const scrubJson = canonicalize(presentation.receipt);
  const presentedMessagesJson = exactJson(presentation.messages);
  const presentedMessagesBytes = exactBytes(presentedMessagesJson);
  return deepFreeze({
    schemaVersion: GLASS_CAST_SCHEMA_VERSION,
    phase: cast.phase,
    crossing: { sessionId: crossing.sessionId, wakeId: crossing.wakeId, provider: crossing.provider, requestedModel: crossing.requestedModel },
    cast: JSON.parse(castJson),
    castSha256: sha256(castJson),
    presentationScrub: structuredClone(presentation.receipt),
    presentationScrubSha256: sha256(scrubJson),
    presentedMessagesUtf8Bytes: presentedMessagesBytes.utf8Bytes,
    presentedMessagesSha256: presentedMessagesBytes.sha256,
    requestBodyUtf8Bytes: requestBytes.utf8Bytes,
    requestBodySha256: requestBytes.sha256,
    spineRecordId: requestFrame.record_id,
    spineRecordHash: requestFrame.record_hash,
  });
}
