import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import { currencies as CURRENCY_MAP, getCurrencyByCountry } from '../utils/helpers';
import { 
  FaSearch, 
  FaBars, 
  FaTimes, 
  FaBell, 
  FaHeart, 
  FaEnvelope, 
  FaShoppingBag,
  FaUser,
  FaCog,
  FaSignOutAlt,
  FaMoon,
  FaSun,
  FaGlobe,
  FaStore,
  FaExchangeAlt,
  FaStar,
  FaShieldAlt,
  FaPlusCircle,
  FaGavel,
  FaUndo,
  FaUserPlus,
  FaAward,
  FaTag,
  FaFemale,
  FaMale,
  FaChild,
  FaMobileAlt,
  FaCouch,
  FaSpa,
  FaTshirt,
} from 'react-icons/fa';

// Currency dropdown: curated popular list first; the ACTIVE currency is
// always prepended so an IP-auto-selected currency (e.g. CHF/SEK/NOK from
// the visitor's country) is visible and selectable even when it is outside
// the popular set. Symbols/names come from the shared helpers map that
// mirrors server config/currencies.js — single source of truth.
const POPULAR_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
  'JPY', 'INR', 'CAD', 'AUD', 'BRL', 'CNY', 'KRW',
];

const currencyOptions = (active) => {
  const codes = active && POPULAR_CURRENCIES.indexOf(active) === -1
    ? [active, ...POPULAR_CURRENCIES]
    : POPULAR_CURRENCIES.slice();
  return codes
    .filter((code) => CURRENCY_MAP[code])
    .map((code) => ({ code, symbol: CURRENCY_MAP[code].symbol, name: CURRENCY_MAP[code].name }));
};

// Country dropdown: launch markets from GET /marketplace/countries, with a
// static fallback for API failures and the auto-detected country prepended
// whenever it is not already listed (e.g. a visitor from an upcoming market).
const FALLBACK_COUNTRIES = [
  { code: 'US', name: 'United States', currency: 'USD', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', currency: 'EUR', flag: '🇪🇺' },
  { code: 'FR', name: 'France', currency: 'EUR', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', currency: 'EUR', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', currency: 'EUR', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', flag: '🇳🇱' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', flag: '🇨🇭' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', flag: '🇸🇪' },
];

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
];

const Navbar = () => {
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const { theme, toggleTheme, language, changeLanguage, currency, changeCurrency, country, changeCountry } = useTheme();
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const navigate = useNavigate();
  const location = useLocation();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [countriesList, setCountriesList] = useState([]);
  
  const searchRef = useRef(null);
  const isFirstRender = useRef(true);
  const dropdownRef = useRef(null);
  const prefsRef = useRef(null);

  // Track scroll for glass effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fetch unread notifications count
  useEffect(() => {
    if (user) {
      const fetchUnread = async () => {
        try {
          const res = await api.get('/notifications?limit=1&unread=true');
          // If we have an X-Total-Count header or similar mechanism
          if (res.headers && res.headers['x-total-count']) {
            setUnreadNotifications(parseInt(res.headers['x-total-count']));
          } else if (res.data && res.data.unreadCount) {
            setUnreadNotifications(res.data.unreadCount);
          }
        } catch (e) {
          // Silently fail
        }
      };
      fetchUnread();
    }
  }, [user]);

  // Fetch the launch-market list for the country selector. On failure the
  // static fallback (plus the detected country) still renders the selector.
  useEffect(() => {
    let mounted = true;
    api.get('/marketplace/countries')
      .then((res) => {
        if (mounted && Array.isArray(res.data) && res.data.length) setCountriesList(res.data);
      })
      .catch(() => { /* fallback list is used */ });
    return () => { mounted = false; };
  }, []);

  const countryOptions = (() => {
    const base = countriesList.length ? countriesList : FALLBACK_COUNTRIES;
    const list = base.filter((c) => c && c.code);
    if (country && !list.some((c) => c.code === country)) {
      return [{ code: country, name: country, currency: getCurrencyByCountry(country), flag: '🏳️' }, ...list];
    }
    return list;
  })();

  // Debounced search autocomplete
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const handler = setTimeout(async () => {
      const trimmed = searchQuery.trim();
      if (trimmed.length >= 2) {
        try {
          const res = await api.get(`/listings/search?q=${encodeURIComponent(trimmed)}&limit=5`);
          setSearchSuggestions(res.data.listings || []);
          setShowSuggestions(true);
        } catch (e) {
          setSearchSuggestions([]);
        }
      } else {
        setSearchSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close the preferences panel on outside click or Escape (popover contract)
  useEffect(() => {
    const handleClick = (e) => {
      if (prefsRef.current && !prefsRef.current.contains(e.target)) {
        setPrefsOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setPrefsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setShowSuggestions(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
    setDropdownOpen(false);
  };

  const closeAllMenus = () => {
    setMenuOpen(false);
    setDropdownOpen(false);
    setShopOpen(false);
    setPrefsOpen(false);
  };

  // Check if a route is active
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
      <div className="navbar-container">
        {/* Logo */}
        <Link to="/" className="navbar-logo" onClick={closeAllMenus}>
          <span className="td-logo-mark">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="16" fill="url(#logo-gradient)" />
              <path d="M10 22V12l6-4 6 4v10H10z" fill="white" opacity="0.95" />
              <path d="M12 18h8v4h-8z" fill="white" />
              <defs>
                <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#6C3BFF" />
                  <stop offset="0.55" stopColor="#8B5CFF" />
                  <stop offset="1" stopColor="#FF6BC1" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span className="logo-text">TrendDrop</span>
        </Link>

        {/* Search */}
        <form className="search-form" onSubmit={handleSearch} ref={searchRef}>
          <FaSearch className="search-icon" />
          <input
            type="text"
            placeholder={`${language === 'ar' ? 'ابحث عن العلامات التجارية...' : 'Search brands, items...'}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchSuggestions.length > 0 && setShowSuggestions(true)}
            className="search-input"
            aria-label="Search"
          />
          
          {/* Search Suggestions */}
          {showSuggestions && searchSuggestions.length > 0 && (
            <div className="search-suggestions">
              {searchSuggestions.map((item) => (
                <div
                  key={item._id}
                  className="search-suggestion-item"
                  onClick={() => {
                    navigate(`/listing/${item._id}`);
                    setSearchQuery('');
                    setShowSuggestions(false);
                  }}
                >
                  {item.images?.[0] && (
                    <img src={item.images[0]} alt="" className="search-suggestion-img" />
                  )}
                  <div className="search-suggestion-info">
                    <span className="search-suggestion-title">{item.title}</span>
                    <span className="search-suggestion-price">
                      {currency === 'USD' ? '$' : 
                       currency === 'EUR' ? '€' : 
                       currency === 'GBP' ? '£' : 
                       currency === 'JPY' ? '¥' : 
                       currency === 'INR' ? '₹' : '$'}
                      {item.price}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </form>

        {/* Desktop Menu */}
        <div className={`navbar-menu ${menuOpen ? 'active' : ''}`}>
          <Link 
            to="/feed" 
            className={`nav-link ${isActive('/feed') ? 'active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            Feed
          </Link>
          <Link 
            to="/search" 
            className={`nav-link ${isActive('/search') ? 'active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            Browse
          </Link>
          {/* Shop — category mega-menu (the catalog is the product; it must be
              reachable in one click from anywhere, not only via the search box) */}
          <div className="nav-dropdown">
            <button
              className="nav-dropdown-trigger"
              onClick={() => setShopOpen(!shopOpen)}
              aria-label="Shop categories"
              aria-haspopup="menu"
              aria-expanded={shopOpen}
            >
              Shop
            </button>

            {shopOpen && (
              <div className="nav-mega-menu" role="menu">
                <div className="dropdown-header">Shop by category</div>
                <div className="nav-mega-grid">
                  {[
                    { name: 'Women', icon: <FaFemale /> },
                    { name: 'Men', icon: <FaMale /> },
                    { name: 'Kids', icon: <FaChild /> },
                    { name: 'Electronics', icon: <FaMobileAlt /> },
                    { name: 'Home', icon: <FaCouch /> },
                    { name: 'Beauty', icon: <FaSpa /> },
                    { name: 'Accessories', icon: <FaShoppingBag /> },
                    { name: 'Clothing', icon: <FaTshirt /> },
                  ].map((cat) => (
                    <Link
                      key={cat.name}
                      to={`/search?category=${cat.name}`}
                      className="nav-mega-item"
                      role="menuitem"
                      onClick={() => { setShopOpen(false); setMenuOpen(false); }}
                    >
                      <span aria-hidden="true">{cat.icon}</span>
                      {cat.name}
                    </Link>
                  ))}
                </div>
                <Link to="/search" className="nav-mega-all" role="menuitem" onClick={() => { setShopOpen(false); setMenuOpen(false); }}>
                  Browse everything →
                </Link>
              </div>
            )}
          </div>

          <Link 
            to="/sell" 
            className="nav-link sell-link"
            onClick={() => setMenuOpen(false)}
          >
            <FaPlusCircle size={14} /> Sell
          </Link>

          {user ? (
            <>
              {/* Notification Bell */}
              <Link to="/notifications" className="nav-icon-link" title="Notifications" onClick={() => setMenuOpen(false)}>
                <FaBell />
                {unreadNotifications > 0 && (
                  <span className="nav-icon-badge">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </Link>

              {/* Wishlist */}
              <Link to="/wishlist" className="nav-icon-link" title="Wishlist" onClick={() => setMenuOpen(false)}>
                <FaHeart />
              </Link>

              {/* Messages */}
              <Link to="/messages" className="nav-icon-link" title="Messages" onClick={() => setMenuOpen(false)}>
                <FaEnvelope />
              </Link>

              {/* Cart */}
              <Link to="/cart" className="nav-icon-link" title="Cart" onClick={() => setMenuOpen(false)}>
                <FaShoppingBag />
                {cartCount > 0 && (
                  <span className="nav-icon-badge">{cartCount}</span>
                )}
              </Link>

              {/* Profile Dropdown */}
              <div className="nav-dropdown" ref={dropdownRef}>
                <button
                  className="nav-dropdown-trigger user-menu-trigger"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  aria-label="Profile menu"
                  aria-haspopup="menu"
                  aria-expanded={dropdownOpen}
                >
                  <img
                    src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}&background=6C3BFF&color=fff&size=68`}
                    alt={user.name}
                    className="nav-avatar"
                  />
                  <span className="nav-username">{user.name?.split(' ')[0]}</span>
                </button>
                
                {dropdownOpen && (
                  <div className="nav-dropdown-menu">
                    <Link
                      to={`/profile/${user.id || user._id}`}
                      className="dropdown-item"
                      onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}
                    >
                      <FaUser size={14} /> My Profile
                    </Link>
                    <Link to="/seller-dashboard" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaStore size={14} /> Seller Dashboard
                    </Link>
                    <Link to="/offers" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaExchangeAlt size={14} /> Offers
                    </Link>
                    <Link to="/transactions" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaShieldAlt size={14} /> Transactions
                    </Link>
                    <Link to="/auctions" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaGavel size={14} /> Auctions
                    </Link>
                    <Link to="/returns" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaUndo size={14} /> Returns
                    </Link>
                    <Link to="/referrals" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaUserPlus size={14} /> Referrals
                    </Link>
                    <Link to="/seller-badges" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaAward size={14} /> Seller Badges
                    </Link>
                    <Link to="/price-suggestion" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaTag size={14} /> Price Suggestion
                    </Link>
                    <Link to="/fraud-protection" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaShieldAlt size={14} /> Fraud Protection
                    </Link>
                    <Link to="/wishlist" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaHeart size={14} /> Wishlist
                    </Link>
                    <Link to="/reviews" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaStar size={14} /> Reviews
                    </Link>
                    <Link to="/settings" className="dropdown-item" onClick={() => { setDropdownOpen(false); setMenuOpen(false); }}>
                      <FaCog size={14} /> Settings
                    </Link>
                    <button className="dropdown-item logout-btn" onClick={handleLogout}>
                      <FaSignOutAlt size={14} /> Logout
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="auth-links">
              <Link to="/login" className="nav-link" onClick={() => setMenuOpen(false)}>
                Login
              </Link>
              <Link to="/register" className="nav-link register-btn" onClick={() => setMenuOpen(false)}>
                Join
              </Link>
            </div>
          )}
        </div>

        {/* Right-side global controls — one consolidated preferences popover
            (country + currency + language + theme) instead of four competing
            utility buttons next to the account menu (UI/UX audit item 5). */}
        <div className="navbar-global-controls">
          <div className="nav-dropdown" ref={prefsRef}>
            <button
              className="nav-icon-link global-btn prefs-trigger"
              onClick={() => setPrefsOpen(!prefsOpen)}
              title="Region, currency & language"
              aria-label="Region & language preferences"
              aria-haspopup="dialog"
              aria-expanded={prefsOpen}
            >
              <FaGlobe size={14} />
              <span className="prefs-codes">{country || '—'} · {currency || 'USD'}</span>
            </button>

            {prefsOpen && (
              <div className="nav-dropdown-menu prefs-panel" role="dialog" aria-label="Region & preferences">
                <div className="prefs-header">
                  <span className="dropdown-header">Region & preferences</span>
                  <button
                    className="prefs-close"
                    onClick={() => setPrefsOpen(false)}
                    aria-label="Close preferences"
                  >
                    <FaTimes size={12} />
                  </button>
                </div>

                <button
                  className="prefs-theme-row"
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <FaSun size={14} /> : <FaMoon size={14} />}
                  <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>

                <label className="prefs-field">
                  <span className="prefs-label">Country</span>
                  <select
                    className="prefs-select"
                    aria-label="Select country"
                    value={country || ''}
                    onChange={(e) => {
                      const code = e.target.value;
                      changeCountry(code);
                      const opt = countryOptions.find((c) => c.code === code);
                      if (opt && opt.currency) changeCurrency(opt.currency);
                    }}
                  >
                    {!country && <option value="">—</option>}
                    {countryOptions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="prefs-field">
                  <span className="prefs-label">Currency</span>
                  <select
                    className="prefs-select"
                    aria-label="Select currency"
                    value={currency || 'USD'}
                    onChange={(e) => changeCurrency(e.target.value)}
                  >
                    {currencyOptions(currency).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.symbol} {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="prefs-field">
                  <span className="prefs-label">Language</span>
                  <select
                    className="prefs-select"
                    aria-label="Select language"
                    value={language || 'en'}
                    onChange={(e) => changeLanguage(e.target.value)}
                  >
                    {languages.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.flag} {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Menu Toggle (mobile) */}
          <button 
            className="menu-toggle" 
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <FaTimes /> : <FaBars />}
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
