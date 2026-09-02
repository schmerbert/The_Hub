import { placeModule } from '../../declaration.js';
import { SPOTLIGHT_TOOL_NAMES } from './tools.js';

// Spotlight is installed as a room shell, not as a source of authority.  The
// host owns the door, sockets, and every future observation crossing.
export const SPOTLIGHT = placeModule({
  id: 'room.spotlight',
  // Room movement is World-owned and remains separate from the observatory's
  // provider-facing hands.  It is safe to mount because the door event is the
  // sole authority that can make the route reachable.
  mountedTools: ['move_through_door', ...SPOTLIGHT_TOOL_NAMES],
  nodes: [
    [
      'room.spotlight',
      'room',
      'The Spotlight Observatory. A sheltered balcony looks across a wide landscape; a capped telescope rests beside the charting table. The Resident spots the light rather than standing beneath it.',
      { room: 'spotlight', expression: 'observatory', entrance: 'withheld_until_verified_observation_wire' },
      'standing',
    ],
    [
      'fixture.spotlight_landscape',
      'fixture',
      'The landscape holds retained observations already in custody. Looking across it does not poll, stream, or refresh.',
      { fixture: 'landscape', passive: true, source: 'retained_observations' },
      'standing',
    ],
    [
      'fixture.spotlight_telescope',
      'fixture',
      'The telescope is capped until a host-owned read-only observation wire is verified. Inquiry is deliberate; entering the room never initiates a request.',
      { fixture: 'telescope', capped: true, effect: 'observe' },
      'standing',
    ],
    [
      'fixture.spotlight_archive',
      'fixture',
      'The archive keeps attributable past observations and recorded analogues distinct from the present landscape.',
      { fixture: 'archive', passive: true, source: 'recorded_observations' },
      'standing',
    ],
    [
      'fixture.spotlight_table',
      'fixture',
      'The charting table holds immutable evidence packets, comparison, counterevidence, missing-data disclosure, and the next observation worth making.',
      { fixture: 'table', immutablePackets: true, effect: 'observe' },
      'standing',
    ],
    [
      'fixture.spotlight_bell',
      'fixture',
      'The bell marks a crossed-attention boundary. It is not an alert subscription, conclusion, recommendation, or autonomous wake.',
      { fixture: 'bell', policyBoundary: true, autonomous: false },
      'standing',
    ],
  ],
  edges: [
    ['edge.contains.spotlight_landscape', 'contains', 'room.spotlight', 'fixture.spotlight_landscape', null, 'Landscape'],
    ['edge.contains.spotlight_telescope', 'contains', 'room.spotlight', 'fixture.spotlight_telescope', null, 'Telescope'],
    ['edge.contains.spotlight_archive', 'contains', 'room.spotlight', 'fixture.spotlight_archive', null, 'Archive'],
    ['edge.contains.spotlight_table', 'contains', 'room.spotlight', 'fixture.spotlight_table', null, 'Charting Table'],
    ['edge.contains.spotlight_bell', 'contains', 'room.spotlight', 'fixture.spotlight_bell', null, 'Bell'],
  ],
});
