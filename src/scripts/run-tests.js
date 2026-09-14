import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RUNTIME_TEST_ROOT = resolve(ROOT, 'test');
const EXPERIMENT_TEST_ROOT = resolve(ROOT, 'experiments', 'room-capsules');
const ARCHITECTURE_TESTS = [
  'test/architecture-boundaries-v1.test.js',
  'test/place-module-structure-v1.test.js',
  'test/runtime-boundary-floor-v1.test.js',
  'test/world-event-contract-extraction-v1.test.js',
];

async function testFilesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await testFilesUnder(path));
    else if (entry.name.endsWith('.test.js')) files.push(path);
  }
  return files.sort();
}

const lane = process.argv[2] || 'full';
const serial = process.argv.includes('--serial');
let files;
if (lane === 'architecture') files = ARCHITECTURE_TESTS.map(path => resolve(ROOT, path));
else if (lane === 'runtime') files = await testFilesUnder(RUNTIME_TEST_ROOT);
else if (lane === 'experiments') files = await testFilesUnder(EXPERIMENT_TEST_ROOT);
else if (lane === 'full') files = [...await testFilesUnder(EXPERIMENT_TEST_ROOT), ...await testFilesUnder(RUNTIME_TEST_ROOT)].sort();
else throw new Error(`Unknown test lane: ${lane}`);

const configured = Number.parseInt(process.env.HUB_TEST_CONCURRENCY || '', 10);
const concurrency = serial ? 1 : Number.isInteger(configured) && configured > 0 ? configured : 2;
process.stdout.write(`Hub test lane: ${lane} (${files.length} files, concurrency ${concurrency})\n`);

const child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
});
child.once('error', error => { throw error; });
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
