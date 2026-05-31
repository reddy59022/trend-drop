import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { FaSearch, FaBars, FaTimes, FaBell, FaHeart, FaEnvelope, FaShoppingBag } from 'react-icons/fa';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { cart } = useCart();
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Ref to skip effect on initial render
  const isFirstRender = useRef(true);

  // Debounced navigation effect: trigger on each keystroke after 300ms
  useEffect(() => {
    // Skip running on component mount
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const handler = setTimeout(() => {
      const trimmed = searchQuery.trim();
      if (trimmed) {
        navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      } else {
        // Navigate to base search page without query when input is empty
        navigate('/search');
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [searchQuery, navigate]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
    setDropdownOpen(false);
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <span className="logo-text">TrendDrop</span>
        </Link>

        <form className="search-form" onSubmit={handleSearch}>
          <FaSearch className="search-icon" />
          <input
            type="text"
            placeholder="Search for brands, items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </form>

        <div className={`navbar-menu ${menuOpen ? 'active' : ''}`}>
          <Link to="/feed" className="nav-link" onClick={() => setMenuOpen(false)}>
            Feed
          </Link>
          <Link to="/search" className="nav-link" onClick={() => setMenuOpen(false)}>
            Browse
          </Link>
          <Link to="/sell" className="nav-link sell-link" onClick={() => setMenuOpen(false)}>
            Sell
          </Link>

          {user ? (
            <>
              <Link to="/offers" className="nav-link" onClick={() => setMenuOpen(false)}>
                Offers
              </Link>
              <Link to="/wishlist" className="nav-icon-link" onClick={() => setMenuOpen(false)} title="Wishlist">
                <FaHeart />
              </Link>
              <Link to="/messages" className="nav-icon-link" onClick={() => setMenuOpen(false)} title="Messages">
                <FaEnvelope />
              </Link>
               <Link to="/notifications" className="nav-icon-link" onClick={() => setMenuOpen(false)}>
                 <FaBell />
               </Link>
               {/* Cart / Bag icon - moved before profile dropdown for better alignment */}
               <Link to="/cart" className="nav-icon-link" onClick={() => setMenuOpen(false)} title="Cart" style={{ position: 'relative', display: 'flex', alignItems: 'center', marginRight: '8px', alignSelf: 'center', marginTop: '-2px' }}>
                 <FaShoppingBag />
                 {cartCount > 0 && (
                   <span style={{
                     position: 'absolute',
                     top: '-4px',
                     right: '-6px',
                     background: '#ff4136',
                     color: '#fff',
                     borderRadius: '50%',
                     padding: '2px 5px',
                     fontSize: '10px',
                   }}>{cartCount}</span>
                 )}
               </Link>
               <div className="nav-dropdown">
                <button
                  className="nav-dropdown-trigger"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
                >
                  <img
                    src={user.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%23ddd"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="%23999">👤</text></svg>'}
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
                      onClick={() => setDropdownOpen(false)}
                    >
                      My Profile
                    </Link>
                    <Link to="/seller-dashboard" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                      💰 Seller Dashboard
                    </Link>
                    <Link to="/settings" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                      Settings
                    </Link>
                    <Link to="/wishlist" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                      Wishlist
                    </Link>
                    <Link to="/messages" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                      Messages
                    </Link>
                    <Link to="/transactions" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                      Transactions
                    </Link>
                    <button className="dropdown-item logout-btn" onClick={handleLogout}>
                      Logout
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

        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <FaTimes /> : <FaBars />}
        </button>
      </div>
    </nav>
  );
};

export default Navbar;