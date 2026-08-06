import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { sha256 } from '../core/hash.js';
import { resolveRepositoryPath } from './graph.js';

const DEFAULTS = Object.freeze({ maxFiles: 100, maxBytes: 120000, maxLines: 160, maxResults: 50 });
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function rel(root, path) { return relative(root, path).replaceAll('\\', '/'); }
function splitSourceLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== '\r' && character !== '\n') continue;
    const terminator = character === '\r' && text[index + 1] === '\n' ? '\r\n' : character;
    lines.push({ content: text.slice(start, index), raw: text.slice(start, index + terminator.length), terminator });
    index += terminator.length - 1;
    start = index + 1;
  }
  if (start < text.length || text.length === 0) lines.push({ content: text.slice(start), raw: text.slice(start), terminator: '' });
  return lines;
}
function safeText(root, path, limits) {
  const stat = lstatSync(path); if (!stat.isFile()) fail('workshop_not_file', 'Workshop target is not a regular file.');
  if (stat.size > limits.maxBytes) fail('workshop_oversized', 'Workshop target exceeds the bounded source size.');
  const bytes = readFileSync(path); if (bytes.includes(0)) fail('workshop_binary', 'Workshop target is binary or contains NUL bytes.');
  const text = bytes.toString('utf8'); if (text.includes('\uFFFD')) fail('workshop_binary', 'Workshop target is not valid UTF-8 source text.');
  return { text, bytes, stat };
}
function source(path, root, startLine, endLine, text) { return { path: rel(root, path), startLine, endLine, text, hash: sha256(text), byteLength: Buffer.byteLength(text, 'utf8') }; }

export class WorkshopAdapter {
  constructor(root, limits = {}) { this.root = root; this.limits = { ...DEFAULTS, ...limits }; }
  list(path = '.') {
    const absolute = path === '.' ? this.root : resolveRepositoryPath(this.root, path);
    const stat = lstatSync(absolute); if (!stat.isDirectory()) fail('workshop_not_directory', 'Workshop list target is not a directory.');
    const names = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    if (names.length > this.limits.maxFiles) fail('workshop_limit', 'Workshop listing exceeds the file-count limit.');
    const entries = [];
    for (const item of names) {
      let child; try { child = resolveRepositoryPath(this.root, `${path === '.' ? '' : `${path}/`}${item.name}`); } catch (error) { if (['workshop_path_forbidden','workshop_path_invalid'].includes(error.code)) continue; throw error; }
      const childStat = lstatSync(child); const type = childStat.isDirectory() ? 'directory' : childStat.isFile() ? 'file' : 'other';
      entries.push({ name: item.name, path: rel(this.root, child), type });
    }
    return { kind: 'workshop_list', path: path === '.' ? '.' : rel(this.root, absolute), entries, exact: true };
  }
  read(path, startLine = 1, lineCount = this.limits.maxLines) {
    if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(lineCount) || lineCount < 1 || lineCount > this.limits.maxLines) fail('workshop_limit', 'Workshop line range is outside the bounded limit.');
    const absolute = resolveRepositoryPath(this.root, path); const { text } = safeText(this.root, absolute, this.limits); const lines = splitSourceLines(text); const start = startLine - 1; const selected = lines.slice(start, start + lineCount); if (!selected.length || start >= lines.length) fail('workshop_range', 'Workshop line range is unavailable.');
    const body = selected.map(line => line.raw).join(''); this.inspectPath = path; return { kind: 'workshop_read', source: source(absolute, this.root, startLine, startLine + selected.length - 1, body), lineCount: selected.length, exact: true, lineTerminators: 'preserved' };
  }
  search(query, path = '.', maxResults = this.limits.maxResults) {
    if (typeof query !== 'string' || !query || query.length > 200) fail('workshop_invalid_argument', 'Workshop search query is invalid.');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > this.limits.maxResults) fail('workshop_limit', 'Workshop search result limit is outside the bounded limit.');
    const rootPath = path === '.' ? this.root : resolveRepositoryPath(this.root, path); const target = lstatSync(rootPath); const files = [];
    const walk = directory => { for (const item of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) { if (files.length >= this.limits.maxFiles) fail('workshop_limit', 'Workshop search file limit exceeded.'); let child; try { child = resolveRepositoryPath(this.root, `${rel(this.root, directory) === '' ? '' : `${rel(this.root, directory)}/`}${item.name}`); } catch (error) { if (['workshop_path_forbidden','workshop_path_invalid'].includes(error.code)) continue; throw error; } if (item.isDirectory()) walk(child); else if (item.isFile()) files.push(child); } };
    if (target.isDirectory()) walk(rootPath); else if (target.isFile()) files.push(rootPath); else fail('workshop_not_file', 'Workshop search target is not searchable.');
    const matches = []; let omitted = false; for (const file of files) { let text; try { text = safeText(this.root, file, this.limits).text; } catch (error) { if (['workshop_binary','workshop_oversized'].includes(error.code)) continue; throw error; } const lines = splitSourceLines(text); for (let index = 0; index < lines.length; index += 1) { const line = lines[index]; if (!line.content.includes(query)) continue; if (matches.length < maxResults) matches.push({ path: rel(this.root, file), line: index + 1, text: line.raw, hash: sha256(line.raw), byteLength: Buffer.byteLength(line.raw, 'utf8') }); else { omitted = true; break; } } if (omitted) break; }
    return { kind: 'workshop_search', query, path: path === '.' ? '.' : rel(this.root, rootPath), matches, exact: true, truncated: omitted, lineTerminators: 'preserved' };
  }
}
