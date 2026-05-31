import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaSearch, FaCamera, FaHeart, FaUsers, FaBolt, FaShieldAlt, FaGlobeAmericas, FaGem } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const Home = () => {
  const [trending, setTrending] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [trendingRes, newRes] = await Promise.all([
          api.get('/listings?limit=8&sort=popular'),
          api.get('/listings?limit=8&sort=newest'),
        ]);
        setTrending(trendingRes.data.listings || []);
        setNewArrivals(newRes.data.listings || []);
      } catch (error) {
        console.error('Error fetching listings:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const categories = [
    { name: 'Women', icon: '👗', color: '#FF385C', count: '12.5K' },
    { name: 'Men', icon: '👔', color: '#1A1A2E', count: '8.3K' },
    { name: 'Kids', icon: '🧸', color: '#FF8C42', count: '4.1K' },
    { name: 'Electronics', icon: '📱', color: '#00BCD4', count: '6.7K' },
    { name: 'Home', icon: '🏠', color: '#4CAF50', count: '5.2K' },
    { name: 'Beauty', icon: '💄', color: '#E040FB', count: '3.8K' },
    { name: 'Accessories', icon: '👜', color: '#FF9800', count: '9.4K' },
    { name: 'Vintage', icon: '🎭', color: '#6C63FF', count: '2.6K' },
  ];

  const stats = [
    { value: '85+', label: 'Countries', icon: <FaGlobeAmericas /> },
    { value: '50K+', label: 'Active Sellers', icon: <FaUsers /> },
    { value: '1M+', label: 'Items Listed', icon: <FaGem /> },
    { value: '99%', label: 'Buyer Protection', icon: <FaShieldAlt /> },
  ];

  return (
    <div className="home-page">
      {/* ===== Hero Section ===== */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <FaBolt /> Global Fashion Marketplace
          </div>
          <h1>Buy & Sell Fashion<br/>From Around the World</h1>
          <p>Join millions of fashion lovers. Shop unique items, make offers, and sell your closet — all in one place.</p>
          <div className="hero-actions">
            <Link to="/search" className="btn btn-primary btn-lg">
              <FaSearch /> Start Shopping
            </Link>
            <Link to="/sell" className="btn btn-glass btn-lg">
              <FaCamera /> Start Selling
            </Link>
          </div>
          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap', opacity: 0.7, fontSize: 13 }}>
            <span>✨ Free shipping over $50</span>
            <span>🔒 Buyer protection</span>
            <span>💎 5% low commission</span>
          </div>
        </div>
      </section>

      {/* ===== Global Stats Bar ===== */}
      <section className="section" style={{ padding: '32px 0', background: 'var(--td-surface-secondary)' }}>
        <div className="container">
          <div className="stats-bar">
            {stats.map((stat, i) => (
              <div key={i} className="stat-item">
                <span className="stat-icon">{stat.icon}</span>
                <div className="stat-info">
                  <span className="stat-value">{stat.value}</span>
                  <span className="stat-label">{stat.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Categories ===== */}
      <section className="section">
        <div className="container">
          <h2 className="section-title">Shop by Category</h2>
          <div className="categories-grid">
            {categories.map((cat) => (
              <Link
                key={cat.name}
                to={`/search?category=${cat.name}`}
                className="category-card"
                style={{ '--cat-color': cat.color }}
              >
                <span className="category-icon">{cat.icon}</span>
                <span className="category-name">{cat.name}</span>
                <span className="category-count">{cat.count} items</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Trending Listings ===== */}
      {trending.length > 0 && (
        <section className="section bg-light">
          <div className="container">
            <div className="section-header">
              <h2 className="section-title">🔥 Trending Now</h2>
              <Link to="/search?sort=popular" className="btn btn-ghost btn-sm">
                View All →
              </Link>
            </div>
            <div className="listings-grid">
              {trending.map((listing, i) => (
                <div key={listing._id} style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.05}s both` }}>
                  <ListingCard listing={listing} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== Commission Comparison ===== */}
      <section className="commission-section">
        <div className="container">
          <div className="commission-content">
            <div className="commission-text">
              <span className="commission-badge">💎 Lowest Fees</span>
              <h2>Keep Up to 95% of Your Sales</h2>
              <p>TrendDrop has the lowest commission in the market — just 5%. More money in your pocket.</p>
              <Link to="/seller-dashboard" className="btn btn-primary btn-lg">
                Start Selling — Keep More 💰
              </Link>
            </div>
            <div className="commission-comparison">
              {[
                { platform: 'TrendDrop', rate: '5%', highlight: true },
                { platform: 'Poshmark', rate: '20%', highlight: false },
                { platform: 'Mercari', rate: '10%', highlight: false },
                { platform: 'Depop', rate: '10%', highlight: false },
              ].map(item => (
                <div key={item.platform} className={`compare-card ${item.highlight ? 'highlight' : ''}`}>
                  <div className="compare-platform">{item.platform}</div>
                  <div className="compare-rate">{item.rate}</div>
                  <div className="compare-label">commission</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== New Arrivals ===== */}
      {newArrivals.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-header">
              <h2 className="section-title">✨ New Arrivals</h2>
              <Link to="/feed" className="btn btn-ghost btn-sm">
                View All →
              </Link>
            </div>
            <div className="listings-grid">
              {newArrivals.map((listing, i) => (
                <div key={listing._id} style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.05}s both` }}>
                  <ListingCard listing={listing} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== Features ===== */}
      <section className="section bg-light">
        <div className="container">
          <h2 className="section-title">Why TrendDrop?</h2>
          <div className="features-grid">
            <div className="feature-card glass">
              <div className="feature-icon-wrap">
                <FaCamera className="feature-icon" />
              </div>
              <h3>Snap & List in Seconds</h3>
              <p>AI-powered listing. Just snap a photo, and we help you set the perfect price.</p>
            </div>
            <div className="feature-card glass">
              <div className="feature-icon-wrap">
                <FaHeart className="feature-icon" />
              </div>
              <h3>Negotiate with Confidence</h3>
              <p>Make offers, counter-offers, and find the perfect deal with our secure negotiation system.</p>
            </div>
            <div className="feature-card glass">
              <div className="feature-icon-wrap">
                <FaGlobeAmericas className="feature-icon" />
              </div>
              <h3>Global Community</h3>
              <p>Buy and sell in 85+ countries with multi-currency support and local shipping options.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="cta-section">
        <div className="container">
          <h2>Ready to Start Selling?</h2>
          <p>Turn your closet into cash. Join millions of sellers worldwide.</p>
          <div className="cta-actions">
            <Link to="/register" className="btn btn-primary btn-xl">
              Get Started Free
            </Link>
            <Link to="/feed" className="btn btn-glass btn-xl">
              Browse Items
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;