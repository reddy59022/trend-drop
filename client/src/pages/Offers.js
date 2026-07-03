import { defaultAvatar, formatPrice } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import moment from 'moment';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { FaExchangeAlt, FaArrowUp, FaCheck, FaTimes, FaGavel } from 'react-icons/fa';
import { io } from 'socket.io-client';

const Offers = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('received');
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Socket.io for real-time offer notifications
  useEffect(() => {
    if (!user) return;
    fetchOffers();

    // Connect to socket for real-time updates
    const token = localStorage.getItem('token');
    if (token) {
      const socket = io('/', {
        auth: { token },
      });

      // Listen for offer updates
      socket.on('notification:new', (notification) => {
        if (notification.type === 'offer') {
          fetchOffers();
          toast.info(`New offer update: ${notification.message}`);
        }
      });

      return () => {
        socket.disconnect();
      };
    }
  }, [user]); // eslint-disable-line

  const fetchOffers = async () => {
    try {
      const [received, sent] = await Promise.all([api.get('/offers/received'), api.get('/offers/sent')]);
      setReceivedOffers(received.data);
      setSentOffers(sent.data);
    } catch (error) { console.error(error); }
    setLoading(false);
  };

  const handleAccept = async (offerId) => { try { await api.patch(`/offers/${offerId}/accept`); toast.success('Offer accepted!'); fetchOffers(); } catch (error) { toast.error(error.response?.data?.message || 'Failed to accept'); } };
  const handleSellerAcceptBuyerCounter = async (offerId) => { try { await api.patch(`/offers/${offerId}/seller-accept-buyer-counter`); toast.success('Counter accepted!'); fetchOffers(); } catch (error) { toast.error(error.response?.data?.message || 'Failed to accept counter'); } };
  const handleDecline = async (offerId) => { try { await api.patch(`/offers/${offerId}/decline`); toast.success('Offer declined'); fetchOffers(); } catch (error) { toast.error(error.response?.data?.message || 'Failed'); } };
  const handleSellerCounter = async (offer) => {
    const previous = offer.counterAmount || offer.amount;
    const currency = offer.currency || 'USD';
    const amount = prompt(`Counter offer amount (must be higher than ${currency} ${previous}):`);
    if (!amount || isNaN(amount)) return;
    try { await api.patch(`/offers/${offer._id}/counter`, { counterAmount: Number(amount) }); toast.success('Counter sent!'); fetchOffers(); } catch (error) { toast.error(error.response?.data?.message || 'Failed'); }
  };

  if (!user) return (
    <div className="page-container">
      <div className="empty-state">
        <div className="empty-state-icon">💬</div>
        <h2>Offers</h2>
        <p>Sign in to manage your offers</p>
        <Link to="/login" className="btn btn-primary btn-lg">Sign In</Link>
      </div>
    </div>
  );

  if (loading) return (
    <div className="page-container">
      <h1 className="page-title"><FaGavel /> Offers</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 'var(--td-radius-lg)' }} />)}</div>
    </div>
  );

  const getStatusColor = (status) => {
    const map = { accepted: 'status-success', completed: 'status-success', declined: 'status-declined', countered: 'status-countered', buyer_countered: 'status-countered', expired: 'status-expired' };
    return map[status] || 'status-pending';
  };

  const getStatusLabel = (s) => ({ pending: '⏳ Pending', accepted: '✅ Accepted', declined: '❌ Declined', countered: '🔄 Countered', buyer_countered: '🔄 You Countered', completed: '✅ Completed', expired: '⏰ Expired' }[s] || s);

const isOfferExpired = (offer) => {
  if (offer.status === 'accepted' && offer.acceptedUntil) {
    return new Date() > new Date(offer.acceptedUntil);
  }
  return false;
};

const renderOfferCard = (offer, type) => {
  // If offer is completed/declined/expired, no action buttons
  const isTerminalState = offer.status === 'completed' || offer.status === 'declined' || offer.status === 'expired' || isOfferExpired(offer);
  
  return (
    <div key={offer._id} className="offer-card" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
      <Link to={`/listing/${offer.listing?._id}`} className="offer-image">
        <img src={offer.listing?.images?.[0] || defaultAvatar} alt="" />
      </Link>
      <div className="offer-details">
        <h4>{offer.listing?.title}</h4>
        <p style={{ color: 'var(--td-text-secondary)' }}>{type === 'received' ? `From: ${offer.buyer?.name}` : `To: ${offer.seller?.name}`}</p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8 }}>
          <div><span style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Offered</span><br /><strong style={{ fontSize: 16, color: 'var(--td-primary)' }}>{formatPrice(offer.amount, offer.currency || 'USD')}</strong></div>
          {offer.counterAmount && offer.status !== 'accepted' && (
            <div><span style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Counter</span><br /><strong style={{ fontSize: 16 }}>{formatPrice(offer.counterAmount, offer.currency || 'USD')}</strong></div>
          )}
          {offer.status === 'accepted' && offer.acceptedPrice && (
            <div><span style={{ fontSize: 11, color: 'var(--td-text-tertiary)' }}>Accepted Price</span><br /><strong style={{ fontSize: 16, color: 'var(--td-success)' }}>{formatPrice(offer.acceptedPrice, offer.currency || 'USD')}</strong></div>
          )}
        </div>
        <span className={`offer-status ${getStatusColor(offer.status)}`} style={{ marginTop: 8 }}>{getStatusLabel(offer.status)}</span>
        {offer.status === 'accepted' && offer.acceptedUntil && (
          <p style={{ fontSize: 11, color: isOfferExpired(offer) ? 'var(--td-error)' : 'var(--td-text-secondary)', marginTop: 4 }}>
            {isOfferExpired(offer) ? '⏰ Offer expired - make a new offer' : `⏳ Valid for ${Math.max(0, Math.floor((new Date(offer.acceptedUntil) - new Date()) / (1000 * 60 * 60)))}h`}
          </p>
        )}
        <p className="offer-time">{moment(offer.createdAt).fromNow()}</p>
      </div>
      {/* Actions */}
      {/* Received offers - seller actions */}
      {type === 'received' && !isTerminalState && offer.status === 'pending' && (
        <div className="offer-actions">
          <button className="btn btn-primary btn-sm" onClick={() => handleAccept(offer._id)}><FaCheck size={12} /> Accept</button>
          <button className="btn btn-outline btn-sm" onClick={() => handleSellerCounter(offer)}><FaExchangeAlt size={12} /> Counter</button>
          <button className="btn btn-sm" onClick={() => handleDecline(offer._id)} style={{ color: 'var(--td-error)' }}><FaTimes size={12} /> Decline</button>
        </div>
      )}
      {type === 'received' && !isTerminalState && offer.status === 'buyer_countered' && (
        <div className="offer-actions">
          <button className="btn btn-primary btn-sm" onClick={() => handleSellerAcceptBuyerCounter(offer._id)}><FaCheck size={12} /> Accept Counter</button>
          <button className="btn btn-outline btn-sm" onClick={() => handleSellerCounter(offer)}><FaExchangeAlt size={12} /> Counter Again</button>
          <button className="btn btn-sm" onClick={() => handleDecline(offer._id)} style={{ color: 'var(--td-error)' }}><FaTimes size={12} /> Decline</button>
        </div>
      )}
      {type === 'received' && offer.status === 'accepted' && (
        <div className="offer-actions">
          <span className="offer-status status-success" style={{ padding: '4px 12px' }}>✅ Accepted - Waiting for buyer</span>
        </div>
      )}
      {type === 'received' && offer.status === 'countered' && (
        <div className="offer-actions">
          <span className="offer-status status-countered" style={{ padding: '4px 12px' }}>Awaiting buyer response...</span>
        </div>
      )}
      {/* Sent offers - buyer actions */}
      {type === 'sent' && !isTerminalState && offer.status === 'countered' && (
        <div className="offer-actions">
          <button className="btn btn-primary btn-sm" onClick={async () => { 
            try { await api.patch(`/offers/${offer._id}/accept-counter`); toast.success('Counter accepted!'); fetchOffers(); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
          }}>
            <FaCheck size={12} /> Accept
          </button>
          <button className="btn btn-outline btn-sm" onClick={async () => { 
            const p = offer.counterAmount || offer.amount; 
            const currency = offer.currency || 'USD';
            const amt = prompt(`Counter (higher than ${currency} ${p}):`); 
            if (!amt || isNaN(amt)) return; 
            try { await api.patch(`/offers/${offer._id}/buyer-counter`, { counterAmount: Number(amt) }); toast.success('Counter sent'); fetchOffers(); } catch (e) { toast.error('Failed'); } 
          }}>
            <FaArrowUp size={12} /> Counter
          </button>
        </div>
      )}
      {type === 'sent' && offer.status === 'buyer_countered' && !isTerminalState && (
        <div className="offer-actions">
          <span className="offer-status status-countered" style={{ padding: '4px 12px' }}>Awaiting seller response...</span>
        </div>
      )}
      {/* Accepted offers - show purchase action for buyer */}
      {type === 'sent' && offer.status === 'accepted' && !isOfferExpired(offer) && (
        <div className="offer-actions">
          <Link to={`/listing/${offer.listing?._id}`} className="btn btn-primary btn-sm">
            Proceed to Purchase
          </Link>
        </div>
      )}
      {type === 'sent' && isOfferExpired(offer) && (
        <div className="offer-actions">
          <span className="offer-status status-expired" style={{ padding: '4px 12px' }}>⏰ Offer expired - make a new offer</span>
        </div>
      )}
    </div>
  );
};

  return (
    <div className="page-container">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><FaExchangeAlt /> Offers</h1>

      <div className="tabs" style={{ marginBottom: 'var(--td-space-lg)' }}>
        <button className={`tab ${activeTab === 'received' ? 'active' : ''}`} onClick={() => setActiveTab('received')}>
          Received ({receivedOffers.length})
        </button>
        <button className={`tab ${activeTab === 'sent' ? 'active' : ''}`} onClick={() => setActiveTab('sent')}>
          Sent ({sentOffers.length})
        </button>
      </div>

      <div className="offers-list">
        {activeTab === 'received' ? (
          receivedOffers.length === 0 ? (
            <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
              <div className="empty-state-icon">📩</div>
              <h2>No offers received</h2>
              <p>When buyers make offers on your items, they'll appear here.</p>
            </div>
          ) : receivedOffers.map(o => renderOfferCard(o, 'received'))
        ) : (
          sentOffers.length === 0 ? (
            <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
              <div className="empty-state-icon">📤</div>
              <h2>No offers sent</h2>
              <p>Browse listings and make offers on items you love.</p>
              <Link to="/search" className="btn btn-primary">Browse Items</Link>
            </div>
          ) : sentOffers.map(o => renderOfferCard(o, 'sent'))
        )}
      </div>
    </div>
  );
};

export default Offers;