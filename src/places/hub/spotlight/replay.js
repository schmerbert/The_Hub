import { readFileSync } from 'node:fs';
import { clone, deepFreeze, isPlainObject, sha256 } from './canonical.js';
import { admitSpotlightObservation } from './observation.js';

export const SPOTLIGHT_PACKET_API = 'spotlight-packet.v1';
const REPLAY_FIXTURE_URL = new URL('./fixtures/recorded-replay.json', import.meta.url);
const PRICE_RETURN_BOUNDARY = 0.08;
const VOLUME_RATIO_BOUNDARY = 2;
const MAX_OBSERVATIONS = 2_000;

function fail(message, code = 'spotlight_replay_invalid') {
  throw Object.assign(new Error(message), { code });
}

function assertDataset(dataset) {
  if (!isPlainObject(dataset) || dataset.schemaVersion !== 1 || typeof dataset.datasetId !== 'string' || !isPlainObject(dataset.instrument) || !Array.isArray(dataset.observations) || dataset.observations.length < 2 || dataset.observations.length > MAX_OBSERVATIONS || !Array.isArray(dataset.analogues)) fail('Recorded Spotlight replay dataset is invalid.');
  if (typeof dataset.instrument.id !== 'string' || typeof dataset.instrument.quote !== 'string') fail('Recorded Spotlight replay instrument is invalid.');
  const ids = new Set();
  let previousAt = -Infinity;
  for (const [index, observation] of dataset.observations.entries()) {
    if (!isPlainObject(observation) || typeof observation.id !== 'string' || typeof observation.sourceRef !== 'string' || typeof observation.observedAt !== 'string') fail(`Recorded Spotlight observation ${index} lacks provenance.`);
    if (ids.has(observation.id)) fail('Recorded Spotlight replay contains a duplicate observation id.');
    ids.add(observation.id);
    if (!Number.isFinite(observation.price) || !Number.isFinite(observation.volume) || observation.price <= 0 || observation.volume <= 0) fail(`Recorded Spotlight observation ${index} is not normalized.`);
    if (observation.dataCompleteness !== undefined && (!Number.isFinite(observation.dataCompleteness) || observation.dataCompleteness < 0 || observation.dataCompleteness > 1)) fail(`Recorded Spotlight observation ${index} completeness is invalid.`);
    const at = Date.parse(observation.observedAt);
    if (!Number.isFinite(at) || at <= previousAt) fail('Recorded Spotlight observations must be strictly chronological.');
    previousAt = at;
  }
  for (const analogue of dataset.analogues) {
    if (!isPlainObject(analogue) || typeof analogue.id !== 'string' || !Array.isArray(analogue.sourceRefs)) fail('Recorded Spotlight analogue lacks provenance.');
  }
}

function boundaryState(baseline, observation) {
  const priceReturn = rounded((observation.price - baseline.price) / baseline.price);
  const volumeRatio = rounded(observation.volume / baseline.volume);
  return {
    active: priceReturn >= PRICE_RETURN_BOUNDARY && volumeRatio >= VOLUME_RATIO_BOUNDARY,
    priceReturn,
    volumeRatio,
    thresholds: { priceReturn: PRICE_RETURN_BOUNDARY, volumeRatio: VOLUME_RATIO_BOUNDARY },
  };
}

function rounded(number) {
  return Number(number.toFixed(8));
}

function toObservation(dataset, raw, receivedAt) {
  const fields = {
    price: { status: 'present', value: raw.price },
    volume: { status: 'present', value: raw.volume },
    data_completeness: raw.dataCompleteness === undefined
      ? { status: 'missing', reason: 'recorded fixture did not declare field completeness' }
      : { status: 'present', value: raw.dataCompleteness },
  };
  const missing = Object.entries(fields).filter(([, field]) => field.status === 'missing').map(([key]) => key);
  if (raw.dataCompleteness !== undefined && raw.dataCompleteness < 1) missing.push('market_observation');
  return admitSpotlightObservation({
    schemaVersion: 1,
    kind: 'spotlight_observation',
    source: { authority: 'recorded_market', reference: raw.sourceRef },
    instrument: { id: dataset.instrument.id, label: dataset.instrument.label || dataset.instrument.id, quote: dataset.instrument.quote },
    observedAt: new Date(raw.observedAt).toISOString(),
    receivedAt,
    fields,
    freshness: { status: 'observed', asOf: new Date(raw.observedAt).toISOString() },
    completeness: { status: missing.length ? 'partial' : 'complete', missing },
    authority: { observationalOnly: true, financialExecution: false },
  });
}

function createPacket({ dataset, baseline, observation, state, clock, baselinePacket, receivedAt }) {
  const body = {
    schemaVersion: 1,
    apiVersion: SPOTLIGHT_PACKET_API,
    kind: 'spotlight_packet',
    datasetId: dataset.datasetId,
    instrument: clone(dataset.instrument),
    createdAt: clock.now(),
    boundary: { name: 'price_and_volume_expansion', transition: 'inactive_to_active', ...state },
    claims: [
      { claim: 'price_return_crossed_boundary', observed: state.priceReturn, threshold: state.thresholds.priceReturn },
      { claim: 'volume_ratio_crossed_boundary', observed: state.volumeRatio, threshold: state.thresholds.volumeRatio },
    ],
    sourceRefs: [baseline.sourceRef, observation.sourceRef],
    observationRefs: [baseline.id, observation.id],
    observationPackets: [baselinePacket, toObservation(dataset, observation, receivedAt)],
    analogues: dataset.analogues.slice(0, 3).map((analogue, index) => ({ slot: index + 1, status: 'recorded', ...clone(analogue) })),
    missingData: observation.dataCompleteness < 1
      ? [{ field: 'market_observation', completeness: observation.dataCompleteness, consequence: 'packet remains observational' }]
      : [],
    counterevidence: [
      { kind: 'recorded_analogue', analogueId: 'analogue.202', observation: 'returned_below_boundary_in_10m' },
      { kind: 'scope_limit', observation: 'recorded price and volume do not establish liquidity or causation' },
    ],
    nextObservation: 'Observe whether price remains above the return boundary after the next recorded interval.',
    authority: { observationalOnly: true, financialExecution: false },
  };
  while (body.analogues.length < 3) body.analogues.push({ slot: body.analogues.length + 1, status: 'insufficient_history' });
  const hash = sha256(body);
  return deepFreeze({ ...body, identity: `packet.spotlight_${hash.slice(0, 20)}`, hash: `sha256:${hash}` });
}

export function runSpotlightReplay({ dataset, storage, clock }) {
  assertDataset(dataset);
  if (!storage || typeof storage.append !== 'function') fail('Spotlight replay requires host-owned append-only storage.', 'spotlight_replay_unwired');
  if (!clock || typeof clock.set !== 'function' || typeof clock.now !== 'function') fail('Spotlight replay requires a host-owned replay clock.', 'spotlight_replay_unwired');
  let previousActive = false;
  let packet = null;
  const baseline = dataset.observations[0];
  for (const raw of dataset.observations) {
    const receivedAt = new Date(raw.observedAt).toISOString();
    clock.set(receivedAt);
    const admitted = toObservation(dataset, raw, receivedAt);
    storage.append(deepFreeze({ kind: 'spotlight_observation', observation: admitted }));
    const state = boundaryState(baseline, raw);
    if (!previousActive && state.active) {
      packet = createPacket({ dataset, baseline, observation: raw, state, clock, baselinePacket: toObservation(dataset, baseline, new Date(baseline.observedAt).toISOString()), receivedAt });
      storage.append(deepFreeze({ kind: 'spotlight_packet', packet }));
    }
    previousActive = state.active;
  }
  if (!packet) fail('Recorded Spotlight fixture did not cross a boundary.');
  return packet;
}

export const replayFirstSpotlight = runSpotlightReplay;

export function loadSpotlightReplayFixture() {
  return deepFreeze(JSON.parse(readFileSync(REPLAY_FIXTURE_URL, 'utf8')));
}
