function intent(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

export async function placeInCenterFromHouse(world, gateway, sessionId, wakeId = 'test-house-navigation') {
  world.ensureLifespan(sessionId);
  if (world.current(sessionId).room_node_id !== 'place.house') throw new Error('Workshop test setup must begin in the House.');
  await gateway.execute({ sessionId, wakeId, intent: intent(`${wakeId}:open-front-door`, 'operate_passage', { passage_id: 'passage.garden_house', action: 'open' }) });
  await gateway.execute({ sessionId, wakeId, intent: intent(`${wakeId}:house-to-garden`, 'move_through_passage', { passage_id: 'passage.garden_house' }) });
  await gateway.execute({ sessionId, wakeId, intent: intent(`${wakeId}:garden-to-center`, 'move_through_passage', { passage_id: 'passage.center_garden' }) });
}

export async function placeInWorkshopFromHouse(world, gateway, sessionId, wakeId = 'test-house-navigation') {
  await placeInCenterFromHouse(world, gateway, sessionId, wakeId);
  await gateway.execute({ sessionId, wakeId, intent: intent(`${wakeId}:center-to-workshop`, 'move_through_door', { door_id: 'door.workshop' }) });
}
