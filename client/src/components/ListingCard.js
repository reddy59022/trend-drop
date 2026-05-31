import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaHeart, FaShoppingBag, FaCheckCircle, FaBolt } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { toast } from 'react-toastify';
import { defaultAvatar, getConditionColor } from '../utils/helpers';

const ListingCard = ({ listing }) => {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [liked, setLiked] = useState(
    listing.likes?.includes(user?.id || user?._id) || false
  );
  const [likeCount, setLikeCount] = useState(listing.likes?.length || 0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);

  const discount = listing.originalPrice
    ? Math.round((1 - listing.price / listing.originalPrice) * 100)
    : 0;

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

  const handleAddToCart = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error('Please login to add items to cart');
      return;
    }
    if (listing.available_quantity <= 0) {
      toast.error('This item is sold out');
      return;
    }
    setAddingToCart(true);
    try {
      addToCart({
        listingId: listing._id,
        title: listing.title,
        price: listing.price,
        currency: listing.currency || 'USD',
        quantity: 1,
        thumbnail: listing.images?.[0] || '',
        available: listing.available_quantity,
      });
      toast.success('Added to cart!');
    } catch (error) {
      toast.error('Failed to add to cart');
    } finally {
      setAddingToCart(false);
    }
  };

  const conditionColor = getConditionColor(listing.condition);

  return (
    <Link to={`/listing/${listing._id}`} className="listing-card">
      <div className="listing-card-image">
        {!imageLoaded && <div className="skeleton skeleton-image" />}
        <img
          src={listing.images?.[0] || defaultAvatar}
          alt={listing.title}
          onLoad={() => setImageLoaded(true)}
          style={{ opacity: imageLoaded ? 1 : 0 }}
        />
        
        {/* Badges */}
        {listing.boosted && (
          <span className="boost-badge">
            <FaBolt size={10} /> BOOSTED
          </span>
        )}
        {discount > 0 && (
          <span className="discount-badge">-{discount}%</span>
        )}
        {listing.sold && <span className="sold-badge">SOLD</span>}

        {/* Quick add to cart */}
        {!listing.sold && listing.available_quantity > 0 && (
          <button
            className="quick-cart-btn"
            onClick={handleAddToCart}
            disabled={addingToCart}
            title="Quick add to cart"
          >
            <FaShoppingBag />
          </button>
        )}

        {/* Like button */}
        <button
          className={`like-btn ${liked ? 'liked' : ''}`}
          onClick={handleLike}
          title={liked ? 'Unlike' : 'Like'}
        >
          <FaHeart />
        </button>
      </div>

      <div className="listing-card-info">
        <h3 className="listing-card-title">{listing.title}</h3>
        
        <div className="listing-card-price">
          <span className="current-price">
            ${listing.price.toFixed(2)}
          </span>
          {listing.originalPrice && (
            <span className="original-price">${listing.originalPrice.toFixed(2)}</span>
          )}
        </div>

        <div className="listing-card-meta">
          <span 
            className="listing-condition"
            style={{ 
              background: `${conditionColor}15`,
              color: conditionColor,
            }}
          >
            {listing.condition}
          </span>
          {listing.brand && <span className="listing-brand">{listing.brand}</span>}
          {listing.size && <span className="listing-brand">{listing.size}</span>}
        </div>

        <div className="listing-card-seller">
          <img
            src={listing.seller?.avatar || defaultAvatar}
            alt=""
            className="seller-avatar-small"
          />
          <span>{listing.seller?.name}</span>
          {listing.seller?.verified && (
            <FaCheckCircle 
              size={14} 
              style={{ color: 'var(--td-primary)', marginLeft: 2 }} 
              title="Verified seller"
            />
          )}
        </div>

        {likeCount > 0 && (
          <div className="listing-card-likes">
            <FaHeart /> {likeCount}
          </div>
        )}
      </div>
    </Link>
  );
};

export default ListingCard;