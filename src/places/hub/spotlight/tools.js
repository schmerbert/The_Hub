// Provider-neutral hand schemas for the Spotlight room.  These schemas are
// deliberately complete even while the host-owned wires remain capped.  The
// gate service, rather than the schema catalog, decides whether a hand can
// have an effect.

const emptyParameters = () => ({ type: 'object', properties: {}, required: [], additionalProperties: false });

export const SPOTLIGHT_TOOLS = Object.freeze([
  { type: 'function', function: { name: 'spotlight_capability_status', description: 'Report every Spotlight hand and the host-owned requirements currently missing, without contacting a provider.', parameters: emptyParameters() } },
  { type: 'function', function: { name: 'spotlight_observation_list', description: 'List retained Spotlight observations already in host custody; viewing the landscape never polls or refreshes a source.', parameters: { type: 'object', properties: { instrument_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_observation_read', description: 'Read one retained, attributable Spotlight observation from host custody.', parameters: { type: 'object', properties: { observation_id: { type: 'string' } }, required: ['observation_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_observe', description: 'Deliberately request one bounded read-only observation through a verified Spotlight source.', parameters: { type: 'object', properties: { instrument_id: { type: 'string' }, observation_ref: { type: 'string' } }, required: ['instrument_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_packet_build', description: 'Build an immutable evidence packet from retained Spotlight observations and declared counterevidence.', parameters: { type: 'object', properties: { observation_ids: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } }, next_observation: { type: 'string' } }, required: ['observation_ids'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_replay', description: 'Run a bounded, future-blind Spotlight replay through host-owned recorded data and custody.', parameters: { type: 'object', properties: { dataset_id: { type: 'string' } }, required: [], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_trade_propose', description: 'Prepare a non-executing, evidence-linked trade proposal for collaborative review.', parameters: { type: 'object', properties: { instrument_id: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] }, quantity: { type: 'number', exclusiveMinimum: 0 }, order_type: { type: 'string', enum: ['market', 'limit'] }, limit_price: { type: 'number', exclusiveMinimum: 0 }, thesis: { type: 'string' }, evidence_ids: { type: 'array', maxItems: 20, items: { type: 'string' } } }, required: ['instrument_id', 'side', 'quantity', 'order_type', 'thesis'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_trade_execute', description: 'Execute an explicitly approved trade through a verified account jurisdiction; unavailable until strategy, approval, custody, and execution authority are installed.', parameters: { type: 'object', properties: { proposal_id: { type: 'string' }, approval_id: { type: 'string' } }, required: ['proposal_id', 'approval_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_ring_propose', description: 'Prepare a non-executing take-profit/stop-loss ring proposal for collaborative review.', parameters: { type: 'object', properties: { instrument_id: { type: 'string' }, quantity: { type: 'number', exclusiveMinimum: 0 }, take_profit: { type: 'number', exclusiveMinimum: 0 }, stop_loss: { type: 'number', exclusiveMinimum: 0 }, rationale: { type: 'string' }, evidence_ids: { type: 'array', maxItems: 20, items: { type: 'string' } } }, required: ['instrument_id', 'quantity', 'take_profit', 'stop_loss', 'rationale'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spotlight_ring_adjust', description: 'Adjust an existing take-profit/stop-loss ring only within an explicitly approved collaborative authority envelope.', parameters: { type: 'object', properties: { ring_id: { type: 'string' }, take_profit: { type: 'number', exclusiveMinimum: 0 }, stop_loss: { type: 'number', exclusiveMinimum: 0 }, approval_id: { type: 'string' } }, required: ['ring_id', 'take_profit', 'stop_loss', 'approval_id'], additionalProperties: false } } },
]);

export const SPOTLIGHT_TOOL_NAMES = Object.freeze(SPOTLIGHT_TOOLS.map(tool => tool.function.name));

export const SPOTLIGHT_TOOL_APPROVAL_CLASS = Object.freeze({
  spotlight_capability_status: 'auto',
  spotlight_observation_list: 'auto',
  spotlight_observation_read: 'auto',
  spotlight_observe: 'auto',
  spotlight_packet_build: 'auto',
  spotlight_replay: 'auto',
  spotlight_trade_propose: 'auto',
  spotlight_trade_execute: 'confirm',
  spotlight_ring_propose: 'auto',
  spotlight_ring_adjust: 'confirm',
});

