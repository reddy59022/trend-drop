// Bounded, in-process velocity tracker for fraud checks.
//
// The previous map appended a timestamp per check forever, so a long-lived
// process leaked memory for every user who ever checked out. Entries are now
// trimmed to the one-hour window and hard-capped per user. This is deliberately
// dependency-free (works for free at any scale); a multi-instance deployment
// can swap the same interface for Redis without touching the fraud route.

const WINDOW_MS = 60 * 60 * 1000;
const MAX_ENTRIES_PER_USER = 1000;
const store = new Map();

function recentEntries(userId, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  const entries = (store.get(userId) || []).filter((t) => t > cutoff);
  if (entries.length > 0) store.set(userId, entries);
  else store.delete(userId);
  return entries;
}

function record(userId, now = Date.now()) {
  const entries = recentEntries(userId, now);
  entries.push(now);
  if (entries.length > MAX_ENTRIES_PER_USER) {
    entries.splice(0, entries.length - MAX_ENTRIES_PER_USER);
  }
  store.set(userId, entries);
  return entries.length;
}

function count(userId, now = Date.now()) {
  return recentEntries(userId, now).length;
}

function prune(now = Date.now()) {
  for (const userId of [...store.keys()]) recentEntries(userId, now);
}

function size() {
  return store.size;
}

function entryCount(userId) {
  return (store.get(userId) || []).length;
}

function reset() {
  store.clear();
}

module.exports = {
  WINDOW_MS,
  MAX_ENTRIES_PER_USER,
  record,
  count,
  prune,
  size,
  entryCount,
  reset,
};
