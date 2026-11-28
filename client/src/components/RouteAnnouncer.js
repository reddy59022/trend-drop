import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { pageNameForPath, titleForPath } from '../utils/routeTitles';

/**
 * Everything a full page load does for free, a client-side route change has to
 * do by hand:
 *
 * - reset scroll (otherwise a long listing scrolled to the bottom opens the
 *   next screen at the footer),
 * - set a real document title (pageNameForPath owns the map),
 * - move focus to the main landmark, because the link that was activated is
 *   unmounted by the route change and focus falls back to <body>, leaving
 *   keyboard users at the top of the page with no cursor and screen-reader
 *   users with no announcement,
 * - announce the new screen, because nothing else tells a screen reader that
 *   the page changed.
 *
 * The first render is the initial page load: no focus move (that would steal
 * focus from the address bar / first Tab) and no announcement, only the title.
 */
const RouteAnnouncer = () => {
  const { pathname } = useLocation();
  const isInitialRender = useRef(true);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
    document.title = titleForPath(pathname);

    if (isInitialRender.current) {
      isInitialRender.current = false;
      return undefined;
    }

    const main = document.getElementById('main-content');
    if (main && typeof main.focus === 'function') {
      main.focus({ preventScroll: true });
    }

    // Clear first so revisiting the same screen (back/forward, repeated taps)
    // announces again instead of leaving identical text in the live region.
    setAnnouncement('');
    const timer = window.setTimeout(() => {
      setAnnouncement(`Navigated to ${pageNameForPath(pathname)}`);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="route-announcer"
    >
      {announcement}
    </div>
  );
};

export default RouteAnnouncer;
