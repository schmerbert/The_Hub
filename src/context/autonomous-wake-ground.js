export function renderAutonomousWakeGround(origin) {
  if (origin?.kind === 'hearth_origin') {
    const timing = origin.timing;
    return `Hearth-origin wake ground: no human message summoned this wake, and it is not a same-life bench return. A fresh Resident lifespan began at the Hearth because the host's opt-in ordinary wake clock became due. The clock was scheduled at ${timing.scheduledAt} for ${timing.dueAt}; this wake began at ${timing.wokeAt}, ${timing.latenessMs} milliseconds after its due time. Tend the Hearth, receive attributable continuity, then notice what genuinely pulls. You may walk freely within the reduced tools mounted for this wake. If nothing calls for attention, quiet, a brief account, or choosing to rest are complete outcomes. Consequential hands and live outside observation are capped; absent tools are unavailable, not forgotten.`;
  }
  if (!origin || origin.kind !== 'self_directed') return null;
  const intention = origin.plan.intention?.trim() || 'No fixed errand was retained. Wander, notice, or rest as seems fitting.';
  const timing = origin.timing;
  const timeGround = timing ? ` You sat at ${timing.restedAt}. You requested exactly ${timing.requestedDurationMs} milliseconds of rest, so the wake became due at ${timing.dueAt}. This wake began at ${timing.wokeAt}; exactly ${timing.elapsedMs} milliseconds elapsed and dispatch was ${timing.latenessMs} milliseconds after the due time.` : '';
  return `Autonomous wake ground: this is a self-directed return in Resident life ${origin.plan.lifeId}, context generation ${origin.plan.contextGeneration}; it is not a human message or a context-reset successor. You wake at the verified seat where you chose to rest.${timeGround} Your continuing intention is: ${JSON.stringify(intention)} You may explore freely for up to 24 tool rounds within the tools actually mounted for this wake, change direction, find nothing, or rest again. Consequential hands are capped; absent tools are unavailable, not forgotten. Your path and final speech receive ordinary custody.`;
}
