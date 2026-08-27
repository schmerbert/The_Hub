import { canonicalize, sha256 } from '../core/hash.js';

// The first Forest selector is deliberately small and replaceable. It is a
// shadow witness, so its output must be useful to inspect without becoming a
// provider-facing context builder.
export const SEMANTIC_FOREST_EXHALE_POLICY_VERSION = 'semantic_forest_exhale_shadow/v2';
export const SEMANTIC_FOREST_EXHALE_SELECTOR_VERSION = 'lexical_anchor/v2';
export const SEMANTIC_FOREST_EXHALE_PHASE = 'human_admission';
export const SEMANTIC_FOREST_EXHALE_MAX_ATOMS = 2;
export const SEMANTIC_FOREST_EXHALE_MAX_CANDIDATES = 64;
export const SEMANTIC_FOREST_EXHALE_MAX_EXCLUSIONS = 128;
export const SEMANTIC_FOREST_EXHALE_MAX_ATOM_BYTES = 1000;
export const SEMANTIC_FOREST_EXHALE_MAX_PACKET_BYTES = 1800;

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'just', 'like', 'may', 'me', 'more', 'most', 'my', 'no', 'of', 'on',
  'or', 'our', 'out', 'over', 'she', 'should', 'so', 'some', 'than', 'that', 'the', 'their',
  'there', 'these', 'they', 'this', 'to', 'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  'answer', 'dont', 'good', 'looking', 'not', 'quite', 'test', 'think', 'wonderful',
]);

function error(code, message) { return Object.assign(new Error(message), { code }); }

function normalizeToken(token) {
  return String(token || '').normalize('NFKC').toLocaleLowerCase('en-US');
}

function rawTokens(text) {
  if (typeof text !== 'string') return [];
  const matches = text.normalize('NFKC').match(/[$#]?[\p{L}\p{N}]+(?:[._/-][\p{L}\p{N}]+)*/gu) || [];
  return matches.map(raw => ({ raw, normalized: normalizeToken(raw) }));
}

function meaningfulToken(token) {
  const normalized = token.normalized.replace(/^[$#]/, '');
  return Boolean(normalized) && (token.normalized.startsWith('$') || normalized.length >= 3) && !STOP_WORDS.has(normalized);
}

function termsFor(text) {
  const all = rawTokens(text);
  const seen = new Set();
  return all.filter(meaningfulToken).filter(token => {
    const key = token.normalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function focusTermsFor(text) {
  const clauses = String(text || '').split(/[\r\n]+|(?<=[.!?])\s+/u).map(value => value.trim()).filter(Boolean);
  const focused = [...clauses].reverse().find(clause => /\b(?:what|who|where)\s+(?:is|are|was|were)\b|\b(?:tell|remind)\s+me\s+about\b/iu.test(clause));
  return { terms: termsFor(focused || text), explicit: Boolean(focused) };
}

function tokenSet(text) { return new Set(rawTokens(text).map(token => token.normalized)); }

function roomSignalTokens(roomSignals = {}) {
  const values = [roomSignals.roomId, roomSignals.roomType, roomSignals.engagedFixtureId].filter(Boolean).join(' ');
  return termsFor(values).map(item => item.normalized);
}

function bodyHashMatches(entry) {
  return typeof entry?.body === 'string' && typeof entry?.bodyHash === 'string' && sha256(entry.body) === entry.bodyHash;
}

function sourceHashValid(entry) {
  return typeof entry?.sourceEventHash === 'string' && /^[a-f0-9]{64}$/i.test(entry.sourceEventHash);
}

function entryIdentity(entry) {
  return {
    entryId: entry.entryId || entry.entry_id,
    sourceEventId: entry.sourceEventId || entry.source_event_id,
    sourceEventHash: entry.sourceEventHash || entry.source_event_hash,
    bodyHash: entry.bodyHash || entry.body_hash,
    sourceTimestamp: entry.sourceTimestamp || entry.source_timestamp,
    threadId: entry.threadId || entry.thread_id,
    wakeId: entry.wakeId || entry.wake_id || null,
    actorKind: entry.actorKind || entry.actor_kind,
    jurisdiction: entry.jurisdiction,
    bucket: entry.bucket,
    chronology: entry.chronology ? structuredClone(entry.chronology) : null,
    supersession: entry.supersession ? structuredClone(entry.supersession) : { supported: false },
  };
}

function candidateRecord(entry, score, matchedTerms, roomMatches) {
  const identity = entryIdentity(entry);
  return {
    ...identity,
    body: entry.body,
    score,
    matchedTerms,
    roomMatches,
  };
}

function compareCandidates(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  const leftTime = left.sourceTimestamp || '';
  const rightTime = right.sourceTimestamp || '';
  if (rightTime !== leftTime) return rightTime.localeCompare(leftTime);
  return String(left.entryId).localeCompare(String(right.entryId));
}

function similarity(left, right) {
  const a = tokenSet(left); const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function exactSpan(body, preferredTerms, maxBytes) {
  const lowered = body.toLocaleLowerCase('en-US');
  const positions = preferredTerms.map(term => lowered.indexOf(term)).filter(index => index >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  let start = body.lastIndexOf('\n\n', hit);
  start = start < 0 ? 0 : start + 2;
  let end = body.indexOf('\n\n', hit);
  end = end < 0 ? body.length : end;
  while (start < end && /\s/u.test(body[start])) start += 1;
  while (end > start && /\s/u.test(body[end - 1])) end -= 1;
  if (Buffer.byteLength(body.slice(start, end), 'utf8') > maxBytes) {
    const codepoints = [...body]; const utf16Starts = []; let offset = 0;
    for (const point of codepoints) { utf16Starts.push(offset); offset += point.length; }
    const hitPoint = Math.max(0, utf16Starts.findIndex(value => value >= hit));
    let left = hitPoint; let right = Math.min(codepoints.length, hitPoint + 1);
    while (left > 0 || right < codepoints.length) {
      const expandLeft = left > 0 ? body.slice(utf16Starts[left - 1], utf16Starts[right] ?? body.length) : null;
      const expandRight = right < codepoints.length ? body.slice(utf16Starts[left], utf16Starts[right + 1] ?? body.length) : null;
      if (expandLeft !== null && Buffer.byteLength(expandLeft, 'utf8') <= maxBytes) left -= 1;
      else if (expandRight !== null && Buffer.byteLength(expandRight, 'utf8') <= maxBytes) right += 1;
      else break;
    }
    start = utf16Starts[left] ?? 0; end = utf16Starts[right] ?? body.length;
  }
  const exactText = body.slice(start, end);
  return { exactText, span: { startUtf16: start, endUtf16: end, startByte: Buffer.byteLength(body.slice(0, start), 'utf8'), endByte: Buffer.byteLength(body.slice(0, end), 'utf8') } };
}

function bounded(list, limit) { return Array.isArray(list) ? list.slice(0, limit) : []; }

export function extractSemanticQueryTerms(text) {
  return termsFor(text).map(token => token.normalized);
}

export function buildSemanticRoomSignals({ roomId = null, roomType = null, engagedFixtureId = null } = {}) {
  return {
    roomId: roomId || null,
    roomType: roomType || null,
    engagedFixtureId: engagedFixtureId || null,
    relevanceOnly: true,
    relevanceTerms: roomSignalTokens({ roomId, roomType, engagedFixtureId }),
  };
}

export function selectSemanticForestAtoms({ utterance, entries = [], excludedSourceEventIds = [], excludedEntryIds = [], roomSignals = {}, candidateBoundary = null, maxAtoms = SEMANTIC_FOREST_EXHALE_MAX_ATOMS, maxCandidates = SEMANTIC_FOREST_EXHALE_MAX_CANDIDATES, maxExclusions = SEMANTIC_FOREST_EXHALE_MAX_EXCLUSIONS } = {}) {
  if (typeof utterance !== 'string' || !utterance.trim()) throw error('semantic_exhale_invalid', 'Semantic Forest selection requires the triggering utterance.');
  if (!Array.isArray(entries)) throw error('semantic_exhale_invalid', 'Semantic Forest selection requires a candidate array.');
  const queryTerms = termsFor(utterance);
  const focus = focusTermsFor(utterance);
  const focusTerms = focus.terms;
  const focusSet = new Set(focusTerms.map(term => term.normalized));
  const totalEligibleCount = candidateBoundary?.totalEligibleCount || entries.length;
  const corpusFrequenciesAvailable = Boolean(candidateBoundary?.termDocumentFrequencies);
  const frequencies = candidateBoundary?.termDocumentFrequencies || Object.fromEntries(queryTerms.map(term => [term.normalized, entries.filter(entry => tokenSet(entry.body).has(term.normalized)).length]));
  const rareLimit = Math.max(8, Math.ceil(totalEligibleCount * 0.02));
  const explicitAnchorLimit = Math.max(32, Math.ceil(totalEligibleCount * 0.1));
  const anchorTerms = focusTerms.filter(term => term.raw.startsWith('$') || (corpusFrequenciesAvailable && (
    (frequencies[term.normalized] ?? totalEligibleCount) <= rareLimit ||
    (focus.explicit && (frequencies[term.normalized] ?? 0) > 0 && (frequencies[term.normalized] ?? totalEligibleCount) <= explicitAnchorLimit)
  )));
  const roomTerms = roomSignalTokens(roomSignals);
  const excludedSources = new Set(excludedSourceEventIds.filter(Boolean));
  const excludedEntries = new Set(excludedEntryIds.filter(Boolean));
  const exclusions = [];
  const candidates = [];
  const seenEntries = new Set();
  const addExclusion = (entry, reason, detail = null) => {
    if (exclusions.length >= maxExclusions) return;
    const identity = entryIdentity(entry);
    exclusions.push({ ...identity, reason, ...(detail ? { detail } : {}) });
  };

  for (const entry of entries) {
    const identity = entryIdentity(entry);
    if (!identity.entryId || seenEntries.has(identity.entryId)) { addExclusion(entry, 'duplicate_entry'); continue; }
    seenEntries.add(identity.entryId);
    if (identity.jurisdiction !== 'home' || identity.bucket !== 'utterance') { addExclusion(entry, 'wrong_jurisdiction'); continue; }
    if (excludedSources.has(identity.sourceEventId)) { addExclusion(entry, 'active_context'); continue; }
    if (excludedEntries.has(identity.entryId)) { addExclusion(entry, 'active_context'); continue; }
    if (!bodyHashMatches({ ...entry, bodyHash: identity.bodyHash })) { addExclusion(entry, 'body_integrity'); continue; }
    if (!sourceHashValid({ ...entry, sourceEventHash: identity.sourceEventHash })) { addExclusion(entry, 'source_integrity'); continue; }
    if (!queryTerms.length) { addExclusion(entry, 'weak_query'); continue; }
    const candidateTokens = tokenSet(entry.body);
    const matchedTerms = queryTerms.filter(term => candidateTokens.has(term.normalized)).map(term => term.normalized);
    const roomMatches = roomTerms.filter(term => candidateTokens.has(term));
    if (!matchedTerms.length) { addExclusion(entry, 'no_lexical_match'); continue; }
    const matchedAnchors = anchorTerms.filter(term => candidateTokens.has(term.normalized)).map(term => term.normalized);
    if (anchorTerms.length && !matchedAnchors.length) { addExclusion(entry, 'anchor_mismatch', { required: anchorTerms.map(term => term.normalized) }); continue; }
    const entityMatches = queryTerms.filter(term => term.raw.startsWith('$') && candidateTokens.has(term.normalized)).length;
    const lexicalScore = matchedTerms.reduce((sum, term) => {
      const rarity = Math.log2((totalEligibleCount + 1) / ((frequencies[term] ?? totalEligibleCount) + 1)) + 1;
      return sum + rarity * (focus.explicit && !focusSet.has(term) ? 0.15 : 1);
    }, 0);
    const bodyTokens = rawTokens(entry.body).map(token => token.normalized);
    const anchorOccurrences = bodyTokens.filter(token => matchedAnchors.includes(token)).length;
    const anchorConcentration = anchorOccurrences ? 20 / Math.sqrt(Math.max(1, bodyTokens.length)) : 0;
    const sourceAttribution = identity.actorKind === 'user' ? 0.75 : 0;
    const score = lexicalScore + matchedAnchors.length * 6 + anchorConcentration + sourceAttribution + entityMatches * 3 + (roomMatches.length * 0.05) + (matchedTerms.length === queryTerms.length ? 0.5 : 0);
    candidates.push({ ...candidateRecord(entry, score, matchedTerms, roomMatches), matchedAnchors });
  }

  candidates.sort(compareCandidates);
  const boundedCandidates = bounded(candidates, maxCandidates);
  const selected = [];
  let silenceReason = null;
  if (!queryTerms.length) silenceReason = 'weak_query';
  else if (!boundedCandidates.length) silenceReason = 'no_relevant_home_atom';
  else {
    const top = boundedCandidates[0];
    const tie = boundedCandidates.filter(candidate => candidate.score === top.score);
    // A single generic-looking hit is useful; a tied pair with no
    // distinguishing term is not evidence strong enough to breathe.
    if (tie.length > 1 && queryTerms.length === 1 && !queryTerms[0].raw.startsWith('$') && !anchorTerms.length) silenceReason = 'ambiguous_match';
    else {
      for (const candidate of boundedCandidates) {
        if (selected.some(prior => similarity(prior.body, candidate.body) >= 0.8)) { addExclusion(candidate, 'near_duplicate'); continue; }
        selected.push(candidate);
        if (selected.length >= Math.max(0, Math.min(maxAtoms, SEMANTIC_FOREST_EXHALE_MAX_ATOMS))) break;
      }
    }
  }
  if (silenceReason) {
    for (const candidate of boundedCandidates) addExclusion(candidate, silenceReason);
  }
  return {
    query: { terms: queryTerms.map(term => term.normalized), focusTerms: focusTerms.map(term => term.normalized), anchorTerms: anchorTerms.map(term => term.normalized), termDocumentFrequencies: frequencies, termCount: queryTerms.length },
    candidates: boundedCandidates,
    exclusions: bounded(exclusions, maxExclusions),
    selected,
    silenceReason,
    selectorVersion: SEMANTIC_FOREST_EXHALE_SELECTOR_VERSION,
    policyVersion: SEMANTIC_FOREST_EXHALE_POLICY_VERSION,
    roomSignals: structuredClone(roomSignals),
  };
}

export function buildSemanticForestPacket(selection) {
  if (!selection || typeof selection !== 'object') throw error('semantic_exhale_invalid', 'Semantic Forest packet selection is required.');
  let remainingBytes = SEMANTIC_FOREST_EXHALE_MAX_PACKET_BYTES;
  const atoms = bounded(selection.selected, SEMANTIC_FOREST_EXHALE_MAX_ATOMS).flatMap(candidate => {
    const body = candidate.body;
    if (typeof body !== 'string' || !body.length) throw error('semantic_exhale_invalid', 'Selected Forest atoms require exact source text.');
    const maximum = Math.min(SEMANTIC_FOREST_EXHALE_MAX_ATOM_BYTES, remainingBytes);
    if (maximum < 64) return [];
    const extracted = exactSpan(body, candidate.matchedAnchors?.length ? candidate.matchedAnchors : candidate.matchedTerms, maximum);
    remainingBytes -= Buffer.byteLength(extracted.exactText, 'utf8');
    return [{
      entryId: candidate.entryId,
      sourceEventId: candidate.sourceEventId,
      sourceEventHash: candidate.sourceEventHash,
      sourceBodyHash: candidate.bodyHash,
      bodyHash: sha256(extracted.exactText),
      sourceTimestamp: candidate.sourceTimestamp,
      actorKind: candidate.actorKind,
      span: extracted.span,
      exactText: extracted.exactText,
    }];
  });
  return {
    schemaVersion: 1,
    kind: 'semantic_forest_exhale',
    heading: 'A breath from the Forest',
    atoms,
    silence: atoms.length === 0,
    silenceReason: atoms.length ? null : selection.silenceReason || 'no_relevant_home_atom',
    custody: { exact: true, rawBody: false, generatedSummary: false, actionAuthority: false, respiration: 'prohibited', forestExhaleEligible: false, providerVisible: false },
  };
}

export function runSemanticForestShadow({ forest, utterance, trigger, activeSourceEventIds = [], roomSignals = {}, maxAtoms = SEMANTIC_FOREST_EXHALE_MAX_ATOMS } = {}) {
  if (!forest || typeof forest !== 'object') return { bypassed: true, reason: 'forest_unavailable' };
  const queryTerms = extractSemanticQueryTerms(utterance);
  const homeSurface = typeof forest.searchEligibleHomeAtoms === 'function' && queryTerms.length
    ? forest.searchEligibleHomeAtoms({ queryTerms, excludeSourceEventIds: activeSourceEventIds, includeExclusions: true })
    : typeof forest.listEligibleHomeAtoms === 'function'
    ? forest.listEligibleHomeAtoms({ includeExclusions: true })
    : null;
  const entries = Array.isArray(homeSurface)
    ? homeSurface
    : homeSurface?.entries || (typeof forest.listEntries === 'function' ? forest.listEntries() : []);
  const boundaryExclusions = Array.isArray(homeSurface?.exclusions) ? homeSurface.exclusions : [];
  const candidateBoundary = homeSurface?.boundary || { order: 'unknown', maxEntries: entries.length, totalEligibleCount: entries.length, examinedCount: entries.length, complete: true };
  const selection = selectSemanticForestAtoms({ utterance, entries, excludedSourceEventIds: activeSourceEventIds, roomSignals, candidateBoundary, maxAtoms });
  const byId = new Map(entries.map(entry => [entry.entryId || entry.entry_id, entry]));
  selection.selected = selection.selected.map(candidate => ({ ...candidate, body: byId.get(candidate.entryId)?.body || '' }));
  selection.candidates = selection.candidates.map(({ body, ...candidate }) => candidate);
  selection.exclusions = bounded([...boundaryExclusions, ...selection.exclusions], SEMANTIC_FOREST_EXHALE_MAX_EXCLUSIONS);
  const packet = buildSemanticForestPacket(selection);
  const triggerPayload = {
    sessionId: trigger?.sessionId || null,
    wakeId: trigger?.wakeId || null,
    sourceEventId: trigger?.sourceEventId || null,
    sourceEventHash: trigger?.sourceEventHash || null,
    contentHash: trigger?.contentHash || sha256(utterance),
    threadId: trigger?.threadId || null,
    turnOrdinal: trigger?.turnOrdinal || null,
    sourceTimestamp: trigger?.sourceTimestamp || null,
  };
  const decision = {
    schemaVersion: 1,
    kind: 'attention_exposure',
    exposureKind: 'semantic_forest_shadow',
    disposition: 'shadowed',
    policyVersion: SEMANTIC_FOREST_EXHALE_POLICY_VERSION,
    selectorVersion: SEMANTIC_FOREST_EXHALE_SELECTOR_VERSION,
    phase: SEMANTIC_FOREST_EXHALE_PHASE,
    trigger: triggerPayload,
    roomSignals: structuredClone(roomSignals),
    query: selection.query,
    candidateBoundary: structuredClone(candidateBoundary),
    candidates: selection.candidates,
    exclusions: selection.exclusions,
    selectedAtoms: packet.atoms,
    packet,
    packetHash: sha256(canonicalize(packet)),
    custody: { respiration: 'prohibited', forestExhaleEligible: false, providerVisible: false, glass: false, scrub: false, spine: false },
  };
  return { bypassed: false, decision, packet, selection };
}

export function renderAmbientFeatherPacket(packet) {
  if (!packet?.atoms?.length) return null;
  return [
    packet.transientLanding ? '# Passing birds in this clearing' : '# A breath from the Forest',
    ...(packet.transientLanding ? ['', 'These distant bearings were selected for this human turn. They may change or depart on the next turn. They are not predictions, fixed signs, or local paths; choosing one with walk_toward makes the path.'] : []),
    ...packet.atoms.flatMap(atom => [
      '',
      `${atom.actorKind === 'resident' ? 'Earlier Resident' : 'Earlier Human'} — surfaced with this turn:`,
      `> ${atom.exactText}`,
      `Bearing: Forest entry ${atom.bearing.entryId}${atom.bearing.offerId ? `; passing offer ${atom.bearing.offerId}` : ''}${atom.sourceTimestamp ? `, ${atom.sourceTimestamp}` : ''}${atom.bearing.unreadBeyondPreview ? ' (more remains beyond this glint)' : ''}.`,
    ]),
  ].join('\n');
}

export async function runAmbientFeatherShadow({ service, utterance, trigger, activeSourceEventIds = [], excludeEntryIds = [], forestWalk = null, roomSignals = {}, firstTurn = false } = {}) {
  if (!service) return { bypassed: true, reason: 'ambient_feather_service_unavailable' };
  const selected = await service.select({ utterance, activeSourceEventIds, excludeEntryIds, firstTurn });
  const atoms = (selected.feathers || []).map(atom => forestWalk?.active ? {
    ...atom,
    bearing: {
      ...atom.bearing,
      kind: 'passing_feather',
      offerId: `forest_feather_${sha256(canonicalize({ journeyId:forestWalk.journeyId, junctionId:forestWalk.junctionId, wakeId:trigger.wakeId, entryId:atom.entryId }))}`,
    },
  } : atom);
  const packet = {
    schemaVersion: 1, kind: 'semantic_forest_exhale', heading: forestWalk?.active ? 'Passing birds in this clearing' : 'A breath from the Forest', atoms,
    ...(forestWalk?.active ? { transientLanding:true } : {}),
    silence: atoms.length === 0, silenceReason: atoms.length ? null : selected.silenceReason || 'no_ambient_feather',
    custody: { exact: true, rawBody: false, generatedSummary: false, actionAuthority: false, respiration: 'prohibited', forestExhaleEligible: false, providerVisible: atoms.length > 0 },
  };
  const triggerPayload = {
    sessionId: trigger?.sessionId || null, wakeId: trigger?.wakeId || null,
    sourceEventId: trigger?.sourceEventId || null, sourceEventHash: trigger?.sourceEventHash || null,
    contentHash: trigger?.contentHash || sha256(utterance), threadId: trigger?.threadId || null,
    turnOrdinal: trigger?.turnOrdinal || null, sourceTimestamp: trigger?.sourceTimestamp || null,
  };
  const policyVersion = 'semantic_forest_exhale_shadow/v4';
  const selectorVersion = 'ambient_vector_feathers/v2';
  const shadowPacket = structuredClone(packet);
  shadowPacket.custody.providerVisible = false;
  const decision = {
    schemaVersion: 1, kind: 'attention_exposure', exposureKind: 'semantic_forest_shadow', disposition: 'shadowed',
    policyVersion, selectorVersion, phase: SEMANTIC_FOREST_EXHALE_PHASE, trigger: triggerPayload,
    roomSignals: structuredClone(roomSignals), query: { kind: 'embedding', generationId: selected.generationId },
    candidateBoundary: { kind: 'derived_semantic_index', generationId: selected.generationId, returnedCount: selected.candidates.length, complete: false },
    candidates: selected.candidates, exclusions: selected.exclusions || [], selectedAtoms: atoms, packet: shadowPacket,
    packetHash: sha256(canonicalize(shadowPacket)),
    custody: { respiration: 'prohibited', forestExhaleEligible: false, providerVisible: false, glass: false, scrub: false, spine: false },
  };
  return { bypassed: false, decision, packet, selection: selected };
}

export function renderDepartedFeatherFootprint(departures) {
  if (!Array.isArray(departures) || departures.length === 0) return null;
  return 'A Forest breath crossed recently and has now left immediate attention. Its absence here does not mean it did not occur.';
}
