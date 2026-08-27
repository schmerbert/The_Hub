import { join } from 'node:path';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_QUERY_INSTRUCTION = 'Represent this sentence for searching relevant passages: ';

export class LocalEmbeddingProvider {
  constructor({ model = DEFAULT_EMBEDDING_MODEL, cacheDir = join(process.cwd(), '.runtime', 'models'), dimensions = DEFAULT_EMBEDDING_DIMENSIONS, allowRemoteModels = false } = {}) {
    this.model = model;
    this.cacheDir = cacheDir;
    this.dimensions = dimensions;
    this.allowRemoteModels = allowRemoteModels;
    this.pipelinePromise = null;
  }

  identity() {
    return { provider: 'transformers.js', model: this.model, dimensions: this.dimensions, normalization: 'l2', dtype: 'q8', queryInstruction: DEFAULT_QUERY_INSTRUCTION };
  }

  async pipeline() {
    if (!this.pipelinePromise) this.pipelinePromise = import('@huggingface/transformers').then(async ({ pipeline, env }) => {
      env.cacheDir = this.cacheDir;
      env.allowRemoteModels = this.allowRemoteModels;
      return pipeline('feature-extraction', this.model, { dtype: 'q8' });
    });
    return this.pipelinePromise;
  }

  async embed(texts, { query = false } = {}) {
    if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string' || !text.trim())) throw new Error('Embedding input must contain non-empty strings.');
    const extractor = await this.pipeline();
    const prepared = query ? texts.map(text => DEFAULT_QUERY_INSTRUCTION + text) : texts;
    const output = await extractor(prepared, { pooling: 'mean', normalize: true });
    const rows = output.tolist();
    if (rows.some(row => row.length !== this.dimensions)) throw new Error('Embedding model returned incompatible dimensions.');
    return rows;
  }
}
