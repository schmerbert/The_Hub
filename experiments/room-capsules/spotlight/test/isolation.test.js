import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NETWORK_MODULES = ['node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns'];

test('all source imports stay in the capsule or use non-network Node built-ins', () => {
  for (const file of walk(root).filter((path) => ['.js', '.mjs'].includes(extname(path)))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${relative(root, file)} uses fetch`);
    assert.doesNotMatch(source, /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/, `${relative(root, file)} writes files`);
    const importPatterns = [/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g, /\bimport\s+(['"])([^'"]+)\1/g];
    for (const match of importPatterns.flatMap((pattern) => [...source.matchAll(pattern)])) {
      const specifier = match[2];
      assert.equal(NETWORK_MODULES.some((name) => specifier === name || specifier.startsWith(`${name}/`)), false, `${relative(root, file)} imports network module ${specifier}`);
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'), `${relative(root, file)} imports package ${specifier}`);
      const target = resolve(dirname(file), specifier);
      assert.ok(target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`), `${relative(root, file)} escapes capsule: ${specifier}`);
    }
  }
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
