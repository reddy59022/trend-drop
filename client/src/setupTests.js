// Global Jest setup for client-side tests (loaded automatically by react-scripts).
//
// ---------------------------------------------------------------------------
// Settle async work before unmounting
// ---------------------------------------------------------------------------
// Most pages fetch on mount and then chain follow-up requests (e.g. Sell's
// getFeatureFlags() -> setIntlShippingAllowed(), Register's legal-version
// lookup, Home's parallel listing requests). A test whose body does not wait
// for all of that finishes first, React applies the late setState with no act()
// scope open, and the suite logs:
//
//   Warning: An update to <Component> inside a test was not wrapped in act(...)
//
// That output buries genuine warnings, and the stranded update can land while
// the *next* test is running. Draining the pending queue here keeps every
// update attributed to its own test and keeps the suite output clean. Tests
// should still await what they assert on (findBy*/waitFor); this hook only
// catches work a test does not wait for.
//
// Ordering matters: the flush must happen while the component is still mounted,
// so Testing Library's own teardown has to run *after* it. `afterEach` hooks
// fire in registration order, and RTL registers its auto-cleanup the moment it
// is imported, so we disable that and call cleanup() ourselves at the end.
// The opt-out flag is read at import time, which is why it is set before any
// import (setupFilesAfterEnv runs before the test module, so nothing has pulled
// RTL in yet) and why RTL itself is required lazily below instead of imported
// at the top of this file.
process.env.RTL_SKIP_AUTO_CLEANUP = 'true';

import '@testing-library/jest-dom';

afterEach(async () => {
  // eslint-disable-next-line global-require
  const { act, cleanup } = require('@testing-library/react');
  await act(async () => {
    // A macrotask tick drains the microtask queue (every pending .then()
    // continuation) before the timer fires, then React flushes its updates.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
});

// jsdom lacks matchMedia (used by ThemeContext when mounted for real).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom lacks IntersectionObserver (used by image lazy-load / carousels).
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Pagination / detail pages call window.scrollTo.
if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = () => {};
} else if (typeof window !== 'undefined') {
  try { window.scrollTo = () => {}; } catch (e) { /* read-only in some jsdom versions */ }
}

// URL.createObjectURL is used by image-preview flows (Sell / EditListing).
if (typeof window !== 'undefined' && window.URL && !window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:mock-url';
  window.URL.revokeObjectURL = () => {};
}
