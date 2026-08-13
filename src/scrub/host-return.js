import { canonicalize, sha256 } from '../core/hash.js';

const BRAND = Symbol('ScrubbedHostReturn');
const IDENTITY_POLICY = 'host_return_identity';
const HEARTH_MARKDOWN_POLICY = 'hearth_scroll_markdown_v1';
const GLASS_WAKE_INHERITANCE_POLICY = 'glass_wake_inheritance_markdown_v1';
const HOUSE_HEARTH_PACKET_POLICY = 'house_hearth_packet_markdown_v1';
const RESULT_RACK_POLICY = 'result_rack_projection_v1';
function invalid(message) { throw Object.assign(new Error(message), { code: 'host_return_scrub_invalid' }); }
function render(policy, result, projection) {
  if (policy === HEARTH_MARKDOWN_POLICY || policy === GLASS_WAKE_INHERITANCE_POLICY || policy === HOUSE_HEARTH_PACKET_POLICY) {
    if (typeof result?.markdown !== 'string') invalid('Wake inheritance Markdown rendering requires a markdown result field.');
    if (policy === GLASS_WAKE_INHERITANCE_POLICY && (!result.markdown.startsWith('# Wake inheritance') || result?.glassInheritance?.kind !== 'glass_wake_inheritance')) invalid('Glass wake inheritance rendering requires its versioned exact inheritance receipt.');
    return result.markdown;
  }
  if (policy === RESULT_RACK_POLICY) {
    if (!projection || typeof projection.content !== 'string' || projection.contentHash !== sha256(projection.content) || typeof projection.exactPointer !== 'string' || !projection.exactPointer.startsWith('result-rack://')) invalid('Result Rack rendering requires a hashed deterministic projection and exact custody pointer.');
    return projection.content;
  }
  invalid('Host return projection policy is not installed.');
}

export function scrubHostReturn({ toolName, toolCallId = null, arguments: args, result, content = null, renderPolicy = null, projection = null, roomId, actionReceiptId = null, requestRecordId = null, spineRecordId = null }) {
  if (typeof toolName !== 'string' || !toolName || !result || typeof result !== 'object') throw Object.assign(new Error('Host return Scrub requires a named result object.'), { code: 'host_return_scrub_invalid' });
  const canonicalResult = JSON.stringify(result);
  const output = renderPolicy ? render(renderPolicy, result, projection) : content === null ? canonicalResult : content;
  const identity = !renderPolicy && output === canonicalResult;
  if (!identity && !renderPolicy) invalid('Custom host content requires a named deterministic render policy.');
  if (renderPolicy && content !== null && content !== output) invalid('Host content does not match its deterministic render policy.');
  const message = { role: 'tool', ...(toolCallId ? { tool_call_id: toolCallId } : {}), content: output };
  const receiptId = `host_return_scrub_${sha256(canonicalize({
    toolName,
    toolCallId,
    arguments: args || {},
    result,
    output,
    renderPolicy,
    projection: projection ? { projectionId: projection.projectionId, contentHash: projection.contentHash, sourceHash: projection.sourceHash, exactPointer: projection.exactPointer } : null,
    roomId,
    actionReceiptId,
    requestRecordId,
    spineRecordId,
  }))}`;
  const receipt = {
    receiptId,
    schemaVersion: 1,
    policy: identity ? IDENTITY_POLICY : renderPolicy,
    mode: identity ? 'identity' : 'projection',
    changed: !identity,
    toolName,
    toolCallId,
    roomId,
    actionReceiptId,
    requestRecordId,
    spineRecordId,
    argumentsHash: sha256(canonicalize(args || {})),
    sourceResultHash: sha256(canonicalResult),
    inputHash: sha256(canonicalResult),
    outputHash: sha256(message.content),
    exact: identity,
    ...(projection ? { projectionId: projection.projectionId, projectionHash: projection.contentHash, sourceCustodyHash: projection.sourceHash, exactPointer: projection.exactPointer } : {}),
  };
  return Object.freeze({ [BRAND]: true, message, result: structuredClone(result), receipt });
}
export function assertScrubbedHostReturn(value) {
  if (!value || value[BRAND] !== true || value.message?.role !== 'tool' || !value.receipt || typeof value.receipt.receiptId !== 'string' || !value.receipt.receiptId || value.receipt.outputHash !== sha256(value.message.content) || value.receipt.sourceResultHash !== sha256(JSON.stringify(value.result))) invalid('Host return is not a validated Scrub result.');
  const identity = value.receipt.mode === 'identity' && value.receipt.policy === IDENTITY_POLICY;
  const projection = value.receipt.mode === 'projection' && typeof value.receipt.policy === 'string' && value.receipt.policy !== IDENTITY_POLICY;
  if (!identity && !projection) invalid('Host return Scrub mode is invalid.');
  if (identity && (value.receipt.changed !== false || value.receipt.exact !== true || value.message.content !== JSON.stringify(value.result))) invalid('Identity host return Scrub is not unchanged canonical serialization.');
  if (projection && (value.receipt.changed !== true || value.receipt.exact !== false)) invalid('Projected host return Scrub falsely claims identity.');
  if (value.receipt.policy === RESULT_RACK_POLICY && (value.receipt.projectionHash !== sha256(value.message.content) || typeof value.receipt.exactPointer !== 'string' || !value.receipt.exactPointer.startsWith('result-rack://'))) invalid('Result Rack host return projection custody is invalid.');
  return value;
}
