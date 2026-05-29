import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FaFilter } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const Search = () => {
  const [searchParams] = useSearchParams();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState({
    category: searchParams.get('category') || '',
    brand: searchParams.get('brand') || '',
    size: searchParams.get('size') || '',
    condition: searchParams.get('condition') || '',
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    sort: searchParams.get('sort') || 'newest',
  });

  const query = searchParams.get('q') || '';

  useEffect(() => {
    fetchListings();
    // eslint-disable-next-line
  }, [query, filters, page]);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('search', query);
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      params.set('page', page);
      params.set('limit', 20);

      const res = await api.get(`/listings?${params.toString()}`);
      setListings(res.data.listings);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({
      category: '', brand: '', size: '', condition: '',
      minPrice: '', maxPrice: '', sort: 'newest',
    });
    setPage(1);
  };

  const categories = ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'];
  const conditions = ['New with tags', 'New without tags', 'Good', 'Fair', 'Poor'];
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'];

  return (
    <div className="page-container">
      <div className="search-header">
        <h1>
          {query ? `Results for "${query}"` : 'Browse All'}
          {total > 0 && <span className="result-count"> ({total} items)</span>}
        </h1>
        <div className="search-controls">
          <select
            value={filters.sort}
            onChange={(e) => handleFilterChange('sort', e.target.value)}
            className="form-input"
          >
            <option value="newest">Newest</option>
            <option value="price_low">Price: Low to High</option>
            <option value="price_high">Price: High to Low</option>
            <option value="popular">Most Popular</option>
          </select>
          <button
            className="btn btn-outline filter-toggle"
            onClick={() => setShowFilters(!showFilters)}
          >
            <FaFilter /> Filters
          </button>
        </div>
      </div>

      <div className="search-layout">
        {/* Filters Sidebar */}
        <div className={`filter-sidebar ${showFilters ? 'open' : ''}`}>
          <div className="filter-header">
            <h3>Filters</h3>
            <button className="btn btn-sm" onClick={clearFilters}>Clear All</button>
          </div>

          <div className="filter-group">
            <h4>Category</h4>
            {categories.map((cat) => (
              <label key={cat} className="filter-option">
                <input
                  type="radio"
                  name="category"
                  checked={filters.category === cat}
                  onChange={() => handleFilterChange('category', filters.category === cat ? '' : cat)}
                />
                {cat}
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Condition</h4>
            {conditions.map((cond) => (
              <label key={cond} className="filter-option">
                <input
                  type="radio"
                  name="condition"
                  checked={filters.condition === cond}
                  onChange={() => handleFilterChange('condition', filters.condition === cond ? '' : cond)}
                />
                {cond}
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Size</h4>
            <div className="size-options">
              {sizes.map((size) => (
                <button
                  key={size}
                  className={`size-btn ${filters.size === size ? 'active' : ''}`}
                  onClick={() => handleFilterChange('size', filters.size === size ? '' : size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <h4>Price Range</h4>
            <div className="price-range">
              <input
                type="number"
                placeholder="Min"
                value={filters.minPrice}
                onChange={(e) => handleFilterChange('minPrice', e.target.value)}
                className="form-input"
              />
              <span>-</span>
              <input
                type="number"
                placeholder="Max"
                value={filters.maxPrice}
                onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          <div className="filter-group">
            <label>
              <input
                type="text"
                placeholder="Brand..."
                value={filters.brand}
                onChange={(e) => handleFilterChange('brand', e.target.value)}
                className="form-input"
              />
            </label>
          </div>
        </div>

        {/* Results */}
        <div className="search-results">
          {loading ? (
            <div className="spinner"></div>
          ) : listings.length === 0 ? (
            <div className="empty-state">
              <p>No items found. Try different filters.</p>
            </div>
          ) : (
            <>
              <div className="listings-grid">
                {listings.map((listing) => (
                  <ListingCard key={listing._id} listing={listing} />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="pagination">
                  <button className="btn btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button className="btn btn-sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Search;