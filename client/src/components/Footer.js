import React from 'react';
import { Link } from 'react-router-dom';
import { FaInstagram, FaTwitter, FaFacebook, FaPinterest, FaTiktok, FaYoutube } from 'react-icons/fa';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-grid">
          {/* Brand */}
          <div className="footer-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className="av-logo-mark" style={{ width: 28, height: 28 }}>
                <svg viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="16" fill="url(#footer-logo-gradient)"/>
                  <path d="M10 22V12l6-4 6 4v10H10z" fill="white" opacity="0.95"/>
                  <path d="M12 18h8v4h-8z" fill="white"/>
                  <defs>
                    <linearGradient id="footer-logo-gradient" x1="0" y1="0" x2="32" y2="32">
                      <stop stopColor="#6C3BFF"/>
                      <stop offset="0.55" stopColor="#8B5CFF"/>
                      <stop offset="1" stopColor="#FF6BC1"/>
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              <span className="footer-brand-name">AURAVEST</span>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
              Wear the Extraordinary. The world's most beautiful fashion marketplace — curated designers, verified authenticity, and a community that lives in style.
            </p>
            <div className="social-icons">
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                <FaInstagram />
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter">
                <FaTwitter />
              </a>
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                <FaFacebook />
              </a>
              <a href="https://pinterest.com" target="_blank" rel="noopener noreferrer" aria-label="Pinterest">
                <FaPinterest />
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" aria-label="TikTok">
                <FaTiktok />
              </a>
              <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" aria-label="YouTube">
                <FaYoutube />
              </a>
            </div>
          </div>

          {/* Shop */}
          <div className="footer-section">
            <h4>Shop</h4>
            <Link to="/search">Browse All</Link>
            <Link to="/feed">New Arrivals</Link>
            <Link to="/search?sort=popular">Trending</Link>
            <Link to="/search?category=Women">Women</Link>
            <Link to="/search?category=Men">Men</Link>
            <Link to="/search?category=Kids">Kids</Link>
          </div>

          {/* Sell */}
          <div className="footer-section">
            <h4>Sell</h4>
            <Link to="/sell">Start Selling</Link>
            <Link to="/seller-dashboard">Seller Dashboard</Link>
            <Link to="/seller-dashboard">Boost Your Items</Link>
            <Link to="/settings">Payout Settings</Link>
            <Link to="/transactions">Sales History</Link>
          </div>

          {/* Support */}
          <div className="footer-section">
            <h4>Support</h4>
            <Link to="/settings">Help Center</Link>
            <Link to="/settings">Report a Problem</Link>
            <Link to="/settings">Privacy Policy</Link>
            <Link to="/settings">Terms of Service</Link>
            <Link to="/settings">Shipping Info</Link>
            <Link to="/settings">Returns & Refunds</Link>
          </div>
        </div>

        <div className="footer-bottom">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <span>© {currentYear} AURAVEST. All rights reserved.</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ opacity: 0.5 }}>🌍 Available in 85+ countries</span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span style={{ opacity: 0.5 }}>💳 Secure payments</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;