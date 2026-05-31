import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
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
  FaDollarSign,
  FaStore,
  FaExchangeAlt,
  FaStar,
  FaShieldAlt,
  FaQuestionCircle,
  FaPlusCircle,
} from 'react-icons/fa';

const currencies = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
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
  const { theme, toggleTheme, language, changeLanguage, currency, changeCurrency, dir } = useTheme();
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const navigate = useNavigate();
  const location = useLocation();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  
  const searchRef = useRef(null);
  const isFirstRender = useRef(true);
  const dropdownRef = useRef(null);

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
    setCurrencyOpen(false);
    setLangOpen(false);
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
          <svg className="logo-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="16" fill="url(#logo-gradient)" />
            <path d="M10 22V12l6-4 6 4v10H10z" fill="white" opacity="0.9" />
            <path d="M12 18h8v4h-8z" fill="white" />
            <defs>
              <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
                <stop stopColor="#FF385C" />
                <stop offset="1" stopColor="#FF6B81" />
              </linearGradient>
            </defs>
          </svg>
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
                  className="nav-dropdown-trigger"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  aria-label="Profile menu"
                >
                  <img
                    src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}&background=FF385C&color=fff&size=68`}
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

        {/* Right-side global controls */}
        <div className="navbar-global-controls">
          {/* Theme Toggle */}
          <button 
            className="nav-icon-link global-btn" 
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <FaSun /> : <FaMoon />}
          </button>

          {/* Currency Selector */}
          <div className="nav-dropdown">
            <button 
              className="nav-icon-link global-btn currency-btn"
              onClick={() => { setCurrencyOpen(!currencyOpen); setLangOpen(false); }}
              title="Select currency"
              aria-label="Select currency"
            >
              <FaDollarSign size={12} />
              <span style={{ fontSize: 11, fontWeight: 700 }}>{currency}</span>
            </button>
            
            {currencyOpen && (
              <div className="currency-dropdown">
                <div className="dropdown-header">Select Currency</div>
                {currencies.map(c => (
                  <button
                    key={c.code}
                    className={`currency-option ${currency === c.code ? 'active' : ''}`}
                    onClick={() => { changeCurrency(c.code); setCurrencyOpen(false); }}
                  >
                    <span className="currency-symbol">{c.symbol}</span>
                    <span className="currency-code">{c.code}</span>
                    <span className="currency-name">{c.name}</span>
                    {currency === c.code && <span className="check-mark">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Language Selector */}
          <div className="nav-dropdown">
            <button 
              className="nav-icon-link global-btn"
              onClick={() => { setLangOpen(!langOpen); setCurrencyOpen(false); }}
              title="Select language"
              aria-label="Select language"
            >
              <FaGlobe size={14} />
            </button>
            
            {langOpen && (
              <div className="lang-dropdown">
                <div className="dropdown-header">Select Language</div>
                {languages.map(l => (
                  <button
                    key={l.code}
                    className={`lang-option ${language === l.code ? 'active' : ''}`}
                    onClick={() => { changeLanguage(l.code); setLangOpen(false); }}
                  >
                    <span className="lang-flag">{l.flag}</span>
                    <span className="lang-name">{l.name}</span>
                    {language === l.code && <span className="check-mark">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Menu Toggle (mobile) */}
          <button 
            className="menu-toggle" 
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <FaTimes /> : <FaBars />}
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;