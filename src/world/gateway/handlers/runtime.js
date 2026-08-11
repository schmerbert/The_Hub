import { listRecipes } from '../../recipes.js';
import { KILN_FIXTURE_ID } from '../../graph.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function outcome(result) { return { result, source: null, changedRoom: false }; }

export const RUNTIME_HANDLERS = Object.freeze({
  workshop_recipe_list: () => outcome({ kind: 'workshop_recipe_list', recipes: listRecipes() }),
  workshop_run_recipe: async ({ recipes, args, noteKiln, onRecipeComplete }) => {
    try {
      noteKiln({ status: 'running', recipe: args.recipe });
      const result = await recipes.start(args.recipe, { path: args.path, script: args.script }, { onComplete: onRecipeComplete });
      return outcome(result);
    } catch (error) {
      noteKiln({ status: 'failed', recipe: args.recipe, reason: error?.message || 'recipe_failed' });
      throw error;
    }
  },
  workshop_recipe_status: ({ recipes, world }) => {
    const runner = recipes.status();
    const kiln = world.getFixtureRuntime(KILN_FIXTURE_ID) || { status: 'idle' };
    return outcome({ ...runner, kiln });
  },
  workshop_recipe_cancel: async ({ recipes, noteKiln }) => {
    const result = await recipes.cancel('cancelled_by_tool');
    if (result.cancelled) noteKiln({ status: 'cancelled', recipe: recipes.lastRecipe || null, reason: 'cancelled_by_tool' });
    return outcome(result);
  },
  workshop_sandbox_diff: async ({ recipes }) => {
    if (typeof recipes.diff !== 'function') fail('sandbox_backend_unavailable', 'Workshop recipes are not using an isolated Sandbox Bay.');
    return outcome({ kind: 'workshop_sandbox_diff', ...(await recipes.diff()) });
  },
  workshop_sandbox_promote: async ({ recipes, sessionId, wakeId, promotionPreview, pendingConfirm }) => {
    if (typeof recipes.promotionPlan !== 'function') fail('sandbox_backend_unavailable', 'Workshop recipes are not using an isolated Sandbox Bay.');
    const plan = await recipes.promotionPlan();
    if (!plan.promotable) fail('sandbox_promotion_stale', 'Sandbox candidate cannot be promoted because the canonical checkout is dirty or advanced.');
    const preview = promotionPreview({ sessionId, wakeId, plan });
    return outcome(pendingConfirm(sessionId, wakeId, 'sandbox_promotion', { plan }, preview, 'workshop_sandbox_promote'));
  },
});
