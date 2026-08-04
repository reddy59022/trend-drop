import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { FaGavel, FaClock, FaUser, FaArrowLeft, FaVideo, FaBroadcastTower, FaEye, FaExclamationTriangle, FaDollarSign, FaTrophy, FaComment, FaVideoSlash } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/helpers';
import MediaCarousel from '../components/MediaCarousel';
import CommentSection from '../components/CommentSection';

// STUN servers for WebRTC - helps establish direct peer connection
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

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
  const [isViewingStream, setIsViewingStream] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const videoRef = useRef(null);
  const viewerVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // For seller: viewerId -> RTCPeerConnection
  const remotePeerRef = useRef(null); // For viewer: RTCPeerConnection to seller
  const localStreamRef = useRef(null);

  // Wire up local stream to video element once it exists in the DOM
  // Critical fix: videoRef.current is null at the moment setIsStreaming(true) is called
  // because the <video> element isn't rendered yet. This effect runs AFTER render.
  useEffect(() => {
    if (localStream && videoRef.current) {
      videoRef.current.srcObject = localStream;
      videoRef.current.play()
        .then(() => console.log('Local video stream playing'))
        .catch(err => {
          console.error('Error playing local video:', err);
          // Retry with muted autoplay (some browsers require it)
          videoRef.current.muted = true;
          videoRef.current.play().catch(e => console.error('Retry play failed:', e));
        });
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [localStream, isStreaming]);

  // Wire up remote viewer video stream once it exists in the DOM
  useEffect(() => {
    if (isViewingStream && viewerVideoRef.current) {
      const videoEl = viewerVideoRef.current;
      if (!videoEl.srcObject && remotePeerRef.current?.remoteStream) {
        videoEl.srcObject = remotePeerRef.current.remoteStream;
        videoEl.play().catch(e => console.error('Viewer video play failed:', e));
      }
    }
  }, [isViewingStream, auction?.streamInfo?.isLive]);

  useEffect(() => {
    fetchAuction();
    // eslint-disable-next-line
  }, [id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllStreams();
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, []);

  const fetchAuction = async () => {
    try {
      const res = await api.get(`/auctions/${id}`);
      setAuction(res.data.auction);
      setViewerCount(res.data.auction.streamInfo?.viewerCount || 0);
    } catch (error) {
      console.error('Fetch auction error:', error);
      toast.error('Auction not found');
      navigate('/auctions');
    }
    setLoading(false);
  };

  // ============ SOCKET CONNECTION ============
  const connectSocket = () => {
    if (socketRef.current?.connected) return socketRef.current;
    
    const token = localStorage.getItem('token');
    const socket = io('/', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    
    socket.on('connect', () => {
      console.log('Socket connected for live stream');
    });
    
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
    
    socketRef.current = socket;
    return socket;
  };

  // ============ SELLER STREAM LOGIC ============
  const handleStartStream = async () => {
    if (!user || String(user._id) !== String(auction?.seller?._id)) return;
    
    try {
      setStreamError(null);
      // Get local camera/mic stream
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
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsStreaming(true);
      
      // Connect to socket for signaling
      const socket = connectSocket();
      
      // Notify server stream started
      const streamRes = await api.post(`/auctions/${id}/stream/start`, {
        streamId: `auction-${id}-${Date.now()}`,
        sellerId: user._id,
      });
      
      // Update local auction state so streamIsLive is immediately true
      setAuction(prev => prev ? {
        ...prev,
        streamInfo: {
          ...(prev.streamInfo || {}),
          isLive: true,
          streamId: streamRes.data?.streamInfo?.streamId || `auction-${id}-${Date.now()}`,
          startedAt: new Date().toISOString(),
          sellerId: user._id,
        },
      } : prev);
      
      // Seller joins stream room so viewers can signal connection
      socket.emit('stream:join', { auctionId: id });
      
      // ===== Handle viewers joining - create peer connection per viewer =====
      socket.on('stream:viewer-joined', ({ auctionId, userId, userName }) => {
        if (auctionId !== id) return;
        console.log(`Viewer ${userName} joined stream room`);
        setViewerCount(prev => prev + 1);
        createPeerConnectionForViewer(userId);
      });
      
      // Viewer answers our offer
      socket.on('stream:answer', ({ auctionId, answer, viewerId }) => {
        if (auctionId !== id) return;
        console.log('Received answer from viewer:', viewerId);
        const pc = peerConnectionsRef.current.get(String(viewerId));
        if (pc) {
          pc.setRemoteDescription(new RTCSessionDescription(answer))
            .catch(err => console.error('Error setting remote description:', err));
        }
      });
      
      // ICE candidates from viewers
      socket.on('stream:ice-candidate', ({ auctionId, candidate, fromUserId }) => {
        if (auctionId !== id) return;
        console.log('Received ICE from viewer:', fromUserId);
        const pc = peerConnectionsRef.current.get(String(fromUserId));
        if (pc && candidate) {
          pc.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(err => console.error('Error adding ICE candidate:', err));
        }
      });
      
      // Viewer disconnected
      socket.on('stream:viewer-left', ({ userId }) => {
        const pc = peerConnectionsRef.current.get(String(userId));
        if (pc) {
          pc.close();
          peerConnectionsRef.current.delete(String(userId));
          setViewerCount(prev => Math.max(0, prev - 1));
        }
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

  // Seller creates a peer connection for a new viewer
  const createPeerConnectionForViewer = (viewerId) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      
      // Add local tracks
      localStreamRef.current?.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
      
      // Handle ICE candidates - send to viewer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('stream:ice-candidate', {
            auctionId: id,
            candidate: event.candidate,
            toUserId: viewerId,
          });
        }
      };
      
      // Handle connection state
      pc.onconnectionstatechange = () => {
        console.log(`Peer connection to viewer ${viewerId}: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          peerConnectionsRef.current.delete(String(viewerId));
          setViewerCount(prev => Math.max(0, prev - 1));
        }
      };
      
      // Create offer
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socketRef.current.emit('stream:offer', {
            auctionId: id,
            offer: pc.localDescription,
          });
        })
        .catch(err => console.error('Error creating offer:', err));
      
      peerConnectionsRef.current.set(String(viewerId), pc);
    } catch (error) {
      console.error('Error creating peer connection for viewer:', error);
    }
  };

  // ============ VIEWER STREAM LOGIC ============
  const joinStreamAsViewer = async () => {
    try {
      if (!user) return;
      
      setStreamError(null);
      
      // Connect to socket
      const socket = connectSocket();
      
      // Setup viewer peer connection
      setupViewerPeerConnection();
      
      // IMPORTANT: Register socket listeners BEFORE emitting stream:join
      // to avoid race condition where seller's SDP offer arrives before listener is ready
      socket.on('stream:offer', async ({ auctionId, offer, sellerId }) => {
        if (auctionId !== id) return;
        console.log('Received offer from seller');
        
        try {
          // Create/update peer connection
          const pc = setupViewerPeerConnection(sellerId);
          
          // Set remote description from seller's offer
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          
          // Create answer
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          // Send answer back to seller
          socket.emit('stream:answer', {
            auctionId: id,
            answer: pc.localDescription,
            toSellerId: sellerId,
          });
        } catch (error) {
          console.error('Error handling stream offer:', error);
        }
      });
      
      // ICE candidates from seller
      socket.on('stream:ice-candidate', ({ auctionId, candidate, fromUserId }) => {
        if (auctionId !== id) return;
        console.log('Received ICE from seller');
        if (remotePeerRef.current) {
          remotePeerRef.current.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(err => console.error('Error adding ICE:', err));
        }
      });
      
      // Stream ended
      socket.on('stream:ended', ({ auctionId }) => {
        if (auctionId !== id) return;
        toast.info('Live stream has ended');
        setIsViewingStream(false);
        if (remotePeerRef.current) {
          remotePeerRef.current.close();
          remotePeerRef.current = null;
        }
      });
      
      // NOW join the stream room - all listeners are registered
      socket.emit('stream:join', { auctionId: id });
      
      setIsViewingStream(true);
      toast.success('Joined live stream!');
    } catch (error) {
      console.error('Join stream error:', error);
      setStreamError('Failed to join live stream');
    }
  };

  // Viewer creates/gets peer connection
  const setupViewerPeerConnection = (sellerId = null) => {
    if (remotePeerRef.current) return remotePeerRef.current;
    
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      
      // Handle remote stream
      pc.ontrack = (event) => {
        console.log('Received remote track:', event.streams[0]);
        remotePeerRef.current.remoteStream = event.streams[0];
        if (viewerVideoRef.current) {
          viewerVideoRef.current.srcObject = event.streams[0];
          viewerVideoRef.current.play().catch(e => console.error('Viewer play error:', e));
        }
        setIsViewingStream(true);
      };
      
      // Handle ICE candidates - send to seller
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('stream:ice-candidate', {
            auctionId: id,
            candidate: event.candidate,
            toUserId: sellerId,
          });
        }
      };
      
      pc.onconnectionstatechange = () => {
        console.log(`Viewer peer connection state: ${pc.connectionState}`);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          console.log('Connection lost to seller');
        }
      };
      
      remotePeerRef.current = pc;
      return pc;
    } catch (error) {
      console.error('Error setting up viewer peer connection:', error);
      return null;
    }
  };

  // ============ BID PLACEMENT ============
  const handleBid = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    const amount = parseFloat(bidAmount);
    if (!amount || amount < effectiveMinBid) {
      toast.error(`Minimum bid is ${formatPrice(effectiveMinBid, auction.currency || 'USD')}`);
      return;
    }
    
    try {
      const res = await api.post(`/auctions/${id}/bids`, { amount });
      setAuction(res.data.auction);
      setBidAmount('');
      setShowBidModal(false);
      toast.success('Bid placed successfully!');
    } catch (error) {
      console.error('Error placing bid:', error);
      toast.error(error.response?.data?.message || 'Failed to place bid');
    }
  };

  // ============ STOP STREAM ============
  const handleStopStream = async () => {
    // Stop all peer connections (broadcasting to viewers)
    stopAllStreams();
    
    try {
      await api.post(`/auctions/${id}/stream/stop`);
      socketRef.current?.emit('stream:end', { auctionId: id });
    } catch (e) {}
    toast.success('Stream ended');
  };
  
  const stopAllStreams = () => {
    // Close all seller peer connections
    peerConnectionsRef.current.forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    peerConnectionsRef.current.clear();
    
    // Close viewer peer connection
    if (remotePeerRef.current) {
      try { remotePeerRef.current.close(); } catch (e) {}
      remotePeerRef.current = null;
    }
    
    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    setLocalStream(null);
    setIsStreaming(false);
    setIsViewingStream(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    if (viewerVideoRef.current) viewerVideoRef.current.srcObject = null;
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
  const streamIsLive = auction.streamInfo?.isLive;

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
          <div className="glass-card" style={{ marginTop: 'var(--td-space-md)', padding: 'var(--td-space-md)' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--td-space-md)' }}>
              <FaBroadcastTower style={{ color: streamIsLive || isStreaming ? 'var(--td-error)' : 'var(--td-primary)' }} /> 
              Live Stream {streamIsLive && <span style={{ fontSize: 12, background: 'var(--td-error)', color: 'white', padding: '2px 8px', borderRadius: 12 }}>LIVE</span>}
            </h3>
            
            {/* SELLER VIEW */}
            {isSeller && isActive && (
              <>
                {!isStreaming ? (
                  <button onClick={handleStartStream} className="btn btn-primary" style={{ width: '100%' }}>
                    <FaVideo /> Start Live Stream
                  </button>
                ) : (
                  <div>
                    <div style={{ position: 'relative' }}>
                      <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: 'var(--td-radius-lg)', background: '#000' }} />
                      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 8 }}>
                        <span style={{ background: 'var(--td-error)', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 12, fontWeight: 700 }}>● LIVE</span>
                        <span style={{ background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 12 }}>
                          <FaEye /> {viewerCount} watching
                        </span>
                      </div>
                    </div>
                    <div style={{ marginTop: 'var(--td-space-sm)', display: 'flex', gap: 'var(--td-space-sm)' }}>
                      <button onClick={handleStopStream} className="btn btn-error" style={{ flex: 1 }}>
                        <FaVideoSlash /> Stop Stream
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            
            {/* VIEWER VIEW */}
            {streamIsLive && user && !isSeller && (
              <>
                {!isViewingStream ? (
                  <button onClick={joinStreamAsViewer} className="btn btn-primary" style={{ width: '100%' }}>
                    <FaVideo /> Join Live Stream
                  </button>
                ) : (
                  <div>
                    <div style={{ position: 'relative' }}>
                      <video ref={viewerVideoRef} autoPlay playsInline style={{ width: '100%', borderRadius: 'var(--td-radius-lg)', background: '#000', aspectRatio: '16/9' }} />
                      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 8 }}>
                        <span style={{ background: 'var(--td-error)', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 12, fontWeight: 700 }}>● LIVE</span>
                      </div>
                    </div>
                    <p className="form-hint" style={{ marginTop: 'var(--td-space-sm)', textAlign: 'center' }}>
                      Watching live stream... If video doesn't appear, the seller may have ended it.
                    </p>
                  </div>
                )}
              </>
            )}
            
            {/* STREAM STATUS FOR NON-INTERACTING USERS */}
            {streamIsLive && !isSeller && !user && (
              <div>
                <button onClick={() => navigate('/login')} className="btn btn-primary" style={{ width: '100%' }}>
                  <FaVideo /> Login to Watch Live
                </button>
              </div>
            )}
            
            {streamError && <p style={{ color: 'var(--td-error)', fontSize: 12, marginTop: 8 }}>{streamError}</p>}
            
            <p className="form-hint" style={{ marginTop: 'var(--td-space-sm)' }}>
              {isSeller ? 'Stream your auction live to bidders. Viewers will see your camera feed in real-time.' : 
               streamIsLive ? 'Watch the seller stream this auction live.' : 
               'When the seller goes live, you can watch the stream here.'}
            </p>
          </div>
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
            {streamIsLive && <span style={{ color: 'var(--td-error)', fontWeight: 700, fontSize: 13 }}>● Streaming Now</span>}
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