import { canonicalize, id, sha256 } from '../core/hash.js';

function now() { return new Date().toISOString(); }
function row(row) { return row ? { ...row } : null; }

export const ROOTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS roots_epochs (
  id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version=1),
  boundary_kind TEXT NOT NULL UNIQUE CHECK(boundary_kind='roots_boundary/v1'),
  pre_boundary_head_json TEXT NOT NULL, pre_boundary_head_hash TEXT NOT NULL,
  law_json TEXT NOT NULL, law_hash TEXT NOT NULL, established_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS roots_epochs_append_only_update BEFORE UPDATE ON roots_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS roots_epochs_append_only_delete BEFORE DELETE ON roots_epochs BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS root_artifacts (
  id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL REFERENCES roots_epochs(id),
  kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
  retention_class TEXT NOT NULL, sensitivity_class TEXT NOT NULL,
  payload_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS root_artifacts_kind_order ON root_artifacts(kind,created_at,id);
CREATE TRIGGER IF NOT EXISTS root_artifacts_append_only_update BEFORE UPDATE ON root_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS root_artifacts_append_only_delete BEFORE DELETE ON root_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS root_edges (
  id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL REFERENCES roots_epochs(id),
  from_artifact_id TEXT NOT NULL REFERENCES root_artifacts(id),
  relation TEXT NOT NULL, target_authority TEXT NOT NULL, target_id TEXT NOT NULL,
  target_hash TEXT, created_at TEXT NOT NULL,
  UNIQUE(from_artifact_id,relation,target_authority,target_id)
);
CREATE TRIGGER IF NOT EXISTS root_edges_append_only_update BEFORE UPDATE ON root_edges BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS root_edges_append_only_delete BEFORE DELETE ON root_edges BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS root_wake_packets (
  artifact_id TEXT PRIMARY KEY REFERENCES root_artifacts(id),
  session_id TEXT NOT NULL REFERENCES sessions(id), wake_id TEXT NOT NULL UNIQUE REFERENCES wakes(id),
  hearth_receipt_id TEXT NOT NULL UNIQUE REFERENCES hearth_receipts(id),
  packet_hash TEXT NOT NULL, markdown_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS root_wake_packets_append_only_update BEFORE UPDATE ON root_wake_packets BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS root_wake_packets_append_only_delete BEFORE DELETE ON root_wake_packets BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS root_reasoning_artifacts (
  artifact_id TEXT PRIMARY KEY REFERENCES root_artifacts(id),
  reasoning_hash TEXT NOT NULL UNIQUE, byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS root_reasoning_artifacts_append_only_update BEFORE UPDATE ON root_reasoning_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS root_reasoning_artifacts_append_only_delete BEFORE DELETE ON root_reasoning_artifacts BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS root_attention_exposures (
  artifact_id TEXT PRIMARY KEY REFERENCES root_artifacts(id),
  session_id TEXT NOT NULL REFERENCES sessions(id), wake_id TEXT NOT NULL REFERENCES wakes(id),
  phase TEXT NOT NULL, exposure_kind TEXT NOT NULL CHECK(exposure_kind IN ('result_trail_sign','result_reopen')),
  exposure_key TEXT NOT NULL UNIQUE, policy_version TEXT NOT NULL,
  selected_pointer TEXT, selected_projection_id TEXT, selected_source_hash TEXT,
  packet_hash TEXT NOT NULL, glass_cast_receipt_id TEXT, glass_cast_receipt_hash TEXT,
  glass_band TEXT NOT NULL, glass_ordinal INTEGER NOT NULL,
  scrub_receipt_hash TEXT NOT NULL, spine_record_id TEXT NOT NULL, spine_record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS root_attention_exposures_wake_order ON root_attention_exposures(wake_id, created_at, artifact_id);
CREATE TRIGGER IF NOT EXISTS root_attention_exposures_append_only_update BEFORE UPDATE ON root_attention_exposures BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS root_attention_exposures_append_only_delete BEFORE DELETE ON root_attention_exposures BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TABLE IF NOT EXISTS root_attention_exposure_events (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES root_artifacts(id),
  ordinal INTEGER NOT NULL, disposition TEXT NOT NULL CHECK(disposition IN ('prepared','presented','refused','never_dispatched','shadowed')),
  dispatch_hash TEXT, created_at TEXT NOT NULL, UNIQUE(artifact_id, ordinal)
);
CREATE TRIGGER IF NOT EXISTS root_attention_exposure_events_append_only_update BEFORE UPDATE ON root_attention_exposure_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS root_attention_exposure_events_append_only_delete BEFORE DELETE ON root_attention_exposure_events BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
`;

export class RootsLedger {
  constructor(sqlite) { this.sqlite = sqlite; }

  epoch() {
    return row(this.sqlite.prepare(`SELECT id,schema_version AS schemaVersion,boundary_kind AS boundaryKind,
      pre_boundary_head_json AS preBoundaryHeadJson,pre_boundary_head_hash AS preBoundaryHeadHash,
      law_json AS lawJson,law_hash AS lawHash,established_at AS establishedAt FROM roots_epochs LIMIT 1`).get());
  }

  establishEpoch() {
    const existing = this.epoch();
    if (existing) return { status: 'already_established', epoch: existing };
    const head = this.sqlite.prepare('SELECT rowid AS rowid,id,wake_id AS wakeId,return_hash AS returnHash,created_at AS createdAt FROM hearth_receipts ORDER BY rowid DESC LIMIT 1').get() || null;
    const boundary = { hearthPacketCount: this.sqlite.prepare('SELECT COUNT(*) AS count FROM hearth_receipts').get().count, head };
    const law = { name: 'Retention Does Not Imply Respiration', version: 1,
      before: 'Historical retained material remains exact and may lack rooted custody.',
      after: 'Every new Hearth wake packet is retained as immutable causal evidence and is never an ordinary Forest Exhale source.' };
    const boundaryJson = canonicalize(boundary); const lawJson = canonicalize(law);
    this.sqlite.prepare(`INSERT INTO roots_epochs(id,schema_version,boundary_kind,pre_boundary_head_json,pre_boundary_head_hash,law_json,law_hash,established_at)
      VALUES(?,1,'roots_boundary/v1',?,?,?,?,?)`).run(id('roots_epoch'), boundaryJson, sha256(boundaryJson), lawJson, sha256(lawJson), now());
    return { status: 'established', epoch: this.epoch() };
  }

  verify({ mismatchLimit = 50 } = {}) {
    const epoch = this.epoch(); const mismatches = [];
    const add = item => { if (mismatches.length < mismatchLimit) mismatches.push(item); };
    if (!epoch) return { verified: true, epoch: null, rootedWakePacketCount: 0, mismatches };
    if (sha256(epoch.preBoundaryHeadJson) !== epoch.preBoundaryHeadHash) add({ code: 'roots_boundary_hash_mismatch' });
    if (sha256(epoch.lawJson) !== epoch.lawHash) add({ code: 'roots_law_hash_mismatch' });
    for (const table of ['roots_epochs','root_artifacts','root_edges','root_wake_packets','root_reasoning_artifacts','root_attention_exposures','root_attention_exposure_events']) for (const action of ['update','delete']) {
      const trigger = `${table}_append_only_${action}`;
      if (!this.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)) add({ code: 'roots_trigger_missing', trigger });
    }
    const exposures = this.sqlite.prepare(`SELECT e.artifact_id AS artifactId,e.session_id AS sessionId,e.wake_id AS wakeId,
      e.exposure_key AS exposureKey,e.exposure_kind AS exposureKind,e.packet_hash AS packetHash,
      e.glass_cast_receipt_id AS glassCastReceiptId,e.glass_cast_receipt_hash AS glassCastReceiptHash,
      e.glass_band AS glassBand,e.glass_ordinal AS glassOrdinal,e.scrub_receipt_hash AS scrubReceiptHash,
      e.spine_record_id AS spineRecordId,e.spine_record_hash AS spineRecordHash,
      a.payload_json AS payloadJson,a.content_hash AS contentHash
      FROM root_attention_exposures e JOIN root_artifacts a ON a.id=e.artifact_id`).all();
    for (const exposure of exposures) {
      let payload = null; try { payload = JSON.parse(exposure.payloadJson); } catch {}
      if (sha256(exposure.payloadJson) !== exposure.contentHash || payload?.kind !== 'attention_exposure' ||
        payload?.custody?.respiration !== 'prohibited' || payload?.custody?.forestExhaleEligible !== false ||
        payload?.packetHash !== exposure.packetHash || payload?.exposureKey !== exposure.exposureKey) {
        add({ code: 'root_attention_exposure_binding_mismatch', artifactId: exposure.artifactId });
      }
      const events = this.sqlite.prepare(`SELECT ordinal,disposition FROM root_attention_exposure_events WHERE artifact_id=? ORDER BY ordinal`).all(exposure.artifactId);
      if (!events.length || events[0].ordinal !== 1 || events[0].disposition !== 'prepared' || events.some((item, index) => item.ordinal !== index + 1)) add({ code: 'root_attention_exposure_event_gap', artifactId: exposure.artifactId });
      const terminal = events.at(-1)?.disposition;
      if (!['presented','refused','never_dispatched','shadowed'].includes(terminal)) add({ code: 'root_attention_exposure_unclosed', artifactId: exposure.artifactId });
      if (exposure.glassCastReceiptId) {
        const cast = this.sqlite.prepare('SELECT receipt_hash AS receiptHash,spine_record_id AS spineRecordId,spine_record_hash AS spineRecordHash FROM glass_cast_receipts WHERE id=?').get(exposure.glassCastReceiptId);
        if (!cast || cast.receiptHash !== exposure.glassCastReceiptHash || cast.spineRecordId !== exposure.spineRecordId || cast.spineRecordHash !== exposure.spineRecordHash) add({ code: 'root_attention_exposure_glass_binding_mismatch', artifactId: exposure.artifactId });
      }
      const wake = this.sqlite.prepare('SELECT status FROM wakes WHERE id=?').get(exposure.wakeId);
      if (wake?.status === 'committed' && terminal === 'presented') {
        const downstream = this.sqlite.prepare(`SELECT e.target_id AS targetId,e.target_hash AS targetHash,h.message_json AS messageJson
          FROM root_edges e JOIN session_history h ON h.id=e.target_id
          WHERE e.from_artifact_id=? AND e.relation='preceded_scroll_row' AND e.target_authority='session_history'`).all(exposure.artifactId);
        if (downstream.length !== 1 || sha256(downstream[0].messageJson) !== downstream[0].targetHash) add({ code: 'root_attention_exposure_scroll_edge_missing', artifactId: exposure.artifactId });
      }
    }
    const boundary = JSON.parse(epoch.preBoundaryHeadJson);
    const hearths = this.sqlite.prepare(`SELECT rowid AS rowid,id,session_id AS sessionId,wake_id AS wakeId,return_json AS returnJson,return_hash AS returnHash,
      scroll_markdown AS markdown,scroll_hash AS markdownHash FROM hearth_receipts WHERE rowid>? ORDER BY rowid`).all(boundary.head?.rowid || 0);
    for (const hearth of hearths) {
      const rooted = this.sqlite.prepare(`SELECT p.artifact_id AS artifactId,p.packet_hash AS packetHash,p.markdown_hash AS markdownHash,
        a.payload_json AS payloadJson,a.content_hash AS contentHash,a.kind,a.payload_version AS payloadVersion
        FROM root_wake_packets p JOIN root_artifacts a ON a.id=p.artifact_id WHERE p.hearth_receipt_id=? AND p.wake_id=? AND p.session_id=?`).get(hearth.id, hearth.wakeId, hearth.sessionId);
      if (!rooted) { add({ code: 'root_wake_packet_missing', wakeId: hearth.wakeId }); continue; }
      if (rooted.kind !== 'wake_packet' || rooted.payloadVersion !== 1 || sha256(rooted.payloadJson) !== rooted.contentHash || rooted.packetHash !== sha256(hearth.returnJson) || rooted.markdownHash !== hearth.markdownHash || sha256(hearth.markdown || '') !== hearth.markdownHash) add({ code: 'root_wake_packet_binding_mismatch', wakeId: hearth.wakeId });
      const wake = this.sqlite.prepare('SELECT status FROM wakes WHERE id=?').get(hearth.wakeId);
      if (wake?.status === 'committed') {
        const edge = this.sqlite.prepare("SELECT target_id AS targetId,target_hash AS targetHash FROM root_edges WHERE from_artifact_id=? AND relation='presented_in_glass' AND target_authority='glass_cast_receipt'").get(rooted.artifactId);
        const cast = edge ? this.sqlite.prepare("SELECT id,receipt_hash AS receiptHash FROM glass_cast_receipts WHERE id=? AND phase='response'").get(edge.targetId) : null;
        if (!edge || !cast || edge.targetHash !== cast.receiptHash) add({ code: 'root_wake_packet_glass_edge_missing', wakeId: hearth.wakeId });
      }
    }
    const reasoning = this.sqlite.prepare(`SELECT r.artifact_id AS artifactId,r.reasoning_hash AS reasoningHash,r.byte_length AS byteLength,
      a.payload_json AS payloadJson,a.content_hash AS contentHash,a.kind FROM root_reasoning_artifacts r JOIN root_artifacts a ON a.id=r.artifact_id`).all();
    for (const item of reasoning) {
      let payload = null; try { payload = JSON.parse(item.payloadJson); } catch {}
      if (item.kind !== 'provider_reasoning' || sha256(item.payloadJson) !== item.contentHash || payload?.reasoningHash !== item.reasoningHash ||
        sha256(payload?.text || '') !== item.reasoningHash || Buffer.byteLength(payload?.text || '', 'utf8') !== item.byteLength) add({ code: 'root_reasoning_binding_mismatch', artifactId: item.artifactId });
      const scrollEdges = this.sqlite.prepare(`SELECT target_id AS targetId,target_hash AS targetHash FROM root_edges
        WHERE from_artifact_id=? AND relation='produced_scroll_row' AND target_authority='session_history'`).all(item.artifactId);
      if (!scrollEdges.length) add({ code: 'root_reasoning_scroll_edge_missing', artifactId: item.artifactId });
      for (const edge of scrollEdges) {
        const history = this.sqlite.prepare('SELECT message_json AS messageJson FROM session_history WHERE id=?').get(edge.targetId);
        let message = null; try { message = JSON.parse(history?.messageJson); } catch {}
        const pointerMatches = message?.reasoning_ref?.artifactId === item.artifactId && message.reasoning_ref.sha256 === item.reasoningHash;
        const inheritedMatches = typeof message?.reasoning_content === 'string' && sha256(message.reasoning_content) === item.reasoningHash;
        if (!history || edge.targetHash !== sha256(history.messageJson) || (!pointerMatches && !inheritedMatches)) add({ code: 'root_reasoning_scroll_binding_mismatch', artifactId: item.artifactId, historyId: edge.targetId });
      }
    }
    return { verified: mismatches.length === 0, epoch: { id: epoch.id, boundaryKind: epoch.boundaryKind, establishedAt: epoch.establishedAt }, rootedWakePacketCount: hearths.length, rootedReasoningCount: reasoning.length, rootedAttentionExposureCount: exposures.length, mismatches };
  }

  recordAttentionExposure({ sessionId, wakeId, phase, exposureKind, pointer = null, packet, glassBand = 'living_edge', glassOrdinal,
    glassCastReceiptId, glassCastReceiptHash, scrubReceiptHash, spineRecordId, spineRecordHash, exposureKey }) {
    const epoch = this.epoch();
    if (!epoch) throw Object.assign(new Error('Roots boundary is not established.'), { code: 'roots_boundary_missing' });
    if (!['response', 'ordinary'].includes(phase) || !['result_trail_sign', 'result_reopen'].includes(exposureKind) ||
      !packet || typeof packet !== 'object' || typeof scrubReceiptHash !== 'string' || !scrubReceiptHash ||
      typeof spineRecordId !== 'string' || !spineRecordId || typeof spineRecordHash !== 'string' || !spineRecordHash ||
      !Number.isInteger(glassOrdinal) || glassOrdinal < 1) throw Object.assign(new Error('Attention exposure coordinates are invalid.'), { code: 'roots_exposure_invalid' });
    const wake = this.sqlite.prepare('SELECT session_id AS sessionId FROM wakes WHERE id=?').get(wakeId);
    if (!wake || wake.sessionId !== sessionId) throw Object.assign(new Error('Attention exposure wake custody is invalid.'), { code: 'roots_exposure_invalid' });
    const packetHash = sha256(canonicalize(packet));
    const resolvedKey = exposureKey || `attention_exposure_${sha256(canonicalize({ sessionId, wakeId, phase, exposureKind, pointer, packetHash, glassCastReceiptId: glassCastReceiptId || null, spineRecordId }))}`;
    const existing = this.sqlite.prepare(`SELECT artifact_id AS artifactId,session_id AS sessionId,wake_id AS wakeId,phase,
      exposure_kind AS exposureKind,packet_hash AS packetHash,glass_ordinal AS glassOrdinal,scrub_receipt_hash AS scrubReceiptHash,
      spine_record_id AS spineRecordId,spine_record_hash AS spineRecordHash FROM root_attention_exposures WHERE exposure_key=?`).get(resolvedKey);
    if (existing) {
      if (existing.sessionId !== sessionId || existing.wakeId !== wakeId || existing.phase !== phase || existing.exposureKind !== exposureKind ||
        existing.packetHash !== packetHash || existing.glassOrdinal !== glassOrdinal || existing.scrubReceiptHash !== scrubReceiptHash ||
        existing.spineRecordId !== spineRecordId || existing.spineRecordHash !== spineRecordHash) {
        throw Object.assign(new Error('Attention exposure retry conflicts with its existing immutable custody.'), { code: 'roots_exposure_conflict' });
      }
      return { artifactId: existing.artifactId, exposureKey: resolvedKey, deduplicated: true };
    }
    const artifactId = id('root'); const createdAt = now();
    const payload = {
      schemaVersion: 1, kind: 'attention_exposure', exposureKey: resolvedKey, sessionId, wakeId, phase, exposureKind,
      policyVersion: 'result_exhale/v1', pointer: pointer ? structuredClone(pointer) : null, packet: structuredClone(packet), packetHash,
      custody: { respiration: 'prohibited', forestExhaleEligible: false, actionAuthority: false },
    };
    const payloadJson = canonicalize(payload);
    this.sqlite.prepare(`INSERT INTO root_artifacts(id,epoch_id,kind,payload_version,retention_class,sensitivity_class,payload_json,content_hash,created_at)
      VALUES(?,?,'attention_exposure',1,'causal_evidence','ordinary',?,?,?)`).run(artifactId, epoch.id, payloadJson, sha256(payloadJson), createdAt);
    this.sqlite.prepare(`INSERT INTO root_attention_exposures(artifact_id,session_id,wake_id,phase,exposure_kind,exposure_key,policy_version,
      selected_pointer,selected_projection_id,selected_source_hash,packet_hash,glass_cast_receipt_id,glass_cast_receipt_hash,glass_band,glass_ordinal,
      scrub_receipt_hash,spine_record_id,spine_record_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      artifactId, sessionId, wakeId, phase, exposureKind, resolvedKey, 'result_exhale/v1', pointer?.exactPointer || null,
      pointer?.projectionId || null, pointer?.sourceHash || null, packetHash, glassCastReceiptId || null, glassCastReceiptHash || null,
      glassBand, glassOrdinal, scrubReceiptHash, spineRecordId, spineRecordHash, createdAt,
    );
    this.sqlite.prepare('INSERT INTO root_attention_exposure_events(id,artifact_id,ordinal,disposition,dispatch_hash,created_at) VALUES(?,?,1,?,?,?)')
      .run(id('root_exposure'), artifactId, 'prepared', null, createdAt);
    const edge = (relation, targetAuthority, targetId, targetHash = null) => this.sqlite.prepare(`INSERT OR IGNORE INTO root_edges(id,epoch_id,from_artifact_id,relation,target_authority,target_id,target_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id('root_edge'), epoch.id, artifactId, relation, targetAuthority, targetId, targetHash, createdAt);
    edge('exposed_during', 'wake', wakeId);
    if (pointer?.exactPointer) edge('selected_from_result', 'result_rack_pointer', pointer.exactPointer, pointer.sourceHash || null);
    if (glassCastReceiptId) edge('presented_in_glass', 'glass_cast_receipt', glassCastReceiptId, glassCastReceiptHash || null);
    edge('presented_through_spine', 'spine_record', spineRecordId, spineRecordHash);
    return { artifactId, exposureKey: resolvedKey, packetHash, deduplicated: false };
  }

  recordAttentionExposureDisposition({ artifactId, disposition, dispatchHash = null }) {
    if (typeof artifactId !== 'string' || !artifactId || !['presented', 'refused', 'never_dispatched', 'shadowed'].includes(disposition)) throw Object.assign(new Error('Attention exposure disposition is invalid.'), { code: 'roots_exposure_invalid' });
    const current = this.sqlite.prepare('SELECT disposition,ordinal FROM root_attention_exposure_events WHERE artifact_id=? ORDER BY ordinal DESC LIMIT 1').get(artifactId);
    if (!current) throw Object.assign(new Error('Attention exposure was not found.'), { code: 'roots_exposure_not_found' });
    if (current.disposition === disposition) return { artifactId, disposition, deduplicated: true };
    if (['presented', 'refused', 'never_dispatched', 'shadowed'].includes(current.disposition)) throw Object.assign(new Error('Attention exposure is already terminal.'), { code: 'roots_exposure_terminal' });
    const ordinal = current.ordinal + 1;
    this.sqlite.prepare('INSERT INTO root_attention_exposure_events(id,artifact_id,ordinal,disposition,dispatch_hash,created_at) VALUES(?,?,?,?,?,?)')
      .run(id('root_exposure'), artifactId, ordinal, disposition, dispatchHash, now());
    return { artifactId, disposition, deduplicated: false };
  }

  linkAttentionExposuresToScroll({ wakeId, historyId, historyHash }) {
    if (typeof wakeId !== 'string' || !wakeId || typeof historyId !== 'string' || !historyId || typeof historyHash !== 'string' || !historyHash) throw Object.assign(new Error('Attention exposure Scroll coordinates are invalid.'), { code: 'roots_exposure_invalid' });
    const history = this.sqlite.prepare('SELECT wake_id AS wakeId,message_kind AS messageKind,message_json AS messageJson FROM session_history WHERE id=?').get(historyId);
    if (!history || history.wakeId !== wakeId || history.messageKind !== 'resident' || sha256(history.messageJson) !== historyHash) throw Object.assign(new Error('Attention exposure Scroll target is invalid.'), { code: 'roots_exposure_invalid' });
    const epoch = this.epoch();
    const artifacts = this.sqlite.prepare('SELECT artifact_id AS artifactId FROM root_attention_exposures WHERE wake_id=? ORDER BY created_at,artifact_id').all(wakeId);
    for (const item of artifacts) this.sqlite.prepare(`INSERT OR IGNORE INTO root_edges(id,epoch_id,from_artifact_id,relation,target_authority,target_id,target_hash,created_at)
      VALUES(?,?,?,'preceded_scroll_row','session_history',?,?,?)`).run(id('root_edge'), epoch.id, item.artifactId, historyId, historyHash, now());
    return { wakeId, historyId, linkedCount: artifacts.length };
  }

  recordWakePacket({ sessionId, wakeId, hearthReceiptId, packet, markdown, markdownHash }) {
    const epoch = this.epoch();
    if (!epoch) throw Object.assign(new Error('Roots boundary is not established.'), { code: 'roots_boundary_missing' });
    const artifactId = id('root');
    const payload = { schemaVersion: 1, kind: 'wake_packet', sessionId, wakeId, hearthReceiptId,
      packet: structuredClone(packet), packetHash: sha256(JSON.stringify(packet)), markdown, markdownHash,
      custody: { respiration: 'prohibited', forestExhaleEligible: false } };
    const payloadJson = canonicalize(payload); const createdAt = now();
    this.sqlite.prepare(`INSERT INTO root_artifacts(id,epoch_id,kind,payload_version,retention_class,sensitivity_class,payload_json,content_hash,created_at)
      VALUES(?,?,'wake_packet',1,'causal_evidence','ordinary',?,?,?)`).run(artifactId, epoch.id, payloadJson, sha256(payloadJson), createdAt);
    this.sqlite.prepare(`INSERT INTO root_wake_packets(artifact_id,session_id,wake_id,hearth_receipt_id,packet_hash,markdown_hash,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(artifactId, sessionId, wakeId, hearthReceiptId, payload.packetHash, markdownHash, createdAt);
    return { artifactId, contentHash: sha256(payloadJson) };
  }

  linkWakePacketToGlass({ wakeId, glassCastReceiptId, glassCastReceiptHash }) {
    const rooted = this.sqlite.prepare('SELECT artifact_id AS artifactId FROM root_wake_packets WHERE wake_id=?').get(wakeId);
    if (!rooted) return null;
    const epoch = this.epoch();
    this.sqlite.prepare(`INSERT OR IGNORE INTO root_edges(id,epoch_id,from_artifact_id,relation,target_authority,target_id,target_hash,created_at)
      VALUES(?,?,?,'presented_in_glass','glass_cast_receipt',?,?,?)`).run(id('root_edge'), epoch.id, rooted.artifactId, glassCastReceiptId, glassCastReceiptHash, now());
    return rooted.artifactId;
  }

  recordReasoning(text) {
    if (typeof text !== 'string') return null;
    const epoch = this.epoch();
    if (!epoch) throw Object.assign(new Error('Roots boundary is not established.'), { code: 'roots_boundary_missing' });
    const reasoningHash = sha256(text);
    const existing = this.sqlite.prepare(`SELECT artifact_id AS artifactId,reasoning_hash AS reasoningHash,byte_length AS byteLength
      FROM root_reasoning_artifacts WHERE reasoning_hash=?`).get(reasoningHash);
    if (existing) return { ...existing, deduplicated: true };
    const artifactId = `root_reasoning_${reasoningHash}`;
    const payload = { schemaVersion: 1, kind: 'provider_reasoning', text, reasoningHash,
      custody: { respiration: 'pointer_only', forestExhaleEligible: false, residentBrowseEligible: false } };
    const payloadJson = canonicalize(payload); const createdAt = now(); const byteLength = Buffer.byteLength(text, 'utf8');
    this.sqlite.prepare(`INSERT INTO root_artifacts(id,epoch_id,kind,payload_version,retention_class,sensitivity_class,payload_json,content_hash,created_at)
      VALUES(?,?,'provider_reasoning',1,'causal_evidence','restricted',?,?,?)`).run(artifactId, epoch.id, payloadJson, sha256(payloadJson), createdAt);
    this.sqlite.prepare(`INSERT INTO root_reasoning_artifacts(artifact_id,reasoning_hash,byte_length,created_at) VALUES(?,?,?,?)`).run(artifactId, reasoningHash, byteLength, createdAt);
    return { artifactId, reasoningHash, byteLength, deduplicated: false };
  }

  linkReasoning({ artifactId, relation, targetAuthority, targetId, targetHash = null }) {
    if (!artifactId) return null;
    const epoch = this.epoch();
    this.sqlite.prepare(`INSERT OR IGNORE INTO root_edges(id,epoch_id,from_artifact_id,relation,target_authority,target_id,target_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id('root_edge'), epoch.id, artifactId, relation, targetAuthority, targetId, targetHash, now());
    return artifactId;
  }

  reasoningForHistory(historyId) {
    const item = this.sqlite.prepare(`SELECT a.id AS artifactId,a.payload_json AS payloadJson,r.reasoning_hash AS reasoningHash,r.byte_length AS byteLength
      FROM root_edges e JOIN root_artifacts a ON a.id=e.from_artifact_id JOIN root_reasoning_artifacts r ON r.artifact_id=a.id
      WHERE e.relation='produced_scroll_row' AND e.target_authority='session_history' AND e.target_id=? LIMIT 1`).get(historyId);
    if (!item) return null;
    const payload = JSON.parse(item.payloadJson);
    return { artifactId: item.artifactId, reasoningHash: item.reasoningHash, byteLength: item.byteLength, text: payload.text };
  }

  inspectWake(wakeId) {
    return this.sqlite.prepare(`SELECT DISTINCT a.id AS artifactId,a.kind,a.payload_version AS payloadVersion,a.retention_class AS retentionClass,
      a.sensitivity_class AS sensitivityClass,a.payload_json AS payloadJson,a.content_hash AS contentHash,a.created_at AS createdAt
      FROM root_artifacts a LEFT JOIN root_wake_packets p ON p.artifact_id=a.id LEFT JOIN root_edges e ON e.from_artifact_id=a.id
      WHERE p.wake_id=? OR (e.target_authority='wake' AND e.target_id=?)`).all(wakeId, wakeId).map(item => ({ ...item, payload: JSON.parse(item.payloadJson),
        edges: this.sqlite.prepare('SELECT relation,target_authority AS targetAuthority,target_id AS targetId,target_hash AS targetHash,created_at AS createdAt FROM root_edges WHERE from_artifact_id=? ORDER BY created_at,id').all(item.artifactId) }));
  }
}
