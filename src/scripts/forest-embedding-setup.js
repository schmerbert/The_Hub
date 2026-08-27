import { readConfig } from '../core/config.js';
import { LocalEmbeddingProvider } from '../forest/embedding-provider.js';

const config = readConfig();
const provider = new LocalEmbeddingProvider({ model: config.embeddingModel, cacheDir: config.embeddingCachePath, allowRemoteModels: true });
const [vector] = await provider.embed(['Forest embedding setup witness.']);
console.log(JSON.stringify({ status: 'ready', cachePath: config.embeddingCachePath, identity: provider.identity(), dimensions: vector.length }, null, 2));
