import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FaFilter, FaTimes, FaSlidersH, FaChevronDown, FaSave, FaTag } from 'react-icons/fa';
import api, { getSearchBrands, getSearchColors, getSearchSizes, saveSearchFilter, getSavedSearchFilters, shareOfferToLikers } from '../services/api';
import ListingCard from '../components/ListingCard';
import Pagination from '../components/Pagination';
import { toast } from 'react-toastify';

const Search = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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

  const [brandSuggestions, setBrandSuggestions] = useState([]);
  const [colorSuggestions, setColorSuggestions] = useState([]);
  const [sizeSuggestions, setSizeSuggestions] = useState([]);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [showSaveSearch, setShowSaveSearch] = useState(false);

  const query = searchParams.get('q') || '';

  useEffect(() => { fetchListings(); }, [query, filters, page]); // eslint-disable-line

  // Load autocomplete suggestions
  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const brandsRes = await getSearchBrands();
        setBrandSuggestions(brandsRes.data?.slice(0, 20) || []);
        
        if (filters.category) {
          const colorsRes = await getSearchColors(filters.category);
          setColorSuggestions(colorsRes.data?.slice(0, 15) || []);
          
          const sizesRes = await getSearchSizes(filters.category);
          setSizeSuggestions(sizesRes.data?.slice(0, 20).map(s => s.size) || []);
        }
      } catch (error) {
        console.error('Error loading suggestions:', error);
      }
    };
    loadSuggestions();
  }, [filters.category]); // eslint-disable-line

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

  // Save search functionality
  const handleSaveSearch = async () => {
    try {
      await saveSearchFilter({
        query,
        filters,
        name: `${filters.category || 'All'} Search`,
      });
      setShowSaveSearch(false);
      toast.success('Search saved! You can find it in Saved Searches.');
    } catch (error) {
      console.error('Error saving search:', error);
    }
  };

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

          {/* Brand Autocomplete */}
          <div className="filter-group" style={{ position: 'relative' }}>
            <h4>Brand</h4>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search brands..."
                value={filters.brand}
                onChange={(e) => handleFilterChange('brand', e.target.value)}
                onFocus={() => setShowBrandDropdown(true)}
                onBlur={() => setTimeout(() => setShowBrandDropdown(false), 200)}
                className="form-input"
              />
              {showBrandDropdown && brandSuggestions.length > 0 && (
                <div className="glass-card" style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  maxHeight: 200,
                  overflowY: 'auto',
                  zIndex: 10,
                  marginTop: 4,
                }}>
                  {brandSuggestions
                    .filter(b => b.brand?.toLowerCase().includes(filters.brand.toLowerCase()))
                    .slice(0, 10)
                    .map((b, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          handleFilterChange('brand', b.brand);
                          setShowBrandDropdown(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderBottom: i < 9 ? '1px solid var(--td-border-light)' : 'none',
                        }}
                        className="hover-bg"
                      >
                        <FaTag size={11} style={{ marginRight: 6, color: 'var(--td-text-tertiary)' }} />
                        {b.brand}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Color Filter with Suggestions */}
          <div className="filter-group">
            <h4>Color</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {colorSuggestions.length > 0 ? (
                colorSuggestions.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => handleFilterChange('color', c.color)}
                    className={`btn btn-sm ${filters.color === c.color ? 'btn-primary' : 'btn-outline'}`}
                    style={{ borderRadius: 'var(--td-radius-full)', padding: '4px 10px' }}
                  >
                    {c.color}
                  </button>
                ))
              ) : (
                <input
                  type="text"
                  placeholder="Enter color..."
                  value={filters.color || ''}
                  onChange={(e) => handleFilterChange('color', e.target.value)}
                  className="form-input"
                  style={{ flex: 1, minWidth: 120 }}
                />
              )}
            </div>
          </div>

          {/* Size Filter with Dynamic Suggestions */}
          <div className="filter-group">
            <h4>Size</h4>
            <div className="size-options">
              {sizeSuggestions.length > 0 ? (
                sizeSuggestions.map(size => (
                  <button key={size} className={`size-btn ${filters.size === size ? 'active' : ''}`}
                    onClick={() => handleFilterChange('size', filters.size === size ? '' : size)}>
                    {size}
                  </button>
                ))
              ) : (
                sizes.map(size => (
                  <button key={size} className={`size-btn ${filters.size === size ? 'active' : ''}`}
                    onClick={() => handleFilterChange('size', filters.size === size ? '' : size)}>
                    {size}
                  </button>
                ))
              )}
            </div>
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
            <h4>Price Range</h4>
            <div className="price-range">
              <input type="number" placeholder="Min" value={filters.minPrice}
                onChange={(e) => handleFilterChange('minPrice', e.target.value)} className="form-input" style={{ flex: 1 }} />
              <span style={{ color: 'var(--td-text-tertiary)' }}>—</span>
              <input type="number" placeholder="Max" value={filters.maxPrice}
                onChange={(e) => handleFilterChange('maxPrice', e.target.value)} className="form-input" style={{ flex: 1 }} />
            </div>
          </div>

          {/* Save Search Button */}
          <div className="filter-group">
            <button onClick={handleSaveSearch} className="btn btn-primary btn-block" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <FaSave size={14} /> Save This Search
            </button>
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
