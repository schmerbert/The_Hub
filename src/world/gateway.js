import { scrubHostReturn } from '../scrub/host-return.js';
import { TOOL_NAMES } from './tools.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parseArguments(call) {
  if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') fail('world_tool_invalid', 'Tool intent is malformed.');
  if (!TOOL_NAMES.has(call.function.name)) fail('world_tool_unknown', 'The requested capability is not installed.');
  let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { fail('world_tool_invalid', 'Tool arguments are not valid JSON.'); }
  if (!args || Array.isArray(args) || typeof args !== 'object') fail('world_tool_invalid', 'Tool arguments must be an object.');
  return { call, name: call.function.name, args };
}

export class WorldActionGateway {
  constructor({ world, workshop, forest = null }) { this.world = world; this.workshop = workshop; this.forest = forest; }
  schemas(sessionId) { return this.world.availableTools(sessionId); }
  execute({ sessionId, wakeId, requestRecordId, spineRecordId, intent }) {
    const parsed = parseArguments(intent); const room = this.world.current(sessionId).room_node_id;
    const isWorkshop = parsed.name.startsWith('workshop_'); if (isWorkshop && room !== 'room.workshop') fail('world_wrong_room', 'Workshop tools are unavailable outside the Workshop.');
    let result; let source = null;
    if (parsed.name === 'move_through_door') result = this.world.move({ sessionId, wakeId, doorId: parsed.args.door_id });
    else if (parsed.name === 'workshop_list') result = this.workshop.list(parsed.args.path || '.');
    else if (parsed.name === 'workshop_read') { result = this.workshop.read(parsed.args.path, parsed.args.start_line || 1, parsed.args.line_count || undefined); this.world.inspect(sessionId, result.source.path); source = { sourceKind: 'workshop_read', source: result.source }; }
    else if (parsed.name === 'workshop_search') { result = this.workshop.search(parsed.args.query, parsed.args.path || '.', parsed.args.max_results || undefined); this.world.inspect(sessionId, result.path); source = { sourceKind: 'workshop_search', source: result }; }
    else fail('world_tool_unknown', 'The requested capability is not installed.');
    const actionReceipt = this.world.actionReceipt({ sessionId, wakeId, roomNodeId: room, toolName: parsed.name, arguments: parsed.args, result, outcome: 'committed', requestRecordId, spineRecordId });
    const scrub = scrubHostReturn({ toolName: parsed.name, toolCallId: parsed.call.id, arguments: parsed.args, result, roomId: room, actionReceiptId: actionReceipt.receiptId, requestRecordId, spineRecordId });
    const wild = source && this.forest ? this.forest.ingestWorkshopSource({ ...source, actionReceiptId: actionReceipt.receiptId, spineRecordId, requestRecordId }) : [];
    return { ...parsed, result, scrub, actionReceipt, wild, changedRoom: parsed.name === 'move_through_door', projection: this.world.projection(sessionId) };
  }
  refuse({ sessionId, wakeId, requestRecordId, spineRecordId = null, intent, error }) {
    const name = intent?.function?.name || 'unknown'; const room = this.world.current(sessionId).room_node_id;
    let refusedArguments = { raw_arguments: intent?.function?.arguments || '' }; try { refusedArguments = JSON.parse(intent?.function?.arguments || '{}'); } catch {}
    const result = { ok: false, error: error?.code || 'world_tool_refused', message: error?.message || 'The action was refused.' };
    const receipt = this.world.actionReceipt({ sessionId, wakeId, roomNodeId: room, toolName: name, arguments: refusedArguments, result, outcome: 'refused', requestRecordId, spineRecordId });
    const scrub = scrubHostReturn({ toolName: name, toolCallId: intent?.id || null, arguments: refusedArguments, result, roomId: room, actionReceiptId: receipt.receiptId, requestRecordId, spineRecordId });
    return { name, result, scrub, actionReceipt: receipt, wild: [] };
  }
}

export { parseArguments as parseWorldToolIntent };
