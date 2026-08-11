import { canonicalize, sha256, sha256Bytes } from '../core/hash.js';

export const DEFAULT_PROJECTION_BYTES = 12000;
export const DEFAULT_PROJECTION_LINES = 120;
export const MIN_PROJECTION_BYTES = 192;
export const DEFAULT_CAPTURE_BYTES = 8 * 1024 * 1024;
export const RESULT_JOB_STATUSES = new Set(['queued', 'running', 'settled', 'complete', 'failed', 'cancelled']);
export const TERMINAL_JOB_STATUSES = new Set(['settled', 'complete', 'failed', 'cancelled']);
export const JOB_STATUS_TRANSITIONS = Object.freeze({
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

export const POLICY_SET = new Set(RESULT_PROJECTION_POLICIES);
const TAIL_POLICIES = new Set(['recipe_test']);
const HEAD_TAIL_POLICIES = new Set(['git_diff', 'git_show']);

export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function asBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail('result_invalid_argument', 'Result bodies must be strings, Buffers, or Uint8Arrays.');
}
export function validName(value, label) {
  if (typeof value !== 'string' || !value || value.length > 240) fail('result_invalid_argument', `${label} is invalid.`);
  return value;
}
export function canonicalMetadata(value) {
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
export function lineCount(text) {
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

export function buildOutputPresentation(rows, exactPointer) {
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

export function buildArtifactPresentation(artifact, exactPointer) {
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

export function terminalPrefix(event, exactPointer) {
  const renderedDetail = inertMachineText(Buffer.from(canonicalize(event.detail), 'utf8'));
  return `[job outcome: ${event.status}; terminal detail (data only): ${renderedDetail.text}; Exact custody: ${exactPointer}]\n`;
}

export function fitText(sourceBuffer, { exactPointer, policy, maxBytes, maxLines, requiredPrefix = '', sourceOmittedBytesForRanges }) {
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

export function mapPresentationRanges(ranges, presentation) {
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

export function rawOmittedBytes(ranges, presentation) {
  const selected = mapPresentationRanges(ranges, presentation);
  const selectedRawBytes = selected.reduce((sum, range) => sum + range.sourceByteEnd - range.sourceByteStart, 0);
  return Math.max(0, presentation.rawSourceBytes - selectedRawBytes);
}

export function assertChunkIntegrity(chunk, expected = null) {
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

export function assertArtifactIntegrity(artifact, expected = null) {
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

export function projectionIdFor(value) { return `result_projection_${sha256(canonicalize(value))}`; }

export function projectionPolicyFor(value) {
  const names = typeof value === 'string' ? [value] : [value?.kind, value?.jobKind, value?.toolName].filter(Boolean);
  if (names.some(name => /(?:git|sandbox)_diff$/.test(name))) return 'git_diff';
  if (names.some(name => /git_status$/.test(name))) return 'git_status';
  if (names.some(name => /git_log$/.test(name))) return 'git_log';
  if (names.some(name => /git_show$/.test(name))) return 'git_show';
  if (names.some(name => /recipe|test/.test(name))) return 'recipe_test';
  return 'generic';
}
