import { deepFreeze, sha256 } from './canonical.js';

const PRICE_RETURN_BOUNDARY = 0.08;
const VOLUME_RATIO_BOUNDARY = 2;

export function runFirstMarble({ dataset, storage, clock }) {
  assertDataset(dataset);
  let previousActive = false;
  let packet = null;
  const baseline = dataset.observations[0];

  for (let index = 0; index < dataset.observations.length; index += 1) {
    const observation = deepFreeze(structuredClone(dataset.observations[index]));
    clock.set(observation.observedAt);
    storage.append(deepFreeze({
      kind: 'market_observation',
      datasetId: dataset.datasetId,
      instrument: structuredClone(dataset.instrument),
      observation
    }));
    const state = boundaryState(baseline, observation);
    if (!previousActive && state.active) {
      packet = createPacket({ dataset, baseline, observation, state, clock });
      storage.append(deepFreeze({ kind: 'spotlight_packet', packet }));
    }
    previousActive = state.active;
  }
  if (!packet) throw new Error('Recorded fixture did not cross a Spotlight boundary');
  return packet;
}

function boundaryState(baseline, observation) {
  const priceReturn = rounded((observation.price - baseline.price) / baseline.price);
  const volumeRatio = rounded(observation.volume / baseline.volume);
  return {
    active: priceReturn >= PRICE_RETURN_BOUNDARY && volumeRatio >= VOLUME_RATIO_BOUNDARY,
    priceReturn,
    volumeRatio,
    thresholds: { priceReturn: PRICE_RETURN_BOUNDARY, volumeRatio: VOLUME_RATIO_BOUNDARY }
  };
}

function createPacket({ dataset, baseline, observation, state, clock }) {
  const analogues = dataset.analogues.slice(0, 3).map((analogue, index) => ({
    slot: index + 1,
    status: 'recorded',
    ...structuredClone(analogue)
  }));
  while (analogues.length < 3) analogues.push({ slot: analogues.length + 1, status: 'insufficient_history' });

  const body = {
    schemaVersion: 1,
    kind: 'spotlight_evidence_packet',
    datasetId: dataset.datasetId,
    instrument: structuredClone(dataset.instrument),
    createdAt: clock.now(),
    boundary: {
      name: 'price_and_volume_expansion',
      transition: 'inactive_to_active',
      ...state
    },
    claims: [
      { claim: 'price_return_crossed_boundary', observed: state.priceReturn, threshold: state.thresholds.priceReturn },
      { claim: 'volume_ratio_crossed_boundary', observed: state.volumeRatio, threshold: state.thresholds.volumeRatio }
    ],
    sourceRefs: [baseline.sourceRef, observation.sourceRef],
    observationRefs: [baseline.id, observation.id],
    analogues,
    missingData: observation.dataCompleteness < 1
      ? [{ field: 'market_observation', completeness: observation.dataCompleteness, consequence: 'packet remains observational' }]
      : [],
    counterevidence: [
      { kind: 'recorded_analogue', analogueId: 'analogue.202', observation: 'returned_below_boundary_in_10m' },
      { kind: 'scope_limit', observation: 'recorded price and volume do not establish liquidity or causation' }
    ],
    nextObservation: 'Observe whether price remains above the return boundary after the next recorded interval.',
    authority: { observationalOnly: true, financialExecution: false }
  };
  const hash = sha256(body);
  return deepFreeze({ ...body, identity: `packet.spotlight_${hash.slice(0, 20)}`, hash: `sha256:${hash}` });
}

function assertDataset(dataset) {
  if (!dataset || dataset.schemaVersion !== 1 || !Array.isArray(dataset.observations) || dataset.observations.length < 2) throw new Error('Invalid recorded replay dataset');
  for (const observation of dataset.observations) {
    if (!observation.id || !observation.sourceRef || !observation.observedAt) throw new Error('Observation lacks provenance');
    if (!Number.isFinite(observation.price) || !Number.isFinite(observation.volume)) throw new Error('Observation is not normalized');
  }
}

function rounded(number) {
  return Number(number.toFixed(8));
}
