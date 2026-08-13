import { createSpotlightCapsule } from './src/capsule.js';
import { createFakeHost } from './src/fake-host.js';

const capsule = createSpotlightCapsule();
const bare = capsule.inspect();
const fakeHost = createFakeHost();
const replay = capsule.inspect(fakeHost);
const packet = capsule.replayFirstMarble(fakeHost);

console.log(JSON.stringify({ bare, replay, packet, retainedRecords: fakeHost.records().length }, null, 2));
