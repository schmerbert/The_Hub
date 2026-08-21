import { lstatSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';
import { resolveRepositoryPath } from './path-law.js';

export const DEFAULT_EXCLUDED_DIRECTORIES = Object.freeze([
  'node_modules',
  'build',
  'dist',
  'coverage',
  '.cache',
  'cache',
  '.next',
  'out',
  'target',
]);

const MAX_REPORTED_SKIPS = 20;

function rel(root, path) { return relative(root, path).replaceAll('\\', '/'); }
function joinPath(directory, name) { return `${directory.replace(/[\\/]$/, '')}/${name}`; }

function traversalReport(state) {
  const boundary = state.boundary;
  const continuation = boundary
    ? {
        nextPath: boundary.nextPath || null,
        action: boundary.kind === 'max_files'
          ? 'Narrow path to the named unvisited file or one of its containing subdirectories; the remaining scope was not evaluated and no traversal cursor is installed.'
          : 'Narrow path or request fewer matching results; the remainder was not evaluated after the result bound.',
      }
    : null;
  return {
    filesExamined: state.filesExamined,
    filesSkipped: state.filesSkipped,
    directoriesSkipped: state.directoriesSkipped,
    skippedPaths: state.skippedPaths,
    skippedPathCount: state.skippedPathCount,
    truncated: Boolean(boundary),
    complete: !boundary,
    boundary: boundary || null,
    continuation,
  };
}

export function walkWorkshopFiles(root, startPath, limits, { onFile } = {}) {
  const absolute = startPath === '.' ? root : resolveRepositoryPath(root, startPath);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() && !stat.isFile()) throw Object.assign(new Error('Workshop walk target is not searchable.'), { code: 'workshop_not_file' });
  const state = { filesExamined: 0, filesSkipped: 0, directoriesSkipped: 0, skippedPaths: [], skippedPathCount: 0, boundary: null };
  const noteSkip = (path, kind, countAsFile = false) => {
    if (countAsFile) state.filesSkipped += 1;
    state.skippedPathCount += 1;
    if (state.skippedPaths.length < MAX_REPORTED_SKIPS) state.skippedPaths.push({ path: rel(root, path), kind });
  };
  const stop = (kind, nextPath = null, limit = null) => {
    if (!state.boundary) state.boundary = { kind, limit: limit ?? (kind === 'max_files' ? limits.maxFiles : limits.maxResults), nextPath };
  };
  const walk = directory => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (state.boundary) return;
      const directoryRelative = rel(root, directory);
      const requested = directoryRelative ? `${directoryRelative}/${item.name}` : item.name;
      let child;
      try { child = resolveRepositoryPath(root, requested); }
      catch (error) {
        if (['workshop_path_forbidden', 'workshop_path_invalid'].includes(error.code)) { noteSkip(joinPath(directory, item.name), error.code); continue; }
        throw error;
      }
      if (item.isDirectory()) {
        if (limits.excludedDirectories.some(name => name.toLowerCase() === item.name.toLowerCase())) {
          state.directoriesSkipped += 1;
          noteSkip(child, 'excluded_directory');
          continue;
        }
        walk(child);
      } else if (item.isFile()) {
        if (state.filesExamined >= limits.maxFiles) { stop('max_files', rel(root, child)); return; }
        state.filesExamined += 1;
        const action = onFile?.(child, { skip: (kind = 'unreadable') => noteSkip(child, kind, true) });
        if (action?.stop) stop(action.stop.kind || 'max_results', action.stop.nextPath || rel(root, child), action.stop.limit);
      }
    }
  };
  if (stat.isDirectory()) walk(absolute);
  else if (limits.maxFiles < 1) stop('max_files', rel(root, absolute));
  else {
    state.filesExamined = 1;
    onFile?.(absolute, { skip: (kind = 'unreadable') => noteSkip(absolute, kind, true) });
  }
  return { absolute, ...traversalReport(state) };
}

