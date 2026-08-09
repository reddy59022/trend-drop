import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  FaHome, 
  FaCompass, 
  FaPlusCircle, 
  FaEnvelope, 
  FaUser,
  FaHeart,
  FaFire,
} from 'react-icons/fa';

const MobileTabBar = () => {
  const { user } = useAuth();
  const location = useLocation();
  // Logged-out users only see public routes (/home, /feed & /login).
  // Protected routes (/sell, /messages, /profile, /wishlist) require auth,
  // so showing them to guests would create a confusing login-loop UX.
  const tabs = user ? [
    { path: '/', icon: <FaHome />, label: 'Home' },
    { path: '/feed', icon: <FaCompass />, label: 'Feed' },
    { path: '/sell', icon: <FaPlusCircle />, label: 'Sell', highlight: true },
    { path: '/trends', icon: <FaFire />, label: 'Trends' },
    { path: '/messages', icon: <FaEnvelope />, label: 'Messages' },
    { path: `/profile/${user.id || user._id}`, icon: <FaUser />, label: 'Profile' },
  ] : [
    { path: '/', icon: <FaHome />, label: 'Home' },
    { path: '/feed', icon: <FaCompass />, label: 'Feed' },
    { path: '/login', icon: <FaUser />, label: 'Login', highlight: true },
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
            className={`mobile-tab-item ${tab.highlight ? 'mobile-tab-center' : ''} ${isActive ? 'active' : ''}`}
            aria-label={tab.label}
          >
            {tab.icon}
            {!tab.highlight && <span>{tab.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
};

export default MobileTabBar;