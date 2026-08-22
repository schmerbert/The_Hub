import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ContinuitySeed } from '../src/places/hub/workshop/seed-store.js';

function git(root, ...args) { const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seed-repo-')); const stateRoot = mkdtempSync(join(tmpdir(), 'seed-state-'));
  writeFileSync(join(root, 'work.txt'), 'base\n'); git(root, 'init'); git(root, 'config', 'user.email', 'seed@example.invalid'); git(root, 'config', 'user.name', 'Seed Test'); git(root, 'add', '.'); git(root, 'commit', '-m', 'base');
  return { root, stateRoot, clean() { rmSync(root, { recursive: true, force: true }); rmSync(stateRoot, { recursive: true, force: true }); } };
}

test('Seed persists attributed standing and a fresh instance reads a bounded cockpit', () => {
  const f = fixture(); try {
    let seed = new ContinuitySeed(f.root, { stateRoot: f.stateRoot });
    seed.setObjective('Ship the Workshop.', { actor: 'human', provenance: 'explicit_human' });
    seed.addFact('The suite passes.', { actor: 'agent', provenance: 'measured_test', source: { kind: 'command', coordinate: 'npm test' } });
    seed.addDecision('Use SQLite by default.', { actor: 'human', provenance: 'explicit_human' });
    const question = seed.addQuestion('Is the package ready?', { actor: 'agent', provenance: 'explicit_agent' });
    seed.observeRepository({ actor: 'agent', provenance: 'measured_git' }); seed.close();
    seed = new ContinuitySeed(f.root, { stateRoot: f.stateRoot });
    const cockpit = seed.readCockpit({ kilnRuns: [{ runId: 'kiln_example', status: 'settled' }] });
    assert.equal(cockpit.objective.body, 'Ship the Workshop.'); assert.equal(cockpit.facts.length, 1); assert.equal(cockpit.decisions.length, 1); assert.equal(cockpit.openQuestions[0].id, question.id); assert.equal(cockpit.kilnRuns.length, 1);
    assert.deepEqual(cockpit.drift, { observed: true, headChanged: false, workingTreeChanged: false });
    assert.equal(cockpit.custody.hiddenReasoningStored, false); seed.close();
  } finally { f.clean(); }
});

test('Seed reports measured drift and question resolution', () => {
  const f = fixture(); try {
    const seed = new ContinuitySeed(f.root, { stateRoot: f.stateRoot });
    const question = seed.addQuestion('What changed?', { actor: 'human', provenance: 'explicit_human' });
    seed.observeRepository({ actor: 'agent', provenance: 'measured_git' });
    writeFileSync(join(f.root, 'work.txt'), 'changed\n');
    assert.equal(seed.readCockpit().drift.workingTreeChanged, true);
    seed.resolveQuestion(question.id, { actor: 'human', provenance: 'explicit_human' });
    assert.equal(seed.readCockpit().openQuestions.length, 0); seed.close();
  } finally { f.clean(); }
});

test('Seed refuses missing attribution, missing fact coordinates, in-repo state, and unknown schema', () => {
  const f = fixture(); try {
    assert.throws(() => new ContinuitySeed(f.root, { stateRoot: join(f.root, '.seed') }), error => error.code === 'seed_state_root_inside_repository');
    let seed = new ContinuitySeed(f.root, { stateRoot: f.stateRoot });
    assert.throws(() => seed.setObjective('x', { actor: '', provenance: 'human' }), error => error.code === 'seed_invalid_value');
    assert.throws(() => seed.addFact('x', { actor: 'agent', provenance: 'test' }), error => error.code === 'seed_source_required');
    seed.close();
    const sqlite = new DatabaseSync(join(f.stateRoot, 'continuity.sqlite')); sqlite.prepare('UPDATE seed_meta SET generation=99').run(); sqlite.close();
    assert.throws(() => new ContinuitySeed(f.root, { stateRoot: f.stateRoot }), error => error.code === 'seed_schema_unsupported');
  } finally { f.clean(); }
});

test('Seed event custody is append-only', () => {
  const f = fixture(); try {
    const seed = new ContinuitySeed(f.root, { stateRoot: f.stateRoot }); seed.setObjective('Keep evidence.', { actor: 'human', provenance: 'explicit_human' });
    assert.throws(() => seed.sqlite.exec('DELETE FROM seed_events'), /append-only/); seed.close();
  } finally { f.clean(); }
});
