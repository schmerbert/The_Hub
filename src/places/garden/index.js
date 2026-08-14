import { placeModule } from '../declaration.js';

export const GARDEN = placeModule({
  id: 'place.garden',
  nodes: [
    ['place.garden', 'place', 'An exterior junction. The House is west, the Forest north, the Road east, and the Hub south.', { occupiable: true, place: 'garden' }, 'standing', 1],
    ['boundary.forest', 'boundary', 'The Forest is north. Crossing is not installed.', { occupiable: false, traversable: false }, 'standing', 1],
    ['boundary.road', 'boundary', 'The Road continues east out of sight. Crossing is not installed.', { occupiable: false, traversable: false }, 'standing', 1],
    ['fixture.garden_turning_stone', 'fixture', 'A stone in the Garden can be turned.', { engageable: false, turnable: true }, 'standing', 1],
  ],
  edges: [
    ['edge.contains.garden_stone', 'contains', 'place.garden', 'fixture.garden_turning_stone', null, 'Turning stone'],
    ['edge.boundary.garden_forest', 'boundary', 'place.garden', 'boundary.forest', null, 'Forest boundary'],
    ['edge.boundary.garden_road', 'boundary', 'place.garden', 'boundary.road', null, 'Road boundary'],
  ],
  objectStates: [{ objectId: 'fixture.garden_turning_stone', state: { turnCount: 0 }, revision: 1 }],
  mountedTools: ['move_through_passage', 'operate_passage', 'inspect_fixture', 'turn_fixture'],
});
