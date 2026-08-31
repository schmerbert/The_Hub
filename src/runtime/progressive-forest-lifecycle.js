import { SemanticIndexStore } from '../forest/semantic-index.js';
import { LocalEmbeddingProvider } from '../forest/embedding-provider.js';
import { AmbientFeatherService } from '../forest/ambient-feathers.js';
import { ForestTraversalStore } from '../forest/traversal-store.js';
import { ForestTraversalService } from '../forest/traversal.js';
import { verifyForestAsync } from '../forest/verify-async.js';

/**
 * Owns the process-local lifecycle for a Forest that is opened before its
 * strict proof completes. Domain verifiers remain the authority for Forest
 * integrity; this module only coordinates their result and the one bounded
 * capability transition into the already-open store.
 */
export class ProgressiveForestLifecycle {
  constructor({
    enabled,
    config,
    db,
    readiness,
    wakeService,
    gateway,
    forest,
    forestOpenFailure = false,
    forestVerificationOptions,
    forestVerifier = verifyForestAsync,
    ambientFeatherServiceOverride = null,
    forestTraversalServiceOverride = null,
  }) {
    this.enabled = Boolean(enabled);
    this.config = config;
    this.db = db;
    this.readiness = readiness;
    this.wakeService = wakeService;
    this.gateway = gateway;
    this._forest = forest || null;
    this.forestOpenFailure = Boolean(forestOpenFailure);
    this.forestVerificationOptions = forestVerificationOptions;
    this.forestVerifier = forestVerifier || verifyForestAsync;
    this.ambientFeatherServiceOverride = ambientFeatherServiceOverride;
    this.forestTraversalServiceOverride = forestTraversalServiceOverride;

    this._semanticIndex = null;
    this._forestTraversalStore = null;
    this._ambientFeatherService = null;
    this._forestTraversalService = null;
    this._forestVerification = null;
    this.forestVerificationAbortController = null;
    this.forestVerificationPromise = null;
    this.forestActivationPromise = null;
    this.startupGeneration = 1;
    this.forestSourceSnapshot = null;
    this.forestDataVersionSnapshot = null;
    this.closing = false;
  }

  // Public projections hide the opened-but-unverified store from callers.
  get forest() {
    return this.enabled && !this.readiness.is('forest', 'ready') ? null : this._forest;
  }

  get forestTraversal() {
    return this.enabled && !this.readiness.is('forest', 'ready') ? null : this._forestTraversalService;
  }

  get forestVerification() {
    return this.enabled && !this.readiness.is('forest', 'ready') ? null : this._forestVerification;
  }

  get verificationPromise() { return this.forestVerificationPromise; }

  closeProgressiveForest() {
    this.gateway.forest = null;
    this.wakeService.forest = null;
    this.wakeService.ambientFeatherService = null;
    this.wakeService.forestTraversalService = null;
    try { this._forestTraversalStore?.close(); } catch {}
    try { this._semanticIndex?.close(); } catch {}
    try { this._forest?.close(); } catch {}
    this._forestTraversalStore = null;
    this._semanticIndex = null;
    this._forest = null;
    this._forestVerification = null;
    this._ambientFeatherService = null;
    this._forestTraversalService = null;
  }

  currentSourceSnapshot() {
    return JSON.stringify(this.db.listEligibleUtteranceEvents().map(event => [
      event.id,
      event.content,
      event.createdAt,
      event.actorKind,
      event.threadId,
      event.wakeId || null,
    ]));
  }

  async activate(verification, generation) {
    if (this.closing || generation !== this.startupGeneration || !this._forest || this.readiness.is('forest', 'ready')) return;

    // A wake that began while Forest was pending must complete without Forest
    // before the process-local capability transition can take place.
    const wakeWasActive = Boolean(this.wakeService.activeWakePromise);
    if (this.wakeService.activeWakePromise) {
      try { await this.wakeService.activeWakePromise; } catch {}
    }
    if (this.closing || generation !== this.startupGeneration || !this._forest || this.readiness.is('forest', 'ready')) return;

    const currentSourceSnapshot = this.currentSourceSnapshot();
    const currentForestDataVersion = typeof this._forest.dataVersion === 'function' ? this._forest.dataVersion() : null;
    if (wakeWasActive || currentSourceSnapshot !== this.forestSourceSnapshot || currentForestDataVersion !== this.forestDataVersionSnapshot) {
      // The worker proof belongs to an earlier Source view. A pending wake is
      // deliberately not retroactively admitted to Forest in v1, so this
      // generation remains unavailable instead of blessing stale custody.
      this.closeProgressiveForest();
      this.readiness.settle('forest', 'failed', { code: 'forest_verification_stale' });
      return;
    }
    if (!verification?.ok) {
      this.closeProgressiveForest();
      this.readiness.settle('forest', 'failed', { code: 'forest_verification_failed' });
      return;
    }

    const candidate = this._forest;
    let nextIndex = null;
    let nextAmbient = this.ambientFeatherServiceOverride || null;
    let nextTraversalStore = null;
    let nextTraversal = this.forestTraversalServiceOverride || null;
    try {
      if (!nextAmbient) {
        nextIndex = new SemanticIndexStore(this.config.semanticIndexPath);
        nextAmbient = new AmbientFeatherService({
          forest: candidate,
          index: nextIndex,
          embeddingProvider: new LocalEmbeddingProvider({ model: this.config.embeddingModel, cacheDir: this.config.embeddingCachePath }),
        });
      }
      if (nextAmbient && !nextTraversal) {
        nextTraversalStore = new ForestTraversalStore(this.config.forestTraversalPath);
        nextTraversal = new ForestTraversalService({ store: nextTraversalStore, forest: candidate, ambientFeatherService: nextAmbient });
      }
      if (this.closing || generation !== this.startupGeneration || candidate !== this._forest) {
        nextTraversalStore?.close();
        nextIndex?.close();
        return;
      }
      // This block is the one capability transition: every Forest-dependent
      // owner receives the exact verified store before readiness is settled.
      this._semanticIndex = nextIndex;
      this._ambientFeatherService = nextAmbient;
      this._forestTraversalStore = nextTraversalStore;
      this._forestTraversalService = nextTraversal;
      this._forestVerification = verification;
      this.wakeService.forest = candidate;
      this.wakeService.forestDataVersion = typeof candidate.dataVersion === 'function' ? candidate.dataVersion() : null;
      this.wakeService.ambientFeatherService = nextAmbient;
      this.wakeService.forestTraversalService = nextTraversal;
      this.gateway.forest = candidate;
      this.readiness.settle('forest', 'ready', { code: 'forest_verified' });
    } catch {
      nextTraversalStore?.close();
      nextIndex?.close();
      this.closeProgressiveForest();
      this.readiness.settle('forest', 'failed', { code: 'forest_activation_failed' });
    }
  }

  start() {
    if (!this.enabled) return null;
    if (!this._forest) {
      if (!this.readiness.is('forest', 'failed')) {
        this.readiness.settle('forest', 'failed', { code: this.forestOpenFailure ? 'forest_open_failed' : 'forest_unavailable' });
      }
      return null;
    }

    this.forestVerificationAbortController = new AbortController();
    const generation = this.startupGeneration;
    this.forestSourceSnapshot = this.currentSourceSnapshot();
    this.forestDataVersionSnapshot = typeof this._forest.dataVersion === 'function' ? this._forest.dataVersion() : null;
    try {
      this.forestVerificationPromise = Promise.resolve(this.forestVerifier(this.forestVerificationOptions, { signal: this.forestVerificationAbortController.signal }))
        .then(verification => this.activate(verification, generation))
        .catch(() => {
          if (this.closing || generation !== this.startupGeneration) return;
          void this.activate(null, generation);
        });
      this.forestActivationPromise = this.forestVerificationPromise;
    } catch {
      this.forestVerificationPromise = Promise.resolve().then(() => {
        if (!this.closing && generation === this.startupGeneration) return this.activate(null, generation);
      });
      this.forestActivationPromise = this.forestVerificationPromise;
    }
    return this.forestVerificationPromise;
  }

  beginClose() {
    this.closing = true;
    this.startupGeneration += 1;
    this.forestVerificationAbortController?.abort();
    return this.forestActivationPromise || this.forestVerificationPromise;
  }

  /** Close lifecycle-owned stores after pending verification/activation settles. */
  closeStores() {
    const failures = [];
    try { this._forestTraversalStore?.close(); } catch (error) { failures.push(error); }
    try { this._semanticIndex?.close(); } catch (error) { failures.push(error); }
    try { this._forest?.close(); } catch (error) { failures.push(error); }
    return failures;
  }
}

export function createProgressiveForestLifecycle(dependencies) {
  return new ProgressiveForestLifecycle(dependencies);
}
