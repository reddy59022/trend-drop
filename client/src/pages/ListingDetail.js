import { defaultAvatar, formatPrice, getConditionColor } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaHeart, FaShareAlt, FaArrowLeft, FaShieldAlt, FaCheckCircle, FaChartLine, FaShippingFast, FaStore, FaRulerCombined, FaPalette, FaTag, FaEdit } from 'react-icons/fa';
import api, { checkInWishlist, addToWishlist, removeFromWishlist } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import MediaCarousel from '../components/MediaCarousel';
import CommentSection from '../components/CommentSection';
import OfferModal from '../components/OfferModal';
import ListingCard from '../components/ListingCard';
import { useCart } from '../context/CartContext';

const ListingDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const [listing, setListing] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [buyerOffer, setBuyerOffer] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [activePriceIndex, setActivePriceIndex] = useState(-1);
  const [selectedCountry, setSelectedCountry] = useState('US');
  const [shippingEstimate, setShippingEstimate] = useState(null);
  const [showMobileSticky, setShowMobileSticky] = useState(false);

  useEffect(() => {
    fetchListing();
    if (user) fetchBuyerOffer();
    // eslint-disable-next-line
  }, [id, user]);

  // Track scroll for mobile sticky bar
  useEffect(() => {
    const handleScroll = () => {
      setShowMobileSticky(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const fetchListing = async () => {
    try {
      const res = await api.get(`/listings/${id}`);
      setListing(res.data.listing);
      setSimilar(res.data.similar || []);
      setComments(res.data.listing.comments || []);
      setLikeCount(res.data.listing.likes?.length || 0);
      // Fetch price history
      try {
        const phRes = await api.get(`/pricehistory/${id}`);
        setPriceHistory(phRes.data.history || []);
      } catch (e) {
        // Price history may not be available
      }
      if (user) {
        // Check wishlist first, fallback to likes array
        try {
          const wishlistRes = await checkInWishlist(id);
          setLiked(wishlistRes.data.inWishlist);
        } catch (e) {
          setLiked(res.data.listing.likes?.includes(user.id || user._id) || false);
        }
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
      if (liked) {
        // Remove from wishlist
        await removeFromWishlist(id);
        setLiked(false);
        toast.info('Removed from wishlist');
      } else {
        // Add to wishlist
        await addToWishlist(id);
        setLiked(true);
        toast.success('Added to wishlist!');
      }
      // Also toggle the like on the listing for social features
      const res = await api.post(`/listings/${id}/like`);
      setLikeCount(res.data.likes.length);
    } catch (error) {
      console.error('Wishlist error:', error);
      toast.error('Failed to update wishlist');
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

  const handleAddToBag = async () => {
    if (!user) return toast.error('Please login');
    if (!listing.quantity || listing.quantity <= 0) {
      toast.error('Item is out of stock');
      return;
    }

    let latestOffer = buyerOffer;
    if (!latestOffer) {
      try {
        const offerRes = await api.get('/offers/sent');
        latestOffer = offerRes.data.find((o) => o.listing && o.listing._id === id) || null;
        if (latestOffer) setBuyerOffer(latestOffer);
      } catch (e) {}
    }

    try {
      const res = await api.get(`/listings/${id}`);
      const currentListing = res.data.listing;
      if (!currentListing.available || currentListing.sold || currentListing.quantity <= 0) {
        toast.error('This item is no longer available');
        return;
      }

      // Only use the negotiated price when the offer is ACCEPTED (buyer accepted seller's counter)
      // For pending/countered/buyer_countered, use the listing price
      let finalPrice = listing.price;
      let negotiatedFlag = null;
      if (latestOffer && latestOffer.status === 'accepted') {
        finalPrice = latestOffer.counterAmount || latestOffer.amount;
        negotiatedFlag = finalPrice;
      } else if (latestOffer && latestOffer.status === 'completed') {
        // Use listing price for completed offers (item already purchased)
        finalPrice = listing.price;
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
        sellerId: listing.seller?._id || listing.seller,
        sellerName: listing.seller?.name || 'Seller',
      };
      addToCart(item);
      toast.success(`Added to cart at ${formatPrice(finalPrice, listing.currency || 'USD')}!`);
      navigate('/cart');
    } catch (error) {
      toast.error('Failed to verify item availability');
    }
  };

  const fetchBuyerOffer = async () => {
    if (!user) return;
    try {
      const res = await api.get('/offers/sent');
      const myOffer = res.data.find((o) => o.listing && o.listing._id === id);
      setBuyerOffer(myOffer || null);
    } catch (e) {}
  };

  const getOfferPrice = () => {
    if (!buyerOffer) return listing.price;
    // Only use negotiated price when buyer has ACCEPTED the seller's counter
    // For pending/countered/buyer_countered/declined/completed/expired, use listing price
    if (buyerOffer.status === 'accepted') {
      return buyerOffer.counterAmount || buyerOffer.amount;
    }
    return listing.price;
  };

  const handleShippingEstimate = async () => {
    try {
      const res = await api.post('/shipping/calculate', {
        from: listing.shipsFrom || 'US',
        to: selectedCountry,
        weight: listing.weight || 0.5,
        dimensions: listing.dimensions || { length: 10, width: 10, height: 5 },
      });
      setShippingEstimate(res.data);
    } catch (e) {
      toast.error('Could not calculate shipping');
    }
  };

  if (loading) return (
    <div className="page-container">
      <div style={{ display: 'flex', gap: 40, maxWidth: 1200, margin: '0 auto' }}>
        <div className="skeleton skeleton-image" style={{ flex: 1, aspectRatio: 1 }} />
        <div style={{ flex: 1 }}>
          <div className="skeleton skeleton-text-lg" />
          <div className="skeleton skeleton-text" style={{ width: '40%' }} />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" />
        </div>
      </div>
    </div>
  );

  if (!listing) return null;

  const isOwner = user && (user.id || user._id) === listing.seller?._id;
  const discount = listing.originalPrice
    ? Math.round((1 - listing.price / listing.originalPrice) * 100)
    : 0;
  const displayPrice = getOfferPrice();
  const shippingFee = listing.shipping?.freeShipping ? 0 : (listing.shipping?.shippingCost || 5.99);
  const protectionFee = displayPrice * 0.05;
  const totalCost = displayPrice + shippingFee + protectionFee;

  return (
    <> 
    <div className="page-container">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <FaArrowLeft /> Back to Browse
      </button>

      <div className="listing-detail">
        {/* Left - Image */}
        <div className="listing-detail-left">
          <MediaCarousel images={listing.images} videoUrl={listing.videoUrl} />
          
          {/* Price History Chart */}
          {priceHistory.length > 0 && (
            <div className="price-history-chart">
              <h3><FaChartLine /> Price History</h3>
              <div className="chart-bars">
                {priceHistory.map((entry, i) => {
                  const maxPrice = Math.max(...priceHistory.map(p => p.price));
                  const heightPercent = (entry.price / maxPrice) * 100;
                  return (
                    <div
                      key={i}
                      className={`chart-bar ${activePriceIndex === i ? 'active' : ''}`}
                      style={{ height: `${Math.max(heightPercent, 5)}%` }}
                      onMouseEnter={() => setActivePriceIndex(i)}
                      onMouseLeave={() => setActivePriceIndex(-1)}
                    >
                      <div className="chart-tooltip">
                        {formatPrice(entry.price, listing.currency)}<br />
                        {new Date(entry.date).toLocaleDateString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right - Details */}
        <div className="listing-detail-right">
          {/* Header */}
          <div className="listing-detail-header">
            {listing.boost && listing.boost.active && (
              <span className="boost-badge" style={{ position: 'relative', top: 0, left: 0, display: 'inline-flex', marginBottom: 8 }}>
                ★ BOOSTED
              </span>
            )}
            <h1>{listing.title}</h1>
            <div className="listing-detail-price">
              <span className="current-price">{formatPrice(listing.price, listing.currency || 'USD')}</span>
              {listing.originalPrice && (
                <>
                  <span className="original-price">{formatPrice(listing.originalPrice, listing.currency || 'USD')}</span>
                  <span className="discount-badge" style={{ position: 'relative', top: 0, left: 0 }}>-{discount}%</span>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <div className="listing-card-likes" style={{ marginTop: 0 }}>
                <FaHeart /> {likeCount} likes
              </div>
            </div>
          </div>

          {/* Meta Grid */}
          <div className="listing-detail-meta">
            {listing.brand && (
              <p><FaTag style={{ marginRight: 4, opacity: 0.5 }} /> <strong>Brand:</strong> {listing.brand}</p>
            )}
            {listing.size && (
              <p><FaRulerCombined style={{ marginRight: 4, opacity: 0.5 }} /> <strong>Size:</strong> {listing.size}</p>
            )}
            {listing.color && (
              <p><FaPalette style={{ marginRight: 4, opacity: 0.5 }} /> <strong>Color:</strong> {listing.color}</p>
            )}
            <p>
              <strong>Condition:</strong>{' '}
              <span 
                className="badge"
                style={{ 
                  background: `${getConditionColor(listing.condition)}15`,
                  color: getConditionColor(listing.condition),
                }}
              >
                {listing.condition}
              </span>
            </p>
            <p><strong>Category:</strong> {listing.category}</p>
            {listing.shipsFrom && <p><FaStore style={{ marginRight: 4, opacity: 0.5 }} /> <strong>Ships from:</strong> {listing.shipsFrom}</p>}
          </div>

          {/* Shipping Calculator */}
          <div className="shipping-calculator">
            <h3><FaShippingFast /> Calculate Shipping</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">From</label>
                <input 
                  className="form-input" 
                  value={listing.shipsFrom || 'US'} 
                  disabled 
                />
              </div>
              <div className="form-group">
                <label className="form-label">To</label>
                <select 
                  className="form-input" 
                  value={selectedCountry}
                  onChange={(e) => { setSelectedCountry(e.target.value); setShippingEstimate(null); }}
                >
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="AU">Australia</option>
                  <option value="JP">Japan</option>
                  <option value="IN">India</option>
                  <option value="BR">Brazil</option>
                  <option value="AE">UAE</option>
                  <option value="SG">Singapore</option>
                </select>
              </div>
            </div>
            <button className="btn btn-sm btn-outline" onClick={handleShippingEstimate}>
              Get Estimate
            </button>
            {shippingEstimate && (
              <div className="shipping-result">
                <span>Estimated Shipping</span>
                <span className="shipping-cost">{formatPrice(shippingEstimate.cost, listing.currency || 'USD')}</span>
              </div>
            )}
          </div>

          {/* Buyer Protection */}
          {!isOwner && !listing.sold && user && (
            <div className="glass-card" style={{ padding: 'var(--td-space-md)', margin: 'var(--td-space-md) 0' }}>
              <h4 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaShieldAlt color="var(--td-primary)" /> Purchase Summary
                {buyerOffer && (buyerOffer.status === 'accepted' || buyerOffer.status === 'countered' || buyerOffer.status === 'buyer_countered' || buyerOffer.status === 'pending') && (
                  <span className="badge badge-success">Negotiated Price</span>
                )}
              </h4>
              <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="flex-between">
                  <span style={{ color: 'var(--td-text-secondary)' }}>Item Price</span>
                  <span style={{ fontWeight: 600 }}>{formatPrice(displayPrice, listing.currency || 'USD')}</span>
                </div>
                <div className="flex-between">
                  <span style={{ color: 'var(--td-text-secondary)' }}>Shipping</span>
                  <span>{formatPrice(shippingFee, listing.currency || 'USD')}</span>
                </div>
                <div className="flex-between">
                  <span style={{ color: 'var(--td-text-secondary)' }}>Buyer Protection (5%)</span>
                  <span>{formatPrice(protectionFee, listing.currency || 'USD')}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}>
                  <div className="flex-between">
                    <span style={{ fontWeight: 700 }}>Total</span>
                    <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--td-primary)' }}>
                      {formatPrice(totalCost, listing.currency || 'USD')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Seller earnings */}
          {isOwner && (
            <div className="glass-card" style={{ padding: 'var(--td-space-md)', margin: 'var(--td-space-md) 0', borderLeft: '3px solid var(--td-success)' }}>
              <h4 style={{ marginBottom: 12, color: 'var(--td-success)' }}>Your Earnings</h4>
              <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="flex-between">
                  <span>Listing Price</span>
                  <span>{formatPrice(listing.price, listing.currency || 'USD')}</span>
                </div>
                <div className="flex-between" style={{ color: 'var(--td-error)' }}>
                  <span>Platform Fee (8%)</span>
                  <span>-{formatPrice(listing.price * 0.08, listing.currency || 'USD')}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}>
                  <div className="flex-between" style={{ color: 'var(--td-success)', fontWeight: 700 }}>
                    <span>You'll Receive</span>
                    <span style={{ fontSize: 18 }}>{formatPrice(listing.price * 0.92, listing.currency || 'USD')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="listing-detail-description">
            <h3>Description</h3>
            <p>{listing.description}</p>
          </div>

          {/* Action Buttons */}
          <div className="listing-detail-actions">
            <div className="listing-detail-action-row">
              <button className={`btn ${liked ? 'btn-primary' : 'btn-outline'}`} onClick={handleLike}>
                <FaHeart /> {liked ? 'Liked' : 'Like'} ({likeCount})
              </button>
              <button className="btn btn-outline" onClick={handleShare}>
                <FaShareAlt /> Share
              </button>
            </div>
            {!isOwner && !listing.sold && user && (
              <div className="listing-detail-action-row">
                {buyerOffer && buyerOffer.status === 'pending' && (
                  <>
                    <span className="badge badge-warning" style={{ padding: '8px 16px', fontSize: 14 }}>
                      ⏳ Offer pending — awaiting seller response
                    </span>
                    <button className="btn btn-primary btn-lg" onClick={handleAddToBag}>
                      Add to Bag at {formatPrice(listing.price, listing.currency || 'USD')}
                    </button>
                  </>
                )}
                {buyerOffer && buyerOffer.status === 'countered' && (
                  <>
                    <button className="btn btn-outline btn-lg" onClick={async () => {
                      const currency = buyerOffer.currency || 'USD';
                      const currentPrice = buyerOffer.counterAmount || buyerOffer.amount;
                      const amount = prompt(`Enter your counter amount (must be higher than ${currency} ${currentPrice}):`);
                      if (!amount || isNaN(amount)) return;
                      try {
                        await api.patch(`/offers/${buyerOffer._id}/buyer-counter`, { counterAmount: Number(amount) });
                        toast.success('Counter sent');
                        fetchBuyerOffer();
                      } catch (e) {
                        toast.error(e.response?.data?.message || 'Failed to send counter');
                      }
                    }}>
                      Counter Offer
                    </button>
                    <button className="btn btn-primary btn-lg" style={{ flex: 2 }} onClick={async () => {
                      try {
                        await api.patch(`/offers/${buyerOffer._id}/accept-counter`);
                        fetchBuyerOffer();
                        toast.success('Counter accepted! You can now purchase.');
                      } catch (e) {
                        toast.error(e.response?.data?.message || 'Failed to accept offer');
                      }
                    }}>
                      Accept & Buy at {formatPrice(getOfferPrice(), listing.currency || 'USD')}
                    </button>
                  </>
                )}
                {buyerOffer && buyerOffer.status === 'buyer_countered' && (
                  <>
                    <span className="badge badge-warning" style={{ padding: '8px 16px', fontSize: 14 }}>
                      🔄 Counter sent — awaiting seller response
                    </span>
                    <button className="btn btn-primary btn-lg" onClick={handleAddToBag}>
                      Add to Bag at {formatPrice(listing.price, listing.currency || 'USD')}
                    </button>
                  </>
                )}
                {buyerOffer && buyerOffer.status === 'accepted' && (
                  <>
                    <span className="badge badge-success" style={{ padding: '8px 16px', fontSize: 14 }}>
                      ✅ Offer accepted at {formatPrice(getOfferPrice(), listing.currency || 'USD')}
                    </span>
                    <button className="btn btn-primary btn-lg" style={{ flex: 2 }} onClick={handleAddToBag}>
                      Buy Now at {formatPrice(getOfferPrice(), listing.currency || 'USD')}
                    </button>
                  </>
                )}
                {(!buyerOffer || buyerOffer.status === 'declined' || buyerOffer.status === 'completed' || buyerOffer.status === 'expired') && (
                  <>
                    <button className="btn btn-outline btn-lg" onClick={() => setOfferModalOpen(true)}>
                      Make Offer
                    </button>
                    <button className="btn btn-primary btn-lg" onClick={handleAddToBag}>
                      Add to Bag — {formatPrice(displayPrice, listing.currency || 'USD')}
                    </button>
                  </>
                )}
              </div>
            )}
            {listing.sold && <div className="sold-banner">This item has been sold</div>}
          </div>

          {/* Seller Card */}
          <div className="seller-card">
            <Link to={`/profile/${listing.seller?._id}`} className="seller-info">
              <img src={listing.seller?.avatar || defaultAvatar} alt="" className="seller-avatar" />
              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {listing.seller?.name}
                  {listing.seller?.verified && <FaCheckCircle color="var(--td-primary)" size={16} />}
                </h4>
                <p>{listing.seller?.followers?.length || 0} followers • {listing.seller?.stats?.totalSales || 0} sales</p>
              </div>
            </Link>
            {!isOwner && user && (
              <button className={`btn btn-sm ${isFollowing ? 'btn-outline' : 'btn-primary'}`} onClick={handleFollow}>
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
            {isOwner && (
              <Link to={`/listing/${id}/edit`} className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }}>
                <FaEdit /> Edit Listing
              </Link>
            )}
          </div>

          {/* Comments */}
          <CommentSection listingId={listing._id} comments={comments} onCommentsUpdate={setComments} />
        </div>
      </div>

      {/* Similar Listings */}
      {similar.length > 0 && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Similar Items</h2>
            <Link to={`/search?category=${listing.category}`} className="btn btn-ghost btn-sm">View All →</Link>
          </div>
          <div className="listings-grid">
            {similar.map((item) => (
              <ListingCard key={item._id} listing={item} />
            ))}
          </div>
        </div>
      )}

          <OfferModal listing={listing} isOpen={offerModalOpen} onClose={() => setOfferModalOpen(false)} onOfferSubmitted={() => { fetchListing(); fetchBuyerOffer(); }} />
    </div>

    {/* Mobile Sticky Buy Bar */}
    {showMobileSticky && !isOwner && !listing.sold && (
      <div className="mobile-sticky-bar" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--td-glass-bg)',
        backdropFilter: 'blur(var(--td-blur-xl))',
        borderTop: '1px solid var(--td-glass-border)',
        padding: '12px 16px',
        paddingBottom: 'calc(12px + var(--td-safe-area-bottom))',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        animation: 'fadeInUp 0.3s ease-out',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--td-primary)' }}>
            {formatPrice(displayPrice, listing.currency || 'USD')}
          </div>
          {listing.originalPrice && (
            <div style={{ fontSize: 12, textDecoration: 'line-through', color: 'var(--td-text-tertiary)' }}>
              {formatPrice(listing.originalPrice, listing.currency || 'USD')}
            </div>
          )}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setOfferModalOpen(true)}>
          Offer
        </button>
        <button className="btn btn-primary" onClick={handleAddToBag} style={{ padding: '12px 24px' }}>
          Add to Bag
        </button>
      </div>
    )}
    </>
  );
};

export default ListingDetail;