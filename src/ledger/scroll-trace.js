import { canonicalize, id, sha256 } from '../core/hash.js';

function now() { return new Date().toISOString(); }
function row(value) { return value ? { ...value } : null; }

export class ScrollTraceLedger {
  constructor(sqlite) { this.sqlite = sqlite; }

  epoch() {
    return row(this.sqlite.prepare(`SELECT id, schema_version AS schemaVersion, boundary_kind AS boundaryKind,
      pre_boundary_head_json AS preBoundaryHeadJson, pre_boundary_head_hash AS preBoundaryHeadHash,
      law_json AS lawJson, law_hash AS lawHash, established_at AS establishedAt FROM trace_epochs LIMIT 1`).get());
  }

  establishEpoch() {
    const existing = this.epoch();
    if (existing) return { status: 'already_established', epoch: existing };
    const head = this.sqlite.prepare(`SELECT id,session_id AS sessionId,ordinal,content_hash AS contentHash,created_at AS createdAt
      FROM session_history ORDER BY created_at DESC,id DESC LIMIT 1`).get() || null;
    const preBoundaryHead = {
      historyCount: this.sqlite.prepare('SELECT COUNT(*) AS count FROM session_history').get().count,
      providerRequestCount: this.sqlite.prepare('SELECT COUNT(*) AS count FROM provider_requests').get().count,
      sourceEventCount: this.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get().count,
      head,
    };
    const law = { name: 'Two-Ended Closure Law', version: 1,
      before: 'Exact inherited history; trace ancestry may be partial and must not be fabricated.',
      after: 'Every new Session Scroll row has one atomic manifest naming source, gate, witness, destination, and disposition.' };
    const preBoundaryHeadJson = canonicalize(preBoundaryHead); const lawJson = canonicalize(law);
    this.sqlite.prepare(`INSERT INTO trace_epochs(id,schema_version,boundary_kind,pre_boundary_head_json,pre_boundary_head_hash,law_json,law_hash,established_at)
      VALUES(?,1,'scroll_trace_boundary/v1',?,?,?,?,?)`).run(id('trace_epoch'), preBoundaryHeadJson, sha256(preBoundaryHeadJson), lawJson, sha256(lawJson), now());
    return { status: 'established', epoch: this.epoch() };
  }

  appendManifest({ historyId, sessionId, wakeId, ordinal, messageKind, sourceEventId, scrubReceipt }) {
    const epoch = this.epoch();
    if (!epoch) return null;
    let source; let gate;
    if (messageKind === 'user') {
      if (!sourceEventId) throw new Error('Closure-era human Scroll rows require a Source event.');
      source = { authority: 'Source', eventId: sourceEventId }; gate = { kind: 'http_wake_validation+source_append' };
    } else if (messageKind === 'tool_result') {
      if (!sourceEventId || !scrubReceipt?.receipt?.receiptId) throw new Error('Closure-era tool results require a host Source event and host-return Scrub receipt.');
      source = { authority: 'Source', eventId: sourceEventId }; gate = { kind: 'host-return_scrub', receiptId: scrubReceipt.receipt.receiptId };
    } else {
      if (!scrubReceipt?.receipt?.receiptId || !scrubReceipt?.receipt?.source?.spineRecordId) throw new Error('Closure-era provider Scroll rows require return Scrub and Spine witnesses.');
      source = { authority: 'Spine', recordId: scrubReceipt.receipt.source.spineRecordId, recordHash: scrubReceipt.receipt.source.recordHash || null };
      gate = { kind: 'provider-return_scrub', receiptId: scrubReceipt.receipt.receiptId };
    }
    const manifest = { epochId: epoch.id, historyId, sessionId, wakeId, ordinal, messageKind, source, gate,
      witness: { historyId, sourceEventId: sourceEventId || null, scrubReceiptId: scrubReceipt?.receipt?.receiptId || null },
      destination: { authority: 'Session Scroll', sessionId, ordinal }, disposition: 'retained_in_session_scroll' };
    const manifestJson = canonicalize(manifest);
    this.sqlite.prepare(`INSERT INTO scroll_trace_manifests(id,epoch_id,history_id,schema_version,manifest_json,manifest_hash,created_at)
      VALUES(?,?,?,1,?,?,?)`).run(id('scroll_trace'), epoch.id, historyId, manifestJson, sha256(manifestJson), now());
    return manifest;
  }
}
