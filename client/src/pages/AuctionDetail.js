import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaGavel, FaClock, FaUser, FaArrowLeft, FaVideo, FaBroadcastTower, FaEye, FaExclamationTriangle, FaDollarSign, FaTrophy, FaComment } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/helpers';
import MediaCarousel from '../components/MediaCarousel';
import CommentSection from '../components/CommentSection';

const AuctionDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [auction, setAuction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState('');
  const [showBidModal, setShowBidModal] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [streamError, setStreamError] = useState(null);
  const videoRef = useRef(null);

  useEffect(() => {
    fetchAuction();
    // eslint-disable-next-line
  }, [id]);

  const fetchAuction = async () => {
    try {
      const res = await api.get(`/auctions/${id}`);
      setAuction(res.data.auction);
    } catch (error) {
      console.error('Fetch auction error:', error);
      toast.error('Auction not found');
      navigate('/auctions');
    }
    setLoading(false);
  };

  const handleBid = async () => {
    if (!user) return toast.error('Please login to bid');
    if (!bidAmount) return toast.error('Enter a bid amount');

    try {
      const res = await api.post(`/auctions/${id}/bids`, { amount: parseFloat(bidAmount) });
      setAuction(res.data.auction);
      setBidAmount('');
      setShowBidModal(false);
      toast.success('Bid placed successfully!');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to place bid');
    }
  };

  const handleStartStream = async () => {
    if (!user || String(user._id) !== String(auction?.seller?._id)) return;
    
    try {
      setStreamError(null);
      // Use 'user' for front-facing camera (laptop/webcam), fallback to no facingMode for compatibility
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (err) {
        // Fallback: try without facingMode constraint (works on all devices)
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      }
      
      setLocalStream(stream);
      setIsStreaming(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      // Notify server stream started
      await api.post(`/auctions/${id}/stream/start`, {
        streamId: `auction-${id}-${Date.now()}`,
        sellerId: user._id,
      });
      
      toast.success('Live stream started!');
    } catch (error) {
      console.error('Stream error:', error);
      let msg = 'Failed to start stream';
      if (error.name === 'NotAllowedError') msg = 'Camera/mic access denied';
      else if (error.name === 'NotFoundError') msg = 'No camera/mic found';
      else if (error.name === 'NotReadableError') msg = 'Camera/mic in use';
      setStreamError(msg);
      toast.error(msg);
    }
  };

  const handleStopStream = async () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setIsStreaming(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    
    try {
      await api.post(`/auctions/${id}/stream/stop`);
    } catch (e) {}
    toast.success('Stream ended');
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
        </div>
      </div>
    </div>
  );

  if (!auction) return null;

  const isSeller = user && String(user._id) === String(auction.seller?._id);
  const isActive = auction.status === 'active';
  const isEnded = auction.status === 'closed' || auction.status === 'cancelled';
  const timeLeft = new Date(auction.endTime) - new Date();
  const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
  const minutesLeft = Math.max(0, Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60)));

  const minBid = auction.currentBid + 1;
  const mustMeetReserve = auction.currentBid <= auction.reservePrice && minBid < auction.reservePrice;
  const effectiveMinBid = mustMeetReserve ? auction.reservePrice : minBid;

  return (
    <div className="page-container">
      <button className="back-btn" onClick={() => navigate('/auctions')}>
        <FaArrowLeft /> Back to Auctions
      </button>

      <div className="auction-detail">
        {/* Left - Image/Video */}
        <div className="auction-detail-left">
          <MediaCarousel images={auction.listing?.images} videoUrl={auction.listing?.videoUrl} />
          
          {/* Live Stream Section */}
          {isSeller && isActive && (
            <div className="glass-card" style={{ marginTop: 'var(--td-space-md)', padding: 'var(--td-space-md)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--td-space-md)' }}>
                <FaBroadcastTower style={{ color: 'var(--td-primary)' }} /> Live Stream
              </h3>
              {!isStreaming ? (
                <button onClick={handleStartStream} className="btn btn-primary" style={{ width: '100%' }}>
                  <FaVideo /> Start Live Stream
                </button>
              ) : (
                <div>
                  <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: 'var(--td-radius-lg)', background: 'var(--td-bg-tertiary)' }} />
                  <div style={{ marginTop: 'var(--td-space-sm)', display: 'flex', gap: 'var(--td-space-sm)' }}>
                    <button onClick={handleStopStream} className="btn btn-error" style={{ flex: 1 }}>
                      <FaVideo style={{ transform: 'scaleX(-1)' }} /> Stop Stream
                    </button>
                  </div>
                  {streamError && <p style={{ color: 'var(--td-error)', fontSize: 12, marginTop: 8 }}>{streamError}</p>}
                </div>
              )}
              <p className="form-hint" style={{ marginTop: 'var(--td-space-sm)' }}>
                Stream your auction live to bidders. Requires camera & microphone permissions.
              </p>
            </div>
          )}
          
          {/* Viewer Stream Placeholder */}
          {auction.streamInfo?.isLive && !isSeller && (
            <div className="glass-card" style={{ marginTop: 'var(--td-space-md)', padding: 'var(--td-space-md)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--td-space-md)' }}>
                <FaBroadcastTower style={{ color: 'var(--td-success)' }} /> Live Stream Active
              </h3>
              <div style={{ aspectRatio: '16/9', borderRadius: 'var(--td-radius-lg)', background: 'var(--td-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--td-text-tertiary)' }}>
                <span>Live stream would appear here (WebRTC viewer implementation)</span>
              </div>
              <p className="form-hint">Viewer count: {auction.streamInfo.viewerCount || 0}</p>
            </div>
          )}
        </div>

        {/* Right - Details */}
        <div className="auction-detail-right">
          {/* Status Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--td-space-md)', flexWrap: 'wrap' }}>
            <span className={`auction-status-badge ${auction.status}`}>
              {auction.status === 'scheduled' ? '⏳ Upcoming' : 
               auction.status === 'active' ? '🔴 Live' : 
               auction.status === 'closed' ? '✅ Ended' : '❌ Cancelled'}
            </span>
            {auction.currency && (
              <span className="currency-badge">{auction.currency}</span>
            )}
          </div>

          <h1>{auction.listing?.title}</h1>
          
          {/* Pricing */}
          <div className="auction-pricing-detail">
            <div className="price-row current">
              <span>Current Bid</span>
              <strong>{formatPrice(auction.currentBid, auction.currency || 'USD')}</strong>
            </div>
            <div className="price-row reserve">
              <span>Reserve Price</span>
              <strong>{formatPrice(auction.reservePrice, auction.currency || 'USD')}</strong>
              {auction.currentBid < auction.reservePrice && <span className="reserve-not-met">Reserve not met</span>}
            </div>
            {auction.currentBid > 0 && (
              <div className="price-row bid-count">
                <span>Total Bids</span>
                <strong>{auction.bids?.length || 0}</strong>
              </div>
            )}
          </div>

          {/* Timer */}
          {isActive && (
            <div className="auction-timer glass-card" style={{ padding: 'var(--td-space-md)', margin: 'var(--td-space-md) 0' }}>
              <FaClock style={{ marginRight: 8 }} />
              <strong>Time Remaining: </strong>
              <span className="timer-value">{hoursLeft}h {minutesLeft}m</span>
            </div>
          )}

          {/* Winner */}
          {auction.winner && isEnded && (
            <div className="auction-winner glass-card" style={{ padding: 'var(--td-space-md)', margin: 'var(--td-space-md) 0', borderLeft: '4px solid var(--td-success)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FaTrophy style={{ color: 'var(--td-success)' }} />
                <strong>Auction Ended - Winner:</strong>
              </div>
              <p>{auction.winner.name} won with a bid of {formatPrice(auction.winningBid, auction.winningCurrency || auction.currency || 'USD')}</p>
            </div>
          )}

          {/* Seller Info */}
          <div className="seller-card glass-card" style={{ padding: 'var(--td-space-md)', marginBottom: 'var(--td-space-md)' }}>
            <Link to={`/profile/${auction.seller?._id}`} className="seller-info" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="seller-avatar" style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--td-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 20 }}>
                {auction.seller?.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <h4 style={{ margin: 0 }}>{auction.seller?.name}</h4>
                <p style={{ margin: 4, color: 'var(--td-text-secondary)', fontSize: 14 }}>Seller</p>
              </div>
            </Link>
          </div>

          {/* Bid Form */}
          {isActive && user && !isSeller && (
            <div className="bid-form glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--td-space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaGavel /> Place Your Bid
              </h3>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--td-primary)' }}>
                  {auction.currency || 'USD'}
                </span>
                <input
                  type="number"
                  min={effectiveMinBid}
                  step="1"
                  placeholder={`Min: ${formatPrice(effectiveMinBid, auction.currency || 'USD')}`}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="form-input"
                  style={{ flex: 1, maxWidth: 200, fontSize: 18 }}
                />
                <button 
                  onClick={() => setShowBidModal(true)}
                  className="btn btn-primary"
                  style={{ padding: '14px 28px', fontSize: 16 }}
                  disabled={!bidAmount || parseFloat(bidAmount) < effectiveMinBid}
                >
                  Bid Now
                </button>
              </div>
              <p className="form-hint" style={{ marginTop: 'var(--td-space-sm)' }}>
                Minimum bid: {formatPrice(effectiveMinBid, auction.currency || 'USD')}
                {mustMeetReserve && ' (must meet reserve)'}
              </p>
            </div>
          )}

          {isSeller && isActive && (
            <div className="seller-actions glass-card" style={{ padding: 'var(--td-space-md)', marginBottom: 'var(--td-space-md)' }}>
              <p style={{ margin: 0, color: 'var(--td-text-secondary)' }}>
                You are the seller. <strong>{auction.bids?.length || 0} bids</strong> so far. 
                Current high: <strong>{formatPrice(auction.currentBid, auction.currency || 'USD')}</strong>
              </p>
            </div>
          )}

          {(isEnded || isSeller) && !isActive && (
            <div className="glass-card" style={{ padding: 'var(--td-space-md)', marginBottom: 'var(--td-space-md)', background: 'rgba(var(--td-text-tertiary-rgb), 0.1)' }}>
              <p style={{ margin: 0, color: 'var(--td-text-secondary)' }}>
                {isEnded ? 'This auction has ended.' : 'Auction not yet started.'}
              </p>
            </div>
          )}

          {/* Listing Details */}
          <div className="listing-details glass-card" style={{ padding: 'var(--td-space-lg)' }}>
            <h3 style={{ marginBottom: 'var(--td-space-md)' }}>Item Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--td-space-md)' }}>
              {auction.listing?.category && (
                <div><strong>Category:</strong> {auction.listing.category}</div>
              )}
              {auction.listing?.brand && (
                <div><strong>Brand:</strong> {auction.listing.brand}</div>
              )}
              {auction.listing?.size && (
                <div><strong>Size:</strong> {auction.listing.size}</div>
              )}
              {auction.listing?.condition && (
                <div><strong>Condition:</strong> {auction.listing.condition}</div>
              )}
              <div><strong>Auction Started:</strong> {new Date(auction.startTime).toLocaleString()}</div>
              <div><strong>Auction Ends:</strong> {new Date(auction.endTime).toLocaleString()}</div>
            </div>
          </div>

          {/* Description */}
          {auction.listing?.description && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--td-space-md)' }}>Description</h3>
              <p>{auction.listing.description}</p>
            </div>
          )}

          {/* Bid History */}
          {auction.bids && auction.bids.length > 0 && (
            <div className="glass-card" style={{ padding: 'var(--td-space-lg)' }}>
              <h3 style={{ marginBottom: 'var(--td-space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FaComment /> Bid History ({auction.bids.length})
              </h3>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {auction.bids
                  .slice()
                  .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                  .map((bid, i) => (
                    <div key={i} className="bid-history-item" style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--td-space-sm) 0', borderBottom: '1px solid var(--td-border)' }}>
                      <span>{bid.bidder?.name || 'Anonymous'}</span>
                      <strong>{formatPrice(bid.amount, bid.currency || auction.currency || 'USD')}</strong>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <CommentSection listingId={id} comments={auction.listing?.comments || []} onCommentsUpdate={() => {}} />
        </div>
      </div>

      {/* Bid Confirmation Modal */}
      {showBidModal && (
        <div className="modal-overlay" onClick={() => setShowBidModal(false)}>
          <div className="modal-content glass-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, padding: 'var(--td-space-xl)' }}>
            <h3 style={{ marginBottom: 'var(--td-space-md)' }}>Confirm Bid</h3>
            <p style={{ marginBottom: 'var(--td-space-lg)' }}>
              Place bid of <strong>{formatPrice(parseFloat(bidAmount), auction.currency || 'USD')}</strong>?
            </p>
            <div style={{ display: 'flex', gap: 'var(--td-space-md)', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setShowBidModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleBid}>Confirm Bid</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuctionDetail;