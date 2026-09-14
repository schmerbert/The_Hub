import { residentToolProfile, schemasForResidentSession } from '../world/tools.js';
import { REOPEN_RESULT_TOOL, RESULT_REOPEN_TOOL_NAME } from '../context/result-exhale.js';
import { REST_FOR_TOOL, REST_FOR_TOOL_NAME, autonomousToolAllowed } from './autonomous-wakes.js';

export function fitToolContinuationRound({
  world,
  sessionId,
  config,
  forestTraversalService = null,
  autonomous = false,
  round,
  roundLimit,
}) {
  const finalOpportunity = round === roundLimit;
  const location = world.current(sessionId);
  const roomId = location.room_node_id;
  const forestTools = forestTraversalService?.tools(sessionId, roomId) || [];
  const forestState = forestTraversalService?.projection(sessionId) || { active: false };
  const forestActive = forestState.active === true;
  const fittedWorldTools = schemasForResidentSession(world, sessionId, {
    workshopMaxLines: config.workshopMaxLines,
    workshopMaxResults: config.workshopMaxResults,
  });
  let worldTools = forestActive
    ? forestState.entranceRegister === 'physical'
      ? fittedWorldTools.filter(tool => tool.function.name === 'move_through_passage')
      : []
    : fittedWorldTools;
  if (autonomous) worldTools = worldTools.filter(tool => autonomousToolAllowed(tool.function.name, { forestToolNames: forestTools.map(tool => tool.function.name) }));
  const fittedForestTools = autonomous
    ? forestTools.filter(tool => autonomousToolAllowed(tool.function.name, { forestToolNames: forestTools.map(tool => tool.function.name) }))
    : forestTools;
  const fittedProfile = forestActive
    ? {
        roomId: 'place.forest',
        activeGroup: 'forest_walk',
        names: [...worldTools.map(tool => tool.function.name), ...fittedForestTools.map(tool => tool.function.name)],
        completeCount: worldTools.length + fittedForestTools.length,
        omittedCount: 0,
      }
    : (() => {
        const profile = residentToolProfile(world, sessionId);
        const names = [...worldTools.map(tool => tool.function.name), ...fittedForestTools.map(tool => tool.function.name)];
        return {
          ...profile,
          names,
          completeCount: autonomous ? names.length : profile.completeCount + fittedForestTools.length,
          omittedCount: autonomous ? Math.max(profile.completeCount - worldTools.length, 0) : profile.omittedCount,
        };
      })();
  const toolProfile = {
    ...fittedProfile,
    names: [...fittedProfile.names, RESULT_REOPEN_TOOL_NAME, REST_FOR_TOOL_NAME],
    completeCount: fittedProfile.completeCount + 2,
  };
  return {
    finalOpportunity,
    location,
    roomId,
    forestTools: fittedForestTools,
    worldTools,
    toolProfile,
    tools: finalOpportunity ? [] : [...worldTools, ...fittedForestTools, REOPEN_RESULT_TOOL, REST_FOR_TOOL],
    toolRoundBudget: {
      used: round,
      remaining: Math.max(roundLimit - round, 0),
      limit: roundLimit,
      finalOpportunity,
    },
  };
}
