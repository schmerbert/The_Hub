import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { sha256, sha256Bytes } from '../core/hash.js';
import { resolveRepositoryPath } from '../workshop/path-law.js';

const DEFAULTS = Object.freeze({
  maxFiles: 100,
  maxBytes: 120000,
  maxLines: 160,
  maxResults: 50,
  maxTreeDepth: 6,
  maxTreeEntries: 400,
  defaultTreeEntries: 120,
});
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
function pathIdentity(stat) { return { device: String(stat.dev), inode: String(stat.ino) }; }
function sameIdentity(left, right) { return left?.device === right?.device && left?.inode === right?.inode; }
function diffPathKey(path) { return process.platform === 'win32' ? path.toLowerCase() : path; }

function globToRegExp(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 260) fail('workshop_invalid_argument', 'Glob pattern is invalid.');
  let regex = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { regex += '(?:.*/)?'; index += 2; }
      else { regex += '.*'; index += 1; }
      continue;
    }
    if (character === '*') { regex += '[^/]*'; continue; }
    if (character === '?') { regex += '[^/]'; continue; }
    if ('\\.[]{}()+-^$|'.includes(character)) regex += `\\${character}`;
    else regex += character;
  }
  return new RegExp(`${regex}$`);
}

function walkFiles(root, startPath, limits, { includeDirs = false } = {}) {
  const files = [];
  const walk = directory => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= limits.maxFiles) fail('workshop_limit', 'Workshop file walk exceeded the file-count limit.');
      let child;
      try { child = resolveRepositoryPath(root, `${rel(root, directory) === '' ? '' : `${rel(root, directory)}/`}${item.name}`); }
      catch (error) { if (['workshop_path_forbidden', 'workshop_path_invalid'].includes(error.code)) continue; throw error; }
      if (item.isDirectory()) {
        if (includeDirs) files.push(child);
        walk(child);
      } else if (item.isFile()) files.push(child);
    }
  };
  const absolute = startPath === '.' ? root : resolveRepositoryPath(root, startPath);
  const stat = lstatSync(absolute);
  if (stat.isDirectory()) walk(absolute);
  else if (stat.isFile()) files.push(absolute);
  else fail('workshop_not_file', 'Workshop walk target is not searchable.');
  return { absolute, files };
}

function parseUnifiedDiff(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim() || diffText.length > 500000) fail('workshop_invalid_argument', 'Unified diff is invalid.');
  const lines = diffText.replaceAll('\r\n', '\n').split('\n');
  const files = [];
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('diff --git ')) continue;
    if (line.startsWith('--- ')) {
      const path = line.slice(4).replace(/^[ab]\//, '').trim();
      current = { path, hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!current) fail('workshop_diff_invalid', 'Unified diff +++ without ---.');
      current.path = line.slice(4).replace(/^[ab]\//, '').trim();
      continue;
    }
    if (line.startsWith('@@ ')) {
      if (!current) fail('workshop_diff_invalid', 'Unified diff hunk without file header.');
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) fail('workshop_diff_invalid', 'Unified diff hunk header is malformed.');
      current.hunks.push({ oldStart: Number(match[1]), oldCount: Number(match[2] || 1), newStart: Number(match[3]), newCount: Number(match[4] || 1), lines: [] });
      continue;
    }
    if (!current?.hunks.length) continue;
    const hunk = current.hunks.at(-1);
    if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line === '\\ No newline at end of file') hunk.lines.push(line);
  }
  if (!files.length) fail('workshop_diff_invalid', 'Unified diff contained no file sections.');
  return files;
}

function applyHunksToText(text, hunks) {
  const original = splitSourceLines(text);
  const result = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const oldStart = hunk.oldStart - 1;
    if (oldStart < cursor) fail('workshop_diff_mismatch', 'Unified diff hunks overlap or are out of order.');
    while (cursor < oldStart) {
      if (cursor >= original.length) fail('workshop_diff_mismatch', 'Unified diff context exceeds file length.');
      result.push(original[cursor].raw);
      cursor += 1;
    }
    for (const line of hunk.lines) {
      if (line === '\\ No newline at end of file') continue;
      if (line.startsWith(' ')) {
        if (cursor >= original.length || original[cursor].content !== line.slice(1)) fail('workshop_diff_mismatch', 'Unified diff context does not match the file.');
        result.push(original[cursor].raw);
        cursor += 1;
      } else if (line.startsWith('-')) {
        if (cursor >= original.length || original[cursor].content !== line.slice(1)) fail('workshop_diff_mismatch', 'Unified diff removal does not match the file.');
        cursor += 1;
      } else if (line.startsWith('+')) {
        result.push(`${line.slice(1)}\n`);
      }
    }
  }
  while (cursor < original.length) {
    result.push(original[cursor].raw);
    cursor += 1;
  }
  return result.join('');
}

function prepareUnifiedDiff(root, diff, limits) {
  const files = parseUnifiedDiff(diff);
  const targets = [];
  const seen = new Set();
  for (const file of files) {
    if (!file.path || file.path === '/dev/null') fail('workshop_diff_invalid', 'Unified diff path is invalid.');
    const absolute = resolveRepositoryPath(root, file.path, { allowMissing: file.hunks.every(hunk => hunk.oldCount === 0) });
    const path = rel(root, absolute);
    const key = diffPathKey(path);
    if (seen.has(key)) fail('workshop_diff_invalid', 'Unified diff contains a duplicate normalized path.');
    seen.add(key);
    const exists = existsSync(absolute);
    const before = exists ? safeText(root, absolute, limits).text : '';
    const after = applyHunksToText(before, file.hunks);
    if (Buffer.byteLength(after, 'utf8') > limits.maxBytes * 2) fail('workshop_limit', 'Diff result would exceed the bounded source size.');
    targets.push({ absolute, path, key, before, after, created: !exists });
  }
  for (const target of targets) {
    if (targets.some(other => other !== target && other.key.startsWith(`${target.key}/`))) {
      fail('workshop_diff_invalid', 'Unified diff file paths cannot contain one another.');
    }
  }
  return targets;
}

function missingParentDirectories(root, absolute) {
  const missing = [];
  let parent = dirname(absolute);
  while (parent !== root && !existsSync(parent)) {
    missing.push(parent);
    parent = dirname(parent);
  }
  return missing;
}

export class WorkshopAdapter {
  constructor(root, limits = {}) { this.root = root; this.limits = { ...DEFAULTS, ...limits }; }
  list(path = '.') {
    const absolute = path === '.' ? this.root : resolveRepositoryPath(this.root, path);
    const stat = lstatSync(absolute); if (!stat.isDirectory()) fail('workshop_not_directory', 'Workshop list target is not a directory.');
    const names = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    if (names.length > this.limits.maxFiles) fail('workshop_limit', 'Workshop listing exceeds the file-count limit.');
    const entries = [];
    for (const item of names) {
      let child; try { child = resolveRepositoryPath(this.root, `${path === '.' ? '' : `${path}/`}${item.name}`); } catch (error) { if (['workshop_path_forbidden', 'workshop_path_invalid'].includes(error.code)) continue; throw error; }
      const childStat = lstatSync(child); const type = childStat.isDirectory() ? 'directory' : childStat.isFile() ? 'file' : 'other';
      entries.push({ name: item.name, path: rel(this.root, child), type });
    }
    return { kind: 'workshop_list', path: path === '.' ? '.' : rel(this.root, absolute), entries, exact: true };
  }
  read(path, startLine = 1, lineCount = this.limits.maxLines) {
    if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(lineCount) || lineCount < 1 || lineCount > this.limits.maxLines) fail('workshop_limit', 'Workshop line range is outside the bounded limit.');
    const absolute = resolveRepositoryPath(this.root, path); const { text } = safeText(this.root, absolute, this.limits); const lines = splitSourceLines(text); const start = startLine - 1; const selected = lines.slice(start, start + lineCount); if (!selected.length || start >= lines.length) fail('workshop_range', 'Workshop line range is unavailable.');
    const body = selected.map(line => line.raw).join(''); return { kind: 'workshop_read', source: source(absolute, this.root, startLine, startLine + selected.length - 1, body), lineCount: selected.length, exact: true, lineTerminators: 'preserved' };
  }
  search(query, path = '.', maxResults = this.limits.maxResults) {
    if (typeof query !== 'string' || !query || query.length > 200) fail('workshop_invalid_argument', 'Workshop search query is invalid.');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > this.limits.maxResults) fail('workshop_limit', 'Workshop search result limit is outside the bounded limit.');
    const { absolute, files } = walkFiles(this.root, path, this.limits);
    const matches = []; let omitted = false;
    for (const file of files) {
      let text; try { text = safeText(this.root, file, this.limits).text; } catch (error) { if (['workshop_binary', 'workshop_oversized'].includes(error.code)) continue; throw error; }
      const lines = splitSourceLines(text);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.content.includes(query)) continue;
        if (matches.length < maxResults) matches.push({ path: rel(this.root, file), line: index + 1, text: line.raw, hash: sha256(line.raw), byteLength: Buffer.byteLength(line.raw, 'utf8') });
        else { omitted = true; break; }
      }
      if (omitted) break;
    }
    return { kind: 'workshop_search', query, path: path === '.' ? '.' : rel(this.root, absolute), matches, exact: true, truncated: omitted, lineTerminators: 'preserved' };
  }
  searchRegex(pattern, path = '.', maxResults = this.limits.maxResults, flags = '') {
    if (typeof pattern !== 'string' || !pattern || pattern.length > 200) fail('workshop_invalid_argument', 'Workshop regex pattern is invalid.');
    if (typeof flags !== 'string' || flags.length > 5 || /[^gimsuy]/.test(flags)) fail('workshop_invalid_argument', 'Workshop regex flags are invalid.');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > this.limits.maxResults) fail('workshop_limit', 'Workshop search result limit is outside the bounded limit.');
    let regex; try { regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`); } catch { fail('workshop_invalid_argument', 'Workshop regex pattern could not be compiled.'); }
    const { absolute, files } = walkFiles(this.root, path, this.limits);
    const matches = []; let omitted = false;
    for (const file of files) {
      let text; try { text = safeText(this.root, file, this.limits).text; } catch (error) { if (['workshop_binary', 'workshop_oversized'].includes(error.code)) continue; throw error; }
      const lines = splitSourceLines(text);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        regex.lastIndex = 0;
        if (!regex.test(line.content)) continue;
        if (matches.length < maxResults) matches.push({ path: rel(this.root, file), line: index + 1, text: line.raw, hash: sha256(line.raw), byteLength: Buffer.byteLength(line.raw, 'utf8') });
        else { omitted = true; break; }
      }
      if (omitted) break;
    }
    return { kind: 'workshop_search_regex', pattern, flags, path: path === '.' ? '.' : rel(this.root, absolute), matches, exact: true, truncated: omitted, lineTerminators: 'preserved' };
  }
  glob(pattern, path = '.', maxResults = this.limits.maxResults) {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > this.limits.maxResults) fail('workshop_limit', 'Workshop glob result limit is outside the bounded limit.');
    const matcher = globToRegExp(pattern.replaceAll('\\', '/'));
    const { absolute, files } = walkFiles(this.root, path, this.limits);
    const matches = []; let truncated = false;
    for (const file of files) {
      const relativePath = rel(this.root, file);
      if (!matcher.test(relativePath)) continue;
      if (matches.length < maxResults) matches.push(relativePath);
      else { truncated = true; break; }
    }
    return { kind: 'workshop_glob', pattern, path: path === '.' ? '.' : rel(this.root, absolute), matches, exact: true, truncated };
  }
  tree(path = '.', depth = 3, maxEntries = undefined) {
    if (!Number.isInteger(depth) || depth < 1 || depth > this.limits.maxTreeDepth) fail('workshop_limit', 'Workshop tree depth is outside the bounded limit.');
    const limit = maxEntries === undefined ? this.limits.defaultTreeEntries : maxEntries;
    if (!Number.isInteger(limit) || limit < 1 || limit > this.limits.maxTreeEntries) fail('workshop_limit', 'Workshop tree entry limit is outside the bounded limit.');
    const absolute = path === '.' ? this.root : resolveRepositoryPath(this.root, path);
    if (!lstatSync(absolute).isDirectory()) fail('workshop_not_directory', 'Workshop tree target is not a directory.');
    const entries = []; let truncated = false;
    const walk = (directory, level) => {
      if (truncated || level > depth) return;
      for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= limit) { truncated = true; return; }
        let child; try { child = resolveRepositoryPath(this.root, `${rel(this.root, directory) === '' ? '' : `${rel(this.root, directory)}/`}${item.name}`); } catch (error) { if (['workshop_path_forbidden', 'workshop_path_invalid'].includes(error.code)) continue; throw error; }
        const type = item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'other';
        entries.push({ path: rel(this.root, child), type, depth: level });
        if (item.isDirectory()) walk(child, level + 1);
        if (truncated) return;
      }
    };
    walk(absolute, 1);
    return {
      kind: 'workshop_tree',
      path: path === '.' ? '.' : rel(this.root, absolute),
      depth,
      maxEntries: limit,
      entries,
      exact: true,
      truncated,
      ...(truncated ? { note: 'Tree truncated; narrow path or raise max_entries.' } : {}),
    };
  }
  stat(path) {
    const absolute = resolveRepositoryPath(this.root, path);
    const stat = lstatSync(absolute);
    const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    return { kind: 'workshop_stat', path: rel(this.root, absolute), type, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), exact: true };
  }
  fileHash(path) {
    const absolute = resolveRepositoryPath(this.root, path);
    const { text, bytes } = safeText(this.root, absolute, this.limits);
    return { kind: 'workshop_file_hash', path: rel(this.root, absolute), hash: sha256(text), byteLength: bytes.length, exact: true };
  }
  previewPatch(path, oldText, newText) {
    if (typeof oldText !== 'string' || !oldText) fail('workshop_invalid_argument', 'Patch old_text must be a non-empty string.');
    if (typeof newText !== 'string') fail('workshop_invalid_argument', 'Patch new_text must be a string.');
    if (oldText.length > this.limits.maxBytes || newText.length > this.limits.maxBytes) fail('workshop_limit', 'Patch text exceeds the bounded source size.');
    const absolute = resolveRepositoryPath(this.root, path);
    const { text } = safeText(this.root, absolute, this.limits);
    const first = text.indexOf(oldText);
    if (first < 0) fail('workshop_patch_missing', 'Patch old_text was not found in the target file.');
    const second = text.indexOf(oldText, first + oldText.length);
    if (second >= 0) fail('workshop_patch_ambiguous', 'Patch old_text is not unique in the target file.');
    const next = `${text.slice(0, first)}${newText}${text.slice(first + oldText.length)}`;
    if (Buffer.byteLength(next, 'utf8') > this.limits.maxBytes * 2) fail('workshop_limit', 'Patched file would exceed the bounded source size.');
    return { kind: 'workshop_patch_preview', path: rel(this.root, absolute), beforeHash: sha256(text), afterHash: sha256(next), beforeBytes: Buffer.byteLength(text, 'utf8'), afterBytes: Buffer.byteLength(next, 'utf8'), oldText, newText, exact: true };
  }
  applyPatch(path, oldText, newText) {
    const preview = this.previewPatch(path, oldText, newText);
    const absolute = resolveRepositoryPath(this.root, path);
    const { text } = safeText(this.root, absolute, this.limits);
    if (sha256(text) !== preview.beforeHash) fail('workshop_patch_stale', 'The target file changed before the patch could be applied.');
    const next = `${text.slice(0, text.indexOf(oldText))}${newText}${text.slice(text.indexOf(oldText) + oldText.length)}`;
    writeFileSync(absolute, next, 'utf8');
    return { kind: 'workshop_patch_applied', path: preview.path, beforeHash: preview.beforeHash, afterHash: preview.afterHash, beforeBytes: preview.beforeBytes, afterBytes: preview.afterBytes, exact: true };
  }
  previewUnifiedDiff(diff) {
    const previews = prepareUnifiedDiff(this.root, diff, this.limits).map(file => ({
      path: file.path,
      beforeHash: sha256(file.before),
      afterHash: sha256(file.after),
      beforeBytes: Buffer.byteLength(file.before, 'utf8'),
      afterBytes: Buffer.byteLength(file.after, 'utf8'),
      created: file.created,
    }));
    return { kind: 'workshop_unified_diff_preview', files: previews, diff, exact: true };
  }
  applyUnifiedDiff(diff) {
    const files = prepareUnifiedDiff(this.root, diff, this.limits);
    for (const file of files) {
      const exists = existsSync(file.absolute);
      const current = exists ? safeText(this.root, file.absolute, this.limits).text : '';
      if (exists === file.created || sha256(current) !== sha256(file.before)) fail('workshop_patch_stale', 'A unified diff target changed before apply.');
    }
    const attempted = [];
    const createdDirectories = [...new Set(files.flatMap(file => missingParentDirectories(this.root, file.absolute)))].sort((a, b) => b.length - a.length);
    try {
      for (const file of files) {
        mkdirSync(dirname(file.absolute), { recursive: true });
        attempted.push(file);
        writeFileSync(file.absolute, file.after, 'utf8');
      }
    } catch (error) {
      for (const file of attempted.reverse()) {
        try {
          if (file.created) { if (existsSync(file.absolute)) unlinkSync(file.absolute); }
          else writeFileSync(file.absolute, file.before, 'utf8');
        } catch {}
      }
      for (const directory of createdDirectories) {
        try { rmdirSync(directory); } catch {}
      }
      throw error;
    }
    return { kind: 'workshop_unified_diff_applied', files: files.map(file => ({ path: file.path, beforeHash: sha256(file.before), afterHash: sha256(file.after) })), exact: true };
  }
  previewWriteFile(path, content) {
    if (typeof content !== 'string') fail('workshop_invalid_argument', 'Write content must be a string.');
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxBytes) fail('workshop_limit', 'Write content exceeds the bounded source size.');
    const absolute = resolveRepositoryPath(this.root, path, { allowMissing: true });
    const exists = existsSync(absolute);
    if (exists && !lstatSync(absolute).isFile()) fail('workshop_not_file', 'Write target exists and is not a file.');
    const before = exists ? safeText(this.root, absolute, this.limits).text : '';
    return { kind: 'workshop_write_preview', path: rel(this.root, absolute), exists, beforeHash: exists ? sha256(before) : null, afterHash: sha256(content), afterBytes: Buffer.byteLength(content, 'utf8'), exact: true };
  }
  writeFile(path, content) {
    const preview = this.previewWriteFile(path, content);
    const absolute = resolveRepositoryPath(this.root, path, { allowMissing: true });
    if (preview.exists) {
      const { text } = safeText(this.root, absolute, this.limits);
      if (sha256(text) !== preview.beforeHash) fail('workshop_patch_stale', 'Write target changed before apply.');
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
    return { kind: 'workshop_write_applied', path: preview.path, beforeHash: preview.beforeHash, afterHash: preview.afterHash, afterBytes: preview.afterBytes, exact: true };
  }
  previewCreatePath(path, kind) {
    if (kind !== 'file' && kind !== 'directory') fail('workshop_invalid_argument', 'Create kind must be file or directory.');
    const absolute = resolveRepositoryPath(this.root, path, { allowMissing: true });
    if (existsSync(absolute)) fail('workshop_path_exists', 'Create target already exists.');
    return { kind: 'workshop_create_preview', path: rel(this.root, absolute), createKind: kind, exact: true };
  }
  createPath(path, kind) {
    const preview = this.previewCreatePath(path, kind);
    const absolute = resolveRepositoryPath(this.root, path, { allowMissing: true });
    if (existsSync(absolute)) fail('workshop_path_exists', 'Create target already exists.');
    if (kind === 'directory') mkdirSync(absolute, { recursive: true });
    else { mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, '', 'utf8'); }
    return { kind: 'workshop_create_applied', path: preview.path, createKind: kind, exact: true };
  }
  previewDeletePath(path) {
    const absolute = resolveRepositoryPath(this.root, path);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      const names = readdirSync(absolute);
      if (names.length) fail('workshop_not_empty', 'Directory delete requires an empty directory in v1.');
    } else if (!stat.isFile()) fail('workshop_not_file', 'Delete target is not a file or directory.');
    const type = stat.isDirectory() ? 'directory' : 'file';
    const hash = type === 'file' ? sha256Bytes(readFileSync(absolute)) : sha256(JSON.stringify([]));
    return { kind: 'workshop_delete_preview', path: rel(this.root, absolute), type, identity: pathIdentity(stat), hash, exact: true };
  }
  deletePath(path, approvedPreview = null) {
    const preview = this.previewDeletePath(path);
    if (approvedPreview && (
      approvedPreview.path !== preview.path ||
      approvedPreview.type !== preview.type ||
      approvedPreview.hash !== preview.hash ||
      !sameIdentity(approvedPreview.identity, preview.identity)
    )) fail('workshop_patch_stale', 'Delete target changed after approval.');
    const absolute = resolveRepositoryPath(this.root, path);
    if (preview.type === 'directory') rmdirSync(absolute);
    else unlinkSync(absolute);
    return { kind: 'workshop_delete_applied', path: preview.path, type: preview.type, exact: true };
  }
  previewRenamePath(fromPath, toPath) {
    const fromAbsolute = resolveRepositoryPath(this.root, fromPath);
    const toAbsolute = resolveRepositoryPath(this.root, toPath, { allowMissing: true });
    if (existsSync(toAbsolute)) fail('workshop_path_exists', 'Rename destination already exists.');
    return { kind: 'workshop_rename_preview', fromPath: rel(this.root, fromAbsolute), toPath: rel(this.root, toAbsolute), exact: true };
  }
  renamePath(fromPath, toPath) {
    const preview = this.previewRenamePath(fromPath, toPath);
    const fromAbsolute = resolveRepositoryPath(this.root, fromPath);
    const toAbsolute = resolveRepositoryPath(this.root, toPath, { allowMissing: true });
    mkdirSync(dirname(toAbsolute), { recursive: true });
    renameSync(fromAbsolute, toAbsolute);
    return { kind: 'workshop_rename_applied', fromPath: preview.fromPath, toPath: preview.toPath, exact: true };
  }
}
