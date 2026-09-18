import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { toast } from 'react-toastify';
import api, { validatePromo, applyBundleDiscount } from '../services/api';
import { formatPrice, convertAmount } from '../utils/helpers';
import StripeCheckoutForm from '../components/StripeCheckoutForm';
import { FaTrash, FaMinus, FaPlus, FaShoppingBag, FaArrowLeft, FaShieldAlt, FaTruck, FaCreditCard, FaSpinner, FaTag, FaPercent, FaBoxes } from 'react-icons/fa';

const Cart = () => {
  const navigate = useNavigate();
  const { cart, removeFromCart, updateQuantity, clearCart } = useCart();
  const { currency } = useTheme();
  const [stripePromise, setStripePromise] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [shippingInfo, setShippingInfo] = useState({
    fullName: '', street1: '', city: '', state: '', postalCode: '', country: 'US', phone: ''
  });
  // Authoritative payment state created by the SERVER. The intent is created
  // BEFORE the Stripe form renders so the button amount (displayed) always
  // equals the amount the card will actually be charged.
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentIntentId, setPaymentIntentId] = useState(null);
  const [serverTotalAmount, setServerTotalAmount] = useState(null);
  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  // Bundle discount state
  const [bundleDiscounts, setBundleDiscounts] = useState([]);
  const [bundleDiscount, setBundleDiscount] = useState(0);

  useEffect(() => {
    const initStripe = async () => {
      try {
        const res = await api.get('/payments/publishable-key');
        const key = res.data.publishableKey;
        const configured = res.data.configured;
        
        console.log('Stripe init:', { configured, keyPrefix: key ? key.substring(0, 7) + '...' : 'not set' });
        
        if (configured && key && key.startsWith('pk_')) {
          setStripePromise(loadStripe(key));
        } else {
          try {
            const statusRes = await api.get('/payments/status');
            console.log('Payment status:', statusRes.data);
          } catch (e) {}
        }
      } catch (e) {
        console.error('Stripe init error:', e);
      }
    };
    initStripe();
  }, []);

  // Build the exact item payload the server expects. Cart state can come from
  // stale/tampered local storage, so never forward a non-integral quantity to
  // money endpoints. The server validates this too; normalizing here gives
  // the buyer a recoverable checkout instead of a confusing NaN/400 response.
  const normalizeQuantity = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  };

  // negotiatedPrice is ONLY sent for genuinely negotiated items — otherwise it
  // could override the listing price and bypass offer validation.
  const buildItemsPayload = () =>
    cart.map(item => ({
      listingId: item.listingId,
      quantity: normalizeQuantity(item.quantity),
      ...(item.offerId ? { offerId: item.offerId } : {}),
      ...(item.negotiatedPrice != null ? { negotiatedPrice: item.negotiatedPrice } : {}),
      currency: item.currency || 'USD'
    }));

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
        if (listing.quantity < normalizeQuantity(item.quantity)) {
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

    // Show the payment form only after availability is checked. The intent is
    // created when the buyer submits the card, after shipping details have
    // been entered. Creating it here used the default US address, then a
    // buyer changing country authorized the wrong shipping total and caused
    // confirm-batch to reject the payment (or risked amount drift).
    setClientSecret(null);
    setPaymentIntentId(null);
    setServerTotalAmount(null);
    setShowForm(true);
    setPaymentLoading(false);
  };

  const handleSuccess = async (paymentMethod) => {
    try {
      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe not loaded');

      // Create the authorization from the final shipping address. Shipping
      // country changes the server-computed total, so this must happen after
      // the buyer has completed the form rather than on the initial checkout
      // click.
      let activeClientSecret = clientSecret;
      let activePaymentIntentId = paymentIntentId;
      if (!activeClientSecret || !activePaymentIntentId) {
        const createRes = await api.post('/payments/create-intent', {
          items: buildItemsPayload(),
          shippingAddress: shippingInfo,
          buyerCountry: shippingInfo.country || 'US',
          promoCode: appliedPromo ? appliedPromo.code : null,
        });
        activeClientSecret = createRes.data.clientSecret;
        activePaymentIntentId = createRes.data.paymentIntentId;
        setClientSecret(activeClientSecret);
        setPaymentIntentId(activePaymentIntentId);
        setServerTotalAmount(createRes.data.amount != null ? createRes.data.amount : null);
      }

      // STEP 2: Confirm payment with Stripe (3DS2/SCA-aware)
      let { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(activeClientSecret, {
        payment_method: paymentMethod.id,
      });

      // 3-D Secure v2: some banks (especially cross-border EU/UK/IN cards)
      // require an additional challenge. Loop handleCardAction until resolved
      // instead of failing every SCA card on iOS/Android/web.
      let attempts = 0;
      while (!confirmError && paymentIntent?.status === 'requires_action' && attempts < 5) {
        const { error: actionError, paymentIntent: updatedPi } = await stripe.handleCardAction(activeClientSecret);
        confirmError = actionError || null;
        if (updatedPi) paymentIntent = updatedPi;
        attempts += 1;
      }

      if (confirmError) throw new Error(confirmError.message);
      // R32 FIX (production /cart bug): confirm-batch (manual capture,
      // capture_method:'manual') authorizes the card WITHOUT charging it, so
      // Stripe.js resolves the confirmation with status 'requires_capture'.
      // The old `!== 'succeeded'` guard treated every real authorization as a
      // failure: the buyer's money was HELD but the order was never placed —
      // "payment confirmed, order placement failed, stuck on cart". Accept
      // both terminal payment states here; the server capture happens in
      // confirm-batch (STEP 3) after the order is validated.
      if (!['succeeded', 'requires_capture'].includes(paymentIntent?.status)) {
        throw new Error(`Payment status: ${paymentIntent?.status}`);
      }

      // STEP 3: Confirm batch with all items (same payload shape as intent)
      try {
        const confirmRes = await api.post('/payments/confirm-batch', {
          paymentIntentId: activePaymentIntentId,
          items: buildItemsPayload(),
          shippingAddress: shippingInfo,
        });

        // Use promo code if applied (mark usage)
        if (appliedPromo) {
          try {
            await api.post(`/promos/${appliedPromo._id}/use`);
          } catch (e) {
            console.error('Failed to mark promo used:', e);
          }
        }

        clearCart();
        setShowForm(false);
        toast.success('Order placed successfully! 🎉');

        // Navigate with the router — window.location.href deep-links are a
        // hard page load that breaks inside the Capacitor WebView
        // (capacitor://localhost/orders/... is not a real URL).
        const orderId = confirmRes.data.orders?.[0]?._id || confirmRes.data.transactions?.[0]?._id;
        if (orderId) {
          setTimeout(() => navigate(`/orders/${orderId}`), 1500);
        }
      } catch (orderError) {
        // R32.2 FIX: order placement failed AFTER the card was authorized.
        // Without this, the buyer is left with funds HELD on their card and
        // no order (a stranded hold for ~7 days). Hand the authorization back
        // so no money stays reserved, then surface the failure.
        console.error('Order placement failed after payment authorization:', orderError);
        try {
          await api.post('/payments/cancel-payment', { paymentIntentId: activePaymentIntentId });
        } catch (e) {
          // Never mask the original failure with a release error.
          console.error('Failed to release the payment authorization:', e);
        }
        throw orderError;
      }
      return true;
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error(error.response?.data?.message || 'Failed to place order');
      return false;
    }
  };

  const [itemBreakdowns, setItemBreakdowns] = useState({});

  const fetchBundleDiscounts = async () => {
    if (cart.length === 0) return;
    try {
      const res = await applyBundleDiscount({
        items: cart.map(i => ({ listingId: i.listingId, quantity: i.quantity }))
      });
      if (res.data.discounts) {
        setBundleDiscounts(res.data.discounts);
        setBundleDiscount(res.data.totalBundleDiscount || 0);
      }
    } catch (e) {
      // Bundle discounts may not be configured - this is non-critical
    }
  };

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
    if (cart.length > 0) {
      fetchBreakdowns();
      fetchBundleDiscounts();
    }
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

    // GLOBAL CURRENCY STANDARD: breakdown/price values are denominated in the
    // ITEM's currency — convert each line to the user's preferred currency
    // BEFORE summing, otherwise a multi-currency bag totals mixed units.
    const preferred = currency || 'USD';
    const itemCurrency = item.currency || 'USD';
    const toPreferred = (value) => convertAmount(value, itemCurrency, preferred);

    if (bd && bd.buyer) {
      group.subtotal += toPreferred(bd.buyer.itemPrice * item.quantity);
      group.shipping += toPreferred(bd.buyer.shippingCost * item.quantity);
      group.protection += toPreferred(bd.buyer.buyerProtectionFee * item.quantity);
      group.total += toPreferred(bd.buyer.totalPaid * item.quantity);
    } else {
      group.subtotal += toPreferred(item.price * item.quantity);
      group.total += toPreferred(item.price * item.quantity);
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

  // Apply bundle discount (visual only - actual discount calculated server-side).
  // The server computes discounts on raw item prices (item currency), so the
  // discount is converted into the preferred currency before it is subtracted
  // from (and displayed next to) the converted totals.
  const bundleDiscountPreferred = convertAmount(bundleDiscount, cart[0]?.currency || 'USD', currency || 'USD');
  const promoDiscountPreferred = appliedPromo?.discountAmount
    ? convertAmount(appliedPromo.discountAmount, cart[0]?.currency || 'USD', currency || 'USD')
    : 0;
  const totalDiscountPreferred = bundleDiscountPreferred + promoDiscountPreferred;
  const displayTotal = totalDiscountPreferred > 0
    ? Math.max(0, grandTotal - totalDiscountPreferred)
    : grandTotal;

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
                    Shipping: {formatPrice(pkg.shipping, currency || 'USD')}
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
                        disabled={item.quantity <= 1}
                        style={{ width: 28, height: 28, opacity: item.quantity <= 1 ? 0.4 : 1 }}><FaMinus size={10} /></button>
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
            
            {/* Promo Code Section */}
            {!showForm && (
              <div style={{ marginBottom: 'var(--td-space-md)' }}>
                {!appliedPromo ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="form-input" placeholder="Promo code" value={promoCode}
                      onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoError(''); }}
                      style={{ flex: 1, fontSize: 13 }} />
                    <button className="btn btn-outline btn-sm" disabled={!promoCode || promoLoading}
                      onClick={async () => {
                        setPromoLoading(true);
                        setPromoError('');
                        try {
                          const res = await validatePromo({
                            code: promoCode,
                            items: cart.map(i => ({ listingId: i.listingId, quantity: i.quantity }))
                          });
                          if (res.data.valid) {
                            setAppliedPromo(res.data.promo);
                            toast.success(`Promo applied! Save ${formatPrice(res.data.promo.discountAmount, cart[0]?.currency || 'USD')}`);
                          }
                        } catch (err) {
                          setPromoError(err.response?.data?.message || 'Invalid promo code');
                        } finally { setPromoLoading(false); }
                      }}>
                      <FaTag size={12} /> Apply
                    </button>
                  </div>
                ) : (
                  <div className="badge badge-success" style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span>Code <strong>{appliedPromo.code}</strong> — Save {formatPrice(appliedPromo.discountAmount, cart[0]?.currency || 'USD')}</span>
                    <button className="btn btn-icon btn-ghost" onClick={() => { setAppliedPromo(null); setPromoCode(''); }}
                      style={{ color: '#fff', width: 24, height: 24 }}><FaTrash size={10} /></button>
                  </div>
                )}
                {promoError && <div style={{ fontSize: 12, color: 'var(--td-error)', marginTop: 4 }}>{promoError}</div>}
              </div>
            )}

            {/* Bundle Discount Display */}
            {bundleDiscounts.length > 0 && (
              <div style={{ marginBottom: 'var(--td-space-md)', padding: 8, background: 'var(--td-surface-2)', borderRadius: 'var(--td-radius-sm)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--td-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FaBoxes /> Bundle Discounts Active
                </div>
                {bundleDiscounts.map((d, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--td-text-tertiary)', marginTop: 2 }}>
                    {d.ruleName}: -{formatPrice(d.discountAmount, cart[0]?.currency || 'USD')}
                  </div>
                ))}
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--td-primary)', marginTop: 4 }}>
                  Total Bundle Savings: -{formatPrice(bundleDiscount, cart[0]?.currency || 'USD')}
                </div>
              </div>
            )}

            {Object.keys(itemBreakdowns).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 'var(--td-space-md)' }}>
                <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                  <span>Items Subtotal</span><span>{formatPrice(subtotalItems, currency || 'USD')}</span>
                </div>
                {sellerPackages.length > 1 && sellerPackages.map((pkg, i) => (
                  <div key={i} className="flex-between" style={{ fontSize: 12, color: 'var(--td-text-tertiary)', paddingLeft: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaTruck size={10} /> Package {i + 1} ({pkg.sellerName})</span>
                    <span>{formatPrice(pkg.shipping, currency || 'USD')}</span>
                  </div>
                ))}
                <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaTruck size={12} /> Total Shipping ({sellerPackages.length} {sellerPackages.length === 1 ? 'package' : 'packages'})</span>
                  <span>{formatPrice(totalShipping, currency || 'USD')}</span>
                </div>
                <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaShieldAlt size={12} /> Buyer Protection</span>
                  <span>{formatPrice(totalProtection, currency || 'USD')}</span>
                </div>
                {promoDiscountPreferred > 0 && (
                  <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-success)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaTag size={12} /> Promo Savings</span>
                    <span>-{formatPrice(promoDiscountPreferred, currency || 'USD')}</span>
                  </div>
                )}
                {bundleDiscount > 0 && (
                  <div className="flex-between" style={{ fontSize: 14, color: 'var(--td-success)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><FaBoxes size={12} /> Bundle Savings</span>
                    <span>-{formatPrice(bundleDiscountPreferred, currency || 'USD')}</span>
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--td-border)', margin: '4px 0', paddingTop: 12 }}>
                  <div className="flex-between">
                    <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
                    <span style={{ fontWeight: 800, fontSize: 22, color: 'var(--td-primary)' }}>{formatPrice(displayTotal, currency || 'USD')}</span>
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
                        <span style={{ fontWeight: 600 }}>{formatPrice(bd?.buyer?.totalPaid ?? item.price, item.currency || 'USD')}</span>
                      </div>
                    );
                  })}
                </div>

                <p style={{ fontSize: 12, color: 'var(--td-text-tertiary)', marginBottom: 12 }}>
                  By continuing, you agree to the <a href="/legal/terms" target="_blank" rel="noreferrer">Terms of Service</a> and acknowledge the <a href="/legal/buyer" target="_blank" rel="noreferrer">Buyer Rules and Returns</a>. Your country’s mandatory consumer rights still apply.
                </p>

                {stripePromise ? (
                  <Elements stripe={stripePromise}>
                    <StripeCheckoutForm
                      items={cart}
                      shippingInfo={shippingInfo}
                      totalAmount={serverTotalAmount != null ? formatPrice(serverTotalAmount, 'USD') : formatPrice(displayTotal, currency || 'USD')}
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