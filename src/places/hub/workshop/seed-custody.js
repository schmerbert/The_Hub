import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export function canonicalSeedRepository(repositoryPath) {
  if (typeof repositoryPath !== 'string' || !repositoryPath || repositoryPath.includes('\0')) fail('seed_repository_invalid', 'Seed repository path is invalid.');
  const resolved = resolve(repositoryPath);
  if (!existsSync(resolved)) fail('seed_repository_missing', 'Seed repository does not exist.');
  const canonical = realpathSync.native(resolved); const stat = lstatSync(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('seed_repository_invalid', 'Seed repository must be a real directory.');
  const identityPath = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  return { path: canonical, repositoryId: createHash('sha256').update(`the-workshop:repository:${identityPath}`).digest('hex') };
}

export function prepareSeedStateRoot(stateRoot, repositoryPath) {
  if (typeof stateRoot !== 'string' || !stateRoot || stateRoot.includes('\0')) fail('seed_state_root_invalid', 'Seed state root is invalid.');
  const root = resolve(stateRoot); const repository = canonicalSeedRepository(repositoryPath).path;
  const rel = relative(repository, root);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) fail('seed_state_root_inside_repository', 'Seed state must remain outside the canonical repository.');
  let cursor = root;
  while (!existsSync(cursor)) { const parent = resolve(cursor, '..'); if (parent === cursor) break; cursor = parent; }
  const ancestor = lstatSync(cursor);
  if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) fail('seed_state_root_invalid', 'Seed state ancestry must be real directories.');
  mkdirSync(root, { recursive: true });
  const final = lstatSync(root);
  if (final.isSymbolicLink() || !final.isDirectory()) fail('seed_state_root_invalid', 'Seed state root must be a real directory.');
  return root;
}
