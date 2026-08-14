import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

// Room-owned path boundary: no Workshop affordance may escape its repository.

function assertWithin(root, target) {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Target escapes the repository root.');
}

export function assertWorkshopRepositoryPath(requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0') || isAbsolute(requested)) throw Object.assign(new Error('Workshop paths must be relative repository paths.'), { code: 'workshop_path_invalid' });
  const normalized = requested.replaceAll('\\', '/'); const parts = normalized.split('/');
  if (parts.includes('..') || parts.includes('') && normalized.startsWith('/')) throw Object.assign(new Error('Workshop traversal is refused.'), { code: 'workshop_path_invalid' });
  if (parts.some(part => /^\.(?:git|runtime)$/i.test(part) || /^\.env(?:\.|$)/i.test(part) || /^\.gitignore$/i.test(part) || /(credential|secret|token|password)/i.test(part))) throw Object.assign(new Error('Workshop protected paths are refused.'), { code: 'workshop_path_forbidden' });
  return normalized;
}

export function resolveRepositoryPath(root, requested, { allowMissing = false } = {}) {
  const normalized = assertWorkshopRepositoryPath(requested); const parts = normalized.split('/');
  const absoluteRoot = realpathSync(root); const absolute = join(absoluteRoot, ...parts); assertWithin(absoluteRoot, absolute);
  const meaningfulParts = parts.filter(part => part && part !== '.');
  let cursor = absoluteRoot;
  for (let index = 0; index < meaningfulParts.length; index += 1) {
    cursor = join(cursor, meaningfulParts[index]);
    if (!existsSync(cursor)) break;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw Object.assign(new Error('Workshop symlinks and junctions are refused.'), { code: 'workshop_path_forbidden' });
    assertWithin(absoluteRoot, realpathSync(cursor));
    if (index < meaningfulParts.length - 1 && !stat.isDirectory()) throw Object.assign(new Error('Workshop path parent is not a directory.'), { code: 'workshop_not_directory' });
  }
  if (!existsSync(absolute) && !allowMissing) throw Object.assign(new Error('Workshop target does not exist.'), { code: 'workshop_not_found' });
  if (existsSync(absolute)) { const stat = lstatSync(absolute); if (stat.isSymbolicLink()) throw Object.assign(new Error('Workshop symlinks are refused.'), { code: 'workshop_path_forbidden' }); const real = realpathSync(absolute); assertWithin(absoluteRoot, real); }
  return absolute;
}
