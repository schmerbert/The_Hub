import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { id, sha256 } from '../core/hash.js';

const NOW = () => new Date().toISOString();
const SEED_NODES = [
  ['room.center', 'room', 'The Center. A packed-sand floor, a low stone bench, and a small tin cup. One Workshop door is present.', { room: 'center' }],
  ['room.workshop', 'room', 'The Workshop. A read-only place to inspect the Hub repository.', { room: 'workshop' }],
  ['fixture.packed_sand', 'fixture', 'A floor of packed sand.', { material: 'packed_sand' }],
  ['fixture.stone_bench', 'fixture', 'A low stone bench.', { material: 'stone' }],
  ['object.tin_cup', 'object', 'A small tin cup. Its contents are unspecified.', { material: 'tin', contents: 'unspecified' }],
];
const SEED_EDGES = [
  ['edge.door.workshop.center_to_workshop', 'door', 'room.center', 'room.workshop', 'door.workshop', 'Workshop'],
  ['edge.door.workshop.workshop_to_center', 'door', 'room.workshop', 'room.center', 'door.workshop', 'Center'],
  ['edge.contains.center.packed_sand', 'contains', 'room.center', 'fixture.packed_sand', null, null],
  ['edge.contains.center.stone_bench', 'contains', 'room.center', 'fixture.stone_bench', null, null],
  ['edge.contains.center.tin_cup', 'contains', 'room.center', 'object.tin_cup', null, null],
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS world_nodes (id TEXT PRIMARY KEY, node_type TEXT NOT NULL CHECK(node_type IN ('room','fixture','object')), resident_text TEXT NOT NULL, state_json TEXT NOT NULL, lifecycle TEXT NOT NULL CHECK(lifecycle IN ('standing','retired')), revision INTEGER NOT NULL CHECK(revision>0), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_edges (id TEXT PRIMARY KEY, edge_type TEXT NOT NULL CHECK(edge_type IN ('door','contains')), from_node_id TEXT NOT NULL REFERENCES world_nodes(id), to_node_id TEXT NOT NULL REFERENCES world_nodes(id), door_identity TEXT, label TEXT, created_at TEXT NOT NULL, UNIQUE(edge_type, from_node_id, to_node_id));
CREATE TABLE IF NOT EXISTS world_locations (session_id TEXT PRIMARY KEY, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), inspected_source TEXT, revision INTEGER NOT NULL CHECK(revision>0), started_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_location_events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, actor TEXT NOT NULL, from_room TEXT REFERENCES world_nodes(id), to_room TEXT NOT NULL REFERENCES world_nodes(id), edge_id TEXT REFERENCES world_edges(id), door_identity TEXT, created_at TEXT NOT NULL, attribution_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_action_receipts (receipt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, room_node_id TEXT NOT NULL REFERENCES world_nodes(id), tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('committed','refused')), request_record_id TEXT, spine_record_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS world_location_events_session_order ON world_location_events(session_id, created_at, event_id);
CREATE INDEX IF NOT EXISTS world_action_receipts_session_order ON world_action_receipts(session_id, created_at, receipt_id);
CREATE TRIGGER IF NOT EXISTS world_nodes_append_only_update BEFORE UPDATE ON world_nodes BEGIN SELECT RAISE(ABORT, 'standing world nodes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS world_nodes_append_only_delete BEFORE DELETE ON world_nodes BEGIN SELECT RAISE(ABORT, 'standing world nodes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS world_edges_append_only_update BEFORE UPDATE ON world_edges BEGIN SELECT RAISE(ABORT, 'standing world edges are append-only'); END;
CREATE TRIGGER IF NOT EXISTS world_edges_append_only_delete BEFORE DELETE ON world_edges BEGIN SELECT RAISE(ABORT, 'standing world edges are append-only'); END;
CREATE TRIGGER IF NOT EXISTS world_location_events_append_only_update BEFORE UPDATE ON world_location_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_location_events_append_only_delete BEFORE DELETE ON world_location_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_action_receipts_append_only_update BEFORE UPDATE ON world_action_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS world_action_receipts_append_only_delete BEFORE DELETE ON world_action_receipts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

function assertWithin(root, target) {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Target escapes the repository root.');
}

export class WorldGraphStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
    this.sqlite.exec(SCHEMA);
    this.migrate();
    this.seed();
  }
  migrate() {
    const columns = this.sqlite.prepare('PRAGMA table_info(world_action_receipts)').all().map(column => column.name);
    if (!columns.includes('request_record_id')) this.sqlite.exec('ALTER TABLE world_action_receipts ADD COLUMN request_record_id TEXT');
    if (!columns.includes('spine_record_id')) this.sqlite.exec('ALTER TABLE world_action_receipts ADD COLUMN spine_record_id TEXT');
  }
  transaction(fn) { this.sqlite.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.sqlite.exec('COMMIT'); return result; } catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; } }
  seed() {
    const now = NOW();
    this.transaction(() => {
      for (const [nodeId, nodeType, text, state] of SEED_NODES) {
        const existing = this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(nodeId);
        if (existing && (existing.node_type !== nodeType || existing.resident_text !== text || existing.state_json !== JSON.stringify(state))) throw new Error(`World seed conflict for ${nodeId}.`);
        if (!existing) this.sqlite.prepare('INSERT INTO world_nodes VALUES(?,?,?,?,?,?,?)').run(nodeId, nodeType, text, JSON.stringify(state), 'standing', 1, now);
      }
      for (const [edgeId, type, from, to, door, label] of SEED_EDGES) {
        const existing = this.sqlite.prepare('SELECT * FROM world_edges WHERE id=?').get(edgeId);
        if (existing && (existing.edge_type !== type || existing.from_node_id !== from || existing.to_node_id !== to || (existing.door_identity || null) !== door)) throw new Error(`World seed conflict for ${edgeId}.`);
        if (!existing) this.sqlite.prepare('INSERT INTO world_edges VALUES(?,?,?,?,?,?,?)').run(edgeId, type, from, to, door, label, now);
      }
    });
  }
  ensureLifespan(sessionId) {
    const existing = this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId);
    if (existing) return existing;
    const now = NOW();
    this.sqlite.prepare('INSERT INTO world_locations VALUES(?,?,?,?,?,?)').run(sessionId, 'room.center', null, 1, now, now);
    return this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId);
  }
  current(sessionId) { return this.sqlite.prepare('SELECT * FROM world_locations WHERE session_id=?').get(sessionId) || this.ensureLifespan(sessionId); }
  node(nodeId) { return this.sqlite.prepare('SELECT * FROM world_nodes WHERE id=?').get(nodeId); }
  exits(roomId) { return this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='door' AND from_node_id=? ORDER BY id").all(roomId); }
  fixtures(roomId) { return this.sqlite.prepare("SELECT n.* FROM world_nodes n JOIN world_edges e ON e.to_node_id=n.id WHERE e.edge_type='contains' AND e.from_node_id=? ORDER BY n.id").all(roomId); }
  projection(sessionId) {
    const location = this.current(sessionId); const room = this.node(location.room_node_id);
    return { revision: location.revision, roomId: room.id, roomType: room.node_type, text: room.resident_text, fixtures: this.fixtures(room.id).map(item => ({ id: item.id, type: item.node_type, text: item.resident_text, state: JSON.parse(item.state_json) })), exits: this.exits(room.id).map(edge => ({ edgeId: edge.id, doorId: edge.door_identity, label: edge.label, to: edge.to_node_id })), inspectedSource: location.inspected_source || null };
  }
  availableTools(sessionId) {
    const room = this.current(sessionId).room_node_id;
    return room === 'room.center' ? ['move_through_door'] : room === 'room.workshop' ? ['move_through_door', 'workshop_list', 'workshop_read', 'workshop_search'] : [];
  }
  presenceMessage(sessionId) {
    const projection = this.projection(sessionId);
    const exits = projection.exits.length ? projection.exits.map(exit => `${exit.label} (${exit.doorId})`).join(', ') : 'none';
    const affordances = this.availableTools(sessionId).join(', ') || 'none';
    return `Current room (host state, not atmosphere): ${projection.roomId}. ${projection.text} Exits: ${exits}. Available native tools: ${affordances}.`;
  }
  move({ sessionId, wakeId, doorId, actor = 'resident_tool' }) {
    if (typeof doorId !== 'string' || !doorId) throw Object.assign(new Error('A door identity is required.'), { code: 'world_invalid_argument' });
    const current = this.current(sessionId); const edge = this.sqlite.prepare("SELECT * FROM world_edges WHERE edge_type='door' AND from_node_id=? AND door_identity=?").get(current.room_node_id, doorId);
    if (!edge) throw Object.assign(new Error('That door is not reachable from the current room.'), { code: 'world_wrong_room_or_door' });
    const now = NOW(); const eventId = id('location');
    this.transaction(() => {
      this.sqlite.prepare('UPDATE world_locations SET room_node_id=?, revision=revision+1, inspected_source=NULL, updated_at=? WHERE session_id=?').run(edge.to_node_id, now, sessionId);
      this.sqlite.prepare('INSERT INTO world_location_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(eventId, sessionId, wakeId || null, actor, current.room_node_id, edge.to_node_id, edge.id, edge.door_identity, now, JSON.stringify({ actor, wakeId: wakeId || null }));
    });
    return { eventId, edgeId: edge.id, doorId, fromRoom: current.room_node_id, toRoom: edge.to_node_id, projection: this.projection(sessionId) };
  }
  inspect(sessionId, source) { const now = NOW(); this.sqlite.prepare('UPDATE world_locations SET inspected_source=?, updated_at=? WHERE session_id=?').run(source || null, now, sessionId); }
  actionReceipt({ sessionId, wakeId, roomNodeId, toolName, arguments: args, result, outcome, requestRecordId = null, spineRecordId = null }) { const receiptId = id('action'); this.sqlite.prepare('INSERT INTO world_action_receipts(receipt_id,session_id,wake_id,room_node_id,tool_name,arguments_json,result_json,outcome,request_record_id,spine_record_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(receiptId, sessionId, wakeId || null, roomNodeId, toolName, JSON.stringify(args), JSON.stringify(result), outcome, requestRecordId, spineRecordId, NOW()); return { receiptId, requestRecordId, spineRecordId }; }
  listLocationEvents(sessionId) { return this.sqlite.prepare('SELECT * FROM world_location_events WHERE session_id=? ORDER BY created_at,event_id').all(sessionId); }
  close() { this.sqlite.close(); }
}

export function seedWorldGraph(path) { const store = new WorldGraphStore(path); const result = { nodes: store.sqlite.prepare('SELECT COUNT(*) AS count FROM world_nodes').get().count, edges: store.sqlite.prepare('SELECT COUNT(*) AS count FROM world_edges').get().count }; store.close(); return result; }

export function resolveRepositoryPath(root, requested, { allowMissing = false } = {}) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0') || isAbsolute(requested)) throw Object.assign(new Error('Workshop paths must be relative repository paths.'), { code: 'workshop_path_invalid' });
  const normalized = requested.replaceAll('\\', '/'); const parts = normalized.split('/');
  if (parts.includes('..') || parts.includes('') && normalized.startsWith('/')) throw Object.assign(new Error('Workshop traversal is refused.'), { code: 'workshop_path_invalid' });
  if (parts.some(part => part === '.git' || part === '.runtime' || /^\.env(?:\.|$)/i.test(part) || /(credential|secret|token|password)/i.test(part))) throw Object.assign(new Error('Workshop protected paths are refused.'), { code: 'workshop_path_forbidden' });
  const absoluteRoot = realpathSync(root); const absolute = join(absoluteRoot, ...parts); assertWithin(absoluteRoot, absolute);
  if (!existsSync(absolute) && !allowMissing) throw Object.assign(new Error('Workshop target does not exist.'), { code: 'workshop_not_found' });
  if (existsSync(absolute)) { const stat = lstatSync(absolute); if (stat.isSymbolicLink()) throw Object.assign(new Error('Workshop symlinks are refused.'), { code: 'workshop_path_forbidden' }); const real = realpathSync(absolute); assertWithin(absoluteRoot, real); }
  return absolute;
}
