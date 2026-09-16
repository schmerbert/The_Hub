import { residentToolProfile, schemasForResidentSession } from '../world/tools.js';
import { REOPEN_RESULT_TOOL, RESULT_REOPEN_TOOL_NAME } from '../context/result-exhale.js';
import { REST_FOR_TOOL, REST_FOR_TOOL_NAME, autonomousToolAllowed } from './autonomous-wakes.js';
import { isQuietEmbodimentAction, quietEmbodimentRemaining } from './quiet-embodiment.js';

export function fitToolContinuationRound({
  world,
  sessionId,
  config,
  forestTraversalService = null,
  autonomous = false,
  round,
  roundLimit,
  quietEmbodimentUsed = 0,
  quietEmbodimentLimit = null,
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
  const quietEmbodimentActive = !autonomous && Number.isInteger(quietEmbodimentLimit);
  const quietEmbodimentSpent = quietEmbodimentActive && quietEmbodimentRemaining({ limit: quietEmbodimentLimit, attempted: quietEmbodimentUsed }) === 0;
  const quietEmbodimentOmitted = quietEmbodimentSpent ? worldTools.filter(tool => isQuietEmbodimentAction(tool.function.name)).length : 0;
  if (quietEmbodimentSpent) worldTools = worldTools.filter(tool => !isQuietEmbodimentAction(tool.function.name));
  const fittedForestTools = autonomous
    ? forestTools.filter(tool => autonomousToolAllowed(tool.function.name, { forestToolNames: forestTools.map(tool => tool.function.name) }))
    : forestTools;
  const fittedProfile = forestActive
    ? {
        roomId: 'place.forest',
        activeGroup: 'forest_walk',
        names: [...worldTools.map(tool => tool.function.name), ...fittedForestTools.map(tool => tool.function.name)],
        completeCount: worldTools.length + fittedForestTools.length,
        omittedCount: quietEmbodimentOmitted,
      }
    : (() => {
        const profile = residentToolProfile(world, sessionId);
        const names = [...worldTools.map(tool => tool.function.name), ...fittedForestTools.map(tool => tool.function.name)];
        return {
          ...profile,
          names,
          completeCount: autonomous ? names.length : profile.completeCount + fittedForestTools.length,
          omittedCount: autonomous ? Math.max(profile.completeCount - worldTools.length, 0) : profile.omittedCount + quietEmbodimentOmitted,
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
    quietEmbodiment: quietEmbodimentActive ? {
      used: quietEmbodimentUsed,
      remaining: quietEmbodimentRemaining({ limit: quietEmbodimentLimit, attempted: quietEmbodimentUsed }),
      limit: quietEmbodimentLimit,
      spent: quietEmbodimentSpent,
    } : null,
  };
}

export function publishToolCallsReady({ calls, response, created, phase, db, publish, toolCardPayload }) {
  const toolCallEventId = db.recordToolCall({
    wakeId: created.wakeId,
    sessionId: created.sessionId,
    message: response.result.message,
    returnScrub: response.returnScrub,
  });
  for (const call of calls) {
    publish('tool_call.ready', {
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      phase,
      payload: toolCardPayload(call.id || null, call.function?.name || 'unknown', 'ready', { providerRequestId: response.requestId }),
      source: { toolCallEventId, returnScrubReceiptId: response.returnScrub.receipt.receiptId },
    });
  }
  return toolCallEventId;
}

export function publishToolStarted({ call, response, toolCallEventId, created, phase, publish, toolCardPayload }) {
  publish('tool.started', {
    sessionId: created.sessionId,
    wakeId: created.wakeId,
    phase,
    payload: toolCardPayload(call.id || null, call.function?.name || 'unknown', 'running', { providerRequestId: response.requestId }),
    source: { toolCallEventId, providerRequestId: response.requestId },
  });
}

export function settleToolAction({ call, action, created, phase, db, publish, publishCards, toolCardPayload, forestTraversalService = null }) {
  const toolName = action.name || call.function?.name || 'unknown';
  const hostEventId = db.recordToolResult({
    wakeId: created.wakeId,
    sessionId: created.sessionId,
    toolName,
    result: action.result,
    hostReturnScrub: action.scrub,
  });
  if (toolName === 'move_through_passage' && action.result?.toLocationId === 'place.garden') {
    forestTraversalService?.completePhysicalReturn({
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      toolCallId: call.id || toolName,
      toPlaceId: action.result.toLocationId,
    });
  }
  const refused = action.result?.ok === false;
  publish(refused ? 'tool.refused' : 'tool.completed', {
    sessionId: created.sessionId,
    wakeId: created.wakeId,
    phase,
    payload: toolCardPayload(call.id || null, toolName, refused ? 'refused' : 'completed', {
      status: action.result?.status || (refused ? 'refused' : 'completed'),
    }),
    source: {
      hostEventId,
      actionReceiptId: action.actionReceipt?.receiptId || null,
      hostReturnReceiptId: action.scrub?.receipt?.receiptId || null,
    },
  });
  if (action.result?.status === 'pending_approval') {
    publish('approval.pending', {
      sessionId: created.sessionId,
      wakeId: created.wakeId,
      phase,
      payload: { approvalId: action.result.approvalId, toolCallId: call.id || null, toolName },
      source: {
        hostEventId,
        actionReceiptId: action.actionReceipt?.receiptId || null,
        approvalReceiptId: action.approvalReceipt?.receiptId || null,
      },
    });
  }
  publishCards(created, phase, call, action, hostEventId);
  return { toolName, hostEventId, refused };
}
