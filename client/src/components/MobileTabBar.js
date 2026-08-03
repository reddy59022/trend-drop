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
} from 'react-icons/fa';

const MobileTabBar = () => {
  const { user } = useAuth();
  const location = useLocation();
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