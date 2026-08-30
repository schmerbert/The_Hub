// The Ceiling is the complete installed wire catalog. The Patch Bay selects
// which wires are live in a room; it does not rename or otherwise alter them.
import { CENTER } from '../places/hub/center.js';
import { GARDEN } from '../places/garden/index.js';
import { HOUSE } from '../places/house/index.js';
import { THRESHOLD } from '../places/threshold/index.js';
export const approvalAnchor = 'fixture.workshop_workbench';
export const APPROVAL_ANCHOR = approvalAnchor;

export const WIRE_GROUPS = Object.freeze([
  { id: 'move', label: 'move' },
  { id: 'fixtures', label: 'fixtures' },
  { id: 'explore', label: 'explore' },
  { id: 'workbench', label: 'workbench' },
  { id: 'kiln', label: 'kiln' },
  { id: 'ledger', label: 'ledger' },
  { id: 'clipboard', label: 'clipboard' },
  { id: 'heartbeat', label: 'heartbeat' },
  { id: 'meta', label: 'meta' },
]);

const wires = [
  ['move_through_door', 'move'],
  ['move_through_passage', 'move'],
  ['operate_passage', 'fixtures'],
  ['turn_fixture', 'fixtures'],
  ['inspect_fixture', 'fixtures'],
  ['tend_hearth', 'fixtures'],
  ['engage_fixture', 'fixtures'],
  ['disengage_fixture', 'fixtures'],
  ['workshop_list', 'explore'],
  ['workshop_read', 'explore'],
  ['workshop_search', 'explore'],
  ['workshop_search_regex', 'explore'],
  ['workshop_glob', 'explore'],
  ['workshop_tree', 'explore'],
  ['workshop_stat', 'explore'],
  ['workshop_file_hash', 'explore'],
  ['workshop_apply_patch', 'workbench'],
  ['workshop_apply_unified_diff', 'workbench'],
  ['workshop_write_file', 'workbench'],
  ['workshop_create_path', 'workbench'],
  ['workshop_delete_path', 'workbench'],
  ['workshop_rename_path', 'workbench'],
  ['workshop_git_add', 'workbench'],
  ['workshop_git_commit', 'workbench'],
  ['workshop_git_checkout', 'workbench'],
  ['workshop_pending_diff', 'workbench'],
  ['workshop_approval_status', 'workbench'],
  ['workshop_approval_list', 'workbench'],
  ['workshop_recipe_list', 'kiln'],
  ['workshop_run_recipe', 'kiln'],
  ['workshop_recipe_status', 'kiln'],
  ['workshop_recipe_cancel', 'kiln'],
  ['workshop_sandbox_diff', 'kiln'],
  ['workshop_sandbox_promote', 'workbench'],
  ['workshop_git_status', 'ledger'],
  ['workshop_git_diff', 'ledger'],
  ['workshop_git_log', 'ledger'],
  ['workshop_git_show', 'ledger'],
  ['workshop_git_branch_list', 'ledger'],
  ['workshop_brief_upsert', 'clipboard'],
  ['workshop_brief_get', 'clipboard'],
  ['workshop_timer_set', 'heartbeat'],
  ['workshop_timer_status', 'heartbeat'],
  ['workshop_timer_cancel', 'heartbeat'],
  ['workshop_tool_catalog', 'meta'],
];

export const CEILING_WIRES = Object.freeze(wires.map(([name, groupId]) => Object.freeze({ name, groupId })));
const WIRES_BY_GROUP = new Map(WIRE_GROUPS.map(group => [group.id, CEILING_WIRES.filter(wire => wire.groupId === group.id)]));
const WORKSHOP_TOOL_NAMES = Object.freeze(CEILING_WIRES.map(wire => wire.name).filter(name => !['move_through_passage', 'operate_passage', 'turn_fixture', 'tend_hearth'].includes(name)));

export const ROOM_PROFILES = Object.freeze({
  [CENTER.id]: CENTER.mountedTools,
  'room.workshop': WORKSHOP_TOOL_NAMES,
  [GARDEN.id]: GARDEN.mountedTools,
  [HOUSE.id]: HOUSE.mountedTools,
  [THRESHOLD.id]: THRESHOLD.mountedTools,
});

export function mountedToolNames(roomId) {
  return [...(ROOM_PROFILES[roomId] || [])];
}

function shortName(name) {
  return name.replace(/^workshop_/, '');
}

function wireAlias(groupId, name) {
  const short = shortName(name);
  if (groupId === 'move') return short.replace(/^move_/, '');
  if (groupId === 'fixtures') return short.replace(/_fixture$/, '');
  return short;
}

function presenceAliases(groupId, mounted) {
  const aliases = (WIRES_BY_GROUP.get(groupId) || []).filter(wire => mounted.has(wire.name)).map(wire => wireAlias(groupId, wire.name));
  const maxAliases = groupId === 'move' || groupId === 'fixtures' ? aliases.length : 3;
  return aliases.length > maxAliases ? `${aliases.slice(0, maxAliases).join(', ')}, …` : aliases.join(', ');
}

export function profilePresenceLine(roomId) {
  const mounted = new Set(mountedToolNames(roomId));
  const parts = WIRE_GROUPS.flatMap(group => {
    const groupWires = (WIRES_BY_GROUP.get(group.id) || []).filter(wire => mounted.has(wire.name));
    return groupWires.length ? `${group.label} (${presenceAliases(group.id, mounted)})` : [];
  });
  return parts.length ? `Patched: ${parts.join('; ')}.` : 'Patched: none.';
}

export function mountProfile(roomId) {
  const tools = mountedToolNames(roomId);
  const mounted = new Set(tools);
  return {
    roomId,
    tools,
    groups: WIRE_GROUPS.filter(group => (WIRES_BY_GROUP.get(group.id) || []).some(wire => mounted.has(wire.name)))
      .map(group => group.id),
  };
}

export function ceilingCatalog() {
  return {
    groups: WIRE_GROUPS.map(group => ({ ...group })),
    wires: CEILING_WIRES.map(wire => ({ ...wire })),
    approvalAnchor,
  };
}
