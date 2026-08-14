// Canonical public surface for the complete room.workshop package.
export { WORKSHOP } from './declaration.js';
export { WorkshopAdapter } from './adapter.js';
export { sanitizeGitStderr, WorkshopGit } from './git.js';
export { buildRecipeEnvironment, buildRecipeInvocation, listRecipes, RecipeRunner } from './recipes.js';
export {
  buildDockerCreateArgs,
  buildSandboxEnvironment,
  DEFAULT_SANDBOX_RESOURCES,
  DockerCliSandboxBackend,
  HostTestSandboxBackend,
  SANDBOX_ENV_ALLOWLIST,
  SandboxBay,
} from './sandbox.js';
export { SandboxRecipeRunner } from './sandbox-recipes.js';
export { applySandboxPromotion } from './promotion.js';
export { assertWorkshopRepositoryPath, resolveRepositoryPath } from './path-law.js';

export const WORKSHOP_PACKAGE_VERSION = 2;
