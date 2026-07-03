import React, { useState } from 'react';
import api from '../services/api';
import './PriceSuggestion.css';

const PriceSuggestion = () => {
  const [formData, setFormData] = useState({
    title: '',
    category: 'Men',
    brand: '',
    condition: 'Good',
  });
  const [suggestion, setSuggestion] = useState(null);
  const [similarListings, setSimilarListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categories = ['Men', 'Women', 'Kids', 'Electronics', 'Home', 'Sports'];
  const conditions = ['New', 'Like New', 'Good', 'Fair', 'Poor'];

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await api.post('/price-suggestions/suggest', formData);
      setSuggestion(res.data);
      
      // Also fetch similar listings
      const similarRes = await api.post('/price-suggestions/similar', {
        title: formData.title,
        category: formData.category,
        brand: formData.brand,
      });
      setSimilarListings(similarRes.data.similar || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to get price suggestion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="price-suggestion-page">
      <div className="suggestion-header">
        <h1>Price Suggestion AI</h1>
        <p>Get smart pricing recommendations based on market data</p>
      </div>

      <div className="suggestion-container glass-card">
        <form onSubmit={handleSubmit} className="suggestion-form">
          <div className="form-group">
            <label>Item Title</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="e.g., Nike Air Max 2023"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select name="category" value={formData.category} onChange={handleChange}>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Condition</label>
              <select name="condition" value={formData.condition} onChange={handleChange}>
                {conditions.map(cond => (
                  <option key={cond} value={cond}>{cond}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Brand (Optional)</label>
            <input
              type="text"
              name="brand"
              value={formData.brand}
              onChange={handleChange}
              placeholder="e.g., Nike, Gucci, Apple"
            />
          </div>

          <button type="submit" disabled={loading} className="suggest-button">
            {loading ? 'Calculating...' : 'Get Price Suggestion'}
          </button>
        </form>

        {error && <div className="error-message">{error}</div>}

        {suggestion && (
          <div className="suggestion-result">
            <h2>Suggested Price: ${suggestion.suggestedPrice}</h2>
            <div className="price-range">
              <span>Recommended Range: ${suggestion.priceRange.min} - ${suggestion.priceRange.max}</span>
            </div>

            <div className="price-breakdown">
              <h3>Price Breakdown:</h3>
              <ul>
                <li>Base Price: ${suggestion.breakdown.basePrice}</li>
                <li>Brand Multiplier: {suggestion.breakdown.brandMultiplier}x</li>
                <li>Condition Multiplier: {suggestion.breakdown.conditionMultiplier}x</li>
                <li>Seasonality: {suggestion.breakdown.seasonality}x</li>
              </ul>
            </div>
          </div>
        )}

        {similarListings.length > 0 && (
          <div className="similar-listings">
            <h3>Similar Sold Items:</h3>
            <div className="similar-grid">
              {similarListings.map(listing => (
                <div key={listing._id} className="similar-item">
                  <span className="similar-title">{listing.title}</span>
                  <span className="similar-price">${listing.price}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceSuggestion;