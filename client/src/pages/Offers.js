import { defaultAvatar } from "../utils/helpers";
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import moment from 'moment';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const Offers = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('received');
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchOffers();
    // eslint-disable-next-line
  }, [user]);

  const fetchOffers = async () => {
    try {
      const [received, sent] = await Promise.all([
        api.get('/offers/received'),
        api.get('/offers/sent'),
      ]);
      setReceivedOffers(received.data);
      setSentOffers(sent.data);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const handleAccept = async (offerId) => {
    try {
      await api.patch(`/offers/${offerId}/accept`);
      toast.success('Offer accepted!');
      fetchOffers();
    } catch (error) {
      toast.error('Failed to accept offer');
    }
  };

  const handleDecline = async (offerId) => {
    try {
      await api.patch(`/offers/${offerId}/decline`);
      toast.success('Offer declined');
      fetchOffers();
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to decline offer';
      toast.error(msg);
    }
  };

   // Counter action for sellers (when viewing received offers)
   const handleSellerCounter = async (offer) => {
     const previous = offer.counterAmount || offer.amount;
     const amount = prompt(`Enter counter offer amount (must be higher than $${previous}):`);
     if (!amount || isNaN(amount)) return;
     try {
       await api.patch(`/offers/${offer._id}/counter`, { counterAmount: Number(amount) });
       toast.success('Counter offer sent!');
       fetchOffers();
     } catch (error) {
       const msg = error.response?.data?.message || 'Failed to send counter offer';
       toast.error(msg);
     }
   };

  if (!user) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <h2>Offers</h2>
          <p>Sign in to view your offers</p>
          <Link to="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page-container"><div className="spinner"></div></div>;

  const getStatusColor = (status) => {
    switch (status) {
      case 'accepted': return 'status-success';
      case 'completed': return 'status-success';
      case 'declined': return 'status-error';
      case 'countered': return 'status-warning';
      case 'buyer_countered': return 'status-warning';
      default: return 'status-pending';
    }
  };

  return (
    <div className="page-container">
      <h1 className="page-title">Offers</h1>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'received' ? 'active' : ''}`}
          onClick={() => setActiveTab('received')}
        >
          Received ({receivedOffers.length})
        </button>
        <button
          className={`tab ${activeTab === 'sent' ? 'active' : ''}`}
          onClick={() => setActiveTab('sent')}
        >
          Sent ({sentOffers.length})
        </button>
      </div>

      <div className="offers-list">
            {activeTab === 'received' && (
              receivedOffers.length === 0 ? (
                <div className="empty-state"><p>No offers received yet</p></div>
              ) : (
                receivedOffers.map((offer) => (
                  <div key={offer._id} className="offer-card">
                    <Link to={`/listing/${offer.listing?._id}`} className="offer-image">
                      <img src={offer.listing?.images?.[0] || defaultAvatar} alt="" />
                    </Link>
                    <div className="offer-details">
                      <h4>{offer.listing?.title}</h4>
                      <p>From: {offer.buyer?.name}</p>
                      <p>Offered: <strong>${offer.amount}</strong></p>
                      {offer.counterAmount && <p>Counter: <strong>${offer.counterAmount}</strong></p>}
                      <span className={`offer-status ${getStatusColor(offer.status)}`}>{offer.status}</span>
                      <p className="offer-time">{moment(offer.createdAt).fromNow()}</p>
                    </div>
                    {/* Seller actions for pending offers */}
                    {offer.status === 'pending' && (
                      <div className="offer-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => handleAccept(offer._id)}>
                          Accept
                        </button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleSellerCounter(offer)}>
                      Counter
                    </button>
                        <button className="btn btn-sm" onClick={() => handleDecline(offer._id)}>
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )
            )}

        {activeTab === 'sent' && (
          sentOffers.length === 0 ? (
            <div className="empty-state"><p>No offers sent yet</p></div>
          ) : (
            sentOffers.map((offer) => (
                <div key={offer._id} className="offer-card">
                  <Link to={`/listing/${offer.listing?._id}`} className="offer-image">
                    <img src={offer.listing?.images?.[0] || defaultAvatar} alt="" />
                  </Link>
                  <div className="offer-details">
                    <h4>{offer.listing?.title}</h4>
                    <p>To: {offer.seller?.name}</p>
                    <p>Offered: <strong>${offer.amount}</strong></p>
                    {offer.counterAmount && <p>Counter: <strong>${offer.counterAmount}</strong></p>}
                    <span className={`offer-status ${getStatusColor(offer.status)}`}>
                      {offer.status}
                    </span>
                    <p className="offer-time">{moment(offer.createdAt).fromNow()}</p>
                  </div>
                  {/* Buyer actions when seller has countered */}
                  {offer.status === 'countered' && (
                    <div className="offer-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          try {
                            // Accept the counter (sets status to accepted). Payment will be handled separately.
                            await api.patch(`/offers/${offer._id}/accept-counter`);
                            toast.success('Counter accepted. Please proceed to payment.');
                            fetchOffers();
                          } catch (e) {
                            const msg = e.response?.data?.message || 'Failed to accept counter';
                            toast.error(msg);
                          }
                        }}
                      >
                        Accept Counter
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={async () => {
                          const previous = offer.counterAmount || offer.amount;
                          const amount = prompt(`Enter new counter amount (must be higher than $${previous}):`);
                          if (!amount || isNaN(amount)) return;
                          try {
                            await api.patch(`/offers/${offer._id}/buyer-counter`, { counterAmount: Number(amount) });
                            toast.success('Counter sent');
                            fetchOffers();
                          } catch (e) {
                            const msg = e.response?.data?.message || 'Failed to send counter';
                            toast.error(msg);
                          }
                        }}
                      >
                        Counter Again
                      </button>
                    </div>
                  )}
                </div>
            ))
          )
        )}
      </div>
    </div>
  );
};

export default Offers;