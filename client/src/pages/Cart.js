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

    // Verify Stripe is loaded before showing checkout
    if (!stripePromise) {
      toast.error('Payment system not loaded. Please refresh the page.');
      return;
    }

    setShowForm(true);
  };

  const handleSuccess = () => {
    clearCart();
    setShowForm(false);
  };

  // Calculate full breakdown with shipping and buyer protection for display
  const [itemBreakdowns, setItemBreakdowns] = React.useState({});

  React.useEffect(() => {
    // Fetch breakdown for each item when cart changes
    const fetchBreakdowns = async () => {
      const breakdowns = {};
      for (const item of cart) {
        try {
          const res = await api.post('/payments/breakdown', {
            itemPrice: item.price,
            fromCountry: 'US',
            toCountry: shippingInfo.country || 'US',
            weightKg: 0.5,
          });
          breakdowns[item.listingId] = res.data;
        } catch (e) {
          // Fallback: calculate locally
          const shippingFee = 3.99;
          const protectionFee = Math.round(item.price * 0.05 * 100) / 100;
          breakdowns[item.listingId] = {
            buyer: {
              itemPrice: item.price,
              shippingCost: shippingFee,
              buyerProtectionFee: protectionFee,
              totalPaid: Math.round((item.price + shippingFee + protectionFee) * 100) / 100,
            },
          };
        }
      }
      setItemBreakdowns(breakdowns);
    };

    if (cart.length > 0) {
      fetchBreakdowns();
    }
  }, [cart, shippingInfo.country]);

  // Calculate totals with fees
  let subtotalItems = 0;
  let totalShipping = 0;
  let totalProtection = 0;
  let grandTotal = 0;

  cart.forEach(item => {
    const bd = itemBreakdowns[item.listingId];
    if (bd && bd.buyer) {
      subtotalItems += bd.buyer.itemPrice * item.quantity;
      totalShipping += bd.buyer.shippingCost * item.quantity;
      totalProtection += bd.buyer.buyerProtectionFee * item.quantity;
      grandTotal += bd.buyer.totalPaid * item.quantity;
    } else {
      // Fallback before breakdown loads
      subtotalItems += item.price * item.quantity;
      grandTotal += item.price * item.quantity;
    }
  });

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
                <th style={{ padding: '10px' }}>Subtotal</th>
                <th style={{ padding: '10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => {
                const bd = itemBreakdowns[item.listingId];
                return (
                  <tr key={item.listingId} style={{ borderBottom: '1px solid #eaeaea' }}>
                    <td style={{ padding: '10px' }}>
                      {item.title}
                      {item.negotiatedPrice && (
                        <div style={{ fontSize: 11, color: '#10b981' }}>Negotiated price</div>
                      )}
                    </td>
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
                );
              })}
            </tbody>
            <tfoot>
              {cart.length > 0 && Object.keys(itemBreakdowns).length > 0 && (
                <>
                  <tr style={{ background: '#f9f9f9' }}>
                    <td colSpan="3" style={{ textAlign: 'right', padding: '8px 10px', fontSize: 14 }}>Items Subtotal:</td>
                    <td style={{ padding: '8px 10px', fontSize: 14 }}>{formatPrice(subtotalItems, 'USD')}</td>
                    <td></td>
                  </tr>
                  <tr style={{ background: '#f9f9f9' }}>
                    <td colSpan="3" style={{ textAlign: 'right', padding: '8px 10px', fontSize: 14 }}>Shipping:</td>
                    <td style={{ padding: '8px 10px', fontSize: 14 }}>{formatPrice(totalShipping, 'USD')}</td>
                    <td></td>
                  </tr>
                  <tr style={{ background: '#f9f9f9' }}>
                    <td colSpan="3" style={{ textAlign: 'right', padding: '8px 10px', fontSize: 14 }}>Buyer Protection (5%):</td>
                    <td style={{ padding: '8px 10px', fontSize: 14 }}>{formatPrice(totalProtection, 'USD')}</td>
                    <td></td>
                  </tr>
                  <tr style={{ borderTop: '2px solid #333' }}>
                    <td colSpan="3" style={{ textAlign: 'right', fontWeight: 'bold', padding: '12px 10px', fontSize: 16 }}>Grand Total:</td>
                    <td style={{ padding: '12px 10px', fontWeight: 'bold', fontSize: 18, color: '#FF4D6D' }}>{formatPrice(grandTotal, 'USD')}</td>
                    <td></td>
                  </tr>
                </>
              )}
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

              {/* Full Order Summary Before Payment */}
              <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Order Summary</h4>
                {cart.map(item => {
                  const bd = itemBreakdowns[item.listingId];
                  return (
                    <div key={item.listingId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                      <span>{item.title} × {item.quantity}</span>
                      <span>{formatPrice(bd?.buyer?.totalPaid || item.price, 'USD')}</span>
                    </div>
                  );
                })}
                <div style={{ borderTop: '1px solid #ddd', marginTop: 8, paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Items</span><span>{formatPrice(subtotalItems, 'USD')}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Shipping</span><span>{formatPrice(totalShipping, 'USD')}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Protection</span><span>{formatPrice(totalProtection, 'USD')}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, marginTop: 8 }}><span>Total</span><span style={{ color: '#FF4D6D' }}>{formatPrice(grandTotal, 'USD')}</span></div>
                </div>
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