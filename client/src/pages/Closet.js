import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import ListingCard from '../components/ListingCard';

const Closet = () => {
  const { id } = useParams();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchCloset();
    // eslint-disable-next-line
  }, [id, sort, page]);

  const fetchCloset = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/users/${id}/closet?sort=${sort}&page=${page}&limit=20`);
      setListings(res.data.listings);
      setTotalPages(res.data.totalPages);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="closet-header">
        <h1>Closet</h1>
        <div className="sort-controls">
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="form-input">
            <option value="newest">Newest</option>
            <option value="price_low">Price: Low to High</option>
            <option value="price_high">Price: High to Low</option>
            <option value="popular">Most Popular</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="spinner"></div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <p>No items in this closet yet</p>
          <Link to="/sell" className="btn btn-primary">Start Selling</Link>
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
  );
};

export default Closet;