import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ListingCard from '../components/ListingCard';
import { FaRss } from 'react-icons/fa';

const Feed = () => {
  const { user } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    fetchFeed();
    // eslint-disable-next-line
  }, [user]);

  const fetchFeed = async (pageNum = 1) => {
    try {
      const res = await api.get(`/users/feed?page=${pageNum}&limit=20`);
      if (pageNum === 1) {
        setListings(res.data.listings);
      } else {
        setListings((prev) => [...prev, ...res.data.listings]);
      }
      setHasMore(pageNum < res.data.totalPages);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFeed(nextPage);
  };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <FaRss size={48} />
          <h2>Feed</h2>
          <p>Sign in to see items from people you follow</p>
          <Link to="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="page-container"><div className="spinner"></div></div>;
  }

  return (
    <div className="page-container">
      <h1 className="page-title">Your Feed</h1>
      {listings.length === 0 ? (
        <div className="empty-state">
          <FaRss size={48} />
          <h2>Your feed is empty</h2>
          <p>Follow sellers to see their latest items here</p>
          <Link to="/search" className="btn btn-primary">Browse Listings</Link>
        </div>
      ) : (
        <>
          <div className="listings-grid">
            {listings.map((listing) => (
              <ListingCard key={listing._id} listing={listing} />
            ))}
          </div>
          {hasMore && (
            <div className="load-more">
              <button className="btn btn-outline" onClick={loadMore}>
                Load More
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Feed;