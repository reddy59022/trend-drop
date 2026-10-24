/**
 * Accessibility regression: every <button> must have an accessible name.
 *
 * A button whose entire content is an icon (or a bare ×/«/» glyph) announces
 * nothing to screen readers and shows up in the accessibility tree as an
 * unnamed button. This test scans all component/page source and fails on any
 * button that has neither aria-label/aria-labelledby nor visible text.
 *
 * (TDD history: this test was written after a live production audit found
 * unnamed icon-only buttons in the search page like buttons, cart quantity
 * steppers, admin report actions, collection/saved-search editors, and modal
 * close buttons. All were fixed and this test pins the class.)
 */
const fs = require('fs');
const path = require('path');

function collectJsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue;
      collectJsFiles(p, acc);
    } else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
      acc.push(p);
    }
  }
  return acc;
}

/** Find the end index of a JSX opening tag starting at `start` ('<button'). */
function findOpenTagEnd(src, start) {
  let i = start + '<button'.length;
  let braceDepth = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      braceDepth += 1;
    } else if (c === '}') {
      braceDepth -= 1;
    } else if (c === '>' && braceDepth <= 0) {
      return i;
    }
    i += 1;
  }
  return -1;
}

function findMatchingClose(src, openEnd) {
  let j = openEnd + 1;
  let openCount = 1;
  while (j < src.length && openCount > 0) {
    const next = src.indexOf('<button', j);
    const close = src.indexOf('</button>', j);
    if (close === -1) return -1;
    if (next !== -1 && next < close) {
      openCount += 1;
      j = next + '<button'.length;
    } else {
      openCount -= 1;
      j = close + '</button>'.length;
    }
  }
  return j;
}

const SRC_ROOT = path.join(__dirname);

describe('accessibility: every button has an accessible name', () => {
  const files = collectJsFiles(SRC_ROOT);

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no icon-only buttons without aria-label or visible text', () => {
    const offenders = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      let idx = src.indexOf('<button');
      while (idx !== -1) {
        const openEnd = findOpenTagEnd(src, idx);
        if (openEnd === -1) break;
        const openTag = src.slice(idx, openEnd + 1);
        const relPath = path.relative(SRC_ROOT, file);
        const line = src.slice(0, idx).split('\n').length;

        const hasLabel = /aria-label\s*=|aria-labelledby\s*=/.test(openTag);
        if (!hasLabel) {
          if (/\/>\s*$/.test(openTag)) {
            offenders.push(`${relPath}:${line} (self-closing, no label)`);
          } else {
            const closeEnd = findMatchingClose(src, openEnd);
            const inner = closeEnd === -1 ? '' : src.slice(openEnd + 1, closeEnd - '</button>'.length);
            // Strip nested JSX tags; what remains is rendered text
            // (including {expressions} that evaluate to labels).
            const text = inner.replace(/<[^>]*>/g, '').trim();
            if (!/[A-Za-z0-9]/.test(text)) {
              offenders.push(`${relPath}:${line} ${openTag.replace(/\s+/g, ' ').slice(0, 70)}`);
            }
          }
        }

        idx = src.indexOf('<button', openEnd + 1);
      }
    }

    expect(offenders).toEqual([]);
  });
});
