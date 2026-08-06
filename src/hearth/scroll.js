import { canonicalize, sha256 } from '../core/hash.js';
import { BLESSING_V1 } from '../resident/charter.js';

function suffixByUnits(value, limit) {
  if (value.length <= limit) return { text: value, start: 0 };
  let start = value.length - limit;
  if (start > 0 && start < value.length && (value.charCodeAt(start) & 0xfc00) === 0xdc00) start -= 1;
  return { text: value.slice(start), start };
}

function sourceHash(value) { return sha256(value); }

function entryFor(forest, sourceEventId) {
  if (!forest || !sourceEventId) return null;
  return forest.listEntries().find(entry => entry.source_event_id === sourceEventId) || null;
}

function atomFor(item, forest, excerptLimit) {
  const excerpt = suffixByUnits(item.content, excerptLimit);
  const entry = entryFor(forest, item.id);
  return {
    sourceEventId: item.id,
    forestEntryId: entry?.entry_id || null,
    actor: item.actorKind,
    timestamp: item.createdAt,
    originalLength: item.content.length,
    originalLengthUtf16: item.content.length,
    originalHash: sourceHash(item.content),
    startOffsetUtf16: excerpt.start,
    endOffsetUtf16: item.content.length,
    excerptStartUtf16: excerpt.start,
    excerptEndUtf16: item.content.length,
    omittedPrefixLength: excerpt.start,
    omittedPrefixUtf16: excerpt.start,
    excerpt: excerpt.text,
    excerptHash: sourceHash(excerpt.text),
  };
}

function labelFor(atom) {
  const handle = atom.forestEntryId ? ` · ${atom.forestEntryId}` : '';
  const nearEnd = atom.omittedPrefixUtf16 ? ' (near the end)' : '';
  return `**${atom.actor}**${nearEnd}${handle}\n${atom.excerpt}`;
}

export function buildHearthScroll({ hearth, prior, forest = null, budget = 3000, excerptLimit = 600, maxAtoms = 4, sourceAncestry = null, roomProjection = null }) {
  if (!Number.isInteger(budget) || budget < 1 || !Number.isInteger(excerptLimit) || excerptLimit < 1) throw Object.assign(new Error('Hearth Scroll limits are invalid.'), { code: 'hearth_scroll_invalid' });
  const candidates = (prior?.tail || []).slice(-maxAtoms).map(item => atomFor(item, forest, excerptLimit));
  const base = [
    '# Hearth Scroll',
    '',
    '## Place to stand',
    `Continuity: ${hearth.continuity}. Chamber: ${hearth.chamber}.`,
    roomProjection ? `Current room: ${roomProjection.roomId}. ${roomProjection.text}` : 'The implemented ground has no spatial room, movement, or perception machinery.',
    ...(roomProjection ? [`Fixtures: ${roomProjection.fixtures.map(item => item.text).join(' ') || 'none'}.`, `Doors: ${roomProjection.exits.map(exit => `${exit.label} (${exit.doorId})`).join(', ') || 'none'}.`] : []),
    '',
    '## Blessing',
    BLESSING_V1,
    '',
  ];
  const custody = [
    '',
    '## Custody',
    'Custody held. These extracts are exact contiguous source text; no summary was substituted. Older paths remain available behind the wall.',
  ];
  const chosen = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const trace = ['## Trace', '', ...[...chosen, candidate].reverse().map(labelFor), ''];
    const rendered = [...base, ...(chosen.length ? trace : []), ...custody].join('\n');
    if (rendered.length <= budget) chosen.push(candidate);
  }
  const chronological = chosen.slice().sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  const trace = chronological.length ? ['## Trace', '', ...chronological.map(labelFor), ''] : [];
  const markdown = [...base, ...trace, ...custody].join('\n');
  if (markdown.length > budget) throw Object.assign(new Error('Hearth Scroll cannot fit its mandatory exact ground within the configured budget.'), { code: 'hearth_scroll_budget' });
  const scroll = {
    schemaVersion: 2,
    hearthVersion: 2,
    sourceEvents: chronological,
    selection: { policy: 'recency', maxAtoms, excerptLimitUtf16: excerptLimit, budgetUtf16: budget, order: 'chronological', consideredNewestFirst: true },
    environment: hearth.environment,
    limitations: hearth.limitations,
    renderedScroll: markdown,
    renderedScrollHash: sha256(markdown),
    sourceAncestry,
  };
  return { markdown, markdownHash: sha256(markdown), atoms: chronological, receipt: { ...hearth, schema_version: 2, hearth_version: 2, scroll, rendered_scroll: markdown, rendered_scroll_hash: sha256(markdown), receipt_hash_basis: sha256(canonicalize(scroll)) } };
}

export function exactScrollSuffix(value, limit) { return suffixByUnits(value, limit); }
