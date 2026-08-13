import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const networkModules = ['node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns'];

test('host source has no network, Hub-core imports, external packages, fetch, or filesystem writes', () => {
  for (const file of walk(sourceRoot).filter((path) => ['.js', '.mjs'].includes(extname(path)))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${relative(sourceRoot, file)} uses fetch`);
    assert.doesNotMatch(source, /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/, `${relative(sourceRoot, file)} writes files`);
    assert.doesNotMatch(source, /(?:^|['"/\\])(?:src|test|docs)(?:[/\\]|['"])/m, `${relative(sourceRoot, file)} references Hub core`);
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
      const specifier = match[2];
      assert.equal(networkModules.some((name) => specifier === name || specifier.startsWith(`${name}/`)), false, `${relative(sourceRoot, file)} imports ${specifier}`);
      assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), `${relative(sourceRoot, file)} imports external package ${specifier}`);
    }
  }
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
