/**
 * TDD round: the fraud velocity tracker must not grow without bound.
 */
const tracker = require('../utils/velocityTracker');

describe('VT.1 velocity tracker bounds', () => {
  beforeEach(() => tracker.reset());

  test('keeps at most the cap of timestamps per user', () => {
    const now = Date.now();
    for (let i = 0; i < 1200; i += 1) tracker.record('user-a', now);
    expect(tracker.entryCount('user-a')).toBeLessThanOrEqual(1000);
    expect(tracker.count('user-a', now - 60 * 60 * 1000)).toBeLessThanOrEqual(1000);
  });

  test('does not count timestamps older than the one-hour window', () => {
    const now = Date.now();
    tracker.record('user-b', now - 2 * 60 * 60 * 1000);
    expect(tracker.count('user-b', now - 60 * 60 * 1000)).toBe(0);
    expect(tracker.entryCount('user-b')).toBe(0);
  });

  test('prune drops users with no recent activity without touching active ones', () => {
    const now = Date.now();
    tracker.record('stale', now - 3 * 60 * 60 * 1000);
    tracker.record('active', now);
    tracker.prune(now);
    expect(tracker.size()).toBe(1);
    expect(tracker.count('active', now - 60 * 60 * 1000)).toBe(1);
  });
});
