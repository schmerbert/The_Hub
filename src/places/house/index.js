import { placeModule } from '../declaration.js';

export const HOUSE = placeModule({
  id: 'place.house',
  nodes: [
    ['place.house', 'place', 'One undivided interior space. Its front door opens to the Garden. A blank window is set inside near the door.', { occupiable: true, place: 'house' }, 'standing', 1],
    ['object.front_door', 'object', 'The front door joins the Garden and House.', { object: 'front_door' }, 'standing', 1],
    ['fixture.house_window', 'fixture', 'A blank interior window is set near the front door.', { fixture: 'house_window' }, 'standing', 1],
  ],
  edges: [
    ['edge.contains.house_window', 'contains', 'place.house', 'fixture.house_window', null, 'Blank window'],
    ['edge.contains.garden_front_door', 'contains', 'place.garden', 'object.front_door', null, 'Front door'],
    ['edge.contains.house_front_door', 'contains', 'place.house', 'object.front_door', null, 'Front door'],
  ],
  objectStates: [{ objectId: 'object.front_door', state: { locked: false, open: false }, revision: 1 }],
  mountedTools: ['move_through_passage', 'operate_passage', 'inspect_fixture', 'tend_hearth'],
});

export const HEARTH = placeModule({
  id: 'fixture.hearth',
  nodes: [['fixture.hearth', 'fixture', 'A tended fire stands in the House.', { fixture: 'hearth', engageable: false }, 'standing', 1]],
  edges: [['edge.contains.house_hearth', 'contains', 'place.house', 'fixture.hearth', null, 'Hearth']],
});
