import { placeModule } from '../declaration.js';

export const THRESHOLD = placeModule({
  id: 'place.threshold',
  nodes: [['place.threshold', 'place', 'A threshold adjoining the House. No arrival story is implied.', { occupiable: true, place: 'threshold' }, 'standing', 1]],
  mountedTools: ['move_through_passage'],
});
