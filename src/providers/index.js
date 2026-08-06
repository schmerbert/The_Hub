import { DeepSeekResidentProvider } from './deepseek.js';
import { FakeResidentProvider } from './fake.js';

export function createProvider(config, override) {
  if (override) return override;
  return config.mode === 'fake' ? new FakeResidentProvider(config) : new DeepSeekResidentProvider(config);
}
