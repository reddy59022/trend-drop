import React, { createContext, useState, useContext, useEffect } from 'react';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [language, setLanguage] = useState(() => {
    return localStorage.getItem('language') || 'en';
  });

  const [currency, setCurrency] = useState(() => {
    return localStorage.getItem('currency') || 'USD';
  });

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