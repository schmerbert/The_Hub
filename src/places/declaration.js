export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function placeModule({ id, nodes = [], edges = [], passages = [], objectStates = [], mountedTools = [] }) {
  return deepFreeze({ id, nodes, edges, passages, objectStates, mountedTools });
}
