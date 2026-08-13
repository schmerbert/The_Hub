import { deepFreeze } from './immutable.js';

export function createReplayWireKit() {
  const records = [];
  let currentInstant = null;
  const capabilities = deepFreeze({
    'storage.append_only': deepFreeze({
      append(record) {
        records.push(deepFreeze(structuredClone(record)));
        return records.length;
      }
    }),
    'clock.replay': deepFreeze({
      set(instant) { currentInstant = new Date(instant).toISOString(); },
      now() {
        if (currentInstant === null) throw new Error('Replay clock has not advanced');
        return currentInstant;
      }
    })
  });
  return deepFreeze({ capabilities, records: () => deepFreeze(structuredClone(records)) });
}
