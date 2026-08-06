import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeResidentProvider } from '../src/providers/fake.js';
import { prepareProviderRequest } from '../src/providers/dispatch.js';
import {
  assertScrubbedPresentation,
  scrubProviderHistory,
  verifyScrubbedProjection,
} from '../src/scrub/provider-presentation.js';

const source = [
  { role: 'system', content: 'ground' },
  { role: 'user', content: 'exact user words' },
  { role: 'assistant', content: 'exact resident words' },
];

function withMessages(presentation, messages) {
  const forged = Object.create(presentation);
  Object.defineProperty(forged, 'messages', { value: messages, enumerable: true });
  return forged;
}

test('identity provider scrub is an exact source projection', () => {
  const presentation = scrubProviderHistory(source);
  assert.deepEqual(presentation.messages, source);
  assert.equal(presentation.receipt.sourceCount, source.length);
  assert.equal(presentation.receipt.outputCount, source.length);
  assert.deepEqual(presentation.receipt.omissions, []);
  assert.equal(verifyScrubbedProjection(source, presentation), true);
});

test('subtractive scrub receipts identify every omitted source position', () => {
  const presentation = scrubProviderHistory(source, {
    omissions: [{ sourceIndex: 1, reason: 'display-only fixture span' }],
  });
  assert.deepEqual(presentation.messages, [source[0], source[2]]);
  assert.deepEqual(presentation.receipt.omissions, [{ sourceIndex: 1, start: 0, end: source[1].content.length, reason: 'display-only fixture span' }]);
  assert.equal(verifyScrubbedProjection(source, presentation), true);
  assert.throws(() => verifyScrubbedProjection(source.slice(1), presentation), /exact ordered source projection/);
});

test('content-span omissions remove exact source ranges without changing role or order', () => {
  const spanSource = [{ role: 'user', content: 'keep [scaffold] keep' }, { role: 'assistant', content: 'answer' }];
  const presentation = scrubProviderHistory(spanSource, {
    omissions: [{ sourceIndex: 0, start: 5, end: 15, reason: 'scaffolding wrapper' }],
  });
  assert.deepEqual(presentation.messages, [{ role: 'user', content: 'keep  keep' }, spanSource[1]]);
  assert.deepEqual(presentation.receipt.omissions, [{ sourceIndex: 0, start: 5, end: 15, reason: 'scaffolding wrapper' }]);
  assert.equal(verifyScrubbedProjection(spanSource, presentation), true);
});

test('mutation, reorder, paraphrase, insertion, and undeclared omission are refused', () => {
  const presentation = scrubProviderHistory(source);
  const cases = [
    ['mutation', withMessages(presentation, [{ ...source[0], content: 'changed' }, ...source.slice(1)])],
    ['reorder', withMessages(presentation, [source[1], source[0], source[2]])],
    ['paraphrase', withMessages(presentation, [source[0], source[1], { role: 'assistant', content: 'a paraphrase' }])],
    ['insertion', withMessages(presentation, [...source, { role: 'user', content: 'inserted' }])],
    ['undeclared omission', withMessages(presentation, source.slice(0, 2))],
  ];
  for (const [label, forged] of cases) {
    assert.throws(() => assertScrubbedPresentation(forged), /receipt does not match|exact ordered/, label);
    assert.throws(() => verifyScrubbedProjection(source, forged), /receipt does not match|exact ordered/, label);
  }
});

test('provider dispatch requires the validated presentation contract', () => {
  const provider = new FakeResidentProvider();
  assert.throws(() => provider.prepareRequest({ messages: source, model: 'test-model' }), /validated ScrubbedPresentation/);
  const presentation = scrubProviderHistory(source);
  const prepared = provider.prepareRequest({ presentation, model: 'test-model' });
  assert.deepEqual(JSON.parse(prepared.requestBodyString).messages, source);
});

test('legacy provider bridge receives messages only after presentation validation', () => {
  let received;
  const legacy = {
    prepareRequest(input) {
      received = input;
      return { requestBody: { model: input.model, messages: input.messages } };
    },
  };
  assert.throws(() => prepareProviderRequest(legacy, { presentation: { messages: source }, model: 'test-model' }), /validated ScrubbedPresentation/);
  const presentation = scrubProviderHistory(source);
  const prepared = prepareProviderRequest(legacy, { presentation, model: 'test-model' });
  assert.deepEqual(received.messages, presentation.messages);
  assert.deepEqual(prepared.requestBody.messages, source);
});
