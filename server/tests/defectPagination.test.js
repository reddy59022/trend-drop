/**
 * Red tests proving defects in cursor-based pagination (utils/pagination.js).
 *
 * DEFECT — `paginate(..., { cursor })` has two contract bugs:
 *   1. `pagination.total` is computed AFTER the cursor filter (`_id > cursor`)
 *      is injected, so `total` shrinks as the caller scrolls instead of
 *      reporting the full number of matching items. A UI that renders
 *      "1–20 of N" would show a smaller N on every page.
 *   2. The helper MUTATES the caller's `filter` object (it writes
 *      `filter._id = { $gt: cursor }` in place). A caller that reuses the same
 *      filter across an infinite-scroll sequence — the normal pattern — has its
 *      filter silently corrupted from one call to the next.
 *
 * These are pure-function defects, so the model is faked: the assertions are
 * about the numbers `paginate` returns and the object it is handed, not about
 * MongoDB.
 */
const { paginate } = require('../utils/pagination');

// A fake model whose `countDocuments` reflects whether the cursor `_id` filter
// is present, exactly as Mongo would: 55 docs total, 50 after the cursor.
function makeModel(totalDocs, afterCursor) {
  return {
    find() {
      const q = {
        sort() { return q; },
        skip() { return q; },
        limit() { return q; },
        populate() { return q; },
        select() { return q; },
        lean() { return Promise.resolve(Array.from({ length: 10 }, (_, i) => ({ _id: `id${i}` }))); },
      };
      return q;
    },
    countDocuments(filter) {
      const cursorApplied = !!(filter && filter._id && filter._id.$gt !== undefined);
      return Promise.resolve(cursorApplied ? afterCursor : totalDocs);
    },
  };
}

describe('DEFECT: cursor pagination total + caller-filter mutation', () => {
  test('pagination.total reports the FULL match count, not the post-cursor count', async () => {
    const Model = makeModel(55, 50);
    const res = await paginate(Model, { cursor: 'id5', limit: 10, filter: { available: true } });
    // Scrolling deeper must not change how many items exist in total.
    expect(res.pagination.total).toBe(55);
  });

  test('total is stable across successive cursor pages', async () => {
    const Model = makeModel(55, 50);
    const page1 = await paginate(Model, { cursor: 'id5', limit: 10, filter: {} });
    const page2 = await paginate(Model, { cursor: 'id15', limit: 10, filter: {} });
    expect(page1.pagination.total).toBe(55);
    expect(page2.pagination.total).toBe(55);
  });

  test('the caller\'s filter object is NOT mutated by a cursor query', async () => {
    const Model = makeModel(55, 50);
    const filter = { available: true };
    const snapshot = JSON.stringify(filter);
    await paginate(Model, { cursor: 'id5', limit: 10, filter });
    expect(JSON.stringify(filter)).toBe(snapshot);
    expect(filter._id).toBeUndefined();
  });

  test('REGRESSION GUARD: offset pagination still returns a correct total and does not mutate filter', async () => {
    const Model = makeModel(55, 50);
    const filter = { available: true };
    const res = await paginate(Model, { page: 2, limit: 10, filter });
    expect(res.pagination.total).toBe(55);
    expect(filter._id).toBeUndefined();
  });
});
