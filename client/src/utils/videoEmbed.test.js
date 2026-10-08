/**
 * Red tests proving defects in the video URL parser (utils/videoEmbed.js).
 *
 * DEFECT A — Instagram URLs are never recognised.
 *   `PLATFORMS.INSTAGRAM` is defined, `getVideoPlatformLabel`/`Color` render
 *   an `'instagram'` badge, and the Sell form's placeholder literally tells the
 *   user to paste an "Instagram/Facebook reel URL". But `parseVideoUrl` has NO
 *   Instagram branch, so an instagram.com/reel/... URL falls through to
 *   `{ platform: 'unknown' }`. Sell.js then rejects it
 *   (`parsed.platform !== 'unknown'` gate), so a seller can never attach an
 *   Instagram reel even though the UI asks for one.
 *
 * DEFECT B — `isValidVideoUrl` accepts ANY non-empty string.
 *   It returns `parseVideoUrl(url) !== null`, but `parseVideoUrl` returns a
 *   non-null `{ platform: 'unknown' }` object for unrecognized input. So
 *   `isValidVideoUrl('not a url')` is `true`. That contradicts the rest of the
 *   app, which treats `platform === 'unknown'` as "not a valid video".
 */
import { parseVideoUrl, isValidVideoUrl, getVideoPlatformLabel, PLATFORMS } from './videoEmbed';

describe('DEFECT A: Instagram URLs must be recognised as a supported platform', () => {
  test('parses an instagram reel URL as platform "instagram"', () => {
    const parsed = parseVideoUrl('https://www.instagram.com/reel/CxYzAbC1234/');
    expect(parsed.platform).toBe(PLATFORMS.INSTAGRAM);
    expect(parsed.platform).toBe('instagram');
  });

  test('parses an instagram post URL and produces an embeddable URL', () => {
    const parsed = parseVideoUrl('https://www.instagram.com/p/CxYzAbC1234/');
    expect(parsed.platform).toBe('instagram');
    expect(parsed.embedUrl).toContain('instagram.com');
  });

  test('an instagram reel is NOT the "unknown" fallback (Sell.js gates on this)', () => {
    const parsed = parseVideoUrl('https://www.instagram.com/reel/CxYzAbC1234/');
    expect(parsed.platform).not.toBe('unknown');
  });

  test('instagram gets a human label and the documented platform constant', () => {
    const parsed = parseVideoUrl('https://www.instagram.com/reel/CxYzAbC1234/');
    expect(getVideoPlatformLabel(parsed)).toBe('Instagram Reel');
    expect(PLATFORMS.INSTAGRAM).toBe('instagram');
  });
});

describe('DEFECT B: isValidVideoUrl must reject unrecognized strings', () => {
  test('a plain non-URL string is NOT a valid video URL', () => {
    expect(isValidVideoUrl('not a url')).toBe(false);
    expect(isValidVideoUrl('hello')).toBe(false);
  });

  test('empty / non-string input is NOT valid', () => {
    expect(isValidVideoUrl('')).toBe(false);
    expect(isValidVideoUrl(null)).toBe(false);
    expect(isValidVideoUrl(undefined)).toBe(false);
    expect(isValidVideoUrl(12345)).toBe(false);
  });

  test('REGRESSION GUARD: real video URLs stay valid', () => {
    expect(isValidVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isValidVideoUrl('https://www.instagram.com/reel/CxYzAbC1234/')).toBe(true);
    expect(isValidVideoUrl('https://example.com/clip.mp4')).toBe(true); // direct file
    expect(isValidVideoUrl('https://vimeo.com/123456789')).toBe(true);
  });
});
