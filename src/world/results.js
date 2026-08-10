import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256, sha256Bytes } from '../core/hash.js';

const NOW = () => new Date().toISOString();
const DEFAULT_PROJECTION_BYTES = 12000;
const DEFAULT_PROJECTION_LINES = 120;
const MIN_PROJECTION_BYTES = 192;
const DEFAULT_CAPTURE_BYTES = 8 * 1024 * 1024;
const RESULT_JOB_STATUSES = new Set(['queued', 'running', 'settled', 'complete', 'failed', 'cancelled']);
const TERMINAL_JOB_STATUSES = new Set(['settled', 'complete', 'failed', 'cancelled']);
const JOB_STATUS_TRANSITIONS = Object.freeze({
  queued: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['settled', 'complete', 'failed', 'cancelled']),
});

export const RESULT_PROJECTION_POLICIES = Object.freeze([
  'generic',
  'git_diff',
  'git_status',
  'git_log',
  'git_show',
  'recipe_test',
]);
export const RESULT_PROJECTION_VERSION = 'result_projection/v1';

const POLICY_SET = new Set(RESULT_PROJECTION_POLICIES);
const TAIL_POLICIES = new Set(['recipe_test']);
const HEAD_TAIL_POLICIES = new Set(['git_diff', 'git_show']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS result_jobs (
  job_id TEXT PRIMARY KEY,
  session_id TEXT,
  wake_id TEXT,
  tool_name TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS result_output_chunks (
  chunk_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  ordinal INTEGER NOT NULL,
  stream TEXT NOT NULL CHECK(stream IN ('stdout','stderr','output')),
  byte_start INTEGER NOT NULL CHECK(byte_start>=0),
  byte_end INTEGER NOT NULL CHECK(byte_end>=byte_start),
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  body BLOB NOT NULL,
  body_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, ordinal)
);
CREATE TABLE IF NOT EXISTS result_job_status_events (
  event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  detail_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, ordinal)
);
CREATE TABLE IF NOT EXISTS result_artifacts (
  artifact_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  body BLOB NOT NULL,
  body_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, name)
);
CREATE TABLE IF NOT EXISTS result_projections (
  projection_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES result_jobs(job_id),
  fitter_version TEXT NOT NULL,
  policy TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('output','artifact')),
  source_id TEXT,
  source_sha256 TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  line_count INTEGER NOT NULL CHECK(line_count>=0),
  max_bytes INTEGER NOT NULL CHECK(max_bytes>0),
  max_lines INTEGER NOT NULL CHECK(max_lines>0),
  truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),
  omitted_bytes INTEGER NOT NULL CHECK(omitted_bytes>=0),
  omitted_lines INTEGER NOT NULL CHECK(omitted_lines>=0),
  exact_pointer TEXT NOT NULL,
  source_ranges_json TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS result_chunks_job_order ON result_output_chunks(job_id, ordinal);
CREATE INDEX IF NOT EXISTS result_job_status_order ON result_job_status_events(job_id, ordinal);
CREATE INDEX IF NOT EXISTS result_artifacts_job_name ON result_artifacts(job_id, name);
CREATE INDEX IF NOT EXISTS result_projections_job_policy ON result_projections(job_id, policy, created_at);
CREATE TRIGGER IF NOT EXISTS result_jobs_append_only_update BEFORE UPDATE ON result_jobs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_jobs_append_only_delete BEFORE DELETE ON result_jobs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_output_chunks_append_only_update BEFORE UPDATE ON result_output_chunks BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_output_chunks_append_only_delete BEFORE DELETE ON result_output_chunks BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_job_status_events_append_only_update BEFORE UPDATE ON result_job_status_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_job_status_events_append_only_delete BEFORE DELETE ON result_job_status_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_artifacts_append_only_update BEFORE UPDATE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_artifacts_append_only_delete BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_projections_append_only_update BEFORE UPDATE ON result_projections BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS result_projections_append_only_delete BEFORE DELETE ON result_projections BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function asBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail('result_invalid_argument', 'Result bodies must be strings, Buffers, or Uint8Arrays.');
}
function validName(value, label) {
  if (typeof value !== 'string' || !value || value.length > 240) fail('result_invalid_argument', `${label} is invalid.`);
  return value;
}
function canonicalMetadata(value) {
  if (value === undefined) return '{}';
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('result_invalid_argument', 'Result metadata must be an object.');
  const seen = new Set();
  const validate = candidate => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return;
    if (typeof candidate !== 'object') fail('result_invalid_argument', 'Result metadata must contain only JSON-compatible values.');
    if (seen.has(candidate)) fail('result_invalid_argument', 'Result metadata must not contain cycles.');
    seen.add(candidate);
    if (Array.isArray(candidate)) for (const item of candidate) validate(item);
    else {
      if (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null) fail('result_invalid_argument', 'Result metadata objects must be plain JSON objects.');
      for (const item of Object.values(candidate)) validate(item);
    }
    seen.delete(candidate);
  };
  validate(value);
  const json = canonicalize(value);
  try { JSON.parse(json); } catch { fail('result_invalid_argument', 'Result metadata did not produce valid JSON.'); }
  return json;
}
function lineCount(text) {
  if (!text) return 0;
  const breaks = text.match(/\r\n|\r|\n/g)?.length || 0;
  return breaks + (/\r\n$|\r$|\n$/.test(text) ? 0 : 1);
}
function splitLines(text) {
  const lines = [];
  let start = 0;
  let byteStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\r' && text[index] !== '\n') continue;
    const width = text[index] === '\r' && text[index + 1] === '\n' ? 2 : 1;
    const value = text.slice(start, index + width);
    const bytes = Buffer.byteLength(value, 'utf8');
    lines.push({ text: value, byteStart, byteEnd: byteStart + bytes });
    byteStart += bytes;
    index += width - 1;
    start = index + 1;
  }
  if (start < text.length) {
    const value = text.slice(start);
    const bytes = Buffer.byteLength(value, 'utf8');
    lines.push({ text: value, byteStart, byteEnd: byteStart + bytes });
  }
  return lines;
}
function clipPrefixUtf8(text, maxBytes) {
  let result = '';
  let used = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return { text: result, bytes: used };
}
function clipSuffixUtf8(text, maxBytes) {
  const characters = Array.from(text);
  let result = '';
  let used = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const size = Buffer.byteLength(characters[index], 'utf8');
    if (used + size > maxBytes) break;
    result = `${characters[index]}${result}`;
    used += size;
  }
  return { text: result, bytes: used };
}
function mergeRanges(lines) {
  if (!lines.length) return [];
  return [{ byteStart: lines[0].byteStart, byteEnd: lines.at(-1).byteEnd }];
}
function selectedBytes(groups) { return groups.flat().reduce((sum, line) => sum + Buffer.byteLength(line.text, 'utf8'), 0); }
function selectedLines(groups) { return groups.flat().length; }

function inertMachineText(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { text: null, binary: true, segments: [] }; }
  let output = '';
  let rawOffset = 0;
  let presentationOffset = 0;
  const segments = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    let rendered;
    if (character === '\r' || character === '\n') rendered = character;
    else if (character === '\\') rendered = '\\\\';
    else if (character === '\t') rendered = '\\t';
    else if (code < 32 || (code >= 127 && code <= 159)) rendered = code <= 255 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u{${code.toString(16)}}`;
    else if (character === '<' || character === '>' || character === '&' || character === '`') rendered = `\\u${code.toString(16).padStart(4, '0')}`;
    else rendered = character;
    const rawLength = Buffer.byteLength(character, 'utf8');
    const presentationLength = Buffer.byteLength(rendered, 'utf8');
    segments.push({
      rawByteStart: rawOffset,
      rawByteEnd: rawOffset + rawLength,
      presentationByteStart: presentationOffset,
      presentationByteEnd: presentationOffset + presentationLength,
    });
    output += rendered;
    rawOffset += rawLength;
    presentationOffset += presentationLength;
  }
  return { text: output, binary: false, segments };
}

function buildOutputPresentation(rows, exactPointer) {
  const pieces = [];
  const segments = [];
  let presentationOffset = 0;
  let rawSourceBytes = 0;
  const append = text => {
    pieces.push(text);
    presentationOffset += Buffer.byteLength(text, 'utf8');
  };
  for (const row of rows) {
    rawSourceBytes += row.byteLength;
    append(`[${row.stream} · chunk ${row.ordinal} · ${row.byteLength} bytes] `);
    const rendered = inertMachineText(row.body);
    if (rendered.binary) {
      append(`[binary chunk omitted from fitted view; exact bytes remain at ${exactPointer}]\n`);
    } else {
      const renderedStart = presentationOffset;
      append(rendered.text);
      segments.push(...rendered.segments.map(segment => ({
        sourceKind: 'output_chunk',
        chunkId: row.chunkId,
        stream: row.stream,
        sourceByteStart: row.byteStart + segment.rawByteStart,
        sourceByteEnd: row.byteStart + segment.rawByteEnd,
        presentationByteStart: renderedStart + segment.presentationByteStart,
        presentationByteEnd: renderedStart + segment.presentationByteEnd,
      })));
      if (rendered.text && !/[\r\n]$/.test(rendered.text)) append('\n');
    }
  }
  return { buffer: Buffer.from(pieces.join(''), 'utf8'), rawSourceBytes, segments };
}

function buildArtifactPresentation(artifact, exactPointer) {
  const pieces = [];
  let presentationOffset = 0;
  const append = text => {
    pieces.push(text);
    presentationOffset += Buffer.byteLength(text, 'utf8');
  };
  append(`[artifact ${artifact.name} · ${artifact.mediaType} · data only]\n`);
  const rendered = inertMachineText(artifact.body);
  if (rendered.binary) {
    append(`[binary artifact omitted from fitted view; exact bytes remain at ${exactPointer}]\n`);
    return { buffer: Buffer.from(pieces.join(''), 'utf8'), rawSourceBytes: artifact.byteLength, segments: [] };
  }
  const renderedStart = presentationOffset;
  append(rendered.text);
  return {
    buffer: Buffer.from(pieces.join(''), 'utf8'),
    rawSourceBytes: artifact.byteLength,
    segments: rendered.segments.map(segment => ({
      sourceKind: 'artifact',
      artifactId: artifact.artifactId,
      sourceByteStart: segment.rawByteStart,
      sourceByteEnd: segment.rawByteEnd,
      presentationByteStart: renderedStart + segment.presentationByteStart,
      presentationByteEnd: renderedStart + segment.presentationByteEnd,
    })),
  };
}

function terminalPrefix(event, exactPointer) {
  const renderedDetail = inertMachineText(Buffer.from(canonicalize(event.detail), 'utf8'));
  return `[job outcome: ${event.status}; terminal detail (data only): ${renderedDetail.text}; Exact custody: ${exactPointer}]\n`;
}

function fitText(sourceBuffer, { exactPointer, policy, maxBytes, maxLines, requiredPrefix = '', sourceOmittedBytesForRanges }) {
  const text = sourceBuffer.toString('utf8');
  const encoding = 'inert_utf8_v2';
  const sourceBytes = sourceBuffer.length;
  const lines = splitLines(text);
  const sourceLines = lines.length;
  const prefixBytes = Buffer.byteLength(requiredPrefix, 'utf8');
  const prefixLines = lineCount(requiredPrefix);
  if (prefixBytes > maxBytes || prefixLines > maxLines) fail('result_projection_limit', 'Projection ceiling cannot contain the required terminal outcome receipt.');
  const allRanges = sourceBytes ? [{ byteStart: 0, byteEnd: sourceBytes }] : [];
  const exactSourceOmitted = sourceOmittedBytesForRanges(allRanges);
  const exactFits = prefixBytes + sourceBytes <= maxBytes && prefixLines + sourceLines <= maxLines;
  if (exactFits) {
    return {
      content: `${requiredPrefix}${text}`,
      truncated: exactSourceOmitted > 0,
      omittedBytes: exactSourceOmitted,
      presentationOmittedBytes: 0,
      omittedLines: 0,
      selectedRanges: allRanges,
      encoding,
    };
  }

  const availableLines = Math.max(0, maxLines - prefixLines - 1);
  let groups;
  if (TAIL_POLICIES.has(policy)) groups = [lines.slice(-availableLines)];
  else if (HEAD_TAIL_POLICIES.has(policy)) {
    const selectedCount = Math.min(availableLines, lines.length);
    const headCount = Math.ceil(selectedCount / 2);
    const tailCount = selectedCount - headCount;
    groups = [lines.slice(0, headCount), tailCount ? lines.slice(-tailCount) : []];
  } else groups = [lines.slice(0, availableLines)];

  const disclosure = () => {
    const presentationOmittedBytes = Math.max(0, sourceBytes - Math.min(sourceBytes, selectedBytes(groups)));
    const omittedBytes = sourceOmittedBytesForRanges(groups.flatMap(mergeRanges));
    const omittedLines = Math.max(0, sourceLines - selectedLines(groups));
    return `[Result fitted by ${policy}; ${presentationOmittedBytes} presentation bytes/${omittedLines} lines omitted; ${omittedBytes} exact source bytes not represented. Exact custody pointer is in the outcome header.]`;
  };
  const render = () => {
    const visible = groups.map(group => group.map(line => line.text).join(''));
    const note = disclosure();
    if (groups.length === 2) {
      const head = visible[0] || '';
      const tail = visible[1] || '';
      return `${requiredPrefix}${head}${head && !/[\r\n]$/.test(head) ? '\n' : ''}${note}${tail ? `\n${tail}` : ''}`;
    }
    if (TAIL_POLICIES.has(policy)) return `${requiredPrefix}${note}${visible[0] ? `\n${visible[0]}` : ''}`;
    return `${requiredPrefix}${visible[0] || ''}${visible[0] && !/[\r\n]$/.test(visible[0]) ? '\n' : ''}${note}`;
  };

  let content = render();
  while (Buffer.byteLength(content, 'utf8') > maxBytes && groups.some(group => group.length)) {
    const over = Buffer.byteLength(content, 'utf8') - maxBytes;
    let group;
    let edge;
    if (TAIL_POLICIES.has(policy)) { group = groups[0]; edge = 'start'; }
    else if (groups.length === 2 && groups[1].length >= groups[0].length) { group = groups[1]; edge = 'start'; }
    else { group = groups[0]; edge = 'end'; }
    const index = edge === 'start' ? 0 : group.length - 1;
    const line = group[index];
    const size = Buffer.byteLength(line.text, 'utf8');
    if (size <= over) group.splice(index, 1);
    else if (edge === 'start') {
      const clipped = clipSuffixUtf8(line.text, size - over);
      line.text = clipped.text;
      line.byteStart = line.byteEnd - clipped.bytes;
    } else {
      const clipped = clipPrefixUtf8(line.text, size - over);
      line.text = clipped.text;
      line.byteEnd = line.byteStart + clipped.bytes;
    }
    content = render();
  }
  if (Buffer.byteLength(content, 'utf8') > maxBytes) fail('result_projection_limit', 'Projection ceiling is too small for its required truncation disclosure.');
  return {
    content,
    truncated: true,
    omittedBytes: sourceOmittedBytesForRanges(groups.flatMap(mergeRanges)),
    presentationOmittedBytes: Math.max(0, sourceBytes - Math.min(sourceBytes, selectedBytes(groups))),
    omittedLines: Math.max(0, sourceLines - selectedLines(groups)),
    selectedRanges: groups.flatMap(mergeRanges),
    encoding,
  };
}

function mapPresentationRanges(ranges, presentation) {
  const selected = presentation.segments.filter(segment => ranges.some(range => (
    segment.presentationByteStart >= range.byteStart && segment.presentationByteEnd <= range.byteEnd
  )));
  const merged = [];
  for (const segment of selected) {
    const prior = merged.at(-1);
    const sameSource = prior
      && prior.sourceKind === segment.sourceKind
      && prior.chunkId === segment.chunkId
      && prior.artifactId === segment.artifactId
      && prior.stream === segment.stream;
    if (sameSource && prior.sourceByteEnd === segment.sourceByteStart && prior.presentationByteEnd === segment.presentationByteStart) {
      prior.sourceByteEnd = segment.sourceByteEnd;
      prior.presentationByteEnd = segment.presentationByteEnd;
    } else merged.push({ ...segment });
  }
  return merged;
}

function rawOmittedBytes(ranges, presentation) {
  const selected = mapPresentationRanges(ranges, presentation);
  const selectedRawBytes = selected.reduce((sum, range) => sum + range.sourceByteEnd - range.sourceByteStart, 0);
  return Math.max(0, presentation.rawSourceBytes - selectedRawBytes);
}

function assertChunkIntegrity(chunk, expected = null) {
  const actualHash = chunk ? sha256Bytes(chunk.body) : null;
  if (!chunk
    || chunk.body.length !== chunk.byteLength
    || actualHash !== chunk.bodyHash
    || (expected && (
      chunk.jobId !== expected.jobId
      || chunk.ordinal !== expected.ordinal
      || chunk.stream !== expected.stream
      || chunk.byteStart !== expected.byteStart
      || chunk.byteEnd !== expected.byteEnd
      || chunk.byteLength !== expected.byteLength
      || chunk.bodyHash !== expected.bodyHash
    ))) fail('result_custody_mismatch', 'Result Rack output chunk no longer matches its custody receipt.');
  return chunk;
}

function assertArtifactIntegrity(artifact, expected = null) {
  const actualHash = artifact ? sha256Bytes(artifact.body) : null;
  if (!artifact
    || artifact.body.length !== artifact.byteLength
    || actualHash !== artifact.bodyHash
    || (expected && (
      artifact.jobId !== expected.jobId
      || artifact.artifactId !== expected.artifactId
      || artifact.byteLength !== expected.byteLength
      || artifact.bodyHash !== expected.bodyHash
    ))) fail('result_custody_mismatch', 'Result Rack artifact no longer matches its custody receipt.');
  return artifact;
}

function projectionIdFor(value) { return `result_projection_${sha256(canonicalize(value))}`; }

export function projectionPolicyFor(value) {
  const names = typeof value === 'string' ? [value] : [value?.kind, value?.jobKind, value?.toolName].filter(Boolean);
  if (names.some(name => /(?:git|sandbox)_diff$/.test(name))) return 'git_diff';
  if (names.some(name => /git_status$/.test(name))) return 'git_status';
  if (names.some(name => /git_log$/.test(name))) return 'git_log';
  if (names.some(name => /git_show$/.test(name))) return 'git_show';
  if (names.some(name => /recipe|test/.test(name))) return 'recipe_test';
  return 'generic';
}

export class ResultRackStore {
  constructor(path, { projectionMaxBytes = DEFAULT_PROJECTION_BYTES, projectionMaxLines = DEFAULT_PROJECTION_LINES, captureMaxBytes = DEFAULT_CAPTURE_BYTES } = {}) {
    if (!Number.isInteger(projectionMaxBytes) || projectionMaxBytes < MIN_PROJECTION_BYTES) fail('result_invalid_argument', `projectionMaxBytes must be at least ${MIN_PROJECTION_BYTES}.`);
    if (!Number.isInteger(projectionMaxLines) || projectionMaxLines < 1) fail('result_invalid_argument', 'projectionMaxLines must be a positive integer.');
    if (!Number.isInteger(captureMaxBytes) || captureMaxBytes < 1) fail('result_invalid_argument', 'captureMaxBytes must be a positive integer.');
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.projectionMaxBytes = projectionMaxBytes;
    this.projectionMaxLines = projectionMaxLines;
    this.captureMaxBytes = captureMaxBytes;
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
    this.sqlite.exec(SCHEMA);
  }
  transaction(fn) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.sqlite.exec('COMMIT'); return value; }
    catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }
  createJob({ jobId = id('result_job'), sessionId = null, wakeId = null, toolName, jobKind = null, status = 'running', metadata = {} }) {
    validName(jobId, 'Result job id');
    validName(toolName, 'Result tool name');
    const resolvedJobKind = jobKind || projectionPolicyFor(toolName);
    validName(resolvedJobKind, 'Result job kind');
    if (TERMINAL_JOB_STATUSES.has(status)) fail('result_invalid_argument', 'Result jobs must begin queued or running, then seal with an append-only status event.');
    if (!RESULT_JOB_STATUSES.has(status)) fail('result_invalid_argument', 'Result job status is invalid.');
    const metadataJson = canonicalMetadata(metadata);
    this.sqlite.prepare('INSERT INTO result_jobs VALUES(?,?,?,?,?,?,?,?,?)')
      .run(jobId, sessionId, wakeId, toolName, resolvedJobKind, status, metadataJson, sha256(metadataJson), NOW());
    return this.getJob(jobId);
  }
  getJob(jobId) {
    const row = this.sqlite.prepare('SELECT * FROM result_jobs WHERE job_id=?').get(jobId);
    if (!row) return null;
    const latest = this.sqlite.prepare('SELECT status, ordinal FROM result_job_status_events WHERE job_id=? ORDER BY ordinal DESC LIMIT 1').get(jobId);
    return {
      jobId: row.job_id,
      sessionId: row.session_id,
      wakeId: row.wake_id,
      toolName: row.tool_name,
      jobKind: row.job_kind,
      initialStatus: row.status,
      status: latest?.status || row.status,
      statusEventCount: latest?.ordinal || 0,
      metadata: JSON.parse(row.metadata_json),
      metadataHash: row.metadata_sha256,
      createdAt: row.created_at,
    };
  }
  insertStatusEvent(jobId, status, detailJson) {
    const ordinal = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM result_job_status_events WHERE job_id=?').get(jobId).ordinal;
    const detailHash = sha256(detailJson);
    const eventId = `result_status_${sha256(canonicalize({ jobId, ordinal, status, detailHash }))}`;
    this.sqlite.prepare('INSERT INTO result_job_status_events VALUES(?,?,?,?,?,?,?)').run(eventId, jobId, ordinal, status, detailJson, detailHash, NOW());
    return eventId;
  }
  appendJobStatus(jobId, status, detail = {}) {
    if (!RESULT_JOB_STATUSES.has(status)) fail('result_invalid_argument', 'Result job status is invalid.');
    const detailJson = canonicalMetadata(detail);
    return this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job) fail('result_job_not_found', 'Result job was not found.');
      if (TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_terminal', 'Result job already has a terminal status.');
      if (!JOB_STATUS_TRANSITIONS[job.status]?.has(status)) fail('result_invalid_transition', `Result job cannot transition from ${job.status} to ${status}.`);
      const eventId = this.insertStatusEvent(jobId, status, detailJson);
      return this.listJobStatusEvents(jobId).find(event => event.eventId === eventId);
    });
  }
  listJobStatusEvents(jobId) {
    return this.sqlite.prepare('SELECT * FROM result_job_status_events WHERE job_id=? ORDER BY ordinal').all(jobId).map(row => ({
      eventId: row.event_id,
      jobId: row.job_id,
      ordinal: row.ordinal,
      status: row.status,
      detail: JSON.parse(row.detail_json),
      detailHash: row.detail_sha256,
      createdAt: row.created_at,
    }));
  }
  verifyTerminalReceipt(jobId, expected) {
    const event = this.listJobStatusEvents(jobId).find(item => item.eventId === expected?.eventId);
    if (!event
      || event.ordinal !== expected.ordinal
      || event.status !== expected.status
      || event.detailHash !== expected.detailHash
      || sha256(canonicalize(event.detail)) !== event.detailHash
      || canonicalize(event.detail) !== canonicalize(expected.detail)) {
      fail('result_custody_mismatch', 'Result job terminal receipt no longer matches its custody manifest.');
    }
    return event;
  }
  appendOutputChunk(jobId, stream, body) {
    if (!['stdout', 'stderr', 'output'].includes(stream)) fail('result_invalid_argument', 'Result output stream is invalid.');
    const bytes = asBytes(body);
    const result = this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job) fail('result_job_not_found', 'Result job was not found.');
      if (TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_terminal', 'Result output custody is sealed.');
      if (job.status !== 'running') fail('result_job_inactive', 'Result output may only be captured while its job is running.');
      const prior = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0) AS ordinal, COALESCE(MAX(byte_end),0) AS byte_end FROM result_output_chunks WHERE job_id=?').get(jobId);
      if (prior.byte_end + bytes.length > this.captureMaxBytes) {
        this.insertStatusEvent(jobId, 'failed', canonicalMetadata({
          reason: 'capture_limit', sourceKind: 'output', capturedBytes: prior.byte_end,
          attemptedBytes: bytes.length, captureMaxBytes: this.captureMaxBytes, incomplete: true,
        }));
        return { captureRefused: true };
      }
      const ordinal = prior.ordinal + 1;
      const byteStart = prior.byte_end;
      const bodyHash = sha256Bytes(bytes);
      const chunkId = `result_chunk_${sha256(canonicalize({ jobId, ordinal, stream, byteStart, byteLength: bytes.length, bodyHash }))}`;
      this.sqlite.prepare('INSERT INTO result_output_chunks VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(chunkId, jobId, ordinal, stream, byteStart, byteStart + bytes.length, bytes.length, bytes, bodyHash, NOW());
      return this.getOutputChunk(chunkId);
    });
    if (result.captureRefused) fail('result_capture_limit', 'Result output exceeded its exact capture ceiling; no bytes were stored and the job was sealed failed.');
    return result;
  }
  getOutputChunk(chunkId) {
    const row = this.sqlite.prepare('SELECT * FROM result_output_chunks WHERE chunk_id=?').get(chunkId);
    if (!row) return null;
    return {
      chunkId: row.chunk_id,
      jobId: row.job_id,
      ordinal: row.ordinal,
      stream: row.stream,
      byteStart: row.byte_start,
      byteEnd: row.byte_end,
      byteLength: row.byte_length,
      body: Buffer.from(row.body),
      bodyHash: row.body_sha256,
      createdAt: row.created_at,
    };
  }
  listOutputChunks(jobId) {
    return this.sqlite.prepare('SELECT chunk_id FROM result_output_chunks WHERE job_id=? ORDER BY ordinal').all(jobId)
      .map(row => this.getOutputChunk(row.chunk_id));
  }
  addArtifact(jobId, { artifactId = null, name, mediaType = 'application/octet-stream', body, metadata = {} }) {
    validName(name, 'Result artifact name');
    validName(mediaType, 'Result artifact media type');
    const bytes = asBytes(body);
    const bodyHash = sha256Bytes(bytes);
    const metadataJson = canonicalMetadata(metadata);
    const resolvedId = artifactId || `result_artifact_${sha256(canonicalize({ jobId, name, mediaType, bodyHash, metadataJson }))}`;
    validName(resolvedId, 'Result artifact id');
    const result = this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job) fail('result_job_not_found', 'Result job was not found.');
      if (TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_terminal', 'Result artifact custody is sealed.');
      if (job.status !== 'running') fail('result_job_inactive', 'Result artifacts may only be captured while their job is running.');
      if (bytes.length > this.captureMaxBytes) {
        this.insertStatusEvent(jobId, 'failed', canonicalMetadata({
          reason: 'capture_limit', sourceKind: 'artifact', artifactName: name, capturedBytes: 0,
          attemptedBytes: bytes.length, captureMaxBytes: this.captureMaxBytes, incomplete: true,
        }));
        return { captureRefused: true };
      }
      this.sqlite.prepare('INSERT INTO result_artifacts VALUES(?,?,?,?,?,?,?,?,?)')
        .run(resolvedId, jobId, name, mediaType, bytes.length, bytes, bodyHash, metadataJson, NOW());
      return this.getArtifact(resolvedId);
    });
    if (result.captureRefused) fail('result_capture_limit', 'Result artifact exceeded its exact capture ceiling; no bytes were stored and the job was sealed failed.');
    return result;
  }
  getArtifact(artifactId) {
    const row = this.sqlite.prepare('SELECT * FROM result_artifacts WHERE artifact_id=?').get(artifactId);
    if (!row) return null;
    return {
      artifactId: row.artifact_id,
      jobId: row.job_id,
      name: row.name,
      mediaType: row.media_type,
      byteLength: row.byte_length,
      body: Buffer.from(row.body),
      bodyHash: row.body_sha256,
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at,
    };
  }
  createProjection(jobId, { policy = null, source = { kind: 'output' }, maxBytes = this.projectionMaxBytes, maxLines = this.projectionMaxLines } = {}) {
    const job = this.getJob(jobId);
    if (!job) fail('result_job_not_found', 'Result job was not found.');
    if (!TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_open', 'Result projections require sealed terminal job custody.');
    const resolvedPolicy = policy || projectionPolicyFor(job);
    if (!POLICY_SET.has(resolvedPolicy)) fail('result_projection_policy_unknown', 'Result projection policy is not installed.');
    if (!Number.isInteger(maxBytes) || maxBytes < MIN_PROJECTION_BYTES || maxBytes > this.projectionMaxBytes) fail('result_projection_limit', 'Projection byte ceiling is invalid.');
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > this.projectionMaxLines) fail('result_projection_limit', 'Projection line ceiling is invalid.');

    const terminalEvent = this.listJobStatusEvents(jobId).at(-1);
    if (!terminalEvent || terminalEvent.status !== job.status || sha256(canonicalize(terminalEvent.detail)) !== terminalEvent.detailHash) {
      fail('result_custody_mismatch', 'Result job terminal receipt no longer matches its recorded status.');
    }
    const terminalReceipt = {
      eventId: terminalEvent.eventId, ordinal: terminalEvent.ordinal, status: terminalEvent.status,
      detail: terminalEvent.detail, detailHash: terminalEvent.detailHash,
    };

    let sourceId = null; let outputRows = null; let artifact = null;
    if (!source || source.kind === 'output') {
      outputRows = this.listOutputChunks(jobId).map(row => assertChunkIntegrity(row));
    } else if (source.kind === 'artifact') {
      artifact = this.getArtifact(source.artifactId);
      if (!artifact || artifact.jobId !== jobId) fail('result_artifact_not_found', 'Result artifact was not found for this job.');
      assertArtifactIntegrity(artifact);
      sourceId = artifact.artifactId;
    } else fail('result_invalid_argument', 'Projection source is invalid.');
    const sourceKind = artifact ? 'artifact' : 'output';
    const exactSourceManifest = artifact
      ? { artifactId: artifact.artifactId, jobId, byteLength: artifact.byteLength, bodyHash: artifact.bodyHash }
      : { chunks: outputRows.map(row => ({ chunkId: row.chunkId, jobId, ordinal: row.ordinal, stream: row.stream, byteStart: row.byteStart, byteEnd: row.byteEnd, byteLength: row.byteLength, bodyHash: row.bodyHash })) };
    const sourceManifest = { receiptVersion: 'result_source_manifest/v1', ...exactSourceManifest, terminal: terminalReceipt };
    const sourceHash = artifact
      ? artifact.bodyHash
      : sha256(canonicalize({ version: 'result_output_manifest/v1', ...exactSourceManifest }));
    const identity = {
      fitterVersion: RESULT_PROJECTION_VERSION, jobId, policy: resolvedPolicy, sourceKind, sourceId, sourceHash,
      terminalEventId: terminalEvent.eventId, terminalStatus: terminalEvent.status, terminalDetailHash: terminalEvent.detailHash,
      maxBytes, maxLines,
    };
    const projectionId = projectionIdFor(identity);
    const existing = this.getProjection(projectionId);
    if (existing) return existing;
    const exactPointer = artifact
      ? `result-rack://jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/${sourceHash}`
      : `result-rack://jobs/${encodeURIComponent(jobId)}/output/${sourceHash}`;
    const presentation = artifact ? buildArtifactPresentation(artifact, exactPointer) : buildOutputPresentation(outputRows, exactPointer);
    const fitted = fitText(presentation.buffer, {
      exactPointer, policy: resolvedPolicy, maxBytes, maxLines, requiredPrefix: terminalPrefix(terminalEvent, exactPointer),
      sourceOmittedBytesForRanges: ranges => rawOmittedBytes(ranges, presentation),
    });
    const sourceRanges = mapPresentationRanges(fitted.selectedRanges, presentation);
    const contentHash = sha256(fitted.content);
    this.sqlite.prepare('INSERT INTO result_projections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(projection_id) DO NOTHING')
      .run(
        projectionId, jobId, RESULT_PROJECTION_VERSION, resolvedPolicy, sourceKind, sourceId, sourceHash,
        fitted.content, contentHash, Buffer.byteLength(fitted.content, 'utf8'), lineCount(fitted.content),
        maxBytes, maxLines, fitted.truncated ? 1 : 0, fitted.omittedBytes, fitted.omittedLines,
        exactPointer, JSON.stringify({
          receiptVersion: 'result_presentation_receipt/v1', encoding: fitted.encoding, ranges: sourceRanges,
          presentationRanges: fitted.selectedRanges, presentationOmittedBytes: fitted.presentationOmittedBytes,
        }), JSON.stringify(sourceManifest), NOW(),
      );
    return this.getProjection(projectionId);
  }
  readExact(exactPointer) {
    const row = this.sqlite.prepare('SELECT job_id, source_kind, source_id, source_sha256, source_manifest_json FROM result_projections WHERE exact_pointer=? ORDER BY created_at, projection_id LIMIT 1').get(exactPointer);
    if (!row) fail('result_pointer_not_found', 'Result Rack pointer was not found.');
    let manifest;
    try { manifest = JSON.parse(row.source_manifest_json); }
    catch { fail('result_custody_mismatch', 'Result Rack source manifest is not valid JSON.'); }
    this.verifyTerminalReceipt(row.job_id, manifest.terminal);
    if (row.source_kind === 'artifact') {
      const artifact = this.getArtifact(manifest.artifactId);
      assertArtifactIntegrity(artifact, { ...manifest, jobId: row.job_id });
      if (artifact.bodyHash !== row.source_sha256) fail('result_custody_mismatch', 'Pointed Result Rack artifact no longer matches its custody hash.');
      return { exactPointer, jobId: row.job_id, sourceKind: 'artifact', sourceId: artifact.artifactId, body: artifact.body, bodyHash: artifact.bodyHash };
    }
    const chunks = manifest.chunks.map(expected => {
      const chunk = this.getOutputChunk(expected.chunkId);
      return assertChunkIntegrity(chunk, { ...expected, jobId: row.job_id });
    });
    const body = Buffer.concat(chunks.map(chunk => chunk.body));
    const bodyHash = sha256Bytes(body);
    const manifestHash = sha256(canonicalize({ version: 'result_output_manifest/v1', chunks: manifest.chunks }));
    if (manifestHash !== row.source_sha256) fail('result_custody_mismatch', 'Pointed Result Rack output manifest no longer matches its custody hash.');
    return { exactPointer, jobId: row.job_id, sourceKind: 'output', sourceId: null, body, bodyHash, sourceHash: manifestHash, chunks };
  }
  getProjection(projectionId) {
    const row = this.sqlite.prepare('SELECT * FROM result_projections WHERE projection_id=?').get(projectionId);
    if (!row) return null;
    let pointers; let sourceManifest;
    try {
      pointers = JSON.parse(row.source_ranges_json);
      sourceManifest = JSON.parse(row.source_manifest_json);
    } catch { fail('result_custody_mismatch', 'Stored Result Rack projection receipts are not valid JSON.'); }
    const content = row.content_text;
    if (sha256(content) !== row.content_sha256
      || Buffer.byteLength(content, 'utf8') !== row.byte_length
      || lineCount(content) !== row.line_count) {
      fail('result_custody_mismatch', 'Stored Result Rack projection content no longer matches its receipt.');
    }
    const terminal = this.verifyTerminalReceipt(row.job_id, sourceManifest.terminal);
    const expectedProjectionId = projectionIdFor({
      fitterVersion: row.fitter_version, jobId: row.job_id, policy: row.policy,
      sourceKind: row.source_kind, sourceId: row.source_id, sourceHash: row.source_sha256,
      terminalEventId: terminal.eventId, terminalStatus: terminal.status, terminalDetailHash: terminal.detailHash,
      maxBytes: row.max_bytes, maxLines: row.max_lines,
    });
    if (expectedProjectionId !== row.projection_id || !content.startsWith(terminalPrefix(terminal, row.exact_pointer))) {
      fail('result_custody_mismatch', 'Stored Result Rack projection identity no longer matches its outcome receipt.');
    }
    return {
      projectionId: row.projection_id,
      jobId: row.job_id,
      fitterVersion: row.fitter_version,
      policy: row.policy,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceHash: row.source_sha256,
      content,
      contentHash: row.content_sha256,
      byteLength: row.byte_length,
      lineCount: row.line_count,
      maxBytes: row.max_bytes,
      maxLines: row.max_lines,
      truncated: Boolean(row.truncated),
      omittedBytes: row.omitted_bytes,
      presentationOmittedBytes: pointers.presentationOmittedBytes,
      omittedLines: row.omitted_lines,
      exactPointer: row.exact_pointer,
      encoding: pointers.encoding,
      presentationReceiptVersion: pointers.receiptVersion,
      presentationRanges: pointers.presentationRanges,
      sourceRanges: pointers.ranges,
      sourceManifest,
      createdAt: row.created_at,
    };
  }
  close() { this.sqlite.close(); }
}

function thresholdStatus(totalBytes, warnBytes, refuseBytes) {
  return totalBytes >= refuseBytes ? 'refuse' : totalBytes >= warnBytes ? 'warn' : 'ok';
}
function validateThresholds(warnBytes, refuseBytes) {
  if (!Number.isInteger(warnBytes) || warnBytes < 0 || !Number.isInteger(refuseBytes) || refuseBytes <= warnBytes) {
    fail('attention_invalid_threshold', 'Attention thresholds require 0 <= warnBytes < refuseBytes.');
  }
}
function validateOmissionPlan(messages, declaredOmissions) {
  if (!Array.isArray(declaredOmissions)) fail('attention_invalid_omission', 'Declared omissions must be an array.');
  const used = new Set();
  return declaredOmissions.map(item => {
    if (!item || item.reason !== 'old_tool_pair' || !Number.isInteger(item.assistantMessageIndex) || !Number.isInteger(item.toolMessageIndex)) {
      fail('attention_invalid_omission', 'Only indexed old_tool_pair omissions may be declared.');
    }
    const assistant = messages[item.assistantMessageIndex];
    const tool = messages[item.toolMessageIndex];
    if (!assistant || assistant.role !== 'assistant' || !tool || tool.role !== 'tool' || item.toolMessageIndex !== item.assistantMessageIndex + 1) {
      fail('attention_invalid_omission', 'Declared old tool pairs do not match assistant/tool message roles and order.');
    }
    if ((assistant.content !== null && assistant.content !== '') || !Array.isArray(assistant.tool_calls) || assistant.tool_calls.length !== 1) {
      fail('attention_invalid_omission', 'Declared old tool pairs must be a tool-only assistant call with exactly one result.');
    }
    if (item.toolMessageIndex >= messages.length - 1) fail('attention_invalid_omission', 'The current or tail tool pair cannot be declared old.');
    if (used.has(item.assistantMessageIndex) || used.has(item.toolMessageIndex)) fail('attention_invalid_omission', 'Declared omissions overlap.');
    if (typeof tool.tool_call_id !== 'string' || !tool.tool_call_id || assistant.tool_calls[0]?.id !== tool.tool_call_id) {
      fail('attention_invalid_omission', 'Declared tool result does not belong to its assistant tool call.');
    }
    if (typeof item.replacementPointer !== 'string' || !item.replacementPointer.startsWith('result-rack://') || typeof item.replacementHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.replacementHash)) {
      fail('attention_invalid_omission', 'Declared old tool pairs require a Result Rack replacement pointer and SHA-256 hash.');
    }
    used.add(item.assistantMessageIndex); used.add(item.toolMessageIndex);
    return {
      reason: item.reason,
      assistantMessageIndex: item.assistantMessageIndex,
      toolMessageIndex: item.toolMessageIndex,
      assistantMessageHash: sha256(JSON.stringify(assistant)),
      toolMessageHash: sha256(JSON.stringify(tool)),
      replacementPointer: item.replacementPointer,
      replacementHash: item.replacementHash,
    };
  });
}

function serialized(value) { return JSON.stringify(value) ?? 'null'; }

export class AttentionMeter {
  constructor({ warnBytes = 80000, refuseBytes = 120000, replacementVerifier = null } = {}) {
    validateThresholds(warnBytes, refuseBytes);
    if (replacementVerifier !== null && typeof replacementVerifier !== 'function') fail('attention_invalid_input', 'Attention replacement verifier must be a function.');
    this.warnBytes = warnBytes;
    this.refuseBytes = refuseBytes;
    this.replacementVerifier = replacementVerifier;
  }
  measure({ messages = [], tools = [], estimatedAdditionalBytes = 0, declaredOmissions = [] } = {}) {
    if (!Array.isArray(messages) || !Array.isArray(tools)) fail('attention_invalid_input', 'Attention messages and tools must be arrays.');
    if (!Number.isInteger(estimatedAdditionalBytes) || estimatedAdditionalBytes < 0) fail('attention_invalid_input', 'Estimated additional bytes must be a non-negative integer.');
    const messageDetails = messages.map((message, index) => ({ index, role: message?.role || null, bytes: Buffer.byteLength(serialized(message), 'utf8'), hash: sha256(serialized(message)) }));
    const toolDetails = tools.map((tool, index) => ({ index, name: tool?.function?.name || tool?.name || null, bytes: Buffer.byteLength(serialized(tool), 'utf8'), hash: sha256(serialized(tool)) }));
    const payloadBytes = Buffer.byteLength(JSON.stringify({ messages, tools }), 'utf8');
    const totalBytes = payloadBytes + estimatedAdditionalBytes;
    const declarations = validateOmissionPlan(messages, declaredOmissions).map(declaration => {
      let custodyVerified = false;
      if (this.replacementVerifier) {
        try {
          const custody = this.replacementVerifier(declaration.replacementPointer);
          custodyVerified = custody?.bodyHash === declaration.replacementHash || custody?.sourceHash === declaration.replacementHash;
        } catch {}
      }
      return { ...declaration, custodyVerified };
    });
    const omittedIndexes = new Set(declarations.flatMap(item => [item.assistantMessageIndex, item.toolMessageIndex]));
    const plannedMessages = messages.filter((_, index) => !omittedIndexes.has(index));
    const plannedPayloadBytes = Buffer.byteLength(JSON.stringify({ messages: plannedMessages, tools }), 'utf8');
    const projectedTotalBytes = plannedPayloadBytes + estimatedAdditionalBytes;
    return {
      schemaVersion: 1,
      phase: 'pre_dispatch',
      status: thresholdStatus(totalBytes, this.warnBytes, this.refuseBytes),
      dispatchAllowed: totalBytes < this.refuseBytes,
      thresholds: { warnBytes: this.warnBytes, refuseBytes: this.refuseBytes },
      payloadBytes,
      estimatedAdditionalBytes,
      totalBytes,
      messages: { count: messages.length, bytes: messageDetails.reduce((sum, item) => sum + item.bytes, 0), items: messageDetails },
      toolSchemas: { count: tools.length, bytes: toolDetails.reduce((sum, item) => sum + item.bytes, 0), items: toolDetails },
      omissionPlan: {
        applied: false,
        readyToApply: declarations.length > 0 && declarations.every(item => item.custodyVerified),
        reason: declarations.length ? 'declared_old_tool_pairs' : 'none',
        declarations,
        projectedMessageCount: plannedMessages.length,
        projectedPayloadBytes: plannedPayloadBytes,
        projectedTotalBytes,
        projectedStatus: thresholdStatus(projectedTotalBytes, this.warnBytes, this.refuseBytes),
        estimatedSavingsBytes: totalBytes - projectedTotalBytes,
      },
    };
  }
}

export function measureAttention(input, thresholds = {}) {
  return new AttentionMeter(thresholds).measure(input);
}
