import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FaSearch, FaCamera, FaHeart, FaUsers, FaBolt, FaShieldAlt, FaGlobeAmericas, FaGem, FaSpinner, FaExclamationTriangle, FaStore, FaTag, FaStar, FaTruck } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const LOADING_SKELETONS = 4;

const SkeletonCard = () => (
  <div className="listing-card" style={{ pointerEvents: 'none' }}>
    <div style={{ width: '100%', paddingBottom: '100%', background: 'linear-gradient(90deg, var(--td-surface-2) 25%, var(--td-surface) 50%, var(--td-surface-2) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite', borderRadius: 'var(--td-radius-sm) var(--td-radius-sm) 0 0' }} />
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ height: 14, width: '80%', background: 'var(--td-surface-2)', borderRadius: 4, animation: 'shimmer 1.5s infinite' }} />
      <div style={{ height: 12, width: '60%', background: 'var(--td-surface-2)', borderRadius: 4, animation: 'shimmer 1.5s infinite' }} />
      <div style={{ height: 16, width: '40%', background: 'var(--td-surface-2)', borderRadius: 4, animation: 'shimmer 1.5s infinite' }} />
    </div>
  </div>
);

const Home = () => {
  const [trending, setTrending] = useState([]);
  const [newArrivals, setNewArrivals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trendingRes, newRes] = await Promise.all([
        api.get('/listings?limit=8&sort=popular'),
        api.get('/listings?limit=8&sort=newest'),
      ]);
      setTrending(trendingRes.data.listings || []);
      setNewArrivals(newRes.data.listings || []);
    } catch (error) {
      console.error('Error fetching listings:', error);
      setError('Unable to load listings. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const categories = [
    { name: 'Women', icon: '👗', color: '#FF385C', count: '12.5K', ariaLabel: 'Browse Women fashion' },
    { name: 'Men', icon: '👔', color: '#1A1A2E', count: '8.3K', ariaLabel: 'Browse Men fashion' },
    { name: 'Kids', icon: '🧸', color: '#FF8C42', count: '4.1K', ariaLabel: 'Browse Kids fashion' },
    { name: 'Electronics', icon: '📱', color: '#00BCD4', count: '6.7K', ariaLabel: 'Browse Electronics' },
    { name: 'Home', icon: '🏠', color: '#4CAF50', count: '5.2K', ariaLabel: 'Browse Home goods' },
    { name: 'Beauty', icon: '💄', color: '#E040FB', count: '3.8K', ariaLabel: 'Browse Beauty products' },
    { name: 'Accessories', icon: '👜', color: '#FF9800', count: '9.4K', ariaLabel: 'Browse Accessories' },
    { name: 'Vintage', icon: '🎭', color: '#6C63FF', count: '2.6K', ariaLabel: 'Browse Vintage items' },
  ];

  const stats = [
    { value: '85+', label: 'Countries', icon: <FaGlobeAmericas aria-hidden="true" /> },
    { value: '50K+', label: 'Active Sellers', icon: <FaUsers aria-hidden="true" /> },
    { value: '1M+', label: 'Items Listed', icon: <FaGem aria-hidden="true" /> },
    { value: '99%', label: 'Buyer Protection', icon: <FaShieldAlt aria-hidden="true" /> },
  ];

  const renderListingGrid = (listings) => {
    if (listings.length === 0) {
      return (
        <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛍️</div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No listings yet</h3>
          <p style={{ color: 'var(--td-text-tertiary)', fontSize: 14, marginBottom: 16 }}>
            Be the first to list an item! Start selling today.
          </p>
          <Link to="/sell" className="btn btn-primary btn-sm">
            <FaCamera aria-hidden="true" /> Start Selling
          </Link>
        </div>
      );
    }
    return (
      <div className="listings-grid">
        {listings.map((listing) => (
          <div key={listing._id} style={{ animation: `fadeInUp 0.4s ease-out` }}>
            <ListingCard listing={listing} />
          </div>
        ))}
      </div>
    );
  };

  // Fixed commission display - matches actual 8% platform fee
  const commissionData = [
    { platform: 'AURAVEST', rate: '8%', highlight: true, note: '+ 5% buyer protection' },
    { platform: 'Poshmark', rate: '20%', highlight: false, note: 'flat rate' },
    { platform: 'Mercari', rate: '10%', highlight: false, note: '+ payment fee' },
    { platform: 'Depop', rate: '10%', highlight: false, note: '+ PayPal fee' },
  ];

  return (
    <div className="home-page" role="main" aria-label="AURAVEST Home">
      {/* ===== Hero Section ===== */}
      <section className="hero" aria-label="Hero banner">
        <div className="hero-content">
          <div className="hero-badge">
            <FaBolt aria-hidden="true" /> The New Standard in Fashion
          </div>
          <h1>Wear the<br/><span className="av-serif">Extraordinary</span></h1>
          <p>Discover designer pieces, vintage treasures, and verified luxury — curated by a global community that lives in style.</p>
          <div className="hero-actions">
            <Link to="/search" className="btn btn-primary btn-lg" aria-label="Start shopping">
              <FaSearch aria-hidden="true" /> Start Shopping
            </Link>
            <Link to="/sell" className="btn btn-glass btn-lg" aria-label="Start selling">
              <FaCamera aria-hidden="true" /> Start Selling
            </Link>
          </div>
          <div className="hero-features" role="list" aria-label="Platform highlights">
            <span role="listitem"><FaTruck aria-hidden="true" /> Free shipping over $50</span>
            <span role="listitem"><FaShieldAlt aria-hidden="true" /> Buyer protection</span>
            <span role="listitem"><FaTag aria-hidden="true" /> Low 8% commission</span>
          </div>
        </div>
      </section>

      {/* ===== Global Stats Bar ===== */}
      <section className="section" style={{ padding: '32px 0', background: 'var(--td-surface-secondary)' }} aria-label="Platform statistics">
        <div className="container">
          <div className="stats-bar" role="list">
            {stats.map((stat, i) => (
              <div key={i} className="stat-item" role="listitem">
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
      <section className="section" aria-label="Shop by category">
        <div className="container">
          <h2 className="section-title">Shop by Category</h2>
          <div className="categories-grid" role="list">
            {categories.map((cat) => (
              <Link
                key={cat.name}
                to={`/search?category=${cat.name}`}
                className="category-card"
                style={{ '--cat-color': cat.color }}
                aria-label={cat.ariaLabel}
                role="listitem"
              >
                <span className="category-icon" aria-hidden="true">{cat.icon}</span>
                <span className="category-name">{cat.name}</span>
                <span className="category-count">{cat.count} items</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Trending Listings ===== */}
      <section className="section bg-light" aria-label="Trending listings">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">🔥 Trending Now</h2>
            <Link to="/search?sort=popular" className="btn btn-ghost btn-sm" aria-label="View all trending">
              View All →
            </Link>
          </div>
          {loading ? (
            <div className="listings-grid" role="status" aria-label="Loading trending listings">
              {Array.from({ length: LOADING_SKELETONS }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="empty-state" role="alert">
              <FaExclamationTriangle size={32} style={{ color: 'var(--td-warning)', marginBottom: 12 }} />
              <p style={{ color: 'var(--td-text-secondary)', marginBottom: 16 }}>{error}</p>
              <button className="btn btn-outline btn-sm" onClick={fetchData} aria-label="Retry loading listings">
                <FaSpinner aria-hidden="true" /> Retry
              </button>
            </div>
          ) : renderListingGrid(trending)}
        </div>
      </section>

      {/* ===== Commission Comparison ===== */}
      <section className="commission-section" aria-label="Commission comparison">
        <div className="container">
          <div className="commission-content">
            <div className="commission-text">
              <span className="commission-badge">💎 Lowest Fees</span>
              <h2>Keep Up to 92% of Your Sales</h2>
              <p>AURAVEST has one of the lowest commission rates in fashion — just 8%. More money in your pocket, and more time in style.</p>
              <Link to="/seller-dashboard" className="btn btn-primary btn-lg" aria-label="Start selling, keep more">
                Start Selling — Keep More 💰
              </Link>
            </div>
            <div className="commission-comparison" role="list">
              {commissionData.map(item => (
                <div key={item.platform} className={`compare-card ${item.highlight ? 'highlight' : ''}`} role="listitem">
                  <div className="compare-platform">{item.platform}</div>
                  <div className="compare-rate">{item.rate}</div>
                  <div className="compare-label">commission</div>
                  <div className="compare-note">{item.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== New Arrivals ===== */}
      <section className="section" aria-label="New arrivals">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">✨ New Arrivals</h2>
            <Link to="/feed" className="btn btn-ghost btn-sm" aria-label="View all new arrivals">
              View All →
            </Link>
          </div>
          {loading ? (
            <div className="listings-grid" role="status" aria-label="Loading new arrivals">
              {Array.from({ length: LOADING_SKELETONS }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="empty-state" role="alert">
              <FaExclamationTriangle size={32} style={{ color: 'var(--td-warning)', marginBottom: 12 }} />
              <p style={{ color: 'var(--td-text-secondary)', marginBottom: 16 }}>{error}</p>
              <button className="btn btn-outline btn-sm" onClick={fetchData} aria-label="Retry loading listings">
                <FaSpinner aria-hidden="true" /> Retry
              </button>
            </div>
          ) : renderListingGrid(newArrivals)}
        </div>
      </section>

      {/* ===== Features ===== */}
      <section className="section bg-light" aria-label="Why AURAVEST features">
        <div className="container">
          <h2 className="section-title">The AURAVEST Difference</h2>
          <div className="features-grid">
            <div className="feature-card glass">
              <div className="feature-icon-wrap">
                <FaCamera className="feature-icon" aria-hidden="true" />
              </div>
              <h3>Snap & List in Seconds</h3>
              <p>AI-powered listing. Just snap a photo, and we help you set the perfect price.</p>
            </div>
            <div className="feature-card glass" tabIndex={0}>
              <div className="feature-icon-wrap">
                <FaHeart className="feature-icon" aria-hidden="true" />
              </div>
              <h3>Negotiate with Confidence</h3>
              <p>Make offers, counter-offers, and find the perfect deal with our secure negotiation system.</p>
            </div>
            <div className="feature-card glass">
              <div className="feature-icon-wrap">
                <FaGlobeAmericas className="feature-icon" aria-hidden="true" />
              </div>
              <h3>Global Community</h3>
              <p>Buy and sell in 85+ countries with multi-currency support and local shipping options.</p>
            </div>
            <div className="feature-card glass">
              <div className="feature-icon-wrap">
                <FaStar className="feature-icon" aria-hidden="true" />
              </div>
              <h3>Verified Sellers</h3>
              <p>Shop with confidence from verified sellers with real reviews and ratings.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="cta-section" aria-label="Call to action">
        <div className="container">
          <h2>Your Closet Has a Story.</h2>
          <p>Turn it into a masterpiece — and a paycheck. Join thousands of verified sellers worldwide.</p>
          <div className="cta-actions">
            <Link to="/register" className="btn btn-primary btn-xl" aria-label="Get started free">
              Get Started Free
            </Link>
            <Link to="/feed" className="btn btn-glass btn-xl" aria-label="Browse items">
              Browse Items
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;