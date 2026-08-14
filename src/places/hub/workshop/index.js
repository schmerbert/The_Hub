// Reference room package. Existing implementation paths remain compatibility
// facades until their migration register permits removal.
export { WORKSHOP } from '../workshop.js';
export { WorkshopAdapter } from '../../../world/workshop.js';
export { WorkshopGit } from '../../../world/git.js';
export { RecipeRunner } from '../../../world/recipes.js';
export { DockerCliSandboxBackend, SandboxBay } from '../../../world/sandbox.js';
export { SandboxRecipeRunner } from '../../../world/sandbox-recipes.js';
export { applySandboxPromotion } from '../../../world/promotion.js';
export { assertWorkshopRepositoryPath, resolveRepositoryPath } from '../../../workshop/path-law.js';

export const WORKSHOP_PACKAGE_VERSION = 1;
