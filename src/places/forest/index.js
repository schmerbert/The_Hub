import { placeModule } from '../declaration.js';

export const FOREST_PLACE = placeModule({
  id: 'place.forest',
  nodes: [
    ['place.forest', 'place', 'The Resident Forest. Paths begin beneath a canopy projected from forest.resident; the Garden treeline remains behind.', { occupiable: true, place: 'forest', projects: 'forest.resident' }, 'standing', 1],
  ],
  edges: [],
  mountedTools: ['move_through_passage'],
});
