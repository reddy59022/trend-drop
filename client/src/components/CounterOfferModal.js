import React, { useState, useEffect } from 'react';
import { FaTimes, FaSpinner, FaExchangeAlt, FaArrowUp, FaDollarSign } from 'react-icons/fa';
import api from '../services/api';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/helpers';

/**
 * CounterOfferModal - Reusable counter-offer dialog for Offers page
 * 
 * Features:
 * - Matches app standard modal design (modal-overlay + modal)
 * - Validation: amount must be > previous amount AND > $50
 * - Inline error display
 * - Loading states
 * - Proper currency formatting
 */
const CounterOfferModal = ({ 
  isOpen, 
  onClose, 
  offer, 
  type, // 'received' (seller countering) or 'sent' (buyer countering)
  onCounterSubmitted 
}) => {
  const [counterAmount, setCounterAmount] = useState('');
  const [counterMessage, setCounterMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Calculate minimum allowed amount when offer changes
  useEffect(() => {
    if (offer) {
      const previousAmount = offer.counterAmount || offer.amount;
      // Must be higher than previous amount AND at least $50
      const minAmount = Math.max(previousAmount + 0.01, 50);
      // If current value is below minimum, clear it
      if (counterAmount && parseFloat(counterAmount) < minAmount) {
        setCounterAmount('');
      }
    }
  }, [offer, counterAmount]);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCounterAmount('');
      setCounterMessage('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen || !offer) return null;

  const previousAmount = offer.counterAmount || offer.amount;
  const currency = offer.currency || 'USD';
  const minAllowed = Math.max(previousAmount + 0.01, 50);

  const isBuyer = type === 'sent';
  const actionLabel = isBuyer ? 'Counter' : 'Send Counter';
  // const icon = isBuyer ? FaArrowUp : FaExchangeAlt; // Used inline below

  const validateAmount = (value) => {
    const num = parseFloat(value);
    if (!value || isNaN(num)) {
      return 'Please enter a valid amount';
    }
    if (num <= previousAmount) {
      return `Must be higher than ${formatPrice(previousAmount, currency)}`;
    }
    if (num < 50) {
      return 'Counter offer must be at least $50.00';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const validationError = validateAmount(counterAmount);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const counterVal = parseFloat(counterAmount);
      let endpoint, payload;

      if (isBuyer) {
        // Buyer countering seller's counter
        endpoint = `/offers/${offer._id}/buyer-counter`;
        payload = { counterAmount: counterVal, message: counterMessage.trim() };
      } else {
        // Seller countering buyer's offer/counter
        endpoint = `/offers/${offer._id}/counter`;
        payload = { counterAmount: counterVal };
      }

      const res = await api.patch(endpoint, payload);
      
      toast.success('Counter offer sent!');
      onCounterSubmitted?.(res.data);
      onClose();
    } catch (error) {
      const errMsg = error.response?.data?.message || 'Failed to send counter offer';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAmountChange = (e) => {
    const value = e.target.value;
    setCounterAmount(value);
    // Clear error when user starts typing
    if (error) setError('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>
            <FaExchangeAlt style={{ marginRight: 8, color: 'var(--td-primary)' }} />
            Counter Offer
          </h2>
          <button className="modal-close" onClick={onClose} disabled={submitting}>
            <FaTimes />
          </button>
        </div>

        <div className="modal-body">
          {/* Context Info */}
          <div className="glass-card" style={{ padding: 16, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>Current Offer</span>
              <strong style={{ fontSize: 18, color: 'var(--td-primary)' }}>
                {formatPrice(previousAmount, currency)}
              </strong>
            </div>
            {offer.counterAmount && (
              <div style={{ fontSize: 11, color: 'var(--td-text-secondary)' }}>
                {isBuyer ? 'Seller countered at this price' : 'Buyer offered this amount'}
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Your Counter Offer</label>
              <div style={{ position: 'relative' }}>
                <FaDollarSign style={{
                  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                  fontWeight: 700, color: 'var(--td-text-tertiary)', fontSize: 18,
                }} />
                <input
                  type="number"
                  className={`form-input ${error ? 'form-input-error' : ''}`}
                  placeholder={`Min: ${formatPrice(minAllowed, currency)}`}
                  value={counterAmount}
                  onChange={handleAmountChange}
                  min={minAllowed}
                  step="0.01"
                  style={{ paddingLeft: 36, fontSize: 20, fontWeight: 700 }}
                  required
                  disabled={submitting}
                  autoFocus
                />
              </div>
              <div className="form-hint" style={{ marginTop: 6 }}>
                Must be higher than {formatPrice(previousAmount, currency)} and at least $50.00
              </div>
              {error && (
                <div className="form-error" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FaTimes style={{ fontSize: 10 }} />
                  {error}
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Message (Optional)</label>
              <textarea
                className="form-input"
                placeholder="Add a note..."
                value={counterMessage}
                onChange={(e) => setCounterMessage(e.target.value)}
                maxLength={500}
                rows={2}
                disabled={submitting}
              />
              <div className="form-hint" style={{ textAlign: 'right' }}>{counterMessage.length}/500</div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                className="btn btn-outline btn-block"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <FaSpinner className="spinner-sm" />
                    Sending...
                  </>
                ) : (
                  <>
                    <FaArrowUp size={14} /> {actionLabel}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CounterOfferModal;
