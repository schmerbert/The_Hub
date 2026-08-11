function outcome(result, { changedRoom = false } = {}) { return { result, source: null, changedRoom }; }

export const NAVIGATION_HANDLERS = Object.freeze({
  move_through_door: ({ world, sessionId, wakeId, commandId, args }) => outcome(
    world.move({ sessionId, wakeId, commandId, doorId: args.door_id }),
    { changedRoom: true },
  ),
  move_through_passage: ({ world, sessionId, wakeId, commandId, args }) => outcome(
    world.moveThroughPassage({ sessionId, wakeId, commandId, passageId: args.passage_id }),
    { changedRoom: true },
  ),
  operate_passage: ({ world, sessionId, wakeId, commandId, args }) => outcome(
    world.operatePassage({ sessionId, wakeId, commandId, passageId: args.passage_id, action: args.action }),
  ),
  turn_fixture: ({ world, sessionId, wakeId, commandId, args }) => outcome(
    world.turnFixture({ sessionId, wakeId, commandId, fixtureId: args.fixture_id }),
  ),
  inspect_fixture: ({ world, sessionId, args, fixtureContents }) => {
    const result = world.inspectFixture({ sessionId, fixtureId: args.fixture_id });
    result.contents = fixtureContents(sessionId, args.fixture_id);
    return outcome(result);
  },
  engage_fixture: ({ world, sessionId, wakeId, commandId, args, fixtureContents }) => {
    const result = world.engageFixture({ sessionId, wakeId, commandId, fixtureId: args.fixture_id });
    result.contents = fixtureContents(sessionId, args.fixture_id);
    return outcome(result);
  },
  disengage_fixture: ({ world, sessionId, wakeId, commandId }) => outcome(world.disengageFixture({ sessionId, wakeId, commandId })),
  workshop_timer_set: ({ world, sessionId, wakeId, commandId, args }) => outcome(world.setTimer(sessionId, args.seconds, { wakeId, commandId })),
  workshop_timer_status: ({ world, sessionId }) => outcome(world.getTimer(sessionId)),
  workshop_timer_cancel: ({ world, sessionId, wakeId, commandId }) => outcome(world.cancelTimer(sessionId, { wakeId, commandId })),
});
