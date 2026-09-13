import { lstatSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { sha256 } from './canonical.js';
import { resolveRepositoryPath } from './path-law.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function rel(root, path) { return relative(root, path).replaceAll('\\', '/'); }
function linesOf(text) {
  const lines = []; let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\r' && text[index] !== '\n') continue;
    const width = text[index] === '\r' && text[index + 1] === '\n' ? 2 : 1;
    lines.push({ content: text.slice(start, index), raw: text.slice(start, index + width) }); index += width - 1; start = index + 1;
  }
  if (start < text.length || text.length === 0) lines.push({ content: text.slice(start), raw: text.slice(start) });
  return lines;
}
function load(root, path, limits) {
  const absolute = resolveRepositoryPath(root, path); const stat = lstatSync(absolute);
  if (!stat.isFile()) fail('workshop_not_file', 'Workshop document target is not a regular file.');
  if (stat.size > limits.maxBytes) fail('workshop_document_oversized', `Document exceeds the ${limits.maxBytes}-byte bounded source ceiling.`);
  const bytes = readFileSync(absolute); if (bytes.includes(0)) fail('workshop_binary', 'Workshop document is binary or contains NUL bytes.');
  const text = bytes.toString('utf8'); if (text.includes('\uFFFD')) fail('workshop_binary', 'Workshop document is not valid UTF-8 text.');
  const lines = linesOf(text);
  return { absolute, path: rel(root, absolute), bytes, text, lines, revision: sha256(text) };
}
function complement(selected, total) {
  const missing = []; let cursor = 1;
  for (const [start, end] of selected) { if (cursor < start) missing.push([cursor, start - 1]); cursor = end + 1; }
  if (cursor <= total) missing.push([cursor, total]); return missing;
}
function source(doc, start, end) {
  const text = doc.lines.slice(start - 1, end).map(line => line.raw).join('');
  return { path: doc.path, startLine: start, endLine: end, text, hash: sha256(text), byteLength: Buffer.byteLength(text, 'utf8') };
}
function fittedEnd(doc, start, requestedEnd, limits) {
  let bytes = 0; let end = start - 1;
  while (end < requestedEnd && end - start + 1 < limits.maxDocumentLines) {
    const nextBytes = Buffer.byteLength(doc.lines[end].raw, 'utf8');
    if (end >= start && bytes + nextBytes > limits.maxDocumentBytes) break;
    bytes += nextBytes; end += 1;
  }
  if (end < start) fail('workshop_document_line_oversized', 'One document line exceeds the presentation ceiling.');
  if (end >= requestedEnd) return end;
  for (let index = end; index > start; index -= 1) {
    if (/^#{1,6}\s+/.test(doc.lines[index].content)) return index;
  }
  return end;
}

export function documentOutline(root, path, limits) {
  const doc = load(root, path, limits); const headings = [];
  for (let index = 0; index < doc.lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(doc.lines[index].content);
    if (match) headings.push({ level: match[1].length, line: index + 1, text: match[2], hash: sha256(doc.lines[index].raw) });
  }
  const presented = headings.map(heading => [heading.line, heading.line]); const totalLines = doc.lines.length;
  return { kind: 'workshop_document_outline', path: doc.path, revision: doc.revision, byteLength: doc.bytes.length, totalLines, headings, documentExtent: { requested: [[1, totalLines]], examined: [[1, totalLines]], presented, missing: complement(presented, totalLines), standing: 'partial', transform: 'heading_index/v1' }, exact: true };
}

export function documentRead(root, path, { heading = null, startLine = null, endLine = null } = {}, limits) {
  const doc = load(root, path, limits); const totalLines = doc.lines.length; let first = startLine || 1; let requestedLast = endLine || totalLines;
  if (heading !== null) {
    if (typeof heading !== 'string' || !heading.trim()) fail('workshop_invalid_argument', 'Document heading must be non-empty text.');
    const candidates = doc.lines.map((line, index) => ({ line, index })).filter(({ line }) => /^(#{1,6})\s+/.test(line.content) && line.content.replace(/^#{1,6}\s+/, '').replace(/\s*#*\s*$/, '') === heading);
    if (candidates.length !== 1) fail(candidates.length ? 'workshop_document_heading_ambiguous' : 'workshop_document_heading_missing', 'Document heading must match exactly one Markdown heading.');
    first = candidates[0].index + 1; const level = /^(#{1,6})/.exec(candidates[0].line.content)[1].length;
    const next = doc.lines.findIndex((line, index) => index > candidates[0].index && /^(#{1,6})\s+/.test(line.content) && /^(#{1,6})/.exec(line.content)[1].length <= level);
    requestedLast = next < 0 ? totalLines : next;
  }
  if (!Number.isInteger(first) || !Number.isInteger(requestedLast) || first < 1 || requestedLast < first || requestedLast > totalLines) fail('workshop_range', 'Document line range is unavailable.');
  const last = fittedEnd(doc, first, requestedLast, limits);
  const missing = complement([[first, last]], totalLines);
  return { kind: 'workshop_document_read', source: source(doc, first, last), documentRevision: doc.revision, totalLines, byteLength: doc.bytes.length, documentExtent: { requested: [[first, requestedLast]], examined: [[first, last]], presented: [[first, last]], missing, standing: missing.length ? 'partial' : 'complete', continuation: last < totalLines ? { tool: 'workshop_document_read', arguments: { path: doc.path, start_line: last + 1, end_line: last < requestedLast ? requestedLast : totalLines } } : null }, exact: true, lineTerminators: 'preserved' };
}
