import { canonicalize, sha256 } from './hash.js';

export const TRUTHFUL_EXTENT_VERSION = 'truthful_extent/v1';
function fail(message) { throw Object.assign(new Error(message), { code: 'truthful_extent_invalid' }); }
function ranges(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  let prior = 0;
  return value.map(range => {
    if (!Array.isArray(range) || range.length !== 2 || !Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 1 || range[1] < range[0] || range[0] <= prior) fail(`${label} contains an invalid or overlapping range.`);
    prior = range[1]; return Object.freeze([range[0], range[1]]);
  });
}
export function mergeLineRanges(value) {
  const sorted = (value || []).map(range => [...range]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const merged = [];
  for (const range of sorted) {
    if (!Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 1 || range[1] < range[0]) fail('Coverage contains an invalid range.');
    const prior = merged.at(-1); if (prior && range[0] <= prior[1] + 1) prior[1] = Math.max(prior[1], range[1]); else merged.push(range);
  }
  return merged;
}
export function missingLineRanges(covered, totalLines) {
  const merged = mergeLineRanges(covered); const missing = []; let cursor = 1;
  for (const [start, end] of merged) { if (cursor < start) missing.push([cursor, start - 1]); cursor = Math.max(cursor, end + 1); }
  if (cursor <= totalLines) missing.push([cursor, totalLines]); return missing;
}
export function createLineExtent({ locator, revision, requested, examined, presented = examined, missing = [], standing, continuation = null, transform = 'exact_utf8', coverage = null }) {
  if (typeof locator !== 'string' || !locator || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) fail('Subject locator or revision is invalid.');
  if (!['complete', 'partial', 'interrupted', 'refused'].includes(standing)) fail('Extent standing is invalid.');
  const extent = { version: TRUTHFUL_EXTENT_VERSION, coordinate: 'line_range', subject: { kind: 'file', locator, revision: `sha256:${revision}` }, requested: ranges(requested, 'Requested extent'), examined: ranges(examined, 'Examined extent'), presented: ranges(presented, 'Presented extent'), missing: ranges(missing, 'Missing extent'), standing, continuation, presentation: { transform, exact: transform === 'exact_utf8' }, coverage: coverage ? { covered: ranges(coverage.covered, 'Covered extent'), unread: ranges(coverage.unread, 'Unread extent') } : null };
  extent.receiptHash = sha256(canonicalize(extent)); return Object.freeze(extent);
}
export function verifyTruthfulExtent(extent) {
  if (!extent || extent.version !== TRUTHFUL_EXTENT_VERSION || typeof extent.receiptHash !== 'string') fail('Extent version or receipt is invalid.');
  const { receiptHash, ...body } = extent;
  createLineExtent({ locator: body.subject?.locator, revision: body.subject?.revision?.replace(/^sha256:/, ''), requested: body.requested, examined: body.examined, presented: body.presented, missing: body.missing, standing: body.standing, continuation: body.continuation, transform: body.presentation?.transform, coverage: body.coverage });
  if (sha256(canonicalize(body)) !== receiptHash) fail('Extent receipt hash does not match.'); return true;
}
