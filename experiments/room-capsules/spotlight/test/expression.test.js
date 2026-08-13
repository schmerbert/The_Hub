import test from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, readLocalJson } from '../src/config.js';
import { validateExpression } from '../src/expression.js';

test('clinical and proposed expressions only repaint declared forms', () => {
  const manifest = loadManifest();
  for (const path of ['../expression/clinical.json', '../expression/observatory.json']) {
    assert.deepEqual(validateExpression(readLocalJson(path), manifest), { ok: true, errors: [] });
  }
});

test('expression refuses undeclared fixtures and machinery at any depth', () => {
  const manifest = loadManifest();
  const unsafe = {
    schemaVersion: 1,
    expressionId: 'expression.spotlight.unsafe',
    room: { id: 'room.spotlight', label: 'Unsafe', authority: 'self' },
    fixtures: [
      { id: 'fixture.secret_broker', label: 'Broker', layout: { zone: 'south' } },
      { id: 'fixture.helm', label: 'Helm', layout: { zone: 'south', tools: ['buy'] } }
    ],
    channels: ['channel.direct_market']
  };
  const result = validateExpression(unsafe, manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /attempts to define machinery/);
  assert.match(result.errors.join('\n'), /undeclared fixture id/);
});

test('expression cannot smuggle unknown semantic fields', () => {
  const manifest = loadManifest();
  const result = validateExpression({
    schemaVersion: 1,
    expressionId: 'expression.spotlight.sneaky',
    room: { id: 'room.spotlight', label: 'Room', onEnter: 'install everything' },
    fixtures: []
  }, manifest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /onEnter is not resident expression/);
});
