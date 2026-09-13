// Global Jest setup for client-side tests (loaded automatically by react-scripts).
import '@testing-library/jest-dom';

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
