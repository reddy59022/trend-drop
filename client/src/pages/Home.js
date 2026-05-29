import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaSearch, FaCamera, FaHeart, FaUsers } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const Home = () => {
  const [trending, setTrending] = useState([]);

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const res = await api.get('/listings?limit=8&sort=popular');
        setTrending(res.data.listings);
      } catch (error) {
        console.error(error);
      }
    };
    fetchTrending();
  }, []);

  const categories = [
    { name: 'Women', icon: '👗', color: '#E24455' },
    { name: 'Men', icon: '👔', color: '#2A2A2A' },
    { name: 'Kids', icon: '🧸', color: '#FF8C42' },
    { name: 'Electronics', icon: '📱', color: '#4ECDC4' },
    { name: 'Home', icon: '🏠', color: '#45B7D1' },
    { name: 'Beauty', icon: '💄', color: '#DDA0DD' },
    { name: 'Accessories', icon: '👜', color: '#98D8C8' },
  ];

  return (
    <div className="home-page">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <h1>Buy & Sell Fashion</h1>
          <p>Shop millions of items from your favorite brands</p>
          <div className="hero-actions">
            <Link to="/search" className="btn btn-primary btn-lg">
              <FaSearch /> Browse
            </Link>
            <Link to="/sell" className="btn btn-secondary btn-lg">
              <FaCamera /> Start Selling
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
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
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Trending Listings */}
      {trending.length > 0 && (
        <section className="section bg-light">
          <div className="container">
            <h2 className="section-title">Trending Items</h2>
            <div className="listings-grid">
              {trending.map((listing) => (
                <ListingCard key={listing._id} listing={listing} />
              ))}
            </div>
            <div className="section-cta">
              <Link to="/search" className="btn btn-outline">
                View All
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Commission Comparison - Attract Sellers */}
      <section className="section" style={{ background: 'linear-gradient(135deg, #FF4D6D, #FF8FA3)', color: '#fff', padding: '40px 0' }}>
        <div className="container" style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Keep 95% of Your Sales</h2>
          <p style={{ fontSize: 16, marginBottom: 24, opacity: 0.9 }}>TrendDrop has the lowest commission in the market</p>
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 16,
            flexWrap: 'wrap', marginBottom: 24,
          }}>
            {[
              { platform: 'TrendDrop', rate: '5%', highlight: true },
              { platform: 'Poshmark', rate: '20%', highlight: false },
              { platform: 'Mercari', rate: '10%', highlight: false },
              { platform: 'Depop', rate: '10%', highlight: false },
            ].map(item => (
              <div key={item.platform} style={{
                background: item.highlight ? '#fff' : 'rgba(255,255,255,0.15)',
                color: item.highlight ? '#FF4D6D' : '#fff',
                borderRadius: 12, padding: '16px 24px',
                minWidth: 120, textAlign: 'center',
                border: item.highlight ? '3px solid #fff' : '2px solid rgba(255,255,255,0.3)',
              }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>
                  {item.platform}
                </div>
                <div style={{ fontSize: 32, fontWeight: 800 }}>{item.rate}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>commission</div>
              </div>
            ))}
          </div>
          <Link to="/seller-dashboard" style={{
            display: 'inline-block', padding: '12px 32px', background: '#fff',
            color: '#FF4D6D', borderRadius: 24, fontWeight: 700, fontSize: 15,
            textDecoration: 'none',
          }}>
            Start Selling — Keep More 💰
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="section">
        <div className="container">
          <h2 className="section-title">Why TrendDrop?</h2>
          <div className="features-grid">
            <div className="feature-card">
              <FaCamera className="feature-icon" />
              <h3>Snap & List</h3>
              <p>List your items in seconds. Just snap a photo, add details, and you're ready to sell.</p>
            </div>
            <div className="feature-card">
              <FaHeart className="feature-icon" />
              <h3>Make Offers</h3>
              <p>Found something you love? Make an offer and negotiate the best price.</p>
            </div>
            <div className="feature-card">
              <FaUsers className="feature-icon" />
              <h3>Join Community</h3>
              <p>Follow sellers, share listings, and be part of a fashion-loving community.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="container">
          <h2>Ready to Start Selling?</h2>
          <p>Turn your closet into cash. List your first item today!</p>
          <Link to="/register" className="btn btn-primary btn-lg">
            Get Started Free
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Home;