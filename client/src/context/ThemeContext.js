import React, { createContext, useState, useContext, useEffect } from 'react';
import { getCurrencyByCountry } from '../utils/helpers';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
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
    return localStorage.getItem('language') || 'en';
  });

  const [currency, setCurrency] = useState(() => {
    const saved = localStorage.getItem('currency');
    if (saved) return saved;
    // Default to USD, will be updated by useCurrencyDetection effect
    return 'USD';
  });

  // Auto-detect currency based on user location
  useEffect(() => {
    const detectCurrency = async () => {
      try {
        // Try to get user's location-based currency
        const res = await fetch('https://ipapi.co/json/').catch(() => null);
        if (res) {
          const data = await res.json().catch(() => null);
          if (data && data.country) {
            const userCurrency = getCurrencyByCountry(data.country);
            if (userCurrency && userCurrency !== currency) {
              setCurrency(userCurrency);
            }
          }
        }
      } catch (e) {
        // Keep USD as default
      }
    };
    
    // Only auto-detect if no saved preference
    if (!localStorage.getItem('currency')) {
      detectCurrency();
    }
  }, []);

  const [dir, setDir] = useState(() => {
    // RTL languages
    const rtlLangs = ['ar', 'he', 'fa', 'ur', 'ps', 'ku', 'sd'];
    const savedLang = localStorage.getItem('language') || 'en';
    return rtlLangs.includes(savedLang) ? 'rtl' : 'ltr';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    localStorage.setItem('language', language);
  }, [language, dir]);

  useEffect(() => {
    localStorage.setItem('currency', currency);
  }, [currency]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const changeLanguage = (lang) => {
    const rtlLangs = ['ar', 'he', 'fa', 'ur', 'ps', 'ku', 'sd'];
    setLanguage(lang);
    setDir(rtlLangs.includes(lang) ? 'rtl' : 'ltr');
  };

  const changeCurrency = (curr) => {
    setCurrency(curr);
  };

  return (
    <ThemeContext.Provider value={{
      theme,
      language,
      currency,
      dir,
      toggleTheme,
      changeLanguage,
      changeCurrency,
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