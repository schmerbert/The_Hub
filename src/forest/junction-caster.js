function dot(a, b) { let value = 0; for (let index = 0; index < a.length; index += 1) value += a[index] * b[index]; return value; }
function subtract(a, b) { return a.map((value, index) => value - b[index]); }
function scale(a, amount) { return a.map(value => value * amount); }
function normalize(a) { const length = Math.hypot(...a); return length > 1e-9 ? a.map(value => value / length) : a.map(() => 0); }
function lateral(vector, straight) { return normalize(subtract(vector, scale(straight, dot(vector, straight)))); }
function lateralRaw(vector, straight) { return subtract(vector, scale(straight, dot(vector, straight))); }

export function castPolarSemanticFork({ queryVector, candidates, priorAxis = null }) {
  if (candidates.length < 1) return { offers: [], axis: priorAxis, receipt: { policy: 'polar_semantic/v1', reason: 'empty_neighborhood' } };
  const straight = candidates[0]; const straightAxis = normalize(straight.vector);
  let best = null;
  for (let leftIndex = 1; leftIndex < candidates.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
    const a = candidates[leftIndex]; const b = candidates[rightIndex];
    const lateralA = lateral(a.vector, straightAxis); const lateralB = lateral(b.vector, straightAxis);
    const opposition = -dot(lateralA, lateralB);
    const lateralMidpoint = lateralRaw(a.vector, straightAxis).map((value, index) => value + lateralRaw(b.vector, straightAxis)[index]);
    const balance = 1 - Math.min(1, Math.hypot(...lateralMidpoint));
    const relevance = a.score + b.score;
    const score = relevance + balance + opposition;
    if (!best || score > best.score || (score === best.score && `${a.entryId}:${b.entryId}` < `${best.a.entryId}:${best.b.entryId}`)) best = { a, b, lateralA, lateralB, opposition, balance, relevance, score };
  }
  if (!best || best.opposition < 0.05) return { offers: [{ ...straight, direction: 'semantic_straight' }], axis: priorAxis, receipt: { policy: 'polar_semantic/v1', reason: 'poles_unresolved' } };
  const reference = priorAxis ? normalize(priorAxis) : best.lateralA;
  const ordered = dot(best.lateralA, reference) >= dot(best.lateralB, reference) ? [best.a, best.b] : [best.b, best.a];
  return {
    offers: [{ ...ordered[0], direction: 'semantic_left' }, { ...straight, direction: 'semantic_straight' }, { ...ordered[1], direction: 'semantic_right' }],
    axis: lateral(ordered[0].vector, straightAxis),
    receipt: { policy: 'polar_semantic/v1', straightEntryId: straight.entryId, leftEntryId: ordered[0].entryId, rightEntryId: ordered[1].entryId, relevance: best.relevance, balance: best.balance, opposition: best.opposition, objective: best.score },
  };
}
