import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ListingCard from '../components/ListingCard';
import Pagination from '../components/Pagination';
import { FaRss } from 'react-icons/fa';

const Feed = () => {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);

  const fetchFeed = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const url = user ? `/users/feed?page=${pageNum}&limit=20` : `/listings?page=${pageNum}&limit=20&sort=popular`;
      const res = await api.get(url);
      setListings(res.data.listings || res.data.docs || []);
      setPagination(res.data.pagination || {
        total: res.data.total,
        totalPages: res.data.totalPages,
        currentPage: res.data.currentPage || pageNum,
        hasNextPage: pageNum < (res.data.totalPages || 1),
        hasPrevPage: pageNum > 1,
      });
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchFeed(1);
  }, [fetchFeed]);

  if (loading && listings.length === 0) {
    return <div className="page-container"><div className="spinner"></div></div>;
  }

  return (
    <div className="page-container">
      <h1 className="page-title">{user ? 'Your Feed' : 'Trending Items'}</h1>
      {!user && (
        <p style={{ textAlign: 'center', color: '#888', marginBottom: 20 }}>
          <Link to="/login" style={{ color: '#FF4D6D' }}>Sign in</Link> to follow sellers and get a personalized feed
        </p>
      )}
      {listings.length === 0 ? (
        <div className="empty-state">
          <FaRss size={48} />
          <h2>{user ? 'Your feed is empty' : 'No listings yet'}</h2>
          <p>{user ? 'Follow sellers to see their latest items here' : 'Be the first to list an item!'}</p>
          <Link to={user ? '/search' : '/register'} className="btn btn-primary">
            {user ? 'Browse Listings' : 'Get Started'}
          </Link>
        </div>
      ) : (
        <>
          <div className="listings-grid">
            {listings.map((listing) => (
              <ListingCard key={listing._id} listing={listing} />
            ))}
          </div>
          <Pagination pagination={pagination} onPageChange={fetchFeed} />
        </>
      )}
    </div>
  );
};

export default Feed;