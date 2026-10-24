import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FaSearch, FaCamera, FaHeart, FaUsers, FaBolt, FaShieldAlt, FaGlobeAmericas, FaGem, FaSpinner, FaExclamationTriangle, FaTag, FaStar, FaTruck, FaFemale, FaMale, FaChild, FaMobileAlt, FaCouch, FaSpa, FaShoppingBag, FaTshirt } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const LOADING_SKELETONS = 4;

// Real numbers, honestly formatted: the landing page must never invent
// marketplace figures. Large counts stay exact rather than rounded up.
const formatCount = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value.toLocaleString('en-US');
};

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
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trendingRes, newRes, marketRes] = await Promise.all([
        api.get('/listings?limit=8&sort=popular'),
        api.get('/listings?limit=8&sort=newest'),
        // Marketplace numbers are decoration, never a reason to fail the page.
        api.get('/listings/marketplace-stats').catch(() => null),
      ]);
      setTrending(trendingRes.data.listings || []);
      setNewArrivals(newRes.data.listings || []);
      setMarket(marketRes && marketRes.data ? marketRes.data : null);
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

  // Counts come from GET /listings/marketplace-stats (active, in-stock items
  // only). The category strip keeps its editorial order; a category with no
  // live items simply shows no count instead of an invented one.
  const categoryCounts = (market && Array.isArray(market.categories))
    ? market.categories.reduce((acc, c) => {
      if (c && typeof c.name === 'string') acc[c.name] = c.count;
      return acc;
    }, {})
    : {};

  // One icon family (react-icons) instead of emoji: emoji render differently on
  // every OS and read as placeholder design next to a premium wordmark.
  const categories = [
    { name: 'Women', icon: <FaFemale aria-hidden="true" />, color: '#FF6BC1', ariaLabel: 'Browse Women fashion' },
    { name: 'Men', icon: <FaMale aria-hidden="true" />, color: '#6C3BFF', ariaLabel: 'Browse Men fashion' },
    { name: 'Kids', icon: <FaChild aria-hidden="true" />, color: '#FFB020', ariaLabel: 'Browse Kids fashion' },
    { name: 'Electronics', icon: <FaMobileAlt aria-hidden="true" />, color: '#00D4FF', ariaLabel: 'Browse Electronics' },
    { name: 'Home', icon: <FaCouch aria-hidden="true" />, color: '#10D98E', ariaLabel: 'Browse Home goods' },
    { name: 'Beauty', icon: <FaSpa aria-hidden="true" />, color: '#FF8ACB', ariaLabel: 'Browse Beauty products' },
    { name: 'Accessories', icon: <FaShoppingBag aria-hidden="true" />, color: '#FFB86B', ariaLabel: 'Browse Accessories' },
    { name: 'Clothing', icon: <FaTshirt aria-hidden="true" />, color: '#9D74FF', ariaLabel: 'Browse Clothing' },
  ];

  // Only real figures, plus one true constant (the 8% flat commission).
  const stats = [
    { value: formatCount(market && market.totalListings), label: 'Items live', icon: <FaGem aria-hidden="true" /> },
    { value: formatCount(market && market.totalSellers), label: 'Sellers', icon: <FaUsers aria-hidden="true" /> },
    { value: formatCount(market && market.totalCountries), label: 'Countries', icon: <FaGlobeAmericas aria-hidden="true" /> },
    { value: '8%', label: 'Flat commission', icon: <FaTag aria-hidden="true" /> },
  ];

  const hasStats = stats.some((stat) => stat.value);

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
    { platform: 'TrendDrop', rate: '8%', highlight: true, note: '+ 5% buyer protection' },
    { platform: 'Poshmark', rate: '20%', highlight: false, note: 'flat rate' },
    { platform: 'Mercari', rate: '10%', highlight: false, note: '+ payment fee' },
    { platform: 'Depop', rate: '10%', highlight: false, note: '+ PayPal fee' },
  ];

  return (
    <div className="home-page" role="main" aria-label="TrendDrop Home">
      {/* ===== Hero Section ===== */}
      <section className="hero" aria-label="Hero banner">
        <div className="hero-content">
          <div className="hero-badge">
            <FaBolt aria-hidden="true" /> The New Standard in Fashion
          </div>
          <h1>Wear the<br/><span className="td-serif">Extraordinary</span></h1>
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
            <span role="listitem"><FaTruck aria-hidden="true" /> Free US shipping over $50</span>
            <span role="listitem"><FaShieldAlt aria-hidden="true" /> Buyer protection</span>
            <span role="listitem"><FaTag aria-hidden="true" /> Low 8% commission</span>
          </div>
        </div>
      </section>

      {/* ===== Live Marketplace Numbers (real counts, never invented) ===== */}
      {hasStats && (
        <section className="section" style={{ padding: '32px 0', background: 'var(--td-surface-secondary)' }} aria-label="Marketplace statistics">
          <div className="container">
            <div className="stats-bar" role="list">
              {stats.filter((stat) => stat.value).map((stat) => (
                <div key={stat.label} className="stat-item" role="listitem">
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
      )}

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
                {categoryCounts[cat.name] > 0 && (
                  <span className="category-count">{categoryCounts[cat.name].toLocaleString('en-US')} items</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Trending Listings ===== */}
      <section className="section bg-light" aria-label="Trending listings">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Trending Now</h2>
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
              <p>TrendDrop has one of the lowest commission rates in fashion — just 8%. More money in your pocket, and more time in style.</p>
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
            <p className="commission-footnote">
              Competitor rates are the platforms' published seller fees as of
              October 2026 and can change. TrendDrop's 8% is a single flat
              commission — no listing fees, no payment-processing surcharge.
            </p>
          </div>
        </div>
      </section>

      {/* ===== New Arrivals ===== */}
      <section className="section" aria-label="New arrivals">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">New Arrivals</h2>
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
      <section className="section bg-light" aria-label="Why TrendDrop features">
        <div className="container">
          <h2 className="section-title">The TrendDrop Difference</h2>
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