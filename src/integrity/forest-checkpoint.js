import { basename, extname } from 'node:path';
import { verifyForest } from '../forest/verify.js';
import {
  SPINE_PROOF_VERSION,
  SPINE_SCHEMA_VERSION,
  SPINE_VERIFIER_VERSION,
  createSpineVerifiedProof,
  validateSpineVerifiedProof,
} from '../spine/verified-index.js';
import { VerifiedAncestryStore } from './checkpoint-store.js';

function spineIdentity(path) {
  return { domain: 'spine', name: basename(path, extname(path)) || 'default' };
}

function persistentSpineProof(proof) {
  return {
    proofVersion: proof.proofVersion,
    verifierVersion: proof.verifierVersion,
    schemaVersion: proof.schemaVersion,
    storeIdentity: proof.storeIdentity,
    ledgers: proof.ledgers,
    globalRecordIds: proof.globalRecordIds,
    globalRecordHashes: proof.globalRecordHashes,
    preparedRequests: proof.preparedRequests,
    ledgerSetHash: proof.ledgerSetHash,
    compactIndexHash: proof.compactIndexHash,
  };
}

function manifestFor(proof) {
  return {
    proofVersion: proof.proofVersion,
    ledgerSetHash: proof.ledgerSetHash,
    compactIndexHash: proof.compactIndexHash,
    ledgerCount: proof.ledgers.length,
    frameCount: proof.globalRecordIds.length,
    requestCount: proof.preparedRequests.length,
    frontiers: proof.ledgers.map(ledger => ({
      logicalId: ledger.logicalId,
      byteBoundary: ledger.byteBoundary,
      frameCount: ledger.frameCount,
      terminalRecordHash: ledger.terminalRecordHash,
    })),
  };
}

function boundedCheckpoint(mode, checkpointCode, proof, elapsedMs) {
  return {
    domain: 'forest',
    mode,
    code: checkpointCode,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    spine: {
      ledgerCount: proof.ledgers.length,
      frameCount: proof.globalRecordIds.length,
      requestCount: proof.preparedRequests.length,
      appendedFrameCount: proof.appendedFrameCount || 0,
    },
  };
}

/**
 * Run the authoritative Forest proof while satisfying its Spine dependency
 * from a compatible verified prefix plus a fully checked suffix when possible.
 * Checkpoint failure is never success: it selects the existing full proof.
 */
export function verifyForestWithCheckpoint(options = {}, { forceFull = false } = {}) {
  const startedAt = performance.now();
  const { checkpointPath, ...forestOptions } = options;
  if (!checkpointPath || !forestOptions.spinePath) return verifyForest(forestOptions);

  const identity = spineIdentity(forestOptions.spinePath);
  let checkpointStore = null;
  let prior = null;
  let proof = null;
  let checkpointCode = forceFull ? 'verified_ancestry_full_requested' : 'verified_ancestry_checkpoint_miss';
  try {
    try {
      checkpointStore = new VerifiedAncestryStore(checkpointPath);
      if (checkpointStore.schemaStanding?.status !== 'ready') {
        checkpointCode = typeof checkpointStore.schemaStanding?.code === 'string'
          && checkpointStore.schemaStanding.code.startsWith('verified_ancestry_')
          ? checkpointStore.schemaStanding.code
          : 'verified_ancestry_checkpoint_refused';
      } else if (!forceFull) {
        prior = checkpointStore.findCompatible({
          domain: 'spine',
          verifierVersion: SPINE_VERIFIER_VERSION,
          schemaVersion: SPINE_SCHEMA_VERSION,
          storeIdentity: identity,
        });
        if (prior) {
          try {
            proof = validateSpineVerifiedProof(forestOptions.spinePath, prior.payload, { storeIdentity: identity });
            checkpointCode = proof.mode === 'checkpoint_unchanged' ? 'verified_ancestry_checkpoint_unchanged' : 'verified_ancestry_suffix_verified';
          } catch (error) {
            checkpointCode = error?.code || 'verified_ancestry_checkpoint_refused';
          }
        }
      }
    } catch (error) {
      // The checkpoint is only a rebuildable acceleration projection. Refusal,
      // corruption, or an unreadable store selects the authoritative full proof.
      checkpointCode = typeof error?.code === 'string' && error.code.startsWith('verified_ancestry_')
        ? error.code
        : 'verified_ancestry_checkpoint_refused';
      checkpointStore?.close();
      checkpointStore = null;
    }
    if (!proof) proof = createSpineVerifiedProof(forestOptions.spinePath, { storeIdentity: identity });

    const verification = verifyForest({ ...forestOptions, spineProof: proof });
    const mode = proof.mode || 'full';
    const shouldPublish = mode === 'full' || mode === 'checkpoint_suffix';
    if (shouldPublish && checkpointStore?.schemaStanding?.status === 'ready') {
      const latest = checkpointStore.listGenerations({ domain: 'spine', limit: 1 })[0] || null;
      const latestMaterial = latest ? checkpointStore.getGeneration(latest.generationId) : null;
      const payload = persistentSpineProof(proof);
      const manifest = manifestFor(proof);
      // A background full audit normally confirms the same frontier that was
      // accepted at startup. Do not duplicate that large proof generation.
      if (!latestMaterial || latestMaterial.manifest?.compactIndexHash !== manifest.compactIndexHash) {
        checkpointStore.publish({
          domain: 'spine',
          verifierVersion: SPINE_VERIFIER_VERSION,
          schemaVersion: SPINE_SCHEMA_VERSION,
          storeIdentity: identity,
          storeGeneration: { proofVersion: SPINE_PROOF_VERSION, ledgerSetHash: proof.ledgerSetHash },
          manifest,
          payload,
          indexes: { prepared_request_ids: proof.preparedRequests.map(request => request.recordId) },
          predecessorCheckpointHash: latest?.checkpointHash || null,
        });
      }
    }
    return {
      ...verification,
      checkpoint: boundedCheckpoint(mode, checkpointCode, proof, performance.now() - startedAt),
    };
  } finally {
    checkpointStore?.close();
  }
}
