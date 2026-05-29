import React, { useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import api from '../services/api';
import { toast } from 'react-toastify';

const OfferModal = ({ listing, isOpen, onClose, onOfferSubmitted }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (Number(amount) >= listing.price) {
      toast.error('Offer must be less than the listing price');
      return;
    }

    setLoading(true);
    try {
      await api.post('/offers', { listingId: listing._id, amount: Number(amount) });
      toast.success('Offer submitted successfully!');
      setAmount('');
      onOfferSubmitted?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to submit offer');
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Make an Offer</h2>
          <button className="modal-close" onClick={onClose}>
            <FaTimes />
          </button>
        </div>
        <div className="modal-body">
          <div className="offer-listing-info">
            <img
              src={listing.images?.[0] || 'https://via.placeholder.com/80'}
              alt={listing.title}
              className="offer-listing-image"
            />
            <div>
              <h4>{listing.title}</h4>
              <p className="offer-listing-price">Listed at: ${listing.price}</p>
            </div>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="offerAmount">Your Offer ($)</label>
              <input
                type="number"
                id="offerAmount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="1"
                step="0.01"
                required
                className="form-input"
              />
            </div>
            <p className="offer-note">
              You can negotiate with the seller through counter offers.
            </p>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Offer'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OfferModal;