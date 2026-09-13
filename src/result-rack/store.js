import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, id, sha256, sha256Bytes } from '../core/hash.js';
import { RESULT_RACK_SCHEMA } from './schema.js';
import {
  DEFAULT_PROJECTION_BYTES, DEFAULT_PROJECTION_LINES, DEFAULT_DOCUMENT_PROJECTION_BYTES, DEFAULT_DOCUMENT_PROJECTION_LINES, MIN_PROJECTION_BYTES, DEFAULT_CAPTURE_BYTES,
  RESULT_JOB_STATUSES, TERMINAL_JOB_STATUSES, JOB_STATUS_TRANSITIONS, POLICY_SET,
  fail, asBytes, validName, canonicalMetadata, lineCount, buildOutputPresentation,
  buildArtifactPresentation, terminalPrefix, fitText, mapPresentationRanges, rawOmittedBytes,
  assertChunkIntegrity, assertArtifactIntegrity, projectionIdFor, projectionPolicyFor,
  RESULT_PROJECTION_VERSION,
} from './projection.js';

const NOW = () => new Date().toISOString();

export class ResultRackStore {
  constructor(path, { projectionMaxBytes = DEFAULT_PROJECTION_BYTES, projectionMaxLines = DEFAULT_PROJECTION_LINES, documentProjectionMaxBytes = DEFAULT_DOCUMENT_PROJECTION_BYTES, documentProjectionMaxLines = DEFAULT_DOCUMENT_PROJECTION_LINES, captureMaxBytes = DEFAULT_CAPTURE_BYTES } = {}) {
    if (!Number.isInteger(projectionMaxBytes) || projectionMaxBytes < MIN_PROJECTION_BYTES) fail('result_invalid_argument', `projectionMaxBytes must be at least ${MIN_PROJECTION_BYTES}.`);
    if (!Number.isInteger(projectionMaxLines) || projectionMaxLines < 1) fail('result_invalid_argument', 'projectionMaxLines must be a positive integer.');
    if (!Number.isInteger(documentProjectionMaxBytes) || documentProjectionMaxBytes < projectionMaxBytes) fail('result_invalid_argument', 'documentProjectionMaxBytes must be at least projectionMaxBytes.');
    if (!Number.isInteger(documentProjectionMaxLines) || documentProjectionMaxLines < projectionMaxLines) fail('result_invalid_argument', 'documentProjectionMaxLines must be at least projectionMaxLines.');
    if (!Number.isInteger(captureMaxBytes) || captureMaxBytes < 1) fail('result_invalid_argument', 'captureMaxBytes must be a positive integer.');
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.projectionMaxBytes = projectionMaxBytes;
    this.projectionMaxLines = projectionMaxLines;
    this.documentProjectionMaxBytes = documentProjectionMaxBytes;
    this.documentProjectionMaxLines = documentProjectionMaxLines;
    this.captureMaxBytes = captureMaxBytes;
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
    this.sqlite.exec(RESULT_RACK_SCHEMA);
  }
  transaction(fn) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.sqlite.exec('COMMIT'); return value; }
    catch (error) { try { this.sqlite.exec('ROLLBACK'); } catch {} throw error; }
  }
  createJob({ jobId = id('result_job'), sessionId = null, wakeId = null, toolName, jobKind = null, status = 'running', metadata = {} }) {
    validName(jobId, 'Result job id');
    validName(toolName, 'Result tool name');
    const resolvedJobKind = jobKind || projectionPolicyFor(toolName);
    validName(resolvedJobKind, 'Result job kind');
    if (TERMINAL_JOB_STATUSES.has(status)) fail('result_invalid_argument', 'Result jobs must begin queued or running, then seal with an append-only status event.');
    if (!RESULT_JOB_STATUSES.has(status)) fail('result_invalid_argument', 'Result job status is invalid.');
    const metadataJson = canonicalMetadata(metadata);
    this.sqlite.prepare('INSERT INTO result_jobs VALUES(?,?,?,?,?,?,?,?,?)')
      .run(jobId, sessionId, wakeId, toolName, resolvedJobKind, status, metadataJson, sha256(metadataJson), NOW());
    return this.getJob(jobId);
  }
  getJob(jobId) {
    const row = this.sqlite.prepare('SELECT * FROM result_jobs WHERE job_id=?').get(jobId);
    if (!row) return null;
    const latest = this.sqlite.prepare('SELECT status, ordinal FROM result_job_status_events WHERE job_id=? ORDER BY ordinal DESC LIMIT 1').get(jobId);
    return {
      jobId: row.job_id,
      sessionId: row.session_id,
      wakeId: row.wake_id,
      toolName: row.tool_name,
      jobKind: row.job_kind,
      initialStatus: row.status,
      status: latest?.status || row.status,
      statusEventCount: latest?.ordinal || 0,
      metadata: JSON.parse(row.metadata_json),
      metadataHash: row.metadata_sha256,
      createdAt: row.created_at,
    };
  }
  insertStatusEvent(jobId, status, detailJson) {
    const ordinal = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM result_job_status_events WHERE job_id=?').get(jobId).ordinal;
    const detailHash = sha256(detailJson);
    const eventId = `result_status_${sha256(canonicalize({ jobId, ordinal, status, detailHash }))}`;
    this.sqlite.prepare('INSERT INTO result_job_status_events VALUES(?,?,?,?,?,?,?)').run(eventId, jobId, ordinal, status, detailJson, detailHash, NOW());
    return eventId;
  }
  appendJobStatus(jobId, status, detail = {}) {
    if (!RESULT_JOB_STATUSES.has(status)) fail('result_invalid_argument', 'Result job status is invalid.');
    const detailJson = canonicalMetadata(detail);
    return this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job) fail('result_job_not_found', 'Result job was not found.');
      if (TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_terminal', 'Result job already has a terminal status.');
      if (!JOB_STATUS_TRANSITIONS[job.status]?.has(status)) fail('result_invalid_transition', `Result job cannot transition from ${job.status} to ${status}.`);
      const eventId = this.insertStatusEvent(jobId, status, detailJson);
      return this.listJobStatusEvents(jobId).find(event => event.eventId === eventId);
    });
  }
  listJobStatusEvents(jobId) {
    return this.sqlite.prepare('SELECT * FROM result_job_status_events WHERE job_id=? ORDER BY ordinal').all(jobId).map(row => ({
      eventId: row.event_id,
      jobId: row.job_id,
      ordinal: row.ordinal,
      status: row.status,
      detail: JSON.parse(row.detail_json),
      detailHash: row.detail_sha256,
      createdAt: row.created_at,
    }));
  }
  verifyTerminalReceipt(jobId, expected) {
    const event = this.listJobStatusEvents(jobId).find(item => item.eventId === expected?.eventId);
    if (!event
      || event.ordinal !== expected.ordinal
      || event.status !== expected.status
      || event.detailHash !== expected.detailHash
      || sha256(canonicalize(event.detail)) !== event.detailHash
      || canonicalize(event.detail) !== canonicalize(expected.detail)) {
      fail('result_custody_mismatch', 'Result job terminal receipt no longer matches its custody manifest.');
    }
    return event;
  }
  appendOutputChunk(jobId, stream, body) {
    if (!['stdout', 'stderr', 'output'].includes(stream)) fail('result_invalid_argument', 'Result output stream is invalid.');
    const bytes = asBytes(body);
    const result = this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job) fail('result_job_not_found', 'Result job was not found.');
      if (TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_terminal', 'Result output custody is sealed.');
      if (job.status !== 'running') fail('result_job_inactive', 'Result output may only be captured while its job is running.');
      const prior = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0) AS ordinal, COALESCE(MAX(byte_end),0) AS byte_end FROM result_output_chunks WHERE job_id=?').get(jobId);
      if (prior.byte_end + bytes.length > this.captureMaxBytes) {
        this.insertStatusEvent(jobId, 'failed', canonicalMetadata({
          reason: 'capture_limit', sourceKind: 'output', capturedBytes: prior.byte_end,
          attemptedBytes: bytes.length, captureMaxBytes: this.captureMaxBytes, incomplete: true,
        }));
        return { captureRefused: true };
      }
      const ordinal = prior.ordinal + 1;
      const byteStart = prior.byte_end;
      const bodyHash = sha256Bytes(bytes);
      const chunkId = `result_chunk_${sha256(canonicalize({ jobId, ordinal, stream, byteStart, byteLength: bytes.length, bodyHash }))}`;
      this.sqlite.prepare('INSERT INTO result_output_chunks VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(chunkId, jobId, ordinal, stream, byteStart, byteStart + bytes.length, bytes.length, bytes, bodyHash, NOW());
      return this.getOutputChunk(chunkId);
    });
    if (result.captureRefused) fail('result_capture_limit', 'Result output exceeded its exact capture ceiling; no bytes were stored and the job was sealed failed.');
    return result;
  }
  getOutputChunk(chunkId) {
    const row = this.sqlite.prepare('SELECT * FROM result_output_chunks WHERE chunk_id=?').get(chunkId);
    if (!row) return null;
    return {
      chunkId: row.chunk_id,
      jobId: row.job_id,
      ordinal: row.ordinal,
      stream: row.stream,
      byteStart: row.byte_start,
      byteEnd: row.byte_end,
      byteLength: row.byte_length,
      body: Buffer.from(row.body),
      bodyHash: row.body_sha256,
      createdAt: row.created_at,
    };
  }
  listOutputChunks(jobId) {
    return this.sqlite.prepare('SELECT chunk_id FROM result_output_chunks WHERE job_id=? ORDER BY ordinal').all(jobId)
      .map(row => this.getOutputChunk(row.chunk_id));
  }
  addArtifact(jobId, { artifactId = null, name, mediaType = 'application/octet-stream', body, metadata = {} }) {
    validName(name, 'Result artifact name');
    validName(mediaType, 'Result artifact media type');
    const bytes = asBytes(body);
    const bodyHash = sha256Bytes(bytes);
    const metadataJson = canonicalMetadata(metadata);
    const resolvedId = artifactId || `result_artifact_${sha256(canonicalize({ jobId, name, mediaType, bodyHash, metadataJson }))}`;
    validName(resolvedId, 'Result artifact id');
    const result = this.transaction(() => {
      const job = this.getJob(jobId);
      if (!job) fail('result_job_not_found', 'Result job was not found.');
      if (TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_terminal', 'Result artifact custody is sealed.');
      if (job.status !== 'running') fail('result_job_inactive', 'Result artifacts may only be captured while their job is running.');
      if (bytes.length > this.captureMaxBytes) {
        this.insertStatusEvent(jobId, 'failed', canonicalMetadata({
          reason: 'capture_limit', sourceKind: 'artifact', artifactName: name, capturedBytes: 0,
          attemptedBytes: bytes.length, captureMaxBytes: this.captureMaxBytes, incomplete: true,
        }));
        return { captureRefused: true };
      }
      this.sqlite.prepare('INSERT INTO result_artifacts VALUES(?,?,?,?,?,?,?,?,?)')
        .run(resolvedId, jobId, name, mediaType, bytes.length, bytes, bodyHash, metadataJson, NOW());
      return this.getArtifact(resolvedId);
    });
    if (result.captureRefused) fail('result_capture_limit', 'Result artifact exceeded its exact capture ceiling; no bytes were stored and the job was sealed failed.');
    return result;
  }
  getArtifact(artifactId) {
    const row = this.sqlite.prepare('SELECT * FROM result_artifacts WHERE artifact_id=?').get(artifactId);
    if (!row) return null;
    return {
      artifactId: row.artifact_id,
      jobId: row.job_id,
      name: row.name,
      mediaType: row.media_type,
      byteLength: row.byte_length,
      body: Buffer.from(row.body),
      bodyHash: row.body_sha256,
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at,
    };
  }
  createProjection(jobId, { policy = null, source = { kind: 'output' }, maxBytes = null, maxLines = null } = {}) {
    const job = this.getJob(jobId);
    if (!job) fail('result_job_not_found', 'Result job was not found.');
    if (!TERMINAL_JOB_STATUSES.has(job.status)) fail('result_job_open', 'Result projections require sealed terminal job custody.');
    const resolvedPolicy = policy || projectionPolicyFor(job);
    if (!POLICY_SET.has(resolvedPolicy)) fail('result_projection_policy_unknown', 'Result projection policy is not installed.');
    const byteCeiling = resolvedPolicy === 'document_read' ? this.documentProjectionMaxBytes : this.projectionMaxBytes;
    const lineCeiling = resolvedPolicy === 'document_read' ? this.documentProjectionMaxLines : this.projectionMaxLines;
    maxBytes ??= byteCeiling; maxLines ??= lineCeiling;
    if (!Number.isInteger(maxBytes) || maxBytes < MIN_PROJECTION_BYTES || maxBytes > byteCeiling) fail('result_projection_limit', 'Projection byte ceiling is invalid.');
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > lineCeiling) fail('result_projection_limit', 'Projection line ceiling is invalid.');

    const terminalEvent = this.listJobStatusEvents(jobId).at(-1);
    if (!terminalEvent || terminalEvent.status !== job.status || sha256(canonicalize(terminalEvent.detail)) !== terminalEvent.detailHash) {
      fail('result_custody_mismatch', 'Result job terminal receipt no longer matches its recorded status.');
    }
    const terminalReceipt = {
      eventId: terminalEvent.eventId, ordinal: terminalEvent.ordinal, status: terminalEvent.status,
      detail: terminalEvent.detail, detailHash: terminalEvent.detailHash,
    };

    let sourceId = null; let outputRows = null; let artifact = null;
    if (!source || source.kind === 'output') {
      outputRows = this.listOutputChunks(jobId).map(row => assertChunkIntegrity(row));
    } else if (source.kind === 'artifact') {
      artifact = this.getArtifact(source.artifactId);
      if (!artifact || artifact.jobId !== jobId) fail('result_artifact_not_found', 'Result artifact was not found for this job.');
      assertArtifactIntegrity(artifact);
      sourceId = artifact.artifactId;
    } else fail('result_invalid_argument', 'Projection source is invalid.');
    const sourceKind = artifact ? 'artifact' : 'output';
    const exactSourceManifest = artifact
      ? { artifactId: artifact.artifactId, jobId, byteLength: artifact.byteLength, bodyHash: artifact.bodyHash }
      : { chunks: outputRows.map(row => ({ chunkId: row.chunkId, jobId, ordinal: row.ordinal, stream: row.stream, byteStart: row.byteStart, byteEnd: row.byteEnd, byteLength: row.byteLength, bodyHash: row.bodyHash })) };
    const sourceManifest = { receiptVersion: 'result_source_manifest/v1', ...exactSourceManifest, terminal: terminalReceipt };
    const sourceHash = artifact
      ? artifact.bodyHash
      : sha256(canonicalize({ version: 'result_output_manifest/v1', ...exactSourceManifest }));
    const identity = {
      fitterVersion: RESULT_PROJECTION_VERSION, jobId, policy: resolvedPolicy, sourceKind, sourceId, sourceHash,
      terminalEventId: terminalEvent.eventId, terminalStatus: terminalEvent.status, terminalDetailHash: terminalEvent.detailHash,
      maxBytes, maxLines,
    };
    const projectionId = projectionIdFor(identity);
    const existing = this.getProjection(projectionId);
    if (existing) return existing;
    const exactPointer = artifact
      ? `result-rack://jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/${sourceHash}`
      : `result-rack://jobs/${encodeURIComponent(jobId)}/output/${sourceHash}`;
    const presentation = artifact ? buildArtifactPresentation(artifact, exactPointer) : buildOutputPresentation(outputRows, exactPointer);
    const fitted = fitText(presentation.buffer, {
      exactPointer, policy: resolvedPolicy, maxBytes, maxLines, requiredPrefix: terminalPrefix(terminalEvent, exactPointer),
      sourceOmittedBytesForRanges: ranges => rawOmittedBytes(ranges, presentation),
    });
    const sourceRanges = mapPresentationRanges(fitted.selectedRanges, presentation);
    const contentHash = sha256(fitted.content);
    this.sqlite.prepare('INSERT INTO result_projections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(projection_id) DO NOTHING')
      .run(
        projectionId, jobId, RESULT_PROJECTION_VERSION, resolvedPolicy, sourceKind, sourceId, sourceHash,
        fitted.content, contentHash, Buffer.byteLength(fitted.content, 'utf8'), lineCount(fitted.content),
        maxBytes, maxLines, fitted.truncated ? 1 : 0, fitted.omittedBytes, fitted.omittedLines,
        exactPointer, JSON.stringify({
          receiptVersion: 'result_presentation_receipt/v1', encoding: fitted.encoding, ranges: sourceRanges,
          presentationRanges: fitted.selectedRanges, presentationOmittedBytes: fitted.presentationOmittedBytes,
        }), JSON.stringify(sourceManifest), NOW(),
      );
    return this.getProjection(projectionId);
  }
  readExact(exactPointer) {
    const row = this.sqlite.prepare('SELECT job_id, source_kind, source_id, source_sha256, source_manifest_json FROM result_projections WHERE exact_pointer=? ORDER BY created_at, projection_id LIMIT 1').get(exactPointer);
    if (!row) fail('result_pointer_not_found', 'Result Rack pointer was not found.');
    let manifest;
    try { manifest = JSON.parse(row.source_manifest_json); }
    catch { fail('result_custody_mismatch', 'Result Rack source manifest is not valid JSON.'); }
    this.verifyTerminalReceipt(row.job_id, manifest.terminal);
    if (row.source_kind === 'artifact') {
      const artifact = this.getArtifact(manifest.artifactId);
      assertArtifactIntegrity(artifact, { ...manifest, jobId: row.job_id });
      if (artifact.bodyHash !== row.source_sha256) fail('result_custody_mismatch', 'Pointed Result Rack artifact no longer matches its custody hash.');
      return { exactPointer, jobId: row.job_id, sourceKind: 'artifact', sourceId: artifact.artifactId, body: artifact.body, bodyHash: artifact.bodyHash, sourceHash: artifact.bodyHash };
    }
    const chunks = manifest.chunks.map(expected => {
      const chunk = this.getOutputChunk(expected.chunkId);
      return assertChunkIntegrity(chunk, { ...expected, jobId: row.job_id });
    });
    const body = Buffer.concat(chunks.map(chunk => chunk.body));
    const bodyHash = sha256Bytes(body);
    const manifestHash = sha256(canonicalize({ version: 'result_output_manifest/v1', chunks: manifest.chunks }));
    if (manifestHash !== row.source_sha256) fail('result_custody_mismatch', 'Pointed Result Rack output manifest no longer matches its custody hash.');
    return { exactPointer, jobId: row.job_id, sourceKind: 'output', sourceId: null, body, bodyHash, sourceHash: manifestHash, chunks };
  }
  getProjection(projectionId) {
    const row = this.sqlite.prepare('SELECT * FROM result_projections WHERE projection_id=?').get(projectionId);
    if (!row) return null;
    let pointers; let sourceManifest;
    try {
      pointers = JSON.parse(row.source_ranges_json);
      sourceManifest = JSON.parse(row.source_manifest_json);
    } catch { fail('result_custody_mismatch', 'Stored Result Rack projection receipts are not valid JSON.'); }
    const content = row.content_text;
    if (sha256(content) !== row.content_sha256
      || Buffer.byteLength(content, 'utf8') !== row.byte_length
      || lineCount(content) !== row.line_count) {
      fail('result_custody_mismatch', 'Stored Result Rack projection content no longer matches its receipt.');
    }
    const terminal = this.verifyTerminalReceipt(row.job_id, sourceManifest.terminal);
    const expectedProjectionId = projectionIdFor({
      fitterVersion: row.fitter_version, jobId: row.job_id, policy: row.policy,
      sourceKind: row.source_kind, sourceId: row.source_id, sourceHash: row.source_sha256,
      terminalEventId: terminal.eventId, terminalStatus: terminal.status, terminalDetailHash: terminal.detailHash,
      maxBytes: row.max_bytes, maxLines: row.max_lines,
    });
    if (expectedProjectionId !== row.projection_id || !content.startsWith(terminalPrefix(terminal, row.exact_pointer))) {
      fail('result_custody_mismatch', 'Stored Result Rack projection identity no longer matches its outcome receipt.');
    }
    return {
      projectionId: row.projection_id,
      jobId: row.job_id,
      fitterVersion: row.fitter_version,
      policy: row.policy,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceHash: row.source_sha256,
      content,
      contentHash: row.content_sha256,
      byteLength: row.byte_length,
      lineCount: row.line_count,
      maxBytes: row.max_bytes,
      maxLines: row.max_lines,
      truncated: Boolean(row.truncated),
      omittedBytes: row.omitted_bytes,
      presentationOmittedBytes: pointers.presentationOmittedBytes,
      omittedLines: row.omitted_lines,
      exactPointer: row.exact_pointer,
      encoding: pointers.encoding,
      presentationReceiptVersion: pointers.receiptVersion,
      presentationRanges: pointers.presentationRanges,
      sourceRanges: pointers.ranges,
      sourceManifest,
      createdAt: row.created_at,
    };
  }

  /**
   * Resolve a stored projection pointer without exposing the retained raw body.
   * Result Rack is the sole owner of this crossing: callers receive the exact
   * already-fitted projection after terminal and source-integrity verification.
   */
  reopenProjection(exactPointer, { sessionId, maxBytes = this.projectionMaxBytes, maxLines = this.projectionMaxLines } = {}) {
    if (typeof exactPointer !== 'string' || !exactPointer.startsWith('result-rack://')) fail('result_pointer_invalid', 'Result reopening requires an exact Result Rack pointer.');
    if (typeof sessionId !== 'string' || !sessionId) fail('result_session_ineligible', 'Result reopening requires the current session identity.');
    if (!Number.isInteger(maxBytes) || maxBytes < MIN_PROJECTION_BYTES || maxBytes > this.projectionMaxBytes ||
      !Number.isInteger(maxLines) || maxLines < 1 || maxLines > this.projectionMaxLines) {
      fail('result_projection_limit', 'Result reopening ceilings are invalid.');
    }
    const row = this.sqlite.prepare(`SELECT projection_id AS projectionId, job_id AS jobId
      FROM result_projections WHERE exact_pointer=? ORDER BY created_at, projection_id LIMIT 1`).get(exactPointer);
    if (!row) fail('result_pointer_not_found', 'Result Rack pointer was not found.');
    const job = this.getJob(row.jobId);
    if (!job) fail('result_custody_mismatch', 'Result Rack pointer has no job custody.');
    if (job.sessionId !== sessionId) fail('result_session_ineligible', 'Result Rack pointer belongs to another session.');
    const projection = this.getProjection(row.projectionId);
    // getProjection verifies the terminal receipt and projection identity. The
    // exact read additionally verifies every retained chunk/artifact hash.
    const exact = this.readExact(exactPointer);
    if (exact.sourceHash !== projection.sourceHash) fail('result_custody_mismatch', 'Result Rack projection source hash no longer matches its pointer.');
    if (projection.byteLength > maxBytes || projection.lineCount > maxLines) fail('result_projection_limit', 'Stored Result Rack projection exceeds the reopening ceiling.');
    return Object.freeze({
      projectionId: projection.projectionId,
      jobId: projection.jobId,
      exactPointer: projection.exactPointer,
      content: projection.content,
      contentHash: projection.contentHash,
      sourceHash: projection.sourceHash,
      sourceKind: projection.sourceKind,
      sourceId: projection.sourceId,
      byteLength: projection.byteLength,
      lineCount: projection.lineCount,
      maxBytes: projection.maxBytes,
      maxLines: projection.maxLines,
      truncated: projection.truncated,
      omittedBytes: projection.omittedBytes,
      omittedLines: projection.omittedLines,
      sourceManifest: projection.sourceManifest,
      terminal: projection.sourceManifest.terminal,
      custody: { exact: true, rawBody: false, generatedSummary: false },
    });
  }

  validateProjectionPointer(exactPointer, { sessionId } = {}) {
    try {
      const projection = this.reopenProjection(exactPointer, { sessionId });
      const { content: _content, ...custody } = projection;
      return custody;
    } catch (error) {
      if (error?.code) return null;
      throw error;
    }
  }

  validateProjectionReceipt({ exactPointer, projectionId, projectionHash, sourceHash }, { sessionId } = {}) {
    if (typeof projectionId !== 'string' || !projectionId || typeof projectionHash !== 'string' || !projectionHash || typeof sourceHash !== 'string' || !sourceHash) return null;
    try {
      const projection = this.getProjection(projectionId);
      if (!projection || projection.exactPointer !== exactPointer || projection.contentHash !== projectionHash || projection.sourceHash !== sourceHash) return null;
      const job = this.getJob(projection.jobId);
      if (!job || job.sessionId !== sessionId) return null;
      const exact = this.readExact(exactPointer);
      if (exact.sourceHash !== projection.sourceHash) return null;
      const { content: _content, ...custody } = projection;
      return custody;
    } catch (error) {
      if (error?.code) return null;
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}
