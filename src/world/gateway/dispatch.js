import { TOOL_NAMES } from '../tools.js';
import { NAVIGATION_HANDLERS } from './handlers/navigation.js';
import { WORKSHOP_HANDLERS } from './handlers/workshop.js';
import { GIT_HANDLERS } from './handlers/git.js';
import { RUNTIME_HANDLERS } from './handlers/runtime.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

const HANDLERS = new Map();
for (const group of [NAVIGATION_HANDLERS, WORKSHOP_HANDLERS, GIT_HANDLERS, RUNTIME_HANDLERS]) {
  for (const [name, handler] of Object.entries(group)) {
    if (HANDLERS.has(name)) throw new Error(`Duplicate World tool handler: ${name}`);
    HANDLERS.set(name, handler);
  }
}

const installed = [...TOOL_NAMES].sort();
const registered = [...HANDLERS.keys()].sort();
if (JSON.stringify(installed) !== JSON.stringify(registered)) {
  const missing = installed.filter(name => !HANDLERS.has(name));
  const extra = registered.filter(name => !TOOL_NAMES.has(name));
  throw new Error(`World tool handler registry mismatch. missing=${missing.join(',')} extra=${extra.join(',')}`);
}

export const WORLD_TOOL_HANDLER_NAMES = Object.freeze(registered);

export function parseWorldToolIntent(call) {
  if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') fail('world_tool_invalid', 'Tool intent is malformed.');
  if (!TOOL_NAMES.has(call.function.name)) fail('world_tool_unknown', 'The requested capability is not installed.');
  let args; try { args = JSON.parse(call.function.arguments || '{}'); } catch { fail('world_tool_invalid', 'Tool arguments are not valid JSON.'); }
  if (!args || Array.isArray(args) || typeof args !== 'object') fail('world_tool_invalid', 'Tool arguments must be an object.');
  return { call, name: call.function.name, args };
}

function validateOutcome(name, outcome) {
  if (!outcome || typeof outcome !== 'object' || !Object.hasOwn(outcome, 'result') || !Object.hasOwn(outcome, 'source') || typeof outcome.changedRoom !== 'boolean') {
    throw new Error(`World tool handler ${name} returned an invalid outcome.`);
  }
  return outcome;
}

export function dispatchWorldToolImmediate(name, context) {
  const handler = HANDLERS.get(name);
  if (!handler) fail('world_tool_unknown', 'The requested capability is not installed.');
  const outcome = handler(context);
  return outcome && typeof outcome.then === 'function'
    ? outcome.then(value => validateOutcome(name, value))
    : validateOutcome(name, outcome);
}

export async function dispatchWorldTool(name, context) {
  return await dispatchWorldToolImmediate(name, context);
}
