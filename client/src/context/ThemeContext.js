import React, { createContext, useState, useContext, useEffect } from 'react';
import { getCurrencyByCountry } from '../utils/helpers';
import { setPreferredCurrency } from '../utils/currencyStore';
import {
  AUTO_SOURCE,
  MANUAL_SOURCE,
  STORAGE_KEYS,
  readSavedPreferences,
  persistPreference,
  decideAutoDetect,
  detectGeo,
} from '../services/geoDetect';
import api from '../services/api';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) { /* private-mode WebView */ }
    if (saved) return saved;
    // Guard for older/native WebViews where matchMedia may be unavailable
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) {
        // Fall through to light default
      }
    }
    return 'light';
  });

  const [language, setLanguage] = useState(() => {
    let saved = null;
    try { saved = localStorage.getItem('language'); } catch (e) { /* private-mode WebView */ }
    return saved || 'en';
  });

  const [dir, setDir] = useState(() => {
    // RTL languages
    const rtlLangs = ['ar', 'he', 'fa', 'ur', 'ps', 'ku', 'sd'];
    let savedLang = 'en';
    try { savedLang = localStorage.getItem('language') || 'en'; } catch (e) { /* private-mode WebView */ }
    return rtlLangs.includes(savedLang) ? 'rtl' : 'ltr';
  });

  // Top-right country + currency: default USD/unknown until the server's
  // IP geo resolution answers (or the user has an explicit choice saved).
  const savedPrefs = readSavedPreferences();
  const [currency, setCurrencyState] = useState(() => savedPrefs.currency || 'USD');
  const [currencySource, setCurrencySource] = useState(() => savedPrefs.currencySource || AUTO_SOURCE);
  const [country, setCountryState] = useState(() => savedPrefs.country || null);
  const [countrySource, setCountrySource] = useState(() => savedPrefs.countrySource || AUTO_SOURCE);

  // IP-based auto-selection of the top-right country + currency. Runs on
  // every app load for auto-sourced values (a changed IP — travel/VPN —
  // self-heals) and is skipped entirely when the user made explicit choices.
  // The same code path serves web, iOS and Android: it talks to the shared
  // API client whose base URL resolves the deployed backend on native.
  useEffect(() => {
    const decision = decideAutoDetect(savedPrefs);
    if (decision.localCurrency) {
      // Manual country known, currency missing: derive locally, no request.
      setCurrencyState(decision.localCurrency);
      setCurrencySource(MANUAL_SOURCE);
      persistPreference(STORAGE_KEYS.currency, decision.localCurrency, MANUAL_SOURCE);
      return undefined;
    }
    if (!decision.apiNeeded) return undefined;
    let cancelled = false;
            detectGeo(api).then((detected) => {
      console.log('[DBG] theme .then detected=', JSON.stringify(detected), 'decision=', JSON.stringify({detectCountry: decision.detectCountry, detectCurrency: decision.detectCurrency, apiNeeded: decision.apiNeeded, localCurrency: decision.localCurrency}));
      if (cancelled || !detected) { console.log('[DBG] .then early-return cancelled=', cancelled, 'detected=', detected); return; } // failure keeps the USD default
      if (decision.detectCountry && detected.country) {
        console.log('[DBG] setCountryState reached, calling with', detected.country, 'cancelled=', cancelled);
        setCountryState(detected.country);
        setCountrySource(AUTO_SOURCE);
        persistPreference(STORAGE_KEYS.country, detected.country, AUTO_SOURCE);
      }
      if (decision.detectCurrency) {
        setCurrencyState(detected.currency);
        setCurrencySource(AUTO_SOURCE);
        persistPreference(STORAGE_KEYS.currency, detected.currency, AUTO_SOURCE);
      }
    });
    return () => { cancelled = true; };
    // savedPrefs is read once per app load on purpose (mount-time snapshot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    try { localStorage.setItem('language', language); } catch (e) { /* private-mode WebView */ }
  }, [language, dir]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) { /* private-mode WebView */ }
  }, [theme]);

  // Persist the active currency/country for the rest of the app (the source
  // marker decides whether the next app load re-detects from the IP).
  // Keep the global preferred-currency store (used by formatPrice — the one
  // conversion point every page renders money through) in sync with the
  // top-right selection: initial value, manual changes, country switches and
  // IP auto-detection all flow through this single effect.
  useEffect(() => {
    setPreferredCurrency(currency);
  }, [currency]);

  useEffect(() => {
    persistPreference(STORAGE_KEYS.currency, currency, currencySource);
  }, [currency, currencySource]);

  useEffect(() => {
    persistPreference(STORAGE_KEYS.country, country, countrySource);
  }, [country, countrySource]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const changeLanguage = (lang) => {
    const rtlLangs = ['ar', 'he', 'fa', 'ur', 'ps', 'ku', 'sd'];
    setLanguage(lang);
    setDir(rtlLangs.includes(lang) ? 'rtl' : 'ltr');
  };

  const changeCurrency = (curr) => {
    setCurrencyState(curr);
    setCurrencySource(MANUAL_SOURCE);
  };

  // Picking a country switches to that country's currency — both marked
  // manual so IP auto-detection never overrides them afterwards.
  const changeCountry = (code) => {
    const next = (code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(next)) return;
    setCountryState(next);
    setCountrySource(MANUAL_SOURCE);
    setCurrencyState(getCurrencyByCountry(next));
    setCurrencySource(MANUAL_SOURCE);
  };

  return (
    <ThemeContext.Provider value={{
      theme,
      language,
      currency,
      currencySource,
      country,
      countrySource,
      dir,
      toggleTheme,
      changeLanguage,
      changeCurrency,
      changeCountry,
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeContext;