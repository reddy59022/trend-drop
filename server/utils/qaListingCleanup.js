/**
 * QA/E2E catalog junk detection (pure logic).
 *
 * The production catalog accumulated test inventory (PROD-E2E …, QA Test
 * Item …, transaction-artifact titles like "$32_20260915094524_prod3 …").
 * Cleanup is destructive, so detection is deliberately TIGHT: a false positive
 * deletes a real seller's listing. Only unmistakable test artifacts match —
 * real listings are never deleted on vibes.
 */

// Titles that can only come from test harnesses.
const JUNK_PATTERNS = [
  /^PROD-E2E\b/i, // e2e harness ("PROD-E2E 20260911 …")
  /^E2E[- _]/i, // harness ("E2E-checkout-123")
  /^QA Test Item\b/i, // QA fixtures ("QA Test Item 3")
  /^TD QA\b/i, // audit write-checks ("TD QA …")
  /^\$\d+_\d{8,}/, // transaction artifacts ("$32_20260915094524_prod3 …")
  /^\$?\d+_\d{8,}_/, // same family without leading "$"
];

/**
 * True only for titles that can ONLY be test artifacts.
 * @param {string} title
 */
const isQaJunkTitle = (title) => {
  if (typeof title !== 'string' || !title.trim()) return false;
  return JUNK_PATTERNS.some((re) => re.test(title.trim()));
};

/**
 * Split candidate listings into deletable junk and rows that need a human:
 * a junk listing that has commerce history (transactions / orders / offers)
 * must not be silently deleted — the history would be orphaned.
 *
 * @param {Array<{ title: string, _id: any }>} listings
 * @param {(listing: any) => boolean} hasRelatedData
 * @returns {{ deletable: any[], needsReview: any[] }}
 */
const planQaCleanup = (listings, hasRelatedData) => {
  const deletable = [];
  const needsReview = [];
  for (const listing of listings) {
    if (!isQaJunkTitle(listing.title)) continue;
    if (hasRelatedData(listing)) needsReview.push(listing);
    else deletable.push(listing);
  }
  return { deletable, needsReview };
};

module.exports = { isQaJunkTitle, planQaCleanup, JUNK_PATTERNS };
