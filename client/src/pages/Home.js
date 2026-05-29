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