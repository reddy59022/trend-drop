import React from 'react';
import { Link } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCart } from '../context/CartContext';
import { toast } from 'react-toastify';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';
import StripeCheckoutForm from '../components/StripeCheckoutForm';

const Cart = () => {
  const { cart, removeFromCart, updateQuantity, clearCart, totalAmount } = useCart();
  const [stripePromise, setStripePromise] = React.useState(null);
  const [showForm, setShowForm] = React.useState(false);
  const [shippingInfo, setShippingInfo] = React.useState({
    fullName: '', street1: '', city: '', state: '', postalCode: '', country: 'US', phone: ''
  });

  // Load Stripe publishable key once
  React.useEffect(() => {
    const initStripe = async () => {
      try {
        const res = await api.get('/payments/publishable-key');
        if (res.data.publishableKey && res.data.publishableKey !== 'pk_test_placeholder') {
          setStripePromise(loadStripe(res.data.publishableKey));
        }
      } catch (e) {
        console.warn('Stripe init warning:', e);
      }
    };
    initStripe();
  }, []);

  const handleCheckout = async () => {
    if (cart.length === 0) return toast.error('Cart is empty');

    // Validate inventory against live server data
    try {
      for (const item of cart) {
        const res = await api.get(`/listings/${item.listingId}`);
        const listing = res.data.listing;
        if (!listing.available || listing.sold) {
          toast.error(`"${listing.title}" is no longer available`);
          return;
        }
        if (listing.quantity < item.quantity) {
          toast.error(`Only ${listing.quantity} left of "${listing.title}"`);
          return;
        }
      }
    } catch (error) {
      toast.error('Failed to verify item availability');
      return;
    }

    setShowForm(true);
  };

  const handleSuccess = () => {
    clearCart();
    setShowForm(false);
  };

  const grandTotal = totalAmount();

  return (
    <div className="page-container" style={{ padding: '20px' }}>
      <h2 style={{ textAlign: 'center', color: '#2c3e50' }}>Your Bag</h2>
      {cart.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '40px' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🛍️</div>
          <p style={{ fontSize: '18px', color: '#555' }}>Your bag is empty! 🎉</p>
          <p style={{ color: '#777' }}>Browse our collection and add items you love.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: '20px' }}>
            Continue Shopping
          </Link>
        </div>
      ) : (
        <div>
          <table className="cart-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ padding: '10px' }}>Item</th>
                <th style={{ padding: '10px' }}>Price</th>
                <th style={{ padding: '10px' }}>Qty</th>
                <th style={{ padding: '10px' }}>Total</th>
                <th style={{ padding: '10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => (
                <tr key={item.listingId} style={{ borderBottom: '1px solid #eaeaea' }}>
                  <td style={{ padding: '10px' }}>{item.title}</td>
                  <td style={{ padding: '10px' }}>{formatPrice(item.price, item.currency)}</td>
                  <td style={{ padding: '10px' }}>
                    <button className="btn btn-sm" onClick={() => updateQuantity(item.listingId, item.quantity - 1)}>-</button>
                    <span style={{ margin: '0 8px' }}>{item.quantity}</span>
                    <button className="btn btn-sm" onClick={() => {
                      if (item.quantity < (item.available || Infinity)) {
                        updateQuantity(item.listingId, item.quantity + 1);
                      } else {
                        toast.error(`Only ${item.available} available`);
                      }
                    }}>+</button>
                  </td>
                  <td style={{ padding: '10px' }}>{formatPrice(item.price * item.quantity, item.currency)}</td>
                  <td style={{ padding: '10px' }}>
                    <button className="btn btn-outline" onClick={() => removeFromCart(item.listingId)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" style={{ textAlign: 'right', fontWeight: 'bold', padding: '10px' }}>Grand Total:</td>
                <td style={{ padding: '10px' }}>{formatPrice(grandTotal, 'USD')}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          <div style={{ textAlign: 'right', marginTop: '20px' }}>
            {!showForm && (
              <button className="btn btn-primary" onClick={handleCheckout} disabled={cart.length === 0}>
                Proceed to Checkout
              </button>
            )}
          </div>

          {showForm && (
            <div className="checkout-form" style={{ marginTop: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
              <h3 style={{ marginBottom: '15px' }}>Shipping & Payment Details</h3>

              {/* Shipping Info Form */}
              <div style={{ display: 'grid', gap: '10px', marginBottom: '20px' }}>
                <input type="text" placeholder="Full Name" value={shippingInfo.fullName}
                  onChange={e => setShippingInfo({ ...shippingInfo, fullName: e.target.value })} required style={{ padding: '8px' }} />
                <input type="text" placeholder="Street Address" value={shippingInfo.street1}
                  onChange={e => setShippingInfo({ ...shippingInfo, street1: e.target.value })} required style={{ padding: '8px' }} />
                <input type="text" placeholder="City" value={shippingInfo.city}
                  onChange={e => setShippingInfo({ ...shippingInfo, city: e.target.value })} required style={{ padding: '8px' }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <input type="text" placeholder="State" value={shippingInfo.state}
                    onChange={e => setShippingInfo({ ...shippingInfo, state: e.target.value })} required style={{ padding: '8px', flex: 1 }} />
                  <input type="text" placeholder="Postal Code" value={shippingInfo.postalCode}
                    onChange={e => setShippingInfo({ ...shippingInfo, postalCode: e.target.value })} required style={{ padding: '8px', flex: 1 }} />
                </div>
                <input type="text" placeholder="Country (ISO code, e.g. US)" value={shippingInfo.country}
                  onChange={e => setShippingInfo({ ...shippingInfo, country: e.target.value })} required style={{ padding: '8px' }} />
                <input type="text" placeholder="Phone" value={shippingInfo.phone}
                  onChange={e => setShippingInfo({ ...shippingInfo, phone: e.target.value })} style={{ padding: '8px' }} />
              </div>

              {/* Stripe Card Element */}
              {stripePromise ? (
                <Elements stripe={stripePromise}>
                  <StripeCheckoutForm
                    items={cart}
                    shippingInfo={shippingInfo}
                    totalAmount={formatPrice(grandTotal, 'USD')}
                    onSuccess={handleSuccess}
                    onCancel={() => setShowForm(false)}
                  />
                </Elements>
              ) : (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <p>Loading payment system...</p>
                  <p style={{ fontSize: 12, color: '#888' }}>
                    Make sure STRIPE_PUBLISHABLE_KEY is set in your .env file
                  </p>
                  <button className="btn btn-outline" onClick={() => setShowForm(false)} style={{ marginTop: 12 }}>
                    Back
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Cart;