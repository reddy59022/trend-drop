import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import ListingCard from '../components/ListingCard';
import Pagination from '../components/Pagination';
import { FaStore, FaFilter } from 'react-icons/fa';

const Closet = () => {
  const { id } = useParams();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => { fetchCloset(); }, [id, sort, page]); // eslint-disable-line

  const fetchCloset = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/users/${id}/closet?sort=${sort}&page=${page}&limit=20`);
      setListings(res.data.listings || []);
      setTotalPages(res.data.totalPages || 1);
      setTotal(res.data.total || res.data.listings?.length || 0);
    } catch (error) { console.error(error); }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="closet-header" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
        <h1 className="page-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FaStore /> Closet {total > 0 && <span style={{ fontSize: 16, color: 'var(--td-text-tertiary)', fontWeight: 400 }}>({total} items)</span>}
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FaFilter size={14} color="var(--td-text-tertiary)" />
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="form-input" style={{ width: 'auto', padding: '8px 32px 8px 12px' }}>
            <option value="newest">✨ Newest</option>
            <option value="price_low">💰 Low to High</option>
            <option value="price_high">💎 High to Low</option>
            <option value="popular">🔥 Popular</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="listings-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton skeleton-card">
              <div className="skeleton skeleton-image" />
              <div style={{ padding: 'var(--td-space-md)' }}><div className="skeleton skeleton-text-lg" /><div className="skeleton skeleton-text" style={{ width: '40%' }} /></div>
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">👕</div>
          <h2>No items in this closet yet</h2>
          <p>This closet is waiting to be filled with amazing finds.</p>
          <Link to="/sell" className="btn btn-primary">Start Selling</Link>
        </div>
      ) : (
        <>
          <div className="listings-grid">
            {listings.map((listing, i) => (
              <div key={listing._id} style={{ animation: `fadeInUp 0.3s ease-out ${i * 0.03}s both` }}>
                <ListingCard listing={listing} />
              </div>
            ))}
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={(p) => { setPage(p); window.scrollTo(0, 0); }} />
        </>
      )}
    </div>
  );
};

export default Closet;