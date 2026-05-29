import React from 'react';
import { Link } from 'react-router-dom';
import { FaFacebook, FaTwitter, FaInstagram, FaPinterest } from 'react-icons/fa';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-grid">
          <div className="footer-section">
            <h4>About</h4>
            <Link to="/">Company</Link>
            <Link to="/">Careers</Link>
            <Link to="/">Press</Link>
          </div>
          <div className="footer-section">
            <h4>Help</h4>
            <Link to="/">Help Center</Link>
            <Link to="/">Selling</Link>
            <Link to="/">Buying</Link>
          </div>
          <div className="footer-section">
            <h4>Legal</h4>
            <Link to="/">Terms of Service</Link>
            <Link to="/">Privacy Policy</Link>
            <Link to="/">Cookie Policy</Link>
          </div>
          <div className="footer-section">
            <h4>Connect</h4>
            <div className="social-icons">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer"><FaFacebook /></a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"><FaTwitter /></a>
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer"><FaInstagram /></a>
              <a href="https://pinterest.com" target="_blank" rel="noopener noreferrer"><FaPinterest /></a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} TrendDrop. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;