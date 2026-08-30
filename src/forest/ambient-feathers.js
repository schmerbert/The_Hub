import { sha256 } from '../core/hash.js';

const MAX_FEATHERS = 3;
const MAX_PREVIEW_BYTES = 360;
const AMBIENT_SCORE_FLOORS = Object.freeze([0.70, 0.72, 0.76]);
const ANCHORED_SCORE_FLOORS = Object.freeze([0.58, 0.68, 0.74]);
const DIRECT_ECHO_OVERLAP = 0.82;
const ACTIVE_CONTEXT_WINDOW = 8;
const ACTIVE_TOPIC_DEPTH = 3;
const ANCHOR_STOPWORDS = new Set(['about','after','again','also','another','because','before','being','could','forest','from','have','into','just','like','more','other','really','should','something','that','their','there','these','thing','think','this','through','what','when','where','which','with','would','your']);

function identity(entry) {
  return {
    entryId: entry.entryId || entry.entry_id,
    sourceEventId: entry.sourceEventId || entry.source_event_id,
    sourceEventHash: entry.sourceEventHash || entry.source_event_hash,
    bodyHash: entry.bodyHash || entry.body_hash,
    sourceTimestamp: entry.sourceTimestamp || entry.source_timestamp,
    actorKind: entry.actorKind || entry.actor_kind,
    body: entry.body,
  };
}

function boundedSuffixStart(text, end, maxBytes) {
  let start = end;
  for (const point of [...text.slice(0, end)].reverse()) {
    const next = start - point.length;
    if (Buffer.byteLength(text.slice(next, end), 'utf8') > maxBytes) break;
    start = next;
  }
  return start;
}

export function buildAmbientFeatherPreview(body, maxBytes = MAX_PREVIEW_BYTES) {
  const source = String(body || '');
  const leading = source.match(/^\s*/u)?.[0].length || 0;
  const trailing = source.match(/\s*$/u)?.[0].length || 0;
  const end = source.length - trailing;
  if (end <= leading) return { exactText: '', span: null };

  const clean = source.slice(leading, end);
  const sentenceStarts = [0];
  for (const match of clean.matchAll(/[.!?](?=\s|$)\s*/gu)) {
    const next = match.index + match[0].length;
    if (next < clean.length) sentenceStarts.push(next);
  }

  let start = sentenceStarts.at(-1);
  if (Buffer.byteLength(clean.slice(start), 'utf8') > maxBytes) {
    start = boundedSuffixStart(clean, clean.length, maxBytes);
  } else {
    for (let index = sentenceStarts.length - 2; index >= 0; index -= 1) {
      const candidate = sentenceStarts[index];
      if (Buffer.byteLength(clean.slice(candidate), 'utf8') > maxBytes) break;
      start = candidate;
    }
  }

  const startUtf16 = leading + start;
  const exactText = source.slice(startUtf16, end);
  return { exactText, span: {
    startUtf16, endUtf16: end,
    startByte: Buffer.byteLength(source.slice(0, startUtf16), 'utf8'),
    endByte: Buffer.byteLength(source.slice(0, end), 'utf8'),
  } };
}

function tokenSet(text) { return new Set(String(text || '').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) || []); }
function lexicalOverlap(a, b) {
  const left = tokenSet(a); const right = tokenSet(b); if (!left.size || !right.size) return 0;
  let overlap = 0; for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.min(left.size, right.size);
}

function rareQueryAnchors(entries, utterance) {
  const query = [...tokenSet(utterance)].filter(token => token.length >= 4 && !ANCHOR_STOPWORDS.has(token));
  return new Set(query.filter(token => entries.reduce((count, entry) => count + (tokenSet(entry.body).has(token) ? 1 : 0), 0) <= 6));
}

function conceptTokens(text) {
  return new Set([...tokenSet(text)].filter(token => token.length >= 4 && !ANCHOR_STOPWORDS.has(token)));
}

function sharesTopic(candidateTokens, text) {
  const liveTokens = conceptTokens(text);
  let shared = 0;
  for (const token of candidateTokens) if (liveTokens.has(token)) shared += 1;
  return shared >= 2 || [...candidateTokens].some(token => token.length >= 6 && liveTokens.has(token));
}

function activeTopicDepth(body, activeContextTexts) {
  const candidateTokens = conceptTokens(body);
  if (!candidateTokens.size) return 0;
  return activeContextTexts.slice(-ACTIVE_CONTEXT_WINDOW).reduce((depth, text) => depth + (sharesTopic(candidateTokens, text) ? 1 : 0), 0);
}

export class AmbientFeatherService {
  constructor({ forest, index, embeddingProvider }) {
    this.forest = forest;
    this.index = index;
    this.embeddingProvider = embeddingProvider;
    this.generationId = this.index.ensureGeneration({ embedding: this.embeddingProvider.identity(), forest: this.forest.semanticProjectionIdentity() });
    this.ready = false;
    this.error = null;
    this.warming = this.sync().then(() => { this.ready = true; }, error => { this.error = error; });
  }

  entries() {
    return this.forest.listSemanticProjectionAtoms().map(identity);
  }

  async sync() {
    const entries = this.entries();
    const missing = this.index.missing(this.generationId, entries);
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batch = missing.slice(offset, offset + 32);
      const vectors = await this.embeddingProvider.embed(batch.map(entry => entry.body));
      batch.forEach((entry, index) => this.index.put(this.generationId, entry, vectors[index]));
    }
    return { entryCount: entries.length, vectorCount: this.index.count(this.generationId) };
  }

  async offerBearings({ query, excludeEntryIds = [], limit = 8 }) {
    if (!this.ready) throw Object.assign(new Error(this.error ? 'Forest embeddings are unavailable.' : 'The Forest canopy is still warming.'), { code: this.error ? 'embedding_unavailable' : 'embedding_warming' });
    if (typeof query !== 'string' || !query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 48) throw Object.assign(new Error('Forest bearing query is invalid.'), { code: 'forest_walk_invalid_argument' });
    await this.sync();
    const entries = this.entries(); const byId = new Map(entries.map(entry => [entry.entryId, entry]));
    const [queryVector] = await this.embeddingProvider.embed([query], { query: true });
    return this.index.search(this.generationId, queryVector, { excludeEntryIds, limit: 48 }).flatMap(candidate => {
      const entry = byId.get(candidate.entryId);
      if (!entry || sha256(entry.body) !== entry.bodyHash) return [];
      return [{ ...entry, score: candidate.score }];
    }).slice(0, limit);
  }

  async semanticNeighborhood({ query, excludeEntryIds = [], limit = 24 }) {
    if (!this.ready) throw Object.assign(new Error(this.error ? 'Forest embeddings are unavailable.' : 'The Forest canopy is still warming.'), { code: this.error ? 'embedding_unavailable' : 'embedding_warming' });
    if (typeof query !== 'string' || !query.trim() || !Number.isInteger(limit) || limit < 3 || limit > 48) throw Object.assign(new Error('Forest bearing query is invalid.'), { code: 'forest_walk_invalid_argument' });
    await this.sync();
    const entries = this.entries(); const byId = new Map(entries.map(entry => [entry.entryId, entry]));
    const [queryVector] = await this.embeddingProvider.embed([query], { query: true });
    const candidates = this.index.search(this.generationId, queryVector, { excludeEntryIds, limit, includeVectors: true }).flatMap(candidate => {
      const entry = byId.get(candidate.entryId);
      return !entry || sha256(entry.body) !== entry.bodyHash ? [] : [{ ...entry, score: candidate.score, vector: candidate.vector }];
    });
    return { queryVector: [...queryVector], candidates };
  }

  async select({ utterance, activeSourceEventIds = [], activeContextTexts = [], excludeEntryIds = [], firstTurn = false }) {
    if (firstTurn) return { feathers: [], candidates: [], exclusions: [], silenceReason: 'first_turn_quiet', generationId: this.generationId };
    if (!this.ready) return { feathers: [], candidates: [], silenceReason: this.error ? 'embedding_unavailable' : 'embedding_warming', generationId: this.generationId };
    await this.sync();
    const entries = this.entries();
    const byId = new Map(entries.map(entry => [entry.entryId, entry]));
    const activeSources = new Set(activeSourceEventIds);
    const excludedIds = [...new Set([...entries.filter(entry => activeSources.has(entry.sourceEventId)).map(entry => entry.entryId), ...excludeEntryIds])];
    const [queryVector] = await this.embeddingProvider.embed([utterance], { query: true });
    const neighborhood = this.index.search(this.generationId, queryVector, { excludeEntryIds: excludedIds, limit: 48 });
    const selected = [];
    const exclusions = [];
    const anchors = rareQueryAnchors(entries, utterance);
    for (const candidate of neighborhood) {
      const entry = byId.get(candidate.entryId);
      if (!entry || sha256(entry.body) !== entry.bodyHash) continue;
      const anchored = [...anchors].some(token => tokenSet(entry.body).has(token));
      const floors = anchored ? ANCHORED_SCORE_FLOORS : AMBIENT_SCORE_FLOORS;
      const scoreFloor = floors[Math.min(selected.length, floors.length - 1)];
      if (candidate.score < scoreFloor) {
        exclusions.push({ entryId: entry.entryId, reason: 'quiet_prior' });
        continue;
      }
      const glint = buildAmbientFeatherPreview(entry.body);
      if (lexicalOverlap(utterance, entry.body) >= DIRECT_ECHO_OVERLAP || lexicalOverlap(utterance, glint.exactText) >= DIRECT_ECHO_OVERLAP) {
        exclusions.push({ entryId: entry.entryId, reason: 'direct_utterance_echo' });
        continue;
      }
      const topicDepth = activeTopicDepth(entry.body, activeContextTexts);
      if (topicDepth >= ACTIVE_TOPIC_DEPTH) {
        exclusions.push({ entryId: entry.entryId, reason: 'active_context_topic_saturated', evidence: { matchingRecentMessages: topicDepth, inspectedRecentMessages: Math.min(activeContextTexts.length, ACTIVE_CONTEXT_WINDOW) } });
        continue;
      }
      if (selected.some(prior => lexicalOverlap(prior.body, entry.body) >= 0.72)) continue;
      selected.push({ ...entry, score: candidate.score });
      if (selected.length >= MAX_FEATHERS) break;
    }
    const feathers = selected.map(entry => {
      const glint = buildAmbientFeatherPreview(entry.body);
      return {
        entryId: entry.entryId, sourceEventId: entry.sourceEventId, sourceEventHash: entry.sourceEventHash,
        sourceBodyHash: entry.bodyHash, bodyHash: sha256(glint.exactText), sourceTimestamp: entry.sourceTimestamp,
        actorKind: entry.actorKind, span: glint.span, exactText: glint.exactText,
        bearing: {
          kind: 'forest_entry', entryId: entry.entryId,
          unreadBeyondPreview: entry.body.slice(0, glint.span.startUtf16).trim().length > 0 || entry.body.slice(glint.span.endUtf16).trim().length > 0,
        },
      };
    });
    return { feathers, candidates: neighborhood.map(({ entryId, sourceEventId, bodyHash, score }) => ({ entryId, sourceEventId, bodyHash, score })), exclusions, silenceReason: feathers.length ? null : 'quiet_prior', generationId: this.generationId };
  }
}
