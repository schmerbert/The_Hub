const HUB_ID = 'place.hub';

function placeName(id) {
  const special = {
    'place.garden': 'Garden',
    'place.house': 'House',
    'place.forest': 'Forest',
    'place.threshold': 'Threshold',
    'room.center': 'Center',
    'room.workshop': 'Workshop',
    'room.spotlight': 'Spotlight Observatory',
  };
  return special[id] || String(id).replace(/^(place|room)\./, '').replaceAll('_', ' ');
}

function shortestPath(start, goal, traversableEdges) {
  if (start === goal) return [start];
  const queue = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    for (const edge of traversableEdges.filter(item => item.fromNodeId === path.at(-1))) {
      if (visited.has(edge.toNodeId)) continue;
      const next = [...path, edge.toNodeId];
      if (edge.toNodeId === goal) return next;
      visited.add(edge.toNodeId);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Render bounded structural knowledge from a verified World projection.
 * Containment establishes existence; door/passage edges establish only a
 * known route, not that every stateful passage is presently open.
 */
export function spatialHorizon({ currentRoomId, nodes = [], edges = [] } = {}) {
  const nodeIds = new Set(nodes.map(node => node.id));
  const hubRooms = edges
    .filter(edge => edge.edgeType === 'contains' && edge.fromNodeId === HUB_ID && nodeIds.has(edge.toNodeId))
    .map(edge => edge.toNodeId)
    .sort((left, right) => left.localeCompare(right));
  if (!nodeIds.has(currentRoomId) || !nodeIds.has(HUB_ID) || !hubRooms.length) return null;

  const traversable = edges.filter(edge => ['door', 'passage'].includes(edge.edgeType));
  const workshopPath = nodeIds.has('room.workshop') ? shortestPath(currentRoomId, 'room.workshop', traversable) : null;
  const spotlightPath = nodeIds.has('room.spotlight') ? shortestPath(currentRoomId, 'room.spotlight', traversable) : null;
  const relation = currentRoomId === 'place.garden'
    ? 'South is the Hub.'
    : hubRooms.includes(currentRoomId)
      ? `You are within the Hub in the ${placeName(currentRoomId)}.`
      : 'The Garden is the exterior junction beside the Hub.';
  const inventory = `Verified Hub rooms: ${hubRooms.map(id => `${placeName(id)} (${id})`).join(', ')}.`;
  const workshop = currentRoomId === 'room.workshop'
    ? 'You are presently in the Workshop.'
    : workshopPath
      ? `Known route to the Workshop: ${workshopPath.map(placeName).join(' -> ')}.`
      : 'The Workshop exists within the Hub, but no traversable route from here is installed.';
  const spotlight = nodeIds.has('room.spotlight')
    ? spotlightPath
      ? `Known route to the Spotlight Observatory: ${spotlightPath.map(placeName).join(' -> ')}.`
      : 'The Spotlight Observatory exists within the Hub, but no traversable route to it is installed.'
    : null;
  return [relation, inventory, workshop, spotlight].filter(Boolean).join(' ');
}
