import React, { useState, useEffect } from 'react';
import { FaTimes, FaSpinner, FaGavel, FaMoneyBillWave, FaHistory, FaCheck, FaArrowRight, FaUser, FaStore } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/helpers';

/**
 * OfferModal - Full Counter-Offer Chain Support (v14.0)
 * 
 * Supports:
 * - Initial offer creation
 * - Counter-offer history display
 * - Buyer countering seller's counter
 * - Buyer accepting seller's counter
 * - Shows who needs to act next
 */
const OfferModal = ({ listing, isOpen, onClose, onOfferSubmitted, existingOffer }) => {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [offer, setOffer] = useState(existingOffer || null);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterMessage, setCounterMessage] = useState('');

  // Load existing offer if provided
  useEffect(() => {
    if (existingOffer) {
      setOffer(existingOffer);
    } else if (listing?._id && user) {
      // Fetch buyer's offer for this listing
      fetchBuyerOffer();
    }
  }, [existingOffer, listing?._id]);

  const fetchBuyerOffer = async () => {
    try {
      const res = await api.get(`/offers/listing/${listing._id}/buyer`);
      if (res.data) {
        setOffer(res.data);
      }
    } catch (err) {
      // No offer exists yet
    }
  };

  if (!isOpen || !listing) return null;

  const isBuyer = user?._id === listing?.buyer?._id || user?._id !== listing?.seller?._id;
  const minOffer = listing.price * 0.5;
  const maxOffer = listing.price;
  const suggestions = [
    { label: '25% off', value: listing.price * 0.75 },
    { label: '15% off', value: listing.price * 0.85 },
    { label: '10% off', value: listing.price * 0.9 },
  ];

  // Determine what actions are available
  const canMakeOffer = !offer || offer.status === 'declined' || offer.status === 'expired';
  const canCounter = offer?.status === 'countered' && isBuyer; // Buyer can counter seller's counter
  const canAcceptCounter = offer?.status === 'countered' && isBuyer; // Buyer can accept seller's counter
  const isWaitingForSeller = offer?.status === 'pending' || offer?.status === 'buyer_countered';
  const isAccepted = offer?.status === 'accepted';
  const isCompleted = offer?.status === 'completed';

  // Get the current active price
  const getCurrentPrice = () => {
    if (isAccepted && offer.acceptedPrice) return offer.acceptedPrice;
    if (offer?.counterAmount) return offer.counterAmount;
    return offer?.amount || listing.price;
  };

  // Handle initial offer submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error('Please login to make an offer');
      return;
    }
    const offerAmount = parseFloat(amount);
    if (!offerAmount || offerAmount <= 0) {
      toast.error('Please enter a valid offer amount');
      return;
    }
    if (offerAmount < listing.price * 0.5) {
      toast.error('Offer must be at least 50% of the listing price');
      return;
    }
    if (offerAmount > listing.price) {
      toast.error('Offer cannot exceed the listing price');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/offers', {
        listingId: listing._id,
        amount: offerAmount,
        message: message.trim(),
      });
      setOffer(res.data);
      toast.success('Offer sent successfully!');
      onOfferSubmitted?.(res.data);
    } catch (error) {
      const errMsg = error.response?.data?.message || 'Failed to send offer';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle buyer countering seller's counter
  const handleBuyerCounter = async (e) => {
    e.preventDefault();
    const counterVal = parseFloat(counterAmount);
    if (!counterVal || counterVal <= 0) {
      toast.error('Please enter a valid counter amount');
      return;
    }
    if (counterVal <= (offer.counterAmount || offer.amount)) {
      toast.error(`Counter must be higher than ${formatPrice(offer.counterAmount || offer.amount, offer.currency)}`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.patch(`/offers/${offer._id}/buyer-counter`, {
        counterAmount: counterVal,
        message: counterMessage.trim(),
      });
      setOffer(res.data);
      setCounterAmount('');
      setCounterMessage('');
      toast.success('Counter sent!');
      onOfferSubmitted?.(res.data);
    } catch (error) {
      const errMsg = error.response?.data?.message || 'Failed to send counter';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle buyer accepting seller's counter
  const handleAcceptCounter = async () => {
    setSubmitting(true);
    try {
      const res = await api.patch(`/offers/${offer._id}/accept-counter`);
      setOffer(res.data.offer);
      toast.success(`Offer accepted at ${formatPrice(res.data.finalPrice, offer.currency)}! Proceed to purchase.`);
      onOfferSubmitted?.(res.data.offer);
    } catch (error) {
      const errMsg = error.response?.data?.message || 'Failed to accept counter';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  // Render counter-offer history
  const renderHistory = () => {
    if (!offer?.counterHistory || offer.counterHistory.length === 0) return null;

    return (
      <div className="offer-history" style={{ marginTop: 16, marginBottom: 16 }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}>
          <FaHistory /> Negotiation History
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {offer.counterHistory.map((entry, idx) => (
            <div
              key={idx}
              className="glass-card"
              style={{
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                borderLeft: `3px solid ${entry.counteredBy === 'buyer' ? 'var(--td-primary)' : 'var(--td-success)'}`,
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: entry.counteredBy === 'buyer' ? 'var(--td-primary)' : 'var(--td-success)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: 14,
              }}>
                {entry.counteredBy === 'buyer' ? <FaUser /> : <FaStore />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {entry.counteredBy === 'buyer' ? 'You' : 'Seller'} offered {formatPrice(entry.amount, offer.currency)}
                </div>
                {entry.message && (
                  <div style={{ fontSize: 12, color: 'var(--td-text-secondary)', marginTop: 2 }}>
                    "{entry.message}"
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--td-text-tertiary)', marginTop: 2 }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </div>
              </div>
              {idx < offer.counterHistory.length - 1 && (
                <FaArrowRight style={{ color: 'var(--td-text-tertiary)', fontSize: 12 }} />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render status badge
  const renderStatus = () => {
    const statusConfig = {
      pending: { color: 'var(--td-warning)', text: 'Waiting for Seller', icon: FaSpinner },
      countered: { color: 'var(--td-primary)', text: 'Seller Countered - Your Turn', icon: FaArrowRight },
      buyer_countered: { color: 'var(--td-info)', text: 'Waiting for Seller', icon: FaSpinner },
      accepted: { color: 'var(--td-success)', text: 'Accepted - Ready to Purchase', icon: FaCheck },
      completed: { color: 'var(--td-success)', text: 'Completed', icon: FaCheck },
      declined: { color: 'var(--td-danger)', text: 'Declined', icon: FaTimes },
      expired: { color: 'var(--td-text-tertiary)', text: 'Expired', icon: FaTimes },
    };
    const config = statusConfig[offer?.status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 20,
        background: `${config.color}22`, color: config.color,
        fontSize: 12, fontWeight: 600,
      }}>
        <Icon size={12} className={offer?.status === 'pending' || offer?.status === 'buyer_countered' ? 'spinner-sm' : ''} />
        {config.text}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2><FaGavel style={{ marginRight: 8, color: 'var(--td-primary)' }} /> 
            {offer ? 'Offer Details' : 'Make an Offer'}
          </h2>
          <button className="modal-close" onClick={onClose}><FaTimes /></button>
        </div>

        <div className="modal-body">
          {/* Listing Preview */}
          <div className="offer-listing-info glass-card" style={{ padding: 12, marginBottom: 16 }}>
            <img
              src={listing.images?.[0] || ''}
              alt={listing.title}
              className="offer-listing-image"
            />
            <div>
              <h4 style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{listing.title}</h4>
              <div className="offer-listing-price">{formatPrice(listing.price, listing.currency || 'USD')}</div>
              <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginTop: 2 }}>
                {listing.condition} • {listing.brand || 'No brand'}
              </div>
            </div>
          </div>

          {/* Existing Offer View */}
          {offer && offer.status !== 'declined' && offer.status !== 'expired' && (
            <>
              {/* Status */}
              <div style={{ marginBottom: 16 }}>
                {renderStatus()}
              </div>

              {/* Current Price */}
              <div className="glass-card" style={{ padding: 16, marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--td-text-secondary)', marginBottom: 4 }}>
                  {isAccepted ? 'Accepted Price' : 'Current Offer'}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: isAccepted ? 'var(--td-success)' : 'var(--td-primary)' }}>
                  {formatPrice(getCurrentPrice(), offer.currency)}
                </div>
                {isAccepted && (
                  <div style={{ fontSize: 12, color: 'var(--td-success)', marginTop: 4 }}>
                    You can now purchase at this price!
                  </div>
                )}
              </div>

              {/* Counter-Offer History */}
              {renderHistory()}

              {/* Actions based on status */}
              {canCounter && (
                <form onSubmit={handleBuyerCounter} style={{ marginTop: 16 }}>
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">Your Counter Offer</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                        fontWeight: 700, color: 'var(--td-text-tertiary)', fontSize: 16,
                      }}>$</span>
                      <input
                        type="number"
                        className="form-input"
                        placeholder={`Min: $${((offer.counterAmount || offer.amount) + 1).toFixed(0)}`}
                        value={counterAmount}
                        onChange={(e) => setCounterAmount(e.target.value)}
                        min={(offer.counterAmount || offer.amount) + 1}
                        step="0.01"
                        style={{ paddingLeft: 32, fontSize: 18, fontWeight: 700 }}
                        required
                      />
                    </div>
                    <div className="form-hint" style={{ marginTop: 4 }}>
                      Must be higher than seller's counter of {formatPrice(offer.counterAmount, offer.currency)}
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <textarea
                      className="form-input"
                      placeholder="Add a message (optional)..."
                      value={counterMessage}
                      onChange={(e) => setCounterMessage(e.target.value)}
                      maxLength={500}
                      rows={2}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      type="button"
                      className="btn btn-success btn-block"
                      onClick={handleAcceptCounter}
                      disabled={submitting}
                    >
                      {submitting ? <FaSpinner className="spinner-sm" /> : <><FaCheck /> Accept {formatPrice(offer.counterAmount, offer.currency)}</>}
                    </button>
                    <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                      {submitting ? <FaSpinner className="spinner-sm" /> : 'Counter'}
                    </button>
                  </div>
                </form>
              )}

              {isWaitingForSeller && (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--td-text-secondary)' }}>
                  <FaSpinner className="spinner-sm" style={{ marginRight: 8 }} />
                  Waiting for seller to respond...
                </div>
              )}

              {isAccepted && !isCompleted && (
                <button
                  className="btn btn-success btn-block"
                  onClick={() => {
                    onOfferSubmitted?.(offer);
                    onClose();
                  }}
                >
                  <FaCheck /> Proceed to Purchase at {formatPrice(offer.acceptedPrice, offer.currency)}
                </button>
              )}
            </>
          )}

          {/* New Offer Form */}
          {canMakeOffer && (
            <form onSubmit={handleSubmit}>
              {/* Quick Suggestions */}
              <div style={{ marginBottom: 16 }}>
                <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Quick Offer</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {suggestions.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={`btn btn-sm ${amount === s.value.toString() ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setAmount(s.value.toString())}
                    >
                      <FaMoneyBillWave size={12} /> {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Amount */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Your Offer</label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    fontWeight: 700, color: 'var(--td-text-tertiary)', fontSize: 16,
                  }}>$</span>
                  <input
                    type="number"
                    className="form-input"
                    placeholder={`Min: $${minOffer.toFixed(0)}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min={minOffer}
                    max={maxOffer}
                    step="0.01"
                    style={{ paddingLeft: 32, fontSize: 18, fontWeight: 700 }}
                    required
                  />
                </div>
                <div className="form-hint" style={{ marginTop: 4 }}>
                  Offer must be between {formatPrice(minOffer, listing.currency)} and {formatPrice(maxOffer, listing.currency)}
                </div>
              </div>

              {/* Message */}
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Message (Optional)</label>
                <textarea
                  className="form-input"
                  placeholder="Add a note to the seller..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={500}
                  rows={3}
                />
                <div className="form-hint" style={{ textAlign: 'right' }}>{message.length}/500</div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-outline btn-block" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                  {submitting ? <><FaSpinner className="spinner-sm" /> Sending...</> : 'Send Offer'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfferModal;