import { placeModule } from '../../declaration.js';

export const WORKSHOP = placeModule({
  id: 'room.workshop',
  nodes: [
    ['room.workshop', 'room', 'The Workshop. Shelves hold the repository close to a scarred workbench; a kiln, ledger, and clipboard keep their separate places. Tools are mounted here without engaging; engagement is orientation only.', { room: 'workshop' }, 'standing'],
    ['fixture.workshop_shelves', 'fixture', 'Shelves hold the repository where it can be examined as it is.', { engageable: true, fixture: 'shelves' }, 'standing'],
    ['fixture.workshop_workbench', 'fixture', 'The workbench is a heavy surface for cuts and changes; pending cuts wait here for the Builder.', { engageable: true, fixture: 'workbench' }, 'standing'],
    ['fixture.workshop_kiln', 'fixture', 'The kiln accepts a named recipe and keeps its running state.', { engageable: true, fixture: 'kiln' }, 'standing'],
    ['fixture.workshop_ledger', 'fixture', 'The ledger keeps history, staging, and landing in one standing record.', { engageable: true, fixture: 'ledger' }, 'standing'],
    ['fixture.workshop_clipboard', 'fixture', 'The clipboard holds an objective, scope, and acceptance before work begins.', { engageable: true, fixture: 'clipboard' }, 'standing'],
    ['station.spec_table', 'station', 'Spec Table. Retired Workshop station.', { station: 'spec_table', retired: true }, 'retired'],
    ['station.control_panel', 'station', 'Control Panel. Retired Workshop station.', { station: 'control_panel', retired: true }, 'retired'],
  ],
  edges: [
    ['edge.contains.workshop.shelves', 'contains', 'room.workshop', 'fixture.workshop_shelves', null, null],
    ['edge.contains.workshop.workbench', 'contains', 'room.workshop', 'fixture.workshop_workbench', null, null],
    ['edge.contains.workshop.kiln', 'contains', 'room.workshop', 'fixture.workshop_kiln', null, null],
    ['edge.contains.workshop.ledger', 'contains', 'room.workshop', 'fixture.workshop_ledger', null, null],
    ['edge.contains.workshop.clipboard', 'contains', 'room.workshop', 'fixture.workshop_clipboard', null, null],
  ],
});
