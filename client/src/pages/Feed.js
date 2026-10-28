import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import api from '../services/api';
import ListingCard from '../components/ListingCard';
import Pagination from '../components/Pagination';
import { FaFilter, FaPen } from 'react-icons/fa';

const Feed = () => {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [sort, setSort] = useState('popular');

  // Sequence guard: rapid sort/page changes fire overlapping requests; a slow
  // stale response must not overwrite fresher data.
  const fetchSeqRef = useRef(0);
  const fetchFeed = useCallback(async (pageNum = 1) => {
    const seq = ++fetchSeqRef.current;
    const isCurrent = () => seq === fetchSeqRef.current;
    setLoading(true);
    try {
      const url = user
        ? `/users/feed?page=${pageNum}&limit=20&sort=${sort}`
        : `/listings?page=${pageNum}&limit=20&sort=${sort}`;
      const res = await api.get(url);
      if (!isCurrent()) return; // superseded by a newer request
      const listingsData = res.data.listings || res.data.docs || [];
      setListings(listingsData);
      setPagination({
        total: res.data.total || 0,
        totalPages: res.data.totalPages || 1,
        currentPage: res.data.currentPage || pageNum,
      });
    } catch (error) {
      if (user && error?.response?.status === 401) {
        try {
          const res = await api.get(`/listings?page=${pageNum}&limit=20&sort=${sort}`);
          if (!isCurrent()) return;
          setListings(res.data.listings || []);
          setPagination({
            total: res.data.total || 0,
            totalPages: res.data.totalPages || 1,
            currentPage: res.data.currentPage || pageNum,
          });
        } catch (fallbackError) {
          if (isCurrent()) toast.error('Failed to load feed');
        }
      }
    }
    if (isCurrent()) setLoading(false);
  }, [user, sort]);

  useEffect(() => {
    fetchFeed(1);
  }, [fetchFeed]);

  const sortOptions = [
    { value: 'popular', label: 'Most Popular' },
    { value: 'newest', label: 'Newest' },
    { value: 'price_low', label: 'Price: Low → High' },
    { value: 'price_high', label: 'Price: High → Low' },
  ];

  return (
    <div className="page-container">
      <div className="flex-between" style={{ marginBottom: 'var(--td-space-lg)', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            {user ? 'Your Feed' : 'Trending Items'}
          </h1>
          {!user && (
            <p style={{ color: 'var(--td-text-tertiary)', marginTop: 4, fontSize: 14 }}>
              <Link to="/login" style={{ color: 'var(--td-primary)', fontWeight: 600 }}>Sign in</Link> to follow sellers and get a personalized feed
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FaFilter size={14} color="var(--td-text-tertiary)" />
          <select
            className="form-input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{ width: 'auto', minWidth: 180, padding: '8px 32px 8px 12px' }}
          >
            {sortOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && listings.length === 0 ? (
        <div className="listings-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton skeleton-card" style={{ animation: `fadeIn 0.3s ease-out ${i * 0.05}s` }}>
              <div className="skeleton skeleton-image" />
              <div style={{ padding: 'var(--td-space-md)' }}>
                <div className="skeleton skeleton-text-lg" />
                <div className="skeleton skeleton-text" style={{ width: '40%' }} />
                <div className="skeleton skeleton-text-sm" />
              </div>
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon"><FaPen aria-hidden="true" /></div>
          <h2>{user ? 'Your feed is empty' : 'No listings yet'}</h2>
          <p>{user ? 'Follow sellers to see their latest items here' : 'Be the first to list an item!'}</p>
          <Link to={user ? '/search' : '/register'} className="btn btn-primary btn-lg">
            {user ? 'Browse Listings' : 'Get Started'}
          </Link>
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
          {pagination && (
            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={fetchFeed}
            />
          )}
        </>
      )}
    </div>
  );
};

export default Feed;