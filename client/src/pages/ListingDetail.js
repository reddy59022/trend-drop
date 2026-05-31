import { defaultAvatar, formatPrice, getConditionColor } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaHeart, FaShareAlt, FaArrowLeft, FaTruck, FaShieldAlt } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import ImageCarousel from '../components/ImageCarousel';
import CommentSection from '../components/CommentSection';
import OfferModal from '../components/OfferModal';
import ListingCard from '../components/ListingCard';
import { useCart } from '../context/CartContext';

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
  const [buyerOffer, setBuyerOffer] = useState(null);
  const { addToCart } = useCart();

  useEffect(() => {
    fetchListing();
    if (user) fetchBuyerOffer();
    // eslint-disable-next-line
  }, [id, user]);

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

  // Add to Cart — uses negotiated price if buyer has an accepted offer
  const handleAddToBag = async () => {
    if (!user) return toast.error('Please login');

    if (!listing.quantity || listing.quantity <= 0) {
      toast.error('Item is out of stock');
      return;
    }
    if (listing.available === false) {
      toast.error('Item is no longer available');
      return;
    }

    // Re-fetch offer to get latest state
    let latestOffer = buyerOffer;
    if (!latestOffer) {
      try {
        const offerRes = await api.get('/offers/sent');
        latestOffer = offerRes.data.find((o) => o.listing && o.listing._id === id) || null;
        if (latestOffer) setBuyerOffer(latestOffer);
      } catch (e) {
        // ignore
      }
    }

    try {
      const res = await api.get(`/listings/${id}`);
      const currentListing = res.data.listing;
      if (!currentListing.available || currentListing.sold || currentListing.quantity <= 0) {
        toast.error('This item is no longer available');
        return;
      }

      // Calculate the correct price: negotiated price OR listing price
      let finalPrice = listing.price;
      let negotiatedFlag = null;
      if (latestOffer && latestOffer.status !== 'completed' && latestOffer.status !== 'declined' && (latestOffer.status === 'accepted' || latestOffer.status === 'countered' || latestOffer.status === 'buyer_countered')) {
        finalPrice = latestOffer.counterAmount || latestOffer.amount;
        negotiatedFlag = finalPrice;
      }

      const item = {
        listingId: listing._id,
        title: listing.title,
        price: finalPrice,
        currency: listing.currency || 'USD',
        quantity: 1,
        thumbnail: listing.images?.[0] || '',
        available: currentListing.quantity,
        negotiatedPrice: negotiatedFlag,
        offerId: latestOffer ? latestOffer._id : null,
        sellerCountry: listing.shipsFrom || currentListing.shipsFrom || 'US',
        weight: listing.weight || currentListing.weight || 0.5,
      };
      addToCart(item);
      toast.success(`Added to cart at ${formatPrice(finalPrice, listing.currency || 'USD')}!`);
      navigate('/cart');
    } catch (error) {
      toast.error('Failed to verify item availability');
    }
  };

  // Fetch buyer's own offer (if any) for this listing
  const fetchBuyerOffer = async () => {
    if (!user) return;
    try {
      const res = await api.get('/offers/sent');
      const myOffer = res.data.find((o) => o.listing && o.listing._id === id);
      setBuyerOffer(myOffer || null);
    } catch (e) {
      console.error(e);
    }
  };

  // Get the final negotiated price for this offer
  const getOfferPrice = () => {
    if (!buyerOffer) return listing.price;
    return buyerOffer.counterAmount || buyerOffer.amount;
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
              <span className="current-price">{formatPrice(listing.price, listing.currency || 'USD')}</span>
              {listing.originalPrice && (
                <>
                  <span className="original-price">{formatPrice(listing.originalPrice, listing.currency || 'USD')}</span>
                  {discount > 0 && <span className="discount-badge">{discount}% OFF</span>}
                </>
              )}
            </div>
          </div>

          <div className="listing-detail-meta">
            {listing.brand && <p><strong>Brand:</strong> {listing.brand}</p>}
            {listing.size && <p><strong>Size:</strong> {listing.size}</p>}
            {listing.color && <p><strong>Color:</strong> {listing.color}</p>}
            <p><strong>Condition:</strong> <span style={{ color: getConditionColor(listing.condition) }}>{listing.condition}</span></p>
            <p><strong>Category:</strong> {listing.category}</p>
            {listing.shipsFrom && <p><strong>Ships from:</strong> {listing.shipsFrom}</p>}
          </div>

          {/* Shipping Info */}
          <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 12, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}><FaTruck /> Shipping</h4>
            {listing.shipping?.freeShipping ? (
              <p style={{ color: '#10b981', fontWeight: 600, margin: 0 }}>Free Domestic Shipping</p>
            ) : (
              <p style={{ margin: 0, fontSize: 14 }}>
                Shipping cost paid by buyer: ~{formatPrice(listing.shipping?.shippingCost || 3.99, listing.currency || 'USD')}
              </p>
            )}
            {listing.shipping?.estimatedDays && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
                Estimated delivery: {listing.shipping.estimatedDays} business days
              </p>
            )}
          </div>

          {/* Payment Breakdown Preview for buyers — uses negotiated price if buyer has accepted offer */}
          {!isOwner && !listing.sold && user && (() => {
            const displayPrice = getOfferPrice();
            const shippingFee = listing.shipping?.freeShipping ? 0 : (listing.shipping?.shippingCost || 3.99);
            const protectionFee = displayPrice * 0.05;
            const totalCost = displayPrice + shippingFee + protectionFee;
            return (
              <div style={{ background: '#f8f9fa', padding: 16, borderRadius: 12, marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FaShieldAlt /> Buyer Protection
                  {buyerOffer && (buyerOffer.status === 'accepted' || buyerOffer.status === 'countered' || buyerOffer.status === 'buyer_countered') && (
                    <span style={{ fontSize: 12, color: '#10b981', fontWeight: 500 }}>(Negotiated Price)</span>
                  )}
                </h4>
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Item Price</span><span>{formatPrice(displayPrice, listing.currency || 'USD')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Shipping</span><span>{formatPrice(shippingFee, listing.currency || 'USD')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Buyer Protection (5%)</span><span>{formatPrice(protectionFee, listing.currency || 'USD')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #ddd', paddingTop: 4, marginTop: 2 }}>
                    <span>Total</span><span>{formatPrice(totalCost, listing.currency || 'USD')}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Seller earnings preview */}
          {isOwner && (
            <div style={{ background: '#f0fdf4', padding: 16, borderRadius: 12, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: '#10b981' }}>Your Earnings</h4>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Listing Price</span><span>{formatPrice(listing.price, listing.currency || 'USD')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444' }}>
                  <span>Platform Fee (10%)</span><span>-{formatPrice(listing.price * 0.1, listing.currency || 'USD')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #c8e6c9', paddingTop: 4, marginTop: 2, color: '#10b981' }}>
                  <span>You'll Receive</span><span>{formatPrice(listing.price * 0.9, listing.currency || 'USD')}</span>
                </div>
              </div>
            </div>
          )}

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
            {/* Buyer actions based on offer state */}
            {!isOwner && !listing.sold && user && (
              <div className="listing-detail-action-row">
            {buyerOffer && (buyerOffer.status === 'countered' || buyerOffer.status === 'accepted' || buyerOffer.status === 'buyer_countered') ? (
              <>
                {/* 
                  Status: countered → seller offered a price → buyer accepts or counters
                  Status: buyer_countered → seller accepted buyer's counter → buyer can proceed
                  Status: accepted → either side accepted → ready to purchase at negotiated price
                */}
                {buyerOffer.status === 'countered' && (
                  <button className="btn btn-outline" onClick={async () => {
                    const amount = prompt('Enter your counter amount (must be higher than ' + getOfferPrice() + '):');
                    if (!amount || isNaN(amount)) return;
                    try {
                      await api.patch(`/offers/${buyerOffer._id}/buyer-counter`, { counterAmount: Number(amount) });
                      toast.success('Counter sent');
                      fetchBuyerOffer();
                    } catch (e) {
                      toast.error('Failed to send counter');
                    }
                  }}>Counter Offer</button>
                )}
                                <button className="btn btn-primary" onClick={async () => {
                    try {
                      // Accept the counter if in 'countered' state
                      if (buyerOffer.status === 'countered') {
                        await api.patch(`/offers/${buyerOffer._id}/accept-counter`);
                        // Re-fetch to get updated status
                        fetchBuyerOffer();
                      }
                      // Add to cart at negotiated price then navigate to cart
                      handleAddToBag();
                    } catch (e) {
                      toast.error('Failed to accept offer');
                    }
                  }}>
                    Add to Bag at {formatPrice(getOfferPrice(), listing.currency || 'USD')}
                  </button>
                )}
              </>
            ) : (
                  <>
                    <button className="btn btn-outline" onClick={() => setOfferModalOpen(true)}>
                      Make Offer
                    </button>
                    <button className="btn btn-primary" onClick={handleAddToBag}>
                      Add to Bag
                    </button>
                  </>
                )}
              </div>
            )}
            {listing.sold && (
              <div className="sold-banner">This item has been sold</div>
            )}
            {isOwner && (
              <div className="listing-detail-action-row">
                {/* No manual sold button – status handled automatically */}
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