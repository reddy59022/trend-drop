import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { 
  FaHome, 
  FaSearch,
  FaPlusCircle, 
  FaShoppingBag,
  FaUser,
} from 'react-icons/fa';

const MobileTabBar = () => {
  const { user } = useAuth();
  const { cart } = useCart();
  const location = useLocation();

  // Five tabs maximum — the platform ceiling (iOS HIG / Material bottom
  // navigation both cap at 5). The previous 6-tab dock clipped labels on
  // 320px screens and, more importantly, had no Cart tab at all, so the
  // highest-value destination in a marketplace was unreachable from the
  // persistent navigation on phones. Messages now lives in the header menu,
  // which already carries its unread badge.
  const cartCount = (cart || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
  const profilePath = user ? `/profile/${user.id || user._id}` : '/login';

  // Guests get only public routes: protected destinations (/sell, /cart,
  // /profile) would bounce to /login and read as a broken tab.
  const tabs = user ? [
    { path: '/', icon: <FaHome />, label: 'Home', exact: true },
    { path: '/search', icon: <FaSearch />, label: 'Search' },
    { path: '/sell', icon: <FaPlusCircle />, label: 'Sell', highlight: true },
    { path: '/cart', icon: <FaShoppingBag />, label: 'Cart', badge: cartCount },
    { path: profilePath, icon: <FaUser />, label: 'Profile', match: '/profile' },
  ] : [
    { path: '/', icon: <FaHome />, label: 'Home', exact: true },
    { path: '/search', icon: <FaSearch />, label: 'Search' },
    // No raised centre action for guests: with four tabs it lands right of
    // centre and reads as a misaligned dock. The CTA returns with the fifth
    // tab once the shopper has an account.
    { path: '/sell', icon: <FaPlusCircle />, label: 'Sell' },
    { path: '/login', icon: <FaUser />, label: 'Sign in' },
  ];

  return (
    <nav className="mobile-tab-bar" aria-label="Primary">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? location.pathname === tab.path
          : location.pathname === tab.path ||
            location.pathname.startsWith(`${tab.match || tab.path}/`);
        
        return (
          <Link
            key={tab.label}
            to={tab.path}
            className={`mobile-tab-item ${tab.highlight ? 'mobile-tab-center' : ''} ${isActive ? 'active' : ''}`}
            aria-label={tab.badge > 0 ? `${tab.label}, ${tab.badge} items` : tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.icon}
            {tab.badge > 0 && (
              <span className="mobile-tab-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
            )}
            {!tab.highlight && <span>{tab.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
};

export default MobileTabBar;