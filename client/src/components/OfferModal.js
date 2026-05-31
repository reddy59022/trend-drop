import React, { useState } from 'react';
import { FaTimes, FaSpinner, FaGavel, FaMoneyBillWave } from 'react-icons/fa';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/helpers';

const OfferModal = ({ listing, isOpen, onClose, onOfferSubmitted }) => {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !listing) return null;

  const minOffer = listing.price * 0.5;
  const maxOffer = listing.price;
  const suggestions = [
    { label: '25% off', value: listing.price * 0.75 },
    { label: '15% off', value: listing.price * 0.85 },
    { label: '10% off', value: listing.price * 0.9 },
  ];

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
      await api.post('/offers', {
        listingId: listing._id,
        amount: offerAmount,
        message: message.trim(),
      });
      toast.success('Offer sent successfully!');
      onOfferSubmitted?.();
      onClose();
    } catch (error) {
      const errMsg = error.response?.data?.message || 'Failed to send offer';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2><FaGavel style={{ marginRight: 8, color: 'var(--td-primary)' }} /> Make an Offer</h2>
          <button className="modal-close" onClick={onClose}><FaTimes /></button>
        </div>

        <div className="modal-body">
          {/* Listing Preview */}
          <div className="offer-listing-info glass-card" style={{ padding: 12, marginBottom: 16 }}>
            <img
              src={listing.images?.[0]}
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
                  position: 'absolute',
                  left: 14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontWeight: 700,
                  color: 'var(--td-text-tertiary)',
                  fontSize: 16,
                }}>
                  $
                </span>
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
        </div>
      </div>
    </div>
  );
};

export default OfferModal;