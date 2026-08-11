function outcome(result, { changedRoom = false } = {}) { return { result, source: null, changedRoom }; }

export const NAVIGATION_HANDLERS = Object.freeze({
  move_through_door: ({ world, sessionId, wakeId, args }) => outcome(
    world.move({ sessionId, wakeId, doorId: args.door_id }),
    { changedRoom: true },
  ),
  inspect_fixture: ({ world, sessionId, args, fixtureContents }) => {
    const result = world.inspectFixture({ sessionId, fixtureId: args.fixture_id });
    result.contents = fixtureContents(sessionId, args.fixture_id);
    return outcome(result);
  },
  engage_fixture: ({ world, sessionId, wakeId, args, fixtureContents }) => {
    const result = world.engageFixture({ sessionId, wakeId, fixtureId: args.fixture_id });
    result.contents = fixtureContents(sessionId, args.fixture_id);
    return outcome(result);
  },
  disengage_fixture: ({ world, sessionId, wakeId }) => outcome(world.disengageFixture({ sessionId, wakeId })),
  workshop_timer_set: ({ world, sessionId, args }) => outcome(world.setTimer(sessionId, args.seconds)),
  workshop_timer_status: ({ world, sessionId }) => outcome(world.getTimer(sessionId)),
  workshop_timer_cancel: ({ world, sessionId }) => outcome(world.cancelTimer(sessionId)),
});
