import React from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { toast } from 'react-toastify';
import api from '../services/api';
import { formatPrice } from '../utils/helpers';

const Cart = () => {
  const { cart, removeFromCart, updateQuantity, clearCart, totalAmount } = useCart();

  // Simple Luhn algorithm to validate a 16‑digit card number
  const isValidCardNumber = (num) => {
    if (!/^\d{16}$/.test(num)) return false;
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      let digit = parseInt(num.charAt(15 - i), 10);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  };

  // UI state for showing checkout form
  const [showForm, setShowForm] = React.useState(false);
  const [cardNumber, setCardNumber] = React.useState('');
  const [shippingInfo, setShippingInfo] = React.useState({
    fullName: '', street1: '', city: '', state: '', postalCode: '', country: 'US', phone: ''
  });

  const handleCheckout = async () => {
    if (cart.length === 0) return toast.error('Cart is empty');

    // Validate inventory before proceeding
    const outOfStockItem = cart.find((item) => {
      const available = item.available ?? Infinity;
      return item.quantity > available;
    });
    if (outOfStockItem) {
      toast.error(`Only ${outOfStockItem.available} left of "${outOfStockItem.title}"`);
      return;
    }

    // Show the checkout form UI
    setShowForm(true);
  };

  const submitCheckout = async (e) => {
    e.preventDefault();
    if (!isValidCardNumber(cardNumber)) {
      toast.error('Invalid card number. Please enter a valid 16‑digit number.');
      return;
    }
    // Basic shipping validation
    if (!shippingInfo.fullName) {
      toast.error('Please fill in shipping details');
      return;
    }
    try {
      for (const item of cart) {
        const intentRes = await api.post('/payments/create-intent', {
          listingId: item.listingId,
          shippingAddress: shippingInfo,
          buyerCountry: shippingInfo.country || 'US',
        });
        const { paymentIntentId } = intentRes.data;
        const confirmRes = await api.post('/payments/confirm', {
          paymentIntentId,
          listingId: item.listingId,
          shippingAddress: shippingInfo,
        });
        if (confirmRes.status !== 200 && confirmRes.status !== 201) {
          throw new Error('Payment confirmation failed');
        }
        const transaction = confirmRes.data.transaction;
        await api.post('/shipping/generate-label', { transactionId: transaction._id });
      }
      toast.success('Purchase completed and shipping labels generated');
      clearCart();
      setShowForm(false);
    } catch (err) {
      console.error(err);
      toast.error('Checkout failed');
    }
  };

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
                    <button
                      className="btn btn-sm"
                      onClick={() => updateQuantity(item.listingId, item.quantity - 1)}
                    >-</button>
                    <span style={{ margin: '0 8px' }}>{item.quantity}</span>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        if (item.quantity < (item.available || Infinity)) {
                          updateQuantity(item.listingId, item.quantity + 1);
                        } else {
                          toast.error(`Only ${item.available} available`);
                        }
                      }}
                    >+</button>
                  </td>
                  <td style={{ padding: '10px' }}>{formatPrice(item.price * item.quantity, item.currency)}</td>
                  <td style={{ padding: '10px' }}>
                    <button className="btn btn-outline" onClick={() => removeFromCart(item.listingId)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" style={{ textAlign: 'right', fontWeight: 'bold', padding: '10px' }}>Grand Total:</td>
                <td style={{ padding: '10px' }}>{formatPrice(totalAmount(), 'USD')}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
      <div style={{ textAlign: 'right', marginTop: '20px' }}>
        {/* Show checkout button when form is not visible */}
        {!showForm && (
          <button className="btn btn-primary" onClick={handleCheckout} disabled={cart.length === 0}>
            Checkout
          </button>
        )}
      </div>

      {/* Checkout form overlay */}
      {showForm && (
        <div className="checkout-form" style={{ marginTop: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3 style={{ marginBottom: '15px' }}>Enter Payment & Shipping Details</h3>
          <form onSubmit={submitCheckout} style={{ display: 'grid', gap: '10px' }}>
            <input type="text" placeholder="Card Number (16 digits)" value={cardNumber} onChange={e => setCardNumber(e.target.value)} required style={{ padding: '8px' }} />
            <input type="text" placeholder="Full Name" value={shippingInfo.fullName} onChange={e => setShippingInfo({ ...shippingInfo, fullName: e.target.value })} required style={{ padding: '8px' }} />
            <input type="text" placeholder="Street Address" value={shippingInfo.street1} onChange={e => setShippingInfo({ ...shippingInfo, street1: e.target.value })} required style={{ padding: '8px' }} />
            <input type="text" placeholder="City" value={shippingInfo.city} onChange={e => setShippingInfo({ ...shippingInfo, city: e.target.value })} required style={{ padding: '8px' }} />
            <input type="text" placeholder="State / Province" value={shippingInfo.state} onChange={e => setShippingInfo({ ...shippingInfo, state: e.target.value })} required style={{ padding: '8px' }} />
            <input type="text" placeholder="Postal Code" value={shippingInfo.postalCode} onChange={e => setShippingInfo({ ...shippingInfo, postalCode: e.target.value })} required style={{ padding: '8px' }} />
            <input type="text" placeholder="Country (ISO code)" value={shippingInfo.country} onChange={e => setShippingInfo({ ...shippingInfo, country: e.target.value })} required style={{ padding: '8px' }} />
            <input type="text" placeholder="Phone Number" value={shippingInfo.phone} onChange={e => setShippingInfo({ ...shippingInfo, phone: e.target.value })} style={{ padding: '8px' }} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button type="submit" className="btn btn-primary">Pay & Order</button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )}
</div>
);
};

export default Cart;
