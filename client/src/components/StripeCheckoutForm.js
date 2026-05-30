import React, { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'react-toastify';
import api from '../services/api';

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: '16px',
      color: '#424770',
      fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
      '::placeholder': { color: '#aab7c4' },
    },
    invalid: { color: '#9e2146', iconColor: '#9e2146' },
  },
  hidePostalCode: false,
};

const StripeCheckoutForm = ({ items, shippingInfo, onSuccess, onCancel, totalAmount }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!stripe || !elements) {
      setError('Stripe not initialized. Please wait...');
      return;
    }

    // Validate shipping
    if (!shippingInfo.fullName || !shippingInfo.street1) {
      setError('Please fill in shipping details');
      return;
    }

    setProcessing(true);

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Step 1: Create PaymentIntent on server
        const intentRes = await api.post('/payments/create-intent', {
          listingId: item.listingId,
          shippingAddress: shippingInfo,
          buyerCountry: shippingInfo.country || 'US',
        });

        const { clientSecret, paymentIntentId } = intentRes.data;

        if (!clientSecret) {
          throw new Error('Failed to get payment authorization. Please try again.');
        }

        // Step 2: Confirm the payment with Stripe.js (real card tokenization)
        // The clientSecret contains the PI id + secret, Stripe.js handles the rest
        const result = await stripe.confirmCardPayment(clientSecret, {
          payment_method: {
            card: elements.getElement(CardElement),
            billing_details: {
              name: shippingInfo.fullName,
              address: {
                line1: shippingInfo.street1,
                line2: shippingInfo.street2 || '',
                city: shippingInfo.city || '',
                state: shippingInfo.state || '',
                postal_code: shippingInfo.postalCode || '',
                country: shippingInfo.country || 'US',
              },
            },
          },
        });

        if (result.error) {
          // Show specific Stripe error messages
          const stripeMsg = result.error.message || 'Card declined';
          const code = result.error.code || '';
          let userMsg = stripeMsg;
          if (code === 'card_declined') userMsg = 'Your card was declined. Please try another card.';
          else if (code === 'incorrect_cvc') userMsg = 'Incorrect CVC. Please check your card.';
          else if (code === 'expired_card') userMsg = 'Card expired. Please use a different card.';
          else if (code === 'processing_error') userMsg = 'Processing error. Please try again.';
          throw new Error(userMsg);
        }

        const paymentIntent = result.paymentIntent;

        // With auth-only flow, status will be 'requires_capture' (not 'succeeded')
        // This means the card was authorized but NOT charged yet
        if (paymentIntent.status !== 'requires_capture') {
          throw new Error(`Payment authorization failed. Status: ${paymentIntent.status}`);
        }

        // Step 3: Confirm with our server (fulfills, captures, updates inventory)
        const confirmRes = await api.post('/payments/confirm', {
          paymentIntentId,
          listingId: item.listingId,
          shippingAddress: shippingInfo,
        });

        if (!confirmRes.data.transaction) {
          throw new Error(confirmRes.data.message || 'Failed to create order');
        }
      }

      // All items purchased successfully
      toast.success('All purchases completed successfully!');
      onSuccess();

    } catch (err) {
      console.error('Checkout error:', err);
      const errorMsg = err.response?.data?.message || err.message || 'Payment failed';
      setError(errorMsg);
      toast.error(errorMsg);
    }

    setProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 8, padding: 10, background: '#f0fdf4', borderRadius: 8 }}>
        🔒 Your card will be authorized but <strong>not charged</strong> until the seller fulfills your order.
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 14 }}>
          Card Details
        </label>
        <div style={{
          padding: '14px 12px',
          border: '1px solid #ddd',
          borderRadius: 8,
          background: '#fafafa',
        }}>
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          Stripe test card: 4242 4242 4242 4242 | Any future expiry | Any 3-digit CVC
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12, borderRadius: 8, background: '#fef2f2', color: '#ef4444',
          fontSize: 14, border: '1px solid #fecaca',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!stripe || processing}
          style={{ flex: 1, padding: '12px 24px', fontSize: 16 }}
        >
          {processing ? 'Processing Payment...' : `Pay ${totalAmount}`}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={onCancel}
          disabled={processing}
          style={{ padding: '12px 24px' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default StripeCheckoutForm;