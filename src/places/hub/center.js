import { placeModule } from '../declaration.js';

export const CENTER = placeModule({
  id: 'room.center',
  nodes: [
    ['room.center', 'room', 'The Center. Packed sand lies under a low stone bench and a small tin cup; the Workshop door stands nearby.', { room: 'center' }, 'standing'],
    ['fixture.packed_sand', 'fixture', 'Packed sand makes the Center floor.', { material: 'packed_sand' }, 'standing'],
    ['fixture.stone_bench', 'fixture', 'A low stone bench carries the weight of the room.', { material: 'stone' }, 'standing'],
    ['object.tin_cup', 'object', 'A small tin cup. Its contents are unspecified.', { material: 'tin', contents: 'unspecified' }, 'standing'],
  ],
  edges: [
    ['edge.contains.center.packed_sand', 'contains', 'room.center', 'fixture.packed_sand', null, null],
    ['edge.contains.center.stone_bench', 'contains', 'room.center', 'fixture.stone_bench', null, null],
    ['edge.contains.center.tin_cup', 'contains', 'room.center', 'object.tin_cup', null, null],
  ],
  mountedTools: ['move_through_door', 'move_through_passage', 'inspect_fixture'],
});

export const HUB_CONTAINER = placeModule({
  id: 'place.hub',
  nodes: [['place.hub', 'place', 'The existing Hub container; not occupiable.', { occupiable: false, place: 'hub' }, 'standing', 1]],
  edges: [
    ['edge.contains.hub_center', 'contains', 'place.hub', 'room.center', null, 'Center'],
    ['edge.contains.hub_workshop', 'contains', 'place.hub', 'room.workshop', null, 'Workshop'],
  ],
});

export const CENTER_EXTENSION = placeModule({
  id: 'object.marker',
  nodes: [['object.marker', 'object', 'A marker is present in the Center.', { object: 'marker' }, 'standing', 1]],
  edges: [['edge.contains.center_marker', 'contains', 'room.center', 'object.marker', null, 'Marker']],
});
