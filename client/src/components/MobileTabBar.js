import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { 
  FaHome, 
  FaCompass, 
  FaPlusCircle, 
  FaEnvelope, 
  FaUser,
  FaHeart,
} from 'react-icons/fa';

const MobileTabBar = () => {
  const { user } = useAuth();
  const { cart } = useCart();
  const location = useLocation();
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  const tabs = user ? [
    { path: '/', icon: <FaHome />, label: 'Home' },
    { path: '/feed', icon: <FaCompass />, label: 'Feed' },
    { path: '/sell', icon: <FaPlusCircle />, label: 'Sell', highlight: true },
    { path: '/messages', icon: <FaEnvelope />, label: 'Messages' },
    { path: `/profile/${user.id || user._id}`, icon: <FaUser />, label: 'Profile' },
  ] : [
    { path: '/', icon: <FaHome />, label: 'Home' },
    { path: '/feed', icon: <FaCompass />, label: 'Feed' },
    { path: '/sell', icon: <FaPlusCircle />, label: 'Sell', highlight: true },
    { path: '/wishlist', icon: <FaHeart />, label: 'Saved' },
    { path: '/login', icon: <FaUser />, label: 'Login' },
  ];

  return (
    <nav className="mobile-tab-bar">
      {tabs.map((tab) => {
        const isActive = location.pathname === tab.path || 
          (tab.path !== '/' && location.pathname.startsWith(tab.path));
        
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`mobile-tab-item ${isActive ? 'active' : ''}`}
          >
            {tab.highlight ? (
              <div style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--td-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 20,
                marginTop: -12,
                boxShadow: '0 4px 12px var(--td-primary-glow)',
              }}>
                {tab.icon}
              </div>
            ) : (
              tab.icon
            )}
            {!tab.highlight && <span>{tab.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
};

export default MobileTabBar;