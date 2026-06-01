import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCart } from '../context/CartContext';
import { toast } from 'react-toastify';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';
import StripeCheckoutForm from '../components/StripeCheckoutForm';
import { FaTrash, FaMinus, FaPlus, FaShoppingBag, FaArrowLeft, FaShieldAlt, FaTruck, FaCreditCard, FaSpinner } from 'react-icons/fa';

const Cart = () => {
  const { cart, removeFromCart, updateQuantity, clearCart } = useCart();
  const [stripePromise, setStripePromise] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [shippingInfo, setShippingInfo] = useState({
    fullName: '', street1: '', city: '', state: '', postalCode: '', country: 'US', phone: ''
  });

  useEffect(() => {
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
    setPaymentLoading(true);
    try {
      for (const item of cart) {
        const res = await api.get(`/listings/${item.listingId}`);
        const listing = res.data.listing;
        if (!listing.available || listing.sold) {
          toast.error(`"${listing.title}" is no longer available`);
          setPaymentLoading(false);
          return;
        }
        if (listing.quantity < item.quantity) {
          toast.error(`Only ${listing.quantity} left of "${listing.title}"`);
          setPaymentLoading(false);
          return;
        }
      }
    } catch (error) {
      toast.error('Failed to verify item availability');
      setPaymentLoading(false);
      return;
    }
    if (!stripePromise) {
      toast.error('Payment system not loaded. Please refresh the page.');
      setPaymentLoading(false);
      return;
    }
    setShowForm(true);
    setPaymentLoading(false);
  };

  const handleSuccess = async (paymentMethod) => {
    try {
      const items = cart.map(item => ({
        listingId: item.listingId,
        quantity: item.quantity,
        negotiatedPrice: item.negotiatedPrice || item.price,
        currency: item.currency || 'USD'
      }));

      // Step 1: Create payment intent
      const firstItem = items[0];
      const createRes = await api.post('/payments/create-intent', {
        listingId: firstItem.listingId,
        shippingAddress: shippingInfo,
        buyerCountry: shippingInfo.country || 'US'
      });

      const { clientSecret: cs, paymentIntentId } = createRes.data;

      // Step 2: Confirm payment with Stripe
      if (!stripePromise) throw new Error('Stripe not loaded');
      const stripe = await stripePromise;
      
      const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(cs, {
        payment_method: paymentMethod.id,
      });

      if (confirmError) throw new Error(confirmError.message);
      if (paymentIntent.status !== 'succeeded') throw new Error(`Payment status: ${paymentIntent.status}`);

      // Step 3: Confirm batch with all items
      const confirmRes = await api.post('/payments/confirm-batch', {
        paymentIntentId,
        items,
        shippingAddress: shippingInfo
      });

      clearCart();
      setShowForm(false);
      toast.success('Order placed successfully! 🎉');
      
      if (confirmRes.data.transactions && confirmRes.data.transactions.length > 0) {
        setTimeout(() => {
          window.location.href = `/orders/${confirmRes.data.transactions[0]._id}`;
        }, 2000);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error(error.response?.data?.message || 'Failed to place order');
    }
  };

  const [itemBreakdowns, setItemBreakdowns] = useState({});

  useEffect(() => {
    const fetchBreakdowns = async () => {
      const breakdowns = {};
      for (const item of cart) {
        try {
          const res = await api.post('/payments/breakdown', {
            itemPrice: item.price,
            fromCountry: item.sellerCountry || 'US',
            toCountry: shippingInfo.country || 'US',
            weightKg: item.weight || 0.5,
          });
          breakdowns[item.listingId] = res.data;
        } catch (e) {
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
    if (cart.length > 0) fetchBreakdowns();
  }, [cart, shippingInfo.country]);

  // Group cart items by seller for package display
  const sellerGroups = {};
  cart.forEach(item => {
    const sellerKey = item.sellerId || 'unknown';
    if (!sellerGroups[sellerKey]) {
      sellerGroups[sellerKey] = {
        sellerId: sellerKey,
        sellerName: item.sellerName || 'Seller',
        items: [],
        subtotal: 0,
        shipping: 0,
        protection: 0,
        total: 0
      };
    }
    const group = sellerGroups[sellerKey];
    const bd = itemBreakdowns[item.listingId];
    group.items.push({ ...item, breakdown: bd });
    
    if (bd && bd.buyer) {
      group.subtotal += bd.buyer.itemPrice * item.quantity;
      group.shipping += bd.buyer.shippingCost * item.quantity;
      group.protection += bd.buyer.buyerProtectionFee * item.quantity;
      group.total += bd.buyer.totalPaid * item.quantity;
    } else {
      group.subtotal += item.price * item.quantity;
      group.total += item.price * item.quantity;
    }
  });
  const sellerPackages = Object.values(sellerGroups);
  
  let subtotalItems = 0, totalShipping = 0, totalProtection = 0, grandTotal = 0;
  sellerPackages.forEach(pkg => {
    subtotalItems += pkg.subtotal;
    totalShipping += pkg.shipping;
    totalProtection += pkg.protection;
    grandTotal += pkg.total;
  });

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--td-space-lg)' }}>
        <Link to="/search" className="continue-shopping"><FaArrowLeft size={14} /> Continue Shopping</Link>
      </div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FaShoppingBag /> Your Bag ({cart.length})
      </h1>

      {cart.length === 0 ? (
        <div className="empty-state" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <div className="empty-state-icon">🛍️</div>
          <h2>Your bag is empty</h2>
          <p>Looks like you haven't added anything yet. Browse our collection and find something you love!</p>
          <Link to="/search" className="btn btn-primary btn-lg">Start Shopping</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 'var(--td-space-xl)', alignItems: 'start' }}>
          {/* Cart Items Grouped by Seller */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--td-space-md)' }}>
            {sellerPackages.map((pkg, pkgIndex) => (
              <div key={pkg.sellerId || pkgIndex} className="glass-card" style={{ 
                padding: 0, overflow: 'hidden',
                animation: `fadeInUp 0.3s ease-out ${pkgIndex * 0.1}s both`
              }}>
                <div style={{ 
                  background: 'linear-gradient(135deg, var(--td-primary), #ff6b8a)',
                  padding: '10px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FaTruck size={14} color="#fff" />
                    <span style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>
                      Package {pkgIndex + 1} — {pkg.sellerName}
                    </span>
                  </div>
                  <span style={{ fontWeight: 600, color: '#fff', fontSize: 12 }}>
                    Shipping: {formatPrice(pkg.shipping, 'USD')}
                  </span>
                </div>
                
                {pkg.items.map((item, i) => (
                  <div key={item.listingId} style={{ 
                    display: 'flex', gap: 16, padding: 16, alignItems: 'center',
                    borderTop: i > 0 ? '1px solid var(--td-border-light)' : 'none'
                  }}>
                    <img src={item.thumbnail} alt={item.title}
                      style={{ width: 72, height: 72, borderRadius: 'var(--td-radius-sm)', objectFit: 'cover', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{item.title}</h4>
                      {item.negotiatedPrice && <span className="badge badge-success" style={{ marginBottom: 4, fontSize: 10 }}>Negotiated</span>}
                      <div style={{ fontSize: 12, color: 'var(--td-text-tertiary)' }}>{formatPrice(item.price, item.currency)} each</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button className="btn btn-icon btn-ghost" onClick={() => updateQuantity(item.listingId, item.quantity - 1)}
                        style={{ width: 28, height: 28 }}><FaMinus size={10} /></button>
                      <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center', fontSize: 14 }}>{item.quantity}</span>
                      <button className="btn btn-icon btn-ghost" onClick={() => {
                        if (item.quantity < (item.available || Infinity)) updateQuantity(item.listingId, item.quantity + 1);
                        else toast.error(`Only ${item.available} available`);
                      }} style={{ width: 28, height: 28 }}><FaPlus size={10} /></button>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 70 }}>
                      <div style={{ fontWeight: 700, color: 'var(--td-primary)', fontSize: 14 }}>{formatPrice(item.price * item.quantity, item.currency)}</div>
                    </div>
                    <button className="btn btn-icon btn-ghost" onClick={() => removeFromCart(item.listingId)}
                      style={{ color: 'var(--td-error)', width: 32, height: 32 }} title="Remove"><FaTrash size={12} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Order Summary */}
          <div className="glass-card" style={{ padding: 'var(--td-space-lg)', position: 'sticky', top: 'calc(var(--td-nav-height) + var(--td-space-lg))' }}>
            <h3 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Order Summary</h3>
            
            {Object.keys(itemBreakdowns).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 'var(--td-space-md)' }}>
                <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                  <span>Items Subtotal</span><span>{formatPrice(subtotalItems, 'USD')}</span>
                </div>
                {sellerPackages.length > 1 && sellerPackages.map((pkg, i) => (
                  <div key={i} className="flex-between" style={{ fontSize: 12, color: 'var(--td-text-tertiary)', paddingLeft: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaTruck size={10} /> Package {i + 1} ({pkg.sellerName})</span>
                    <span>{formatPrice(pkg.shipping, 'USD')}</span>
                  </div>
                ))}
                <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaTruck size={12} /> Total Shipping ({sellerPackages.length} {sellerPackages.length === 1 ? 'package' : 'packages'})</span>
                  <span>{formatPrice(totalShipping, 'USD')}</span>
                </div>
                <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaShieldAlt size={12} /> Buyer Protection</span>
                  <span>{formatPrice(totalProtection, 'USD')}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--td-border)', margin: '4px 0', paddingTop: 12 }}>
                  <div className="flex-between">
                    <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
                    <span style={{ fontWeight: 800, fontSize: 22, color: 'var(--td-primary)' }}>{formatPrice(grandTotal, cart[0]?.currency || 'USD')}</span>
                  </div>
                </div>
              </div>
            )}

            {!showForm ? (
              <button className="btn btn-primary btn-block btn-lg" onClick={handleCheckout} disabled={cart.length === 0 || paymentLoading}>
                {paymentLoading ? <><FaSpinner className="spinner-sm" /> Checking...</> : <><FaCreditCard /> Proceed to Checkout</>}
              </button>
            ) : (
              <div style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                <h4 style={{ fontWeight: 700, marginBottom: 'var(--td-space-md)' }}>Shipping Details</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 'var(--td-space-md)' }}>
                  <input type="text" className="form-input" placeholder="Full Name *" value={shippingInfo.fullName}
                    onChange={e => setShippingInfo({...shippingInfo, fullName: e.target.value})} required />
                  <input type="text" className="form-input" placeholder="Street Address *" value={shippingInfo.street1}
                    onChange={e => setShippingInfo({...shippingInfo, street1: e.target.value})} required />
                  <input type="text" className="form-input" placeholder="City *" value={shippingInfo.city}
                    onChange={e => setShippingInfo({...shippingInfo, city: e.target.value})} required />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="text" className="form-input" placeholder="State *" value={shippingInfo.state}
                      onChange={e => setShippingInfo({...shippingInfo, state: e.target.value})} required />
                    <input type="text" className="form-input" placeholder="ZIP Code *" value={shippingInfo.postalCode}
                      onChange={e => setShippingInfo({...shippingInfo, postalCode: e.target.value})} required />
                  </div>
                  <select className="form-input" value={shippingInfo.country}
                    onChange={e => setShippingInfo({...shippingInfo, country: e.target.value})} required>
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                    <option value="GB">United Kingdom</option>
                    <option value="DE">Germany</option>
                    <option value="FR">France</option>
                    <option value="AU">Australia</option>
                    <option value="JP">Japan</option>
                    <option value="IN">India</option>
                    <option value="AE">UAE</option>
                    <option value="SG">Singapore</option>
                    <option value="BR">Brazil</option>
                  </select>
                  <input type="text" className="form-input" placeholder="Phone" value={shippingInfo.phone}
                    onChange={e => setShippingInfo({...shippingInfo, phone: e.target.value})} />
                </div>

                <div className="glass-card" style={{ padding: 12, marginBottom: 'var(--td-space-md)' }}>
                  <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--td-text-secondary)' }}>Items</h5>
                  {cart.map(item => {
                    const bd = itemBreakdowns[item.listingId];
                    return (
                      <div key={item.listingId} className="flex-between" style={{ fontSize: 13, padding: '2px 0' }}>
                        <span style={{ color: 'var(--td-text-secondary)' }}>{item.title} × {item.quantity}</span>
                        <span style={{ fontWeight: 600 }}>{formatPrice(bd?.buyer?.totalPaid || item.price, 'USD')}</span>
                      </div>
                    );
                  })}
                </div>

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
                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: 'var(--td-text-tertiary)', fontSize: 14 }}>Loading payment system...</p>
                    <button className="btn btn-outline btn-sm" onClick={() => setShowForm(false)} style={{ marginTop: 12 }}>Back</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Cart;