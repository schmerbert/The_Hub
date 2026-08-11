export const CONVERSATION_TAIL_THRESHOLD_PX = 48;

function metric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function captureConversationScroll(scroller, { forceTail = false, threshold = CONVERSATION_TAIL_THRESHOLD_PX } = {}) {
  const scrollTop = metric(scroller?.scrollTop);
  const clientHeight = metric(scroller?.clientHeight);
  const scrollHeight = metric(scroller?.scrollHeight);
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    followTail: Boolean(forceTail) || scrollHeight - clientHeight - scrollTop <= threshold,
  };
}

export function restoreConversationScroll(scroller, snapshot) {
  if (!scroller || !snapshot) return;
  scroller.scrollTop = snapshot.followTail ? metric(scroller.scrollHeight) : snapshot.scrollTop;
}

export function reconcileThinkingDisclosure(current, { wakeId, hasThinking, renderedOpen } = {}) {
  if (!hasThinking || typeof wakeId !== 'string' || !wakeId) return { wakeId: null, open: false };
  if (current?.wakeId !== wakeId) return { wakeId, open: false };
  return { wakeId, open: typeof renderedOpen === 'boolean' ? renderedOpen : current.open === true };
}
