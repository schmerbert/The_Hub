export function renderAutonomousWakeGround(origin) {
  if (!origin || origin.kind !== 'self_directed') return null;
  const intention = origin.plan.intention?.trim() || 'No fixed errand was retained. Wander, notice, or rest as seems fitting.';
  const timing = origin.timing;
  const timeGround = timing ? ` You sat at ${timing.restedAt}. You requested exactly ${timing.requestedDurationMs} milliseconds of rest, so the wake became due at ${timing.dueAt}. This wake began at ${timing.wokeAt}; exactly ${timing.elapsedMs} milliseconds elapsed and dispatch was ${timing.latenessMs} milliseconds after the due time.` : '';
  return `Autonomous wake ground: this is a self-directed return in Resident life ${origin.plan.lifeId}, context generation ${origin.plan.contextGeneration}; it is not a human message or a context-reset successor. You wake at the verified seat where you chose to rest.${timeGround} Your continuing intention is: ${JSON.stringify(intention)} You may explore freely for up to 24 tool rounds within the tools actually mounted for this wake, change direction, find nothing, or rest again. Consequential hands are capped; absent tools are unavailable, not forgotten. Your path and final speech receive ordinary custody.`;
}
