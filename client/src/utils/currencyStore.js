// Reactive access to the app's preferred display currency.
//
// The store primitives themselves live in utils/helpers.js (right next to
// formatPrice — the single conversion point) so formatting never needs a
// cross-module import. This module only adds the React binding:
//   usePreferredCurrency() → re-renders the component when the user picks
//   a different currency in the top-right selector (or IP auto-detect runs).
//
// Standard for pages/components:
//   - Display money with formatPrice(amount, sourceCurrency) — it reads the
//     preferred currency itself, no hook needed for correctness at render.
//   - Use the hook only when a component must REACT to changes without
//     remounting (e.g. widgets rendered outside the routed subtree).
import { useSyncExternalStore } from 'react';
import {
  getPreferredCurrency,
  setPreferredCurrency,
  subscribePreferredCurrency,
} from './helpers';

export { getPreferredCurrency, setPreferredCurrency, subscribePreferredCurrency };

export const usePreferredCurrency = () =>
  useSyncExternalStore(subscribePreferredCurrency, getPreferredCurrency, getPreferredCurrency);

export default usePreferredCurrency;