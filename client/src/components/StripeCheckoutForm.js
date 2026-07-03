import React, { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { FaSpinner, FaCheckCircle, FaCreditCard, FaLock } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { formatPrice } from '../utils/helpers';

const StripeCheckoutForm = ({ amount, currency, totalAmount, onSuccess, onError, buttonText, items, shippingInfo }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [cardError, setCardError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Support both totalAmount (formatted string) and amount/currency (number) props
  const displayAmount = totalAmount || formatPrice(amount, currency || 'USD');

  const CARD_ELEMENT_OPTIONS = {
    style: {
      base: {
        fontSize: '16px',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        color: 'var(--td-text)',
        '::placeholder': {
          color: 'var(--td-text-tertiary)',
        },
        padding: '12px',
        iconColor: 'var(--td-primary)',
      },
      invalid: {
        color: 'var(--td-error)',
        iconColor: 'var(--td-error)',
      },
    },
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setCardError(null);

    try {
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: elements.getElement(CardElement),
      });

      if (error) {
        setCardError(error.message);
        setProcessing(false);
        return;
      }

      // Call parent's onSuccess with payment method
      await onSuccess(paymentMethod);
      setSuccess(true);
      toast.success('Payment successful! 🎉');
    } catch (err) {
      setCardError(err.message || 'Payment failed');
      onError?.(err);
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 'var(--td-space-xl)',
        animation: 'scaleIn 0.3s ease-out',
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(0, 200, 83, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto var(--td-space-md)',
        }}>
          <FaCheckCircle size={32} color="var(--td-success)" />
        </div>
        <h3 style={{ marginBottom: 8 }}>Payment Successful!</h3>
        <p style={{ color: 'var(--td-text-secondary)', fontSize: 14 }}>
          {displayAmount} has been processed.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{
        background: 'var(--td-surface)',
        border: '2px solid var(--td-border)',
        borderRadius: 'var(--td-radius-sm)',
        padding: 'var(--td-space-md)',
        marginBottom: 'var(--td-space-md)',
        transition: 'border-color 0.2s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <FaCreditCard color="var(--td-primary)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Card Details</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--td-text-tertiary)' }}>
            <FaLock size={10} /> Secured
          </span>
        </div>
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>

      {cardError && (
        <div style={{
          background: 'rgba(255, 23, 68, 0.06)',
          color: 'var(--td-error)',
          padding: '10px 14px',
          borderRadius: 'var(--td-radius-sm)',
          fontSize: 13,
          marginBottom: 'var(--td-space-md)',
        }}>
          {cardError}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-block btn-lg"
        disabled={!stripe || processing}
        style={{ position: 'relative' }}
      >
        {processing ? (
          <><FaSpinner className="spinner-sm" /> Processing...</>
        ) : (
          buttonText || `Pay ${displayAmount}`
        )}
      </button>

      <div style={{
        textAlign: 'center',
        marginTop: 12,
        fontSize: 12,
        color: 'var(--td-text-tertiary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}>
        <FaLock size={10} /> 
        Secured by Stripe • Your card info is encrypted
      </div>
    </form>
  );
};

export default StripeCheckoutForm;