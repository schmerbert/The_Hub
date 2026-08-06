export const MOVE_TOOL = { type: 'function', function: { name: 'move_through_door', description: 'Move through a declared door from the current room.', parameters: { type: 'object', properties: { door_id: { type: 'string' } }, required: ['door_id'], additionalProperties: false } } };
export const WORKSHOP_TOOLS = [
  { type: 'function', function: { name: 'workshop_list', description: 'List exact names and types in a repository directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_read', description: 'Read an exact bounded contiguous source line range.', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, line_count: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_search', description: 'Search exact source lines with bounded results.', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer', minimum: 1 } }, required: ['query'], additionalProperties: false } } },
];
export function schemasForRoom(roomId) { return roomId === 'room.center' ? [MOVE_TOOL] : roomId === 'room.workshop' ? [MOVE_TOOL, ...WORKSHOP_TOOLS] : []; }
export const TOOL_NAMES = new Set([MOVE_TOOL.function.name, ...WORKSHOP_TOOLS.map(tool => tool.function.name)]);
