import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { FaFilter, FaTimes, FaSlidersH } from 'react-icons/fa';
import api from '../services/api';
import ListingCard from '../components/ListingCard';
import Pagination from '../components/Pagination';

const Search = () => {
  const [searchParams] = useSearchParams();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
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

  useEffect(() => { fetchListings(); }, [query, filters, page]); // eslint-disable-line

  const fetchListings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('search', query);
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      params.set('page', page);
      params.set('limit', 20);
      const res = await api.get(`/listings?${params.toString()}`);
      setListings(res.data.listings || res.data.docs || []);
      setPagination(res.data.pagination || { total: res.data.total, totalPages: res.data.totalPages, currentPage: Number(page) });
    } catch (error) { console.error(error); }
    setLoading(false);
  };

  const handleFilterChange = (key, value) => { setFilters(prev => ({ ...prev, [key]: value })); setPage(1); };
  const handlePageChange = (newPage) => { setPage(newPage); window.scrollTo(0, 0); };
  const clearFilters = () => { setFilters({ category: '', brand: '', size: '', condition: '', minPrice: '', maxPrice: '', sort: 'newest' }); setPage(1); };

  const categories = ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories'];
  const conditions = ['New with tags', 'New without tags', 'Good', 'Fair', 'Poor'];
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'];

  // Active filter chips
  const activeFilters = Object.entries(filters).filter(([k, v]) => v && k !== 'sort');

  return (
    <div className="page-container">
      <div className="search-header" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
        <h1>
          {query ? <span>Results for <strong>"{query}"</strong></span> : 'Browse All'}
          {pagination?.total > 0 && <span className="result-count"> · {pagination.total} items</span>}
        </h1>
        <div className="search-controls">
          <select value={filters.sort} onChange={(e) => handleFilterChange('sort', e.target.value)} className="form-input" style={{ width: 'auto', padding: '8px 32px 8px 12px' }}>
            <option value="newest">✨ Newest</option>
            <option value="price_low">💰 Price: Low to High</option>
            <option value="price_high">💎 Price: High to Low</option>
            <option value="popular">🔥 Most Popular</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={() => setShowFilters(!showFilters)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FaSlidersH size={14} /> Filters {activeFilters.length > 0 && <span className="badge badge-primary" style={{ fontSize: 10 }}>{activeFilters.length}</span>}
          </button>
        </div>
      </div>

      {/* Active Filter Chips */}
      {activeFilters.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--td-space-md)', animation: 'fadeIn 0.2s ease-out' }}>
          {activeFilters.map(([key, value]) => (
            <button key={key} className="btn btn-sm btn-primary" onClick={() => handleFilterChange(key, '')} style={{ borderRadius: 'var(--td-radius-full)', fontSize: 12, padding: '4px 12px' }}>
              {value} <FaTimes size={10} style={{ marginLeft: 4 }} />
            </button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={clearFilters} style={{ fontSize: 12 }}>Clear All</button>
        </div>
      )}

      <div className="search-layout">
        {/* Filters Sidebar */}
        <div className={`filter-sidebar ${showFilters ? 'open' : ''}`}>
          <div className="filter-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FaFilter size={14} /> Filters</h3>
            <button className="btn btn-sm btn-ghost" onClick={clearFilters}>Clear All</button>
          </div>

          <div className="filter-group">
            <h4>Category</h4>
            {categories.map(cat => (
              <label key={cat} className="filter-option" style={{ cursor: 'pointer' }}>
                <input type="radio" name="category" checked={filters.category === cat}
                  onChange={() => handleFilterChange('category', filters.category === cat ? '' : cat)} />
                {cat}
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Condition</h4>
            {conditions.map(cond => (
              <label key={cond} className="filter-option" style={{ cursor: 'pointer' }}>
                <input type="radio" name="condition" checked={filters.condition === cond}
                  onChange={() => handleFilterChange('condition', filters.condition === cond ? '' : cond)} />
                {cond}
              </label>
            ))}
          </div>

          <div className="filter-group">
            <h4>Size</h4>
            <div className="size-options">
              {sizes.map(size => (
                <button key={size} className={`size-btn ${filters.size === size ? 'active' : ''}`}
                  onClick={() => handleFilterChange('size', filters.size === size ? '' : size)}>
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <h4>Price Range</h4>
            <div className="price-range">
              <input type="number" placeholder="Min" value={filters.minPrice}
                onChange={(e) => handleFilterChange('minPrice', e.target.value)} className="form-input" style={{ flex: 1 }} />
              <span style={{ color: 'var(--td-text-tertiary)' }}>—</span>
              <input type="number" placeholder="Max" value={filters.maxPrice}
                onChange={(e) => handleFilterChange('maxPrice', e.target.value)} className="form-input" style={{ flex: 1 }} />
            </div>
          </div>

          <div className="filter-group">
            <h4>Brand</h4>
            <input type="text" placeholder="Search brand..." value={filters.brand}
              onChange={(e) => handleFilterChange('brand', e.target.value)} className="form-input" />
          </div>

          {/* Mobile close button */}
          <button className="btn btn-primary btn-block" onClick={() => setShowFilters(false)} style={{ marginTop: 'var(--td-space-md)' }}>
            <FaTimes size={14} /> Close Filters
          </button>
        </div>

        {/* Results */}
        <div className="search-results">
          {loading ? (
            <div className="listings-grid">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="skeleton skeleton-card" style={{ animation: `fadeIn 0.3s ease-out ${i * 0.05}s` }}>
                  <div className="skeleton skeleton-image" />
                  <div style={{ padding: 'var(--td-space-md)' }}><div className="skeleton skeleton-text-lg" /><div className="skeleton skeleton-text" style={{ width: '40%' }} /></div>
                </div>
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
              <div className="empty-state-icon">🔍</div>
              <h2>No items found</h2>
              <p>Try different filters or search terms</p>
              <button className="btn btn-primary" onClick={clearFilters}>Clear Filters</button>
            </div>
          ) : (
            <>
              <div className="listings-grid">
                {listings.map((listing, i) => (
                  <div key={listing._id} style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.03}s both` }}>
                    <ListingCard listing={listing} />
                  </div>
                ))}
              </div>
              {pagination && <Pagination currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={handlePageChange} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Search;