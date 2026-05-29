import { defaultAvatar } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaHeart, FaShareAlt, FaArrowLeft } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import ImageCarousel from '../components/ImageCarousel';
import CommentSection from '../components/CommentSection';
import OfferModal from '../components/OfferModal';
import ListingCard from '../components/ListingCard';

const ListingDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    fetchListing();
    // eslint-disable-next-line
  }, [id]);

  const fetchListing = async () => {
    try {
      const res = await api.get(`/listings/${id}`);
      setListing(res.data.listing);
      setSimilar(res.data.similar || []);
      setComments(res.data.listing.comments || []);
      setLikeCount(res.data.listing.likes?.length || 0);
      if (user) {
        setLiked(res.data.listing.likes?.includes(user.id || user._id) || false);
        setIsFollowing(
          res.data.listing.seller?.followers?.some(
            (f) => (f._id || f) === (user.id || user._id)
          ) || false
        );
      }
    } catch (error) {
      toast.error('Listing not found');
      navigate('/');
    }
    setLoading(false);
  };

  const handleLike = async () => {
    if (!user) return toast.error('Please login');
    try {
      const res = await api.post(`/listings/${id}/like`);
      setLiked(res.data.liked);
      setLikeCount(res.data.likes.length);
    } catch (error) {
      toast.error('Failed to like');
    }
  };

  const handleFollow = async () => {
    if (!user) return toast.error('Please login');
    try {
      const res = await api.post(`/users/${listing.seller._id}/follow`);
      setIsFollowing(res.data.following);
    } catch (error) {
      toast.error('Failed to follow');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      navigator.share({ title: listing.title, url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    }
  };

  const handleBuyNow = async () => {
    if (!user) return toast.error('Please login');
    if (!window.confirm(`Purchase "${listing.title}" for $${listing.price}?`)) return;

    setBuying(true);
    try {
      await api.post('/transactions', { listingId: listing._id });
      toast.success('Purchase successful!');
      fetchListing();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Purchase failed');
    }
    setBuying(false);
  };

  const handleMarkSold = async () => {
    if (!window.confirm('Mark this item as sold?')) return;
    try {
      await api.patch(`/listings/${id}/sold`);
      toast.success('Item marked as sold');
      fetchListing();
    } catch (error) {
      toast.error('Failed to mark as sold');
    }
  };

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;
  if (!listing) return null;

  const isOwner = user && (user.id || user._id) === listing.seller?._id;
  const discount = listing.originalPrice
    ? Math.round((1 - listing.price / listing.originalPrice) * 100)
    : 0;

  return (
    <div className="page-container">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <FaArrowLeft /> Back
      </button>

      <div className="listing-detail">
        <div className="listing-detail-left">
          <ImageCarousel images={listing.images} />
        </div>

        <div className="listing-detail-right">
          <div className="listing-detail-header">
            <h1>{listing.title}</h1>
            <div className="listing-detail-price">
              <span className="current-price">${listing.price}</span>
              {listing.originalPrice && (
                <>
                  <span className="original-price">${listing.originalPrice}</span>
                  {discount > 0 && <span className="discount-badge">{discount}% OFF</span>}
                </>
              )}
            </div>
          </div>

          <div className="listing-detail-meta">
            {listing.brand && <p><strong>Brand:</strong> {listing.brand}</p>}
            {listing.size && <p><strong>Size:</strong> {listing.size}</p>}
            {listing.color && <p><strong>Color:</strong> {listing.color}</p>}
            <p><strong>Condition:</strong> {listing.condition}</p>
            <p><strong>Category:</strong> {listing.category}</p>
          </div>

          <div className="listing-detail-description">
            <h3>Description</h3>
            <p>{listing.description}</p>
          </div>

          <div className="listing-detail-actions">
            <div className="listing-detail-action-row">
              <button className={`btn ${liked ? 'btn-primary' : 'btn-outline'}`} onClick={handleLike}>
                <FaHeart /> {liked ? 'Liked' : 'Like'} ({likeCount})
              </button>
              <button className="btn btn-outline" onClick={handleShare}>
                <FaShareAlt /> Share ({listing.shares?.length || 0})
              </button>
            </div>
            {!isOwner && !listing.sold && user && (
              <div className="listing-detail-action-row">
                <button className="btn btn-outline" onClick={() => setOfferModalOpen(true)}>
                  Make Offer
                </button>
                <button className="btn btn-primary" onClick={handleBuyNow} disabled={buying}>
                  {buying ? 'Buying...' : `Buy Now - $${listing.price}`}
                </button>
              </div>
            )}
            {listing.sold && (
              <div className="sold-banner">This item has been sold</div>
            )}
            {isOwner && (
              <div className="listing-detail-action-row">
                {!listing.sold && (
                  <button className="btn btn-primary" onClick={handleMarkSold}>
                    Mark as Sold
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Seller Info */}
          <div className="seller-card">
            <Link to={`/profile/${listing.seller?._id}`} className="seller-info">
              <img
                src={listing.seller?.avatar || defaultAvatar}
                alt=""
                className="seller-avatar"
              />
              <div>
                <h4>{listing.seller?.name}</h4>
                <p>{listing.seller?.followers?.length || 0} followers</p>
              </div>
            </Link>
            {!isOwner && user && (
              <button
                className={`btn btn-sm ${isFollowing ? 'btn-outline' : 'btn-primary'}`}
                onClick={handleFollow}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          {/* Comments */}
          <CommentSection
            listingId={listing._id}
            comments={comments}
            onCommentsUpdate={setComments}
          />
        </div>
      </div>

      {/* Similar Listings */}
      {similar.length > 0 && (
        <div className="section">
          <h2 className="section-title">Similar Items</h2>
          <div className="listings-grid">
            {similar.map((item) => (
              <ListingCard key={item._id} listing={item} />
            ))}
          </div>
        </div>
      )}

      <OfferModal
        listing={listing}
        isOpen={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        onOfferSubmitted={fetchListing}
      />
    </div>
  );
};

export default ListingDetail;