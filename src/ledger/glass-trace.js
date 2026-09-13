import { canonicalize, id, sha256 } from '../core/hash.js';
import { STABLE_GLASS_TEXT, STABLE_GLASS_TRANSITIONAL_V2_TEXT, STABLE_GLASS_V1_TEXT, STABLE_GLASS_V2_TEXT, STABLE_GLASS_V3_TEXT } from '../context/glass-cast.js';
import { renderAutonomousWakeGround } from '../context/autonomous-wake-ground.js';

const GLASS_HASHES_BY_VERSION = new Map([
  [1, new Set([sha256(STABLE_GLASS_V1_TEXT)])],
  [2, new Set([sha256(STABLE_GLASS_V2_TEXT), sha256(STABLE_GLASS_TRANSITIONAL_V2_TEXT)])],
  [3, new Set([sha256(STABLE_GLASS_V3_TEXT)])],
  [4, new Set([sha256(STABLE_GLASS_TEXT)])],
]);

function now() { return new Date().toISOString(); }
function row(value) { return value ? { ...value } : null; }

function rootedHistoricalTrailSign(sqlite, item, cast) {
  if (item.kind !== 'result_trail_sign') return false;
  const available = sqlite.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='root_attention_exposures'").get();
  if (!available) return false;
  const candidates = sqlite.prepare(`SELECT e.packet_hash AS packetHash,e.glass_cast_receipt_hash AS glassCastReceiptHash,
    a.payload_json AS payloadJson,a.content_hash AS contentHash
    FROM root_attention_exposures e JOIN root_artifacts a ON a.id=e.artifact_id
    WHERE e.exposure_kind='result_trail_sign' AND e.glass_cast_receipt_id=?`).all(cast.id);
  return candidates.some(candidate => {
    let payload;
    try { payload = JSON.parse(candidate.payloadJson); } catch { return false; }
    return candidate.glassCastReceiptHash === cast.receiptHash &&
      candidate.contentHash === sha256(candidate.payloadJson) &&
      candidate.packetHash === sha256(canonicalize(payload?.packet)) &&
      payload?.exposureKind === 'result_trail_sign' &&
      payload?.packet?.messageHash === item.messageHash;
  });
}

function witnessedHistoricalAutonomousGround(sqlite, item, cast) {
  if (item.kind !== 'autonomous_wake_ground') return false;
  const origin = sqlite.prepare(`SELECT r.plan_id AS planId,r.trigger_event_id AS triggerEventId,r.seat_json AS seatJson,r.seat_hash AS seatHash,e.content
    FROM wake_origin_receipts r JOIN events e ON e.id=r.trigger_event_id
    WHERE r.wake_id=? AND r.origin='self_directed'`).get(cast.wakeId);
  if (!origin || sha256(origin.seatJson) !== origin.seatHash) return false;
  let trigger;
  try { trigger = JSON.parse(origin.content); } catch { return false; }
  if (trigger?.kind !== 'autonomous_wake_trigger/v2' || trigger.planId !== origin.planId ||
    trigger.seatHash !== origin.seatHash || canonicalize(trigger.seat) !== canonicalize(JSON.parse(origin.seatJson))) return false;
  const content = renderAutonomousWakeGround({ kind: 'self_directed', plan: trigger, timing: trigger.timing });
  return typeof content === 'string' && item.messageHash === sha256(JSON.stringify({ role: 'system', content }));
}

export class GlassTraceLedger {
  constructor(sqlite) { this.sqlite = sqlite; }

  epoch() {
    return row(this.sqlite.prepare(`SELECT id,schema_version AS schemaVersion,boundary_kind AS boundaryKind,
      pre_boundary_head_json AS preBoundaryHeadJson,pre_boundary_head_hash AS preBoundaryHeadHash,
      law_json AS lawJson,law_hash AS lawHash,established_at AS establishedAt FROM glass_trace_epochs LIMIT 1`).get());
  }

  establishEpoch() {
    const existing = this.epoch();
    if (existing) return { status: 'already_established', epoch: existing };
    const head = this.sqlite.prepare(`SELECT rowid AS rowid,id,provider_request_id AS providerRequestId,receipt_hash AS receiptHash,created_at AS createdAt
      FROM glass_cast_receipts ORDER BY rowid DESC LIMIT 1`).get() || null;
    const boundary = { castCount: this.sqlite.prepare('SELECT COUNT(*) AS count FROM glass_cast_receipts').get().count, head };
    const law = { name: 'Glass Two-Ended Closure', version: 1, before: 'Exact historical casts may have partial ground ancestry.', after: 'Every new Glass source has a resolvable authority witness and explicit presented or omitted disposition.' };
    const boundaryJson = canonicalize(boundary); const lawJson = canonicalize(law);
    this.sqlite.prepare(`INSERT INTO glass_trace_epochs(id,schema_version,boundary_kind,pre_boundary_head_json,pre_boundary_head_hash,law_json,law_hash,established_at)
      VALUES(?,1,'glass_trace_boundary/v1',?,?,?,?,?)`).run(id('glass_trace_epoch'), boundaryJson, sha256(boundaryJson), lawJson, sha256(lawJson), now());
    return { status: 'established', epoch: this.epoch() };
  }

  verify({ mismatchLimit = 50 } = {}) {
    const epoch = this.epoch(); const mismatches = [];
    const add = item => { if (mismatches.length < mismatchLimit) mismatches.push(item); };
    if (!epoch) return { verified: true, epoch: null, tracedCastCount: 0, mismatches };
    if (sha256(epoch.preBoundaryHeadJson) !== epoch.preBoundaryHeadHash) add({ code: 'glass_trace_boundary_hash_mismatch' });
    if (sha256(epoch.lawJson) !== epoch.lawHash) add({ code: 'glass_trace_law_hash_mismatch' });
    for (const trigger of ['glass_trace_epochs_append_only_update','glass_trace_epochs_append_only_delete','glass_ground_receipts_append_only_update','glass_ground_receipts_append_only_delete','glass_trace_manifests_append_only_update','glass_trace_manifests_append_only_delete']) {
      if (!this.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)) add({ code: 'glass_trace_trigger_missing', trigger });
    }
    const boundary = JSON.parse(epoch.preBoundaryHeadJson);
    const casts = this.sqlite.prepare('SELECT id,wake_id AS wakeId,provider_request_id AS providerRequestId,receipt_hash AS receiptHash FROM glass_cast_receipts WHERE rowid>? ORDER BY rowid').all(boundary.head?.rowid || 0);
    for (const cast of casts) {
      const stored = this.sqlite.prepare('SELECT manifest_json AS manifestJson,manifest_hash AS manifestHash FROM glass_trace_manifests WHERE glass_cast_receipt_id=?').get(cast.id);
      if (!stored) { add({ code: 'glass_trace_manifest_missing', glassCastReceiptId: cast.id }); continue; }
      if (sha256(stored.manifestJson) !== stored.manifestHash) { add({ code: 'glass_trace_manifest_hash_mismatch', glassCastReceiptId: cast.id }); continue; }
      let manifest; try { manifest = JSON.parse(stored.manifestJson); } catch { add({ code: 'glass_trace_manifest_invalid_json', glassCastReceiptId: cast.id }); continue; }
      if (manifest.providerRequestId !== cast.providerRequestId || manifest.glassCastReceiptHash !== cast.receiptHash) add({ code: 'glass_trace_cast_binding_mismatch', glassCastReceiptId: cast.id });
      let requestMessages; try { requestMessages = JSON.parse(this.sqlite.prepare('SELECT request_body AS requestBody FROM provider_requests WHERE id=?').get(cast.providerRequestId)?.requestBody).messages; } catch {}
      const presented = (manifest.items || []).filter(item => item.disposition?.kind === 'presented').sort((left, right) => left.disposition.presentedOrdinal - right.disposition.presentedOrdinal);
      if (!Array.isArray(requestMessages) || requestMessages.length !== presented.length || presented.some((item, index) => item.messageHash !== sha256(JSON.stringify(requestMessages[index])))) add({ code: 'glass_trace_request_projection_mismatch', glassCastReceiptId: cast.id });
      for (const item of manifest.items || []) {
        if (item.source?.authority === 'glass_ground_receipt') {
          const ground = this.sqlite.prepare('SELECT receipt_hash AS receiptHash,receipt_json AS receiptJson FROM glass_ground_receipts WHERE id=? AND provider_request_id=?').get(item.source.receiptId, cast.providerRequestId);
          if (!ground || ground.receiptHash !== item.source.receiptHash || sha256(ground.receiptJson) !== ground.receiptHash) add({ code: 'glass_trace_ground_unresolved', sourceOrdinal: item.sourceOrdinal });
          else if (!JSON.parse(ground.receiptJson).sourceMessageHashes?.includes(item.messageHash) &&
            !rootedHistoricalTrailSign(this.sqlite, item, cast) && !witnessedHistoricalAutonomousGround(this.sqlite, item, cast)) add({ code: 'glass_trace_ground_message_mismatch', sourceOrdinal: item.sourceOrdinal });
        } else if (item.source?.authority === 'Session Scroll') {
          const history = this.sqlite.prepare('SELECT session_id AS sessionId,ordinal,message_json AS messageJson FROM session_history WHERE id=?').get(item.source.historyId);
          if (!history || history.sessionId !== item.source.sessionId || history.ordinal !== item.source.ordinal || sha256(history.messageJson) !== item.source.messageHash) add({ code: 'glass_trace_scroll_unresolved', sourceOrdinal: item.sourceOrdinal });
        } else if (item.source?.authority === 'Source') {
          const event = this.sqlite.prepare('SELECT content FROM events WHERE id=?').get(item.source.eventId);
          if (!event || (item.source.contentHash && sha256(event.content) !== item.source.contentHash)) add({ code: 'glass_trace_source_unresolved', sourceOrdinal: item.sourceOrdinal });
        } else if (item.source?.authority === 'code_owned_glass' && !GLASS_HASHES_BY_VERSION.get(item.source.version)?.has(item.source.contentHash)) add({ code: 'glass_trace_stable_glass_mismatch', sourceOrdinal: item.sourceOrdinal });
        else if (!['code_owned_glass','glass_ground_receipt','Session Scroll','Source'].includes(item.source?.authority)) add({ code: 'glass_trace_authority_unknown', sourceOrdinal: item.sourceOrdinal });
      }
    }
    return { verified: mismatches.length === 0, epoch: { id: epoch.id, boundaryKind: epoch.boundaryKind, establishedAt: epoch.establishedAt }, tracedCastCount: casts.length, mismatches };
  }
}
