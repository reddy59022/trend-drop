/**
 * Accessibility regression: the three money flows (cart -> checkout, sell,
 * messages).
 *
 * A live keyboard + screen-reader audit of these flows found controls that
 * could not be reached at all (conversation rows were clickable divs), fields
 * announced only by placeholder text, focus dropped on <body> when a panel
 * swapped in place, and a message list that was neither scrollable by keyboard
 * nor announced when new messages arrived. Those are fixed; this test pins the
 * contract so a refactor cannot silently undo them.
 *
 * Static source assertions, in the same spirit as a11yButtons.test.js: cheap,
 * and they fail loudly on the exact patterns that caused the defects.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('money-flow accessibility contract', () => {
  describe('messages', () => {
    const src = read('pages/Messages.js');

    test('conversation rows are buttons, not clickable divs', () => {
      expect(src).toMatch(/<button key=\{conv\.otherUser\?\._id \|\| `c-\$\{i\}`\}/);
      // The old markup: a div carrying onClick and a pointer cursor.
      expect(src).not.toMatch(/<div key=\{conv\.otherUser\?\._id \|\| `c-\$\{i\}`\}\n\s+style=\{\{\n\s+display: 'flex', gap: 12/);
      expect(src).toMatch(/onClick=\{\(\) => handleSelectConversation\(conv\)\}/);
    });

    test('conversation rows announce unread counts and the listing', () => {
      expect(src).toMatch(/aria-label=\{`\$\{conv\.otherUser\?\.name \|\| 'Unknown'\}/);
      expect(src).toMatch(/\$\{conv\.unreadCount\} unread`/);
    });

    test('the message list is a focusable live log', () => {
      expect(src).toMatch(/role="log" aria-live="polite"/);
      expect(src).toMatch(/aria-label=\{`Conversation with \$\{threadTitle\}`\} tabIndex=\{0\}/);
    });

    test('message input and send button are named', () => {
      expect(src).toMatch(/aria-label=\{`Message \$\{threadTitle\}`\}/);
      expect(src).toMatch(/aria-label=\{sending \? 'Sending message' : 'Send message'\}/);
      expect(src).toMatch(/aria-busy=\{sending\}/);
    });

    test('opening and closing a thread moves focus deliberately', () => {
      expect(src).toMatch(/threadHeadingRef\.current\?\.focus\(\)/);
      expect(src).toMatch(/listHeadingRef\.current\?\.focus\(\)/);
    });
  });

  describe('cart and checkout', () => {
    const src = read('pages/Cart.js');

    test('every shipping field is programmatically labelled for autofill', () => {
      const ids = ['ship-fullName', 'ship-street1', 'ship-city', 'ship-state', 'ship-postalCode', 'ship-country', 'ship-phone'];
      ids.forEach((id) => expect(src).toMatch(new RegExp(`id="${id}"`)));
      expect(src).toMatch(/aria-label="Full name" autoComplete="name"/);
      expect(src).toMatch(/aria-label="Country" autoComplete="country"/);
      expect(src).toMatch(/aria-label="Phone number" autoComplete="tel"/);
    });

    test('promo code field is named and its error is announced', () => {
      expect(src).toMatch(/aria-label="Promo code"/);
      expect(src).toMatch(/role="alert"/);
    });

    test('quantity and total changes are announced', () => {
      expect(src).toMatch(/<output aria-live="polite"/);
      expect(src).toMatch(/<span aria-live="polite" style=\{\{ fontWeight: 800/);
    });

    test('the checkout panel receives focus when it opens', () => {
      expect(src).toMatch(/shippingHeadingRef/);
      expect(src).toMatch(/tabIndex=\{-1\} id="shipping-details"/);
    });
  });

  describe('sell', () => {
    const src = read('pages/Sell.js');

    test('no form label is left without a control association', () => {
      const orphan = src.match(/className="form-label">/g) || [];
      expect(orphan).toHaveLength(0);
      expect(src).toMatch(/htmlFor="list-title"/);
      expect(src).toMatch(/htmlFor="list-shippingCost"/);
      expect(src).toMatch(/htmlFor="list-boostDuration"/);
    });

    test('the stepper reports the current step and every panel heading can take focus', () => {
      expect(src).toMatch(/aria-current=\{isActive \? 'step' : undefined\}/);
      expect(src).toMatch(/aria-label=\{`Step \$\{i \+ 1\} of \$\{steps\.length\}/);
      const headings = src.match(/className="sell-step-heading"/g) || [];
      expect(headings).toHaveLength(5);
      expect(src).toMatch(/stepHeadingRef\.current\?\.focus\(\)/);
    });

    test('boost tiers are a radiogroup with arrow-key selection', () => {
      expect(src).toMatch(/role="radiogroup" aria-label="Boost tier"/);
      expect(src).toMatch(/role="radio"/);
      expect(src).toMatch(/aria-checked=\{isSelected\}/);
      expect(src).toMatch(/ArrowRight/);
    });

    test('the optional video URL field is named', () => {
      expect(src).toMatch(/aria-label="Product video URL"/);
    });
  });

  test('payment errors are announced as alerts', () => {
    expect(read('components/StripeCheckoutForm.js')).toMatch(/role="alert"/);
  });
});
