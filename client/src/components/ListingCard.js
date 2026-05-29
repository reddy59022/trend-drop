import { defaultAvatar } from "../utils/helpers";
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaHeart } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

const ListingCard = ({ listing }) => {
  const { user } = useAuth();
  const [liked, setLiked] = useState(
    listing.likes?.includes(user?.id || user?._id) || false
  );
  const [likeCount, setLikeCount] = useState(listing.likes?.length || 0);

  const handleLike = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error('Please login to like items');
      return;
    }
    try {
      const res = await api.post(`/listings/${listing._id}/like`);
      setLiked(res.data.liked);
      setLikeCount(res.data.likes.length);
    } catch (error) {
      toast.error('Failed to like listing');
    }
  };

  const discount = listing.originalPrice
    ? Math.round((1 - listing.price / listing.originalPrice) * 100)
    : 0;

  return (
    <Link to={`/listing/${listing._id}`} className="listing-card">
      <div className="listing-card-image">
        <img
          src={listing.images?.[0] || defaultAvatar}
          alt={listing.title}
        />
        {discount > 0 && (
          <span className="discount-badge">{discount}% OFF</span>
        )}
        {listing.sold && <span className="sold-badge">SOLD</span>}
        <button
          className={`like-btn ${liked ? 'liked' : ''}`}
          onClick={handleLike}
        >
          <FaHeart />
        </button>
      </div>
      <div className="listing-card-info">
        <h3 className="listing-card-title">{listing.title}</h3>
        <div className="listing-card-price">
          <span className="current-price">${listing.price}</span>
          {listing.originalPrice && (
            <span className="original-price">${listing.originalPrice}</span>
          )}
        </div>
        <div className="listing-card-meta">
          <span className="listing-condition">{listing.condition}</span>
          {listing.brand && <span className="listing-brand">{listing.brand}</span>}
        </div>
        <div className="listing-card-seller">
          <img
            src={listing.seller?.avatar || defaultAvatar}
            alt=""
            className="seller-avatar-small"
          />
          <span>{listing.seller?.name}</span>
        </div>
        <div className="listing-card-likes">
          <FaHeart /> {likeCount}
        </div>
      </div>
    </Link>
  );
};

export default ListingCard;