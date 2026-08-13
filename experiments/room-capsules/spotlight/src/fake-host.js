import { deepFreeze } from './canonical.js';

export function createFakeHost({ replay = true, bindReplay = true, marketDelivery = false, bindMarketDelivery = true, outbox = false, bindOutbox = true } = {}) {
  const records = [];
  let replayNow = null;
  const capabilities = {};
  const bindings = {};
  if (replay) {
    capabilities['storage.append_only'] = deepFreeze({
      append(record) {
        records.push(deepFreeze(structuredClone(record)));
        return records.length;
      }
    });
    capabilities['clock.replay'] = deepFreeze({
      set(instant) { replayNow = new Date(instant).toISOString(); },
      now() {
        if (!replayNow) throw new Error('Replay clock has not advanced');
        return replayNow;
      }
    });
    if (bindReplay) {
      bindings['socket.packet_custody'] = 'storage.append_only';
      bindings['socket.replay_clock'] = 'clock.replay';
    }
  }
  if (marketDelivery) {
    capabilities['channel.market_delivery'] = deepFreeze({ kind: 'fake_market_delivery' });
    if (bindMarketDelivery) bindings['socket.market_observations'] = 'channel.market_delivery';
  }
  if (outbox) {
    capabilities['outbox.resident'] = deepFreeze({ kind: 'fake_resident_outbox' });
    if (bindOutbox) bindings['socket.resident_outbox'] = 'outbox.resident';
  }
  return deepFreeze({
    capabilities: deepFreeze(capabilities),
    bindings: deepFreeze(bindings),
    records() { return deepFreeze(structuredClone(records)); }
  });
}
