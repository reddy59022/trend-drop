/**
 * Keyboard / screen-reader contracts for the community, admin and dashboard
 * surfaces. These pages have no interactive containers of their own, so the
 * regressions that reach them are structural: a clickable wrapper that swallows
 * its own nested controls, a table with no header scope or name, a field named
 * only by its placeholder, and results that update with no live region.
 *
 * Source-level assertions keep them pinned without a browser: each one maps to
 * a measured axe violation or a Tab journey recorded in the audit.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
// Comments explain the fixes below and would otherwise match the patterns.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

describe('expanding order and return rows keep nested controls valid', () => {
  test.each([
    ['Transactions.js', 'txn-detail', 'payment breakdown for'],
    ['ReturnsCenter.js', 'return-detail', 'details for the return of'],
  ])('%s exposes one expand button instead of a role="button" wrapper', (file, panelId, labelFragment) => {
    const src = stripComments(read(`pages/${file}`));
    // A role="button" wrapper around the row made the listing link (and, on
    // returns, the approve/deny buttons) nested interactive controls.
    expect(src).not.toMatch(/role=\{?["']button["']/);
    expect(src).not.toMatch(/role=\{[^}]*'button'/);
    expect(src).toContain('aria-expanded=');
    expect(src).toContain(`aria-controls={\`${panelId}-`);
    expect(src).toContain(labelFragment);
    expect(src).toContain(`id={\`${panelId}-`);
  });
});

describe('dashboard tables are navigable and announced', () => {
  const tableFiles = ['pages/Admin.js', 'pages/SellerBadges.js', 'pages/LegalAdmin.js'];

  test.each(tableFiles)('%s gives every header cell a column scope', (file) => {
    const src = read(file);
    const headers = (src.match(/<th\b(?!ead)/g) || []).length;
    const scoped = (src.match(/<th scope="col"/g) || []).length;
    expect(headers).toBeGreaterThan(0);
    expect(scoped).toBe(headers);
  });

  test.each(tableFiles)('%s names every table with a caption', (file) => {
    const src = read(file);
    const tables = (src.match(/<table\b/g) || []).length;
    const captions = (src.match(/<caption className="sr-only">[^<]+<\/caption>/g) || []).length;
    expect(tables).toBeGreaterThan(0);
    expect(captions).toBe(tables);
  });

  test('the tier table is a focusable scroll region (mobile CSS makes it the scroller)', () => {
    const src = read('pages/SellerBadges.js');
    expect(src).toMatch(/<table tabIndex=\{0\}[^>]*>\s*\n\s*<caption className="sr-only">Seller badge tier requirements<\/caption>/);
  });

  test.each(tableFiles)('%s gives every table the tab stop its mobile scroll needs', (file) => {
    const src = read(file);
    const tables = (src.match(/<table\b/g) || []).length;
    const focusable = (src.match(/<table tabIndex=\{0\}/g) || []).length;
    expect(tables).toBeGreaterThan(0);
    expect(focusable).toBe(tables);
  });
});

describe('admin controls have accessible names', () => {
  test('the user search and per-row role selects are labelled', () => {
    const src = read('pages/Admin.js');
    expect(src).toContain('aria-label="Search users by name or email"');
    expect(src).toMatch(/aria-label=\{`Role for \$\{u\.name/);
  });
});

describe('form-only dashboards label every field', () => {
  test('fraud forms name inputs, the reason select and the notes area', () => {
    const src = read('pages/FraudProtection.js');
    for (const label of [
      'aria-label="Listing ID"',
      'aria-label="Transaction amount in USD"',
      'aria-label="Transaction ID"',
      'aria-label="Why this transaction is being flagged"',
      'aria-label="Additional notes for the fraud team"',
    ]) {
      expect(src).toContain(label);
    }
  });

  test('fraud errors and results are announced', () => {
    const src = read('pages/FraudProtection.js');
    expect(src).toContain('role="alert"');
    expect(src).toMatch(/role="status" aria-live="polite"/);
    expect(src.match(/role="status"/g).length).toBeGreaterThanOrEqual(2);
  });

  test('legal admin names its pack fields and associates the attestation', () => {
    const src = read('pages/LegalAdmin.js');
    for (const label of [
      'aria-label="Country ISO code"',
      'aria-label="Policy pack version"',
      'aria-label="Governing law"',
      'aria-label="Change summary"',
      'aria-label="Mandatory rights summary"',
      'aria-label="Dispute resolution and local procedure"',
    ]) {
      expect(src).toContain(label);
    }
    expect(src).toContain('htmlFor="legal-attestation"');
    expect(src).toContain('id="legal-attestation"');
  });

  test('the legal consent dialog manages focus like a modal', () => {
    const src = read('components/LegalConsentGate.js');
    // Focus moves into the dialog, Tab is trapped, and focus is handed to the
    // main landmark (the gate opens on load, so there is no opener element).
    expect(src).toContain('titleRef.current?.focus()');
    expect(src).toContain("document.addEventListener('keydown', onKeyDown)");
    expect(src).toMatch(/event\.key !== 'Tab'/);
    expect(src).toContain("document.querySelector('main')");
    expect(src).toContain('aria-describedby="legal-consent-desc"');
  });

  test('the transactions page-size select is labelled', () => {
    const src = read('pages/Transactions.js');
    expect(src).toContain('htmlFor="txn-page-size"');
    expect(src).toContain('id="txn-page-size"');
    expect(src).toContain('aria-label="Transactions per page"');
  });
});

describe('admin tabs expose the current section to AT', () => {
  const src = read('pages/Admin.js');

  test('the strip is a tablist whose selected tab is the only tab stop', () => {
    expect(src).toContain('role="tablist" aria-label="Admin sections"');
    expect(src).toContain('role="tab"');
    expect(src).toContain('aria-selected={selected}');
    expect(src).toContain('tabIndex={selected ? 0 : -1}');
    expect(src).toContain('aria-controls="admin-panel"');
    expect(src).toMatch(/event\.key === 'ArrowRight'/);
    expect(src).toMatch(/event\.key === 'Home'/);
  });

  test('the panel is labelled by the active tab', () => {
    expect(src).toContain('role="tabpanel" id="admin-panel"');
    expect(src).toContain('aria-labelledby={`admin-tab-${activeTab}`}');
  });
});

describe('the shared confirm dialog is a named, focus-managed modal', () => {
  const src = read('context/ConfirmContext.js');

  test('it is named and described, and focus starts on the safe action', () => {
    expect(src).toContain('aria-labelledby="td-confirm-title"');
    expect(src).toContain("aria-describedby={state.message ? 'td-confirm-message' : undefined}");
    expect(src).toContain('cancelRef.current?.focus()');
  });

  test('Escape cancels, Tab is trapped and focus returns to the opener', () => {
    expect(src).toMatch(/event\.key === 'Escape'/);
    expect(src).toMatch(/event\.key !== 'Tab'/);
    expect(src).toContain('restoreFocusRef.current');
  });
});

describe('admin write actions confirm and announce their outcome', () => {
  const src = stripComments(read('pages/Admin.js'));

  test.each([
    ['role change', "title: 'Change user role?'", 'Role updated to'],
    ['suspend', "title: 'Suspend this user?'", 'suspended'],
  ])('%s asks before writing and reports back', (_name, confirmTitle, successText) => {
    expect(src).toContain(confirmTitle);
    expect(src).toContain(successText);
  });

  test('report actions confirm before writing', () => {
    expect(src).toContain("title: resolving ? 'Resolve this report?' : 'Dismiss this report?'");
    expect(src).toContain("confirmLabel: resolving ? 'Resolve' : 'Dismiss'");
  });

  test('a cancelled role change puts the select back to the real role', () => {
    // A controlled select does not repaint on cancel: no state changed.
    expect(src).toContain('selectEl.value = previousRole');
  });

  test('report resolution and refunds announce success, and failures are announced too', () => {
    expect(src).toContain("'Report resolved'");
    expect(src).toContain("'Refund issued'");
    expect(src).toContain("title: 'Force refund?'");
    // These handlers used to fail silently into console.error.
    expect(src).not.toMatch(/handleResolveReport[\s\S]{0,400}console\.error/);
  });
});
