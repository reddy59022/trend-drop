import { defaultAvatar, formatPrice, formatPriceRaw, getConditionTone, normalizeComment, displayDate } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaHeart, FaShareAlt, FaArrowLeft, FaShieldAlt, FaCheckCircle, FaChartLine, FaShippingFast, FaStore, FaRulerCombined, FaPalette, FaTag, FaEdit, FaComment, FaBolt, FaExchangeAlt, FaClock } from 'react-icons/fa';
import api, { checkInWishlist } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { toast } from 'react-toastify';
import { shareItem, copyText } from '../services/native';
import MediaCarousel from '../components/MediaCarousel';
import CommentSection from '../components/CommentSection';
import OfferModal from '../components/OfferModal';
import ChatModal from '../components/ChatModal';
import ListingCard from '../components/ListingCard';
import { useCart } from '../context/CartContext';

const ListingDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { socket } = useSocket();
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
  const [summaryShipping, setSummaryShipping] = useState(null);
  const [sellerEstimate, setSellerEstimate] = useState(null);
  const [sellerEstimateLoading, setSellerEstimateLoading] = useState(false);
  const [sellerQuantity, setSellerQuantity] = useState(1);
  const [showMobileSticky, setShowMobileSticky] = useState(false);
  const [counterModalOpen, setCounterModalOpen] = useState(false);
  const [counterAmount, setCounterAmount] = useState('');
  const [chatModalOpen, setChatModalOpen] = useState(false);

  const isOwner = Boolean(
    user && listing && (user.id || user._id) === listing.seller?._id
  );

  useEffect(() => {
    fetchListing();
    if (user) fetchBuyerOffer();
    // eslint-disable-next-line
  }, [id, user]);

  // Keep the purchase-summary shipping line aligned with the server's
  // weight- and threshold-aware calculation. The static listing shipping fee
  // ignored free-shipping thresholds, so the detail page could quote $3.99
  // while cart/checkout correctly charged $0.
  useEffect(() => {
    if (!listing) return undefined;
    let cancelled = false;
    const itemPrice = buyerOffer?.status === 'accepted'
      ? (buyerOffer.counterAmount || buyerOffer.amount)
      : listing.price;
    api.post('/shipping/calculate', {
      fromCountry: listing.shipsFrom || 'US',
      toCountry: selectedCountry,
      weightKg: listing.weight || 0.5,
      itemPrice,
    }).then((res) => {
      if (!cancelled) setSummaryShipping(res.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [listing, selectedCountry, buyerOffer]);

  // Seller earnings are a server calculation, not a client-side percentage.
  // It must include the postage the seller funds when the carrier label costs
  // more than the buyer's shipping charge, and it must change with destination
  // and quantity (combined weight changes the label).
  useEffect(() => {
    if (!listing || !isOwner) {
      setSellerEstimate(null);
      setSellerEstimateLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSellerEstimateLoading(true);
    api.post('/shipping/seller-estimate', {
      listingId: listing._id,
      toCountry: selectedCountry,
      quantity: sellerQuantity,
    }).then((res) => {
      if (!cancelled) setSellerEstimate(res.data);
    }).catch(() => {
      if (!cancelled) setSellerEstimate(null);
    }).finally(() => {
      if (!cancelled) setSellerEstimateLoading(false);
    });
    return () => { cancelled = true; };
  }, [listing, isOwner, selectedCountry, sellerQuantity]);

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

      // Load comments from the dedicated Comment collection (the listing page writes to this
      // collection, so the embedded listing.comments array is not the source of truth).
      try {
        const cRes = await api.get(`/comments/${id}`);
        setComments(cRes.data.comments?.map(normalizeComment) || []);
      } catch (e) {
        // Fall back to any legacy embedded comments if present
        setComments((res.data.listing.comments || []).map(normalizeComment));
      }

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

  // Realtime comment updates: join the listing room so viewers see new/deleted comments live.
  useEffect(() => {
    if (!socket || !id) return;
    socket.emit('listing:join', { listingId: id });

    // Incoming realtime comment events for this listing.
    const onNew = (created) => {
      setComments((prev) => {
        const key = created._id?.toString?.() || created.id?.toString?.();
        if (!key || prev.some((c) => (c._id || c.id)?.toString?.() === key)) return prev; // dedupe
        return [normalizeComment(created), ...prev];
      });
    };
    const onDeleted = (commentId) => {
      setComments((prev) => prev.filter((c) => (c._id || c.id)?.toString?.() !== commentId));
    };
    socket.on('comment:new', onNew);
    socket.on('comment:deleted', onDeleted);
    return () => {
      socket.off('comment:new', onNew);
      socket.off('comment:deleted', onDeleted);
      socket.emit('listing:leave', { listingId: id });
    };
  }, [socket, id]);

  const handleLike = async () => {
    if (!user) return toast.error('Please login');
    try {
      // The like endpoint also maintains the wishlist entry and returns the
      // authoritative state, so do not write the wishlist separately here.
      const res = await api.post(`/listings/${id}/like`);
      setLiked(res.data.liked);
      setLikeCount(res.data.likes.length);
      if (res.data.liked) toast.success('Added to wishlist!');
      else toast.info('Removed from wishlist');
    } catch (error) {
      console.error('Like error:', error);
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
    const shared = await shareItem({ title: listing.title, url: window.location.href });
    if (!shared) {
      await copyText(window.location.href);
      toast.success('Link copied to clipboard!');
    }
  };

  const handleSubmitCounter = async () => {
    if (!counterAmount || isNaN(counterAmount)) return;
    try {
      await api.patch(`/offers/${buyerOffer._id}/buyer-counter`, { counterAmount: Number(counterAmount) });
      toast.success('Counter sent');
      setCounterModalOpen(false);
      setCounterAmount('');
      fetchBuyerOffer();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to send counter');
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
        ...(negotiatedFlag != null ? { negotiatedPrice: negotiatedFlag } : {}),
        ...(latestOffer ? { offerId: latestOffer._id } : {}),
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
      // POST /api/shipping/calculate reads { fromCountry, toCountry, weightKg,
      // itemPrice } and 400s without fromCountry/toCountry. This used to send
      // { from, to, weight, dimensions } — every field name wrong — so the
      // request ALWAYS failed and "Get Estimate" never rendered a price; the
      // user only ever saw "Could not calculate shipping". `itemPrice` is sent
      // so the server's free-shipping threshold is applied here too, otherwise
      // the estimate quotes a fee that checkout then waives.
      const res = await api.post('/shipping/calculate', {
        fromCountry: listing.shipsFrom || 'US',
        toCountry: selectedCountry,
        weightKg: listing.weight || 0.5,
        itemPrice: listing.price,
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

  const discount = listing.originalPrice
    ? Math.round((1 - listing.price / listing.originalPrice) * 100)
    : 0;
  const displayPrice = getOfferPrice();
  const quotedShipping = summaryShipping && Number.isFinite(Number(summaryShipping.cost))
    ? Number(summaryShipping.cost)
    : null;
  const shippingFee = quotedShipping !== null
    ? quotedShipping
    : (listing.shipping?.freeShipping ? 0 : (listing.shipping?.shippingCost || 5.99));
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
                        {displayDate(entry.date)}
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

            <h1>{listing.title}</h1>
            <div className="listing-detail-price">
              {buyerOffer && buyerOffer.status === 'accepted' && (
                <>
                  <span className="current-price negotiated-price" style={{ color: 'var(--td-success)' }}>Offer Price: {formatPrice(displayPrice, listing.currency || 'USD')}</span>
                  <span className="original-price">{formatPrice(listing.price, listing.currency || 'USD')}</span>
                  <span className="discount-badge" style={{ position: 'relative', top: 0, left: 0 }}>Negotiated</span>
                </>
              )}
              {!buyerOffer || buyerOffer.status !== 'accepted' ? (
                <>
                  <span className="current-price">{formatPrice(listing.price, listing.currency || 'USD')}</span>
                  {listing.originalPrice && (
                    <>
                      <span className="original-price">{formatPrice(listing.originalPrice, listing.currency || 'USD')}</span>
                      <span className="discount-badge" style={{ position: 'relative', top: 0, left: 0 }}>-{discount}%</span>
                    </>
                  )}
                </>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <div className="listing-card-likes" style={{ marginTop: 0 }}>
                <FaHeart /> {likeCount} likes
              </div>
            </div>
            {/* Feature 4 — auto-respond badge visible to buyers (not the owner).
                Shows the instant-offer guarantee + least price in listing currency. */}
            {!isOwner && listing.autoRespond?.enabled && listing.autoRespond?.minPrice != null && (
              <div style={{
                padding: 'var(--td-space-md) var(--td-space-lg)',
                marginTop: 12,
                borderRadius: 'var(--td-radius-lg)',
                border: '2px solid var(--td-success)',
                background: 'linear-gradient(135deg, rgba(16,217,142,0.08) 0%, rgba(16,217,142,0.02) 100%)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--td-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                  <FaBolt size={16} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--td-success)', marginBottom: 2 }}>Instant Offer Enabled</div>
                  <div style={{ fontSize: 13, color: 'var(--td-text-secondary)', lineHeight: 1.4 }}>
                    Offers at <strong>{formatPrice(listing.autoRespond.minPrice, listing.currency || 'USD')}</strong> or more are accepted automatically. Lower offers receive an instant counter.
                    {listing.autoRespond.autoOfferToLikers && <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--td-primary)' }}>This seller auto-sends offers to likers!</span>}
                  </div>
                </div>
              </div>
            )}
            {/* Feature 4 — owner-only view of their own auto-respond config. */}
            {isOwner && listing.autoRespond?.enabled && (
              <div style={{
                padding: 'var(--td-space-md) var(--td-space-lg)', marginTop: 12,
                borderRadius: 'var(--td-radius-lg)',
                border: '2px dashed var(--td-success)',
                background: 'rgba(16,217,142,0.04)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(16,217,142,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--td-success)', flexShrink: 0 }}>
                  <FaExchangeAlt size={14} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--td-success)', marginBottom: 2 }}>Auto Respond Active</div>
                  <div style={{ fontSize: 13, color: 'var(--td-text-secondary)' }}>
                    Minimum auto-accept price: <strong>{formatPrice(listing.autoRespond.minPrice, listing.currency || 'USD')}</strong>
                    {listing.autoRespond.autoOfferToLikers && <span> &middot; Auto-offer sent to likers</span>}
                    <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--td-text-tertiary)' }}>Only you can see this.</span>
                  </div>
                </div>
              </div>
            )}
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
                className={`badge td-tone-${getConditionTone(listing.condition)}`}
                style={{ 
                  background: 'var(--td-tone-bg)',
                  color: 'var(--td-tone-fg)',
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
                <label className="form-label" htmlFor="shipping-from">From</label>
                <input 
                  id="shipping-from"
                  name="shippingFrom"
                  className="form-input" 
                  value={listing.shipsFrom || 'US'} 
                  disabled 
                />
              </div>
              <div className="form-group">
                <label className="form-label">To</label>
                <select 
                  className="form-input" 
                  aria-label="Destination country"
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
          {isOwner && (() => {
            // Fallback values keep the card useful while the estimate loads (or
            // if it is temporarily unavailable). The authoritative platform
            // fee, boost, postage and net all come from the server estimate;
            // nothing here invents a postage number.
            const estimate = sellerEstimate?.seller;
            const estimatePostage = sellerEstimate?.postage;
            const boostFeePct = listing.boost?.active ? { standard: 10, premium: 15, elite: 20 }[listing.boost.tier] || 10 : 0;
            const fallbackBoostFee = listing.boost?.active ? Math.round(listing.price * (boostFeePct / 100) * 100) / 100 : 0;
            const platformFee = estimate?.platformFee ?? Math.round(listing.price * 0.08 * 100) / 100;
            const platformFeePercent = estimate?.platformFeePercent ?? 8;
            const boostFee = estimate?.boostFee ?? fallbackBoostFee;
            const itemSubtotal = estimate?.itemSubtotal ?? listing.price;
            const postageSubsidy = estimate?.sellerPostageSubsidy ?? 0;
            const youEarn = estimate?.sellerEarnings
              ?? Math.round((listing.price - platformFee - boostFee) * 100) / 100;
            const maxEstimateQty = Math.max(1, Math.min(Number(listing.quantity ?? listing.available_quantity) || 1, 10));
            const qty = sellerEstimate?.quantity || sellerQuantity;
            return (
            <div className="glass-card" style={{ padding: 'var(--td-space-md)', margin: 'var(--td-space-md) 0', borderLeft: '3px solid var(--td-success)' }}>
              <h4 style={{ marginBottom: 12, color: 'var(--td-success)' }}>Your Earnings</h4>
              <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {maxEstimateQty > 1 && (
                  <div className="flex-between" style={{ alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ color: 'var(--td-text-secondary)' }}>Estimate for</span>
                    <select
                      className="form-input"
                      aria-label="Earnings estimate quantity"
                      value={sellerQuantity}
                      onChange={(e) => setSellerQuantity(Number(e.target.value))}
                      style={{ width: 96, padding: '4px 8px' }}
                    >
                      {Array.from({ length: maxEstimateQty }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n} item{n === 1 ? '' : 's'}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex-between">
                  <span>{qty > 1 ? `Items (${qty} × ${formatPrice(listing.price, listing.currency || 'USD')})` : 'Listing Price'}</span>
                  <span>{formatPrice(itemSubtotal, listing.currency || 'USD')}</span>
                </div>
                <div className="flex-between" style={{ color: 'var(--td-error)' }}>
                  <span>Platform Fee ({platformFeePercent}%)</span>
                  <span>-{formatPrice(platformFee, listing.currency || 'USD')}</span>
                </div>
                {boostFee > 0 && (
                  <div className="flex-between" style={{ color: 'var(--td-error)' }}>
                    <span>Boost Fee ({listing.boost.tier})</span>
                    <span>-{formatPrice(boostFee, listing.currency || 'USD')}</span>
                  </div>
                )}
                <div className="flex-between" style={{ color: postageSubsidy > 0 ? 'var(--td-error)' : 'var(--td-text-secondary)' }}>
                  <span>Postage (seller-paid)</span>
                  <span>
                    {sellerEstimateLoading && !estimate
                      ? 'Calculating…'
                      : (postageSubsidy > 0
                        ? `-${formatPrice(postageSubsidy, listing.currency || 'USD')}`
                        : formatPrice(0, listing.currency || 'USD'))}
                  </span>
                </div>
                {estimatePostage && postageSubsidy > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: -2 }}>
                    Carrier label {formatPrice(estimatePostage.labelCost, listing.currency || 'USD')}
                    {' '}less buyer shipping {formatPrice(estimatePostage.buyerShipping, listing.currency || 'USD')}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--td-border)', paddingTop: 6, marginTop: 4 }}>
                  <div className="flex-between" style={{ color: 'var(--td-success)', fontWeight: 700 }}>
                    <span>You'll Earn</span>
                    <span style={{ fontSize: 18 }}>{formatPrice(youEarn, listing.currency || 'USD')}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 4, lineHeight: 1.45 }}>
                  {estimate
                    ? `Estimated for ${qty} item${qty === 1 ? '' : 's'} shipping to ${selectedCountry}. Final postage uses the carrier label rate at sale.`
                    : 'Final postage is deducted at the carrier label rate when the sale ships.'}
                </div>
              </div>
            </div>
            );
          })()}

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
              {!listing.sold && (
                <button
                  className="btn btn-outline"
                  data-testid="try-on-button"
                  aria-label="Try it on"
                  onClick={() => navigate('/virtual-try-on/' + id, { state: { from: '/listing/' + id } })}
                >
                  <FaRulerCombined /> Try On
                </button>
              )}
              <button className="btn btn-outline" onClick={handleShare}>
                <FaShareAlt /> Share
              </button>
              {/* Message Seller lives in the purchase row below for available items;
                  keep it here only for sold items, where that row is not rendered. */}
              {!isOwner && user && listing.seller && listing.sold && (
                <button
                  className="btn btn-outline"
                  onClick={() => setChatModalOpen(true)}
                  style={{ color: 'var(--td-primary)', borderColor: 'var(--td-primary)' }}
                >
                  <FaComment /> Message Seller
                </button>
              )}
            </div>
            {!isOwner && !listing.sold && user && (
              <div className="listing-detail-action-row">
                {/* Single "Try On" entry point lives in the row above; this purchase
                    row leads with contact + negotiation + checkout actions. */}
                {listing.seller && (
                  <button
                    className="btn btn-outline btn-lg"
                    onClick={() => setChatModalOpen(true)}
                    style={{ color: 'var(--td-primary)', borderColor: 'var(--td-primary)' }}
                  >
                    <FaComment /> Message Seller
                  </button>
                )}
                {buyerOffer && buyerOffer.status === 'pending' && (
                  <>
                    <span className="badge badge-warning" style={{ padding: '8px 16px', fontSize: 14 }}>
                      <FaClock aria-hidden="true" /> Offer pending — awaiting seller response
                    </span>
                    <button className="btn btn-primary btn-lg" onClick={handleAddToBag}>
                      Add to Bag at {formatPrice(listing.price, listing.currency || 'USD')}
                    </button>
                  </>
                )}
                {buyerOffer && buyerOffer.status === 'countered' && (
                  <>
                    <button className="btn btn-outline btn-lg" onClick={() => setCounterModalOpen(true)}>
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
                      <FaExchangeAlt aria-hidden="true" /> Counter sent — awaiting seller response
                    </span>
                    <button className="btn btn-primary btn-lg" onClick={handleAddToBag}>
                      Add to Bag at {formatPrice(listing.price, listing.currency || 'USD')}
                    </button>
                  </>
                )}
                {buyerOffer && buyerOffer.status === 'accepted' && (
                  <>
                    <span className="badge badge-success" style={{ padding: '8px 16px', fontSize: 14 }}>
                      <FaCheckCircle aria-hidden="true" /> Offer accepted at {formatPrice(getOfferPrice(), listing.currency || 'USD')}
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

    {/* Counter Offer Modal */}
    {counterModalOpen && buyerOffer && (
      <div className="modal-overlay" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}>
        <div className="glass-card" style={{ padding: 'var(--td-space-xl)', maxWidth: 400, width: '100%' }}>
          <h3 style={{ marginBottom: 8 }}>Counter Offer</h3>
          <p style={{ fontSize: 13, color: 'var(--td-text-secondary)', marginBottom: 12 }}>
            Enter your counter amount (must be higher than {formatPriceRaw(buyerOffer.counterAmount || buyerOffer.amount, buyerOffer.currency || 'USD')})
          </p>
          <input
            type="number"
            className="form-input"
            value={counterAmount}
            onChange={(e) => setCounterAmount(e.target.value)}
            placeholder="Enter amount"
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmitCounter} disabled={!counterAmount || isNaN(counterAmount)}>
              Send Counter
            </button>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setCounterModalOpen(false); setCounterAmount(''); }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}

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
        {!listing.sold && (
          <button className="btn btn-outline btn-sm" data-testid="try-on-button-mobile" onClick={() => navigate('/virtual-try-on/' + id, { state: { from: '/listing/' + id } })}>
            Try On
          </button>
        )}
        <button className="btn btn-primary" onClick={handleAddToBag} style={{ padding: '12px 24px' }}>
          Add to Bag
        </button>
      </div>
    )}

    {/* Chat Modal */}
    {chatModalOpen && listing?.seller && (
      <ChatModal
        isOpen={chatModalOpen}
        onClose={() => setChatModalOpen(false)}
        listing={listing}
        seller={listing.seller}
      />
    )}
    </>
  );
};

export default ListingDetail;