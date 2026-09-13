import { CEILING_WIRES, mountedToolNames } from './ceiling.js';
import { SPOTLIGHT_TOOLS, SPOTLIGHT_TOOL_APPROVAL_CLASS, SPOTLIGHT_TOOL_NAMES } from '../places/hub/spotlight/tools.js';

export const MOVE_TOOL = { type: 'function', function: { name: 'move_through_door', description: 'Move through a declared door from the current room.', parameters: { type: 'object', properties: { door_id: { type: 'string' } }, required: ['door_id'], additionalProperties: false } } };
export const B1_TOOLS = [
  { type: 'function', function: { name: 'move_through_passage', description: 'Cross a declared passage from the current location.', parameters: { type: 'object', properties: { passage_id: { type: 'string' } }, required: ['passage_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'operate_passage', description: 'Operate the installed front-door passage from the current side.', parameters: { type: 'object', properties: { passage_id: { type: 'string' }, action: { type: 'string', enum: ['open', 'close', 'lock', 'unlock'] } }, required: ['passage_id', 'action'], additionalProperties: false } } },
  { type: 'function', function: { name: 'turn_fixture', description: 'Turn the installed Garden turning stone once.', parameters: { type: 'object', properties: { fixture_id: { type: 'string' } }, required: ['fixture_id'], additionalProperties: false } } },
];
export const FIXTURE_TOOLS = [
  { type: 'function', function: { name: 'inspect_fixture', description: 'Inspect a fixture or object contained by the current location without mutating it.', parameters: { type: 'object', properties: { fixture_id: { type: 'string' } }, required: ['fixture_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'engage_fixture', description: 'Bring one Workshop fixture into working focus. Engaging another fixture moves focus directly without an intervening disengage; its fitted actions are available on the next continuation.', parameters: { type: 'object', properties: { fixture_id: { type: 'string' } }, required: ['fixture_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'disengage_fixture', description: 'Step away from the currently focused Workshop fixture without leaving the room.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
];
export const HEARTH_TOOLS = [
  { type: 'function', function: { name: 'tend_hearth', description: 'Reread the exact Hearth packet already settled for this lifespan. In the House this is a read of the standing Hearth affordance; it does not tend the Hearth a second time or create new continuity.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
];

export const WORKSHOP_TOOLS = [
  { type: 'function', function: { name: 'workshop_list', description: 'List exact names and types in a repository directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_read', description: 'Read an exact bounded contiguous source line range. line_count maximum is 160 by default (configured by HUB_WORKSHOP_MAX_LINES); the result reports total_lines and next_start_line when more remains.', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, line_count: { type: 'integer', minimum: 1, maximum: 160 } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_document_outline', description: 'Index every Markdown heading in one bounded UTF-8 document and return its exact revision and complete line extent.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_document_read', description: 'Read a bounded UTF-8 document, exact line range, or Markdown heading section; larger requests return a heading-aware batch and exact continuation. Returns a truthful extent receipt.', parameters: { type: 'object', properties: { path: { type: 'string' }, heading: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_search', description: 'Search exact source lines with bounded results. Traversal streams through the repository, skips common dependency/build/cache directories, and reports partial bounds honestly.', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer', minimum: 1 } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_search_regex', description: 'Search source lines with a bounded regular expression; returns exact matching line spans and partial traversal metadata when a bound is reached.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer', minimum: 1 }, flags: { type: 'string' } }, required: ['pattern'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_glob', description: 'Match repository-relative paths with a glob pattern using bounded streaming traversal; reports skipped directories and actionable truncation metadata.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer', minimum: 1 } }, required: ['pattern'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_tree', description: 'Bounded-depth directory tree under a path (default max_entries 120, ceiling 400).', parameters: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer', minimum: 1 }, max_entries: { type: 'integer', minimum: 1 } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_stat', description: 'Return type, size, and mtime for one path.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_file_hash', description: 'Return SHA-256 of one text file under Workshop limits.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_apply_patch', description: 'Apply an exact single-path text replacement under Workshop path law.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_apply_unified_diff', description: 'Apply a unified diff under Workshop path law.', parameters: { type: 'object', properties: { diff: { type: 'string' } }, required: ['diff'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_write_file', description: 'Create or overwrite a whole file under Workshop path law.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_create_path', description: 'Create a directory or empty file under Workshop path law.', parameters: { type: 'object', properties: { path: { type: 'string' }, kind: { type: 'string', enum: ['file', 'directory'] } }, required: ['path', 'kind'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_delete_path', description: 'Propose deleting a single file or empty directory for Builder confirmation.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_rename_path', description: 'Rename or move a path within the Workshop root.', parameters: { type: 'object', properties: { from_path: { type: 'string' }, to_path: { type: 'string' } }, required: ['from_path', 'to_path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_recipe_list', description: 'List installed Workshop recipes.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_run_recipe', description: 'Start a named Workshop recipe without blocking; kiln runs house-bound until settle/fail/cancel.', parameters: { type: 'object', properties: { recipe: { type: 'string' }, path: { type: 'string' }, script: { type: 'string' } }, required: ['recipe'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_recipe_status', description: 'Inspect kiln/recipe running state and last result.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_recipe_cancel', description: 'Cancel an in-flight Workshop recipe.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_sandbox_diff', description: 'Inspect the exact candidate diff in the active isolated Workshop job.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_sandbox_promote', description: 'Propose promoting the isolated job diff into the clean canonical checkout; always requires Builder confirmation.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_timer_set', description: 'Arm a lifespan heartbeat timer (seconds 1..3600); replaces any prior timer.', parameters: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 3600 } }, required: ['seconds'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_timer_status', description: 'Inspect the lifespan heartbeat timer.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_timer_cancel', description: 'Clear the lifespan heartbeat timer ding.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_status', description: 'Show git status for the Workshop repository root.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_diff', description: 'Show git diff for the Workshop repository. Large trees may truncate; scope with path when needed.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_log', description: 'Show a bounded recent git log.', parameters: { type: 'object', properties: { max_count: { type: 'integer', minimum: 1 } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_show', description: 'Show one commit or a path at a revision.', parameters: { type: 'object', properties: { revision: { type: 'string' }, path: { type: 'string' } }, required: ['revision'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_branch_list', description: 'List local git branches.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_add', description: 'Stage paths in the Workshop repository.', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, update: { type: 'boolean' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_commit', description: 'Create a local git commit in the Workshop repository.', parameters: { type: 'object', properties: { message: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } }, required: ['message'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_git_checkout', description: 'Propose checking out an existing local branch for Builder confirmation.', parameters: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_brief_upsert', description: 'Create or update the session work brief.', parameters: { type: 'object', properties: { objective: { type: 'string' }, scope_paths: { type: 'array', items: { type: 'string' } }, acceptance: { type: 'array', items: { type: 'string' } }, non_goals: { type: 'array', items: { type: 'string' } } }, required: ['objective'], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_brief_get', description: 'Read the current session work brief.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_pending_diff', description: 'Inspect pending Workshop approvals without applying them.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_approval_status', description: 'Inspect Workshop approval status.', parameters: { type: 'object', properties: { approval_id: { type: 'string' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_approval_list', description: 'List pending and recent Workshop approvals for this lifespan.', parameters: { type: 'object', properties: { pending_only: { type: 'boolean' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'workshop_tool_catalog', description: 'List mounted Workshop tools with descriptions and approval classes.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } },
];

export const TOOL_APPROVAL_CLASS = Object.freeze({
  workshop_list: 'auto', workshop_read: 'auto', workshop_document_outline: 'auto', workshop_document_read: 'auto', workshop_search: 'auto', workshop_search_regex: 'auto', workshop_glob: 'auto', workshop_tree: 'auto', workshop_stat: 'auto', workshop_file_hash: 'auto',
  workshop_apply_patch: 'auto', workshop_apply_unified_diff: 'auto', workshop_write_file: 'auto', workshop_create_path: 'auto', workshop_rename_path: 'auto', workshop_delete_path: 'confirm',
  workshop_recipe_list: 'auto', workshop_run_recipe: 'auto', workshop_recipe_status: 'auto', workshop_recipe_cancel: 'auto',
  workshop_sandbox_diff: 'auto', workshop_sandbox_promote: 'confirm',
  workshop_timer_set: 'auto', workshop_timer_status: 'auto', workshop_timer_cancel: 'auto',
  workshop_git_status: 'auto', workshop_git_diff: 'auto', workshop_git_log: 'auto', workshop_git_show: 'auto', workshop_git_branch_list: 'auto',
  workshop_git_add: 'auto', workshop_git_commit: 'auto', workshop_git_checkout: 'confirm',
  workshop_brief_upsert: 'auto', workshop_brief_get: 'auto', workshop_pending_diff: 'auto', workshop_approval_status: 'auto', workshop_approval_list: 'auto', workshop_tool_catalog: 'auto',
  ...SPOTLIGHT_TOOL_APPROVAL_CLASS,
});

const BY_NAME = new Map([MOVE_TOOL, ...B1_TOOLS, ...FIXTURE_TOOLS, ...HEARTH_TOOLS, ...WORKSHOP_TOOLS, ...SPOTLIGHT_TOOLS].map(tool => [tool.function.name, tool]));
export const TOOL_NAMES = new Set(BY_NAME.keys());
export const WORKSHOP_TOOL_NAMES = WORKSHOP_TOOLS.map(tool => tool.function.name);
export { SPOTLIGHT_TOOLS, SPOTLIGHT_TOOL_NAMES };

export function schemasForTools(toolNames, { workshopMaxLines = null, workshopMaxResults = null } = {}) {
  return toolNames.map(name => {
    const schema = BY_NAME.get(name);
    if (!schema) return null;
    if (name === 'workshop_read' && Number.isInteger(workshopMaxLines)) {
      const copy = structuredClone(schema);
      copy.function.parameters.properties.line_count.maximum = workshopMaxLines;
      copy.function.description = `Read an exact bounded contiguous source line range. line_count maximum is ${workshopMaxLines}; the result reports total_lines and next_start_line when more remains.`;
      return copy;
    }
    if (['workshop_search', 'workshop_search_regex', 'workshop_glob'].includes(name) && Number.isInteger(workshopMaxResults)) {
      const copy = structuredClone(schema);
      copy.function.parameters.properties.max_results.maximum = workshopMaxResults;
      return copy;
    }
    return schema;
  }).filter(Boolean);
}

/** @deprecated Prefer schemasForSession */
export function schemasForRoom(roomId) {
  return schemasForTools(mountedToolNames(roomId));
}

export function schemasForSession(world, sessionId) {
  return schemasForTools(world.availableTools(sessionId));
}

const RESIDENT_CORE_NAMES = Object.freeze([
  'move_through_door',
  'inspect_fixture',
  'engage_fixture',
  'disengage_fixture',
  'workshop_tool_catalog',
]);

const FIXTURE_ATTENTION_GROUP = Object.freeze({
  'fixture.workshop_shelves': 'explore',
  'fixture.workshop_workbench': 'workbench',
  'fixture.workshop_kiln': 'kiln',
  'fixture.workshop_ledger': 'ledger',
  'fixture.workshop_clipboard': 'clipboard',
});

/**
 * Provider-facing schema fitting is deliberately separate from World authority.
 * The World keeps the complete room catalog mounted; this function only chooses
 * which schemas consume resident attention on the next provider crossing.
 */
export function residentToolProfile(world, sessionId) {
  const available = world.availableTools(sessionId);
  if (!available.includes('workshop_tool_catalog')) {
    return { names: available, activeGroup: null, completeCount: available.length, omittedCount: 0 };
  }
  const engagedFixtureId = world.projection(sessionId).engagedFixtureId || null;
  const activeGroup = FIXTURE_ATTENTION_GROUP[engagedFixtureId] || null;
  const groupNames = activeGroup
    ? CEILING_WIRES.filter(wire => wire.groupId === activeGroup || (activeGroup === 'kiln' && wire.groupId === 'heartbeat')).map(wire => wire.name)
    : [];
  // Promotion is anchored at the workbench; its exact sandbox preview belongs
  // beside the confirming action even though recipe execution lives at the kiln.
  if (activeGroup === 'workbench' && available.includes('workshop_sandbox_diff')) groupNames.push('workshop_sandbox_diff');
  const selected = new Set([...RESIDENT_CORE_NAMES, ...groupNames]);
  const names = available.filter(name => selected.has(name));
  return { names, activeGroup, completeCount: available.length, omittedCount: available.length - names.length };
}

export function schemasForResidentSession(world, sessionId, limits = {}) {
  return schemasForTools(residentToolProfile(world, sessionId).names, limits);
}

export function toolCatalogEntries(toolNames, { immediatelyCallable = toolNames } = {}) {
  const callable = new Set(immediatelyCallable);
  return toolNames.filter(name => name.startsWith('workshop_')).map(name => {
    const schema = BY_NAME.get(name);
    return {
      name,
      description: schema?.function?.description || '',
      approvalClass: TOOL_APPROVAL_CLASS[name] || 'auto',
      installed: true,
      immediatelyCallable: callable.has(name),
      ...(callable.has(name) ? {} : { unavailableReason: 'Engage the fixture that owns this capability to fit it on the next provider phase.' }),
    };
  });
}
