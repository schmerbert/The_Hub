import { listRecipes } from '../../recipes.js';
import { KILN_FIXTURE_ID } from '../../graph.js';
import { id } from '../../../core/hash.js';

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function outcome(result) { return { result, source: null, changedRoom: false }; }

export const RUNTIME_HANDLERS = Object.freeze({
  tend_hearth: ({ readHearth, sessionId }) => {
    if (typeof readHearth !== 'function') fail('hearth_reread_unavailable', 'The settled Hearth packet is not available to reread.');
    const packet = readHearth(sessionId);
    if (!packet || typeof packet.scrollMarkdown !== 'string' || !packet.scrollMarkdown) fail('hearth_reread_unavailable', 'The settled Hearth packet is not available to reread.');
    return outcome({
      kind: 'house_hearth_reread',
      status: 'reopened',
      markdown: packet.scrollMarkdown,
      hearthPacket: structuredClone(packet.returnValue),
      hearthReceiptId: packet.hearthReceiptId || null,
      settledWakeId: packet.wakeId || null,
      returnHash: packet.returnHash || null,
      scrollHash: packet.scrollHash || null,
      settlementUnchanged: true,
      inheritanceSelection: 'unchanged',
    });
  },
  workshop_recipe_list: () => outcome({ kind: 'workshop_recipe_list', recipes: listRecipes() }),
  workshop_run_recipe: async ({ recipes, args, noteKiln, onRecipeComplete, commitOutcome, registerKilnRun, activateKilnRun, compensateRecipeStart }) => {
    const runId = id('kiln_run'); registerKilnRun(runId, args.recipe);
    try {
      const result = await recipes.start(args.recipe, { path: args.path, script: args.script }, { onComplete: finalResult => onRecipeComplete(finalResult, runId) });
      let committed;
      try { committed = commitOutcome(() => {
        const event = noteKiln({ status: 'running', runId, recipe: args.recipe }, 'recipe_started');
        return outcome({ ...result, worldEventSequence: event.worldEventSequence, worldEventHash: event.worldEventHash });
      }); } catch (error) { await compensateRecipeStart(runId, error); throw error; }
      activateKilnRun(runId);
      return committed;
    } catch (error) {
      registerKilnRun(runId, null, { discard: true });
      throw error;
    }
  },
  workshop_recipe_status: ({ recipes, world }) => {
    const runner = recipes.status();
    const kiln = world.getFixtureRuntime(KILN_FIXTURE_ID) || { status: 'idle' };
    return outcome({ ...runner, kiln });
  },
  workshop_recipe_cancel: async ({ cancelKilnRun }) => cancelKilnRun(),
  workshop_sandbox_diff: async ({ recipes }) => {
    if (typeof recipes.diff !== 'function') fail('sandbox_backend_unavailable', 'Workshop recipes are not using an isolated Sandbox Bay.');
    return outcome({ kind: 'workshop_sandbox_diff', ...(await recipes.diff()) });
  },
  workshop_sandbox_promote: async ({ recipes, sessionId, wakeId, promotionPreview, pendingConfirm, commitOutcome }) => {
    if (typeof recipes.promotionPlan !== 'function') fail('sandbox_backend_unavailable', 'Workshop recipes are not using an isolated Sandbox Bay.');
    const plan = await recipes.promotionPlan();
    if (!plan.promotable) fail('sandbox_promotion_stale', 'Sandbox candidate cannot be promoted because the canonical checkout is dirty or advanced.');
    const preview = promotionPreview({ sessionId, wakeId, plan });
    return commitOutcome(() => outcome(pendingConfirm(sessionId, wakeId, 'sandbox_promotion', { plan }, preview, 'workshop_sandbox_promote')));
  },
});
